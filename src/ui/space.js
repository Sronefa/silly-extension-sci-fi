// The space around the station: flying between stations and sites in the system, sensor surveys,
// the cartography desk, and the mining plot. The Space tab needs a ship; the Mining tab needs
// a ship with mining lasers, and does not exist otherwise.
import { registerTab, registerWidget, registerActions, btn, confirmAsk } from './hud.js';
import { S, commit, galaxy } from '../core/state.js';
import { toast } from '../core/st.js';
import { esc, fmtInt } from '../core/util.js';
import { SITE_KINDS, FIELD_TYPES, ZONES, CLAIM } from '../data/sites.js';
import { goodById } from '../data/economy.js';
import { port } from '../systems/services.js';
import { areaOf, quit } from '../systems/activity.js';
import {
    knownSites, sitesOf, isKnown, herePos, placeOf, flightMinutes, flyTo, cruiseTick, currentSite, startSurvey, sensorPower,
    describeSite, sellableData, dataValue, sellData, chartPrice, buyChart, fileClaim, zoneOf, siteBook, revealFromStory, sitesPrompt,
} from '../systems/sites.js';
import {
    PLOT_KM, canMine, laserCount, refines, scanRange, shipInField, visibleRocks, rockInReach, helmTo, approach, fieldTick,
    scanRocks, startMining, miningPrompt, fieldSpeed,
} from '../systems/mining.js';
import { registerCommand, onTick, fmtDuration } from '../systems/sim.js';
import { registerPromptSection } from '../core/ailink.js';
import { blip } from './sfx.js';

const cr = (n) => `${fmtInt(n)} cr`;
let selRock = null;

function act(fn) {
    try {
        const r = fn();
        const text = typeof r === 'string' ? r : r?.text;
        if (text) toast('success', text);
        blip('click');
    } catch (e) { toast('warning', e.message); blip('error'); }
    commit('space');
}

// ---- Where the ship is, and where it can go ----

function whereLine(st) {
    const sys = galaxy().systems[st.loc.system];
    if (st.transit) return 'In jump transit.';
    if (st.cruise) {
        const left = Math.max(0, st.cruise.end - st.minutes);
        const f = Math.min(1, (st.minutes - st.cruise.start) / Math.max(1, st.cruise.end - st.cruise.start));
        return `${st.cruise.ferry ? 'On the system ferry' : 'In flight'} to <b>${esc(st.cruise.name)}</b>, ${esc(fmtDuration(left))} to go.
            <span class="sf-xp"><span style="width:${Math.round(f * 100)}%"></span></span>
            <small class="sf-dim">The flight is lived. Play it, or let the time go by with the hourglass <i class="fa-solid fa-hourglass-half"></i> ("until you get there").</small>`;
    }
    if (st.loc.docked) return `Docked at <b>${esc(sys.stations[st.loc.station]?.name ?? '?')}</b>.`;
    const s = currentSite(st);
    if (s) return `Holding at <b>${esc(s.name)}</b>: ${esc(describeSite(st, s))}.`;
    return `In open space in the ${esc(sys.name)} system.`;
}

function placeRow(st, ref, name, sub, icon) {
    const from = herePos(st);
    const to = placeOf(st, ref);
    const here = (st.loc.docked && to?.station === st.loc.station && !st.cruise) || (!st.loc.docked && !st.cruise && to?.site && st.loc.site === to.site.id);
    const heading = st.cruise?.to === ref;
    const mins = from && to ? flightMinutes(st, from, to.pos) + (st.loc.docked ? 10 : 0) + (to.station != null ? 10 : 0) : 0;
    const busy = !!(st.cruise || st.transit || st.activity?.on || st.combat || st.shipCombat);
    return `<li class="sf-row sf-wrap"><span class="sf-grow"><i class="fa-solid ${icon}"></i> <b>${esc(name)}</b><br><small class="sf-dim">${esc(sub)}</small></span>
        ${here ? '<span class="sf-tag">here</span>' : heading ? '<span class="sf-tag">heading there</span>'
        : btn('sp-fly', fmtDuration(mins), { icon: 'fa-location-arrow', data: { ref }, disabled: busy, title: to?.station != null ? 'Fly there and dock' : 'Fly there' })}</li>`;
}

function sitesHtml(st) {
    const sys = galaxy().systems[st.loc.system];
    if (st.transit) return '<div class="sf-dim">In jump transit. The system you are bound for opens up on arrival.</div>';
    const known = knownSites(st);
    const hidden = sitesOf(st.seed, sys.id).length - known.length;
    const stations = sys.stations.map((s, i) => placeRow(st, `st:${i}`, s.name, `Station, orbiting ${s.orbiting}`, 'fa-satellite'));
    const sites = known.map(s => placeRow(st, s.id, s.name, `${SITE_KINDS[s.kind].name}: ${describeSite(st, s)}`, SITE_KINDS[s.kind].icon));
    const chart = siteBook(st).charts[sys.id];
    return `<div class="sf-note">${whereLine(st)}</div>
        <ul class="sf-list">${stations.join('')}${sites.join('')}</ul>
        <small class="sf-dim">${hidden > 0 ? 'Most of the system is uncharted: fields, wrecks and stranger things are out there for a survey to find.' : 'You know every site in this system.'}${chart ? ' You hold the public charts of this system.' : ''}</small>`;
}

function surveyHtml(st) {
    if (!st.ship) return '';
    const a = st.activity;
    if (a?.kind === 'survey' || a?.kind === 'mine') {
        return `<div class="sf-note"><b>${esc(a.name)}</b><br>${esc(fmtDuration(a.done))} done, ${esc(fmtDuration(a.need - a.done))} to go.${a.kind === 'survey' ? ` ${a.found.length} contact${a.found.length === 1 ? '' : 's'} so far.` : ` ${a.cut} t cut.`}
            <span class="sf-xp sf-act-bar"><span style="width:${Math.round(100 * a.done / a.need)}%"></span></span></div>
            <small class="sf-dim">Lived time: play the watch, or let it pass with the hourglass <i class="fa-solid fa-hourglass-half"></i>.</small>
            <div class="sf-actions">${btn('sp-stop', 'Stop', { icon: 'fa-stop' })}</div>`;
    }
    const can = !st.loc.docked && !st.cruise && !st.transit && !a?.on;
    const power = sensorPower(st);
    return `<small class="sf-dim">A sweep listens and pings for hours, picking out what is too faint to see in passing. Sensors: ${power >= 1.2 ? 'military grade' : power >= 0.9 ? 'good' : power >= 0.6 ? 'ordinary' : 'poor'}. Faint things, like a base running dark, take long sweeps and good sensors.</small>
        <div class="sf-actions">${[2, 6, 12].map(h => btn('sp-survey', `Sweep ${h} h`, { icon: 'fa-satellite-dish', data: { h }, disabled: !can })).join('')}</div>
        ${can ? '' : `<small class="sf-dim">${st.loc.docked ? 'Undock first: station traffic drowns everything out.' : 'The ship has to be holding still, and the crew free.'}</small>`}`;
}

function deskHtml(st) {
    const p = port(st);
    if (!p) return '<div class="sf-dim">The cartography desk is in the port office of a station.</div>';
    const here = areaOf(st) === 'office';
    const g = galaxy();
    const near = [p.sys.id, ...g.adj[p.sys.id].map(e => e.to)];
    const book = siteBook(st);
    const charts = near.map(id => {
        const price = chartPrice(st, id);
        const have = book.charts[id];
        return `<li class="sf-row"><span class="sf-grow">Charts of <b>${esc(g.systems[id].name)}</b></span>${have ? '<span class="sf-tag">owned</span>' : price ? btn('sp-chart', cr(price), { icon: 'fa-map', data: { sys: id }, disabled: !here || st.captain.credits < price }) : '<small class="sf-dim">nobody keeps them</small>'}</li>`;
    }).join('');
    const sell = sellableData(st).map(s => {
        const v = dataValue(st, s);
        return `<li class="sf-row"><span class="sf-grow"><i class="fa-solid ${SITE_KINDS[s.kind].icon}"></i> ${esc(s.name)} <small class="sf-dim">${esc(g.systems[s.sys].name)}</small></span>${v ? btn('sp-sell', cr(v), { icon: 'fa-coins', data: { id: s.id }, disabled: !here }) : '<small class="sf-dim">no buyer here</small>'}</li>`;
    }).join('');
    const claimable = knownSites(st, p.sys.id).filter(s => s.kind === 'field' && s.zone === 'claimable');
    const claims = claimable.map(s => {
        const c = book.claims[s.id];
        const mine = zoneOf(st, s) === 'mine';
        return `<li class="sf-row"><span class="sf-grow">${esc(s.name)} <small class="sf-dim">${esc(FIELD_TYPES[s.type].name)}${mine ? `, yours for ${esc(fmtDuration(c.until - st.minutes))}` : ''}</small></span>${btn('sp-claim', mine ? 'Renew' : `File · ${cr(CLAIM.perWeek * CLAIM.weeks)}`, { icon: 'fa-stamp', data: { id: s.id }, disabled: !here })}</li>`;
    }).join('');
    return `<small class="sf-dim">${here ? '' : 'You can read the listings from anywhere on the station; business is done at the port office. '}Public charts show the fields and wrecks on record, never the hidden things. Your own survey finds sell here, once each.</small>
        <div class="sf-sub">Charts</div><ul class="sf-list">${charts}</ul>
        <div class="sf-sub">Your survey data</div><ul class="sf-list">${sell || '<li class="sf-dim">Nothing unsold.</li>'}</ul>
        <div class="sf-sub">Mining claims in this system</div><ul class="sf-list">${claims || '<li class="sf-dim">No unclaimed fields known here.</li>'}</ul>
        <small class="sf-dim">A claim runs ${CLAIM.weeks} weeks. Claimed ground is richer than the open zones, and mining someone else's is poaching.</small>`;
}

// ---- The mining plot ----

const ORE_COLORS = { ore: '#b07a4a', raremetals: '#d4b44a', silicates: '#9a9a8a', ice: '#8fd0f0', water: '#6ab0e0', gas: '#b0e0a0', radioactives: '#9fe04a', gems: '#e05ad0' };

function plotSvg(st, here) {
    const rocks = visibleRocks(st, here).filter(r => r.seen);
    const range = scanRange(st);
    const reach = rockInReach(st);
    const dots = rocks.map(r => {
        const rad = 0.12 + r.size / 700;
        const col = r.scanned ? (ORE_COLORS[r.ore] ?? '#aaa') : '#6b7280';
        const spent = r.left <= 0;
        return `<circle cx="${r.x}" cy="${r.y}" r="${rad.toFixed(2)}" fill="${spent ? 'none' : col}" stroke="${r.id === selRock ? '#fff' : spent ? '#555' : 'none'}" stroke-width="0.08" opacity="${spent ? 0.6 : 0.9}" data-sf="mn-rock" data-id="${esc(r.id)}" style="cursor:pointer"/>`;
    }).join('');
    const f = st.field;
    const path = f?.move ? `<line x1="${here.x.toFixed(2)}" y1="${here.y.toFixed(2)}" x2="${f.move.x1}" y2="${f.move.y1}" stroke="#7dd3fc" stroke-width="0.06" stroke-dasharray="0.25 0.2"/>` : '';
    const grid = Array.from({ length: PLOT_KM / 5 + 1 }, (_, i) => i * 5).map(v => `<line x1="${v}" y1="0" x2="${v}" y2="${PLOT_KM}"/><line x1="0" y1="${v}" x2="${PLOT_KM}" y2="${v}"/>`).join('');
    return `<svg class="sf-plot sf-field" viewBox="-0.5 -0.5 ${PLOT_KM + 1} ${PLOT_KM + 1}" data-sf="mn-plot" style="width:100%;max-height:60vh;background:#05080d;touch-action:manipulation">
        <g stroke="#1e293b" stroke-width="0.04">${grid}</g>
        ${range ? `<circle cx="${here.x.toFixed(2)}" cy="${here.y.toFixed(2)}" r="${range}" fill="none" stroke="#22d3ee" stroke-width="0.05" stroke-dasharray="0.3 0.3" opacity="0.6" pointer-events="none"/>` : ''}
        ${path}${dots}
        <g transform="translate(${here.x.toFixed(2)} ${here.y.toFixed(2)})" pointer-events="none"><polygon points="0,-0.35 0.25,0.25 -0.25,0.25" fill="${reach ? '#4ade80' : '#7dd3fc'}"/></g>
        <text x="0" y="${PLOT_KM + 0.4}" font-size="0.45" fill="#64748b">5 km grid · tap open space to move, a rock to select it</text></svg>`;
}

function rockLine(st, here, r) {
    const d = Math.max(0, r.d - r.size / 2000);
    if (!r.scanned) return `A ${r.size} m rock, ${d.toFixed(1)} km off. ${scanRange(st) ? 'Not read yet: bring it within scanner range and sweep.' : 'Without an ore scanner you only learn what it holds by cutting it.'}`;
    return `A ${r.size} m rock of ${goodById(r.ore).name.toLowerCase()}, about ${fmtInt(r.left)} t left at ${Math.round(r.purity * 100)}% purity${refines(st) ? ` (${Math.min(95, Math.round(r.purity * 200))}% through the refining rig)` : ''}${r.hazard ? `, and the scanner flags ${r.hazard === 'volatile' ? 'gas pockets' : 'fault lines'}` : ''}. ${d.toFixed(1)} km off.`;
}

function fieldHtml(st) {
    const here = shipInField(st);
    if (!here) {
        const fields = knownSites(st).filter(s => s.kind === 'field');
        return `<div class="sf-dim">The ship is not in an asteroid field. ${fields.length ? `Known fields here: ${fields.map(s => esc(s.name)).join(', ')}. Fly there from the Space tab.` : 'No fields are known in this system yet: survey, or buy the charts.'}</div>`;
    }
    const z = zoneOf(st, here.site);
    const rocks = visibleRocks(st, here);
    const sel = rocks.find(r => r.id === selRock && r.seen);
    const reach = rockInReach(st);
    const a = st.activity;
    const cutting = a?.kind === 'mine' && a.on;
    const busy = !!(a?.on || st.shipCombat || st.combat);
    const free = Math.max(0, (st.ship.cargoCap ?? 0) - st.cargo.reduce((n, c) => n + (c.qty || 0), 0));
    return `<div class="sf-sub">${esc(here.site.name)} · ${esc(FIELD_TYPES[here.site.type].name)} · ${z === 'mine' ? '<b class="sf-ok-line">your claim</b>' : z === 'claimed' ? `<b class="sf-warn-line">${esc(here.site.owner)}'s claim: this is poaching</b>` : esc(ZONES[z].name)}</div>
        ${plotSvg(st, here)}
        <div class="sf-note">${here.moving ? `Under helm, ${esc(fmtDuration(here.eta))} to go.` : reach ? 'Alongside a rock, in laser reach.' : 'Holding station.'} Lasers: ${laserCount(st)}${refines(st) ? ', refining rig running' : ''}. Hold: ${fmtInt(free)} t free. Manoeuvring at ${(fieldSpeed(st) * 60).toFixed(0)} km/h.</div>
        ${sel ? `<div class="sf-note"><b>Selected:</b> ${esc(rockLine(st, here, sel))}</div>` : ''}
        ${cutting ? `<div class="sf-note"><b>${esc(a.name)}</b><br>${esc(fmtDuration(a.done))} done, ${esc(fmtDuration(a.need - a.done))} to go. ${a.cut} t cut.
            <span class="sf-xp sf-act-bar"><span style="width:${Math.round(100 * a.done / a.need)}%"></span></span></div>
            <small class="sf-dim">Lived time: play the shift, or let it pass with the hourglass <i class="fa-solid fa-hourglass-half"></i>.</small>
            <div class="sf-actions">${btn('sp-stop', 'Stop cutting', { icon: 'fa-stop' })}</div>`
        : `<div class="sf-actions">
            ${btn('mn-scan', 'Scan', { icon: 'fa-wave-square', disabled: busy || here.moving || !scanRange(st), title: scanRange(st) ? `Reads every rock within ${scanRange(st)} km` : 'No ore scanner fitted' })}
            ${btn('mn-approach', 'Approach selected', { icon: 'fa-location-arrow', disabled: busy || !sel || sel.left <= 0 })}
            ${[2, 4, 8].map(h => btn('mn-cut', `Cut ${h} h`, { icon: 'fa-bolt', cls: h === 4 ? 'primary' : '', data: { h }, disabled: busy || !reach || here.moving || free < 1 })).join('')}</div>`}
        <small class="sf-dim">Helm orders take real time, longer for big hulls. Ore grade is what the market pays for: the price on the board is for ore at half purity.</small>`;
}

// ---- Prompt and commands ----

const SPACE_RULE = '<space>\nAsteroid fields, wrecks, anomalies and hidden bases are unknown to the character until the game says they are found. Flights inside a system take the time the game sets; never move the ship or dock it yourself. When someone in the story tells the character where something is, add: site reveal <field|derelict|anomaly|cache|hideout>.\n</space>';

export function initSpaceUi() {
    onTick((st) => { cruiseTick(st); fieldTick(st); });
    registerPromptSection((st) => {
        if (st.custody || st.transit) return '';
        const state = [sitesPrompt(st), miningPrompt(st)].filter(Boolean).join('\n');
        return { rules: SPACE_RULE, state };
    });
    registerCommand('site', (st, [op, kind]) => {
        if (/^(reveal|learn|tip)$/i.test(op ?? '')) return revealFromStory(kind ?? '');
        throw new Error('usage: site reveal <kind>');
    }, ['poi']);
    registerWidget({ id: 'spsites', title: (st) => `${galaxy().systems[st.loc.system].name} system`, render: sitesHtml });
    registerWidget({ id: 'spsurvey', title: () => 'Sensor survey', render: surveyHtml, when: (st) => !!st.ship });
    registerWidget({ id: 'spdesk', title: () => 'Cartography desk', render: deskHtml });
    registerWidget({ id: 'mnfield', title: () => 'Mining', render: fieldHtml });
    registerTab({ id: 'space', label: 'Space', icon: 'fa-satellite', order: 21, when: (st) => !st.custody && !!st.ship, widgets: ['spsites', 'spsurvey', 'svparts', 'spdesk'] });
    // No mining lasers, no mining tab.
    registerTab({ id: 'mining', label: 'Mining', icon: 'fa-meteor', order: 22, when: (st) => !st.custody && canMine(st), widgets: ['mnfield'], badge: (st) => (shipInField(st) ? '•' : '') });
    registerActions({
        'sp-fly'(el) { act(() => flyTo(el.dataset.ref)); },
        'sp-survey'(el) { act(() => startSurvey(Number(el.dataset.h))); },
        async 'sp-stop'() { if (await confirmAsk('Stop now?', 'What is done so far is kept.')) act(() => quit()); },
        'sp-chart'(el) { act(() => buyChart(Number(el.dataset.sys))); },
        'sp-sell'(el) { act(() => sellData(el.dataset.id)); },
        'sp-claim'(el) { act(() => fileClaim(el.dataset.id)); },
        'mn-rock'(el) { selRock = el.dataset.id; commit('view'); },
        'mn-plot'(el, ev) {
            if (ev.target.closest?.('[data-sf="mn-rock"]')) return;
            const svg = el.closest('svg') ?? el;
            const pt = svg.createSVGPoint();
            pt.x = ev.clientX; pt.y = ev.clientY;
            const p = pt.matrixTransform(svg.getScreenCTM().inverse());
            act(() => helmTo(p.x, p.y));
        },
        'mn-approach'() { act(() => approach(selRock)); },
        'mn-scan'() { act(() => scanRocks()); },
        'mn-cut'(el) { act(() => startMining(Number(el.dataset.h))); },
    });
    void isKnown;
}
