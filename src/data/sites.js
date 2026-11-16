// Places in a star system that are not stations: asteroid fields, derelicts, anomalies, lost
// cargo, hidden bases. Most are not on any public chart. They are found by surveying, bought
// as map data, or heard about in the story.

export const SITE_KINDS = {
    field: { name: 'Asteroid field', icon: 'fa-meteor' },
    derelict: { name: 'Derelict', icon: 'fa-ship' },
    anomaly: { name: 'Anomaly', icon: 'fa-burst' },
    cache: { name: 'Lost cargo', icon: 'fa-box' },
    hideout: { name: 'Hidden base', icon: 'fa-skull-crossbones' },
};

/**
 * Asteroid field types: what the rocks are made of. ores: goods the rocks can hold, with weights.
 * purity: the range of ore content in a rock cut without a refining rig.
 */
export const FIELD_TYPES = {
    ice: { name: 'Ice field', ores: { ice: 6, water: 2, gas: 1 }, purity: [0.3, 0.6] },
    stony: { name: 'Stony field', ores: { silicates: 5, ore: 3 }, purity: [0.25, 0.5] },
    metallic: { name: 'Metallic field', ores: { ore: 6, raremetals: 1, silicates: 1 }, purity: [0.25, 0.5] },
    rich: { name: 'Rich metallic field', ores: { ore: 4, raremetals: 3, radioactives: 1, gems: 0.4 }, purity: [0.3, 0.55] },
};

/** Who an asteroid field belongs to. Claims are richer than the open zones everyone works. */
export const ZONES = {
    open: { name: 'Open zone', rich: 0.6, desc: 'Free for anyone. Worked over, and crowded.' },
    claimable: { name: 'Unclaimed', rich: 1.2, desc: 'Nobody has registered it yet. A claim can be filed at a port office in this system.' },
    claimed: { name: 'Claimed', rich: 1.2, desc: 'Registered to someone else. Mining here is poaching.' },
};
/** Filing a claim: credits per week, and how many weeks it runs before renewal. */
export const CLAIM = { perWeek: 900, weeks: 4 };

/** What survey data sells for at a port office, by kind of find. */
export const DATA_VALUE = { field: 500, derelict: 900, anomaly: 1600, cache: 400, hideout: 2500 };
/** Map data for one system from a cartography office, by security level. */
export const CHART_PRICE = [0, 600, 450, 300, 220, 160];

/** Derelict histories, for the storyteller and the salvage screen. */
export const DERELICT_FATES = [
    'a reactor scram that killed the crew', 'a pirate attack, long ago', 'a jump misfire that left her drifting',
    'a hull breach in a debris storm', 'an outbreak aboard', 'abandonment after an insurance fraud',
    'a mutiny, by the look of the bulkheads', 'a battle nobody wrote down',
];
export const ANOMALIES = [
    'a gravitational lensing knot', 'a pocket of exotic ion plasma', 'a repeating radio source with no visible origin',
    'a field of crystalline dust that confuses sensors', 'an old beacon broadcasting in a dead protocol',
];
