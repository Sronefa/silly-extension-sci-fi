// The ship a character flies between battles, for any hull in the catalog. The six original
// hulls keep their hand-set figures; every other class gets figures derived from its size and family.
import { SHIP_CLASSES } from './catalog.js';
import { VESSELS } from './vessels.js';

const FUEL = [0, 12, 35, 60, 90, 140, 220];
const BURN = [0, 0.4, 0.8, 1.4, 2.2, 3.5, 6];
const HOLD = {
    civilian: [0, 4, 45, 150, 400, 1200, 3000],
    industrial: [0, 6, 70, 320, 900, 3000, 8000],
    military: [0, 1, 20, 45, 120, 300, 600],
    strike: [0, 1, 1, 1, 1, 1, 1],
};
const HOLD_BY_ROLE = { Yacht: 0.3, 'Fast packet': 0.5, 'Hospital ship': 0.3, Starliner: 0.15, Transport: 0.2, Tug: 0.2, 'Prospecting boat': 0.8, Tanker: 1.2, Shuttle: 1 };
const OLD_WEAPON = { pulse: 'pulse', rail: 'rail', missile: 'missile', asm: 'missile', autocannon: 'autocannon', lance: 'lance', pd: 'pd' };

const cache = {};
/** Overworld figures for a hull class id, or null if no such class exists. */
export function ownClass(id) {
    if (SHIP_CLASSES[id]) return SHIP_CLASSES[id];
    if (cache[id]) return cache[id];
    const v = VESSELS[id];
    if (!v) return null;
    const fam = v.family ?? 'civilian';
    const ind = fam === 'industrial' ? 1.2 : 1;
    cache[id] = {
        id: v.id, name: v.name, role: v.role,
        hull: v.hull, shields: v.shield, armor: v.armor[0],
        fuel: Math.round(FUEL[v.size] * ind), fuelPerLy: Math.round(BURN[v.size] * ind * 10) / 10,
        cargo: Math.max(1, Math.round((HOLD[fam] ?? HOLD.civilian)[v.size] * (HOLD_BY_ROLE[v.role] ?? 1))),
        evasion: Math.round(v.speed / 6), crewMax: Math.max(2, Math.round(v.crew * 1.3)),
        weapons: v.mounts.map(m => OLD_WEAPON[m.id]).filter(Boolean), price: v.price,
    };
    return cache[id];
}
