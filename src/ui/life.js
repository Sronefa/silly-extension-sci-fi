// Station life: the job board, flight school, the bank, the shipyard, laying a ship up, and
// the screens for a character who is in prison or owned by someone.
import { registerTab, registerWidget, registerActions, btn, ask, confirmAsk } from './hud.js';
import { S, commit, fmtDate } from '../core/state.js';
import { toast } from '../core/st.js';
import { esc, fmtInt } from '../core/util.js';
import { LIVING, LICENCES, LENDERS, OWNERS } from '../data/life.js';
import { WEAR_PARTS, DAY } from '../data/economy.js';
import { VESSELS, LEGAL } from '../data/vessels.js';
import { ownClass } from '../data/hulls.js';
import { port, wearLabel } from '../systems/services.js';
import {
    jobBoard, takeShift, living, licencesOf, licenceStatus, enrol, courseStep, hasSchool, missingLicences,
    yardStock, inspect, listingWear, buyQuote, buyShip, sellShip, tradeIn, layUpQuote, layUp, reclaim, paperCheck, lifeTick,
} from '../systems/life.js';
import { loans, loanOffers, takeLoan, repay, financeTick, arrivalChecks, imprison, enslave, release, custodyAct, totalDebt, ownerKind, exitsText } from '../systems/finance.js';
import { areasHere, areaOf, areaName, walkTime, moveTo, clockIn, quit, present, activityTick, activityPrompt } from '../systems/activity.js';
import { registerCommand, onTick, onArrival, advanceTime, fmtDuration, isAiCommand } from '../systems/sim.js';
import { registerPromptSection } from '../core/ailink.js';
import { galaxy } from '../core/state.js';
import { blip } from './sfx.js';

let openOffer = null;
const cr = (n) => `${fmtInt(n)} cr`;

function act(fn) {
    try { const text = fn(); if (text) toast('success', text); blip('click'); } catch (e) { toast('warning', e.message); blip('error'); }
    commit('life');
}

/** The commitment card: what is booked or under way, and how far along it is. */
function activityHtml(st) {
    const a = st.activity;
    if (!a) return '';
    const here = present(st, a);
    const place = a.area ? areaName(st, a.area).toLowerCase() : '';
    if (!a.on) {
        return `<div class="sf-note"><b>${esc(a.name)}</b><br>Booked. ${here ? 'You are in the right place.' : `Get to the ${esc(place)}.`} It has to start within ${esc(fmtDuration(Math.max(0, a.by - st.minutes)))}.</div>
            <div class="sf-actions">${btn('act-start', 'Clock in', { icon: 'fa-play', cls: 'primary', disabled: !here })}${btn('act-quit', 'Cancel', { icon: 'fa-xmark' })}</div>`;
    }
    const left = a.need - a.done;
    return `<div class="sf-note"><b>${esc(a.name)}</b><br>${esc(fmtDuration(a.done))} done, ${esc(fmtDuration(left))} to go.${here ? '' : ` <span class="sf-warn-line">You have left the ${esc(place)}: ${Math.max(0, 45 - a.away)} min before it counts as walking out.</span>`}
            <span class="sf-xp sf-act-bar"><span style="width:${Math.round(100 * a.done / a.need)}%"></span></span></div>
        <small class="sf-dim">The time is lived: it passes as the story does. To let a stretch of it go by, write what your character does and use the hourglass <i class="fa-solid fa-hourglass-half"></i> in the chat bar.</small>
        <div class="sf-actions">${btn('act-quit', a.custody ? 'Down tools' : 'Walk out', { icon: 'fa-door-open' })}</div>`;
}

function whereHtml(st) {
    const p = port(st);
    if (!p) return `${activityHtml(st)}<div class="sf-dim">You are not aboard a station.</div>`;
    const here = areaOf(st);
    const rows = areasHere(st).map(a => `<li class="sf-row"><span class="sf-grow">${a.id === here ? `<b class="sf-ok-line"><i class="fa-solid fa-location-dot"></i> ${esc(a.name)}</b>` : esc(a.name)}${st.activity?.area === a.id ? ' <span class="sf-tag l-licensed">expected here</span>' : ''}</span>
        ${a.id === here ? '<small class="sf-dim">you are here</small>' : btn('area-go', `Walk · ${walkTime(st, here, a.id)} min`, { icon: 'fa-person-walking', data: { id: a.id } })}</li>`).join('');
    return `${activityHtml(st)}<small class="sf-dim">${esc(p.station.name)}. Getting about takes time, and things happen where they happen: work at the workplace, beds in the habitat ring, ships at the yard.</small><ul class="sf-list">${rows}</ul>`;
}

function jobsHtml(st) {
    const p = port(st);
    if (!p) return '<div class="sf-dim">Shift work is found on stations. Dock, or get yourself to one.</div>';
    const jobs = jobBoard(st);
    const liv = Object.entries(LIVING).map(([k, v]) => `<button type="button" class="sf-btn" data-sf="life-live" data-kind="${k}"${v.cost <= st.captain.credits ? '' : ' disabled'}>${esc(v.name)} · ${v.cost} cr</button>`).join('');
    return `<small class="sf-dim">A shift is eight hours, worked at the workplace and lived in story time. Sign on, get there within two hours and clock in. A second shift the same day is overtime: it pays the same and costs you more. ${st.indenture ? 'Combine Credit takes 70% of every wage until your indenture is paid.' : ''}</small>
        <ul class="sf-list">${jobs.map(j => `<li class="sf-row"><span class="sf-grow"><b>${esc(j.name)}</b> <small class="sf-dim">${esc(j.skill)}${j.min ? ` ${j.min}+` : ''} · ${esc(areaName(st, j.at).toLowerCase())}</small><br><small class="${j.why ? 'sf-warn-line' : 'sf-dim'}">${esc(j.why || j.desc)}</small></span>
            <button type="button" class="sf-btn${j.why ? '' : ' primary'}" data-sf="life-work" data-id="${j.id}"${j.why ? ' disabled' : ''}>${cr(j.pay)}</button></li>`).join('')}</ul>
        <div class="sf-sub">Bed and board</div><div class="sf-actions">${liv}</div>`;
}

function licenceHtml(st) {
    const p = port(st);
    const school = hasSchool(p);
    const held = licencesOf(st);
    const c = st.captain.course;
    const rows = Object.values(LICENCES).map(def => {
        const s = licenceStatus(st, def.id);
        const right = held[def.id] ? '<span class="sf-tag l-open">Held</span>'
            : s.course ? `<span class="sf-tag">${s.course.lessons}/${def.lessons}</span>`
                : `<button type="button" class="sf-btn" data-sf="life-enrol" data-id="${def.id}"${!s.why && school && def.fee <= st.captain.credits ? '' : ' disabled'}>Enrol · ${cr(def.fee)}</button>`;
        return `<li class="sf-row"><span class="sf-grow"><b>${esc(def.name)}</b><br><small class="sf-dim">${esc(def.desc)}</small>${s.why && !held[def.id] ? `<br><small class="sf-warn-line">${esc(s.why)}</small>` : ''}</span>${right}</li>`;
    }).join('');
    let course = '';
    if (c) {
        const def = LICENCES[c.id];
        const next = c.lessons < def.lessons ? `Book lesson ${c.lessons + 1} (4 h)` : !c.theory ? `Book the written test (2 h)${c.fail ? ' · 300 cr' : ''}` : `Book the check flight (3 h)${c.fail ? ' · 300 cr' : ''}`;
        course = `<div class="sf-note">Enrolled: ${esc(def.name)}. ${c.lessons}/${def.lessons} lessons${c.theory ? ', written test passed' : ''}.</div>
            <div class="sf-actions">${btn('life-course', next, { icon: 'fa-graduation-cap', cls: 'primary', disabled: !school || !!st.activity })}</div>`;
    }
    const own = st.ship ? missingLicences(st, VESSELS[st.ship.classId]) : [];
    return `${own.length ? `<div class="sf-warn-line"><i class="fa-solid fa-triangle-exclamation"></i> You are flying the ${esc(st.ship.name)} without the ${own.map(id => esc(LICENCES[id].name)).join(' and the ')}. Policed systems fine for that.</div>` : ''}
        ${course}<ul class="sf-list">${rows}</ul>
        ${school ? '' : '<small class="sf-dim">Flight schools are found on stations in policed space.</small>'}`;
}

function bankHtml(st) {
    const book = loans(st);
    const offers = loanOffers(st);
    const rows = book.map(l => `<li class="sf-row"><span class="sf-grow"><b>${esc(LENDERS[l.lender].name)}</b> ${cr(l.balance)}<br><small class="${l.missed ? 'sf-warn-line' : 'sf-dim'}">${cr(Math.min(l.payment, l.balance))} due ${esc(fmtDate(l.next))}${l.missed ? ` · ${l.missed} missed` : ''}${l.repo ? ' · repossession ordered' : l.collateral ? ' · secured on your ship' : ''}</small></span>
        ${btn('life-repay', 'Pay', { data: { id: l.id }, disabled: st.captain.credits < 1 || !!st.custody })}</li>`).join('');
    const flags = [
        st.indenture ? 'Indentured to Combine Credit: 70% of your wages are garnished.' : '',
        st.bounty ? `The moneylenders have ${cr(st.bounty)} on your head.` : '',
        ...(st.warrants ?? []).map(w => (w.reason ? `Warrant in ${w.faction} space for ${w.reason}.` : `Debtor's warrant in ${w.faction} space${w.escape ? ' (escaped custody)' : ''}.`)),
    ].filter(Boolean).map(t => `<div class="sf-warn-line"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(t)}</div>`).join('');
    const lend = offers.map(o => `<li class="sf-row"><span class="sf-grow"><b>${esc(LENDERS[o.lender].name)}</b> <small class="sf-dim">${(LENDERS[o.lender].rate * 100).toFixed(2)}% a week · up to ${cr(o.max)}</small><br><small class="${o.why ? 'sf-warn-line' : 'sf-dim'}">${esc(o.why || LENDERS[o.lender].desc)}</small></span>
        ${btn('life-borrow', 'Borrow', { data: { lender: o.lender, max: o.max }, disabled: !o.max })}</li>`).join('');
    return `<div class="sf-kv"><span>Balance</span><b>${cr(st.captain.credits)}</b></div><div class="sf-kv"><span>Total owed</span><b class="${book.length ? 'sf-crit-txt' : ''}">${cr(totalDebt(st))}</b></div>
        ${flags}<ul class="sf-list">${rows || '<li class="sf-dim">You owe nobody anything.</li>'}</ul>
        ${offers.length ? `<div class="sf-sub">Lenders here</div><ul class="sf-list">${lend}</ul>` : '<small class="sf-dim">Nobody is lending here.</small>'}`;
}

function wearLine(wear) {
    return WEAR_PARTS.map(p => `<span class="sf-tag${wear[p.id] >= 75 ? ' l-restricted' : wear[p.id] >= 50 ? ' l-licensed' : ''}">${esc(p.name)}: ${wearLabel(Math.max(0, wear[p.id]))}</span>`).join('');
}

function offerHtml(st, o) {
    const open = openOffer === o.id;
    const oc = ownClass(o.cls.id);
    let detail = '';
    if (open) {
        const q = buyQuote(st, o), qf = buyQuote(st, o, { finance: true });
        const lw = o.used ? listingWear(st, o) : null;
        detail = `<div class="sf-reg-detail">
            <small class="sf-dim">${esc(o.cls.desc ?? '')}</small>
            <div class="sf-kv"><span>Hull / shield</span><b>${oc.hull} / ${oc.shields}</b></div>
            <div class="sf-kv"><span>Hold / fuel / crew</span><b>${oc.cargo} t · ${oc.fuel} · ${oc.crewMax}</b></div>
            ${lw ? `<div class="sf-kv"><span>Hull condition</span><b>${lw.hull}%</b></div><div class="sf-tags">${wearLine(lw.wear)}</div>
                <small class="${lw.level === 2 ? 'sf-ok-line' : 'sf-warn-line'}">${lw.level === 2 ? 'Surveyed: this is her real condition.' : lw.level === 1 ? 'You looked her over but could not be sure. This is still mostly the seller\'s word.' : 'Seller\'s description. Nobody you trust has looked at her.'}</small>
                ${lw.level < 2 && lw.survey ? `<small class="sf-dim">A surveyor is going through her. Report due ${esc(fmtDate(lw.survey.due))}.</small>` : ''}${lw.level < 2 && !lw.survey ? `<div class="sf-actions">${lw.level === 0 ? btn('yard-inspect', 'Inspect her yourself (4 h)', { icon: 'fa-magnifying-glass', data: { id: o.id, how: 'self' } }) : ''}${btn('yard-inspect', `Hire a surveyor · ${cr(Math.max(150, Math.round(o.price * 0.015 / 10) * 10))}`, { icon: 'fa-clipboard-check', data: { id: o.id, how: 'pay' } })}</div>` : ''}` : ''}
            ${q.missing.length ? `<small class="sf-warn-line">You do not hold the ${q.missing.map(id => esc(LICENCES[id].name)).join(' or the ')}. You can buy her, but flying her in policed space will be fined.</small>` : ''}
            ${q.trade ? `<div class="sf-kv"><span>Trade-in for the ${esc(st.ship.name)}</span><b>${cr(q.trade)}</b></div>` : ''}
            <div class="sf-mk-two">
                <div><button type="button" class="sf-btn primary sf-wide" data-sf="yard-buy" data-id="${o.id}"${q.ok ? '' : ' disabled'}>${q.net >= 0 ? `Buy · ${cr(q.net)}` : `Swap · ${cr(-q.net)} back`}</button><small class="${q.ok ? 'sf-dim' : 'sf-warn-line'}">${esc(q.ok ? 'paid in full' : q.why)}</small></div>
                <div><button type="button" class="sf-btn sf-wide" data-sf="yard-buy" data-id="${o.id}" data-fin="1"${qf.ok && qf.borrowed ? '' : ' disabled'}>Finance · ${cr(qf.down)} down</button><small class="${qf.ok ? 'sf-dim' : 'sf-warn-line'}">${esc(qf.ok ? (qf.borrowed ? `${cr(qf.borrowed)} bank loan over two years` : 'no loan needed') : qf.why)}</small></div>
            </div></div>`;
    }
    return `<li class="sf-reg${open ? ' open' : ''}"><div class="sf-row" data-sf="yard-open" data-id="${o.id}"><span class="sf-grow"><b>${esc(o.used ? o.name : o.cls.name)}</b><br><small class="sf-dim">${o.used ? `${esc(o.cls.name)} · ` : ''}${esc(o.cls.role)}${o.cls.legal !== 'open' ? ` · ${esc(LEGAL[o.cls.legal].name.toLowerCase())}` : ''}</small></span><b class="sf-num">${fmtInt(o.price)}</b></div>${detail}</li>`;
}

function shipyardHtml(st) {
    const p = port(st);
    const stock = yardStock(st);
    const canSell = st.ship && p && (p.station.services.includes('shipyard') || p.station.services.includes('repair'));
    const sell = canSell ? `<div class="sf-sub">Sell</div><div class="sf-row"><span class="sf-grow">The ${esc(st.ship.name)}<br><small class="sf-dim">${stock ? 'yard price' : 'breaker\'s price'}, as she stands</small></span>${btn('yard-sell', `Sell · ${cr(tradeIn(st) * (stock ? 1 : 0.8))}`, { icon: 'fa-hand-holding-dollar' })}</div>` : '';
    if (!stock) return `<div class="sf-dim">${p ? 'This station has no shipyard.' : 'Ships are bought and sold at station shipyards.'}</div>${sell}`;
    return `<small class="sf-dim">Stock changes weekly. Buying while you own a ship trades her in. Capital ships and military hulls are not for sale to private buyers.</small>
        <div class="sf-sub">New</div><ul class="sf-list">${stock.new.map(o => offerHtml(st, o)).join('')}</ul>
        <div class="sf-sub">Used</div><ul class="sf-list">${stock.used.map(o => offerHtml(st, o)).join('') || '<li class="sf-dim">Nothing on the used lot this week.</li>'}</ul>${sell}`;
}

function parkingHtml(st) {
    const l = st.laidUp;
    const p = port(st);
    if (l) {
        const here = p && p.key === l.key;
        return `<div class="sf-loc-main"><i class="fa-solid fa-warehouse"></i> ${esc(l.ship.name)}</div><div class="sf-loc-sub">${l.mode === 'pad' ? 'On an open pad' : 'In a locked hangar'} at ${esc(l.place)} · ${cr(l.fee)} a day${l.cargo.length ? ` · ${l.cargo.reduce((n, c) => n + c.qty, 0)} t aboard` : ''}</div>
            <div class="sf-actions">${btn('park-reclaim', 'Go back aboard', { icon: 'fa-rocket', cls: 'primary', disabled: !here || !!st.ship })}</div>${here ? '' : '<small class="sf-dim">You have to go back there to collect her.</small>'}`;
    }
    const q = layUpQuote(st);
    if (!q) return '<div class="sf-dim">Dock your ship to leave her somewhere.</div>';
    return `<small class="sf-dim">Leave the ship here and go on foot or as a passenger. The rent runs every day until you come back for her.</small>
        <div class="sf-actions">${btn('park', `Open pad · ${cr(q.pad)}/day`, { icon: 'fa-square-parking', data: { mode: 'pad' } })}${btn('park', `Locked hangar · ${cr(q.hangar)}/day`, { icon: 'fa-warehouse', data: { mode: 'hangar' } })}</div>
        ${q.risky ? '<div class="sf-warn-line"><i class="fa-solid fa-triangle-exclamation"></i> Security here is poor. A ship on an open pad may be stripped, or gone when you get back.</div>' : ''}`;
}

function custodyHtml(st) {
    const c = st.custody;
    const sys = galaxy().systems[c.sys];
    const locked = c.cool > st.minutes;
    const slave = c.type === 'slave';
    const o = slave ? ownerKind(c) : null;
    const busy = !!st.activity;
    const head = !slave
        ? `<div class="sf-downed"><b>IMPRISONED</b><span>${esc(sys.name)} Penitentiary, for ${esc(c.reason)}. ${esc(fmtDuration(c.until - st.minutes))} left to serve.</span></div>`
        : `<div class="sf-downed"><b>ENSLAVED</b><span>${esc(o.type)}. Property of ${esc(c.owner)}: ${esc(c.work)}. ${Math.floor((st.minutes - c.since) / DAY)} days so far.</span></div>`;
    // What a slave knows about being sold their freedom: nothing, until the owner says.
    const price = !slave ? '' : c.asked || c.trust >= 40
        ? (c.sells ? `<div class="sf-kv"><span>Your price</span><b>${cr(c.price)}</b></div>` : `<div class="sf-kv"><span>Your price</span><b class="sf-crit-txt">not for sale</b></div>`)
        : '<div class="sf-kv"><span>Your price</span><b class="sf-dim">unknown</b></div>';
    const ways = !slave ? '' : [
        c.until ? `<div class="sf-kv"><span>Bond runs out in</span><b>${esc(fmtDuration(c.until - st.minutes))}</b></div>` : '',
        o.exit === 'wins' ? `<div class="sf-kv"><span>Victories in the pits</span><b>${c.wins} of ${c.need}</b></div>` : '',
    ].join('');
    const extra = !slave ? '' : [
        o.exit === 'wins' ? btn('custody', c.bout > st.minutes ? `Next bout ${fmtDate(c.bout)}` : 'Fight your bout', { icon: 'fa-hand-back-fist', data: { a: 'fight' }, disabled: c.bout > st.minutes || busy }) : '',
        o.exit === 'join' ? btn('custody', 'Ask to join the crew', { icon: 'fa-skull-crossbones', data: { a: 'join' }, disabled: c.trust < 70 || locked || busy }) : '',
        btn('custody', c.sells || !(c.asked || c.trust >= 40) ? 'Offer to buy your freedom' : 'Not for sale', { icon: 'fa-coins', data: { a: 'buy' }, disabled: c.trust < 40 || (c.asked && !c.sells) || busy }),
    ].join('');
    const note = !slave
        ? 'The sentence is served in story time. Good conduct takes a little off it and makes an escape easier to set up; a failed escape adds thirty days. Debts are discharged when you walk out.'
        : `Nothing is skipped. Trust makes escape easier. ${o.exit === 'term' ? 'A bond runs out in the end, and a contractor will always take money to close it early. ' : o.exit === 'wins' ? 'By the custom of the pits, enough victories earn freedom. ' : o.exit === 'join' ? 'A crew that comes to respect a thrall may take them in as one of their own. ' : ''}Some owners will sell you your freedom once they trust you; some never will, and you only learn which by earning enough trust to ask. Friends who think well of you may come looking, in time.`;
    return `${head}${activityHtml(st)}
        <div class="sf-kv"><span>${!slave ? 'Conduct' : `${esc(c.owner)}'s trust`}</span><b>${Math.round(c.trust)}%</b></div>
        ${slave ? `<div class="sf-kv"><span>Hidden away</span><b>${cr(c.stash)}</b></div>${price}${ways}` : `<div class="sf-kv"><span>Prison account</span><b>${cr(st.captain.credits)}</b></div>`}
        ${locked ? `<div class="sf-warn-line">${!slave ? 'In solitary' : 'Chained and watched'} until ${esc(fmtDate(c.cool))}.</div>` : ''}
        <div class="sf-actions">
            ${btn('custody', !slave ? 'Eat in the mess' : 'Eat what you are given', { icon: 'fa-utensils', data: { a: 'eat' } })}
            ${btn('custody', !slave ? 'Go out on a work detail (8 h)' : 'Begin the day\'s work (8 h)', { icon: 'fa-person-digging', data: { a: 'work' }, disabled: busy })}
            ${btn('custody', 'Defy them', { icon: 'fa-hand-fist', data: { a: 'defy' } })}
            ${btn('custody', 'Attempt escape', { icon: 'fa-person-running', cls: 'primary', data: { a: 'escape' }, disabled: locked })}
            ${extra}
        </div>
        <small class="sf-dim">${note}</small>`;
}

function promptSection(st) {
    const rules = [];
    const state = [];
    const c = st.custody;
    if (c?.type === 'prison') {
        state.push(`${st.captain.name} is a prisoner in the ${galaxy().systems[c.sys].name} Penitentiary (${c.reason}), with ${fmtDuration(c.until - st.minutes)} left to serve. They own nothing and cannot leave.`);
        rules.push('<custody>\nPlay prison life as it comes, in story time: the cell block, work details, other prisoners, guards. Never shorten the sentence and never release the character yourself.\n</custody>');
    }
    if (c?.type === 'slave') {
        state.push(`${st.captain.name} is a slave (${ownerKind(c).type.toLowerCase()}), the property of ${c.owner}: ${c.work}. They own nothing, have no rights here and cannot leave. Owner's trust: ${Math.round(c.trust)}%.${c.until ? ` The bond has ${fmtDuration(c.until - st.minutes)} left to run.` : ''}${c.need ? ` Pit victories: ${c.wins} of ${c.need}.` : ''} ${exitsText(c)}`);
        rules.push('<custody>\nPlay this life as it comes, in story time, and do not soften it. The character gets out only through the game. If the story itself frees them (a raid, a rescue by named characters), add the command: release.\n</custody>');
    }
    const act = activityPrompt(st);
    if (act.rules) rules.push(act.rules);
    if (act.state) state.push(act.state);
    if (!c) {
        const book = loans(st);
        if (book.length) state.push(`Debts: ${book.map(l => `${LENDERS[l.lender].name} ${fmtInt(l.balance)} cr${l.missed ? ` (${l.missed} payments missed)` : ''}${l.repo ? ', repossession ordered' : ''}`).join('; ')}.`);
        if (st.indenture) state.push(`${st.captain.name} is indentured to Combine Credit: most of their wages are garnished and leaving Combine space is treated as flight.`);
        if (st.bounty) state.push(`Ashen moneylenders have a ${fmtInt(st.bounty)} cr bounty on ${st.captain.name}, to be taken alive.`);
        if ((st.warrants ?? []).length) state.push(`Warrants for ${st.captain.name}: ${st.warrants.map(w => `${w.faction} space`).join(', ')}. Arrest is likely at any well-policed port there.`);
        if (st.laidUp) state.push(`${st.captain.name}'s ship, the ${st.laidUp.ship.name}, is laid up at ${st.laidUp.place} and is not with them.`);
        if (st.ship) {
            const miss = missingLicences(st, VESSELS[st.ship.classId]);
            if (miss.length) state.push(`${st.captain.name} is flying without the ${miss.map(id => LICENCES[id].name).join(' or the ')}.`);
        }
        if (st.captain.course) state.push(`${st.captain.name} is a student pilot working toward the ${LICENCES[st.captain.course.id].name}.`);
        rules.push(`<life>\nWages, loans, ship purchases, licences and sentences are run by the game. Never invent payments, pardons or releases. If the story has the character arrested and convicted, add: arrest <days> "offence". If they are captured and sold by slavers or pirates, add: enslave "owner name" <${OWNERS.map(o => o.kind).join('|')}> [nosale] (the kind of owner decides the kind of bondage; nosale for an owner who will never sell them their freedom).\n</life>`);
    }
    return { rules: rules.join('\n\n'), state: state.join('\n'), now: act.now };
}

export function initLifeUi() {
    onTick((st, mins) => { activityTick(st, mins); lifeTick(st); financeTick(st); });
    onArrival((st) => { paperCheck(st); arrivalChecks(st); });
    registerPromptSection(promptSection);

    const free = (st) => !st.custody;
    registerWidget({ id: 'custody', when: (st) => !!st.custody, title: (st) => (st.custody.type === 'prison' ? 'Prison' : 'Bondage'), render: custodyHtml });
    registerWidget({ id: 'whereabouts', when: free, title: () => 'Where you are', render: whereHtml });
    registerWidget({ id: 'jobs', when: free, title: () => 'Work and lodging', render: jobsHtml });
    registerWidget({ id: 'bank', title: () => 'Debts and lenders', render: bankHtml });
    registerWidget({ id: 'licences', when: free, title: () => 'Licences', render: licenceHtml });
    registerWidget({ id: 'shipyard', when: free, title: () => 'Shipyard', render: shipyardHtml });
    registerWidget({ id: 'parking', when: (st) => free(st) && (!!st.ship || !!st.laidUp), title: () => 'Pads and hangars', render: parkingHtml });
    registerTab({ id: 'custody', label: 'Custody', icon: 'fa-lock', order: 2, when: (st) => !!st.custody, widgets: ['custody', 'bank'] });
    registerTab({ id: 'station', label: 'Station', icon: 'fa-building', order: 25, when: free, widgets: ['whereabouts', 'jobs', 'bank', 'licences', 'shipyard', 'parking'] });

    registerActions({
        'life-work'(el) { act(() => takeShift(el.dataset.id)); },
        'area-go'(el) { act(() => moveTo(el.dataset.id)); },
        'act-start'() { act(() => clockIn()); },
        async 'act-quit'() { const a = S().activity; if (a && (!a.on || await confirmAsk('Walk out?', 'You lose what is left of it.'))) act(() => quit()); },
        'life-live'(el) { act(() => living(el.dataset.kind)); },
        'life-enrol'(el) { act(() => enrol(el.dataset.id)); },
        'life-course'() { act(() => courseStep()); },
        async 'life-borrow'(el) {
            const v = await ask(`Borrow how much? (up to ${fmtInt(el.dataset.max)} cr)`, el.dataset.max);
            const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
            if (n) act(() => takeLoan(el.dataset.lender, n));
        },
        async 'life-repay'(el) {
            const st = S();
            const loan = loans(st).find(l => l.id === el.dataset.id);
            if (!loan) return;
            const v = await ask(`Pay how much toward ${fmtInt(loan.balance)} cr?`, String(Math.min(Math.ceil(loan.balance), Math.floor(st.captain.credits))));
            const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
            if (n) act(() => repay(loan.id, n));
        },
        'yard-open'(el) { openOffer = openOffer === el.dataset.id ? null : el.dataset.id; commit('ui'); },
        'yard-inspect'(el) { act(() => inspect(el.dataset.id, el.dataset.how)); },
        async 'yard-buy'(el) {
            const name = await ask('Name her', '');
            if (name === null || name === undefined || name === false) return;
            act(() => buyShip(el.dataset.id, { finance: el.dataset.fin === '1', name: String(name).trim() }));
            openOffer = null;
        },
        async 'yard-sell'() { if (await confirmAsk('Sell your ship?', 'This cannot be undone.')) act(() => sellShip()); },
        'park'(el) { act(() => layUp(el.dataset.mode)); },
        'park-reclaim'() { act(() => reclaim()); },
        'custody'(el) { act(() => custodyAct(el.dataset.a, advanceTime)); },
    });

    registerCommand('area', (st, args) => moveTo(args.join(' '), { ai: isAiCommand() }), ['goto', 'walk']);
    registerCommand('arrest', (st, [days = '30', ...why]) => {
        if (st.custody) throw new Error('already in custody');
        imprison(st, isAiCommand() ? Math.min(Number(days) || 30, 365) : Number(days) || 30, why.join(' ') || 'an offence against the law');
        return `Imprisoned: ${st.loc.place}`;
    }, ['imprison', 'jail']);
    registerCommand('enslave', (st, args) => {
        if (st.custody?.type === 'slave') throw new Error('already enslaved');
        const kind = args.find(a => OWNERS.some(o => o.kind === a.toLowerCase()))?.toLowerCase();
        const nosale = args.some(a => /^nosale$/i.test(a));
        const name = args.filter(a => a.toLowerCase() !== kind && !/^nosale$/i.test(a)).join(' ');
        enslave(st, name, { kind, sells: nosale ? false : undefined });
        return `Enslaved (${ownerKind(st.custody).type.toLowerCase()}): property of ${st.custody.owner}`;
    }, ['enslaved']);
    registerCommand('release', (st, args) => {
        // The storyteller may free a slave through the story, but may not open a prison.
        if (isAiCommand() && st.custody?.type === 'prison') throw new Error('a sentence ends when it is served, or by escape');
        const c = release(st, args.join(' ') || 'freed');
        return c.type === 'slave' ? `Free of ${c.owner}` : 'Released';
    }, ['freed', 'rescued']);
}
