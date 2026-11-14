// Ship-OS: Space Opera Suite. Entry point for the SillyTavern extension.
import { settings, on } from './src/core/st.js';
import { S, migrate, notify } from './src/core/state.js';
import { initAiLink, refreshPrompt } from './src/core/ailink.js';
import { initSlash } from './src/core/slash.js';
import { initHud, redraw } from './src/ui/hud.js';
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
