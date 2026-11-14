// Character sheet, party, skill checks, training, loadout, checkpoints and the death screen.
import { registerTab, registerWidget, registerActions, gauge, btn, ask, confirmAsk } from './hud.js';
import { S, commit, addLog, fmtDate, currentStation, checkpoints, saveCheckpoint, loadCheckpoint, deleteCheckpoint, deleteCampaign } from '../core/state.js';
import { ctx, toast, toInput } from '../core/st.js';
import { esc, fmtInt, uid } from '../core/util.js';
import { PERSONAL_WEAPONS, ARMORS } from '../data/catalog.js';
import { ATTRIBUTES, SKILL_DEFS, skillDef, TRAITS, FLAWS, CYBERWARE, CHECK_DCS } from '../data/chargen.js';
import {
    attrOf, skillOf, skillBonus, originOf, careerOf, xpNeeded, gainXp, armorOf, cyberLoad, cyberCapacity,
    conditionPenalty, hasFx, makeNpcSheet, refreshDerived, SKILL_MAX,
} from '../systems/character.js';
import { runCommand, advanceTime, killPlayer } from '../systems/sim.js';
import { syncHealth, isDown } from '../systems/body.js';
import { blip } from './sfx.js';

const expanded = new Set();
const TRAIN_CAP = 5;

const q = (s) => `"${String(s).replace(/"/g, "'")}"`;

function exec(line, quiet = false) {
    const r = runCommand(line);
    if (!r.ok) { toast('warning', r.text); blip('error'); return r; }
    if (!quiet) toast('info', r.text);
    commit('ui');
    return r;
}

function attrGrid(sheet, editable) {
    return `<div class="sf-attr-grid">${ATTRIBUTES.map(a => {
        const v = attrOf(sheet, a.id);
        const bonus = v - (sheet.attrs[a.id] ?? 0);
        return `<div class="sf-attr${editable ? ' sf-editable' : ''}"${editable ? ` data-sf="edit" data-cmd="attr ${a.id}" data-label="${a.name} (1-10)"` : ''} title="${esc(a.desc)}">
            <small>${a.id.toUpperCase()}</small><b>${v}</b>${bonus ? `<i>${bonus > 0 ? '+' : ''}${bonus}</i>` : ''}</div>`;
    }).join('')}</div>`;
}

function skillRows(sheet, { all = true } = {}) {
    let group = '';
    return SKILL_DEFS.filter(d => all || skillOf(sheet, d.id) > 0).map(d => {
        const base = sheet.skills[d.id] ?? 0;
        const bonus = skillBonus(sheet, d.id);
        const need = xpNeeded(base);
        const xp = sheet.xp?.[d.id] ?? 0;
        const head = all && d.group !== group ? `<div class="sf-sub">${(group = d.group)}</div>` : '';
        return `${head}<div class="sf-skill-row" title="${esc(d.name)}: governed by ${d.attr.toUpperCase()}. ${Math.round(xp)}/${need} XP to next level.">
            <span class="sf-skill-name">${esc(d.name)}</span>
            <span class="sf-pips">${Array.from({ length: SKILL_MAX }, (_, i) => `<i class="${i < base ? 'on' : i < base + bonus ? 'bonus' : ''}"></i>`).join('')}</span>
            <b>${base + bonus}</b>
            <span class="sf-xp"><span style="width:${base >= SKILL_MAX ? 100 : Math.min(100, (xp / need) * 100)}%"></span></span>
        </div>`;
    }).join('');
}

function tagList(list, ids, cls) {
    return ids.map(id => list.find(x => x.id === id)).filter(Boolean)
        .map(x => `<span class="sf-tag ${cls}" title="${esc(x.desc)}">${esc(x.name)}</span>`).join('');
}

function partyRow(st, c) {
    const open = expanded.has(c.id);
    const best = SKILL_DEFS.map(d => ({ d, v: skillOf(c, d.id) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 3);
    return `<div class="sf-member${isDown(c) ? ' down' : ''}">
        <div class="sf-row">
            <span class="sf-grow"><b>${esc(c.name)}</b> <span class="sf-dim">${esc(c.role)}</span><br>
                <small class="sf-dim">${best.map(x => `${esc(x.d.name)} ${x.v}`).join(' · ') || 'No trained skills'}</small></span>
            ${btn('member-toggle', '', { icon: open ? 'fa-chevron-up' : 'fa-chevron-down', cls: 'ghost', data: { id: c.id }, title: 'Sheet' })}
            ${btn('crew-remove', '', { icon: 'fa-user-minus', cls: 'ghost', data: { name: c.name }, title: 'Remove from party' })}
        </div>
        ${gauge('Health', c.health, c.maxHealth, { edit: `health ${q(c.name)}` })}
        ${open ? `<div class="sf-member-sheet">
            ${attrGrid(c, false)}
            ${skillRows(c, { all: false })}
            <div class="sf-kv"><span>Weapon</span><b>${esc(PERSONAL_WEAPONS[c.weapon]?.name ?? c.weapon)}</b></div>
            <div class="sf-kv"><span>Armor</span><b>${esc(ARMORS[c.armor]?.name ?? c.armor)} (class ${armorOf(c)})</b></div>
            ${c.notes ? `<div class="sf-note">${esc(c.notes)}</div>` : ''}
            <div class="sf-actions">
                ${btn('member-skill', 'Set skill', { icon: 'fa-pen', data: { id: c.id } })}
                ${btn('member-role', 'Role', { icon: 'fa-id-badge', data: { id: c.id } })}
                ${btn('member-note', 'Note', { icon: 'fa-note-sticky', data: { id: c.id } })}
            </div>
        </div>` : ''}
    </div>`;
}

/** Names of the AI characters in the current chat that have no sheet yet. */
function chatCharacterNames(st) {
    const c = ctx();
    const names = [];
    if (c.groupId) {
        const group = c.groups?.find(g => g.id == c.groupId);
        for (const avatar of group?.members ?? []) {
            const ch = c.characters?.find(x => x.avatar === avatar);
            if (ch?.name) names.push(ch.name);
        }
    } else if (c.characterId !== undefined) {
        const ch = c.characters?.[c.characterId];
        if (ch?.name) names.push(ch.name);
    }
    return names.filter(n => !st.crew.some(m => m.name === n));
}

function trainCost(st, level) {
    const base = 150 * (level + 1);
    return Math.round(st.captain.tier === 'trainee' ? base * 0.6 : base);
}

function deathHtml(st) {
    const cps = checkpoints();
    const canLoad = st.deathMode === 'checkpoint' && cps.length;
    const backup = hasFx(st.captain, 'backup');
    return `<div class="sf-death">
        <div class="sf-death-title">FLATLINE</div>
        <div class="sf-death-name">${esc(st.captain.name)}</div>
        <div class="sf-dim">${esc(fmtDate(st.minutes))}${st.deathCause ? ` · ${esc(st.deathCause)}` : ''}</div>
        <div class="sf-boot"><div>VITAL SIGNS ........ NONE</div><div>RECORD ............. ${st.deathMode === 'ironman' ? 'CLOSED' : 'SUSPENDED'}</div></div>
        ${backup ? `<div class="sf-note">A cortex backup exists. A clinic can decant you into a clone: you lose half your credits and all unspent skill XP.</div>
            <div class="sf-actions">${btn('death-backup', 'Restore from cortex backup', { icon: 'fa-brain', cls: 'primary' })}</div>` : ''}
        ${canLoad ? `<div class="sf-sub">Checkpoints</div><ul class="sf-list">${cps.map(c => `<li class="sf-row"><span class="sf-grow"><b>${esc(c.label)}</b><br><small class="sf-dim">${esc(fmtDate(c.minutes))} · ${esc(c.where)}</small></span>${btn('cp-load', 'Load', { icon: 'fa-rotate-left', data: { id: c.id } })}</li>`).join('')}</ul>` : ''}
        ${st.deathMode === 'ironman' && !backup ? '<div class="sf-warn-line">Permadeath is on. This story is over.</div>' : ''}
        <div class="sf-actions">
            ${btn('death-new', 'New character, same sector', { icon: 'fa-user-plus' })}
            ${btn('death-undo', 'It was not fatal', { icon: 'fa-heart-pulse', cls: 'ghost', title: 'Undo: revive at 1 health' })}
        </div>
    </div>`;
}

export function initSheet(wizardApi) {
    registerWidget({
        id: 'identity', title: (st) => st.captain.name, render(st) {
            const c = st.captain;
            const o = originOf(c.origin);
            return `<div class="sf-loc-main">${esc(c.role)}</div>
            <div class="sf-loc-sub">${o ? esc(o.name) : ''}${c.look ? ` · ${esc(c.look)}` : ''}</div>
            ${attrGrid(c, true)}
            <div class="sf-kv"><span>Total health</span><b>${c.maxHealth}</b></div>
            <div class="sf-kv"><span>Armor class</span><b>${armorOf(c)}</b></div>
            <div class="sf-kv"><span>Death rule</span><b>${st.deathMode === 'ironman' ? 'Permadeath' : 'Checkpoints'}</b></div>
            <div class="sf-actions">${btn('sheet-look', 'Appearance', { icon: 'fa-pen' })}</div>`;
        },
    });
    registerWidget({ id: 'skills', title: () => 'Skills', render: (st) => `${skillRows(st.captain)}<small class="sf-dim">Skills grow with use. The thin bar is progress to the next level.</small>` });
    registerWidget({
        id: 'augments', title: () => 'Traits and cyberware', render(st) {
            const c = st.captain;
            return `<div class="sf-sub">Traits</div><div class="sf-tags">${tagList(TRAITS, c.traits, 'good') || '<span class="sf-dim">None</span>'}</div>
            <div class="sf-sub">Flaws</div><div class="sf-tags">${tagList(FLAWS, c.flaws, 'bad') || '<span class="sf-dim">None</span>'}</div>
            <div class="sf-sub">Cyberware</div>${gauge('Neural load', cyberLoad(c), Math.max(1, cyberCapacity(c)), { cls: 'info', text: `${cyberLoad(c)}/${cyberCapacity(c)}` })}
            <div class="sf-tags">${tagList(CYBERWARE, c.cyber, 'cyber') || '<span class="sf-dim">No implants</span>'}</div>`;
        },
    });
    registerWidget({
        id: 'check', title: () => 'Skill check', render(st) {
            const people = [st.captain, ...st.crew];
            const pen = conditionPenalty(st.captain);
            const last = st.lastCheck;
            return `<div class="sf-check-form">
                <select class="sf-input" data-check="who">${people.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')}</select>
                <select class="sf-input" data-check="skill">${SKILL_DEFS.map(d => `<option value="${d.id}">${esc(d.name)} (${skillOf(st.captain, d.id)})</option>`).join('')}</select>
                <select class="sf-input" data-check="dc">${CHECK_DCS.map(d => `<option value="${d.dc}"${d.dc === 12 ? ' selected' : ''}>${d.name} (${d.dc})</option>`).join('')}</select>
                ${btn('check-roll', 'Roll 2d10', { icon: 'fa-dice', cls: 'primary' })}
            </div>
            ${pen.total ? `<div class="sf-warn-line"><i class="fa-solid fa-triangle-exclamation"></i> Condition penalty -${pen.total}: ${esc(pen.parts.join(', '))}</div>` : ''}
            ${last ? `<div class="sf-check-result ${last.success ? 'ok' : 'fail'}"><b>${last.crit ? 'CRITICAL' : last.fumble ? 'FUMBLE' : last.success ? 'SUCCESS' : 'FAILURE'}</b>
                <span class="sf-dice"><i>${last.d1}</i><i>${last.d2}</i> ${last.bonus >= 0 ? '+' : ''}${last.bonus} = ${last.total} vs ${last.dc}</span>
                <small>${esc(last.who)} · ${esc(last.name)}${last.xp ? ` · +${last.xp} XP` : ''}</small></div>
                <div class="sf-actions">${btn('check-chat', 'Put in my message', { icon: 'fa-share' })}</div>
                <small class="sf-dim">The AI is told this result on your next message.</small>` : '<small class="sf-dim">2d10 + skill + attribute. Double 10 is a critical, double 1 a fumble.</small>'}`;
        },
    });
    registerWidget({
        id: 'training', title: () => 'Training', render(st) {
            const station = currentStation();
            if (!station) return '<div class="sf-dim">Dock at a station to find instructors and simulators.</div>';
            const c = st.captain;
            return `<small class="sf-dim">${esc(station.name)}: each session takes 8 hours and gives 30 XP. Instructors can take you to level ${TRAIN_CAP}; beyond that only real use teaches.${c.tier === 'trainee' ? ' Trainee rate: 40% off.' : ''}</small>
            <div class="sf-check-form">
                <select class="sf-input" data-train="skill">${SKILL_DEFS.filter(d => (c.skills[d.id] ?? 0) < TRAIN_CAP).map(d => `<option value="${d.id}">${esc(d.name)} ${c.skills[d.id] ?? 0} · ${fmtInt(trainCost(st, c.skills[d.id] ?? 0))} cr</option>`).join('')}</select>
                ${btn('train', 'Train 8 h', { icon: 'fa-graduation-cap', cls: 'primary' })}
            </div>`;
        },
    });
    registerWidget({
        id: 'loadout', title: () => 'Loadout', render(st) {
            const c = st.captain;
            return `<label class="sf-field"><span>Weapon</span><select class="sf-input" data-sf-change="loadout" data-slot="weapon">${Object.values(PERSONAL_WEAPONS).filter(w => w.id !== 'claws').map(w => `<option value="${w.id}"${w.id === c.weapon ? ' selected' : ''}>${esc(w.name)} (${w.dmg[0]}-${w.dmg[1]}, pen ${w.pen})</option>`).join('')}</select></label>
            <label class="sf-field"><span>Armor</span><select class="sf-input" data-sf-change="loadout" data-slot="armor">${Object.values(ARMORS).map(a => `<option value="${a.id}"${a.id === c.armor ? ' selected' : ''}>${esc(a.name)} (class ${a.cls}${a.frame ? `, frame ${a.frame}` : ''})</option>`).join('')}</select></label>`;
        },
    });
    registerWidget({
        id: 'party', title: () => 'Party', render(st) {
            const missing = chatCharacterNames(st);
            return `${st.crew.map(c => partyRow(st, c)).join('') || '<div class="sf-dim">Nobody travels with you yet.</div>'}
            <div class="sf-actions">
                ${missing.map(n => btn('party-import', `Add ${n}`, { icon: 'fa-user-plus', cls: 'primary', data: { name: n } })).join('')}
                ${btn('crew-add', 'Add someone', { icon: 'fa-user-plus' })}
            </div>`;
        },
    });
    registerWidget({
        id: 'checkpoints', title: () => 'Checkpoints', render(st) {
            const cps = checkpoints();
            return `<small class="sf-dim">${st.deathMode === 'ironman' ? 'Permadeath: checkpoints cannot be loaded after death.' : 'An autosave is made on every arrival.'}</small>
            <ul class="sf-list">${cps.map(c => `<li class="sf-row"><span class="sf-grow"><b>${esc(c.label)}</b>${c.auto ? ' <span class="sf-tag">auto</span>' : ''}<br><small class="sf-dim">${esc(fmtDate(c.minutes))} · ${esc(c.where)}</small></span>
                ${btn('cp-load', '', { icon: 'fa-rotate-left', cls: 'ghost', data: { id: c.id }, title: 'Load' })}${btn('cp-delete', '', { icon: 'fa-trash', cls: 'ghost', data: { id: c.id }, title: 'Delete' })}</li>`).join('') || '<li class="sf-dim">No checkpoints</li>'}</ul>
            <div class="sf-actions">${btn('cp-save', 'Save checkpoint', { icon: 'fa-floppy-disk' })}</div>`;
        },
    });
    registerTab({ id: 'sheet', label: 'Sheet', icon: 'fa-id-badge', order: 14, widgets: ['identity', 'skills', 'check', 'augments', 'training'] });

    const member = (id) => S().crew.find(c => c.id === id);
    registerActions({
        async 'sheet-look'() {
            const st = S();
            const v = await ask('Appearance (the AI is told this)', st.captain.look ?? '');
            if (v === null || v === undefined || v === false) return;
            st.captain.look = String(v).trim();
            commit('ui');
        },
        'check-roll'(el) {
            const form = el.closest('.sf-panel-body');
            const get = (k) => form.querySelector(`[data-check="${k}"]`)?.value;
            const r = exec(`check ${q(get('who'))} ${get('skill')} ${get('dc')}`, true);
            if (r.ok) { blip(S().lastCheck?.success ? 'boot' : 'error'); toast(S().lastCheck?.success ? 'success' : 'warning', r.text); }
        },
        'check-chat'() {
            const last = S().lastCheck;
            if (last) toInput(`[${last.text}]`);
        },
        train(el) {
            const st = S();
            const id = el.closest('.sf-panel-body').querySelector('[data-train="skill"]')?.value;
            const def = skillDef(id);
            if (!def) return;
            const c = st.captain;
            const cost = trainCost(st, c.skills[id] ?? 0);
            if (c.credits < cost) { blip('error'); return toast('warning', `Training costs ${fmtInt(cost)} cr.`); }
            c.credits -= cost;
            advanceTime(8 * 60);
            const lv = gainXp(c, id, 30);
            addLog(`Trained ${def.name} for 8 h (${fmtInt(cost)} cr).${lv ? ` Now level ${c.skills[id]}.` : ''}`, 'sys');
            toast(lv ? 'success' : 'info', lv ? `${def.name} improved to ${c.skills[id]}.` : `${def.name}: training logged.`);
            commit('train');
        },
        loadout(el) {
            const st = S();
            st.captain[el.dataset.slot] = el.value;
            refreshDerived(st.captain);
            commit('ui');
        },
        'member-toggle'(el) {
            expanded.has(el.dataset.id) ? expanded.delete(el.dataset.id) : expanded.add(el.dataset.id);
            commit('view');
        },
        async 'member-skill'(el) {
            const m = member(el.dataset.id);
            const name = await ask(`Which skill of ${m.name}? (e.g. firearms, pilot, medicine)`);
            if (!name) return;
            const n = String(name).trim().toLowerCase();
            const def = SKILL_DEFS.find(d => d.id.startsWith(n) || d.name.toLowerCase().startsWith(n) || d.name.toLowerCase().includes(n));
            if (!def) return toast('warning', `Unknown skill "${name}".`);
            const v = await ask(`${def.name} level (0-10)`, String(m.skills[def.id] ?? 0));
            if (v === null || v === undefined || v === false) return;
            m.skills[def.id] = Math.max(0, Math.min(10, Math.round(Number(v)) || 0));
            commit('ui');
        },
        async 'member-role'(el) {
            const m = member(el.dataset.id);
            const v = await ask('Role', m.role);
            if (!v) return;
            m.role = String(v).trim();
            commit('ui');
        },
        async 'member-note'(el) {
            const m = member(el.dataset.id);
            const v = await ask('Notes', m.notes ?? '');
            if (v === null || v === undefined || v === false) return;
            m.notes = String(v).trim();
            commit('ui');
        },
        async 'party-import'(el) {
            const role = await ask(`What does ${el.dataset.name} do? (Pilot, Engineer, Medic, Mercenary, Netrunner…)`, 'Mercenary');
            if (!role) return;
            const st = S();
            const sheet = makeNpcSheet(el.dataset.name, String(role).trim());
            st.crew.push(sheet);
            expanded.add(sheet.id);
            addLog(`${sheet.name} joined the party as ${sheet.role}.`, 'sys');
            commit('ui');
        },
        async 'cp-save'() {
            const v = await ask('Checkpoint name', `Manual save`);
            if (!v) return;
            saveCheckpoint(String(v).trim());
            commit('checkpoint');
            toast('success', 'Checkpoint saved.');
        },
        async 'cp-load'(el) {
            const st = S();
            if (st.deathMode === 'ironman' && st.dead) return toast('error', 'Permadeath: checkpoints are locked.');
            if (!st.dead && !(await confirmAsk('Load this checkpoint?', 'Your current state will be replaced. The chat itself is not rewound.'))) return;
            if (loadCheckpoint(el.dataset.id)) toast('success', 'Checkpoint loaded.');
        },
        'cp-delete'(el) { deleteCheckpoint(el.dataset.id); },
        'vitals-stable'() {
            const st = S();
            const pc = st.captain;
            for (const id of ['head', 'thorax']) {
                const p = pc.body.parts[id];
                if (p.hp <= 0) p.hp = Math.max(1, Math.round(p.max * 0.15));
            }
            for (const p of Object.values(pc.body.parts)) p.w = p.w.filter(w => w !== 'bleed' && w !== 'hemorrhage');
            syncHealth(pc);
            addLog(`${pc.name} was stabilised.`, 'sys');
            commit('ui');
        },
        async 'vitals-die'() {
            const cause = await ask('Cause of death', '');
            if (cause === null || cause === undefined || cause === false) return;
            killPlayer(String(cause).trim());
            blip('alert');
            commit('death');
        },
        'death-undo'() {
            const st = S();
            st.dead = false;
            st.deathCause = '';
            for (const p of Object.values(st.captain.body.parts)) { if (p.hp <= 0) p.hp = Math.max(1, Math.round(p.max * 0.15)); p.w = p.w.filter(w => w !== 'bleed' && w !== 'hemorrhage'); }
            syncHealth(st.captain);
            addLog(`${st.captain.name} was pulled back from the brink.`, 'sys');
            commit('ui');
        },
        'death-backup'() {
            const st = S();
            const c = st.captain;
            st.dead = false;
            st.deathCause = '';
            c.credits = Math.floor(c.credits / 2);
            for (const k of Object.keys(c.xp)) c.xp[k] = 0;
            c.injuries = c.injuries.filter(i => i.permanent);
            for (const k of Object.keys(c.needs)) c.needs[k] = 60;
            c.stress = 50;
            c.body = null;
            refreshDerived(c);
            st.minutes += 72 * 60;
            st.transit = null;
            st.loc.docked = true;
            st.loc.place = '';
            addLog(`${c.name} decanted from cortex backup. Three days are missing.`, 'sys');
            st.pendingEvent = `${c.name} died, and has just woken in a clone body in a station clinic, restored from a cortex backup. Three days have passed, and the last hours before death are missing from memory.`;
            commit('ui');
        },
        async 'death-new'() {
            const st = S();
            if (!(await confirmAsk('Start a new character?', 'The sector stays the same. The dead character and their belongings are gone.'))) return;
            const seed = st.seed;
            deleteCampaign();
            wizardApi.reset({ seed: String(seed) });
            commit('new-char');
        },
    });
    void uid; void careerOf;
    return { deathHtml };
}
