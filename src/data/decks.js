// Deck plans. Every ship bigger than a strike craft has an interior, generated from its class:
// the same class always gives the same plan, scaled to its length, crew and equipment. A gunboat
// is two cramped decks around a gun; a 500 m carrier is a small city.
import { SIZES, SC_WEAPONS } from './vessels.js';

const DECKS = [0, 0, 2, 3, 4, 6, 9];
export const beamOf = (cls) => Math.round(SIZES[cls.size].length / (cls.family === 'industrial' ? 4 : cls.wing || /carrier/i.test(cls.role) ? 4.2 : 5.5));

/** Kinds of compartment, for colour and for what the player may enter. */
export const ROOM_KINDS = {
    command: { name: 'Command', secure: true }, weapons: { name: 'Weapons', secure: true }, engineering: { name: 'Engineering', secure: true },
    crew: { name: 'Crew spaces' }, medical: { name: 'Medical' }, flight: { name: 'Flight operations' }, hold: { name: 'Holds' },
    service: { name: 'Ship services' }, public: { name: 'Public areas' },
};

/**
 * The list of compartments a class needs. w is relative floor area, lvl is how high in the ship
 * it sits (0 top deck, 1 keel), pos is where along the hull (0 bow, 1 stern). sys ties a
 * compartment to the ship system that is damaged with it; watch is how many people work there.
 */
function roomsFor(cls) {
    const z = cls.size;
    const war = cls.family === 'military';
    const has = (id) => cls.rooms.includes(id);
    const guns = cls.mounts.filter(mt => !['pd', 'sand', 'decoy'].includes(SC_WEAPONS[mt.id].kind)).length;
    const out = [];
    const add = (id, name, kind, w, lvl, pos, o = {}) => out.push({ id, name, kind, w, lvl, pos, sys: null, watch: 0, wide: false, desc: '', ...o });
    const small = z === 2 && cls.crew <= 6;
    const people = (share, min = 1, max = 400) => Math.max(min, Math.min(max, Math.round(cls.crew * share)));

    // Command
    const bridgeName = small ? 'Flight Deck' : z <= 3 ? 'Bridge' : 'Bridge';
    add('bridge', bridgeName, 'command', 2.5 + z, 0, 0.14, { sys: 'bridge', watch: small ? Math.min(cls.crew, 2) : people(0.05, 3, 40),
        desc: z <= 3 ? `Helm, sensors${has('cic') ? '' : ', gunnery'} and the jump plot all share this one compartment.` : 'Helm, sensor and command stations. The captain\'s chair is here.' });
    if (z >= 6) add('flag', 'Flag Bridge', 'command', 4, 0, 0.24, { watch: 12, desc: 'Where an admiral and their staff run the whole force.' });
    if (z >= 4) add('nav', 'Navigation', 'command', 2 + z * 0.4, 0.06, 0.3, { watch: 2 + z, desc: 'The navigators work jump solutions here. Without them a jump is a guess.' });
    add('sensors', small ? 'Sensor Bay' : 'Sensor Array', 'command', 1.5 + z * 0.4, 0, 0.03, { sys: 'sensors', watch: z >= 3 ? people(0.02, 1, 12) : 0, desc: 'Antenna farms, processors and the technicians who keep them honest.' });
    // Weapons
    if (has('cic')) add('cic', z >= 5 ? 'Gunnery Deck' : 'Gunnery Control', 'weapons', 2 + z + guns * 0.15, 0.18, 0.3, { sys: 'cic', watch: Math.max(2, Math.round(guns * 1.5)),
        desc: 'Fire control. Every firing solution is worked here, by people, against the clock.' });
    if (cls.mounts.some(mt => SC_WEAPONS[mt.id].fixed)) add('spinal', 'Spinal Gun Gallery', 'weapons', 3 + z * 1.5, 0.5, 0.12, { wide: z >= 4, watch: 4 + z * 2, desc: 'The accelerator runs the length of the keel. This is the breech end.' });
    if (has('magazine')) add('magazine', 'Magazine', 'weapons', 1.5 + z * 0.8, 0.88, 0.42, { sys: 'magazine', watch: people(0.02, 1, 30), desc: 'Shells and missiles behind the thickest bulkheads aboard.' });
    if (war && z >= 3) add('armory', cls.pirate ? 'Boarding Lock and Armory' : 'Marine Barracks and Armory', 'weapons', 2 + z * 0.8, 0.55, 0.28, { watch: people(0.08, 4, 160), desc: 'The ship\'s soldiers, their weapons and the lock they go out of.' });
    if (cls.mounts.some(mt => mt.id === 'dronebay')) add('dronectl', 'Drone Control', 'weapons', 2 + z * 0.4, 0.3, 0.6, { watch: 3 + z, desc: 'Operators fly the drones from couches here.' });
    // Engineering
    add('reactor', 'Reactor Room', 'engineering', 2.5 + z * 1.2, 0.7, 0.7, { sys: 'reactor', watch: people(0.05, 1, 60), desc: 'The reactor and its shielding. Hot, loud and never empty.' });
    add('drives', small ? 'Drive Bay' : 'Main Engineering', 'engineering', 3 + z * 1.4, 0.6, 1, { sys: 'drives', watch: people(0.06, 1, 80), wide: z >= 4, desc: 'The main drives and the people who talk to them.' });
    if (has('jump')) add('jump', 'Jump Drive', 'engineering', 1.5 + z * 0.7, 0.8, 0.86, { sys: 'jump', watch: z >= 3 ? 2 : 0, desc: 'The jump core. Nobody lingers.' });
    if (has('shields')) add('shields', 'Shield Emitters', 'engineering', 1.5 + z * 0.4, 0.3, 0.5, { sys: 'shields', desc: 'Emitter capacitors and their cooling.' });
    if (has('lifesupport')) add('lifesupport', 'Life Support', 'service', 1.5 + z * 0.7, 0.5, 0.56, { sys: 'lifesupport', watch: z >= 4 ? people(0.01, 2, 20) : 0, desc: 'Air, water and heat for everyone aboard.' });
    if (z >= 3) add('shop', cls.dcBonus ? 'Fabrication Shops' : 'Machine Shop', 'engineering', (cls.dcBonus ? 6 : 1.5) + z * 0.5, 0.66, 0.6, { watch: people(cls.dcBonus ? 0.2 : 0.02, 1, 60), desc: 'Damage control lockers and the tools to make what is not in stores.' });
    // People
    if (has('quarters')) {
        const per = z >= 5 ? 130 : z >= 4 ? 50 : 24;
        const n = small ? 1 : Math.max(1, Math.min(12, Math.ceil(cls.crew / per)));
        const liner = /liner|transport|yacht/i.test(cls.role);
        for (let i = 0; i < n; i++) add(`berth${i + 1}`, small ? 'Crew Cabins' : n === 1 ? 'Crew Berthing' : `Berthing ${'ABCDEFGHJKLM'[i]}`, 'crew', small ? 2.5 : 2.5 + z * 0.5, 0.3 + 0.4 * (i / Math.max(1, n - 1 || 1)), 0.25 + 0.5 * ((i * 7) % 10) / 10, { sys: 'quarters', desc: z >= 4 ? 'Racks three high, lockers, and a queue for the showers.' : 'Bunks, lockers and not much else.' });
        if (liner) { const pn = Math.max(1, Math.min(10, z * 2 - 2)); for (let i = 0; i < pn; i++) add(`cabins${i + 1}`, pn === 1 ? 'Passenger Cabins' : `Passenger Deck ${i + 1}`, 'public', 3 + z, 0.15 + 0.5 * (i / Math.max(1, pn - 1 || 1)), 0.3 + 0.4 * ((i * 3) % 5) / 5, { desc: 'Cabins for people who paid to be somewhere else.' }); }
        if (z >= 3) add('wardroom', 'Officers\' Country', 'crew', 1.5 + z * 0.5, 0.1, 0.38, { desc: 'Officers\' cabins and the wardroom.' });
        add('mess', small ? 'Galley' : 'Mess Deck and Galley', 'crew', small ? 1.5 : 2 + z * 0.8, 0.45, 0.4, { watch: z >= 3 ? people(0.02, 1, 30) : 0, desc: small ? 'A table, a heater and everyone\'s elbows.' : 'Where the crew eats, argues and hears the news.' });
    }
    if (cls.medbay || (war && z >= 3 && !cls.pirate)) add('medbay', z >= 5 || /hospital/i.test(cls.role) ? 'Hospital' : 'Med Bay', 'medical', (/hospital/i.test(cls.role) ? 10 : 1.5) + z * 0.6, 0.4, 0.5, { watch: people(/hospital/i.test(cls.role) ? 0.3 : 0.02, 1, 60), desc: 'Beds, an autodoc, a surgeon if the ship rates one.' });
    if (war && z >= 3 && !cls.pirate) add('brig', 'Brig', 'service', 1, 0.6, 0.34, { watch: 1, desc: 'Cells.' });
    // Flight and holds
    if (has('hangar')) {
        add('hangar', z >= 5 ? 'Hangar Deck' : 'Hangar', 'flight', 6 + z * 2 + (cls.wing?.length ?? 0), 0.75, 0.72, { sys: 'hangar', wide: true, watch: people(0.08, 2, 200), desc: 'Strike craft, shuttles, fuel lines and people running.' });
        if (cls.wing?.length) add('pri', 'Flight Control', 'flight', 1.5 + z * 0.3, 0.2, 0.7, { watch: 4 + z, desc: 'Launches, recoveries and the air picture.' });
        if (cls.wing?.length) add('ready', 'Pilots\' Ready Room', 'flight', 1.5 + z * 0.3, 0.55, 0.62, { desc: 'Briefings, flight gear and bad coffee.' });
    }
    if (cls.mechBay) add('mechbay', 'Mech Bay', 'flight', 5 + z, 0.72, 0.55, { wide: true, watch: people(0.04, 6, 80), desc: 'Gantries and actuator rigs. The only place aboard a combat frame can be repaired.' });
    if (has('cargo')) add('cargo', cls.family === 'industrial' && z >= 4 ? 'Main Hold' : 'Cargo Hold', 'hold', cls.family === 'industrial' ? 8 + z * 4 : cls.family === 'civilian' ? 4 + z * 1.5 : 2 + z, 0.85, 0.5, { sys: 'cargo', wide: true, desc: 'The hold.' });
    if (cls.volatile) add('tanks', 'Reaction Mass Tanks', 'hold', 20, 0.5, 0.5, { wide: true, desc: 'Thousands of tonnes of something that burns.' });
    if (cls.mounts.some(mt => mt.id === 'mininglaser') && z >= 3) add('ore', 'Ore Bay and Crushers', 'hold', 6 + z * 2, 0.7, 0.35, { wide: true, watch: people(0.2, 2, 200), desc: 'Rock goes in. Money comes out, eventually.' });
    // Locks and boats
    add('lock', small ? 'Airlock' : 'Main Airlock', 'service', 0.8 + z * 0.2, 0.5, 0.46, { desc: 'The way in and out.' });
    if (cls.pods && z >= 2) { add('pods1', z >= 4 ? 'Escape Pods, forward' : 'Escape Pod', 'service', 0.8 + z * 0.3, 0.3, 0.2, { desc: 'One-way boats.' }); if (z >= 4) add('pods2', 'Escape Pods, aft', 'service', 0.8 + z * 0.3, 0.6, 0.8, { desc: 'One-way boats.' }); }
    // A big ship is a town.
    if (z >= 5) {
        add('rec', 'Recreation Deck', 'public', 3 + z, 0.42, 0.45, { desc: 'A gym, a canteen, a cinema that shows the same twelve films.' });
        add('hydro', 'Hydroponics', 'service', 3 + z, 0.5, 0.36, { watch: people(0.01, 4, 30), desc: 'Green rows under lamps. Fresh food and half the air.' });
        add('admin', 'Ship\'s Offices', 'service', 2 + z * 0.5, 0.2, 0.44, { watch: people(0.02, 4, 40), desc: 'Pay, post, discipline and paperwork.' });
        add('stores', 'Stores and Workshops', 'hold', 4 + z, 0.8, 0.3, { watch: people(0.02, 4, 40), desc: 'Everything a thousand people need for six months.' });
    }
    if (z >= 6 || /starliner|carrier/i.test(cls.role) && z >= 5) add('promenade', /starliner/i.test(cls.role) ? 'Grand Promenade' : 'Main Street', 'public', 5 + z, 0.36, 0.5, { wide: true, desc: /starliner/i.test(cls.role) ? 'Shops, restaurants and a ballroom under a false sky.' : 'The long central passage: ship\'s store, barber, chapel, and everyone you know.' });
    if (cls.faction === 'hegemony' && z >= 4) add('chapel', 'Chapel', 'public', 1.5 + z * 0.4, 0.25, 0.42, { watch: 1, desc: 'Hegemony ships carry a chaplain, and the chaplain reports upward.' });
    return out;
}

const TYPICAL = [0, 0, 7, 11, 17, 23, 29]; // how long an ordinary compartment is, in metres
// Filler compartments: [name, kind, system, description, level in the ship, how many at most (0 = any number)].
const FILL = {
    military: [['Crew Berthing', 'crew', 'quarters', 'Racks three high, lockers, and a queue for the showers.', 0.45, 0], ['Stores', 'hold', null, 'Spares, rations and everything else, lashed down.', 0.85, 0],
        ['Damage Control Station', 'engineering', null, 'Hoses, patches, breathing sets and a party that drills with them daily.', 0.5, 6], ['Auxiliary Machinery', 'engineering', null, 'Pumps, compressors and generators.', 0.75, 10],
        ['Heads and Showers', 'crew', null, 'Never enough of them.', 0.45, 10], ['Ordnance Handling', 'weapons', null, 'Hoists and rails that feed the guns from the magazine.', 0.8, 4], ['Fuel Bunkers', 'hold', null, 'Reaction mass.', 0.92, 0],
        ['Coolant Plant', 'engineering', null, 'Heat goes here before it goes overboard.', 0.7, 3], ['Briefing Room', 'command', null, 'A table, a display and bad news.', 0.1, 2], ['Workshops', 'engineering', null, 'Benches and machine tools.', 0.7, 3],
        ['Water Recycling', 'service', null, 'Best not to think about it.', 0.62, 2], ['Cold Stores', 'hold', null, 'Frozen provisions.', 0.82, 3], ['Training Simulators', 'crew', null, 'Where mistakes are free.', 0.3, 2],
        ['Signals Office', 'command', null, 'Codes, comms and the people cleared to read them.', 0.05, 1], ['Gymnasium', 'crew', null, 'Mandatory, in theory.', 0.45, 1], ['Laundry', 'service', null, 'Steam and noise.', 0.58, 1]],
    civilian: [['Passenger Cabins', 'public', null, 'Cabins for people who paid to be somewhere else.', 0.3, 0], ['Stores', 'hold', null, 'Provisions and spares.', 0.85, 0], ['Crew Cabins', 'crew', 'quarters', 'Small, but a door that shuts.', 0.6, 0],
        ['Lounge', 'public', null, 'Soft chairs and a view.', 0.2, 4], ['Baggage Hold', 'hold', null, 'Other people\'s luggage.', 0.9, 4], ['Auxiliary Machinery', 'engineering', null, 'Pumps, compressors and generators.', 0.8, 6],
        ['Dining Room', 'public', null, 'Three sittings a day.', 0.35, 3], ['Observation Lounge', 'public', null, 'Stars, through very thick glass.', 0.05, 2], ['Shops', 'public', null, 'Duty free.', 0.4, 4],
        ['Water Recycling', 'service', null, 'Best not to think about it.', 0.7, 2], ['Theatre', 'public', null, 'Tonight and every night.', 0.4, 1], ['Spa', 'public', null, 'Included in first class.', 0.25, 1]],
    industrial: [['Cargo Bay', 'hold', 'cargo', 'Containers stacked to the deckhead.', 0.6, 0], ['Tankage', 'hold', null, 'Bulk liquids.', 0.9, 0], ['Stores', 'hold', null, 'Spares and provisions.', 0.5, 6],
        ['Auxiliary Machinery', 'engineering', null, 'Pumps, compressors and generators.', 0.75, 8], ['Crane Gallery', 'hold', null, 'Gantry cranes and the people who drive them.', 0.3, 4], ['Workshops', 'engineering', null, 'Benches and machine tools.', 0.65, 3],
        ['Crew Cabins', 'crew', 'quarters', 'Small, but a door that shuts.', 0.15, 4], ['Cargo Office', 'service', null, 'Manifests, seals and arguments.', 0.2, 1]],
};

const cache = new Map();

/** The deck plan of a hull class: decks top to bottom, each with rooms placed in metres from the bow. */
export function deckPlan(cls) {
    if (!cls || cls.size < 2) return null;
    const key = `${cls.id}:${cls.medbay ? 1 : 0}${cls.mechBay ? 1 : 0}${cls.mounts.length}`;
    if (cache.has(key)) return cache.get(key);
    const z = cls.size;
    const L = SIZES[z].length, B = beamOf(cls);
    const n = z === 2 && cls.crew <= 3 ? 1 : DECKS[z];
    const rows = z >= 4 ? 2 : 1;
    const rooms = roomsFor(cls);
    // Heavy turrets sit on armored barbettes that run down through the upper decks.
    const heavy = cls.mounts.filter(mt => SC_WEAPONS[mt.id].size >= 4 && !SC_WEAPONS[mt.id].fixed);
    heavy.slice(0, 10).forEach((mt, i) => rooms.push({ id: `barbette${i + 1}`, name: `No. ${i + 1} Turret Barbette`, kind: 'weapons', w: 2 + z * 0.4, lvl: 0.12 + 0.1 * (i % 3), pos: 0.15 + 0.7 * (i / Math.max(1, heavy.length - 1 || 1)), sys: null, watch: 6, wide: false, desc: `The ${SC_WEAPONS[mt.id].name.toLowerCase()} mount, its hoists and its crew.` }));
    // Upper and lower decks are shorter: the hull tapers.
    const frac = Array.from({ length: n }, (_, i) => (n === 1 ? 1 : 1 - 0.3 * Math.abs(i - (n - 1) * 0.55) / ((n - 1) * 0.55)));
    // A hull has far more compartments than the ones a battle cares about. Fill it to scale.
    const want = Math.round(frac.reduce((a, f) => a + L * f, 0) / TYPICAL[z] * rows * 0.9);
    const pool = FILL[cls.family === 'strike' ? 'military' : cls.family] ?? FILL.military;
    const seen = {};
    for (let i = 0, added = 0; rooms.length < want && i < 2000; i++) {
        const [name, kind, sys, desc, lvl, max] = pool[i % pool.length];
        if (max && (seen[name] ?? 0) >= max) continue;
        seen[name] = (seen[name] ?? 0) + 1;
        added++;
        rooms.push({ id: `x${added}`, name: `${name} ${seen[name]}`, kind, w: 1.6 + z * 0.35, lvl: Math.max(0.02, Math.min(0.98, lvl + (((added * 0.37) % 1) - 0.5) * 0.3)), pos: ((added * 0.61) % 1) * 0.8 + 0.1, sys, watch: 0, wide: false, desc });
    }
    for (const r of rooms) if (/ 1$/.test(r.name) && !rooms.some(o => o.name === r.name.replace(/ 1$/, ' 2'))) r.name = r.name.replace(/ 1$/, '');
    rooms.sort((a, b) => a.lvl - b.lvl);
    const total = rooms.reduce((sum, r) => sum + r.w * (r.wide && rows === 2 ? 1.6 : 1), 0);
    const cap = frac.map(f => total * f / frac.reduce((a, c) => a + c, 0));
    const decks = frac.map((f, i) => ({ n: i + 1, len: Math.round(L * f), x0: Math.round(L * (1 - f) * 0.45), rooms: [], w: 0 }));
    let d = 0;
    for (const r of rooms) {
        const w = r.w * (r.wide && rows === 2 ? 1.6 : 1);
        while (d < n - 1 && decks[d].w + w * 0.5 > cap[d]) d++;
        decks[d].rooms.push(r); decks[d].w += w;
    }
    for (const deck of decks) {
        // Bow to stern. A wide compartment spans the beam; between them, port and starboard rows are packed separately.
        const list = deck.rooms.sort((a, b) => a.pos - b.pos);
        const segs = [];
        let cur = null;
        for (const r of list) {
            if (r.wide || rows === 1) { segs.push({ wide: r, w: r.w * (rows === 2 ? 0.8 : 1) }); cur = null; continue; }
            if (!cur) { cur = { rows: [[], []], sum: [0, 0], w: 0 }; segs.push(cur); }
            const k = cur.sum[0] <= cur.sum[1] ? 0 : 1;
            cur.rows[k].push(r); cur.sum[k] += r.w; cur.w = Math.max(cur.sum[0], cur.sum[1]);
        }
        const sum = segs.reduce((a, g) => a + g.w, 0) || 1;
        let x = deck.x0;
        const placed = [];
        const put = (r, at, len, y, h) => placed.push({ ...r, deck: deck.n, x: Math.round(at * 10) / 10, len: Math.round(len * 10) / 10, y, h });
        for (const g of segs) {
            const len = deck.len * g.w / sum;
            if (g.wide) put(g.wide, x, len, 0, 1);
            else g.rows.forEach((row, k) => {
                if (!row.length) return;
                const lone = !g.rows[1 - k].length;
                let at = x;
                for (const r of row) { const l = len * r.w / g.sum[k]; put(r, at, l, lone ? 0 : k * 0.5, lone ? 1 : 0.5); at += l; }
            });
            x += len;
        }
        deck.rooms = placed;
        const kinds = {};
        for (const r of deck.rooms) kinds[r.kind] = (kinds[r.kind] ?? 0) + r.len * r.h;
        const top = Object.entries(kinds).sort((a, c) => c[1] - a[1])[0]?.[0];
        deck.name = deck.rooms.some(r => r.id === 'bridge') ? 'Command deck' : { command: 'Command deck', weapons: 'Gun deck', engineering: 'Engineering deck', crew: 'Crew deck', medical: 'Medical deck', flight: 'Flight deck', hold: 'Hold deck', service: 'Service deck', public: 'Main deck' }[top] ?? 'Deck';
        delete deck.w;
    }
    const plan = { cls: cls.id, length: L, beam: B, decks: decks.filter(k => k.rooms.length), rooms: [] };
    plan.decks.forEach((k, i) => { k.n = i + 1; for (const r of k.rooms) r.deck = k.n; });
    plan.rooms = plan.decks.flatMap(k => k.rooms);
    cache.set(key, plan);
    return plan;
}

/** The compartment where each post does its work. */
export function stationRoom(plan, role) {
    const want = { gunnery: ['cic', 'bridge'], engineering: ['reactor', 'drives'], crew: [], passenger: [] }[role] ?? ['bridge'];
    return want.map(id => plan.rooms.find(r => r.id === id)).find(Boolean) ?? null;
}
