// Economy data: the goods that move between stations, what each kind of economy makes and
// needs, the events that upset a market, and the price lists for port services.
// Prices are credits per tonne. One credit buys roughly what one euro does today.

export const TIERS = {
    raw: { name: 'Raw materials', short: 'Raw' },
    refined: { name: 'Refined goods', short: 'Refined' },
    made: { name: 'Manufactured goods', short: 'Made' },
    luxury: { name: 'Luxuries', short: 'Luxury' },
    contraband: { name: 'Controlled goods', short: 'Controlled' },
};

/**
 * Handling rules. A hold without the right fitting can still carry the cargo, but it will not
 * arrive in the state it left in.
 */
export const HANDLING = {
    cold: { name: 'Refrigerated', icon: 'fa-snowflake', need: 'reefer', module: 'Refrigerated Hold', warn: 'spoils without a refrigerated hold' },
    haz: { name: 'Hazardous', icon: 'fa-radiation', need: 'hazmat', module: 'Hazmat Containment', warn: 'needs hazmat containment: regulated ports will not load it without, and it can leak' },
    live: { name: 'Live cargo', icon: 'fa-paw', need: 'pens', module: 'Livestock Pens', warn: 'dies without livestock pens' },
};

// vol: how much the price wanders by itself. loss: share lost per day when carried without the right hold.
export const GOODS = [
    // Raw
    { id: 'water', name: 'Purified Water', tier: 'raw', base: 18, vol: 0.15 },
    { id: 'ice', name: 'Volatile Ice', tier: 'raw', base: 24, vol: 0.2 },
    { id: 'biomass', name: 'Raw Biomass', tier: 'raw', base: 22, vol: 0.2 },
    { id: 'grain', name: 'Bulk Grain', tier: 'raw', base: 30, vol: 0.2 },
    { id: 'silicates', name: 'Silicates', tier: 'raw', base: 32, vol: 0.15 },
    { id: 'ore', name: 'Unrefined Ore', tier: 'raw', base: 40, vol: 0.25 },
    { id: 'gas', name: 'Helium-3', tier: 'raw', base: 85, vol: 0.3, handling: 'haz', loss: 0 },
    { id: 'livestock', name: 'Livestock', tier: 'raw', base: 190, vol: 0.25, handling: 'live', loss: 0.15 },
    { id: 'radioactives', name: 'Radioactives', tier: 'raw', base: 320, vol: 0.3, handling: 'haz', loss: 0 },
    { id: 'raremetals', name: 'Rare Earth Metals', tier: 'raw', base: 480, vol: 0.35 },
    // Refined
    { id: 'food', name: 'Processed Food', tier: 'refined', base: 45, vol: 0.2 },
    { id: 'fertilizer', name: 'Fertilizer', tier: 'refined', base: 48, vol: 0.2 },
    { id: 'textiles', name: 'Synthweave Textiles', tier: 'refined', base: 55, vol: 0.2 },
    { id: 'coolant', name: 'Reactor Coolant', tier: 'refined', base: 65, vol: 0.2 },
    { id: 'polymers', name: 'Industrial Polymers', tier: 'refined', base: 70, vol: 0.2 },
    { id: 'chemicals', name: 'Industrial Chemicals', tier: 'refined', base: 95, vol: 0.25, handling: 'haz', loss: 0 },
    { id: 'freshfood', name: 'Fresh Produce', tier: 'refined', base: 110, vol: 0.3, handling: 'cold', loss: 0.1 },
    { id: 'alloys', name: 'Structural Alloys', tier: 'refined', base: 120, vol: 0.2 },
    { id: 'fuelcells', name: 'Fusion Fuel Cells', tier: 'refined', base: 150, vol: 0.3, handling: 'haz', loss: 0 },
    { id: 'composites', name: 'Hull Composites', tier: 'refined', base: 170, vol: 0.2 },
    // Manufactured
    { id: 'construction', name: 'Construction Materials', tier: 'made', base: 90, vol: 0.2 },
    { id: 'consumer', name: 'Consumer Goods', tier: 'made', base: 160, vol: 0.2 },
    { id: 'machinery', name: 'Heavy Machinery', tier: 'made', base: 210, vol: 0.2 },
    { id: 'medical', name: 'Medical Supplies', tier: 'made', base: 260, vol: 0.3 },
    { id: 'electronics', name: 'Electronics', tier: 'made', base: 310, vol: 0.25 },
    { id: 'shipparts', name: 'Ship Components', tier: 'made', base: 380, vol: 0.25 },
    { id: 'pharma', name: 'Pharmaceuticals', tier: 'made', base: 420, vol: 0.3, handling: 'cold', loss: 0.04 },
    { id: 'munitions', name: 'Ship Munitions', tier: 'made', base: 440, vol: 0.3, restricted: ['accord'] },
    { id: 'robotics', name: 'Robotics', tier: 'made', base: 520, vol: 0.25 },
    { id: 'datacores', name: 'Encrypted Data Cores', tier: 'made', base: 650, vol: 0.4 },
    // Luxury
    { id: 'spirits', name: 'Spirits', tier: 'luxury', base: 240, vol: 0.25 },
    { id: 'coffee', name: 'Real Coffee', tier: 'luxury', base: 380, vol: 0.3 },
    { id: 'luxury', name: 'Luxury Goods', tier: 'luxury', base: 720, vol: 0.35 },
    { id: 'gems', name: 'Gemstones', tier: 'luxury', base: 1100, vol: 0.35 },
    { id: 'art', name: 'Art and Antiques', tier: 'luxury', base: 1400, vol: 0.4 },
    // Controlled: legal somewhere, a crime somewhere else
    { id: 'weapons', name: 'Small Arms', tier: 'contraband', base: 540, vol: 0.3, restricted: ['accord', 'hegemony'] },
    { id: 'narcotics', name: 'Neural Stimulants', tier: 'contraband', base: 900, vol: 0.5, restricted: ['accord', 'combine', 'hegemony', 'compact'] },
    { id: 'cyberware', name: 'Unlicensed Cyberware', tier: 'contraband', base: 1600, vol: 0.4, restricted: ['accord', 'hegemony', 'compact'] },
    { id: 'milspec', name: 'Military Hardware', tier: 'contraband', base: 2200, vol: 0.4, restricted: ['accord', 'combine', 'hegemony', 'compact'] },
];
export const goodById = (id) => GOODS.find(g => g.id === id);

/** What each economy makes and needs. The number is how strongly: 1 is a sideline, 3 is what the place exists for. */
export const ECON = {
    agricultural: {
        label: 'Agricultural',
        makes: { grain: 3, biomass: 2, freshfood: 2, food: 2, water: 2, livestock: 1.5, textiles: 1.5, spirits: 1, coffee: 1 },
        needs: { fertilizer: 2.5, machinery: 2, consumer: 1.5, medical: 1, electronics: 1, chemicals: 1, fuelcells: 1 },
    },
    industrial: {
        label: 'Industrial',
        makes: { machinery: 2.5, consumer: 2, construction: 2, polymers: 2, alloys: 1.5, shipparts: 1.5, chemicals: 1.5, robotics: 1 },
        needs: { ore: 3, food: 2, silicates: 1.5, water: 1.5, raremetals: 1.5, fuelcells: 1.5, gas: 1 },
    },
    mining: {
        label: 'Mining',
        makes: { ore: 3, silicates: 2, ice: 2, raremetals: 1.5, radioactives: 1, gems: 0.6 },
        needs: { food: 2, machinery: 2, medical: 1.5, spirits: 1.5, water: 1, construction: 1, fuelcells: 1 },
    },
    hightech: {
        label: 'High-Tech',
        makes: { electronics: 2.5, robotics: 2, medical: 1.5, pharma: 1.5, datacores: 1.5 },
        needs: { raremetals: 2.5, polymers: 1.5, luxury: 1.5, freshfood: 1.5, coffee: 1, composites: 1, art: 1, gems: 0.7 },
    },
    refinery: {
        label: 'Refinery',
        makes: { fuelcells: 3, alloys: 2, polymers: 2, chemicals: 2, coolant: 2, fertilizer: 1.5, composites: 1.5 },
        needs: { ore: 3, ice: 2.5, gas: 2.5, radioactives: 1.5, machinery: 1.5, biomass: 1 },
    },
    military: {
        label: 'Military',
        makes: { munitions: 2, weapons: 1.5, shipparts: 1.5 },
        needs: { fuelcells: 2.5, food: 2, medical: 2, alloys: 2, composites: 2, electronics: 1.5, pharma: 1, coolant: 1, spirits: 1 },
    },
    outpost: {
        label: 'Frontier Outpost',
        makes: { ice: 1.5, biomass: 0.5 },
        needs: { food: 2.5, water: 2, medical: 2, machinery: 1.5, weapons: 1.5, construction: 1.5, fuelcells: 1.5, consumer: 1, spirits: 1, narcotics: 1 },
    },
    tourism: {
        label: 'Tourism',
        makes: { luxury: 1.5, spirits: 1.5, art: 1 },
        needs: { freshfood: 2.5, coffee: 2, luxury: 2, food: 1.5, textiles: 1.5, consumer: 1.5, narcotics: 1.5, livestock: 1, gems: 1 },
    },
};

/**
 * Things that happen to a system and upset its market. fx is a shift on how well stocked each
 * good is (negative means scarce and dear). Keys: a good id, or makes / needs / all.
 */
export const EVENT_TYPES = {
    shortage: { name: 'Shortage', days: [6, 14], pickGood: 'needs', fx: (g) => ({ [g]: -0.9 }), text: (s, g) => `${s} is running short of ${g}. Buyers there are paying well over the odds.` },
    glut: { name: 'Glut', days: [6, 12], pickGood: 'makes', fx: (g) => ({ [g]: 0.8 }), text: (s, g) => `Warehouses in ${s} are overflowing with ${g}. It is going cheap.` },
    strike: { name: 'Strike', days: [5, 12], fx: () => ({ makes: -0.8 }), text: (s) => `Workers in ${s} have walked out. Local production has all but stopped.` },
    blockade: { name: 'Blockade', days: [8, 20], fx: () => ({ needs: -0.7, makes: 0.6 }), text: (s) => `${s} is under blockade. Imports are scarce and exports are piling up on the docks.` },
    plague: { name: 'Outbreak', days: [8, 18], fx: () => ({ medical: -1.2, pharma: -1.2, food: -0.3 }), text: (s) => `An outbreak has been declared in ${s}. Medical supplies and pharmaceuticals are desperately needed.` },
    war: { name: 'Fighting', days: [10, 25], fx: () => ({ munitions: -0.9, weapons: -0.8, medical: -0.7, fuelcells: -0.7, alloys: -0.5, shipparts: -0.7 }), text: (s) => `There is fighting in and around ${s}. Fleets are buying munitions, fuel, parts and medical supplies.` },
    boom: { name: 'Building boom', days: [10, 20], fx: () => ({ construction: -0.8, alloys: -0.6, machinery: -0.6, composites: -0.5 }), text: (s) => `A building boom in ${s} is eating construction materials, alloys and machinery.` },
    harvest: { name: 'Bumper harvest', days: [8, 15], econ: ['agricultural'], fx: () => ({ grain: 0.7, freshfood: 0.7, food: 0.5, livestock: 0.4 }), text: (s) => `${s} has brought in a bumper harvest. Food of every kind is cheap there.` },
    festival: { name: 'Festival', days: [4, 8], minSec: 2, fx: () => ({ luxury: -0.6, spirits: -0.7, freshfood: -0.5, coffee: -0.5 }), text: (s) => `${s} is celebrating. Spirits, fresh food and luxuries sell fast.` },
    raids: { name: 'Pirate raids', days: [8, 18], maxSec: 2, fx: () => ({ needs: -0.45 }), text: (s) => `Raiders are hitting the lanes into ${s}. Fewer freighters are getting through, and everything imported costs more.` },
};

// Sales tax and broker margin by who runs the port.
export const TAX = { accord: 0.03, combine: 0.04, compact: 0.01, hegemony: 0.05, ashen: 0 };
export const BROKER_MARGIN = 0.04;

// ---- Port services ----
// Per-day docking fee by hull size (index is the size class), before the security surcharge.
export const DOCK_FEE = [0, 15, 40, 120, 350, 900, 2500];
// Yard work scales with the size of the ship.
export const SIZE_COST = [0, 0.5, 1, 3, 8, 20, 50];
// Credits per point of wear cleared by a yard, for a size 2 hull.
export const SERVICE_RATE = { reactor: 22, engines: 20, shields: 15, weapons: 12, sensors: 10, lifesupport: 10, structure: 15 };
// Wear points gained per day, always and while under way.
export const WEAR_RATE = {
    reactor: { day: 0.35, transit: 0.8 },
    engines: { day: 0.05, transit: 1.6 },
    shields: { day: 0.15, transit: 0.3 },
    weapons: { day: 0.08, transit: 0 },
    sensors: { day: 0.2, transit: 0.2 },
    lifesupport: { day: 0.5, transit: 0.1 },
    structure: { day: 0.1, transit: 0.35 },
};
export const WEAR_PARTS = [
    { id: 'reactor', name: 'Reactor' },
    { id: 'engines', name: 'Drives' },
    { id: 'shields', name: 'Shield emitters' },
    { id: 'weapons', name: 'Weapon mounts' },
    { id: 'sensors', name: 'Sensors' },
    { id: 'lifesupport', name: 'Life support' },
    { id: 'structure', name: 'Hull structure' },
];

/** Price of one round, missile or drone for a ship weapon, before local market conditions. */
export function ammoUnitPrice(def) {
    if (def.kind === 'kinetic') return Math.max(2, Math.round(def.dmg * 0.35));
    if (def.kind === 'missile') return Math.round(def.dmg * 3 * (def.nuclear ? 12 : 1));
    return { drone: 6000, mine: 1500, grapple: 300, sand: 120, decoy: 2500 }[def.kind] ?? 200;
}

export const FEED_PRICE_PER_SYSTEM = 40; // credits per week per system covered
export const WEEK = 7 * 1440;
export const DAY = 1440;
