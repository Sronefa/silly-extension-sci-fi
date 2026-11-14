// Character sheets: the same structure is used for the player and for every party member.
import { uid, clamp, norm } from '../core/util.js';
import { NEEDS } from '../data/catalog.js';
import { ARMOR } from '../data/combat.js';
import { ensureBody, ensureArmor, bodyPenalty } from './body.js';
import {
    ATTRIBUTES, SKILL_DEFS, SKILL_IDS, skillDef, ORIGINS, CAREERS, TIERS, TRAITS, FLAWS, CYBERWARE,
    MAX_FLAW_POINTS, DIFFICULTIES,
} from '../data/chargen.js';

export const ATTR_BASE = 4;
export const ATTR_MIN = 2;
export const ATTR_MAX_CREATE = 8;
export const SKILL_MAX_CREATE = 6;
export const SKILL_MAX = 10;
const ATTR_COST = 4;
const ATTR_REFUND = 3;

const byId = (list, id) => list.find(x => x.id === id);
export const originOf = (id) => byId(ORIGINS, id);
export const careerOf = (id) => byId(CAREERS, id);
export const tierOf = (id) => byId(TIERS, id) ?? TIERS[1];

/** Every effect block that applies to a sheet (traits, flaws, cyberware). */
export function effects(sheet) {
    const out = [];
    for (const id of sheet.traits ?? []) { const t = byId(TRAITS, id); if (t) out.push(t.fx); }
    for (const id of sheet.flaws ?? []) { const f = byId(FLAWS, id); if (f) out.push(f.fx); }
    for (const id of sheet.cyber ?? []) { const c = byId(CYBERWARE, id); if (c) out.push(c.fx); }
    return out;
}

const sumFx = (sheet, pick) => effects(sheet).reduce((n, fx) => n + (pick(fx) || 0), 0);
const mulFx = (sheet, pick) => effects(sheet).reduce((n, fx) => n * (pick(fx) ?? 1), 1);

export const attrOf = (sheet, id) => (sheet.attrs?.[id] ?? ATTR_BASE) + sumFx(sheet, fx => fx.attr?.[id]);
export const skillOf = (sheet, id) => clamp((sheet.skills?.[id] ?? 0) + sumFx(sheet, fx => fx.skill?.[id]), 0, SKILL_MAX + 3);
export const skillBonus = (sheet, id) => sumFx(sheet, fx => fx.skill?.[id]);
/** Total health across all body parts. Endurance and traits scale the whole body. */
export const calcMaxHealth = (sheet) => Math.max(120, 250 + attrOf(sheet, 'end') * 25 + sumFx(sheet, fx => fx.maxHealth) * 3);
export const decayMult = (sheet, need) => mulFx(sheet, fx => fx.decay?.[need]);
export const stressMult = (sheet) => mulFx(sheet, fx => fx.stressGain);
export const xpMult = (sheet) => mulFx(sheet, fx => fx.xp);
export const armorOf = (sheet) => (ARMOR[sheet.armor]?.cls ?? 0);
/** Flat damage reduction from subdermal plating and similar. */
export const plating = (sheet) => sumFx(sheet, fx => fx.armor);
export const hasFx = (sheet, key) => effects(sheet).some(fx => fx[key]);
export const cyberCapacity = (sheet) => Math.max(0, Math.floor((attrOf(sheet, 'end') + 2) * mulFx(sheet, fx => fx.cyberCap)));
export const cyberLoad = (sheet) => (sheet.cyber ?? []).reduce((n, id) => n + (byId(CYBERWARE, id)?.load ?? 0), 0);

export function refreshDerived(sheet) {
    ensureBody(sheet, calcMaxHealth(sheet));
    ensureArmor(sheet);
    return sheet;
}

// ---------- Creation ----------

export function newDraft(name) {
    return {
        name: name || 'Unnamed',
        look: '',
        origin: 'station',
        career: 'trader',
        tier: 'pro',
        difficulty: 'standard',
        deathMode: 'checkpoint',
        attrBuy: {},
        skillBuy: {},
        traits: [],
        flaws: [],
        cyber: [],
        shipName: 'Wandering Star',
        seed: '',
    };
}

export function draftBaseAttrs(d) {
    const o = originOf(d.origin);
    const out = {};
    for (const a of ATTRIBUTES) out[a.id] = ATTR_BASE + (o?.attr?.[a.id] ?? 0);
    return out;
}

export function draftBaseSkills(d) {
    const o = originOf(d.origin), c = careerOf(d.career), t = tierOf(d.tier);
    const out = {};
    for (const id of SKILL_IDS) out[id] = 0;
    for (const [k, v] of Object.entries(c?.skill ?? {})) out[k] += Math.max(0, v + t.skillMod);
    for (const [k, v] of Object.entries(o?.skill ?? {})) out[k] += v;
    return out;
}

/** Cyberware that comes with the career and costs no points. */
export const draftFreeCyber = (d) => careerOf(d.career)?.start?.cyber ?? [];

function skillStepCost(level) {
    if (level <= 3) return 1;
    if (level <= 5) return 2;
    return 3;
}

export function draftPoints(d) {
    const diff = byId(DIFFICULTIES, d.difficulty) ?? DIFFICULTIES[1];
    const flawGain = Math.min(MAX_FLAW_POINTS, d.flaws.reduce((n, id) => n + (byId(FLAWS, id)?.gain ?? 0), 0));
    const total = diff.points + tierOf(d.tier).points + (careerOf(d.career)?.points ?? 0) + flawGain;
    let spent = 0;
    for (const v of Object.values(d.attrBuy)) spent += v > 0 ? v * ATTR_COST : v * ATTR_REFUND;
    const base = draftBaseSkills(d);
    for (const [id, v] of Object.entries(d.skillBuy)) {
        for (let i = 1; i <= v; i++) spent += skillStepCost(base[id] + i);
    }
    spent += d.traits.reduce((n, id) => n + (byId(TRAITS, id)?.cost ?? 0), 0);
    const free = draftFreeCyber(d);
    spent += d.cyber.filter(id => !free.includes(id)).reduce((n, id) => n + (byId(CYBERWARE, id)?.cost ?? 0), 0);
    return { total, spent, left: total - spent, flawGain };
}

export function draftCanAttr(d, id, delta) {
    const base = draftBaseAttrs(d)[id];
    const cur = d.attrBuy[id] ?? 0;
    const next = cur + delta;
    const value = base + next;
    if (value < ATTR_MIN || value > ATTR_MAX_CREATE) return false;
    if (next < -1) return false;
    if (delta < 0 && next < 0 && Object.entries(d.attrBuy).filter(([k, v]) => v < 0 && k !== id).length >= 2) return false;
    if (delta > 0) return draftPoints(d).left >= (cur < 0 ? ATTR_REFUND : ATTR_COST);
    return true;
}

export function draftCanSkill(d, id, delta) {
    const base = draftBaseSkills(d)[id];
    const cur = d.skillBuy[id] ?? 0;
    if (delta < 0) return cur > 0;
    if (base + cur + 1 > SKILL_MAX_CREATE) return false;
    return draftPoints(d).left >= skillStepCost(base + cur + 1);
}

/** A preview sheet for the draft, used both for the wizard display and to build the final character. */
export function draftSheet(d) {
    const attrs = draftBaseAttrs(d);
    for (const [k, v] of Object.entries(d.attrBuy)) attrs[k] += v;
    const skills = draftBaseSkills(d);
    for (const [k, v] of Object.entries(d.skillBuy)) skills[k] += v;
    const cyber = [...new Set([...draftFreeCyber(d), ...d.cyber])];
    return { attrs, skills, traits: [...d.traits], flaws: [...d.flaws], cyber, armor: careerOf(d.career)?.armor ?? 'none' };
}

export function draftProblems(d) {
    const problems = [];
    const p = draftPoints(d);
    if (p.left < 0) problems.push(`You have overspent by ${-p.left} point${p.left === -1 ? '' : 's'}.`);
    const s = draftSheet(d);
    if (cyberLoad(s) > cyberCapacity(s)) problems.push(`Cyberware load ${cyberLoad(s)} exceeds capacity ${cyberCapacity(s)}.`);
    if (!String(d.name).trim()) problems.push('Your character needs a name.');
    return problems;
}

/** What the chosen start gives you beyond the sheet. */
export function draftStart(d) {
    const c = careerOf(d.career), t = tierOf(d.tier);
    const start = c?.start ?? {};
    return {
        ship: t.noShip ? null : (start.ship ?? null),
        craft: start.craft ?? null,
        // A trainee's craft is a school airframe; they do not have a ship loan either.
        debt: t.noShip ? 0 : (start.debt ?? 0),
    };
}

export function buildSheetFromDraft(d) {
    const o = originOf(d.origin), c = careerOf(d.career), t = tierOf(d.tier);
    const base = draftSheet(d);
    const needs = {};
    for (const n of NEEDS) needs[n.id] = 85;
    const xp = {};
    for (const id of SKILL_IDS) xp[id] = 0;
    const sheet = {
        id: uid('pc'),
        isPlayer: true,
        name: String(d.name).trim(),
        look: String(d.look ?? '').trim(),
        origin: d.origin, career: d.career, tier: d.tier,
        role: `${t.id === 'pro' ? '' : `${t.name} `}${c.name}`,
        attrs: base.attrs, skills: base.skills, xp,
        traits: base.traits, flaws: base.flaws, cyber: base.cyber,
        stress: 10, radiation: 0, needs,
        injuries: [],
        weapon: c.weapon ?? 'fists', armor: c.armor ?? 'none',
        inventory: [],
        credits: Math.round((c.credits ?? 0) * t.creditMult) + (o.credits ?? 0),
        debt: draftStart(d).debt,
        craving: 0,
    };
    const stack = (name) => {
        const it = sheet.inventory.find(x => x.name === name);
        if (it) it.qty++;
        else sheet.inventory.push({ id: uid('it'), name, qty: 1 });
    };
    for (const g of ['Ration Pack', 'Ration Pack', 'Water Flask', 'Water Flask', 'Dermal Patch', 'Magazine', ...(c.gear ?? [])]) stack(g);
    for (const fx of effects(sheet)) {
        if (fx.credits) sheet.credits += fx.credits;
        if (fx.debt) sheet.debt += fx.debt;
        if (fx.injury) sheet.injuries.push({ id: uid('inj'), name: fx.injury, severity: 'moderate', permanent: true, since: 0 });
    }
    refreshDerived(sheet);
    return sheet;
}

/** Starting reputation from origin, career, traits and flaws. */
export function draftReputation(d) {
    const rep = { accord: 0, combine: 0, compact: 0, hegemony: 0, ashen: -20 };
    const add = (obj) => { for (const [k, v] of Object.entries(obj ?? {})) rep[k] = clamp((rep[k] ?? 0) + v, -100, 100); };
    const o = originOf(d.origin);
    add(o?.rep);
    add(careerOf(d.career)?.rep);
    for (const id of d.traits) { const fx = byId(TRAITS, id)?.fx; if (fx?.repHome && o) add({ [o.faction]: fx.repHome }); }
    for (const id of d.flaws) add(byId(FLAWS, id)?.fx?.rep);
    return rep;
}

// ---------- Party members ----------

/** Builds a sheet for an AI character or hired hand from a role word such as "Engineer". */
export function makeNpcSheet(name, role = 'Crew') {
    const r = norm(role);
    const career = CAREERS.find(c => norm(c.name).includes(r) || r.includes(norm(c.name)))
        ?? CAREERS.find(c => r && Object.keys(c.skill).some(k => norm(skillDef(k).name).includes(r)))
        ?? { pilot: careerOf('courier'), gunner: careerOf('fighter'), security: careerOf('merc'), soldier: careerOf('marine'), doctor: careerOf('medic'), hacker: careerOf('netrunner'), navigator: careerOf('explorer'), scientist: careerOf('explorer'), quartermaster: careerOf('trader'), mechanic: careerOf('engineer') }[r];
    const attrs = {};
    for (const a of ATTRIBUTES) attrs[a.id] = ATTR_BASE + (Math.random() < 0.35 ? 1 : 0);
    const skills = {}, xp = {};
    for (const id of SKILL_IDS) { skills[id] = 0; xp[id] = 0; }
    for (const [k, v] of Object.entries(career?.skill ?? {})) skills[k] = v;
    const sheet = {
        id: uid('npc'), isPlayer: false, name, role,
        origin: null, career: career?.id ?? null, tier: 'pro',
        attrs, skills, xp, traits: [], flaws: [], cyber: [],
        stress: 10, morale: 70, injuries: [],
        weapon: career?.weapon ?? 'pistol', armor: career?.armor ?? 'none',
        wage: 60, notes: '',
    };
    refreshDerived(sheet);
    return sheet;
}

// ---------- Progression and checks ----------

export const xpNeeded = (level) => 40 + level * 40;

/** Adds XP to a skill. Returns the number of levels gained. */
export function gainXp(sheet, skillId, amount) {
    if (!skillDef(skillId) || !(amount > 0)) return 0;
    sheet.xp ??= {};
    sheet.skills ??= {};
    let gained = 0;
    sheet.xp[skillId] = (sheet.xp[skillId] ?? 0) + amount * xpMult(sheet);
    while ((sheet.skills[skillId] ?? 0) < SKILL_MAX && sheet.xp[skillId] >= xpNeeded(sheet.skills[skillId] ?? 0)) {
        sheet.xp[skillId] -= xpNeeded(sheet.skills[skillId] ?? 0);
        sheet.skills[skillId] = (sheet.skills[skillId] ?? 0) + 1;
        gained++;
    }
    sheet.xp[skillId] = Math.round(sheet.xp[skillId] * 10) / 10;
    return gained;
}

/** Penalty to all checks from hunger, exhaustion, stress and wounds. Returns { total, parts }. */
export function conditionPenalty(sheet, now = 0) {
    const parts = [];
    let needs = 0;
    for (const n of NEEDS) {
        const v = sheet.needs?.[n.id];
        if (v === undefined) continue;
        if (v <= 15) { needs += 2; parts.push(`${n.crit} -2`); }
        else if (v <= 35) { needs += 1; parts.push(`${n.low} -1`); }
    }
    needs = Math.min(needs, 4);
    let stress = 0;
    if ((sheet.stress ?? 0) >= 80) { stress = 2; parts.push('breaking point -2'); }
    else if ((sheet.stress ?? 0) >= 55) { stress = 1; parts.push('stressed -1'); }
    let wounds = 0;
    for (const i of sheet.injuries ?? []) wounds += { minor: 0, moderate: 1, severe: 2, critical: 3 }[i.severity] ?? 0;
    wounds = Math.min(wounds, 4);
    if (wounds) parts.push(`injuries -${wounds}`);
    const body = bodyPenalty(sheet, now);
    parts.push(...body.parts.filter(p => !p.includes('attacks')));
    return { total: needs + stress + wounds + body.all, parts, attack: body.attack, legs: body.legs };
}

/**
 * The core roll of the game: 2d10 + skill + attribute modifier - condition penalties, against a difficulty.
 * Two dice give a bell curve, so skill matters more than luck. Double 10 is a critical, double 1 a fumble.
 */
export function skillCheck(sheet, skillId, dc, { mod = 0, now = 0 } = {}) {
    const def = skillDef(skillId);
    if (!def) throw new Error(`unknown skill "${skillId}"`);
    const d1 = 1 + Math.floor(Math.random() * 10), d2 = 1 + Math.floor(Math.random() * 10);
    const skill = skillOf(sheet, skillId);
    const attrMod = attrOf(sheet, def.attr) - 5;
    const pen = conditionPenalty(sheet, now);
    const untrained = skill === 0 ? -2 : 0;
    const bonus = skill + attrMod + untrained - pen.total + mod;
    const total = d1 + d2 + bonus;
    const crit = d1 === 10 && d2 === 10;
    const fumble = d1 === 1 && d2 === 1;
    const success = crit || (!fumble && total >= dc);
    // No XP for checks that could not fail; failure teaches a little more than success.
    const trivial = 2 + bonus >= dc;
    const xp = trivial ? 0 : Math.max(3, dc - 6) + (success ? 0 : 3);
    const levels = gainXp(sheet, skillId, xp);
    return { skillId, name: def.name, dc, d1, d2, skill, attrMod, untrained, penalty: pen, mod, bonus, total, success, crit, fumble, margin: total - dc, xp, levels };
}

export function describeCheck(sheet, r) {
    const outcome = r.crit ? 'CRITICAL SUCCESS' : r.fumble ? 'FUMBLE' : r.success ? (r.margin >= 5 ? 'clear success' : 'success') : (r.margin <= -5 ? 'bad failure' : 'failure');
    return `${sheet.name} ${r.name} check vs ${r.dc}: rolled ${r.d1}+${r.d2} ${r.bonus >= 0 ? '+' : ''}${r.bonus} = ${r.total}. ${outcome}.`;
}
