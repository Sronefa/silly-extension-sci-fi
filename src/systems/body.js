// Body and wounds. Every character has seven body parts with their own health, and wounds
// that sit on a part until treated: bleeding, arterial bleeds, fractures, burns, concussion.
import { BODY_PARTS, partDef, WOUND_TYPES, ARMOR, MEDS } from '../data/combat.js';
import { clamp, uid } from '../core/util.js';

const round1 = (n) => Math.round(n * 10) / 10;

export function makeBody(total) {
    const parts = {};
    for (const p of BODY_PARTS) {
        const max = Math.round(total * p.share);
        parts[p.id] = { hp: max, max, w: [] };
    }
    return { parts, painUntil: 0, stim: 0 };
}

/** Makes sure a sheet has a body sized for `total` health, rescaling an existing one. */
export function ensureBody(sheet, total) {
    if (!sheet.body?.parts) {
        const ratio = sheet.maxHealth > 0 && sheet.health !== undefined ? clamp(sheet.health / sheet.maxHealth, 0, 1) : 1;
        sheet.body = makeBody(total);
        if (ratio < 1) for (const p of Object.values(sheet.body.parts)) p.hp = Math.round(p.max * ratio);
    } else {
        for (const def of BODY_PARTS) {
            const p = (sheet.body.parts[def.id] ??= { hp: 0, max: 0, w: [] });
            p.w ??= [];
            const scar = p.scar ?? 1;
            const max = Math.max(1, Math.round(total * def.share * scar));
            if (max !== p.max) {
                p.hp = p.max > 0 ? Math.round((p.hp / p.max) * max) : max;
                p.max = max;
            }
        }
    }
    sheet.body.painUntil ??= 0;
    sheet.body.stim ??= 0;
    syncHealth(sheet);
    return sheet.body;
}

export function syncHealth(sheet) {
    let hp = 0, max = 0;
    for (const p of Object.values(sheet.body.parts)) { hp += Math.max(0, p.hp); max += p.max; }
    sheet.health = Math.round(hp);
    sheet.maxHealth = max;
}

export const part = (sheet, id) => sheet.body.parts[id];
export const isDead = (sheet) => sheet.body.parts.head.hp <= 0;
export const isDown = (sheet) => sheet.body.parts.head.hp <= 0 || sheet.body.parts.thorax.hp <= 0;
export const hasWound = (sheet, type) => Object.values(sheet.body.parts).some(p => p.w.includes(type));
export const isBleeding = (sheet) => hasWound(sheet, 'bleed') || hasWound(sheet, 'hemorrhage');

export function randomPart() {
    let r = Math.random() * BODY_PARTS.reduce((n, p) => n + p.hit, 0);
    for (const p of BODY_PARTS) { r -= p.hit; if (r <= 0) return p.id; }
    return 'thorax';
}

/** Raw damage to a part. Damage to an already destroyed part spreads through the rest of the body. */
export function damagePart(sheet, id, dmg) {
    const p = part(sheet, id);
    if (!p || dmg <= 0) return { destroyed: false };
    if (p.hp <= 0) {
        const alive = BODY_PARTS.filter(d => part(sheet, d.id).hp > 0);
        const spread = (dmg * (id === 'stomach' ? 1.2 : 0.7)) / Math.max(1, alive.length);
        for (const d of alive) part(sheet, d.id).hp = round1(Math.max(0, part(sheet, d.id).hp - spread));
        syncHealth(sheet);
        return { destroyed: false, spread: true };
    }
    p.hp = round1(Math.max(0, p.hp - dmg));
    const destroyed = p.hp <= 0;
    if (destroyed) p.w = p.w.filter(w => w === 'hemorrhage' || w === 'bleed');
    syncHealth(sheet);
    return { destroyed };
}

export function addWound(sheet, id, type) {
    const p = part(sheet, id);
    if (!p || !WOUND_TYPES[type] || p.w.includes(type)) return false;
    if (type === 'bleed' && p.w.includes('hemorrhage')) return false;
    if (type === 'hemorrhage') p.w = p.w.filter(w => w !== 'bleed');
    p.w.push(type);
    return true;
}

export function healPart(sheet, id, amount) {
    const p = part(sheet, id);
    if (!p || p.hp <= 0) return 0;
    const before = p.hp;
    p.hp = round1(Math.min(p.max, p.hp + amount));
    syncHealth(sheet);
    return p.hp - before;
}

/** Spreads healing over the most damaged living parts. */
export function healBody(sheet, amount) {
    let left = amount;
    const order = BODY_PARTS.map(d => part(sheet, d.id)).filter(p => p.hp > 0 && p.hp < p.max).sort((a, b) => a.hp / a.max - b.hp / b.max);
    for (const p of order) {
        if (left <= 0) break;
        const give = Math.min(left, p.max - p.hp);
        p.hp = round1(p.hp + give);
        left -= give;
    }
    syncHealth(sheet);
    return amount - left;
}

export function ensureArmor(sheet) {
    const a = ARMOR[sheet.armor] ?? ARMOR.none;
    if (sheet.armorFor !== a.id) {
        sheet.armorFor = a.id;
        sheet.armorDur = a.dur;
        sheet.frame = a.frame ?? 0;
    }
    return a;
}

/**
 * Resolves one hit against a body part: armor check, damage, and any wounds it leaves.
 * Returns a record the combat log can describe.
 */
export function applyHit(sheet, id, weapon, rawDmg) {
    const a = ensureArmor(sheet);
    const out = { part: id, dmg: 0, blocked: false, frame: false, wounds: [], destroyed: false, armorBroke: false };
    // Power armor: the frame soaks everything while it holds.
    if (a.powered && sheet.frame > 0) {
        const absorbed = rawDmg * (weapon.pen >= 5 ? 1 : weapon.pen >= 4 ? 0.7 : 0.35);
        sheet.frame = Math.max(0, Math.round(sheet.frame - absorbed));
        out.frame = true;
        out.dmg = Math.round(absorbed);
        out.armorBroke = sheet.frame <= 0;
        return out;
    }
    let dmg = rawDmg;
    let penetrated = true;
    const covered = a.covers.includes(id) && (a.powered || sheet.armorDur > 0);
    if (covered) {
        const eff = a.powered ? 3 : a.cls * (0.5 + 0.5 * (sheet.armorDur / a.dur));
        const diff = weapon.pen + (weapon.energy ? 0.5 : 0) - eff;
        const chance = diff >= 1 ? 0.95 : diff >= 0 ? 0.65 : diff >= -1 ? 0.25 : diff >= -2 ? 0.08 : 0.02;
        penetrated = Math.random() < chance;
        if (!a.powered) {
            sheet.armorDur = Math.max(0, round1(sheet.armorDur - (penetrated ? 2 + weapon.pen : 3 + weapon.pen * 1.5)));
            out.armorBroke = sheet.armorDur <= 0;
        }
        dmg = penetrated ? dmg * 0.85 : dmg * 0.15;
        out.blocked = !penetrated;
    }
    dmg = Math.max(1, Math.round(dmg));
    out.dmg = dmg;
    const p = part(sheet, id);
    const def = partDef(id);
    const wasAlive = p.hp > 0;
    out.destroyed = damagePart(sheet, id, dmg).destroyed;
    if (penetrated && wasAlive) {
        const add = (type) => { if (addWound(sheet, id, type)) out.wounds.push(type); };
        if (weapon.energy) {
            if (Math.random() < 0.55) add('burn');
        } else {
            const heavy = 0.1 + (dmg > 50 ? 0.15 : 0);
            const r = Math.random();
            if (r < heavy) add('hemorrhage');
            else if (r < heavy + (weapon.bleed ?? 0.35)) add('bleed');
        }
        if (def.limb && !out.destroyed && dmg >= p.max * 0.35 && Math.random() < 0.35) add('fracture');
        if (id === 'head' && !out.destroyed && Math.random() < 0.5) add('concussion');
    } else if (!penetrated && id === 'head' && Math.random() < 0.25) {
        if (addWound(sheet, id, 'concussion')) out.wounds.push('concussion');
    }
    return out;
}

/** Bleeding and burns over time. `rounds` for combat, `minutes` for story time. */
export function woundTick(sheet, { rounds = 0, minutes = 0 } = {}) {
    let lost = 0;
    for (const def of BODY_PARTS) {
        const p = part(sheet, def.id);
        for (const w of p.w) {
            const t = WOUND_TYPES[w];
            const dmg = (t.perRound ?? 0) * rounds + (t.perMinute ?? 0) * minutes;
            if (dmg > 0) {
                // A bleeding part that is already gone drains the thorax instead.
                const target = p.hp > 0 ? def.id : 'thorax';
                const tp = part(sheet, target);
                const take = Math.min(tp.hp, dmg);
                tp.hp = round1(tp.hp - take);
                lost += take;
            }
        }
    }
    if (lost > 0) syncHealth(sheet);
    return lost;
}

/** Slow natural recovery for parts that are not destroyed and not bleeding. */
export function naturalHeal(sheet, hours, mult = 1) {
    for (const p of Object.values(sheet.body.parts)) {
        if (p.hp <= 0 || p.hp >= p.max || p.w.includes('bleed') || p.w.includes('hemorrhage')) continue;
        p.hp = round1(Math.min(p.max, p.hp + p.max * 0.012 * hours * mult));
    }
    syncHealth(sheet);
}

/** Penalties from the state of the body. `now` is campaign minutes, for painkillers. */
export function bodyPenalty(sheet, now = 0) {
    const out = { all: 0, attack: 0, legs: 0, parts: [] };
    if (!sheet.body) return out;
    const parts = sheet.body.parts;
    let pain = 0;
    for (const def of BODY_PARTS) {
        const p = parts[def.id];
        if (p.hp <= 0) pain = Math.max(pain, 2);
        else if (p.hp < p.max * 0.5 || p.w.includes('fracture') || p.w.includes('burn')) pain = Math.max(pain, 1);
        if (def.limb === 'arm') {
            if (p.hp <= 0) out.attack += 3;
            else if (p.w.includes('fracture')) out.attack += 2;
        }
        if (def.limb === 'leg' && (p.hp <= 0 || p.w.includes('fracture'))) out.legs += 1;
    }
    if (pain && sheet.body.painUntil > now) pain = 0;
    if (pain) { out.all += pain; out.parts.push(`pain -${pain}`); }
    if (parts.head.w.includes('concussion')) { out.all += 2; out.parts.push('concussion -2'); }
    if (out.attack) out.parts.push(`arm wounds -${out.attack} to attacks`);
    return out;
}

function takeItem(inventory, name) {
    const it = inventory?.find(x => x.name.toLowerCase() === name.toLowerCase() && x.qty > 0);
    if (!it) return false;
    it.qty -= 1;
    if (it.qty <= 0) inventory.splice(inventory.indexOf(it), 1);
    return true;
}

export function countItem(inventory, name) {
    return inventory?.find(x => x.name.toLowerCase() === name.toLowerCase())?.qty ?? 0;
}

/** Which of the carried medical items would do something for this part right now. */
export function usefulMeds(sheet, id, inventory) {
    const p = part(sheet, id);
    return Object.values(MEDS).filter(m => {
        if (countItem(inventory, m.name) <= 0) return false;
        if (m.surgery) return p.hp <= 0 && !partDef(id).vital;
        if (m.painkiller || m.combatStim) return false;
        if (p.hp <= 0) return (m.fixes ?? []).some(f => p.w.includes(f));
        return (m.fixes ?? []).some(f => p.w.includes(f)) || ((m.heal || m.healAll) && p.hp < p.max);
    });
}

/**
 * Uses a medical item from `inventory` on `sheet`. `surgeryRoll` is a function that performs
 * the Medicine check for field surgery and returns true on success.
 */
export function useMed(sheet, medId, partId, inventory, { now = 0, surgeryRoll = () => true } = {}) {
    const m = MEDS[medId];
    if (!m) return { ok: false, text: 'Unknown item' };
    if (countItem(inventory, m.name) <= 0) return { ok: false, text: `No ${m.name} left` };
    const p = partId ? part(sheet, partId) : null;
    const pname = partId ? partDef(partId).name.toLowerCase() : '';
    const done = [];
    if (m.surgery) {
        if (!p || p.hp > 0) return { ok: false, text: 'Surgery is for destroyed body parts' };
        if (partDef(partId).vital) return { ok: false, text: 'That cannot be fixed in the field' };
        takeItem(inventory, m.name);
        if (!surgeryRoll()) return { ok: true, failed: true, text: `Field surgery on the ${pname} failed. The kit is spent.` };
        p.scar = round1((p.scar ?? 1) * 0.75);
        p.max = Math.max(1, Math.round(p.max * 0.75));
        p.hp = Math.max(1, Math.round(p.max * 0.25));
        p.w = [];
        syncHealth(sheet);
        return { ok: true, text: `Field surgery restored the ${pname} at reduced capacity.` };
    }
    if (m.painkiller) {
        takeItem(inventory, m.name);
        sheet.body.painUntil = now + m.painkiller;
        return { ok: true, text: `${m.name}: pain suppressed for ${m.painkiller} minutes.` };
    }
    if (m.combatStim) {
        takeItem(inventory, m.name);
        sheet.body.stim = m.combatStim;
        return { ok: true, text: `${m.name}: senses sharpen.` };
    }
    if (m.healAll) {
        takeItem(inventory, m.name);
        for (const bp of Object.values(sheet.body.parts)) bp.w = bp.w.filter(w => !m.fixes.includes(w));
        const got = healBody(sheet, m.healAll);
        return { ok: true, text: `${m.name}: bleeding stopped, ${Math.round(got)} health restored.` };
    }
    if (!p) return { ok: false, text: 'Choose a body part' };
    const fixed = (m.fixes ?? []).filter(f => p.w.includes(f));
    const canHeal = m.heal && p.hp > 0 && p.hp < p.max;
    if (!fixed.length && !canHeal) return { ok: false, text: `${m.name} would do nothing for the ${pname}` };
    takeItem(inventory, m.name);
    if (fixed.length) {
        p.w = p.w.filter(w => !fixed.includes(w));
        done.push(`${fixed.map(f => WOUND_TYPES[f].name.toLowerCase()).join(' and ')} treated`);
    }
    if (canHeal) done.push(`${Math.round(healPart(sheet, partId, m.heal))} health restored`);
    return { ok: true, text: `${m.name} on the ${pname}: ${done.join(', ')}.` };
}

/** One-line summary for the AI and for logs. Empty when the body is unharmed. */
export function describeBody(sheet) {
    const bits = [];
    for (const def of BODY_PARTS) {
        const p = part(sheet, def.id);
        if (p.hp >= p.max && !p.w.length) continue;
        const state = p.hp <= 0 ? 'DESTROYED' : `${Math.round(p.hp)}/${p.max}`;
        bits.push(`${def.name} ${state}${p.w.length ? ` (${p.w.map(w => WOUND_TYPES[w].name.toLowerCase()).join(', ')})` : ''}`);
    }
    return bits.join('; ');
}

export const newWoundId = () => uid('w');
