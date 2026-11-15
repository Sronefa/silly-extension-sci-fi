// The Archive panel: what the lorebook agent has written, with manual controls.
import { registerWidget, registerActions, btn, redraw } from './hud.js';
import { S, onChange } from '../core/state.js';
import { settings } from '../core/st.js';
import { esc } from '../core/util.js';
import { onSideActivity, sideProfile } from '../core/llm.js';
import { loreEntries, runLoreAgent, editLoreEntry, loreBusy, initAgents } from '../systems/agents.js';

let cache = [];
let cacheBook = null;
let open = null;

async function reload() {
    try {
        cache = await loreEntries();
        cacheBook = S()?.lore?.book ?? null;
    } catch { cache = []; }
    redraw();
}

function archiveHtml(st) {
    const cfg = settings();
    if ((st.lore?.book ?? null) !== cacheBook) reload();
    const prof = sideProfile();
    const rows = cache.map(e => `<li class="sf-lore${e.disabled ? ' off' : ''}${open === e.uid ? ' open' : ''}">
        <div class="sf-row" data-sf="lore-open" data-id="${e.uid}"><span class="sf-grow"><b>${esc(e.title)}</b> <small class="sf-dim">${esc(e.keys.join(', '))}</small></span>
        ${e.disabled ? '<span class="sf-tag">off</span>' : ''}</div>
        ${open === e.uid ? `<p class="sf-lore-text">${esc(e.content)}</p><div class="sf-actions">
            ${btn('lore-toggle', e.disabled ? 'Switch on' : 'Switch off', { icon: 'fa-power-off', cls: 'ghost', data: { id: e.uid } })}
            ${btn('lore-delete', 'Delete', { icon: 'fa-trash', cls: 'ghost', data: { id: e.uid } })}</div>` : ''}
    </li>`).join('');
    return `<small class="sf-dim">${cfg.loreAgent ? `The archivist reads the story every ${cfg.loreEvery} replies` : 'The archivist is off (Extensions settings), but you can run it by hand'}${st.lore?.book ? ` and writes to the lorebook “${esc(st.lore.book)}”` : ''}. Model: ${esc(prof ? prof.name : 'same as the chat')}.</small>
        <ul class="sf-list">${rows || '<li class="sf-dim">Nothing archived yet.</li>'}</ul>
        <div class="sf-actions">${btn('lore-run', loreBusy() ? 'Archiving…' : 'Update archive now', { icon: 'fa-book-atlas', cls: 'primary', disabled: loreBusy() })}</div>`;
}

export function initAgentsUi() {
    initAgents();
    registerWidget({ id: 'archive', title: () => `Archive${cache.length ? ` (${cache.length})` : ''}`, render: archiveHtml });
    registerActions({
        'lore-open'(el) { const id = Number(el.dataset.id); open = open === id ? null : id; redraw(); },
        async 'lore-run'() { const p = runLoreAgent({ manual: true }); redraw(); await p; await reload(); },
        async 'lore-toggle'(el) { await editLoreEntry(el.dataset.id, 'toggle'); await reload(); },
        async 'lore-delete'(el) { await editLoreEntry(el.dataset.id, 'delete'); open = null; await reload(); },
    });
    onChange((reason) => { if (reason === 'lore' || reason === 'chat') reload(); });
    // A small pulse on the console header while a background model call is running.
    onSideActivity((n) => document.querySelectorAll('.sf-root').forEach(el => el.classList.toggle('sf-thinking', n > 0)));
}
