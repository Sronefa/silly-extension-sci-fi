// Where a person is aboard a station, and the things that hold them somewhere for hours:
// a shift, a lesson, an exam, a work detail. Nothing here jumps the clock. A commitment is
// booked, the character has to get to the place, and it only progresses while story time
// passes with them there.
import { S, addLog } from '../core/state.js';
import { STATION_AREAS, WORKS_NAME } from '../data/life.js';
import { port, hasYard } from './services.js';
import { advanceTime, fmtDuration } from './sim.js';

export const hasSchool = (p) => !!p && p.sys.security >= 2 && p.sys.faction !== 'ashen';

// ---- Station areas ----

/** The areas of the station the character is on, in the order you pass through them. */
export function areasHere(st = S()) {
    const p = port(st);
    if (!p) return [];
    return STATION_AREAS
        .filter(a => !a.when || (a.when === 'yard' ? hasYard(p) : hasSchool(p)))
        .map(a => (a.id === 'works' ? { ...a, name: WORKS_NAME[p.sys.economy] ?? a.name } : a));
}

/** Where on the station the character is. Everyone steps off at the docks. */
export function areaOf(st = S()) {
    const p = port(st);
    if (!p) return null;
    if (st.loc.areaKey !== p.key || !areasHere(st).some(a => a.id === st.loc.area)) return 'docks';
    return st.loc.area;
}

export const areaName = (st, id) => areasHere(st).find(a => a.id === id)?.name ?? id;

/** Minutes on foot and by lift between two areas of this station. */
export function walkTime(st, from, to) {
    const list = areasHere(st);
    const i = list.findIndex(a => a.id === from), j = list.findIndex(a => a.id === to);
    if (i < 0 || j < 0 || i === j) return 0;
    return 4 + 3 * Math.abs(i - j);
}

/** Finds an area from an id or a loosely written name. */
export function findArea(st, text) {
    const t = String(text ?? '').toLowerCase().replace(/[^a-z]/g, '');
    if (!t) return null;
    const list = areasHere(st);
    return list.find(a => a.id === t) ?? list.find(a => a.name.toLowerCase().replace(/[^a-z]/g, '') === t)
        ?? list.find(a => a.name.toLowerCase().replace(/[^a-z]/g, '').includes(t) || t.includes(a.id)) ?? null;
}

/** Walks to another part of the station. The walk takes its time whoever asks for it. */
export function moveTo(id, { ai = false } = {}) {
    const st = S();
    const p = port(st);
    if (!p) throw new Error('you are not aboard a station');
    if (st.custody) throw new Error('you do not go where you please');
    if (st.combat || st.shipCombat) throw new Error('not now');
    const area = findArea(st, id);
    if (!area) throw new Error(`no such place here. Areas: ${areasHere(st).map(a => a.name).join(', ')}`);
    const from = areaOf(st);
    if (from === area.id) return `Already at the ${area.name.toLowerCase()}`;
    const mins = walkTime(st, from, area.id);
    const fromName = areaName(st, from);
    advanceTime(mins);
    st.loc.area = area.id;
    st.loc.areaKey = p.key;
    if (!ai) st.pendingEvent ??= `${st.captain.name} has walked from the ${fromName.toLowerCase()} to the ${area.name.toLowerCase()} of ${p.station.name} (${mins} minutes). Pick the scene up as they arrive.`;
    return `Walked to the ${area.name.toLowerCase()} (${mins} min)`;
}

// ---- Commitments ----

const kinds = {};
/**
 * def.finish(st, a): the time has been put in. def.stop(st, a, why): cut short ('quit' or
 * 'left'). def.miss(st, a): never turned up. def.half(st, a): called once near the middle.
 */
export function registerActivity(kind, def) { kinds[kind] = def; }

/** Books a commitment. a: { kind, name, need (minutes), area?, key?, custody?, window? }. */
export function book(st, a) {
    if (st.activity) throw new Error(`you are already committed: ${st.activity.name.toLowerCase()}`);
    if (st.combat || st.shipCombat) throw new Error('not now');
    st.activity = { done: 0, away: 0, on: false, booked: st.minutes, by: st.minutes + (a.window ?? 120), ...a };
    return st.activity;
}

/** True when the character is where the commitment happens. */
export function present(st, a = st.activity) {
    if (!a) return false;
    if (a.custody) return !!st.custody;
    const p = port(st);
    return !!p && p.key === a.key && (!a.area || areaOf(st) === a.area);
}

export function clockIn() {
    const st = S();
    const a = st.activity;
    if (!a) throw new Error('you have nothing booked');
    if (a.on) throw new Error('already started');
    if (!present(st, a)) throw new Error(`you are not there. Go to the ${areaName(st, a.area).toLowerCase()} first`);
    kinds[a.kind]?.start?.(st, a);
    a.on = true;
    a.started = st.minutes;
    a.ev = st.pendingEvent;
    return `Started: ${a.name}`;
}

/** Walks away from a commitment, or cancels one that has not begun. */
export function quit() {
    const st = S();
    const a = st.activity;
    if (!a) throw new Error('you have nothing booked');
    st.activity = null;
    dropEvent(st, a);
    if (a.on) return kinds[a.kind]?.stop?.(st, a, 'quit') ?? `Walked out: ${a.name}`;
    return kinds[a.kind]?.miss?.(st, a, 'cancelled') ?? `Cancelled: ${a.name}`;
}

/** A scene prompt this commitment queued and nobody narrated yet gives way to what happened next. */
function dropEvent(st, a) { if (a.ev && st.pendingEvent === a.ev) st.pendingEvent = null; }

export function activityTick(st, mins) {
    const a = st.activity;
    if (!a) return;
    if (a.custody && !st.custody) { st.activity = null; return; }
    if (!a.on) {
        if (st.minutes > a.by) {
            st.activity = null;
            const text = kinds[a.kind]?.miss?.(st, a, 'late') ?? `Missed: ${a.name}.`;
            addLog(text, 'story');
        }
        return;
    }
    if (present(st, a)) {
        const before = a.done;
        a.done = Math.min(a.need, a.done + mins);
        if (before < a.need / 2 && a.done >= a.need / 2 && a.done < a.need) { dropEvent(st, a); kinds[a.kind]?.half?.(st, a); a.ev = st.pendingEvent; }
        if (a.done >= a.need) {
            st.activity = null;
            dropEvent(st, a);
            const text = kinds[a.kind]?.finish?.(st, a);
            if (text) addLog(text, 'story');
        }
    } else {
        a.away += mins;
        if (a.away > 45) {
            st.activity = null;
            dropEvent(st, a);
            const text = kinds[a.kind]?.stop?.(st, a, 'left') ?? `Abandoned: ${a.name}.`;
            if (text) addLog(text, 'story');
        }
    }
}

/** What the storyteller is told about the character's whereabouts and commitments. */
export function activityPrompt(st) {
    const out = { rules: '', state: '', now: '' };
    const p = port(st);
    const a = st.activity;
    if (p && !st.custody) {
        const here = areaOf(st);
        out.state = `${st.captain.name} is at the ${areaName(st, here).toLowerCase()} of ${p.station.name}. Other areas (id: minutes on foot): ${areasHere(st).filter(x => x.id !== here).map(x => `${x.name} (${x.id}: ${walkTime(st, here, x.id)} min)`).join(', ')}.`;
        out.rules = 'PLACES IN A STATION: nobody teleports. When the character goes to another area, narrate the way there and add the command: area <id>. The game adds the walking time itself. Use area, not location, for places inside the station.';
    }
    if (a && !a.on) {
        const where = a.area ? `at the ${areaName(st, a.area).toLowerCase()}` : 'there';
        out.now = `BOOKED, NOT STARTED: ${a.name}, ${fmtDuration(a.need)} long. ${st.captain.name} must be ${where} and start within ${fmtDuration(Math.max(0, a.by - st.minutes))} or lose it${present(st, a) ? ' (they are in the right place now)' : '; they still have to get there'}. The player starts it from the game panel. Do not narrate the work itself yet.`;
    }
    if (a?.on) {
        out.now = `IN PROGRESS: ${a.name}, ${fmtDuration(a.done)} done, ${fmtDuration(a.need - a.done)} to go. Play it as scenes (the task in hand, the people around, small troubles). Do not jump to the end, and do not pay, pass, fail or reward anything: the game resolves it when the time has really been put in.${a.note ? ` ${a.note}` : ''}${a.area ? ` Leaving the ${areaName(st, a.area).toLowerCase()} for long means walking out on it.` : ''}`;
    }
    return out;
}
