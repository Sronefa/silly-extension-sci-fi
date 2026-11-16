// Contract kinds, the clients who post them, and the numbers behind the pay.
// Pay is set so that honest work with a small ship earns a little more than a skilled shift
// worker once fuel, wear, fees and the loan are paid. Risky kinds pay better.

/** Who posts work, by faction. Corporations and offices with a name and a habit. */
export const CLIENTS = {
    accord: ['Accord Postal Service', 'Halvorsen Freight Lines', 'Ministry of Supply', 'Solace Medical Trust', 'Accord Cartographic Office', 'Okafor and Daughters'],
    combine: ['Kepler Logistics', 'Combine Resource Directorate', 'Tanaka Heavy Industries', 'Brandt Mining Consolidated', 'Morrow Insurance Salvage Desk', 'Vostok Chemical'],
    compact: ['Free Worlds Relief', 'Ibarra Cooperative', 'Frontier Haulers Guild', 'Lindqvist Prospecting', 'Compact Survey Bureau', 'Reyes Family Holdings'],
    hegemony: ['Office of Provision', 'Holy Ardent Quartermaster', 'Thessaly Foundries', 'Corvin Mission Society', 'Ardent Survey Corps'],
    ashen: ['A man called Hadley', 'The Zheng clan', 'Nobody you should name', 'Adeyemi\'s crew', 'The Quiet Exchange'],
};

/**
 * min: standing needed with the client's faction to be offered it. ship: needs a ship of your own.
 * armed: needs a weapon fitted. risk: 0 to 3, shown on the board.
 */
export const KINDS = {
    haul: { name: 'Freight haul', icon: 'fa-boxes-stacked', min: -20, ship: true, risk: 0, desc: 'Carry the client\'s cargo to another station before the deadline. You put down a deposit against it.' },
    courier: { name: 'Courier run', icon: 'fa-envelope', min: -10, ship: false, risk: 0, desc: 'Carry a sealed package by hand. Any ship or berth will do.' },
    passengers: { name: 'Passenger charter', icon: 'fa-people-group', min: -10, ship: true, risk: 0, desc: 'Carry paying passengers. Needs passenger cabins.' },
    ore: { name: 'Ore quota', icon: 'fa-gem', min: -20, ship: true, risk: 1, desc: 'Deliver ore to this station by the deadline, from any source. Paid above the market.' },
    escort: { name: 'Escort', icon: 'fa-shield-halved', min: 0, ship: true, armed: true, risk: 2, desc: 'Fly alongside the client\'s ship to another system. Raiders may try their luck.' },
    bounty: { name: 'Bounty', icon: 'fa-crosshairs', min: 10, ship: true, armed: true, risk: 3, desc: 'A named raider operates in a nearby system. Find them and beat them.' },
};

// Pay figures (credits).
export const PAY = {
    haulBase: 12, haulPerLy: 1.0,          // per tonne
    courierBase: 260, courierPerLy: 22,
    paxBase: 40, paxPerLy: 6,              // per passenger
    oreMarkup: 1.15,                       // over the station's buying price
    escortBase: 900, escortPerLy: 45,
    bountyByHull: 9,                       // per point of the target's hull
};

/** Share of the cargo's value held as a deposit. */
export const DEPOSIT = 0.25;
/** Late deliveries within this many days are still taken, at half pay. */
export const GRACE_DAYS = 3;
/** Standing gained and lost with the client's faction. */
export const STANDING = { done: 3, late: -2, failed: -8, abandoned: -6 };

/** Boards list this many offers, more at busy stations. */
export const BOARD_SIZE = [3, 4, 5, 6, 7, 8];
