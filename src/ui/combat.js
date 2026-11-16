// Combat screen, body display with treatment, daily activities, and the encounter starter.
import { registerTab, registerWidget, registerActions, gauge, btn, openHud, redraw } from './hud.js';
import { S, commit, onChange, addLog } from '../core/state.js';
import { toast, ctx, settings } from '../core/st.js';
import { esc } from '../core/util.js';
import { BODY_PARTS, partDef, WOUND_TYPES, WEAPONS, ARMOR, MEDS, ENEMIES, COVER_NAMES, BAND_NAMES } from '../data/combat.js';
import {
    C, sheetOf, weaponOf, isOut, player, playerActions, neighbors, hasLos, bandOf, zoneDist, canAttack, attackBonus, defenseOf,
    hitChance, coverPenalty, startFromTokens, abortCombat, onCombatRedraw,
} from '../systems/combat.js';
import { part, usefulMeds, useMed, countItem, ensureArmor, isDown, bodyPenalty } from '../systems/body.js';
import { skillCheck, skillOf, gainXp } from '../systems/character.js';
import { advanceTime, registerCommand, runCommand, transitInfo, fmtDuration } from '../systems/sim.js';
import { registerPromptSection } from '../core/ailink.js';
import { blip } from './sfx.js';

let target = null;      // selected enemy unit id
let called = '';        // called shot body part
let grenadeMode = false;
let selPart = 'thorax';
let bodyWho = 'pc';

const hpClass = (p) => (p.hp <= 0 ? 'dead' : p.hp < p.max * 0.35 ? 'crit' : p.hp < p.max * 0.7 ? 'warn' : 'ok');

// A simple front-facing figure. Each shape is one body part.
const DOLL = {
    head: '<circle cx="50" cy="13" r="10"/>',
    thorax: '<path d="M33 26 H67 L64 58 H36 Z"/>',
    stomach: '<path d="M36 60 H64 L62 82 H38 Z"/>',
    rarm: '<path d="M30 27 L20 31 L15 70 L24 72 L31 44 Z"/>',
    larm: '<path d="M70 27 L80 31 L85 70 L76 72 L69 44 Z"/>',
    rleg: '<path d="M38 84 H49 L47 132 H37 Z"/>',
    lleg: '<path d="M51 84 H62 L63 132 H53 Z"/>',
};

function bodySheet(st) {
    if (bodyWho === 'pc') return st.captain;
    return st.crew.find(c => c.id === bodyWho) ?? st.captain;
}

function dollSvg(sheet) {
    return `<svg class="sf-doll" viewBox="0 0 100 136">${BODY_PARTS.map(d => {
        const p = part(sheet, d.id);
        const bleeding = p.w.includes('bleed') || p.w.includes('hemorrhage');
        return `<g class="sf-doll-part ${hpClass(p)}${selPart === d.id ? ' sel' : ''}${bleeding ? ' bleeding' : ''}" data-sf="body-part" data-part="${d.id}">${DOLL[d.id]}</g>`;
    }).join('')}</svg>`;
}

function bodyHtml(st) {
    const sheet = bodySheet(st);
    const inv = st.captain.inventory;
    const a = ensureArmor(sheet);
    const sel = part(sheet, selPart);
    const def = partDef(selPart);
    const meds = usefulMeds(sheet, selPart, inv);
    const quick = Object.values(MEDS).filter(m => (m.painkiller || m.combatStim || m.healAll) && countItem(inv, m.name) > 0);
    const people = [st.captain, ...st.crew];
    const rows = BODY_PARTS.map(d => {
        const p = part(sheet, d.id);
        return `<div class="sf-part-row ${hpClass(p)}${selPart === d.id ? ' sel' : ''}" data-sf="body-part" data-part="${d.id}">
            <span>${d.name}${a.covers.includes(d.id) && (a.powered || sheet.armorDur > 0) ? ' <i class="fa-solid fa-shield-halved"></i>' : ''}</span>
            <b>${p.hp <= 0 ? 'LOST' : `${Math.round(p.hp)}/${p.max}`}</b>
            ${p.w.length ? `<em>${p.w.map(w => WOUND_TYPES[w].short).join(' ')}</em>` : ''}
        </div>`;
    }).join('');
    const pen = bodyPenalty(sheet, st.minutes);
    return `${people.length > 1 ? `<select class="sf-input" data-sf-change="body-who">${people.map(p => `<option value="${p === st.captain ? 'pc' : p.id}"${(p === st.captain ? 'pc' : p.id) === bodyWho ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
    <div class="sf-body-wrap">${dollSvg(sheet)}<div class="sf-part-list">${rows}</div></div>
    ${a.id !== 'none' ? (a.powered
        ? gauge('Armor frame', sheet.frame, a.frame, { text: `${sheet.frame}/${a.frame}` })
        : `<small class="sf-dim">${esc(a.name)} · class ${a.cls}</small>` + gauge('Armor', sheet.armorDur, a.dur)) : '<small class="sf-dim">No armor. A rifle round will put you down.</small>'}
    ${pen.parts.length ? `<div class="sf-warn-line"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(pen.parts.join(', '))}${pen.legs ? `, ${pen.legs === 1 ? 'cannot sprint' : 'can barely move'}` : ''}</div>` : ''}
    ${sheet.body.painUntil > st.minutes ? `<small class="sf-dim">Painkillers active for ${Math.round(sheet.body.painUntil - st.minutes)} more minutes.</small>` : ''}
    <div class="sf-sub">${def.name}: ${sel.hp <= 0 ? 'destroyed' : `${Math.round(sel.hp)}/${sel.max}`}${sel.w.length ? ` · ${sel.w.map(w => WOUND_TYPES[w].name).join(', ')}` : ''}</div>
    <div class="sf-actions">
        ${meds.map(m => btn('body-treat', `${m.name} (${countItem(inv, m.name)})`, { icon: 'fa-kit-medical', cls: 'primary', data: { med: m.id }, title: m.desc })).join('')}
        ${quick.map(m => btn('body-treat', `${m.name} (${countItem(inv, m.name)})`, { icon: 'fa-syringe', data: { med: m.id }, title: m.desc })).join('')}
        ${!meds.length && !quick.length ? '<small class="sf-dim">Nothing you carry would help this.</small>' : ''}
    </div>`;
}

// ---------- Battlefield ----------

const ZW = 112, ZH = 84, PAD = 6;

function visibleTo(u, x) {
    return x.side === u.side || hasLos(u.zone, x.zone);
}

function fieldSvg(c) {
    const me = player();
    const cols = Math.max(...c.zones.map(z => z.x)) + 1, rows = Math.max(...c.zones.map(z => z.y)) + 1;
    const cx = (z) => z.x * ZW + ZW / 2, cy = (z) => z.y * ZH + ZH / 2;
    const adj = neighbors(me.zone).map(n => n.to);
    const myTurn = c.order[c.turn] === 'pc' && !isOut(me);
    const links = c.links.map(([a, b, sight]) => `<line class="sf-zlink${sight ? '' : ' blocked'}" x1="${cx(c.zones[a])}" y1="${cy(c.zones[a])}" x2="${cx(c.zones[b])}" y2="${cy(c.zones[b])}"/>`).join('');
    const zones = c.zones.map(z => {
        const seen = hasLos(me.zone, z.id);
        const here = z.id === me.zone;
        const reach = myTurn && adj.includes(z.id) && (!me.moved || !me.acted);
        const gren = grenadeMode && !here && seen && zoneDist(me.zone, z.id) <= 2;
        const units = c.units.filter(u => u.zone === z.id && !u.fled && !u.dead && !u.surrendered);
        const allies = units.filter(u => u.side === 'ally');
        const foes = units.filter(u => u.side === 'enemy');
        const x0 = z.x * ZW + PAD, y0 = z.y * ZH + PAD, w = ZW - PAD * 2, h = ZH - PAD * 2;
        const token = (u, i, side) => {
            const sh = sheetOf(u);
            const tx = side === 'ally' ? x0 + 12 + i * 17 : x0 + w - 12 - i * 17;
            const ty = y0 + h - 14;
            const frac = sh.health / sh.maxHealth;
            return `<g class="sf-token ${side}${u.ref === 'pc' ? ' pc' : ''}${u.id === target ? ' targeted' : ''}${u.down ? ' down' : ''}${u.hunker ? ' hunker' : ''}" ${side === 'enemy' ? `data-sf="cb-target" data-id="${u.id}"` : ''}>
                <circle cx="${tx}" cy="${ty}" r="7.5"/><text x="${tx}" y="${ty + 2.6}">${esc(u.ref === 'pc' ? '★' : sh.name.replace(/[^A-Za-z ]/g, '').split(' ').map(s => s[0]).join('').slice(-2).toUpperCase() || '?')}</text>
                <rect x="${tx - 7}" y="${ty + 9}" width="14" height="2" class="sf-token-hpbg"/><rect x="${tx - 7}" y="${ty + 9}" width="${14 * Math.max(0, frac)}" height="2" class="sf-token-hp"/>
            </g>`;
        };
        return `<g class="sf-zone cover${z.cover}${here ? ' here' : ''}${seen ? '' : ' unseen'}${reach && !grenadeMode ? ' reach' : ''}${gren ? ' gren' : ''}" data-sf="cb-zone" data-zone="${z.id}">
            <rect x="${x0}" y="${y0}" width="${w}" height="${h}"/>
            <text class="sf-zone-name" x="${x0 + 5}" y="${y0 + 12}">${esc(z.name)}</text>
            <text class="sf-zone-cover" x="${x0 + 5}" y="${y0 + 23}">${COVER_NAMES[z.cover].toUpperCase()}${z.high ? ' · HIGH' : ''}</text>
            ${allies.map((u, i) => token(u, i, 'ally')).join('')}
            ${seen ? foes.map((u, i) => token(u, i, 'enemy')).join('') : (foes.length ? `<text class="sf-zone-unknown" x="${x0 + w - 12}" y="${y0 + h - 10}">?</text>` : '')}
        </g>`;
    }).join('');
    return `<svg class="sf-field" viewBox="0 0 ${cols * ZW} ${rows * ZH}" preserveAspectRatio="xMidYMid meet">${links}${zones}</svg>`;
}

function healthWord(sh) {
    const f = sh.health / sh.maxHealth;
    return f >= 0.95 ? 'unhurt' : f >= 0.7 ? 'grazed' : f >= 0.45 ? 'wounded' : f >= 0.2 ? 'badly wounded' : 'barely standing';
}

function targetsHtml(c) {
    const me = player();
    const foes = c.units.filter(u => u.side === 'enemy' && !isOut(u));
    const myTurn = c.order[c.turn] === 'pc' && !isOut(me);
    return foes.map(u => {
        const sh = sheetOf(u);
        const seen = visibleTo(me, u);
        if (!seen) return `<div class="sf-target unseen"><span class="sf-grow"><b>Unseen contact</b><br><small class="sf-dim">Somewhere beyond your line of sight</small></span></div>`;
        const why = canAttack(me, u);
        const bonus = attackBonus(me, u, { called: called || null });
        const chance = bonus === null ? 0 : hitChance(bonus, defenseOf(u));
        const cov = coverPenalty(me, u);
        const a = ARMOR[sh.armor];
        return `<div class="sf-target${u.id === target ? ' sel' : ''}" data-sf="cb-target" data-id="${u.id}">
            <span class="sf-grow"><b>${esc(sh.name)}</b> <small class="sf-dim">${healthWord(sh)}</small><br>
                <small class="sf-dim">${esc(c.zones[u.zone].name)} · ${BAND_NAMES[bandOf(me.zone, u.zone)]}${cov ? ` · cover -${cov}` : ''} · ${esc(WEAPONS[sh.weapon]?.name ?? '')}${a.id !== 'none' ? ` · ${esc(a.name)}` : ''}${u.overwatch ? ' · OVERWATCH' : ''}</small></span>
            ${why ? `<small class="sf-warn-line">${esc(why)}</small>` : `<b class="sf-chance">${chance}%</b>${btn('cb-attack', weaponOf(me).melee ? 'Strike' : 'Fire', { icon: 'fa-crosshairs', cls: 'primary', data: { id: u.id }, disabled: !myTurn || me.acted })}`}
        </div>`;
    }).join('') || '<div class="sf-dim">No hostiles standing.</div>';
}

function actionsHtml(st, c) {
    const me = player();
    const sh = st.captain;
    const w = weaponOf(me);
    const myTurn = c.order[c.turn] === 'pc' && !isOut(me);
    const inv = sh.inventory;
    const mags = countItem(inv, 'Magazine');
    const grenades = inv.filter(i => /grenade/i.test(i.name)).reduce((n, i) => n + i.qty, 0);
    if (isOut(me)) return `<div class="sf-downed"><b>${me.dead ? 'KILLED' : 'DOWN'}</b><span>The fight goes on without you.</span></div>`;
    const pip = (used, label) => `<span class="sf-pipbox${used ? ' used' : ''}">${label}</span>`;
    const quick = Object.values(MEDS).filter(m => m.quick && countItem(inv, m.name) > 0);
    return `<div class="sf-turn-bar">${myTurn ? '<b>YOUR TURN</b>' : '<b>…</b>'} <span>Round ${c.round}</span>
        ${pip(me.moved, 'MOVE')}${pip(me.acted, 'ACTION')}${pip(me.bonus, 'BONUS')}</div>
    <div class="sf-kv"><span>${esc(w.name)}</span><b>${w.melee ? 'melee' : `${me.mag}/${w.mag} · ${mags} spare`}${me.aim ? ' · AIMED' : ''}${me.hunker ? ' · IN COVER' : ''}</b></div>
    <div class="sf-sub">Action</div>
    <div class="sf-actions">
        ${!w.melee ? btn('cb-do', 'Reload', { icon: 'fa-rotate', data: { act: 'reload' }, disabled: !myTurn || me.acted || me.mag >= w.mag || !mags }) : ''}
        ${!w.melee ? btn('cb-do', 'Overwatch', { icon: 'fa-eye', data: { act: 'overwatch' }, disabled: !myTurn || me.acted, title: 'Fire at the first enemy that moves into view' }) : ''}
        ${grenades ? btn('cb-grenade', grenadeMode ? 'Pick a zone…' : `Grenade (${grenades})`, { icon: 'fa-bomb', cls: grenadeMode ? 'primary' : '', disabled: !myTurn || me.acted }) : ''}
        ${c.zones[me.zone].entry ? btn('cb-do', 'Withdraw', { icon: 'fa-person-running', data: { act: 'disengage' }, disabled: !myTurn || me.acted, title: 'Break contact and leave the fight' }) : ''}
    </div>
    <label class="sf-field"><span>Aim at</span><select class="sf-input" data-sf-change="cb-called">
        <option value="">Centre mass (no penalty)</option>
        ${BODY_PARTS.map(p => `<option value="${p.id}"${called === p.id ? ' selected' : ''}>${p.name} (${p.id === 'head' ? '-6' : '-4'})</option>`).join('')}
    </select></label>
    <div class="sf-sub">Bonus action</div>
    <div class="sf-actions">
        ${btn('cb-do', 'Take cover', { icon: 'fa-shield', data: { act: 'hunker' }, disabled: !myTurn || me.bonus })}
        ${btn('cb-do', 'Steady aim', { icon: 'fa-bullseye', data: { act: 'aim' }, disabled: !myTurn || me.bonus })}
        ${quick.map(m => btn('cb-quick', `${m.name} (${countItem(inv, m.name)})`, { icon: 'fa-syringe', data: { med: m.id }, disabled: !myTurn || me.bonus, title: m.desc })).join('')}
    </div>
    <small class="sf-dim">Tap an adjacent zone to move${me.moved ? ' (sprinting uses your action)' : ''}. Treat wounds from the Body panel.</small>
    <div class="sf-actions">${btn('cb-do', 'End turn', { icon: 'fa-forward-step', cls: 'primary wide', data: { act: 'endTurn' }, disabled: !myTurn })}</div>`;
}

function act(fn) {
    try {
        fn();
        blip('click');
    } catch (e) {
        toast('warning', e.message);
        blip('error');
    }
    const st = S();
    if (st && !st.combat && st.lastCombat) {
        toast(st.lastCombat.result === 'victory' ? 'success' : 'warning', `Fight over: ${st.lastCombat.result}. Send a message and the AI will narrate it.`);
        target = null;
        grenadeMode = false;
    }
    commit('combat');
}

export function initCombatUi() {
    registerWidget({
        id: 'battlefield', when: (st) => !!st.combat, title: (st) => st.combat.scene, flush: true,
        render: (st) => `${fieldSvg(st.combat)}<div class="sf-field-legend"><span><i class="l-ally"></i>you and allies</span><span><i class="l-foe"></i>hostile</span><span><i class="l-block"></i>doorway, blocks sight</span></div>`,
    });
    registerWidget({ id: 'targets', when: (st) => !!st.combat, title: () => 'Hostiles', render: (st) => targetsHtml(st.combat) });
    registerWidget({ id: 'cbactions', when: (st) => !!st.combat, title: () => 'Your turn', render: (st) => actionsHtml(st, st.combat) });
    registerWidget({
        id: 'cblog', when: (st) => !!st.combat, title: () => 'Combat log',
        render: (st) => `<ul class="sf-cblog">${st.combat.log.slice(-40).reverse().map(l => `<li class="${l.kind}">${esc(l.text)}</li>`).join('')}</ul>
            <div class="sf-actions">${btn('cb-abort', 'Abort fight', { icon: 'fa-ban', cls: 'ghost', title: 'End the fight without a result' })}</div>`,
    });
    registerWidget({
        id: 'aar', when: (st) => !st.combat && !!st.lastCombat, title: () => 'After-action report',
        render: (st) => `<div class="sf-check-result ${st.lastCombat.result === 'victory' ? 'ok' : 'fail'}"><b>${esc(st.lastCombat.result.toUpperCase())}</b><small>${esc(st.lastCombat.scene)} · ${st.lastCombat.rounds} rounds</small></div>
            <ul class="sf-cblog">${st.lastCombat.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
            ${st.pendingEvent?.startsWith('COMBAT RESULT') ? `<small class="sf-dim">The AI will narrate this fight on its next reply.</small><div class="sf-actions">${btn('cb-narrate', 'Narrate now', { icon: 'fa-feather', cls: 'primary' })}</div>` : ''}
            <div class="sf-actions">${btn('cb-dismiss', 'Dismiss', { icon: 'fa-xmark', cls: 'ghost' })}</div>`,
    });
    registerWidget({ id: 'body', title: (st) => `Body: ${bodySheet(st).name}`, render: bodyHtml });
    registerWidget({
        id: 'activities', title: () => 'Daily life', render(st) {
            const t = transitInfo(st);
            return `${t ? `<div class="sf-note">In jump transit to ${esc(t.toSys.name)}: ${esc(fmtDuration(t.left))} to go. Time passes as you live it.</div>` : ''}
            <div class="sf-actions">
                ${btn('run', 'Eat', { icon: 'fa-utensils', data: { cmd: 'eat' }, title: '15 minutes, uses a ration or ship stores' })}
                ${btn('run', 'Drink', { icon: 'fa-glass-water', data: { cmd: 'drink' }, title: '5 minutes' })}
                ${btn('run', 'Wash', { icon: 'fa-shower', data: { cmd: 'wash' }, title: '20 minutes' })}
                ${btn('run', 'Unwind 1 h', { icon: 'fa-mug-hot', data: { cmd: 'relax 1h' }, title: 'Lowers stress, lifts morale' })}
            </div>
            <div class="sf-actions">
                ${btn('run', 'Nap 2 h', { icon: 'fa-bed', data: { cmd: 'sleep 2h' } })}
                ${btn('run', 'Sleep 6 h', { icon: 'fa-bed', data: { cmd: 'sleep 6h' } })}
                ${btn('run', 'Sleep 8 h', { icon: 'fa-bed', data: { cmd: 'sleep 8h' } })}
            </div>`;
        },
    });
    registerWidget({
        id: 'encounter', when: (st) => !st.combat, title: () => 'Start a fight', render: () => `<small class="sf-dim">The AI starts fights on its own with a tag. Use this to stage one yourself.</small>
            <label class="sf-field"><span>Where</span><input class="sf-input" data-enc="scene" value="Cargo bay" placeholder="corridor, bar, street, bridge…"></label>
            <div class="sf-check-form">
                <select class="sf-input" data-enc="type">${Object.values(ENEMIES).map(e => `<option value="${e.id}"${e.id === 'pirate' ? ' selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
                <select class="sf-input" data-enc="count">${[1, 2, 3, 4, 5, 6].map(n => `<option${n === 2 ? ' selected' : ''}>${n}</option>`).join('')}</select>
            </div>
            <div class="sf-actions">${btn('enc-start', 'Start fight', { icon: 'fa-crosshairs', cls: 'primary' })}</div>`,
    });
    registerTab({ id: 'combat', label: 'Combat', icon: 'fa-crosshairs', order: 5, when: (st) => !!st.combat || !!st.lastCombat, widgets: ['battlefield', 'cbactions', 'targets', 'body', 'cblog', 'aar'] });

    registerActions({
        'cb-zone'(el) {
            const zone = Number(el.dataset.zone);
            const me = player();
            if (grenadeMode) { grenadeMode = false; return act(() => playerActions.grenade(zone)); }
            if (zone === me.zone) return;
            act(() => (me.moved ? playerActions.sprint(zone) : playerActions.move(zone)));
        },
        'cb-target'(el, ev) {
            ev.stopPropagation();
            target = el.dataset.id;
            redraw();
        },
        'cb-attack'(el, ev) {
            ev.stopPropagation();
            target = el.dataset.id;
            act(() => playerActions.attack(el.dataset.id, called || null));
        },
        'cb-do'(el) { act(() => playerActions[el.dataset.act]()); },
        'cb-grenade'() { grenadeMode = !grenadeMode; redraw(); },
        'cb-called'(el) { called = el.value; redraw(); },
        'cb-quick'(el) { act(() => playerActions.treat(el.dataset.med, null)); },
        'cb-abort'() {
            abortCombat();
            addLog('Combat aborted.', 'combat');
            commit('combat');
        },
        'cb-dismiss'() { S().lastCombat = null; commit('combat'); },
        async 'cb-narrate'() {
            const c = ctx();
            try {
                await c.executeSlashCommandsWithOptions?.('/trigger');
            } catch (e) {
                toast('warning', 'Send any message and the AI will narrate the fight.');
            }
        },
        'body-part'(el) { selPart = el.dataset.part; redraw(); },
        'body-who'(el) { bodyWho = el.value; redraw(); },
        'body-treat'(el) {
            const st = S();
            const med = MEDS[el.dataset.med];
            const sheet = bodySheet(st);
            if (st.combat) {
                if (sheet !== st.captain) return toast('warning', 'In a fight you can only treat yourself.');
                return act(() => playerActions.treat(med.id, selPart));
            }
            const medic = [st.captain, ...st.crew].filter(p => !isDown(p)).sort((a, b) => skillOf(b, 'medicine') - skillOf(a, 'medicine'))[0] ?? st.captain;
            const r = useMed(sheet, med.id, selPart, st.captain.inventory, {
                now: st.minutes,
                surgeryRoll: () => {
                    const roll = skillCheck(medic, 'medicine', 14, { now: st.minutes });
                    toast(roll.success ? 'success' : 'warning', `${medic.name} Medicine ${roll.total} vs 14`);
                    return roll.success;
                },
            });
            if (!r.ok) { blip('error'); return toast('warning', r.text); }
            if (med.time) advanceTime(med.time);
            gainXp(medic, 'medicine', med.surgery ? 12 : 4);
            addLog(`${sheet.name}: ${r.text}`, 'sys');
            toast(r.failed ? 'warning' : 'success', r.text);
            commit('treat');
        },
        'enc-start'(el) {
            const box = el.closest('.sf-panel-body');
            const get = (k) => box.querySelector(`[data-enc="${k}"]`)?.value;
            const r = runCommand(`combat "${String(get('scene') || 'Unknown ground').replace(/"/g, "'")}" ${get('type')} ${get('count')}`);
            if (!r.ok) { blip('error'); return toast('warning', r.text); }
            commit('combat');
        },
    });

    registerCommand('combat', (st, args) => {
        if (/^(end|stop|abort)$/i.test(args[0] ?? '')) { abortCombat(); return 'Combat ended'; }
        return startFromTokens(args);
    }, ['fight', 'battle', 'encounter']);

    registerPromptSection((st) => (st.combat
        ? { now: 'A FIGHT IS IN PROGRESS and the game is resolving it. Do not narrate its course or outcome yet; keep any reply to a single tense beat.' }
        : ''));

    // Open the combat screen the moment a fight starts.
    let wasFighting = false;
    onChange(() => {
        const fighting = !!S()?.combat;
        if (fighting && !wasFighting) {
            target = null;
            grenadeMode = false;
            if (settings().enabled) { openHud('combat'); blip('alert'); }
        }
        wasFighting = fighting;
    });
    onCombatRedraw(() => redraw());
}
