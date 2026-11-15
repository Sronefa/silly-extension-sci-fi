// Port services and the cost of keeping a ship: fuel, stores, ammunition, yard repairs,
// maintenance part by part, docking fees and crew wages.
import { S, addLog } from '../core/state.js';
import { settings } from '../core/st.js';
import { getGalaxy } from './galaxy.js';
import { clamp, uid } from '../core/util.js';
import { SHIP_SYSTEMS } from '../data/catalog.js';
import { VESSELS, SC_WEAPONS } from '../data/vessels.js';
import { MODULES } from '../data/modules.js';
import { DOCK_FEE, SIZE_COST, SERVICE_RATE, WEAR_RATE, WEAR_PARTS, ammoUnitPrice, WEEK, DAY } from '../data/economy.js';
import { econ, ledger, tradingPost, marketAt, stationKey, vendorMod, onEconomyDay } from './market.js';
import { effectiveClass } from './refit.js';
import { skillOf, skillCheck } from './character.js';
import { advanceTime } from './sim.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
export const hullSize = (st) => VESSELS[st.ship?.classId]?.size ?? 2;
const sizeCost = (st) => SIZE_COST[hullSize(st)] ?? 1;

/** The station the player is docked at, market or not. */
export function port(st = S()) {
    if (!st || st.transit || !st.loc.docked) return null;
    const sys = getGalaxy(st.seed).systems[st.loc.system];
    const idx = sys.stations[st.loc.station] ? st.loc.station : 0;
    return { key: stationKey(sys.id, idx), sys, station: sys.stations[idx], idx };
}

/** A ship in the service of a power pays nothing in that power's military ports. */
export function freePort(st, p = port(st)) {
    const f = st.service?.faction;
    return !!(f && p && p.sys.faction === f && (p.sys.economy === 'military' || p.sys.capital));
}

/** Forced charges (fees, wages) come out of credits; what cannot be paid becomes debt. */
function charge(st, amount, text) {
    amount = Math.round(amount);
    if (amount <= 0) return 0;
    const paid = Math.min(Math.max(0, st.captain.credits), amount);
    st.captain.credits -= paid;
    ledger(st, text, -amount);
    if (paid < amount) {
        st.captain.debt = (st.captain.debt ?? 0) + (amount - paid);
        addLog(`${text}: ${fmt(amount - paid)} cr could not be paid and has been added to your debt.`, 'trade');
    }
    return amount;
}

function spend(st, amount, text) {
    amount = Math.round(amount);
    if (amount > st.captain.credits) throw new Error(`that costs ${fmt(amount)} cr`);
    st.captain.credits -= amount;
    if (amount) ledger(st, text, -amount);
}

// ---- Prices that follow the local market ----

function localPrice(st, p, goodId, fallback) {
    const row = marketAt(st, p.key).find(r => r.good.id === goodId);
    // A port that does not trade the good still has it for its own customers, at a premium.
    return row ? row.buy : fallback * 1.25 * (1 + vendorMod(st, p.key));
}

export function storePrices(st = S()) {
    const p = port(st);
    if (!p) return null;
    const free = freePort(st, p);
    return {
        free,
        fuel: free ? 0 : Math.max(8, Math.round(localPrice(st, p, 'fuelcells', 150) * 0.22)),
        supplies: free ? 0 : Math.max(4, Math.round(3 + localPrice(st, p, 'food', 45) * 0.2)),
        parts: free ? 0 : Math.max(60, Math.round(localPrice(st, p, 'shipparts', 380) * 0.5)),
        sellsParts: p.station.services.includes('repair') || p.station.services.includes('shipyard'),
        munitions: localPrice(st, p, 'munitions', 440) / 440,
        alloys: localPrice(st, p, 'alloys', 120) / 120,
        shipparts: localPrice(st, p, 'shipparts', 380) / 380,
    };
}

export function buyStore(kind, qty) {
    const st = S();
    if (!st.ship) throw new Error('you have no ship to load');
    const sp = storePrices(st);
    if (!sp) throw new Error('dock at a station first');
    const ship = st.ship;
    if (kind === 'fuel') {
        qty = Math.min(qty, Math.round((ship.maxFuel - ship.fuel) * 10) / 10);
        if (qty <= 0) throw new Error('tanks are full');
        spend(st, qty * sp.fuel, `Fuel, ${qty} units`);
        ship.fuel = Math.round((ship.fuel + qty) * 10) / 10;
        return `Took on ${qty} fuel${sp.free ? ' (issued)' : ` for ${fmt(qty * sp.fuel)} cr`}`;
    }
    if (kind === 'supplies') {
        qty = Math.floor(qty);
        if (qty <= 0) throw new Error('nothing to load');
        spend(st, qty * sp.supplies, `Supplies, ${qty} crew-days`);
        ship.supplies += qty;
        return `Loaded ${qty} crew-days of supplies${sp.free ? ' (issued)' : ` for ${fmt(qty * sp.supplies)} cr`}`;
    }
    if (kind === 'parts') {
        qty = Math.floor(qty);
        if (!sp.sellsParts) throw new Error('this station has no chandler for ship parts');
        if (qty <= 0) throw new Error('nothing to load');
        spend(st, qty * sp.parts, `Spare parts, ${qty}`);
        ship.parts += qty;
        return `Loaded ${qty} spare parts${sp.free ? ' (issued)' : ` for ${fmt(qty * sp.parts)} cr`}`;
    }
    throw new Error('use: fuel, supplies or parts');
}

// ---- Ammunition ----

/** Every magazine on the ship, how full it is, and what it costs to fill here. */
export function magazines(st = S()) {
    const cls = st?.ship ? effectiveClass(st) : null;
    if (!cls) return [];
    const p = port(st);
    const sp = p ? storePrices(st) : null;
    const standing = p ? (st.reputation?.[p.sys.faction] ?? 0) : 0;
    const lawless = p ? (p.sys.security <= 1 || p.sys.faction === 'ashen') : false;
    const yard = p ? (p.station.services.includes('repair') || p.station.services.includes('shipyard') || p.sys.economy === 'military') : false;
    return cls.mounts.map((mt, n) => {
        const def = SC_WEAPONS[mt.id];
        if (!def || def.ammo == null) return null;
        const key = `${n}:${mt.id}`;
        const cur = clamp(st.ship.scAmmo?.[key] ?? def.ammo, 0, def.ammo);
        const missing = def.ammo - cur;
        const legal = MODULES[mt.id]?.legal ?? 'restricted';
        let unit = ammoUnitPrice(def) * (sp?.munitions ?? 1), why = '';
        if (!p) why = 'not docked';
        else if (sp.free) unit = 0;
        else if (!yard) why = 'no armourer at this station';
        else if (legal === 'restricted' || legal === 'state') why = 'military issue only';
        else if (legal === 'licensed' && lawless) unit *= 1.6;
        else if (legal === 'licensed' && standing < 20) why = 'licensed: needs standing 20 here';
        return { key, n, id: mt.id, name: def.name, cur, max: def.ammo, missing, unit: Math.ceil(unit), cost: Math.ceil(unit * missing), why, loads: def.kind === 'kinetic' && !def.fixed };
    }).filter(Boolean);
}

export function restock(key) {
    const st = S();
    const list = magazines(st).filter(m => m.missing > 0 && (key === 'all' ? !m.why : m.key === key));
    if (!list.length) throw new Error(key === 'all' ? 'nothing here can be restocked' : 'that magazine is full');
    const bad = list.find(m => m.why);
    if (bad) throw new Error(bad.why);
    const cost = list.reduce((s, m) => s + m.cost, 0);
    spend(st, cost, `Ammunition: ${list.map(m => m.name).join(', ')}`);
    st.ship.scAmmo ??= {};
    for (const m of list) st.ship.scAmmo[m.key] = m.max;
    return `Magazines filled: ${list.map(m => m.name).join(', ')}${cost ? ` for ${fmt(cost)} cr` : ' (issued)'}`;
}

// ---- Wear ----

export function wearOf(st = S()) {
    const w = (st.ship.wear ??= {});
    for (const p of WEAR_PARTS) w[p.id] ??= 0;
    return w;
}

export const wearLabel = (v) => (v >= 75 ? 'overdue' : v >= 50 ? 'due' : v >= 25 ? 'fair' : 'good');
/** Worn drives burn more fuel: up to a quarter more. */
export const fuelMult = (st = S()) => (st?.ship ? 1 + Math.max(0, (st.ship.wear?.engines ?? 0) - 50) / 200 : 1);

function wearTick(st, mins) {
    if (!st.ship) return;
    const w = wearOf(st);
    const days = mins / DAY;
    for (const p of WEAR_PARTS) {
        const r = WEAR_RATE[p.id];
        w[p.id] = clamp(w[p.id] + days * r.day, 0, 100);
    }
    // A battle ages a ship faster than a month of cruising.
    const rep = st.lastShipCombat;
    if (rep && !rep.worn) {
        rep.worn = true;
        w.weapons = clamp(w.weapons + 8, 0, 100);
        w.shields = clamp(w.shields + 6, 0, 100);
        w.engines = clamp(w.engines + 4, 0, 100);
        w.reactor = clamp(w.reactor + 4, 0, 100);
        w.structure = clamp(w.structure + 5, 0, 100);
    }
}

/** Time under way is what wears drives and reactor. Charged when the ship arrives. */
export function transitWear(st, hours) {
    if (!st.ship) return;
    const w = wearOf(st);
    for (const p of WEAR_PARTS) w[p.id] = clamp(w[p.id] + (hours / 24) * WEAR_RATE[p.id].transit, 0, 100);
}

const FAULTS = {
    reactor: 'A coolant pump on the reactor has failed',
    engines: 'A drive injector has burned out',
    shields: 'A shield emitter has shorted',
    weapons: 'A weapon mount has seized in its ring',
    sensors: 'The sensor array has lost calibration',
    lifesupport: 'A scrubber bank in life support has clogged',
    structure: 'A hull frame has cracked along an old weld',
};

function faultDay(st) {
    if (!st.ship || st.shipCombat) return;
    const w = wearOf(st);
    for (const p of WEAR_PARTS) {
        if (w[p.id] <= 60) continue;
        const chance = (w[p.id] - 60) / 40 * 0.06 * (st.transit ? 2 : 1);
        if (Math.random() > chance) continue;
        const hit = 8 + Math.floor(Math.random() * 18);
        if (p.id === 'structure') st.ship.hull = Math.max(1, st.ship.hull - Math.round(st.ship.maxHull * hit / 200));
        else st.ship.systems[p.id] = Math.max(0, (st.ship.systems[p.id] ?? 100) - hit);
        addLog(`${FAULTS[p.id]}: overdue maintenance (${p.name.toLowerCase()} wear ${Math.round(w[p.id])}%).`, 'ship');
        st.pendingEvent ??= `${FAULTS[p.id]} aboard the ${st.ship.name}, the result of maintenance left too long. ${p.name} is now degraded. Work this breakdown into the scene.`;
    }
}

// ---- Yard work: paid up front, done in story time ----

export const hasYard = (p) => !!p && (p.station.services.includes('repair') || p.station.services.includes('shipyard'));

/** Everything the yard here could do to the ship, with cost and hours. */
export function yardQuotes(st = S()) {
    const p = port(st);
    if (!st.ship || !p) return [];
    const sp = storePrices(st);
    const mult = sp.free ? 0 : 1;
    const queued = new Set((st.ship.yard ?? []).map(j => `${j.kind}:${j.id}`));
    const out = [];
    const hullGap = st.ship.maxHull - st.ship.hull;
    if (hullGap >= 1) out.push({ kind: 'hull', id: 'hull', label: `Hull repair (${Math.round(hullGap)} points)`, cost: hullGap * 4 * sp.alloys * mult, hours: Math.max(1, Math.ceil(hullGap / 12)) });
    for (const s of SHIP_SYSTEMS) {
        const gap = 100 - (st.ship.systems[s.id] ?? 100);
        if (gap >= 1) out.push({ kind: 'system', id: s.id, label: `Repair ${s.name.toLowerCase()} (${Math.round(gap)}% damaged)`, cost: gap * 12 * sizeCost(st) * sp.shipparts * mult, hours: Math.max(1, Math.ceil(gap / 6)) });
    }
    const w = wearOf(st);
    for (const part of WEAR_PARTS) {
        if (w[part.id] < 5) continue;
        out.push({ kind: 'service', id: part.id, label: `Service ${part.name.toLowerCase()} (wear ${Math.round(w[part.id])}%)`, cost: w[part.id] * SERVICE_RATE[part.id] * sizeCost(st) * sp.shipparts * mult, hours: Math.max(1, Math.ceil(w[part.id] / 8)) });
    }
    return out.filter(q => !queued.has(`${q.kind}:${q.id}`)).map(q => ({ ...q, cost: Math.round(q.cost) }));
}

export function orderYard(kind, id) {
    const st = S();
    const p = port(st);
    if (!hasYard(p)) throw new Error('this station has no repair yard');
    const list = yardQuotes(st).filter(x => (kind === 'all' ? true : kind === 'allservice' ? x.kind === 'service' : kind === 'allrepair' ? x.kind !== 'service' : x.kind === kind && x.id === id));
    if (!list.length) throw new Error('nothing to do');
    const total = list.reduce((s, q) => s + q.cost, 0);
    spend(st, total, list.length === 1 ? `Yard: ${list[0].label}` : `Yard: ${list.length} jobs`);
    const yard = (st.ship.yard ??= []);
    let at = Math.max(st.minutes, ...yard.map(j => j.end));
    for (const q of list) {
        at += q.hours * 60;
        yard.push({ uid: uid('job'), kind: q.kind, id: q.id, label: q.label, cost: q.cost, end: at, key: p.key });
    }
    const hours = Math.round((at - st.minutes) / 60);
    addLog(`Yard work ordered at ${p.station.name}: ${list.map(q => q.label).join('; ')}. ${fmt(total)} cr, ready in ${hours} h.`, 'ship');
    return `Yard work ordered: ${list.length} job${list.length > 1 ? 's' : ''}, ${total ? `${fmt(total)} cr` : 'no charge'}, ready in ${hours} h`;
}

function finishJob(st, job) {
    if (job.kind === 'hull') { st.ship.hull = st.ship.maxHull; delete st.ship.scRooms; }
    else if (job.kind === 'system') st.ship.systems[job.id] = 100;
    else if (job.kind === 'service') wearOf(st)[job.id] = 0;
    addLog(`Yard work finished: ${job.label.replace(/ \(.*\)$/, '')}.`, 'ship');
}

function yardTick(st) {
    const yard = st.ship?.yard;
    if (!yard?.length) return;
    const p = port(st);
    const here = yard.filter(j => p && j.key === p.key);
    const away = yard.filter(j => !here.includes(j));
    if (away.length) {
        // The ship left before the work was done: the yard keeps its labour and returns the rest.
        const refund = Math.round(away.reduce((s, j) => s + j.cost, 0) * 0.6);
        st.captain.credits += refund;
        if (refund) ledger(st, 'Yard work cancelled, part refund', refund);
        addLog(`Left the yard with ${away.length} job${away.length > 1 ? 's' : ''} unfinished${refund ? `: ${fmt(refund)} cr refunded` : ''}.`, 'ship');
    }
    const left = [];
    for (const j of here) {
        if (j.end <= st.minutes) finishJob(st, j);
        else left.push(j);
    }
    st.ship.yard = left;
}

// ---- Work the crew can do without a yard ----

function engineer(st) {
    return [st.captain, ...st.crew].sort((a, b) => skillOf(b, 'engineering') - skillOf(a, 'engineering'))[0];
}

export function fieldWork(kind, id) {
    const st = S();
    const ship = st.ship;
    if (!ship) throw new Error('you have no ship');
    if (st.shipCombat || st.combat) throw new Error('not in the middle of a fight');
    if (ship.parts < 1) throw new Error('no spare parts aboard');
    const eng = engineer(st);
    if (kind === 'service') {
        const w = wearOf(st);
        const part = WEAR_PARTS.find(p => p.id === id);
        if (!part) throw new Error('unknown part');
        if (w[id] <= 30) throw new Error('nothing more can be done for it without a yard');
        ship.parts -= 1;
        advanceTime(180);
        const r = skillCheck(eng, 'engineering', 11);
        const gain = r.success ? 15 : 5;
        w[id] = Math.max(30, w[id] - gain);
        const text = `${eng.name} serviced the ${part.name.toLowerCase()} (3 h, one spare part): wear now ${Math.round(w[id])}%${r.success ? '' : '. A clumsy job'}.`;
        addLog(text, 'ship');
        return text;
    }
    if (kind === 'system') {
        const s = SHIP_SYSTEMS.find(x => x.id === id);
        if (!s) throw new Error('unknown system');
        if (ship.systems[id] >= 70) throw new Error('field repairs cannot do better than this: it needs a yard');
        ship.parts -= 1;
        advanceTime(120);
        const r = skillCheck(eng, 'engineering', 12);
        ship.systems[id] = Math.min(70, ship.systems[id] + (r.success ? 12 : 4));
        const text = `${eng.name} patched the ${s.name.toLowerCase()} (2 h, one spare part): now ${Math.round(ship.systems[id])}%${r.success ? '' : '. It barely took'}.`;
        addLog(text, 'ship');
        return text;
    }
    if (kind === 'hull') {
        if (ship.hull >= ship.maxHull * 0.5) throw new Error('patches will not make this hull any sounder: it needs a yard');
        ship.parts -= 1;
        advanceTime(180);
        const r = skillCheck(eng, 'engineering', 12);
        ship.hull = Math.min(ship.maxHull * 0.5, ship.hull + ship.maxHull * (r.success ? 0.05 : 0.02));
        const text = `${eng.name} welded patches over the worst of the hull damage (3 h, one spare part): hull ${Math.round(ship.hull)}/${ship.maxHull}.`;
        addLog(text, 'ship');
        return text;
    }
    throw new Error('use: service, system or hull');
}

// ---- Docking fees and wages ----

export function dockFee(st = S(), p = port(st)) {
    if (!st.ship || !p || freePort(st, p)) return 0;
    return Math.round((DOCK_FEE[hullSize(st)] ?? 40) * (0.6 + 0.2 * p.sys.security));
}

function dockTick(st) {
    const e = econ(st);
    const p = port(st);
    if (!st.ship || !p) { e.dock = null; return; }
    if (!e.dock || e.dock.key !== p.key) e.dock = { key: p.key, since: st.minutes, paid: 0 };
    const due = Math.floor((st.minutes - e.dock.since) / DAY) + 1;
    const fee = dockFee(st, p);
    while (e.dock.paid < due) {
        e.dock.paid++;
        if (fee) charge(st, fee, `Docking fee, ${p.station.name}`);
    }
}

export const weeklyWages = (st = S()) => st.crew.reduce((s, c) => s + (c.wage ?? 60) * 7, 0);

function wageTick(st) {
    const e = econ(st);
    while (st.minutes >= e.payday) {
        e.payday += WEEK;
        if (!settings().wages || !st.crew.length) continue;
        // Crew of a ship in service are paid by the service, not by the player.
        if (st.service?.faction && !st.ship) continue;
        const due = weeklyWages(st);
        if (!due) continue;
        if (st.captain.credits >= due) {
            st.captain.credits -= due;
            ledger(st, `Crew wages, ${st.crew.length} aboard`, -due);
            addLog(`Pay day: ${fmt(due)} cr in wages paid to ${st.crew.length} crew.`, 'trade');
            e.missedPay = 0;
        } else {
            e.owedWages += due;
            e.missedPay = (e.missedPay ?? 0) + 1;
            ledger(st, 'Crew wages unpaid', 0);
            addLog(`Pay day missed: the crew are owed ${fmt(e.owedWages)} cr.`, 'trade');
            const leaving = e.missedPay >= 2 ? st.crew.filter(() => Math.random() < 0.3) : [];
            st.pendingEvent ??= `It is pay day and ${st.captain.name} cannot pay the crew, who are now owed ${fmt(e.owedWages)} credits${e.missedPay > 1 ? ` after ${e.missedPay} missed weeks` : ''}. ${leaving.length ? `${leaving.map(c => c.name).join(' and ')} ${leaving.length > 1 ? 'have' : 'has'} had enough and intend${leaving.length > 1 ? '' : 's'} to leave at the next port. ` : ''}Play out their reaction.`;
        }
    }
}

export function payOwedWages() {
    const st = S();
    const e = econ(st);
    if (!e.owedWages) throw new Error('the crew are owed nothing');
    spend(st, e.owedWages, 'Back wages');
    const paid = e.owedWages;
    e.owedWages = 0;
    e.missedPay = 0;
    addLog(`Back wages paid: ${fmt(paid)} cr.`, 'trade');
    return `Back wages paid: ${fmt(paid)} cr`;
}

/** Runs on every advance of the clock. */
export function servicesTick(st, mins) {
    wearTick(st, mins);
    yardTick(st);
    dockTick(st);
    wageTick(st);
}

onEconomyDay((st) => faultDay(st));
