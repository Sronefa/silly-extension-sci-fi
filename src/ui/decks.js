// The deck plan of the ship the player is aboard: every deck, every compartment, to scale.
import { registerWidget, registerActions, btn, redraw } from './hud.js';
import { S, commit } from '../core/state.js';
import { toast } from '../core/st.js';
import { esc, fmtInt } from '../core/util.js';
import { POSTS, ROOMS } from '../data/vessels.js';
import { ROOM_KINDS, stationRoom } from '../data/decks.js';
import { aboardShip, playerRoom, clearance, playerShip, SC } from '../systems/shipcombat.js';
import { advanceTime } from '../systems/sim.js';
import { registerPromptSection } from '../core/ailink.js';
import { blip } from './sfx.js';

const view = { deck: null, room: null, ship: null };
const TYPICAL_PX = 84; // an ordinary compartment is drawn about this wide

/** May someone with this clearance walk into this compartment? */
function mayEnter(room, lvl, station) {
    if (lvl >= 2 || room.id === station?.id) return true;
    if (ROOM_KINDS[room.kind].secure) return false;
    if (lvl >= 1) return true;
    return ['public', 'medical'].includes(room.kind) || /^(mess|lock|pods|cabins)/.test(room.id);
}

function battleState(st, ship) {
    const sc = st.shipCombat;
    const ps = sc ? playerShip(sc) : null;
    return ps && ps.name === ship.name ? ps : null;
}

function decksHtml(st) {
    const ship = aboardShip(st);
    if (!ship) return '';
    const { plan } = ship;
    const here = playerRoom(st);
    const lvl = clearance(st);
    const station = stationRoom(plan, ship.role);
    if (view.ship !== ship.name) { view.ship = ship.name; view.deck = null; view.room = null; }
    const deckN = Math.min(plan.decks.length, view.deck ?? here?.deck ?? station?.deck ?? 1);
    const deck = plan.decks[deckN - 1];
    const ps = battleState(st, ship);
    const typical = plan.length / Math.max(6, plan.rooms.length / plan.decks.length / (ship.cls.size >= 4 ? 2 : 1));
    const k = Math.max(1.2, TYPICAL_PX / typical);
    const H = Math.round(Math.min(230, Math.max(96, plan.beam * k)));
    const rooms = deck.rooms.map(r => {
        const sys = ps && r.sys ? ps.rooms[r.sys] : null;
        const cls = ['sf-dk-room', `k-${r.kind}`, r.id === here?.id ? 'here' : '', r.id === view.room ? 'sel' : '', sys?.fire ? 'fire' : '', sys && sys.hp <= 0 ? 'dead' : sys && sys.hp < sys.max * 0.5 ? 'hurt' : '', mayEnter(r, lvl, station) ? '' : 'locked'].filter(Boolean).join(' ');
        return `<div class="${cls}" data-sf="dk-room" data-id="${r.id}" style="left:${(r.x * k).toFixed(0)}px;width:${Math.max(10, r.len * k - 2).toFixed(0)}px;top:${(r.y * H).toFixed(0)}px;height:${(r.h * H - 2).toFixed(0)}px">
            <span>${r.id === here?.id ? '<i class="fa-solid fa-person"></i> ' : ''}${r.id === station?.id ? '<i class="fa-solid fa-star"></i> ' : ''}${sys?.fire ? '<i class="fa-solid fa-fire"></i> ' : ''}${esc(r.name)}</span></div>`;
    }).join('');
    const sel = plan.rooms.find(r => r.id === view.room);
    let detail = '<small class="sf-dim">Tap a compartment to see what it is and to go there.</small>';
    if (sel) {
        const sys = ps && sel.sys ? ps.rooms[sel.sys] : null;
        const ok = mayEnter(sel, lvl, station);
        const mins = here ? Math.max(1, Math.round((Math.abs(sel.x + sel.len / 2 - here.x - here.len / 2) + Math.abs(sel.deck - here.deck) * 30) / 70)) : Math.max(1, Math.round(plan.length / 140));
        detail = `<div class="sf-dk-detail"><div class="sf-loc-main">${esc(sel.name)}</div>
            <div class="sf-loc-sub">Deck ${sel.deck} · ${esc(ROOM_KINDS[sel.kind].name)} · about ${Math.round(sel.len)} × ${Math.round(plan.beam * sel.h * 0.9)} m${sel.watch ? ` · ${fmtInt(sel.watch)} on watch` : ''}</div>
            <small class="sf-dim">${esc(sel.desc)}</small>
            ${sel.id === station?.id ? `<small class="sf-ok-line">Your station as ${esc(POSTS[ship.role].name.toLowerCase())} is here.</small>` : ''}
            ${sys ? `<small class="${sys.hp <= 0 || sys.fire ? 'sf-warn-line' : 'sf-dim'}">${esc(ROOMS[sel.sys].name)}: ${sys.hp <= 0 ? 'destroyed' : `${Math.round(100 * sys.hp / sys.max)}%`}${sys.fire ? ', on fire' : ''}</small>` : ''}
            <div class="sf-actions">${sel.id === here?.id ? '<small class="sf-ok-line">You are here.</small>' : ok ? btn('dk-go', `Go there (${mins} min)`, { icon: 'fa-person-walking', cls: 'primary', data: { id: sel.id, m: mins }, disabled: !!st.combat }) : '<small class="sf-warn-line"><i class="fa-solid fa-lock"></i> Restricted. Your clearance does not open this door.</small>'}</div></div>`;
    }
    return `<div class="sf-sub">${esc(ship.name)} · ${fmtInt(plan.length)} × ${fmtInt(plan.beam)} m · ${plan.decks.length} deck${plan.decks.length > 1 ? 's' : ''} · ${plan.rooms.length} compartments</div>
        <div class="sf-seg sf-dk-decks">${plan.decks.map(d => `<button type="button" class="sf-btn${d.n === deckN ? ' primary' : ''}" data-sf="dk-deck" data-n="${d.n}" title="${esc(d.name)}">${d.n}${here?.deck === d.n ? ' <i class="fa-solid fa-person"></i>' : ''}</button>`).join('')}</div>
        <small class="sf-dim">Deck ${deckN} of ${plan.decks.length}: ${esc(deck.name.toLowerCase())}. Bow to the left.${here ? '' : ' Your position aboard is not being tracked right now.'}</small>
        <div class="sf-dk-scroll"><div class="sf-dk-hull" style="width:${Math.round(plan.length * k)}px;height:${H}px">${rooms}</div></div>
        ${detail}`;
}

export function initDecksUi() {
    registerWidget({ id: 'decks', when: (st) => !!aboardShip(st), title: () => 'Deck plan', render: decksHtml });
    registerActions({
        'dk-deck'(el) { view.deck = Number(el.dataset.n); view.room = null; redraw(); },
        'dk-room'(el) { view.room = view.room === el.dataset.id ? null : el.dataset.id; redraw(); },
        'dk-go'(el) {
            const st = S();
            const ship = aboardShip(st);
            const room = ship?.plan.rooms.find(r => r.id === el.dataset.id);
            if (!room) return;
            st.loc.place = `${room.name}, deck ${room.deck}, aboard ${ship.name}`;
            st.aboard = { ship: ship.name, room: room.id, place: st.loc.place };
            if (!st.shipCombat) advanceTime(Number(el.dataset.m) || 1);
            view.deck = room.deck;
            blip('click');
            toast('info', `You make your way to ${room.name}.`);
            commit('move');
        },
    });
    registerPromptSection((st) => {
        const ship = aboardShip(st);
        if (!ship) return '';
        const here = playerRoom(st);
        const { plan } = ship;
        const decks = plan.decks.map(d => `Deck ${d.n} (${d.name.toLowerCase()}): ${d.rooms.filter(r => !r.id.startsWith('x')).map(r => r.name).join(', ') || 'stores and machinery'}`).join('; ');
        return `Interior of ${ship.name}, ${plan.length} m long, ${plan.decks.length} deck${plan.decks.length > 1 ? 's' : ''} numbered from the top, about ${fmtInt(ship.cls.crew)} aboard. ${decks}.${plan.rooms.length > 40 ? ` Plus about ${plan.rooms.filter(r => r.id.startsWith('x')).length} berthing, stores and machinery spaces.` : ''}${here ? ` ${st.captain.name} is in ${here.name} on deck ${here.deck}.` : ''} Keep scenes aboard consistent with this layout.`;
    });
    void SC;
}
