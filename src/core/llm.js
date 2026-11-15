// Side calls: short background requests to a language model that never touch the chat.
// They can go to the model the chat is using, or to a separate (usually faster and cheaper)
// connection profile chosen in the settings.
import { ctx, settings } from './st.js';

let chain = Promise.resolve();
let busy = 0;
const listeners = new Set();

/** Subscribes to "a side call started or finished", for activity indicators. */
export function onSideActivity(fn) { listeners.add(fn); }
export const sideBusy = () => busy > 0;
const ping = () => listeners.forEach(fn => { try { fn(busy); } catch { /* ignore */ } });

/** Connection profiles the user has saved in SillyTavern's Connection Manager. */
export function sideProfiles() {
    const c = ctx();
    if (c.extensionSettings?.disabledExtensions?.includes?.('connection-manager')) return [];
    const list = c.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(list) ? list.filter(p => p?.id && p?.name).map(p => ({ id: p.id, name: p.name, model: p.model ?? '' })) : [];
}

/** The profile side calls will use, or null when they go to the chat's own model. */
export function sideProfile() {
    const cfg = settings();
    if (cfg.sideSource !== 'profile' || !cfg.sideProfile) return null;
    return sideProfiles().find(p => p.id === cfg.sideProfile) ?? null;
}

function clean(text) {
    return String(text ?? '')
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/^[\s\S]*<\/think(?:ing)?>/i, '')
        .trim();
}

async function request({ system, prompt, maxTokens, signal }) {
    const c = ctx();
    const profile = sideProfile();
    if (profile && c.ConnectionManagerRequestService?.sendRequest) {
        const messages = [];
        if (system) messages.push({ role: 'system', content: system });
        messages.push({ role: 'user', content: prompt });
        const res = await c.ConnectionManagerRequestService.sendRequest(profile.id, messages, maxTokens, {
            stream: false, signal, extractData: true, includePreset: true, includeInstruct: true,
        });
        return clean(typeof res === 'string' ? res : res?.content);
    }
    if (typeof c.generateRaw !== 'function') throw new Error('This SillyTavern version has no background generation');
    return clean(await c.generateRaw({ prompt, systemPrompt: system ?? '', responseLength: maxTokens }));
}

/**
 * Runs one side call. Calls are queued so that they never overlap, which keeps slow local
 * backends and rate-limited APIs happy.
 * @returns {Promise<string>} the model's text
 */
export function sideCall({ system = '', prompt, maxTokens = 400, signal = null }) {
    const run = async () => {
        busy++; ping();
        try {
            return await request({ system, prompt, maxTokens, signal });
        } finally {
            busy--; ping();
        }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
}

/** Pulls the first JSON object out of a model reply, tolerating code fences and chatter. */
export function parseJson(text) {
    const s = String(text ?? '');
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    const body = s.slice(a, b + 1);
    try { return JSON.parse(body); } catch { /* try a light repair */ }
    try { return JSON.parse(body.replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
}
