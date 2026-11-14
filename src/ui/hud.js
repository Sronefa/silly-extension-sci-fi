// The HUD shell: floating launcher, status strip above the chat, and the tabbed panel.
// Feature modules register tabs and click actions here; the shell owns layout and redraws.
import { ctx, settings, saveSettings, hasChat, toast } from '../core/st.js';
import { S, onChange, fmtDate, locationLabel, newCampaign } from '../core/state.js';
import { esc, pct, gaugeClass, fmtInt, debounce } from '../core/util.js';
import { SHIP_CLASSES } from '../data/catalog.js';
import { needStatuses } from '../systems/sim.js';
import { blip } from './sfx.js';

const tabs = [];
const widgets = new Map();
const actions = {};
let floatLayer;
let active = 'bridge';
let root, strip, fab;

export function registerTab(tab) {
    tabs.push(tab);
    tabs.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
    Object.assign(actions, tab.actions ?? {});
}

/**
 * A widget is one self-contained panel. Tabs are lists of widgets, and on wide screens
 * any widget can be popped out of the console and dragged anywhere on the page.
 */
export function registerWidget(w) {
    widgets.set(w.id, w);
}

const isNarrow = () => window.matchMedia('(max-width: 1000px)').matches;
const floating = () => (settings().floating ??= {});
const isFloating = (id) => !isNarrow() && !!floating()[id];

function widgetHtml(id, st, { floated = false } = {}) {
    const w = widgets.get(id);
    if (!w) return '';
    let body;
    try { body = w.render(st); } catch (e) { console.error('[Ship-OS] widget failed', id, e); body = `<div class="sf-warn-line">Widget error: ${esc(e.message)}</div>`; }
    const tools = floated
        ? `<button type="button" class="sf-icon-btn sf-pop" data-sf="widget-dock" data-id="${id}" title="Return to console"><i class="fa-solid fa-down-left-and-up-right-to-center"></i></button>`
        : `<button type="button" class="sf-icon-btn sf-pop" data-sf="widget-pop" data-id="${id}" title="Pop out as a movable widget"><i class="fa-solid fa-up-right-from-square"></i></button>`;
    return `<section class="sf-panel${w.flush ? ' flush' : ''}" data-widget="${id}"><h3 class="sf-panel-title"><span>${esc(w.title(st))}</span>${tools}</h3><div class="sf-panel-body">${body}</div></section>`;
}

function renderTabBody(tab, st) {
    if (tab.render) return tab.render(st);
    return tab.widgets.map(id => (isFloating(id)
        ? `<div class="sf-floating-note"><i class="fa-solid fa-up-right-from-square"></i> ${esc(widgets.get(id)?.title(st) ?? id)} is floating ${btn('widget-dock', 'Return', { cls: 'ghost', data: { id } })}</div>`
        : widgetHtml(id, st))).join('');
}

function mountWidgets(container) {
    container.querySelectorAll('[data-widget]').forEach(el => widgets.get(el.dataset.widget)?.mount?.(el));
}

function renderFloating() {
    if (!floatLayer) return;
    const st = S();
    const cfg = settings();
    const map = floating();
    const ids = cfg.enabled && st && !isNarrow() ? Object.keys(map).filter(id => widgets.has(id)) : [];
    for (const el of [...floatLayer.children]) if (!ids.includes(el.dataset.float)) el.remove();
    for (const id of ids) {
        let el = floatLayer.querySelector(`[data-float="${id}"]`);
        if (!el) {
            el = document.createElement('div');
            el.className = 'sf-widget sf-root';
            el.dataset.float = id;
            floatLayer.appendChild(el);
        }
        const pos = map[id];
        const scroll = el.querySelector('.sf-panel-body')?.scrollTop ?? 0;
        el.style.width = `${pos.w ?? 340}px`;
        el.innerHTML = widgetHtml(id, st, { floated: true });
        placeWidget(el, pos);
        mountWidgets(el);
        const body = el.querySelector('.sf-panel-body');
        if (body) body.scrollTop = scroll;
    }
}

function placeWidget(el, pos) {
    const x = Math.max(0, Math.min(window.innerWidth - 80, pos.x));
    const y = Math.max(0, Math.min(window.innerHeight - 40, pos.y));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
}

/** Drag floating widgets by their title bar. */
function initDrag() {
    let drag = null;
    document.addEventListener('pointerdown', (e) => {
        const head = e.target.closest?.('.sf-widget .sf-panel-title');
        if (!head || e.target.closest('button')) return;
        const el = head.closest('.sf-widget');
        const r = el.getBoundingClientRect();
        drag = { el, id: el.dataset.float, dx: e.clientX - r.left, dy: e.clientY - r.top };
        el.classList.add('dragging');
        floatLayer.appendChild(el); // bring to front
        e.preventDefault();
    });
    document.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const pos = floating()[drag.id];
        if (!pos) return;
        pos.x = Math.round(e.clientX - drag.dx);
        pos.y = Math.round(e.clientY - drag.dy);
        placeWidget(drag.el, pos);
    });
    const end = () => {
        if (!drag) return;
        drag.el.classList.remove('dragging');
        drag = null;
        saveSettings();
    };
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => redraw());
}

export function registerActions(map) {
    Object.assign(actions, map);
}

export function gauge(label, value, max, { cls, text, invert = false, edit = '' } = {}) {
    const p = pct(value, max);
    const level = cls ?? gaugeClass(invert ? 100 - p : p);
    return `<div class="sf-gauge-row${edit ? ' sf-editable' : ''}"${edit ? ` data-sf="edit" data-cmd="${esc(edit)}" data-label="${esc(label)}"` : ''}>
        <span class="sf-gauge-label">${esc(label)}</span>
        <div class="sf-gauge ${level}"><span style="width:${p}%"></span></div>
        <span class="sf-gauge-val">${esc(text ?? `${Math.round(value)}/${Math.round(max)}`)}</span>
    </div>`;
}

export function panel(title, body, extra = '') {
    return `<section class="sf-panel"><h3 class="sf-panel-title"><span>${esc(title)}</span>${extra}</h3><div class="sf-panel-body">${body}</div></section>`;
}

export function btn(action, label, { icon = '', cls = '', data = {}, disabled = false, title = '' } = {}) {
    const d = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
    return `<button type="button" class="sf-btn ${cls}" data-sf="${action}"${d}${disabled ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${icon ? `<i class="fa-solid ${icon}"></i>` : ''}${label ? `<span>${esc(label)}</span>` : ''}</button>`;
}

/** Asks the user for a line of text using the host popup, falling back to window.prompt. */
export async function ask(title, def = '') {
    const P = ctx().Popup;
    try {
        if (P?.show?.input) return await P.show.input(title, '', String(def));
    } catch { /* fall through */ }
    return window.prompt(title, def);
}

export async function confirmAsk(title, text = '') {
    const P = ctx().Popup;
    try {
        if (P?.show?.confirm) return !!(await P.show.confirm(title, text));
    } catch { /* fall through */ }
    return window.confirm(`${title}\n${text}`);
}

function wizardHtml() {
    if (!hasChat()) {
        return `<div class="sf-empty"><i class="fa-solid fa-satellite-dish"></i><p>NO UPLINK</p><small>Open a chat to bring Ship-OS online.</small></div>`;
    }
    const classes = Object.values(SHIP_CLASSES).map(c =>
        `<option value="${c.id}"${c.id === 'mule' ? ' selected' : ''}>${esc(c.name)}: hull ${c.hull}, cargo ${c.cargo} t</option>`).join('');
    return `<div class="sf-wizard">
        <div class="sf-boot">
            <div>SHIP-OS v1.0 // COLD START</div>
            <div>REACTOR ............ STANDBY</div>
            <div>NAV DATABASE ....... EMPTY</div>
            <div>CREW MANIFEST ...... UNREGISTERED</div>
        </div>
        ${panel('Register vessel', `
            <label class="sf-field"><span>Captain</span><input class="sf-input" id="sf-w-captain" value="${esc(ctx().name1 || 'Captain')}"></label>
            <label class="sf-field"><span>Ship name</span><input class="sf-input" id="sf-w-ship" value="Wandering Star"></label>
            <label class="sf-field"><span>Hull class</span><select class="sf-input" id="sf-w-class">${classes}</select></label>
            <label class="sf-field"><span>Starting funds</span><select class="sf-input" id="sf-w-diff">
                <option value="easy">Comfortable (25,000 cr)</option>
                <option value="normal" selected>Standard (10,000 cr)</option>
                <option value="hard">Scraping by (3,000 cr)</option>
            </select></label>
            <label class="sf-field"><span>Sector seed</span><input class="sf-input" id="sf-w-seed" placeholder="random" inputmode="numeric"></label>
            <div class="sf-actions">${btn('wizard-start', 'Initialise campaign', { icon: 'fa-power-off', cls: 'primary' })}</div>
            <small class="sf-dim">The campaign is saved inside this chat. Each chat has its own ship, sector and save.</small>
        `)}
    </div>`;
}

function renderHud() {
    if (!root) return;
    const st = S();
    const head = root.querySelector('.sf-hud-date');
    head.textContent = st ? fmtDate(st.minutes) : 'OFFLINE';
    root.dataset.alert = st?.alert ?? 'green';
    const nav = root.querySelector('.sf-tabs');
    const body = root.querySelector('.sf-body');
    if (!st) {
        nav.innerHTML = '';
        body.innerHTML = wizardHtml();
        return;
    }
    if (!tabs.some(t => t.id === active)) active = tabs[0]?.id;
    nav.innerHTML = tabs.map(t => `<button type="button" class="sf-tab${t.id === active ? ' active' : ''}" data-sf="tab" data-tab="${t.id}">
        <i class="fa-solid ${t.icon}"></i><span>${esc(t.label)}</span>${t.badge?.(st) ? `<b class="sf-badge">${esc(t.badge(st))}</b>` : ''}</button>`).join('');
    const tab = tabs.find(t => t.id === active);
    const scroll = body.scrollTop;
    // Tabs that own live widgets (the map) can update in place instead of being rebuilt.
    if (body.dataset.tab === active && tab.update?.(body, st)) return;
    body.dataset.tab = active;
    body.innerHTML = renderTabBody(tab, st);
    tab.mount?.(body, st);
    mountWidgets(body);
    body.scrollTop = scroll;
}

function renderStrip() {
    if (!strip) return;
    const cfg = settings();
    const st = S();
    strip.hidden = !(cfg.enabled && cfg.strip && st);
    if (strip.hidden) return;
    const mini = (icon, v, max, title) => {
        const p = pct(v, max);
        return `<span class="sf-mini ${gaugeClass(p)}" title="${esc(title)} ${Math.round(v)}/${Math.round(max)}"><i class="fa-solid ${icon}"></i><span class="sf-mini-bar"><span style="width:${p}%"></span></span></span>`;
    };
    const statuses = needStatuses(st);
    strip.dataset.alert = st.alert;
    strip.innerHTML = `
        <span class="sf-strip-date">${esc(fmtDate(st.minutes))}</span>
        <span class="sf-strip-loc"><i class="fa-solid fa-location-crosshairs"></i> ${esc(locationLabel(st))}</span>
        <span class="sf-strip-gauges">
            ${mini('fa-shield-halved', st.ship.shields, st.ship.maxShields, 'Shields')}
            ${mini('fa-cube', st.ship.hull, st.ship.maxHull, 'Hull')}
            ${mini('fa-gas-pump', st.ship.fuel, st.ship.maxFuel, 'Fuel')}
            ${mini('fa-heart-pulse', st.captain.health, st.captain.maxHealth, 'Health')}
        </span>
        ${statuses.length ? `<span class="sf-strip-warn"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(statuses.join(', '))}</span>` : ''}
        <span class="sf-strip-cr">${fmtInt(st.captain.credits)} cr</span>`;
}

function applyBodyState() {
    const st = S();
    const cfg = settings();
    document.body.classList.toggle('sf-red-alert', !!(cfg.enabled && cfg.redAlert && st?.alert === 'red'));
    document.body.classList.toggle('sf-yellow-alert', !!(cfg.enabled && cfg.redAlert && st?.alert === 'yellow'));
}

export const redraw = debounce(() => {
    renderHud();
    renderFloating();
    renderStrip();
    applyBodyState();
}, 30);

export function openHud(tabId) {
    if (tabId) active = tabId;
    root.classList.add('open');
    document.body.classList.add('sf-hud-open');
    renderHud();
}

export function closeHud() {
    root.classList.remove('open');
    document.body.classList.remove('sf-hud-open');
}

export function toggleHud() {
    root.classList.contains('open') ? closeHud() : openHud();
}

export function applyLayout() {
    const cfg = settings();
    if (!root) return;
    root.dataset.dock = cfg.dock;
    root.hidden = !cfg.enabled;
    fab.hidden = !(cfg.enabled && cfg.fab);
    if (!cfg.enabled) closeHud();
    redraw();
}

function onClick(ev) {
    const el = ev.target.closest('[data-sf]');
    if (!el || el.disabled) return;
    const name = el.dataset.sf;
    const fn = actions[name];
    if (!fn) return;
    ev.preventDefault();
    blip('click');
    Promise.resolve(fn(el, ev)).catch(e => {
        console.error('[Ship-OS] action failed', name, e);
        toast('error', e.message || String(e));
    });
}

export function initHud() {
    root = document.createElement('div');
    root.id = 'sf-hud';
    root.className = 'sf-root';
    root.innerHTML = `
        <header class="sf-hud-head">
            <span class="sf-hud-logo"><i class="fa-solid fa-atom"></i> SHIP-OS</span>
            <span class="sf-hud-date"></span>
            <button type="button" class="sf-icon-btn" data-sf="hud-dock" title="Switch side"><i class="fa-solid fa-right-left"></i></button>
            <button type="button" class="sf-icon-btn" data-sf="hud-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <nav class="sf-tabs"></nav>
        <section class="sf-body"></section>`;
    document.body.appendChild(root);

    fab = document.createElement('button');
    fab.id = 'sf-fab';
    fab.type = 'button';
    fab.className = 'sf-root';
    fab.title = 'Ship-OS';
    fab.dataset.sf = 'hud-toggle';
    fab.innerHTML = '<i class="fa-solid fa-atom"></i>';
    document.body.appendChild(fab);

    floatLayer = document.createElement('div');
    floatLayer.id = 'sf-float';
    document.body.appendChild(floatLayer);
    initDrag();

    strip = document.createElement('div');
    strip.id = 'sf-strip';
    strip.className = 'sf-root';
    strip.dataset.sf = 'hud-toggle';
    strip.hidden = true;
    const sheld = document.getElementById('sheld');
    const chat = document.getElementById('chat');
    if (sheld && chat) sheld.insertBefore(strip, chat);
    else document.body.appendChild(strip);

    // Entry in the wand menu next to the chat input.
    const menu = document.getElementById('extensionsMenu');
    if (menu) {
        const item = document.createElement('div');
        item.className = 'list-group-item flex-container flexGap5';
        item.dataset.sf = 'hud-toggle';
        item.innerHTML = '<div class="fa-solid fa-atom extensionsMenuExtensionButton"></div><span>Ship-OS console</span>';
        menu.appendChild(item);
    }

    registerActions({
        'hud-toggle': () => toggleHud(),
        'hud-close': () => closeHud(),
        'hud-dock': () => {
            const cfg = settings();
            cfg.dock = cfg.dock === 'right' ? 'left' : 'right';
            saveSettings();
            applyLayout();
        },
        'tab': (el) => { active = el.dataset.tab; renderHud(); },
        'widget-pop': (el) => {
            const r = el.closest('.sf-panel').getBoundingClientRect();
            const n = Object.keys(floating()).length;
            const left = root.dataset.dock === 'right' ? Math.max(10, r.left - 360 - n * 24) : Math.min(window.innerWidth - 360, r.right + 20 + n * 24);
            floating()[el.dataset.id] = { x: Math.round(left), y: Math.round(Math.max(50, Math.min(r.top, window.innerHeight - 300))), w: 340 };
            saveSettings();
            redraw();
        },
        'widget-dock': (el) => {
            delete floating()[el.dataset.id];
            saveSettings();
            redraw();
        },
        'wizard-start': () => {
            const val = (id) => document.getElementById(id)?.value?.trim();
            const seedText = val('sf-w-seed');
            newCampaign({
                captain: val('sf-w-captain'),
                shipName: val('sf-w-ship'),
                shipClass: val('sf-w-class'),
                difficulty: val('sf-w-diff'),
                seed: seedText && Number.isFinite(Number(seedText)) ? Number(seedText) >>> 0 : undefined,
            });
            blip('boot');
            toast('success', 'All systems online. Welcome aboard, Captain.');
        },
    });

    document.addEventListener('click', onClick);
    // Inline edits: any input with data-sf-change runs its action when the value changes.
    document.addEventListener('change', (ev) => {
        const el = ev.target.closest?.('[data-sf-change]');
        if (!el) return;
        const fn = actions[el.dataset.sfChange];
        if (fn) Promise.resolve(fn(el, ev)).catch(e => toast('error', e.message || String(e)));
    });
    onChange(() => redraw());
    applyLayout();
}
