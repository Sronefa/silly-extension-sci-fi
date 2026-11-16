// On-foot tactical combat. Zones with cover, line of sight and distance; each turn is a move,
// an action and a bonus action. The player controls one character; everyone else acts on their own.
import { sideCall } from '../core/llm.js';
import { S, addLog } from '../core/state.js';
import { ctx, settings } from '../core/st.js';
import { uid, norm, pick as pickRng, clamp } from '../core/util.js';
import { WEAPONS, ARMOR, MEDS, ENEMIES, LAYOUTS, BODY_PARTS, partDef, WOUND_TYPES, BAND_NAMES, BARKS } from '../data/combat.js';
import {
    makeBody, ensureArmor, applyHit, woundTick, isDead, isDown, isBleeding, randomPart, bodyPenalty, useMed, countItem,
    syncHealth, part, describeBody,
} from './body.js';
import { attrOf, skillOf, conditionPenalty, gainXp, plating, skillCheck } from './character.js';
import { advanceTime, killPlayer } from './sim.js';

const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const d10 = () => 1 + Math.floor(Math.random() * 10);
const any = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const C = () => S()?.combat ?? null;

// ---------- Units ----------

export function sheetOf(u) {
    const st = S();
    if (u.ref === 'pc') return st.captain;
    if (u.ref) return st.crew.find(c => c.id === u.ref) ?? u.sheet;
    return u.sheet;
}

export const weaponOf = (u) => WEAPONS[sheetOf(u).weapon] ?? WEAPONS.fists;
export const isOut = (u) => u.dead || u.down || u.fled || u.surrendered;
export const unitById = (id) => C().units.find(u => u.id === id);
export const player = () => C().units.find(u => u.ref === 'pc');
export const foesOf = (u) => C().units.filter(x => x.side !== u.side && !isOut(x));
export const friendsOf = (u) => C().units.filter(x => x.side === u.side && x !== u && !isOut(x));

function enemySheet(tpl, name) {
    const sheet = {
        name,
        attrs: { str: 5, ref: tpl.ref, end: 5, int: 4, per: 5, pre: 4 },
        skills: { firearms: tpl.skill, melee: tpl.skill },
        xp: {}, traits: [], flaws: [], cyber: [], injuries: [],
        weapon: tpl.weapon, armor: tpl.armor,
    };
    sheet.body = makeBody(Math.round(375 * tpl.tough));
    syncHealth(sheet);
    ensureArmor(sheet);
    return sheet;
}

function guessTemplate(name) {
    const n = norm(name);
    const direct = Object.values(ENEMIES).find(e => e.id === n || norm(e.name) === n) ?? Object.values(ENEMIES).find(e => n.includes(e.id) || norm(e.name).includes(n));
    if (direct) return { tpl: direct, custom: !(direct.id === n || norm(direct.name) === n) && !n.includes(direct.id) ? name : (direct.id === n ? null : name) };
    const map = [
        [/drone|bot|robot|synth|android|mech/, 'drone'], [/turret|sentry/, 'turret'], [/marine|soldier|trooper|legion|commando/, 'marine'],
        [/guard|security|police|officer|cop|enforcer/, 'guard'], [/merc|contractor|operative|agent|assassin|hunter/, 'merc'],
        [/hound|beast|creature|animal|feral|wolf|rat/, 'beast'], [/sniper|marksman|sharpshooter/, 'sniper'],
        [/thug|brawler|drunk|punk/, 'thug'], [/gang|ganger|scav|scavenger|smuggler/, 'ganger'], [/civilian|worker|crew/, 'civilian'],
        [/heavy|juggernaut|brute/, 'heavy'], [/power armor|exo/, 'trooper'],
    ];
    for (const [re, id] of map) if (re.test(n)) return { tpl: ENEMIES[id], custom: name };
    return { tpl: ENEMIES.pirate, custom: name };
}

/**
 * Parses the enemy part of a combat tag: `pirate 3 "Captain Rhee" merc weapon=sniper`.
 * Returns [{ tpl, name, count, weapon, armor }].
 */
export function parseEnemies(tokens) {
    const groups = [];
    for (const tok of tokens) {
        if (/^\d+$/.test(tok) && groups.length) { groups[groups.length - 1].count = clamp(Number(tok), 1, 8); continue; }
        const xm = /^x(\d+)$/i.exec(tok);
        if (xm && groups.length) { groups[groups.length - 1].count = clamp(Number(xm[1]), 1, 8); continue; }
        const kv = /^(weapon|armor)=(.+)$/i.exec(tok);
        if (kv && groups.length) {
            const table = kv[1].toLowerCase() === 'weapon' ? WEAPONS : ARMOR;
            const found = Object.values(table).find(x => x.id === norm(kv[2]) || norm(x.name).includes(norm(kv[2])));
            if (found) groups[groups.length - 1][kv[1].toLowerCase()] = found.id;
            continue;
        }
        if (/^(ambush|surprise|ambushed|surprised)$/i.test(tok)) continue;
        const { tpl, custom } = guessTemplate(tok);
        groups.push({ tpl, name: custom ?? tpl.name, count: 1 });
    }
    return groups;
}

function pickLayout(scene) {
    const n = norm(scene);
    const found = Object.values(LAYOUTS).find(l => l.keys.some(k => n.includes(k)));
    return found ?? any(Object.values(LAYOUTS));
}

// ---------- Geometry ----------

export function neighbors(i) {
    const out = [];
    for (const [a, b, sight] of C().links) {
        if (a === i) out.push({ to: b, sight });
        else if (b === i) out.push({ to: a, sight });
    }
    return out;
}

function bfs(from, sightOnly) {
    const dist = new Map([[from, 0]]);
    const queue = [from];
    while (queue.length) {
        const cur = queue.shift();
        for (const n of neighbors(cur)) {
            if (sightOnly && !n.sight) continue;
            if (!dist.has(n.to)) { dist.set(n.to, dist.get(cur) + 1); queue.push(n.to); }
        }
    }
    return dist;
}

export const zoneDist = (a, b) => bfs(a, false).get(b) ?? 99;
/** You can see into the same zone, any directly connected zone, and along chains of open links. */
export const hasLos = (a, b) => a === b || neighbors(a).some(n => n.to === b) || bfs(a, true).has(b);
export const bandOf = (a, b) => Math.min(3, zoneDist(a, b));

function stepToward(from, to) {
    const dist = bfs(to, false);
    let best = null;
    for (const n of neighbors(from)) {
        const d = dist.get(n.to) ?? 99;
        if (best === null || d < best.d) best = { to: n.to, d };
    }
    return best && best.d < (dist.get(from) ?? 99) ? best.to : null;
}

// ---------- Log and chatter ----------

function log(text, kind = '') {
    const c = C();
    const entry = { id: uid('l'), text, kind, round: c.round };
    c.log.push(entry);
    if (c.log.length > 200) c.log.shift();
    return entry;
}

let speechBusy = false;
const redrawHooks = [];
export function onCombatRedraw(fn) { redrawHooks.push(fn); }

function say(u, kind, detail = '') {
    const c = C();
    const sheet = sheetOf(u);
    if (ENEMIES[u.tpl]?.machine) return;
    const entry = log(`${sheet.name}: "${any(BARKS[kind] ?? BARKS.start)}"`, 'say');
    const cfg = settings();
    if (!cfg.combatSpeech || speechBusy || (c.speechCalls ?? 0) >= 6) return;
    c.speechCalls = (c.speechCalls ?? 0) + 1;
    speechBusy = true;
    const prompt = `Scene: a firefight at ${c.scene}. ${sheet.name}${u.side === 'enemy' ? ' (hostile)' : ' (an ally of the protagonist)'} ${detail || kind}. Write only the single short line they shout, in character, at most 12 words. No quotation marks, no narration.`;
    sideCall({ prompt, system: 'You write terse, gritty combat barks for a grounded science fiction story.', maxTokens: 40 })
        .then((text) => {
            const line = String(text ?? '').split('\n')[0].replace(/^["'“]+|["'”]+$/g, '').trim();
            if (line && C() === c) { entry.text = `${sheet.name}: "${line.slice(0, 140)}"`; redrawHooks.forEach(fn => fn()); }
        })
        .catch(() => { /* keep the canned line */ })
        .finally(() => { speechBusy = false; });
}

// ---------- Setup ----------

/**
 * Starts a fight. layout, when given, is a ground of its own ({ zones, links }, as in LAYOUTS),
 * such as the compartments of a wreck around the one being entered.
 */
export function startCombat({ scene = 'Unknown ground', groups = [], surprise = null, layout: custom = null } = {}) {
    const st = S();
    if (!st || st.dead) throw new Error('no living character');
    if (st.combat) throw new Error('a fight is already in progress');
    if (!groups.length) throw new Error('no enemies given');
    const layout = custom ?? pickLayout(scene);
    const zones = layout.zones.map((z, i) => ({ id: i, ...z }));
    const entry = zones.find(z => z.entry) ?? zones[0];
    const far = zones.filter(z => z.far);
    const mid = zones.filter(z => !z.entry && !z.far);
    const units = [];
    const mk = (extra) => ({ zone: entry.id, moved: false, acted: false, bonus: false, hunker: false, aim: 0, overwatch: false, mag: 0, meds: 1, ...extra });

    units.push(mk({ id: 'pc', ref: 'pc', side: 'ally' }));
    for (const c of st.crew) {
        if (isDown(c)) continue;
        units.push(mk({ id: c.id, ref: c.id, side: 'ally', style: WEAPONS[c.weapon]?.melee ? 'rush' : 'cover', mags: 3 }));
    }
    let n = 0;
    for (const g of groups) {
        for (let i = 0; i < g.count; i++) {
            if (n >= 12) break;
            const label = g.count > 1 ? `${g.name} ${String.fromCharCode(65 + i)}` : g.name;
            const sheet = enemySheet(g.tpl, label);
            if (g.weapon) sheet.weapon = g.weapon;
            if (g.armor) { sheet.armor = g.armor; sheet.armorFor = null; ensureArmor(sheet); }
            const zone = (n % 3 === 2 && mid.length ? any(mid) : any(far.length ? far : mid)).id;
            units.push(mk({ id: uid('e'), side: 'enemy', tpl: g.tpl.id, sheet, zone, style: g.tpl.style, morale: g.tpl.morale, mags: 3, static: !!g.tpl.static }));
            n++;
        }
    }
    for (const u of units) {
        const sh = sheetOf(u);
        u.mag = weaponOf(u).mag ?? 0;
        u.init = d10() + d10() + attrOf(sh, 'ref') - 5 + (surprise === u.side ? 6 : 0);
        ensureArmor(sh);
    }
    const order = [...units].sort((a, b) => b.init - a.init).map(u => u.id);
    st.combat = {
        scene, layout: custom ? 'custom' : Object.keys(LAYOUTS).find(k => LAYOUTS[k] === layout), zones, links: layout.links.map(l => [...l]),
        units, order, turn: -1, round: 1, log: [], over: null, startMinutes: st.minutes,
        stats: { shots: 0, hits: 0, kills: [], used: [], taken: 0 }, prevAlert: st.alert,
    };
    st.alert = 'red';
    log(`Contact at ${scene}. ${units.filter(u => u.side === 'enemy').length} hostile${units.filter(u => u.side === 'enemy').length === 1 ? '' : 's'}.`, 'sys');
    if (surprise === 'enemy') log('Ambush! They have the drop on you.', 'sys');
    if (surprise === 'ally') log('You have the element of surprise.', 'sys');
    const loud = units.find(u => u.side === 'enemy' && !ENEMIES[u.tpl]?.machine);
    if (loud) say(loud, 'start', 'has just spotted the protagonist and opens the fight');
    addLog(`Combat started: ${scene}.`, 'combat');
    advance();
    return st.combat;
}

// ---------- Attack maths ----------

export function coverPenalty(attacker, target) {
    const c = C();
    if (attacker.zone === target.zone) return 0;
    const z = c.zones[target.zone];
    return z.cover * 2 + (target.hunker ? (z.cover > 0 ? 2 : 1) : 0);
}

export function attackBonus(attacker, target, { called = null } = {}) {
    const c = C();
    const st = S();
    const sh = sheetOf(attacker);
    const w = weaponOf(attacker);
    const band = bandOf(attacker.zone, target.zone);
    const acc = w.acc[band];
    if (acc === null || acc === undefined) return null;
    const skill = skillOf(sh, w.skill);
    const cond = attacker.side === 'ally' ? conditionPenalty(sh, st.minutes) : { total: bodyPenalty(sh, st.minutes).all, attack: bodyPenalty(sh, st.minutes).attack };
    let bonus = skill + (skill === 0 ? -2 : 0) + attrOf(sh, w.melee ? 'str' : 'per') - 5 + acc;
    bonus += attacker.aim ? 2 : 0;
    bonus += sh.body?.stim > 0 ? 2 : 0;
    bonus -= cond.total + (cond.attack ?? 0);
    bonus -= coverPenalty(attacker, target);
    if (c.zones[attacker.zone].high && !c.zones[target.zone].high && band > 0) bonus += 1;
    if (ARMOR[sh.armor]?.bulky) bonus -= 1;
    if (called) bonus -= called === 'head' ? 6 : 4;
    return bonus;
}

export const defenseOf = (target) => 12 + attrOf(sheetOf(target), 'ref') - 5 + (target.down ? -4 : 0);

/** Probability that 2d10 + bonus meets the difficulty (double 1 always misses, double 10 always hits). */
export function hitChance(bonus, dc) {
    let ok = 0;
    for (let a = 1; a <= 10; a++) {
        for (let b = 1; b <= 10; b++) {
            if (a === 10 && b === 10) ok++;
            else if (a === 1 && b === 1) continue;
            else if (a + b + bonus >= dc) ok++;
        }
    }
    return ok;
}

export function canAttack(attacker, target) {
    if (!hasLos(attacker.zone, target.zone)) return 'No line of sight';
    const w = weaponOf(attacker);
    if (attackBonus(attacker, target) === null) return w.melee ? 'Must be in the same zone' : 'Out of range';
    if (!w.melee && attacker.mag <= 0) return 'Magazine empty';
    return '';
}

function markOut(target, by) {
    const c = C();
    const sh = sheetOf(target);
    const fatal = isDead(sh) || sh.health <= 0;
    if (target.side === 'enemy') {
        target.dead = true;
        c.stats.kills.push(sh.name);
        log(`${sh.name} is ${fatal ? 'killed' : 'down and out of the fight'}.`, 'kill');
        if (by && by.side === 'ally' && Math.random() < 0.4) say(by, 'kill');
    } else if (target.ref === 'pc') {
        if (fatal) { target.dead = true; log(`${sh.name} is killed.`, 'kill'); }
        else { target.down = true; log(`${sh.name} goes down, bleeding out.`, 'kill'); }
        const friend = friendsOf(target)[0];
        if (friend) say(friend, 'allydown', 'just saw the protagonist go down');
    } else {
        if (fatal) { target.dead = true; log(`${sh.name} is killed.`, 'kill'); }
        else { target.down = true; log(`${sh.name} is down.`, 'kill'); }
    }
}

function resolveShot(attacker, target, { called = null, mod = 0, reaction = false } = {}) {
    const c = C();
    const ash = sheetOf(attacker), tsh = sheetOf(target);
    const w = weaponOf(attacker);
    const bonus = attackBonus(attacker, target, { called }) + mod;
    const dc = defenseOf(target);
    const a = d10(), b = d10();
    const crit = a === 10 && b === 10, fumble = a === 1 && b === 1;
    const hit = crit || (!fumble && a + b + bonus >= dc);
    const band = bandOf(attacker.zone, target.zone);
    if (attacker.side === 'ally') c.stats.shots++;
    const head = `${ash.name} ${reaction ? 'snap-fires' : w.melee ? 'attacks' : 'fires'} ${w.melee ? `with ${w.name}` : `the ${w.name}`} at ${tsh.name} (${BAND_NAMES[band].toLowerCase()}, ${hitChance(bonus, dc)}%)`;
    if (!hit) {
        log(`${head}: ${fumble ? 'a wild miss' : 'miss'} [${a}+${b}${bonus >= 0 ? '+' : ''}${bonus} vs ${dc}].`, attacker.side === 'ally' ? 'ally' : 'enemy');
        return { hit: false };
    }
    if (attacker.side === 'ally') c.stats.hits++;
    const partId = called ?? randomPart();
    let dmg = rnd(w.dmg[0], w.dmg[1]) * (crit ? 1.5 : 1);
    dmg = Math.max(1, dmg - plating(tsh));
    const r = applyHit(tsh, partId, w, dmg);
    let text;
    if (r.frame) text = `the power armor frame absorbs ${r.dmg}${r.armorBroke ? ' and FAILS' : ''}`;
    else if (r.blocked) text = `${partDef(partId).name.toLowerCase()} armor stops it (${r.dmg} blunt)${r.armorBroke ? ', armor wrecked' : ''}`;
    else text = `${crit ? 'CRITICAL ' : ''}hit to the ${partDef(partId).name.toLowerCase()} for ${r.dmg}${r.wounds.length ? `, ${r.wounds.map(x => WOUND_TYPES[x].name.toLowerCase()).join(' and ')}` : ''}${r.destroyed ? `, ${partDef(partId).name.toLowerCase()} destroyed` : ''}`;
    log(`${head}: ${text}.`, attacker.side === 'ally' ? 'ally' : 'enemy');
    if (target.side === 'ally') c.stats.taken += r.frame ? 0 : r.dmg;
    if (isDown(tsh) || tsh.health <= 0) markOut(target, attacker);
    else if (!r.frame && !r.blocked && target.side === 'ally' && target.ref !== 'pc' && Math.random() < 0.3) say(target, 'hurt', 'was just shot');
    return { hit: true, r };
}

function doAttack(attacker, target, opts = {}) {
    const w = weaponOf(attacker);
    const ash = sheetOf(attacker);
    const res = resolveShot(attacker, target, opts);
    if (!w.melee) attacker.mag = Math.max(0, attacker.mag - 1);
    // Automatic weapons get a follow-up round that is harder to control.
    if (w.burst && !opts.called && !isOut(target) && attacker.mag > 0) {
        resolveShot(attacker, target, { mod: -3 });
        attacker.mag = Math.max(0, attacker.mag - 1);
    }
    attacker.aim = 0;
    if (attacker.ref) gainXp(ash, w.skill, res.hit ? 3 : 4);
    return res;
}

/** Enemies on overwatch fire at a unit that just moved into view. */
function triggerOverwatch(mover) {
    for (const u of C().units) {
        if (isOut(u) || u.side === mover.side || !u.overwatch || isOut(mover)) continue;
        if (canAttack(u, mover)) continue;
        u.overwatch = false;
        resolveShot(u, mover, { mod: -2, reaction: true });
        if (!weaponOf(u).melee) u.mag = Math.max(0, u.mag - 1);
    }
}

function moveUnit(u, to) {
    const c = C();
    u.zone = to;
    u.hunker = false;
    u.aim = 0;
    log(`${sheetOf(u).name} moves to ${c.zones[to].name}.`, u.side === 'ally' ? 'ally' : 'enemy');
    triggerOverwatch(u);
}

// ---------- Player actions ----------

function need(cond, msg) { if (!cond) throw new Error(msg); }

function myTurn() {
    const c = C();
    need(c && !c.over, 'The fight is over');
    const u = unitById(c.order[c.turn]);
    need(u?.ref === 'pc', 'Not your turn');
    return u;
}

export const playerActions = {
    move(zoneId) {
        const u = myTurn();
        const legs = bodyPenalty(sheetOf(u), S().minutes).legs;
        need(!u.moved, 'You have already moved this turn');
        need(neighbors(u.zone).some(n => n.to === zoneId), 'That zone is not adjacent');
        if (legs >= 2) { need(!u.acted, 'With both legs out, moving takes your action'); u.acted = true; }
        u.moved = true;
        moveUnit(u, zoneId);
    },
    sprint(zoneId) {
        const u = myTurn();
        need(!u.acted, 'No action left');
        need(bodyPenalty(sheetOf(u), S().minutes).legs === 0, 'You cannot sprint on a wounded leg');
        need(neighbors(u.zone).some(n => n.to === zoneId), 'That zone is not adjacent');
        u.acted = true;
        moveUnit(u, zoneId);
    },
    attack(targetId, called = null) {
        const u = myTurn();
        need(!u.acted, 'No action left');
        const t = unitById(targetId);
        need(t && !isOut(t), 'No such target');
        const why = canAttack(u, t);
        need(!why, why);
        if (called) need(!weaponOf(u).burst || true, '');
        u.acted = true;
        doAttack(u, t, { called });
    },
    reload() {
        const u = myTurn();
        const w = weaponOf(u);
        need(!u.acted, 'No action left');
        need(!w.melee, 'Nothing to reload');
        need(u.mag < w.mag, 'Magazine is full');
        const inv = sheetOf(u).inventory;
        const m = inv.find(i => /^magazine$/i.test(i.name) && i.qty > 0);
        need(m, 'No spare magazines');
        m.qty--;
        if (m.qty <= 0) inv.splice(inv.indexOf(m), 1);
        u.mag = w.mag;
        u.acted = true;
        log(`${sheetOf(u).name} reloads.`, 'ally');
    },
    overwatch() {
        const u = myTurn();
        need(!u.acted, 'No action left');
        u.acted = true;
        u.overwatch = true;
        log(`${sheetOf(u).name} goes on overwatch.`, 'ally');
    },
    grenade(zoneId) {
        const u = myTurn();
        const c = C();
        need(!u.acted, 'No action left');
        const inv = sheetOf(u).inventory;
        const g = inv.find(i => /grenade/i.test(i.name) && i.qty > 0);
        need(g, 'No grenades');
        need(zoneDist(u.zone, zoneId) <= 2 && hasLos(u.zone, zoneId), 'Out of throwing range or sight');
        need(zoneId !== u.zone, 'Too close');
        g.qty--;
        if (g.qty <= 0) inv.splice(inv.indexOf(g), 1);
        u.acted = true;
        log(`${sheetOf(u).name} throws a frag grenade into ${c.zones[zoneId].name}.`, 'ally');
        const frag = { name: 'fragmentation', pen: 3, dmg: [30, 55] };
        for (const t of c.units.filter(x => !isOut(x) && x.zone === zoneId)) {
            const hits = c.zones[zoneId].cover === 2 && t.hunker ? 1 : 2;
            const tsh = sheetOf(t);
            let total = 0;
            for (let i = 0; i < hits; i++) total += applyHit(tsh, randomPart(), frag, rnd(frag.dmg[0], frag.dmg[1])).dmg;
            log(`${tsh.name} is caught in the blast (${total}).`, 'ally');
            if (isDown(tsh) || tsh.health <= 0) markOut(t, u);
        }
        c.stats.used.push('Frag Grenade');
    },
    treat(medId, partId) {
        const u = myTurn();
        const m = MEDS[medId];
        need(m, 'Unknown item');
        const sh = sheetOf(u);
        if (m.quick) need(!u.bonus, 'No bonus action left');
        else need(!u.acted, 'No action left');
        need(m.time <= 2, `${m.name} takes too long to use in a fight`);
        const r = useMed(sh, medId, partId, sh.inventory, { now: S().minutes });
        need(r.ok, r.text);
        if (m.quick) u.bonus = true; else u.acted = true;
        gainXp(sh, 'medicine', 4);
        C().stats.used.push(m.name);
        log(`${sh.name}: ${r.text}`, 'ally');
    },
    hunker() {
        const u = myTurn();
        need(!u.bonus, 'No bonus action left');
        u.bonus = true;
        u.hunker = true;
        log(`${sheetOf(u).name} gets down behind ${C().zones[u.zone].cover ? 'cover' : 'whatever there is'}.`, 'ally');
    },
    aim() {
        const u = myTurn();
        need(!u.bonus, 'No bonus action left');
        u.bonus = true;
        u.aim = 1;
        log(`${sheetOf(u).name} steadies their aim.`, 'ally');
    },
    disengage() {
        const u = myTurn();
        const c = C();
        need(!u.acted, 'No action left');
        need(c.zones[u.zone].entry, 'You can only break away from the zone you came in by');
        need(!c.units.some(x => x.side === 'enemy' && !isOut(x) && x.zone === u.zone), 'An enemy is on top of you');
        log(`${sheetOf(u).name} breaks contact and withdraws.`, 'sys');
        finish('escaped');
    },
    endTurn() {
        myTurn();
        advance();
    },
};

// ---------- NPC behaviour ----------

function bestTarget(u) {
    let best = null;
    for (const t of foesOf(u)) {
        if (canAttack(u, t)) continue;
        const chance = hitChance(attackBonus(u, t), defenseOf(t));
        const score = chance + (t.down ? -40 : 0) + (sheetOf(t).health < sheetOf(t).maxHealth * 0.5 ? 10 : 0);
        if (!best || score > best.score) best = { t, score, chance };
    }
    return best;
}

function nearestFoe(u) {
    let best = null;
    for (const t of foesOf(u)) {
        const d = zoneDist(u.zone, t.zone);
        if (!best || d < best.d) best = { t, d };
    }
    return best?.t ?? null;
}

function npcTurn(u) {
    const c = C();
    const sh = sheetOf(u);
    const w = weaponOf(u);
    const tpl = ENEMIES[u.tpl];
    // Morale: badly hurt or outnumbered enemies may break.
    if (u.side === 'enemy' && u.morale > 0 && !tpl?.machine) {
        const hurt = sh.health / sh.maxHealth;
        const alone = friendsOf(u).length === 0 && c.units.filter(x => x.side === 'enemy').length > 1;
        if ((hurt < u.morale || (alone && hurt < 0.8)) && Math.random() < 0.35) {
            if (Math.random() < 0.5 || bodyPenalty(sh).legs > 0) {
                u.surrendered = true;
                log(`${sh.name} throws down their weapon and surrenders.`, 'kill');
            } else {
                u.fled = true;
                say(u, 'flee', 'is breaking and running from the fight');
                log(`${sh.name} breaks and runs.`, 'kill');
            }
            return;
        }
    }
    // Stop a serious bleed before anything else.
    if (u.meds > 0 && Object.values(sh.body.parts).some(p => p.w.includes('hemorrhage')) && Math.random() < 0.7) {
        for (const p of Object.values(sh.body.parts)) p.w = p.w.filter(x => x !== 'hemorrhage' && x !== 'bleed');
        u.meds--;
        log(`${sh.name} clamps a wound.`, u.side === 'ally' ? 'ally' : 'enemy');
        if (c.zones[u.zone].cover) u.hunker = true;
        return;
    }
    if (!w.melee && u.mag <= 0) {
        if (u.mags > 0) { u.mags--; u.mag = w.mag; log(`${sh.name} reloads.`, u.side === 'ally' ? 'ally' : 'enemy'); if (Math.random() < 0.25) say(u, 'reload'); }
        else { sh.weapon = 'fists'; log(`${sh.name} is out of ammunition.`, u.side === 'ally' ? 'ally' : 'enemy'); }
        if (c.zones[u.zone].cover) u.hunker = true;
        return;
    }
    let target = bestTarget(u);
    const legs = bodyPenalty(sh).legs;
    const canMove = !u.static && legs < 2;
    const style = w.melee ? 'rush' : (u.style ?? 'cover');
    // Decide on movement.
    if (canMove) {
        const foe = nearestFoe(u);
        let dest = null;
        if (!target && foe) dest = stepToward(u.zone, foe.zone);
        else if (target && style === 'rush' && bandOf(u.zone, target.t.zone) > 0) dest = stepToward(u.zone, target.t.zone);
        else if (target && style === 'push' && (bandOf(u.zone, target.t.zone) > 1 || target.chance < 30)) dest = stepToward(u.zone, target.t.zone);
        else if (target && style === 'cover' && c.zones[u.zone].cover === 0) {
            const opts = neighbors(u.zone).map(n => c.zones[n.to]).filter(z => z.cover > 0 && foesOf(u).some(f => hasLos(z.id, f.zone)));
            if (opts.length) dest = opts.sort((a, b) => b.cover - a.cover)[0].id;
        } else if (target && target.chance < 15 && style !== 'hold' && foe) dest = stepToward(u.zone, foe.zone);
        if (dest !== null && dest !== undefined) {
            moveUnit(u, dest);
            u.moved = true;
            if (isOut(u)) return;
            target = bestTarget(u);
        }
    }
    if (target) {
        doAttack(u, target.t);
    } else if (!u.moved && !w.melee) {
        u.overwatch = true;
        log(`${sh.name} covers the approach.`, u.side === 'ally' ? 'ally' : 'enemy');
    }
    if (isOut(u)) return;
    // Bonus action: get down if there is cover, otherwise steady for the next shot.
    if (c.zones[u.zone].cover > 0 && style !== 'rush') u.hunker = true;
    else if (!w.melee) u.aim = 1;
}

// ---------- Turn engine ----------

function checkEnd() {
    const c = C();
    if (c.over) return true;
    const enemies = c.units.filter(u => u.side === 'enemy' && !isOut(u));
    const allies = c.units.filter(u => u.side === 'ally' && !isOut(u));
    if (!enemies.length) { finish('victory'); return true; }
    if (!allies.length) { finish('defeat'); return true; }
    return false;
}

function beginTurn(u) {
    const sh = sheetOf(u);
    u.moved = false; u.acted = false; u.bonus = false;
    u.hunker = false; u.overwatch = false;
    if (sh.body.stim > 0) sh.body.stim--;
    const lost = woundTick(sh, { rounds: 1 });
    if (lost > 0 && (isDown(sh) || sh.health <= 0)) {
        log(`${sh.name} collapses from blood loss.`, 'kill');
        markOut(u, null);
        return false;
    }
    return true;
}

/** Moves to the next unit and runs every non-player turn until the player has to decide something. */
export function advance() {
    const c = C();
    let guard = 0;
    while (!c.over && guard++ < 400) {
        if (checkEnd()) break;
        c.turn++;
        if (c.turn >= c.order.length) {
            c.turn = 0;
            c.round++;
            // Downed allies keep bleeding while the fight goes on.
            for (const u of c.units.filter(x => x.down && !x.dead)) {
                const sh = sheetOf(u);
                woundTick(sh, { rounds: 1 });
                if (isDead(sh) || sh.health <= 0) { u.dead = true; log(`${sh.name} dies of their wounds.`, 'kill'); }
            }
            if (c.round > 40) { log('The fight burns itself out.', 'sys'); finish('stalemate'); break; }
        }
        const u = unitById(c.order[c.turn]);
        if (!u || isOut(u)) continue;
        if (!beginTurn(u)) continue;
        if (u.ref === 'pc') break;
        npcTurn(u);
    }
    if (!c.over) checkEnd();
}

// ---------- Ending ----------

function finish(result) {
    const st = S();
    const c = C();
    if (c.over) return;
    c.over = result;
    const pc = st.captain;
    const pu = player();
    const lines = [];
    const enemies = c.units.filter(u => u.side === 'enemy');
    const killed = enemies.filter(u => u.dead).map(u => sheetOf(u).name);
    const fled = enemies.filter(u => u.fled).map(u => sheetOf(u).name);
    const gave = enemies.filter(u => u.surrendered).map(u => sheetOf(u).name);
    const standing = enemies.filter(u => !isOut(u)).map(u => sheetOf(u).name);
    const outcome = { victory: 'The player side won', defeat: 'The player side was defeated', escaped: 'The player broke contact and withdrew', stalemate: 'Both sides broke off' }[result];
    lines.push(`${outcome} after ${c.round} round${c.round === 1 ? '' : 's'} at ${c.scene}.`);
    if (killed.length) lines.push(`Enemies killed or incapacitated: ${killed.join(', ')}.`);
    if (gave.length) lines.push(`Surrendered and alive: ${gave.join(', ')}.`);
    if (fled.length) lines.push(`Fled: ${fled.join(', ')}.`);
    if (standing.length) lines.push(`Enemies still standing: ${standing.join(', ')}.`);
    for (const u of c.units.filter(x => x.side === 'ally')) {
        const sh = sheetOf(u);
        const body = describeBody(sh);
        const state = u.dead ? 'KILLED' : u.down ? 'DOWN and dying without help' : body ? 'wounded' : 'unhurt';
        lines.push(`${sh.name}: ${state}${body && !u.dead ? `. ${body}` : ''}.`);
    }
    if (c.stats.used.length) lines.push(`Used: ${c.stats.used.join(', ')}.`);

    // A downed player lives or dies on who is left to help.
    if (pu.dead || isDead(pc)) {
        killPlayer(`killed in the fight at ${c.scene}`);
    } else if (pu.down && result === 'victory') {
        const medic = c.units.filter(u => u.side === 'ally' && u.ref !== 'pc' && !isOut(u)).map(sheetOf).sort((a, b) => skillOf(b, 'medicine') - skillOf(a, 'medicine'))[0];
        if (medic) {
            const r = skillCheck(medic, 'medicine', 13, { now: st.minutes });
            if (r.success) {
                const t = part(pc, 'thorax');
                t.hp = Math.max(t.hp, Math.round(t.max * 0.15));
                for (const p of Object.values(pc.body.parts)) p.w = p.w.filter(x => x !== 'hemorrhage' && x !== 'bleed');
                syncHealth(pc);
                lines.push(`${medic.name} stabilised ${pc.name} (Medicine ${r.total} vs 13).`);
            } else {
                lines.push(`${medic.name} could not stabilise ${pc.name} (Medicine ${r.total} vs 13).`);
                killPlayer(`died of wounds at ${c.scene}`);
            }
        } else {
            lines.push(`${pc.name} is down with nobody to help.`);
        }
    }
    // Spoils of a won fight.
    if (result === 'victory' && !st.dead) {
        const loot = [];
        const cr = killed.length * rnd(20, 160);
        if (cr) { pc.credits += cr; loot.push(`${cr} cr`); }
        const give = (name, qty) => {
            const it = pc.inventory.find(i => i.name === name);
            if (it) it.qty += qty; else pc.inventory.push({ id: uid('it'), name, qty });
            loot.push(`${name} x${qty}`);
        };
        if (enemies.some(u => !ENEMIES[u.tpl]?.machine && !WEAPONS[sheetOf(u).weapon]?.melee)) give('Magazine', rnd(1, 2));
        if (Math.random() < 0.5) give(any(['Dermal Patch', 'Dermal Patch', 'Hemoclamp', 'Analgesic Stim', 'Medkit']), 1);
        if (loot.length) lines.push(`Recovered: ${loot.join(', ')}.`);
    }
    const summary = lines.join(' ');
    const minutes = Math.max(1, Math.ceil(c.round / 8));
    st.alert = c.prevAlert === 'red' ? 'yellow' : (c.prevAlert ?? 'green');
    st.lastCombat = { result, scene: c.scene, rounds: c.round, summary, lines, log: c.log.slice(-60).map(l => l.text), at: st.minutes };
    st.combat = null;
    if (!st.dead) advanceTime(minutes);
    addLog(`Combat ended (${result}): ${c.scene}, ${c.round} rounds.`, 'combat');
    st.pendingEvent = `COMBAT RESULT, resolved by the game rules. Narrate the whole fight now as one vivid passage that matches these facts exactly, then continue the scene: ${summary}`
        + (result === 'defeat' && !st.dead ? ` ${pc.name} is at the mercy of the victors: decide what they do (capture, rob, leave for dead). Only use the die command if they finish ${pc.name} off.` : '');
}

/** Used by the `combat` command and the encounter widget. */
export function startFromTokens(tokens) {
    const scene = tokens[0] && !/^\d+$/.test(tokens[0]) ? tokens[0] : 'Unknown ground';
    const rest = tokens.slice(1);
    const surprise = rest.some(t => /^(ambush|ambushed)$/i.test(t)) ? 'enemy' : rest.some(t => /^(surprise|surprised)$/i.test(t)) ? 'ally' : null;
    const groups = parseEnemies(rest);
    startCombat({ scene, groups, surprise });
    const n = C()?.units.filter(u => u.side === 'enemy').length ?? 0;
    return `Combat started at ${scene}: ${n} hostile${n === 1 ? '' : 's'}`;
}

export function abortCombat() {
    const st = S();
    if (!st?.combat) return;
    st.alert = st.combat.prevAlert ?? 'green';
    st.combat = null;
}

void pickRng; void countItem; void isBleeding;
