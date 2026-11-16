// The market engine. Every station holds real stock of every good it trades. Stock follows what
// the system makes and needs, drifts with time, lurches with events, and moves when the player
// trades. Price is a function of how full the warehouse is.
//
// Stock at a moment is computed, not stored: tendency + slow seeded drift + events + what the
// player did (which other traders even out over a few days). That keeps the save small and lets
// the terminal draw price history for any day.
import { S, addLog, galaxy, cargoUsed, cargoCap } from '../core/state.js';
import { getGalaxy, systemDistance } from './galaxy.js';
import { makeRng, hash, clamp, uid, norm } from '../core/util.js';
import { GOODS, goodById, ECON, EVENT_TYPES, TAX, BROKER_MARGIN, HANDLING, FEED_PRICE_PER_SYSTEM, WEEK, DAY } from '../data/economy.js';
import { skillOf } from './character.js';
import { slotsOf, fitted } from './refit.js';
import { MODULES } from '../data/modules.js';

const ELASTICITY = 0.5;
const DELTA_HALF_LIFE = 4 * DAY;
const STATION_COMMS = 15; // light years a station relay reaches
const SHIP_COMMS = 10;
const NEWS_SPEED = 4; // light years per day

export const stationKey = (sysId, idx) => `${sysId}.${idx}`;
const parseKey = (key) => key.split('.').map(Number);

/** The economy's own slice of the save. */
export function econ(st = S()) {
    const e = (st.econ ??= {});
    e.seen ??= {};
    e.feeds ??= {};
    e.events ??= [];
    e.vendor ??= {};
    e.ledger ??= [];
    e.day ??= Math.floor(st.minutes / DAY);
    e.payday ??= st.minutes + WEEK;
    e.owedWages ??= 0;
    return e;
}

export function ledger(st, text, amt) {
    const e = econ(st);
    e.ledger.unshift({ t: st.minutes, text, amt: Math.round(amt) });
    if (e.ledger.length > 40) e.ledger.length = 40;
}

// ---- The static shape of the sector's economy, derived once from the seed ----

const models = new Map();
function model(seed) {
    if (models.has(seed)) return models.get(seed);
    const g = getGalaxy(seed);
    const own = g.systems.map(sys => {
        const e = ECON[sys.economy];
        const b = {};
        for (const good of GOODS) b[good.id] = 0.45 * (e.makes[good.id] ?? 0) - 0.45 * (e.needs[good.id] ?? 0);
        return b;
    });
    const systems = g.systems.map((sys, i) => {
        const near = g.adj[i].map(a => own[a.to]);
        const bias = {};
        for (const good of GOODS) {
            const avg = near.length ? near.reduce((s, n) => s + n[good.id], 0) / near.length : 0;
            // Freighters on the lanes pull neighbouring markets toward each other.
            bias[good.id] = 0.84 * own[i][good.id] + 0.16 * avg;
        }
        const scale = 0.3 + clamp((Math.log10(Math.max(1000, sys.population)) - 3) / 6.6, 0, 1) * 1.5;
        const lawless = sys.security <= 1 || sys.faction === 'ashen';
        const stations = sys.stations.map((_, idx) => {
            const r = makeRng(hash('mkt', seed, i, idx));
            const goods = {};
            for (const good of GOODS) {
                const jitter = (r() - 0.5) * 0.3, p1 = 7 + r() * 6, p2 = 24 + r() * 20, f1 = r() * 6.283, f2 = r() * 6.283, luck = r();
                const local = own[i][good.id] !== 0;
                const banned = (good.restricted ?? []).includes(sys.faction);
                let traded = local || luck < 0.5;
                if (good.tier === 'contraband') traded = local || lawless || (!banned && luck < 0.3);
                if (banned && !lawless) traded = false;
                goods[good.id] = { jitter, p1, p2, f1, f2, traded };
            }
            return { share: idx === 0 ? 1 : 0.55, goods };
        });
        return { bias, scale, stations };
    });
    const m = { systems };
    models.set(seed, m);
    return m;
}

const refOf = (good) => 6000 / Math.pow(good.base, 0.8);

function envelope(ev, t) {
    if (t < ev.start) return 0;
    if (t < ev.start + 1.5 * DAY) return (t - ev.start) / (1.5 * DAY);
    if (t <= ev.end) return 1;
    if (t < ev.end + 3 * DAY) return 1 - (t - ev.end) / (3 * DAY);
    return 0;
}

function eventShift(st, g, sysId, goodId, t) {
    let shift = 0;
    for (const ev of econ(st).events) {
        const w = ev.sys === sysId ? 1 : g.adj[sysId].some(a => a.to === ev.sys) ? 0.35 : 0;
        if (!w) continue;
        const env = envelope(ev, t);
        if (!env) continue;
        const fx = EVENT_TYPES[ev.type]?.fx(ev.good) ?? {};
        const e = ECON[g.systems[sysId].economy];
        let v = fx[goodId] ?? 0;
        if (fx.makes && e.makes[goodId]) v += fx.makes;
        if (fx.needs && e.needs[goodId]) v += fx.needs;
        if (fx.all) v += fx.all;
        shift += v * env * w;
    }
    return shift;
}

function playerDelta(st, key, goodId, t) {
    const d = st.marketDelta?.[key]?.[goodId];
    if (!d) return 0;
    return d.d * Math.pow(0.5, Math.max(0, t - d.t) / DELTA_HALF_LIFE);
}

/** Tonnes on hand at a station at time t, and the reference level the price is measured against. */
export function stockAt(st, key, goodId, t = st.minutes, { withPlayer = true } = {}) {
    const [sysId, idx] = parseKey(key);
    const g = getGalaxy(st.seed);
    const ms = model(st.seed).systems[sysId];
    const stn = ms.stations[idx] ?? ms.stations[0];
    const sg = stn.goods[goodId];
    const good = goodById(goodId);
    const days = t / DAY;
    // Slow swings plus day-to-day jitter, all reproducible from the seed.
    const d0 = Math.floor(days), f = days - d0, sm = f * f * (3 - 2 * f);
    const n0 = hash('jit', st.seed, key, goodId, d0) / 4294967296 - 0.5, n1 = hash('jit', st.seed, key, goodId, d0 + 1) / 4294967296 - 0.5;
    const drift = good.vol * (0.4 * Math.sin(days * 6.283 / sg.p1 + sg.f1) + 0.3 * Math.sin(days * 6.283 / sg.p2 + sg.f2) + 0.55 * (n0 + (n1 - n0) * sm));
    const b = ms.bias[goodId] + sg.jitter + drift + eventShift(st, g, sysId, goodId, t);
    const ref = Math.max(2, refOf(good) * ms.scale * stn.share);
    const stock = ref * Math.exp(b) + (withPlayer ? playerDelta(st, key, goodId, t) : 0);
    return { stock: Math.max(0, stock), ref, traded: sg.traded };
}

const midPrice = (good, stock, ref) => good.base * Math.pow(clamp(stock / ref, 0.08, 6), -ELASTICITY);

// ---- Vendor attitude: the result of haggling, or of insulting the broker ----

export function vendorMod(st, key) {
    const v = econ(st).vendor[key];
    if (!v || v.until <= st.minutes) return 0;
    return v.mod;
}

function spread(st, sysId) {
    const sys = getGalaxy(st.seed).systems[sysId];
    return Math.max(0.02, BROKER_MARGIN + (TAX[sys.faction] ?? 0.02) - 0.004 * skillOf(st.captain, 'negotiation'));
}

function prices(st, key, mid) {
    const [sysId] = parseKey(key);
    const m = spread(st, sysId);
    const v = vendorMod(st, key);
    return {
        buy: mid * (1 + m) * (1 + v),
        sell: mid * (1 - m) * (v > 0 ? 1 / (1 + v) : 1 - v / 2),
    };
}

/** One row per good the station trades, as it stands at time t. */
export function marketAt(st, key, t = st.minutes, opts = {}) {
    const rows = [];
    for (const good of GOODS) {
        const s = stockAt(st, key, good.id, t, opts);
        if (!s.traded) continue;
        const mid = midPrice(good, s.stock, s.ref);
        const p = prices(st, key, mid);
        rows.push({ good, stock: Math.floor(s.stock), ref: s.ref, mid, buy: Math.ceil(p.buy), sell: Math.floor(p.sell) });
    }
    return rows;
}

/** Mid price over the last `days`, for the terminal's graphs. */
export function priceHistory(st, key, goodId, days = 30, points = 48) {
    const good = goodById(goodId);
    const out = [];
    for (let i = 0; i < points; i++) {
        const t = st.minutes - days * DAY * (1 - i / (points - 1));
        const s = stockAt(st, key, goodId, t, { withPlayer: i === points - 1 });
        out.push({ t, p: midPrice(good, s.stock, s.ref) });
    }
    return out;
}

// ---- What the player knows ----

export function commsRange(st) {
    if (st.transit) return 0;
    return st.loc.docked || !st.ship ? STATION_COMMS : SHIP_COMMS;
}

function feedCovers(st, sys) {
    return (econ(st).feeds[sys.faction] ?? 0) > st.minutes && sys.security >= 2 && sys.faction !== 'ashen';
}

/** How the player knows a system's markets: live, stale (as of a time), or not at all. */
export function access(st, sysId) {
    const g = getGalaxy(st.seed);
    const sys = g.systems[sysId];
    if (!st.transit && sysId === st.loc.system) return { mode: 'live', via: 'local', t: st.minutes };
    if (feedCovers(st, sys)) return { mode: 'live', via: 'feed', t: st.minutes };
    if (!st.transit && systemDistance(g, st.loc.system, sysId) <= commsRange(st)) return { mode: 'live', via: 'comms', t: st.minutes };
    const seen = econ(st).seen[sysId];
    if (seen != null) return { mode: 'stale', via: 'memory', t: seen };
    return { mode: 'none' };
}

function rememberLive(st) {
    const e = econ(st);
    for (const sys of getGalaxy(st.seed).systems) if (access(st, sys.id).mode === 'live') e.seen[sys.id] = st.minutes;
}

/** The market of a station as the player knows it, or null. */
export function knownMarket(st, key) {
    const [sysId] = parseKey(key);
    const a = access(st, sysId);
    if (a.mode === 'none') return null;
    return { ...a, rows: marketAt(st, key, a.t, { withPlayer: a.mode === 'live' }) };
}

/** The station the player can trade at right now, or null. */
export function tradingPost(st = S()) {
    if (!st || st.transit || !st.loc.docked) return null;
    const sys = getGalaxy(st.seed).systems[st.loc.system];
    const idx = sys.stations[st.loc.station] ? st.loc.station : 0;
    if (!sys.stations[idx].services.includes('market')) return null;
    return { key: stationKey(sys.id, idx), sys, station: sys.stations[idx], idx };
}

// ---- Ship fittings that matter to cargo ----

export function shipHas(st, flag) {
    if (!st.ship) return false;
    try { return slotsOf(st).some(slot => MODULES[fitted(st, slot)]?.fx?.[flag]); } catch { return false; }
}

export const handlingOk = (st, good) => !good.handling || shipHas(st, HANDLING[good.handling].need);

// ---- Trading ----

function walk(st, key, good, qty, dir) {
    // Price moves with every tonne, so a big order pays the average along the way.
    const s = stockAt(st, key, good.id);
    let stock = s.stock, total = 0, done = 0;
    for (; done < qty; done++) {
        if (dir < 0 && stock < 1) break;
        if (dir > 0 && stock >= s.ref * 4) break;
        const at = dir < 0 ? stock - 0.5 : stock + 0.5;
        const p = prices(st, key, midPrice(good, at, s.ref));
        total += dir < 0 ? p.buy : p.sell;
        stock += dir;
    }
    return { qty: done, total: dir < 0 ? Math.ceil(total) : Math.floor(total), avg: done ? total / done : 0, traded: s.traded };
}

export function quoteBuy(st, key, goodId, qty) {
    const good = goodById(goodId);
    const q = walk(st, key, good, qty, -1);
    const [sysId] = parseKey(key);
    const sys = getGalaxy(st.seed).systems[sysId];
    let why = '';
    if (!q.traded) why = 'not traded here';
    else if (q.qty < qty) why = `only ${q.qty} t in stock`;
    else if (cargoCap(st) - cargoUsed(st) < qty) why = `only ${Math.max(0, cargoCap(st) - cargoUsed(st))} t of hold free`;
    else if (q.total > st.captain.credits) why = 'not enough credits';
    else if (good.handling === 'haz' && sys.security >= 3 && !handlingOk(st, good)) why = 'port safety rules: no hazmat containment aboard';
    return { ...q, ok: !why && qty > 0, why };
}

export function quoteSell(st, key, goodId, qty) {
    const good = goodById(goodId);
    const q = walk(st, key, good, qty, 1);
    const have = st.cargo.filter(c => c.comId === goodId).reduce((n, c) => n + c.qty, 0);
    let why = '';
    if (!q.traded) why = 'no buyer for this here';
    else if (have < qty) why = `you hold ${have} t`;
    else if (q.qty < qty) why = `the warehouse will only take ${q.qty} t more`;
    // Mined ore is graded: the market price is for run-of-mine ore at half purity.
    const grade = gradeFactor(st, goodId, Math.min(qty, have));
    if (grade !== 1) { q.total = Math.floor(q.total * grade); q.avg *= grade; }
    return { ...q, ok: !why && qty > 0, why, have, grade };
}

/** Price factor for graded ore: the market quotes ore of half purity. */
export const purityFactor = (p) => (p ? Math.min(2, Math.max(0.1, p / 0.5)) : 1);
/** Stacks of a good in the order they are sold: graded ore best first. */
const sellOrder = (st, goodId) => st.cargo.filter(c => c.comId === goodId).sort((a, b) => (b.purity ?? 0) - (a.purity ?? 0));
function gradeFactor(st, goodId, qty) {
    let left = qty, sum = 0;
    for (const c of sellOrder(st, goodId)) {
        const take = Math.min(left, c.qty);
        sum += take * purityFactor(c.purity);
        left -= take;
        if (!left) break;
    }
    return qty > 0 ? sum / (qty - left || 1) : 1;
}

function nudge(st, key, goodId, amount) {
    const m = ((st.marketDelta ??= {})[key] ??= {});
    const cur = playerDelta(st, key, goodId, st.minutes);
    m[goodId] = { d: Math.round((cur + amount) * 10) / 10, t: st.minutes };
    if (Math.abs(m[goodId].d) < 0.5) delete m[goodId];
}

export function buyGood(goodId, qty) {
    const st = S();
    const post = tradingPost(st);
    if (!post) throw new Error('you need to be docked at a station with a market');
    qty = Math.floor(qty);
    const q = quoteBuy(st, post.key, goodId, qty);
    if (!q.ok) throw new Error(q.why || 'nothing to buy');
    const good = goodById(goodId);
    st.captain.credits -= q.total;
    let stack = st.cargo.find(c => c.comId === goodId && !c.purity);
    if (!stack) { stack = { id: uid('it'), name: good.name, qty: 0, comId: goodId, paid: 0 }; st.cargo.push(stack); }
    stack.paid = Math.round(((stack.paid || 0) * stack.qty + q.total) / (stack.qty + qty));
    stack.qty += qty;
    nudge(st, post.key, goodId, -qty);
    const text = `Bought ${qty} t ${good.name} at ${post.station.name} for ${q.total.toLocaleString('en-US')} cr (${Math.round(q.avg)} cr/t).`;
    ledger(st, `Bought ${qty} t ${good.name}`, -q.total);
    addLog(text, 'trade');
    return text;
}

export function sellGood(goodId, qty) {
    const st = S();
    const post = tradingPost(st);
    if (!post) throw new Error('you need to be docked at a station with a market');
    qty = Math.floor(qty);
    const q = quoteSell(st, post.key, goodId, qty);
    if (!q.ok) throw new Error(q.why || 'nothing to sell');
    const good = goodById(goodId);
    let left = qty, cost = 0;
    for (const c of sellOrder(st, goodId)) {
        const take = Math.min(left, c.qty);
        c.qty -= take; left -= take; cost += take * (c.paid || 0);
        if (!left) break;
    }
    st.cargo = st.cargo.filter(c => c.qty > 0);
    st.captain.credits += q.total;
    nudge(st, post.key, goodId, qty);
    const profit = q.total - cost;
    const text = `Sold ${qty} t ${good.name} at ${post.station.name} for ${q.total.toLocaleString('en-US')} cr (${Math.round(q.avg)} cr/t${cost ? `, ${profit >= 0 ? 'profit' : 'loss'} ${Math.abs(Math.round(profit)).toLocaleString('en-US')} cr` : ''}).`;
    ledger(st, `Sold ${qty} t ${good.name}`, q.total);
    addLog(text, 'trade');
    return text;
}

// ---- Information for sale ----

export function brokerQuote(st, sysId) {
    const g = getGalaxy(st.seed);
    return Math.round((60 + 8 * systemDistance(g, st.loc.system, sysId)) / 5) * 5;
}

export function buyReport(sysId) {
    const st = S();
    if (!tradingPost(st)) throw new Error('information brokers work out of station markets: dock first');
    const g = getGalaxy(st.seed);
    const sys = g.systems[sysId];
    if (!sys) throw new Error('unknown system');
    if (access(st, sysId).mode === 'live') throw new Error('you already have live prices for that system');
    const cost = brokerQuote(st, sysId);
    if (cost > st.captain.credits) throw new Error(`the broker wants ${cost} cr`);
    st.captain.credits -= cost;
    econ(st).seen[sysId] = st.minutes;
    ledger(st, `Market report: ${sys.name}`, -cost);
    return `Market report for ${sys.name} bought for ${cost} cr. It is accurate as of now and will age.`;
}

export function feedInfo(st, factionId) {
    const g = getGalaxy(st.seed);
    const covered = g.systems.filter(s => s.faction === factionId && s.security >= 2);
    return { systems: covered.length, cost: covered.length * FEED_PRICE_PER_SYSTEM, until: econ(st).feeds[factionId] ?? 0 };
}

export function buyFeed(factionId) {
    const st = S();
    if (st.transit) throw new Error('no network link in jump');
    if (!st.loc.docked) throw new Error('subscriptions are sold at station terminals: dock first');
    const info = feedInfo(st, factionId);
    if (!info.systems || factionId === 'ashen') throw new Error('nobody sells a feed for that space');
    if (info.cost > st.captain.credits) throw new Error(`a week of that feed costs ${info.cost} cr`);
    st.captain.credits -= info.cost;
    const e = econ(st);
    e.feeds[factionId] = Math.max(st.minutes, e.feeds[factionId] ?? 0) + WEEK;
    rememberLive(st);
    ledger(st, `Market data feed, one week (${factionId})`, -info.cost);
    return `Market data feed subscribed for one week: live prices from ${info.systems} systems.`;
}

// ---- Events ----

function spawnEvent(st, t) {
    const g = getGalaxy(st.seed);
    const e = econ(st);
    const live = e.events.filter(ev => ev.end > t);
    const busy = new Set(live.map(ev => ev.sys));
    const pool = g.systems.filter(s => !busy.has(s.id));
    if (!pool.length) return;
    const sys = pool[Math.floor(Math.random() * pool.length)];
    const types = Object.entries(EVENT_TYPES).filter(([, d]) => (!d.econ || d.econ.includes(sys.economy))
        && (d.minSec == null || sys.security >= d.minSec) && (d.maxSec == null || sys.security <= d.maxSec));
    const [type, def] = types[Math.floor(Math.random() * types.length)];
    let good = null;
    if (def.pickGood) {
        const list = Object.keys(ECON[sys.economy][def.pickGood]);
        good = list[Math.floor(Math.random() * list.length)];
    }
    const days = def.days[0] + Math.random() * (def.days[1] - def.days[0]) + Math.max(0, (st.minutes - t) / DAY);
    e.events.push({ id: uid('ev'), type, sys: sys.id, good, start: t, end: Math.round(t + days * DAY) });
}

function eventsDay(st, t) {
    const e = econ(st);
    e.events = e.events.filter(ev => ev.end + 40 * DAY > t);
    const live = e.events.filter(ev => ev.end > t).length;
    if (live < 3 || (live < 7 && Math.random() < 0.22)) spawnEvent(st, t);
}

export function describeEvent(st, ev) {
    const g = getGalaxy(st.seed);
    const def = EVENT_TYPES[ev.type];
    return def.text(g.systems[ev.sys].name, ev.good ? goodById(ev.good).name.toLowerCase() : '');
}

/** Events the player has heard of: live market access, or enough time for the news to travel. */
export function knownEvents(st) {
    const g = getGalaxy(st.seed);
    return econ(st).events.filter(ev => {
        if (ev.end <= st.minutes || ev.start > st.minutes) return false;
        if (access(st, ev.sys).mode === 'live') return true;
        return (st.minutes - ev.start) / DAY * NEWS_SPEED >= systemDistance(g, st.loc.system, ev.sys);
    }).map(ev => ({ ...ev, name: EVENT_TYPES[ev.type].name, sysName: g.systems[ev.sys].name, text: describeEvent(st, ev), daysLeft: Math.ceil((ev.end - st.minutes) / DAY) }));
}

// ---- Cargo that does not keep ----

function spoil(st, mins) {
    const lost = [];
    for (const c of st.cargo) {
        const good = c.comId ? goodById(c.comId) : null;
        if (!good?.loss || handlingOk(st, good)) continue;
        c.rot = (c.rot ?? 0) + c.qty * good.loss * (mins / DAY);
        const gone = Math.min(c.qty, Math.floor(c.rot));
        if (gone > 0) { c.rot -= gone; c.qty -= gone; lost.push(`${gone} t ${good.name}`); }
    }
    if (lost.length) {
        st.cargo = st.cargo.filter(c => c.qty > 0);
        addLog(`Cargo lost for want of the right hold: ${lost.join(', ')}.`, 'trade');
    }
}

function hazardDay(st) {
    if (!st.ship) return;
    for (const c of st.cargo) {
        const good = c.comId ? goodById(c.comId) : null;
        if (good?.handling !== 'haz' || handlingOk(st, good) || Math.random() > 0.03) continue;
        const gone = Math.max(1, Math.round(c.qty * 0.1));
        c.qty -= gone;
        st.ship.systems.lifesupport = Math.max(0, st.ship.systems.lifesupport - (5 + Math.floor(Math.random() * 11)));
        addLog(`Containment failure in the hold: ${gone} t ${good.name} vented, life support fouled.`, 'ship');
        st.pendingEvent ??= `A container of ${good.name.toLowerCase()} carried without hazmat containment has leaked in the hold of the ${st.ship.name}. ${gone} tonnes are lost and the life support system is contaminated. Work this into the scene.`;
    }
    st.cargo = st.cargo.filter(c => c.qty > 0);
}

// ---- Clock ----

const dayHooks = [];
/** Other economy modules (port services, wages) run once per in-story day through here. */
export function onEconomyDay(fn) { dayHooks.push(fn); }

export function marketTick(st, mins) {
    const e = econ(st);
    if (!e.events.length) for (let i = 0; i < 4; i++) spawnEvent(st, st.minutes - (2 + Math.random() * 4) * DAY);
    spoil(st, mins);
    const today = Math.floor(st.minutes / DAY);
    const from = Math.max(e.day + 1, today - 30);
    for (let d = from; d <= today; d++) {
        eventsDay(st, d * DAY);
        hazardDay(st);
        for (const fn of dayHooks) { try { fn(st, d); } catch (err) { console.error('[Ship-OS] economy day failed', err); } }
    }
    e.day = today;
    for (const [k, v] of Object.entries(e.vendor)) if (v.until <= st.minutes && (v.cool ?? 0) <= st.minutes) delete e.vendor[k];
    rememberLive(st);
}

// ---- Analysis for the terminal ----

/** Best places the player knows of to sell what this station sells. */
export function opportunities(st, key, limit = 6) {
    const g = getGalaxy(st.seed);
    const here = marketAt(st, key);
    const [hereSys] = parseKey(key);
    const out = [];
    for (const sys of g.systems) {
        const a = access(st, sys.id);
        if (a.mode === 'none') continue;
        sys.stations.forEach((stn, idx) => {
            const k = stationKey(sys.id, idx);
            if (k === key || !stn.services.includes('market')) return;
            const there = marketAt(st, k, a.t, { withPlayer: a.mode === 'live' });
            for (const row of here) {
                if (row.stock < 5) continue;
                const t = there.find(r => r.good.id === row.good.id);
                if (!t) continue;
                const margin = t.sell - row.buy;
                if (margin > 0) out.push({ good: row.good, buy: row.buy, sell: t.sell, margin, pct: margin / row.buy, station: stn.name, sys, key: k, dist: systemDistance(g, hereSys, sys.id), mode: a.mode, age: st.minutes - a.t });
            }
        });
    }
    // One line per good: its best destination.
    const best = new Map();
    for (const o of out) if (!best.has(o.good.id) || best.get(o.good.id).margin < o.margin) best.set(o.good.id, o);
    return [...best.values()].sort((a, b) => b.margin - a.margin).slice(0, limit);
}

/** Where the player knows a good is bought and sold, for the detail view. */
export function quotesElsewhere(st, key, goodId, limit = 4) {
    const g = getGalaxy(st.seed);
    const [hereSys] = parseKey(key);
    const out = [];
    for (const sys of g.systems) {
        const a = access(st, sys.id);
        if (a.mode === 'none') continue;
        sys.stations.forEach((stn, idx) => {
            const k = stationKey(sys.id, idx);
            if (k === key || !stn.services.includes('market')) return;
            const s = stockAt(st, k, goodId, a.t, { withPlayer: a.mode === 'live' });
            if (!s.traded) return;
            const p = prices(st, k, midPrice(goodById(goodId), s.stock, s.ref));
            out.push({ station: stn.name, sys, key: k, buy: Math.ceil(p.buy), sell: Math.floor(p.sell), stock: Math.floor(s.stock), dist: systemDistance(g, hereSys, sys.id), mode: a.mode, age: st.minutes - a.t });
        });
    }
    return { sellAt: [...out].sort((a, b) => b.sell - a.sell).slice(0, limit), buyAt: [...out].sort((a, b) => a.buy - b.buy).slice(0, limit) };
}

// ---- Haggling ----

/**
 * The AI reports how the bargaining went; the engine decides what it is worth.
 * outcome: success | fail | insult
 */
export function haggle(outcome) {
    const st = S();
    const post = tradingPost(st);
    if (!post) throw new Error('there is no vendor to bargain with here');
    const e = econ(st);
    const cur = e.vendor[post.key];
    const o = norm(outcome);
    if (/^(insult|insulted|offend|offended|disrespect|angry|hostile)/.test(o)) {
        e.vendor[post.key] = { mod: 0.25, until: st.minutes + 3 * DAY, cool: st.minutes + 3 * DAY };
        return `The traders at ${post.station.name} take offence: prices are 25% worse for three days`;
    }
    if (cur && (cur.cool ?? 0) > st.minutes) {
        if (cur.mod > 0) return `The traders at ${post.station.name} are still offended and will not bargain`;
        return `The traders at ${post.station.name} have already given their best price today`;
    }
    if (/^(fail|failed|no|refuse|refused)/.test(o)) {
        e.vendor[post.key] = { mod: 0, until: 0, cool: st.minutes + DAY };
        return `No deal: prices at ${post.station.name} stay as posted`;
    }
    if (!/^(success|succeed|ok|yes|good|deal|pleased|agree)/.test(o)) throw new Error('use: haggle success|fail|insult');
    // How good a deal depends on the character, not on the storyteller.
    const neg = skillOf(st.captain, 'negotiation');
    const rollv = 1 + Math.floor(Math.random() * 10) + 1 + Math.floor(Math.random() * 10);
    const pctOff = clamp(Math.round(2 + neg * 0.8 + (rollv - 11) * 0.5), 2, 15);
    e.vendor[post.key] = { mod: -pctOff / 100, until: st.minutes + DAY, cool: st.minutes + DAY };
    return `Deal struck at ${post.station.name}: ${pctOff}% off what you buy and ${Math.round(pctOff / 2)}% more for what you sell, for the next day`;
}

export { goodById, DAY, WEEK };
void galaxy;
