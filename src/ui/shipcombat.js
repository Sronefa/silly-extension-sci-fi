// The tactical screen for ship combat. What you see depends on your station: a captain or pilot
// gets everything, an officer gets the plot and their own console, and someone with no station
// gets no tactical picture at all, only what they can feel.
import { registerTab, registerWidget, registerActions, gauge, btn, openHud, redraw, confirmAsk } from './hud.js';
import { S, commit, onChange, addLog } from '../core/state.js';
import { toast, ctx, settings, gmOn } from '../core/st.js';
import { esc, clamp, fmtInt } from '../core/util.js';
import { SIZES, SC_WEAPONS, ARC_NAMES, ROOMS, VESSELS, POSTS, THROTTLES, POWER_PRESETS, TRACK_NAMES, PULSE_SECONDS, sensorGrade, GRADE_NAMES, LOADS, loadsFor, STYLES, FAMILIES, LEGAL, hullAccess } from '../data/vessels.js';
import {
    SC, clsOf, sizeOf, shipById, playerShip, isActive, dist, bearing, angDiff, playerPost, clearance, resolveClass,
    startShipCombatFromTokens, runPulse, order, pendingOrders, weaponBlock, hitChance, orderSeconds, quality, joinBoardingDefence, dcTeams, autoDc,
    topSpeed, sensorRange, signature, roomPct, warpSpool, playerSurrender, abandonShip, demandSurrender, setFleetOrder,
    abortShipCombat, salvagePrize, tetherOn, masked, shownAs, consoles,
} from '../systems/shipcombat.js';
import { startCombat, parseEnemies } from '../systems/combat.js';
import { registerCommand } from '../systems/sim.js';
import { registerPromptSection } from '../core/ailink.js';
import { blip } from './sfx.js';
import { deckPlan } from '../data/decks.js';
import { boardPrize } from '../systems/salvage.js';

const can = (domain, sc = SC()) => !!sc && consoles(sc).includes(domain);
const live = (sc = SC()) => { const ps = playerShip(sc); return !!ps && isActive(ps) && !sc.over; };
const hasConsole = (st) => !!st.shipCombat && consoles(st.shipCombat).length > 0;
const clock = (pulses) => { const s = pulses * PULSE_SECONDS; return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const deg = (n) => String(Math.round(((n % 360) + 360) % 360)).padStart(3, '0');
const off = (ok) => !ok;
const secs = (n) => (n < 15 ? 'at once' : n < 90 ? `in about ${Math.round(n / 5) * 5} seconds` : `in about ${clock(Math.round(n / PULSE_SECONDS))}`);
const rating = (q) => (q >= 7 ? 'superb' : q >= 5 ? 'sharp' : q >= 3 ? 'competent' : q >= 2 ? 'green' : 'out of their depth');

// ---- The plot ---------------------------------------------------------------------------

function glyph(s, level, mine, sel, k) {
    const sc = SC();
    const foe = s.side === 'enemy';
    // A decoy drone the sensors have not seen through is drawn exactly like the ship it copies.
    const fake = foe && masked(sc, 'ally', s);
    const src = fake ? (shipById(s.mimic, sc) ?? s) : s;
    const size = SIZES[(foe ? shownAs(sc, 'ally', s) : clsOf(s)).size].draw * k * (!foe && s.mimic ? 0.5 : 1);
    const cls = `sf-ship ${foe ? 'foe' : 'friend'}${mine ? ' own' : ''}${sel ? ' sel' : ''} st-${s.state}`;
    const attr = foe ? ` data-sf="sc-target" data-id="${s.id}"` : (mine ? '' : ` data-sf="sc-ally" data-id="${s.id}"`);
    if (foe && level === 1) {
        return `<g class="${cls} blip"${attr} transform="translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})"><rect x="${-6 * k}" y="${-6 * k}" width="${12 * k}" height="${12 * k}" transform="rotate(45)"/><text y="${4 * k}" font-size="${10 * k}">?</text><circle class="hit" r="${18 * k}"/></g>`;
    }
    const label = foe && level === 2 ? (sc?.misid?.[s.id] ?? shownAs(sc, 'ally', s).role) : !foe && s.mimic ? 'decoy' : foe && s.mimic && !fake ? 'decoy drone' : s.name;
    const hull = (!foe && !s.mimic) || (foe && level >= 3) ? ` ${Math.max(0, Math.round(100 * src.hull / src.maxHull))}%` : '';
    return `<g class="${cls}"${attr} transform="translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})">
        ${s.sandUp > 0 ? `<circle class="sand" r="${size * 2.2}"/>` : ''}${mine ? `<circle class="ring" r="${size * 1.5}"/>` : ''}${sel ? `<circle class="reticle" r="${size * 1.7}"/>` : ''}
        <g transform="rotate(${s.heading.toFixed(0)})"><path d="M0 ${-size} L${size * 0.62} ${size * 0.8} L0 ${size * 0.45} L${-size * 0.62} ${size * 0.8} Z"/>${isActive(s) ? `<line x1="0" y1="${-size}" x2="0" y2="${-size - clamp(s.speed, 0, 300) * 0.5 - 6 * k}"/>` : ''}</g>
        <text y="${size + 15 * k}" font-size="${12 * k}">${esc(label)}${hull}</text><circle class="hit" r="${Math.max(size * 1.4, 16 * k)}"/></g>`;
}

function plotSvg(sc) {
    const ps = playerShip(sc);
    const tracks = sc.tracks.ally;
    const shown = sc.ships.filter(s => s.state !== 'escaped' && !(s.mimic && !isActive(s)) && (s.side === 'ally' || (tracks[s.id] ?? 0) >= 1));
    const pts = [...shown, ...(sc.ghosts ?? [])];
    const xs = pts.map(s => s.x), ys = pts.map(s => s.y);
    let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 600) * 1.3 + 200;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const vb = [cx - span / 2, cy - span / 2, span, span];
    const k = span / 520; // one screen pixel in km, roughly
    const step = [100, 250, 500, 1000, 2500, 5000].find(g => span / g <= 8) ?? 5000;
    let grid = '';
    for (let x = Math.ceil(vb[0] / step) * step; x < vb[0] + span; x += step) grid += `<line x1="${x}" y1="${vb[1]}" x2="${x}" y2="${vb[1] + span}"/>`;
    for (let y = Math.ceil(vb[1] / step) * step; y < vb[1] + span; y += step) grid += `<line x1="${vb[0]}" y1="${y}" x2="${vb[0] + span}" y2="${y}"/>`;
    let rings = '';
    if (ps && isActive(ps)) {
        const guns = ps.weapons.filter(w => !w.out && ['kinetic', 'beam', 'plasma'].includes(SC_WEAPONS[w.id].kind) && !SC_WEAPONS[w.id].melee).map(w => SC_WEAPONS[w.id].range);
        if (can('weapons', sc) && guns.length) rings += `<circle class="rng gun" cx="${ps.x}" cy="${ps.y}" r="${Math.max(...guns)}"/>`;
        if (can('sensors', sc)) rings += `<circle class="rng sens" cx="${ps.x}" cy="${ps.y}" r="${sensorRange(ps)}"/>`;
        const r = span * 0.42;
        const h = ps.want.heading * Math.PI / 180;
        rings += `<line class="course" x1="${ps.x}" y1="${ps.y}" x2="${ps.x + Math.sin(h) * r}" y2="${ps.y - Math.cos(h) * r}"/>`;
        const q = pendingOrders(ps, ['heading'])[0];
        if (q) { const qh = q.value * Math.PI / 180; rings += `<line class="course queued" x1="${ps.x}" y1="${ps.y}" x2="${ps.x + Math.sin(qh) * r}" y2="${ps.y - Math.cos(qh) * r}"/>`; }
        const t = shipById(ps.target, sc);
        if (t && (tracks[t.id] ?? 0) >= 1) rings += `<line class="aim" x1="${ps.x}" y1="${ps.y}" x2="${t.x}" y2="${t.y}"/>`;
    }
    const reach = Math.max(...sc.ships.filter(s => s.side === 'ally' && isActive(s)).map(s => sensorRange(s)), 0);
    const missiles = sc.missiles.filter(m => m.side === 'ally' || sc.ships.some(s => s.side === 'ally' && isActive(s) && dist(s, m) <= reach))
        .map(m => `<circle class="msl ${m.side === 'ally' ? 'friend' : 'foe'}" cx="${m.x.toFixed(1)}" cy="${m.y.toFixed(1)}" r="${3 * k}"/>`).join('');
    const ships = shown.sort((a, b) => (a.id === sc.playerShip) - (b.id === sc.playerShip))
        .map(s => glyph(s, s.side === 'ally' ? 3 : tracks[s.id] ?? 0, s.id === sc.playerShip, ps?.target === s.id, k)).join('');
    const ghosts = (sc.ghosts ?? []).map(g => `<g class="sf-ship foe blip" transform="translate(${g.x.toFixed(1)} ${g.y.toFixed(1)})"><rect x="${-6 * k}" y="${-6 * k}" width="${12 * k}" height="${12 * k}" transform="rotate(45)"/><text y="${4 * k}" font-size="${10 * k}">?</text></g>`).join('');
    const mines = (sc.mines ?? []).filter(mn => mn.seen.ally).map(mn => `<rect class="mine ${mn.side === 'ally' ? 'friend' : 'foe'}" x="${(mn.x - 4 * k).toFixed(1)}" y="${(mn.y - 4 * k).toFixed(1)}" width="${8 * k}" height="${8 * k}" transform="rotate(45 ${mn.x.toFixed(1)} ${mn.y.toFixed(1)})"/>`).join('');
    const tethers = (sc.tethers ?? []).map(th => [shipById(th.a, sc), shipById(th.b, sc)]).filter(([a, b]) => a && b && (a.side === 'ally' || (tracks[a.id] ?? 0) >= 2))
        .map(([a, b]) => `<line class="tether" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`).join('');
    return `<svg class="sf-plot" viewBox="${vb.map(n => n.toFixed(0)).join(' ')}" data-sf="sc-plot" style="--k:${k.toFixed(2)}">
        <g class="grid">${grid}</g>${rings}${mines}${tethers}${missiles}${ghosts}${ships}</svg>
        <div class="sf-field-legend"><span>grid ${fmtInt(step)} km</span><span><i class="l-ally"></i>friendly</span><span><i class="l-foe"></i>hostile</span>${can('helm', sc) ? '<span>tap the plot to set a course</span>' : ''}</div>`;
}

// ---- Consoles ---------------------------------------------------------------------------

function timeHtml(st, sc) {
    const ps = playerShip(sc);
    const hail = sc.hail ? `<div class="sf-check-result fail"><b>INCOMING HAIL</b><small>${esc(sc.hail.name)} demands your surrender.</small></div>
        ${can('command', sc) ? `<div class="sf-actions">${btn('sc-surrender', 'Surrender the ship', { icon: 'fa-flag', cls: 'ghost' })}${btn('sc-refuse', 'Refuse', { icon: 'fa-hand', cls: 'primary' })}</div>` : '<small class="sf-dim">The answer is the captain\'s to give.</small>'}` : '';
    return `<div class="sf-turn-head"><b>${esc(POSTS[sc.role]?.name ?? 'Aboard')}</b> <small>${esc(ps.name)} · ${esc(clsOf(ps).role)}</small><span class="sf-grow"></span><small>T+${clock(sc.pulse)}</small></div>
        ${ps.state !== 'active' ? `<div class="sf-note">${ps.state === 'disabled' ? 'The ship is dead in space.' : esc(ps.state)}</div>` : ''}${hail}
        ${sc.boardingPending ? `<div class="sf-check-result fail"><b>BOARDERS</b><small>About ${sc.boardingPending.n} from ${esc(sc.boardingPending.from)} are aboard.</small></div>
            <div class="sf-actions">${btn('sc-repel', 'Go and meet them', { icon: 'fa-person-rifle', cls: 'primary', title: 'Fight them on foot, yourself' })}</div><small class="sf-dim">Or carry on at your post and leave it to the crew: it is settled in the next 30 seconds.</small>` : ''}
        ${st.combat ? '<div class="sf-note">There is fighting on the decks. Finish it on the Combat tab before the battle moves on.</div>' : ''}
        <div class="sf-actions">${btn('sc-run', 'Run 30 seconds', { icon: 'fa-forward-step', cls: 'primary wide', data: { n: 1 }, disabled: !!st.combat })}${btn('sc-run', '2 min', { icon: 'fa-forward', data: { n: 4 }, title: 'Runs four pulses, stopping early if something needs your attention' })}</div>`;
}

function helmHtml(st, sc) {
    const ps = playerShip(sc);
    const ok = live(sc);
    const d = orderSeconds(sc, ps, 'helm');
    const mine = can('helm', sc) && S().shipCombat.role !== 'captain' && S().shipCombat.role !== 'commander';
    const q = pendingOrders(ps, ['heading', 'throttle', 'evasive']);
    const qText = q.map(o => `${o.type === 'heading' ? `come to ${deg(o.value)}` : o.type === 'throttle' ? THROTTLES[o.value].name.toLowerCase() : o.value ? 'evasive' : 'steady'} in ${clock(o.at - sc.pulse)}`).join(', ');
    const t = shipById(ps.target, sc);
    return `<div class="sf-sub">Heading ${deg(ps.heading)}${Math.abs(angDiff(ps.want.heading, ps.heading)) > 1 ? ` → ${deg(ps.want.heading)}` : ''} · ${Math.round(ps.speed)} of ${Math.round(clsOf(ps).speed)} km per pulse</div>
        <small class="sf-dim">${clsOf(ps).size === 1 || mine ? 'You have the controls: the ship answers' : `Your helm officer is ${rating(ps.officers.helm)}: the ship answers`} ${secs(d)}. Turns ${Math.round(sizeOf(ps).turn)}° per pulse.</small>
        ${qText ? `<div class="sf-note">Orders in hand: ${esc(qText)}.</div>` : ''}
        <div class="sf-actions">
            ${btn('sc-turn', '45° port', { icon: 'fa-rotate-left', data: { d: -45 }, disabled: off(ok) })}${btn('sc-turn', '15°', { icon: 'fa-rotate-left', data: { d: -15 }, disabled: off(ok) })}
            ${btn('sc-turn', '15°', { icon: 'fa-rotate-right', data: { d: 15 }, disabled: off(ok) })}${btn('sc-turn', '45° starboard', { icon: 'fa-rotate-right', data: { d: 45 }, disabled: off(ok) })}
        </div>
        <div class="sf-actions">
            ${btn('sc-course', 'Close on target', { icon: 'fa-crosshairs', data: { m: 'close' }, disabled: off(ok && t) })}
            ${btn('sc-course', 'Show broadside', { icon: 'fa-arrows-left-right', data: { m: 'broad' }, disabled: off(ok && t) })}
            ${btn('sc-course', 'Open the range', { icon: 'fa-up-right-from-square', data: { m: 'open' }, disabled: off(ok && t) })}
        </div>
        <div class="sf-seg">${THROTTLES.map(th => `<button type="button" class="sf-btn${ps.want.throttle === th.id ? ' primary' : ''}${pendingOrders(ps, ['throttle'])[0]?.value === th.id ? ' queued' : ''}" data-sf="sc-throttle" data-v="${th.id}"${ok ? '' : ' disabled'}>${esc(th.name)}</button>`).join('')}</div>
        <div class="sf-actions">${btn('sc-evasive', ps.evasive ? 'Evasive: on' : 'Evasive manoeuvres', { icon: 'fa-shuffle', cls: ps.evasive ? 'primary' : '', disabled: off(ok), title: 'Harder to hit, and your own gunnery suffers' })}
            ${clsOf(ps).size > 1 || clsOf(ps).mech ? btn('sc-ram', ps.ramming ? `Ramming ${shipById(ps.ramming, sc)?.name ?? ''}: belay` : 'Ram the target', { icon: 'fa-angles-right', cls: ps.ramming ? 'primary' : 'ghost', disabled: off(ok && (t || ps.ramming)), title: clsOf(ps).ram ? 'Reinforced prow: built for this. Steer onto her at speed.' : 'No reinforced prow: your own ship will suffer about as much as theirs. You must steer onto her at speed.' }) : ''}</div>
        ${ps.ramming ? '<small class="sf-warn-line">Collision course ordered. She strikes if you close within about 60 km, bow on.</small>' : ''}`;
}

function weaponsHtml(st, sc) {
    const ps = playerShip(sc);
    const ok = live(sc);
    const tracks = sc.tracks.ally;
    const foes = sc.ships.filter(s => s.side === 'enemy' && isActive(s) && (tracks[s.id] ?? 0) >= 1 && !(s.mimic && !masked(sc, 'ally', s)));
    const t = shipById(ps.target, sc);
    const qT = pendingOrders(ps, ['target'])[0];
    const groups = new Map();
    for (const w of ps.weapons) { const key = `${w.id}:${w.arc}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(w); }
    const rows = [...groups.values()].map(list => {
        const def = SC_WEAPONS[list[0].id];
        const up = list.filter(w => !w.out);
        const w = up[0] ?? list[0];
        const auto = { pd: 'automatic', sweeper: 'automatic: finds and clears mines nearby', sand: 'countermeasure: thrown from the sensor console', decoy: 'countermeasure: launched from the sensor console', mine: 'laid astern on your order' }[def.kind];
        const blocked = up.length ? (auto ? '' : weaponBlock(sc, ps, w, t && isActive(t) ? t : null)) : 'destroyed';
        const unit = { missile: 'missiles', drone: 'drones', decoy: 'drones', mine: 'mines', grapple: 'harpoons', sand: 'canisters' }[def.kind] ?? 'salvos';
        const ammo = list[0].ammo !== null ? ` · ${up.reduce((n, x) => n + x.ammo, 0)} ${unit}` : '';
        const status = auto ?? (blocked || (def.kind === 'missile' ? 'ready' : def.kind === 'drone' ? 'ready to launch' : def.kind === 'grapple' ? `${hitChance(sc, ps, w, t)}% to take hold` : `${hitChance(sc, ps, w, t)}% to hit`));
        const loads = loadsFor(def);
        const qLoad = pendingOrders(ps, ['load']).find(o => o.value.id === list[0].id && o.value.arc === list[0].arc)?.value.load;
        const loadSeg = loads.length > 1 ? `<div class="sf-seg sf-loads">${loads.map(l => `<button type="button" class="sf-btn${w.load === l.id ? ' primary' : ''}${qLoad === l.id ? ' queued' : ''}" data-sf="sc-load" data-key="${list[0].id}:${list[0].arc}" data-v="${l.id}" title="${esc(l.full)}"${ok && up.length ? '' : ' disabled'}>${esc(l.name)}</button>`).join('')}</div>` : '';
        const toggle = def.kind === 'mine' ? btn('sc-mine', 'Lay', { icon: 'fa-circle-dot', data: {}, disabled: off(ok && up.some(x => x.ammo > 0)) })
            : def.nuclear ? btn('sc-nuke', w.on ? 'ARMED' : 'Safe', { icon: 'fa-radiation', cls: w.on ? 'primary' : 'ghost', data: { key: `${list[0].id}:${list[0].arc}` }, disabled: off(ok && up.length && can('command', sc)), title: 'Nuclear release needs the commanding officer' })
                : ['sweeper', 'sand', 'decoy'].includes(def.kind) ? '' : null;
        return `<li class="sf-row sf-wpn${blocked ? ' blocked' : ''}${w.on ? '' : ' off'}"><span class="sf-grow"><b>${esc(def.name)}</b>${list.length > 1 ? ` ×${up.length}${up.length < list.length ? `/${list.length}` : ''}` : ''}
            <small class="sf-dim">${def.range ? `${ARC_NAMES[list[0].arc]} · ${fmtInt(def.range)} km` : ''}${def.range ? ammo : ammo.replace(' · ', '')}</small><br><small class="${blocked ? 'sf-warn-line' : 'sf-ok-line'}">${esc(status)}</small>${loadSeg}</span>
            ${toggle ?? btn('sc-weapon', w.on ? 'Free' : 'Held', { cls: w.on ? 'primary' : 'ghost', data: { key: `${list[0].id}:${list[0].arc}` }, disabled: off(ok && up.length) })}</li>`;
    }).join('');
    const d = orderSeconds(sc, ps, 'weapons');
    return `${clsOf(ps).size > 1 ? `<small class="sf-dim">${sc.role === 'gunnery' ? 'You work the solutions yourself: fire orders take effect' : `Your gunnery officer is ${rating(ps.officers.weapons)}: fire orders take effect`} ${secs(d)}.</small>` : ''}
        <label class="sf-field"><span>Target</span><select class="sf-input" data-sf-change="sc-target-sel"${ok ? '' : ' disabled'}>
            <option value="">No target</option>${foes.map(f => `<option value="${f.id}"${f.id === (qT?.value ?? ps.target) ? ' selected' : ''}>${esc((tracks[f.id] ?? 0) >= 3 ? f.name : (tracks[f.id] ?? 0) >= 2 ? (sc.misid?.[f.id] ?? shownAs(sc, 'ally', f).role) : 'Unknown contact')} · ${fmtInt(dist(ps, f))} km · ${esc(TRACK_NAMES[tracks[f.id] ?? 0].toLowerCase())}</option>`).join('')}</select></label>
        ${qT ? `<div class="sf-note">Target change in ${clock(qT.at - sc.pulse)}.</div>` : ''}
        <label class="sf-field"><span>Aim for</span><select class="sf-input" data-sf-change="sc-called"${ok ? '' : ' disabled'}>
            ${[['', 'Centre of mass'], ['drives', 'Drives'], ['weapons', 'Weapon mounts'], ['reactor', 'Reactor'], ['sensors', 'Sensor array'], ['bridge', 'Bridge'], ['shields', 'Shield emitters']].map(([v, n]) => `<option value="${v}"${ps.called === v ? ' selected' : ''}>${n}${v ? ' (harder)' : ''}</option>`).join('')}</select></label>
        <ul class="sf-list">${rows}</ul>
        ${ps.weapons.some(w => SC_WEAPONS[w.id].kind === 'missile') ? `<div class="sf-actions">${btn('sc-missiles', ps.missiles ? 'Missiles: weapons free' : 'Missiles: held', { icon: 'fa-rocket', cls: ps.missiles ? 'primary' : '', disabled: off(ok) })}</div>` : ''}`;
}

function engineeringHtml(st, sc) {
    const ps = playerShip(sc);
    const cls = clsOf(ps);
    const ok = live(sc) || ps.state === 'disabled';
    const teams = dcTeams(ps);
    const rooms = Object.entries(ps.rooms).map(([id, r]) => {
        const on = ps.dc.includes(id);
        return `<div class="sf-room${r.fire ? ' fire' : ''}${r.hp <= 0 ? ' dead' : ''}${on ? ' dc' : ''}" ${teams ? `data-sf="sc-dc" data-id="${id}"` : ''}>
            <span>${esc(ROOMS[id].name)}${r.fire ? ' <i class="fa-solid fa-fire"></i>' : ''}${on ? ' <i class="fa-solid fa-wrench"></i>' : ''}</span>
            <div class="sf-gauge ${r.hp <= 0 ? 'crit' : r.hp < r.max * 0.5 ? 'warn' : 'ok'}"><span style="width:${Math.round(100 * r.hp / r.max)}%"></span></div></div>`;
    }).join('');
    const out = ps.weapons.filter(w => w.out).length;
    return `${gauge('Hull', Math.max(0, ps.hull), ps.maxHull)}${gauge('Shields', ps.shield, ps.maxShield || 1, { text: ps.shieldDown > 0 ? `down ${clock(ps.shieldDown)}` : undefined, cls: 'info' })}
        ${gauge('Heat', ps.heat, cls.heat, { invert: true, text: ps.heatLock ? 'LOCKED' : undefined })}
        <small class="sf-dim">Armor bow ${ps.armor[0].toFixed(1)} · flank ${ps.armor[1].toFixed(1)} · stern ${ps.armor[2].toFixed(1)}</small>
        <div class="sf-seg">${Object.entries(POWER_PRESETS).map(([id, p]) => `<button type="button" class="sf-btn${ps.power === id ? ' primary' : ''}" data-sf="sc-power" data-v="${id}"${ok ? '' : ' disabled'}>${esc(p.name)}</button>`).join('')}</div>
        <div class="sf-actions">
            ${btn('sc-overload', ps.overload ? 'Overload armed' : 'Overload reactor', { icon: 'fa-bolt', cls: ps.overload ? 'primary' : '', disabled: off(live(sc)), title: 'One pulse of extra power to everything. A lot of heat, and it can start a reactor fire.' })}
            ${cls.warp ? btn('sc-warp', ps.warp !== null ? `Abort jump (${clock(ps.warp)})` : 'Emergency jump', { icon: 'fa-explosion', cls: ps.warp !== null ? 'primary' : '', disabled: off(live(sc) && can('command', sc)), title: `Spools for ${clock(warpSpool(ps))}. A blind jump can leave you stranded.` }) : ''}
        </div>
        ${tetherOn(ps, sc) ? `<div class="sf-check-result fail"><b>GRAPPLED</b><small>${esc(shipById(tetherOn(ps, sc).a, sc)?.name ?? 'An enemy')} has a line in the hull. No jump, and the ship can barely manoeuvre.</small></div>
            <div class="sf-actions">${btn('sc-cut', ps.cutting ? 'Cutting party at work' : 'Cut the line', { icon: 'fa-scissors', cls: 'primary', disabled: off(ok && !ps.cutting) })}</div>` : ''}
        <div class="sf-sub">Compartments${teams ? ` · ${ps.dc.length}/${teams} repair teams assigned` : ' · no repair teams aboard'}</div>
        <div class="sf-rooms">${rooms}${out ? `<div class="sf-room${ps.dc.includes('weapons') ? ' dc' : ''}" data-sf="sc-dc" data-id="weapons"><span>${out} weapon${out > 1 ? 's' : ''} out${ps.dc.includes('weapons') ? ' <i class="fa-solid fa-wrench"></i>' : ''}</span></div>` : ''}</div>
        ${teams ? `<div class="sf-actions">${btn('sc-dc-auto', ps.dcManual ? 'Let the chief decide' : 'Chief engineer decides', { icon: 'fa-user-gear', cls: ps.dcManual ? '' : 'primary' })}</div>` : ''}
        ${ps.casualties ? `<small class="sf-warn-line">About ${ps.casualties} casualties.</small>` : ''}`;
}

function sensorsHtml(st, sc) {
    const ps = playerShip(sc);
    const ok = live(sc);
    const tracks = sc.tracks.ally;
    const sig = signature(ps) / sizeOf(ps).sig;
    const loud = sig < 0.6 ? 'running dark' : sig < 1.2 ? 'quiet' : sig < 1.9 ? 'visible' : 'lit up like a beacon';
    const seen = sc.tracks.enemy[ps.id] ?? 0;
    const rows = sc.ships.filter(s => s.side === 'enemy' && s.state !== 'escaped' && !(s.mimic && !isActive(s)) && (tracks[s.id] ?? 0) >= 1).map(s => {
        const l = tracks[s.id];
        const fake = masked(sc, 'ally', s);
        const src = fake ? (shipById(s.mimic, sc) ?? s) : s; // an unexposed decoy reads exactly like its parent
        const as = shownAs(sc, 'ally', s);
        return `<li class="sf-row" data-sf="sc-target" data-id="${s.id}"><span class="sf-grow"><b>${esc(l >= 2 ? (l >= 3 ? (s.mimic && !fake ? `Decoy drone (${s.name})` : s.name) : (sc.misid?.[s.id] ?? as.role)) : 'Unknown contact')}</b>
            <small class="sf-dim">bearing ${deg(bearing(ps, s))} · ${fmtInt(dist(ps, s))} km${l >= 3 ? ` · ${esc(SIZES[as.size].name.toLowerCase())}` : ''}${l >= 3 ? ` · hull ${Math.max(0, Math.round(100 * src.hull / src.maxHull))}%${src.shield > 0 ? ', shields up' : ', shields down'}${s.sandUp > 0 ? ', behind a sand screen' : ''}${s.state !== 'active' ? `, ${s.state}` : ''}` : ''}</small></span>
            <span class="sf-tag t${l}">${esc(TRACK_NAMES[l])}</span></li>`;
    }).join('');
    const inbound = sc.missiles.filter(m => m.side === 'enemy' && m.target === ps.id).length;
    const ghostRows = (sc.ghosts ?? []).map(g => `<li class="sf-row"><span class="sf-grow"><b>Unknown contact</b> <small class="sf-dim">bearing ${deg(bearing(ps, g))} · ${fmtInt(dist(ps, g))} km</small></span><span class="sf-tag t1">${esc(TRACK_NAMES[1])}</span></li>`).join('');
    const grade = sensorGrade(clsOf(ps));
    const count = (id) => ps.weapons.filter(w => w.id === id && !w.out).reduce((n, w) => n + w.ammo, 0);
    const sand = ps.weapons.some(w => w.id === 'sandcaster'), sandN = count('sandcaster');
    const drones = ps.weapons.some(w => w.id === 'decoydrone'), droneN = count('decoydrone');
    return `<small class="sf-dim">${esc(GRADE_NAMES[grade][0].toUpperCase() + GRADE_NAMES[grade].slice(1))} sensor suite${grade <= 2 ? ': expect false contacts and wrong identifications' : ''}. Your ship is ${loud}. ${seen >= 3 ? 'The enemy has a firing solution on you.' : seen === 2 ? 'The enemy has you classified.' : seen === 1 ? 'The enemy has a faint contact on you.' : 'The enemy does not appear to see you.'}</small>
        ${inbound ? `<div class="sf-check-result fail"><b>VAMPIRE</b><small>${inbound} missile${inbound > 1 ? 's' : ''} inbound</small></div>` : ''}
        <div class="sf-actions">
            ${btn('sc-radar', ps.radar ? 'Radar: active' : 'Radar: silent', { icon: 'fa-satellite-dish', cls: ps.radar ? 'primary' : '', disabled: off(ok), title: 'Active radar sees far and is seen from farther' })}
            ${clsOf(ps).jammer ? btn('sc-jam', ps.jam ? 'Jammer: on' : 'Jammer: off', { icon: 'fa-tower-broadcast', cls: ps.jam ? 'primary' : '', disabled: off(ok), title: 'Degrades enemy tracks on ships near you. They will know something is out here.' }) : ''}
            ${btn('sc-decoy', ps.decoyUp > 0 ? 'Decoys out' : `Decoys (${ps.decoys})`, { icon: 'fa-burst', disabled: off(ok && ps.decoys > 0 && ps.decoyUp <= 0), title: 'Seduces incoming missiles for the next minute' })}
            ${sand ? btn('sc-sand', ps.sandUp > 0 ? 'Sand screen up' : `Sand screen (${sandN})`, { icon: 'fa-cloud', disabled: off(ok && sandN > 0 && !(ps.sandUp > 0)), title: 'Beams lose most of their bite against you for a minute. Your own beams suffer too.' }) : ''}
            ${drones ? btn('sc-decoydrone', `Decoy drone (${droneN})`, { icon: 'fa-clone', disabled: off(ok && droneN > 0), title: 'A drone that answers to sensors as your ship does. Good sensors see through it up close.' }) : ''}
        </div>
        ${ps.blind > 0 ? '<div class="sf-check-result fail"><b>SENSORS WHITED OUT</b><small>The pulse of a nuclear detonation. Recovering.</small></div>' : ''}
        <ul class="sf-list">${rows + ghostRows || '<li class="sf-dim">No contacts.</li>'}</ul>`;
}

function commandHtml(st, sc) {
    const ps = playerShip(sc);
    const ok = live(sc);
    const allies = sc.ships.filter(s => s.side === 'ally' && !s.isPlayer && s.state !== 'escaped' && !s.mimic);
    const foes = sc.ships.filter(s => s.side === 'enemy' && isActive(s) && (sc.tracks.ally[s.id] ?? 0) >= 2);
    const fleet = can('fleet', sc) && allies.length ? `<div class="sf-sub">Strike force</div><ul class="sf-list">${allies.map(a => {
        const cur = pendingOrders(a, ['fleet'])[0]?.value ?? a.fleet;
        const val = cur ? (cur.type === 'engage' ? `engage:${cur.target}` : cur.type) : 'free';
        return `<li class="sf-row"><span class="sf-grow"><b>${esc(a.name)}</b> <small class="sf-dim">${esc(clsOf(a).role)} · ${a.state === 'active' ? `hull ${Math.max(0, Math.round(100 * a.hull / a.maxHull))}%` : esc(a.state)}</small></span>
            <select class="sf-input sf-narrow" data-sf-change="sc-fleet" data-id="${a.id}"${isActive(a) ? '' : ' disabled'}>
                ${[['free', 'Fight at will'], ['screen', 'Screen the flagship'], ['hold', 'Hold fire and position'], ['withdraw', 'Withdraw'], ...foes.map(f => [`engage:${f.id}`, `Engage ${f.name}`])].map(([v, n]) => `<option value="${v}"${v === val ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></li>`;
    }).join('')}</ul><small class="sf-dim">Signals take about ${clock(1)} to be acted on.</small>` : (allies.length ? `<small class="sf-dim">Friendly ships fight under their own captains: ${esc(allies.map(a => a.name).join(', '))}.</small>` : '');
    const crew = clsOf(ps).size > 1 ? `<small class="sf-dim">Your officers: helm ${rating(ps.officers.helm)}, gunnery ${rating(ps.officers.weapons)}, sensors ${rating(ps.officers.sensors)}, engineering ${rating(ps.officers.engineering)}.</small>` : '';
    return `${crew}${fleet}
        <div class="sf-actions">
            ${btn('sc-demand', 'Demand their surrender', { icon: 'fa-bullhorn', disabled: off(ok) })}
            ${btn('sc-disengage', sc.disengage ? 'Breaking contact…' : 'Break contact', { icon: 'fa-person-running', cls: sc.disengage ? 'primary' : '', disabled: off(ok), title: 'You are clear once no enemy holds a track on you' })}
        </div>
        <div class="sf-actions">
            ${btn('sc-surrender', 'Surrender', { icon: 'fa-flag', cls: 'ghost', disabled: off(ps.state === 'active' || ps.state === 'disabled') })}
            ${btn('sc-abandon', clsOf(ps).size === 1 ? 'Eject' : 'Abandon ship', { icon: 'fa-life-ring', cls: 'ghost', disabled: off(!!clsOf(ps).pods) })}
        </div>`;
}

function stationHtml(st, sc) {
    const ps = playerShip(sc);
    const felt = sc.log.filter(l => l.felt).slice(-14).reverse();
    const away = (POSTS[sc.role]?.can.length ?? 0) > 0;
    return `<div class="sf-note">${away ? 'You are away from your station. Your consoles are there, not here. Go back on the deck plan to take them up again.' : 'You have no station that shows you the battle.'} You know only what you can hear, feel and are told aboard ${esc(ps.name)}.</div>
        <div class="sf-actions">
            ${btn('sc-act', sc.playerAct === 'brace' ? 'Braced' : 'Brace', { icon: 'fa-hands-holding', cls: sc.playerAct === 'brace' ? 'primary' : '', data: { a: 'brace' }, title: 'Less likely to be hurt if your compartment is hit' })}
            ${sc.role === 'crew' ? btn('sc-act', sc.playerAct === 'dc' ? 'With the repair party' : 'Help damage control', { icon: 'fa-fire-extinguisher', cls: sc.playerAct === 'dc' ? 'primary' : '', data: { a: 'dc' }, title: 'An engineering check. Dangerous work.' }) : ''}
        </div>
        <ul class="sf-cblog">${felt.map(l => `<li class="${l.kind}">${esc(l.text)}</li>`).join('') || '<li class="sys">The deck hums. Nothing yet.</li>'}</ul>`;
}

function aarHtml(st) {
    const r = st.lastShipCombat;
    const good = ['victory', 'enemy-withdrew', 'escaped'].includes(r.result);
    const prizes = r.prizes.filter(p => !p.done).map(p => `<li class="sf-row"><span class="sf-grow"><b>${esc(p.name)}</b> <small class="sf-dim">${esc(VESSELS[p.cls].role)} · ${esc(p.state)}</small></span>
        ${btn('sc-board', p.state === 'surrendered' ? 'Send a prize crew' : 'Board her', { icon: 'fa-person-rifle', cls: 'primary', data: { id: p.id } })}${btn('sc-salvage', 'Salvage', { icon: 'fa-screwdriver-wrench', data: { id: p.id } })}</li>`).join('');
    return `<div class="sf-check-result ${good ? 'ok' : 'fail'}"><b>${esc(r.result.replace('-', ' ').toUpperCase())}</b><small>${esc(r.scene)} · ${clock(r.pulses)}</small></div>
        <ul class="sf-cblog">${r.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
        ${prizes && r.authority ? `<div class="sf-sub">Beaten ships</div><ul class="sf-list">${prizes}</ul>` : ''}
        ${st.pendingEvent?.startsWith('SPACE BATTLE RESULT') ? `<small class="sf-dim">The AI will narrate this battle on its next reply.</small><div class="sf-actions">${btn('cb-narrate', 'Narrate now', { icon: 'fa-feather', cls: 'primary' })}</div>` : ''}
        <div class="sf-actions">${btn('sc-dismiss', 'Dismiss', { icon: 'fa-xmark', cls: 'ghost' })}</div>`;
}

function postingHtml(st) {
    const p = playerPost(st);
    if (!p) return '<div class="sf-dim">You hold no post aboard any vessel.</div>';
    const cls = VESSELS[p.classId];
    const post = POSTS[p.role];
    const lvl = post.clearance;
    const arms = Object.entries(cls.mounts.reduce((m, x) => { m[x.id] = (m[x.id] ?? 0) + 1; return m; }, {})).map(([id, n]) => `${SC_WEAPONS[id].name}${n > 1 ? ` ×${n}` : ''}`).join(', ');
    return `<div class="sf-loc-main"><i class="fa-solid fa-id-badge"></i> ${esc(post.name)}</div><div class="sf-loc-sub">${esc(p.shipName)} · ${esc(cls.name)}</div>
        ${lvl >= 2 ? `<small class="sf-dim">${esc(SIZES[cls.size].name)}, about ${fmtInt(SIZES[cls.size].length)} m, crew ${fmtInt(cls.crew)}. Armament: ${esc(arms || 'none')}.</small>
        ${cls.mech ? `<small class="sf-warn-line">Combat frame: worth about ${fmtInt(cls.price)} cr, needs Mech Piloting ${cls.minSkill} to handle properly, and can only be repaired in a dedicated mech bay.</small>` : ''}
        <small class="sf-dim">In battle you control: ${post.can.length ? esc(post.can.join(', ')) : 'nothing'}.</small>` : '<small class="sf-dim">You have no access to the ship\'s systems.</small>'}`;
}

// ---- The ship registry: every hull class in known space -----------------------------------

const reg = { family: '', faction: '', size: '', open: null };

function registryHtml(st) {
    const all = Object.values(VESSELS).filter(v => !v.decoy);
    const list = all.filter(v => (!reg.family || (reg.family === 'civil' ? v.civil : v.family === reg.family && !v.civil)) && (!reg.faction || (reg.faction === 'none' ? !v.faction : v.faction === reg.faction)) && (!reg.size || v.size === Number(reg.size)))
        .sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
    const sel = (key, opts) => `<select class="sf-input" data-sf-change="reg-filter" data-k="${key}">${opts.map(([v, n]) => `<option value="${v}"${String(reg[key]) === String(v) ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
    const rows = list.map(v => {
        const open = reg.open === v.id;
        const access = hullAccess(v, { standing: v.faction ? (st.reputation?.[v.faction] ?? 0) : Math.max(0, ...Object.values(st.reputation ?? {})) });
        const arms = Object.entries(v.mounts.reduce((mm, x) => { mm[x.id] = (mm[x.id] ?? 0) + 1; return mm; }, {})).map(([id, n]) => `${SC_WEAPONS[id].name}${n > 1 ? ` ×${n}` : ''}`).join(', ');
        const detail = open ? `<div class="sf-reg-detail">
            <small class="sf-dim">${esc(v.desc)}</small>
            ${v.faction ? `<small class="sf-dim"><b>${esc(STYLES[v.faction].name)} build.</b> ${esc(STYLES[v.faction].look)}</small>` : ''}
            <div class="sf-kv"><span>Size</span><b>${esc(SIZES[v.size].name)}, about ${fmtInt(SIZES[v.size].length)} m</b></div>
            <div class="sf-kv"><span>Crew</span><b>${fmtInt(v.crew)}</b></div>
            <div class="sf-kv"><span>Hull / shields</span><b>${fmtInt(v.hull)} / ${fmtInt(v.shield)}</b></div>
            <div class="sf-kv"><span>Armor bow / flank / stern</span><b>${v.armor.join(' / ')}</b></div>
            <div class="sf-kv"><span>Speed</span><b>${fmtInt(v.speed)} km per pulse</b></div>
            <div class="sf-kv"><span>Sensors</span><b>${fmtInt(v.sensors)} km, ${esc(GRADE_NAMES[sensorGrade(v)])}</b></div>
            <div class="sf-kv"><span>Armament</span><b>${esc(arms || 'none')}</b></div>
            ${v.wing?.length ? `<div class="sf-kv"><span>Air wing</span><b>${esc(v.wing.map(w => VESSELS[w].name).join(', '))}</b></div>` : ''}
            ${v.mech ? `<div class="sf-kv"><span>Pilot</span><b>Mech Piloting ${v.minSkill} or better</b></div>` : ''}
            <div class="sf-kv"><span>Price</span><b>${v.price ? `${fmtInt(v.price)} cr` : 'not for sale'}</b></div>
            <small class="${access.ok ? 'sf-ok-line' : 'sf-warn-line'}">${esc(access.legal.name)}. ${esc(access.why)}</small>
        </div>` : '';
        return `<li class="sf-reg${open ? ' open' : ''}"><div class="sf-row" data-sf="reg-open" data-id="${v.id}"><span class="sf-grow"><b>${esc(v.name)}</b> <small class="sf-dim">${esc(v.role)}</small></span>
            <span class="sf-tag l-${v.legal}">${esc(LEGAL[v.legal].name)}</span></div>${detail}</li>`;
    }).join('');
    return `<div class="sf-check-form">
            ${sel('family', [['', 'All families'], ...Object.entries(FAMILIES), ['civil', 'Civilian-pattern warships']])}
            ${sel('faction', [['', 'All builders'], ...Object.entries(STYLES).map(([id, f]) => [id, f.name]), ['none', 'Independent yards']])}
            ${sel('size', [['', 'All sizes'], ...Object.values(SIZES).map(z => [z.id, z.name])])}
        </div>
        <small class="sf-dim">${list.length} of ${all.length} hull classes. Tap one for details.</small>
        <ul class="sf-list sf-reg-list">${rows || '<li class="sf-dim">Nothing matches.</li>'}</ul>`;
}

// ---- Wiring -----------------------------------------------------------------------------

function act(fn) {
    try { fn(); blip('click'); } catch (e) { toast('warning', e.message); blip('error'); }
    commit('shipcombat');
}

function afterPulse() {
    const st = S();
    if (st && !st.shipCombat && st.lastShipCombat) {
        const r = st.lastShipCombat.result;
        toast(['victory', 'enemy-withdrew', 'escaped'].includes(r) ? 'success' : 'warning', `Battle over: ${r.replace('-', ' ')}. Send a message and the AI will narrate it.`);
    }
}

export function initShipCombatUi() {
    const sc = (st) => st.shipCombat;
    registerWidget({ id: 'sctime', when: (st) => !!sc(st), title: (st) => sc(st).scene, render: (st) => timeHtml(st, sc(st)) });
    registerWidget({ id: 'scplot', when: hasConsole, title: () => 'Tactical plot', flush: true, render: (st) => plotSvg(sc(st)) });
    registerWidget({ id: 'schelm', when: (st) => can('helm', sc(st)), title: () => 'Helm', render: (st) => helmHtml(st, sc(st)) });
    registerWidget({ id: 'scweapons', when: (st) => can('weapons', sc(st)), title: () => 'Weapons', render: (st) => weaponsHtml(st, sc(st)) });
    registerWidget({ id: 'scsensors', when: (st) => can('sensors', sc(st)), title: () => 'Sensors and electronic warfare', render: (st) => sensorsHtml(st, sc(st)) });
    registerWidget({ id: 'sceng', when: (st) => can('engineering', sc(st)), title: () => 'Engineering and damage control', render: (st) => engineeringHtml(st, sc(st)) });
    registerWidget({ id: 'sccommand', when: (st) => can('command', sc(st)), title: () => 'Command', render: (st) => commandHtml(st, sc(st)) });
    registerWidget({ id: 'scstation', when: (st) => !!sc(st) && !hasConsole(st), title: () => 'Battle stations', render: (st) => stationHtml(st, sc(st)) });
    registerWidget({
        id: 'sclog', when: hasConsole, title: () => 'Battle log',
        render: (st) => `<ul class="sf-cblog">${sc(st).log.slice(-50).reverse().map(l => `<li class="${l.kind}"><small>${clock(l.p)}</small> ${esc(l.text)}</li>`).join('')}</ul>
            <div class="sf-actions">${btn('sc-abort', 'Abort battle', { icon: 'fa-ban', cls: 'ghost', title: 'End the battle without a result' })}</div>`,
    });
    registerWidget({ id: 'scaar', when: (st) => !st.shipCombat && !!st.lastShipCombat, title: () => 'After-action report', render: aarHtml });
    registerWidget({ id: 'posting', when: (st) => !!playerPost(st) && !(st.ship && !st.post), title: () => 'Posting', render: postingHtml });
    registerWidget({
        id: 'scstart', when: (st) => !st.shipCombat && !st.combat && clearance(st) >= 0 && gmOn(), title: () => 'Stage a space battle',
        render: () => `<small class="sf-dim">The AI starts battles with a tag. Use this to stage one yourself.</small>
            <div class="sf-check-form"><select class="sf-input" data-scs="cls">${Object.values(VESSELS).filter(v => !v.decoy).map(v => `<option value="${v.id}"${v.id === 'raider' ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
            <select class="sf-input" data-scs="n">${[1, 2, 3, 4, 6].map(n => `<option>${n}</option>`).join('')}</select></div>
            <div class="sf-actions">${btn('sc-start', 'Start battle', { icon: 'fa-rocket', cls: 'primary' })}</div>`,
    });
    registerWidget({ id: 'registry', title: () => 'Ship registry', render: registryHtml });
    registerTab({ id: 'tactical', label: 'Tactical', icon: 'fa-satellite', order: 4, when: (st) => !!st.shipCombat || !!st.lastShipCombat, widgets: ['sctime', 'scplot', 'scstation', 'schelm', 'scweapons', 'scsensors', 'sceng', 'sccommand', 'sclog', 'scaar'] });

    const me = () => playerShip(SC());
    const told = (delay, what) => { if (delay > 0) toast('info', `${what}: carried out in about ${clock(delay)}.`); };
    registerActions({
        'sc-run'(el) {
            const n = Number(el.dataset.n) || 1;
            act(() => {
                for (let i = 0; i < n; i++) {
                    const before = SC();
                    const hadHail = !!before?.hail;
                    const end = runPulse();
                    if (end || !SC() || (!hadHail && SC().hail)) break;
                }
            });
            afterPulse();
        },
        'sc-plot'(el, ev) {
            const sc = SC();
            if (!can('helm', sc) || !live(sc)) return;
            const svg = el.closest('svg') ?? el;
            const pt = svg.createSVGPoint();
            pt.x = ev.clientX; pt.y = ev.clientY;
            const p = pt.matrixTransform(svg.getScreenCTM().inverse());
            const ps = me();
            if (Math.hypot(p.x - ps.x, p.y - ps.y) < 5) return;
            act(() => told(order(ps, 'heading', Math.round(bearing(ps, p))), 'Course change'));
        },
        'sc-target'(el) {
            const sc = SC();
            if (!can('weapons', sc) || !live(sc)) return;
            act(() => told(order(me(), 'target', el.dataset.id), 'Target change'));
        },
        'sc-target-sel'(el) { act(() => told(order(me(), 'target', el.value || null), 'Target change')); },
        'sc-called'(el) { act(() => order(me(), 'called', el.value)); },
        'sc-turn'(el) { const ps = me(); const base = pendingOrders(ps, ['heading'])[0]?.value ?? ps.want.heading; act(() => told(order(ps, 'heading', base + Number(el.dataset.d)), 'Course change')); },
        'sc-course'(el) {
            const ps = me();
            const t = shipById(ps.target, SC());
            if (!t) return;
            const b = bearing(ps, t);
            const h = el.dataset.m === 'close' ? b : el.dataset.m === 'open' ? b + 180 : b + (angDiff(ps.heading, b) >= 0 ? 90 : -90);
            act(() => told(order(ps, 'heading', Math.round(h)), 'Course change'));
        },
        'sc-throttle'(el) { act(() => told(order(me(), 'throttle', Number(el.dataset.v)), 'Engine order')); },
        'sc-evasive'() { const ps = me(); act(() => told(order(ps, 'evasive', !(pendingOrders(ps, ['evasive'])[0]?.value ?? ps.evasive)), 'Helm order')); },
        'sc-weapon'(el) {
            const ps = me();
            const [id, arc] = el.dataset.key.split(':');
            const list = ps.weapons.filter(w => w.id === id && w.arc === arc);
            const on = !list[0].on;
            act(() => { let d = 0; for (const w of list) d = order(ps, 'weapon', { n: w.n, on }); told(d, 'Fire order'); });
        },
        'reg-filter'(el) { reg[el.dataset.k] = el.value; reg.open = null; redraw(); },
        'reg-open'(el) { reg.open = reg.open === el.dataset.id ? null : el.dataset.id; redraw(); },
        'sc-load'(el) { const ps = me(); const [id, arc] = el.dataset.key.split(':'); act(() => told(order(ps, 'load', { id, arc, load: el.dataset.v }), `Reload with ${LOADS[el.dataset.v].full.toLowerCase()}`)); },
        'sc-mine'() { act(() => told(order(me(), 'mine', true), 'Mine')); },
        'sc-ram'() { const ps = me(); act(() => told(order(ps, 'ram', ps.ramming ? null : ps.target), ps.ramming ? 'Belay ramming' : 'Ramming order')); },
        'sc-sand'() { act(() => told(order(me(), 'sand', true), 'Sand screen')); },
        'sc-decoydrone'() { act(() => told(order(me(), 'decoydrone', true), 'Decoy drone')); },
        'sc-cut'() { act(() => told(order(me(), 'cut', true), 'Cutting party')); },
        async 'sc-nuke'(el) {
            const ps = me();
            const [id, arc] = el.dataset.key.split(':');
            const list = ps.weapons.filter(w => w.id === id && w.arc === arc);
            const on = !list[0].on;
            if (on && !(await confirmAsk('Release nuclear weapons?', 'The torpedo fires at your current target as soon as it bears. Everything near the blast suffers, friend or foe, and nobody forgets who used one.'))) return;
            act(() => { let d = 0; for (const w of list) d = order(ps, 'weapon', { n: w.n, on }); told(d, on ? 'Nuclear release' : 'Weapon safed'); });
        },
        'sc-missiles'() { const ps = me(); act(() => told(order(ps, 'missiles', !ps.missiles), 'Fire order')); },
        'sc-power'(el) { act(() => told(order(me(), 'power', el.dataset.v), 'Power change')); },
        'sc-overload'() { const ps = me(); act(() => told(order(ps, 'overload', !ps.overload), 'Overload')); },
        'sc-warp'() { const ps = me(); act(() => told(order(ps, 'warp', ps.warp === null), 'Jump order')); },
        'sc-repel'() { act(() => joinBoardingDefence()); },
        'sc-dc'(el) {
            const ps = me();
            if (!can('engineering', SC())) return;
            act(() => {
                const id = el.dataset.id;
                ps.dcManual = true;
                const list = ps.dc.includes(id) ? ps.dc.filter(x => x !== id) : [...ps.dc, id];
                if (list.length > dcTeams(ps)) list.shift();
                told(order(ps, 'dc', list), 'Repair teams');
            });
        },
        'sc-dc-auto'() { const ps = me(); act(() => { ps.dcManual = !ps.dcManual; if (!ps.dcManual) autoDc(ps); }); },
        'sc-radar'() { const ps = me(); act(() => told(order(ps, 'radar', !ps.radar), 'Sensor order')); },
        'sc-jam'() { const ps = me(); act(() => told(order(ps, 'jam', !ps.jam), 'Sensor order')); },
        'sc-decoy'() { act(() => told(order(me(), 'decoy', true), 'Decoys')); },
        'sc-demand'() { act(() => demandSurrender()); afterPulse(); },
        'sc-disengage'() { act(() => { const sc = SC(); sc.disengage = !sc.disengage; }); },
        'sc-refuse'() { act(() => { const sc = SC(); sc.log.push({ p: sc.pulse, text: `${me().name} refuses to surrender.`, kind: 'info', felt: true }); sc.hail = null; }); },
        async 'sc-surrender'() {
            if (!(await confirmAsk('Surrender the ship?', 'You put the ship and everyone aboard at the mercy of the enemy.'))) return;
            act(() => playerSurrender()); afterPulse();
        },
        async 'sc-abandon'() {
            if (!(await confirmAsk('Abandon ship?', 'The ship and everything aboard is lost. You take to the pods.'))) return;
            act(() => abandonShip()); afterPulse();
        },
        'sc-fleet'(el) { const [type, target] = el.value.split(':'); act(() => setFleetOrder(el.dataset.id, type, target ?? null)); },
        'sc-act'(el) { act(() => { const sc = SC(); sc.playerAct = sc.playerAct === el.dataset.a ? null : el.dataset.a; }); },
        'sc-abort'() { abortShipCombat(); addLog('Space battle aborted.', 'combat'); commit('shipcombat'); },
        'sc-dismiss'() { S().lastShipCombat = null; commit('shipcombat'); },
        'sc-salvage'(el) {
            const p = S().lastShipCombat?.prizes.find(x => x.id === el.dataset.id);
            // Anything with an inside is explored compartment by compartment; strike craft are stripped from outside.
            if (p && deckPlan(VESSELS[p.cls])) { act(() => { toast('success', boardPrize(p.id)); openHud('wreck'); }); return; }
            act(() => { const cr = salvagePrize(el.dataset.id); if (cr) toast('success', `Salvage worth ${fmtInt(cr)} cr.`); });
        },
        'sc-board'(el) {
            const st = S();
            const p = st.lastShipCombat?.prizes.find(x => x.id === el.dataset.id);
            if (!p || p.done) return;
            const cls = VESSELS[p.cls];
            act(() => {
                p.done = true;
                if (p.state === 'surrendered') {
                    st.pendingEvent = `${st.pendingEvent ? `${st.pendingEvent} ` : ''}A prize crew from ${st.captain.name}'s side has taken possession of the surrendered ${p.name} (${cls.role}) without a fight. About ${p.crew} of her crew are prisoners. Decide what is found aboard.`;
                    addLog(`Prize crew aboard ${p.name}.`, 'combat');
                    return;
                }
                const type = cls.pirate ? 'pirate' : cls.machine ? 'drone' : cls.doctrine === 'civilian' ? 'guard' : 'marine';
                startCombat({ scene: `Aboard the ${p.name}, corridor`, groups: parseEnemies([type, String(clamp(Math.round(p.crew / 4), 2, 6))]) });
            });
        },
        'sc-start'(el) {
            const box = el.closest('[data-widget], .sf-widget') ?? document;
            const get = (k) => box.querySelector(`[data-scs="${k}"]`)?.value;
            act(() => startShipCombatFromTokens(['Open space', get('cls'), get('n')]));
        },
    });

    registerCommand('shipcombat', (st, args) => {
        if (/^(end|stop|abort)$/i.test(args[0] ?? '')) { abortShipCombat(); return 'Space battle ended'; }
        return startShipCombatFromTokens(args);
    }, ['spacebattle', 'spacecombat', 'dogfight', 'shipfight', 'navalcombat']);

    registerCommand('post', (st, args) => {
        const role = String(args[0] ?? '').toLowerCase();
        if (!role || /^(none|off|leave|discharged?)$/.test(role)) { st.post = null; return 'Posting ended'; }
        const key = Object.keys(POSTS).find(k => k === role || POSTS[k].name.toLowerCase() === role) ?? ({ gunner: 'gunnery', engineer: 'engineering', helmsman: 'helm', pilot: 'pilot', officer: 'xo', first: 'xo', admiral: 'commander', commodore: 'commander', sensor: 'sensors', ops: 'sensors', marine: 'crew', crewman: 'crew' })[role];
        if (!key) throw new Error(`unknown post "${args[0]}"`);
        const cls = args[2] ? resolveClass(args[2]) : (args[1] ? resolveClass(args[1]) : null);
        const named = args[1] && !(args.length === 2 && cls) ? args[1] : null;
        if (!cls && !st.ship && !st.craft.length) throw new Error('name the ship and its class, for example: post gunnery "ISV Castellan" frigate');
        st.post = { role: key, ship: named ?? cls?.name ?? '', classId: cls?.id ?? null };
        const p = playerPost(st);
        return `Posted as ${POSTS[key].name.toLowerCase()} aboard ${p.shipName}`;
    }, ['station', 'assign']);

    registerPromptSection((st) => {
        const out = [];
        const p = playerPost(st);
        if (p && !(p.own && p.role === 'captain') && !p.craft) {
            const post = POSTS[p.role];
            out.push(`${st.captain.name} serves as ${post.name.toLowerCase()} aboard ${p.shipName} (${VESSELS[p.classId].name})${post.can.includes('command') ? ' and is in command' : `; they are not in command and ${post.can.length ? `only work the ${post.can.join(' and ')} station` : 'have no access to the bridge or the ship\'s systems'}`}.`);
        }
        if (st.stranded) out.push(`${st.ship?.name ?? 'The ship'} is STRANDED in deep space after a blind emergency jump: no lane, drive burned out.`);
        return { state: out.join('\n'), now: st.shipCombat ? 'A SPACE BATTLE IS IN PROGRESS and the game is resolving it. Do not narrate its course or outcome yet; keep any reply to a single tense beat.' : '' };
    });

    let was = false;
    onChange(() => {
        const now = !!S()?.shipCombat;
        if (now && !was && settings().enabled) { openHud('tactical'); blip('alert'); }
        was = now;
    });
    void ctx; void redraw;
}
