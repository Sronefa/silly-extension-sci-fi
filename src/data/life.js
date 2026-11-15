// Life-sim data: shift work for people without a ship, station living costs, pilot licences,
// lenders, and the people who end up owning you if it all goes wrong.

/**
 * Shift jobs. pay is credits for an eight hour shift before skill and local conditions.
 * skill/min: the skill used and the level needed to be taken on. econ: where the job exists (all if absent).
 */
export const JOBS = [
    { id: 'cleaner', name: 'Hold cleaner', skill: 'athletics', min: 0, pay: 130, desc: 'Scrubbing tanks and holds between cargoes.' },
    { id: 'galley', name: 'Galley hand', skill: 'negotiation', min: 0, pay: 140, desc: 'Dishes, tables and drunk spacers.' },
    { id: 'dockhand', name: 'Dock hand', skill: 'athletics', min: 0, pay: 160, desc: 'Shifting cargo on the docks.' },
    { id: 'picker', name: 'Hydroponics picker', skill: 'survival', min: 0, pay: 150, econ: ['agricultural'], desc: 'Harvest work under grow lights.' },
    { id: 'sorter', name: 'Ore sorter', skill: 'athletics', min: 0, pay: 190, econ: ['mining', 'refinery'], desc: 'Hard, dusty, and the pay shows it.' },
    { id: 'line', name: 'Line worker', skill: 'engineering', min: 0, pay: 190, econ: ['industrial', 'refinery', 'military'], desc: 'A place on an assembly line.' },
    { id: 'guide', name: 'Tourist guide', skill: 'negotiation', min: 1, pay: 200, econ: ['tourism'], desc: 'Smile, walk backwards, know where the toilets are.' },
    { id: 'clerk', name: 'Warehouse clerk', skill: 'negotiation', min: 1, pay: 210, desc: 'Manifests, tallies and arguments with captains.' },
    { id: 'runner', name: 'Station courier', skill: 'streetwise', min: 1, pay: 220, desc: 'Packages across the station, no questions.' },
    { id: 'data', name: 'Data clerk', skill: 'electronics', min: 2, pay: 290, econ: ['hightech', 'industrial', 'tourism', 'agricultural'], desc: 'Cleaning records for people who cannot be bothered.' },
    { id: 'mechanic', name: "Mechanic's mate", skill: 'engineering', min: 2, pay: 300, desc: 'Passing tools in a repair bay, then holding them.' },
    { id: 'guard', name: 'Security shift', skill: 'firearms', min: 2, pay: 310, desc: 'Standing at a door with a sidearm.' },
    { id: 'tech', name: 'Electronics tech', skill: 'electronics', min: 3, pay: 340, desc: 'Fault finding on other people\'s systems.' },
    { id: 'medic', name: "Medic's aide", skill: 'medicine', min: 2, pay: 340, desc: 'Clinic work: dressings, scans, cleaning up.' },
    { id: 'lab', name: 'Lab assistant', skill: 'science', min: 3, pay: 360, econ: ['hightech', 'refinery', 'agricultural'], desc: 'Assays and sample runs.' },
    { id: 'welder', name: 'Yard welder', skill: 'engineering', min: 4, pay: 400, yard: true, desc: 'Hull work in a suit. Skilled, and paid like it.' },
    { id: 'copilot', name: 'Shuttle co-pilot', skill: 'pilot', min: 3, pay: 450, licence: 'basic', desc: 'Right-hand seat on the orbital runs.' },
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

export const OWNERS = [
    { kind: 'mine', name: 'a mining camp', work: 'hauling ore in a pressure suit that leaks', place: 'Slave pens, {sys} mining camp' },
    { kind: 'salvage', name: 'a salvage gang', work: 'cutting wrecks apart without a tether', place: 'Breaker hulk, {sys}' },
    { kind: 'estate', name: 'a warlord\'s household', work: 'serving in the household, at the owner\'s pleasure', place: 'The household of {owner}, {sys}' },
    { kind: 'ship', name: 'a raider crew', work: 'scrubbing decks and bilges aboard a raider', place: 'Aboard the raider of {owner}, {sys}' },
    { kind: 'pit', name: 'a fighting stable', work: 'training for the pits, and fighting in them', place: 'The fighting pits, {sys}' },
];
export const OWNER_NAMES = ['Varro Kesh', 'Mother Ansa', 'Dray the Elder', 'Captain Ilse Morrow', 'Old Tannhauser', 'Sister Ruin', 'Boss Okonta', 'Kael Vantress', 'The Widow Sato', 'Jorun Half-Hand'];
