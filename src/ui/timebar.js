// The hourglass in SillyTavern's chat bar. The chat stays the centre of play: the player writes
// what their character does, picks how long they mean it to take, and sends. The game decides
// how much of that really passes (see systems/clock.js) before the storyteller answers.
import { S, onChange } from '../core/state.js';
import { settings, toast, on } from '../core/st.js';
import { esc } from '../core/util.js';
import { fmtDuration } from '../systems/sim.js';
import { parseAsk, refusal, suggestions, setPendingAsk, pendingAsk, MAX_ASK } from '../systems/clock.js';

const PLAIN = [5, 15, 30, 60, 120, 240, 480];
let btn, pop, chip;

const textarea = () => document.getElementById('send_textarea');

function closePop() { pop?.remove(); pop = null; }

function setChip() {
    const a = pendingAsk();
    if (!chip) return;
    chip.hidden = !a;
    chip.textContent = a ? `⌛ ${fmtDuration(a)}` : '';
    btn?.classList.toggle('sf-time-armed', !!a);
}

function choose(mins) {
    closePop();
    if (!Number.isFinite(mins) || mins <= 0) { toast('warning', 'Say how long: 30m, 2h, 1h30, or until 07:00'); return; }
    if (mins > MAX_ASK) { toast('warning', 'A day at most at a time'); return; }
    setPendingAsk(mins);
    setChip();
    const ta = textarea();
    if (!ta?.value.trim()) {
        toast('info', `Now write what your character does during those ${fmtDuration(mins)}, and send.`);
        ta?.focus();
    }
}

function openPop() {
    if (pop) { closePop(); return; }
    const st = S();
    const no = refusal(st);
    pop = document.createElement('div');
    pop.id = 'sf-time-pop';
    pop.className = 'sf-time-pop';
    const sugg = no ? [] : suggestions(st);
    pop.innerHTML = no
        ? `<div class="sf-time-head">Let time pass</div><div class="sf-warn-line">${esc(no.charAt(0).toUpperCase() + no.slice(1))}.</div>`
        : `<div class="sf-time-head">Let time pass</div>
        <small class="sf-dim">Write what your character does in that time and send it. The game decides how much really passes: it stops early if something happens.</small>
        ${sugg.length ? `<div class="sf-time-row">${sugg.map(x => `<button type="button" class="sf-btn primary" data-m="${x.mins}">${esc(x.label)}</button>`).join('')}</div>` : ''}
        <div class="sf-time-row">${PLAIN.map(m => `<button type="button" class="sf-btn" data-m="${m}">${esc(fmtDuration(m))}</button>`).join('')}</div>
        <div class="sf-time-row"><input type="text" class="text_pole sf-time-in" placeholder="1h30, 45m, until 07:00"><button type="button" class="sf-btn" data-custom="1">Set</button></div>
        ${pendingAsk() ? '<div class="sf-time-row"><button type="button" class="sf-btn" data-m="0">Clear</button></div>' : ''}`;
    pop.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.custom) { choose(parseAsk(pop.querySelector('.sf-time-in').value, S())); return; }
        const m = Number(b.dataset.m);
        if (m === 0) { setPendingAsk(null); setChip(); closePop(); return; }
        choose(m);
    });
    pop.querySelector('.sf-time-in')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); choose(parseAsk(e.target.value, S())); } });
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 16);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
    pop.style.bottom = `${Math.max(8, window.innerHeight - r.top + 6)}px`;
}

function sync() {
    if (!btn) return;
    const st = S();
    const on = settings().enabled && !!st && !st.dead;
    btn.classList.toggle('displayNone', !on);
    if (!on) { setPendingAsk(null); closePop(); }
    setChip();
}

export function initTimeBar() {
    const form = document.getElementById('rightSendForm');
    const send = document.getElementById('send_but');
    if (!form) return;
    btn = document.createElement('div');
    btn.id = 'sf-time-but';
    btn.className = 'fa-solid fa-hourglass-half interactable';
    btn.title = 'Let time pass: pick how long, write what your character does, send';
    btn.tabIndex = 0;
    btn.addEventListener('click', (e) => { e.stopPropagation(); openPop(); });
    form.insertBefore(btn, send ?? null);
    chip = document.createElement('span');
    chip.id = 'sf-time-chip';
    chip.hidden = true;
    chip.title = 'Time asked for with the next message. Click to clear.';
    chip.addEventListener('click', () => { setPendingAsk(null); setChip(); });
    form.insertBefore(chip, btn);
    document.addEventListener('click', (e) => { if (pop && !pop.contains(e.target) && e.target !== btn) closePop(); });
    onChange(sync);
    on('CHAT_CHANGED', () => { setPendingAsk(null); closePop(); sync(); });
    sync();
}

/** Called after a message is sent, when the request has been used. */
export function timeBarSent() { setChip(); }
