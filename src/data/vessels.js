// Ship combat data: size classes, hull classes, ship weapons, rooms and stations.
// Distances are kilometres on the tactical plot. One pulse is 30 seconds.

export const PULSE_SECONDS = 30;

/**
 * Size classes. Everything that makes a capital ship feel vastly bigger than a fighter lives here:
 * the base time in seconds each station needs to carry out an order (before the officer's skill
 * is counted), how fast it turns, how loud it is on sensors, how many
 * damage control teams it carries.
 */
export const SIZES = {
    1: { id: 1, name: 'Strike craft', length: 18, delay: { helm: 0, weapons: 0, sensors: 0, engineering: 0 }, turn: 180, accel: 1, sig: 0.3, evasion: 45, dcTeams: 0, draw: 7 },
    2: { id: 2, name: 'Corvette', length: 60, delay: { helm: 8, weapons: 10, sensors: 0, engineering: 8 }, turn: 90, accel: 0.6, sig: 0.6, evasion: 24, dcTeams: 1, draw: 10 },
    3: { id: 3, name: 'Frigate', length: 120, delay: { helm: 30, weapons: 25, sensors: 5, engineering: 15 }, turn: 60, accel: 0.4, sig: 1, evasion: 14, dcTeams: 2, draw: 13 },
    4: { id: 4, name: 'Destroyer', length: 200, delay: { helm: 60, weapons: 40, sensors: 8, engineering: 25 }, turn: 40, accel: 0.3, sig: 1.3, evasion: 8, dcTeams: 3, draw: 16 },
    5: { id: 5, name: 'Cruiser', length: 320, delay: { helm: 120, weapons: 60, sensors: 12, engineering: 40 }, turn: 25, accel: 0.2, sig: 1.7, evasion: 4, dcTeams: 4, draw: 20 },
    6: { id: 6, name: 'Capital ship', length: 500, delay: { helm: 240, weapons: 90, sensors: 15, engineering: 60 }, turn: 12, accel: 0.1, sig: 2.3, evasion: 0, dcTeams: 6, draw: 26 },
};

/**
 * Weapons. kind: kinetic | beam | plasma | missile | pd | pod | drone | decoy | mine | sweeper | grapple | sand.
 * range km, dmg per hit, shots per pulse, pen vs armor, heat per pulse fired, track = how well
 * it follows small fast targets (added to hit chance against sizes 1-2, capital guns are poor at it).
 */
export const SC_WEAPONS = {
    autocannon: { id: 'autocannon', name: 'Autocannon', kind: 'kinetic', size: 1, range: 160, dmg: 14, shots: 4, pen: 2, acc: 62, track: 15, heat: 1, ammo: 40 },
    pulse: { id: 'pulse', name: 'Pulse Laser', kind: 'beam', size: 1, range: 220, dmg: 20, shots: 2, pen: 2, acc: 72, track: 12, heat: 7 },
    rail: { id: 'rail', name: 'Railgun', kind: 'kinetic', size: 2, range: 650, dmg: 95, shots: 1, pen: 6, acc: 60, track: -5, heat: 3, ammo: 24 },
    lance: { id: 'lance', name: 'Beam Lance', kind: 'beam', size: 3, range: 380, dmg: 170, shots: 1, pen: 7, acc: 70, track: -5, heat: 16 },
    heavyrail: { id: 'heavyrail', name: 'Heavy Rail Battery', kind: 'kinetic', size: 4, range: 1300, dmg: 420, shots: 1, pen: 10, acc: 55, track: -25, heat: 6, ammo: 30 },
    heavybeam: { id: 'heavybeam', name: 'Siege Beam', kind: 'beam', size: 5, range: 700, dmg: 600, shots: 1, pen: 11, acc: 66, track: -30, heat: 30 },
    lightspinal: { id: 'lightspinal', name: 'Spinal Railgun', kind: 'kinetic', size: 3, range: 1800, dmg: 950, shots: 1, pen: 13, acc: 52, track: -40, heat: 10, ammo: 10, cycle: 4, fixed: true },
    spinal: { id: 'spinal', name: 'Spinal Mass Driver', kind: 'kinetic', size: 6, range: 2400, dmg: 2600, shots: 1, pen: 16, acc: 50, track: -45, heat: 14, ammo: 12, cycle: 5, fixed: true },
    mininglaser: { id: 'mininglaser', name: 'Mining Laser', kind: 'beam', size: 2, range: 120, dmg: 120, shots: 1, pen: 5, acc: 48, track: -15, heat: 15, improvised: true },
    plasma: { id: 'plasma', name: 'Plasma Projector', kind: 'plasma', size: 4, range: 450, dmg: 1100, shots: 1, pen: 9, acc: 62, track: -35, heat: 30, cycle: 2, slow: true, shieldMult: 1.6, rare: true },
    dronebay: { id: 'dronebay', name: 'Drone Launcher', kind: 'drone', size: 2, range: 2000, ammo: 3, spawn: 'drone' },
    mines: { id: 'mines', name: 'Mine Dispenser', kind: 'mine', size: 2, range: 0, ammo: 8, dmg: 750, pen: 8, trigger: 90 },
    harpoon: { id: 'harpoon', name: 'Grapple Harpoon', kind: 'grapple', size: 2, range: 90, acc: 58, track: 0, ammo: 4, cycle: 2, hold: 5 },
    sandcaster: { id: 'sandcaster', name: 'Sandcaster', kind: 'sand', size: 1, range: 0, ammo: 5 },
    decoydrone: { id: 'decoydrone', name: 'Decoy Drone Rack', kind: 'decoy', size: 2, range: 0, ammo: 2, spawn: 'decoyship' },
    particle: { id: 'particle', name: 'Particle Beam', kind: 'beam', size: 4, range: 520, dmg: 380, shots: 1, pen: 8, acc: 64, track: -25, heat: 28, bleed: 0.5, rad: true, rare: true },
    nuke: { id: 'nuke', name: 'Nuclear Torpedo', kind: 'missile', size: 3, range: 2400, dmg: 6500, pen: 14, speed: 280, salvo: 1, ammo: 2, hp: 5, nuclear: true, blast: 130, emp: 450 },
    sweeper: { id: 'sweeper', name: 'Counter-mine Suite', kind: 'sweeper', size: 2, range: 320, detect: 700 },
    missile: { id: 'missile', name: 'Light Missile Rails', kind: 'missile', size: 1, range: 1400, dmg: 130, pen: 4, speed: 380, salvo: 2, ammo: 4, hp: 1 },
    asm: { id: 'asm', name: 'Anti-ship Missile Cell', kind: 'missile', size: 2, range: 2800, dmg: 480, pen: 7, speed: 300, salvo: 2, ammo: 8, hp: 1 },
    torpedo: { id: 'torpedo', name: 'Torpedo Tube', kind: 'missile', size: 1, range: 1800, dmg: 1700, pen: 11, speed: 170, salvo: 1, ammo: 2, hp: 2 },
    pod: { id: 'pod', name: 'Boarding Pod', kind: 'pod', size: 2, range: 260, speed: 130, hp: 2, dmg: 0, pen: 0 },
    pd: { id: 'pd', name: 'Point Defence Turret', kind: 'pd', size: 1, range: 60, intercept: 0.45, shots: 2, heat: 1, dmg: 8, pen: 1, acc: 55, track: 25 },
    flak: { id: 'flak', name: 'Flak Battery', kind: 'pd', size: 3, range: 110, intercept: 0.5, shots: 4, heat: 2, dmg: 16, pen: 2, acc: 50, track: 20 },
    blade: { id: 'blade', name: 'Heat Blade', kind: 'beam', size: 1, range: 12, dmg: 260, shots: 1, pen: 9, acc: 80, track: 20, heat: 10, melee: true },
};

/** Firing arcs as [centre, half-width] in degrees relative to the bow. */
export const ARCS = { F: [[0, 50]], B: [[90, 65], [270, 65]], A: [[180, 50]], T: [[0, 180]], S: [[0, 12]] };
export const ARC_NAMES = { F: 'bow', B: 'broadside', A: 'stern', T: 'turret', S: 'spinal, fixed forward' };

/**
 * Shell types for kinetic guns. AP is the default. HE trades penetration for blast: more damage
 * to what it reaches, more fires. Flak is only made for small calibres: useless against armor,
 * deadly to strike craft, and it lets the gun help against missiles.
 */
export const LOADS = {
    ap: { id: 'ap', name: 'AP', full: 'Armor-piercing', pen: 0, dmg: 1, room: 1, fire: 1, shield: 0.75 },
    he: { id: 'he', name: 'HE', full: 'High explosive', pen: -3, dmg: 1.4, room: 1.6, fire: 2.2, shield: 1 },
    flak: { id: 'flak', name: 'Flak', full: 'Flak', pen: -4, dmg: 0.5, room: 0.5, fire: 0.5, shield: 0.6, craft: 25, intercept: 0.3, maxSize: 2 },
};
export const loadsFor = (def) => (def.kind === 'kinetic' && !def.fixed ? Object.values(LOADS).filter(l => !l.maxSize || def.size <= l.maxSize) : []);

/** Rough mass by size class, for ramming. */
export const MASS = [0, 4, 60, 320, 900, 2200, 5200];

/** Compartments. vital ones change how the ship fights when they are damaged. */
export const ROOMS = {
    bridge: { id: 'bridge', name: 'Bridge', share: 0.07, station: ['captain', 'commander', 'helm', 'sensors'] },
    cockpit: { id: 'cockpit', name: 'Cockpit', share: 0.2, station: ['pilot'] },
    cic: { id: 'cic', name: 'Gunnery Control', share: 0.06, station: ['gunnery'] },
    reactor: { id: 'reactor', name: 'Reactor', share: 0.12, station: ['engineering'] },
    drives: { id: 'drives', name: 'Main Drives', share: 0.14 },
    sensors: { id: 'sensors', name: 'Sensor Array', share: 0.06 },
    magazine: { id: 'magazine', name: 'Magazine', share: 0.08 },
    shields: { id: 'shields', name: 'Shield Emitters', share: 0.07 },
    lifesupport: { id: 'lifesupport', name: 'Life Support', share: 0.06 },
    quarters: { id: 'quarters', name: 'Crew Decks', share: 0.1, station: ['crew', 'passenger'] },
    hangar: { id: 'hangar', name: 'Hangar', share: 0.1 },
    cargo: { id: 'cargo', name: 'Cargo Hold', share: 0.12 },
    jump: { id: 'jump', name: 'Jump Drive', share: 0.07 },
};
const SMALL_ROOMS = ['cockpit', 'reactor', 'drives', 'sensors'];
const SHIP_ROOMS = ['bridge', 'reactor', 'drives', 'sensors', 'magazine', 'shields', 'lifesupport', 'quarters', 'cargo', 'jump'];
const WAR_ROOMS = ['bridge', 'cic', 'reactor', 'drives', 'sensors', 'magazine', 'shields', 'lifesupport', 'quarters', 'jump'];

const m = (id, arc = 'T', n = 1) => Array.from({ length: n }, () => ({ id, arc }));

/**
 * Hull classes. armor is [bow, flank, stern]. speed is km per pulse at full burn.
 * doctrine steers the AI: brawl closes in, standoff keeps its distance, strike makes passes,
 * screen shoots down missiles and small craft, civilian runs.
 */
export const VESSELS = {
    // Strike craft and mechs
    kestrel: { id: 'kestrel', name: 'F-22 Kestrel', role: 'Interceptor', size: 1, hull: 90, armor: [2, 1, 1], shield: 60, speed: 240, sensors: 1500, crew: 1, heat: 60, rooms: SMALL_ROOMS, mounts: [...m('pulse', 'F', 2), ...m('missile', 'F')], decoys: 2, doctrine: 'strike', pods: true },
    harrier: { id: 'harrier', name: 'A-9 Harrow', role: 'Strike craft', size: 1, hull: 130, armor: [3, 2, 1], shield: 70, speed: 190, sensors: 1300, crew: 2, heat: 60, rooms: SMALL_ROOMS, mounts: [...m('autocannon', 'F'), ...m('torpedo', 'F')], decoys: 2, doctrine: 'strike', pods: true },
    halberd: { id: 'halberd', name: 'MF-7 Halberd', role: 'Line combat frame', size: 1, mech: true, agile: 1.5, minSkill: 5, price: 2400000, hull: 280, armor: [5, 4, 3], shield: 90, speed: 170, sensors: 1300, crew: 1, heat: 80, rooms: SMALL_ROOMS, mounts: [...m('pulse', 'T'), ...m('rail', 'F'), ...m('blade', 'T')], decoys: 1, doctrine: 'brawl', pods: true },
    lynx: { id: 'lynx', name: 'LX-2 Lynx', role: 'Scout frame', size: 1, mech: true, agile: 1.7, minSkill: 5, price: 1700000, hull: 190, armor: [3, 3, 2], shield: 70, speed: 220, sensors: 2000, crew: 1, heat: 70, rooms: SMALL_ROOMS, mounts: [...m('autocannon', 'T')], decoys: 2, jammer: true, doctrine: 'strike', pods: true },
    drone: { id: 'drone', name: 'Combat Drone', role: 'Drone', size: 1, hull: 60, armor: [1, 1, 1], shield: 30, speed: 230, sensors: 1200, crew: 0, heat: 50, rooms: ['reactor', 'drives', 'sensors'], mounts: [...m('pulse', 'F')], doctrine: 'strike', machine: true },
    decoyship: { id: 'decoyship', name: 'Decoy Drone', role: 'Decoy drone', size: 1, hull: 25, armor: [1, 1, 1], shield: 0, speed: 150, sensors: 0, crew: 0, heat: 50, rooms: ['reactor', 'drives'], mounts: [], doctrine: 'decoy', machine: true, decoy: true },
    // Civilian and light hulls
    sparrow: { id: 'sparrow', name: 'Sparrow-class Courier', role: 'Courier', size: 2, hull: 260, armor: [2, 2, 1], shield: 120, speed: 150, sensors: 1400, crew: 2, heat: 80, rooms: SHIP_ROOMS, mounts: [...m('pulse', 'T')], decoys: 2, doctrine: 'civilian', pods: true, warp: true },
    mule: { id: 'mule', name: 'Mule-class Light Freighter', role: 'Light Freighter', size: 2, hull: 480, armor: [3, 3, 2], shield: 160, speed: 95, sensors: 1200, crew: 4, heat: 90, rooms: SHIP_ROOMS, mounts: [...m('pulse', 'T'), ...m('pd', 'T')], decoys: 2, doctrine: 'civilian', pods: true, warp: true },
    pathfinder: { id: 'pathfinder', name: 'Pathfinder-class Explorer', role: 'Explorer', size: 2, hull: 380, armor: [3, 2, 2], shield: 180, speed: 120, sensors: 2600, crew: 4, heat: 90, rooms: SHIP_ROOMS, mounts: [...m('pulse', 'T'), ...m('pd', 'T')], decoys: 3, jammer: true, doctrine: 'civilian', pods: true, warp: true },
    atlas: { id: 'atlas', name: 'Atlas-class Bulk Hauler', role: 'Heavy Freighter', size: 4, hull: 2200, armor: [4, 3, 2], shield: 260, speed: 55, sensors: 1300, crew: 8, heat: 120, rooms: SHIP_ROOMS, mounts: [...m('autocannon', 'T', 2), ...m('sandcaster', 'T'), ...m('pd', 'T', 2)], decoys: 2, doctrine: 'civilian', pods: true, warp: true },
    liner: { id: 'liner', name: 'Passenger Transport', role: 'Transport', size: 3, hull: 1100, armor: [3, 3, 2], shield: 220, speed: 80, sensors: 1500, crew: 20, heat: 100, rooms: SHIP_ROOMS, mounts: [...m('pd', 'T', 2)], decoys: 2, doctrine: 'civilian', pods: true, warp: true },
    // Warships
    raider: { id: 'raider', name: 'Ashen Raider', role: 'Pirate corvette', size: 2, hull: 340, armor: [3, 2, 2], shield: 110, speed: 140, sensors: 1300, crew: 6, heat: 90, rooms: WAR_ROOMS, mounts: [...m('autocannon', 'T', 2), ...m('pulse', 'F'), ...m('harpoon', 'F')], decoys: 1, doctrine: 'brawl', pods: true, warp: true, pirate: true },
    gunboat: { id: 'gunboat', name: 'Corsair Gunboat', role: 'Gunboat', size: 2, hull: 460, armor: [4, 3, 2], shield: 150, speed: 115, sensors: 1400, crew: 8, heat: 100, rooms: WAR_ROOMS, mounts: [...m('lightspinal', 'S'), ...m('autocannon', 'T', 2)], decoys: 1, doctrine: 'standoff', pods: true, warp: true, pirate: true },
    ramship: { id: 'ramship', name: 'Corsair Ram', role: 'Ram corvette', size: 2, hull: 640, armor: [9, 3, 2], shield: 120, speed: 175, sensors: 1200, crew: 12, heat: 100, rooms: WAR_ROOMS, mounts: [...m('autocannon', 'T', 2), ...m('harpoon', 'F')], decoys: 1, doctrine: 'ram', ram: true, pods: true, warp: true, pirate: true },
    fireship: { id: 'fireship', name: 'Tramp Freighter', role: 'Fire ship', size: 2, hull: 420, armor: [3, 3, 2], shield: 0, speed: 125, sensors: 900, crew: 0, heat: 90, rooms: ['bridge', 'reactor', 'drives', 'cargo'], mounts: [], doctrine: 'ram', machine: true, fireship: { dmg: 2600, pen: 10, blast: 90 }, disguise: 'Light Freighter', pirate: true },
    barge: { id: 'barge', name: 'Mining Barge', role: 'Mining barge', size: 3, hull: 1500, armor: [5, 4, 3], shield: 180, speed: 60, sensors: 1300, crew: 14, heat: 160, rooms: SHIP_ROOMS, mounts: [...m('mininglaser', 'F', 2), ...m('pd', 'T')], decoys: 1, doctrine: 'civilian', pods: true, warp: true },
    minelayer: { id: 'minelayer', name: 'Thorn-class Minelayer', role: 'Minelayer', size: 3, hull: 1000, armor: [5, 4, 3], shield: 300, speed: 100, sensors: 2200, crew: 35, heat: 130, rooms: WAR_ROOMS, mounts: [...m('mines', 'A', 2), ...m('sweeper', 'T'), ...m('rail', 'T'), ...m('pd', 'T', 2)], decoys: 3, doctrine: 'standoff', pods: true, warp: true },
    lancer: { id: 'lancer', name: 'Lancer-class Corvette', role: 'Corvette', size: 2, hull: 440, armor: [4, 3, 2], shield: 220, speed: 135, sensors: 1700, crew: 5, heat: 100, rooms: WAR_ROOMS, mounts: [...m('rail', 'F'), ...m('pulse', 'T'), ...m('asm', 'T'), ...m('pd', 'T')], decoys: 3, doctrine: 'standoff', pods: true, warp: true },
    patrol: { id: 'patrol', name: 'Patrol Cutter', role: 'Cutter', size: 2, hull: 480, armor: [4, 4, 2], shield: 240, speed: 130, sensors: 2000, crew: 10, heat: 100, rooms: WAR_ROOMS, mounts: [...m('rail', 'T'), ...m('pulse', 'T'), ...m('sandcaster', 'T'), ...m('pd', 'T')], decoys: 3, doctrine: 'standoff', pods: true, warp: true, lawful: true },
    warden: { id: 'warden', name: 'Warden-class Frigate', role: 'Frigate', size: 3, hull: 1300, armor: [6, 5, 3], shield: 420, speed: 95, sensors: 2300, crew: 40, heat: 140, rooms: WAR_ROOMS, mounts: [...m('rail', 'T', 2), ...m('asm', 'T'), ...m('pulse', 'T', 2), ...m('decoydrone', 'T'), ...m('pd', 'T', 2)], decoys: 4, jammer: true, doctrine: 'standoff', pods: true, warp: true },
    frigate: { id: 'frigate', name: 'Pirate Frigate', role: 'Frigate', size: 3, hull: 1150, armor: [5, 4, 3], shield: 320, speed: 90, sensors: 1900, crew: 45, heat: 130, rooms: WAR_ROOMS, mounts: [...m('rail', 'T'), ...m('lance', 'F'), ...m('asm', 'T'), ...m('autocannon', 'T', 2), ...m('pd', 'T')], decoys: 3, doctrine: 'brawl', pods: true, warp: true, pirate: true },
    destroyer: { id: 'destroyer', name: 'Halberd-class Destroyer', role: 'Destroyer', size: 4, hull: 2900, armor: [7, 6, 4], shield: 700, speed: 85, sensors: 2800, crew: 120, heat: 180, rooms: [...WAR_ROOMS, 'hangar'], mounts: [...m('heavyrail', 'T'), ...m('rail', 'T', 2), ...m('asm', 'T', 2), ...m('lance', 'B', 2), ...m('sandcaster', 'T'), ...m('decoydrone', 'T'), ...m('flak', 'T'), ...m('pd', 'T', 3)], decoys: 6, jammer: true, doctrine: 'standoff', pods: true, warp: true },
    cruiser: { id: 'cruiser', name: 'Bastion-class Cruiser', role: 'Cruiser', size: 5, hull: 6800, armor: [9, 8, 5], shield: 1500, speed: 60, sensors: 3200, crew: 420, heat: 260, rooms: [...WAR_ROOMS, 'hangar'], mounts: [...m('heavyrail', 'T', 3), ...m('heavybeam', 'B', 2), ...m('rail', 'T', 4), ...m('asm', 'T', 4), ...m('particle', 'T'), ...m('sandcaster', 'T', 2), ...m('decoydrone', 'T'), ...m('flak', 'T', 3), ...m('pd', 'T', 6)], decoys: 8, jammer: true, doctrine: 'standoff', pods: true, warp: true },
    carrier: { id: 'carrier', name: 'Aegir-class Carrier', role: 'Carrier', size: 5, hull: 6000, armor: [7, 6, 4], shield: 1400, speed: 55, sensors: 3600, crew: 600, heat: 240, rooms: [...WAR_ROOMS, 'hangar'], mounts: [...m('rail', 'T', 4), ...m('asm', 'T', 3), ...m('dronebay', 'T', 2), ...m('decoydrone', 'T', 2), ...m('sandcaster', 'T', 2), ...m('flak', 'T', 4), ...m('pd', 'T', 8)], decoys: 8, jammer: true, doctrine: 'screen', pods: true, warp: true, wing: ['kestrel', 'kestrel', 'harrier', 'harrier'] },
    dreadnought: { id: 'dreadnought', name: 'Sovereign-class Dreadnought', role: 'Capital ship', size: 6, hull: 18000, armor: [12, 10, 6], shield: 3600, speed: 38, sensors: 3800, crew: 1800, heat: 400, rooms: [...WAR_ROOMS, 'hangar'], mounts: [...m('spinal', 'S'), ...m('plasma', 'F', 2), ...m('heavyrail', 'T', 6), ...m('heavybeam', 'B', 4), ...m('rail', 'T', 8), ...m('asm', 'T', 8), ...m('nuke', 'F'), ...m('particle', 'B', 2), ...m('sandcaster', 'T', 3), ...m('decoydrone', 'T', 2), ...m('flak', 'T', 6), ...m('pd', 'T', 12)], decoys: 12, jammer: true, doctrine: 'standoff', pods: true, warp: true },
    station: { id: 'station', name: 'Defence Platform', role: 'Platform', size: 4, hull: 3200, armor: [7, 7, 7], shield: 900, speed: 0, sensors: 3000, crew: 60, heat: 200, rooms: ['cic', 'reactor', 'sensors', 'magazine', 'shields', 'lifesupport', 'quarters'], mounts: [...m('heavyrail', 'T', 2), ...m('asm', 'T', 2), ...m('flak', 'T', 2), ...m('pd', 'T', 4)], decoys: 4, doctrine: 'hold' },
};

/** Words the AI may use that map onto a hull class. */
export const VESSEL_ALIASES = {
    fighter: 'kestrel', interceptor: 'kestrel', bomber: 'harrier', strike: 'harrier', mech: 'halberd', scout: 'lynx',
    pirate: 'raider', corvette: 'lancer', cutter: 'patrol', freighter: 'mule', hauler: 'atlas', courier: 'sparrow', transport: 'liner',
    ram: 'ramship', fireship: 'fireship', brander: 'fireship', miner: 'barge', mining: 'barge', minelayer: 'minelayer',
    capital: 'dreadnought', battleship: 'dreadnought', platform: 'station', turret: 'station',
};

/** Stations a character can hold aboard, and what each may touch during a battle. */
export const POSTS = {
    captain: { id: 'captain', name: 'Captain', clearance: 3, can: ['helm', 'weapons', 'engineering', 'sensors', 'command'] },
    commander: { id: 'commander', name: 'Strike Force Commander', clearance: 4, can: ['helm', 'weapons', 'engineering', 'sensors', 'command', 'fleet'] },
    xo: { id: 'xo', name: 'Executive Officer', clearance: 3, can: ['engineering', 'sensors', 'command'] },
    pilot: { id: 'pilot', name: 'Pilot', clearance: 3, can: ['helm', 'weapons', 'engineering', 'sensors', 'command'] },
    helm: { id: 'helm', name: 'Helm Officer', clearance: 2, can: ['helm'] },
    gunnery: { id: 'gunnery', name: 'Gunnery Officer', clearance: 2, can: ['weapons'] },
    engineering: { id: 'engineering', name: 'Engineering Officer', clearance: 2, can: ['engineering'] },
    sensors: { id: 'sensors', name: 'Sensor Officer', clearance: 2, can: ['sensors'] },
    crew: { id: 'crew', name: 'Crew', clearance: 1, can: [] },
    passenger: { id: 'passenger', name: 'Passenger', clearance: 0, can: [] },
};

export const THROTTLES = [
    { id: 0, name: 'All stop', f: 0 },
    { id: 1, name: 'One third', f: 0.34 },
    { id: 2, name: 'Two thirds', f: 0.67 },
    { id: 3, name: 'Full', f: 1 },
    { id: 4, name: 'Flank', f: 1.3 },
];

export const POWER_PRESETS = {
    balanced: { name: 'Balanced', eng: 1, shd: 1, wpn: 1 },
    attack: { name: 'Weapons', eng: 0.8, shd: 0.7, wpn: 1.4 },
    defence: { name: 'Shields', eng: 0.8, shd: 1.5, wpn: 0.7 },
    speed: { name: 'Engines', eng: 1.35, shd: 0.8, wpn: 0.75 },
};

export const TRACK_NAMES = ['No contact', 'Unknown contact', 'Classified', 'Firing solution'];

/**
 * Sensor grade, 1 to 4. Civilian sets throw ghost contacts and misread what they see;
 * military suites rarely do, and a capital ship's almost never.
 */
export function sensorGrade(cls) {
    if (cls.grade) return cls.grade;
    if (cls.size >= 5) return 4;
    if (cls.doctrine === 'civilian') return cls.sensors >= 2000 ? 2 : 1;
    if (cls.pirate) return 2;
    return 3;
}
export const GRADE_NAMES = ['', 'civilian', 'commercial', 'military', 'fleet-grade'];

/** Boarding pods carried. Pirates live off prizes; warships carry marines. Strike craft carry none. */
export function boardingPods(cls) {
    if (cls.size < 2 || cls.doctrine === 'civilian' || cls.machine || !cls.speed) return 0;
    if (cls.pirate) return cls.size >= 3 ? 3 : 1;
    return cls.size >= 3 ? cls.size - 2 : 0;
}
