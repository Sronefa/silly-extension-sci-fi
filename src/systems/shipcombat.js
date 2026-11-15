// Ship combat. A 2D plot resolved in simultaneous 30-second pulses: everyone's standing orders
// play out together. Ships are built from hull classes, mounts and rooms, so the same rules
// carry a single-seat fighter and a capital ship; size decides how fast a ship answers orders.
import { S, addLog } from '../core/state.js';
import { uid, clamp, norm } from '../core/util.js';
import { SIZES, SC_WEAPONS, ARCS, ROOMS, VESSELS, VESSEL_ALIASES, POSTS, THROTTLES, POWER_PRESETS, PULSE_SECONDS, sensorGrade, boardingPods, LOADS, loadsFor, MASS } from '../data/vessels.js';
import { startCombat, parseEnemies } from './combat.js';
import { skillOf, gainXp, skillCheck } from './character.js';
import { applyHit, randomPart, isDead } from './body.js';
import { advanceTime, killPlayer } from './sim.js';
import { effectiveClass } from './refit.js';

const rnd = Math.random;
const chance = (p) => rnd() < p;
const pickOne = (arr) => arr[Math.floor(rnd() * arr.length)];
const rad = (d) => d * Math.PI / 180;

export const SC = () => S()?.shipCombat ?? null;
/** A ship's class. The player's own refitted ship carries its own copy. */
export const clsOf = (s) => s.own ?? VESSELS[s.cls];
export const sizeOf = (s) => SIZES[clsOf(s).size];
export const shipById = (id, sc = SC()) => sc?.ships.find(s => s.id === id) ?? null;
export const playerShip = (sc = SC()) => shipById(sc?.playerShip, sc);
export const isActive = (s) => s.state === 'active';
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** Compass bearing from a to b: 0 is up the plot, clockwise. */
export const bearing = (a, b) => (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI + 360) % 360;
export const angDiff = (a, b) => ((a - b + 540) % 360) - 180;

// ---------------------------------------------------------------------------------------
// Who the player is aboard
// ---------------------------------------------------------------------------------------

export function resolveClass(word) {
    const n = norm(word);
    if (!n) return null;
    if (VESSELS[n]) return VESSELS[n];
    if (VESSEL_ALIASES[n]) return VESSELS[VESSEL_ALIASES[n]];
    const direct = Object.values(VESSELS).find(v => (n.length >= 4 && norm(v.name).includes(n)) || norm(v.role) === n);
    if (direct) return direct;
    const alias = Object.entries(VESSEL_ALIASES).find(([k]) => n.includes(k));
    return alias ? VESSELS[alias[1]] : null;
}

/**
 * The player's station: which vessel they serve on and in what capacity. Owning a ship makes
 * you its captain, flying a single-seat craft makes you its pilot, and the `post` command covers
 * everything else (an officer on someone else's warship, a passenger on a liner).
 */
export function playerPost(st = S()) {
    if (!st) return null;
    const p = st.post;
    if (p?.role && POSTS[p.role]) {
        if (p.classId && VESSELS[p.classId]) return { role: p.role, shipName: p.ship || VESSELS[p.classId].name, classId: p.classId, own: false };
        if (st.ship) return { role: p.role, shipName: st.ship.name, classId: st.ship.classId, own: true };
        if (st.craft.length) return { role: p.role, shipName: st.craft[0].name, classId: st.craft[0].classId, craft: st.craft[0].id };
    }
    if (st.ship) return { role: 'captain', shipName: st.ship.name, classId: st.ship.classId, own: true };
    if (st.craft.length) return { role: 'pilot', shipName: st.craft[0].name, classId: st.craft[0].classId, craft: st.craft[0].id };
    return null;
}
export const clearance = (st = S()) => POSTS[playerPost(st)?.role]?.clearance ?? 0;
/** May the player touch this domain (helm, weapons, engineering, sensors, command, fleet) right now? */
export function may(domain, sc = SC()) {
    if (!sc || sc.over) return false;
    const ps = playerShip(sc);
    if (!ps || !isActive(ps)) return false;
    return POSTS[sc.role]?.can.includes(domain) ?? false;
}

// ---------------------------------------------------------------------------------------
// Building ships
// ---------------------------------------------------------------------------------------

function makeShip(classId, { name, side, x, y, heading, crewQ = 3, morale = 0.5 }) {
    const cls = typeof classId === 'object' ? classId : VESSELS[classId];
    const rooms = {};
    for (const id of cls.rooms) {
        const max = Math.round(cls.hull * ROOMS[id].share * 0.6) + 10;
        rooms[id] = { hp: max, max, fire: false };
    }
    return {
        id: uid('v'), name: name || cls.name, cls: cls.id, side, x, y, heading, speed: 0,
        want: { heading, throttle: cls.speed ? 2 : 0 }, queue: [],
        hull: cls.hull, maxHull: cls.hull, armor: [...cls.armor], shield: cls.shield, maxShield: cls.shield, shieldDown: 0,
        heat: 0, rooms, weapons: cls.mounts.map((mt, n) => ({ n, id: mt.id, arc: mt.arc, ammo: SC_WEAPONS[mt.id].ammo ?? null, on: !SC_WEAPONS[mt.id].nuclear, out: false, cd: 0, load: 'ap' })),
        power: 'balanced', radar: true, jam: false, decoys: cls.decoys ?? 0, decoyUp: 0, evasive: false, overload: false,
        target: null, called: '', missiles: true, dc: [], crewQ, morale, casualties: 0,
        state: 'active', warp: null, fleet: null, hot: false, lostFor: 0,
        // The officers at each station. How good they are decides how fast and how well orders are carried out.
        officers: Object.fromEntries(['helm', 'weapons', 'sensors', 'engineering'].map(d => [d, clamp(crewQ + Math.floor(rnd() * 3) - 1, 1, 8)])),
        pods: boardingPods(cls) + (cls.extraPods ?? 0), ...(cls.custom ? { own: cls } : {}),
    };
}

function parseGroups(tokens) {
    const sides = { enemy: [], ally: [] };
    let side = 'enemy';
    let flags = { ambush: false, surprise: false };
    for (const tok of tokens) {
        if (/^(allies|ally|with|friendly|friendlies|escort|escorts)$/i.test(tok)) { side = 'ally'; continue; }
        if (/^(enemies|enemy|hostiles|against|vs)$/i.test(tok)) { side = 'enemy'; continue; }
        if (/^(ambush|ambushed)$/i.test(tok)) { flags.ambush = true; continue; }
        if (/^(surprise|surprised)$/i.test(tok)) { flags.surprise = true; continue; }
        const list = sides[side];
        const xm = /^x?(\d+)$/i.exec(tok);
        if (xm && list.length) { list[list.length - 1].count = clamp(Number(xm[1]), 1, 12); continue; }
        const cls = resolveClass(tok);
        if (cls) list.push({ cls: cls.id, name: null, count: 1 });
        else if (list.length && !list[list.length - 1].name && list[list.length - 1].count === 1) list[list.length - 1].name = tok; // quoted ship name after its class
        else list.push({ cls: 'raider', name: tok, count: 1 });
    }
    return { ...sides, ...flags };
}

const LETTERS = 'ABCDEFGHJKLMNP';

export function startShipCombat({ scene = 'Open space', enemy = [], ally = [], ambush = false, surprise = false } = {}) {
    const st = S();
    if (!st || st.dead) throw new Error('no living character');
    if (st.shipCombat) throw new Error('a space battle is already in progress');
    if (st.combat) throw new Error('a fight on foot is in progress');
    if (!enemy.length) throw new Error('no enemy vessels given');
    let post = playerPost(st);
    // Someone with no vessel and no post is aboard whatever is carrying them: a passenger.
    if (!post) post = { role: 'passenger', shipName: 'the transport', classId: 'liner', own: false };
    const sep = ambush ? 420 : surprise ? 900 : 1700;
    const ships = [];
    const pcls = (post.own && st.ship ? effectiveClass(st) : null) ?? VESSELS[post.classId] ?? VESSELS.mule;
    const me = makeShip(pcls.custom ? pcls : pcls.id, { name: post.shipName, side: 'ally', x: 0, y: sep / 2, heading: 0, crewQ: 3, morale: 0.2 });
    me.isPlayer = true;
    if (post.own && st.ship) {
        // The player's own ship arrives in whatever state it is really in.
        me.hull = Math.max(1, Math.round(me.maxHull * clamp(st.ship.hull / st.ship.maxHull, 0.05, 1)));
        me.shield = Math.round(me.maxShield * clamp(st.ship.shields / st.ship.maxShields, 0, 1));
        const map = { reactor: 'reactor', engines: 'drives', shields: 'shields', sensors: 'sensors', lifesupport: 'lifesupport' };
        for (const [sysId, roomId] of Object.entries(map)) if (me.rooms[roomId]) me.rooms[roomId].hp = Math.round(me.rooms[roomId].max * clamp((st.ship.systems[sysId] ?? 100) / 100, 0, 1));
        for (const w of me.weapons) { const saved = st.ship.scAmmo?.[`${w.n}:${w.id}`]; if (saved != null && w.ammo != null) w.ammo = saved; }
    }
    ships.push(me);
    let col = 1;
    const place = (g, side) => {
        for (let i = 0; i < g.count; i++) {
            const cls = VESSELS[g.cls];
            const many = g.count > 1;
            const name = g.name ? (many ? `${g.name} ${LETTERS[i]}` : g.name) : `${cls.name}${many || ships.some(s => s.cls === cls.id && s.side === side) ? ` ${LETTERS[ships.filter(s => s.cls === cls.id && s.side === side).length]}` : ''}`;
            let name2 = name;
            for (let k = 0; ships.some(q => q.name === name2) && k < LETTERS.length; k++) name2 = `${g.name ?? cls.name} ${LETTERS[k]}`;
            const lateral = (col % 2 ? 1 : -1) * Math.ceil(col / 2) * (cls.size >= 4 ? 320 : 170);
            col++;
            const s = makeShip(cls.id, {
                name: name2, side, x: lateral + (rnd() - 0.5) * 60, y: (side === 'ally' ? 1 : -1) * (sep / 2 + rnd() * 120),
                heading: side === 'ally' ? 0 : 180, crewQ: cls.pirate ? 2 + Math.floor(rnd() * 2) : 3 + Math.floor(rnd() * 2), morale: cls.pirate ? 0.45 : cls.doctrine === 'civilian' ? 0.7 : 0.2,
            });
            ships.push(s);
            for (const w of cls.wing ?? []) {
                const wc = VESSELS[w];
                ships.push(makeShip(wc.id, { name: `${wc.name} ${LETTERS[ships.filter(q => q.cls === wc.id && q.side === side).length]}`, side, x: s.x + (rnd() - 0.5) * 200, y: s.y + (side === 'ally' ? -120 : 120), heading: s.heading, crewQ: 3, morale: 0.3 }));
            }
        }
    };
    for (const g of ally) place(g, 'ally');
    col = 0;
    for (const g of enemy) place(g, 'enemy');
    const sc = {
        scene, pulse: 0, ships, missiles: [], log: [], playerShip: me.id, role: post.role, own: !!post.own, craft: post.craft ?? null,
        mines: [], tracks: { ally: {}, enemy: {} }, hail: null, hailed: false, over: null, prevAlert: st.alert, playerAct: null, stats: { fired: 0, hits: 0 },
    };
    if (ambush) { for (const s of ships.filter(x => x.side === 'enemy')) { s.radar = false; s.want.throttle = 1; } }
    if (surprise) { me.radar = false; }
    st.shipCombat = sc;
    st.lastShipCombat = null;
    st.alert = 'red';
    say(sc, `Battle stations. ${scene}.`, 'sys', true);
    updateTracks(sc, true);
    if (ambush) say(sc, 'Hostile contacts close aboard, they were running dark!', 'warn', true);
    addLog(`Space battle: ${scene}.`, 'combat');
    return sc;
}

export function startShipCombatFromTokens(tokens) {
    const scene = tokens[0] && !resolveClass(tokens[0]) && !/^\d+$/.test(tokens[0]) ? tokens[0] : 'Open space';
    const rest = scene === tokens[0] ? tokens.slice(1) : tokens;
    const g = parseGroups(rest);
    const sc = startShipCombat({ scene, ...g });
    const n = sc.ships.filter(s => s.side === 'enemy').length;
    return `Space battle at ${scene}: ${n} hostile vessel${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------------------
// Derived numbers
// ---------------------------------------------------------------------------------------

function say(sc, text, kind = 'info', felt = false) {
    sc.log.push({ p: sc.pulse, text, kind, felt });
    if (sc.log.length > 400) sc.log.splice(0, sc.log.length - 400);
}
const feltBy = (sc, s) => s.id === sc.playerShip;

export const roomPct = (s, id) => (s.rooms[id] ? clamp(s.rooms[id].hp / s.rooms[id].max, 0, 1) : 1);
const powered = (s) => roomPct(s, 'reactor') > 0;
export const power = (s) => {
    const p = POWER_PRESETS[s.power] ?? POWER_PRESETS.balanced;
    const out = (0.5 + 0.5 * roomPct(s, 'reactor')) * (s.overload ? 1.3 : 1);
    return { eng: p.eng * out, shd: p.shd * out, wpn: p.wpn * out };
};
export const topSpeed = (s) => (powered(s) ? clsOf(s).speed * power(s).eng * (roomPct(s, 'drives') > 0 ? 0.3 + 0.7 * roomPct(s, 'drives') : 0) : 0);
export const turnRate = (s) => (powered(s) ? sizeOf(s).turn * (roomPct(s, 'drives') > 0 ? 0.4 + 0.6 * roomPct(s, 'drives') : 0) * Math.min(1.2, power(s).eng) : 0);
export const sensorRange = (s) => (powered(s) ? clsOf(s).sensors * (0.15 + 0.85 * roomPct(s, 'sensors')) * (s.radar ? 1 : 0.4) * (s.blind > 0 ? 0.25 : 1) : 0);
export function signature(s) {
    const t = s.want.throttle;
    let sig = (s.sigAs ?? sizeOf(s).sig) * (clsOf(s).sigMult ?? 1);
    sig *= s.radar ? 1.4 : 1;
    sig *= t >= 4 ? 1.5 : t >= 3 ? 1.25 : t <= 1 ? 0.75 : 1;
    sig *= 1 + 0.6 * clamp(s.heat / clsOf(s).heat, 0, 1.2);
    if (s.jam) sig *= 1.3;
    if (!s.radar && t <= 1 && !s.hot) sig *= 0.5; // running dark
    if (Object.values(s.rooms).some(r => r.fire)) sig *= 1.2;
    return sig;
}
export const dcTeams = (s) => Math.max(0, sizeOf(s).dcTeams + (clsOf(s).dcBonus ?? 0) - (s.casualties > clsOf(s).crew * 0.5 ? 1 : 0));
/** Pulses an emergency jump needs to spool: bigger drives take longer. */
export const warpSpool = (s) => Math.max(2, 3 + clsOf(s).size + (clsOf(s).spool ?? 0));
export const overheated = (s) => s.heat >= clsOf(s).heat;
/** The tether holding this ship, if someone has a grapple in her. */
export const tetherOn = (s, sc = SC()) => sc?.tethers?.find(t => t.b === s.id) ?? null;
/** Has this side seen through a decoy drone yet? */
export const masked = (sc, side, t) => !!t.mimic && !sc.unmasked?.[side]?.[t.id];
/** The class a ship appears to be to the other side: a decoy drone answers as its parent. */
export const shownAs = (sc, side, t) => (masked(sc, side, t) ? clsOf(shipById(t.mimic, sc) ?? t) : clsOf(t));

/** The skill level working one station of a ship: the player's own when they hold it. */
export function quality(sc, s, domain) {
    if (s.id === sc.playerShip && POSTS[sc.role]?.can.includes(domain)) {
        const cap = S()?.captain;
        if (cap) {
            const cls = clsOf(s);
            const skill = domain === 'helm' ? (cls.mech ? 'mech' : 'pilot') : domain === 'weapons' ? 'gunnery' : domain === 'engineering' ? 'engineering' : 'electronics';
            let q = skillOf(cap, skill);
            // A combat frame is beyond anyone who has not put the years in.
            if (cls.minSkill && (domain === 'helm' || domain === 'weapons')) q -= Math.max(0, cls.minSkill - skillOf(cap, 'mech')) * 2;
            return q;
        }
    }
    return s.officers?.[domain] ?? s.crewQ;
}

const DOMAIN = {
    heading: 'helm', throttle: 'helm', evasive: 'helm',
    target: 'weapons', weapon: 'weapons', missiles: 'weapons', called: 'weapons',
    load: 'weapons', mine: 'weapons', ram: 'helm', sand: 'sensors', decoydrone: 'sensors', cut: 'engineering',
    radar: 'sensors', jam: 'sensors', decoy: 'sensors',
    power: 'engineering', overload: 'engineering', dc: 'engineering', warp: 'engineering',
};

/**
 * Seconds a station needs to carry out an order. The base depends on the ship's size and on the
 * station (a sensor officer flips a switch, a gunnery officer has to work a solution, the helm
 * has to move the whole ship); a good officer does it in half the time, a poor one takes longer.
 */
export function orderSeconds(sc, s, domain, { jitter = false } = {}) {
    if (domain === 'fleet') return 30;
    const base = sizeOf(s).delay[domain] ?? 0;
    if (!base) return 0;
    let t = base * clamp(1.6 - quality(sc, s, domain) * 0.15, 0.45, 1.9);
    if ((domain === 'helm' || domain === 'sensors') && s.rooms.bridge && s.rooms.bridge.hp <= 0) t *= 2;
    if (domain === 'weapons' && s.rooms.cic && s.rooms.cic.hp <= 0) t *= 2;
    if (domain === 'engineering' && s.rooms.reactor?.fire) t *= 1.5;
    if (s.casualties > clsOf(s).crew * 0.4) t *= 1.3;
    if (jitter) t *= 0.85 + rnd() * 0.3;
    return Math.round(t);
}
export const helmDelay = (s, sc = SC()) => Math.round(orderSeconds(sc, s, 'helm') / PULSE_SECONDS);
export const fireDelay = (s, sc = SC()) => Math.round(orderSeconds(sc, s, 'weapons') / PULSE_SECONDS);

function inArc(s, w, target) {
    // A strike craft can bring its nose onto anything within one pulse; the pass itself is abstracted.
    if (turnRate(s) >= 120) return true;
    const rel = (angDiff(bearing(s, target), s.heading) + 360) % 360;
    return ARCS[w.arc].some(([c, half]) => Math.abs(angDiff(rel, c)) <= half);
}

export function evasionOf(sc, t) {
    const cls = clsOf(t);
    if (!cls.speed || !isActive(t)) return 0;
    if (cls.decoy) return 4;
    if (tetherOn(t, sc)) return Math.round(sizeOf(t).evasion * 0.2);
    const frac = clamp(t.speed / cls.speed, 0, 1.3);
    return Math.round((sizeOf(t).evasion * frac * (0.4 + 0.6 * roomPct(t, 'drives')) + (t.evasive ? 12 * frac : 0) + quality(sc, t, 'helm') * 1.5 * frac) * (cls.agile ?? 1));
}

/** Why a weapon cannot fire at a target right now, or '' when it can. */
export function weaponBlock(sc, s, w, t) {
    const def = SC_WEAPONS[w.id];
    if (w.out) return 'destroyed';
    if (!powered(s)) return 'no power';
    if (!t) return 'no target';
    const track = sc.tracks[s.side][t.id] ?? 0;
    if (track < 2) return 'no track';
    if (def.kind !== 'missile' && track < 3 && dist(s, t) > 150) return 'needs a firing solution';
    if (w.ammo !== null && w.ammo <= 0) return 'out of ammunition';
    if (def.kind === 'beam' && s.heatLock) return 'overheated';
    if (dist(s, t) > def.range) return 'out of range';
    if (def.kind === 'grapple') {
        if (clsOf(t).size < 2) return 'target too small to grapple';
        if (t.shield > 0 && t.shieldDown <= 0) return 'target shields are up';
        if (tetherOn(t, sc)) return 'target already held';
    }
    if (!inArc(s, w, t)) return 'out of arc';
    if (w.cd > 0) return def.fixed ? `charging, ${w.cd * PULSE_SECONDS} s` : 'cycling';
    return '';
}

export function hitChance(sc, s, w, t) {
    const def = SC_WEAPONS[w.id];
    const d = dist(s, t);
    const tsize = t.mimic ? clsOf(shipById(t.mimic, sc) ?? t).size : clsOf(t).size;
    let c = def.acc + quality(sc, s, 'weapons') * 3 - 30 * (d / def.range);
    c += tsize <= 2 ? def.track - (tsize === 1 ? 10 : 0) : (tsize - 2) * 6;
    c -= evasionOf(sc, t);
    if ((sc.tracks[s.side][t.id] ?? 0) < 3) c -= 20;
    if (s.heat > clsOf(s).heat * 0.8) c -= 10;
    if (s.evasive) c -= 15;
    if (s.called) c -= 15;
    const load = LOADS[w.load];
    if (def.kind === 'kinetic' && load?.craft && tsize === 1) c += load.craft;
    // Plasma bolts are slow: anything that can move gets out of the way.
    if (def.slow) c -= evasionOf(sc, t) * 1.5 + 25 * (d / def.range) + (tsize <= 2 ? 20 : 0);
    if (def.improvised) c -= 5;
    if (def.kind === 'beam' && (s.sandUp > 0 || t.sandUp > 0)) c -= 12;
    if (def.kind === 'grapple') c += (clsOf(t).size - 2) * 8 - (t.speed > 0 ? 10 * clamp(t.speed / (clsOf(t).speed || 1), 0, 1) : 0);
    c += (power(s).wpn - 1) * 12;
    if (s.rooms.cic && s.rooms.cic.hp <= 0) c -= 12;
    return clamp(Math.round(c), 3, 95);
}

// ---------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------

export const pendingOrders = (s, types = null) => s.queue.filter(o => !types || types.includes(o.type));

function applyOrder(sc, s, o) {
    switch (o.type) {
        case 'heading': s.want.heading = ((o.value % 360) + 360) % 360; break;
        case 'throttle': s.want.throttle = clamp(Number(o.value), 0, 4); break;
        case 'evasive': s.evasive = !!o.value; break;
        case 'target': s.target = o.value; break;
        case 'called': s.called = o.value || ''; break;
        case 'weapon': { const w = s.weapons[o.value.n]; if (w) w.on = !!o.value.on; break; }
        case 'missiles': s.missiles = !!o.value; break;
        case 'fleet': s.fleet = o.value; break;
        case 'load': for (const w of s.weapons) if (w.id === o.value.id && w.arc === o.value.arc && w.load !== o.value.load) { w.load = o.value.load; w.cd = Math.max(w.cd, 1); } break;
        case 'mine': layMine(sc, s); break;
        case 'ram': s.ramming = o.value || null; break;
        case 'sand': castSand(sc, s); break;
        case 'decoydrone': launchDecoy(sc, s); break;
        case 'cut': s.cutting = true; break;
        case 'power': if (POWER_PRESETS[o.value]) s.power = o.value; break;
        case 'radar': s.radar = !!o.value; break;
        case 'jam': if (clsOf(s).jammer) s.jam = !!o.value; break;
        case 'decoy': if (s.decoys > 0 && s.decoyUp <= 0) { s.decoys--; s.decoyUp = 2; say(sc, `${s.name} launches decoys.`, 'info', feltBy(sc, s)); } break;
        case 'overload': s.overload = !!o.value; break;
        case 'dc': s.dc = o.value.filter(id => id === 'weapons' || s.rooms[id]).slice(0, dcTeams(s)); break;
        case 'warp': s.warp = o.value ? (s.warp ?? warpSpool(s)) : null; break;
        default: break;
    }
}

/** Issues an order through the station that owns it. Returns the pulses until it is carried out. */
export function order(s, type, value, sc = SC()) {
    const delay = Math.round(orderSeconds(sc, s, type === 'fleet' ? 'fleet' : DOMAIN[type], { jitter: true }) / PULSE_SECONDS);
    if (delay <= 0) { applyOrder(sc, s, { type, value }); return 0; }
    s.queue = s.queue.filter(o => !(o.type === type && (type !== 'weapon' || o.value.n === value.n) && (type !== 'load' || (o.value.id === value.id && o.value.arc === value.arc))));
    s.queue.push({ type, value, at: sc.pulse + delay });
    return delay;
}

// ---------------------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------------------

function updateTracks(sc, first = false) {
    for (const side of ['ally', 'enemy']) {
        const mine = sc.ships.filter(s => s.side === side && isActive(s));
        const theirs = sc.ships.filter(s => s.side !== side && s.state !== 'escaped');
        const jammers = theirs.filter(s => isActive(s) && s.jam && powered(s));
        for (const t of theirs) {
            let level = 0;
            if (t.state !== 'active') level = mine.length ? 3 : 0; // a hulk does not hide
            else {
                const sig = signature(t);
                const jammed = jammers.some(j => dist(j, t) <= 500);
                for (const o of mine) {
                    const d = dist(o, t);
                    const reach = sensorRange(o) * sig;
                    let l = d <= 150 ? 3 : 0; // close enough to see with the naked sensor
                    if (reach > 0) {
                        let ratio = d / reach;
                        if (jammed && ratio > 0.25) ratio *= 1.6;
                        l = Math.max(l, ratio <= 0.45 ? 3 : ratio <= 0.75 ? 2 : ratio <= 1 ? 1 : 0);
                    }
                    level = Math.max(level, l);
                }
            }
            const prev = sc.tracks[side][t.id] ?? 0;
            if (!first && level < prev - 1) level = prev - 1; // tracks decay, they do not vanish at once
            if (side === 'ally' && level !== prev) {
                if (prev === 0 && level > 0) say(sc, `New contact bearing ${Math.round(bearing(playerShip(sc) ?? t, t)).toString().padStart(3, '0')}.`, 'info');
                else if (level === 3 && prev < 3) say(sc, `Firing solution on ${t.name}.`, 'info');
                else if (level === 0) say(sc, `Contact lost: ${t.name}.`, 'warn');
            }
            sc.tracks[side][t.id] = level;
            if (t.mimic && level >= 2 && isActive(t) && !sc.unmasked?.[side]?.[t.id]) {
                // A decoy drone only fools sensors at a distance; good suites see through it from farther out.
                if (mine.some(o => dist(o, t) <= sensorRange(o) * [0, 0.1, 0.18, 0.36, 0.5][sensorGrade(clsOf(o))])) {
                    ((sc.unmasked ??= {})[side] ??= {})[t.id] = true;
                    if (side === 'ally') say(sc, `One of the ${t.name} contacts is a decoy drone.`, 'warn');
                }
            }
            // A poor sensor suite can misread what it is looking at until it has a firing solution.
            if (side === 'ally' && level === 2 && prev < 2 && t.state === 'active') {
                const grade = Math.max(...mine.map(o => sensorGrade(clsOf(o))), 1);
                sc.misid ??= {};
                if (clsOf(t).disguise && grade < 4) sc.misid[t.id] = clsOf(t).disguise;
                else if (chance([0, 0.4, 0.18, 0.05, 0.01][grade])) {
                    const size = clsOf(t).size;
                    const wrong = Object.values(VESSELS).filter(v => Math.abs(v.size - size) <= 1 && v.id !== t.cls && v.speed);
                    if (wrong.length) sc.misid[t.id] = pickOne(wrong).role;
                } else delete sc.misid[t.id];
            }
            if (side === 'ally' && level >= 3 && sc.misid?.[t.id] && !clsOf(t).disguise) { say(sc, `Reclassified: the ${sc.misid[t.id].toLowerCase()} is ${t.name}.`, 'warn'); delete sc.misid[t.id]; }
            // A disguised hull holds up until someone gets a close look at her.
            if (side === 'ally' && clsOf(t).disguise && !t.exposed && level >= 2 && isActive(t) && mine.some(o => dist(o, t) <= sensorRange(o) * [0, 0.08, 0.14, 0.3, 0.45][sensorGrade(clsOf(o))])) {
                t.exposed = true; delete sc.misid?.[t.id];
                say(sc, `Warning: ${t.name} is no freighter. She is rigged as a fire ship.`, 'bad', true);
            }
        }
    }
    updateGhosts(sc);
}

/**
 * False tracks on the player's side of the plot. Civilian sensors throw them all the time,
 * military ones rarely, and an enemy jammer makes everything worse. A ghost looks exactly like
 * a faint real contact until it fades or something gets close enough to see there is nothing there.
 */
function updateGhosts(sc) {
    sc.ghosts ??= [];
    const mine = sc.ships.filter(s => s.side === 'ally' && isActive(s) && sensorRange(s) > 0);
    if (!mine.length) { sc.ghosts = []; return; }
    for (const g of sc.ghosts) {
        g.x += Math.sin(rad(g.heading)) * g.speed; g.y -= Math.cos(rad(g.heading)) * g.speed;
        g.ttl--;
        const seenThrough = mine.some(o => dist(o, g) <= sensorRange(o) * (0.2 + quality(sc, o, 'sensors') * 0.03));
        if (g.ttl <= 0 || seenThrough) { g.dead = true; say(sc, seenThrough ? 'Contact resolved as a sensor ghost. Nothing there.' : 'A contact fades from the plot.', 'dim'); }
    }
    sc.ghosts = sc.ghosts.filter(g => !g.dead);
    const best = mine.sort((a, b) => sensorGrade(clsOf(b)) - sensorGrade(clsOf(a)))[0];
    const grade = sensorGrade(clsOf(best));
    const jammed = sc.ships.some(s => s.side === 'enemy' && isActive(s) && s.jam);
    let p = [0, 0.14, 0.07, 0.02, 0.004][grade] * (jammed ? 3 : 1) * (1.6 - roomPct(best, 'sensors') * 0.6) * clamp(1.5 - quality(sc, best, 'sensors') * 0.12, 0.5, 1.5);
    if (sc.ghosts.length >= 3) p = 0;
    if (chance(p)) {
        const r = sensorRange(best) * (0.6 + rnd() * 0.5);
        const b = rad(rnd() * 360);
        sc.ghosts.push({ id: uid('g'), x: best.x + Math.sin(b) * r, y: best.y - Math.cos(b) * r, heading: rnd() * 360, speed: 40 + rnd() * 120, ttl: 2 + Math.floor(rnd() * (grade <= 1 ? 8 : 4)) });
        say(sc, `New contact bearing ${Math.round(b * 180 / Math.PI).toString().padStart(3, '0')}.`, 'info');
    }
}

// ---------------------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------------------

const CALLED = { drives: 'drives', weapons: 'weapons', reactor: 'reactor', sensors: 'sensors', bridge: 'bridge', shields: 'shields' };

function hurtPlayer(sc, s, roomId, severity) {
    const st = S();
    if (!st || s.id !== sc.playerShip || st.dead) return;
    const mine = ROOMS[roomId]?.station?.includes(sc.role) || (sc.role === 'pilot' && roomId === 'cockpit') || (sc.role === 'xo' && roomId === 'bridge');
    if (!mine) return;
    if (!chance(sc.playerAct === 'brace' ? 0.3 : 0.55)) { say(sc, `The ${ROOMS[roomId].name.toLowerCase()} takes a hit around you. You are unhurt.`, 'warn', true); return; }
    const partId = randomPart();
    const res = applyHit(st.captain, partId, { pen: 3, bleed: 0.4, energy: chance(0.3) }, Math.round(18 + rnd() * 40 * severity));
    say(sc, `${st.captain.name} is hit by ${res.blocked ? 'debris, stopped by armor' : 'shrapnel and fire'} as the ${ROOMS[roomId].name.toLowerCase()} is struck.`, 'bad', true);
    if (isDead(st.captain)) { sc.playerKilled = true; }
}

function knockOutWeapon(sc, s) {
    const live = s.weapons.filter(w => !w.out);
    if (!live.length) return;
    const w = pickOne(live);
    w.out = true;
    say(sc, `${s.name}: ${SC_WEAPONS[w.id].name} knocked out.`, s.side === 'ally' ? 'bad' : 'good', feltBy(sc, s));
}

function destroyShip(sc, s, why) {
    if (s.state === 'destroyed') return;
    s.state = 'destroyed';
    s.hull = 0; s.shield = 0; s.speed *= 0.5;
    if (s.mimic) { if (why) say(sc, `The contact answering as ${s.name} bursts apart: it was a decoy drone.`, 'info'); return; }
    say(sc, `${s.name} ${why}.`, s.side === 'ally' ? 'bad' : 'good', true);
    if (clsOf(s).volatile && !s.exploded) {
        // A tanker does not break up quietly.
        s.exploded = true;
        say(sc, `${s.name}'s tanks go up in a fireball.`, 'warn', true);
        for (const o of sc.ships) if (o !== s && o.state !== 'destroyed' && o.state !== 'escaped' && dist(o, s) < 110) damage(sc, o, 1400 * (1 - dist(o, s) / 110 * 0.6), 7, 'missile', s, '', { fire: 2.5 });
    }
}

function roomDestroyed(sc, s, id, attacker) {
    const cls = clsOf(s);
    const felt = feltBy(sc, s);
    if (id === 'magazine') {
        say(sc, `${s.name}: magazine detonation!`, s.side === 'ally' ? 'bad' : 'good', true);
        for (const w of s.weapons) if (w.ammo !== null) w.ammo = 0;
        s.hull -= s.maxHull * 0.25;
        s.casualties += Math.round(cls.crew * 0.1);
    } else if (id === 'reactor') {
        s.shield = 0;
        if (chance(0.25)) {
            destroyShip(sc, s, 'loses reactor containment and is torn apart');
            s.exploded = true;
            for (const o of sc.ships) if (o !== s && isActive(o) && dist(o, s) < 80) damage(sc, o, s.maxHull * 0.15, 6, 'missile', s, '');
            return;
        }
        say(sc, `${s.name}: reactor scrammed. She is dead in space.`, s.side === 'ally' ? 'bad' : 'good', true);
        s.state = 'disabled';
    } else if (id === 'bridge' || id === 'cockpit') {
        say(sc, `${s.name}: ${ROOMS[id].name.toLowerCase()} destroyed.`, s.side === 'ally' ? 'bad' : 'good', felt);
        if (id === 'cockpit') { s.state = 'disabled'; s.casualties = cls.crew; }
        else s.casualties += Math.round(cls.crew * 0.03) + 2;
    } else {
        say(sc, `${s.name}: ${ROOMS[id].name.toLowerCase()} destroyed.`, s.side === 'ally' ? 'bad' : 'good', felt);
        if (id === 'quarters') s.casualties += Math.round(cls.crew * 0.12);
        if (id === 'cargo' && s.id === sc.playerShip) sc.cargoLost = true;
    }
    void attacker;
}

/** Applies one hit: shields, then armor on the struck facing, then hull and what is behind it. */
export function damage(sc, t, dmg, pen, kind, attacker, called, opt = {}) {
    if (t.state === 'destroyed' || t.state === 'escaped') return { dealt: 0 };
    const felt = feltBy(sc, t);
    t.hot = true;
    // A sand cloud scatters coherent light and bleeds the energy out of plasma.
    if (t.sandUp > 0 && kind === 'beam') { dmg *= 0.35; t.sandHit = sc.pulse; }
    if (t.sandUp > 0 && kind === 'plasma') dmg *= 0.7;
    if (kind === 'beam' || kind === 'plasma') t.beamHit = sc.pulse;
    if (t.shield > 0 && t.shieldDown <= 0 && kind !== 'ram') {
        const mult = opt.shield ?? (kind === 'beam' ? 1.25 : kind === 'kinetic' ? 0.75 : 1);
        // Particle beams are not wholly stopped by shields: part of every hit leaks through.
        const leak = dmg * (opt.bleed ?? 0);
        dmg -= leak;
        const absorbed = Math.min(t.shield, dmg * mult);
        t.shield -= absorbed;
        dmg -= absorbed / mult;
        dmg += leak;
        if (t.shield <= 0) { t.shield = 0; t.shieldDown = 3; say(sc, `${t.name}: shields have collapsed.`, t.side === 'ally' ? 'bad' : 'good', felt); }
        if (dmg <= 0.5) return { dealt: 0, shield: true };
    }
    const rel = Math.abs(angDiff(bearing(t, attacker), t.heading));
    const face = rel <= 50 ? 0 : rel >= 130 ? 2 : 1;
    const armor = t.armor[face];
    const diff = pen - armor;
    const mult = diff >= 0 ? 1 : diff >= -1 ? 0.5 : diff >= -2 ? 0.2 : 0.05;
    if (diff >= -2) t.armor[face] = Math.max(clsOf(t).armor[face] * 0.4, armor - Math.min(0.5, dmg / t.maxHull * 3));
    const dealt = dmg * mult;
    t.hull -= dealt;
    if (dealt > 0) sc.lastHurt = sc.pulse;
    const out = { dealt, face, pen: diff >= -1 };
    if (opt.rad && dealt > 0 && clsOf(t).crew) {
        // Hard radiation: it kills people and cooks electronics behind the plating.
        t.casualties += Math.max(1, Math.round(clsOf(t).crew * 0.012));
        if (t.rooms.sensors && t.rooms.sensors.hp > 0) t.rooms.sensors.hp = Math.max(1, t.rooms.sensors.hp - dealt * 0.3);
    }
    if (diff >= -1) {
        const ids = Object.keys(t.rooms).filter(id => t.rooms[id].hp > 0);
        let id = null;
        if (called && CALLED[called] && chance(0.6)) id = CALLED[called];
        else {
            const pool = [...ids.map(r => [r, ROOMS[r].share]), ['weapons', 0.14], ['void', 0.25]];
            let r = rnd() * pool.reduce((n, p) => n + p[1], 0);
            for (const [pid, share] of pool) { r -= share; if (r <= 0) { id = pid; break; } }
        }
        if (id === 'weapons') { if (chance(clamp(dealt / (t.maxHull * 0.05), 0.15, 0.9))) knockOutWeapon(sc, t); }
        else if (id && id !== 'void' && t.rooms[id] && t.rooms[id].hp > 0) {
            const room = t.rooms[id];
            const rd = dealt * 0.5 * (opt.room ?? 1);
            room.hp = Math.max(0, room.hp - rd);
            out.room = id;
            if (rd > room.max * 0.15 && chance(Math.min(0.8, (kind === 'beam' || kind === 'plasma' ? 0.3 : 0.18) * (opt.fire ?? 1))) && !room.fire) { room.fire = true; say(sc, `${t.name}: fire in the ${ROOMS[id].name.toLowerCase()}.`, t.side === 'ally' ? 'bad' : 'good', felt); }
            hurtPlayer(sc, t, id, clamp(rd / room.max, 0.3, 1.5));
            if (room.hp <= 0) roomDestroyed(sc, t, id, attacker);
        }
    }
    if (t.hull <= 0 && t.state !== 'destroyed') destroyShip(sc, t, 'breaks up');
    return out;
}

// ---------------------------------------------------------------------------------------
// The AI crew: runs every ship, and every station of the player's ship they do not hold
// ---------------------------------------------------------------------------------------

function pickTarget(sc, s) {
    const tracks = sc.tracks[s.side];
    const cls = clsOf(s);
    const foes = sc.ships.filter(t => t.side !== s.side && isActive(t) && (tracks[t.id] ?? 0) >= 1 && !(t.mimic && !masked(sc, s.side, t)));
    if (!foes.length) return null;
    const sz = (t) => shownAs(sc, s.side, t).size;
    const heavy = s.weapons.some(w => !w.out && w.id === 'torpedo' && w.ammo > 0);
    const score = (t) => dist(s, t) / 400 - (tracks[t.id] ?? 0) * 0.8
        + (heavy ? -sz(t) : 0)
        + (cls.doctrine === 'screen' && sz(t) > 1 ? 2 : 0)
        + (cls.size >= 4 && sz(t) === 1 ? 1.5 : 0)
        - (t.id === s.target ? 0.6 : 0);
    return foes.sort((a, b) => score(a) - score(b))[0];
}

function gunRanges(s) {
    const guns = s.weapons.filter(w => !w.out && ['kinetic', 'beam', 'plasma'].includes(SC_WEAPONS[w.id].kind) && (w.ammo === null || w.ammo > 0) && !SC_WEAPONS[w.id].melee);
    if (!guns.length) return null;
    const r = guns.map(w => SC_WEAPONS[w.id].range);
    return { min: Math.min(...r), max: Math.max(...r) };
}

function aiHelm(sc, s) {
    const cls = clsOf(s);
    if (!cls.speed) return;
    const set = (h, th, ev = false) => {
        if (!pendingOrders(s, ['heading']).length && Math.abs(angDiff(h, s.want.heading)) > 8) order(s, 'heading', Math.round(h), sc);
        if (!pendingOrders(s, ['throttle']).length && th !== s.want.throttle) order(s, 'throttle', th, sc);
        if (!pendingOrders(s, ['evasive']).length && ev !== s.evasive) order(s, 'evasive', ev, sc);
    };
    if (cls.decoy) {
        // A decoy drone shadows its parent on a slightly different course.
        const parent = shipById(s.mimic, sc);
        if (parent) { s.want.heading = (parent.want.heading + (s.off ?? 0) + 360) % 360; s.want.throttle = parent.want.throttle; }
        return;
    }
    const foes = sc.ships.filter(t => t.side !== s.side && isActive(t) && !clsOf(t).decoy);
    const known = foes.filter(t => (sc.tracks[s.side][t.id] ?? 0) >= 1);
    const fleeing = s.fleeing || s.fleet?.type === 'withdraw' || (cls.doctrine === 'civilian' && !s.isPlayer) || s.warp !== null;
    if (fleeing) {
        const near = (known.length ? known : foes).sort((a, b) => dist(s, a) - dist(s, b))[0];
        if (near) set((bearing(s, near) + 180) % 360, 4, true);
        return;
    }
    if (s.fleet?.type === 'hold') { set(s.want.heading, 0); return; }
    if (s.fleet?.type === 'screen') {
        const flag = playerShip(sc);
        if (flag && flag !== s && dist(s, flag) > 260) { set(bearing(s, flag), 3); return; }
    }
    const t = shipById(s.target, sc);
    if (!t || !isActive(t)) {
        // Nothing on the scope: sweep toward where the enemy was last believed to be.
        const guess = foes.sort((a, b) => dist(s, a) - dist(s, b))[0];
        if (guess && cls.doctrine !== 'hold') set(bearing(s, guess), 2);
        return;
    }
    const d = dist(s, t);
    if (cls.doctrine === 'ram' && clsOf(t).size >= 2 && (cls.fireship || s.hull > s.maxHull * 0.3)) { s.ramming = t.id; set(bearing(s, t), 4); return; }
    const g = gunRanges(s);
    const hasMissiles = s.weapons.some(w => !w.out && SC_WEAPONS[w.id].kind === 'missile' && w.ammo > 0);
    let want;
    if (cls.doctrine === 'strike') want = g ? g.min * 0.5 : 400;
    else if (cls.doctrine === 'brawl') want = g ? g.min * 0.6 : 200;
    else want = hasMissiles && !g ? 1200 : g ? g.max * 0.75 : 1500;
    // A fight that has gone quiet draws the ships together: nobody circles out of reach for ever.
    want *= clamp(1 - Math.max(0, sc.pulse - (sc.lastHurt ?? 0) - 12) / 30, 0.25, 1);
    const nose = s.weapons.some(w => !w.out && (w.ammo === null || w.ammo > 0) && SC_WEAPONS[w.id].fixed);
    const b = bearing(s, t);
    const small = cls.size === 1;
    if (small) {
        // Strike craft throttle back as they merge, or they would overshoot every pass.
        const closing = d > 700 ? 3 : d > 300 ? 2 : 1;
        set(b, closing, d < 500);
    } else if (d > want * 1.15) set(b, d > want * 2 ? 3 : 2);
    else if (nose) set(b, d < want * 0.4 ? 0 : 1); // a spinal gun only bears when the bow does
    else if (d < want * 0.6 && cls.doctrine !== 'brawl') set((b + 150) % 360, 3);
    else set((b + (angDiff(s.heading, b) >= 0 ? 80 : -80) + 360) % 360, 2); // hold the range and show a broadside
}

function aiWeapons(sc, s) {
    const t = pickTarget(sc, s);
    const id = t?.id ?? null;
    if (s.fleet?.type === 'engage' && shipById(s.fleet.target, sc) && isActive(shipById(s.fleet.target, sc))) {
        if (s.target !== s.fleet.target && !pendingOrders(s, ['target']).length) order(s, 'target', s.fleet.target, sc);
    } else if (id !== s.target && !pendingOrders(s, ['target']).length) order(s, 'target', id, sc);
    if (clsOf(s).pirate && s.pods > 0 && t && clsOf(t).size >= 2) s.called = 'drives'; else if (clsOf(s).pirate) s.called = '';
    const tt = shipById(s.target, sc);
    if (tt) {
        for (const w of s.weapons) {
            const def = SC_WEAPONS[w.id];
            const opts = loadsFor(def).map(l => l.id);
            if (opts.length < 2) continue;
            const armor = Math.min(...tt.armor);
            const want = clsOf(tt).size === 1 && opts.includes('flak') ? 'flak' : def.pen - 3 >= armor ? 'he' : 'ap';
            if (w.load !== want) { w.load = want; w.cd = Math.max(w.cd, 1); }
        }
        if (s.weapons.some(w => w.id === 'mines' && !w.out && w.ammo > 0) && dist(s, tt) < 900 && sc.pulse % 3 === 0 && Math.abs(angDiff(bearing(s, tt), s.heading)) > 90) layMine(sc, s);
    }
    const hold = s.fleet?.type === 'hold';
    if (s.missiles === hold) s.missiles = !hold;
    for (const w of s.weapons) {
        // Nuclear release is never automatic aboard the player's ship, and never at knife range.
        const want = !hold && (!SC_WEAPONS[w.id].nuclear || (!s.isPlayer && !!tt && shownAs(sc, s.side, tt).size >= 4 && dist(s, tt) > 500));
        if (w.on !== want) w.on = want;
    }
}

function aiEngineering(sc, s) {
    const cls = clsOf(s);
    const t = shipById(s.target, sc);
    const g = gunRanges(s);
    if (s.fleeing || s.warp !== null) s.power = 'speed';
    else if (s.maxShield && s.shield < s.maxShield * 0.3 && s.shieldDown <= 0) s.power = 'defence';
    else if (t && g && dist(s, t) <= g.max) s.power = s.heat > cls.heat * 0.7 ? 'balanced' : 'attack';
    else s.power = t ? 'speed' : 'balanced';
    autoDc(s);
}

export function autoDc(s) {
    const teams = dcTeams(s);
    if (!teams) { s.dc = []; return; }
    const prio = { reactor: 5, bridge: 4, cockpit: 4, drives: 3.5, magazine: 3, cic: 3, shields: 2.5, sensors: 2.5, jump: 2, lifesupport: 1.5, hangar: 1, quarters: 1, cargo: 0.5 };
    const cands = Object.entries(s.rooms)
        .map(([id, r]) => ({ id, need: (r.fire ? 10 : 0) + (r.hp < r.max * 0.6 ? (1 - r.hp / r.max) * (prio[id] ?? 1) : 0) }))
        .filter(c => c.need > 0).sort((a, b) => b.need - a.need);
    const list = cands.slice(0, teams).map(c => c.id);
    if (list.length < teams && s.weapons.some(w => w.out)) list.push('weapons');
    s.dc = list;
}

function aiSensors(sc, s) {
    const cls = clsOf(s);
    const known = Object.entries(sc.tracks[s.side]).some(([id, l]) => l >= 1 && isActive(shipById(id, sc) ?? {}));
    const seen = (sc.tracks[s.side === 'ally' ? 'enemy' : 'ally'][s.id] ?? 0) >= 2;
    if (!s.radar && (seen || s.hot || sc.pulse > 6 || (known && Object.entries(sc.tracks[s.side]).some(([id, l]) => l >= 2 && dist(s, shipById(id, sc)) < 600)))) s.radar = true;
    if (cls.jammer) s.jam = known && !s.fleeing;
    const inbound = sc.missiles.filter(m => m.target === s.id && dist(m, s) <= SC_WEAPONS[m.wid].speed * 2);
    if ((s.beamHit ?? -9) >= sc.pulse - 1 && !(s.sandUp > 0)) castSand(sc, s);
    if (seen && !sc.ships.some(d => d.mimic === s.id && isActive(d)) && chance(0.3)) launchDecoy(sc, s);
    if (inbound.length && s.decoys > 0 && s.decoyUp <= 0) { s.decoys--; s.decoyUp = 2; say(sc, `${s.name} launches decoys.`, 'info', feltBy(sc, s)); }
}

/** When the player is not in command, their captain makes the hard calls. */
function npcCaptain(sc, s) {
    const cls = clsOf(s);
    const hurt = 1 - s.hull / s.maxHull;
    const outgunned = cls.doctrine === 'civilian' || hurt > 0.6;
    const contact = Object.values(sc.tracks.ally).some(l => l >= 1);
    if (sc.noCaptainAi) return;
    if (contact && outgunned && s.warp === null && cls.warp && roomPct(s, 'jump') > 0 && (hurt > 0.3 || cls.doctrine === 'civilian')) {
        s.warp = warpSpool(s); s.fleeing = true;
        say(sc, 'The captain orders an emergency jump. The drive begins to spool.', 'warn', true);
    }
    if (sc.hail && outgunned && chance(hurt > 0.5 ? 0.6 : 0.3)) {
        s.state = 'surrendered';
        say(sc, `The captain of ${s.name} answers the hail and surrenders the ship.`, 'bad', true);
    } else if (hurt > 0.85 && chance(0.4)) {
        sc.abandoned = true;
        s.state = 'destroyed';
        say(sc, `The captain orders abandon ship. Escape pods away from ${s.name}.`, 'bad', true);
    }
}

function aiMorale(sc, s) {
    if (s.isPlayer) { if (!(POSTS[sc.role]?.can ?? []).includes('command')) npcCaptain(sc, s); return; }
    const cls = clsOf(s);
    if (cls.machine || cls.doctrine === 'hold') return;
    const friends = sc.ships.filter(o => o.side === s.side && isActive(o)).length;
    const foes = sc.ships.filter(o => o.side !== s.side && isActive(o) && !clsOf(o).decoy).length;
    const hurt = 1 - s.hull / s.maxHull;
    if (!s.fleeing && hurt > 0.55 && chance(s.morale * (hurt + (foes > friends ? 0.2 : 0)) * 0.5)) {
        s.fleeing = true;
        say(sc, `${s.name} is breaking off.`, s.side === 'ally' ? 'warn' : 'good');
        if (cls.warp && roomPct(s, 'jump') > 0) s.warp = warpSpool(s);
    }
    // Nobody keeps up a fight that is going nowhere: after a quarter of an hour without a telling hit, they leave.
    if (!s.fleeing && s.side === 'enemy' && sc.pulse - (sc.lastHurt ?? 0) > 30) {
        s.fleeing = true;
        say(sc, `${s.name} gives up the engagement and turns away.`, 'good');
        if (cls.warp && roomPct(s, 'jump') > 0) s.warp = warpSpool(s);
    }
    const helpless = topSpeed(s) <= 0 || s.weapons.every(w => w.out || w.ammo === 0);
    if ((helpless && hurt > 0.3 && chance(0.35)) || (hurt > 0.8 && chance(s.morale * 0.4))) {
        s.state = 'surrendered';
        say(sc, `${s.name} strikes her colours and signals surrender.`, s.side === 'ally' ? 'bad' : 'good', true);
    }
}

/** The enemy flagship calls on the player's ship to surrender when it clearly has the upper hand. */
function maybeHail(sc) {
    if (sc.hail || sc.hailed) return;
    const ps = playerShip(sc);
    if (!ps || !isActive(ps)) return;
    const foes = sc.ships.filter(s => s.side === 'enemy' && isActive(s) && (sc.tracks.enemy[ps.id] ?? 0) >= 2);
    if (!foes.length) return;
    const friends = sc.ships.filter(s => s.side === 'ally' && isActive(s));
    const weight = (list) => list.reduce((n, s) => n + s.hull * (s.weapons.some(w => !w.out) ? 1 : 0.2), 0);
    const weak = ps.hull < ps.maxHull * 0.45 || clsOf(ps).doctrine === 'civilian' || weight(friends) < weight(foes) * 0.5;
    if (!weak || sc.pulse < 2) return;
    const lead = foes.sort((a, b) => clsOf(b).size - clsOf(a).size)[0];
    if (clsOf(lead).machine) return;
    sc.hailed = true;
    sc.hail = { from: lead.id, name: lead.name, kind: clsOf(lead).pirate ? 'pirate' : clsOf(lead).lawful ? 'lawful' : 'military', until: sc.pulse + 3 };
    say(sc, `${lead.name} hails: ${clsOf(lead).pirate ? '"Cut your drives and open your locks. Nobody has to die today."' : '"Stand down, power down your weapons and prepare to be boarded."'}`, 'warn', true);
}

// ---------------------------------------------------------------------------------------
// One pulse
// ---------------------------------------------------------------------------------------

function fireShip(sc, s) {
    if (!isActive(s) || !powered(s)) return;
    const t = shipById(s.target, sc);
    const cls = clsOf(s);
    const pw = power(s);
    for (const w of s.weapons) {
        if (w.cd > 0) { w.cd--; continue; }
        const def = SC_WEAPONS[w.id];
        if (['pd', 'mine', 'sweeper', 'sand', 'decoy'].includes(def.kind)) continue; // these work on their own, see below
        if (!w.on || !t || !isActive(t) || t.side === s.side) continue;
        if (weaponBlock(sc, s, w, t)) continue;
        if (def.kind === 'drone') {
            if (!s.missiles || w.ammo <= 0) continue;
            w.ammo--; w.cd = 3;
            const dc = VESSELS[def.spawn];
            const d = makeShip(dc.id, { name: `${s.name} drone ${LETTERS[sc.ships.filter(q => q.parent === s.id).length % LETTERS.length]}`, side: s.side, x: s.x + (rnd() - 0.5) * 30, y: s.y + (rnd() - 0.5) * 30, heading: s.heading, crewQ: 2, morale: 0 });
            d.parent = s.id; d.target = t.id; d.speed = s.speed;
            sc.ships.push(d);
            say(sc, `${s.name} launches a combat drone.`, s.side === 'ally' ? 'info' : 'warn', feltBy(sc, s));
            continue;
        }
        if (def.kind === 'grapple') {
            const c = hitChance(sc, s, w, t);
            w.ammo--; w.cd = def.cycle;
            if (rnd() * 100 < c) {
                (sc.tethers ??= []).push({ a: s.id, b: t.id, ttl: def.hold });
                say(sc, `${s.name} puts a grapple into ${t.name} (${c}%). The line holds.`, s.side === 'ally' ? 'good' : 'bad', true);
            } else say(sc, `${s.name} fires a grapple at ${t.name} (${c}%) and misses.`, 'dim', feltBy(sc, s) || feltBy(sc, t));
            continue;
        }
        if (def.kind === 'missile') {
            if (!s.missiles) continue;
            const n = Math.min(def.salvo, w.ammo);
            w.ammo -= n;
            w.cd = 2;
            for (let i = 0; i < n; i++) sc.missiles.push({ id: uid('m'), side: s.side, from: s.id, target: t.id, wid: w.id, x: s.x, y: s.y, hp: def.hp, fuel: Math.ceil(def.range / def.speed) + 3 });
            if (def.nuclear) { sc.nukeBy = s.name; say(sc, `${s.name} launches a NUCLEAR torpedo at ${t.name}.`, 'bad', true); }
            else say(sc, `${s.name} launches ${n} ${def.name.replace(/ (Rails|Cell|Tube)$/, '').toLowerCase()}${n > 1 ? 's' : ''} at ${t.name}.`, s.side === 'ally' ? 'info' : 'warn', feltBy(sc, s) || feltBy(sc, t));
            s.hot = true;
            continue;
        }
        const c = hitChance(sc, s, w, t);
        const logAt = sc.log.length;
        let hits = 0, dealt = 0, rooms = [];
        for (let i = 0; i < def.shots; i++) {
            if (s.id === sc.playerShip) sc.stats.fired++;
            if (rnd() * 100 < c) {
                hits++;
                if (s.id === sc.playerShip) sc.stats.hits++;
                const ld = def.kind === 'kinetic' ? (LOADS[w.load] ?? LOADS.ap) : null;
                const r = damage(sc, t, def.dmg * (ld?.dmg ?? 1) * (def.kind !== 'kinetic' ? Math.min(1.3, pw.wpn) : 1) * (0.85 + rnd() * 0.3), Math.max(1, def.pen + (ld?.pen ?? 0)), def.kind, s, s.called,
                    ld ? { shield: ld.shield, room: ld.room, fire: ld.fire } : def.shieldMult ? { shield: def.shieldMult, fire: 1.5 } : def.bleed ? { bleed: def.bleed, rad: def.rad } : {});
                dealt += r.dealt ?? 0;
                if (r.room) rooms.push(ROOMS[r.room].name.toLowerCase());
            }
        }
        if (w.ammo !== null) w.ammo--;
        if (def.cycle) w.cd = def.cycle;
        s.heat += def.heat * (def.kind === 'kinetic' ? 0.5 : 1);
        s.hot = true;
        const big = clsOf(t).size >= 3 || cls.size >= 3 || feltBy(sc, s) || feltBy(sc, t);
        if (big || hits) {
            say(sc, `${s.name} fires ${def.name.toLowerCase()}${def.kind === 'kinetic' && w.load !== 'ap' ? ` (${LOADS[w.load].name})` : ''} at ${t.name} (${c}%): ${hits ? `${hits} hit${hits > 1 ? 's' : ''}${dealt >= 1 ? `, ${Math.round(dealt)} hull` : ', absorbed'}${rooms.length ? `, ${[...new Set(rooms)].join(' and ')} damaged` : ''}` : 'miss'}.`,
                hits ? (s.side === 'ally' ? 'good' : 'bad') : 'dim', feltBy(sc, s) || (feltBy(sc, t) && hits > 0));
            if (logAt < sc.log.length - 1) sc.log.splice(logAt, 0, sc.log.pop());
        }
        if (!isActive(t)) break;
    }
}

function pointDefence(sc, t, incoming) {
    // The target's own turrets, plus escorts close enough to cover it.
    const guns = [];
    for (const s of sc.ships) {
        if (s.side !== t.side || !isActive(s) || !powered(s)) continue;
        for (const w of s.weapons) {
            const def = SC_WEAPONS[w.id];
            if (def.kind === 'kinetic' && w.load === 'flak' && !w.out && w.on && w.ammo > 0 && s === t) { for (let i = 0; i < def.shots; i++) guns.push({ s, p: LOADS.flak.intercept }); continue; }
            if (def.kind !== 'pd' || w.out || !w.on) continue;
            if (s !== t && dist(s, t) > def.range * 3) continue;
            for (let i = 0; i < def.shots; i++) guns.push({ s, p: def.intercept * (s === t ? 1 : 0.6) * (0.7 + s.crewQ * 0.08) });
            s.heat += def.heat;
        }
    }
    let killed = 0;
    for (const g of guns) {
        const m = incoming.find(x => x.hp > 0);
        if (!m) break;
        if (chance(g.p)) { m.hp--; if (m.hp <= 0) killed++; }
    }
    return killed;
}

/** A nuclear warhead does not need to hit: it goes off close aboard and everything nearby pays. */
function nuclearBlast(sc, t, def, from) {
    say(sc, `NUCLEAR DETONATION close aboard ${t.name}.`, 'bad', true);
    const at = { x: t.x, y: t.y };
    const evaded = clamp(evasionOf(sc, t) / 100, 0, 0.5); // a nimble ship is farther from the fireball
    const dealt = damage(sc, t, def.dmg * (1 - evaded) * (0.85 + rnd() * 0.3), def.pen, 'missile', from, '', { fire: 2.5, rad: true }).dealt ?? 0;
    for (const o of sc.ships) {
        if (o === t || o.state === 'destroyed' || o.state === 'escaped') continue;
        const d = Math.hypot(o.x - at.x, o.y - at.y);
        if (d <= def.blast) { damage(sc, o, def.dmg * 0.35 * (1 - d / def.blast * 0.6), 8, 'missile', at, '', { fire: 2, rad: true }); say(sc, `${o.name} is caught in the blast.`, o.side === 'ally' ? 'bad' : 'good', feltBy(sc, o)); }
        if (d <= def.emp && isActive(o)) o.blind = 3;
    }
    if (isActive(t)) t.blind = 3;
    sc.missiles.forEach(m => { if (Math.hypot(m.x - at.x, m.y - at.y) <= def.blast * 2) m.dead = true; });
    say(sc, 'The pulse whites out every sensor in the area.', 'warn', true);
    return dealt;
}

/** Throws a cloud of ablative sand around the ship: beams scatter in it for about a minute, both ways. */
export function castSand(sc, s) {
    const w = s.weapons.find(x => x.id === 'sandcaster' && !x.out && x.ammo > 0);
    if (!w || s.sandUp > 0) return false;
    w.ammo--; s.sandUp = 2;
    say(sc, `${s.name} throws a sand screen.`, 'info', feltBy(sc, s));
    return true;
}

/** Sends out a drone that answers to sensors exactly as its parent does. */
export function launchDecoy(sc, s) {
    const w = s.weapons.find(x => x.id === 'decoydrone' && !x.out && x.ammo > 0);
    if (!w || !isActive(s)) return false;
    w.ammo--;
    const off = (chance(0.5) ? 1 : -1) * (20 + rnd() * 25);
    const d = makeShip('decoyship', { name: s.name, side: s.side, x: s.x + (rnd() - 0.5) * 40, y: s.y + (rnd() - 0.5) * 40, heading: s.heading, crewQ: 1, morale: 0 });
    Object.assign(d, { mimic: s.id, sigAs: sizeOf(s).sig * 1.1, off, speed: s.speed, ttl: 14, radar: s.radar });
    d.want = { heading: (s.want.heading + off + 360) % 360, throttle: s.want.throttle };
    sc.ships.push(d);
    if (s.side === 'ally') say(sc, `${s.name} launches a decoy drone.`, 'info', feltBy(sc, s));
    return true;
}

/** Grapple lines: the two hulls are dragged together, the lighter one more. The held crew try to cut free. */
function stepTethers(sc) {
    if (!sc.tethers?.length) return;
    for (const th of sc.tethers) {
        const a = shipById(th.a, sc), b = shipById(th.b, sc);
        th.ttl--;
        const gone = (x) => !x || x.state === 'destroyed' || x.state === 'escaped';
        if (gone(a) || gone(b) || !isActive(a)) { th.dead = true; continue; }
        const ma = MASS[clsOf(a).size], mb = MASS[clsOf(b).size];
        if (mb / ma > 12 && b.speed > 20) { th.dead = true; say(sc, `${b.name} tears the grapple line out of ${a.name} by sheer mass.`, 'info', feltBy(sc, a) || feltBy(sc, b)); continue; }
        const playerCuts = b.id === sc.playerShip && (POSTS[sc.role]?.can ?? []).includes('engineering');
        if (isActive(b) && (playerCuts ? b.cutting : true) && chance(0.15 + quality(sc, b, 'engineering') * 0.05)) {
            th.dead = true; say(sc, `${b.name}'s crew cut the grapple line.`, b.side === 'ally' ? 'good' : 'warn', feltBy(sc, a) || feltBy(sc, b)); continue;
        }
        if (th.ttl <= 0) { th.dead = true; say(sc, `The grapple line between ${a.name} and ${b.name} parts.`, 'info', feltBy(sc, a) || feltBy(sc, b)); continue; }
        const d = dist(a, b);
        if (d > 40) {
            const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d, pull = d - 40;
            a.x += ux * pull * mb / (ma + mb); a.y += uy * pull * mb / (ma + mb);
            b.x -= ux * pull * ma / (ma + mb); b.y -= uy * pull * ma / (ma + mb);
        }
        a.speed *= 0.6; b.speed *= 0.5;
    }
    sc.tethers = sc.tethers.filter(t => !t.dead);
    for (const s of sc.ships) if (s.cutting && !tetherOn(s, sc)) s.cutting = false;
}

/** Fire ships: a hull packed with explosives that only has to get close. They also cook off when shot. */
function stepFireships(sc) {
    for (const s of sc.ships) {
        const fs = clsOf(s).fireship;
        if (!fs || s.blown) continue;
        let power = 0;
        if (isActive(s) && sc.ships.some(o => o.side !== s.side && o.state !== 'destroyed' && o.state !== 'escaped' && !clsOf(o).decoy && clsOf(o).size >= 2 && dist(o, s) <= fs.blast * 0.6)) power = 1;
        else if (s.state === 'destroyed') { s.blown = true; if (chance(0.5)) power = 0.5; }
        if (!power) continue;
        s.blown = true;
        say(sc, `${s.name} ${power === 1 ? 'detonates: she was a fire ship' : 'goes up in a chain of secondary explosions: she was packed with charges'}.`, 'warn', true);
        for (const o of sc.ships) {
            if (o === s || o.state === 'destroyed' || o.state === 'escaped') continue;
            const d = dist(o, s);
            if (d > fs.blast) continue;
            const r = damage(sc, o, fs.dmg * power * (1 - d / fs.blast * 0.6) * (0.85 + rnd() * 0.3), fs.pen, 'missile', s, '', { fire: 2 });
            say(sc, `${o.name} is caught in the explosion: ${Math.round(r.dealt ?? 0)} hull.`, o.side === 'ally' ? 'bad' : 'good', true);
        }
        if (s.state !== 'destroyed') { s.state = 'destroyed'; s.hull = 0; }
    }
}

export function layMine(sc, s) {
    const w = s.weapons.find(x => x.id === 'mines' && !x.out && x.ammo > 0 && x.cd <= 0);
    if (!w) return false;
    w.ammo--; w.cd = 1;
    sc.mines.push({ id: uid('mn'), side: s.side, x: s.x - Math.sin(rad(s.heading)) * 20, y: s.y + Math.cos(rad(s.heading)) * 20, armed: sc.pulse + 1, seen: { ally: s.side === 'ally', enemy: s.side === 'enemy' } });
    if (feltBy(sc, s)) say(sc, `${s.name} lays a mine astern.`, 'info', true);
    return true;
}

/** Mines wait for anything that is not on their layer's side. Sweepers find and clear them. */
function stepMines(sc) {
    const def = SC_WEAPONS.mines;
    for (const s of sc.ships) {
        if (!isActive(s) || !powered(s)) continue;
        const sweep = s.weapons.find(w => w.id === 'sweeper' && !w.out && w.on);
        const sw = SC_WEAPONS.sweeper;
        const eye = sensorRange(s) * (sensorGrade(clsOf(s)) >= 3 ? 0.12 : 0.05);
        for (const mn of sc.mines) {
            if (mn.side === s.side || mn.dead) continue;
            const d = dist(s, mn);
            if (!mn.seen[s.side] && (d <= eye || (sweep && d <= sw.detect))) { mn.seen[s.side] = true; if (s.side === 'ally') say(sc, `Mine detected bearing ${Math.round(bearing(playerShip(sc) ?? s, mn)).toString().padStart(3, '0')}.`, 'warn'); }
        }
        if (sweep) {
            const near = sc.mines.filter(mn => mn.side !== s.side && !mn.dead && mn.seen[s.side] && dist(s, mn) <= sw.range).sort((a, b) => dist(s, a) - dist(s, b))[0];
            if (near && chance(0.5 + quality(sc, s, 'sensors') * 0.05)) { near.dead = true; say(sc, `${s.name} clears a mine.`, s.side === 'ally' ? 'good' : 'info', feltBy(sc, s)); }
        }
    }
    for (const mn of sc.mines) {
        if (mn.dead || sc.pulse < mn.armed) continue;
        const t = sc.ships.find(s => s.side !== mn.side && s.state !== 'destroyed' && s.state !== 'escaped' && dist(s, mn) <= def.trigger);
        if (!t) continue;
        mn.dead = true;
        // A crew that knows the mine is there and can still steer usually avoids it.
        if (mn.seen[t.side] && isActive(t) && chance(0.6 + quality(sc, t, 'helm') * 0.04)) { say(sc, `${t.name} steers clear of a mine, which detonates harmlessly.`, 'info', feltBy(sc, t)); continue; }
        const r = damage(sc, t, def.dmg * (0.8 + rnd() * 0.4), def.pen, 'missile', mn, '', { fire: 1.5 });
        say(sc, `${t.name} strikes a mine: ${Math.round(r.dealt ?? 0)} hull.`, t.side === 'ally' ? 'bad' : 'good', true);
    }
    sc.mines = sc.mines.filter(mn => !mn.dead);
}

/** Ramming: mass times closing speed. Without a reinforced prow the rammer suffers as much as the target. */
function stepRams(sc) {
    for (const s of sc.ships) {
        if (!s.ramming || !isActive(s) || clsOf(s).fireship) continue;
        const t = shipById(s.ramming, sc);
        if (!t || t.state === 'destroyed' || t.state === 'escaped') { s.ramming = null; continue; }
        const d = dist(s, t);
        if (d > Math.max(60, s.speed * 0.6) || Math.abs(angDiff(bearing(s, t), s.heading)) > 35) continue;
        const c = clamp(45 + (turnRate(s) - turnRate(t)) * 0.3 + (s.speed - t.speed) * 0.15 + quality(sc, s, 'helm') * 4 - evasionOf(sc, t), 5, 92);
        if (rnd() * 100 >= c) { say(sc, `${s.name} tries to ram ${t.name} (${c}%) and is evaded.`, 'info', feltBy(sc, s) || feltBy(sc, t)); continue; }
        const closing = Math.max(20, s.speed + t.speed * Math.cos(rad(angDiff(t.heading, s.heading) + 180)));
        const ms = MASS[clsOf(s).size], mt = MASS[clsOf(t).size];
        const blow = ms * closing / 100 * 3.5;
        const toTarget = damage(sc, t, blow, 13, 'ram', s, '', { room: 1.5, fire: 1.5 });
        const toSelf = damage(sc, s, blow * clamp(mt / ms, 0.3, 2) * (clsOf(s).ram ? 0.2 : 1), clsOf(s).ram ? 6 : 13, 'ram', t, '', {});
        s.speed *= 0.3; t.speed *= 0.6; s.ramming = null;
        say(sc, `${s.name} rams ${t.name}: ${Math.round(toTarget.dealt ?? 0)} hull to her, ${Math.round(toSelf.dealt ?? 0)} to the rammer.`, s.side === 'ally' ? 'good' : 'bad', true);
    }
}

/** How a boarding fight goes when nobody the player controls is in it: numbers and quality. */
function crewRepels(t, boarders) {
    const cls = clsOf(t);
    const hands = Math.max(1, (cls.crew - t.casualties) * 0.25) * (0.8 + t.crewQ * 0.1);
    const won = chance(hands / (hands + boarders * 1.3));
    t.casualties += Math.round(boarders * (won ? 0.4 : 0.8));
    return won;
}

function boardShip(sc, t, boarders, from, shot) {
    const felt = feltBy(sc, t);
    const cls = from ? clsOf(from) : null;
    say(sc, `${shot ? `${shot} pod${shot > 1 ? 's' : ''} destroyed, but boarders` : 'Boarders'} from ${from?.name ?? 'the enemy'} are through the hull of ${t.name}: about ${boarders} of them.`, t.side === 'ally' ? 'bad' : 'good', true);
    if (felt) {
        // The player gets one pulse to decide whether to go and meet them.
        sc.boardingPending = { n: boarders, from: from?.name ?? 'the enemy', kind: cls?.pirate ? 'pirate' : 'marine', at: sc.pulse };
        return;
    }
    if (crewRepels(t, boarders)) say(sc, `${t.name}'s crew throw the boarders back.`, t.side === 'ally' ? 'good' : 'bad');
    else { t.state = 'surrendered'; say(sc, `${t.name} has been taken by boarding.`, t.side === 'ally' ? 'bad' : 'good', true); }
}

/** The player goes to meet the boarders in person: this hands over to on-foot combat. */
export function joinBoardingDefence() {
    const st = S();
    const sc = st?.shipCombat;
    const b = sc?.boardingPending;
    if (!b) return;
    const ps = playerShip(sc);
    startCombat({ scene: `Aboard ${ps.name}, corridor`, groups: parseEnemies([b.kind, String(clamp(b.n, 2, 6))]) });
    sc.boarding = b;
    sc.boardingPending = null;
}

function resolveBoarding(sc, st) {
    const ps = playerShip(sc);
    if (sc.boarding) {
        // The fight on the decks was played out on foot.
        const won = st.lastCombat?.result === 'victory';
        sc.boarding = null;
        st.lastCombat = null;
        if (st.pendingEvent?.startsWith('COMBAT RESULT')) st.pendingEvent = null;
        if (won) { say(sc, `The boarders are beaten back. ${ps.name} is still yours.`, 'good', true); return true; }
        say(sc, `The boarders hold the ship. ${ps.name} is taken.`, 'bad', true);
        return false;
    }
    if (sc.boardingPending) {
        const b = sc.boardingPending;
        sc.boardingPending = null;
        if (crewRepels(ps, b.n)) { say(sc, `The crew of ${ps.name} fight the boarders to a standstill and throw them back.`, 'good', true); return true; }
        say(sc, `The boarders fight their way to the bridge. ${ps.name} is taken.`, 'bad', true);
        return false;
    }
    return true;
}

/** Pirates want the prize intact, and marines take ships that cannot run. */
function aiBoarding(sc, s) {
    if (!isActive(s) || !(s.pods > 0) || s.fleeing) return;
    const cls = clsOf(s);
    const t = sc.ships.filter(o => o.side !== s.side && (isActive(o) || o.state === 'disabled') && clsOf(o).size >= 2 && dist(s, o) <= SC_WEAPONS.pod.range && (sc.tracks[s.side][o.id] ?? 0) >= 2)
        .sort((a, b) => dist(s, a) - dist(s, b))[0];
    if (!t || sc.missiles.some(m => m.wid === 'pod' && m.target === t.id)) return;
    if (feltBy(sc, t) && (sc.boardingPending || sc.boarding)) return;
    const held = tetherOn(t, sc)?.a === s.id;
    const open = held || t.shield <= 0 || t.shieldDown > 0;
    const crippled = held || t.state === 'disabled' || topSpeed(t) < clsOf(t).speed * 0.4 || t.hull < t.maxHull * 0.4;
    if (!open) return;
    if (!(crippled || (cls.pirate && chance(0.35)) || chance(0.1))) return;
    const n = crippled ? Math.min(s.pods, 2) : 1;
    s.pods -= n;
    for (let i = 0; i < n; i++) sc.missiles.push({ id: uid('m'), side: s.side, from: s.id, target: t.id, wid: 'pod', x: s.x, y: s.y, hp: SC_WEAPONS.pod.hp, fuel: 6 });
    say(sc, `${s.name} launches ${n > 1 ? `${n} boarding pods` : 'a boarding pod'} at ${t.name}.`, s.side === 'ally' ? 'info' : 'warn', feltBy(sc, t));
}

function stepMissiles(sc) {
    const arrivals = new Map();
    for (const m of sc.missiles) {
        const def = SC_WEAPONS[m.wid];
        const t = shipById(m.target, sc);
        m.fuel--;
        if (!t || t.state === 'destroyed' || t.state === 'escaped' || m.fuel < 0) { m.dead = true; continue; }
        const d = dist(m, t);
        if (d <= def.speed) { if (!arrivals.has(t.id)) arrivals.set(t.id, []); arrivals.get(t.id).push(m); continue; }
        const b = rad(bearing(m, t));
        m.x += Math.sin(b) * def.speed; m.y -= Math.cos(b) * def.speed;
    }
    for (const [tid, all] of arrivals) {
        const t = shipById(tid, sc);
        const felt = feltBy(sc, t);
        const pods = all.filter(m => m.wid === 'pod');
        const list = all.filter(m => m.wid !== 'pod');
        if (pods.length) {
            const shot = pointDefence(sc, t, pods);
            const landed = pods.filter(m => m.hp > 0).length;
            for (const m of pods) m.dead = true;
            const from = shipById(pods[0].from, sc);
            if (!landed) say(sc, `Boarding pods from ${from?.name ?? 'the enemy'} are shot apart short of ${t.name}.`, t.side === 'ally' ? 'good' : 'bad', felt);
            else boardShip(sc, t, landed * 4, from, shot);
        }
        if (!list.length) continue;
        const jam = sc.ships.some(s => s.side === t.side && isActive(s) && s.jam && dist(s, t) <= 500);
        let seduced = 0;
        const logAt = sc.log.length;
        for (const m of list) {
            const hard = SC_WEAPONS[m.wid].nuclear; // inertial guidance: little for a decoy or a jammer to work on
            if ((t.decoyUp > 0 && chance(hard ? 0.12 : 0.4)) || (jam && !hard && chance(0.2))) { m.hp = 0; m.decoyed = true; seduced++; }
        }
        // Point defence takes the nearest threats first, so a conventional salvo can screen a heavy warhead behind it.
        const live = list.filter(m => m.hp > 0).sort((x, y) => (SC_WEAPONS[x.wid].nuclear ? 1 : 0) - (SC_WEAPONS[y.wid].nuclear ? 1 : 0));
        const shot = pointDefence(sc, t, live);
        let hits = 0, dealt = 0;
        for (const m of live.filter(x => x.hp > 0)) {
            const def = SC_WEAPONS[m.wid];
            const from = shipById(m.from, sc) ?? m;
            if (def.nuclear) { hits++; dealt += nuclearBlast(sc, t, def, from); continue; }
            if (rnd() * 100 < clamp(88 - evasionOf(sc, t) * 0.8, 15, 95)) { hits++; dealt += damage(sc, t, def.dmg * (0.85 + rnd() * 0.3), def.pen, 'missile', from, '').dealt ?? 0; }
        }
        for (const m of list) m.dead = true;
        say(sc, `${list.length} missile${list.length > 1 ? 's' : ''} reach ${t.name}: ${[seduced && `${seduced} decoyed`, shot && `${shot} shot down`, hits ? `${hits} hit for ${Math.round(dealt)} hull` : 'no hits'].filter(Boolean).join(', ')}.`,
            hits ? (t.side === 'ally' ? 'bad' : 'good') : 'info', felt || list.some(m => m.from === sc.playerShip));
        if (logAt < sc.log.length - 1) sc.log.splice(logAt, 0, sc.log.pop());
    }
    sc.missiles = sc.missiles.filter(m => !m.dead);
}

/** Point defence turrets also snap at strike craft that wander inside their reach. */
function pdVersusCraft(sc, s) {
    if (!isActive(s) || !powered(s)) return;
    for (const w of s.weapons) {
        const def = SC_WEAPONS[w.id];
        if (def.kind !== 'pd' || w.out || !w.on) continue;
        const t = sc.ships.filter(o => o.side !== s.side && isActive(o) && clsOf(o).size === 1 && dist(s, o) <= def.range * 1.5 && (sc.tracks[s.side][o.id] ?? 0) >= 2).sort((a, b) => dist(s, a) - dist(s, b))[0];
        if (!t) continue;
        const c = clamp(def.acc + def.track + s.crewQ * 3 - evasionOf(sc, t), 5, 90);
        let hits = 0;
        for (let i = 0; i < def.shots; i++) if (rnd() * 100 < c) { hits++; damage(sc, t, def.dmg, def.pen, 'kinetic', s, ''); }
        if (hits) say(sc, `${s.name}'s point defence rakes ${t.name}.`, s.side === 'ally' ? 'good' : 'bad', feltBy(sc, t));
    }
}

function moveShip(sc, s) {
    if (s.state === 'escaped') return;
    const cls = clsOf(s);
    if (isActive(s)) {
        const turn = turnRate(s);
        const diff = angDiff(s.want.heading, s.heading);
        s.heading = (s.heading + clamp(diff, -turn, turn) + 360) % 360;
        const goal = topSpeed(s) * THROTTLES[s.want.throttle].f;
        const step = cls.speed * sizeOf(s).accel * Math.min(1.2, power(s).eng);
        s.speed += clamp(goal - s.speed, -step, step);
    } else {
        s.speed *= 0.9; // a dead ship keeps drifting
    }
    s.x += Math.sin(rad(s.heading)) * s.speed;
    s.y -= Math.cos(rad(s.heading)) * s.speed;
}

function upkeep(sc, s) {
    if (s.state === 'destroyed' || s.state === 'escaped') return;
    const cls = clsOf(s);
    const felt = feltBy(sc, s);
    const pw = power(s);
    // Heat: radiators shed it, flank burns and overloads add to it.
    if (s.want.throttle >= 4 && s.speed > 0) s.heat += cls.heat * 0.05;
    if (s.overload) {
        s.heat += cls.heat * 0.25;
        if (chance(0.12) && s.rooms.reactor) {
            s.rooms.reactor.hp = Math.max(0, s.rooms.reactor.hp - s.rooms.reactor.max * 0.2);
            s.rooms.reactor.fire = true;
            say(sc, `${s.name}: the overload burns through a coolant loop. Fire in the reactor room.`, 'bad', felt);
            if (s.rooms.reactor.hp <= 0) roomDestroyed(sc, s, 'reactor', s);
        }
        s.overload = false;
    }
    s.heat = Math.max(0, s.heat - cls.heat * 0.12 * (powered(s) ? 1 : 0.5));
    if (s.heat >= cls.heat) {
        if (!s.heatLock) say(sc, `${s.name}: heat critical, beam weapons locked out.`, s.side === 'ally' ? 'bad' : 'info', felt);
        s.heatLock = true;
        s.heat = Math.min(s.heat, cls.heat * 1.15);
        const ids = Object.keys(s.rooms).filter(id => s.rooms[id].hp > 0);
        if (ids.length && chance(0.5)) { const r = s.rooms[pickOne(ids)]; r.hp = Math.max(1, r.hp - r.max * 0.06); }
    } else if (s.heatLock && s.heat < cls.heat * 0.7) s.heatLock = false;
    // Shields
    if (s.shieldDown > 0) s.shieldDown--;
    else if (powered(s) && s.maxShield && isActive(s)) s.shield = Math.min(s.maxShield * (0.3 + 0.7 * roomPct(s, 'shields')), s.shield + s.maxShield * 0.04 * pw.shd * roomPct(s, 'shields'));
    if (s.decoyUp > 0) s.decoyUp--;
    if (s.sandUp > 0) s.sandUp--;
    if (s.blind > 0) s.blind--;
    if (s.mimic && isActive(s)) {
        const parent = shipById(s.mimic, sc);
        if (--s.ttl <= 0 || !parent || !isActive(parent)) { destroyShip(sc, s, ''); return; }
    }
    // Fires
    for (const [id, r] of Object.entries(s.rooms)) {
        if (!r.fire) continue;
        if (r.hp <= 0) { r.fire = chance(0.5); continue; }
        r.hp = Math.max(0, r.hp - r.max * 0.06);
        s.heat += cls.heat * 0.02;
        if (chance(0.1)) { const other = pickOne(Object.keys(s.rooms)); if (!s.rooms[other].fire && s.rooms[other].hp > 0) { s.rooms[other].fire = true; say(sc, `${s.name}: fire spreads to the ${ROOMS[other].name.toLowerCase()}.`, 'bad', felt); } }
        if (r.hp <= 0) roomDestroyed(sc, s, id, s);
    }
    // Damage control
    if (isActive(s) || s.state === 'disabled') {
        let teams = dcTeams(s);
        const list = [...s.dc];
        if (felt && sc.playerAct === 'dc' && sc.helped) list.push(...(s.dc.length ? [s.dc[0]] : Object.keys(s.rooms).filter(id => s.rooms[id].fire).slice(0, 1))), teams++;
        for (const id of list.slice(0, teams)) {
            if (id === 'weapons') { const w = s.weapons.find(x => x.out); if (w && chance(0.3)) { w.out = false; say(sc, `${s.name}: ${SC_WEAPONS[w.id].name} back in action.`, 'info', felt); } continue; }
            const r = s.rooms[id];
            if (!r) continue;
            if (r.fire) { if (chance(0.6)) { r.fire = false; say(sc, `${s.name}: fire out in the ${ROOMS[id].name.toLowerCase()}.`, 'info', felt); } continue; }
            const cap = r.max * 0.6;
            if (r.hp < cap) {
                const was = r.hp;
                r.hp = Math.min(cap, r.hp + r.max * 0.08);
                if (was <= 0 && id === 'reactor' && s.state === 'disabled') { s.state = 'active'; say(sc, `${s.name}: reactor restarted.`, s.side === 'ally' ? 'good' : 'warn', felt); }
            }
        }
    }
    // Emergency jump
    if (s.warp !== null && isActive(s)) {
        if (!cls.warp || roomPct(s, 'jump') <= 0 || !powered(s)) { s.warp = null; if (felt) say(sc, 'The jump drive is not answering.', 'bad', true); }
        else {
            if (tetherOn(s, sc)) { if (felt) say(sc, 'The jump drive cannot engage with a grapple line in the hull.', 'bad', true); } else s.warp--;
            s.heat += cls.heat * 0.1;
            if (s.warp <= 0) {
                s.state = 'escaped';
                s.misjump = chance(0.25 + (1 - roomPct(s, 'jump')) * 0.5 + (1 - s.hull / s.maxHull) * 0.2);
                say(sc, `${s.name} tears a hole in space and is gone.`, s.side === 'ally' ? 'info' : 'warn', true);
            } else if (felt) say(sc, `Emergency jump in ${s.warp * PULSE_SECONDS} seconds.`, 'warn', true);
        }
    }
    // Slipping away without a jump drive: out of every enemy's sensors, or simply out of reach.
    if (isActive(s) && (s.fleeing || (s.isPlayer && sc.disengage))) {
        const foes = sc.ships.filter(o => o.side !== s.side && isActive(o));
        const side = s.side === 'ally' ? 'enemy' : 'ally';
        const clear = !foes.length || (sc.tracks[side][s.id] ?? 0) === 0 || foes.every(o => dist(o, s) > 4500);
        s.lostFor = clear ? s.lostFor + 1 : 0;
        if (s.lostFor >= 2) { s.state = 'escaped'; say(sc, `${s.name} has broken contact.`, s.side === 'ally' ? 'info' : 'warn', true); }
    }
}

function checkEnd(sc) {
    const ps = playerShip(sc);
    if (sc.playerKilled) return 'killed';
    if (!ps || ps.state === 'destroyed') return 'destroyed';
    if (ps.state === 'escaped') return 'escaped';
    if (ps.state === 'surrendered') return 'surrendered';
    const foes = sc.ships.filter(s => s.side === 'enemy' && !clsOf(s).decoy);
    if (foes.every(s => !isActive(s))) return foes.every(s => s.state === 'escaped') ? 'enemy-withdrew' : 'victory';
    const friends = sc.ships.filter(s => s.side === 'ally' && isActive(s));
    if (ps.state === 'disabled' && friends.length === 0 && sc.pulse - (sc.disabledAt ?? (sc.disabledAt = sc.pulse)) >= 3) return 'disabled';
    return null;
}

/** Resolves one 30-second pulse for every ship at once. */
export function runPulse() {
    const st = S();
    const sc = st?.shipCombat;
    if (!sc || sc.over) return null;
    if (st.combat) return null; // the fight on the decks comes first
    if (st.dead) { sc.playerKilled = true; finishShipCombat('killed'); return 'killed'; }
    if (!resolveBoarding(sc, st)) { finishShipCombat('boarded'); return 'boarded'; }
    sc.pulse++;
    const ps = playerShip(sc);
    const can = POSTS[sc.role]?.can ?? [];
    // The player may lend a hand even without a station.
    sc.helped = false;
    if (sc.playerAct === 'dc' && ps && isActive(ps)) {
        const r = skillCheck(st.captain, 'engineering', 13, { now: st.minutes });
        sc.helped = r.success;
        say(sc, r.success ? 'You join a damage control party and make a difference.' : 'You join a damage control party but mostly get in the way.', r.success ? 'good' : 'dim', true);
        if (!r.success && r.margin <= -5 && chance(0.5)) { applyHit(st.captain, pickOne(['larm', 'rarm', 'thorax']), { pen: 1, energy: true }, 14 + rnd() * 14); say(sc, 'A flash fire catches you.', 'bad', true); }
    }
    // 1. Orders that have worked their way down the chain of command take effect.
    for (const s of sc.ships) {
        const due = s.queue.filter(o => o.at <= sc.pulse);
        s.queue = s.queue.filter(o => o.at > sc.pulse);
        for (const o of due) applyOrder(sc, s, o);
    }
    // 2. Every crew decides. The player's ship is run by its crew wherever the player has no say.
    for (const s of sc.ships) {
        if (!isActive(s)) continue;
        const mine = s.id === sc.playerShip;
        if (clsOf(s).decoy) { aiHelm(sc, s); continue; }
        aiMorale(sc, s);
        if (!isActive(s)) continue;
        if (!mine || !can.includes('helm')) aiHelm(sc, s);
        if (!mine || !can.includes('weapons')) aiWeapons(sc, s);
        if (!mine || !can.includes('engineering')) aiEngineering(sc, s);
        if (!mine || !can.includes('sensors')) aiSensors(sc, s);
        if (mine && can.includes('engineering') && !s.dcManual) autoDc(s);
    }
    // 3. Movement, then the sensor picture.
    for (const s of sc.ships) moveShip(sc, s);
    stepTethers(sc);
    stepRams(sc);
    stepFireships(sc);
    stepMines(sc);
    updateTracks(sc);
    // 4. Guns and beams, missile launches, then missiles in flight and point defence.
    for (const s of sc.ships) fireShip(sc, s);
    for (const s of sc.ships) if (s.side === 'enemy') aiBoarding(sc, s);
    stepMissiles(sc);
    for (const s of sc.ships) pdVersusCraft(sc, s);
    // 5. Heat, shields, fires, damage control, jumps.
    for (const s of sc.ships) upkeep(sc, s);
    if (sc.hail && sc.pulse > sc.hail.until) { say(sc, `${sc.hail.name}: "Have it your way."`, 'warn', true); sc.hail = null; }
    maybeHail(sc);
    sc.playerAct = null;
    if (st.captain && isDead(st.captain)) sc.playerKilled = true;
    const end = checkEnd(sc);
    if (end) finishShipCombat(end);
    return end;
}

// ---------------------------------------------------------------------------------------
// Command decisions
// ---------------------------------------------------------------------------------------

export function playerSurrender() {
    const sc = SC();
    const ps = playerShip(sc);
    if (!sc || !ps) return;
    ps.state = 'surrendered';
    say(sc, `${ps.name} cuts her drives and signals surrender.`, 'bad', true);
    finishShipCombat('surrendered');
}

export function abandonShip() {
    const sc = SC();
    const ps = playerShip(sc);
    if (!sc || !ps) return;
    sc.abandoned = true;
    say(sc, `Abandon ship! Escape pods away from ${ps.name}.`, 'bad', true);
    finishShipCombat('destroyed');
}

export function demandSurrender() {
    const sc = SC();
    const ps = playerShip(sc);
    if (!sc || !ps) return '';
    const st = S();
    sc.demanded = (sc.demanded ?? 0) + 1;
    const r = skillCheck(st.captain, 'leadership', 12 + sc.demanded * 2, { now: st.minutes });
    let n = 0;
    for (const s of sc.ships.filter(x => x.side === 'enemy' && isActive(x))) {
        if (clsOf(s).machine) continue;
        const hurt = 1 - s.hull / s.maxHull;
        if (chance((hurt * 0.8 + s.morale * 0.3 + (r.success ? 0.15 : -0.2)) * (hurt > 0.4 ? 1 : 0.15))) { s.state = 'surrendered'; n++; say(sc, `${s.name} strikes her colours.`, 'good', true); }
    }
    if (!n) say(sc, 'Your demand for surrender goes unanswered.', 'dim', true);
    const end = checkEnd(sc);
    if (end) finishShipCombat(end);
    return n;
}

export function setFleetOrder(shipId, type, target = null) {
    const sc = SC();
    const s = shipById(shipId, sc);
    if (!s || s.side !== 'ally' || s.isPlayer) return;
    order(s, 'fleet', type === 'free' ? null : { type, target }, sc);
}

// ---------------------------------------------------------------------------------------
// Aftermath
// ---------------------------------------------------------------------------------------

function describeShip(s) {
    const bad = Object.entries(s.rooms).filter(([, r]) => r.hp < r.max * 0.5).map(([id, r]) => `${ROOMS[id].name.toLowerCase()} ${r.hp <= 0 ? 'destroyed' : 'damaged'}`);
    const out = s.weapons.filter(w => w.out).length;
    const stateText = { destroyed: s.exploded ? 'DESTROYED in a reactor breach' : 'DESTROYED', disabled: 'DISABLED, dead in space', surrendered: 'SURRENDERED', escaped: s.misjump ? 'jumped away blind' : 'escaped', active: `hull ${Math.round(100 * s.hull / s.maxHull)}%` }[s.state];
    return `${s.name} (${clsOf(s).role}): ${stateText}${s.state !== 'destroyed' && s.state !== 'escaped' ? `${s.state !== 'active' ? `, hull ${Math.round(100 * Math.max(0, s.hull) / s.maxHull)}%` : ''}${bad.length ? `, ${bad.join(', ')}` : ''}${out ? `, ${out} weapon${out > 1 ? 's' : ''} knocked out` : ''}${s.casualties ? `, about ${s.casualties} crew casualties` : ''}` : ''}`;
}

function syncOwnShip(st, sc, ps) {
    const ship = st.ship;
    if (!ship) return;
    ship.hull = Math.max(1, Math.round(ship.maxHull * clamp(ps.hull / ps.maxHull, 0.01, 1)));
    ship.shields = Math.round(ship.maxShields * clamp(ps.shield / (ps.maxShield || 1), 0, 1));
    const map = { reactor: 'reactor', engines: 'drives', shields: 'shields', sensors: 'sensors', lifesupport: 'lifesupport' };
    for (const [sysId, roomId] of Object.entries(map)) if (ps.rooms[roomId]) ship.systems[sysId] = Math.round(100 * roomPct(ps, roomId));
    const live = ps.weapons.filter(w => !w.out && SC_WEAPONS[w.id].kind !== 'pd').length;
    const all = ps.weapons.filter(w => SC_WEAPONS[w.id].kind !== 'pd').length;
    ship.systems.weapons = all ? Math.round(100 * live / all) : 100;
    ship.scAmmo = Object.fromEntries(ps.weapons.filter(w => w.ammo !== null).map(w => [`${w.n}:${w.id}`, w.ammo]));
    ship.scRooms = Object.fromEntries(Object.entries(ps.rooms).map(([id, r]) => [id, Math.round(100 * r.hp / r.max)]));
}

export function finishShipCombat(result) {
    const st = S();
    const sc = st?.shipCombat;
    if (!sc || sc.over) return;
    sc.over = result;
    const ps = playerShip(sc);
    const cap = st.captain;
    const foes = sc.ships.filter(s => s.side === 'enemy' && !clsOf(s).decoy);
    const friends = sc.ships.filter(s => s.side === 'ally' && !s.isPlayer && !clsOf(s).decoy);
    const victors = foes.filter(s => isActive(s));
    const lead = victors.sort((a, b) => clsOf(b).size - clsOf(a).size)[0];
    const kind = lead ? (clsOf(lead).pirate ? 'pirate' : clsOf(lead).lawful ? 'lawful' : 'military') : null;
    const roleName = POSTS[sc.role]?.name ?? 'crew';
    const lines = [];
    const headline = {
        victory: 'The enemy force was defeated', 'enemy-withdrew': 'The enemy broke off and escaped', destroyed: sc.abandoned ? `${ps.name} was abandoned` : `${ps.name} was destroyed`,
        surrendered: `${ps.name} surrendered`, boarded: `${ps.name} was taken by boarding`, escaped: `${ps.name} escaped the battle`, disabled: `${ps.name} was left dead in space`, killed: `${cap.name} was killed aboard ${ps.name}`, aborted: 'The battle was broken off',
    }[result];
    lines.push(`${headline} after ${Math.max(1, Math.round(sc.pulse * PULSE_SECONDS / 60))} minutes at ${sc.scene}. ${cap.name} served as ${roleName.toLowerCase()} aboard ${ps.name}.`);
    lines.push(`Own ship: ${describeShip(ps)}.`);
    if (friends.length) lines.push(`Friendly: ${friends.map(describeShip).join('; ')}.`);
    lines.push(`Hostile: ${foes.map(describeShip).join('; ')}.`);
    if (sc.nukeBy) lines.push(`A nuclear weapon was used in this battle, launched by ${sc.nukeBy}. That will have consequences far beyond it.`);
    let fate = '';
    const lossOfShip = () => {
        if (sc.own) { st.ship = null; st.cargo = []; }
        if (sc.craft) st.craft = st.craft.filter(c => c.id !== sc.craft);
        st.post = null;
    };
    if (result === 'killed') {
        fate = `${cap.name} died at their station.`;
    } else if (result === 'destroyed') {
        const pods = clsOf(ps).pods;
        const survive = sc.abandoned ? 0.97 : pods ? (ps.exploded ? 0.5 : 0.82) : 0.25;
        if (!chance(survive)) { sc.playerKilled = true; fate = `${cap.name} did not reach a pod and was lost with the ship.`; }
        else {
            if (!sc.abandoned && chance(0.5)) applyHit(cap, pickOne(['stomach', 'larm', 'rarm', 'lleg', 'rleg']), { pen: 2, energy: true }, 15 + rnd() * 25);
            fate = `${cap.name} got away in ${clsOf(ps).size === 1 ? 'an ejection capsule' : 'an escape pod'} and is adrift with a distress beacon and a few days of air. ${lead ? `${lead.name} holds the field: decide whether they recover the pod (as ${kind === 'pirate' ? 'a prisoner to ransom or sell into slavery' : 'a prisoner'}), ignore it, or whether someone else answers the beacon.` : 'No hostile ship remains; decide who answers the beacon, and when.'}`;
        }
        lossOfShip();
    } else if (result === 'surrendered' || result === 'disabled' || result === 'boarded') {
        if (kind === 'pirate') {
            const lootCr = Math.round(cap.credits * (0.3 + rnd() * 0.4));
            const hadCargo = st.cargo.length > 0;
            if (sc.own || sc.craft) { st.cargo = []; cap.credits -= lootCr; }
            const roll = rnd();
            const outcome = roll < 0.5 ? 'They strip the ship of anything valuable and leave it adrift with its crew alive.'
                : roll < 0.8 ? `They take prisoners for ransom, ${cap.name} among them, and put a prize crew aboard.`
                    : `They clap the survivors in irons to be sold as slaves, ${cap.name} among them, and take the ship as a prize.`;
            if (roll >= 0.5 && sc.own) st.shipSeized = true;
            fate = `${result === 'boarded' ? 'Taken in a fight on the decks' : 'Boarded'} by the crew of ${lead.name}. ${sc.own || sc.craft ? `${hadCargo ? 'The cargo is looted' : 'The hold was empty'}${lootCr ? ` and ${lootCr} credits are taken` : ''}. ` : ''}${outcome}`;
        } else if (kind === 'lawful') {
            fate = `Boarded by a party from ${lead.name}. The ship is searched, contraband is seized, and ${sc.own ? `${cap.name} is held to answer for it` : 'the captain is held to answer for it'}. Decide the charges and what happens next.`;
        } else if (lead) {
            fate = `Boarded by marines from ${lead.name}. The crew are taken prisoner and the ship is taken as a prize. Decide where they are taken.`;
            if (sc.own) st.shipSeized = true;
        } else fate = `${ps.name} drifts without power. Help is far away.`;
    } else if (result === 'escaped') {
        if (ps.misjump) {
            fate = `The emergency jump went wrong: ${ps.name} dropped out in deep space between systems, drive burned out, position uncertain. They are STRANDED until the drive is repaired or help comes.`;
            if (sc.own && st.ship) { st.ship.fuel = Math.min(st.ship.fuel, 1); st.ship.systems.engines = Math.min(st.ship.systems.engines, 15); st.stranded = true; }
            if (ps.rooms.jump) ps.rooms.jump.hp = 0;
        } else if (ps.warp !== null || clsOf(ps).warp) {
            fate = `${ps.name} came out of the emergency jump at the edge of the system, shaken but clear.`;
            if (sc.own && st.ship) st.ship.fuel = Math.max(0, Math.round((st.ship.fuel - 3) * 10) / 10);
        } else fate = `${ps.name} slipped out of sensor range and got clear.`;
    }
    if (fate) lines.push(fate);
    // Carry the damage home.
    if (st.ship && sc.own && ps.state !== 'destroyed') syncOwnShip(st, sc, ps);
    if (sc.craft) { const c = st.craft.find(x => x.id === sc.craft); if (c) { c.hull = Math.max(1, Math.round(c.maxHull * clamp(ps.hull / ps.maxHull, 0.01, 1))); c.shields = Math.round(c.maxShields * clamp(ps.shield / (ps.maxShield || 1), 0, 1)); } }
    if (sc.cargoLost && sc.own && st.cargo.length) { const lost = st.cargo.splice(0, Math.ceil(st.cargo.length / 2)); lines.push(`Lost from the breached hold: ${lost.map(c => c.name).join(', ')}.`); }
    // Experience for whatever the player actually did.
    const can = POSTS[sc.role]?.can ?? [];
    const xp = clamp(6 + sc.pulse, 6, 30);
    const gained = [];
    const give = (skill, n) => { if (gainXp(cap, skill, n)) gained.push(skill); };
    if (can.includes('helm')) give(clsOf(ps).mech ? 'mech' : 'pilot', xp);
    if (can.includes('weapons')) give('gunnery', xp);
    if (can.includes('engineering') && sc.role !== 'pilot') give('engineering', Math.round(xp * 0.7));
    if (can.includes('command')) give('tactics', Math.round(xp * 0.7));
    if (can.includes('fleet')) give('leadership', Math.round(xp * 0.7));
    const prizes = result === 'victory' ? foes.filter(s => (s.state === 'disabled' || s.state === 'surrendered') && !clsOf(s).machine).map(s => ({ id: s.id, name: s.name, cls: s.cls, state: s.state, crew: Math.max(0, clsOf(s).crew - s.casualties), done: false })) : [];
    if (prizes.length) lines.push(`Enemy vessels at the mercy of ${can.includes('command') ? cap.name : ps.name}: ${prizes.map(p => `${p.name} (${p.state})`).join(', ')}. They can be boarded, salvaged or left.`);
    const report = {
        result, scene: sc.scene, pulses: sc.pulse, role: sc.role, lines, prizes,
        log: sc.log.slice(-200), at: st.minutes, authority: can.includes('command'),
    };
    advanceTime(Math.max(1, Math.ceil(sc.pulse * PULSE_SECONDS / 60)));
    st.alert = sc.prevAlert ?? 'green';
    st.shipCombat = null;
    st.lastShipCombat = report;
    st.pendingEvent = `SPACE BATTLE RESULT, resolved by the game rules. Narrate the whole engagement now as one vivid passage from ${cap.name}'s point of view as ${roleName.toLowerCase()}${can.length ? '' : ' (they had no tactical picture, only what they could feel, hear and be told)'}, matching these facts exactly, then continue the scene: ${lines.join(' ')}`;
    addLog(`${headline} (${sc.scene}).`, 'combat');
    if (sc.playerKilled) killPlayer(result === 'killed' ? `killed in action aboard ${ps.name}` : `lost with ${ps.name}`);
    return report;
}

export function abortShipCombat() {
    const st = S();
    if (!st?.shipCombat) return;
    st.alert = st.shipCombat.prevAlert ?? 'green';
    st.shipCombat = null;
}

/** Looting a beaten ship takes an hour and yields scrap and whatever was in her hold. */
export function salvagePrize(id) {
    const st = S();
    const p = st?.lastShipCombat?.prizes.find(x => x.id === id);
    if (!p || p.done) return null;
    p.done = true;
    const cls = VESSELS[p.cls];
    const cr = Math.round(cls.hull * (2 + rnd() * 4));
    st.captain.credits += cr;
    advanceTime(60);
    addLog(`Salvaged ${p.name}: ${cr} cr in parts and stores.`, 'trade');
    return cr;
}
