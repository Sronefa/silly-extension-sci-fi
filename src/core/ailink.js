// The link between the campaign state and the AI: telemetry injected into the prompt,
// and hidden <sf>…</sf> update tags parsed out of AI replies.
import { ctx, settings, MODULE, on } from './st.js';
import { S, commit, snapshot, rollbackTo, fmtDate, locationLabel, cargoUsed, cargoCap, shipClass, currentSystem, galaxy, addLog } from './state.js';
import { runBlock, needStatuses, transitInfo, fmtDuration, advanceTime } from '../systems/sim.js';
import { fmtInt } from './util.js';
import { NEEDS, SHIP_SYSTEMS, FACTIONS, SHIP_WEAPONS, PERSONAL_WEAPONS, ARMORS } from '../data/catalog.js';
import { ATTRIBUTES, SKILL_DEFS, TRAITS, FLAWS, CYBERWARE, CRAFT_CLASSES } from '../data/chargen.js';
import { ENEMIES } from '../data/combat.js';
import { VESSELS } from '../data/vessels.js';
import { attrOf, skillOf, originOf, hasFx } from '../systems/character.js';
import { describeBody, isDown } from '../systems/body.js';
import { factionById, SECURITY_LABELS, systemDistance } from '../systems/galaxy.js';

const TAG_RE = /<sf>([\s\S]*?)<\/sf>|\[sf\]([\s\S]*?)\[\/sf\]/gi;
const extraSections = [];

/** Lets feature modules add their own lines to the telemetry block. */
export function registerPromptSection(fn) {
    extraSections.push(fn);
}

/** The command reference shared by the main model's instructions and the tracker pass. */
export function COMMAND_GUIDE() {
    return 'Commands: credits/debt/hull/shields/fuel/supplies/health/stress ±N; health "party member" ±N; time +Nh|+Nm|+Nd; xp <skill> N (award 5-20 when a skill was meaningfully used); '
        + 'nourishment/hydration/rest/hygiene/morale ±N; system <reactor|engines|shields|weapons|sensors|lifesupport> ±N; '
        + 'location "place"; dock "station"; undock; jump "star system"; cargo add|remove "name" N; item add|remove "name" N; '
        + 'injury add "name" minor|moderate|severe|critical; injury heal "name"; rep "faction" ±N; '
        + 'mission add "title" reward N; mission done|fail "title"; crew add|remove "name" "role"; contact "name" ±N; '
        + 'tracker "name" ±N; alert green|yellow|red; log "entry"; wound <head|thorax|abdomen|"left arm"|"right arm"|"left leg"|"right leg"> N [bleed|arterial|fracture|burn|concussion] for specific injuries outside of fights; die "cause" (only if the character is truly killed); '
        + 'combat "place" <enemy> <count> [<enemy> <count>...] [ambush|surprise] when a fight begins. Enemy types: ' + Object.keys(ENEMIES).join(', ') + ', or any quoted name; '
        + 'shipcombat "place" <hull> <count> [<hull> <count>...] [allies <hull> <count>...] [ambush] when a space battle begins (do not narrate it either). Hulls: ' + Object.values(VESSELS).filter(v => !v.decoy && !v.civil).map(v => v.id).join(', ') + ' (add _c to a warship or fighter id for its lighter civilian-pattern version, as used by corporations); '
        + 'post <captain|commander|xo|pilot|helm|gunnery|engineering|sensors|crew|passenger> "ship name" <hull> when the character takes up a position aboard a vessel they do not own; post none when they leave it. spare <module name> when the ship the character owns gains a ship module or weapon as salvage, reward or purchase (it goes into ship stores to be fitted). Capital ships (carriers, battleships, battlecruisers) are built by states and never privately owned: a character commands one only by rank, through post.';
}

export function buildTelemetry({ instructions = true } = {}) {
    const st = S();
    if (!st) return '';
    if (st.dead) return `[SHIP-OS: ${st.captain.name} is dead${st.deathCause ? ` (${st.deathCause})` : ''}. Narrate the death and its aftermath. The character takes no further actions.]`;
    const cfg = settings();
    const sys = currentSystem();
    const fac = factionById(sys.faction);
    const cap = st.captain;
    const ship = st.ship;
    const L = [];
    L.push('[SHIP-OS TELEMETRY. This is the authoritative state of the story world. Keep the narration consistent with it and never contradict these numbers.]');
    L.push(`Date: ${fmtDate(st.minutes)} | Alert: ${st.alert.toUpperCase()}`);
    const tr = transitInfo(st);
    if (tr) L.push(`IN JUMP TRANSIT from ${tr.fromSys.name} to ${tr.toSys.name}: ${fmtDuration(tr.left)} of ship time remain. The journey is lived, never skipped: play out life aboard (conversation, meals, games, maintenance, sleep) and only advance the clock by what each scene actually covers.`);
    L.push(`Location: ${locationLabel(st)} (${fac.name} space, ${SECURITY_LABELS[sys.security].toLowerCase()} security, ${sys.star.label.toLowerCase()}${sys.hazard ? `, hazard: ${sys.hazard}` : ''})`);

    const needs = NEEDS.map(n => `${n.name} ${Math.round(cap.needs[n.id])}%`).join(', ');
    const statuses = needStatuses(st);
    const inj = cap.injuries.length ? ` Injuries: ${cap.injuries.map(i => `${i.name} [${i.severity}]`).join('; ')}.` : '';
    const origin = originOf(cap.origin);
    const named = (list, ids) => ids.map(id => list.find(x => x.id === id)?.name).filter(Boolean);
    const top = SKILL_DEFS.map(d => ({ d, v: skillOf(cap, d.id) })).filter(x => x.v > 0).sort((x, y) => y.v - x.v).slice(0, 8).map(x => `${x.d.name} ${x.v}`);
    L.push(`PLAYER CHARACTER ${cap.name}: ${origin ? `${origin.name}, ` : ''}${cap.role}.${cap.look ? ` Appearance: ${cap.look}.` : ''} Attributes (2-8 human range): ${ATTRIBUTES.map(a => `${a.name} ${attrOf(cap, a.id)}`).join(', ')}. Skills (0-10): ${top.join(', ') || 'none'}.`);
    const traits = [...named(TRAITS, cap.traits), ...named(FLAWS, cap.flaws)];
    const cyber = named(CYBERWARE, cap.cyber);
    if (traits.length || cyber.length) L.push(`${traits.length ? `Traits and flaws: ${traits.join(', ')}. ` : ''}${cyber.length ? `Cyberware: ${cyber.join(', ')}.` : ''}`);
    const body = describeBody(cap);
    L.push(`Condition: Health ${Math.round(cap.health)}/${cap.maxHealth}${isDown(cap) ? ' (DOWNED, unconscious and dying without aid)' : ''}${body ? `. Wounds: ${body}` : ''}. Stress ${Math.round(cap.stress)}%.${inj} ${needs}.${hasFx(cap, 'craving') ? ` Craving ${Math.round(cap.craving)}%.` : ''}${statuses.length ? ` Status: ${statuses.join(', ')}.` : ''}`);
    L.push(`Armed with ${PERSONAL_WEAPONS[cap.weapon]?.name ?? cap.weapon}, wearing ${ARMORS[cap.armor]?.name ?? cap.armor}. Credits: ${fmtInt(cap.credits)} cr${cap.debt ? `, debt ${fmtInt(cap.debt)} cr` : ''}.`);
    if (cap.inventory.length) L.push(`Carried: ${cap.inventory.map(i => `${i.name} x${i.qty}`).join(', ')}`);

    if (ship) {
        const damaged = SHIP_SYSTEMS.filter(s => ship.systems[s.id] < 100).map(s => `${s.name} ${Math.round(ship.systems[s.id])}%`);
        const weapons = ship.weapons.map(w => SHIP_WEAPONS[w.id]?.name ?? w.id).join(', ') || 'unarmed';
        L.push(`Owns ship "${ship.name}" (${shipClass(st).name}): Hull ${Math.round(ship.hull)}/${ship.maxHull}, Shields ${Math.round(ship.shields)}/${ship.maxShields}, Fuel ${Math.round(ship.fuel * 10) / 10}/${ship.maxFuel}, Supplies ${Math.round(ship.supplies)} crew-days, Spare parts ${ship.parts}. Weapons: ${weapons}.${damaged.length ? ` Damaged: ${damaged.join(', ')}.` : ' All systems nominal.'}`);
    } else {
        L.push(`${cap.name} does not own a starship and must book passage, sign on as crew, or acquire one.`);
    }
    for (const c of st.craft) {
        const cls = CRAFT_CLASSES[c.classId];
        L.push(`Assigned ${c.kind} "${c.name}" (${cls?.role ?? c.kind}): Hull ${Math.round(c.hull)}/${c.maxHull}, Shields ${Math.round(c.shields)}/${c.maxShields}, Armor ${c.armor}. Weapons: ${cls?.weapons.join(', ') ?? 'none'}.${c.kind === 'mech' ? ` Combat frames are rare and ruinously expensive (about ${fmtInt(cls?.price ?? 2000000)} cr), take years to master, and can only be repaired in a dedicated mech bay, not an ordinary hangar. Their pilots are few, highly paid and often famous${skillOf(cap, 'mech') >= 7 ? `; ${cap.name} is a recognised ace` : skillOf(cap, 'mech') < (cls?.minSkill ?? 5) ? `; ${cap.name} is still too green to handle one properly` : ''}.` : ''}`);
    }
    L.push(`${ship ? 'Cargo' : 'Hauled goods'} (${cargoUsed(st)}/${cargoCap(st)} t): ${st.cargo.length ? st.cargo.map(c => `${c.name} x${c.qty}`).join(', ') : 'empty'}`);
    if (st.crew.length) {
        L.push(`Party: ${st.crew.map(c => {
            const best = SKILL_DEFS.map(d => ({ d, v: skillOf(c, d.id) })).filter(x => x.v > 0).sort((x, y) => y.v - x.v).slice(0, 3).map(x => `${x.d.name} ${x.v}`);
            return `${c.name} (${c.role}; health ${Math.round(c.health)}/${c.maxHealth}${isDown(c) ? ' DOWNED' : ''}${describeBody(c) ? `, wounds: ${describeBody(c)}` : ''}${best.length ? `; ${best.join(', ')}` : ''}${c.injuries.length ? `; injured: ${c.injuries.map(i => i.name).join(', ')}` : ''})`;
        }).join('; ')}`);
    }
    if (st.lastCheck) L.push(`LATEST SKILL CHECK (narrate this outcome, do not change it): ${st.lastCheck.text}`);

    const active = st.missions.filter(m => m.status === 'active');
    if (active.length) L.push(`Active missions: ${active.map(m => `${m.title}${m.reward ? ` [${fmtInt(m.reward)} cr]` : ''}`).join('; ')}`);
    const reps = FACTIONS.filter(f => st.reputation[f.id]).map(f => `${f.name} ${st.reputation[f.id] > 0 ? '+' : ''}${st.reputation[f.id]}`);
    if (reps.length) L.push(`Reputation: ${reps.join(', ')}`);
    if (st.trackers.length) L.push(`Trackers: ${st.trackers.map(t => `${t.name} ${t.value}/${t.max}`).join(', ')}`);

    if (cfg.injectNearby) {
        const g = galaxy();
        const stations = sys.stations.map(s => s.name).join(', ');
        const near = g.adj[sys.id].map(e => {
            const n = g.systems[e.to];
            return `${n.name} (${systemDistance(g, sys.id, n.id)} ly, ${factionById(n.faction).name})`;
        });
        L.push(`Stations here: ${stations}. Jump lanes to: ${near.join(', ')}.`);
    }

    for (const fn of extraSections) {
        try {
            const out = fn(st);
            if (out) L.push(out);
        } catch (e) { console.error('[Ship-OS] prompt section failed', e); }
    }
    if (st.pendingEvent) L.push(`EVENT TO NARRATE NOW: ${st.pendingEvent}`);

    if (instructions && cfg.aiCommands) {
        L.push('[SHIP-OS UPDATES. When events in your reply change the state above, end the reply with one hidden block listing only what actually changed, one command per line, in this format: <sf>credits -200\ntime +3h\nhull -15</sf>. '
            + COMMAND_GUIDE() + ' '
            + 'FIGHTS: when violence breaks out, do NOT narrate the fight. Stop at the instant it begins and add the combat command. The game resolves the fight and gives you the result to narrate afterwards. '
            + 'TIME: always include a time command for how long the scene took, usually minutes. Never skip ahead hours or days on your own. Never mention the block in the narration.]');
    } else if (instructions && cfg.tracker) {
        L.push('[SHIP-OS RULES. The game tracks the numbers above by itself, so never print stat blocks. '
            + 'FIGHTS: when violence breaks out, do NOT narrate the fight. Stop at the instant it begins; the game resolves the fight and gives you the result to narrate afterwards. '
            + 'TIME: never skip ahead hours or days on your own.]');
    }
    return L.join('\n');
}

export function refreshPrompt() {
    const c = ctx();
    const cfg = settings();
    const text = cfg.enabled && cfg.inject && S() ? buildTelemetry() : '';
    // position 1 = in-chat at depth, role 0 = system
    c.setExtensionPrompt(MODULE, text, 1, Number(cfg.injectDepth) || 0, false, 0);
}

function processMessage(mesId) {
    const cfg = settings();
    if (!cfg.enabled || !S()) return;
    const c = ctx();
    const msg = c.chat?.[mesId];
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== 'string') return;
    // Snapshot first, so a swipe or delete restores everything this reply consumed or changed.
    snapshot(mesId);
    // Any AI reply has narrated whatever event or check was queued, so they are consumed.
    const cur = S();
    if (cur.pendingEvent || cur.lastCheck) {
        cur.pendingEvent = null;
        cur.lastCheck = null;
        commit('consumed');
    }
    TAG_RE.lastIndex = 0;
    const hasTags = cfg.aiCommands && TAG_RE.test(msg.mes);
    // Every reply takes some story time. If the AI did not say how much, assume a short beat.
    // When the tracker pass is on, it reads the reply and decides, so the default waits for it.
    const timed = hasTags && /(^|[\n;>])\s*time\b/i.test(msg.mes);
    const deferTime = replyHooks.length > 0 && cfg.tracker;
    if (!timed && !deferTime) autoTime();
    if (!hasTags) { runReplyHooks(mesId, msg, timed); return; }

    const applied = [];
    const failed = [];
    TAG_RE.lastIndex = 0;
    msg.mes = msg.mes.replace(TAG_RE, (_, a, b) => {
        for (const r of runBlock(a ?? b ?? '', { ai: true })) {
            if (!r.text) continue;
            (r.ok ? applied : failed).push(r.text);
        }
        return '';
    }).trimEnd();

    msg.extra ??= {};
    msg.extra.scifi_os = { applied, failed };
    if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) msg.swipes[msg.swipe_id] = msg.mes;
    if (failed.length) console.warn('[Ship-OS] ignored AI commands:', failed);
    commit('ai');
    // With streaming the text is already on screen, so redraw it without the tags.
    try { c.updateMessageBlock?.(mesId, msg); } catch { /* not rendered yet */ }
    c.saveChat?.();
    runReplyHooks(mesId, msg, timed);
}

const replyHooks = [];
/** Background agents (tracker pass, lorebook agent) run after each AI reply has been processed. */
export function onReply(fn) { replyHooks.push(fn); }
function runReplyHooks(mesId, msg, timed) {
    for (const fn of replyHooks) {
        try { fn({ mesId, msg, timed }); } catch (e) { console.error('[Ship-OS] reply hook failed', e); }
    }
}

/** Adds the default "a reply takes a few minutes" beat. */
export function autoTime() {
    const cfg = settings();
    const cur = S();
    if (!cur || !(cfg.autoMinutes > 0) || cur.combat || cur.dead) return;
    advanceTime(Number(cfg.autoMinutes));
    commit('auto-time');
}

/** Adds a small "telemetry updated" chip under a message that changed the state. */
export function decorateMessage(mesId) {
    const info = ctx().chat?.[mesId]?.extra?.scifi_os;
    const el = document.querySelector(`#chat .mes[mesid="${mesId}"] .mes_block`);
    if (!el) return;
    el.querySelector('.sf-chip-row')?.remove();
    if (!info?.applied?.length) return;
    const row = document.createElement('div');
    row.className = 'sf-chip-row';
    for (const text of info.applied) {
        const chip = document.createElement('span');
        chip.className = 'sf-chip';
        chip.textContent = text;
        row.appendChild(chip);
    }
    el.appendChild(row);
}

function decorateAll() {
    document.querySelectorAll('#chat .mes[mesid]').forEach(el => decorateMessage(Number(el.getAttribute('mesid'))));
}

export function initAiLink() {
    on('MESSAGE_RECEIVED', (id) => { processMessage(Number(id)); refreshPrompt(); });
    on('CHARACTER_MESSAGE_RENDERED', (id) => decorateMessage(Number(id)));
    on('MESSAGE_SWIPED', (id) => { if (rollbackTo(Number(id))) addLog('Timeline reverted (message swiped).', 'sys'); refreshPrompt(); });
    on('MESSAGE_DELETED', (count) => { rollbackTo(Number(count)); refreshPrompt(); });
    on('CHAT_CHANGED', () => { refreshPrompt(); setTimeout(decorateAll, 300); });
    on('MORE_MESSAGES_LOADED', () => setTimeout(decorateAll, 100));
    on('GENERATION_STARTED', () => refreshPrompt());
    refreshPrompt();
}
