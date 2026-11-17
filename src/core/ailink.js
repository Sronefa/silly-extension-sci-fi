// The link between the campaign state and the AI: telemetry injected into the prompt,
// and hidden <sf>…</sf> update tags parsed out of AI replies.
import { ctx, settings, MODULE, on } from './st.js';
import { S, commit, snapshot, rollbackTo, fmtDate, locationLabel, cargoUsed, cargoCap, shipClass, currentSystem, galaxy, addLog } from './state.js';
import { runBlock, needStatuses, transitInfo, fmtDuration, advanceTime, setAiTimeBudget, passMinutes, aiTimeLeft, aiCreditsLeft } from '../systems/sim.js';
import { estimateMinutes, grantPrompt, grantLine, passTime, pendingAsk, pendingAsleep, setPendingAsk, takeTypedAsk } from '../systems/clock.js';
import { toast } from './st.js';
import { takeQueue, runIntent, cutLine, intentPrompt, setBarNote } from './intents.js';
import { hear } from './hear.js';
import { confirmAsk } from '../ui/hud.js';
import { fmtInt } from './util.js';
import { NEEDS, SHIP_SYSTEMS, FACTIONS, SHIP_WEAPONS, PERSONAL_WEAPONS, ARMORS } from '../data/catalog.js';
import { ATTRIBUTES, SKILL_DEFS, TRAITS, FLAWS, CYBERWARE, CRAFT_CLASSES } from '../data/chargen.js';
import { ENEMIES } from '../data/combat.js';
import { VESSELS } from '../data/vessels.js';
import { attrOf, skillOf, originOf, hasFx } from '../systems/character.js';
import { describeBody, isDown } from '../systems/body.js';
import { factionById, SECURITY_LABELS, systemDistance } from '../systems/galaxy.js';

const TAG_RE = /<sf>([\s\S]*?)<\/sf>|\[sf\]([\s\S]*?)\[\/sf\]/gi;
const extraSections = [];

/**
 * Lets feature modules add to what the storyteller is told. A section returns either a string
 * (facts about the world, which go in the state block) or { rules, state, now }:
 *  - rules: standing instructions that hold while a situation lasts (cached high in the prompt);
 *  - state: facts about the world that change now and then;
 *  - now: what is happening this very moment and must be handled in the next reply.
 */
export function registerPromptSection(fn) {
    extraSections.push(fn);
}

function sections(st) {
    const out = { rules: [], state: [], now: [] };
    for (const fn of extraSections) {
        try {
            const r = fn(st);
            if (!r) continue;
            if (typeof r === 'string') { out.state.push(r); continue; }
            for (const k of ['rules', 'state', 'now']) if (r[k]) out[k].push(r[k]);
        } catch (e) { console.error('[Ship-OS] prompt section failed', e); }
    }
    return out;
}

const hasShipLife = (st) => !!(st.ship || st.post || st.craft?.length || st.transit || st.shipCombat);

/** The commands the storyteller may use, limited to what fits the character's situation. */
export function COMMAND_GUIDE(st = S()) {
    const L = ['Commands, one per line:'];
    L.push('- time +Ns|+Nm|+Nh: how long the reply covered (see <time>).');
    L.push('- credits/debt/health/stress ±N; health "party member" ±N; nourishment/hydration/rest/hygiene/morale ±N.');
    L.push('- item add|remove "name" N; cargo add|remove "name" N; xp <skill> N (5 to 20, when a skill was really put to use).');
    L.push('- wound <head|thorax|abdomen|"left arm"|"right arm"|"left leg"|"right leg"> N [bleed|arterial|fracture|burn|concussion] for harm outside a fight; injury add "name" minor|moderate|severe|critical; injury heal "name"; die "cause" (only when the character is truly killed).');
    L.push('- location "place"; dock "station"; undock; jump "star system".');
    L.push('- rep "faction" ±N; contact "name" ±N; mission add "title" reward N; mission done|fail "title"; crew add|remove "name" "role"; tracker "name" ±N; alert green|yellow|red; log "entry".');
    L.push(`- combat "place" <enemy> <count> [<enemy> <count>...] [ambush|surprise]: the instant a fight starts. Enemies: ${Object.keys(ENEMIES).join(', ')}, or any quoted name.`);
    L.push('- post <captain|commander|xo|pilot|helm|gunnery|engineering|sensors|crew|passenger> "ship name" <hull>: the character takes a position aboard a vessel they do not own; post none when they leave it. Capital ships are state-built and never privately owned: a character commands one only by rank, through post.');
    if (st && hasShipLife(st)) {
        L.push(`- system <reactor|engines|shields|weapons|sensors|lifesupport> ±N; hull/shields/fuel/supplies ±N.`);
        L.push(`- shipcombat "place" <hull> <count> [<hull> <count>...] [allies <hull> <count>...] [ambush]: the instant a space battle starts. Hulls: ${Object.values(VESSELS).filter(v => !v.decoy && !v.civil).map(v => v.id).join(', ')} (add _c for the lighter civilian-pattern version of a warship or fighter).`);
        if (st.ship) L.push('- spare <module name>: the character\'s own ship gains a module or weapon as salvage, reward or purchase (it goes to ship stores to be fitted).');
    }
    return L.join('\n');
}

const tag = (name, body) => `<${name}>\n${body}\n</${name}>`;

const TIME_RULE = tag('time', 'The clock in <ship_os_now> is the truth, and it moves only by what your reply really covers. Simulate realistic time passage.\n'
    + '- Give that time as precisely as you can, usually seconds or minutes: a line or two of talk +20s to +1m; a short exchange +2m to +5m; a longer conversation or a small task +10m to +30m; a meal +20m to +45m.\n'
    + '- Never cover more than an hour in one reply. Longer stretches (a work shift, waiting, travel, sleep) pass only when the player asks for them: the game then puts them on the clock and tells you in <ship_os_now>, and you narrate that stretch without a time command for it.\n'
    + '- Nothing is skipped: journeys, shifts, courses and sentences are lived as scenes, and you never jump to their end.');
const FIGHT_RULE = tag('fights', 'The game resolves every fight. When violence breaks out, stop at the instant it begins (with the combat command if you can use commands). Never narrate its course or outcome until the game gives you the result.');
const WORLD_RULE = tag('world', '- Realism over balance: danger follows from the story, never from the character\'s strength. A job far beyond them stays far beyond them.\n'
    + '- Failures have real, lasting consequences. Nothing the character lacks (money, gear, a licence, a ship) turns up conveniently.\n'
    + '- People have their own agendas and know only what they would realistically know. The character is not the leader of anyone unless the story made them so.');

/** Standing instructions: they change only when the situation does, so they sit high and cache well. */
export function buildRules(st = S(), sec = st && sections(st)) {
    if (!st) return '';
    const cfg = settings();
    const L = [];
    L.push(tag('role', 'You are the storyteller of a role-play run by a game engine called Ship-OS. The engine owns the facts: time, money, health, needs, cargo, prices, and the outcome of fights, checks, jobs and sentences. You own the words: what people say and do, and how the world looks and feels.'));
    L.push(tag('truth', 'Each turn the engine sends <ship_os_state> (the world as it is) and <ship_os_now> (this moment, and what to narrate now). They are the authoritative, read-only state at the start of the turn and already include everything that happened before. Never recompute or reconcile them from earlier narration, never contradict their numbers, and never quote them, print stat blocks or mention the engine.'));
    if (st.dead) {
        L.push(tag('death', 'The player character is dead. Narrate the death and its aftermath only; the character takes no further actions.'));
        return L.join('\n\n');
    }
    L.push(WORLD_RULE);
    L.push(TIME_RULE);
    L.push(FIGHT_RULE);
    for (const r of sec.rules) L.push(r);
    if (cfg.aiCommands) {
        L.push(tag('state_changes', 'When your reply changes the world, end it with one hidden block that lists only what changed, one command per line, for example:\n<sf>\ncredits -40\nhydration +25\ntime +4m\n</sf>\n'
            + 'Always include the time command, unless <ship_os_now> says the player asked for the time that passed. Use a command only for what the story really shows happening, not for plans or offers.\n'
            + COMMAND_GUIDE(st)));
    } else if (cfg.tracker) {
        L.push(tag('state_changes', 'The game reads your reply and records what changed by itself, so write only the story.'));
    }
    return L.join('\n\n');
}

/** Facts about the world: who the character is, what they carry, where they are. */
export function buildState(st = S(), sec = st && sections(st)) {
    if (!st || st.dead) return '';
    const cfg = settings();
    const sys = currentSystem();
    const fac = factionById(sys.faction);
    const cap = st.captain;
    const ship = st.ship;
    const L = [];
    const tr = transitInfo(st);
    if (tr) L.push(`In jump transit from ${tr.fromSys.name} to ${tr.toSys.name}: ${fmtDuration(tr.left)} of ship time remain. Life aboard goes on meanwhile (talk, meals, games, maintenance, sleep).`);
    L.push(`Location: ${locationLabel(st)} (${fac.name} space, ${SECURITY_LABELS[sys.security].toLowerCase()} security, ${sys.star.label.toLowerCase()}${sys.hazard ? `, hazard: ${sys.hazard}` : ''}).`);

    const needs = NEEDS.map(n => `${n.name} ${Math.round(cap.needs[n.id])}%`).join(', ');
    const statuses = needStatuses(st);
    const inj = cap.injuries.length ? ` Injuries: ${cap.injuries.map(i => `${i.name} [${i.severity}]`).join('; ')}.` : '';
    const origin = originOf(cap.origin);
    const named = (list, ids) => ids.map(id => list.find(x => x.id === id)?.name).filter(Boolean);
    const top = SKILL_DEFS.map(d => ({ d, v: skillOf(cap, d.id) })).filter(x => x.v > 0).sort((x, y) => y.v - x.v).slice(0, 8).map(x => `${x.d.name} ${x.v}`);
    L.push(`Player character ${cap.name}: ${origin ? `${origin.name}, ` : ''}${cap.role}.${cap.look ? ` Appearance: ${cap.look}.` : ''} Attributes (2-8 human range): ${ATTRIBUTES.map(a => `${a.name} ${attrOf(cap, a.id)}`).join(', ')}. Skills (0-10): ${top.join(', ') || 'none'}.`);
    const traits = [...named(TRAITS, cap.traits), ...named(FLAWS, cap.flaws)];
    const cyber = named(CYBERWARE, cap.cyber);
    if (traits.length || cyber.length) L.push(`${traits.length ? `Traits and flaws: ${traits.join(', ')}. ` : ''}${cyber.length ? `Cyberware: ${cyber.join(', ')}.` : ''}`.trim());
    const body = describeBody(cap);
    L.push(`Condition: health ${Math.round(cap.health)}/${cap.maxHealth}${isDown(cap) ? ' (DOWNED, unconscious and dying without aid)' : ''}${body ? `. Wounds: ${body}` : ''}. Stress ${Math.round(cap.stress)}%.${inj} ${needs}.${hasFx(cap, 'craving') ? ` Craving ${Math.round(cap.craving)}%.` : ''}${statuses.length ? ` Status: ${statuses.join(', ')}.` : ''}`);
    L.push(`Armed with ${PERSONAL_WEAPONS[cap.weapon]?.name ?? cap.weapon}, wearing ${ARMORS[cap.armor]?.name ?? cap.armor}. Credits: ${fmtInt(cap.credits)} cr${cap.debt ? `, debt ${fmtInt(cap.debt)} cr` : ''}.`);
    if (cap.inventory.length) L.push(`Carried: ${cap.inventory.map(i => `${i.name} x${i.qty}`).join(', ')}.`);

    if (ship) {
        const damaged = SHIP_SYSTEMS.filter(s => ship.systems[s.id] < 100).map(s => `${s.name} ${Math.round(ship.systems[s.id])}%`);
        const weapons = ship.weapons.map(w => SHIP_WEAPONS[w.id]?.name ?? w.id).join(', ') || 'unarmed';
        L.push(`Owns ship "${ship.name}" (${shipClass(st).name}): hull ${Math.round(ship.hull)}/${ship.maxHull}, shields ${Math.round(ship.shields)}/${ship.maxShields}, fuel ${Math.round(ship.fuel * 10) / 10}/${ship.maxFuel}, supplies ${Math.round(ship.supplies)} crew-days, spare parts ${ship.parts}. Weapons: ${weapons}.${damaged.length ? ` Damaged: ${damaged.join(', ')}.` : ' All systems nominal.'}`);
    } else {
        L.push(`${cap.name} does not own a starship and must book passage, sign on as crew, or acquire one.`);
    }
    for (const c of st.craft) {
        const cls = CRAFT_CLASSES[c.classId];
        L.push(`Assigned ${c.kind} "${c.name}" (${cls?.role ?? c.kind}): hull ${Math.round(c.hull)}/${c.maxHull}, shields ${Math.round(c.shields)}/${c.maxShields}, armor ${c.armor}. Weapons: ${cls?.weapons.join(', ') ?? 'none'}.${c.kind === 'mech' ? ` Combat frames are rare and ruinously expensive (about ${fmtInt(cls?.price ?? 2000000)} cr), take years to master, and can only be repaired in a dedicated mech bay. Their pilots are few, highly paid and often famous${skillOf(cap, 'mech') >= 7 ? `; ${cap.name} is a recognised ace` : skillOf(cap, 'mech') < (cls?.minSkill ?? 5) ? `; ${cap.name} is still too green to handle one properly` : ''}.` : ''}`);
    }
    if (st.cargo.length || ship) L.push(`${ship ? 'Cargo' : 'Hauled goods'} (${cargoUsed(st)}/${cargoCap(st)} t): ${st.cargo.length ? st.cargo.map(c => `${c.name} x${c.qty}`).join(', ') : 'empty'}.`);
    if (st.crew.length) {
        L.push(`Party: ${st.crew.map(c => {
            const best = SKILL_DEFS.map(d => ({ d, v: skillOf(c, d.id) })).filter(x => x.v > 0).sort((x, y) => y.v - x.v).slice(0, 3).map(x => `${x.d.name} ${x.v}`);
            return `${c.name} (${c.role}; health ${Math.round(c.health)}/${c.maxHealth}${isDown(c) ? ' DOWNED' : ''}${describeBody(c) ? `, wounds: ${describeBody(c)}` : ''}${best.length ? `; ${best.join(', ')}` : ''}${c.injuries.length ? `; injured: ${c.injuries.map(i => i.name).join(', ')}` : ''})`;
        }).join('; ')}.`);
    }
    const active = st.missions.filter(m => m.status === 'active');
    if (active.length) L.push(`Active missions: ${active.map(m => `${m.title}${m.reward ? ` [${fmtInt(m.reward)} cr]` : ''}`).join('; ')}.`);
    const reps = FACTIONS.filter(f => st.reputation[f.id]).map(f => `${f.name} ${st.reputation[f.id] > 0 ? '+' : ''}${st.reputation[f.id]}`);
    if (reps.length) L.push(`Reputation: ${reps.join(', ')}.`);
    if (st.trackers.length) L.push(`Trackers: ${st.trackers.map(t => `${t.name} ${t.value}/${t.max}`).join(', ')}.`);
    if (cfg.injectNearby) {
        const g = galaxy();
        const near = g.adj[sys.id].map(e => {
            const n = g.systems[e.to];
            return `${n.name} (${systemDistance(g, sys.id, n.id)} ly, ${factionById(n.faction).name})`;
        });
        L.push(`Stations in this system: ${sys.stations.map(s => s.name).join(', ')}. Jump lanes to: ${near.join(', ')}.`);
    }
    L.push(...sec.state);
    return L.join('\n');
}

/** This moment: the clock, and anything the next reply must deal with. Kept short, sent last. */
export function buildNow(st = S(), sec = st && sections(st), nudge = true) {
    if (!st) return '';
    if (st.dead) return `${st.captain.name} is dead${st.deathCause ? ` (${st.deathCause})` : ''}. Narrate the death and its aftermath.`;
    const L = [];
    L.push(`${fmtDate(st.minutes)}. Alert: ${st.alert}.`);
    L.push(...sec.now);
    if (st.lastCheck) L.push(`SKILL CHECK, narrate this outcome and do not change it: ${st.lastCheck.text}`);
    if (st.pendingEvent) L.push(`EVENT TO NARRATE NOW: ${st.pendingEvent}`);
    const acts = intentPrompt(st);
    if (acts) L.push(acts);
    const grant = grantPrompt(st);
    if (grant) L.push(grant);
    else if (nudge && settings().aiCommands) L.push('End your reply with the <sf> block, including how long it took.');
    return L.join('\n');
}

const wrap = (tag, text) => (text ? `<${tag}>\n${text}\n</${tag}>` : '');

/** All three blocks, or only the facts (for the tracker pass, which has its own instructions). */
export function buildParts(st = S(), { nudge = true } = {}) {
    if (!st) return { rules: '', state: '', now: '' };
    const sec = sections(st);
    return {
        rules: wrap('ship_os_rules', buildRules(st, sec)),
        state: wrap('ship_os_state', buildState(st, sec)),
        now: wrap('ship_os_now', buildNow(st, sec, nudge)),
    };
}

export function buildTelemetry({ instructions = true } = {}) {
    const p = buildParts(S(), { nudge: instructions });
    return [instructions ? p.rules : '', p.state, p.now].filter(Boolean).join('\n\n');
}

export const PROMPT_KEYS = { rules: `${MODULE}_rules`, state: MODULE, now: `${MODULE}_now` };
const ROLES = { system: 0, user: 1, assistant: 2 };
const live = () => { const cfg = settings(); return cfg.enabled && cfg.inject && !!S(); };

/**
 * How the blocks reach the model:
 *  - 'message' (default, as the Multihog framework does): the rules go after the main prompt, and
 *    state and now are put at the head of the player's latest message by the generate interceptor.
 *    That is where a model pays most attention, and no preset has to cope with system messages
 *    in the middle of the chat. Only the copy sent to the model is changed, never the saved chat.
 *  - 'depth': state and now are separate messages in the chat, at depth N and 0.
 *  - 'macros': nothing is added; the preset places {{shipos_rules}} and the others itself.
 */
const mode = () => { const m = settings().injectMode; return m === 'depth' || m === 'macros' ? m : 'message'; };

export function refreshPrompt() {
    const c = ctx();
    const cfg = settings();
    const m = mode();
    const on = live() && m !== 'macros';
    const p = on ? buildParts() : { rules: '', state: '', now: '' };
    const role = ROLES[cfg.injectRole] ?? 0;
    const inChat = m === 'depth';
    // Positions: 0 = after the story string / main prompt, 1 = in the chat at a depth.
    if (cfg.rulesAt === 'chat') c.setExtensionPrompt(PROMPT_KEYS.rules, p.rules, 1, Math.max(0, Number(cfg.rulesDepth) || 0), false, role);
    else c.setExtensionPrompt(PROMPT_KEYS.rules, p.rules, 0, 0, false, role);
    c.setExtensionPrompt(PROMPT_KEYS.state, inChat ? p.state : '', 1, Math.max(0, Number(cfg.injectDepth) || 0), false, role);
    c.setExtensionPrompt(PROMPT_KEYS.now, inChat ? p.now : '', 1, 0, false, role);
}

/**
 * SillyTavern's generate interceptor (named in manifest.json). It gets a copy of the chat that is
 * about to be sent, so the player's message can carry this turn's state without being saved.
 */
async function interceptor(chat, _size, _abort, type) {
    try {
        if (mode() !== 'message' || !live() || type === 'quiet' || type === 'impersonate' || !Array.isArray(chat)) return;
        const p = buildParts();
        const head = [p.state, p.now].filter(Boolean).join('\n\n');
        if (!head) return;
        let i = chat.length - 1;
        while (i >= 0 && !chat[i]?.is_user) i--;
        if (i < 0) {
            // No player message yet (the opening): the blocks go in as a narrator note at the end.
            chat.push({ name: 'Ship-OS', is_user: false, is_system: false, mes: head, extra: { type: 'narrator' } });
            return;
        }
        const msg = chat[i];
        const text = String(msg.mes ?? '').trim() || '[The player continues without saying anything.]';
        chat[i] = { ...msg, mes: `${head}\n\n<player_message>\n${text}\n</player_message>` };
    } catch (e) { console.error('[Ship-OS] prompt interceptor failed', e); }
}
globalThis.shipOsInterceptor = interceptor;

/**
 * Macros for presets that place the blocks themselves: {{shipos_rules}}, {{shipos_state}},
 * {{shipos_now}}, and {{shipos}} for all three. They are empty when the game is off.
 */
function registerMacros() {
    const c = ctx();
    const part = (k) => () => (live() ? buildParts()[k] : '');
    const defs = [
        ['shipos_rules', part('rules'), 'Ship-OS: standing rules for the storyteller'],
        ['shipos_state', part('state'), 'Ship-OS: the state of the world'],
        ['shipos_now', part('now'), 'Ship-OS: this moment, the clock and what to narrate now'],
        ['shipos', () => (live() ? buildTelemetry() : ''), 'Ship-OS: rules, state and now together'],
    ];
    for (const [key, fn, desc] of defs) {
        try {
            // Current SillyTavern has a macro registry; older builds and ports only have registerMacro.
            if (c.macros?.register) c.macros.register(key, { handler: () => fn(), description: desc });
            else c.registerMacro?.(key, fn, desc);
        } catch (e) { console.warn('[Ship-OS] macro not registered', key, e); }
    }
}

function processMessage(mesId, type = '') {
    const cfg = settings();
    if (!cfg.enabled || !S()) return;
    const c = ctx();
    const msg = c.chat?.[mesId];
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== 'string') return;
    // "Continue" lengthens a reply that was already processed: only the new text counts, the
    // snapshot from before the reply stays (so a swipe still undoes all of it), and what the
    // reply may still add in time and money carries on from where it stopped.
    const prev = type === 'continue' ? msg.extra?.scifi_os : null;
    if (prev && Number.isFinite(prev.len)) return processContinue(mesId, msg, prev);
    // Snapshot first, so a swipe or delete restores everything this reply consumed or changed.
    snapshot(mesId);
    // Any AI reply has narrated whatever event or check was queued, so they are consumed.
    const cur = S();
    if (cur.pendingEvent || cur.lastCheck || cur.lastActs) {
        cur.pendingEvent = null;
        cur.lastCheck = null;
        cur.lastActs = null;
        commit('consumed');
    }
    // A stretch the player asked for has already been put on the clock; this reply narrates it.
    const granted = !!cur.timeGrant;
    cur.timeGrant = null;
    setAiTimeBudget(granted ? 15 : 60, { credits: AI_REPLY_CREDITS });
    TAG_RE.lastIndex = 0;
    const hasTags = cfg.aiCommands && TAG_RE.test(msg.mes);
    // Every reply takes some story time. If the AI did not say how much, assume a short beat.
    // When the tracker pass is on, it reads the reply and decides, so the default waits for it.
    const timed = (hasTags && /(^|[\n;>])\s*time\b/i.test(msg.mes)) || granted;
    const deferTime = replyHooks.length > 0 && cfg.tracker;
    if (!timed && !deferTime) autoTime(msg.mes);
    if (!hasTags) { remember(msg, [], [], timed); runReplyHooks(mesId, msg, timed); return; }

    const applied = [];
    const failed = [];
    msg.mes = applyTags(msg.mes, applied, failed);
    remember(msg, applied, failed, timed);
    if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) msg.swipes[msg.swipe_id] = msg.mes;
    if (failed.length) console.warn('[Ship-OS] ignored AI commands:', failed);
    commit('ai');
    // With streaming the text is already on screen, so redraw it without the tags.
    try { c.updateMessageBlock?.(mesId, msg); } catch { /* not rendered yet */ }
    c.saveChat?.();
    runReplyHooks(mesId, msg, timed);
}

// The most the story may hand over in one reply, however many credit commands it writes.
const AI_REPLY_CREDITS = 2000;

/** Runs the hidden command blocks in a reply and returns the reply without them. */
function applyTags(text, applied, failed) {
    TAG_RE.lastIndex = 0;
    return text.replace(TAG_RE, (_, a, b) => {
        for (const r of runBlock(a ?? b ?? '', { ai: true })) {
            if (!r.text) continue;
            (r.ok ? applied : failed).push(r.text);
        }
        return '';
    }).trimEnd();
}

/** What a reply did, kept on the message: the chips under it, and where a "continue" picks up. */
function remember(msg, applied, failed, timed) {
    msg.extra ??= {};
    msg.extra.scifi_os = { applied, failed, len: msg.mes.length, timed: !!timed, timeLeft: aiTimeLeft(), creditsLeft: aiCreditsLeft() };
}

function processContinue(mesId, msg, prev) {
    const cfg = settings();
    const c = ctx();
    setAiTimeBudget(prev.timeLeft ?? 60, { credits: prev.creditsLeft ?? AI_REPLY_CREDITS });
    const head = msg.mes.slice(0, prev.len);
    let tail = msg.mes.slice(prev.len);
    TAG_RE.lastIndex = 0;
    const hasTags = cfg.aiCommands && TAG_RE.test(tail);
    const timed = prev.timed || (hasTags && /(^|[\n;>])\s*time\b/i.test(tail));
    if (!timed && !(replyHooks.length > 0 && cfg.tracker)) autoTime(tail);
    const applied = [...(prev.applied ?? [])];
    const failed = [...(prev.failed ?? [])];
    if (hasTags) tail = applyTags(tail, applied, failed);
    msg.mes = (head + tail).trimEnd();
    remember(msg, applied, failed, timed);
    if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) msg.swipes[msg.swipe_id] = msg.mes;
    commit('ai');
    try { c.updateMessageBlock?.(mesId, msg); } catch { /* not rendered yet */ }
    if (hasTags) c.saveChat?.();
}

const replyHooks = [];
/** Background agents (tracker pass, lorebook agent) run after each AI reply has been processed. */
export function onReply(fn) { replyHooks.push(fn); }
function runReplyHooks(mesId, msg, timed) {
    for (const fn of replyHooks) {
        try { fn({ mesId, msg, timed }); } catch (e) { console.error('[Ship-OS] reply hook failed', e); }
    }
}

/**
 * Times a reply that did not say how long it took: from its text (a few lines of talk are
 * seconds, a long scene a few minutes), or a fixed beat if the player set one.
 */
export function autoTime(text = '') {
    const cfg = settings();
    const cur = S();
    if (!cur || cur.combat || cur.dead) return;
    passMinutes(Number(cfg.autoMinutes) > 0 ? Number(cfg.autoMinutes) : estimateMinutes(text));
    commit('auto-time');
}

/**
 * The player's own message. It may carry actions queued from the panel, and a request for time
 * to pass (picked from the chat bar or typed as [+2h] at the end). The engine carries them out
 * before the reply, so the storyteller narrates what really happened.
 */
async function processUserMessage(mesId) {
    const cfg = settings();
    const cur = S();
    if (!cfg.enabled || !cur) return;
    const c = ctx();
    const msg = c.chat?.[mesId];
    if (!msg || !msg.is_user || typeof msg.mes !== 'string') return;
    let ask = pendingAsk();
    let asleep = pendingAsleep();
    setPendingAsk(null);
    const typed = takeTypedAsk(msg.mes);
    if (typed) { ask = typed.mins; asleep = typed.asleep; msg.mes = typed.text; }
    const acts = takeQueue();
    // What the player wrote in their own words is read for actions too. The lines the panel
    // wrote are left out, so a button's action is not heard a second time.
    let heard = { acts: [], suggest: [] };
    const own = acts.reduce((t, a) => cutLine(t, a.line), msg.mes);
    if (own.trim()) {
        setBarNote('Reading your message…');
        try { heard = await hear(own, { skip: acts.map(a => a.name), skipIds: ask ? ['sleep', 'relax'] : [] }); } catch (e) { console.warn('[Ship-OS] hearing failed', e); }
        setBarNote('');
        if (heard.error) toast('warning', `Could not read your actions with ${heard.via === 'jev' ? 'Jev' : 'the background model'} (${heard.error}). Only obvious ones are suggested.`);
        // The chat may have been switched while the reader was busy.
        if (ctx().chat?.[mesId] !== msg || !S()) return;
    }
    acts.push(...heard.acts);
    if (!ask && !acts.length && !heard.suggest.length) return;
    msg.extra ??= {};
    msg.extra.scifi_os = { applied: [], failed: [], acts, suggest: heard.suggest, ask: ask || 0, asleep: !!asleep };
    applyUserMessage(mesId, msg);
    if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) msg.swipes[msg.swipe_id] = msg.mes;
    refreshPrompt();
}

/** Carries out what a sent message asked for. Run again, from its snapshot, when one is undone. */
function applyUserMessage(mesId, msg) {
    const x = msg.extra.scifi_os;
    snapshot(mesId);
    const cur = S();
    for (const a of x.acts ?? []) {
        try { a.text = runIntent(a); a.ok = true; } catch (e) { a.ok = false; a.text = String(e.message ?? e); }
    }
    cur.lastActs = (x.acts ?? []).length ? x.acts.map(a => ({ ok: a.ok, text: a.text, line: a.line || a.label })) : null;
    const bad = (x.acts ?? []).filter(a => !a.ok);
    if (bad.length) toast('warning', bad.map(a => `${a.label}: ${a.text}`).join(' · '));
    x.applied = [];
    if (x.ask) {
        let line;
        try {
            const g = passTime(x.ask, { what: msg.mes, asleep: x.asleep });
            line = grantLine(g);
            if (g.granted < g.asked) toast('info', line);
        } catch (e) {
            line = `⌛ no time passed: ${e.message}`;
            toast('warning', line);
        }
        x.applied.push(line);
    }
    commit('time-ask');
}

/**
 * Changes what the player's latest message did (takes an action back, or confirms one the game
 * was unsure of). The state goes back to just before the message, the reply that narrated it is
 * removed, the message is carried out again with the change, and the storyteller answers afresh.
 */
async function redoMessage(mesId, change, { title, removes = 'The reply after this message is removed too, and the storyteller answers again.' }) {
    const c = ctx();
    const msg = c.chat?.[mesId];
    const x = msg?.extra?.scifi_os;
    if (!x) return;
    const later = c.chat.slice(mesId + 1);
    if (later.some(m => m.is_user && !m.is_system)) { toast('info', 'Only your latest message can be changed.'); return; }
    const replies = later.length;
    if (replies && !(await confirmAsk(title, removes))) return;
    for (let i = 0; i < replies; i++) {
        if (typeof c.deleteLastMessage === 'function') await c.deleteLastMessage();
        else { await c.executeSlashCommandsWithOptions?.(`/cut ${c.chat.length - 1}`); }
    }
    if (c.chat.length !== mesId + 1) { toast('error', 'Could not remove the reply. Delete it by hand, then try again.'); return; }
    rollbackTo(mesId);
    change(x, msg);
    if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) msg.swipes[msg.swipe_id] = msg.mes;
    if (!msg.mes.trim() && !x.acts.length && !x.ask) {
        // Nothing left of the message: it goes as well.
        if (typeof c.deleteLastMessage === 'function') await c.deleteLastMessage();
        commit('undo');
        await c.saveChat?.();
        refreshPrompt();
        return;
    }
    applyUserMessage(mesId, msg);
    try { c.updateMessageBlock?.(mesId, msg); } catch { /* not rendered */ }
    decorateMessage(mesId);
    await c.saveChat?.();
    refreshPrompt();
    if (replies) {
        try { await c.executeSlashCommandsWithOptions?.('/trigger'); } catch { toast('info', 'Send to let the storyteller answer again.'); }
    }
}

function undoAct(mesId, idx) {
    const act = ctx().chat?.[mesId]?.extra?.scifi_os?.acts?.[idx];
    if (!act) return Promise.resolve();
    return redoMessage(mesId, (x, msg) => {
        x.acts.splice(idx, 1);
        msg.mes = cutLine(msg.mes, act.line);
    }, { title: `Take back "${act.label}"?` });
}

/** The game was unsure what the player meant; they say yes, so it happens after all. */
function confirmSuggest(mesId, idx) {
    const sug = ctx().chat?.[mesId]?.extra?.scifi_os?.suggest?.[idx];
    if (!sug) return Promise.resolve();
    return redoMessage(mesId, (x) => {
        x.suggest.splice(idx, 1);
        x.acts.push({ ...sug, confirmed: true });
    }, { title: `${sug.label}?`, removes: 'The reply after this message is written again with it.' });
}

/** No, that is not what the player meant: the suggestion goes away and nothing changes. */
async function dropSuggest(mesId, idx) {
    const c = ctx();
    const x = c.chat?.[mesId]?.extra?.scifi_os;
    if (!x?.suggest?.[idx]) return;
    x.suggest.splice(idx, 1);
    decorateMessage(mesId);
    await c.saveChat?.();
}

/**
 * Chips under a message: what the engine did with it. The actions of the player's latest message
 * carry a × to take them back.
 */
export function decorateMessage(mesId) {
    const c = ctx();
    const info = c.chat?.[mesId]?.extra?.scifi_os;
    const el = document.querySelector(`#chat .mes[mesid="${mesId}"] .mes_block`);
    if (!el) return;
    el.querySelector('.sf-chip-row')?.remove();
    const acts = info?.acts ?? [];
    const sugg = info?.suggest ?? [];
    if (!info?.applied?.length && !acts.length && !sugg.length) return;
    const latest = !c.chat.slice(mesId + 1).some(m => m.is_user && !m.is_system);
    const row = document.createElement('div');
    row.className = 'sf-chip-row';
    acts.forEach((a, i) => {
        const chip = document.createElement('span');
        chip.className = `sf-chip sf-chip-act${a.ok === false ? ' bad' : ''}${a.heard ? ' heard' : ''}`;
        chip.textContent = a.ok === false ? `${a.label}: ${a.text}` : (a.text || a.label);
        chip.title = a.heard ? `Read from your words${a.p ? ` (${Math.round(a.p * 100)}% sure)` : ''}` : (a.line ?? '');
        if (latest && a.ok !== false) {
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'sf-chip-x';
            x.textContent = '×';
            x.title = 'Take this action back';
            x.addEventListener('click', (e) => { e.stopPropagation(); undoAct(mesId, i).catch(err => toast('error', err.message)); });
            chip.appendChild(x);
        }
        row.appendChild(chip);
    });
    // Readings the game was not sure of: a tick makes them happen, a cross dismisses them.
    if (latest) sugg.forEach((g, i) => {
        const chip = document.createElement('span');
        chip.className = 'sf-chip sf-chip-act sf-chip-ask';
        chip.textContent = `${g.label}?`;
        chip.title = `Did you mean this? Read from your words${g.p ? ` (${Math.round(g.p * 100)}% sure)` : ''}`;
        const yes = document.createElement('button');
        yes.type = 'button';
        yes.className = 'sf-chip-x sf-chip-yes';
        yes.textContent = '✓';
        yes.title = 'Yes, do it';
        yes.addEventListener('click', (e) => { e.stopPropagation(); confirmSuggest(mesId, i).catch(err => toast('error', err.message)); });
        const no = document.createElement('button');
        no.type = 'button';
        no.className = 'sf-chip-x';
        no.textContent = '×';
        no.title = 'No, that is not what I meant';
        no.addEventListener('click', (e) => { e.stopPropagation(); dropSuggest(mesId, i).catch(err => toast('error', err.message)); });
        chip.append(yes, no);
        row.appendChild(chip);
    });
    for (const text of info.applied ?? []) {
        const chip = document.createElement('span');
        chip.className = 'sf-chip';
        chip.textContent = text;
        row.appendChild(chip);
    }
    el.appendChild(row);
}

function decorateAll() {
    document.querySelectorAll('#chat .mes[mesid]').forEach(el => decorateMessage(Number(el.getAttribute('mesid'))));
}

export function initAiLink() {
    on('MESSAGE_RECEIVED', (id, type) => { processMessage(Number(id), type); refreshPrompt(); });
    on('MESSAGE_SENT', async (id) => { await processUserMessage(Number(id)); setTimeout(decorateAll, 50); });
    on('USER_MESSAGE_RENDERED', (id) => { const n = Number(id); const m = ctx().chat?.[n]; if (m?.extra?.scifi_os) { try { ctx().updateMessageBlock?.(n, m); } catch { /* */ } decorateMessage(n); } });
    on('CHARACTER_MESSAGE_RENDERED', (id) => decorateMessage(Number(id)));
    on('MESSAGE_SWIPED', (id) => { if (rollbackTo(Number(id))) addLog('Timeline reverted (message swiped).', 'sys'); refreshPrompt(); });
    on('MESSAGE_DELETED', (count) => { rollbackTo(Number(count)); refreshPrompt(); });
    on('CHAT_CHANGED', () => { refreshPrompt(); setTimeout(decorateAll, 300); });
    on('MORE_MESSAGES_LOADED', () => setTimeout(decorateAll, 100));
    on('GENERATION_STARTED', () => refreshPrompt());
    registerMacros();
    refreshPrompt();
}
