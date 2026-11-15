// Ship-OS: Space Opera Suite. Entry point for the SillyTavern extension.
import { initAgentsUi } from './src/ui/agents.js';
import { initShipCombatUi } from './src/ui/shipcombat.js';
import { settings, on } from './src/core/st.js';
import { S, migrate, notify } from './src/core/state.js';
import { initAiLink, refreshPrompt } from './src/core/ailink.js';
import { initSlash } from './src/core/slash.js';
import { initHud, redraw, setScreens, registerActions } from './src/ui/hud.js';
import { initSheet } from './src/ui/sheet.js';
import { wizardApi, wizardActions } from './src/ui/chargen.js';
import { initCombatUi } from './src/ui/combat.js';
import { initCoreTabs } from './src/ui/tabs.js';
import { initMap } from './src/ui/map.js';
import { initSettings, applyTheme } from './src/ui/settings.js';
import { onChange } from './src/core/state.js';

let started = false;

function start() {
    if (started) return;
    started = true;
    try {
        settings();
        applyTheme();
        initCoreTabs();
        initMap();
        const sheet = initSheet(wizardApi);
        setScreens(wizardApi, sheet.deathHtml);
        registerActions(wizardActions);
        initCombatUi();
        initShipCombatUi();
        initAgentsUi();
        initHud();
        initSettings();
        initSlash();
        initAiLink();
        onChange(() => refreshPrompt());
        on('CHAT_CHANGED', () => {
            const st = S();
            if (st) migrate(st);
            notify('chat');
        });
        const st = S();
        if (st) migrate(st);
        redraw();
        console.log('[Ship-OS] online');
    } catch (e) {
        console.error('[Ship-OS] failed to start', e);
    }
}

if (globalThis.SillyTavern?.getContext) {
    // Extensions load after the app shell exists, so the DOM is ready here.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
} else {
    console.error('[Ship-OS] SillyTavern context not found');
}
