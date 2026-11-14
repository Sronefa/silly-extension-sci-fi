// Per-chat campaign state, stored in chat metadata so every chat is its own save file.
import { ctx, userName } from './st.js';
import { deepClone, hash, uid, clamp } from './util.js';
import { SHIP_CLASSES, SHIP_SYSTEMS, SKILLS, NEEDS } from '../data/catalog.js';
import { getGalaxy } from '../systems/galaxy.js';

const KEY = 'scifi_os';
const HIST_KEY = 'scifi_os_hist';
const HIST_MAX = 10;
const LOG_MAX = 120;
export const START_YEAR = 2387;

const listeners = new Set();

export function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Returns the live state object for the current chat, or null if no campaign exists. */
export function S() {
    return ctx().chatMetadata?.[KEY] ?? null;
}

export function commit(reason = '') {
    const c = ctx();
    (c.saveMetadataDebounced ?? c.saveMetadata)?.();
    notify(reason);
}

export function notify(reason = '') {
    for (const fn of listeners) {
        try { fn(reason); } catch (e) { console.error('[Ship-OS] listener failed', e); }
    }
}

export function buildShip(classId, name) {
    const cls = SHIP_CLASSES[classId] ?? SHIP_CLASSES.mule;
    const systems = {};
    for (const s of SHIP_SYSTEMS) systems[s.id] = 100;
    return {
        name: name || 'Wandering Star',
        classId: cls.id,
        hull: cls.hull, maxHull: cls.hull,
        shields: cls.shields, maxShields: cls.shields,
        armor: cls.armor,
        fuel: cls.fuel, maxFuel: cls.fuel,
        fuelPerLy: cls.fuelPerLy,
        cargoCap: cls.cargo,
        evasion: cls.evasion,
        crewMax: cls.crewMax,
        weapons: cls.weapons.map(w => ({ id: w, ammo: w === 'missile' ? 6 : null })),
        systems,
        supplies: 20,
        parts: 2,
    };
}

export function newCampaign(opts = {}) {
    const seed = opts.seed ?? hash(Date.now(), Math.random());
    const galaxy = getGalaxy(seed);
    // Start in a reasonably safe, non-capital system.
    const starts = galaxy.systems.filter(s => s.security >= 3 && !s.capital);
    const start = (starts.length ? starts : galaxy.systems)[seed % (starts.length || galaxy.systems.length)];
    const skills = {};
    for (const k of SKILLS) skills[k] = 2;
    const needs = {};
    for (const n of NEEDS) needs[n.id] = 85;
    const credits = { easy: 25000, normal: 10000, hard: 3000 }[opts.difficulty] ?? 10000;

    const state = {
        version: 1,
        seed,
        minutes: 141 * 1440 + 9 * 60,
        captain: {
            name: opts.captain || userName(),
            credits,
            health: 100, maxHealth: 100,
            radiation: 0,
            stress: 10,
            needs,
            injuries: [],
            skills,
            weapon: 'pistol',
            armor: 'none',
            inventory: [
                { id: uid('it'), name: 'Medkit', qty: 2 },
                { id: uid('it'), name: 'Ration Pack', qty: 3 },
                { id: uid('it'), name: 'Multitool', qty: 1 },
            ],
        },
        ship: buildShip(opts.shipClass || 'mule', opts.shipName),
        crew: [],
        cargo: [],
        loc: { system: start.id, station: 0, docked: true, place: '' },
        route: [],
        visited: { [start.id]: true },
        sysNotes: {},
        marketDelta: {},
        missions: [],
        reputation: { accord: 0, combine: 0, compact: 0, hegemony: 0, ashen: -20 },
        contacts: [],
        trackers: [],
        log: [],
        combat: null,
        shipCombat: null,
        pendingEvent: null,
        alert: 'green',
    };
    ctx().chatMetadata[KEY] = state;
    ctx().chatMetadata[HIST_KEY] = [];
    addLog(`Campaign initialised. ${state.ship.name} docked at ${start.stations[0].name}, ${start.name}.`, 'sys');
    commit('new');
    return state;
}

export function deleteCampaign() {
    delete ctx().chatMetadata[KEY];
    delete ctx().chatMetadata[HIST_KEY];
    commit('delete');
}

export function importCampaign(obj) {
    if (!obj || typeof obj !== 'object' || !obj.ship || !obj.captain) throw new Error('Not a Ship-OS save file');
    ctx().chatMetadata[KEY] = migrate(obj);
    ctx().chatMetadata[HIST_KEY] = [];
    commit('import');
}

/** Fills in anything missing from older or hand-edited saves. */
export function migrate(st) {
    if (!st) return st;
    st.captain.needs ??= {};
    for (const n of NEEDS) st.captain.needs[n.id] ??= 80;
    st.captain.skills ??= {};
    for (const k of SKILLS) st.captain.skills[k] ??= 2;
    st.captain.injuries ??= [];
    st.captain.inventory ??= [];
    st.captain.stress ??= 0;
    st.captain.radiation ??= 0;
    st.ship.systems ??= {};
    for (const s of SHIP_SYSTEMS) st.ship.systems[s.id] ??= 100;
    st.ship.weapons ??= [];
    st.ship.parts ??= 0;
    st.ship.supplies ??= 0;
    for (const k of ['crew', 'cargo', 'route', 'missions', 'contacts', 'trackers', 'log']) st[k] ??= [];
    for (const k of ['visited', 'sysNotes', 'marketDelta', 'reputation']) st[k] ??= {};
    st.loc ??= { system: 0, station: 0, docked: true, place: '' };
    st.alert ??= 'green';
    return st;
}

export function addLog(text, kind = 'info') {
    const st = S();
    if (!st) return;
    st.log.unshift({ t: st.minutes, text: String(text), kind });
    if (st.log.length > LOG_MAX) st.log.length = LOG_MAX;
}

// ---- Snapshots, so swiping or deleting an AI message rolls back what it changed ----

export function snapshot(mesId) {
    const st = S();
    if (!st) return;
    const meta = ctx().chatMetadata;
    const hist = (meta[HIST_KEY] ??= []);
    // Drop any snapshots at or after this message; they describe a timeline that no longer exists.
    while (hist.length && hist[hist.length - 1].mesId >= mesId) hist.pop();
    hist.push({ mesId, state: deepClone(st) });
    while (hist.length > HIST_MAX) hist.shift();
}

/** Restores the state from before message `mesId` was applied. Returns true if it rolled back. */
export function rollbackTo(mesId) {
    const meta = ctx().chatMetadata;
    const hist = meta?.[HIST_KEY];
    if (!hist?.length) return false;
    let target = null;
    while (hist.length && hist[hist.length - 1].mesId >= mesId) target = hist.pop();
    if (!target) return false;
    meta[KEY] = target.state;
    commit('rollback');
    return true;
}

// ---- Derived helpers ----

export function galaxy() {
    const st = S();
    return st ? getGalaxy(st.seed) : null;
}

export function currentSystem() {
    const st = S();
    return st ? getGalaxy(st.seed).systems[st.loc.system] : null;
}

export function currentStation() {
    const st = S();
    if (!st || !st.loc.docked) return null;
    const sys = currentSystem();
    return sys.stations[st.loc.station] ?? sys.stations[0];
}

export function cargoUsed(st = S()) {
    return st ? st.cargo.reduce((n, c) => n + c.qty, 0) : 0;
}

export function shipClass(st = S()) {
    return SHIP_CLASSES[st?.ship.classId] ?? SHIP_CLASSES.mule;
}

/** Formats campaign minutes as an in-universe date, e.g. "2387.142 · 09:00". */
export function fmtDate(minutes = S()?.minutes ?? 0) {
    const day = Math.floor(minutes / 1440);
    const year = START_YEAR + Math.floor(day / 365);
    const doy = (day % 365) + 1;
    const m = Math.floor(minutes % 1440);
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    return `${year}.${String(doy).padStart(3, '0')} · ${hh}:${mm}`;
}

export function locationLabel(st = S()) {
    if (!st) return '';
    const sys = getGalaxy(st.seed).systems[st.loc.system];
    if (st.loc.place) return `${st.loc.place}, ${sys.name}`;
    if (st.loc.docked) return `Docked: ${(sys.stations[st.loc.station] ?? sys.stations[0]).name}, ${sys.name}`;
    return `In space, ${sys.name} system`;
}

export function adjust(obj, key, delta, lo, hi) {
    obj[key] = clamp((Number(obj[key]) || 0) + delta, lo, hi);
    return obj[key];
}
