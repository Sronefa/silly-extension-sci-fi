// Life-sim data: shift work for people without a ship, station living costs, pilot licences,
// lenders, and the people who end up owning you if it all goes wrong.

/**
 * Shift jobs. pay is credits for an eight hour shift before skill and local conditions.
 * at: the part of the station where the work is done; you have to walk there and stay there.
 * skill/min: the skill used and the level needed to be taken on. econ: where the job exists (all if absent).
 */
export const JOBS = [
    { id: 'cleaner', at: 'docks', name: 'Hold cleaner', skill: 'athletics', min: 0, pay: 130, desc: 'Scrubbing tanks and holds between cargoes.' },
    { id: 'galley', at: 'concourse', name: 'Galley hand', skill: 'negotiation', min: 0, pay: 140, desc: 'Dishes, tables and drunk spacers.' },
    { id: 'dockhand', at: 'docks', name: 'Dock hand', skill: 'athletics', min: 0, pay: 160, desc: 'Shifting cargo on the docks.' },
    { id: 'picker', at: 'works', name: 'Hydroponics picker', skill: 'survival', min: 0, pay: 150, econ: ['agricultural'], desc: 'Harvest work under grow lights.' },
    { id: 'sorter', at: 'works', name: 'Ore sorter', skill: 'athletics', min: 0, pay: 190, econ: ['mining', 'refinery'], desc: 'Hard, dusty, and the pay shows it.' },
    { id: 'line', at: 'works', name: 'Line worker', skill: 'engineering', min: 0, pay: 190, econ: ['industrial', 'refinery', 'military'], desc: 'A place on an assembly line.' },
    { id: 'guide', at: 'concourse', name: 'Tourist guide', skill: 'negotiation', min: 1, pay: 200, econ: ['tourism'], desc: 'Smile, walk backwards, know where the toilets are.' },
    { id: 'clerk', at: 'docks', name: 'Warehouse clerk', skill: 'negotiation', min: 1, pay: 210, desc: 'Manifests, tallies and arguments with captains.' },
    { id: 'runner', at: 'concourse', name: 'Station courier', skill: 'streetwise', min: 1, pay: 220, desc: 'Packages across the station, no questions.' },
    { id: 'data', at: 'office', name: 'Data clerk', skill: 'electronics', min: 2, pay: 290, econ: ['hightech', 'industrial', 'tourism', 'agricultural'], desc: 'Cleaning records for people who cannot be bothered.' },
    { id: 'mechanic', at: 'yard', name: "Mechanic's mate", skill: 'engineering', min: 2, pay: 300, desc: 'Passing tools in a repair bay, then holding them.' },
    { id: 'guard', at: 'concourse', name: 'Security shift', skill: 'firearms', min: 2, pay: 310, desc: 'Standing at a door with a sidearm.' },
    { id: 'tech', at: 'works', name: 'Electronics tech', skill: 'electronics', min: 3, pay: 340, desc: 'Fault finding on other people\'s systems.' },
    { id: 'medic', at: 'clinic', name: "Medic's aide", skill: 'medicine', min: 2, pay: 340, desc: 'Clinic work: dressings, scans, cleaning up.' },
    { id: 'lab', at: 'works', name: 'Lab assistant', skill: 'science', min: 3, pay: 360, econ: ['hightech', 'refinery', 'agricultural'], desc: 'Assays and sample runs.' },
    { id: 'welder', at: 'yard', name: 'Yard welder', skill: 'engineering', min: 4, pay: 400, yard: true, desc: 'Hull work in a suit. Skilled, and paid like it.' },
    { id: 'eva', at: 'docks', name: 'EVA cutter on the belt rigs', skill: 'athletics', min: 1, pay: 330, econ: ['mining', 'refinery'], eva: true, desc: 'Eight hours in a hard suit on the station\'s mining rigs, cutting rock by hand. It pays well because people die doing it.' },
    { id: 'rigboss', at: 'docks', name: 'EVA rig foreman', skill: 'engineering', min: 4, pay: 480, econ: ['mining'], eva: true, desc: 'Running a cutting crew out on the rock. Your mistakes kill other people.' },
    { id: 'copilot', at: 'docks', name: 'Shuttle co-pilot', skill: 'pilot', min: 3, pay: 450, licence: 'basic', desc: 'Right-hand seat on the orbital runs.' },
];

export const LIVING = {
    meal: { name: 'Hot meal', cost: 12, minutes: 25 },
    bunk: { name: 'Capsule bunk, 8 h', cost: 30, minutes: 480 },
    room: { name: 'Private room, 8 h', cost: 90, minutes: 480 },
};

/**
 * Pilot licences. covers(cls): which hulls it lets you register and fly. lessons are four hour
 * sessions, at most two a day; then a written test and a check flight.
 */
export const LICENCES = {
    basic: { id: 'basic', name: 'Basic Spacecraft Licence', fee: 3000, lessons: 10, needs: null, pilot: 0, theoryDc: 10, flightDc: 11, desc: 'Radio procedure, traffic rules, emergencies. Covers small craft and light ships.' },
    commercial: { id: 'commercial', name: 'Commercial Master\'s Ticket', fee: 7000, lessons: 8, needs: 'basic', pilot: 3, theoryDc: 12, flightDc: 13, desc: 'Covers ships up to heavy freighter size, and carrying passengers for hire.' },
    master: { id: 'master', name: 'Deep-space Master\'s Certificate', fee: 16000, lessons: 8, needs: 'commercial', pilot: 5, theoryDc: 14, flightDc: 15, desc: 'Covers the largest hulls a private owner can register.' },
    armed: { id: 'armed', name: 'Armed Vessel Endorsement', fee: 2000, lessons: 3, needs: 'basic', pilot: 1, theoryDc: 11, flightDc: 11, flightSkill: 'gunnery', desc: 'Rules of engagement and weapons safety. Required to fly anything with guns bigger than point defence.' },
};
export const licenceForSize = (size) => (size <= 2 ? 'basic' : size <= 4 ? 'commercial' : 'master');

export const LENDERS = {
    bank: { id: 'bank', name: 'Chartered bank', rate: 0.0035, weeks: 78, grace: 3, desc: 'Low interest, secured on the ship. Three missed payments and they send for it.' },
    corp: { id: 'corp', name: 'Combine Credit', rate: 0.006, weeks: 52, grace: 3, desc: 'No collateral asked. Default converts the balance into an indenture: they take most of what you earn until it is paid.' },
    shark: { id: 'shark', name: 'Ashen moneylender', rate: 0.025, weeks: 20, grace: 2, desc: 'Cash now, no questions. Miss payments and collectors come; keep missing and they sell you to cover it.' },
    port: { id: 'port', name: 'Port arrears', rate: 0.02, weeks: 12, grace: 4, desc: 'Unpaid fees and fines.' },
};

/**
 * Kinds of bondage. Which one you get depends on who buys you, and so do the ways out.
 * sells: chance that this owner would ever take money for you. tips: chance and size of what a
 * working day lets you hide away. hurt: chance a day's work injures you. watch: how closely you
 * are guarded (added to the escape difficulty). exit: a way out besides sale, rescue and escape:
 * term (a bond that runs out), join (a crew may take you in as one of their own), wins (pit
 * fighters are freed by custom after enough victories).
 */
export const OWNERS = [
    { kind: 'mine', type: 'Hard labour', name: 'a mining camp', work: 'hauling ore in a pressure suit that leaks', place: 'Slave pens, {sys} mining camp', sells: 0.65, price: [3, 8], tips: [0.3, 25], hurt: 0.12, watch: 1 },
    { kind: 'salvage', type: 'Hard labour', name: 'a salvage gang', work: 'cutting wrecks apart without a tether', place: 'Breaker hulk, {sys}', sells: 0.65, price: [3, 8], tips: [0.4, 40], hurt: 0.15, watch: 0 },
    { kind: 'bond', type: 'Labour bond', name: 'a labour contractor', work: 'working off a bond on a contractor\'s gangs, sold on from site to site', place: 'Bonded labour barracks, {sys}', sells: 1, price: [4, 9], tips: [0.9, 18], hurt: 0.05, watch: 0, exit: 'term' },
    { kind: 'estate', type: 'Household service', name: 'a warlord\'s household', work: 'serving in the household, at the owner\'s pleasure', place: 'The household of {owner}, {sys}', sells: 0.45, price: [6, 14], tips: [0.5, 60], hurt: 0.02, watch: 1 },
    { kind: 'companion', type: 'Kept companion', name: 'a private household', work: 'kept as the owner\'s personal possession, dressed, displayed and used as the owner pleases', place: 'The private rooms of {owner}, {sys}', sells: 0.15, price: [15, 40], tips: [0.5, 120], hurt: 0.03, watch: 2 },
    { kind: 'ship', type: 'Crew thrall', name: 'a raider crew', work: 'scrubbing decks and bilges aboard a raider', place: 'Aboard the raider of {owner}, {sys}', sells: 0.3, price: [5, 10], tips: [0.35, 45], hurt: 0.06, watch: 1, exit: 'join' },
    { kind: 'pit', type: 'Pit fighter', name: 'a fighting stable', work: 'training for the pits, and fighting in them', place: 'The fighting pits, {sys}', sells: 0.2, price: [10, 25], tips: [0.2, 30], hurt: 0.1, watch: 2, exit: 'wins' },
];
export const OWNER_NAMES = ['Varro Kesh', 'Mother Ansa', 'Dray the Elder', 'Captain Ilse Morrow', 'Old Tannhauser', 'Sister Ruin', 'Boss Okonta', 'Kael Vantress', 'The Widow Sato', 'Jorun Half-Hand'];

/**
 * The parts of a station a person can be in. Work, lessons and yard business happen in one of
 * them, and getting from one to another takes time. when: only on stations that have it.
 */
export const STATION_AREAS = [
    { id: 'docks', name: 'Docks' },
    { id: 'yard', name: 'Shipyard', when: 'yard' },
    { id: 'works', name: 'Service levels' },
    { id: 'office', name: 'Port office' },
    { id: 'concourse', name: 'Concourse' },
    { id: 'school', name: 'Flight school', when: 'school' },
    { id: 'clinic', name: 'Clinic' },
    { id: 'habitat', name: 'Habitat ring' },
];
export const WORKS_NAME = { agricultural: 'Hydroponics decks', mining: 'Ore handling levels', refinery: 'Refinery levels', industrial: 'Factory levels', hightech: 'Laboratory decks', military: 'Arsenal levels', tourism: 'Service levels' };

/** Things that can happen in the middle of a shift, for the storyteller to play. */
export const SHIFT_INCIDENTS = [
    'a supervisor in a foul mood singles them out',
    'a co-worker offers a way to skim a little off the job, quietly',
    'something breaks and the whole crew is behind schedule',
    'a co-worker is hurt and someone has to deal with it',
    'a stranger comes asking questions about someone who works here',
    'a quiet stretch, and a co-worker who wants to talk',
    'an inspector turns up unannounced',
    'a customer or a captain makes a scene',
];
