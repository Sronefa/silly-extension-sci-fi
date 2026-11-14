// On-foot combat data: body parts, weapons, armor, medical items, enemy templates, zone layouts.

// Share of total health per body part and the chance a hit lands there.
export const BODY_PARTS = [
    { id: 'head', name: 'Head', share: 0.08, hit: 8, vital: true },
    { id: 'thorax', name: 'Thorax', share: 0.20, hit: 32, vital: true },
    { id: 'stomach', name: 'Abdomen', share: 0.16, hit: 16 },
    { id: 'larm', name: 'Left arm', share: 0.135, hit: 10, limb: 'arm' },
    { id: 'rarm', name: 'Right arm', share: 0.135, hit: 10, limb: 'arm' },
    { id: 'lleg', name: 'Left leg', share: 0.145, hit: 12, limb: 'leg' },
    { id: 'rleg', name: 'Right leg', share: 0.145, hit: 12, limb: 'leg' },
];
export const partDef = (id) => BODY_PARTS.find(p => p.id === id);

export const WOUND_TYPES = {
    bleed: { name: 'Bleeding', short: 'BLEED', perRound: 2, perMinute: 0.4 },
    hemorrhage: { name: 'Arterial bleed', short: 'ARTERIAL', perRound: 6, perMinute: 1.6 },
    fracture: { name: 'Fracture', short: 'FRACTURE' },
    burn: { name: 'Plasma burn', short: 'BURN', perMinute: 0.05 },
    concussion: { name: 'Concussion', short: 'CONCUSSED' },
};

// Range bands by zone distance: 0 = same zone, 1 = adjacent, 2 = two zones, 3 = three or more.
// acc = modifier to the attack roll in each band (null = cannot attack at that range).
// pen = armor penetration class.
export const WEAPONS = {
    fists: { id: 'fists', name: 'Unarmed', skill: 'melee', dmg: [8, 16], pen: 0, acc: [0, null, null, null], melee: true },
    knife: { id: 'knife', name: 'Mono-edge Knife', skill: 'melee', dmg: [22, 38], pen: 2, acc: [1, null, null, null], melee: true, bleed: 0.5 },
    blade: { id: 'blade', name: 'Thermal Blade', skill: 'melee', dmg: [34, 54], pen: 4, acc: [1, null, null, null], melee: true, energy: true },
    pistol: { id: 'pistol', name: 'Gauss Pistol', skill: 'firearms', dmg: [30, 44], pen: 2, acc: [1, 0, -2, -5], mag: 12 },
    smg: { id: 'smg', name: 'Flechette SMG', skill: 'firearms', dmg: [26, 38], pen: 2, acc: [2, 1, -2, -6], mag: 30, burst: 2, bleed: 0.45 },
    shotgun: { id: 'shotgun', name: 'Breaching Shotgun', skill: 'firearms', dmg: [70, 110], pen: 2, acc: [3, 0, -5, null], mag: 6 },
    rifle: { id: 'rifle', name: 'Pulse Rifle', skill: 'firearms', dmg: [46, 64], pen: 4, acc: [-1, 1, 1, -1], mag: 24, burst: 2 },
    carbine: { id: 'carbine', name: 'Rail Carbine', skill: 'firearms', dmg: [56, 76], pen: 5, acc: [-1, 1, 1, 0], mag: 10 },
    sniper: { id: 'sniper', name: 'Coil Marksman Rifle', skill: 'firearms', dmg: [84, 116], pen: 6, acc: [-5, -2, 2, 3], mag: 5 },
    arc: { id: 'arc', name: 'Arc Thrower', skill: 'firearms', dmg: [38, 58], pen: 3, acc: [2, 1, -3, null], mag: 8, energy: true },
    plasma: { id: 'plasma', name: 'Plasma Caster', skill: 'firearms', dmg: [62, 92], pen: 5, acc: [0, 1, -1, -4], mag: 6, energy: true },
    claws: { id: 'claws', name: 'Claws', skill: 'melee', dmg: [28, 46], pen: 2, acc: [2, null, null, null], melee: true, bleed: 0.6 },
};

// Armor: class 1-6 against weapon penetration. durability wears down as it is hit.
// Power armor has frame points that absorb all damage until they run out.
export const ARMOR = {
    none: { id: 'none', name: 'Civilian Clothes', cls: 0, dur: 0, covers: [] },
    vest: { id: 'vest', name: 'Ballistic Vest', cls: 2, dur: 40, covers: ['thorax', 'stomach'] },
    flak: { id: 'flak', name: 'Flak Rig', cls: 3, dur: 55, covers: ['thorax', 'stomach'] },
    evasuit: { id: 'evasuit', name: 'Armored EVA Suit', cls: 2, dur: 50, covers: ['head', 'thorax', 'stomach', 'larm', 'rarm', 'lleg', 'rleg'], sealed: true },
    tactical: { id: 'tactical', name: 'Tactical Carapace', cls: 3, dur: 60, covers: ['head', 'thorax', 'stomach', 'larm', 'rarm'] },
    marine: { id: 'marine', name: 'Marine Hardsuit', cls: 4, dur: 85, covers: ['head', 'thorax', 'stomach', 'larm', 'rarm', 'lleg', 'rleg'], sealed: true },
    assault: { id: 'assault', name: 'Assault Plate', cls: 5, dur: 100, covers: ['head', 'thorax', 'stomach', 'larm', 'rarm', 'lleg', 'rleg'], sealed: true, bulky: 1 },
    power: { id: 'power', name: 'Titan Power Armor', cls: 6, dur: 0, frame: 360, covers: ['head', 'thorax', 'stomach', 'larm', 'rarm', 'lleg', 'rleg'], sealed: true, powered: true },
};

// Medical items. Inventory items are matched by name.
export const MEDS = {
    patch: { id: 'patch', name: 'Dermal Patch', desc: 'Seals a bleeding wound.', fixes: ['bleed'], time: 1, price: 60 },
    clamp: { id: 'clamp', name: 'Hemoclamp', desc: 'Stops an arterial bleed.', fixes: ['hemorrhage', 'bleed'], time: 1, price: 180 },
    splint: { id: 'splint', name: 'Bone-weld Splint', desc: 'Sets a fracture.', fixes: ['fracture'], time: 2, price: 220 },
    gel: { id: 'gel', name: 'Burn Gel', desc: 'Treats plasma and arc burns.', fixes: ['burn'], time: 1, price: 140 },
    analgesic: { id: 'analgesic', name: 'Analgesic Stim', desc: 'Suppresses pain for an hour.', painkiller: 60, time: 0, price: 120, quick: true },
    medkit: { id: 'medkit', name: 'Medkit', desc: 'Restores 60 health to one body part and seals light bleeding.', heal: 60, fixes: ['bleed'], time: 2, price: 350 },
    nanite: { id: 'nanite', name: 'Nanite Injector', desc: 'Restores 45 health across the body and stops all bleeding.', healAll: 45, fixes: ['bleed', 'hemorrhage'], time: 0, price: 1400, quick: true },
    surgery: { id: 'surgery', name: 'Field Surgery Kit', desc: 'Revives a destroyed body part at reduced capacity. Medicine check.', surgery: true, time: 15, price: 900 },
    stim: { id: 'stim', name: 'Combat Stim', desc: '+2 to attacks for 5 rounds, then a stress crash.', combatStim: 5, time: 0, price: 400, quick: true },
    neuro: { id: 'neuro', name: 'Neuro-stabiliser', desc: 'Clears a concussion.', fixes: ['concussion'], time: 1, price: 200 },
};
export const medByName = (name) => Object.values(MEDS).find(m => m.name.toLowerCase() === String(name).toLowerCase());

// Enemy templates. tough scales their body; morale is the fraction of health at which they may break.
export const ENEMIES = {
    thug: { id: 'thug', name: 'Dockside Thug', tough: 0.8, weapon: 'knife', armor: 'none', skill: 2, ref: 4, morale: 0.5, style: 'rush' },
    ganger: { id: 'ganger', name: 'Undercity Ganger', tough: 0.85, weapon: 'pistol', armor: 'none', skill: 2, ref: 5, morale: 0.5, style: 'cover' },
    pirate: { id: 'pirate', name: 'Ashen Boarder', tough: 1, weapon: 'smg', armor: 'vest', skill: 3, ref: 5, morale: 0.35, style: 'push' },
    raider: { id: 'raider', name: 'Ashen Breacher', tough: 1.1, weapon: 'shotgun', armor: 'flak', skill: 3, ref: 4, morale: 0.3, style: 'rush' },
    guard: { id: 'guard', name: 'Station Security', tough: 1, weapon: 'pistol', armor: 'vest', skill: 3, ref: 5, morale: 0.4, style: 'cover' },
    merc: { id: 'merc', name: 'Combine Contractor', tough: 1.05, weapon: 'rifle', armor: 'tactical', skill: 4, ref: 5, morale: 0.3, style: 'cover' },
    marine: { id: 'marine', name: 'Hegemony Marine', tough: 1.15, weapon: 'rifle', armor: 'marine', skill: 5, ref: 5, morale: 0.15, style: 'push' },
    sniper: { id: 'sniper', name: 'Marksman', tough: 0.9, weapon: 'sniper', armor: 'vest', skill: 5, ref: 5, morale: 0.4, style: 'hold' },
    officer: { id: 'officer', name: 'Officer', tough: 1, weapon: 'pistol', armor: 'flak', skill: 4, ref: 6, morale: 0.4, style: 'cover' },
    heavy: { id: 'heavy', name: 'Assault Trooper', tough: 1.2, weapon: 'plasma', armor: 'assault', skill: 4, ref: 4, morale: 0.2, style: 'push' },
    trooper: { id: 'trooper', name: 'Power Armor Trooper', tough: 1.2, weapon: 'carbine', armor: 'power', skill: 5, ref: 4, morale: 0.1, style: 'push' },
    drone: { id: 'drone', name: 'Security Drone', tough: 0.6, weapon: 'arc', armor: 'tactical', skill: 3, ref: 6, morale: 0, style: 'push', machine: true },
    turret: { id: 'turret', name: 'Sentry Turret', tough: 0.7, weapon: 'rifle', armor: 'marine', skill: 4, ref: 3, morale: 0, style: 'hold', machine: true, static: true },
    beast: { id: 'beast', name: 'Feral Hound', tough: 0.8, weapon: 'claws', armor: 'none', skill: 3, ref: 7, morale: 0.25, style: 'rush' },
    civilian: { id: 'civilian', name: 'Panicked Civilian', tough: 0.7, weapon: 'fists', armor: 'none', skill: 0, ref: 4, morale: 0.9, style: 'cover' },
};

// Zone layouts. cover: 0 open, 1 light, 2 heavy. link: [a, b, sight] where sight=false means a doorway
// or corner you can move through but not see or shoot through beyond the adjacent zone.
export const LAYOUTS = {
    corridor: {
        keys: ['corridor', 'hall', 'passage', 'deck', 'ship', 'airlock', 'tunnel', 'duct'],
        zones: [
            { name: 'Airlock', cover: 1, x: 0, y: 1, entry: true },
            { name: 'Main Corridor', cover: 0, x: 1, y: 1 },
            { name: 'Junction', cover: 1, x: 2, y: 1 },
            { name: 'Side Compartment', cover: 2, x: 2, y: 0 },
            { name: 'Bulkhead Door', cover: 2, x: 3, y: 1, far: true },
        ],
        links: [[0, 1, true], [1, 2, true], [2, 3, false], [2, 4, true]],
    },
    cargo: {
        keys: ['cargo', 'hold', 'warehouse', 'bay', 'hangar', 'dock', 'storage', 'depot'],
        zones: [
            { name: 'Loading Ramp', cover: 0, x: 0, y: 1, entry: true },
            { name: 'Crate Stacks', cover: 2, x: 1, y: 0 },
            { name: 'Open Floor', cover: 0, x: 1, y: 1 },
            { name: 'Container Row', cover: 2, x: 2, y: 1 },
            { name: 'Gantry', cover: 1, x: 2, y: 0, high: true },
            { name: 'Far Bulkhead', cover: 1, x: 3, y: 1, far: true },
        ],
        links: [[0, 1, true], [0, 2, true], [1, 2, true], [2, 3, true], [1, 4, false], [3, 4, true], [3, 5, true], [2, 5, true]],
    },
    bar: {
        keys: ['bar', 'cantina', 'club', 'lounge', 'market', 'shop', 'promenade', 'mess', 'canteen', 'casino'],
        zones: [
            { name: 'Entrance', cover: 1, x: 0, y: 1, entry: true },
            { name: 'Tables', cover: 1, x: 1, y: 1 },
            { name: 'Bar Counter', cover: 2, x: 2, y: 0 },
            { name: 'Booths', cover: 2, x: 1, y: 0 },
            { name: 'Back Room', cover: 1, x: 3, y: 0, far: true },
            { name: 'Service Exit', cover: 0, x: 3, y: 1, far: true },
        ],
        links: [[0, 1, true], [1, 2, true], [1, 3, true], [0, 3, true], [2, 4, false], [1, 5, true], [2, 5, true]],
    },
    street: {
        keys: ['street', 'alley', 'plaza', 'concourse', 'city', 'slum', 'undercity', 'colony', 'settlement', 'outpost'],
        zones: [
            { name: 'Street Corner', cover: 1, x: 0, y: 1, entry: true },
            { name: 'Open Street', cover: 0, x: 1, y: 1 },
            { name: 'Parked Hauler', cover: 2, x: 2, y: 1 },
            { name: 'Alley Mouth', cover: 1, x: 1, y: 0 },
            { name: 'Rooftop', cover: 1, x: 2, y: 0, high: true },
            { name: 'Barricade', cover: 2, x: 3, y: 1, far: true },
        ],
        links: [[0, 1, true], [1, 2, true], [0, 3, false], [3, 4, false], [1, 3, true], [2, 5, true], [4, 2, true], [4, 5, true]],
    },
    bridge: {
        keys: ['bridge', 'command', 'control', 'cockpit', 'lab', 'medbay', 'office', 'engine', 'reactor', 'engineering', 'server'],
        zones: [
            { name: 'Entry Hatch', cover: 1, x: 0, y: 0, entry: true },
            { name: 'Central Floor', cover: 0, x: 1, y: 0 },
            { name: 'Console Bank', cover: 2, x: 2, y: 0 },
            { name: 'Upper Gallery', cover: 1, x: 1, y: 1, high: true },
            { name: 'Rear Station', cover: 2, x: 3, y: 0, far: true },
        ],
        links: [[0, 1, true], [1, 2, true], [1, 3, true], [2, 4, true], [3, 4, true], [2, 3, true]],
    },
    wild: {
        keys: ['wild', 'surface', 'field', 'canyon', 'forest', 'crater', 'desert', 'ruin', 'wreck', 'derelict', 'cave', 'moon', 'planet', 'outside', 'hull', 'eva'],
        zones: [
            { name: 'Ridge', cover: 1, x: 0, y: 0, entry: true, high: true },
            { name: 'Slope', cover: 0, x: 1, y: 0 },
            { name: 'Boulder Field', cover: 2, x: 1, y: 1 },
            { name: 'Open Ground', cover: 0, x: 2, y: 0 },
            { name: 'Wreckage', cover: 2, x: 2, y: 1 },
            { name: 'Far Treeline', cover: 1, x: 3, y: 0, far: true },
        ],
        links: [[0, 1, true], [0, 2, true], [1, 2, true], [1, 3, true], [2, 4, true], [3, 4, true], [3, 5, true], [4, 5, true]],
    },
};

export const COVER_NAMES = ['Open', 'Light cover', 'Heavy cover'];
export const BAND_NAMES = ['Point blank', 'Short', 'Medium', 'Long'];

// Canned battle chatter used when AI speech calls are off or fail.
export const BARKS = {
    start: ['Contact!', 'Weapons free!', 'Drop them!', 'There! Open fire!', 'No witnesses.'],
    hit: ['Got one!', 'Target hit!', 'That one felt it.'],
    hurt: ['I\'m hit!', 'Taking fire!', 'Medic!', 'Argh, damn it!'],
    kill: ['Target down.', 'One less.', 'Scratch one.'],
    flee: ['Forget this!', 'Fall back! Fall back!', 'I didn\'t sign up for this!'],
    reload: ['Reloading!', 'Changing mag!', 'Cover me!'],
    allydown: ['Man down!', 'No! Stay with me!'],
};
