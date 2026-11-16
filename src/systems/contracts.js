// Contracts: paid work posted on a station's board, or offered in the story. The engine owns
// every number: pay, deposit, deadline, and whether the job was done. Nothing is completed by a
// click on its own: the cargo has to be carried, the system reached, the raider beaten, and the
// character has to be at the right place on the right station to hand it over.
import { S, addLog, galaxy, cargoUsed, cargoCap } from '../core/state.js';
import { getGalaxy, findRoute, systemDistance, factionById } from './galaxy.js';
import { makeRng, hash, pick, randInt, uid, clamp, norm, findByName } from '../core/util.js';
import { GOODS, goodById, DAY } from '../data/economy.js';
import { VESSELS } from '../data/vessels.js';
import { MODULES } from '../data/modules.js';
import { CLIENTS, KINDS, PAY, DEPOSIT, GRACE_DAYS, STANDING, BOARD_SIZE } from '../data/contracts.js';
import { stationKey, marketAt, handlingOk, ledger } from './market.js';
import { port } from './services.js';
import { areaOf } from './activity.js';
import { slotsOf, fitted } from './refit.js';
import { startShipCombat } from './shipcombat.js';
import { isAiCommand, advanceTime } from './sim.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const parseKey = (key) => String(key).split('.').map(Number);

export const contracts = (st = S()) => (st.contracts ??= []);
export const activeContracts = (st = S()) => contracts(st).filter(c => c.status === 'active');

function stationOf(st, key) {
    const [s, i] = parseKey(key);
    const sys = getGalaxy(st.seed).systems[s];
    return sys ? { sys, station: sys.stations[i] ?? sys.stations[0], key } : null;
}
export const placeName = (st, key) => { const p = stationOf(st, key); return p ? `${p.station.name}, ${p.sys.name}` : '?'; };

// ---- What the character's ship can take ----

export function paxCapacity(st = S()) {
    if (!st.ship) return 0;
    try { return slotsOf(st).reduce((n, slot) => n + (MODULES[fitted(st, slot)]?.fx?.passengers ?? 0), 0); } catch { return 0; }
}
const paxAboard = (st) => activeContracts(st).filter(c => c.kind === 'passengers' && c.loaded).reduce((n, c) => n + c.qty, 0);
const armed = (st) => !!st.ship && (st.ship.weapons ?? []).some(w => w.id !== 'pd');

/** Hours a trip of `ly` light years takes, the way this character travels. */
function tripHours(st, path) {
    const g = galaxy();
    let h = 0;
    for (let i = 0; i + 1 < path.length; i++) {
        const d = systemDistance(g, path[i], path[i + 1]);
        h += st.ship ? 4 + d * 1.5 : 10 + d * 2.5;
    }
    return h;
}

// ---- The board ----

function clientFor(rng, sys) {
    return pick(rng, CLIENTS[sys.faction] ?? CLIENTS.compact);
}

/** Offers on the board of a station, for the day. The same day always shows the same board. */
export function boardAt(st, key) {
    const here = stationOf(st, key);
    if (!here) return [];
    const day = Math.floor(st.minutes / DAY);
    const rng = makeRng(hash('board', st.seed, key, day));
    const g = getGalaxy(st.seed);
    const sys = here.sys;
    const n = BOARD_SIZE[clamp(sys.security, 0, 5)];
    // Destinations a few jumps away that have a market.
    const near = g.systems.filter(s => s.id !== sys.id).map(s => ({ s, r: findRoute(g, sys.id, s.id) })).filter(x => x.r && x.r.path.length <= 4);
    const market = (k) => marketAt(st, k).map(r => r.good);
    const local = market(key).filter(gd => gd.tier !== 'contraband');
    const out = [];
    const kinds = ['haul', 'haul', 'courier', 'passengers', 'ore', 'escort', 'bounty'];
    for (let i = 0; i < n * 2 && out.length < n; i++) {
        const kind = pick(rng, kinds);
        const id = `${key}:${day}:${i}`;
        const client = clientFor(rng, sys);
        const base = { id, kind, client, faction: sys.faction, from: key, posted: day };
        if (kind === 'bounty' && (sys.faction === 'ashen' || sys.security < 1)) continue;
        if (kind === 'ore' && !['industrial', 'refinery', 'hightech', 'military'].includes(sys.economy)) continue;
        if (kind === 'haul' || kind === 'courier' || kind === 'passengers' || kind === 'escort') {
            if (!near.length) continue;
            const dest = pick(rng, near);
            const to = stationKey(dest.s.id, randInt(rng, 0, dest.s.stations.length - 1));
            Object.assign(base, { to, toSys: dest.s.id, ly: dest.r.dist, jumps: dest.r.path.length - 1 });
            if (kind === 'haul') {
                if (!local.length) continue;
                const good = pick(rng, local);
                Object.assign(base, { good: good.id, qty: pick(rng, [5, 10, 15, 20, 30, 40, 60, 80]) });
            }
            if (kind === 'passengers') base.qty = randInt(rng, 1, 8);
            if (kind === 'escort') base.hull = pick(rng, ['mule', 'mule', 'barge', 'pathfinder']);
        }
        if (kind === 'ore') Object.assign(base, { good: rng() < 0.75 ? 'ore' : 'raremetals', qty: pick(rng, [20, 30, 40, 60, 80, 120]), days: randInt(rng, 7, 14) });
        if (kind === 'bounty') {
            const lanes = near.filter(x => x.r.path.length <= 3);
            if (!lanes.length) continue;
            const where = pick(rng, lanes);
            const hull = pick(rng, ['scrapjack', 'raider', 'raider', 'gunboat', 'frigate']);
            Object.assign(base, { toSys: where.s.id, ly: where.r.dist, jumps: where.r.path.length - 1, hull, target: `${pick(rng, ['Red', 'Grey', 'Lucky', 'Black', 'Hollow', 'Iron', 'Mad'])} ${pick(rng, ['Kesh', 'Marrow', 'Jonas', 'Vane', 'Sela', 'Doyle', 'Tamsin'])}` });
        }
        out.push(price(st, base));
    }
    const taken = st.contractsTaken ?? {};
    return out.filter(o => !taken[o.id]);
}

/** Sets pay, deposit and deadline. The same rules price board offers and offers made in the story. */
export function price(st, o) {
    const k = KINDS[o.kind];
    o.name = k.name;
    const path = o.toSys != null ? findRoute(galaxy(), parseKey(o.from)[0], o.toSys)?.path ?? [parseKey(o.from)[0], o.toSys] : null;
    const hours = path ? tripHours(st, path) : 0;
    if (o.kind === 'haul') {
        const good = goodById(o.good);
        o.pay = Math.round(o.qty * (PAY.haulBase + PAY.haulPerLy * o.ly));
        o.value = Math.round(o.qty * good.base);
        o.deposit = Math.round(o.value * DEPOSIT);
        o.title = `${o.qty} t ${good.name} to ${placeName(st, o.to)}`;
    }
    if (o.kind === 'courier') { o.pay = Math.round(PAY.courierBase + PAY.courierPerLy * o.ly); o.deposit = 0; o.title = `Sealed package to ${placeName(st, o.to)}`; }
    if (o.kind === 'passengers') { o.pay = Math.round(o.qty * (PAY.paxBase + PAY.paxPerLy * o.ly)); o.deposit = 0; o.title = `${o.qty} passenger${o.qty > 1 ? 's' : ''} to ${placeName(st, o.to)}`; }
    if (o.kind === 'escort') { o.pay = Math.round(PAY.escortBase + PAY.escortPerLy * o.ly); o.deposit = 0; o.title = `Escort the ${VESSELS[o.hull]?.name ?? 'freighter'} to ${placeName(st, o.to)}`; }
    if (o.kind === 'bounty') {
        o.pay = Math.round((VESSELS[o.hull]?.hull ?? 400) * PAY.bountyByHull);
        o.deposit = 0;
        o.title = `Bounty on ${o.target} (${VESSELS[o.hull]?.name ?? 'raider'}) in ${galaxy().systems[o.toSys].name}`;
    }
    if (o.kind === 'ore') {
        const row = marketAt(st, o.from).find(r => r.good.id === o.good);
        const per = Math.round((row?.sell ?? goodById(o.good).base) * PAY.oreMarkup);
        o.pay = per * o.qty;
        o.perT = per;
        o.deposit = 0;
        o.title = `${o.qty} t ${goodById(o.good).name} to ${stationOf(st, o.from)?.station.name}`;
    }
    const prep = o.kind === 'courier' ? 6 : 12;
    o.hours = o.days ? o.days * 24 : Math.round(hours * 1.5 + prep);
    o.risk = KINDS[o.kind].risk + (o.kind === 'haul' && o.value > 20000 ? 1 : 0);
    return o;
}

/** Why the character cannot take this offer, or ''. */
export function blocker(st, o) {
    const k = KINDS[o.kind];
    if (st.custody) return 'you are not free';
    if ((st.reputation[o.faction] ?? 0) < k.min) return `${factionById(o.faction)?.name ?? o.faction} will not deal with you`;
    if (k.ship && !st.ship) return 'needs a ship of your own';
    if (k.armed && !armed(st)) return 'needs an armed ship';
    if (o.kind === 'haul') {
        if (cargoCap(st) - cargoUsed(st) < o.qty) return `needs ${o.qty} t of free hold`;
        if (!handlingOk(st, goodById(o.good))) return 'needs the right hold fitting for this cargo';
    }
    if (o.kind === 'passengers' && paxCapacity(st) - paxAboard(st) < o.qty) return paxCapacity(st) ? 'not enough free cabins' : 'needs passenger cabins';
    if (o.deposit > st.captain.credits) return `needs a ${fmt(o.deposit)} cr deposit`;
    if (activeContracts(st).length >= 6) return 'you already have six jobs on';
    return '';
}

function startContract(st, o) {
    const c = { ...o, status: 'active', accepted: st.minutes, deadline: st.minutes + o.hours * 60 };
    if (c.deposit) { st.captain.credits -= c.deposit; ledger(st, `Deposit: ${c.title}`, -c.deposit); }
    if (c.kind === 'haul') {
        const good = goodById(c.good);
        st.cargo.push({ id: uid('it'), name: `Sealed freight: ${good.name} (${c.client})`, qty: c.qty, comId: null, contract: c.id });
    }
    if (c.kind === 'courier') st.captain.inventory.push({ id: uid('it'), name: `Sealed package for ${placeName(st, c.to)}`, qty: 1, contract: c.id });
    if (c.kind === 'passengers') c.loaded = true;
    if (c.kind === 'bounty') c.found = false;
    contracts(st).push(c);
    (st.contractsTaken ??= {})[c.id] = true;
    addLog(`Contract taken: ${c.title}. ${fmt(c.pay)} cr on completion${c.deposit ? `, ${fmt(c.deposit)} cr deposit paid` : ''}. Due by day ${Math.floor(c.deadline / DAY)}.`, 'trade');
    return c;
}

/** Signs for an offer on the board. The board is in the port office. */
export function accept(offerId) {
    const st = S();
    const p = port(st);
    if (!p) throw new Error('you need to be at a station');
    if (areaOf(st) !== 'office') throw new Error('contracts are signed at the port office');
    const o = boardAt(st, p.key).find(x => x.id === offerId) ?? (st.offers ?? []).find(x => x.id === offerId);
    if (!o) throw new Error('that offer is gone');
    const why = blocker(st, o);
    if (why) throw new Error(why);
    st.offers = (st.offers ?? []).filter(x => x.id !== offerId);
    const c = startContract(st, o);
    // Signing, and for freight, the loading at the docks, take their time.
    advanceTime(10 + (c.kind === 'haul' ? Math.ceil(c.qty / 2) : 0));
    return `Signed: ${c.title}`;
}

// ---- Handing over ----

/** What the character must do next for this contract, or '' when it can be handed over here. */
export function nextStep(st, c) {
    const p = port(st);
    const area = areaOf(st);
    const at = (key) => p && p.key === key;
    if (c.kind === 'haul' || c.kind === 'courier' || c.kind === 'passengers' || c.kind === 'escort') {
        if (c.kind === 'escort' && !c.arrived) return `fly with the client to ${galaxy().systems[c.toSys].name}`;
        if (!at(c.to)) return `go to ${placeName(st, c.to)}`;
        const where = c.kind === 'courier' || c.kind === 'escort' ? 'office' : 'docks';
        if (area !== where) return `go to the ${where === 'office' ? 'port office' : 'docks'}`;
        if (c.kind === 'haul' && !st.cargo.some(x => x.contract === c.id)) return 'the freight is no longer aboard';
        if (c.kind === 'courier' && !st.captain.inventory.some(x => x.contract === c.id)) return 'the package is lost';
        return '';
    }
    if (c.kind === 'ore') {
        if (!at(c.from)) return `go to ${placeName(st, c.from)}`;
        if (area !== 'docks') return 'go to the docks';
        const have = st.cargo.filter(x => x.comId === c.good).reduce((n, x) => n + x.qty, 0);
        if (have < c.qty) return `you hold ${have} of ${c.qty} t`;
        return '';
    }
    if (c.kind === 'bounty') {
        if (!c.won) return `find and beat ${c.target} in ${galaxy().systems[c.toSys].name}`;
        if (!p || p.sys.faction !== c.faction) return `claim it at any ${factionById(c.faction)?.name ?? ''} station`;
        if (area !== 'office') return 'go to the port office';
        return '';
    }
    return '';
}

export function deliver(id) {
    const st = S();
    const c = activeContracts(st).find(x => x.id === id);
    if (!c) throw new Error('no such contract');
    const step = nextStep(st, c);
    if (step) throw new Error(step);
    const late = st.minutes > c.deadline;
    if (c.kind === 'haul') st.cargo = st.cargo.filter(x => x.contract !== c.id);
    if (c.kind === 'courier') st.captain.inventory = st.captain.inventory.filter(x => x.contract !== c.id);
    if (c.kind === 'ore') {
        let left = c.qty;
        for (const x of st.cargo.filter(y => y.comId === c.good)) { const t = Math.min(left, x.qty); x.qty -= t; left -= t; if (!left) break; }
        st.cargo = st.cargo.filter(x => x.qty > 0);
    }
    advanceTime(10 + (c.kind === 'haul' || c.kind === 'ore' ? Math.ceil(c.qty / 2) : c.kind === 'passengers' ? 10 : 0));
    const pay = Math.round(late ? c.pay / 2 : c.pay);
    st.captain.credits += pay + (c.deposit || 0);
    ledger(st, `${late ? 'Late delivery' : 'Contract paid'}: ${c.title}`, pay);
    if (c.deposit) ledger(st, 'Deposit returned', c.deposit);
    standing(st, c, late ? STANDING.late : STANDING.done);
    c.status = 'done';
    c.closed = st.minutes;
    addLog(`Contract complete: ${c.title}. ${fmt(pay)} cr paid${late ? ' (late, half pay)' : ''}${c.deposit ? ' and the deposit returned' : ''}.`, 'trade');
    return { pay, late };
}

function standing(st, c, d) {
    st.reputation[c.faction] = clamp((st.reputation[c.faction] ?? 0) + d, -100, 100);
}

function fail(st, c, why, d = STANDING.failed) {
    c.status = 'failed';
    c.closed = st.minutes;
    c.why = why;
    standing(st, c, d);
    // Freight not handed back is stolen goods in the client's space until it is returned.
    if (c.kind === 'haul' && st.cargo.some(x => x.contract === c.id)) {
        (st.warrants ??= []).push({ faction: c.faction, amount: c.value, contract: c.id, reason: `theft of ${c.client}'s freight`, since: st.minutes });
    }
    if (c.kind === 'passengers') c.loaded = false;
    addLog(`Contract failed: ${c.title} (${why}).${c.deposit ? ` The ${fmt(c.deposit)} cr deposit is forfeit.` : ''}`, 'trade');
}

/** Walking away from a job. The deposit is gone and the client remembers. */
export function abandon(id) {
    const st = S();
    const c = activeContracts(st).find(x => x.id === id);
    if (!c) throw new Error('no such contract');
    fail(st, c, 'abandoned', STANDING.abandoned);
    return c;
}

/** Freight from a failed haul can still be handed back at the destination to clear the warrant. */
export function returnFreight(id) {
    const st = S();
    const c = contracts(st).find(x => x.id === id && x.status === 'failed' && x.kind === 'haul');
    if (!c) throw new Error('nothing to return');
    const p = port(st);
    if (!p || (p.key !== c.to && p.key !== c.from) || areaOf(st) !== 'docks') throw new Error(`take it to the docks at ${placeName(st, c.to)} or ${placeName(st, c.from)}`);
    st.cargo = st.cargo.filter(x => x.contract !== c.id);
    st.warrants = (st.warrants ?? []).filter(w => w.contract !== c.id);
    c.returned = true;
    addLog(`Returned ${c.client}'s freight. The theft complaint is withdrawn.`, 'trade');
}

// ---- The clock ----

export function contractsTick(st) {
    for (const c of activeContracts(st)) {
        if ((c.kind === 'escort' || c.kind === 'bounty') && c.fightAt != null && !st.shipCombat) {
            const r = st.lastShipCombat;
            if (r && r.at >= c.fightAt) {
                const won = r.result === 'victory' || r.result === 'enemy-withdrew' && c.kind === 'escort';
                c.fightAt = null;
                if (c.kind === 'bounty') {
                    if (r.result === 'victory') { c.won = true; addLog(`${c.target} is beaten. Claim the bounty at a ${factionById(c.faction)?.name} station.`, 'trade'); }
                    else { c.found = false; addLog(`${c.target} is still out there.`, 'trade'); }
                } else if (!won) fail(st, c, 'the client\'s ship was lost');
                if (c.status !== 'active') continue;
            }
        }
        const grace = ['haul', 'courier', 'ore'].includes(c.kind) ? GRACE_DAYS * DAY : 0;
        if (st.minutes > c.deadline + grace) fail(st, c, 'the deadline passed');
    }
}

/** Arriving in a system can bring the job to you: the raider you hunt, or the raiders hunting your client. */
export function contractsArrival(st) {
    const here = st.loc.system;
    const sys = galaxy().systems[here];
    for (const c of activeContracts(st)) {
        if (st.shipCombat || st.combat) return;
        if (c.kind === 'bounty' && c.toSys === here && !c.won && !c.found && Math.random() < 0.7) {
            c.found = true;
            c.fightAt = st.minutes;
            startShipCombat({ scene: `${sys.name}, hunting ${c.target}`, enemy: [{ cls: c.hull, count: 1, name: c.target }] });
            st.pendingEvent = `Sensors pick out ${c.target}'s ship in ${sys.name}: the bounty is here.`;
            return;
        }
        if (c.kind === 'escort') {
            if (c.toSys === here) c.arrived = true;
            const raid = sys.security <= 2 ? 0.45 : 0.12;
            if (!c.raided && Math.random() < raid) {
                c.raided = true;
                c.fightAt = st.minutes;
                const n = sys.security <= 1 ? 2 : 1;
                startShipCombat({ scene: `${sys.name}, raiders on the escort`, enemy: [{ cls: pick(Math.random, ['raider', 'gunboat', 'raider']), count: n }], ally: [{ cls: c.hull, count: 1, name: c.client }] });
                st.pendingEvent = `Raiders drop on the convoy in ${sys.name}: they want ${c.client}'s ship.`;
                return;
            }
        }
    }
}

// ---- Offered in the story ----

const KIND_WORDS = { haul: 'haul', freight: 'haul', cargo: 'haul', courier: 'courier', package: 'courier', parcel: 'courier', delivery: 'courier', passenger: 'passengers', passengers: 'passengers', ore: 'ore', mining: 'ore', escort: 'escort', bounty: 'bounty', hunt: 'bounty' };

/**
 * `contract <kind> "client" "destination" [qty N] [good "name"] [target "name"]`: the character
 * agreed to a job in the story. The engine sets pay, deposit and deadline, and refuses what it
 * cannot honour (no ship, no hold space, no deposit).
 */
export function storyContract(args) {
    const st = S();
    const [kw, client, dest, ...rest] = args;
    const kind = KIND_WORDS[norm(kw)];
    if (!kind) throw new Error(`use: contract <${Object.keys(KINDS).join('|')}> "client" "destination system or station"`);
    const opt = {};
    for (let i = 0; i < rest.length - 1; i += 2) opt[norm(rest[i])] = rest[i + 1];
    const here = st.transit ? null : port(st) ?? { key: stationKey(st.loc.system, 0), sys: galaxy().systems[st.loc.system] };
    if (!here) throw new Error('not while in transit');
    const g = galaxy();
    const o = { id: uid('ct'), kind, client: client || 'a private client', faction: here.sys.faction, from: here.key, story: true, posted: Math.floor(st.minutes / DAY) };
    if (kind !== 'ore') {
        const sys = findByName(g.systems, dest ?? '') ?? g.systems.find(s => s.stations.some(x => norm(x.name).includes(norm(dest ?? ''))));
        if (!sys) throw new Error(`unknown destination "${dest}"`);
        const r = findRoute(g, here.sys.id, sys.id);
        if (!r) throw new Error(`no lane route to ${sys.name}`);
        const idx = Math.max(0, sys.stations.findIndex(x => norm(x.name).includes(norm(dest ?? ''))));
        Object.assign(o, { toSys: sys.id, to: stationKey(sys.id, idx), ly: r.dist, jumps: r.path.length - 1 });
    }
    if (kind === 'haul') {
        const good = findByName(GOODS, opt.good ?? '') ?? goodById('consumer');
        Object.assign(o, { good: good.id, qty: clamp(Number(opt.qty) || 10, 1, 200) });
    }
    if (kind === 'passengers') o.qty = clamp(Number(opt.qty) || 1, 1, 30);
    if (kind === 'ore') Object.assign(o, { good: /rare/i.test(opt.good ?? '') ? 'raremetals' : 'ore', qty: clamp(Number(opt.qty) || 30, 5, 300), days: 10 });
    if (kind === 'escort') o.hull = 'mule';
    if (kind === 'bounty') Object.assign(o, { hull: 'raider', target: opt.target ?? 'the raider' });
    price(st, o);
    const why = blocker(st, o);
    if (why) throw new Error(why);
    const c = startContract(st, o);
    return `Contract: ${c.title}, ${fmt(c.pay)} cr${c.deposit ? `, deposit ${fmt(c.deposit)} cr` : ''}`;
}

/** One line per active job, for the storyteller. */
export function contractsPrompt(st) {
    const list = activeContracts(st);
    if (!list.length) return '';
    return `Contracts in hand: ${list.map(c => {
        const left = c.deadline - st.minutes;
        const step = nextStep(st, c);
        return `${c.title} for ${c.client}, ${fmt(c.pay)} cr, ${left > 0 ? `due in ${Math.round(left / 60)} h` : 'OVERDUE'}${step ? ` (next: ${step})` : ' (can be handed over here now)'}`;
    }).join('; ')}.`;
}

export { isAiCommand };
