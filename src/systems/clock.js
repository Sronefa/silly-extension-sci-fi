// How story time moves between messages. Two sources, and the game checks both:
//  - the storyteller says how long each scene took (a few seconds to a few minutes, usually);
//  - the player can ask for a longer stretch to pass from the chat bar, writing what the
//    character does meanwhile. The game grants it, shortens it or refuses it, and stops early
//    when something happens that the character would notice.
import { S, addLog } from '../core/state.js';
import { advanceTime, passMinutes, fmtDuration, fmtShort, parseDuration, needStatuses } from './sim.js';
import { isBleeding } from './body.js';
import { present, walkTime, areaOf } from './activity.js';

/** Minutes before a booking starts that the character has to leave to make it in time. */
function margin(st, a) {
    if (present(st, a)) return 1;
    return (a.area && !a.custody ? walkTime(st, areaOf(st), a.area) : 0) + 5;
}

export const MAX_ASK = 24 * 60;
const STEP = 10;
const LOW = 10;

// ---- Estimating a reply that did not say ----

/**
 * A reply that names no time is timed from its text: spoken lines at speaking pace, the rest as
 * brief action. A couple of lines of talk come out well under a minute; a long scene a few minutes.
 */
export function estimateMinutes(text) {
    const t = String(text ?? '').replace(/<[^>]+>/g, ' ');
    let spoken = 0;
    for (const m of t.matchAll(/["“«]([^"”»]+)["”»]/g)) spoken += m[1].split(/\s+/).filter(Boolean).length;
    const all = t.split(/\s+/).filter(Boolean).length;
    const rest = Math.max(0, all - spoken);
    const mins = spoken / 140 + rest / 450;
    return Math.min(8, Math.max(0.25, Math.round(mins * 4) / 4));
}

// ---- The player's requests ----

// A stretch picked from the chat bar, waiting for the message it goes with.
let pending = null;
export const pendingAsk = () => pending;
export function setPendingAsk(mins) { pending = Number.isFinite(mins) && mins > 0 ? mins : null; }

/** A request typed at the end of a message: [+2h], [wait 30m], [until 07:00]. */
const ASK_RE = /\s*\[(?:\+|wait\s+|pass\s+|⌛\s*)?((?:until\s+)?[\d:hms .]+)\]\s*$/i;
export function takeTypedAsk(text) {
    const m = String(text ?? '').match(ASK_RE);
    if (!m || !/[hms:]/i.test(m[1])) return null;
    const mins = parseAsk(m[1].trim());
    if (!Number.isFinite(mins)) return null;
    return { mins, text: String(text).replace(ASK_RE, '').trimEnd() };
}

/** Turns what the player wrote into minutes: "2h", "30m", "1h30", "until 07:00". */
export function parseAsk(text, st = S()) {
    const s = String(text ?? '').trim().toLowerCase();
    if (!s) return NaN;
    const at = s.match(/^(?:until|till|to)?\s*(\d{1,2})[:h](\d{2})$/);
    if (at) {
        const target = Number(at[1]) * 60 + Number(at[2]);
        const now = Math.floor((st?.minutes ?? 0) % 1440);
        return ((target - now) + 1440) % 1440 || 1440;
    }
    const m = s.match(/^(\d+)h(\d{1,2})$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    return parseDuration(s.replace(/^\+/, ''));
}

/** Why a stretch of time cannot even begin, or ''. */
export function refusal(st = S()) {
    if (!st) return 'no campaign';
    if (st.dead) return 'the character is dead';
    if (st.combat || st.shipCombat) return 'not in the middle of a fight';
    if (isBleeding(st.captain)) return 'you are bleeding: deal with it first';
    const low = lowNeed(st);
    if (low) return `you are too ${low} to let time slip by: see to it first`;
    return '';
}

function lowNeed(st) {
    const n = st.captain.needs ?? {};
    if (n.hydration !== undefined && n.hydration < LOW) return 'thirsty';
    if (n.nourishment !== undefined && n.nourishment < LOW) return 'hungry';
    if (n.rest !== undefined && n.rest < LOW) return 'exhausted';
    return '';
}

/** The useful lengths to offer right now, besides the plain ones. */
export function suggestions(st = S()) {
    const out = [];
    const a = st?.activity;
    if (a?.on && a.need > a.done) out.push({ label: `Until it is done (${fmtDuration(a.need - a.done)})`, mins: a.need - a.done });
    if (a && !a.on && a.by - margin(st, a) > st.minutes) { const m = a.by - margin(st, a) - st.minutes; out.push({ label: `Until it is time to go (${fmtDuration(m)})`, mins: m }); }
    if (st?.transit) { const left = st.transit.end - st.minutes; if (left > 0 && left <= MAX_ASK) out.push({ label: `Until arrival (${fmtDuration(left)})`, mins: left }); }
    return out;
}

/**
 * Lets up to `asked` minutes pass, in short steps, stopping as soon as something happens.
 * Returns { asked, granted, why, from, to } or throws when it cannot start at all.
 */
export function passTime(asked, { what = '' } = {}) {
    const st = S();
    const no = refusal(st);
    if (no) throw new Error(no);
    if (!Number.isFinite(asked) || asked <= 0) throw new Error('say how long: 30m, 2h, until 07:00');
    let why = '';
    if (asked > MAX_ASK) { asked = MAX_ASK; why = 'a day at most at a time'; }
    const from = st.minutes;
    // A commitment's own opening scene, not yet narrated, is folded into the stretch.
    if (st.activity?.ev && st.pendingEvent === st.activity.ev) st.pendingEvent = null;
    const ev0 = st.pendingEvent;
    const cust0 = st.custody?.type ?? null;
    const transit0 = !!st.transit;
    let left = Math.round(asked);
    while (left > 0) {
        const a = st.activity;
        // A booking you have not turned up for is not something time can slide past unnoticed.
        if (a && !a.on && st.minutes + margin(st, a) >= a.by) { why = `it is time to go: ${a.name.toLowerCase()} is due to start`; break; }
        let step = Math.min(STEP, left);
        if (a && !a.on) step = Math.min(step, a.by - st.minutes - margin(st, a));
        if (step <= 0) { why = `it is time to go: ${a.name.toLowerCase()} is due to start`; break; }
        advanceTime(step);
        left -= step;
        if (st.dead) { why = 'the character died'; break; }
        if (a?.on && st.activity !== a) { why = `${a.name.toLowerCase()} is over`; break; }
        if (st.pendingEvent && st.pendingEvent !== ev0) { why = 'something came up'; break; }
        if ((st.custody?.type ?? null) !== cust0) { why = 'everything changed'; break; }
        if (transit0 && !st.transit) { why = 'the journey is over'; break; }
        if (st.combat || st.shipCombat) { why = 'a fight broke out'; break; }
        if (isBleeding(st.captain)) { why = 'you are bleeding'; break; }
        const low = lowNeed(st);
        if (low) { why = `you are too ${low} to carry on`; break; }
    }
    const granted = st.minutes - from;
    st.timeGrant = { asked: Math.round(asked), granted, why, from, to: st.minutes, what: String(what).slice(0, 300) };
    addLog(granted < asked ? `Let ${fmtDuration(granted)} pass of the ${fmtDuration(asked)} asked: ${why}.` : `Let ${fmtDuration(granted)} pass.`, 'sys');
    return st.timeGrant;
}

/** One line for the chat, under the player's message. */
export function grantLine(g) {
    if (!g) return '';
    if (g.granted >= g.asked) return `⌛ ${fmtDuration(g.granted)} passed`;
    return `⌛ ${fmtDuration(g.granted)} of ${fmtDuration(g.asked)} passed: ${g.why}`;
}

/** What the storyteller is told about a stretch the player asked for. Consumed by the next reply. */
export function grantPrompt(st) {
    const g = st.timeGrant;
    if (!g) return '';
    const cut = g.granted < g.asked ? ` The game stopped it after ${fmtDuration(g.granted)} of the ${fmtDuration(g.asked)} asked, because ${g.why}.` : '';
    return `TIME PASSED AT THE PLAYER'S REQUEST: ${fmtDuration(g.granted)} have gone by since the player's last message, and the clock already shows the end of it.${cut} Narrate that stretch briefly, as what the character did (their message says what they meant to do) and what changed around them, and arrive at the present moment. Do not add a time command for this stretch; add one only for anything after it, a few minutes at most.${needStatuses(st).length ? ` By now the character is: ${needStatuses(st).join(', ')}.` : ''}`;
}

export { fmtShort, passMinutes };
