// Static game data: factions, economies, commodities, ships, weapons, enemies.

export const FACTIONS = [
    { id: 'accord', name: 'Sol Accord', color: '#4fa3ff', desc: 'Old Earth bureaucratic federation. Lawful, heavily patrolled core.' },
    { id: 'combine', name: 'Kepler Combine', color: '#f2b84b', desc: 'Corporate conglomerate. Everything has a price, including justice.' },
    { id: 'compact', name: 'Free Worlds Compact', color: '#5ee08f', desc: 'Loose alliance of independent colonies on the frontier.' },
    { id: 'hegemony', name: 'Ardent Hegemony', color: '#d660ff', desc: 'Militarist theocracy expanding rimward. Strict contraband laws.' },
    { id: 'ashen', name: 'Ashen Fleet', color: '#ff5a4f', desc: 'Pirate clans and deserters who prey on unguarded lanes.' },
];

export const ECONOMIES = {
    agricultural: { label: 'Agricultural', produces: ['food', 'water', 'textiles'], demands: ['machinery', 'medical', 'electronics'] },
    industrial: { label: 'Industrial', produces: ['machinery', 'polymers', 'alloys'], demands: ['ore', 'food', 'water'] },
    mining: { label: 'Mining', produces: ['ore', 'raremetals', 'ice'], demands: ['food', 'machinery', 'medical'] },
    hightech: { label: 'High-Tech', produces: ['electronics', 'medical', 'datacores'], demands: ['raremetals', 'polymers', 'luxury'] },
    refinery: { label: 'Refinery', produces: ['fuelcells', 'alloys', 'polymers'], demands: ['ore', 'ice', 'machinery'] },
    military: { label: 'Military', produces: ['weapons', 'alloys'], demands: ['food', 'medical', 'electronics', 'fuelcells'] },
    outpost: { label: 'Frontier Outpost', produces: ['ice'], demands: ['food', 'water', 'medical', 'machinery', 'weapons'] },
    tourism: { label: 'Tourism', produces: ['luxury'], demands: ['food', 'luxury', 'narcotics', 'textiles'] },
};

export const COMMODITIES = [
    { id: 'water', name: 'Purified Water', base: 18, vol: 0.15 },
    { id: 'food', name: 'Hydroponic Food', base: 32, vol: 0.2 },
    { id: 'ice', name: 'Volatile Ice', base: 24, vol: 0.2 },
    { id: 'textiles', name: 'Synthweave Textiles', base: 55, vol: 0.2 },
    { id: 'ore', name: 'Unrefined Ore', base: 40, vol: 0.25 },
    { id: 'polymers', name: 'Industrial Polymers', base: 70, vol: 0.2 },
    { id: 'alloys', name: 'Structural Alloys', base: 120, vol: 0.2 },
    { id: 'machinery', name: 'Heavy Machinery', base: 210, vol: 0.2 },
    { id: 'fuelcells', name: 'Fusion Fuel Cells', base: 150, vol: 0.3 },
    { id: 'medical', name: 'Medical Supplies', base: 260, vol: 0.3 },
    { id: 'electronics', name: 'Consumer Electronics', base: 310, vol: 0.25 },
    { id: 'raremetals', name: 'Rare Earth Metals', base: 480, vol: 0.35 },
    { id: 'datacores', name: 'Encrypted Data Cores', base: 650, vol: 0.4 },
    { id: 'luxury', name: 'Luxury Goods', base: 720, vol: 0.35 },
    { id: 'weapons', name: 'Small Arms', base: 540, vol: 0.3, restricted: ['accord', 'hegemony'] },
    { id: 'narcotics', name: 'Neural Stimulants', base: 900, vol: 0.5, restricted: ['accord', 'combine', 'hegemony', 'compact'] },
];

export const commodityById = (id) => COMMODITIES.find(c => c.id === id);

// Ship weapons. acc = hit chance by range band [long, medium, close].
export const SHIP_WEAPONS = {
    pulse: { id: 'pulse', name: 'Pulse Laser', dmg: [10, 18], acc: [55, 75, 85], vsShield: 1.3, vsHull: 0.8 },
    rail: { id: 'rail', name: 'Railgun', dmg: [22, 36], acc: [70, 60, 45], vsShield: 0.6, vsHull: 1.4 },
    missile: { id: 'missile', name: 'Missile Rack', dmg: [30, 45], acc: [65, 65, 60], vsShield: 0.9, vsHull: 1.2, ammo: 6 },
    autocannon: { id: 'autocannon', name: 'Autocannon', dmg: [8, 14], acc: [30, 65, 90], vsShield: 0.7, vsHull: 1.1 },
    lance: { id: 'lance', name: 'Plasma Lance', dmg: [40, 60], acc: [20, 50, 75], vsShield: 1.1, vsHull: 1.2 },
    pd: { id: 'pd', name: 'Point Defense', dmg: [0, 0], acc: [0, 0, 0], pointDefense: true },
};

// Ship hulls the player can fly.
export const SHIP_CLASSES = {
    sparrow: { id: 'sparrow', name: 'Sparrow-class Courier', role: 'Courier', hull: 220, shields: 90, armor: 2, fuel: 30, fuelPerLy: 0.6, cargo: 20, evasion: 25, crewMax: 2, weapons: ['pulse'], price: 90000 },
    mule: { id: 'mule', name: 'Mule-class Light Freighter', role: 'Light Freighter', hull: 400, shields: 140, armor: 4, fuel: 40, fuelPerLy: 0.9, cargo: 60, evasion: 12, crewMax: 4, weapons: ['pulse', 'pd'], price: 140000 },
    lancer: { id: 'lancer', name: 'Lancer-class Corvette', role: 'Corvette', hull: 360, shields: 200, armor: 6, fuel: 35, fuelPerLy: 1.0, cargo: 25, evasion: 20, crewMax: 5, weapons: ['rail', 'pulse', 'missile'], price: 240000 },
    pathfinder: { id: 'pathfinder', name: 'Pathfinder-class Explorer', role: 'Explorer', hull: 320, shields: 160, armor: 4, fuel: 70, fuelPerLy: 0.7, cargo: 35, evasion: 16, crewMax: 4, weapons: ['pulse', 'pd'], price: 190000 },
    atlas: { id: 'atlas', name: 'Atlas-class Bulk Hauler', role: 'Heavy Freighter', hull: 700, shields: 180, armor: 8, fuel: 60, fuelPerLy: 1.4, cargo: 160, evasion: 5, crewMax: 8, weapons: ['autocannon', 'pd'], price: 320000 },
    warden: { id: 'warden', name: 'Warden-class Frigate', role: 'Frigate', hull: 650, shields: 300, armor: 10, fuel: 50, fuelPerLy: 1.5, cargo: 40, evasion: 10, crewMax: 12, weapons: ['rail', 'rail', 'missile', 'pd'], price: 520000 },
};

export const SHIP_SYSTEMS = [
    { id: 'reactor', name: 'Reactor' },
    { id: 'engines', name: 'Engines' },
    { id: 'shields', name: 'Shield Emitters' },
    { id: 'weapons', name: 'Weapon Mounts' },
    { id: 'sensors', name: 'Sensors' },
    { id: 'lifesupport', name: 'Life Support' },
];

// Hostile ship templates for ship combat.
export const ENEMY_SHIPS = {
    raider: { id: 'raider', name: 'Ashen Raider', hull: 200, shields: 80, armor: 2, evasion: 22, weapons: ['autocannon', 'pulse'], prefRange: 2, bounty: 6000 },
    gunboat: { id: 'gunboat', name: 'Corsair Gunboat', hull: 320, shields: 120, armor: 4, evasion: 15, weapons: ['rail', 'autocannon'], prefRange: 1, bounty: 11000 },
    interceptor: { id: 'interceptor', name: 'Hegemony Interceptor', hull: 180, shields: 150, armor: 3, evasion: 30, weapons: ['pulse', 'pulse', 'missile'], prefRange: 1, bounty: 9000 },
    patrol: { id: 'patrol', name: 'Accord Patrol Cutter', hull: 380, shields: 220, armor: 6, evasion: 14, weapons: ['rail', 'pulse', 'pd'], prefRange: 0, bounty: 15000 },
    drone: { id: 'drone', name: 'Rogue Combat Drone', hull: 120, shields: 60, armor: 1, evasion: 35, weapons: ['pulse'], prefRange: 2, bounty: 3000 },
    frigate: { id: 'frigate', name: 'Pirate Frigate', hull: 620, shields: 260, armor: 8, evasion: 9, weapons: ['rail', 'lance', 'missile'], prefRange: 1, bounty: 30000 },
};

// Personal weapons. acc modifier added to the skill check; dmg is a range.
export const PERSONAL_WEAPONS = {
    fists: { id: 'fists', name: 'Unarmed', dmg: [1, 4], acc: 0 },
    knife: { id: 'knife', name: 'Vibro-knife', dmg: [3, 8], acc: 5 },
    pistol: { id: 'pistol', name: 'Gauss Pistol', dmg: [5, 11], acc: 10 },
    smg: { id: 'smg', name: 'Flechette SMG', dmg: [6, 14], acc: 5 },
    rifle: { id: 'rifle', name: 'Pulse Rifle', dmg: [8, 16], acc: 15 },
    shotgun: { id: 'shotgun', name: 'Breaching Shotgun', dmg: [10, 20], acc: 0 },
    sniper: { id: 'sniper', name: 'Coil Marksman Rifle', dmg: [14, 24], acc: 20 },
    arc: { id: 'arc', name: 'Arc Thrower', dmg: [9, 18], acc: 10 },
};

export const ARMORS = {
    none: { id: 'none', name: 'Shipboard Fatigues', armor: 0 },
    vest: { id: 'vest', name: 'Ballistic Vest', armor: 2 },
    flak: { id: 'flak', name: 'Flak Jacket', armor: 3 },
    evasuit: { id: 'evasuit', name: 'Armored EVA Suit', armor: 4 },
    marine: { id: 'marine', name: 'Marine Hardsuit', armor: 6 },
};

export const ENEMY_TROOPERS = {
    thug: { name: 'Dockside Thug', hp: 18, armor: 0, weapon: 'knife', skill: 2 },
    pirate: { name: 'Ashen Boarder', hp: 24, armor: 2, weapon: 'smg', skill: 3 },
    merc: { name: 'Combine Security', hp: 28, armor: 3, weapon: 'rifle', skill: 4 },
    marine: { name: 'Hegemony Marine', hp: 34, armor: 5, weapon: 'rifle', skill: 5 },
    drone: { name: 'Security Drone', hp: 20, armor: 4, weapon: 'arc', skill: 3 },
    creature: { name: 'Xenofauna', hp: 30, armor: 1, weapon: 'fists', skill: 4, dmgOverride: [6, 14] },
};

export const SKILLS = ['piloting', 'gunnery', 'engineering', 'medicine', 'combat', 'tactics', 'negotiation', 'science'];

export const NEEDS = [
    { id: 'nourishment', name: 'Nourishment', decay: 1.5, low: 'hungry', crit: 'starving' },
    { id: 'hydration', name: 'Hydration', decay: 2.5, low: 'thirsty', crit: 'dehydrated' },
    { id: 'rest', name: 'Rest', decay: 4, low: 'tired', crit: 'exhausted' },
    { id: 'hygiene', name: 'Hygiene', decay: 1.5, low: 'grimy', crit: 'filthy' },
    { id: 'morale', name: 'Morale', decay: 0.5, low: 'downcast', crit: 'despairing' },
];

export const INJURY_SEVERITY = {
    minor: { label: 'Minor', hpCap: 0, healHours: 24, cost: 200 },
    moderate: { label: 'Moderate', hpCap: 10, healHours: 96, cost: 900 },
    severe: { label: 'Severe', hpCap: 25, healHours: 336, cost: 3500 },
    critical: { label: 'Critical', hpCap: 45, healHours: 0, cost: 12000 },
};

export const CREW_ROLES = ['Pilot', 'Engineer', 'Gunner', 'Medic', 'Navigator', 'Security', 'Quartermaster', 'Scientist'];
