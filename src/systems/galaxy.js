// Procedural sector generation. Deterministic from a seed, so only the seed is stored per chat.
import { makeRng, pick, randInt, weightedPick, hash } from '../core/util.js';
import { FACTIONS, ECONOMIES } from '../data/catalog.js';

export const SECTOR_W = 120;
export const SECTOR_H = 80;
const SYSTEM_COUNT = 28;
const LANE_RANGE = 17;

const SYL_A = ['Ke', 'Va', 'Tor', 'Ash', 'Bel', 'Cor', 'Dra', 'Eri', 'Hal', 'Ix', 'Jun', 'Kor', 'Lyr', 'Mer', 'Nav', 'Or', 'Pra', 'Quil', 'Ras', 'Sol', 'Tal', 'Um', 'Ves', 'Wyn', 'Xan', 'Yar', 'Zeph', 'Ald', 'Cas', 'Fen'];
const SYL_B = ['a', 'e', 'i', 'o', 'u', 'ar', 'en', 'is', 'or', 'ul', 'an', 'el', 'ia', 'os'];
const SYL_C = ['ra', 'dis', 'non', 'tis', 'lux', 'vane', 'mar', 'kesh', 'this', 'dor', 'lon', 'ryn', 'tara', 'phis', 'gard', 'heim', 'mira', 'cor'];
const SUFFIX = ['', '', '', '', ' Prime', ' Reach', "'s Rest", ' Deep', ' Minor', ' Gate', ' Drift', ' Verge'];
const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Tau', 'Sigma', 'Omicron'];

const STAR_TYPES = [
    { w: 34, cls: 'M', label: 'Red dwarf', color: '#ff7a5c', r: 3.2 },
    { w: 20, cls: 'K', label: 'Orange dwarf', color: '#ffb066', r: 3.8 },
    { w: 16, cls: 'G', label: 'Yellow main-sequence', color: '#ffe38a', r: 4.2 },
    { w: 10, cls: 'F', label: 'Yellow-white star', color: '#fff6d6', r: 4.6 },
    { w: 6, cls: 'A', label: 'White star', color: '#dfe9ff', r: 5 },
    { w: 3, cls: 'B', label: 'Blue giant', color: '#9cc0ff', r: 5.8 },
    { w: 5, cls: 'D', label: 'White dwarf', color: '#f0f4ff', r: 2.6 },
    { w: 3, cls: 'N', label: 'Neutron star', color: '#b8f2ff', r: 2.4 },
    { w: 3, cls: 'Bin', label: 'Binary pair', color: '#ffd9a8', r: 4.8 },
];

const PLANET_TYPES = [
    { w: 18, type: 'Barren rock', color: '#8d8478' },
    { w: 12, type: 'Ice world', color: '#bfe6ff' },
    { w: 12, type: 'Gas giant', color: '#d9a56b' },
    { w: 8, type: 'Ice giant', color: '#7fc7d9' },
    { w: 8, type: 'Desert world', color: '#d9b36b' },
    { w: 6, type: 'Ocean world', color: '#4f8fe0' },
    { w: 5, type: 'Temperate terrestrial', color: '#6fbf73' },
    { w: 6, type: 'Volcanic world', color: '#e0623d' },
    { w: 5, type: 'Toxic greenhouse', color: '#c9c15a' },
    { w: 6, type: 'Asteroid belt', color: '#9a9a9a', belt: true },
];

const STATION_KINDS = ['Ring Station', 'Orbital', 'Anchorage', 'Highport', 'Waystation', 'Depot', 'Platform', 'Citadel', 'Exchange', 'Dockyard'];
const STATION_NAMES = ['Halvorsen', 'Okafor', 'Tanaka', 'Meridian', 'Castellan', 'Vostok', 'Ibarra', 'Lindqvist', 'Novak', 'Armitage', 'Sato', 'Reyes', 'Kovalenko', 'Adeyemi', 'Brandt', 'Morrow', 'Thessaly', 'Corvin', 'Hadley', 'Zheng'];

function makeName(rng, used) {
    for (let i = 0; i < 50; i++) {
        let name;
        const r = rng();
        if (r < 0.12) {
            name = `${pick(rng, GREEK)} ${pick(rng, SYL_A)}${pick(rng, SYL_C)}`;
        } else if (r < 0.22) {
            name = `${pick(rng, ['HD', 'GJ', 'KOI', 'LHS'])} ${randInt(rng, 1000, 9999)}`;
        } else {
            name = `${pick(rng, SYL_A)}${pick(rng, SYL_B)}${rng() < 0.6 ? pick(rng, SYL_C) : ''}${pick(rng, SUFFIX)}`;
        }
        if (!used.has(name)) {
            used.add(name);
            return name;
        }
    }
    return `Unnamed ${used.size}`;
}

function makeBodies(rng, systemName) {
    const count = randInt(rng, 2, 7);
    const bodies = [];
    let orbit = 0.3 + rng() * 0.3;
    for (let i = 0; i < count; i++) {
        const t = weightedPick(rng, PLANET_TYPES);
        bodies.push({
            name: t.belt ? `${systemName} Belt` : `${systemName} ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][i]}`,
            type: t.type,
            color: t.color,
            belt: !!t.belt,
            orbit: Math.round(orbit * 100) / 100,
            size: t.type.includes('giant') ? 5 : 2 + Math.floor(rng() * 3),
            angle: rng() * Math.PI * 2,
        });
        orbit *= 1.5 + rng() * 0.6;
    }
    return bodies;
}

function makeStations(rng, sys) {
    const count = sys.security >= 4 ? randInt(rng, 2, 3) : sys.security >= 2 ? randInt(rng, 1, 2) : 1;
    const stations = [];
    const usedNames = new Set();
    const anchors = sys.bodies.filter(b => !b.belt);
    for (let i = 0; i < count; i++) {
        let n = pick(rng, STATION_NAMES);
        while (usedNames.has(n)) n = pick(rng, STATION_NAMES);
        usedNames.add(n);
        const services = ['market', 'fuel'];
        if (rng() < 0.45 + sys.security * 0.1) services.push('repair');
        if (rng() < 0.25 + sys.security * 0.12) services.push('medical');
        if (sys.security >= 3 && rng() < 0.5) services.push('shipyard');
        if (rng() < 0.6) services.push('crew');
        const anchor = anchors.length ? pick(rng, anchors) : sys.bodies[0];
        stations.push({
            name: `${n} ${pick(rng, STATION_KINDS)}`,
            orbiting: anchor?.name ?? sys.name,
            services,
        });
    }
    // The first station is always a full-service port so nobody gets stranded.
    for (const s of ['repair']) if (!stations[0].services.includes(s)) stations[0].services.push(s);
    return stations;
}

const cache = new Map();

/** Builds (or returns the cached) sector for a seed. */
export function getGalaxy(seed) {
    if (cache.has(seed)) return cache.get(seed);
    const rng = makeRng(hash('sector', seed));
    const systems = [];
    const used = new Set();

    let guard = 0;
    while (systems.length < SYSTEM_COUNT && guard++ < 4000) {
        const x = 6 + rng() * (SECTOR_W - 12);
        const y = 6 + rng() * (SECTOR_H - 12);
        if (systems.some(s => Math.hypot(s.x - x, s.y - y) < 9)) continue;
        const star = weightedPick(rng, STAR_TYPES);
        systems.push({
            id: systems.length,
            name: makeName(rng, used),
            x: Math.round(x * 10) / 10,
            y: Math.round(y * 10) / 10,
            star: { cls: star.cls, label: star.label, color: star.color, r: star.r },
        });
    }

    // Faction capitals spread across the map; the pirate fleet takes the most isolated system.
    const capitals = [];
    const majors = FACTIONS.filter(f => f.id !== 'ashen');
    const corners = [[0.2, 0.25], [0.8, 0.25], [0.25, 0.8], [0.8, 0.78]];
    majors.forEach((f, i) => {
        const [cx, cy] = corners[i];
        const tx = cx * SECTOR_W, ty = cy * SECTOR_H;
        const free = systems.filter(s => !capitals.some(c => c.sys === s));
        free.sort((a, b) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty));
        capitals.push({ faction: f.id, sys: free[0] });
    });

    for (const s of systems) {
        let best = null, bestD = Infinity;
        for (const c of capitals) {
            const d = Math.hypot(c.sys.x - s.x, c.sys.y - s.y);
            if (d < bestD) { bestD = d; best = c; }
        }
        s.faction = best.faction;
        s.capital = best.sys === s;
        // Security 0 (lawless) to 5 (fortress), falling off with distance from the capital.
        s.security = Math.max(0, Math.min(5, Math.round(5 - bestD / 9 + (rng() - 0.5))));
        if (s.capital) s.security = 5;
    }
    // Lawless systems far from any capital fall to the pirates.
    const lawless = systems.filter(s => s.security === 0);
    lawless.forEach(s => { if (rng() < 0.7) s.faction = 'ashen'; });
    if (!systems.some(s => s.faction === 'ashen')) {
        const far = [...systems].sort((a, b) => a.security - b.security)[0];
        far.faction = 'ashen';
        far.security = 0;
    }

    const econKeys = Object.keys(ECONOMIES);
    for (const s of systems) {
        const r = makeRng(hash('sys', seed, s.id));
        if (s.capital) s.economy = pick(r, ['hightech', 'industrial']);
        else if (s.security <= 1) s.economy = pick(r, ['outpost', 'mining', 'outpost', 'refinery']);
        else s.economy = pick(r, econKeys.filter(k => k !== 'outpost'));
        if (s.faction === 'hegemony' && r() < 0.35) s.economy = 'military';
        s.bodies = makeBodies(r, s.name);
        s.stations = makeStations(r, s);
        s.population = s.capital ? randInt(r, 800, 4000) * 1e6
            : Math.round(Math.pow(10, 3 + s.security * 1.1 + r() * 1.5));
        s.hazard = r() < 0.18 ? pick(r, ['Dense debris field', 'Stellar flare activity', 'Ion storms', 'Uncharted gravity shear', 'Quarantine zone']) : null;
    }

    // Jump lanes: every pair inside lane range, plus a spanning tree so the sector is connected.
    const lanes = new Set();
    const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    const dist = (a, b) => Math.hypot(systems[a].x - systems[b].x, systems[a].y - systems[b].y);
    for (let i = 0; i < systems.length; i++) {
        const near = systems.map((_, j) => j).filter(j => j !== i).sort((a, b) => dist(i, a) - dist(i, b));
        near.slice(0, 2).forEach(j => { if (dist(i, j) <= LANE_RANGE) lanes.add(key(i, j)); });
    }
    const inTree = new Set([0]);
    while (inTree.size < systems.length) {
        let bi = -1, bj = -1, bd = Infinity;
        for (const i of inTree) {
            for (let j = 0; j < systems.length; j++) {
                if (inTree.has(j)) continue;
                const d = dist(i, j);
                if (d < bd) { bd = d; bi = i; bj = j; }
            }
        }
        lanes.add(key(bi, bj));
        inTree.add(bj);
    }

    const laneList = [...lanes].map(k => {
        const [a, b] = k.split('-').map(Number);
        return { a, b, d: Math.round(dist(a, b) * 10) / 10 };
    });
    const adj = systems.map(() => []);
    for (const l of laneList) {
        adj[l.a].push({ to: l.b, d: l.d });
        adj[l.b].push({ to: l.a, d: l.d });
    }

    const galaxy = { seed, systems, lanes: laneList, adj };
    cache.set(seed, galaxy);
    return galaxy;
}

export function systemDistance(galaxy, a, b) {
    const A = galaxy.systems[a], B = galaxy.systems[b];
    return Math.round(Math.hypot(A.x - B.x, A.y - B.y) * 10) / 10;
}

/** Dijkstra over jump lanes. Returns { path: [ids], dist } or null. */
export function findRoute(galaxy, from, to, maxHop = Infinity) {
    if (from === to) return { path: [from], dist: 0 };
    const n = galaxy.systems.length;
    const best = new Array(n).fill(Infinity);
    const prev = new Array(n).fill(-1);
    const done = new Array(n).fill(false);
    best[from] = 0;
    for (let iter = 0; iter < n; iter++) {
        let u = -1;
        for (let i = 0; i < n; i++) if (!done[i] && (u === -1 || best[i] < best[u])) u = i;
        if (u === -1 || best[u] === Infinity) break;
        done[u] = true;
        if (u === to) break;
        for (const e of galaxy.adj[u]) {
            if (e.d > maxHop) continue;
            if (best[u] + e.d < best[e.to]) {
                best[e.to] = best[u] + e.d;
                prev[e.to] = u;
            }
        }
    }
    if (best[to] === Infinity) return null;
    const path = [];
    for (let c = to; c !== -1; c = prev[c]) path.unshift(c);
    return { path, dist: Math.round(best[to] * 10) / 10 };
}

export const factionById = (id) => FACTIONS.find(f => f.id === id);
export const SECURITY_LABELS = ['Lawless', 'Minimal', 'Low', 'Moderate', 'High', 'Fortress'];
