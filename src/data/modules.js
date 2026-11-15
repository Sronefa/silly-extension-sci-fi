// Hardpoints and the modules that go in them. Every hull has a fixed set of slots, each with a
// type and a size; a module fits a slot of its own type that is at least as big as it is.
import { SC_WEAPONS } from './vessels.js';

export const SLOT_TYPES = {
    weapon: { name: 'Weapon mounts', one: 'Weapon mount' },
    defence: { name: 'Defence mounts', one: 'Defence mount' },
    utility: { name: 'Utility mounts', one: 'Utility mount' },
    bay: { name: 'Internal bays', one: 'Internal bay' },
};
export const SLOT_SIZE = ['', 'Small', 'Medium', 'Large', 'Heavy', 'Capital', 'Keel'];

const KIND_SLOT = { pd: 'defence', sand: 'defence', decoy: 'defence', sweeper: 'utility', mine: 'utility', drone: 'utility' };
const W_LEGAL = {
    autocannon: 'open', pulse: 'open', pd: 'open', mininglaser: 'open', sandcaster: 'open', harpoon: 'open',
    rail: 'licensed', lance: 'licensed', missile: 'licensed', dronebay: 'licensed', mines: 'licensed', sweeper: 'licensed', decoydrone: 'licensed', flak: 'licensed',
};

/** Systems that are not weapons. fx is what the module changes about the ship. */
const SYSTEMS = [
    { id: 'jammer', name: 'ECM Jammer', slot: 'utility', size: 2, legal: 'licensed', price: 180000, fx: { jammer: true }, desc: 'Degrades enemy tracks on everything near you.' },
    { id: 'milsensors', name: 'Military Sensor Suite', slot: 'utility', size: 2, legal: 'restricted', price: 400000, fx: { grade: 3 }, desc: 'Military-grade discrimination: few ghosts, few mistakes, and it sees through decoys sooner.' },
    { id: 'longarray', name: 'Long-range Array', slot: 'utility', size: 2, legal: 'open', price: 40000, fx: { sensors: 1.3 }, desc: 'Thirty percent more sensor reach.' },
    { id: 'baffles', name: 'Emission Baffles', slot: 'utility', size: 2, legal: 'restricted', price: 350000, fx: { sig: 0.8 }, desc: 'A smaller signature. Smugglers and scouts pay anything for these.' },
    { id: 'medbay', name: 'Modular Med Bay', slot: 'bay', size: 2, legal: 'open', price: 60000, fx: { medbay: true }, desc: 'Two beds, an autodoc and a pharmacy in a container.' },
    { id: 'surgery', name: 'Surgical Suite', slot: 'bay', size: 3, legal: 'licensed', price: 600000, fx: { medbay: true, surgery: true }, desc: 'A real operating theatre. Needs a real surgeon.' },
    { id: 'cargomod', name: 'Cargo Module', slot: 'bay', size: 2, legal: 'open', price: 8000, fx: { cargo: 30 }, desc: 'Thirty more tonnes of hold.' },
    { id: 'reefer', name: 'Refrigerated Hold', slot: 'bay', size: 1, legal: 'open', price: 6000, fx: { reefer: true }, desc: 'Chills the hold. Fresh produce and pharmaceuticals arrive as they left.' },
    { id: 'hazmat', name: 'Hazmat Containment', slot: 'bay', size: 1, legal: 'open', price: 9000, fx: { hazmat: true }, desc: 'Sealed, vented and certified. Regulated ports will load fuel cells, chemicals and radioactives.' },
    { id: 'pens', name: 'Livestock Pens', slot: 'bay', size: 2, legal: 'open', price: 7000, fx: { pens: true }, desc: 'Stalls, feed and air for live cargo.' },
    { id: 'cabins', name: 'Passenger Cabins', slot: 'bay', size: 2, legal: 'open', price: 15000, fx: { passengers: 8 }, desc: 'Eight berths with doors that close.' },
    { id: 'barracks', name: 'Marine Barracks', slot: 'bay', size: 2, legal: 'restricted', price: 300000, fx: { pods: 1, marines: true }, desc: 'A boarding party, their armory and a pod to send them in.' },
    { id: 'brig', name: 'Brig', slot: 'bay', size: 1, legal: 'open', price: 10000, fx: { brig: true }, desc: 'Four cells.' },
    { id: 'workshop', name: 'Machine Shop', slot: 'bay', size: 2, legal: 'open', price: 45000, fx: { dcBonus: 1 }, desc: 'One more repair team, and somewhere to make the part you do not have.' },
    { id: 'mechbay', name: 'Mech Bay', slot: 'bay', size: 4, legal: 'restricted', price: 2000000, fx: { mechBay: true }, desc: 'Gantries, actuator rigs and a clean room. The only place a combat frame can be repaired.' },
    { id: 'hangarbay', name: 'Hangar Bay', slot: 'bay', size: 3, legal: 'licensed', price: 500000, fx: { hangar: 2 }, desc: 'Room and a launch cradle for two strike craft.' },
    { id: 'tanks', name: 'Auxiliary Tanks', slot: 'bay', size: 2, legal: 'open', price: 9000, fx: { fuel: 15 }, desc: 'Fifteen more units of fuel.' },
    { id: 'armorbelt', name: 'Armor Belt', slot: 'bay', size: 3, legal: 'licensed', price: 450000, fx: { armor: 1, speed: 0.92 }, desc: 'One more point of plate everywhere, and you feel the mass.' },
    { id: 'capacitor', name: 'Shield Capacitor', slot: 'bay', size: 2, legal: 'licensed', price: 200000, fx: { shield: 1.25 }, desc: 'A quarter more shield.' },
    { id: 'heatsink', name: 'Heat Sinks', slot: 'bay', size: 1, legal: 'open', price: 12000, fx: { heat: 1.2 }, desc: 'A fifth more heat capacity.' },
    { id: 'navcomp', name: 'Navigation Computer', slot: 'bay', size: 2, legal: 'open', price: 50000, fx: { spool: -1 }, desc: 'Works jump solutions faster: the drive spools thirty seconds sooner.' },
    { id: 'prow', name: 'Reinforced Prow', slot: 'bay', size: 3, legal: 'licensed', price: 300000, fx: { ram: true, bow: 2 }, desc: 'A ram bow. Turns a collision into a weapon.' },
    { id: 'hidden', name: 'Shielded Compartment', slot: 'bay', size: 1, legal: 'restricted', price: 25000, fx: { hidden: 5 }, desc: 'Five tonnes of hold that a customs scan does not find.' },
    { id: 'orerig', name: 'Ore Processing Rig', slot: 'bay', size: 3, legal: 'open', price: 80000, fx: { mining: true }, desc: 'Crushers and a smelter. Turns rock into something worth hauling.' },
    { id: 'overdrive', name: 'Overtuned Drives', slot: 'bay', size: 2, legal: 'licensed', price: 220000, fx: { speed: 1.12, heat: 0.9 }, desc: 'Faster, hotter, and out of warranty.' },
];

const weaponPrice = (d) => Math.round(18000 * d.size ** 2.2 * (d.nuclear ? 12 : d.rare ? 4 : d.fixed ? 2.5 : d.kind === 'missile' ? 1.5 : 1) / 1000) * 1000;

export const MODULES = {};
for (const d of Object.values(SC_WEAPONS)) {
    if (d.kind === 'pod' || d.melee) continue; // boarding pods come with barracks, blades with a frame
    MODULES[d.id] = { id: d.id, name: d.name, slot: KIND_SLOT[d.kind] ?? 'weapon', size: d.size, weapon: true, fixed: !!d.fixed, legal: W_LEGAL[d.id] ?? 'restricted', price: weaponPrice(d), desc: '' };
}
for (const s of SYSTEMS) MODULES[s.id] = s;

/** The fixed set of slots a hull class has, each with the module it leaves the yard with. */
export function hullSlots(cls) {
    const slots = [];
    const count = {};
    const push = (type, size, extra = {}) => { count[type] = (count[type] ?? 0) + 1; slots.push({ id: `${type[0]}${count[type]}`, type, size, stock: null, ...extra }); };
    for (const mt of cls.mounts) {
        const mod = MODULES[mt.id];
        if (!mod) continue;
        push(mod.slot, mod.size, { arc: mt.arc, stock: mod.id });
    }
    if (cls.size < 2) return slots;
    const util = cls.size - 1;
    for (let i = 0; i < util; i++) push('utility', Math.min(3, cls.size), { stock: i === 0 && cls.jammer ? 'jammer' : null });
    const bays = cls.family === 'industrial' ? cls.size + 1 : cls.family === 'civilian' ? cls.size : cls.size - 1;
    const stock = [];
    if (cls.medbay || (cls.family === 'military' && cls.size >= 3 && !cls.pirate)) stock.push('medbay');
    if (cls.mechBay) stock.push('mechbay');
    if (cls.dcBonus) stock.push('workshop');
    if (cls.ram) stock.push('prow');
    for (let i = 0; i < Math.max(bays, stock.length); i++) {
        const st = stock[i] ?? null;
        push('bay', Math.max(Math.min(4, cls.size), st ? MODULES[st].size : 0), { stock: st });
    }
    return slots;
}

export const fits = (mod, slot) => mod.slot === slot.type && mod.size <= slot.size && (slot.arc === 'S') === !!mod.fixed;

/**
 * What it takes to change a module. Small ones the ship's engineer swaps anywhere; medium ones
 * the engineer can still do, but alongside a station; anything bigger is yard work.
 */
export function refitRule(size) {
    if (size <= 1) return { hours: 2, where: 'anywhere', by: 'the ship\'s engineer, anywhere' };
    if (size === 2) return { hours: 8, where: 'docked', by: 'the ship\'s engineer, alongside a station' };
    if (size === 3) return { hours: 30, where: 'yard', by: 'a station yard crew' };
    if (size === 4) return { hours: 96, where: 'yard', by: 'a shipyard, in dock' };
    if (size === 5) return { hours: 240, where: 'yard', by: 'a shipyard, in dock' };
    return { hours: 720, where: 'yard', by: 'a naval yard: the keel has to be opened' };
}
