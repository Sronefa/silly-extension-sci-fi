// Money owed and what happens when it is not paid: loans from banks, the Combine and Ashen
// moneylenders, weekly payments, repossession, warrants, collectors, and the two places a
// bankrupt can end up. Bankruptcy is never game over: prison in policed space, slavery outside it.
import { S, addLog, adjust, fmtDate } from '../core/state.js';
import { getGalaxy } from './galaxy.js';
import { uid, clamp } from '../core/util.js';
import { LENDERS, OWNERS, OWNER_NAMES } from '../data/life.js';
import { WEEK, DAY } from '../data/economy.js';
import { VESSELS } from '../data/vessels.js';
import { econ, ledger } from './market.js';
import { skillCheck, skillOf, gainXp } from './character.js';
import { damagePart, randomPart } from './body.js';
import { book, registerActivity } from './activity.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const sysOf = (st) => getGalaxy(st.seed).systems[st.loc.system];

export function loans(st = S()) { return (st.loans ??= []); }
export const totalDebt = (st = S()) => Math.round(loans(st).reduce((s, l) => s + l.balance, 0));

/** Keeps the old single debt figure and the loan book telling the same story. */
export function reconcile(st) {
    const book = loans(st);
    const e = econ(st);
    const shown = Math.round(st.captain.debt ?? 0);
    const synced = e.debtSynced ?? 0;
    const diff = shown - synced;
    if (diff > 0) {
        // Debt that arrived from outside the loan book: a starting ship loan, or unpaid fees.
        if (!book.length && !e.debtInit) addLoan(st, st.ship ? 'bank' : 'shark', diff, { collateral: !!st.ship, quiet: true });
        else {
            const port = book.find(l => l.lender === 'port');
            if (port) { port.balance += diff; port.payment = Math.ceil(port.balance / LENDERS.port.weeks + port.balance * LENDERS.port.rate); }
            else addLoan(st, 'port', diff, { quiet: true });
        }
    } else if (diff < 0) {
        let pay = -diff;
        for (const l of [...book].sort((a, b) => b.rate - a.rate)) { const p = Math.min(pay, l.balance); l.balance -= p; pay -= p; }
    }
    e.debtInit = true;
    st.loans = book.filter(l => l.balance >= 1);
    st.captain.debt = totalDebt(st);
    e.debtSynced = st.captain.debt;
}

function addLoan(st, lender, amount, { collateral = false, quiet = false, weeks } = {}) {
    const def = LENDERS[lender];
    const n = weeks ?? def.weeks;
    const r = def.rate;
    const payment = Math.ceil(amount * r / (1 - Math.pow(1 + r, -n)));
    const loan = { id: uid('loan'), lender, faction: sysOf(st).faction, balance: Math.round(amount), rate: r, payment, next: st.minutes + WEEK, missed: 0, collateral, since: st.minutes };
    loans(st).push(loan);
    if (!quiet) addLog(`Loan taken from ${def.name.toLowerCase()}: ${fmt(amount)} cr, ${fmt(payment)} cr a week.`, 'trade');
    return loan;
}

/** What each lender would offer here and now. */
export function loanOffers(st = S()) {
    if (st.transit || !st.loc.docked || st.custody) return [];
    const sys = sysOf(st);
    const book = loans(st);
    const out = [];
    const has = (k) => book.some(l => l.lender === k);
    const standing = st.reputation?.[sys.faction] ?? 0;
    const bad = book.some(l => l.missed > 0) || (st.warrants ?? []).length;
    if (sys.security >= 3 && sys.faction !== 'ashen') {
        const max = bad || has('bank') ? 0 : Math.max(0, Math.round((4000 + 150 * Math.max(0, standing) + (st.ship ? shipWorth(st) * 0.5 : 0)) / 500) * 500);
        out.push({ lender: 'bank', max, why: bad ? 'your record shows missed payments' : has('bank') ? 'you already have a loan with the banks' : '', collateral: !!st.ship });
    }
    if (sys.faction === 'combine' && sys.security >= 2) out.push({ lender: 'corp', max: has('corp') || st.indenture ? 0 : 20000, why: has('corp') ? 'you already owe Combine Credit' : '' });
    if (sys.security <= 2 || sys.faction === 'ashen') out.push({ lender: 'shark', max: has('shark') || st.bounty ? 0 : 15000, why: has('shark') ? 'you already owe them' : st.bounty ? 'there is a price on your head' : '' });
    return out;
}

export function takeLoan(lender, amount) {
    const st = S();
    const offer = loanOffers(st).find(o => o.lender === lender);
    if (!offer) throw new Error('that lender does not do business here');
    amount = Math.round(amount);
    if (!(amount >= 500)) throw new Error('the smallest loan is 500 cr');
    if (amount > offer.max) throw new Error(offer.why || `they will lend at most ${fmt(offer.max)} cr`);
    const loan = addLoan(st, lender, amount, { collateral: lender === 'bank' && !!st.ship });
    st.captain.credits += amount;
    ledger(st, `Loan from ${LENDERS[lender].name}`, amount);
    reconcileAfter(st);
    return `${LENDERS[lender].name}: ${fmt(amount)} cr lent, ${fmt(loan.payment)} cr due every week`;
}

/** A loan made by a shipyard's bank against the hull being bought. */
export function financeShip(st, amount) {
    const loan = addLoan(st, 'bank', amount, { collateral: true, weeks: 104 });
    reconcileAfter(st);
    return loan;
}

function reconcileAfter(st) {
    st.captain.debt = totalDebt(st);
    econ(st).debtSynced = st.captain.debt;
}

export function repay(loanId, amount) {
    const st = S();
    const loan = loans(st).find(l => l.id === loanId);
    if (!loan) throw new Error('no such loan');
    if (st.custody) throw new Error('you have nothing to pay with');
    amount = Math.min(Math.round(amount), Math.ceil(loan.balance), Math.floor(st.captain.credits));
    if (amount <= 0) throw new Error('you have no credits to pay with');
    st.captain.credits -= amount;
    loan.balance -= amount;
    if (loan.balance < 1) { loan.balance = 0; loan.missed = 0; }
    ledger(st, `Paid ${LENDERS[loan.lender].name}`, -amount);
    if (loan.balance <= 0) {
        addLog(`Debt to ${LENDERS[loan.lender].name.toLowerCase()} cleared.`, 'trade');
        if (loan.lender === 'corp') st.indenture = null;
        if (loan.lender === 'shark') st.bounty = 0;
        st.warrants = (st.warrants ?? []).filter(w => w.loan !== loan.id);
    }
    st.loans = loans(st).filter(l => l.balance >= 1);
    reconcileAfter(st);
    return `Paid ${fmt(amount)} cr${loan.balance <= 0 ? ': that debt is cleared' : `, ${fmt(loan.balance)} cr still owed`}`;
}

// ---- What a ship is worth ----

export function shipWorth(st = S(), ship = st.ship) {
    if (!ship) return 0;
    const cls = VESSELS[ship.classId];
    const base = cls?.price ?? 80000;
    const wear = Object.values(ship.wear ?? {});
    const avgWear = wear.length ? wear.reduce((a, b) => a + b, 0) / wear.length : 0;
    const cond = 0.55 + 0.45 * (ship.hull / ship.maxHull);
    return Math.round(base * 0.62 * cond * (1 - avgWear / 250) / 100) * 100;
}

// ---- Pay day for every loan, and what missing it leads to ----

function loanWeek(st, loan) {
    const def = LENDERS[loan.lender];
    loan.balance = Math.round(loan.balance * (1 + loan.rate));
    let due = Math.min(loan.payment, loan.balance);
    if (st.custody) due = Infinity; // nothing can be paid from a cell
    if (st.captain.credits >= due) {
        st.captain.credits -= due;
        loan.balance -= due;
        loan.missed = 0;
        ledger(st, `Loan payment, ${def.name}`, -due);
        if (loan.balance < 1) addLog(`Final payment made: the debt to ${def.name.toLowerCase()} is cleared.`, 'trade');
        return;
    }
    if (st.custody) return; // debts are settled by what custody does to you, not by late fees
    loan.missed++;
    const fee = Math.round(loan.payment * (loan.lender === 'shark' ? 0.1 : 0.03));
    loan.balance += fee;
    addLog(`Missed payment to ${def.name.toLowerCase()} (${loan.missed} in a row). Late fee ${fmt(fee)} cr.`, 'trade');
    if (loan.missed < def.grace) {
        st.pendingEvent ??= `${st.captain.name} has missed a ${fmt(loan.payment)} cr payment to ${def.name.toLowerCase()} and receives a ${loan.lender === 'shark' ? 'quiet, unpleasant warning from one of their people' : 'formal demand'}.`;
        return;
    }
    if (loan.lender === 'bank') {
        if (loan.collateral && (st.ship || st.laidUp)) { loan.repo = true; addLog('The bank has issued a repossession order for your ship. It will be seized at any policed port.', 'trade'); }
        else if (loan.missed >= def.grace + 2) addWarrant(st, loan);
    } else if (loan.lender === 'port') {
        if (loan.missed >= def.grace + 2) addWarrant(st, loan);
    } else if (loan.lender === 'corp') {
        if (!st.indenture) {
            st.indenture = { loan: loan.id, since: st.minutes };
            addLog('Combine Credit has converted your debt into an indenture. Seventy percent of what you earn is theirs until it is paid.', 'trade');
            st.pendingEvent ??= `Combine Credit has enforced the default clause: ${st.captain.name} is now an indentured debtor. A compliance officer explains, pleasantly, that seventy percent of all future earnings are garnished, and that leaving Combine space will be treated as flight.`;
        }
        if (loan.missed >= def.grace + 4) addWarrant(st, loan);
    } else if (loan.lender === 'shark') {
        st.bounty = Math.round(loan.balance * 0.3);
        addLog(`The moneylenders have put a price on you: ${fmt(st.bounty)} cr, alive.`, 'trade');
    }
}

function addWarrant(st, loan) {
    st.warrants ??= [];
    if (st.warrants.some(w => w.loan === loan.id)) return;
    st.warrants.push({ loan: loan.id, faction: loan.faction, amount: Math.round(loan.balance), since: st.minutes });
    addLog(`A debtor's warrant has been issued in ${loan.faction} space for ${fmt(loan.balance)} cr.`, 'trade');
}

function seizeShip(st, loan) {
    const ship = st.ship ?? st.laidUp?.ship;
    const value = Math.round(shipWorth(st, ship) * 0.75); // a forced sale never fetches the full price
    const name = ship.name;
    if (st.ship) { st.ship = null; st.cargo = st.cargo.slice(0, 0); } else st.laidUp = null;
    loan.balance = Math.max(0, loan.balance - value);
    loan.collateral = false; loan.repo = false; loan.missed = 0;
    addLog(`The ${name} has been repossessed and sold for ${fmt(value)} cr against your debt.${loan.balance >= 1 ? ` ${fmt(loan.balance)} cr is still owed.` : ' The debt is cleared.'}`, 'trade');
    st.pendingEvent = `Bailiffs with a court order have seized the ${name} at the dock on behalf of the bank. ${st.captain.name} is put ashore with what they can carry.${loan.balance >= 1 ? ` The forced sale did not cover the loan: ${fmt(loan.balance)} credits are still owed.` : ''} Play out the seizure.`;
}

// ---- Custody ----

export function imprison(st, days, reason, { seize = true } = {}) {
    const sys = sysOf(st);
    days = clamp(Math.round(days), 3, 720);
    if (seize) strip(st, { toDebt: true });
    st.activity = null;
    st.custody = { type: 'prison', sys: sys.id, since: st.minutes, until: st.minutes + days * DAY, reason, trust: 0, cool: 0 };
    st.loc.docked = false;
    st.loc.place = `${sys.name} Penitentiary`;
    st.post = null;
    addLog(`Sentenced to ${days} days in the ${sys.name} Penitentiary: ${reason}.`, 'story');
    st.pendingEvent = `${st.captain.name} has been arrested and sentenced to ${days} days in the ${sys.name} Penitentiary for ${reason}.${seize ? ' Ship, cargo, money and belongings have all been seized.' : ''} The sentence is lived in story time, never skipped: play out intake, the cell block, the work details, the other prisoners and the guards.`;
}

/**
 * Sold. kind picks the sort of owner (see OWNERS); otherwise it is whoever was buying.
 * Whether this owner would ever sell you back to yourself is rolled here and is not known
 * to the slave until the owner trusts them enough to say.
 */
export function enslave(st, ownerName, { kind, sells } = {}) {
    // Slavers do not keep their stock where the law can see it.
    const g = getGalaxy(st.seed);
    if (sysOf(st).security > 1) {
        const here = sysOf(st);
        const dens = g.systems.filter(s => s.security <= 1).sort((a, b) => Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y));
        if (dens[0]) { st.transit = null; st.route = []; st.loc.system = dens[0].id; st.loc.station = 0; st.visited[dens[0].id] = true; }
    }
    const sys = sysOf(st);
    const o = OWNERS.find(x => x.kind === kind) ?? OWNERS[Math.floor(Math.random() * OWNERS.length)];
    const owner = ownerName || OWNER_NAMES[Math.floor(Math.random() * OWNER_NAMES.length)];
    strip(st, { toDebt: false });
    // Whoever sold you has been paid. Outlaw debts die with your freedom; banks write you off.
    st.loans = []; st.bounty = 0; st.indenture = null; st.warrants = [];
    reconcileAfter(st);
    st.activity = null;
    const price = (o.price[0] + Math.floor(Math.random() * (o.price[1] - o.price[0] + 1))) * 1000;
    st.custody = {
        type: 'slave', sys: sys.id, since: st.minutes, owner, kind: o.kind, work: o.work, price,
        sells: sells ?? Math.random() < o.sells, trust: 5, stash: 0, cool: 0, rescueDay: 0,
    };
    if (o.exit === 'term') st.custody.until = st.minutes + (180 + Math.floor(Math.random() * 220)) * DAY;
    if (o.exit === 'wins') { st.custody.wins = 0; st.custody.need = 5 + Math.floor(Math.random() * 4); st.custody.bout = st.minutes + 3 * DAY; }
    st.loc.docked = false;
    st.loc.place = o.place.replace('{sys}', sys.name).replace('{owner}', owner);
    st.post = null;
    st.crew = st.crew.filter(() => false);
    addLog(`Taken and sold. ${st.captain.name} is now the property of ${owner}.`, 'story');
    st.pendingEvent = `${st.captain.name} has been taken and sold as a slave to ${owner}, who runs ${o.name} in the ${sys.name} system. Everything they owned is gone. They are property now (${o.type.toLowerCase()}): ${o.work}. There is no time skip: play out this life day by day. ${exitsText(st.custody)}`;
}

export const ownerKind = (c) => OWNERS.find(x => x.kind === c.kind) ?? OWNERS[0];

/** The ways out, as the storyteller should know them. The owner's mind on selling is the owner's secret. */
function exitsText(c) {
    const o = ownerKind(c);
    const ways = ['escape', 'rescue by friends'];
    if (o.exit === 'term') ways.unshift('serving out the bond');
    if (o.exit === 'join') ways.unshift('being taken into the crew as one of them, if they come to respect the character');
    if (o.exit === 'wins') ways.unshift(`winning ${c.need} bouts in the pits, which by custom earns freedom`);
    return `Ways out: ${ways.join('; ')}. ${c.sells ? `${c.owner} could be brought to sell the character their freedom, once trust is high, for about ${fmt(c.price)} credits.` : `${c.owner} does NOT sell what they own: no offer of money will ever buy this character's freedom, and ${c.owner} says so if asked.`}`;
}
export { exitsText };

/** Takes everything. In prison the proceeds go against what is owed. */
function strip(st, { toDebt }) {
    let value = Math.max(0, st.captain.credits);
    const ship = st.ship ?? st.laidUp?.ship;
    if (ship) value += Math.round(shipWorth(st, ship) * 0.75);
    st.captain.credits = 0;
    st.ship = null; st.laidUp = null; st.cargo = []; st.craft = [];
    st.captain.inventory = [];
    if ('weapon' in st.captain) st.captain.weapon = 'fists';
    if ('armor' in st.captain) st.captain.armor = 'none';
    if (toDebt) {
        for (const l of loans(st).filter(x => x.lender !== 'shark')) { const p = Math.min(value, l.balance); l.balance -= p; value -= p; }
        st.loans = loans(st).filter(l => l.balance >= 1);
        reconcileAfter(st);
    }
}

export function release(st, how = 'released') {
    const c = st.custody;
    if (!c) throw new Error('not in custody');
    const sys = getGalaxy(st.seed).systems[c.sys];
    st.custody = null;
    st.activity = null;
    st.loc.place = '';
    st.loc.docked = how !== 'escaped';
    if (c.type === 'prison' && how === 'released') {
        // Time served settles the civil debts that put you there.
        st.loans = loans(st).filter(l => l.lender === 'shark');
        st.warrants = [];
        st.indenture = null;
        reconcileAfter(st);
        st.captain.credits += 200;
        adjust(st.reputation, sys.faction, -10, -100, 100);
        addLog(`Released from the ${sys.name} Penitentiary with 200 cr gate money and a record.`, 'story');
        st.pendingEvent = `${st.captain.name} has served the sentence and walks out of the ${sys.name} Penitentiary with 200 credits of gate money, the clothes they stand in and a criminal record. The debts that put them there are discharged.`;
    } else if (how === 'escaped') {
        if (c.type === 'prison') (st.warrants ??= []).push({ faction: sys.faction, amount: 0, escape: true, since: st.minutes });
        st.loc.place = c.type === 'prison' ? `On the run, ${sys.name}` : `Loose in ${sys.name}, hunted`;
        addLog(c.type === 'prison' ? `Escaped from the ${sys.name} Penitentiary. Wanted.` : `Escaped from ${c.owner}.`, 'story');
    } else {
        addLog(c.type === 'slave' ? `Free of ${c.owner}: ${how}.` : `Out of prison: ${how}.`, 'story');
    }
    return c;
}

/** Things a prisoner or a slave can do with a day. */
export function custodyAct(action, advanceTime) {
    const st = S();
    const c = st.custody;
    if (!c) throw new Error('you are a free person');
    const pc = st.captain;
    if (action === 'eat') {
        advanceTime(30);
        adjust(pc.needs, 'nourishment', c.type === 'prison' ? 45 : 30, 0, 100);
        adjust(pc.needs, 'hydration', 60, 0, 100);
        return c.type === 'prison' ? 'Ate in the mess hall' : 'Ate what was given';
    }
    if (action === 'work') {
        // The day's work is lived, hour by hour. There is nowhere to walk to: they take you.
        const a = book(st, { kind: 'detail', custody: true, need: 480, name: c.type === 'prison' ? 'Prison work detail' : `The day's work for ${c.owner}`, note: c.type === 'slave' ? `The work: ${c.work}.` : '' });
        a.on = true; a.started = st.minutes;
        st.pendingEvent ??= c.type === 'prison' ? `${pc.name} is marched out on an eight hour work detail. Play it: the task, the guards, the other prisoners.` : `${pc.name}'s working day begins: ${c.work}. Eight hours of it. Play it without softening it.`;
        return c.type === 'prison' ? 'Out on a work detail: eight hours, lived' : 'The working day begins: eight hours, lived';
    }
    if (action === 'fight') {
        if (c.kind !== 'pit') throw new Error('there is no fight to be had');
        if (st.activity) throw new Error('finish what you are doing first');
        if (c.bout > st.minutes) throw new Error(`the next bout is on ${fmtDate(c.bout)}`);
        advanceTime(45);
        c.bout = st.minutes + 4 * DAY;
        const dc = 11 + c.wins;
        const r = skillCheck(pc, 'melee', dc);
        gainXp(pc, 'melee', 8);
        damagePart(pc, randomPart(), r.success ? 5 + Math.floor(Math.random() * 15) : 20 + Math.floor(Math.random() * 25));
        if (!r.success) {
            c.trust = clamp(c.trust - 5, 0, 100);
            st.pendingEvent = `${pc.name} fought in the pits for ${c.owner} and lost (melee ${r.total} against ${dc}). They were beaten down in front of the crowd but live. Narrate the bout and the aftermath.`;
            return 'Lost the bout';
        }
        c.wins++;
        const purse = 80 + c.wins * 40;
        c.stash += purse;
        c.trust = clamp(c.trust + 8, 0, 100);
        if (c.wins >= c.need) {
            pc.credits += c.stash;
            release(st, 'freed by the custom of the pits');
            st.pendingEvent = `${pc.name} has won bout number ${c.wins} in the pits (melee ${r.total} against ${dc}). By the custom of the pits that is enough: the crowd calls for it and ${c.owner} strikes the collar off in front of them. ${pc.name} walks out free with ${fmt(pc.credits)} credits in purses. Narrate it.`;
            return 'Won, and won your freedom';
        }
        st.pendingEvent = `${pc.name} fought in the pits for ${c.owner} and won (melee ${r.total} against ${dc}): ${c.wins} of the ${c.need} victories that earn freedom. A purse of ${purse} credits is theirs to hide. Narrate the bout.`;
        return `Won the bout: ${c.wins} of ${c.need}`;
    }
    if (action === 'join') {
        if (c.kind !== 'ship') throw new Error('there is no crew to join');
        if (c.trust < 70) throw new Error('they would laugh at you. Earn their respect first');
        if (c.cool > st.minutes) throw new Error('not while you are in chains');
        advanceTime(60);
        const r = skillCheck(pc, skillOf(pc, 'firearms') >= skillOf(pc, 'melee') ? 'firearms' : 'melee', 12);
        if (!r.success) { c.trust = clamp(c.trust - 15, 0, 100); st.pendingEvent = `${pc.name} asked ${c.owner} to be taken into the raider crew and was put to the test (${r.name} ${r.total} against 12). They failed it, and were laughed back to the bilges. Narrate it.`; return 'They tested you and you failed'; }
        pc.credits += c.stash;
        adjust(st.reputation, 'ashen', 10, -100, 100);
        release(st, 'blooded into the crew');
        st.loc.docked = false;
        st.loc.place = `Aboard the raider of ${c.owner}`;
        st.pendingEvent = `${pc.name} asked to be taken into the raider crew and passed the test (${r.name} ${r.total} against 12). ${c.owner} has the collar struck off: they are no longer property but the newest and lowest hand of a raider crew, free to stay or to leave at the next port. Narrate it. If they take a post aboard, use the post command.`;
        return 'Blooded into the crew: free';
    }
    if (action === 'defy') {
        advanceTime(60);
        c.trust = clamp(c.trust - 15, 0, 100);
        damagePart(pc, randomPart(), 15 + Math.floor(Math.random() * 20));
        adjust(pc, 'stress', 10, 0, 100);
        st.pendingEvent ??= c.type === 'prison' ? `${pc.name} defied the guards and was beaten for it.` : `${pc.name} defied ${c.owner} and was punished for it.`;
        return 'Defiance was punished';
    }
    if (action === 'escape') {
        if (st.activity?.on) st.activity = null; // slipping away from the work is the attempt
        if (c.cool > st.minutes) throw new Error(c.type === 'prison' ? 'you are in solitary: no chance until they let you out' : 'you are chained and watched: no chance yet');
        advanceTime(120);
        const dc = (c.type === 'prison' ? 17 : 14 + ownerKind(c).watch) - Math.floor(c.trust / 25);
        const skill = skillOf(pc, 'stealth') >= skillOf(pc, 'athletics') ? 'stealth' : 'athletics';
        const r = skillCheck(pc, skill, dc);
        if (r.success) {
            release(st, 'escaped');
            st.pendingEvent = `${pc.name} has escaped ${c.type === 'prison' ? 'from prison' : `from ${c.owner}`} (${r.name} check ${r.total} against ${dc}). They are out, with nothing, and will be hunted. Narrate the escape and where it leaves them.`;
            return 'Escaped';
        }
        c.cool = st.minutes + 7 * DAY;
        c.trust = 0;
        damagePart(pc, randomPart(), 20 + Math.floor(Math.random() * 25));
        if (c.type === 'prison') c.until += 30 * DAY;
        st.pendingEvent = `${pc.name} tried to escape ${c.type === 'prison' ? 'from prison' : `from ${c.owner}`} and was caught (${r.name} check ${r.total} against ${dc}). ${c.type === 'prison' ? 'Thirty days are added to the sentence and a week in solitary follows.' : 'The punishment is brutal, and a week in chains follows.'} Narrate the attempt and the consequences.`;
        return 'The escape failed';
    }
    if (action === 'buy') {
        if (c.type !== 'slave') throw new Error('a sentence cannot be bought off');
        if (c.trust < 40) throw new Error(`${c.owner} will not hear a word about it from you yet`);
        if (!c.sells) { c.asked = true; advanceTime(15); c.trust = clamp(c.trust - 5, 0, 100); st.pendingEvent ??= `${pc.name} raised the question of buying their freedom. ${c.owner} made it plain: they do not sell what is theirs, at any price. Narrate the answer.`; throw new Error(`${c.owner} does not sell what is theirs. Not at any price`); }
        c.asked = true;
        if (c.stash < c.price) throw new Error(`${c.owner} names a price: ${fmt(c.price)} cr. You have hidden ${fmt(c.stash)} cr`);
        advanceTime(60);
        const r = skillCheck(pc, 'negotiation', 13 - Math.floor(c.trust / 30));
        if (!r.success) { c.cool = Math.max(c.cool, st.minutes + 3 * DAY); c.trust = clamp(c.trust - 10, 0, 100); st.pendingEvent ??= `${pc.name} offered ${c.owner} ${fmt(c.price)} credits for their freedom. ${c.owner} refused, and now wonders where a slave got that kind of money.`; return `${c.owner} refused`; }
        c.stash -= c.price;
        pc.credits += c.stash;
        release(st, 'freedom bought');
        st.pendingEvent = `${c.owner} has accepted ${fmt(c.price)} credits and struck the collar off: ${pc.name} is free, with ${fmt(pc.credits)} credits and nothing else. Narrate it.`;
        return 'Freedom bought';
    }
    throw new Error('use: eat, work, defy, escape, buy, fight or join');
}


registerActivity('detail', {
    half(st, a) {
        const c = st.custody;
        if (c) st.pendingEvent ??= c.type === 'prison' ? `Halfway through the work detail: something happens among the prisoners or with a guard. Play it.` : `Halfway through the day's work for ${c.owner}: an overseer, another slave, or the owner takes notice of ${st.captain.name}. Play it.`;
    },
    finish(st) {
        const c = st.custody, pc = st.captain;
        if (!c) return '';
        adjust(pc, 'stress', c.type === 'prison' ? 5 : 9, 0, 100);
        c.trust = clamp(c.trust + (c.type === 'prison' ? 2 : 3), 0, 100);
        if (c.type === 'prison') {
            pc.credits += 15;
            c.until -= Math.round(0.05 * DAY); // good conduct shaves a little off
            st.pendingEvent ??= `The work detail is over and ${pc.name} is marched back to the block. Close it in a line or two.`;
            return 'Worked a prison detail: 15 cr, and a mark for good conduct.';
        }
        const o = ownerKind(c);
        // Favours, errands and things that fall off tables: a trusted slave handles more of them.
        const tip = Math.random() < o.tips[0] ? Math.round((0.3 + Math.random()) * o.tips[1] * (1 + c.trust / 50)) : 0;
        c.stash += tip;
        let hurt = '';
        if (Math.random() < o.hurt) { damagePart(pc, ['larm', 'rarm', 'lleg', 'rleg'][Math.floor(Math.random() * 4)], 8 + Math.floor(Math.random() * 14)); hurt = ' The work hurt them today.'; }
        st.pendingEvent ??= `The working day for ${c.owner} is over.${hurt}${tip ? ` ${pc.name} managed to hide away ${tip} credits.` : ''} Close the day in a line or two.`;
        return `Worked the day for ${c.owner}${tip ? ` and hid away ${tip} cr` : ''}.${hurt}`;
    },
    stop(st) {
        const c = st.custody, pc = st.captain;
        if (!c) return '';
        c.trust = clamp(c.trust - 8, 0, 100);
        damagePart(pc, randomPart(), 6 + Math.floor(Math.random() * 10));
        st.pendingEvent ??= `${pc.name} stopped working before the day was done and was punished for it.`;
        return 'Downed tools, and was punished for it.';
    },
});

// ---- Getting caught ----

function arrivalChecks(st) {
    if (st.custody || st.transit) return;
    const sys = sysOf(st);
    const book = loans(st);
    // Repossession: any policed port will hold the ship for the bank.
    const repo = book.find(l => l.repo);
    if (repo && st.ship && st.loc.docked && sys.security >= 2 && sys.faction !== 'ashen') return seizeShip(st, repo);
    if (repo && st.laidUp && sys.id === Number(st.laidUp.key.split('.')[0])) return seizeShip(st, repo);
    // Warrants are served where the law is strong.
    const w = (st.warrants ?? []).find(x => x.faction === sys.faction);
    if (w && sys.security >= 3 && st.loc.docked && Math.random() < 0.5) {
        const owed = totalDebt(st);
        return imprison(st, w.escape ? 120 : clamp(owed / 400, 14, 365), w.escape ? 'escaping lawful custody' : `defaulting on ${fmt(owed)} cr of debt`);
    }
    // Indentured debtors who leave Combine space are treated as runaways.
    if (st.indenture && sys.faction !== 'combine' && st.minutes - st.indenture.since > 14 * DAY) {
        const loan = book.find(l => l.id === st.indenture.loan);
        if (loan) addWarrant(st, { ...loan, faction: 'combine' });
    }
    // A price on your head is collected where nobody is watching.
    if (st.bounty && sys.security <= 2 && st.loc.docked) {
        const shark = book.find(l => l.lender === 'shark');
        if (shark && shark.missed >= 5 && Math.random() < 0.12) return enslave(st);
        if (Math.random() < 0.15) st.pendingEvent ??= `Collectors working for the moneylenders have found ${st.captain.name}. Three of them, armed, in no hurry. They want ${fmt(Math.min(shark?.balance ?? st.bounty, st.captain.credits + 1))} credits now, or they will take it out of the character's hide. If it comes to violence, start the fight with a combat command.`;
    }
}

function rescueDay(st) {
    const c = st.custody;
    if (c?.type !== 'slave') return;
    // Friends who still care come looking. It takes time, and it is never certain.
    const friends = st.contacts.filter(x => x.standing >= 40).length;
    if (!friends || st.minutes - c.since < 10 * DAY) return;
    if (Math.random() < 0.01 * friends) {
        const who = st.contacts.filter(x => x.standing >= 40)[Math.floor(Math.random() * friends)];
        release(st, `rescued by ${who.name}`);
        st.pendingEvent = `${who.name} has found ${st.captain.name} and come for them. Narrate the rescue from ${c.owner}: it should cost something, and it leaves ${st.captain.name} free but with nothing.`;
    }
}

/** Runs on every advance of the clock. */
export function financeTick(st) {
    reconcile(st);
    for (const loan of loans(st)) {
        let guard = 0;
        while (st.minutes >= loan.next && loan.balance >= 1 && guard++ < 60) { loan.next += WEEK; loanWeek(st, loan); }
    }
    st.loans = loans(st).filter(l => l.balance >= 1);
    reconcileAfter(st);
    const c = st.custody;
    if (c?.type === 'prison' && st.minutes >= c.until) release(st, 'released');
    if (c?.type === 'slave' && c.until && st.minutes >= c.until) {
        st.captain.credits += c.stash;
        release(st, 'the bond is served');
        st.pendingEvent = `The term of ${st.captain.name}'s labour bond has run out. The contractor's clerk strikes the name from the book: they are free, with ${fmt(st.captain.credits)} credits put by and nothing else. Narrate it.`;
    }
    if (c) {
        // Custody feeds you badly but it feeds you: nobody starves to death in a cell.
        for (const n of ['nourishment', 'hydration']) if (st.captain.needs[n] < 12) st.captain.needs[n] = 12;
    }
    const e = econ(st);
    const day = Math.floor(st.minutes / DAY);
    if ((e.finDay ?? day) < day) { arrivalChecks(st); rescueDay(st); }
    e.finDay = day;
}

export { arrivalChecks };
