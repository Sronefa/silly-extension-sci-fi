// Per-chat campaign state, stored in chat metadata so every chat is its own save file.
import { ctx } from './st.js';
import { deepClone, hash, uid, clamp } from './util.js';
import { SHIP_CLASSES, SHIP_SYSTEMS, NEEDS } from '../data/catalog.js';
import { ATTRIBUTES, SKILL_IDS, CRAFT_CLASSES } from '../data/chargen.js';
import { refreshDerived } from '../systems/character.js';
import { getGalaxy } from '../systems/galaxy.js';

const KEY = 'scifi_os';
const HIST_KEY = 'scifi_os_hist';
const SAVE_KEY = 'scifi_os_saves';
const HIST_MAX = 10;
const SAVE_MAX = 5;
const LOG_MAX = 120;
export const START_YEAR = 2387;

const listeners = new Set();

export function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Returns the live state object for the current chat, or null if no campaign exists. */
export function S() {
    const st = ctx().chatMetadata?.[KEY] ?? null;
    // Saves from older versions are upgraded the first time they are touched.
    if (st && st.version !== 2) migrate(st);
    return st;
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

export function buildCraft(classId, name) {
    const cls = CRAFT_CLASSES[classId];
    if (!cls) return null;
    return {
        id: uid('craft'), classId: cls.id, kind: cls.kind, name: name || cls.name,
        hull: cls.hull, maxHull: cls.hull, shields: cls.shields, maxShields: cls.shields,
        armor: cls.armor, energy: cls.energy, maxEnergy: cls.energy,
    };
}

/**
 * Starts a campaign in the current chat.
 * opts: { sheet, reputation, ship, shipName, craft, seed, deathMode }
 */
export function newCampaign(opts = {}) {
    const seed = opts.seed ?? hash(Date.now(), Math.random());
    const galaxy = getGalaxy(seed);
    // Start in a reasonably safe, non-capital system, in home faction space when possible.
    const safe = galaxy.systems.filter(s => s.security >= 3 && !s.capital);
    const home = safe.filter(s => s.faction === opts.homeFaction);
    const pool = home.length ? home : safe.length ? safe : galaxy.systems;
    const start = pool[seed % pool.length];
    const sheet = opts.sheet;

    const state = {
        version: 2,
        seed,
        minutes: 141 * 1440 + 9 * 60,
        captain: sheet,
        ship: opts.ship ? buildShip(opts.ship, opts.shipName) : null,
        craft: opts.craft ? [buildCraft(opts.craft)] : [],
        crew: [],
        cargo: [],
        loc: { system: start.id, station: 0, docked: true, place: '' },
        route: [],
        visited: { [start.id]: true },
        sysNotes: {},
        marketDelta: {},
        missions: [],
        reputation: opts.reputation ?? { accord: 0, combine: 0, compact: 0, hegemony: 0, ashen: -20 },
        contacts: [],
        trackers: [],
        log: [],
        combat: null,
        shipCombat: null,
        pendingEvent: null,
        alert: 'green',
        deathMode: opts.deathMode ?? 'checkpoint',
        dead: false,
    };
    ctx().chatMetadata[KEY] = state;
    ctx().chatMetadata[HIST_KEY] = [];
    ctx().chatMetadata[SAVE_KEY] = [];
    const station = start.stations[0].name;
    addLog(`Record opened for ${sheet.name}, ${sheet.role}. Location: ${station}, ${start.name}.`, 'sys');
    state.pendingEvent = `This is the opening of the story. ${sheet.name} is a ${sheet.role} currently at ${station} in the ${start.name} system. Set the scene there.`;
    saveCheckpoint('Start', true);
    commit('new');
    return state;
}

export function deleteCampaign() {
    delete ctx().chatMetadata[KEY];
    delete ctx().chatMetadata[HIST_KEY];
    delete ctx().chatMetadata[SAVE_KEY];
    commit('delete');
}

export function importCampaign(obj) {
    if (!obj || typeof obj !== 'object' || !obj.captain) throw new Error('Not a Ship-OS save file');
    ctx().chatMetadata[KEY] = migrate(obj);
    ctx().chatMetadata[HIST_KEY] = [];
    commit('import');
}

function migrateSheet(sh) {
    sh.attrs ??= {};
    for (const a of ATTRIBUTES) sh.attrs[a.id] ??= 4;
    const old = sh.skills ?? {};
    sh.skills = {};
    sh.xp ??= {};
    for (const id of SKILL_IDS) {
        sh.skills[id] = old[id] ?? ({ pilot: old.piloting, firearms: old.combat, leadership: old.tactics }[id]) ?? 0;
        sh.xp[id] ??= 0;
    }
    for (const k of ['traits', 'flaws', 'cyber', 'injuries']) sh[k] ??= [];
    sh.stress ??= 0;
    sh.weapon ??= 'pistol';
    sh.armor ??= 'none';
    sh.role ??= sh.isPlayer ? 'Spacer' : 'Crew';
    refreshDerived(sh);
    return sh;
}

/** Fills in anything missing from older or hand-edited saves. */
export function migrate(st) {
    if (!st) return st;
    st.captain.isPlayer = true;
    st.captain.needs ??= {};
    for (const n of NEEDS) st.captain.needs[n.id] ??= 80;
    st.captain.inventory ??= [];
    st.captain.radiation ??= 0;
    st.captain.debt ??= 0;
    st.captain.craving ??= 0;
    migrateSheet(st.captain);
    if (st.ship) {
        st.ship.systems ??= {};
        for (const s of SHIP_SYSTEMS) st.ship.systems[s.id] ??= 100;
        st.ship.weapons ??= [];
        st.ship.parts ??= 0;
        st.ship.supplies ??= 0;
    } else {
        st.ship = null;
    }
    for (const k of ['crew', 'craft', 'cargo', 'route', 'missions', 'contacts', 'trackers', 'log']) st[k] ??= [];
    st.crew = st.crew.map(c => migrateSheet(c));
    for (const k of ['visited', 'sysNotes', 'marketDelta', 'reputation']) st[k] ??= {};
    st.loc ??= { system: 0, station: 0, docked: true, place: '' };
    st.alert ??= 'green';
    st.deathMode ??= 'checkpoint';
    st.dead ??= false;
    st.version = 2;
    return st;
}

// ---- Checkpoints: named saves stored with the chat ----

export function checkpoints() {
    return ctx().chatMetadata?.[SAVE_KEY] ?? [];
}

export function saveCheckpoint(label, auto = false) {
    const st = S();
    if (!st || st.dead) return null;
    const meta = ctx().chatMetadata;
    const list = (meta[SAVE_KEY] ??= []);
    const entry = { id: uid('cp'), label, auto, minutes: st.minutes, where: locationLabel(st), state: deepClone(st) };
    if (auto) {
        // One rolling autosave per label.
        const i = list.findIndex(c => c.auto && c.label === label);
        if (i >= 0) list.splice(i, 1);
    }
    list.unshift(entry);
    const manual = list.filter(c => !c.auto);
    while (manual.length > SAVE_MAX) list.splice(list.indexOf(manual.pop()), 1);
    return entry;
}

export function loadCheckpoint(id) {
    const meta = ctx().chatMetadata;
    const cp = (meta[SAVE_KEY] ?? []).find(c => c.id === id);
    if (!cp) return false;
    meta[KEY] = migrate(deepClone(cp.state));
    meta[HIST_KEY] = [];
    addLog(`Checkpoint restored: ${cp.label}.`, 'sys');
    commit('load');
    return true;
}

export function deleteCheckpoint(id) {
    const meta = ctx().chatMetadata;
    meta[SAVE_KEY] = (meta[SAVE_KEY] ?? []).filter(c => c.id !== id);
    commit('checkpoint');
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

/** Cargo space: the ship's hold, or what one person can haul without a ship. */
export function cargoCap(st = S()) {
    return st?.ship ? st.ship.cargoCap : 2;
}

export function shipClass(st = S()) {
    return st?.ship ? (SHIP_CLASSES[st.ship.classId] ?? SHIP_CLASSES.mule) : null;
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
