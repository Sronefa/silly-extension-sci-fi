// Ship combat data: size classes, hull classes, ship weapons, rooms and stations.
// Distances are kilometres on the tactical plot. One pulse is 30 seconds.

export const PULSE_SECONDS = 30;

/**
 * Size classes. Everything that makes a capital ship feel vastly bigger than a fighter lives here:
 * how long the helm takes to answer, how fast it turns, how loud it is on sensors, how many
 * damage control teams it carries.
 */
export const SIZES = {
    1: { id: 1, name: 'Strike craft', length: 18, helmDelay: 0, fireDelay: 0, turn: 180, accel: 1, sig: 0.3, evasion: 45, dcTeams: 0, draw: 7 },
    2: { id: 2, name: 'Corvette', length: 70, helmDelay: 0, fireDelay: 0, turn: 90, accel: 0.6, sig: 0.6, evasion: 24, dcTeams: 1, draw: 10 },
    3: { id: 3, name: 'Frigate', length: 180, helmDelay: 1, fireDelay: 0, turn: 60, accel: 0.4, sig: 1, evasion: 14, dcTeams: 2, draw: 13 },
    4: { id: 4, name: 'Destroyer', length: 340, helmDelay: 2, fireDelay: 1, turn: 40, accel: 0.3, sig: 1.3, evasion: 8, dcTeams: 3, draw: 16 },
    5: { id: 5, name: 'Cruiser', length: 650, helmDelay: 4, fireDelay: 1, turn: 25, accel: 0.2, sig: 1.7, evasion: 4, dcTeams: 4, draw: 20 },
    6: { id: 6, name: 'Capital ship', length: 1600, helmDelay: 8, fireDelay: 2, turn: 12, accel: 0.1, sig: 2.3, evasion: 0, dcTeams: 6, draw: 26 },
};

/**
 * Weapons. kind: kinetic | beam | missile | pd.
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
    spinal: { id: 'spinal', name: 'Spinal Mass Driver', kind: 'kinetic', size: 6, range: 2200, dmg: 2400, shots: 1, pen: 14, acc: 50, track: -45, heat: 12, ammo: 12, cycle: 3 },
    missile: { id: 'missile', name: 'Light Missile Rails', kind: 'missile', size: 1, range: 1400, dmg: 130, pen: 4, speed: 380, salvo: 2, ammo: 4, hp: 1 },
    asm: { id: 'asm', name: 'Anti-ship Missile Cell', kind: 'missile', size: 2, range: 2800, dmg: 480, pen: 7, speed: 300, salvo: 2, ammo: 8, hp: 1 },
    torpedo: { id: 'torpedo', name: 'Torpedo Tube', kind: 'missile', size: 1, range: 1800, dmg: 1700, pen: 11, speed: 170, salvo: 1, ammo: 2, hp: 2 },
    pd: { id: 'pd', name: 'Point Defence Turret', kind: 'pd', size: 1, range: 60, intercept: 0.45, shots: 2, heat: 1, dmg: 8, pen: 1, acc: 55, track: 25 },
    flak: { id: 'flak', name: 'Flak Battery', kind: 'pd', size: 3, range: 110, intercept: 0.5, shots: 4, heat: 2, dmg: 16, pen: 2, acc: 50, track: 20 },
    blade: { id: 'blade', name: 'Heat Blade', kind: 'beam', size: 1, range: 12, dmg: 260, shots: 1, pen: 9, acc: 80, track: 20, heat: 10, melee: true },
};

/** Firing arcs as [centre, half-width] in degrees relative to the bow. */
export const ARCS = { F: [[0, 50]], B: [[90, 65], [270, 65]], A: [[180, 50]], T: [[0, 180]] };
export const ARC_NAMES = { F: 'bow', B: 'broadside', A: 'stern', T: 'turret' };

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
    halberd: { id: 'halberd', name: 'MF-7 Halberd', role: 'Line combat frame', size: 1, mech: true, hull: 170, armor: [4, 3, 2], shield: 40, speed: 150, sensors: 1300, crew: 1, heat: 80, rooms: SMALL_ROOMS, mounts: [...m('pulse', 'T'), ...m('rail', 'F'), ...m('blade', 'T')], decoys: 1, doctrine: 'brawl', pods: true },
    lynx: { id: 'lynx', name: 'LX-2 Lynx', role: 'Scout frame', size: 1, mech: true, hull: 110, armor: [2, 2, 1], shield: 30, speed: 200, sensors: 2000, crew: 1, heat: 70, rooms: SMALL_ROOMS, mounts: [...m('autocannon', 'T')], decoys: 2, jammer: true, doctrine: 'strike', pods: true },
    drone: { id: 'drone', name: 'Combat Drone', role: 'Drone', size: 1, hull: 60, armor: [1, 1, 1], shield: 30, speed: 230, sensors: 1200, crew: 0, heat: 50, rooms: ['reactor', 'drives', 'sensors'], mounts: [...m('pulse', 'F')], doctrine: 'strike', machine: true },
    // Civilian and light hulls
    sparrow: { id: 'sparrow', name: 'Sparrow-class Courier', role: 'Courier', size: 2, hull: 260, armor: [2, 2, 1], shield: 120, speed: 150, sensors: 1400, crew: 2, heat: 80, rooms: SHIP_ROOMS, mounts: [...m('pulse', 'T')], decoys: 2, doctrine: 'civilian', pods: true, warp: true },
    mule: { id: 'mule', name: 'Mule-class Light Freighter', role: 'Light Freighter', size: 2, hull: 480, armor: [3, 3, 2], shield: 160, speed: 95, sensors: 1200, crew: 4, heat: 90, rooms: SHIP_ROOMS, mounts: [...m('pulse', 'T'), ...m('pd', 'T')], decoys: 2, doctrine: 'civilian', pods: true, warp: true },
    pathfinder: { id: 'pathfinder', name: 'Pathfinder-class Explorer', role: 'Explorer', size: 2, hull: 380, armor: [3, 2, 2], shield: 180, speed: 120, sensors: 2600, crew: 4, heat: 90, rooms: SHIP_ROOMS, mounts: [...m('pulse', 'T'), ...m('pd', 'T')], decoys: 3, jammer: true, doctrine: 'civilian', pods: true, warp: true },
    atlas: { id: 'atlas', name: 'Atlas-class Bulk Hauler', role: 'Heavy Freighter', size: 4, hull: 2200, armor: [4, 3, 2], shield: 260, speed: 55, sensors: 1300, crew: 8, heat: 120, rooms: SHIP_ROOMS, mounts: [...m('autocannon', 'T', 2), ...m('pd', 'T', 2)], decoys: 2, doctrine: 'civilian', pods: true, warp: true },
    liner: { id: 'liner', name: 'Passenger Transport', role: 'Transport', size: 3, hull: 1100, armor: [3, 3, 2], shield: 220, speed: 80, sensors: 1500, crew: 20, heat: 100, rooms: SHIP_ROOMS, mounts: [...m('pd', 'T', 2)], decoys: 2, doctrine: 'civilian', pods: true, warp: true },
    // Warships
    raider: { id: 'raider', name: 'Ashen Raider', role: 'Pirate corvette', size: 2, hull: 340, armor: [3, 2, 2], shield: 110, speed: 140, sensors: 1300, crew: 6, heat: 90, rooms: WAR_ROOMS, mounts: [...m('autocannon', 'T', 2), ...m('pulse', 'F')], decoys: 1, doctrine: 'brawl', pods: true, warp: true, pirate: true },
    gunboat: { id: 'gunboat', name: 'Corsair Gunboat', role: 'Gunboat', size: 2, hull: 460, armor: [4, 3, 2], shield: 150, speed: 115, sensors: 1400, crew: 8, heat: 100, rooms: WAR_ROOMS, mounts: [...m('rail', 'F'), ...m('autocannon', 'T', 2)], decoys: 1, doctrine: 'brawl', pods: true, warp: true, pirate: true },
    lancer: { id: 'lancer', name: 'Lancer-class Corvette', role: 'Corvette', size: 2, hull: 440, armor: [4, 3, 2], shield: 220, speed: 135, sensors: 1700, crew: 5, heat: 100, rooms: WAR_ROOMS, mounts: [...m('rail', 'F'), ...m('pulse', 'T'), ...m('asm', 'T'), ...m('pd', 'T')], decoys: 3, doctrine: 'standoff', pods: true, warp: true },
    patrol: { id: 'patrol', name: 'Patrol Cutter', role: 'Cutter', size: 2, hull: 480, armor: [4, 4, 2], shield: 240, speed: 130, sensors: 2000, crew: 10, heat: 100, rooms: WAR_ROOMS, mounts: [...m('rail', 'T'), ...m('pulse', 'T'), ...m('pd', 'T')], decoys: 3, doctrine: 'standoff', pods: true, warp: true, lawful: true },
    warden: { id: 'warden', name: 'Warden-class Frigate', role: 'Frigate', size: 3, hull: 1300, armor: [6, 5, 3], shield: 420, speed: 95, sensors: 2300, crew: 40, heat: 140, rooms: WAR_ROOMS, mounts: [...m('rail', 'T', 2), ...m('asm', 'T'), ...m('pulse', 'T', 2), ...m('pd', 'T', 2)], decoys: 4, jammer: true, doctrine: 'standoff', pods: true, warp: true },
    frigate: { id: 'frigate', name: 'Pirate Frigate', role: 'Frigate', size: 3, hull: 1150, armor: [5, 4, 3], shield: 320, speed: 90, sensors: 1900, crew: 45, heat: 130, rooms: WAR_ROOMS, mounts: [...m('rail', 'T'), ...m('lance', 'F'), ...m('asm', 'T'), ...m('autocannon', 'T', 2), ...m('pd', 'T')], decoys: 3, doctrine: 'brawl', pods: true, warp: true, pirate: true },
    destroyer: { id: 'destroyer', name: 'Halberd-class Destroyer', role: 'Destroyer', size: 4, hull: 2900, armor: [7, 6, 4], shield: 700, speed: 85, sensors: 2800, crew: 120, heat: 180, rooms: [...WAR_ROOMS, 'hangar'], mounts: [...m('heavyrail', 'T'), ...m('rail', 'T', 2), ...m('asm', 'T', 2), ...m('lance', 'B', 2), ...m('flak', 'T'), ...m('pd', 'T', 3)], decoys: 6, jammer: true, doctrine: 'standoff', pods: true, warp: true },
    cruiser: { id: 'cruiser', name: 'Bastion-class Cruiser', role: 'Cruiser', size: 5, hull: 6800, armor: [9, 8, 5], shield: 1500, speed: 60, sensors: 3200, crew: 420, heat: 260, rooms: [...WAR_ROOMS, 'hangar'], mounts: [...m('heavyrail', 'T', 3), ...m('heavybeam', 'B', 2), ...m('rail', 'T', 4), ...m('asm', 'T', 4), ...m('flak', 'T', 3), ...m('pd', 'T', 6)], decoys: 8, jammer: true, doctrine: 'standoff', pods: true, warp: true },
    carrier: { id: 'carrier', name: 'Aegir-class Carrier', role: 'Carrier', size: 5, hull: 6000, armor: [7, 6, 4], shield: 1400, speed: 55, sensors: 3600, crew: 600, heat: 240, rooms: [...WAR_ROOMS, 'hangar'], mounts: [...m('rail', 'T', 4), ...m('asm', 'T', 3), ...m('flak', 'T', 4), ...m('pd', 'T', 8)], decoys: 8, jammer: true, doctrine: 'screen', pods: true, warp: true, wing: ['kestrel', 'kestrel', 'harrier', 'harrier'] },
    dreadnought: { id: 'dreadnought', name: 'Sovereign-class Dreadnought', role: 'Capital ship', size: 6, hull: 18000, armor: [12, 10, 6], shield: 3600, speed: 38, sensors: 3800, crew: 1800, heat: 400, rooms: [...WAR_ROOMS, 'hangar'], mounts: [...m('spinal', 'F'), ...m('heavyrail', 'T', 6), ...m('heavybeam', 'B', 4), ...m('rail', 'T', 8), ...m('asm', 'T', 8), ...m('flak', 'T', 6), ...m('pd', 'T', 12)], decoys: 12, jammer: true, doctrine: 'standoff', pods: true, warp: true },
    station: { id: 'station', name: 'Defence Platform', role: 'Platform', size: 4, hull: 3200, armor: [7, 7, 7], shield: 900, speed: 0, sensors: 3000, crew: 60, heat: 200, rooms: ['cic', 'reactor', 'sensors', 'magazine', 'shields', 'lifesupport', 'quarters'], mounts: [...m('heavyrail', 'T', 2), ...m('asm', 'T', 2), ...m('flak', 'T', 2), ...m('pd', 'T', 4)], decoys: 4, doctrine: 'hold' },
};

/** Words the AI may use that map onto a hull class. */
export const VESSEL_ALIASES = {
    fighter: 'kestrel', interceptor: 'kestrel', bomber: 'harrier', strike: 'harrier', mech: 'halberd', scout: 'lynx',
    pirate: 'raider', corvette: 'lancer', cutter: 'patrol', freighter: 'mule', hauler: 'atlas', courier: 'sparrow', transport: 'liner',
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
