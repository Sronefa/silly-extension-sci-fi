// Navigation tab: pannable, zoomable sector map with route plotting and a system orbit view.
import { registerTab, registerWidget, registerActions, btn, ask } from './hud.js';
import { S, commit, addLog, galaxy } from '../core/state.js';
import { beginTransit, transitInfo, fmtDuration, onArrival } from '../systems/sim.js';
import { esc, fmtInt, clamp } from '../core/util.js';
import { toast } from '../core/st.js';
import { ECONOMIES } from '../data/catalog.js';
import { fuelMult } from '../systems/services.js';
import { isDown } from '../systems/body.js';
import { SECTOR_W, SECTOR_H, findRoute, factionById, SECURITY_LABELS, systemDistance } from '../systems/galaxy.js';
import { blip } from './sfx.js';

let view = null;      // current viewBox { x, y, w, h }
let selected = null;  // selected system id
let mode = 'sector';  // 'sector' | 'system'

export { onArrival as onJump };

function resetView(st) {
    const sys = galaxy().systems[st.loc.system];
    const w = 70, h = w * (SECTOR_H / SECTOR_W);
    view = { x: clamp(sys.x - w / 2, -10, SECTOR_W - w + 10), y: clamp(sys.y - h / 2, -10, SECTOR_H - h + 10), w, h };
}

function sectorSvg(st) {
    const g = galaxy();
    if (!view) resetView(st);
    const routeEdges = new Set();
    for (let i = 0; i < st.route.length - 1; i++) {
        const a = st.route[i], b = st.route[i + 1];
        routeEdges.add(a < b ? `${a}-${b}` : `${b}-${a}`);
    }
    const lanes = g.lanes.map(l => {
        const A = g.systems[l.a], B = g.systems[l.b];
        const on = routeEdges.has(`${l.a}-${l.b}`);
        return `<line class="sf-lane${on ? ' route' : ''}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>`;
    }).join('');
    const halos = g.systems.map(s => `<circle cx="${s.x}" cy="${s.y}" r="8" fill="${factionById(s.faction).color}" class="sf-halo"/>`).join('');
    const stars = g.systems.map(s => {
        const here = s.id === st.loc.system && !st.transit;
        const sel = s.id === selected;
        return `<g class="sf-sys${here ? ' here' : ''}${sel ? ' sel' : ''}${st.visited[s.id] ? ' visited' : ''}" data-sf="map-select" data-sys="${s.id}">
            <circle cx="${s.x}" cy="${s.y}" r="4.5" class="sf-hit"/>
            ${here ? `<circle cx="${s.x}" cy="${s.y}" r="2.6" class="sf-here-ring"/>` : ''}
            ${sel ? `<circle cx="${s.x}" cy="${s.y}" r="2" class="sf-sel-ring"/>` : ''}
            <circle cx="${s.x}" cy="${s.y}" r="${s.star.r / 5 + (s.capital ? 0.3 : 0)}" fill="${s.star.color}" class="sf-star"/>
            <text x="${s.x}" y="${s.y + 3.4}" class="sf-sys-label">${esc(s.name)}</text>
        </g>`;
    }).join('');
    const grid = [];
    for (let x = 0; x <= SECTOR_W; x += 10) grid.push(`<line class="sf-grid" x1="${x}" y1="0" x2="${x}" y2="${SECTOR_H}"/>`);
    for (let y = 0; y <= SECTOR_H; y += 10) grid.push(`<line class="sf-grid" x1="0" y1="${y}" x2="${SECTOR_W}" y2="${y}"/>`);
    return `<svg class="sf-map" viewBox="${view.x} ${view.y} ${view.w} ${view.h}" preserveAspectRatio="xMidYMid meet">
        <defs><filter id="sf-blur" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3"/></filter></defs>
        <g>${grid.join('')}</g><g filter="url(#sf-blur)">${halos}</g><g>${lanes}</g><g>${stars}</g>${shipMarker(st)}
    </svg>`;
}

function shipMarker(st) {
    const t = transitInfo(st);
    if (!t) return '';
    const x = t.fromSys.x + (t.toSys.x - t.fromSys.x) * t.progress;
    const y = t.fromSys.y + (t.toSys.y - t.fromSys.y) * t.progress;
    return `<line class="sf-lane route" x1="${t.fromSys.x}" y1="${t.fromSys.y}" x2="${t.toSys.x}" y2="${t.toSys.y}"/>
        <g class="sf-ship-marker"><circle cx="${x}" cy="${y}" r="1.6" class="sf-here-ring"/><path d="M ${x} ${y - 1.1} L ${x + 0.8} ${y + 0.8} L ${x} ${y + 0.4} L ${x - 0.8} ${y + 0.8} Z"/></g>`;
}

function systemSvg(sys) {
    const maxOrbit = Math.max(...sys.bodies.map(b => b.orbit), 1);
    const scale = 44 / maxOrbit;
    const bodies = sys.bodies.map(b => {
        const r = Math.max(6, b.orbit * scale);
        const x = 50 + Math.cos(b.angle) * r, y = 50 + Math.sin(b.angle) * r;
        if (b.belt) return `<circle cx="50" cy="50" r="${r}" class="sf-belt"/>`;
        const station = sys.stations.filter(s => s.orbiting === b.name);
        return `<circle cx="50" cy="50" r="${r}" class="sf-orbit"/>
            <circle cx="${x}" cy="${y}" r="${b.size * 0.55}" fill="${b.color}"><title>${esc(b.name)}: ${esc(b.type)}</title></circle>
            ${station.length ? `<rect x="${x + b.size * 0.55 + 0.6}" y="${y - 0.9}" width="1.8" height="1.8" class="sf-station-mark"/>` : ''}
            <text x="${x}" y="${y + b.size * 0.55 + 2.6}" class="sf-body-label">${esc(b.name.replace(sys.name, '').trim() || b.name)}</text>`;
    }).join('');
    return `<svg class="sf-map sf-orrery" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <circle cx="50" cy="50" r="3.2" fill="${sys.star.color}" class="sf-star"/>${bodies}</svg>`;
}

function jumpCost(st, a, b) {
    const d = systemDistance(galaxy(), a, b);
    // Without a ship you travel as a passenger: slower, and paid in credits instead of fuel.
    if (!st.ship) return { d, fuel: 0, fare: Math.round(120 + d * 45), hours: Math.round(10 + d * 2.5) };
    return { d, fuel: Math.round(d * st.ship.fuelPerLy * fuelMult(st) * 10) / 10, fare: 0, hours: Math.round(4 + d * 1.5) };
}

function infoBody(st) {
    const g = galaxy();
    const id = selected ?? st.loc.system;
    const sys = g.systems[id];
    const fac = factionById(sys.faction);
    const here = id === st.loc.system;
    const route = here ? null : findRoute(g, st.loc.system, id);
    let routeLine = '';
    if (route) {
        let fuel = 0, hours = 0, fare = 0;
        for (let i = 0; i < route.path.length - 1; i++) {
            const c = jumpCost(st, route.path[i], route.path[i + 1]);
            fuel += c.fuel; hours += c.hours; fare += c.fare;
        }
        routeLine = `<div class="sf-kv"><span>Route</span><b>${route.path.length - 1} jump${route.path.length > 2 ? 's' : ''} · ${route.dist} ly · ${st.ship ? `${Math.round(fuel * 10) / 10} fuel` : `${fmtInt(fare)} cr fare`} · ${hours} h</b></div>`;
    }
    const stations = sys.stations.map((s, i) => `<li class="sf-row"><span class="sf-grow"><b>${esc(s.name)}</b><br><small class="sf-dim">Orbiting ${esc(s.orbiting)} · ${s.services.join(', ')}</small></span>
        ${here && !st.transit && !(st.loc.docked && st.loc.station === i) ? btn('map-dock', 'Dock', { icon: 'fa-anchor', data: { idx: i } }) : ''}
        ${here && st.loc.docked && st.loc.station === i ? '<span class="sf-tag">docked</span>' : ''}</li>`).join('');
    const bodies = sys.bodies.map(b => `<span class="sf-tag"><i style="background:${b.color}" class="sf-dot"></i>${esc(b.name.replace(sys.name, '').trim() || 'Belt')} ${esc(b.type)}</span>`).join('');
    const next = st.route.length > 1 ? g.systems[st.route[1]] : null;
    const nextCost = next ? jumpCost(st, st.loc.system, next.id) : null;

    const tr = transitInfo(st);
    return `${tr ? `<div class="sf-route-bar transit"><span><i class="fa-solid fa-forward-fast"></i> In jump transit to <b>${esc(tr.toSys.name)}</b> · ${esc(fmtDuration(tr.left))} remaining<br>
        <span class="sf-xp"><span style="width:${Math.round(tr.progress * 100)}%"></span></span></span></div>` : ''}
    ${next && !tr ? `<div class="sf-route-bar"><span><i class="fa-solid fa-route"></i> Course laid in: <b>${esc(g.systems[st.route[st.route.length - 1]].name)}</b> · next ${esc(next.name)} (${st.ship ? `${nextCost.fuel} fuel` : `${fmtInt(nextCost.fare)} cr`}, ${nextCost.hours} h)</span>
        ${st.ship
        ? btn('map-jump', 'Engage jump', { icon: 'fa-forward-fast', cls: 'primary', disabled: st.ship.fuel < nextCost.fuel })
        : btn('map-jump', 'Book passage', { icon: 'fa-ticket', cls: 'primary', disabled: st.captain.credits < nextCost.fare })}${btn('map-clear', '', { icon: 'fa-xmark', cls: 'ghost', title: 'Clear course' })}</div>` : ''}
        <div class="sf-sub"><span style="color:${fac.color}">${esc(fac.name)}</span>${sys.capital ? ' · Capital' : ''}${here ? ' · <b>Current position</b>' : ''}${st.visited[id] ? '' : ' · Unvisited'}</div>
        <div class="sf-kv"><span>Star</span><b>${esc(sys.star.label)} (${esc(sys.star.cls)})</b></div>
        <div class="sf-kv"><span>Economy</span><b>${esc(ECONOMIES[sys.economy].label)}</b></div>
        <div class="sf-kv"><span>Security</span><b>${SECURITY_LABELS[sys.security]}</b></div>
        <div class="sf-kv"><span>Population</span><b>${fmtInt(sys.population)}</b></div>
        ${sys.hazard ? `<div class="sf-warn-line"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(sys.hazard)}</div>` : ''}
        ${routeLine}
        ${st.sysNotes[id] ? `<div class="sf-note">${esc(st.sysNotes[id])}</div>` : ''}
        <div class="sf-actions">
            ${!here && route && !st.transit ? btn('map-plot', 'Plot course', { icon: 'fa-route', cls: 'primary' }) : ''}
            ${btn('map-mode', mode === 'sector' ? 'System view' : 'Sector view', { icon: mode === 'sector' ? 'fa-circle-notch' : 'fa-map' })}
            ${btn('map-note', 'Note', { icon: 'fa-pen' })}
            ${btn('map-center', '', { icon: 'fa-crosshairs', title: 'Centre on ship' })}
        </div>
        <div class="sf-sub">Stations</div><ul class="sf-list">${stations}</ul>
        <div class="sf-sub">Bodies</div><div class="sf-tags">${bodies}</div>`;
}

function chartBody(st) {
    const g = galaxy();
    const sys = g.systems[selected ?? st.loc.system];
    return `<div class="sf-map-wrap">${mode === 'sector' ? sectorSvg(st) : systemSvg(sys)}
        <div class="sf-map-tools">${mode === 'sector' ? `${btn('map-zoom', '', { icon: 'fa-plus', data: { f: '0.7' } })}${btn('map-zoom', '', { icon: 'fa-minus', data: { f: '1.4' } })}` : ''}</div>
        <div class="sf-map-legend">${mode === 'sector' ? 'SECTOR CHART · grid 10 ly' : `${esc(sys.name)} · ORBITAL PLOT`}</div>
    </div>`;
}

function zoom(factor, cx, cy) {
    const w = clamp(view.w * factor, 20, 150);
    const f = w / view.w;
    cx ??= view.x + view.w / 2;
    cy ??= view.y + view.h / 2;
    view = { x: cx - (cx - view.x) * f, y: cy - (cy - view.y) * f, w, h: view.h * f };
}

function applyView(svg) {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
}

/** Pointer-based pan and pinch zoom; works for mouse, pen and touch. */
function mount(body) {
    const svg = body.querySelector('.sf-map:not(.sf-orrery)');
    if (!svg) return;
    const pts = new Map();
    let moved = 0, pinch = 0;
    const toUnits = () => view.w / svg.clientWidth;
    svg.addEventListener('pointerdown', (e) => {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        moved = 0;
        if (pts.size === 2) {
            const [a, b] = [...pts.values()];
            pinch = Math.hypot(a.x - b.x, a.y - b.y);
        }
    });
    svg.addEventListener('pointermove', (e) => {
        const p = pts.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 1) {
            moved += Math.abs(dx) + Math.abs(dy);
            if (moved > 6) {
                if (!svg.hasPointerCapture(e.pointerId)) svg.setPointerCapture(e.pointerId);
                const u = toUnits();
                view.x -= dx * u; view.y -= dy * u;
                applyView(svg);
            }
        } else if (pts.size === 2) {
            const [a, b] = [...pts.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinch > 0 && d > 0) { zoom(pinch / d); applyView(svg); }
            pinch = d;
            moved = 99;
        }
    });
    const end = (e) => { pts.delete(e.pointerId); pinch = 0; };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        const u = view.w / r.width;
        zoom(e.deltaY > 0 ? 1.15 : 0.87, view.x + (e.clientX - r.left) * u, view.y + (e.clientY - r.top) * u);
        applyView(svg);
    }, { passive: false });
    // A drag must not count as a tap on a star.
    svg.addEventListener('click', (e) => { if (moved > 6) { e.stopPropagation(); e.preventDefault(); } }, true);
}

export function doJump() {
    const st = S();
    const g = galaxy();
    if (st.transit) return toast('warning', 'Already in transit.');
    if (st.custody) return toast('warning', st.custody.type === 'prison' ? 'You are in prison.' : 'You are not free to go anywhere.');
    if (st.dead || st.combat || isDown(st.captain)) return toast('warning', 'You are in no state to travel.');
    if (st.route.length < 2) return toast('warning', 'No course laid in.');
    const to = g.systems[st.route[1]];
    const cost = jumpCost(st, st.loc.system, to.id);
    const from = g.systems[st.loc.system];
    if (st.ship) {
        if (st.ship.systems.engines <= 0) { blip('error'); return toast('error', 'Engines are offline. Repairs required.'); }
        if (st.ship.fuel < cost.fuel) { blip('error'); return toast('error', `Insufficient fuel: ${cost.fuel} needed.`); }
        st.ship.fuel = Math.round((st.ship.fuel - cost.fuel) * 10) / 10;
    } else {
        if (st.captain.credits < cost.fare) { blip('error'); return toast('error', `A berth costs ${cost.fare} cr.`); }
        st.captain.credits -= cost.fare;
    }
    beginTransit(to.id, cost.hours, { passenger: !st.ship });
    selected = to.id;
    addLog(st.ship
        ? `Jump engaged: ${from.name} to ${to.name} (${cost.d} ly, ${cost.fuel} fuel, about ${cost.hours} h in transit).`
        : `Boarded a transport from ${from.name} to ${to.name} (${cost.fare} cr, about ${cost.hours} h).`, 'nav');
    st.pendingEvent = `${st.ship ? `The ${st.ship.name} has just entered jump` : `${st.captain.name} has just boarded a passenger transport, which has entered jump`} from ${from.name} toward ${to.name}. The transit takes about ${cost.hours} hours of ship time and is lived, not skipped: life aboard goes on.`;
    blip('jump');
    commit('jump');
    toast('success', `Jump engaged. ${cost.hours} h to ${to.name}.`);
}

export function initMap() {
    registerWidget({ id: 'chart', title: () => (mode === 'sector' ? 'Sector chart' : 'Orbital plot'), render: chartBody, mount, flush: true });
    registerWidget({ id: 'sysinfo', title: (st) => galaxy().systems[selected ?? st.loc.system].name, render: infoBody });
    registerTab({ id: 'nav', label: 'Nav', icon: 'fa-map-location-dot', order: 20, widgets: ['chart', 'sysinfo'] });
    registerActions({
        'map-select'(el) { selected = Number(el.dataset.sys); commit('view'); },
        'map-mode'() { mode = mode === 'sector' ? 'system' : 'sector'; commit('view'); },
        'map-zoom'(el) { zoom(Number(el.dataset.f)); document.querySelectorAll('.sf-map:not(.sf-orrery)').forEach(applyView); },
        'map-center'() { view = null; selected = null; mode = 'sector'; commit('view'); },
        'map-plot'() {
            const st = S();
            const r = findRoute(galaxy(), st.loc.system, selected);
            if (!r) return toast('warning', 'No lane route to that system.');
            st.route = r.path;
            commit('route');
        },
        'map-clear'() { S().route = []; commit('route'); },
        'map-jump'() { doJump(); },
        'map-dock'(el) {
            const st = S();
            const sys = galaxy().systems[st.loc.system];
            st.loc.station = Number(el.dataset.idx);
            st.loc.docked = true;
            st.loc.place = '';
            addLog(`Docked at ${sys.stations[st.loc.station].name}.`, 'nav');
            commit('dock');
        },
        async 'map-note'() {
            const st = S();
            const id = selected ?? st.loc.system;
            const v = await ask('Note for this system', st.sysNotes[id] ?? '');
            if (v === null || v === undefined || v === false) return;
            if (String(v).trim()) st.sysNotes[id] = String(v).trim();
            else delete st.sysNotes[id];
            commit('note');
        },
    });
}
