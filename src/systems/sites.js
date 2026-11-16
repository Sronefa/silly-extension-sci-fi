// Sites in a star system, flying between them, and finding them. The sector is charted for its
// stars, planets and stations, but asteroid fields, wrecks and hidden bases are fog of war: they
// are found by surveying with the ship's sensors, bought as map data, or heard of in the story.
//
// Flying is lived like everything else: undocking for a field three hours out puts the ship in
// flight for three hours of story time, and the hourglass lets that time pass.
import { S, addLog, galaxy } from '../core/state.js';
import { getGalaxy } from './galaxy.js';
import { makeRng, hash, pick, randInt, clamp, uid, norm } from '../core/util.js';
import { SITE_KINDS, FIELD_TYPES, ZONES, CLAIM, DATA_VALUE, CHART_PRICE, DERELICT_FATES, ANOMALIES } from '../data/sites.js';
import { CLIENTS } from '../data/contracts.js';
import { VESSELS } from '../data/vessels.js';
import { DAY, WEEK } from '../data/economy.js';
import { effectiveClass } from './refit.js';
import { gainXp } from './character.js';
import { registerActivity, book, areaOf } from './activity.js';
import { port } from './services.js';
import { ledger } from './market.js';
import { fmtDuration, isAiCommand } from './sim.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const FERRY_FARE = 40;

// ---- What is out there ----

const cache = new Map();
/** Every site of a system, generated from the sector seed. Known or not. */
export function sitesOf(seed, sysId) {
    const k = `${seed}:${sysId}`;
    if (cache.has(k)) return cache.get(k);
    const sys = getGalaxy(seed).systems[sysId];
    const rng = makeRng(hash('sites', seed, sysId));
    const out = [];
    const maxR = Math.max(...sys.bodies.map(b => b.orbit), 1);
    const add = (s) => out.push({ sys: sysId, ...s, id: `${sysId}:${out.length}` });
    // Every belt is a field you can see from anywhere: the open zone most miners work.
    for (const b of sys.bodies.filter(x => x.belt)) {
        add({ kind: 'field', name: b.name, type: pick(rng, ['stony', 'metallic', 'metallic', 'ice']), zone: 'open', r: b.orbit, a: b.angle, signal: 1, visible: true });
    }
    // Uncharted fields, richer, often worth a claim.
    const extra = randInt(rng, 0, sys.economy === 'mining' ? 3 : 2);
    for (let i = 0; i < extra; i++) {
        const type = pick(rng, ['metallic', 'stony', 'ice', 'rich', 'metallic', 'rich']);
        const owned = sys.security >= 3 && rng() < 0.5;
        add({
            kind: 'field', name: `${sys.name} ${['Cluster', 'Shoal', 'Drift', 'Scatter', 'Swarm'][randInt(rng, 0, 4)]} ${String.fromCharCode(65 + i)}`, type,
            zone: owned ? 'claimed' : 'claimable', owner: owned ? pick(rng, CLIENTS[sys.faction] ?? CLIENTS.compact) : null,
            r: Math.round((0.3 + rng() * maxR * 1.2) * 100) / 100, a: rng() * Math.PI * 2, signal: 0.5 + rng() * 0.4, charted: owned,
        });
    }
    // Wrecks: civilian ships mostly, the odd warship in contested space.
    const wrecks = randInt(rng, 0, sys.security <= 2 ? 2 : 1);
    const pool = Object.values(VESSELS).filter(v => v.size >= 2 && v.size <= 4 && !v.decoy && !v.machine && !v.id.endsWith('_c'));
    for (let i = 0; i < wrecks; i++) {
        const cls = pick(rng, pool);
        add({ kind: 'derelict', name: `Wreck of a ${cls.name}`, cls: cls.id, fate: pick(rng, DERELICT_FATES), age: randInt(rng, 2, 80), r: Math.round((0.2 + rng() * maxR * 1.4) * 100) / 100, a: rng() * Math.PI * 2, signal: 0.25 + rng() * 0.45, charted: rng() < 0.25 });
    }
    if (rng() < 0.35) add({ kind: 'anomaly', name: `${sys.name} anomaly`, what: pick(rng, ANOMALIES), r: Math.round((0.5 + rng() * maxR * 1.6) * 100) / 100, a: rng() * Math.PI * 2, signal: 0.3 + rng() * 0.4 });
    if (rng() < 0.3) add({ kind: 'cache', name: 'Drifting cargo pods', r: Math.round((0.2 + rng() * maxR) * 100) / 100, a: rng() * Math.PI * 2, signal: 0.2 + rng() * 0.3 });
    if (sys.security <= 1 && rng() < 0.5) add({ kind: 'hideout', name: `Hidden base in ${sys.name}`, r: Math.round((maxR * (0.8 + rng() * 0.8)) * 100) / 100, a: rng() * Math.PI * 2, signal: 0.12 + rng() * 0.15 });
    cache.set(k, out);
    return out;
}

/** The player's own records: what they know, what they have sold, the claims they hold. */
export function siteBook(st = S()) {
    const b = (st.sites ??= {});
    b.known ??= {};
    b.sold ??= {};
    b.claims ??= {};
    b.charts ??= {};
    b.state ??= {};
    return b;
}

export const siteById = (st, id) => { const [sys] = String(id).split(':').map(Number); return sitesOf(st.seed, sys).find(s => s.id === id) ?? null; };
export function isKnown(st, s) {
    const b = siteBook(st);
    return !!(s.visible || b.known[s.id] || (s.charted && b.charts[s.sys]));
}
export const knownSites = (st, sysId = st.loc.system) => sitesOf(st.seed, sysId).filter(s => isKnown(st, s));

/** Who a field belongs to right now, counting the player's own claims. */
export function zoneOf(st, s) {
    if (s.kind !== 'field') return null;
    const c = siteBook(st).claims[s.id];
    if (c && c.until > st.minutes) return 'mine';
    return s.zone;
}

// ---- Where the ship is ----

function stationPos(sys, idx) {
    const st = sys.stations[idx] ?? sys.stations[0];
    const b = sys.bodies.find(x => x.name === st.orbiting) ?? sys.bodies[0];
    return { r: b?.orbit ?? 1, a: b?.angle ?? 0 };
}

/** Where the character is in the system, as a point (r in AU, a in radians), or null. */
export function herePos(st) {
    if (st.transit) return null;
    const sys = galaxy().systems[st.loc.system];
    if (st.cruise) {
        const f = clamp((st.minutes - st.cruise.start) / Math.max(1, st.cruise.end - st.cruise.start), 0, 1);
        const A = st.cruise.fromPos, B = st.cruise.toPos;
        const ax = A.r * Math.cos(A.a), ay = A.r * Math.sin(A.a), bx = B.r * Math.cos(B.a), by = B.r * Math.sin(B.a);
        const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
        return { r: Math.hypot(x, y), a: Math.atan2(y, x) };
    }
    if (st.loc.docked) return stationPos(sys, st.loc.station);
    const s = st.loc.site ? siteById(st, st.loc.site) : null;
    if (s) return { r: s.r, a: s.a };
    return stationPos(sys, st.loc.station);
}

const dist = (A, B) => Math.hypot(A.r * Math.cos(A.a) - B.r * Math.cos(B.a), A.r * Math.sin(A.a) - B.r * Math.sin(B.a));
const shipSpeed = (st) => (st.ship ? effectiveClass(st)?.speed ?? 100 : 90);

/** Minutes of flight between two points for this ship. Undocking and docking add their own. */
export function flightMinutes(st, A, B) {
    return Math.round(10 + dist(A, B) * 45 * (100 / shipSpeed(st)));
}

export function placeOf(st, ref) {
    const sys = galaxy().systems[st.loc.system];
    if (String(ref).startsWith('st:')) { const i = Number(String(ref).slice(3)); return { ref, name: sys.stations[i]?.name ?? '?', pos: stationPos(sys, i), station: i }; }
    const s = siteById(st, ref);
    return s && s.sys === st.loc.system ? { ref, name: s.name, pos: { r: s.r, a: s.a }, site: s } : null;
}

/** Sets a course inside the system. The ship is in flight until the time has really passed. */
export function flyTo(ref) {
    const st = S();
    if (st.transit) throw new Error('you are in jump transit');
    if (st.custody) throw new Error('you are not free');
    if (st.combat || st.shipCombat) throw new Error('not in the middle of a fight');
    if (st.activity?.on) throw new Error(`you are busy: ${st.activity.name.toLowerCase()}`);
    if (st.salvage) throw new Error('your people are still aboard the wreck');
    const to = placeOf(st, ref);
    if (!to) throw new Error('no such place in this system');
    if (to.site && !isKnown(st, to.site)) throw new Error('you do not know where that is');
    // Without a ship of your own, the only way between stations is the system ferry.
    const ferry = !st.ship;
    if (ferry && (to.station == null || !st.loc.docked)) throw new Error('you need a ship of your own to go there');
    if (ferry && st.captain.credits < FERRY_FARE) throw new Error(`the ferry costs ${FERRY_FARE} cr`);
    const fromPos = herePos(st);
    if (st.loc.docked && to.station === st.loc.station) throw new Error('you are already docked there');
    if (!st.loc.docked && !st.cruise && to.site && st.loc.site === to.site.id) throw new Error('you are already there');
    if (!ferry && st.ship.systems?.engines <= 0) throw new Error('the drives are dead');
    if (ferry) { st.captain.credits -= FERRY_FARE; ledger(st, `Ferry to ${to.name}`, -FERRY_FARE); }
    const undock = st.loc.docked ? 10 : 0;
    const dock = to.station != null ? 10 : 0;
    const mins = undock + dock + flightMinutes(st, fromPos, to.pos);
    const prevEv = st.cruise?.ev;
    st.cruise = { to: ref, name: to.name, start: st.minutes, end: st.minutes + mins, fromPos, toPos: to.pos };
    st.loc.docked = false;
    st.loc.site = null;
    st.loc.place = `In flight to ${to.name}`;
    addLog(`Course laid in for ${to.name}: ${fmtDuration(mins)}.`, 'nav');
    st.cruise.ferry = ferry;
    if (prevEv && st.pendingEvent === prevEv) st.pendingEvent = null;
    st.pendingEvent ??= ferry
        ? `${st.captain.name} has taken a seat on the system ferry to ${to.name}, ${fmtDuration(mins)} away. The trip is lived: play it.`
        : `The ${st.ship.name} has ${undock ? 'undocked and ' : ''}set course for ${to.name}, ${fmtDuration(mins)} away. The flight is lived: play life aboard on the way.`;
    st.cruise.ev = st.pendingEvent;
    return `Under way to ${to.name}, ${fmtDuration(mins)}`;
}

/** Called on the clock: arrivals. */
export function cruiseTick(st) {
    const c = st.cruise;
    if (!c || st.minutes < c.end) return;
    st.cruise = null;
    // The departure nobody narrated gives way to the arrival.
    if (c.ev && st.pendingEvent === c.ev) st.pendingEvent = null;
    const to = placeOf(st, c.to);
    if (!to) { st.loc.place = ''; return; }
    if (to.station != null) {
        st.loc.docked = true;
        st.loc.station = to.station;
        st.loc.site = null;
        st.loc.place = '';
        addLog(`Docked at ${to.name}.`, 'nav');
        st.pendingEvent ??= c.ferry ? `The ferry has docked at ${to.name}.` : `The ${st.ship?.name ?? 'ship'} has docked at ${to.name}.`;
    } else {
        st.loc.site = to.site.id;
        st.loc.place = `At ${to.name}`;
        addLog(`Arrived at ${to.name}.`, 'nav');
        st.pendingEvent ??= `The ${st.ship?.name ?? 'ship'} has arrived at ${to.name} (${SITE_KINDS[to.site.kind].name.toLowerCase()}). Describe what the crew sees.`;
    }
}

/** The site the ship is holding at, if any. */
export function currentSite(st = S()) {
    if (!st || st.transit || st.cruise || st.loc.docked || !st.loc.site) return null;
    const s = siteById(st, st.loc.site);
    return s && s.sys === st.loc.system ? s : null;
}

// ---- Surveying ----

export const sensorPower = (st) => (effectiveClass(st)?.sensors ?? 0) / 1200;

/** Starts a sensor sweep of the system from wherever the ship is in open space. */
export function startSurvey(hours = 4) {
    const st = S();
    if (!st.ship) throw new Error('you need a ship with sensors');
    if (st.transit || st.cruise) throw new Error('not while under way');
    if (st.loc.docked) throw new Error('undock first: station traffic drowns everything out');
    if ((st.ship.systems?.sensors ?? 100) < 20) throw new Error('the sensors are too badly damaged');
    const sys = galaxy().systems[st.loc.system];
    const a = book(st, { kind: 'survey', name: `Sensor survey of the ${sys.name} system`, need: Math.round(clamp(hours, 1, 24) * 60), space: true, sys: sys.id, window: 5 });
    a.on = true;
    a.started = st.minutes;
    a.found = [];
    st.pendingEvent ??= `${st.captain.name} has the ${st.ship.name} begin a slow sensor sweep of the ${sys.name} system: long hours watching returns come in. Play the watch as it goes.`;
    a.ev = st.pendingEvent;
    return `Survey under way (${fmtDuration(a.need)})`;
}

function surveyTick(st, a, mins) {
    const power = sensorPower(st) * clamp((st.ship?.systems?.sensors ?? 100) / 100, 0.2, 1);
    const skill = (st.captain.skills?.electronics ?? 0);
    for (const s of sitesOf(st.seed, a.sys)) {
        if (isKnown(st, s)) continue;
        const rate = 0.18 * power * s.signal * (1 + skill * 0.08);
        if (Math.random() < 1 - Math.exp(-rate * mins / 60)) {
            siteBook(st).known[s.id] = { t: st.minutes, how: 'survey' };
            a.found.push(s.id);
            addLog(`Survey contact: ${s.name} (${SITE_KINDS[s.kind].name.toLowerCase()}).`, 'nav');
            st.pendingEvent ??= `The sensor sweep has picked something out: ${describeSite(st, s)}. Play the moment the contact firms up.`;
        }
    }
}

registerActivity('survey', {
    tick: surveyTick,
    finish(st, a) {
        gainXp(st.captain, 'electronics', 4 + Math.round(a.need / 120));
        return `Survey complete: ${a.found.length ? `${a.found.length} new contact${a.found.length > 1 ? 's' : ''}` : 'nothing new found'}.`;
    },
    stop(st, a) { return `Survey broken off: ${a.found.length} contact${a.found.length === 1 ? '' : 's'} so far.`; },
});

/** A line about a site, as much as the player knows. */
export function describeSite(st, s) {
    if (s.kind === 'field') {
        const z = zoneOf(st, s);
        return `${s.name}, ${FIELD_TYPES[s.type].name.toLowerCase()}, ${z === 'mine' ? 'your claim' : z === 'claimed' ? `claimed by ${s.owner}` : ZONES[z].name.toLowerCase()}`;
    }
    if (s.kind === 'derelict') return `${s.name}, adrift some ${s.age} years after ${s.fate}`;
    if (s.kind === 'anomaly') return `${s.what}`;
    if (s.kind === 'cache') return 'a cluster of drifting cargo pods, unclaimed';
    if (s.kind === 'hideout') return 'a hidden installation running dark';
    return s.name;
}

// ---- Buying and selling charts ----

/** Survey finds that are the player's to sell: found by them and not sold yet. */
export function sellableData(st) {
    const b = siteBook(st);
    return Object.entries(b.known).filter(([id, k]) => k.how === 'survey' && !b.sold[id]).map(([id]) => siteById(st, id)).filter(Boolean);
}

export function dataValue(st, s) {
    const p = port(st);
    const outlaw = p && (p.sys.faction === 'ashen' || p.sys.security <= 1);
    if (s.kind === 'hideout') return outlaw ? 0 : DATA_VALUE.hideout; // pirates do not buy maps of their own bases
    const fieldBonus = s.kind === 'field' ? (s.type === 'rich' ? 2.5 : 1) * (s.zone === 'claimable' ? 1.5 : 1) : 1;
    return Math.round(DATA_VALUE[s.kind] * fieldBonus);
}

function atOffice(st) {
    const p = port(st);
    if (!p) throw new Error('charts are bought and sold at a station');
    if (areaOf(st) !== 'office') throw new Error('the cartography desk is in the port office');
    return p;
}

export function sellData(id) {
    const st = S();
    atOffice(st);
    const s = siteById(st, id);
    if (!s || !sellableData(st).includes(s)) throw new Error('nothing to sell');
    const v = dataValue(st, s);
    if (!v) throw new Error('nobody here will buy that');
    siteBook(st).sold[id] = st.minutes;
    st.captain.credits += v;
    ledger(st, `Survey data: ${s.name}`, v);
    addLog(`Sold the survey data for ${s.name}: ${fmt(v)} cr.`, 'trade');
    return `Sold for ${fmt(v)} cr`;
}

export const chartPrice = (st, sysId) => CHART_PRICE[galaxy().systems[sysId].security] || 0;

/** Public charts of a system: the fields and wrecks on record. Never the hidden ones. */
export function buyChart(sysId) {
    const st = S();
    const p = atOffice(st);
    const g = galaxy();
    if (sysId !== p.sys.id && !g.adj[p.sys.id].some(e => e.to === sysId)) throw new Error('this office only keeps charts for this system and its neighbours');
    const price = chartPrice(st, sysId);
    if (!price) throw new Error('nobody here keeps charts');
    if (siteBook(st).charts[sysId]) throw new Error('you already have those charts');
    if (st.captain.credits < price) throw new Error(`the charts cost ${fmt(price)} cr`);
    st.captain.credits -= price;
    siteBook(st).charts[sysId] = st.minutes;
    ledger(st, `Charts of ${g.systems[sysId].name}`, -price);
    return `Bought the charts of ${g.systems[sysId].name}`;
}

// ---- Claims ----

export function fileClaim(id) {
    const st = S();
    const p = atOffice(st);
    const s = siteById(st, id);
    if (!s || s.kind !== 'field' || s.sys !== p.sys.id) throw new Error('claims are filed in the system where the field is');
    if (!isKnown(st, s)) throw new Error('you do not know where that is');
    const z = zoneOf(st, s);
    if (z === 'open') throw new Error('open zones cannot be claimed');
    if (z === 'claimed') throw new Error(`${s.owner} already holds that claim`);
    const cost = CLAIM.perWeek * CLAIM.weeks;
    if (st.captain.credits < cost) throw new Error(`a claim costs ${fmt(cost)} cr for ${CLAIM.weeks} weeks`);
    st.captain.credits -= cost;
    const b = siteBook(st);
    const cur = b.claims[id];
    b.claims[id] = { since: cur?.since ?? st.minutes, until: Math.max(cur?.until ?? 0, st.minutes) + CLAIM.weeks * WEEK };
    ledger(st, `Mining claim: ${s.name}`, -cost);
    addLog(`Filed a mining claim on ${s.name} until day ${Math.floor(b.claims[id].until / DAY)}.`, 'trade');
    return `Claim filed on ${s.name}`;
}

/** A site the story mentions: a tip from a contact, a log recovered from a wreck. */
export function revealFromStory(kind) {
    const st = S();
    const k = Object.keys(SITE_KINDS).find(x => x.startsWith(norm(kind))) ?? null;
    const hidden = sitesOf(st.seed, st.loc.system).filter(s => !isKnown(st, s) && (!k || s.kind === k));
    if (!hidden.length) throw new Error('there is nothing like that left to find in this system');
    const s = hidden[Math.floor(Math.random() * hidden.length)];
    siteBook(st).known[s.id] = { t: st.minutes, how: 'story' };
    return `Learned of ${s.name}`;
}

/** For the storyteller: where the ship is, and the sites the character knows of here. */
export function sitesPrompt(st) {
    if (st.transit) return '';
    const L = [];
    if (st.cruise) L.push(`The ${st.ship?.name ?? 'ship'} is in flight to ${st.cruise.name}, arriving in ${fmtDuration(Math.max(0, st.cruise.end - st.minutes))}.`);
    const here = currentSite(st);
    if (here && here.kind !== 'field') L.push(`The ${st.ship?.name ?? 'ship'} is holding at ${describeSite(st, here)}.`);
    const known = knownSites(st);
    if (known.length) L.push(`Known sites in this system: ${known.map(s => describeSite(st, s)).join('; ')}.`);
    return L.join('\n');
}

export { uid, isAiCommand };
