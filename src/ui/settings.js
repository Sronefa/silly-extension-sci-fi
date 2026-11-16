// Settings drawer in the Extensions panel, plus theme class management.
import { settings, saveSettings, toast, ctx } from '../core/st.js';
import { S, deleteCampaign, importCampaign, notify } from '../core/state.js';
import { applyLayout, confirmAsk } from './hud.js';
import { refreshPrompt } from '../core/ailink.js';
import { sideProfiles, sideCall } from '../core/llm.js';

const PALETTES = {
    cyan: 'Fleet cyan',
    amber: 'CIC amber',
    green: 'Terminal green',
    violet: 'Deep violet',
    ice: 'Ice white',
};

const FONT_URL = 'https://fonts.googleapis.com/css2?family=Exo+2:ital,wght@0,400;0,500;0,600;1,400&family=Orbitron:wght@500;700&family=Share+Tech+Mono&display=swap';

export function applyTheme() {
    const cfg = settings();
    const b = document.body.classList;
    const on = cfg.enabled;
    b.toggle('sf-theme', on && cfg.theme);
    b.toggle('sf-scanlines', on && cfg.theme && cfg.scanlines);
    b.toggle('sf-starfield', on && cfg.theme && cfg.starfield);
    b.toggle('sf-fonts', on && cfg.fonts);
    for (const p of Object.keys(PALETTES)) b.toggle(`sf-pal-${p}`, cfg.palette === p);
    let link = document.getElementById('sf-fonts-link');
    if (on && cfg.fonts && !link) {
        link = document.createElement('link');
        link.id = 'sf-fonts-link';
        link.rel = 'stylesheet';
        link.href = FONT_URL;
        document.head.appendChild(link);
    }
}

function applyAll() {
    saveSettings();
    applyTheme();
    applyLayout();
    refreshPrompt();
}

const check = (key, label, hint = '') => `<label class="checkbox_label" title="${hint}"><input type="checkbox" data-sfs="${key}"><span>${label}</span></label>`;

export function initSettings() {
    const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.id = 'sf-settings';
    wrap.innerHTML = `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Ship-OS: Space Opera Suite</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            ${check('enabled', 'Enable Ship-OS')}
            <h4>Interface</h4>
            ${check('theme', 'Sci-fi restyle of SillyTavern', 'Restyles chat, panels, buttons and inputs')}
            <label>Colour scheme <select class="text_pole" data-sfs="palette">${Object.entries(PALETTES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
            ${check('fonts', 'Sci-fi fonts (loaded from Google Fonts)')}
            ${check('scanlines', 'Scanline overlay')}
            ${check('starfield', 'Starfield behind the chat')}
            ${check('redAlert', 'Alert status recolours the interface')}
            ${check('strip', 'Status strip above the chat')}
            ${check('fab', 'Floating console button')}
            ${check('sfx', 'Interface sounds')}
            <h4>Simulation</h4>
            ${check('needsDecay', 'Needs drain as time passes')}
            <label>Needs drain speed <input type="range" min="0.25" max="3" step="0.25" data-sfs="needsRate"> <span id="sf-rate-val"></span></label>
            <label title="Story time added for an AI reply that does not say how long it took. 0 times it from its text: a few lines of talk are seconds, a long scene a few minutes.">Fixed minutes per untimed AI reply (0 = judge from the text) <input type="number" class="text_pole" min="0" max="120" data-sfs="autoMinutes"></label>
            ${check('combatSpeech', 'AI-written shouts during fights (extra AI calls)', 'A few short side calls per fight so enemies and allies say things in character')}
            <h4>AI link</h4>
            ${check('inject', 'Send character and ship telemetry to the AI')}
            ${check('injectNearby', 'Include local stations and jump lanes')}
            ${check('aiCommands', 'Let the AI update the state with hidden &lt;sf&gt; tags')}
            <label title="Automatic: the game places its three blocks itself. Preset macros: nothing is added automatically; put {{shipos_rules}}, {{shipos_state}} and {{shipos_now}} (or {{shipos}} for all three) where your preset wants them.">How the game reaches the AI <select class="text_pole" data-sfs="injectMode"><option value="auto">Automatic injection</option><option value="macros">Only through preset macros</option></select></label>
            <label title="Some models and presets handle system messages inside the chat badly. Pick user if yours does.">Role of the injected blocks <select class="text_pole" data-sfs="injectRole"><option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option></select></label>
            <label title="Rules change only when the situation does. After the main prompt they stay put and are cached; in the chat they sit closer to the reply.">Rules block goes <select class="text_pole" data-sfs="rulesAt"><option value="prompt">After the main prompt</option><option value="chat">In the chat, at a depth</option></select></label>
            <label>Rules depth (in the chat) <input type="number" class="text_pole" min="0" max="50" data-sfs="rulesDepth"></label>
            <label title="The state of the world. The short 'now' block always goes last, just before the reply.">State block depth <input type="number" class="text_pole" min="0" max="20" data-sfs="injectDepth"></label>
            <small>Macros for presets: {{shipos_rules}}, {{shipos_state}}, {{shipos_now}}, {{shipos}}. They work in either mode; use them in the preset only with "Only through preset macros", or the blocks are sent twice.</small>
            <h4>Second model and agents</h4>
            <small>Background jobs can use a different, faster model than the one that writes the story. Save it as a Connection Profile in SillyTavern, then pick it here.</small>
            <label>Background jobs use <select class="text_pole" data-sfs="sideSource"><option value="main">The same model as the chat</option><option value="profile">A connection profile</option></select></label>
            <label>Connection profile <select class="text_pole" data-sfs="sideProfile" id="sf-side-profile"></select></label>
            <div class="flex-container"><div class="menu_button" id="sf-side-test">Test the background model</div></div>
            ${check('tracker', 'Tracker pass: a model reads each reply and updates the state', 'One extra call per AI reply. Works together with, or instead of, the hidden tags written by the story model')}
            ${check('loreAgent', 'Lorebook agent: keeps a campaign lorebook up to date', 'Creates, updates, merges and switches entries in a lorebook bound to this chat')}
            <label>Lorebook agent runs every <input type="number" class="text_pole" min="1" max="50" data-sfs="loreEvery"> AI replies</label>
            <h4>Campaign in this chat</h4>
            <div class="flex-container">
                <div class="menu_button" id="sf-export">Export save</div>
                <div class="menu_button" id="sf-import">Import save</div>
                <div class="menu_button redWarningBG" id="sf-reset">Delete campaign</div>
            </div>
            <input type="file" id="sf-import-file" accept=".json,application/json" hidden>
        </div>
    </div>`;
    host.appendChild(wrap);

    const cfg = settings();
    const fillProfiles = () => {
        const sel = wrap.querySelector('#sf-side-profile');
        const list = sideProfiles();
        sel.innerHTML = `<option value="">${list.length ? 'Choose a profile' : 'No connection profiles saved'}</option>` + list.map(p => `<option value="${p.id}">${p.name.replace(/[<>&"]/g, '')}${p.model ? ` (${String(p.model).replace(/[<>&"]/g, '')})` : ''}</option>`).join('');
    };
    fillProfiles();
    wrap.querySelector('#sf-side-profile').addEventListener('pointerdown', () => { const v = cfg.sideProfile; fillProfiles(); wrap.querySelector('#sf-side-profile').value = v; });
    wrap.querySelector('#sf-side-test').addEventListener('click', async () => {
        toast('info', 'Calling the background model…');
        const t0 = Date.now();
        try {
            const out = await sideCall({ system: 'You are a ship computer.', prompt: 'Reply with exactly: LINK ESTABLISHED', maxTokens: 20 });
            toast('success', `Answered in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${String(out).slice(0, 60)}`);
        } catch (e) { toast('error', `The background model did not answer: ${e.message}`); }
    });
    const sync = () => {
        wrap.querySelectorAll('[data-sfs]').forEach(el => {
            const k = el.dataset.sfs;
            if (el.type === 'checkbox') el.checked = !!cfg[k];
            else el.value = cfg[k];
        });
        wrap.querySelector('#sf-rate-val').textContent = `×${cfg.needsRate}`;
    };
    sync();
    wrap.addEventListener('input', (ev) => {
        const el = ev.target.closest('[data-sfs]');
        if (!el) return;
        const k = el.dataset.sfs;
        cfg[k] = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.type === 'range') ? Number(el.value) : el.value;
        sync();
        applyAll();
    });

    wrap.querySelector('#sf-export').addEventListener('click', () => {
        const st = S();
        if (!st) return toast('warning', 'No campaign in this chat.');
        const blob = new Blob([JSON.stringify(st, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ship-os-${st.captain.name.replace(/\W+/g, '-').toLowerCase()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    const file = wrap.querySelector('#sf-import-file');
    wrap.querySelector('#sf-import').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
        const f = file.files?.[0];
        file.value = '';
        if (!f) return;
        try {
            importCampaign(JSON.parse(await f.text()));
            refreshPrompt();
            toast('success', 'Campaign imported into this chat.');
        } catch (e) {
            toast('error', `Import failed: ${e.message}`);
        }
    });
    wrap.querySelector('#sf-reset').addEventListener('click', async () => {
        if (!S()) return toast('warning', 'No campaign in this chat.');
        if (!(await confirmAsk('Delete this campaign?', 'The ship, crew, cargo and log stored in this chat will be erased.'))) return;
        deleteCampaign();
        refreshPrompt();
        notify('delete');
    });
    void ctx;
}
