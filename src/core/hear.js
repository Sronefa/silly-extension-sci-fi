// Reading actions out of the player's own words. When a message is sent, the game works out
// whether the character does something in the world ("I grab a hot meal at a stall"), which
// action and on what, and how sure it is. Sure readings are carried out like a panel action;
// unsure ones become a "did you mean" chip. Three readers, best first:
//  - Jev (TypeSafe System One): a model that only picks from the answers we offer, with
//    calibrated probabilities. Fast and cheap, needs the player's own key.
//  - A side call to a language model (a connection profile or the chat model).
//  - A quick text pass with patterns, which only ever suggests.
// Whatever the reader says, the engine still checks the action against its rules.
import { ctx, settings } from './st.js';
import { S, locationLabel } from './state.js';
import { sideCall, parseJson, sideProfile } from './llm.js';

const specs = [];

/**
 * Something the character can be heard doing.
 * - id: unique name; intent: the panel action that carries it out.
 * - what: one plain sentence, "Rent a bed for the night".
 * - when(st): whether it is possible at all right now (cheap; the engine still checks).
 * - options(st): the things it can apply to here, [{ label, args, hint? }]; leave out if none.
 * - args(st, text, option): the action's arguments, with numbers read from the text.
 * - re: a pattern for the quick text pass (obvious phrasing only).
 * - order: when several are heard in one message, lower goes first (walking before eating).
 */
export function registerHear(spec) {
    specs.push({ order: 50, ...spec });
}

/** What can be heard right now, with the options resolved. */
export function hearable(st = S(), skip = []) {
    const out = [];
    for (const s of specs) {
        if (skip.includes(s.intent) && !s.repeat) continue;
        try {
            if (s.when && !s.when(st)) continue;
            const options = s.options ? s.options(st).filter(Boolean) : null;
            if (options && !options.length) continue;
            out.push({ ...s, opts: options });
        } catch (e) { console.warn('[Ship-OS] hear spec failed', s.id, e); }
    }
    return out;
}

// ---- Numbers in the text ----

const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20, fifty: 50, hundred: 100 };
const num = (s) => (/^\d/.test(s) ? Number(s) : WORDS[String(s).toLowerCase()] ?? NaN);

/** A quantity such as "10 t", "five tonnes", "20 units". */
export function readQty(text, fallback = 1) {
    const m = /(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|fifty|hundred)\s*(t\b|tons?\b|tonnes?\b|units?\b|crates?\b|containers?\b|loads?\b|x\b)/i.exec(text);
    if (m) return Math.max(1, Math.floor(num(m[1])));
    return fallback;
}

/** Hours such as "8 hours", "2h", "a couple of hours". */
export function readHours(text, fallback) {
    if (/couple of hours/i.test(text)) return 2;
    if (/an? hour\b/i.test(text)) return 1;
    const m = /(\d+(?:\.\d+)?|two|three|four|five|six|seven|eight|nine|ten|twelve)\s*(h\b|hrs?\b|hours?\b)/i.exec(text);
    return m ? num(m[1]) : fallback;
}

const short = (s, n = 70) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

// ---- Readers ----

const slug = (s, used) => {
    let k = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'option';
    while (used.has(k)) k += '_';
    used.add(k);
    return k;
};

function sceneOf(st) {
    const bits = [locationLabel(st)];
    if (st.activity) bits.push(`${st.activity.on ? 'Busy with' : 'Booked for'}: ${st.activity.name}`);
    if (st.custody) bits.push(st.custody.type === 'prison' ? 'In prison' : `Enslaved by ${st.custody.owner}`);
    return bits.join('. ');
}

/** Jev: one yes/no question per action that is possible here, and one choice per action with options. */
async function askJev(st, text, list, signal) {
    const cfg = settings();
    const questions = {};
    const keys = [];
    list.forEach((s, i) => {
        questions[`do${i}`] = {
            type: 'noul',
            instructions: `In \`player_message\`, does the player's own character actually do this, now: ${s.what}?`,
            criteria: {
                true: 'The character does it in this message, as their action now.',
                false: 'They only talk, think, plan, ask, hesitate or refuse, someone else does it, or it is not in the message.',
            },
        };
        if (s.opts && s.opts.length > 1) {
            const used = new Set();
            const map = {};
            const ids = s.opts.map(o => { const k = slug(o.label, used); map[k] = o.hint ? `${o.label}: ${o.hint}` : o.label; return k; });
            map.unclear = 'Not said, or none of these';
            keys[i] = ids;
            questions[`pick${i}`] = { type: 'choice', instructions: `If the character in \`player_message\` does this: ${s.what}, which one?`, criteria: map };
        }
    });
    const body = JSON.stringify({ model: cfg.jevModel || 'jev-latest', state: { scene: sceneOf(st), player_message: text }, questions });
    const res = await jevFetch(body, signal);
    const answers = res?.answers ?? {};
    const out = [];
    list.forEach((s, i) => {
        const yes = Number(answers[`do${i}`]?.noul ?? 0);
        if (!(yes > 0)) return;
        let opt = s.opts?.length === 1 ? s.opts[0] : null;
        let p = yes;
        const pick = answers[`pick${i}`];
        if (pick && keys[i]) {
            const k = pick.choice;
            if (!k || k === 'unclear') return;
            opt = s.opts[keys[i].indexOf(k)];
            p *= Number(pick.probabilities?.[k] ?? pick.confidence ?? 1);
        }
        if (s.opts && !opt) return;
        out.push({ spec: s, opt, p });
    });
    return out;
}

let jevRoute = null; // 'direct' or 'proxy', learned on the first call

async function jevFetch(body, signal) {
    const cfg = settings();
    if (!cfg.jevKey) throw new Error('no Jev key');
    const url = cfg.jevUrl || 'https://api.typesafe.ai/v1/systemone';
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.jevKey}` };
    const direct = () => fetch(url, { method: 'POST', headers, body, signal });
    // SillyTavern's own CORS proxy, for when the browser may not call the service directly.
    const proxy = () => fetch(`/proxy/${url}`, { method: 'POST', headers: { ...(ctx().getRequestHeaders?.() ?? {}), ...headers }, body, signal });
    let res;
    const fixed = cfg.jevRoute && cfg.jevRoute !== 'auto' ? cfg.jevRoute : null;
    if ((fixed ?? jevRoute) === 'proxy') res = await proxy();
    else {
        try {
            res = await direct();
            jevRoute = 'direct';
        } catch (e) {
            // A blocked browser request fails without a status; try SillyTavern's proxy instead.
            if (signal?.aborted || fixed === 'direct') throw e;
            res = await proxy();
            jevRoute = res.ok ? 'proxy' : null;
        }
    }
    if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(res.status === 404 && jevRoute === 'proxy' ? 'the browser cannot reach Jev and SillyTavern\'s CORS proxy is off (enableCorsProxy in config.yaml)' : `Jev ${res.status}: ${short(t, 120)}`);
    }
    return res.json();
}

const SIDE_SYSTEM = [
    'You read one message a player wrote in a roleplay and list the game actions their own character actually performs in it, right now.',
    'Only list an action if the character does it in this message. Talking about it, planning it, thinking about it, asking about it, or someone else doing it does not count.',
    'Only use the action ids and options given. Reply with JSON only, no other text.',
].join('\n');

async function askSide(st, text, list, signal) {
    const lines = list.map((s, i) => `A${i}: ${s.what}${s.opts?.length > 1 ? ` | options: ${s.opts.map(o => o.label).join(' ; ')}` : ''}`);
    const prompt = `Scene: ${sceneOf(st)}\n\nActions possible here:\n${lines.join('\n')}\n\nPlayer message:\n"""${text}"""\n\nReply as {"actions":[{"id":"A0","option":"exact option text or empty","sure":true}]}. Use "sure": false when the message only might mean it. Return {"actions":[]} if the character does none of these.`;
    const reply = await sideCall({ system: SIDE_SYSTEM, prompt, maxTokens: 200, signal });
    const data = parseJson(reply);
    const out = [];
    for (const a of data?.actions ?? []) {
        const s = list[Number(String(a?.id ?? '').replace(/\D/g, ''))];
        if (!s) continue;
        let opt = s.opts?.length === 1 ? s.opts[0] : null;
        if (s.opts?.length > 1) {
            const want = String(a.option ?? '').toLowerCase().trim();
            opt = s.opts.find(o => o.label.toLowerCase() === want) ?? s.opts.find(o => want && (o.label.toLowerCase().includes(want) || want.includes(o.label.toLowerCase())));
            if (!opt) continue;
        }
        out.push({ spec: s, opt, p: a.sure === false ? 0.6 : 0.9 });
    }
    return out;
}

/** The quick pass: obvious phrasing only, and only ever a suggestion. */
function askText(st, text, list) {
    const out = [];
    for (const s of list) {
        if (!s.re || !s.re.test(text)) continue;
        let opt = s.opts?.length === 1 ? s.opts[0] : null;
        if (s.opts?.length > 1) {
            const low = text.toLowerCase();
            opt = s.opts.find(o => low.includes(o.label.toLowerCase())) ?? s.opts.find(o => o.words?.some(w => low.includes(w)));
            if (!opt) continue;
        }
        out.push({ spec: s, opt, p: 0.6 });
    }
    return out;
}

/** A tiny request, to check the key and the route and see how fast Jev answers. */
export async function testJev() {
    const t0 = performance.now();
    const res = await jevFetch(JSON.stringify({
        model: settings().jevModel || 'jev-latest',
        state: { player_message: 'I walk up to the noodle stall and buy a hot meal.' },
        questions: { meal: { type: 'noul', instructions: 'In `player_message`, does the character buy a meal now?' } },
    }));
    return { ms: performance.now() - t0, route: jevRoute ?? 'direct', yes: Number(res?.answers?.meal?.noul ?? 0) };
}

/** Which reader is in use, given the settings. */
export function reader() {
    const cfg = settings();
    const mode = cfg.hearMode ?? 'auto';
    if (mode === 'off') return 'off';
    if (mode === 'jev') return cfg.jevKey ? 'jev' : 'text';
    if (mode === 'side') return 'side';
    if (mode === 'text') return 'text';
    if (cfg.jevKey) return 'jev';
    if (sideProfile()) return 'side';
    return 'text';
}

/**
 * Reads a sent message. Returns { acts, suggest, via, error }: acts are sure enough to carry
 * out, suggest are offered as "did you mean". Each is { name, args, label, line, heard: true }.
 */
export async function hear(text, { skip = [], skipIds = [] } = {}) {
    const st = S();
    const via = reader();
    const empty = { acts: [], suggest: [], via };
    if (!st || st.dead || via === 'off' || !text.trim()) return empty;
    // Fights have their own screens; nothing is read from the chat while one runs.
    if (st.combat || st.shipCombat) return empty;
    const list = hearable(st, skip).filter(s => !skipIds.includes(s.id));
    if (!list.length) return empty;
    const cfg = settings();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), (via === 'jev' ? Number(cfg.jevTimeout) || 6 : 25) * 1000);
    let found = [];
    let error = '';
    try {
        found = via === 'jev' ? await askJev(st, text, list, ctl.signal) : via === 'side' ? await askSide(st, text, list, ctl.signal) : askText(st, text, list);
    } catch (e) {
        error = ctl.signal.aborted ? 'took too long' : String(e.message ?? e);
        console.warn('[Ship-OS] reading the message failed, using the quick pass:', e);
        found = askText(st, text, list);
    } finally { clearTimeout(timer); }
    const sure = Number(cfg.hearSure) || 0.85;
    const ask = Number(cfg.hearAsk) || 0.5;
    const acts = [], suggest = [];
    // One reading per action, the likeliest.
    const best = new Map();
    for (const f of found) if (!best.has(f.spec.id) || best.get(f.spec.id).p < f.p) best.set(f.spec.id, f);
    for (const f of [...best.values()].sort((a, b) => a.spec.order - b.spec.order)) {
        if (f.p < ask) continue;
        let args;
        try { args = f.spec.args ? f.spec.args(st, text, f.opt) : (f.opt?.args ?? {}); } catch { continue; }
        const label = f.spec.label ? f.spec.label(args, st, f.opt) : `${f.spec.verb ?? f.spec.what}${f.opt ? ` ${f.opt.label}` : ''}`;
        const item = { name: f.spec.intent, args, label, line: '', heard: true, p: Math.round(f.p * 100) / 100 };
        (f.p >= sure ? acts : suggest).push(item);
    }
    return { acts, suggest, via, error };
}
