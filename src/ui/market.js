// The trading terminal, the port services desk and the ledger.
import { registerTab, registerWidget, registerActions, gauge, btn, redraw } from './hud.js';
import { S, commit, cargoUsed, cargoCap, fmtDate, galaxy } from '../core/state.js';
import { toast, toInput } from '../core/st.js';
import { esc, fmtInt, clamp } from '../core/util.js';
import { FACTIONS, SHIP_SYSTEMS } from '../data/catalog.js';
import { GOODS, TIERS, HANDLING, TAX, BROKER_MARGIN, WEAR_PARTS, DAY } from '../data/economy.js';
import {
    econ, tradingPost, marketAt, knownMarket, priceHistory, quoteBuy, quoteSell, buyGood, sellGood, stockAt,
    opportunities, quotesElsewhere, access, brokerQuote, buyReport, feedInfo, buyFeed, knownEvents, vendorMod,
    haggle, handlingOk, marketTick, stationKey, goodById, commsRange,
} from '../systems/market.js';
import {
    port, storePrices, buyStore, magazines, restock, wearOf, wearLabel, fuelMult, yardQuotes, orderYard, hasYard,
    fieldWork, dockFee, weeklyWages, payOwedWages, servicesTick, freePort, transitWear,
} from '../systems/services.js';
import { registerCommand, onTick, onArrival, fmtDuration, isAiCommand } from '../systems/sim.js';
import { registerPromptSection } from '../core/ailink.js';
import { systemDistance, factionById } from '../systems/galaxy.js';
import { blip } from './sfx.js';

let sel = null;      // good open in the exchange
let qty = 10;
let filter = 'all';
let viewSys = null;  // system shown in the market data widget

const cr = (n) => `${fmtInt(n)} cr`;
const ageText = (mins) => (mins < 90 ? 'live' : mins < 2 * DAY ? `${Math.round(mins / 60)} h old` : `${Math.round(mins / DAY)} d old`);
const where = (o) => (o.dist ? `${o.dist} ly` : 'same system');
const holdOf = (st, id) => st.cargo.filter(c => c.comId === id).reduce((n, c) => n + c.qty, 0);

function act(fn) {
    try { const text = fn(); if (text) toast('success', text); blip('click'); } catch (e) { toast('warning', e.message); blip('error'); }
    commit('economy');
}

// ---- Graph ----

function graph(points, base) {
    const W = 300, H = 96, padL = 4, padR = 40, padY = 8;
    const ps = points.map(p => p.p);
    const lo = Math.min(...ps) * 0.96, hi = Math.max(...ps) * 1.04;
    const x = (i) => padL + (W - padL - padR) * i / (points.length - 1);
    const y = (p) => padY + (H - 2 * padY) * (1 - (p - lo) / (hi - lo || 1));
    const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join(' ');
    const last = ps[ps.length - 1];
    const up = last >= ps[0];
    const weeks = [1, 2, 3].map(w => { const gx = padL + (W - padL - padR) * (1 - w * 7 / 30); return `<line x1="${gx}" y1="${padY}" x2="${gx}" y2="${H - padY}" class="sf-gr-grid"/>`; }).join('');
    return `<svg class="sf-graph ${up ? 'up' : 'down'}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price over the last 30 days">
        ${weeks}
        ${base > lo && base < hi ? `<line x1="${padL}" y1="${y(base)}" x2="${W - padR}" y2="${y(base)}" class="sf-gr-base"/>` : ''}
        <polygon points="${padL},${H - padY} ${line} ${W - padR},${H - padY}" class="sf-gr-area"/>
        <polyline points="${line}" class="sf-gr-line"/>
        <circle cx="${x(points.length - 1)}" cy="${y(last)}" r="2.6" class="sf-gr-dot"/>
        <text x="${W - padR + 4}" y="${y(Math.max(...ps)) + 3}" class="sf-gr-txt">${Math.round(Math.max(...ps))}</text>
        <text x="${W - padR + 4}" y="${Math.min(H - 2, y(Math.min(...ps)) + 9)}" class="sf-gr-txt">${Math.round(Math.min(...ps))}</text>
    </svg>`;
}

function trend(st, key, id) {
    const good = goodById(id);
    const now = stockAt(st, key, id), was = stockAt(st, key, id, st.minutes - 3 * DAY, { withPlayer: false });
    const ch = Math.pow(now.stock / now.ref, -0.5) / Math.pow(was.stock / was.ref, -0.5) - 1;
    void good;
    if (ch > 0.03) return '<i class="fa-solid fa-caret-up sf-up" title="Rising"></i>';
    if (ch < -0.03) return '<i class="fa-solid fa-caret-down sf-down" title="Falling"></i>';
    return '<i class="fa-solid fa-minus sf-flat" title="Steady"></i>';
}

// ---- Exchange ----

function elsewhereHtml(st, key, id) {
    const q = quotesElsewhere(st, key, id, 3);
    const line = (o, what) => `<li class="sf-row"><span class="sf-grow">${esc(o.station)} <small class="sf-dim">${esc(o.sys.name)} · ${where(o)} · ${ageText(o.age)}</small></span><b class="sf-num">${fmtInt(what === 'sell' ? o.sell : o.buy)}</b></li>`;
    if (!q.sellAt.length) return '<small class="sf-dim">You have no price data from other stations. Visit them, get in comms range, buy a report from a broker or subscribe to a data feed.</small>';
    return `<div class="sf-mk-two"><div><div class="sf-sub">Best known buyers</div><ul class="sf-list">${q.sellAt.map(o => line(o, 'sell')).join('')}</ul></div>
        <div><div class="sf-sub">Cheapest known sellers</div><ul class="sf-list">${q.buyAt.map(o => line(o, 'buy')).join('')}</ul></div></div>`;
}

function detailHtml(st, post, row, have) {
    const good = row?.good ?? goodById(sel);
    const stack = st.cargo.find(c => c.comId === good.id);
    const hist = priceHistory(st, post.key, good.id);
    const ps = hist.map(h => h.p);
    const avg = ps.reduce((a, b) => a + b, 0) / ps.length;
    const free = cargoCap(st) - cargoUsed(st);
    const n = clamp(Math.floor(qty) || 1, 1, 9999);
    const qb = row ? quoteBuy(st, post.key, good.id, n) : null;
    const qs = quoteSell(st, post.key, good.id, n);
    const h = good.handling ? HANDLING[good.handling] : null;
    const step = (d, label) => `<button type="button" class="sf-btn ghost" data-sf="mk-step" data-d="${d}">${label}</button>`;
    return `<div class="sf-mk-detail">
        ${row ? graph(hist, good.base) : ''}
        ${row ? `<div class="sf-mk-stats"><span>30 d low <b>${Math.round(Math.min(...ps))}</b></span><span>avg <b>${Math.round(avg)}</b></span><span>high <b>${Math.round(Math.max(...ps))}</b></span><span>galactic <b>${good.base}</b></span></div>` : '<small class="sf-warn-line">Nobody at this station buys or sells this.</small>'}
        ${stack ? `<div class="sf-kv"><span>In your hold</span><b>${have} t${stack.paid ? ` · paid ${fmtInt(stack.paid)} cr/t` : ''}</b></div>` : ''}
        ${h ? `<div class="${handlingOk(st, good) ? 'sf-ok-line' : 'sf-warn-line'}"><i class="fa-solid ${h.icon}"></i> ${esc(h.name)}: ${handlingOk(st, good) ? `your ${esc(h.module.toLowerCase())} handles it` : esc(h.warn)}.</div>` : ''}
        ${row ? `<div class="sf-mk-qty">${step(-10, '−10')}${step(-1, '−1')}<input type="number" class="sf-input sf-mk-in" min="1" value="${n}" data-sf-change="mk-qty" inputmode="numeric">${step(1, '+1')}${step(10, '+10')}
            <button type="button" class="sf-btn ghost" data-sf="mk-max" data-n="${Math.max(1, Math.min(free, row.stock))}">Max buy</button>${have ? `<button type="button" class="sf-btn ghost" data-sf="mk-max" data-n="${have}">All held</button>` : ''}</div>
        <div class="sf-mk-two">
            <div><button type="button" class="sf-btn primary sf-wide" data-sf="mk-buy"${qb.ok ? '' : ' disabled'}>Buy ${n} t · ${cr(qb.total)}</button><small class="${qb.ok ? 'sf-dim' : 'sf-warn-line'}">${qb.ok ? `${Math.round(qb.avg)} cr/t average` : esc(qb.why)}</small></div>
            <div><button type="button" class="sf-btn primary sf-wide" data-sf="mk-sell"${qs.ok ? '' : ' disabled'}>Sell ${n} t · ${cr(qs.total)}</button><small class="${qs.ok || !have ? 'sf-dim' : 'sf-warn-line'}">${qs.ok ? `${Math.round(qs.avg)} cr/t average${stack?.paid ? ` · ${qs.avg >= stack.paid ? 'profit' : 'loss'} ${fmtInt(Math.abs((qs.avg - stack.paid) * n))} cr` : ''}` : esc(qs.why)}</small></div>
        </div>` : ''}
        ${elsewhereHtml(st, post.key, good.id)}
    </div>`;
}

function exchangeHtml(st) {
    const post = tradingPost(st);
    if (!post) return '<div class="sf-dim">The exchange terminal is only available while docked at a station with a market. Market data you already hold is below.</div>';
    const rows = marketAt(st, post.key);
    const fac = factionById(post.sys.faction);
    const v = vendorMod(st, post.key);
    const ids = new Set(rows.map(r => r.good.id));
    // Cargo this station does not trade still shows, so the player can see there is no buyer.
    const extra = [...new Set(st.cargo.filter(c => c.comId && !ids.has(c.comId)).map(c => c.comId))];
    const chips = [['all', 'All'], ...Object.entries(TIERS).map(([k, t]) => [k, t.short]), ['hold', 'In hold']]
        .map(([k, label]) => `<button type="button" class="sf-chipbtn${filter === k ? ' active' : ''}" data-sf="mk-filter" data-f="${k}">${esc(label)}</button>`).join('');
    const show = (good) => filter === 'all' || (filter === 'hold' ? holdOf(st, good.id) > 0 : good.tier === filter);
    const line = (good, row) => {
        const have = holdOf(st, good.id);
        const open = sel === good.id;
        const h = good.handling ? HANDLING[good.handling] : null;
        return `<li class="sf-mk${open ? ' open' : ''}"><div class="sf-mk-row" data-sf="mk-sel" data-id="${good.id}">
            <span class="sf-mk-name t-${good.tier}">${row ? trend(st, post.key, good.id) : ''} ${esc(good.name)}${h ? ` <i class="fa-solid ${h.icon} sf-dim" title="${esc(h.name)}"></i>` : ''}</span>
            <span class="sf-num">${row ? fmtInt(row.stock) : '—'}</span><span class="sf-num">${row ? fmtInt(row.buy) : '—'}</span><span class="sf-num">${row ? fmtInt(row.sell) : '—'}</span><span class="sf-num${have ? ' sf-have' : ''}">${have || ''}</span></div>
            ${open ? detailHtml(st, post, row, have) : ''}</li>`;
    };
    const body = rows.filter(r => show(r.good)).map(r => line(r.good, r)).join('') + extra.map(id => goodById(id)).filter(show).map(g => line(g, null)).join('');
    const attitude = v < 0 ? `<div class="sf-ok-line"><i class="fa-solid fa-handshake"></i> You talked them down: ${Math.round(-v * 100)}% off purchases until ${esc(fmtDate(econ(st).vendor[post.key].until))}.</div>`
        : v > 0 ? `<div class="sf-warn-line"><i class="fa-solid fa-face-angry"></i> The traders here are offended: prices are ${Math.round(v * 100)}% worse until ${esc(fmtDate(econ(st).vendor[post.key].until))}.</div>` : '';
    return `<div class="sf-loc-sub">${esc(post.station.name)} · <span style="color:${fac.color}">${esc(fac.name)}</span> · tax ${Math.round((TAX[post.sys.faction] ?? 0) * 100)}% · broker ${Math.round(BROKER_MARGIN * 100)}%</div>
        ${attitude}
        ${gauge(st.ship ? 'Hold' : 'Carried', cargoUsed(st), cargoCap(st), { cls: 'info', text: `${cargoUsed(st)}/${cargoCap(st)} t` })}
        <div class="sf-kv"><span>Balance</span><b>${cr(st.captain.credits)}</b></div>
        <div class="sf-chiprow">${chips}</div>
        <div class="sf-mk-head"><span>Good</span><span>Stock t</span><span>Buy</span><span>Sell</span><span>Hold</span></div>
        <ul class="sf-list sf-mk-list">${body || '<li class="sf-dim">Nothing in this category.</li>'}</ul>
        <div class="sf-actions">${btn('mk-haggle', 'Haggle with the broker', { icon: 'fa-comments-dollar' })}</div>
        <small class="sf-dim">Prices are credits per tonne and move with every tonne traded. Tap a good for its 30 day chart.</small>`;
}

// ---- Market data ----

function dataHtml(st) {
    const g = galaxy();
    const post = tradingPost(st);
    const here = st.loc.system;
    const systems = g.systems.map(s => ({ s, a: access(st, s.id), d: systemDistance(g, here, s.id) })).sort((a, b) => a.d - b.d);
    if (viewSys == null || !g.systems[viewSys]) viewSys = here;
    const cur = systems.find(x => x.s.id === viewSys);
    const opts = systems.map(x => `<option value="${x.s.id}"${x.s.id === viewSys ? ' selected' : ''}>${esc(x.s.name)} · ${x.d} ly · ${x.a.mode === 'none' ? 'no data' : ageText(st.minutes - x.a.t)}</option>`).join('');
    let table;
    if (cur.a.mode === 'none') {
        table = `<div class="sf-dim">You hold no price data for ${esc(cur.s.name)}.</div>
            ${post ? `<div class="sf-actions">${btn('mk-report', `Buy a broker's report · ${cr(brokerQuote(st, viewSys))}`, { icon: 'fa-user-secret', cls: 'primary' })}</div>` : '<small class="sf-dim">Information brokers work out of station markets.</small>'}`;
    } else {
        table = cur.s.stations.map((stn, idx) => {
            if (!stn.services.includes('market')) return '';
            const m = knownMarket(st, stationKey(cur.s.id, idx));
            const rows = m.rows.map(r => `<li class="sf-mk-row ro"><span class="sf-mk-name t-${r.good.tier}">${esc(r.good.name)}</span><span class="sf-num">${fmtInt(r.stock)}</span><span class="sf-num">${fmtInt(r.buy)}</span><span class="sf-num">${fmtInt(r.sell)}</span><span></span></li>`).join('');
            return `<div class="sf-sub">${esc(stn.name)} <span class="sf-tag ${m.mode === 'live' ? 'l-open' : 'l-licensed'}">${m.mode === 'live' ? `live · ${m.via === 'feed' ? 'data feed' : m.via === 'comms' ? 'comms range' : 'local net'}` : ageText(st.minutes - m.t)}</span></div>
                <div class="sf-mk-head"><span>Good</span><span>Stock t</span><span>Buy</span><span>Sell</span><span></span></div><ul class="sf-list sf-mk-list short">${rows}</ul>`;
        }).join('') + (cur.a.mode === 'stale' && post ? `<div class="sf-actions">${btn('mk-report', `Buy a fresh report · ${cr(brokerQuote(st, viewSys))}`, { icon: 'fa-user-secret' })}</div>` : '');
    }
    const runs = post ? opportunities(st, post.key, 6) : [];
    const runHtml = post ? `<div class="sf-sub">Best known runs from ${esc(post.station.name)}</div><ul class="sf-list">${runs.map(o => `<li class="sf-row"><span class="sf-grow"><b>${esc(o.good.name)}</b> <small class="sf-dim">buy ${fmtInt(o.buy)} here, sell ${fmtInt(o.sell)}</small><br><small class="sf-dim">${esc(o.station)}, ${esc(o.sys.name)} · ${where(o)} · ${ageText(o.age)}</small></span><b class="sf-num sf-up">+${fmtInt(o.margin)}/t</b></li>`).join('') || '<li class="sf-dim">No profitable run in the data you hold.</li>'}</ul>
        <small class="sf-dim">Per-tonne margin on the first tonne. Large loads move both prices against you, and old data may no longer be true.</small>` : '';
    const feeds = FACTIONS.filter(f => f.id !== 'ashen').map(f => {
        const info = feedInfo(st, f.id);
        const on = info.until > st.minutes;
        return `<li class="sf-row"><span class="sf-grow"><b style="color:${f.color}">${esc(f.name)}</b><br><small class="sf-dim">${info.systems} systems · ${on ? `active until ${esc(fmtDate(info.until))}` : 'not subscribed'}</small></span>
            <button type="button" class="sf-btn${on ? '' : ' primary'}" data-sf="mk-feed" data-f="${f.id}"${st.loc.docked && !st.transit && info.systems ? '' : ' disabled'}>${on ? 'Extend' : 'Subscribe'} · ${cr(info.cost)}/wk</button></li>`;
    }).join('');
    return `${runHtml}
        <div class="sf-sub">Price data on file</div>
        <select class="sf-input sf-wide" data-sf-change="mk-view">${opts}</select>
        ${table}
        <div class="sf-sub">Market data feeds</div>
        <ul class="sf-list">${feeds}</ul>
        <small class="sf-dim">A feed gives live prices from every policed system of that power. Lawless ports report to nobody. Comms reach is ${st.transit ? 'nil in jump' : `${commsRange(st)} light years ${st.loc.docked || !st.ship ? 'through the station relay' : 'on the ship\'s own set'}`}.</small>`;
}

function newsHtml(st) {
    const evs = knownEvents(st);
    return `<ul class="sf-list">${evs.map(e => `<li class="sf-row"><span class="sf-grow"><b>${esc(e.name)}: ${esc(e.sysName)}</b><br><small class="sf-dim">${esc(e.text)}</small></span><span class="sf-tag">${e.daysLeft} d</span></li>`).join('') || '<li class="sf-dim">No trade news has reached you.</li>'}</ul>
        <small class="sf-dim">News travels at about four light years a day unless you have a live link.</small>`;
}

// ---- Port services ----

function portHtml(st) {
    const p = port(st);
    if (!p) return '<div class="sf-dim">Dock at a station to take on fuel, stores and ammunition.</div>';
    const sp = storePrices(st);
    const ship = st.ship;
    const need = Math.round((ship.maxFuel - ship.fuel) * 10) / 10;
    const mags = magazines(st);
    const fill = mags.filter(m => m.missing > 0 && !m.why);
    const fillCost = fill.reduce((s, m) => s + m.cost, 0);
    const price = (v, unit) => (sp.free ? 'issued' : `${fmtInt(v)} cr/${unit}`);
    const b = (kind, n, label, cost) => `<button type="button" class="sf-btn" data-sf="port-buy" data-kind="${kind}" data-n="${n}"${n > 0 && cost <= st.captain.credits ? '' : ' disabled'}>${label}${sp.free ? '' : ` · ${cr(cost)}`}</button>`;
    const people = 1 + st.crew.length;
    return `<div class="sf-loc-sub">${esc(p.station.name)} · berth ${sp.free ? 'free for ships in service' : `${cr(dockFee(st, p))} per day`}</div>
        ${sp.free ? '<div class="sf-ok-line"><i class="fa-solid fa-star"></i> Military port of your own service: fuel, stores, ammunition and yard work are issued, not sold.</div>' : ''}
        ${gauge('Fuel', ship.fuel, ship.maxFuel, { text: `${Math.round(ship.fuel * 10) / 10}/${ship.maxFuel}` })}
        <div class="sf-row"><span class="sf-grow"><small class="sf-dim">${price(sp.fuel, 'unit')}</small></span>${b('fuel', Math.min(5, need), '+5', Math.min(5, need) * sp.fuel)}${b('fuel', need, 'Fill', need * sp.fuel)}</div>
        <div class="sf-row"><span class="sf-grow"><b>Supplies</b> ${Math.round(ship.supplies)} crew-days <small class="sf-dim">(${Math.round(ship.supplies / people)} days for ${people}) · ${price(sp.supplies, 'crew-day')}</small></span>${b('supplies', 10, '+10', 10 * sp.supplies)}${b('supplies', 50, '+50', 50 * sp.supplies)}</div>
        <div class="sf-row"><span class="sf-grow"><b>Spare parts</b> ${ship.parts} <small class="sf-dim">${sp.sellsParts ? price(sp.parts, 'part') : 'no chandler here'}</small></span>${sp.sellsParts ? b('parts', 1, '+1', sp.parts) + b('parts', 5, '+5', 5 * sp.parts) : ''}</div>
        <div class="sf-sub">Magazines</div>
        <ul class="sf-list">${mags.map(m => `<li class="sf-row"><span class="sf-grow"><b>${esc(m.name)}</b> ${m.cur}/${m.max}<br><small class="${m.why && m.missing ? 'sf-warn-line' : 'sf-dim'}">${m.missing ? (m.why ? esc(m.why) : sp.free ? 'issued' : `${fmtInt(m.unit)} cr each`) : 'full'}</small></span>
            ${m.missing && !m.why ? `<button type="button" class="sf-btn" data-sf="port-ammo" data-key="${m.key}"${m.cost <= st.captain.credits ? '' : ' disabled'}>Fill${sp.free ? '' : ` · ${cr(m.cost)}`}</button>` : ''}</li>`).join('') || '<li class="sf-dim">No weapon aboard uses ammunition.</li>'}</ul>
        ${fill.length > 1 ? `<div class="sf-actions"><button type="button" class="sf-btn primary" data-sf="port-ammo" data-key="all"${fillCost <= st.captain.credits ? '' : ' disabled'}>Fill every magazine${sp.free ? '' : ` · ${cr(fillCost)}`}</button></div>` : ''}`;
}

function yardHtml(st) {
    const p = port(st);
    const jobs = st.ship.yard ?? [];
    const queue = jobs.length ? `<div class="sf-sub">In the yard</div><ul class="sf-list">${jobs.map(j => `<li class="sf-row"><span class="sf-grow">${esc(j.label)}</span><span class="sf-tag">${esc(fmtDuration(j.end - st.minutes))}</span></li>`).join('')}</ul>
        <small class="sf-dim">Work is done in story time. Leave before it is finished and the yard refunds 60% of what is not done.</small>` : '';
    if (!hasYard(p)) return `${queue}<div class="sf-dim">${p ? 'This station has no repair yard. Your own crew can still do field work with spare parts.' : 'Yard repairs and full servicing need a station with a repair yard.'}</div>`;
    const quotes = yardQuotes(st);
    const rep = quotes.filter(q => q.kind !== 'service'), svc = quotes.filter(q => q.kind === 'service');
    const row = (q) => `<li class="sf-row"><span class="sf-grow">${esc(q.label)}<br><small class="sf-dim">${q.hours} h</small></span><button type="button" class="sf-btn" data-sf="yard-order" data-kind="${q.kind}" data-id="${q.id}"${q.cost <= st.captain.credits ? '' : ' disabled'}>${q.cost ? cr(q.cost) : 'Issue'}</button></li>`;
    const all = (list, kind, label) => (list.length > 1 ? `<div class="sf-actions"><button type="button" class="sf-btn primary" data-sf="yard-order" data-kind="${kind}"${list.reduce((s, q) => s + q.cost, 0) <= st.captain.credits ? '' : ' disabled'}>${label} · ${cr(list.reduce((s, q) => s + q.cost, 0))} · ${list.reduce((s, q) => s + q.hours, 0)} h</button></div>` : '');
    return `${queue}
        <div class="sf-sub">Repairs</div><ul class="sf-list">${rep.map(row).join('') || '<li class="sf-dim">No damage to repair.</li>'}</ul>${all(rep, 'allrepair', 'All repairs')}
        <div class="sf-sub">Servicing</div><ul class="sf-list">${svc.map(row).join('') || '<li class="sf-dim">Nothing is due for service.</li>'}</ul>${all(svc, 'allservice', 'Full service')}`;
}

function upkeepHtml(st) {
    const w = wearOf(st);
    const ship = st.ship;
    const can = ship.parts > 0 && !st.shipCombat && !st.combat;
    const parts = WEAR_PARTS.map(p => `<div class="sf-row"><div class="sf-grow">${gauge(p.name, 100 - w[p.id], 100, { text: wearLabel(w[p.id]) })}</div>
        ${w[p.id] > 30 ? `<button type="button" class="sf-btn ghost" data-sf="field" data-kind="service" data-id="${p.id}" title="Field service: 3 h, one spare part"${can ? '' : ' disabled'}><i class="fa-solid fa-wrench"></i></button>` : '<span class="sf-btn-gap"></span>'}</div>`).join('');
    const broken = SHIP_SYSTEMS.filter(s => ship.systems[s.id] < 70);
    const mult = fuelMult(st);
    return `<small class="sf-dim">Every part wears with use: drives and reactor under way, life support with every day aboard, weapons and shields in battle. Past "due" things start to fail.</small>
        ${parts}
        ${mult > 1 ? `<div class="sf-warn-line"><i class="fa-solid fa-gas-pump"></i> Worn drives are burning ${Math.round((mult - 1) * 100)}% more fuel.</div>` : ''}
        <div class="sf-kv"><span>Spare parts aboard</span><b>${ship.parts}</b></div>
        ${broken.length || ship.hull < ship.maxHull * 0.5 ? `<div class="sf-sub">Field repairs</div><div class="sf-actions">
            ${broken.map(s => `<button type="button" class="sf-btn" data-sf="field" data-kind="system" data-id="${s.id}"${can ? '' : ' disabled'}>Patch ${esc(s.name.toLowerCase())} (${Math.round(ship.systems[s.id])}%)</button>`).join('')}
            ${ship.hull < ship.maxHull * 0.5 ? `<button type="button" class="sf-btn" data-sf="field" data-kind="hull"${can ? '' : ' disabled'}>Patch the hull</button>` : ''}</div>` : ''}
        <small class="sf-dim">Field work uses one spare part and a few hours, and only goes so far: a patched system tops out at 70%, wear cannot be brought under 30% without a yard.</small>`;
}

function ledgerHtml(st) {
    const e = econ(st);
    const p = port(st);
    const wages = weeklyWages(st);
    const feeds = FACTIONS.filter(f => (e.feeds[f.id] ?? 0) > st.minutes).length;
    return `<div class="sf-kv"><span>Balance</span><b>${cr(st.captain.credits)}</b></div>
        ${st.captain.debt ? `<div class="sf-kv"><span>Debt</span><b class="sf-crit-txt">${cr(st.captain.debt)}</b></div>` : ''}
        ${st.crew.length ? `<div class="sf-kv"><span>Crew wages</span><b>${cr(wages)} per week · next pay day ${esc(fmtDate(e.payday))}</b></div>` : ''}
        ${st.ship && p ? `<div class="sf-kv"><span>Berth here</span><b>${freePort(st, p) ? 'free' : `${cr(dockFee(st, p))} per day`}</b></div>` : ''}
        ${feeds ? `<div class="sf-kv"><span>Data feeds</span><b>${feeds} active</b></div>` : ''}
        ${e.owedWages ? `<div class="sf-warn-line"><i class="fa-solid fa-triangle-exclamation"></i> The crew are owed ${cr(e.owedWages)} in back wages.</div><div class="sf-actions">${btn('pay-wages', `Pay back wages · ${cr(e.owedWages)}`, { icon: 'fa-coins', cls: 'primary', disabled: e.owedWages > st.captain.credits })}</div>` : ''}
        <div class="sf-sub">Recent transactions</div>
        <ul class="sf-list sf-ledger">${e.ledger.slice(0, 14).map(l => `<li class="sf-row"><time class="sf-dim">${esc(fmtDate(l.t).split(' · ')[0].slice(5))}</time><span class="sf-grow">${esc(l.text)}</span><b class="sf-num ${l.amt > 0 ? 'sf-up' : ''}">${l.amt > 0 ? '+' : ''}${fmtInt(l.amt)}</b></li>`).join('') || '<li class="sf-dim">Nothing yet.</li>'}</ul>`;
}

// ---- What the storyteller is told ----

function promptSection(st) {
    const L = [];
    const post = tradingPost(st);
    if (post) {
        const rows = marketAt(st, post.key).map(r => ({ r, k: r.mid / r.good.base })).sort((a, b) => a.k - b.k);
        const cheap = rows.slice(0, 4).filter(x => x.k < 0.95).map(x => `${x.r.good.name} ${x.r.buy} cr/t`);
        const dear = rows.slice(-4).reverse().filter(x => x.k > 1.05).map(x => `${x.r.good.name} ${x.r.sell} cr/t`);
        const v = vendorMod(st, post.key);
        L.push(`Market at ${post.station.name}: cheap here: ${cheap.join(', ') || 'nothing notable'}; in demand here: ${dear.join(', ') || 'nothing notable'}.${v < 0 ? ` The broker has agreed a ${Math.round(-v * 100)}% discount.` : v > 0 ? ' The traders here are offended by the character and are charging far over the odds.' : ''}`);
    }
    const evs = knownEvents(st).slice(0, 4);
    if (evs.length) L.push(`Trade news known to ${st.captain.name}: ${evs.map(e => e.text).join(' ')}`);
    if (st.ship) {
        const w = wearOf(st);
        const due = WEAR_PARTS.filter(p => w[p.id] >= 50).map(p => `${p.name.toLowerCase()} (${wearLabel(w[p.id])})`);
        if (due.length) L.push(`Maintenance on the ${st.ship.name}: ${due.join(', ')}.`);
        const jobs = st.ship.yard ?? [];
        if (jobs.length) L.push(`The ship is in the yard: ${jobs.map(j => j.label).join('; ')}. Ready in ${fmtDuration(Math.max(...jobs.map(j => j.end)) - st.minutes)}.`);
    }
    const e = econ(st);
    if (e.owedWages) L.push(`The crew are owed ${fmtInt(e.owedWages)} cr in unpaid wages and know it.`);
    L.push('ECONOMY RULES: the game owns every price and every transaction. The player buys and sells cargo, fuel, stores, ammunition, repairs and information in their own terminal, so never quote exact prices that differ from the ones above, never add or remove credits or cargo for a trade, and never grant more than small sums of money (large payments come from contracts). '
        + 'You may roleplay vendors and brokers. If the character bargains with one, judge only how it went and add one command: haggle success, haggle fail, or haggle insult (when the character is rude or threatening). The game then sets the discount or the penalty in the shop menu.');
    return L.join('\n');
}

export function initMarketUi() {
    onTick((st, mins) => { marketTick(st, mins); servicesTick(st, mins); });
    // Passengers do not wear out a ship they do not own.
    onArrival((st, from, to) => { if (st.ship && !st.post?.classId) transitWear(st, 4 + systemDistance(galaxy(), from.id, to.id) * 1.5); });
    registerPromptSection(promptSection);

    registerWidget({ id: 'exchange', title: (st) => (tradingPost(st) ? 'Commodity exchange' : 'Exchange offline'), render: exchangeHtml });
    registerWidget({ id: 'marketdata', title: () => 'Market data', render: dataHtml });
    registerWidget({ id: 'tradenews', title: () => 'Trade news', render: newsHtml });
    registerWidget({ id: 'ledger', title: () => 'Ledger', render: ledgerHtml });
    registerWidget({ id: 'port', when: (st) => !!st.ship, title: () => 'Port services', render: portHtml });
    registerWidget({ id: 'yard', when: (st) => !!st.ship, title: () => 'Repair yard', render: yardHtml });
    registerWidget({ id: 'upkeep', when: (st) => !!st.ship, title: () => 'Maintenance', render: upkeepHtml });
    registerTab({ id: 'trade', label: 'Trade', icon: 'fa-chart-line', order: 24, widgets: ['exchange', 'marketdata', 'tradenews', 'ledger'] });
    registerTab({ id: 'port', label: 'Port', icon: 'fa-anchor', order: 26, when: (st) => !!st.ship, widgets: ['port', 'yard', 'upkeep'],
        badge: (st) => { const w = st.ship?.wear; return w && Object.values(w).some(v => v >= 75) ? '!' : ''; } });

    registerActions({
        'mk-sel'(el) { sel = sel === el.dataset.id ? null : el.dataset.id; redraw(); },
        'mk-filter'(el) { filter = el.dataset.f; redraw(); },
        'mk-step'(el) { qty = clamp((Math.floor(qty) || 0) + Number(el.dataset.d), 1, 9999); redraw(); },
        'mk-max'(el) { qty = Math.max(1, Number(el.dataset.n) || 1); redraw(); },
        'mk-qty'(el) { qty = clamp(Math.floor(Number(el.value)) || 1, 1, 9999); redraw(); },
        'mk-buy'() { if (sel) act(() => buyGood(sel, qty)); },
        'mk-sell'() { if (sel) act(() => sellGood(sel, qty)); },
        'mk-view'(el) { viewSys = Number(el.value); redraw(); },
        'mk-report'() { act(() => buyReport(viewSys)); },
        'mk-feed'(el) { act(() => buyFeed(el.dataset.f)); },
        'mk-haggle'() {
            const st = S();
            const good = sel ? goodById(sel) : null;
            toInput(`*${st.captain.name} finds the broker and tries to talk the price ${good ? `of ${good.name.toLowerCase()} ` : ''}down.*`);
            toast('info', 'Play out the bargaining in the chat. The result changes the prices here.');
        },
        'port-buy'(el) { act(() => buyStore(el.dataset.kind, Number(el.dataset.n))); },
        'port-ammo'(el) { act(() => restock(el.dataset.key)); },
        'yard-order'(el) { act(() => orderYard(el.dataset.kind, el.dataset.id)); },
        'field'(el) { act(() => fieldWork(el.dataset.kind, el.dataset.id)); },
        'pay-wages'() { act(() => payOwedWages()); },
    });

    const findGood = (name) => {
        const n = String(name ?? '').toLowerCase().trim();
        return GOODS.find(g => g.id === n) ?? GOODS.find(g => g.name.toLowerCase() === n) ?? GOODS.find(g => n.length >= 3 && g.name.toLowerCase().includes(n));
    };
    const playerOnly = () => { if (isAiCommand()) throw new Error('trades are made by the player at the terminal'); };
    registerCommand('haggle', (st, [outcome = '']) => haggle(outcome), ['bargain']);
    registerCommand('buy', (st, [name, n = '1']) => {
        playerOnly();
        const good = findGood(name);
        if (!good) throw new Error(`unknown good "${name}"`);
        return buyGood(good.id, Number(n) || 1);
    });
    registerCommand('sell', (st, [name, n = '1']) => {
        playerOnly();
        const good = findGood(name);
        if (!good) throw new Error(`unknown good "${name}"`);
        return sellGood(good.id, Number(n) || 1);
    });
    registerCommand('refuel', (st, [n]) => { playerOnly(); return buyStore('fuel', n ? Number(n) : 1e9); });
    registerCommand('service', (st, [name = '']) => {
        if (/^(none|off|leave|discharged?|civilian)$/i.test(name) || !name) { st.service = null; return 'No longer in any service'; }
        const f = FACTIONS.find(x => x.id === name.toLowerCase()) ?? FACTIONS.find(x => x.name.toLowerCase().includes(name.toLowerCase()));
        if (!f) throw new Error(`unknown power "${name}"`);
        st.service = { faction: f.id };
        return `In the service of the ${f.name}: its military ports supply and repair the ship at no charge`;
    }, ['enlist']);
}
