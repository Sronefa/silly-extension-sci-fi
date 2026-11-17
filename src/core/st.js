// Thin wrapper around the SillyTavern global context. Everything goes through
// SillyTavern.getContext() so the extension has no relative imports into the host app,
// which keeps it working on desktop, mobile browsers and Tauri-based ports.

export const MODULE = 'scifi_os';

export function ctx() {
    return globalThis.SillyTavern.getContext();
}

export const DEFAULT_SETTINGS = {
    enabled: true,
    // Interface
    theme: true,
    palette: 'cyan',
    fonts: true,
    scanlines: true,
    starfield: true,
    redAlert: true,
    strip: true,
    fab: true,
    dock: 'right',
    sfx: false,
    // Simulation
    needsDecay: true,
    needsRate: 1,
    encounters: true,
    autoMinutes: 0,
    combatSpeech: false,
    wages: true,
    // AI link
    inject: true,
    injectDepth: 1,
    injectMode: 'message',
    injectRole: 'system',
    rulesAt: 'prompt',
    rulesDepth: 8,
    injectNearby: true,
    aiCommands: true,
    hideTags: true,
    // Side model and agents
    sideSource: 'main',
    sideProfile: '',
    tracker: false,
    loreAgent: false,
    loreEvery: 6,
    // Panel actions write a line into the chat box and happen when the message is sent.
    chatActions: true,
    actionStars: true,
    // Game master mode: hand edits, free time, the command console. Off in normal play.
    gmMode: false,
};

/** True when game master mode is on: numbers can be edited by hand and any command run. */
export const gmOn = () => !!settings().gmMode;

export function settings() {
    const c = ctx();
    if (!c.extensionSettings[MODULE]) c.extensionSettings[MODULE] = {};
    const s = c.extensionSettings[MODULE];
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (s[k] === undefined) s[k] = v;
    }
    // Replies used to cost a flat five minutes; they are now timed by what they cover.
    if (s.timeRules !== 2) { s.timeRules = 2; if (Number(s.autoMinutes) === 5) s.autoMinutes = 0; }
    // The first preset-friendly build called the default mode 'auto'.
    if (s.injectMode === 'auto') s.injectMode = 'message';
    return s;
}

export function saveSettings() {
    ctx().saveSettingsDebounced();
}

export function events() {
    const c = ctx();
    return { source: c.eventSource, types: c.eventTypes ?? c.event_types };
}

export function on(typeName, handler) {
    const { source, types } = events();
    const type = types?.[typeName];
    if (source && type) source.on(type, handler);
}

export function toast(kind, message, title = 'Ship-OS') {
    const t = globalThis.toastr;
    if (t && typeof t[kind] === 'function') t[kind](message, title, { timeOut: 3500 });
    else console.log(`[Ship-OS] ${kind}: ${message}`);
}

export function userName() {
    return ctx().name1 || 'Captain';
}

export function hasChat() {
    const c = ctx();
    return c.characterId !== undefined || !!c.groupId;
}

/** Puts text into the chat input so the user can review and send it. */
export function toInput(text, { append = true } = {}) {
    const el = document.getElementById('send_textarea');
    if (!el) return;
    const cur = el.value.trim();
    el.value = append && cur ? `${cur}\n${text}` : text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
}
