// Refitting the player's own ship: what is in each hardpoint, what it costs to change, and the
// ship that results when the fit is applied to the hull class.
import { S, addLog } from '../core/state.js';
import { VESSELS, LEGAL } from '../data/vessels.js';
import { SHIP_CLASSES } from '../data/catalog.js';
import { MODULES, hullSlots, fits, refitRule } from '../data/modules.js';
import { advanceTime } from './sim.js';

const hullOf = (st) => (st?.ship ? VESSELS[st.ship.classId] ?? null : null);
export const slotsOf = (st = S()) => { const cls = hullOf(st); return cls ? hullSlots(cls) : []; };
/** The module in a slot: the player's choice if they made one, otherwise what the yard fitted. */
export function fitted(st, slot) {
    const f = st.ship.fit ?? {};
    return slot.id in f ? f[slot.id] : slot.stock;
}

/** The hull class with the current fit applied. Stock ships get their class back unchanged. */
export function effectiveClass(st = S()) {
    const cls = hullOf(st);
    if (!cls) return null;
    if (!st.ship.fit || !Object.keys(st.ship.fit).length) return cls;
    const out = { ...cls, armor: [...cls.armor], mounts: [], jammer: false, ram: false, medbay: false, mechBay: false, dcBonus: 0, custom: true };
    let pods = 0;
    for (const slot of hullSlots(cls)) {
        const id = fitted(st, slot);
        const mod = id ? MODULES[id] : null;
        if (!mod) continue;
        if (mod.weapon) { out.mounts.push({ id: mod.id, arc: slot.arc ?? 'T' }); continue; }
        const fx = mod.fx ?? {};
        if (fx.jammer) out.jammer = true;
        if (fx.grade) out.grade = Math.max(out.grade ?? 0, fx.grade);
        if (fx.sensors) out.sensors = Math.round(out.sensors * fx.sensors);
        if (fx.sig) out.sigMult = (out.sigMult ?? 1) * fx.sig;
        if (fx.medbay) out.medbay = true;
        if (fx.mechBay) out.mechBay = true;
        if (fx.dcBonus) out.dcBonus += fx.dcBonus;
        if (fx.pods) pods += fx.pods;
        if (fx.armor) out.armor = out.armor.map(a => a + fx.armor);
        if (fx.bow) out.armor[0] += fx.bow;
        if (fx.speed) out.speed = Math.round(out.speed * fx.speed);
        if (fx.shield) out.shield = Math.round(out.shield * fx.shield);
        if (fx.heat) out.heat = Math.round(out.heat * fx.heat);
        if (fx.spool) out.spool = (out.spool ?? 0) + fx.spool;
        if (fx.ram) out.ram = true;
    }
    if (pods) out.extraPods = pods;
    return out;
}

/** Hold, tanks and the like follow the fit on the ship the player flies between battles. */
function syncShip(st) {
    const base = SHIP_CLASSES[st.ship.classId];
    if (!base) return;
    let cargo = base.cargo, fuel = base.fuel;
    for (const slot of slotsOf(st)) {
        const fx = MODULES[fitted(st, slot)]?.fx;
        if (fx?.cargo) cargo += fx.cargo;
        if (fx?.fuel) fuel += fx.fuel;
    }
    st.ship.cargoCap = cargo;
    st.ship.maxFuel = fuel;
    st.ship.fuel = Math.min(st.ship.fuel, fuel);
}

/** Can this module go in this slot right now, and what would it take? modId null empties the slot. */
export function refitQuote(st, slot, modId) {
    const cur = fitted(st, slot);
    const mod = modId ? MODULES[modId] : null;
    if (modId && !mod) return { ok: false, why: 'unknown module' };
    if (mod && !fits(mod, slot)) return { ok: false, why: 'does not fit this slot' };
    if ((modId ?? null) === (cur ?? null)) return { ok: false, why: 'already fitted' };
    const size = Math.max(mod?.size ?? 0, cur ? MODULES[cur].size : 0, 1);
    const rule = refitRule(size);
    const spare = !mod || (st.ship.spares ?? []).includes(mod.id);
    const base = { hours: rule.hours, by: rule.by, spare, cost: 0 };
    if (st.shipCombat || st.combat) return { ...base, ok: false, why: 'not in the middle of a fight' };
    if (rule.where !== 'anywhere' && !st.loc.docked) return { ...base, ok: false, why: `needs ${rule.by}` };
    if (!spare) {
        if (!st.loc.docked) return { ...base, ok: false, why: 'you carry no spare: buy one at a station' };
        const standing = Math.max(0, ...Object.values(st.reputation ?? {}));
        if (mod.legal === 'restricted' || mod.legal === 'state') return { ...base, ok: false, why: `${LEGAL.restricted.name.toLowerCase()}: not sold. Salvage one or find another way.` };
        if (mod.legal === 'licensed' && standing < 20) return { ...base, ok: false, why: 'licensed: needs standing 20 with a government' };
        base.cost += mod.price;
    }
    if (rule.where === 'yard') base.cost += Math.round((mod?.price ?? MODULES[cur].price) * 0.1 / 100) * 100; // yard labour
    if (base.cost > st.captain.credits) return { ...base, ok: false, why: `costs ${base.cost.toLocaleString('en-US')} cr` };
    return { ...base, ok: true };
}

export function refit(slotId, modId) {
    const st = S();
    const slot = slotsOf(st).find(s => s.id === slotId);
    if (!slot) throw new Error('no such hardpoint');
    const q = refitQuote(st, slot, modId || null);
    if (!q.ok) throw new Error(q.why);
    const cur = fitted(st, slot);
    st.ship.spares ??= [];
    if (modId && q.spare) st.ship.spares.splice(st.ship.spares.indexOf(modId), 1);
    if (cur) st.ship.spares.push(cur);
    (st.ship.fit ??= {})[slot.id] = modId || null;
    if ((st.ship.fit[slot.id] ?? null) === (slot.stock ?? null)) delete st.ship.fit[slot.id];
    st.captain.credits -= q.cost;
    syncShip(st);
    advanceTime(q.hours * 60);
    const text = `${modId ? `Fitted ${MODULES[modId].name}` : `Removed ${MODULES[cur].name}`}${modId && cur ? ` in place of ${MODULES[cur].name}` : ''} (${q.hours} h${q.cost ? `, ${q.cost.toLocaleString('en-US')} cr` : ''}).`;
    addLog(text, 'ship');
    return text;
}

/** Puts a module in the ship's stores, for salvage and rewards. */
export function addSpare(modId) {
    const st = S();
    if (!st?.ship) throw new Error('no ship to stow it aboard');
    if (!MODULES[modId]) throw new Error(`unknown module "${modId}"`);
    (st.ship.spares ??= []).push(modId);
    return `${MODULES[modId].name} stowed aboard ${st.ship.name}`;
}
