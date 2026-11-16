// The wreck screen: a deck-by-deck sketch of the compartments, where the party is, the ways on,
// what a search turned up, and the suit air left. Parts that came out are dealt with at a yard.
import { registerTab, registerWidget, registerActions, btn, gauge, confirmAsk } from './hud.js';
import { S, commit } from '../core/state.js';
import { toast } from '../core/st.js';
import { esc, fmtInt } from '../core/util.js';
import { VESSELS } from '../data/vessels.js';
import { MODULES } from '../data/modules.js';
import { port, hasYard } from '../systems/services.js';
import { quit } from '../systems/activity.js';
import {
    SUIT_AIR, PART_REPAIR, wreckOf, boardable, boardWreck, leaveWreck, moveRoom, searchRoom, takeLoot, lootName, lootNeeds, neighbours,
    salvageTick, salvagePrompt, SALVAGE_RULE, salvagedParts, partValue, sellPart, stowPart, handInRecorder,
} from '../systems/salvage.js';
import { onTick, fmtDuration } from '../systems/sim.js';
import { registerPromptSection } from '../core/ailink.js';
import { shipHas } from '../systems/market.js';
import { blip } from './sfx.js';

const cr = (n) => `${fmtInt(n)} cr`;
const KIND_COLOR = { command: '#60a5fa', weapons: '#f87171', engineering: '#fbbf24', crew: '#a78bfa', medical: '#34d399', flight: '#22d3ee', hold: '#a3a3a3', service: '#94a3b8', public: '#f472b6' };

function act(fn) {
    try { const t = fn(); if (t) toast('success', t); blip('click'); } catch (e) { toast('warning', e.message); blip('error'); }
    commit('salvage');
}

function wreckSvg(st, w) {
    const at = st.salvage.at;
    const decks = [...new Set(w.rooms.map(r => r.deck))];
    const minX = Math.min(...w.rooms.map(r => r.x)), maxX = Math.max(...w.rooms.map(r => r.x + r.len));
    const W = 100, DH = 14;
    const sx = (x) => 2 + (x - minX) / Math.max(1, maxX - minX) * (W - 4);
    const pos = (r) => ({ x: sx(r.x + r.len / 2), y: decks.indexOf(r.deck) * DH + 2 + (r.y + r.h / 2) * (DH - 4) });
    const lines = w.links.map(([a, b, sight]) => {
        const A = pos(w.rooms[a]), B = pos(w.rooms[b]);
        return `<line x1="${A.x.toFixed(1)}" y1="${A.y.toFixed(1)}" x2="${B.x.toFixed(1)}" y2="${B.y.toFixed(1)}" stroke="#334155" stroke-width="0.5"${sight ? '' : ' stroke-dasharray="1 1"'}/>`;
    }).join('');
    const near = new Set(neighbours(w, at).map(n => n.to));
    const boxes = w.rooms.map(r => {
        const x0 = sx(r.x), x1 = sx(r.x + r.len), y0 = decks.indexOf(r.deck) * DH + 2 + r.y * (DH - 4);
        const known = r.seen || near.has(r.i);
        const fill = r.seen ? KIND_COLOR[r.kind] ?? '#64748b' : '#1e293b';
        const go = near.has(r.i) && !st.combat;
        return `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${Math.max(1, x1 - x0 - 0.6).toFixed(1)}" height="${(r.h * (DH - 4) - 0.6).toFixed(1)}" rx="0.6" fill="${fill}" fill-opacity="${r.seen ? 0.35 : 0.6}" stroke="${r.i === at ? '#fff' : go ? '#7dd3fc' : '#0f172a'}" stroke-width="${r.i === at ? 0.8 : 0.4}"${go ? ` data-sf="sv-go" data-to="${r.i}" style="cursor:pointer"` : ''}><title>${esc(known ? r.name : 'Unexplored')}</title></rect>`;
    }).join('');
    const me = pos(w.rooms[at]);
    return `<svg viewBox="0 0 ${W} ${decks.length * DH + 2}" style="width:100%;background:#05080d;border-radius:6px">${lines}${boxes}<circle cx="${me.x.toFixed(1)}" cy="${me.y.toFixed(1)}" r="1.4" fill="#4ade80" pointer-events="none"/></svg>
        <small class="sf-dim">${decks.length} deck${decks.length > 1 ? 's' : ''}, bow to the left. Dashed lines are ladders and hatches. Tap a compartment next to yours to go there.</small>`;
}

function aboardHtml(st) {
    const w = wreckOf(st);
    const sv = st.salvage;
    const r = w.rooms[sv.at];
    const busy = !!(st.combat || st.activity?.on);
    const ways = neighbours(w, sv.at).map(n => {
        const o = w.rooms[n.to];
        return btn('sv-go', o.seen ? o.name : `${o.name} (unexplored)`, { icon: n.sight ? 'fa-door-open' : 'fa-stairs', data: { to: n.to }, disabled: busy });
    }).join('');
    const loot = r.searched ? r.loot.map(l => {
        const need = lootNeeds(st, l);
        return `<li class="sf-row sf-wrap"><span class="sf-grow">${esc(lootName(l))}${l.type === 'part' ? `<br><small class="sf-dim">${esc(MODULES[l.mod].desc || '')}</small>` : ''}${need.why ? `<br><small class="sf-warn-line">${esc(need.why)}</small>` : ''}</span>
            ${btn('sv-take', need.mins > 20 ? `Cut free · ${fmtDuration(need.mins)}` : 'Take', { icon: need.mins > 20 ? 'fa-screwdriver-wrench' : 'fa-hand', data: { id: l.id }, disabled: busy || !!need.why })}</li>`;
    }).join('') : '';
    const cutting = st.activity?.kind === 'cut' && st.activity.on ? st.activity : null;
    return `${gauge('Suit air', sv.air, SUIT_AIR, { text: fmtDuration(sv.air), invert: false })}
        ${wreckSvg(st, w)}
        <div class="sf-note"><b>${esc(r.name)}</b> · deck ${r.deck}<br><small>${esc(r.desc || '')}</small>${r.hazard ? `<br><small class="sf-warn-line">Hazard: ${esc(r.hazard)}</small>` : ''}</div>
        ${st.combat ? '<div class="sf-note">There is fighting in here. Finish it on the Combat tab.</div>' : ''}
        ${cutting ? `<div class="sf-note"><b>${esc(cutting.name)}</b><br>${esc(fmtDuration(cutting.done))} done, ${esc(fmtDuration(cutting.need - cutting.done))} to go.
            <span class="sf-xp sf-act-bar"><span style="width:${Math.round(100 * cutting.done / cutting.need)}%"></span></span></div>
            <small class="sf-dim">Lived time, and the suit air runs with it. Play the work, or let it pass with the hourglass <i class="fa-solid fa-hourglass-half"></i>.</small>
            <div class="sf-actions">${btn('sv-stopcut', 'Stop', { icon: 'fa-stop' })}</div>` : ''}
        <div class="sf-sub">Ways on</div><div class="sf-actions">${ways || '<span class="sf-dim">None</span>'}</div>
        ${r.searched ? `<div class="sf-sub">Found here</div><ul class="sf-list">${loot || '<li class="sf-dim">Nothing worth taking.</li>'}</ul>` : `<div class="sf-actions">${btn('sv-search', 'Search this compartment', { icon: 'fa-magnifying-glass', cls: 'primary', disabled: busy })}</div>`}
        <div class="sf-actions">${btn('sv-leave', 'Back to the ship', { icon: 'fa-person-walking-arrow-loop-left', disabled: busy })}</div>
        ${shipHas(st, 'salvage') ? '' : '<small class="sf-dim">Without a salvage rig aboard your ship, only small parts can be carried out by hand.</small>'}`;
}

function wreckHtml(st) {
    if (st.salvage) return aboardHtml(st);
    const src = boardable(st);
    if (!src) return '<div class="sf-dim">No wreck here. Derelicts are found by surveying, from charts, or in the story; ships you beat in battle can be boarded from the battle report.</div>';
    const cls = VESSELS[src.cls];
    return `<div class="sf-note">The ${esc(src.name)}: a ${esc(cls.role.toLowerCase())}, about ${cls.size >= 3 ? 'a hundred' : 'fifty'} metres of dead hull, adrift some ${src.age} years.</div>
        <small class="sf-dim">Going aboard means suits and ${fmtDuration(SUIT_AIR)} of air. You explore her compartment by compartment from her real deck plan. Expect hazards, and maybe company. The reactor will be dead; everything else is luck.</small>
        <div class="sf-actions">${btn('sv-board', 'Go aboard', { icon: 'fa-user-astronaut', cls: 'primary', disabled: !!(st.activity?.on || st.combat || st.shipCombat) })}</div>`;
}

function partsHtml(st) {
    const parts = salvagedParts(st);
    const recs = st.captain.inventory.filter(i => i.recorder);
    if (!parts.length && !recs.length) return '<div class="sf-dim">Nothing salvaged in the hold.</div>';
    const p = port(st);
    const yard = hasYard(p);
    const rows = parts.map(c => {
        const mod = c.part.mod ? MODULES[c.part.mod] : null;
        const stow = mod && c.part.cond !== 'scrap'
            ? btn('sv-stow', c.part.cond === 'damaged' ? `Rebuild · ${cr(mod.price * PART_REPAIR)}` : 'Stow as spare', { icon: 'fa-box-archive', data: { id: c.id }, disabled: c.part.cond === 'damaged' && !yard }) : '';
        return `<li class="sf-row sf-wrap"><span class="sf-grow">${esc(c.name)} <small class="sf-dim">${c.qty} t</small></span>${stow}${btn('sv-sell', cr(partValue(st, c)), { icon: 'fa-coins', data: { id: c.id }, disabled: !yard })}</li>`;
    }).join('');
    const recRows = recs.map(i => `<li class="sf-row"><span class="sf-grow">${esc(i.name)}</span>${btn('sv-recorder', cr(i.recorder.value), { icon: 'fa-coins', data: { id: i.id }, disabled: !p, title: 'Insurers pay for these at any port office' })}</li>`).join('');
    return `<ul class="sf-list">${rows}${recRows}</ul><small class="sf-dim">${yard ? 'A repair yard here buys parts and rebuilds damaged ones.' : 'Parts are sold or rebuilt at a station with a repair yard.'} Spares are fitted from the refit screen.</small>`;
}

export function initSalvageUi() {
    onTick((st, mins) => salvageTick(st, mins));
    registerPromptSection((st) => (st.salvage ? { rules: SALVAGE_RULE, state: salvagePrompt(st) } : ''));
    registerWidget({ id: 'svwreck', title: (st) => (st.salvage ? `Aboard the ${wreckOf(st)?.name ?? 'wreck'}` : 'Wreck'), render: wreckHtml });
    registerWidget({ id: 'svparts', title: () => 'Salvage in the hold', render: partsHtml, when: (st) => salvagedParts(st).length > 0 || st.captain.inventory.some(i => i.recorder) });
    registerTab({ id: 'wreck', label: 'Wreck', icon: 'fa-user-astronaut', order: 22.5, when: (st) => !st.custody && !!(st.salvage || boardable(st)), widgets: ['svwreck'], badge: (st) => (st.salvage && st.salvage.air < 60 ? '!' : '') });
    registerActions({
        'sv-board'() { act(() => boardWreck()); },
        'sv-go'(el) { act(() => moveRoom(el.dataset.to)); },
        'sv-search'() { act(() => searchRoom()); },
        'sv-take'(el) { act(() => takeLoot(el.dataset.id)); },
        async 'sv-stopcut'() { if (await confirmAsk('Stop cutting?', 'The part stays in the wreck.')) act(() => quit()); },
        'sv-leave'() { act(() => leaveWreck()); },
        'sv-sell'(el) { act(() => sellPart(el.dataset.id)); },
        'sv-stow'(el) { act(() => stowPart(el.dataset.id)); },
        'sv-recorder'(el) { act(() => handInRecorder(el.dataset.id)); },
    });
}
