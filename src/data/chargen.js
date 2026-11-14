// Character creation data: attributes, skills, origins, careers, traits, flaws, cyberware.
// Effects use one small vocabulary so every system can read them:
//   attr: { ref: 1 }          attribute bonus
//   skill: { pilot: 1 }       skill bonus
//   maxHealth: 15             flat max health change
//   decay: { rest: 0.8 }      multiplier on how fast a need drains
//   stressGain: 0.5           multiplier on stress gained
//   xp: 1.25                  multiplier on XP earned
//   armor: 2                  personal armor
//   cyberCap: 0.5             multiplier on cyberware capacity
//   credits / debt / rep      applied once at creation

export const ATTRIBUTES = [
    { id: 'str', name: 'Strength', desc: 'Melee damage, carrying, forcing things.' },
    { id: 'ref', name: 'Reflexes', desc: 'Piloting, dodging, acting first.' },
    { id: 'end', name: 'Endurance', desc: 'Health, g-tolerance, cyberware capacity.' },
    { id: 'int', name: 'Intellect', desc: 'Technical and scientific work.' },
    { id: 'per', name: 'Perception', desc: 'Aim, sensors, noticing trouble.' },
    { id: 'pre', name: 'Presence', desc: 'Persuasion, command, nerve.' },
];

export const SKILL_DEFS = [
    { id: 'pilot', name: 'Ship Piloting', attr: 'ref', group: 'Flight' },
    { id: 'mech', name: 'Mech Piloting', attr: 'ref', group: 'Flight' },
    { id: 'gunnery', name: 'Gunnery', attr: 'per', group: 'Flight' },
    { id: 'navigation', name: 'Navigation', attr: 'int', group: 'Flight' },
    { id: 'firearms', name: 'Firearms', attr: 'per', group: 'Combat' },
    { id: 'melee', name: 'Melee', attr: 'str', group: 'Combat' },
    { id: 'athletics', name: 'Athletics', attr: 'end', group: 'Combat' },
    { id: 'stealth', name: 'Stealth', attr: 'ref', group: 'Combat' },
    { id: 'engineering', name: 'Engineering', attr: 'int', group: 'Technical' },
    { id: 'electronics', name: 'Electronics', attr: 'int', group: 'Technical' },
    { id: 'medicine', name: 'Medicine', attr: 'int', group: 'Technical' },
    { id: 'science', name: 'Science', attr: 'int', group: 'Technical' },
    { id: 'negotiation', name: 'Negotiation', attr: 'pre', group: 'Social' },
    { id: 'streetwise', name: 'Streetwise', attr: 'pre', group: 'Social' },
    { id: 'leadership', name: 'Leadership', attr: 'pre', group: 'Social' },
    { id: 'survival', name: 'Survival', attr: 'end', group: 'Social' },
];
export const SKILL_IDS = SKILL_DEFS.map(s => s.id);
export const skillDef = (id) => SKILL_DEFS.find(s => s.id === id);

export const ORIGINS = [
    { id: 'core', name: 'Core Worlder', faction: 'accord', desc: 'Raised under the domes and bureaucracy of the Sol Accord. Educated, soft, well documented.', attr: { int: 1, pre: 1, end: -1 }, skill: { negotiation: 1, science: 1 }, rep: { accord: 10 } },
    { id: 'station', name: 'Station-born', faction: 'combine', desc: 'Grew up in recycled air on a Combine ring. You know every duct and every scam.', attr: { ref: 1, int: 1, str: -1 }, skill: { electronics: 1, engineering: 1 }, rep: { combine: 5 } },
    { id: 'colony', name: 'Frontier Colonist', faction: 'compact', desc: 'A Free Worlds homestead under an open sky. Hard work, thin margins, long memory.', attr: { end: 1, str: 1, pre: -1 }, skill: { survival: 2, athletics: 1 }, rep: { compact: 10 } },
    { id: 'belter', name: 'Belter', faction: 'compact', desc: 'Rock-hopper family. Vacuum is home and a pressure suit is a second skin.', attr: { end: 1, per: 1, pre: -1 }, skill: { engineering: 1, pilot: 1, survival: 1 }, rep: { compact: 5 } },
    { id: 'conscript', name: 'Hegemony Levy', faction: 'hegemony', desc: 'Drilled from childhood in the Ardent Hegemony. Discipline, doctrine and scars.', attr: { str: 1, end: 1, int: -1 }, skill: { firearms: 1, athletics: 1, melee: 1 }, rep: { hegemony: 10, accord: -5 } },
    { id: 'undercity', name: 'Undercity Stray', faction: 'combine', desc: 'The lower decks nobody maps. You learned to read people before you learned to read.', attr: { ref: 1, per: 1, end: -1 }, skill: { streetwise: 2, stealth: 1 }, rep: { ashen: 10 } },
    { id: 'voidborn', name: 'Void Nomad', faction: 'compact', desc: 'Born aboard a long-hauler between stars. Planets feel wrong under your feet.', attr: { ref: 1, per: 1, str: -1 }, skill: { pilot: 1, navigation: 1, engineering: 1 }, rep: {} },
    { id: 'corporate', name: 'Corporate Ward', faction: 'combine', desc: 'Raised on a Combine scholarship contract. Polished, indebted, watched.', attr: { pre: 1, int: 1, end: -1 }, skill: { negotiation: 1, electronics: 1 }, rep: { combine: 10 }, credits: 2000 },
];

// start.ship: hull id the character owns. start.craft: small craft assigned to them.
export const CAREERS = [
    { id: 'trader', name: 'Free Trader', desc: 'Your own hull, your own debts. Buy low, sell high, stay ahead of the bank.', skill: { negotiation: 3, pilot: 2, navigation: 2, streetwise: 1 }, credits: 8000, start: { ship: 'mule', debt: 60000 }, gear: ['Datapad', 'Trade Ledger'], weapon: 'pistol', armor: 'none' },
    { id: 'courier', name: 'Courier Pilot', desc: 'Small, fast, discreet. People pay well for packages that arrive unopened.', skill: { pilot: 3, navigation: 2, electronics: 1, stealth: 1 }, credits: 5000, start: { ship: 'sparrow', debt: 30000 }, gear: ['Datapad', 'Sealed Courier Case'], weapon: 'pistol', armor: 'none' },
    { id: 'explorer', name: 'Surveyor', desc: 'Chart the unvisited and sell the data. Long silence, strange skies.', skill: { navigation: 3, science: 2, pilot: 2, survival: 1 }, credits: 4000, start: { ship: 'pathfinder', debt: 70000 }, gear: ['Survey Scanner', 'EVA Tether'], weapon: 'pistol', armor: 'none' },
    { id: 'smuggler', name: 'Smuggler', desc: 'The lanes have rules. You have a hidden compartment and a talent for lying.', skill: { streetwise: 3, pilot: 2, stealth: 2, negotiation: 1 }, credits: 6000, start: { ship: 'sparrow', debt: 20000 }, gear: ['Forged Transit Papers', 'Signal Scrambler'], weapon: 'pistol', armor: 'vest', rep: { accord: -10, ashen: 10 } },
    { id: 'hunter', name: 'Bounty Hunter', desc: 'Licensed, mostly. You bring people back for money, breathing when it pays more.', skill: { firearms: 2, streetwise: 2, stealth: 2, pilot: 1, melee: 1 }, credits: 4500, start: { ship: 'sparrow', debt: 45000 }, gear: ['Restraints', 'Bounty Scanner', 'Medkit', 'Dermal Patch', 'Magazine', 'Magazine'], weapon: 'rifle', armor: 'vest' },
    { id: 'prospector', name: 'Prospector', desc: 'Somewhere out there is the rock that pays for everything. Not this one. The next.', skill: { engineering: 2, survival: 2, pilot: 2, science: 1, athletics: 1 }, credits: 2500, start: { ship: 'mule', debt: 80000 }, gear: ['Mining Charge', 'Ore Sampler'], weapon: 'knife', armor: 'evasuit' },
    { id: 'mechpilot', name: 'Mech Pilot', desc: 'Strapped into fourteen tons of walking weapon. The frame belongs to your unit; the reflexes are yours.', skill: { mech: 3, gunnery: 2, firearms: 1, engineering: 1 }, credits: 3000, start: { craft: 'halberd' }, gear: ['Pilot Suit', 'Neural Trim Cable'], weapon: 'pistol', armor: 'vest' },
    { id: 'fighter', name: 'Fighter Pilot', desc: 'Escort and interception. Nine g, tunnel vision, and thirty seconds that decide everything.', skill: { pilot: 3, gunnery: 3, navigation: 1, athletics: 1 }, credits: 3000, start: { craft: 'kestrel' }, gear: ['G-Suit', 'Flight Helmet'], weapon: 'pistol', armor: 'none' },
    { id: 'merc', name: 'Mercenary', desc: 'A rifle, a contract, and a strict policy on being paid in advance.', skill: { firearms: 3, athletics: 2, melee: 2, survival: 1 }, credits: 4000, start: {}, gear: ['Medkit', 'Dermal Patch', 'Dermal Patch', 'Hemoclamp', 'Analgesic Stim', 'Magazine', 'Magazine', 'Magazine'], weapon: 'rifle', armor: 'flak' },
    { id: 'marine', name: 'Marine', desc: 'Boarding actions and breach drills. You go through the door first.', skill: { firearms: 3, athletics: 2, melee: 1, leadership: 1, medicine: 1 }, credits: 2500, start: {}, gear: ['Medkit', 'Dermal Patch', 'Hemoclamp', 'Combat Stim', 'Frag Grenade', 'Magazine', 'Magazine', 'Magazine'], weapon: 'shotgun', armor: 'marine' },
    { id: 'engineer', name: "Ship's Engineer", desc: 'Reactors, coolant loops and the certain knowledge that everything breaks.', skill: { engineering: 3, electronics: 2, science: 1, athletics: 1 }, credits: 3500, start: {}, gear: ['Engineering Toolkit', 'Hull Patch Kit'], weapon: 'knife', armor: 'evasuit' },
    { id: 'medic', name: 'Trauma Medic', desc: 'You have kept people alive in airlocks, cargo bays and worse.', skill: { medicine: 3, science: 2, negotiation: 1, electronics: 1 }, credits: 4000, start: {}, gear: ['Field Surgery Kit', 'Medkit', 'Medkit', 'Dermal Patch', 'Dermal Patch', 'Hemoclamp', 'Hemoclamp', 'Bone-weld Splint', 'Burn Gel', 'Analgesic Stim', 'Magazine'], weapon: 'pistol', armor: 'none' },
    { id: 'netrunner', name: 'Netrunner', desc: 'Every lock is a conversation. You are very persuasive.', skill: { electronics: 3, stealth: 2, streetwise: 2, science: 1 }, credits: 5000, start: { cyber: ['neural'] }, gear: ['Intrusion Deck', 'Spoofed ID Chips'], weapon: 'pistol', armor: 'none' },
    { id: 'agent', name: 'Corporate Agent', desc: 'An expense account, a non-disclosure agreement and a problem to make disappear.', skill: { negotiation: 3, leadership: 2, electronics: 1, firearms: 1, streetwise: 1 }, credits: 15000, start: {}, gear: ['Encrypted Commlink', 'Tailored Suit'], weapon: 'pistol', armor: 'vest', rep: { combine: 10 } },
    { id: 'drifter', name: 'Drifter', desc: 'No ship, no contract, no name worth checking. The hard start.', skill: { streetwise: 2, survival: 2, stealth: 1, melee: 1 }, credits: 300, start: {}, gear: ['Worn Duffel'], weapon: 'knife', armor: 'none', points: 6 },
];

// Experience tier: where you are in that career when the story begins.
export const TIERS = [
    { id: 'trainee', name: 'Trainee', desc: 'Still learning. Career skills -1, half pay, no hull of your own, but +6 points and cheaper training.', skillMod: -1, creditMult: 0.5, points: 6, noShip: true },
    { id: 'pro', name: 'Professional', desc: 'Qualified and working. The standard start.', skillMod: 0, creditMult: 1, points: 0 },
    { id: 'veteran', name: 'Veteran', desc: 'Years in. Career skills +1 and more savings, but -5 points: the years cost something.', skillMod: 1, creditMult: 1.6, points: -5 },
];

export const TRAITS = [
    { id: 'tough', name: 'Tough', cost: 3, desc: 'A bigger health pool in every body part.', fx: { maxHealth: 15 } },
    { id: 'cool', name: 'Cool Under Fire', cost: 3, desc: 'Stress builds half as fast.', fx: { stressGain: 0.5 } },
    { id: 'fastlearner', name: 'Fast Learner', cost: 4, desc: '+25% skill XP.', fx: { xp: 1.25 } },
    { id: 'naturalpilot', name: 'Natural Pilot', cost: 3, desc: '+1 Ship Piloting and Mech Piloting.', fx: { skill: { pilot: 1, mech: 1 } } },
    { id: 'deadshot', name: 'Dead Shot', cost: 3, desc: '+1 Firearms and Gunnery.', fx: { skill: { firearms: 1, gunnery: 1 } } },
    { id: 'gearhead', name: 'Gearhead', cost: 2, desc: '+1 Engineering.', fx: { skill: { engineering: 1 } } },
    { id: 'silver', name: 'Silver Tongue', cost: 2, desc: '+1 Negotiation.', fx: { skill: { negotiation: 1 } } },
    { id: 'ironstomach', name: 'Iron Stomach', cost: 1, desc: 'Hunger and thirst build 25% slower.', fx: { decay: { nourishment: 0.75, hydration: 0.75 } } },
    { id: 'lightsleeper', name: 'Short Sleeper', cost: 2, desc: 'Fatigue builds 25% slower.', fx: { decay: { rest: 0.75 } } },
    { id: 'zerog', name: 'Zero-G Native', cost: 2, desc: '+1 Athletics. No penalty working in free fall.', fx: { skill: { athletics: 1 } } },
    { id: 'connected', name: 'Well Connected', cost: 2, desc: '+15 standing with your home faction.', fx: { repHome: 15 } },
    { id: 'savings', name: 'Savings', cost: 2, desc: '+6,000 starting credits.', fx: { credits: 6000 } },
    { id: 'stoic', name: 'Stoic', cost: 1, desc: 'Morale drops 40% slower.', fx: { decay: { morale: 0.6 } } },
    { id: 'lucky', name: 'Lucky', cost: 4, desc: 'Once per day, reroll a failed check.', fx: { luck: 1 } },
];

export const FLAWS = [
    { id: 'wanted', name: 'Wanted', gain: 3, desc: 'A warrant in Sol Accord space. -35 standing; patrols will scan you.', fx: { rep: { accord: -35 } } },
    { id: 'marked', name: 'Marked by the Ashen', gain: 2, desc: 'You crossed a pirate clan. -40 standing with the Ashen Fleet.', fx: { rep: { ashen: -40 } } },
    { id: 'debt', name: 'Deep in Debt', gain: 2, desc: '+25,000 credits of debt to people who collect.', fx: { debt: 25000 } },
    { id: 'addict', name: 'Addict', gain: 3, desc: 'A craving that grows with time. Feed it or suffer.', fx: { craving: 1 } },
    { id: 'frail', name: 'Frail', gain: 3, desc: 'A smaller health pool in every body part.', fx: { maxHealth: -15 } },
    { id: 'lungs', name: "Spacer's Lungs", gain: 2, desc: 'Scarred by bad air. -1 Endurance.', fx: { attr: { end: -1 } } },
    { id: 'insomniac', name: 'Insomniac', gain: 2, desc: 'Fatigue builds 25% faster.', fx: { decay: { rest: 1.25 } } },
    { id: 'hothead', name: 'Hot-headed', gain: 2, desc: 'Stress builds 50% faster.', fx: { stressGain: 1.5 } },
    { id: 'oldwound', name: 'Old Wound', gain: 2, desc: 'Start with a permanent moderate injury.', fx: { injury: 'Old shrapnel wound (leg)' } },
    { id: 'rejection', name: 'Implant Rejection', gain: 2, desc: 'Your body fights hardware. Cyberware capacity halved.', fx: { cyberCap: 0.5 } },
    { id: 'glutton', name: 'High Metabolism', gain: 1, desc: 'Hunger builds 30% faster.', fx: { decay: { nourishment: 1.3 } } },
    { id: 'infamous', name: 'Bad Reputation', gain: 2, desc: '-10 standing with every major faction.', fx: { rep: { accord: -10, combine: -10, compact: -10, hegemony: -10 } } },
    { id: 'voidfear', name: 'Void Phobia', gain: 2, desc: 'Open vacuum terrifies you. EVA piles on stress.', fx: {} },
    { id: 'code', name: 'Code of Honour', gain: 1, desc: 'Lines you will not cross. Breaking them costs morale.', fx: {} },
];
export const MAX_FLAW_POINTS = 8;

// load = neural load; total load is limited by Endurance.
export const CYBERWARE = [
    { id: 'neural', name: 'Neural Link', load: 2, cost: 2, price: 12000, desc: 'Direct interface. +1 Electronics, +1 Mech Piloting.', fx: { skill: { electronics: 1, mech: 1 } } },
    { id: 'optics', name: 'Optic Suite', load: 1, cost: 2, price: 9000, desc: 'Zoom, low-light, threat overlay. +1 Perception.', fx: { attr: { per: 1 } } },
    { id: 'reflex', name: 'Reflex Booster', load: 3, cost: 4, price: 26000, desc: 'Spinal accelerator. +1 Reflexes.', fx: { attr: { ref: 1 } } },
    { id: 'arm', name: 'Cyberarm', load: 2, cost: 3, price: 15000, desc: 'Servo limb. +1 Strength, +1 Melee.', fx: { attr: { str: 1 }, skill: { melee: 1 } } },
    { id: 'plating', name: 'Subdermal Plating', load: 2, cost: 3, price: 18000, desc: 'Every hit that gets through does 6 less damage.', fx: { armor: 6 } },
    { id: 'lungs', name: 'Synthetic Lungs', load: 1, cost: 2, price: 9000, desc: 'Filtered, efficient. +1 Athletics; shrug off bad air.', fx: { skill: { athletics: 1 } } },
    { id: 'nanites', name: 'Medical Nanites', load: 2, cost: 3, price: 20000, desc: 'More health in every body part; wounds knit faster.', fx: { maxHealth: 10, healing: 1.5 } },
    { id: 'voice', name: 'Voice Modulator', load: 1, cost: 1, price: 4000, desc: 'Tone to order. +1 Negotiation.', fx: { skill: { negotiation: 1 } } },
    { id: 'cavity', name: 'Shielded Cavity', load: 1, cost: 1, price: 3000, desc: 'A hidden compartment scanners miss.', fx: {} },
    { id: 'backup', name: 'Cortex Backup', load: 3, cost: 5, price: 60000, desc: 'Your mind is mirrored off-site. Death costs you memory and money, not everything.', fx: { backup: 1 } },
];

// Small craft: mechs and fighters. Both launch from a carrier or station; different strengths.
export const CRAFT_CLASSES = {
    halberd: { id: 'halberd', kind: 'mech', name: 'MF-7 Halberd', role: 'Line combat frame', hull: 160, armor: 8, shields: 40, energy: 100, evasion: 18, speed: 3, weapons: ['Beam Rifle', 'Shoulder Rail', 'Heat Blade'], traits: 'Can fight on surfaces and inside structures. Heavy armor, melee capable.' },
    lynx: { id: 'lynx', kind: 'mech', name: 'LX-2 Lynx', role: 'Scout frame', hull: 110, armor: 4, shields: 30, energy: 110, evasion: 30, speed: 5, weapons: ['Autocannon', 'Sensor Pod'], traits: 'Fast and quiet. Fragile.' },
    kestrel: { id: 'kestrel', kind: 'fighter', name: 'F-22 Kestrel', role: 'Interceptor', hull: 90, armor: 2, shields: 60, energy: 90, evasion: 40, speed: 8, weapons: ['Twin Pulse Lasers', 'Missile Rails'], traits: 'Space only. Fastest thing in the lane; folds if hit.' },
    harrier: { id: 'harrier', kind: 'fighter', name: 'A-9 Harrow', role: 'Strike craft', hull: 130, armor: 4, shields: 70, energy: 90, evasion: 26, speed: 6, weapons: ['Autocannon', 'Torpedo Bay'], traits: 'Anti-ship ordnance. Needs an escort.' },
};

export const DIFFICULTIES = [
    { id: 'story', name: 'Storyteller', points: 18, desc: '18 free points. A capable hero.' },
    { id: 'standard', name: 'Standard', points: 12, desc: '12 free points. Competent, with gaps.' },
    { id: 'hardcore', name: 'Hardcore', points: 6, desc: '6 free points. You are nobody yet.' },
];

export const CHECK_DCS = [
    { dc: 9, name: 'Easy' },
    { dc: 12, name: 'Routine' },
    { dc: 15, name: 'Hard' },
    { dc: 18, name: 'Very hard' },
    { dc: 21, name: 'Extreme' },
];
