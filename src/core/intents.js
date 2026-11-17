// Actions through the chat. A panel button that does something in the world no longer changes
// the state by itself: it writes a line into the chat box and queues the action behind it. The
// engine carries the action out when the message is sent, before the storyteller answers, so the
// reply already knows what happened. A chip under the sent message shows the outcome, with a ×
// that takes it back (and the reply after it, which narrated it).
import { settings, toast, on, toInput } from './st.js';
import { S, commit, dryRun } from './state.js';
import { esc } from './util.js';
import { blip } from '../ui/sfx.js';

const defs = new Map();
let queue = [];
let seq = 0;
let bar;

/**
 * Registers something the character can do from the panel.
 * - line(args, st): the sentence written into the chat box, first person ("I rent a bunk").
 * - run(args, st): carries it out on the live state; returns what happened, throws if it can't.
 */
export function registerIntent(name, def) {
    defs.set(name, def);
}

export const chatActionsOn = () => settings().chatActions !== false;

/** Carries out one queued action on the live state and returns the outcome text. */
export function runIntent(item) {
    const def = defs.get(item.name);
    if (!def) throw new Error('this action no longer exists');
    const r = def.run(item.args ?? {}, S());
    return typeof r === 'string' && r ? r : def.done ?? 'Done';
}

function lineText(text) {
    const t = String(text).trim();
    return settings().actionStars ? `*${t}*` : t;
}

/**
 * Called by a panel button. The action is tried first on a scratch copy of the game, after
 * everything already queued, so a refusal shows at once instead of after sending.
 */
export function intent(name, args = {}) {
    const st = S();
    const def = defs.get(name);
    if (!st || !def) return;
    if (!chatActionsOn()) {
        // The old way, kept as a setting: the button acts on the spot.
        try { toast('success', runIntent({ name, args })); blip('click'); } catch (e) { toast('warning', e.message); blip('error'); }
        commit('act');
        return;
    }
    // The sentence is written from the world as it is now, before the trial run touches it.
    const line = lineText(def.line(args, st));
    let label;
    try {
        label = dryRun(() => {
            for (const q of queue) { try { runIntent(q); } catch { /* shown when it is sent */ } }
            return runIntent({ name, args });
        });
    } catch (e) {
        blip('error');
        toast('warning', cap(e.message));
        return;
    }
    queue.push({ id: ++seq, name, args, line, label });
    toInput(line);
    blip('click');
    renderBar();
    afterQueue.forEach(fn => fn());
}

const afterQueue = [];
/** Lets the interface react when an action is written into the chat box (a phone closes the console). */
export function onQueued(fn) { afterQueue.push(fn); }

/** Hands over the queue when the message is sent, and empties it. */
export function takeQueue() {
    const list = queue.map(({ name, args, line, label }) => ({ name, args, line, label }));
    queue = [];
    renderBar();
    return list;
}

export function clearQueue() {
    queue = [];
    renderBar();
}

export const queued = () => queue.length;

/**
 * What the storyteller is told about the player's last message: what the engine already did
 * (narrate it as done, without commands that would do it twice) and what it refused.
 */
export function intentPrompt(st) {
    const acts = st?.lastActs;
    if (!acts?.length) return '';
    const done = acts.filter(a => a.ok).map(a => a.text);
    const no = acts.filter(a => !a.ok).map(a => `${a.line.replace(/^\*|\*$/g, '')} (refused: ${a.text})`);
    const L = [];
    if (done.length) L.push(`ALREADY DONE BY THE GAME with the player's last message, narrate it as done and do not repeat it with commands: ${done.join('; ')}.`);
    if (no.length) L.push(`TRIED BUT FAILED, narrate the attempt failing for that reason: ${no.join('; ')}.`);
    return L.join('\n');
}

const cap = (s) => String(s ?? '').charAt(0).toUpperCase() + String(s ?? '').slice(1);

/** Removes a sentence the panel wrote, if the player left it as it was. */
export function cutLine(text, line) {
    if (!line) return text;
    const lines = text.split('\n');
    const i = lines.findIndex(l => l.trim() === line.trim());
    if (i >= 0) {
        lines.splice(i, 1);
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    if (!text.includes(line)) return text;
    return text.replace(line, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function unqueue(id) {
    const item = queue.find(q => q.id === id);
    if (!item) return;
    queue = queue.filter(q => q !== item);
    const ta = document.getElementById('send_textarea');
    if (ta) {
        ta.value = cutLine(ta.value, item.line);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    renderBar();
}

/** The queued actions, shown as chips just above the chat box until the message is sent. */
function renderBar() {
    if (!bar) return;
    bar.hidden = !queue.length;
    bar.innerHTML = queue.length
        ? `<span class="sf-acts-head">With this message</span>${queue.map(q => `<span class="sf-chip sf-chip-act" title="${esc(q.line)}">${esc(q.label)}<button type="button" class="sf-chip-x" data-unqueue="${q.id}" title="Take this action back">×</button></span>`).join('')}`
        : '';
}

export function initIntents() {
    const form = document.getElementById('send_form');
    if (form?.parentElement) {
        bar = document.createElement('div');
        bar.id = 'sf-acts';
        bar.className = 'sf-root sf-chip-row';
        bar.hidden = true;
        form.parentElement.insertBefore(bar, form);
        bar.addEventListener('click', (e) => {
            const b = e.target.closest('[data-unqueue]');
            if (b) unqueue(Number(b.dataset.unqueue));
        });
    }
    on('CHAT_CHANGED', () => clearQueue());
}
