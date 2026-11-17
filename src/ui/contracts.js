// The contracts screen: the board in the port office, the jobs in hand, and what is left to do
// for each. Signing and handing over happen at the right place on the right station.
import { registerTab, registerWidget, registerActions, btn, confirmAsk } from './hud.js';
import { S, commit, galaxy } from '../core/state.js';
import { toast } from '../core/st.js';
import { esc, fmtInt } from '../core/util.js';
import { KINDS } from '../data/contracts.js';
import { DAY } from '../data/economy.js';
import { factionById } from '../systems/galaxy.js';
import { port } from '../systems/services.js';
import { areaOf } from '../systems/activity.js';
import {
    boardAt, blocker, accept, activeContracts, contracts, nextStep, deliver, abandon, returnFreight,
    contractsTick, contractsArrival, contractsPrompt, storyContract, placeName,
} from '../systems/contracts.js';
import { registerCommand, onTick, onArrival, fmtDuration } from '../systems/sim.js';
import { registerPromptSection } from '../core/ailink.js';
import { blip } from './sfx.js';
import { registerIntent, intent } from '../core/intents.js';

const cr = (n) => `${fmtInt(n)} cr`;
const RISK = ['Low risk', 'Some risk', 'Dangerous', 'Very dangerous'];


function due(st, c) {
    const left = c.deadline - st.minutes;
    return left > 0 ? `due in ${fmtDuration(left)}` : `<b class="sf-warn-line">overdue by ${esc(fmtDuration(-left))}</b>`;
}

function offerRow(st, o, here) {
    const k = KINDS[o.kind];
    const why = blocker(st, o) || (here ? '' : 'go to the port office to sign');
    return `<li class="sf-row sf-wrap">
        <span class="sf-grow"><i class="fa-solid ${k.icon}"></i> <b>${esc(o.title)}</b><br>
        <small class="sf-dim">${esc(o.client)} · ${esc(k.name)} · ${RISK[Math.min(3, o.risk)]} · ${esc(fmtDuration(o.hours * 60))} to do it${o.deposit ? ` · deposit ${cr(o.deposit)}` : ''}</small>
        ${why ? `<br><small class="sf-warn-line">${esc(why)}</small>` : ''}</span>
        <b class="sf-num">${cr(o.pay)}</b>
        ${btn('ct-accept', 'Sign', { icon: 'fa-file-signature', cls: 'primary', data: { id: o.id }, disabled: !!why })}</li>`;
}

function boardHtml(st) {
    const p = port(st);
    if (!p) return '<div class="sf-dim">Contract boards are kept in station port offices. Dock somewhere first.</div>';
    const here = areaOf(st) === 'office';
    const offers = [...(st.offers ?? []), ...boardAt(st, p.key)];
    const fac = factionById(p.sys.faction);
    return `<small class="sf-dim">${esc(p.station.name)}. The board changes every day. What you are offered depends on your standing with ${esc(fac?.name ?? 'the locals')} (${st.reputation[p.sys.faction] ?? 0}). ${here ? '' : 'You can read it from anywhere on the station, but you sign at the port office.'}</small>
        <ul class="sf-list">${offers.map(o => offerRow(st, o, here)).join('') || '<li class="sf-dim">Nothing posted today.</li>'}</ul>`;
}

function jobRow(st, c) {
    const k = KINDS[c.kind];
    const step = nextStep(st, c);
    return `<li class="sf-row sf-wrap">
        <span class="sf-grow"><i class="fa-solid ${k.icon}"></i> <b>${esc(c.title)}</b><br>
        <small class="sf-dim">${esc(c.client)} · ${cr(c.pay)}${c.deposit ? ` + ${cr(c.deposit)} deposit back` : ''} · ${due(st, c)}</small><br>
        <small>${step ? `Next: ${esc(step)}.` : '<b class="sf-ok-line">Ready to hand over here.</b>'}</small></span>
        ${btn('ct-deliver', 'Hand over', { icon: 'fa-handshake', cls: 'primary', data: { id: c.id }, disabled: !!step })}
        ${btn('ct-abandon', '', { icon: 'fa-xmark', data: { id: c.id }, title: 'Abandon this contract' })}</li>`;
}

function jobsHtml(st) {
    const list = activeContracts(st);
    const failedFreight = contracts(st).filter(c => c.status === 'failed' && c.kind === 'haul' && !c.returned && st.cargo.some(x => x.contract === c.id));
    const past = contracts(st).filter(c => c.status !== 'active').slice(-6).reverse();
    return `<ul class="sf-list">${list.map(c => jobRow(st, c)).join('') || '<li class="sf-dim">No contracts in hand.</li>'}</ul>
        ${failedFreight.map(c => `<div class="sf-warn-line">You still hold ${esc(c.client)}'s freight from a failed contract: that is theft in ${esc(factionById(c.faction)?.name ?? '')} space until it is returned. ${btn('ct-return', 'Return it', { icon: 'fa-rotate-left', data: { id: c.id } })}</div>`).join('')}
        ${past.length ? `<div class="sf-sub">Recent</div><ul class="sf-list">${past.map(c => `<li class="sf-row"><span class="sf-grow">${esc(c.title)}</span><small class="${c.status === 'done' ? 'sf-ok-line' : 'sf-warn-line'}">${c.status === 'done' ? 'paid' : esc(c.why ?? 'failed')}</small></li>`).join('')}</ul>` : ''}
        <small class="sf-dim">Late freight and courier jobs are still taken for ${3} days, at half pay. Failing or walking away from a job costs the deposit and standing with the client's people. Work can also be agreed in the story; the game sets the terms.</small>`;
}

export function initContractsUi() {
    onTick((st) => contractsTick(st));
    onArrival((st) => contractsArrival(st));
    registerPromptSection((st) => {
        if (st.custody) return '';
        return {
            state: contractsPrompt(st),
            rules: '<contracts>\nPaid work is run by the game: it sets the pay, deposit and deadline, decides when a job is done, and pays it. Never pay for a job or declare one finished yourself. When the character agrees to a job in the story, add: contract <haul|courier|passengers|ore|escort|bounty> "client" "destination system or station" [qty N] [good "name"] [target "name"]. The game accepts it only if the character can really do it.\n</contracts>',
        };
    });
    registerCommand('contract', (st, args) => storyContract(args), ['job', 'gig']);
    registerWidget({ id: 'ctboard', title: () => 'Contract board', render: boardHtml });
    registerWidget({ id: 'ctjobs', title: (st) => `Contracts in hand (${activeContracts(st).length})`, render: jobsHtml });
    registerTab({
        id: 'contracts', label: 'Contracts', icon: 'fa-file-signature', order: 23, when: (st) => !st.custody, widgets: ['ctjobs', 'ctboard'],
        badge: (st) => (activeContracts(st).some(c => !nextStep(st, c) || c.deadline < st.minutes) ? '!' : ''),
    });
    registerActions({
        'ct-accept'(el) { intent('ct-accept', { id: el.dataset.id }); },
        'ct-deliver'(el) { intent('ct-deliver', { id: el.dataset.id }); },
        async 'ct-abandon'(el) { if (await confirmAsk('Abandon this contract?', 'The deposit is lost and the client will remember.')) intent('ct-abandon', { id: el.dataset.id }); },
        'ct-return'(el) { intent('ct-return', { id: el.dataset.id }); },
    });

    // What these buttons write into the chat, and what the game does when it is sent.
    const find = (st, id) => {
        const p = port(st);
        return contracts(st).find(x => x.id === id) ?? (p ? boardAt(st, p.key).find(x => x.id === id) : null) ?? (st.offers ?? []).find(x => x.id === id);
    };
    const what = (st, id) => { const c = find(st, id); return c ? `the ${(KINDS[c.kind]?.name ?? 'job').toLowerCase()} for ${c.client}` : 'the contract'; };
    registerIntent('ct-accept', { line: (a, st) => `I sign for ${what(st, a.id)} at the port office.`, run: (a) => accept(a.id) });
    registerIntent('ct-deliver', { line: (a, st) => `I hand over ${what(st, a.id)} and collect my pay.`, run: (a) => { const r = deliver(a.id); return `Paid ${cr(r.pay)}${r.late ? ' (late)' : ''}`; } });
    registerIntent('ct-abandon', { line: (a, st) => `I walk away from ${what(st, a.id)}.`, run: (a) => { abandon(a.id); return 'Contract abandoned'; } });
    registerIntent('ct-return', { line: (a, st) => `I return the freight from ${what(st, a.id)}.`, run: (a) => { returnFreight(a.id); return 'Freight returned'; } });
    void galaxy; void DAY; void placeName;
}
