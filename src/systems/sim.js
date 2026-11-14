// Core simulation primitives shared by the panels, the slash command and the AI tag parser.
import { S, addLog, adjust, cargoUsed, galaxy } from '../core/state.js';
import { settings } from '../core/st.js';
import { clamp, findByName, uid, norm } from '../core/util.js';
import { NEEDS, COMMODITIES, SHIP_SYSTEMS, FACTIONS, INJURY_SEVERITY } from '../data/catalog.js';

/** Advances the campaign clock and everything that depends on it. */
export function advanceTime(minutes) {
    const st = S();
    if (!st || !Number.isFinite(minutes) || minutes === 0) return;
    const before = st.minutes;
    st.minutes = Math.max(0, st.minutes + Math.round(minutes));
    const hours = (st.minutes - before) / 60;
    if (hours <= 0) return;
    const cfg = settings();
    if (cfg.needsDecay) {
        for (const n of NEEDS) {
            adjust(st.captain.needs, n.id, -n.decay * hours * cfg.needsRate, 0, 100);
        }
    }
    // Ship stores: one crew-day of supplies per person per day.
    const people = 1 + st.crew.length;
    st.ship.supplies = Math.max(0, st.ship.supplies - (people * hours) / 24);
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
    hull(st, [v]) { return `Hull ${applyDelta(st.ship, 'hull', v, 0, st.ship.maxHull)}`; },
    shields(st, [v]) { return `Shields ${applyDelta(st.ship, 'shields', v, 0, st.ship.maxShields)}`; },
    fuel(st, [v]) { return `Fuel ${applyDelta(st.ship, 'fuel', v, 0, st.ship.maxFuel)}`; },
    supplies(st, [v]) { return `Supplies ${applyDelta(st.ship, 'supplies', v, 0, 9999)}`; },
    parts(st, [v]) { return `Spare parts ${applyDelta(st.ship, 'parts', v, 0, 999)}`; },
    health(st, [v]) { return `Health ${applyDelta(st.captain, 'health', v, 0, st.captain.maxHealth)}`; },
    stress(st, [v]) { return `Stress ${applyDelta(st.captain, 'stress', v, 0, 100)}`; },
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
        const k = Object.keys(st.captain.skills).find(x => x.startsWith(norm(name)));
        if (!k) throw new Error(`unknown skill "${name}"`);
        return `${k} ${applyDelta(st.captain.skills, k, v, 0, 10)}`;
    },
    system(st, [name, v]) {
        const sys = findByName(SHIP_SYSTEMS, name) ?? SHIP_SYSTEMS.find(x => x.id.startsWith(norm(name)));
        if (!sys) throw new Error(`unknown ship system "${name}"`);
        return `${sys.name} ${applyDelta(st.ship.systems, sys.id, v, 0, 100)}%`;
    },
    location(st, [place]) {
        st.loc.place = place ?? '';
        if (place) st.loc.docked = false;
        return `Location: ${place || 'cleared'}`;
    },
    dock(st, [name]) {
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
        st.loc = { system: sys.id, station: 0, docked: false, place: '' };
        st.visited[sys.id] = true;
        st.route = [];
        return `Arrived in ${sys.name}`;
    },
    cargo(st, [op, name, qty = '1', price]) {
        const n = Math.max(1, Math.round(Number(qty)) || 1);
        if (/^(add|\+|load|gain)$/i.test(op)) {
            const free = st.ship.cargoCap - cargoUsed(st);
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
            st.crew.push({ id: uid('cr'), name, role, health: 100, morale: 70, wage: 60, notes: '' });
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
    inventory: 'item', items: 'item', quest: 'mission', missions: 'mission',
    reputation: 'rep', faction: 'rep', damage: 'system', subsystem: 'system',
    arrive: 'jump', travel: 'jump', track: 'tracker', supply: 'supplies',
};
// Needs can be addressed directly: "rest +30", "morale -10".
for (const n of NEEDS) {
    COMMANDS[n.id] = (st, [v]) => COMMANDS.need(st, [n.id, v]);
}
ALIASES.hunger = 'nourishment';
ALIASES.food = 'nourishment';
ALIASES.thirst = 'hydration';
ALIASES.sleep = 'rest';
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
    if (st.captain.stress >= 80) out.push('breaking point');
    else if (st.captain.stress >= 55) out.push('stressed');
    return out;
}
