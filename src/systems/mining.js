// Mining. An asteroid field is a plot of rocks a few kilometres across. The ship moves through it
// on helm orders that take real time, an ore scanner reads the rocks in range, and the lasers cut
// as story time passes, filling the hold with ore of the purity the rock gives. A refining rig
// aboard doubles the purity, and purity is what the market pays for.
import { S, addLog, cargoUsed, cargoCap } from '../core/state.js';
import { makeRng, hash, pick, clamp, uid, weightedPick } from '../core/util.js';
import { FIELD_TYPES, ZONES } from '../data/sites.js';
import { goodById } from '../data/economy.js';
import { effectiveClass } from './refit.js';
import { shipHas, ledger, purityFactor } from './market.js';
import { gainXp, skillOf } from './character.js';
import { registerActivity, book } from './activity.js';
import { currentSite, siteBook, zoneOf, sitesOf } from './sites.js';
import { startShipCombat } from './shipcombat.js';
import { fmtDuration } from './sim.js';
import { galaxy } from '../core/state.js';

export const PLOT_KM = 20;
const REACH_KM = 0.4;
const BASE_RATE = 7; // tonnes an hour per mining laser, for an average hand at the controls

// ---- The ship's gear ----

export const laserCount = (st) => (st.ship ? (effectiveClass(st)?.mounts ?? []).filter(m => m.id === 'mininglaser').length : 0);
export const canMine = (st = S()) => laserCount(st) > 0;
export const refines = (st) => shipHas(st, 'refine');
/** Ore scanner range in km, from the fitted module. Zero without one. */
export function scanRange(st) {
    if (!st.ship) return 0;
    return shipHas(st, 'oreScan') ? 3 : 0;
}
/** Seen with the eye and the ship's ordinary sensors: the shape and size of a rock, not what it holds. */
const EYE_KM = 1.5;

// ---- The rocks ----

const rockCache = new Map();
/** The rocks of a field, from the sector seed. What has been cut from them is kept in the save. */
export function rocksOf(st, site) {
    const k = `${st.seed}:${site.id}`;
    if (rockCache.has(k)) return rockCache.get(k);
    const rng = makeRng(hash('rocks', st.seed, site.id));
    const type = FIELD_TYPES[site.type];
    const zone = ZONES[site.zone];
    const n = 18 + Math.floor(rng() * 14);
    const ores = Object.entries(type.ores).map(([id, w]) => ({ id, w }));
    const rocks = [];
    for (let i = 0; i < n; i++) {
        const ore = weightedPick(rng, ores).id;
        const size = Math.round(20 + rng() ** 2 * 260); // metres across
        const tonnes = Math.round(size * size * 0.06 * zone.rich * (0.6 + rng() * 0.8));
        const [lo, hi] = type.purity;
        rocks.push({
            id: `${site.id}/${i}`, x: Math.round((1 + rng() * (PLOT_KM - 2)) * 10) / 10, y: Math.round((1 + rng() * (PLOT_KM - 2)) * 10) / 10,
            size, ore, tonnes, purity: Math.round((lo + rng() * (hi - lo)) * zone.rich ** 0.3 * 100) / 100,
            hazard: rng() < 0.12 ? 'volatile' : rng() < 0.12 ? 'fractured' : null,
        });
    }
    rockCache.set(k, rocks);
    return rocks;
}

function fieldState(st, site) {
    const b = siteBook(st);
    const f = (b.state[site.id] ??= {});
    f.cut ??= {};
    f.scanned ??= {};
    return f;
}
export const rockLeft = (st, site, r) => Math.max(0, r.tonnes - (fieldState(st, site).cut[r.id] ?? 0));
export const rockScanned = (st, site, r) => !!fieldState(st, site).scanned[r.id];

// ---- The ship in the field ----

/** Where the ship is on the field plot, km from the corner, and where it is heading. */
export function shipInField(st = S()) {
    const site = currentSite(st);
    if (!site || site.kind !== 'field') return null;
    const f = (st.field ??= {});
    if (f.site !== site.id) Object.assign(f, { site: site.id, x: 1, y: PLOT_KM / 2, move: null });
    if (f.move) {
        const m = f.move;
        const t = clamp((st.minutes - m.start) / Math.max(1, m.end - m.start), 0, 1);
        return { site, x: m.x0 + (m.x1 - m.x0) * t, y: m.y0 + (m.y1 - m.y0) * t, moving: t < 1, eta: Math.max(0, m.end - st.minutes), to: m.rock };
    }
    return { site, x: f.x, y: f.y, moving: false };
}

/** Manoeuvring speed among the rocks, km per minute. Big hulls creep. */
export function fieldSpeed(st) {
    const v = effectiveClass(st)?.speed ?? 80;
    return (v / 10) * 0.06 * (1 + skillOf(st.captain, 'pilot') * 0.04);
}
/** Seconds before the helm answers an order: bigger ships, and greener crews, are slower. */
export const helmLag = (st) => Math.round(1 + (effectiveClass(st)?.size ?? 2) * 1.5);

/** A helm order: move to a point or to a rock. The move takes real time; nothing jumps. */
export function helmTo(x, y, rockId = null) {
    const st = S();
    const here = shipInField(st);
    if (!here) throw new Error('you are not in an asteroid field');
    if (st.activity?.on) throw new Error(`stop first: ${st.activity.name.toLowerCase()}`);
    const tx = clamp(Number(x), 0, PLOT_KM), ty = clamp(Number(y), 0, PLOT_KM);
    const d = Math.hypot(tx - here.x, ty - here.y);
    const mins = Math.max(1, Math.round(helmLag(st) + d / fieldSpeed(st)));
    st.field.move = { x0: here.x, y0: here.y, x1: tx, y1: ty, start: st.minutes, end: st.minutes + mins, rock: rockId };
    return `Helm answering: ${d.toFixed(1)} km, ${fmtDuration(mins)}`;
}

export function approach(rockId) {
    const st = S();
    const here = shipInField(st);
    if (!here) throw new Error('you are not in an asteroid field');
    const r = rocksOf(st, here.site).find(x => x.id === rockId);
    if (!r) throw new Error('no such rock');
    // Stand off a little from the rock, on the near side.
    const d = Math.hypot(r.x - here.x, r.y - here.y) || 1;
    const off = Math.min(d, 0.15 + r.size / 2000);
    return helmTo(r.x - (r.x - here.x) / d * off, r.y - (r.y - here.y) / d * off, rockId);
}

/** Called on the clock: a finished move leaves the ship holding station. */
export function fieldTick(st) {
    const f = st.field;
    if (!f?.move || st.minutes < f.move.end) return;
    f.x = f.move.x1; f.y = f.move.y1;
    f.at = f.move.rock;
    f.move = null;
}

/** The rocks within reach of the scanner. A sweep takes ten minutes of the crew's time. */
export function scanRocks() {
    const st = S();
    const here = shipInField(st);
    if (!here) throw new Error('you are not in an asteroid field');
    const range = scanRange(st);
    if (!range) throw new Error('you have no ore scanner fitted');
    if (here.moving) throw new Error('the scanner needs the ship steady');
    const f = fieldState(st, here.site);
    let n = 0;
    for (const r of rocksOf(st, here.site)) if (!f.scanned[r.id] && Math.hypot(r.x - here.x, r.y - here.y) <= range) { f.scanned[r.id] = st.minutes; n++; }
    gainXp(st.captain, 'electronics', 2);
    return { n, text: n ? `Scanned ${n} rock${n > 1 ? 's' : ''}` : 'Nothing new in scanner range' };
}

/** Rocks the crew can see from where the ship is, for the plot. */
export function visibleRocks(st, here) {
    const range = Math.max(EYE_KM, scanRange(st));
    return rocksOf(st, here.site).map(r => ({ ...r, left: rockLeft(st, here.site, r), d: Math.hypot(r.x - here.x, r.y - here.y), scanned: rockScanned(st, here.site, r), seen: Math.hypot(r.x - here.x, r.y - here.y) <= range * 3 }));
}

// ---- Cutting ----

export function rockInReach(st) {
    const here = shipInField(st);
    if (!here || here.moving) return null;
    let best = null;
    for (const r of rocksOf(st, here.site)) {
        const d = Math.hypot(r.x - here.x, r.y - here.y) - r.size / 2000;
        if (d <= REACH_KM && rockLeft(st, here.site, r) > 0 && (!best || d < best.d)) best = { r, d };
    }
    return best?.r ?? null;
}

/** Starts cutting the rock alongside. Hours of it, lived. */
export function startMining(hours = 4) {
    const st = S();
    if (!canMine(st)) throw new Error('you have no mining laser');
    const here = shipInField(st);
    if (!here) throw new Error('you are not in an asteroid field');
    if (here.moving) throw new Error('the ship is still moving');
    const r = rockInReach(st);
    if (!r) throw new Error('no rock in laser reach: bring the ship alongside one');
    if (cargoCap(st) - cargoUsed(st) < 1) throw new Error('the hold is full');
    const a = book(st, { kind: 'mine', name: `Cutting a ${r.size} m rock in ${here.site.name}`, need: Math.round(clamp(hours, 0.5, 12) * 60), space: true, sys: here.site.sys, site: here.site.id, rock: r.id, window: 5, cut: 0 });
    a.on = true;
    a.started = st.minutes;
    a.zone = zoneOf(st, here.site);
    st.pendingEvent ??= `${st.captain.name} brings the ${st.ship.name} alongside a ${r.size} metre rock in ${here.site.name} and the cutting begins: lasers, dust, the hum of the crushers. Hours of it lie ahead. Play the work.`;
    a.ev = st.pendingEvent;
    return `Cutting under way (${fmtDuration(a.need)})`;
}

function stackFor(st, ore, purity) {
    const p = Math.round(purity * 20) / 20; // stacks are kept in five-percent grades
    const good = goodById(ore);
    let s = st.cargo.find(c => c.comId === ore && c.purity === p);
    if (!s) { s = { id: uid('it'), name: `${good.name} (${Math.round(p * 100)}% pure)`, qty: 0, comId: ore, paid: 0, purity: p, mined: true }; st.cargo.push(s); }
    return s;
}

function mineTick(st, a, mins) {
    const site = currentSite(st);
    const r = site && rocksOf(st, site).find(x => x.id === a.rock);
    if (!r) return;
    const f = fieldState(st, site);
    const skill = skillOf(st.captain, 'engineering');
    // Precious ore is a thin vein in a lot of waste rock: it comes out slowly.
    const scarce = Math.sqrt(Math.max(1, goodById(r.ore).base / 40));
    const rate = BASE_RATE * laserCount(st) * (0.7 + skill * 0.06) * clamp((st.ship.systems?.weapons ?? 100) / 100, 0.2, 1) / scarce;
    a.frac = (a.frac ?? 0) + rate * mins / 60;
    let t = Math.floor(a.frac);
    const free = cargoCap(st) - cargoUsed(st);
    t = Math.min(t, rockLeft(st, site, r), free);
    if (t > 0) {
        a.frac -= t;
        f.cut[r.id] = (f.cut[r.id] ?? 0) + t;
        const purity = clamp(r.purity * (refines(st) ? 2 : 1), 0.05, 0.95);
        stackFor(st, r.ore, purity).qty += t;
        a.cut += t;
        st.ship.wear ??= {};
        st.ship.wear.weapons = clamp((st.ship.wear.weapons ?? 0) + t * 0.01, 0, 100);
    }
    // Rock is not kind: pockets of gas, faults that let go.
    if (r.hazard && Math.random() < 1 - Math.exp(-0.25 * mins / 60)) {
        const dmg = r.hazard === 'volatile' ? 15 + Math.random() * 40 : 5 + Math.random() * 15;
        st.ship.hull = Math.max(1, Math.round(st.ship.hull - dmg));
        st.pendingEvent ??= r.hazard === 'volatile'
            ? `The laser opens a volatile pocket in the rock: an outgassing blast slams the ${st.ship.name} (hull damage). Play it.`
            : `The fractured rock lets go along a fault: fragments rattle against the ${st.ship.name}'s hull. Play it.`;
        r.hazard = null;
    }
    // Poaching on someone's claim draws their security sooner or later.
    if (a.zone === 'claimed' && !a.caught && Math.random() < 1 - Math.exp(-0.18 * mins / 60)) {
        a.caught = true;
        const value = Math.round(a.cut * goodById(r.ore).base);
        (st.warrants ??= []).push({ faction: galaxy().systems[site.sys].faction, amount: Math.max(2000, value * 3), reason: `poaching ore from ${site.owner}'s claim`, since: st.minutes });
        st.pendingEvent ??= `A security cutter from ${site.owner} hails the ${st.ship.name}: they are on a registered claim, they are logged, and the complaint is going to the authorities. Play the hail.`;
    }
    // Claim jumpers and raiders work the lawless belts.
    const sec = galaxy().systems[site.sys].security;
    if (sec <= 2 && !st.shipCombat && Math.random() < 1 - Math.exp(-(0.03 * (3 - sec)) * mins / 60)) {
        a.raid = true;
        startShipCombat({ scene: `${site.name}, claim jumpers`, enemy: [{ cls: pick(Math.random, ['scrapjack', 'raider', 'raider']), count: sec === 0 ? 2 : 1 }] });
        st.pendingEvent = `Claim jumpers come in among the rocks of ${site.name}, weapons hot: they want the ore and the ship.`;
    }
    if (rockLeft(st, site, r) <= 0) { st.activity = null; addLog(`The rock is cut out: ${a.cut} t taken.`, 'trade'); st.pendingEvent ??= `The rock is cut out. ${a.cut} tonnes are in the hold.`; }
    else if (cargoCap(st) - cargoUsed(st) < 1) { st.activity = null; addLog(`The hold is full: ${a.cut} t taken.`, 'trade'); st.pendingEvent ??= `The hold is full. ${a.cut} tonnes cut.`; }
}

registerActivity('mine', {
    tick: mineTick,
    finish(st, a) { gainXp(st.captain, 'engineering', 3 + Math.round(a.need / 90)); return `Cutting done: ${a.cut} t of ore in the hold.`; },
    stop(st, a) { gainXp(st.captain, 'engineering', 2); return `Stopped cutting: ${a.cut} t taken.`; },
});


/** For the storyteller. */
export function miningPrompt(st) {
    const here = shipInField(st);
    if (!here) return '';
    const z = zoneOf(st, here.site);
    return `The ship is in ${here.site.name}, ${FIELD_TYPES[here.site.type].name.toLowerCase()} (${z === 'mine' ? 'the character\'s own claim' : z === 'claimed' ? `${here.site.owner}'s claim: mining here is poaching` : ZONES[z].name.toLowerCase()}), ${here.moving ? `moving between rocks, ${fmtDuration(here.eta)} to go` : 'holding station among the rocks'}.${canMine(st) ? ` Mining lasers: ${laserCount(st)}${refines(st) ? ', refining rig running' : ''}.` : ''}`;
}

export { sitesOf, ledger, purityFactor };
