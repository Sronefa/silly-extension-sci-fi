// Slash commands and macros so Ship-OS can be driven from Quick Replies and scripts.
import { ctx, gmOn, toast } from './st.js';
import { S, commit, fmtDate, locationLabel } from './state.js';
import { runBlock } from '../systems/sim.js';
import { buildTelemetry } from './ailink.js';
import { openHud, toggleHud } from '../ui/hud.js';
import { fmtInt } from './util.js';

function add(name, callback, helpString, aliases = []) {
    const c = ctx();
    try {
        if (c.SlashCommandParser?.addCommandObject && c.SlashCommand?.fromProps) {
            const arg = c.SlashCommandArgument?.fromProps && c.ARGUMENT_TYPE
                ? [c.SlashCommandArgument.fromProps({ description: 'text', typeList: [c.ARGUMENT_TYPE.STRING], isRequired: false })]
                : [];
            c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
                name, aliases, helpString, unnamedArgumentList: arg,
                callback: (_named, unnamed) => String(callback(String(unnamed ?? '')) ?? ''),
            }));
            return;
        }
    } catch (e) {
        console.warn('[Ship-OS] modern slash registration failed, using legacy', e);
    }
    c.registerSlashCommand?.(name, (_n, u) => String(callback(String(u ?? '')) ?? ''), aliases, helpString);
}

function macro(name, handler, description) {
    const c = ctx();
    try {
        if (c.macros?.register) return void c.macros.register(name, { handler, description });
    } catch { /* fall through to legacy */ }
    try { c.registerMacro?.(name, handler); } catch (e) { console.warn('[Ship-OS] macro failed', name, e); }
}

export function initSlash() {
    add('sf', (text) => {
        if (!text.trim()) { toggleHud(); return ''; }
        // Running raw commands is a game master tool, like the console.
        if (!gmOn()) { toast('info', 'Ship-OS commands need game master mode (Ship-OS settings).'); return ''; }
        const results = runBlock(text);
        commit('slash');
        return results.map(r => r.text).filter(Boolean).join('; ');
    }, 'Ship-OS: run state commands, e.g. <code>/sf credits -200; time +2h</code>. With no text it opens the console.', ['shipos']);
    add('sf-open', (tab) => { openHud(tab.trim() || undefined); return ''; }, 'Ship-OS: open the console, optionally on a tab (status, sheet, ship, nav, gear, dossier, log).');
    add('sf-status', () => buildTelemetry(), 'Ship-OS: returns the telemetry text that is sent to the AI.');

    const st = () => S();
    macro('sf_date', () => (st() ? fmtDate(st().minutes) : ''), 'Ship-OS in-universe date');
    macro('sf_location', () => (st() ? locationLabel(st()) : ''), 'Ship-OS current location');
    macro('sf_credits', () => (st() ? fmtInt(st().captain.credits) : ''), 'Ship-OS credits');
    macro('sf_ship', () => st()?.ship?.name ?? '', 'Ship-OS ship name');
}
