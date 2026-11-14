// Core simulation primitives shared by the panels, the slash command and the AI tag parser.
import { S, addLog, adjust, cargoUsed, cargoCap, galaxy, saveCheckpoint } from '../core/state.js';
import { settings } from '../core/st.js';
import { clamp, findByName, uid, norm } from '../core/util.js';
import { NEEDS, COMMODITIES, SHIP_SYSTEMS, FACTIONS, INJURY_SEVERITY } from '../data/catalog.js';
import { ATTRIBUTES, SKILL_DEFS, CYBERWARE, CHECK_DCS } from '../data/chargen.js';
import { decayMult, stressMult, hasFx, gainXp, skillCheck, describeCheck, refreshDerived, makeNpcSheet, cyberLoad, cyberCapacity } from './character.js';
import { damagePart, healBody, woundTick, naturalHeal, isDead, isDown, isBleeding, randomPart, addWound, syncHealth, countItem } from './body.js';
import { BODY_PARTS, WOUND_TYPES } from '../data/combat.js';

function needShip(st) {
    if (!st.ship) throw new Error('you have no ship');
    return st.ship;
}

function findSkill(name) {
    const n = norm(name);
    return SKILL_DEFS.find(x => x.id === n) ?? SKILL_DEFS.find(x => norm(x.name) === n)
        ?? SKILL_DEFS.find(x => x.id.startsWith(n) || norm(x.name).startsWith(n)) ?? SKILL_DEFS.find(x => norm(x.name).includes(n));
}

/** The player, or a party member by name. */
function who(st, name) {
    if (!name || norm(name) === norm(st.captain.name) || /^(me|self|player)$/i.test(name)) return st.captain;
    return findByName(st.crew, name);
}

/** Marks the character as dead. What happens next depends on the campaign's death mode. */
export function killPlayer(cause = '') {
    const st = S();
    if (!st || st.dead) return;
    st.dead = true;
    st.deathCause = cause;
    st.combat = null;
    addLog(`${st.captain.name} has died${cause ? `: ${cause}` : ''}.`, 'combat');
}

const arrivalHooks = [];
/** Feature modules can react to arrivals (encounters, market refresh, wages…). */
export function onArrival(fn) { arrivalHooks.push(fn); }

/**
 * Advances the campaign clock and everything that depends on it: needs, wounds, healing,
 * supplies and travel. There are no time skips: this is the only way time moves.
 */
export function advanceTime(minutes, { asleep = false } = {}) {
    const st = S();
    if (!st || !Number.isFinite(minutes) || minutes === 0) return;
    const before = st.minutes;
    st.minutes = Math.max(0, st.minutes + Math.round(minutes));
    const mins = st.minutes - before;
    const hours = mins / 60;
    if (hours <= 0) return;
    const cfg = settings();
    const pc = st.captain;
    if (cfg.needsDecay) {
        const rate = hours * cfg.needsRate;
        for (const n of NEEDS) {
            let mult = decayMult(pc, n.id);
            if (asleep) mult *= n.id === 'rest' ? 0 : n.id === 'morale' ? 0 : 0.6;
            adjust(pc.needs, n.id, -n.decay * rate * mult, 0, 100);
        }
        if (asleep) adjust(pc.needs, 'rest', 12.5 * hours, 0, 100);
        if (hasFx(pc, 'craving')) adjust(pc, 'craving', 2.5 * rate, 0, 100);
        // Running on empty hurts: the body starts to fail and nerves fray.
        if (pc.needs.hydration <= 0) damagePart(pc, 'thorax', 3 * rate);
        if (pc.needs.nourishment <= 0) damagePart(pc, 'stomach', 1 * rate);
        if (pc.needs.rest <= 0) adjust(pc, 'stress', 4 * rate * stressMult(pc), 0, 100);
    }
    // Wounds bleed in story time too, and rested, fed bodies slowly mend.
    for (const sh of [pc, ...st.crew]) {
        woundTick(sh, { minutes: mins });
        const fed = sh !== pc || (pc.needs.nourishment > 25 && pc.needs.hydration > 25);
        if (fed) naturalHeal(sh, hours, (asleep ? 2 : 1) * (hasFx(sh, 'healing') ? 1.5 : 1));
    }
    if (isDead(pc) || pc.health <= 0) killPlayer(isBleeding(pc) ? 'bled out' : 'succumbed to their condition');
    // Ship stores: one crew-day of supplies per person per day.
    if (st.ship) {
        const people = 1 + st.crew.length;
        st.ship.supplies = Math.max(0, st.ship.supplies - (people * hours) / 24);
    }
    if (st.transit && st.minutes >= st.transit.end) completeTransit();
}

/** Starts a journey to another system. The trip is lived in story time; nothing is skipped. */
export function beginTransit(toId, hours, info = {}) {
    const st = S();
    st.transit = { from: st.loc.system, to: toId, start: st.minutes, end: st.minutes + Math.round(hours * 60), ...info };
    st.loc.docked = false;
    st.loc.place = '';
}

function completeTransit() {
    const st = S();
    const g = galaxy();
    const t = st.transit;
    const from = g.systems[t.from], to = g.systems[t.to];
    st.transit = null;
    st.loc = { system: to.id, station: 0, docked: !!t.passenger, place: '' };
    st.visited[to.id] = true;
    if (st.route[0] === t.from) st.route = st.route.slice(1);
    if (st.route.length < 2) st.route = [];
    addLog(t.passenger ? `Arrived at ${to.stations[0].name}, ${to.name}.` : `Jump complete: arrived in ${to.name}.`, 'nav');
    st.pendingEvent = `${t.passenger ? `The transport carrying ${st.captain.name}` : `The ${st.ship?.name ?? 'ship'}`} has just dropped out of jump and arrived in the ${to.name} system after the journey from ${from.name}. Describe the arrival.`;
    saveCheckpoint(`Arrival: ${to.name}`, true);
    for (const fn of arrivalHooks) {
        try { fn(st, from, to); } catch (e) { console.error('[Ship-OS] arrival hook failed', e); }
    }
}

export function transitInfo(st = S()) {
    const t = st?.transit;
    if (!t) return null;
    const g = galaxy();
    const total = Math.max(1, t.end - t.start);
    return { ...t, fromSys: g.systems[t.from], toSys: g.systems[t.to], left: Math.max(0, t.end - st.minutes), progress: clamp((st.minutes - t.start) / total, 0, 1) };
}

export function fmtDuration(mins) {
    const m = Math.max(0, Math.round(mins));
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), r = m % 60;
    return [d ? `${d} d` : '', h ? `${h} h` : '', !d && r ? `${r} min` : ''].filter(Boolean).join(' ') || '0 min';
}

export function parseDuration(text) {
    const s = String(text).trim().toLowerCase();
    const sign = s.startsWith('-') ? -1 : 1;
    let total = 0, matched = false;
    for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(d|h|m)/g)) {
        matched = true;
        total += Number(m[1]) * { d: 1440, h: 60, m: 1 }[m[2]];
    }
    if (!matched) {
        const n = Number(s.replace(/^[+-]/, ''));
        if (!Number.isFinite(n)) return NaN;
        total = n * 60; // bare numbers are hours
    }
    return sign * total;
}

function parseDelta(tok) {
    const s = String(tok ?? '').replace(/,/g, '').trim();
    const m = s.match(/^([+\-=]?)(\d+(?:\.\d+)?)%?$/);
    if (!m) return null;
    const v = Number(m[2]);
    if (m[1] === '+') return { set: false, v };
    if (m[1] === '-') return { set: false, v: -v };
    return { set: true, v };
}

function applyDelta(obj, key, tok, lo, hi) {
    const d = parseDelta(tok);
    if (!d) throw new Error(`"${tok}" is not a number`);
    const before = Number(obj[key]) || 0;
    obj[key] = clamp(d.set ? d.v : before + d.v, lo, hi);
    const diff = Math.round((obj[key] - before) * 10) / 10;
    return diff >= 0 ? `+${diff}` : `${diff}`;
}

function addStack(list, name, qty, extra = {}) {
    let it = list.find(x => norm(x.name) === norm(name));
    if (!it) {
        it = { id: uid('it'), name, qty: 0, ...extra };
        list.push(it);
    }
    it.qty += qty;
    return it;
}

function removeStack(list, name, qty) {
    const it = findByName(list, name);
    if (!it) throw new Error(`no "${name}" to remove`);
    const taken = Math.min(it.qty, qty);
    it.qty -= taken;
    if (it.qty <= 0) list.splice(list.indexOf(it), 1);
    return { it, taken };
}

/**
 * The command table. Each handler receives string arguments and returns a short
 * human-readable description of what changed.
 */
const COMMANDS = {
    credits(st, [v]) {
        return `Credits ${applyDelta(st.captain, 'credits', v, -1e12, 1e12)}`;
    },
    hull(st, [v]) { return `Hull ${applyDelta(needShip(st), 'hull', v, 0, st.ship.maxHull)}`; },
    shields(st, [v]) { return `Shields ${applyDelta(needShip(st), 'shields', v, 0, st.ship.maxShields)}`; },
    fuel(st, [v]) { return `Fuel ${applyDelta(needShip(st), 'fuel', v, 0, st.ship.maxFuel)}`; },
    supplies(st, [v]) { return `Supplies ${applyDelta(needShip(st), 'supplies', v, 0, 9999)}`; },
    parts(st, [v]) { return `Spare parts ${applyDelta(needShip(st), 'parts', v, 0, 999)}`; },
    health(st, args) {
        // "health -10" hits the player; "health "Ito" -10" hits a party member.
        const target = args.length > 1 ? who(st, args[0]) : st.captain;
        if (!target) throw new Error(`nobody called "${args[0]}"`);
        const d = parseDelta(args[args.length - 1]);
        if (!d) throw new Error(`"${args[args.length - 1]}" is not a number`);
        const before = target.health;
        const change = d.set ? d.v - before : d.v;
        if (change < 0) {
            // Unspecified harm lands on a random body part; large amounts are split over several.
            let left = -change;
            while (left > 0) { const hit = Math.min(left, 30); damagePart(target, randomPart(), hit); left -= hit; }
        } else if (change > 0) {
            healBody(target, change);
        }
        const diff = Math.round(target.health - before);
        return `${target === st.captain ? 'Health' : `${target.name} health`} ${diff >= 0 ? '+' : ''}${diff}${isDown(target) ? ' (DOWN)' : ''}`;
    },
    wound(st, args) {
        // wound ["Name"] <part> <damage> [bleed|arterial|fracture|burn|concussion]
        const first = BODY_PARTS.find(p => p.id === norm(args[0]) || norm(p.name) === norm(args[0]) || norm(p.name).replace(' ', '') === norm(args[0]));
        const target = first ? st.captain : who(st, args[0]);
        if (!target) throw new Error(`nobody called "${args[0]}"`);
        const rest = first ? args : args.slice(1);
        const def = first ?? BODY_PARTS.find(p => p.id === norm(rest[0]) || norm(p.name).startsWith(norm(rest[0])) || norm(rest[0]).includes(p.id));
        if (!def) throw new Error(`unknown body part "${rest[0]}" (head, thorax, abdomen, left/right arm, left/right leg)`);
        const dmg = Math.abs(Number(rest[1])) || 0;
        if (dmg) damagePart(target, def.id, dmg);
        const added = [];
        for (const tok of rest.slice(2)) {
            const type = Object.keys(WOUND_TYPES).find(k => k.startsWith(norm(tok)) || norm(WOUND_TYPES[k].name).startsWith(norm(tok)));
            if (type && addWound(target, def.id, type)) added.push(WOUND_TYPES[type].name.toLowerCase());
        }
        syncHealth(target);
        return `${target === st.captain ? '' : `${target.name}: `}${def.name} -${dmg}${added.length ? ` (${added.join(', ')})` : ''}${isDown(target) ? ' (DOWN)' : ''}`;
    },
    eat(st) {
        const pc = st.captain;
        const food = pc.inventory.find(i => /ration|meal|food/i.test(i.name) && i.qty > 0);
        if (food) { food.qty--; if (food.qty <= 0) pc.inventory.splice(pc.inventory.indexOf(food), 1); }
        else if (st.ship && st.ship.supplies >= 0.34 && !st.loc.docked) st.ship.supplies -= 0.34;
        else if (st.ship && st.ship.supplies >= 0.34) st.ship.supplies -= 0.34;
        else if (st.transit?.passenger) { /* meals are part of the fare */ }
        else throw new Error('nothing to eat: no rations and no ship stores');
        advanceTime(15);
        adjust(pc.needs, 'nourishment', 45, 0, 100);
        return `Ate a meal (${food ? food.name : st.transit?.passenger ? 'galley' : 'ship stores'})`;
    },
    drink(st) {
        const pc = st.captain;
        const water = pc.inventory.find(i => /water|flask|drink|canteen/i.test(i.name) && i.qty > 0);
        if (st.ship && st.ship.supplies > 0.05) st.ship.supplies -= 0.05;
        else if (st.transit?.passenger || st.loc.docked) { /* taps on a station or transport */ }
        else if (water) { water.qty--; if (water.qty <= 0) pc.inventory.splice(pc.inventory.indexOf(water), 1); }
        else throw new Error('nothing to drink');
        advanceTime(5);
        adjust(pc.needs, 'hydration', 50, 0, 100);
        return 'Drank';
    },
    sleep(st, [v = '8h']) {
        if (st.combat) throw new Error('not during a fight');
        const mins = clamp(parseDuration(v), 10, 12 * 60);
        if (!Number.isFinite(mins)) throw new Error(`"${v}" is not a duration`);
        advanceTime(mins, { asleep: true });
        adjust(st.captain, 'stress', -mins / 30, 0, 100);
        return `Slept ${fmtDuration(mins)}`;
    },
    wash(st) {
        if (!st.ship && !st.loc.docked && !st.transit) throw new Error('nowhere to wash here');
        advanceTime(20);
        adjust(st.captain.needs, 'hygiene', 85, 0, 100);
        adjust(st.captain.needs, 'morale', 3, 0, 100);
        return 'Washed';
    },
    relax(st, [v = '1h']) {
        if (st.combat) throw new Error('not during a fight');
        const mins = clamp(parseDuration(v), 10, 6 * 60);
        advanceTime(mins);
        adjust(st.captain, 'stress', -(mins / 60) * 12, 0, 100);
        adjust(st.captain.needs, 'morale', (mins / 60) * 6, 0, 100);
        return `Unwound for ${fmtDuration(mins)}`;
    },
    stress(st, [v]) {
        const d = parseDelta(v);
        if (d && !d.set && d.v > 0) v = `+${Math.round(d.v * stressMult(st.captain) * 10) / 10}`;
        return `Stress ${applyDelta(st.captain, 'stress', v, 0, 100)}`;
    },
    craving(st, [v]) { return `Craving ${applyDelta(st.captain, 'craving', v, 0, 100)}`; },
    debt(st, [v]) { return `Debt ${applyDelta(st.captain, 'debt', v, 0, 1e12)}`; },
    xp(st, args) {
        const target = args.length > 2 ? who(st, args[0]) : st.captain;
        if (!target) throw new Error(`nobody called "${args[0]}"`);
        const [name, v] = args.slice(-2);
        const def = findSkill(name);
        if (!def) throw new Error(`unknown skill "${name}"`);
        const amount = Math.abs(Number(String(v).replace('+', ''))) || 0;
        const lv = gainXp(target, def.id, amount);
        if (lv) addLog(`${target.name}: ${def.name} improved to ${target.skills[def.id]}.`, 'sys');
        return `${target === st.captain ? '' : `${target.name} `}${def.name} +${amount} XP${lv ? ` (now level ${target.skills[def.id]})` : ''}`;
    },
    attr(st, [name, v]) {
        const a = ATTRIBUTES.find(x => x.id === norm(name) || norm(x.name).startsWith(norm(name)));
        if (!a) throw new Error(`unknown attribute "${name}"`);
        const out = applyDelta(st.captain.attrs, a.id, v, 1, 10);
        refreshDerived(st.captain);
        return `${a.name} ${out}`;
    },
    check(st, args) {
        const target = args.length > 2 ? who(st, args[0]) : st.captain;
        if (!target) throw new Error(`nobody called "${args[0]}"`);
        const [name, dcTok = '12'] = args.length > 2 ? args.slice(1) : args;
        const def = findSkill(name);
        if (!def) throw new Error(`unknown skill "${name}"`);
        const named = CHECK_DCS.find(x => norm(x.name).startsWith(norm(dcTok)));
        const dc = named?.dc ?? (Number(dcTok) || 12);
        const r = skillCheck(target, def.id, dc);
        const text = describeCheck(target, r);
        addLog(text + (r.levels ? ` ${def.name} improved to ${target.skills[def.id]}.` : ''), 'check');
        st.lastCheck = { ...r, who: target.name, text };
        return text;
    },
    cyber(st, [op, name]) {
        const c = findByName(CYBERWARE, name) ?? CYBERWARE.find(x => x.id === norm(name));
        if (!c) throw new Error(`unknown cyberware "${name}"`);
        const sh = st.captain;
        if (/^(add|install|\+)$/i.test(op)) {
            if (sh.cyber.includes(c.id)) throw new Error(`${c.name} is already installed`);
            if (cyberLoad(sh) + c.load > cyberCapacity(sh)) throw new Error(`not enough capacity for ${c.name} (load ${c.load})`);
            sh.cyber.push(c.id);
            refreshDerived(sh);
            return `Cyberware installed: ${c.name}`;
        }
        if (/^(remove|-)$/i.test(op)) {
            sh.cyber = sh.cyber.filter(x => x !== c.id);
            refreshDerived(sh);
            return `Cyberware removed: ${c.name}`;
        }
        throw new Error('use: cyber add|remove "Name"');
    },
    die(st, args) {
        killPlayer(args.join(' '));
        return `${st.captain.name} has died`;
    },
    checkpoint(st, args) {
        const cp = saveCheckpoint(args.join(' ') || 'Checkpoint');
        if (!cp) throw new Error('cannot save now');
        return `Checkpoint saved: ${cp.label}`;
    },
    radiation(st, [v]) { return `Radiation ${applyDelta(st.captain, 'radiation', v, 0, 1000)}`; },
    time(st, [v]) {
        const mins = parseDuration(v);
        if (!Number.isFinite(mins)) throw new Error(`"${v}" is not a duration`);
        advanceTime(mins);
        return `Time ${mins >= 0 ? '+' : ''}${Math.round(mins / 6) / 10}h`;
    },
    need(st, [name, v]) {
        const n = findByName(NEEDS, name) ?? NEEDS.find(x => x.id.startsWith(norm(name)));
        if (!n) throw new Error(`unknown need "${name}"`);
        return `${n.name} ${applyDelta(st.captain.needs, n.id, v, 0, 100)}`;
    },
    skill(st, [name, v]) {
        const def = findSkill(name);
        if (!def) throw new Error(`unknown skill "${name}"`);
        return `${def.name} ${applyDelta(st.captain.skills, def.id, v, 0, 10)}`;
    },
    system(st, [name, v]) {
        const sys = findByName(SHIP_SYSTEMS, name) ?? SHIP_SYSTEMS.find(x => x.id.startsWith(norm(name)));
        if (!sys) throw new Error(`unknown ship system "${name}"`);
        return `${sys.name} ${applyDelta(needShip(st).systems, sys.id, v, 0, 100)}%`;
    },
    location(st, [place]) {
        st.loc.place = place ?? '';
        if (place) st.loc.docked = false;
        return `Location: ${place || 'cleared'}`;
    },
    dock(st, [name]) {
        if (st.transit) throw new Error('cannot dock while in jump transit');
        const sys = galaxy().systems[st.loc.system];
        const i = name ? sys.stations.findIndex(s => norm(s.name).includes(norm(name))) : 0;
        st.loc.station = i >= 0 ? i : 0;
        st.loc.docked = true;
        st.loc.place = i < 0 && name ? `Docked: ${name}` : '';
        return `Docked at ${i >= 0 ? sys.stations[st.loc.station].name : name}`;
    },
    undock(st) {
        st.loc.docked = false;
        st.loc.place = '';
        return 'Undocked';
    },
    jump(st, [name]) {
        const sys = findByName(galaxy().systems, name);
        if (!sys) throw new Error(`unknown star system "${name}"`);
        st.transit = null;
        st.loc = { system: sys.id, station: 0, docked: false, place: '' };
        st.visited[sys.id] = true;
        st.route = [];
        return `Arrived in ${sys.name}`;
    },
    cargo(st, [op, name, qty = '1', price]) {
        const n = Math.max(1, Math.round(Number(qty)) || 1);
        if (/^(add|\+|load|gain)$/i.test(op)) {
            const free = cargoCap(st) - cargoUsed(st);
            const take = Math.min(n, Math.max(0, free));
            if (take <= 0) throw new Error('cargo hold is full');
            const known = findByName(COMMODITIES, name);
            addStack(st.cargo, known?.name ?? name, take, { comId: known?.id ?? null, paid: Number(price) || 0 });
            return `Cargo +${take} ${known?.name ?? name}`;
        }
        if (/^(remove|-|unload|lose|sell)$/i.test(op)) {
            const { it, taken } = removeStack(st.cargo, name, n);
            return `Cargo -${taken} ${it.name}`;
        }
        throw new Error('use: cargo add|remove "Name" qty');
    },
    item(st, [op, name, qty = '1']) {
        const n = Math.max(1, Math.round(Number(qty)) || 1);
        if (/^(add|\+|gain)$/i.test(op)) {
            addStack(st.captain.inventory, name, n);
            return `Item +${n} ${name}`;
        }
        if (/^(remove|-|lose|use)$/i.test(op)) {
            const { it, taken } = removeStack(st.captain.inventory, name, n);
            return `Item -${taken} ${it.name}`;
        }
        throw new Error('use: item add|remove "Name" qty');
    },
    injury(st, [op, name, severity = 'minor']) {
        if (/^(add|\+)$/i.test(op)) {
            const sev = Object.keys(INJURY_SEVERITY).find(k => k.startsWith(norm(severity))) ?? 'minor';
            st.captain.injuries.push({ id: uid('inj'), name, severity: sev, since: st.minutes });
            return `Injury: ${name} (${sev})`;
        }
        if (/^(heal|remove|-)$/i.test(op)) {
            const inj = findByName(st.captain.injuries, name);
            if (!inj) throw new Error(`no injury "${name}"`);
            st.captain.injuries.splice(st.captain.injuries.indexOf(inj), 1);
            return `Healed: ${inj.name}`;
        }
        throw new Error('use: injury add|heal "Name" [severity]');
    },
    rep(st, [name, v]) {
        const f = findByName(FACTIONS, name) ?? FACTIONS.find(x => x.id === norm(name));
        const key = f?.id ?? name;
        const out = applyDelta(st.reputation, key, v, -100, 100);
        return `Reputation ${f?.name ?? name} ${out}`;
    },
    mission(st, [op, title, ...rest]) {
        if (/^(add|new|\+)$/i.test(op)) {
            const m = { id: uid('ms'), title, status: 'active', reward: 0, giver: '', notes: '', added: st.minutes };
            for (let i = 0; i < rest.length - 1; i += 2) {
                if (/^reward$/i.test(rest[i])) m.reward = Number(String(rest[i + 1]).replace(/,/g, '')) || 0;
                if (/^giver$/i.test(rest[i])) m.giver = rest[i + 1];
                if (/^notes?$/i.test(rest[i])) m.notes = rest[i + 1];
            }
            st.missions.push(m);
            return `Mission added: ${title}`;
        }
        const m = findByName(st.missions.filter(x => x.status === 'active'), title, 'title') ?? findByName(st.missions, title, 'title');
        if (!m) throw new Error(`no mission "${title}"`);
        if (/^(done|complete|completed)$/i.test(op)) {
            m.status = 'done';
            if (m.reward) st.captain.credits += m.reward;
            return `Mission complete: ${m.title}${m.reward ? ` (+${m.reward} cr)` : ''}`;
        }
        if (/^(fail|failed)$/i.test(op)) { m.status = 'failed'; return `Mission failed: ${m.title}`; }
        if (/^(remove|drop)$/i.test(op)) { st.missions.splice(st.missions.indexOf(m), 1); return `Mission dropped: ${m.title}`; }
        throw new Error('use: mission add|done|fail|drop "Title"');
    },
    crew(st, [op, name, role = 'Crew']) {
        if (/^(add|hire|\+)$/i.test(op)) {
            st.crew.push(makeNpcSheet(name, role));
            return `Crew joined: ${name} (${role})`;
        }
        if (/^(remove|fire|lose|-)$/i.test(op)) {
            const c = findByName(st.crew, name);
            if (!c) throw new Error(`no crew member "${name}"`);
            st.crew.splice(st.crew.indexOf(c), 1);
            return `Crew left: ${c.name}`;
        }
        throw new Error('use: crew add|remove "Name" "Role"');
    },
    contact(st, [name, v, ...note]) {
        let c = findByName(st.contacts, name);
        if (!c) { c = { id: uid('ct'), name, standing: 0, notes: '' }; st.contacts.push(c); }
        const d = parseDelta(v);
        if (d) applyDelta(c, 'standing', v, -100, 100);
        else if (v) c.notes = [v, ...note].join(' ');
        return `Contact ${c.name}: standing ${c.standing}`;
    },
    tracker(st, [name, v, maxKw, maxV]) {
        let t = findByName(st.trackers, name);
        if (!t) { t = { id: uid('tr'), name, value: 0, max: 100 }; st.trackers.push(t); }
        if (/^max$/i.test(maxKw) && Number(maxV) > 0) t.max = Number(maxV);
        const out = v !== undefined ? applyDelta(t, 'value', v, 0, t.max) : '';
        return `${t.name} ${out} (${t.value}/${t.max})`;
    },
    alert(st, [level = 'green']) {
        const l = ['green', 'yellow', 'red'].find(x => x.startsWith(norm(level))) ?? (/off|clear|none/i.test(level) ? 'green' : null);
        if (!l) throw new Error('use: alert green|yellow|red');
        st.alert = l;
        return `Alert status: ${l}`;
    },
    log(st, args) {
        const text = args.join(' ');
        addLog(text, 'story');
        return `Log: ${text}`;
    },
};

const ALIASES = {
    credit: 'credits', cr: 'credits', money: 'credits',
    shield: 'shields', hp: 'health', rad: 'radiation',
    needs: 'need', loc: 'location', place: 'location',
    inventory: 'item', items: 'item', quest: 'mission', party: 'crew', companion: 'crew', death: 'die', save: 'checkpoint', roll: 'check', implant: 'cyber', attribute: 'attr', missions: 'mission',
    reputation: 'rep', faction: 'rep', damage: 'system', subsystem: 'system',
    arrive: 'jump', travel: 'jump', nap: 'sleep', shower: 'wash', injure: 'wound', track: 'tracker', supply: 'supplies',
};
// Needs can be addressed directly: "rest +30", "morale -10".
for (const n of NEEDS) {
    COMMANDS[n.id] = (st, [v]) => COMMANDS.need(st, [n.id, v]);
}
ALIASES.hunger = 'nourishment';
ALIASES.food = 'nourishment';
ALIASES.thirst = 'hydration';
ALIASES.fatigue = 'rest';

export function registerCommand(name, handler, aliases = []) {
    COMMANDS[name] = handler;
    for (const a of aliases) ALIASES[a] = name;
}

export function tokenize(line) {
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|“([^”]*)”|(\S+)/g;
    let m;
    while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
    return out;
}

/** Runs one command line such as `credits -200`. Returns { ok, text }. */
export function runCommand(line) {
    const st = S();
    if (!st) return { ok: false, text: 'No campaign in this chat' };
    const toks = tokenize(line.replace(/[:=](?=\s)/, ' '));
    if (!toks.length) return { ok: false, text: '' };
    let verb = toks[0].toLowerCase().replace(/:$/, '');
    verb = ALIASES[verb] ?? verb;
    const fn = COMMANDS[verb];
    if (!fn) return { ok: false, text: `Unknown command "${toks[0]}"` };
    try {
        return { ok: true, text: fn(st, toks.slice(1)) };
    } catch (e) {
        return { ok: false, text: `${verb}: ${e.message}` };
    }
}

/** Runs a block of commands separated by newlines or semicolons. */
export function runBlock(block) {
    const results = [];
    for (const line of String(block).split(/[\n;]+/)) {
        const t = line.trim();
        if (!t) continue;
        results.push(runCommand(t));
    }
    return results;
}

/** Status words derived from needs, e.g. ["hungry", "exhausted"]. */
export function needStatuses(st = S()) {
    const out = [];
    if (!st) return out;
    for (const n of NEEDS) {
        const v = st.captain.needs[n.id];
        if (v <= 15) out.push(n.crit);
        else if (v <= 35) out.push(n.low);
    }
    if (isDown(st.captain)) out.unshift('DOWNED');
    else if (isBleeding(st.captain)) out.unshift('bleeding');
    if ((st.captain.craving ?? 0) >= 70) out.push('craving');
    if (st.captain.stress >= 80) out.push('breaking point');
    else if (st.captain.stress >= 55) out.push('stressed');
    return out;
}
