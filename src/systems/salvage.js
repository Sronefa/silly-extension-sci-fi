// Salvage. A wreck is explored compartment by compartment, from its real deck plan: the party goes
// in through a lock in suits with a few hours of air, finds what the years have left, and meets
// whatever else is aboard on the on-foot combat ground, built from the compartments around them.
// Parts come out in whatever state they are in: the reactor is always dead, the rest is luck.
import { S, addLog, galaxy, cargoUsed, cargoCap } from '../core/state.js';
import { makeRng, hash, pick, randInt, clamp, uid } from '../core/util.js';
import { VESSELS } from '../data/vessels.js';
import { deckPlan } from '../data/decks.js';
import { MODULES, hullSlots } from '../data/modules.js';
import { GOODS, goodById } from '../data/economy.js';
import { ENEMIES } from '../data/combat.js';
import { shipHas, ledger } from './market.js';
import { skillCheck, describeCheck, gainXp } from './character.js';
import { damagePart } from './body.js';
import { startCombat } from './combat.js';
import { registerActivity, book } from './activity.js';
import { currentSite, siteBook, revealFromStory } from './sites.js';
import { port, hasYard } from './services.js';
import { advanceTime, fmtDuration } from './sim.js';

const MAX_ROOMS = 16;
export const SUIT_AIR = 6 * 60;
/** Tonnes of hold a part takes, by its size. */
export const partTonnes = (mod) => mod.size * 4;
/** What a part fetches at a yard, and what a repair costs, as shares of the new price. */
export const PART_SALE = { working: 0.3, damaged: 0.1, scrap: 0.03 };
export const PART_REPAIR = 0.3;
const CONDITION = { working: 'working', damaged: 'damaged', scrap: 'scrap', dead: 'dead' };

// ---- The wreck ----

const HAZARDS = {
    breach: { name: 'Torn hull', skill: 'athletics', dc: 11, text: 'jagged plating and open vacuum', hurt: 'a suit tear' },
    unstable: { name: 'Buckled frames', skill: 'athletics', dc: 12, text: 'frames that shift under any weight', hurt: 'a collapse' },
    wiring: { name: 'Live wiring', skill: 'electronics', dc: 11, text: 'cables still holding a charge from the batteries', hurt: 'an arc' },
    radiation: { name: 'Radiation', skill: 'engineering', dc: 12, text: 'a cracked reactor shield, counters chattering', hurt: 'a dose' },
};

/** Which compartment a module would be found in. */
function homeFor(mod, rooms) {
    const by = (pred) => rooms.filter(pred);
    const cands = mod.weapon ? by(r => r.kind === 'weapons' || /barbette|gun/i.test(r.name))
        : mod.slot === 'utility' ? by(r => r.id === 'sensors' || r.kind === 'command')
            : mod.fx?.medbay ? by(r => r.kind === 'medical')
                : by(r => ['hold', 'service', 'engineering'].includes(r.kind) && r.id !== 'reactor');
    return cands.length ? cands : rooms.filter(r => r.id !== 'reactor');
}

function rollCondition(rng, fresh, age) {
    const x = rng();
    const working = fresh ? 0.5 : clamp(0.32 - age * 0.003, 0.12, 0.32);
    const damaged = fresh ? 0.35 : 0.4;
    return x < working ? 'working' : x < working + damaged ? 'damaged' : 'scrap';
}

/** Builds a wreck from a ship class: its compartments, how they connect, and what is in them. */
export function buildWreck({ key, cls: clsId, name, fresh = false, age = 10, sys }) {
    const cls = VESSELS[clsId];
    const plan = deckPlan(cls);
    if (!plan) throw new Error('nothing that size has an inside to explore');
    const rng = makeRng(hash('wreck', key));
    const sec = galaxy().systems[sys]?.security ?? 3;
    // The compartments that matter, then enough of the rest to make a ship of it.
    const key1 = ['bridge', 'reactor', 'drives', 'jump', 'sensors', 'cic', 'magazine', 'armory', 'mess', 'shields', 'lifesupport', 'shop'];
    const pickd = [...plan.rooms.filter(r => key1.includes(r.id) || ['hold', 'medical'].includes(r.kind))];
    for (const r of plan.rooms) if (pickd.length < MAX_ROOMS && !pickd.includes(r)) pickd.push(r);
    const chosen = pickd.slice(0, MAX_ROOMS).sort((a, b) => a.deck - b.deck || a.x - b.x || a.y - b.y);
    const rooms = chosen.map((r, i) => ({ i, id: r.id, name: r.name, kind: r.kind, deck: r.deck, x: r.x, y: r.y, len: r.len, h: r.h, desc: r.desc, hazard: null, loot: [], foes: null, seen: false, searched: false }));
    // Corridors along each deck, ladders between them.
    const links = [];
    const decks = [...new Set(rooms.map(r => r.deck))];
    for (const d of decks) {
        const on = rooms.filter(r => r.deck === d);
        for (let k = 1; k < on.length; k++) links.push([on[k - 1].i, on[k].i, on[k - 1].y === on[k].y]);
    }
    for (let k = 1; k < decks.length; k++) {
        const up = rooms.filter(r => r.deck === decks[k - 1]), down = rooms.filter(r => r.deck === decks[k]);
        const mid = (down[0].x + down[down.length - 1].x) / 2;
        const a = down.reduce((b, r) => (Math.abs(r.x - mid) < Math.abs(b.x - mid) ? r : b));
        const b = up.reduce((c, r) => (Math.abs(r.x - a.x) < Math.abs(c.x - a.x) ? r : c));
        links.push([b.i, a.i, false]);
    }
    // The lock you come in by: a hold or a hangar if she has one, otherwise the first compartment.
    const entry = (rooms.find(r => r.kind === 'hold') ?? rooms.find(r => r.kind === 'flight') ?? rooms[0]).i;
    // Hazards.
    for (const r of rooms) {
        if (r.id === 'reactor') { r.hazard = 'radiation'; continue; }
        if (r.i === entry) continue;
        const x = rng();
        r.hazard = x < (fresh ? 0.12 : 0.16) ? 'breach' : x < (fresh ? 0.2 : 0.28) ? 'unstable' : x < (fresh ? 0.3 : 0.36) ? 'wiring' : null;
    }
    // What is still aboard. Modules from her fit, where they would be.
    for (const slot of hullSlots(cls)) {
        const mod = slot.stock ? MODULES[slot.stock] : null;
        if (!mod || rng() < (fresh ? 0.15 : 0.35)) continue; // shot off, or stripped by someone before you
        const room = pick(rng, homeFor(mod, rooms));
        room.loot.push({ id: uid('lt'), type: 'part', mod: mod.id, cond: rollCondition(rng, fresh, age) });
    }
    const reactor = rooms.find(r => r.id === 'reactor');
    if (reactor) reactor.loot.push({ id: uid('lt'), type: 'core', name: 'Reactor core', cond: 'dead', value: Math.round(cls.hull * 1.2), tonnes: cls.size * 6 });
    const goods = GOODS.filter(g => !g.handling && !g.restricted && ['raw', 'refined', 'made'].includes(g.tier));
    for (const r of rooms) {
        if (r.kind === 'hold' && rng() < (fresh ? 0.8 : 0.55)) {
            const g = pick(rng, goods);
            r.loot.push({ id: uid('lt'), type: 'cargo', good: g.id, qty: randInt(rng, 3, 8 + cls.size * 6) });
        }
        if (r.kind === 'crew' && rng() < 0.6) r.loot.push({ id: uid('lt'), type: 'effects', credits: randInt(rng, 15, fresh ? 400 : 160), item: rng() < 0.35 ? pick(rng, ['Dermal Patch', 'Hemoclamp', 'Analgesic Stim', 'Medkit', 'Magazine']) : null });
        if (r.kind === 'medical' && rng() < 0.7) r.loot.push({ id: uid('lt'), type: 'effects', credits: 0, item: pick(rng, ['Medkit', 'Hemoclamp', 'Field Surgery Kit', 'Bone-weld Splint', 'Burn Gel', 'Dermal Patch']) });
        if (r.kind === 'engineering' && r.id !== 'reactor' && rng() < 0.6) r.loot.push({ id: uid('lt'), type: 'spares', qty: randInt(rng, 1, 2 + Math.floor(cls.size / 2)) });
        if (r.id === 'bridge') r.loot.push({ id: uid('lt'), type: 'recorder', name: `Flight recorder of the ${name}`, value: randInt(rng, 400, 1500) * (fresh ? 0.5 : 1), lead: rng() < 0.5 });
    }
    // Who else is aboard. Old security systems still on battery, and other people's salvage crews.
    const free = rooms.filter(r => r.i !== entry);
    if (!fresh && rng() < (cls.family === 'military' ? 0.6 : 0.3) && free.length) {
        const r = pick(rng, free.filter(x => x.kind === 'command' || x.kind === 'weapons' || x.kind === 'engineering').concat(free).slice(0, 6));
        r.foes = { type: rng() < 0.5 ? 'turret' : 'drone', n: randInt(rng, 1, cls.family === 'military' ? 3 : 2), what: 'the ship\'s own security, still on battery' };
    }
    if (rng() < (sec <= 1 ? 0.55 : sec <= 2 ? 0.35 : 0.12) && free.length) {
        const r = pick(rng, free.filter(x => !x.foes));
        if (r) r.foes = { type: sec <= 1 ? 'pirate' : 'ganger', n: randInt(rng, 2, sec <= 1 ? 4 : 3), what: 'another salvage crew, armed and not sharing' };
    }
    return { key, cls: clsId, name, sys, fresh, rooms, links, entry, age };
}

/** The wreck at a site, or a beaten ship, kept in the save so what was taken stays taken. */
function wreckFor(st, src) {
    const b = siteBook(st);
    const f = (b.state[src.key] ??= {});
    f.wreck ??= buildWreck(src);
    return f.wreck;
}
export const wreckOf = (st = S()) => (st.salvage ? siteBook(st).state[st.salvage.key]?.wreck ?? null : null);

export function neighbours(w, i) {
    return w.links.filter(l => l[0] === i || l[1] === i).map(l => ({ to: l[0] === i ? l[1] : l[0], sight: l[2] }));
}
function pathLen(w, a, b) {
    const seen = new Map([[a, 0]]);
    const q = [a];
    while (q.length) { const x = q.shift(); for (const n of neighbours(w, x)) if (!seen.has(n.to)) { seen.set(n.to, seen.get(x) + 1); q.push(n.to); } }
    return seen.get(b) ?? 0;
}

// ---- Going aboard ----

/** What can be boarded from where the ship is: the derelict at this site, or a beaten ship. */
export function boardable(st = S()) {
    const s = currentSite(st);
    if (s?.kind === 'derelict') return { key: `site:${s.id}`, cls: s.cls, name: s.name.replace(/^Wreck of an? /, '').replace(/^/, 'derelict '), fresh: false, age: s.age, sys: s.sys, site: s.id };
    return null;
}

function goAboard(st, src) {
    if (st.salvage) throw new Error('you are already aboard a wreck');
    if (st.combat || st.shipCombat) throw new Error('not in the middle of a fight');
    if (st.activity?.on) throw new Error(`you are busy: ${st.activity.name.toLowerCase()}`);
    const w = wreckFor(st, src);
    st.salvage = { key: src.key, at: w.entry, air: SUIT_AIR, since: st.minutes, site: src.site ?? null, warned: false };
    const r = w.rooms[w.entry];
    r.seen = true;
    advanceTime(20);
    addLog(`Went aboard the ${w.name}.`, 'nav');
    st.pendingEvent ??= `${st.captain.name}${st.crew.length ? ' and the boarding party' : ''} cycle through a lock into the ${w.name} (${VESSELS[w.cls].role.toLowerCase()}, ${w.fresh ? 'beaten in battle just now' : `adrift some ${w.age} years`}). Suits on, ${fmtDuration(SUIT_AIR)} of air. They are in the ${r.name.toLowerCase()}. Describe it: dark, cold, silent.`;
    return `Aboard the ${w.name}`;
}

export function boardWreck() {
    const st = S();
    const src = boardable(st);
    if (!src) throw new Error('there is no wreck here to board');
    return goAboard(st, src);
}

/** A ship beaten in the last battle, opened up for salvage. */
export function boardPrize(id) {
    const st = S();
    const p = st?.lastShipCombat?.prizes?.find(x => x.id === id);
    if (!p || p.done) throw new Error('that ship is gone');
    if (!deckPlan(VESSELS[p.cls])) throw new Error('too small to go aboard: strip what you can from outside');
    p.done = true;
    return goAboard(st, { key: `prize:${st.lastShipCombat.at}:${p.id}`, cls: p.cls, name: p.name, fresh: true, age: 0, sys: st.loc.system });
}

/** Back to the lock and aboard your own ship. The way back takes as long as the way in. */
export function leaveWreck() {
    const st = S();
    if (!st.salvage) throw new Error('you are not aboard a wreck');
    if (st.combat) throw new Error('not in the middle of a fight');
    if (st.activity?.wreck) throw new Error('stop the cutting first');
    const w = wreckOf(st);
    const mins = 10 + pathLen(w, st.salvage.at, w.entry) * 4;
    st.salvage = null;
    advanceTime(mins);
    addLog(`Back aboard from the ${w.name}.`, 'nav');
    return `Back aboard your ship (${fmtDuration(mins)})`;
}

// ---- Moving through her ----

function hazardCheck(st, r) {
    const h = HAZARDS[r.hazard];
    if (!h) return '';
    const res = skillCheck(st.captain, h.skill, h.dc, { now: st.minutes });
    const line = describeCheck(st.captain, res);
    if (res.success) return `${h.name}: ${h.text}. Got through it. (${line})`;
    if (r.hazard === 'breach') { st.salvage.air = Math.max(0, st.salvage.air - 90); damagePart(st.captain, pick(Math.random, ['larm', 'rarm', 'lleg', 'rleg']), 8 + Math.random() * 12); }
    else if (r.hazard === 'unstable') damagePart(st.captain, pick(Math.random, ['lleg', 'rleg', 'thorax']), 15 + Math.random() * 25);
    else if (r.hazard === 'wiring') damagePart(st.captain, pick(Math.random, ['larm', 'rarm']), 12 + Math.random() * 20);
    else if (r.hazard === 'radiation') { damagePart(st.captain, 'thorax', 10 + Math.random() * 10); damagePart(st.captain, 'stomach', 8 + Math.random() * 8); }
    return `${h.name}: ${h.text}. It went wrong: ${h.hurt}${r.hazard === 'breach' ? ', and the suit lost air patching it' : ''}. (${line})`;
}

/** Combat ground: the compartment being entered, where you come from, and what lies around them. */
function groundFor(w, from, to) {
    const ids = [from, to];
    for (const n of neighbours(w, to)) if (!ids.includes(n.to) && ids.length < 5) ids.push(n.to);
    for (const n of neighbours(w, from)) if (!ids.includes(n.to) && ids.length < 6) ids.push(n.to);
    const cover = (r) => (['hold', 'engineering', 'weapons'].includes(r.kind) ? 2 : r.kind === 'crew' || r.kind === 'service' ? 1 : r.hazard === 'unstable' ? 2 : 1);
    const zones = ids.map((id, k) => {
        const r = w.rooms[id];
        return { name: r.name, cover: cover(r), x: k === 0 ? 0 : k === 1 ? 1 : k < 4 ? 2 : 1, y: k === 0 || k === 1 ? 1 : k === 2 ? 1 : k === 3 ? 0 : 2, entry: k === 0, far: k >= 2 };
    });
    const links = [];
    for (const l of w.links) {
        const a = ids.indexOf(l[0]), b = ids.indexOf(l[1]);
        if (a >= 0 && b >= 0) links.push([a, b, l[2]]);
    }
    // Every zone has to be reachable on the ground; tie stragglers to the room being entered.
    for (let k = 2; k < ids.length; k++) if (!links.some(l => l[0] === k || l[1] === k)) links.push([1, k, false]);
    if (!links.some(l => (l[0] === 0 && l[1] === 1) || (l[0] === 1 && l[1] === 0))) links.push([0, 1, true]);
    // The foes hold the room being entered and what is behind it.
    zones[1].far = true;
    return { zones, links };
}

export function moveRoom(to) {
    const st = S();
    const sv = st.salvage;
    if (!sv) throw new Error('you are not aboard a wreck');
    if (st.combat) throw new Error('finish the fight first');
    if (st.activity?.on) throw new Error(`you are busy: ${st.activity.name.toLowerCase()}`);
    const w = wreckOf(st);
    to = Number(to);
    const link = neighbours(w, sv.at).find(n => n.to === to);
    if (!link) throw new Error('no way through from here');
    const r = w.rooms[to];
    const from = sv.at;
    const first = !r.seen;
    advanceTime(link.sight ? 4 : 7);
    if (r.foes) {
        sv.fight = { room: to, from, at: st.minutes };
        const tpl = ENEMIES[r.foes.type];
        startCombat({ scene: `Aboard the ${w.name}: ${r.name}`, groups: [{ tpl, name: tpl.name, count: r.foes.n }], layout: groundFor(w, from, to), surprise: r.foes.type === 'turret' ? 'enemy' : null });
        return `Contact in the ${r.name.toLowerCase()}: ${r.foes.what}`;
    }
    sv.at = to;
    r.seen = true;
    const hz = first ? hazardCheck(st, r) : '';
    if (hz) st.pendingEvent ??= `Aboard the ${w.name}, ${st.captain.name} works into the ${r.name.toLowerCase()}. ${hz} Play it.`;
    return hz ? `${r.name}. ${hz.split('. (')[0]}` : r.name;
}

/** After a fight aboard: a win takes the compartment, anything else leaves you where you were. */
export function salvageAfterFight(st) {
    const sv = st.salvage;
    if (!sv?.fight || st.combat) return;
    const f = sv.fight;
    sv.fight = null;
    const w = wreckOf(st);
    const last = st.lastCombat;
    if (last && last.at >= f.at && last.result === 'victory') {
        const r = w.rooms[f.room];
        r.foes = null;
        r.seen = true;
        sv.at = f.room;
    }
}

/** Going through a compartment properly: lockers, deck plates, under the consoles. */
export function searchRoom() {
    const st = S();
    const sv = st.salvage;
    if (!sv) throw new Error('you are not aboard a wreck');
    if (st.combat || st.activity?.on) throw new Error('not now');
    const w = wreckOf(st);
    const r = w.rooms[sv.at];
    if (r.searched) throw new Error('already searched');
    const mins = Math.round(10 + (r.len ?? 10) * (r.h ?? 1) * 0.6);
    advanceTime(Math.min(45, mins));
    r.searched = true;
    gainXp(st.captain, 'survival', 2);
    return r.loot.length ? `Searched the ${r.name.toLowerCase()}: ${r.loot.length} thing${r.loot.length > 1 ? 's' : ''} worth having` : `Searched the ${r.name.toLowerCase()}: nothing worth taking`;
}

export function lootName(l) {
    if (l.type === 'part') return `${MODULES[l.mod].name} (${CONDITION[l.cond]})`;
    if (l.type === 'core') return `${l.name} (dead)`;
    if (l.type === 'cargo') return `${l.qty} t of ${goodById(l.good).name.toLowerCase()}`;
    if (l.type === 'effects') return [l.credits ? `${l.credits} cr in cred chips` : '', l.item ?? ''].filter(Boolean).join(' and ') || 'personal effects';
    if (l.type === 'spares') return `${l.qty} crate${l.qty > 1 ? 's' : ''} of spare parts`;
    if (l.type === 'recorder') return l.name;
    return 'something';
}

/** How long it takes to get a thing out, and whether the gear aboard can do it. */
export function lootNeeds(st, l) {
    const free = cargoCap(st) - cargoUsed(st);
    if (l.type === 'part') {
        const mod = MODULES[l.mod];
        if (mod.size >= 2 && !shipHas(st, 'salvage')) return { why: 'too big to move by hand: it needs a salvage rig aboard your ship' };
        if (free < partTonnes(mod)) return { why: `needs ${partTonnes(mod)} t of hold` };
        return { mins: 25 * mod.size + 10 };
    }
    if (l.type === 'core') {
        if (!shipHas(st, 'salvage')) return { why: 'a reactor core needs a salvage rig' };
        if (free < l.tonnes) return { why: `needs ${l.tonnes} t of hold` };
        return { mins: 90 };
    }
    if (l.type === 'cargo') {
        if (free < 1) return { why: 'the hold is full' };
        return { mins: Math.round(5 + Math.min(l.qty, free) * 1.5) };
    }
    return { mins: 2 };
}

function stow(st, l) {
    if (l.type === 'part') {
        const mod = MODULES[l.mod];
        st.cargo.push({ id: uid('it'), name: `Salvaged ${mod.name} (${CONDITION[l.cond]})`, qty: partTonnes(mod), comId: null, part: { mod: mod.id, cond: l.cond } });
    } else if (l.type === 'core') {
        st.cargo.push({ id: uid('it'), name: 'Dead reactor core (scrap)', qty: l.tonnes, comId: null, part: { scrap: l.value } });
    } else if (l.type === 'cargo') {
        const n = Math.min(l.qty, cargoCap(st) - cargoUsed(st));
        let s = st.cargo.find(c => c.comId === l.good && !c.purity && !c.contract);
        if (!s) { s = { id: uid('it'), name: goodById(l.good).name, qty: 0, comId: l.good, paid: 0 }; st.cargo.push(s); }
        s.paid = Math.round((s.paid * s.qty) / (s.qty + n));
        s.qty += n;
        l.qty -= n;
        return l.qty <= 0;
    } else if (l.type === 'effects') {
        if (l.credits) st.captain.credits += l.credits;
        if (l.item) { const it = st.captain.inventory.find(i => i.name === l.item); if (it) it.qty += 1; else st.captain.inventory.push({ id: uid('it'), name: l.item, qty: 1 }); }
    } else if (l.type === 'spares') {
        if (st.ship) st.ship.parts = (st.ship.parts ?? 0) + l.qty;
    } else if (l.type === 'recorder') {
        st.captain.inventory.push({ id: uid('it'), name: l.name, qty: 1, recorder: { value: Math.round(l.value) } });
        if (l.lead) { try { const t = revealFromStory(pick(Math.random, ['derelict', 'cache', 'field', 'hideout'])); addLog(`The recorder's last logs point somewhere: ${t.replace(/^Learned of /, '')}.`, 'nav'); } catch { /* nothing left to find here */ } }
    }
    return true;
}

/** Takes a thing. Small things are pocketed; parts are cut free over time, lived. */
export function takeLoot(lootId) {
    const st = S();
    const sv = st.salvage;
    if (!sv) throw new Error('you are not aboard a wreck');
    if (st.combat || st.activity?.on) throw new Error('not now');
    const w = wreckOf(st);
    const r = w.rooms[sv.at];
    const l = r.loot.find(x => x.id === lootId);
    if (!l || !r.searched) throw new Error('nothing like that here');
    const need = lootNeeds(st, l);
    if (need.why) throw new Error(need.why);
    if (need.mins <= 20) {
        advanceTime(need.mins);
        const name = lootName(l);
        if (stow(st, l)) r.loot = r.loot.filter(x => x !== l);
        return `Took ${name}`;
    }
    const a = book(st, { kind: 'cut', name: `Cutting the ${lootName(l).replace(/ \(.*\)$/, '').toLowerCase()} free`, need: need.mins, space: true, sys: st.loc.system, site: sv.site, wreck: sv.key, room: sv.at, loot: l.id, window: 5 });
    a.on = true;
    a.started = st.minutes;
    st.pendingEvent ??= `In the ${r.name.toLowerCase()} of the ${w.name}, ${st.captain.name} sets to work getting the ${lootName(l).toLowerCase()} out: torches, pry bars, sweat inside the suit. It will take ${fmtDuration(need.mins)}. Play the work.`;
    a.ev = st.pendingEvent;
    return `Cutting under way (${fmtDuration(need.mins)})`;
}

registerActivity('cut', {
    finish(st, a) {
        const w = siteBook(st).state[a.wreck]?.wreck;
        const r = w?.rooms[a.room];
        const l = r?.loot.find(x => x.id === a.loot);
        if (!l) return '';
        const name = lootName(l);
        if (lootNeeds(st, l).why) return `Cut free, but there is no room for the ${name.toLowerCase()} in the hold: it stays aboard the wreck.`;
        if (stow(st, l)) r.loot = r.loot.filter(x => x !== l);
        gainXp(st.captain, 'engineering', 3);
        return `Cut free and hauled aboard: ${name}.`;
    },
    stop() { return 'Stopped cutting. The part is still in the wreck.'; },
});

/** On the clock: suit air runs down while you are aboard. */
export function salvageTick(st, mins) {
    const sv = st.salvage;
    if (!sv) return;
    salvageAfterFight(st);
    sv.air = Math.max(0, sv.air - mins);
    if (sv.air <= 60 && !sv.warned) {
        sv.warned = true;
        st.pendingEvent ??= `Suit alarms: under an hour of air left aboard the ${wreckOf(st)?.name ?? 'wreck'}. Play it.`;
    }
    if (sv.air <= 0 && mins > 0) {
        damagePart(st.captain, 'head', mins * 0.6);
        damagePart(st.captain, 'thorax', mins * 0.6);
        st.pendingEvent = `${st.captain.name}'s suit is out of air aboard the ${wreckOf(st)?.name ?? 'wreck'}. Suffocating. Play it, now.`;
    }
}

// ---- Selling what came out ----

export function salvagedParts(st = S()) { return st.cargo.filter(c => c.part); }

export function partValue(st, c) {
    if (c.part.scrap) return c.part.scrap;
    const mod = MODULES[c.part.mod];
    // Military kit without papers: a legal yard pays for it as metal and parts, not as a weapon.
    return Math.round(mod.price * PART_SALE[c.part.cond] * (mod.legal === 'open' ? 1 : 0.5));
}

function atYard(st) {
    const p = port(st);
    if (!p || !hasYard(p)) throw new Error('salvaged parts are dealt with at a station with a repair yard');
    return p;
}

export function sellPart(id) {
    const st = S();
    atYard(st);
    const c = st.cargo.find(x => x.id === id && x.part);
    if (!c) throw new Error('no such part');
    const v = partValue(st, c);
    st.cargo = st.cargo.filter(x => x !== c);
    st.captain.credits += v;
    ledger(st, `Sold ${c.name}`, v);
    addLog(`Sold ${c.name} for ${v} cr.`, 'trade');
    return `Sold for ${v.toLocaleString('en-US')} cr`;
}

/** A working part goes into stores as a spare; a damaged one is rebuilt at the yard first. */
export function stowPart(id) {
    const st = S();
    const c = st.cargo.find(x => x.id === id && x.part);
    if (!c || c.part.scrap) throw new Error('no such part');
    if (c.part.cond === 'scrap') throw new Error('that is scrap: sell it');
    const mod = MODULES[c.part.mod];
    let cost = 0;
    if (c.part.cond === 'damaged') {
        atYard(st);
        cost = Math.round(mod.price * PART_REPAIR);
        if (st.captain.credits < cost) throw new Error(`the yard wants ${cost.toLocaleString('en-US')} cr to rebuild it`);
        st.captain.credits -= cost;
        ledger(st, `Rebuilt ${mod.name}`, -cost);
    }
    st.cargo = st.cargo.filter(x => x !== c);
    (st.ship.spares ??= []).push(mod.id);
    return `${mod.name} ${cost ? 'rebuilt and ' : ''}stowed as a spare: fit it at a yard`;
}

/** Insurers pay for flight recorders at any port office. */
export function handInRecorder(itemId) {
    const st = S();
    const p = port(st);
    if (!p) throw new Error('recorders are handed in at a port office');
    const it = st.captain.inventory.find(i => i.id === itemId && i.recorder);
    if (!it) throw new Error('no such recorder');
    st.captain.inventory = st.captain.inventory.filter(i => i !== it);
    st.captain.credits += it.recorder.value;
    ledger(st, `Insurance reward: ${it.name}`, it.recorder.value);
    return `The insurers pay ${it.recorder.value.toLocaleString('en-US')} cr`;
}

/** For the storyteller. */
export function salvagePrompt(st) {
    const sv = st.salvage;
    if (!sv) return '';
    const w = wreckOf(st);
    const r = w.rooms[sv.at];
    const ways = neighbours(w, sv.at).map(n => w.rooms[n.to].name).join(', ');
    return `${st.captain.name} is aboard the ${w.name} (${VESSELS[w.cls].role.toLowerCase()}, ${w.fresh ? 'just beaten in battle' : `adrift ${w.age} years`}), in the ${r.name.toLowerCase()}${r.hazard ? ` (${HAZARDS[r.hazard].text})` : ''}. Ways on: ${ways || 'none'}. Suit air: ${fmtDuration(sv.air)}.${r.searched ? ` Searched; left here: ${r.loot.map(lootName).join(', ') || 'nothing of value'}.` : ''}`;
}

export const SALVAGE_RULE = '<salvage>\nAboard a wreck the game runs the compartments, the hazards, what is found and who is waiting. Describe the dark, the cold and the damage, but valuables, parts and enemies exist only when the game reports them. Suit air is real and runs down with story time.\n</salvage>';
