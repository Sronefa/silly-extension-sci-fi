// Background agents that run on side calls after an AI reply:
//  - the tracker pass reads the reply and turns what happened into state commands;
//  - the lorebook agent keeps a campaign lorebook of people, places and plot threads.
import { ctx, settings, toast } from '../core/st.js';
import { S, commit, addLog, fmtDate, locationLabel } from '../core/state.js';
import { sideCall, parseJson } from '../core/llm.js';
import { buildTelemetry, COMMAND_GUIDE, onReply, autoTime, decorateMessage, refreshPrompt } from '../core/ailink.js';
import { runBlock } from './sim.js';

const TAG_RE = /<sf>([\s\S]*?)<\/sf>|\[sf\]([\s\S]*?)\[\/sf\]/gi;
const clip = (text, n) => { const s = String(text ?? '').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };
const chatKey = () => { const c = ctx(); return String(c.getCurrentChatId?.() ?? c.chatId ?? ''); };

// ---------------------------------------------------------------------------------------
// Tracker pass
// ---------------------------------------------------------------------------------------

const TRACKER_SYSTEM = 'You are the bookkeeping module of a science fiction role-playing game. You read the latest passage of the story and report, as terse game commands, what changed in the game state. You never write prose, never explain, and never invent events that the passage does not show.';

function trackerPrompt(st, msg, userText, already) {
    return [
        'GAME STATE BEFORE THIS PASSAGE (authoritative):',
        buildTelemetry({ instructions: false }),
        '',
        userText ? `PLAYER ACTION:\n${clip(userText, 1500)}\n` : '',
        `LATEST STORY PASSAGE:\n${clip(msg.mes, 5000)}`,
        '',
        already.length ? `ALREADY RECORDED for this passage (do not repeat these): ${already.join('; ')}` : '',
        '',
        COMMAND_GUIDE(),
        '',
        'Rules:',
        '- Output one command per line and nothing else. If nothing changed, output exactly NONE.',
        '- Only record what the passage clearly shows happening: money spent or earned, items gained, used or lost, injuries, damage, meals, sleep, travel, new missions, changes of place, reputation, people joining or leaving.',
        '- Do not record intentions, offers, plans or things that only might happen.',
        `- Always include one time command for how long the passage covers, usually a few minutes${st.combat ? '' : ''}. Never more than the passage really shows.`,
        '- Eating, drinking, resting and washing raise nourishment, hydration, rest and hygiene (for example "nourishment +40").',
        '- Use the combat command only if a fight is starting right now and has not been resolved in the passage.',
        '- Award xp only when the player character meaningfully used a skill.',
    ].filter(x => x !== '').join('\n');
}

function cleanCommands(text) {
    let body = String(text ?? '');
    const tagged = [...body.matchAll(TAG_RE)].map(m => m[1] ?? m[2] ?? '');
    if (tagged.length) body = tagged.join('\n');
    return body.replace(/```[a-z]*|```/gi, '').split(/[\n;]+/)
        .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
        .filter(l => l && !/^none\.?$/i.test(l) && /^[a-z]/i.test(l) && l.length < 200);
}

async function trackerPass({ mesId, msg, timed }) {
    const cfg = settings();
    const st = S();
    if (!cfg.enabled || !cfg.tracker || !st || st.dead) return;
    if (st.combat) return; // the fight engine owns the state until it ends
    const c = ctx();
    const chat = chatKey();
    const swipe = msg.swipe_id;
    const text = msg.mes;
    let userText = '';
    for (let i = mesId - 1; i >= 0 && i >= mesId - 3; i--) {
        if (c.chat[i]?.is_user) { userText = c.chat[i].mes; break; }
    }
    const already = [...(msg.extra?.scifi_os?.applied ?? [])];
    let lines = null;
    try {
        lines = cleanCommands(await sideCall({ system: TRACKER_SYSTEM, prompt: trackerPrompt(st, msg, userText, already), maxTokens: 300 }));
    } catch (e) {
        console.warn('[Ship-OS] tracker pass failed', e);
    }
    // The reply may have been swiped, deleted or the chat changed while the model was thinking.
    const stale = chatKey() !== chat || ctx().chat?.[mesId] !== msg || msg.swipe_id !== swipe || msg.mes !== text || S() !== st;
    if (stale) return;
    if (!lines) { if (!timed) autoTime(); return; }
    if (timed) lines = lines.filter(l => !/^time\b/i.test(l));
    if (st.combat || already.some(a => /^combat started/i.test(a))) lines = lines.filter(l => !/^(combat|fight|battle|encounter)\b/i.test(l));
    const applied = [];
    const failed = [];
    for (const r of runBlock(lines.join('\n'), { ai: true })) {
        if (!r.text) continue;
        (r.ok ? applied : failed).push(r.text);
    }
    if (!timed && !lines.some(l => /^time\b/i.test(l))) autoTime();
    if (failed.length) console.warn('[Ship-OS] tracker commands ignored:', failed);
    if (applied.length) {
        msg.extra ??= {};
        msg.extra.scifi_os ??= { applied: [], failed: [] };
        msg.extra.scifi_os.applied.push(...applied);
        msg.extra.scifi_os.tracker = true;
        decorateMessage(mesId);
        ctx().saveChat?.();
    }
    commit('tracker');
    refreshPrompt();
}

// ---------------------------------------------------------------------------------------
// Lorebook agent
// ---------------------------------------------------------------------------------------

const LORE_SYSTEM = 'You are the archivist of a long-running science fiction role-playing campaign. You maintain a lorebook: short reference entries that are shown to the storyteller whenever their keywords come up, so that facts survive after the conversation itself has been summarised or forgotten. You reply with JSON only.';
const MAX_OPS = 8;
let loreRunning = false;

/** A complete SillyTavern lorebook entry with the agent's marker on it. */
function makeEntry(uid, { title, keys, content }) {
    return {
        uid, key: keys, keysecondary: [], comment: title, content,
        constant: false, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true,
        order: 100, position: 0, disable: false, ignoreBudget: false, excludeRecursion: false, preventRecursion: false,
        matchPersonaDescription: false, matchCharacterDescription: false, matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false, matchScenario: false, matchCreatorNotes: false,
        delayUntilRecursion: 0, probability: 100, useProbability: true, depth: 4, outletName: '', group: '', groupOverride: false,
        groupWeight: 100, scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null,
        automationId: '', role: 0, sticky: null, cooldown: null, delay: null,
        characterFilterNames: [], characterFilterTags: [], characterFilterExclude: false, triggers: [],
        displayIndex: uid, sfAgent: true,
    };
}

const cleanKeys = (keys) => [...new Set((Array.isArray(keys) ? keys : String(keys ?? '').split(','))
    .map(k => String(k).trim()).filter(k => k.length >= 2 && k.length <= 60))].slice(0, 8);

/** Finds or creates the lorebook this chat's campaign writes to, and binds it to the chat. */
async function ensureBook(st) {
    const c = ctx();
    if (typeof c.loadWorldInfo !== 'function' || typeof c.saveWorldInfo !== 'function') throw new Error('This SillyTavern version does not expose lorebooks to extensions');
    const names = c.getWorldInfoNames?.() ?? [];
    st.lore ??= { book: '', lastMes: -1, runs: 0 };
    // Prefer the lorebook already bound to the chat; the agent only ever edits its own entries there.
    const bound = c.chatMetadata?.world_info;
    if (bound && names.includes(bound)) st.lore.book = bound;
    if (!st.lore.book || !names.includes(st.lore.book)) {
        const base = `Ship-OS ${st.captain.name}`.replace(/[^\w \-]+/g, '').trim().slice(0, 40) || 'Ship-OS Campaign';
        let name = base;
        for (let i = 2; names.includes(name); i++) name = `${base} ${i}`;
        await c.saveWorldInfo(name, { entries: {} }, true);
        await c.updateWorldInfoList?.();
        st.lore.book = name;
    }
    if (c.chatMetadata && c.chatMetadata.world_info !== st.lore.book) {
        c.chatMetadata.world_info = st.lore.book;
        (c.saveMetadataDebounced ?? c.saveMetadata)?.();
        document.querySelector('.chat_lorebook_button')?.classList.add('world_set');
    }
    return st.lore.book;
}

/** The agent's own entries in the campaign lorebook, for display. */
export async function loreEntries() {
    const st = S();
    const c = ctx();
    if (!st?.lore?.book || !(c.getWorldInfoNames?.() ?? []).includes(st.lore.book)) return [];
    const data = await c.loadWorldInfo(st.lore.book);
    return Object.values(data?.entries ?? {}).filter(e => e.sfAgent)
        .map(e => ({ uid: e.uid, title: e.comment, keys: e.key ?? [], content: e.content, disabled: !!e.disable }));
}

function lorePrompt(st, entries, passages) {
    const list = entries.length
        ? entries.map(e => `#${e.uid} ${e.disable ? '[OFF] ' : ''}"${e.comment}" keys: ${(e.key ?? []).join(', ')}\n${clip(e.content, 700)}`).join('\n\n')
        : '(the lorebook is empty)';
    return [
        `CAMPAIGN: the player character is ${st.captain.name}. Date ${fmtDate(st.minutes)}. Location: ${locationLabel(st)}.`,
        '',
        'CURRENT LOREBOOK ENTRIES:',
        list,
        '',
        'NEW STORY SINCE THE LAST UPDATE:',
        passages,
        '',
        'Update the lorebook so that it holds everything a storyteller must remember later. Reply with JSON of this exact shape:',
        '{"ops":[{"op":"create","title":"...","keys":["...","..."],"content":"..."},{"op":"update","id":12,"content":"...","keys":["..."]},{"op":"merge","ids":[3,7],"title":"...","keys":["..."],"content":"..."},{"op":"disable","id":4},{"op":"enable","id":4}]}',
        '',
        'Rules:',
        '- Record durable facts only: named people (who they are, looks, manner, what they want, how they regard the player, promises and debts), places and ships, organisations, important objects, secrets learned, and open plot threads.',
        '- Do NOT record numbers the game already tracks (health, wounds, credits, cargo, fuel, needs, skills, the date) or moment-to-moment action.',
        '- One subject per entry, 30 to 120 words, written as plain third-person fact in the present tense. Say what is true now, and note important history briefly.',
        '- keys are 2 to 5 words or names that will appear in the story when the entry matters (names, nicknames, place names). No generic words.',
        '- If a subject already has an entry, update it (rewrite the whole content with old and new facts combined) instead of creating a duplicate. Merge entries that cover the same subject.',
        '- Disable an entry only when its subject is gone for good and no longer matters; enable it again if the subject returns. For a death or a resolved thread, prefer an update that says so.',
        `- At most ${MAX_OPS} operations. If nothing worth recording happened, reply {"ops":[]}.`,
        entries.length > 45 ? '- The lorebook is getting large: favour merging and tightening entries over creating new ones.' : '',
    ].filter(x => x !== '').join('\n');
}

function applyLoreOps(data, ops) {
    const entries = data.entries;
    const own = (id) => { const e = entries[String(id)] ?? Object.values(entries).find(x => x.uid === Number(id)); return e?.sfAgent ? e : null; };
    const nextUid = () => Object.values(entries).reduce((m, e) => Math.max(m, Number(e.uid) || 0), -1) + 1;
    const byTitle = (title) => Object.values(entries).find(e => e.sfAgent && String(e.comment).toLowerCase() === String(title ?? '').toLowerCase());
    const count = { created: 0, updated: 0, merged: 0, toggled: 0 };
    const titles = [];
    for (const op of ops.slice(0, MAX_OPS)) {
        const kind = String(op?.op ?? '').toLowerCase();
        const content = clip(op?.content, 1600);
        if (kind === 'create') {
            const title = clip(op.title, 80);
            const keys = cleanKeys(op.keys);
            if (!title || !content || !keys.length) continue;
            const dup = byTitle(title);
            if (dup) { dup.content = content; dup.key = cleanKeys([...keys, ...(dup.key ?? [])]); dup.disable = false; count.updated++; titles.push(title); continue; }
            const uid = nextUid();
            entries[uid] = makeEntry(uid, { title, keys, content });
            count.created++; titles.push(title);
        } else if (kind === 'update') {
            const e = own(op.id) ?? byTitle(op.title);
            if (!e || !content) continue;
            e.content = content;
            if (op.keys) { const keys = cleanKeys(op.keys); if (keys.length) e.key = keys; }
            if (op.title) e.comment = clip(op.title, 80);
            count.updated++; titles.push(e.comment);
        } else if (kind === 'merge') {
            const group = (Array.isArray(op.ids) ? op.ids : []).map(own).filter(Boolean);
            const keys = cleanKeys(op.keys?.length ? op.keys : group.flatMap(e => e.key ?? []));
            if (group.length < 2 || !content || !keys.length) continue;
            const keep = group[0];
            keep.content = content; keep.key = keys; keep.disable = false;
            if (op.title) keep.comment = clip(op.title, 80);
            for (const e of group.slice(1)) delete entries[String(e.uid)];
            count.merged++; titles.push(keep.comment);
        } else if (kind === 'disable' || kind === 'enable') {
            const e = own(op.id) ?? byTitle(op.title);
            if (!e) continue;
            e.disable = kind === 'disable';
            count.toggled++;
        }
    }
    return { count, titles };
}

/** Runs the lorebook agent over everything said since its last run. */
export async function runLoreAgent({ manual = false } = {}) {
    const st = S();
    if (!st || loreRunning) return null;
    const c = ctx();
    loreRunning = true;
    const chat = chatKey();
    try {
        const book = await ensureBook(st);
        const upto = c.chat.length - 1;
        const from = Math.max(0, Math.min((st.lore.lastMes ?? -1) + 1, upto), upto - 29);
        const passages = c.chat.slice(from, upto + 1)
            .filter(m => m && !m.is_system && typeof m.mes === 'string' && m.mes.trim())
            .map(m => `${m.is_user ? `[${st.captain.name}, player]` : `[${m.name ?? 'Narrator'}]`} ${clip(m.mes.replace(TAG_RE, ''), 2200)}`)
            .join('\n\n');
        if (!passages) { if (manual) toast('info', 'Nothing new to archive.'); return null; }
        const data = await c.loadWorldInfo(book) ?? { entries: {} };
        data.entries ??= {};
        const mine = Object.values(data.entries).filter(e => e.sfAgent);
        const reply = await sideCall({ system: LORE_SYSTEM, prompt: lorePrompt(st, mine, clip(passages, 24000)), maxTokens: 1400 });
        if (chatKey() !== chat || S() !== st) return null;
        const json = parseJson(reply);
        if (!json || !Array.isArray(json.ops)) throw new Error('the model did not return usable JSON');
        const { count, titles } = applyLoreOps(data, json.ops);
        const total = count.created + count.updated + count.merged + count.toggled;
        if (total) {
            await c.saveWorldInfo(book, data, true);
            try { c.reloadWorldInfoEditor?.(book, false); } catch { /* editor not open */ }
        }
        st.lore.lastMes = upto;
        st.lore.runs = (st.lore.runs ?? 0) + 1;
        st.lore.lastRun = st.minutes;
        const parts = [count.created && `${count.created} new`, count.updated && `${count.updated} updated`, count.merged && `${count.merged} merged`, count.toggled && `${count.toggled} switched`].filter(Boolean);
        if (total) addLog(`Archive updated: ${parts.join(', ')}${titles.length ? ` (${[...new Set(titles)].slice(0, 5).join(', ')})` : ''}.`, 'sys');
        commit('lore');
        if (manual) toast(total ? 'success' : 'info', total ? `Archive updated: ${parts.join(', ')}.` : 'Nothing new worth archiving.');
        return count;
    } catch (e) {
        console.warn('[Ship-OS] lorebook agent failed', e);
        if (manual) toast('error', `Archive update failed: ${e.message}`);
        return null;
    } finally {
        loreRunning = false;
    }
}

export const loreBusy = () => loreRunning;

/** Switches one of the agent's entries on or off, or deletes it. */
export async function editLoreEntry(uid, action) {
    const st = S();
    const c = ctx();
    if (!st?.lore?.book) return;
    const data = await c.loadWorldInfo(st.lore.book);
    const e = Object.values(data?.entries ?? {}).find(x => x.sfAgent && x.uid === Number(uid));
    if (!e) return;
    if (action === 'delete') delete data.entries[String(e.uid)];
    else e.disable = !e.disable;
    await c.saveWorldInfo(st.lore.book, data, true);
    try { c.reloadWorldInfoEditor?.(st.lore.book, false); } catch { /* editor not open */ }
}

function loreTick() {
    const cfg = settings();
    const st = S();
    if (!cfg.enabled || !cfg.loreAgent || !st || st.dead || st.combat || loreRunning) return;
    const c = ctx();
    const last = st.lore?.lastMes ?? -1;
    let replies = 0;
    for (let i = c.chat.length - 1; i > last && i >= 0; i--) if (!c.chat[i].is_user && !c.chat[i].is_system) replies++;
    if (replies >= Math.max(1, Number(cfg.loreEvery) || 6)) runLoreAgent();
}

export function initAgents() {
    onReply((info) => {
        // The tracker goes first so the lorebook agent queues behind it.
        trackerPass(info).catch(e => console.error('[Ship-OS] tracker pass crashed', e)).finally(loreTick);
    });
}
