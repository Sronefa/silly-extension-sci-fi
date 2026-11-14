// The character creator: a step-by-step wizard that works with a thumb on a phone.
import { btn, redraw } from './hud.js';
import { newCampaign } from '../core/state.js';
import { ctx, toast } from '../core/st.js';
import { esc, fmtInt } from '../core/util.js';
import { SHIP_CLASSES, PERSONAL_WEAPONS, ARMORS } from '../data/catalog.js';
import {
    ATTRIBUTES, SKILL_DEFS, ORIGINS, CAREERS, TIERS, TRAITS, FLAWS, CYBERWARE, CRAFT_CLASSES, DIFFICULTIES, MAX_FLAW_POINTS,
} from '../data/chargen.js';
import {
    newDraft, draftPoints, draftBaseAttrs, draftBaseSkills, draftCanAttr, draftCanSkill, draftSheet, draftProblems, draftStart,
    draftFreeCyber, buildSheetFromDraft, draftReputation, attrOf, skillOf, calcMaxHealth, cyberLoad, cyberCapacity, originOf, careerOf, tierOf,
} from '../systems/character.js';
import { factionById } from '../systems/galaxy.js';
import { blip } from './sfx.js';

const STEPS = ['Identity', 'Origin', 'Career', 'Abilities', 'Edges', 'Launch'];
let draft = null;
let step = 0;
let scrollTop = false;

function d() {
    draft ??= newDraft(ctx().name1 || 'Unnamed');
    return draft;
}

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const mods = (obj, names) => Object.entries(obj ?? {}).map(([k, v]) => `${names(k)} ${signed(v)}`).join(', ');
const attrName = (k) => k.toUpperCase();
const skillName = (k) => SKILL_DEFS.find(s => s.id === k)?.name ?? k;

function card(field, item, selected, body) {
    return `<div class="sf-card${selected ? ' selected' : ''}" data-sf="cg-pick" data-field="${field}" data-value="${item.id}">
        <div class="sf-card-head"><b>${esc(item.name)}</b>${selected ? '<i class="fa-solid fa-circle-check"></i>' : ''}</div>
        <div class="sf-card-desc">${esc(item.desc)}</div>${body}</div>`;
}

function stepIdentity(x) {
    return `<label class="sf-field"><span>Name</span><input class="sf-input" data-sf-change="cg-field" data-field="name" value="${esc(x.name)}"></label>
    <label class="sf-field"><span>Appearance</span><input class="sf-input" data-sf-change="cg-field" data-field="look" value="${esc(x.look)}" placeholder="optional: age, build, a scar…"></label>
    <div class="sf-sub">Challenge</div>
    <div class="sf-cards">${DIFFICULTIES.map(o => card('difficulty', o, x.difficulty === o.id, '')).join('')}</div>
    <div class="sf-sub">When you die</div>
    <div class="sf-cards">
        ${card('deathMode', { id: 'checkpoint', name: 'Checkpoints', desc: 'Reload an earlier checkpoint and try again.' }, x.deathMode === 'checkpoint', '')}
        ${card('deathMode', { id: 'ironman', name: 'Permadeath', desc: 'Dead is dead. The record closes for good.' }, x.deathMode === 'ironman', '')}
    </div>`;
}

function stepOrigin(x) {
    return `<div class="sf-cards">${ORIGINS.map(o => card('origin', o, x.origin === o.id, `
        <div class="sf-card-meta"><span style="color:${factionById(o.faction).color}">${esc(factionById(o.faction).name)}</span></div>
        <div class="sf-card-meta">${esc(mods(o.attr, attrName))}</div>
        <div class="sf-card-meta">${esc(mods(o.skill, skillName))}</div>`)).join('')}</div>`;
}

function stepCareer(x) {
    const t = tierOf(x.tier);
    return `<div class="sf-sub">Experience</div>
    <div class="sf-cards three">${TIERS.map(o => card('tier', o, x.tier === o.id, '')).join('')}</div>
    <div class="sf-sub">Career</div>
    <div class="sf-cards">${CAREERS.map(c => {
        const ship = !t.noShip && c.start.ship ? SHIP_CLASSES[c.start.ship] : null;
        const craft = c.start.craft ? CRAFT_CLASSES[c.start.craft] : null;
        const skills = Object.entries(c.skill).map(([k, v]) => `${skillName(k)} ${Math.max(0, v + t.skillMod)}`).join(', ');
        const starts = [
            ship ? `<i class="fa-solid fa-rocket"></i> ${esc(ship.name)}` : '',
            craft ? `<i class="fa-solid ${craft.kind === 'mech' ? 'fa-robot' : 'fa-jet-fighter'}"></i> ${esc(craft.name)}` : '',
            !ship && !craft ? '<i class="fa-solid fa-person-walking"></i> No vessel' : '',
        ].filter(Boolean).join(' · ');
        return card('career', c, x.career === c.id, `
            <div class="sf-card-meta">${esc(skills)}</div>
            <div class="sf-card-meta hi">${starts}</div>
            <div class="sf-card-meta">${fmtInt(Math.round(c.credits * t.creditMult))} cr${ship && c.start.debt ? ` · ${fmtInt(c.start.debt)} cr ship loan` : ''}${c.points ? ` · +${c.points} points` : ''}</div>`);
    }).join('')}</div>`;
}

function stepper(action, id, value, canDown, canUp, extra = '') {
    return `<div class="sf-stepper">
        <button type="button" class="sf-btn ghost" data-sf="${action}" data-id="${id}" data-d="-1"${canDown ? '' : ' disabled'}><i class="fa-solid fa-minus"></i></button>
        <b>${value}</b>${extra}
        <button type="button" class="sf-btn ghost" data-sf="${action}" data-id="${id}" data-d="1"${canUp ? '' : ' disabled'}><i class="fa-solid fa-plus"></i></button>
    </div>`;
}

function stepAbilities(x) {
    const sheet = draftSheet(x);
    const baseA = draftBaseAttrs(x);
    const baseS = draftBaseSkills(x);
    let group = '';
    return `<div class="sf-sub">Attributes <small>4 points each · lowering one refunds 3</small></div>
    ${ATTRIBUTES.map(a => `<div class="sf-buy-row" title="${esc(a.desc)}"><span class="sf-grow"><b>${a.name}</b><br><small class="sf-dim">${esc(a.desc)}</small></span>
        ${stepper('cg-attr', a.id, attrOf(sheet, a.id), draftCanAttr(x, a.id, -1), draftCanAttr(x, a.id, 1), attrOf(sheet, a.id) !== baseA[a.id] + (x.attrBuy[a.id] ?? 0) ? '<i class="sf-bonus">*</i>' : '')}</div>`).join('')}
    <div class="sf-kv"><span>Max health</span><b>${calcMaxHealth(sheet)}</b></div>
    <div class="sf-sub">Skills <small>1 point to level 3 · 2 for 4-5 · 3 for 6</small></div>
    ${SKILL_DEFS.map(s => {
        const head = s.group !== group ? `<div class="sf-sub minor">${(group = s.group)}</div>` : '';
        const bonus = skillOf(sheet, s.id) - sheet.skills[s.id];
        return `${head}<div class="sf-buy-row compact"><span class="sf-grow">${esc(s.name)} <small class="sf-dim">${s.attr.toUpperCase()}</small></span>
            ${stepper('cg-skill', s.id, sheet.skills[s.id], draftCanSkill(x, s.id, -1), draftCanSkill(x, s.id, 1), bonus ? `<i class="sf-bonus">+${bonus}</i>` : '')}</div>`;
    }).join('')}
    <small class="sf-dim">Package levels from origin and career cannot be lowered. Base: ${Object.entries(baseS).filter(([, v]) => v > 0).map(([k, v]) => `${skillName(k)} ${v}`).join(', ')}.</small>`;
}

function toggleChip(list, item, on, cost, cls, locked = false) {
    return `<div class="sf-pick ${cls}${on ? ' selected' : ''}${locked ? ' locked' : ''}" data-sf="${locked ? '' : 'cg-toggle'}" data-list="${list}" data-id="${item.id}">
        <div class="sf-card-head"><b>${esc(item.name)}</b><span class="sf-cost">${cost}</span></div>
        <div class="sf-card-desc">${esc(item.desc)}</div></div>`;
}

function stepEdges(x) {
    const sheet = draftSheet(x);
    const p = draftPoints(x);
    const free = draftFreeCyber(x);
    return `<div class="sf-sub">Traits <small>cost points</small></div>
    <div class="sf-cards">${TRAITS.map(t => toggleChip('traits', t, x.traits.includes(t.id), `-${t.cost}`, 'good')).join('')}</div>
    <div class="sf-sub">Flaws <small>give points · ${p.flawGain}/${MAX_FLAW_POINTS} max</small></div>
    <div class="sf-cards">${FLAWS.map(f => toggleChip('flaws', f, x.flaws.includes(f.id), `+${f.gain}`, 'bad')).join('')}</div>
    <div class="sf-sub">Cyberware <small>neural load ${cyberLoad(sheet)}/${cyberCapacity(sheet)} · capacity comes from Endurance</small></div>
    <div class="sf-cards">${CYBERWARE.map(c => toggleChip('cyber', c, sheet.cyber.includes(c.id), free.includes(c.id) ? 'career' : `-${c.cost} · load ${c.load}`, 'cyber', free.includes(c.id))).join('')}</div>`;
}

function stepLaunch(x) {
    const sheet = draftSheet(x);
    const start = draftStart(x);
    const o = originOf(x.origin), c = careerOf(x.career), t = tierOf(x.tier);
    const problems = draftProblems(x);
    const final = buildSheetFromDraft(x);
    const named = (list, ids) => ids.map(id => list.find(i => i.id === id)?.name).filter(Boolean).join(', ') || 'None';
    return `<div class="sf-summary">
        <div class="sf-loc-main">${esc(x.name || 'Unnamed')}</div>
        <div class="sf-loc-sub">${esc(o.name)} · ${t.id === 'pro' ? '' : `${esc(t.name)} `}${esc(c.name)}</div>
        <div class="sf-attr-grid">${ATTRIBUTES.map(a => `<div class="sf-attr"><small>${a.id.toUpperCase()}</small><b>${attrOf(sheet, a.id)}</b></div>`).join('')}</div>
        <div class="sf-kv"><span>Skills</span><b>${SKILL_DEFS.filter(s => skillOf(sheet, s.id) > 0).map(s => `${esc(s.name)} ${skillOf(sheet, s.id)}`).join(', ') || 'None'}</b></div>
        <div class="sf-kv"><span>Traits</span><b>${esc(named(TRAITS, x.traits))}</b></div>
        <div class="sf-kv"><span>Flaws</span><b>${esc(named(FLAWS, x.flaws))}</b></div>
        <div class="sf-kv"><span>Cyberware</span><b>${esc(named(CYBERWARE, sheet.cyber))}</b></div>
        <div class="sf-kv"><span>Health</span><b>${final.maxHealth}</b></div>
        <div class="sf-kv"><span>Credits</span><b>${fmtInt(final.credits)} cr${final.debt ? ` · debt ${fmtInt(final.debt)} cr` : ''}</b></div>
        <div class="sf-kv"><span>Kit</span><b>${esc(PERSONAL_WEAPONS[final.weapon]?.name)}, ${esc(ARMORS[final.armor]?.name)}, ${esc(final.inventory.map(i => i.name).join(', '))}</b></div>
        <div class="sf-kv"><span>Vessel</span><b>${start.ship ? esc(SHIP_CLASSES[start.ship].name) : start.craft ? `${esc(CRAFT_CLASSES[start.craft].name)} (${CRAFT_CLASSES[start.craft].kind}, assigned)` : 'None. You travel as a passenger.'}</b></div>
    </div>
    ${start.ship ? `<label class="sf-field"><span>Ship name</span><input class="sf-input" data-sf-change="cg-field" data-field="shipName" value="${esc(x.shipName)}"></label>` : ''}
    <label class="sf-field"><span>Sector seed</span><input class="sf-input" data-sf-change="cg-field" data-field="seed" value="${esc(x.seed)}" placeholder="random" inputmode="numeric"></label>
    ${problems.map(p => `<div class="sf-warn-line"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(p)}</div>`).join('')}
    <div class="sf-actions">${btn('cg-launch', 'Begin', { icon: 'fa-power-off', cls: 'primary', disabled: problems.length > 0 })}</div>
    <small class="sf-dim">The character is saved inside this chat. Each chat has its own character, sector and save.</small>`;
}

function html() {
    const x = d();
    const p = draftPoints(x);
    const body = [stepIdentity, stepOrigin, stepCareer, stepAbilities, stepEdges, stepLaunch][step](x);
    return `<div class="sf-wizard">
        <div class="sf-wiz-head">
            <div class="sf-wiz-steps">${STEPS.map((s, i) => `<button type="button" class="sf-wiz-step${i === step ? ' active' : ''}${i < step ? ' done' : ''}" data-sf="cg-step" data-step="${i}"><b>${i + 1}</b><span>${s}</span></button>`).join('')}</div>
            <div class="sf-points ${p.left < 0 ? 'over' : ''}"><b>${p.left}</b><small>points left of ${p.total}</small></div>
        </div>
        <div class="sf-wiz-body">${body}</div>
        <div class="sf-wiz-foot">
            ${btn('cg-step', 'Back', { icon: 'fa-chevron-left', data: { step: step - 1 }, disabled: step === 0 })}
            ${step < STEPS.length - 1 ? btn('cg-step', 'Next', { icon: 'fa-chevron-right', cls: 'primary', data: { step: step + 1 } }) : ''}
        </div>
    </div>`;
}

function mount(body) {
    if (scrollTop) {
        body.scrollTop = 0;
        scrollTop = false;
    }
}

export const wizardApi = {
    html,
    mount,
    reset(preset = {}) {
        draft = Object.assign(newDraft(ctx().name1 || 'Unnamed'), preset);
        step = 0;
    },
};

export const wizardActions = {
    'cg-step'(el) {
        step = Math.max(0, Math.min(STEPS.length - 1, Number(el.dataset.step)));
        scrollTop = true;
        redraw();
    },
    'cg-field'(el) {
        d()[el.dataset.field] = el.value;
    },
    'cg-pick'(el) {
        const x = d();
        const { field, value } = el.dataset;
        if (x[field] === value) return;
        x[field] = value;
        // A new package changes the baseline, so bought levels may no longer be legal.
        if (field === 'origin' || field === 'career' || field === 'tier') {
            x.skillBuy = {};
            if (field === 'origin') x.attrBuy = {};
            x.cyber = x.cyber.filter(id => !draftFreeCyber(x).includes(id));
        }
        redraw();
    },
    'cg-attr'(el) {
        const x = d();
        const delta = Number(el.dataset.d);
        if (!draftCanAttr(x, el.dataset.id, delta)) return;
        x.attrBuy[el.dataset.id] = (x.attrBuy[el.dataset.id] ?? 0) + delta;
        redraw();
    },
    'cg-skill'(el) {
        const x = d();
        const delta = Number(el.dataset.d);
        if (!draftCanSkill(x, el.dataset.id, delta)) return;
        x.skillBuy[el.dataset.id] = (x.skillBuy[el.dataset.id] ?? 0) + delta;
        redraw();
    },
    'cg-toggle'(el) {
        const x = d();
        const list = x[el.dataset.list];
        const id = el.dataset.id;
        const i = list.indexOf(id);
        if (i >= 0) list.splice(i, 1);
        else list.push(id);
        redraw();
    },
    'cg-launch'() {
        const x = d();
        const problems = draftProblems(x);
        if (problems.length) return toast('warning', problems[0]);
        const start = draftStart(x);
        const seedNum = Number(x.seed);
        newCampaign({
            sheet: buildSheetFromDraft(x),
            reputation: draftReputation(x),
            homeFaction: originOf(x.origin)?.faction,
            ship: start.ship,
            shipName: String(x.shipName || '').trim() || 'Wandering Star',
            craft: start.craft,
            deathMode: x.deathMode,
            seed: String(x.seed).trim() && Number.isFinite(seedNum) ? seedNum >>> 0 : undefined,
        });
        draft = null;
        step = 0;
        blip('boot');
        toast('success', 'Record opened. Good luck out there.');
    },
};
