// The refit screen: every hardpoint of the player's own ship and what can go in it.
import { registerWidget, registerActions, redraw } from './hud.js';
import { S, commit } from '../core/state.js';
import { toast } from '../core/st.js';
import { esc, fmtInt } from '../core/util.js';
import { ARC_NAMES, LEGAL } from '../data/vessels.js';
import { MODULES, SLOT_TYPES, SLOT_SIZE, fits, refitRule } from '../data/modules.js';
import { slotsOf, fitted, refitQuote, refit, addSpare } from '../systems/refit.js';
import { registerCommand } from '../systems/sim.js';
import { blip } from './sfx.js';

let openSlot = null;

function optionRow(st, slot, mod) {
    const q = refitQuote(st, slot, mod?.id ?? null);
    const tag = mod ? `<span class="sf-tag l-${mod.legal}">${esc(LEGAL[mod.legal].name)}</span>` : '';
    const terms = q.ok ? `${q.hours} h${q.cost ? ` · ${fmtInt(q.cost)} cr` : q.spare && mod ? ' · from stores' : ''}` : q.why;
    return `<li class="sf-row sf-fit-opt${q.ok ? '' : ' blocked'}"><span class="sf-grow"><b>${esc(mod?.name ?? 'Leave it empty')}</b> ${mod ? `<small class="sf-dim">${esc(SLOT_SIZE[mod.size].toLowerCase())}${q.spare ? ' · in stores' : ` · ${fmtInt(mod.price)} cr`}</small>` : ''}
        ${mod?.desc ? `<br><small class="sf-dim">${esc(mod.desc)}</small>` : ''}<br><small class="${q.ok ? 'sf-ok-line' : 'sf-warn-line'}">${esc(terms)}</small></span>${tag}
        <button type="button" class="sf-btn${q.ok ? ' primary' : ''}" data-sf="fit-do" data-slot="${slot.id}" data-mod="${mod?.id ?? ''}"${q.ok ? '' : ' disabled'}>${mod ? 'Fit' : 'Strip'}</button></li>`;
}

function refitHtml(st) {
    const slots = slotsOf(st);
    if (!slots.length) return '<div class="sf-dim">This hull has no hardpoints to refit.</div>';
    const spares = st.ship.spares ?? [];
    const groups = Object.entries(SLOT_TYPES).map(([type, info]) => {
        const list = slots.filter(s => s.type === type);
        if (!list.length) return '';
        const rows = list.map(slot => {
            const cur = fitted(st, slot);
            const open = openSlot === slot.id;
            let detail = '';
            if (open) {
                const mods = Object.values(MODULES).filter(m => fits(m, slot) && m.id !== cur).sort((a, b) => (spares.includes(b.id) - spares.includes(a.id)) || b.size - a.size || a.name.localeCompare(b.name));
                detail = `<ul class="sf-list sf-fit-list">${cur ? optionRow(st, slot, null) : ''}${mods.map(m => optionRow(st, slot, m)).join('') || '<li class="sf-dim">Nothing else fits here.</li>'}</ul>`;
            }
            return `<li class="sf-reg${open ? ' open' : ''}"><div class="sf-row" data-sf="fit-open" data-id="${slot.id}"><span class="sf-grow"><b>${esc(cur ? MODULES[cur].name : 'Empty')}</b>
                <small class="sf-dim">${esc(SLOT_SIZE[slot.size].toLowerCase())} ${esc(info.one.toLowerCase())}${slot.arc ? ` · ${esc(ARC_NAMES[slot.arc])}` : ''}${cur && cur !== slot.stock ? ' · refitted' : ''}</small></span>
                <i class="fa-solid ${open ? 'fa-chevron-up' : 'fa-chevron-down'}"></i></div>${detail}</li>`;
        }).join('');
        return `<div class="sf-sub">${esc(info.name)}</div><ul class="sf-list">${rows}</ul>`;
    }).join('');
    return `<small class="sf-dim">A module fits a mount of its own type that is at least its size. Small modules are swapped by ${esc(refitRule(1).by)} in ${refitRule(1).hours} hours; medium ones by ${esc(refitRule(2).by)}; anything larger is yard work that takes days. What you take out goes into stores.</small>
        ${groups}
        <div class="sf-sub">Stores</div><div class="sf-tags">${spares.length ? spares.map(id => `<span class="sf-tag">${esc(MODULES[id]?.name ?? id)}</span>`).join('') : '<span class="sf-dim">No spare modules aboard.</span>'}</div>`;
}

export function initRefitUi() {
    registerWidget({ id: 'refit', when: (st) => !!st.ship, title: () => 'Hardpoints and refit', render: refitHtml });
    registerActions({
        'fit-open'(el) { openSlot = openSlot === el.dataset.id ? null : el.dataset.id; redraw(); },
        'fit-do'(el) {
            try { toast('success', refit(el.dataset.slot, el.dataset.mod || null)); blip('click'); openSlot = null; } catch (e) { toast('warning', e.message); blip('error'); }
            commit('refit');
        },
    });
    registerCommand('spare', (st, args) => {
        const key = String(args.join(' ')).toLowerCase().trim();
        const mod = MODULES[key] ?? Object.values(MODULES).find(m => m.name.toLowerCase() === key) ?? Object.values(MODULES).find(m => m.name.toLowerCase().includes(key) && key.length >= 4);
        if (!mod) throw new Error(`unknown module "${args.join(' ')}"`);
        return addSpare(mod.id);
    }, ['module', 'salvagemodule']);
    void S;
}
