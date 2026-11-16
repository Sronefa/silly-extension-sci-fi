// Life ashore and ship ownership: shift work, station living, pilot licences, shipyards
// (new and used hulls, selling), and leaving a ship on a pad or in a hangar.
import { S, addLog, adjust, buildShip, cargoUsed } from '../core/state.js';
import { getGalaxy } from './galaxy.js';
import { makeRng, hash, clamp, uid } from '../core/util.js';
import { JOBS, LIVING, LICENCES, licenceForSize, SHIFT_INCIDENTS } from '../data/life.js';
import { WEAR_PARTS, DOCK_FEE, WEEK, DAY } from '../data/economy.js';
import { VESSELS, STYLES, hullAccess } from '../data/vessels.js';
import { ownClass } from '../data/hulls.js';
import { econ, ledger } from './market.js';
import { port, wearOf } from './services.js';
import { skillOf, skillCheck, gainXp } from './character.js';
import { shipWorth, financeShip, totalDebt } from './finance.js';
import { advanceTime } from './sim.js';
import { book, registerActivity, areaOf, areaName, areasHere, hasSchool } from './activity.js';
import { damagePart } from './body.js';

export { hasSchool };

const fmt = (n) => Math.round(n).toLocaleString('en-US');

function spend(st, amount, text) {
    amount = Math.round(amount);
    if (amount > st.captain.credits) throw new Error(`that costs ${fmt(amount)} cr`);
    st.captain.credits -= amount;
    if (amount) ledger(st, text, -amount);
}

// ---- Shift work ----

/** The jobs on offer at this station today. */
export function jobBoard(st = S()) {
    const p = port(st);
    if (!p || st.custody) return [];
    const day = Math.floor(st.minutes / DAY);
    const r = makeRng(hash('jobs', st.seed, p.key, day));
    const pool = JOBS.filter(j => (!j.econ || j.econ.includes(p.sys.economy)) && (!j.yard || p.station.services.includes('shipyard') || p.station.services.includes('repair')));
    const picked = pool.map(j => ({ j, k: r() })).sort((a, b) => a.k - b.k).slice(0, 5 + (p.sys.security >= 3 ? 1 : 0)).map(x => x.j);
    const done = econ(st).shifts?.day === day ? econ(st).shifts.n : 0;
    return picked.map(j => {
        const lvl = skillOf(st.captain, j.skill);
        const local = (0.85 + 0.05 * p.sys.security) * (0.92 + r() * 0.16);
        const pay = Math.round(j.pay * local * (1 + 0.06 * Math.max(0, lvl - j.min)) / 5) * 5;
        let why = '';
        if (lvl < j.min) why = `needs ${j.skill} ${j.min}`;
        else if (j.licence && !st.captain.licences?.[j.licence]) why = `needs a ${LICENCES[j.licence].name.toLowerCase()}`;
        else if (st.activity) why = `you are committed: ${st.activity.name.toLowerCase()}`;
        else if (done >= 2) why = 'you have worked two shifts today';
        else if (st.captain.needs.rest < 15) why = 'you are too exhausted to work';
        const at = areasHere(st).some(a => a.id === j.at) ? j.at : 'works';
        return { ...j, at, pay, why, overtime: done === 1 };
    }).sort((a, b) => b.pay - a.pay);
}

/**
 * Signs on for a shift. Nothing happens yet: the character has two hours to get to the
 * workplace and clock in, and the eight hours are then lived in story time.
 */
export function takeShift(jobId) {
    const st = S();
    const p = port(st);
    const job = jobBoard(st).find(j => j.id === jobId);
    if (!job) throw new Error('that job is not on the board today');
    if (job.why) throw new Error(job.why);
    book(st, { kind: 'work', id: job.id, name: `Shift as ${job.name.toLowerCase()}`, job: job.name, area: job.at, key: p.key, need: 480, pay: job.pay, skill: job.skill, min: job.min, overtime: job.overtime });
    const where = areaName(st, job.at).toLowerCase();
    st.pendingEvent ??= `${st.captain.name} has signed on for an eight hour shift as ${job.name.toLowerCase()} (${job.desc}) at the ${where} of ${p.station.name}. The shift has not started: they have to get there and report within two hours.`;
    return `Signed on. Report to the ${where} within 2 h and clock in`;
}

function payWage(st, a, pay, tail) {
    pay = Math.round(pay);
    let kept = pay, note = '';
    if (st.indenture) { kept = Math.round(pay * 0.3); garnish(st, pay - kept); note = `, ${fmt(pay - kept)} cr garnished by Combine Credit`; }
    st.captain.credits += kept;
    if (kept) ledger(st, `Wages: ${a.job}`, kept);
    return `${fmt(pay)} cr${tail}${note}`;
}

registerActivity('work', {
    start(st, a) {
        const e = econ(st);
        const day = Math.floor(st.minutes / DAY);
        e.shifts = e.shifts?.day === day ? e.shifts : { day, n: 0 };
        e.shifts.n++;
        st.pendingEvent ??= `${st.captain.name} has clocked in for the shift as ${a.job.toLowerCase()}. Eight hours of it lie ahead. Open the shift: the foreman or whoever is in charge, the task, the people working alongside.`;
    },
    half(st, a) {
        // Out on the rock in a suit, the incident can be the suit.
        if (JOBS.find(j => j.id === a.id)?.eva && Math.random() < 0.15) {
            const r = skillCheck(st.captain, 'athletics', 12);
            if (!r.success) damagePart(st.captain, ['larm', 'rarm', 'lleg', 'rleg'][Math.floor(Math.random() * 4)], 20 + Math.floor(Math.random() * 30));
            st.pendingEvent ??= `Halfway through the EVA shift: ${r.success ? 'a suit seal warning, a tether snaps, a rock shifts. They keep their head and get through it' : 'a rock shifts and pins a limb, and the suit is hurt too. They are injured out there'} (${r.total} against 12). Play it out.`;
            return;
        }
        const what = SHIFT_INCIDENTS[Math.floor(Math.random() * SHIFT_INCIDENTS.length)];
        st.pendingEvent ??= `Halfway through the shift as ${a.job.toLowerCase()}: ${what}. Play it out.`;
    },
    finish(st, a) {
        const r = skillCheck(st.captain, a.skill, 9 + a.min);
        gainXp(st.captain, a.skill, 4);
        adjust(st.captain, 'stress', a.overtime ? 10 : 5, 0, 100);
        const paid = payWage(st, a, a.pay * (r.crit ? 1.25 : r.success ? 1 : 0.7), r.crit ? ' with a bonus for good work' : r.success ? '' : ' after a docked wage for a poor shift');
        st.pendingEvent ??= `The shift as ${a.job.toLowerCase()} is over. ${st.captain.name} clocks out and is paid ${paid}. Close the shift in a line or two.`;
        return `Finished a shift as ${a.job.toLowerCase()}: ${paid}.`;
    },
    stop(st, a, why) {
        const hours = Math.floor(a.done / 60);
        adjust(st.captain, 'stress', 3, 0, 100);
        const paid = hours ? payWage(st, a, a.pay * (hours / 8) * 0.85, ` for ${hours} h`) : 'nothing';
        st.pendingEvent ??= `${st.captain.name} ${why === 'left' ? 'left the workplace and did not come back' : 'walked off the shift'} as ${a.job.toLowerCase()} after ${hours} hours. Paid ${paid}.`;
        return `Left the shift as ${a.job.toLowerCase()} early: ${paid}.`;
    },
    miss(st, a, why) {
        return why === 'cancelled' ? `Gave the shift as ${a.job.toLowerCase()} back.` : `Did not turn up for the shift as ${a.job.toLowerCase()}.`;
    },
});

function garnish(st, amount) {
    const loan = (st.loans ?? []).find(l => l.id === st.indenture?.loan);
    if (!loan) { st.indenture = null; return; }
    loan.balance = Math.max(0, loan.balance - amount);
    if (loan.balance < 1) { st.indenture = null; addLog('The indenture is paid off. Combine Credit releases its claim on your earnings.', 'trade'); }
    st.captain.debt = totalDebt(st);
    econ(st).debtSynced = st.captain.debt;
}

export function living(kind) {
    const st = S();
    const p = port(st);
    if (!p) throw new Error('you need to be aboard a station');
    const item = LIVING[kind];
    if (!item) throw new Error('use: meal, bunk or room');
    if (st.activity?.on) throw new Error(`you are in the middle of something: ${st.activity.name.toLowerCase()}`);
    const here = areaOf(st);
    if (kind === 'meal' ? !['concourse', 'habitat'].includes(here) : here !== 'habitat') throw new Error(kind === 'meal' ? 'food is sold on the concourse and in the habitat ring: go there' : 'beds are in the habitat ring: go there');
    spend(st, item.cost, item.name);
    const pc = st.captain;
    if (kind === 'meal') {
        advanceTime(item.minutes);
        adjust(pc.needs, 'nourishment', 55, 0, 100); adjust(pc.needs, 'hydration', 50, 0, 100);
        return `Ate a hot meal (${item.cost} cr)`;
    }
    advanceTime(item.minutes, { asleep: true });
    adjust(pc, 'stress', kind === 'room' ? -30 : -14, 0, 100);
    adjust(pc.needs, 'hygiene', kind === 'room' ? 85 : 40, 0, 100);
    if (kind === 'room') adjust(pc.needs, 'morale', 8, 0, 100);
    return `Slept eight hours in a ${kind === 'room' ? 'private room' : 'capsule bunk'} (${item.cost} cr)`;
}

// ---- Licences ----

export const licencesOf = (st = S()) => (st.captain.licences ??= {});

/** Which licences a hull needs. */
export function licencesNeeded(cls) {
    if (!cls) return [];
    const out = [licenceForSize(cls.size)];
    if ((cls.mounts ?? []).some(m => !['pd', 'sandcaster', 'mininglaser', 'harpoon'].includes(m.id))) out.push('armed');
    return out;
}
export const missingLicences = (st, cls) => licencesNeeded(cls).filter(id => !licencesOf(st)[id]);


export function licenceStatus(st, id) {
    const def = LICENCES[id];
    const course = st.captain.course?.id === id ? st.captain.course : null;
    let why = '';
    if (licencesOf(st)[id]) why = 'held';
    else if (def.needs && !licencesOf(st)[def.needs]) why = `needs the ${LICENCES[def.needs].name.toLowerCase()} first`;
    else if (skillOf(st.captain, 'pilot') < def.pilot) why = `needs pilot ${def.pilot}`;
    else if (st.captain.course && !course) why = 'finish your current course first';
    return { def, course, why };
}

export function enrol(id) {
    const st = S();
    const p = port(st);
    if (!hasSchool(p)) throw new Error('there is no flight school here');
    const s = licenceStatus(st, id);
    if (s.why) throw new Error(s.why);
    if (s.course) throw new Error('already enrolled');
    if (areaOf(st) !== 'school') throw new Error('enrolment is done in person: go to the flight school');
    spend(st, s.def.fee, `Course fee: ${s.def.name}`);
    st.captain.course = { id, lessons: 0, theory: false, day: -1, today: 0 };
    addLog(`Enrolled for the ${s.def.name}.`, 'story');
    return `Enrolled: ${s.def.lessons} lessons, then a written test and a check flight`;
}

/**
 * Books the next step of the course: a lesson, the written test or the check flight. It is
 * held at the flight school and takes its real time.
 */
export function courseStep() {
    const st = S();
    const p = port(st);
    const c = st.captain.course;
    if (!c) throw new Error('you are not enrolled on a course');
    if (!hasSchool(p)) throw new Error('lessons and tests are held at a flight school: dock at a policed station');
    const def = LICENCES[c.id];
    const day = Math.floor(st.minutes / DAY);
    if (c.day !== day) { c.day = day; c.today = 0; }
    const base = { area: 'school', key: p.key, course: c.id };
    if (c.lessons < def.lessons) {
        if (c.today >= 2) throw new Error('two lessons a day is all the school offers');
        book(st, { ...base, kind: 'lesson', name: `Lesson ${c.lessons + 1} of ${def.lessons}, ${def.name}`, need: 240 });
        return 'Lesson booked. Be at the flight school within 2 h';
    }
    if (c.retry > st.minutes) throw new Error('the examiner will see you again tomorrow');
    if (c.fail && st.captain.credits < 300) throw new Error('the resit fee is 300 cr');
    if (!c.theory) book(st, { ...base, kind: 'exam', name: `Written test, ${def.name}`, need: 120, note: 'It is a sat, silent, invigilated paper.' });
    else book(st, { ...base, kind: 'checkflight', name: `Check flight, ${def.name}`, need: 180, note: 'The examiner sits in the right-hand seat and says little. The flight leaves from and returns to the school; do not change the character\'s area.' });
    return `${c.theory ? 'Check flight' : 'Written test'} booked. Be at the flight school within 2 h`;
}

const courseOf = (st, a) => (st.captain.course?.id === a.course ? st.captain.course : null);
const resit = (st, c) => { if (c.fail) { spend(st, 300, 'Resit fee'); } };

registerActivity('lesson', {
    start(st, a) {
        const c = courseOf(st, a);
        if (c) c.today++;
        st.pendingEvent ??= `${st.captain.name} has reported for a four hour flying lesson (${a.name}). Play the lesson: the instructor, the classroom or the trainer cockpit, what is being taught today.`;
    },
    finish(st, a) {
        const c = courseOf(st, a);
        if (!c) return '';
        const def = LICENCES[c.id], pc = st.captain;
        c.lessons++;
        gainXp(pc, def.flightSkill ?? 'pilot', 6);
        if (c.lessons % 3 === 0) gainXp(pc, 'navigation', 5);
        // Nobody finishes the course without learning to fly at all.
        if (c.lessons === def.lessons && c.id === 'basic' && (pc.skills.pilot ?? 0) < 1) pc.skills.pilot = 1;
        st.pendingEvent ??= `The lesson is over (${c.lessons} of ${def.lessons} done). Close it in a line or two.`;
        return `Lesson ${c.lessons} of ${def.lessons} done.`;
    },
    stop(st, a) { return `Walked out of a lesson. It does not count.`; },
    miss(st, a, why) { return why === 'cancelled' ? 'Lesson cancelled.' : 'Missed a booked lesson.'; },
});

function failed(st, c, def, what, r, dc) {
    c.fail = true; c.retry = st.minutes + DAY;
    st.pendingEvent ??= `${st.captain.name} has failed the ${what} for the ${def.name}${r ? ` (${r.total} against ${dc})` : ''}. Narrate how it went wrong. A resit is possible tomorrow for 300 credits.`;
    return `Failed the ${what}${r ? ` (${r.total} against ${dc})` : ''}. Resit tomorrow for 300 cr.`;
}

registerActivity('exam', {
    start(st, a) { const c = courseOf(st, a); if (c) resit(st, c); st.pendingEvent ??= `${st.captain.name} sits down to the two hour written test for the ${LICENCES[a.course].name}. Play the exam room; the result is not known until the game gives it.`; },
    finish(st, a) {
        const c = courseOf(st, a);
        if (!c) return '';
        const def = LICENCES[c.id];
        const r = skillCheck(st.captain, 'navigation', def.theoryDc, { mod: 2 });
        if (!r.success) return failed(st, c, def, 'written test', r, def.theoryDc);
        c.theory = true; c.fail = false;
        st.pendingEvent ??= `${st.captain.name} has passed the written test for the ${def.name} (${r.total} against ${def.theoryDc}). The check flight is next.`;
        return 'Passed the written test. The check flight is next.';
    },
    stop(st, a) { const c = courseOf(st, a); return c ? failed(st, c, LICENCES[c.id], 'written test (walked out)') : ''; },
    miss(st, a, why) { return why === 'cancelled' ? 'Test booking cancelled.' : 'Missed the written test. It will have to be booked again.'; },
});

registerActivity('checkflight', {
    start(st, a) { const c = courseOf(st, a); if (c) resit(st, c); st.pendingEvent ??= `${st.captain.name} walks out to the trainer with the examiner for the three hour check flight for the ${LICENCES[a.course].name}. Play the flight as it happens; the result is not known until the game gives it.`; },
    finish(st, a) {
        const c = courseOf(st, a);
        if (!c) return '';
        const def = LICENCES[c.id], pc = st.captain;
        const r = skillCheck(pc, def.flightSkill ?? 'pilot', def.flightDc, { mod: 2 + (c.fails ?? 0) });
        st.lastCheck = { ...r, who: pc.name, text: `${pc.name} ${def.name} check flight: ${r.total} against ${def.flightDc}, ${r.success ? 'passed' : 'failed'}.` };
        if (!r.success) { c.fails = (c.fails ?? 0) + 1; return failed(st, c, def, 'check flight', r, def.flightDc); }
        licencesOf(st)[c.id] = { since: st.minutes, issuer: port(st)?.sys.faction ?? null };
        pc.course = null;
        st.pendingEvent ??= `${pc.name} has passed the check flight (${r.total} against ${def.flightDc}) and been granted the ${def.name}. Narrate the landing and the moment the licence is issued.`;
        return `Licence granted: ${def.name}.`;
    },
    stop(st, a) { const c = courseOf(st, a); return c ? failed(st, c, LICENCES[c.id], 'check flight (abandoned)') : ''; },
    miss(st, a, why) { return why === 'cancelled' ? 'Check flight cancelled.' : 'Missed the check flight. It will have to be booked again.'; },
});

/** Characters who start with a ship, or as trained pilots, already hold the papers for it. */
export function grantStartingLicences(st) {
    const e = econ(st);
    if (e.licInit) return;
    e.licInit = true;
    const lic = licencesOf(st);
    const own = st.ship ? VESSELS[st.ship.classId] : null;
    if (own) for (const id of licencesNeeded(own)) { lic[id] = { since: st.minutes, issuer: null }; if (LICENCES[id].needs) lic[LICENCES[id].needs] ??= { since: st.minutes, issuer: null }; }
    if (!lic.basic && skillOf(st.captain, 'pilot') >= 3) lic.basic = { since: st.minutes, issuer: null };
}

// ---- Shipyards ----

const maxSize = (sys) => (sys.security >= 5 ? 5 : sys.security >= 4 ? 4 : 3);

/** New and used hulls for sale at this station this week. */
export function yardStock(st = S()) {
    const p = port(st);
    if (!p || !p.station.services.includes('shipyard')) return null;
    const week = Math.floor(st.minutes / WEEK);
    const r = makeRng(hash('yard', st.seed, p.key, week));
    const sold = econ(st).sold ?? [];
    const standing = st.reputation?.[p.sys.faction] ?? 0;
    const sellable = Object.values(VESSELS).filter(v => v.price && !v.decoy && !v.machine && !v.mech && (v.legal === 'open' || v.legal === 'licensed')
        && (!v.faction || v.faction === p.sys.faction) && v.size <= maxSize(p.sys) && v.family !== 'strike' || (v.id === 'shuttle'));
    const style = STYLES[p.sys.faction]?.price ?? 1;
    const starters = ['shuttle', 'sparrow', 'mule'].map(id => VESSELS[id]);
    const rest = sellable.filter(v => !starters.includes(v)).map(v => ({ v, k: r() })).sort((a, b) => a.k - b.k).slice(0, 5).map(x => x.v);
    const news = [...starters.filter(() => r() < 0.8), ...rest].map(v => {
        const price = Math.round(v.price * (0.95 + 0.1 * r()) * (v.faction ? 1 : 0.9 + style * 0.1) / 500) * 500;
        const acc = hullAccess(v, { standing });
        return { id: `n:${v.id}`, cls: v, used: false, price, ok: acc.ok, why: acc.ok ? '' : acc.why };
    });
    const usedPool = Object.values(VESSELS).filter(v => v.price && v.legal === 'open' && !v.mech && !v.machine && !v.decoy && v.size <= 3);
    const used = [];
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
        const v = usedPool[Math.floor(r() * usedPool.length)];
        const age = 0.25 + r() * 0.6;
        const wear = {};
        for (const part of WEAR_PARTS) wear[part.id] = Math.round(clamp(age * 100 * (0.5 + r()), 5, 95));
        const lemon = r() < 0.3;
        if (lemon) wear[WEAR_PARTS[Math.floor(r() * 4)].id] = 85 + Math.floor(r() * 12);
        const hull = Math.round(100 - age * 30 * r());
        const avg = Object.values(wear).reduce((a, b) => a + b, 0) / 7;
        // A lemon is priced as if its worst fault were not there.
        const priced = lemon ? avg - 8 : avg;
        const price = Math.round(v.price * (0.8 - priced / 180) / 500) * 500;
        const id = `u:${week}:${i}:${v.id}`;
        used.push({ id, cls: v, used: true, price, wear, hull, lemon, name: `${['Lucky', 'Old', 'Second', 'Honest', 'Last', 'Patient', 'Grey', 'Faithful'][Math.floor(r() * 8)]} ${['Maria', 'Chance', 'Wind', 'Debt', 'Harbour', 'Promise', 'Mule', 'Rosa'][Math.floor(r() * 8)]}`, ok: true, why: '' });
    }
    return { new: news, used: used.filter(u => !sold.includes(u.id)) };
}

export function inspect(offerId, how) {
    const st = S();
    const p = port(st);
    const offer = yardStock(st)?.used.find(u => u.id === offerId);
    if (!offer) throw new Error('that ship is not for sale here');
    const e = econ(st);
    e.inspected ??= {};
    e.surveys ??= {};
    if (e.inspected[offerId] === 2) throw new Error('already surveyed');
    if (how === 'pay') {
        if (e.surveys[offerId]) throw new Error('the surveyor is already at work on her');
        const fee = Math.max(150, Math.round(offer.price * 0.015 / 10) * 10);
        spend(st, fee, `Survey: ${offer.name}`);
        e.surveys[offerId] = { due: st.minutes + 240, name: offer.name };
        return `A marine surveyor will go through the ${offer.name} (${fmt(fee)} cr). The report comes in about 4 h`;
    }
    if (e.inspected[offerId]) throw new Error('you have already been over her once');
    book(st, { kind: 'inspect', name: `Inspecting the ${offer.name}`, area: 'yard', key: p.key, need: 240, offer: offerId, ship: offer.name });
    return `The yard will let you aboard the ${offer.name}. Be at the shipyard within 2 h; going through her takes about 4 h`;
}

registerActivity('inspect', {
    start(st, a) { st.pendingEvent ??= `${st.captain.name} is let aboard the ${a.ship}, a used ship for sale, to go through her with a torch and a multimeter. Four hours of crawling through machinery spaces. Play it; what they find is decided by the game at the end.`; },
    finish(st, a) {
        const r = skillCheck(st.captain, 'engineering', 13);
        gainXp(st.captain, 'engineering', 4);
        (econ(st).inspected ??= {})[a.offer] = Math.max(econ(st).inspected[a.offer] ?? 0, r.success ? 2 : 1);
        st.pendingEvent ??= r.success ? `${st.captain.name} has finished going through the ${a.ship} and found what there was to find: her true condition is now known (see the listing).` : `${st.captain.name} has finished going through the ${a.ship} but could not be sure of what they saw.`;
        return r.success ? `Went through the ${a.ship} and found what there was to find.` : `Went through the ${a.ship} but could not be sure of what you saw.`;
    },
    stop(st, a) { return `Gave up the inspection of the ${a.ship} half done. Nothing certain was learned.`; },
    miss(st, a, why) { return why === 'cancelled' ? 'Inspection cancelled.' : `Did not turn up to inspect the ${a.ship}.`; },
});

/** Surveyors hired at the yard do their own work in their own time. */
function surveyTick(st) {
    const e = econ(st);
    for (const [id, sv] of Object.entries(e.surveys ?? {})) {
        if (st.minutes < sv.due) continue;
        delete e.surveys[id];
        (e.inspected ??= {})[id] = 2;
        addLog(`The surveyor's report on the ${sv.name} is in.`, 'trade');
    }
}

/** What a used listing shows: the seller's story until someone competent has looked. */
export function listingWear(st, offer) {
    const level = econ(st).inspected?.[offer.id] ?? 0;
    if (level === 2) return { level, wear: offer.wear, hull: offer.hull };
    const wear = {};
    for (const [k, v] of Object.entries(offer.wear)) wear[k] = Math.min(v, 60) - (level ? 0 : 10);
    return { level, wear, hull: Math.max(offer.hull, 92), survey: econ(st).surveys?.[offer.id] ?? null };
}

export function tradeIn(st = S()) {
    if (!st.ship) return 0;
    const cls = VESSELS[st.ship.classId];
    return cls && (cls.legal === 'open' || cls.legal === 'licensed') ? shipWorth(st) : Math.round(shipWorth(st) * 0.2);
}

export function buyQuote(st, offer, { finance = false } = {}) {
    const trade = tradeIn(st);
    const net = offer.price - trade;
    const down = finance ? Math.max(0, Math.ceil(offer.price * 0.2) - trade) : Math.max(0, net);
    const borrowed = finance ? Math.max(0, net - down) : 0;
    let why = offer.why;
    const sys = port(st)?.sys;
    if (!why && down > st.captain.credits) why = `needs ${fmt(down)} cr ${finance ? 'down' : ''}`.trim();
    if (!why && finance && (!sys || sys.security < 3)) why = 'no bank here will finance a hull';
    if (!why && finance && ((st.loans ?? []).some(l => l.lender === 'bank') || (st.loans ?? []).some(l => l.missed))) why = 'the bank will not lend to you';
    if (!why && st.ship && cargoUsed(st) > ownClass(offer.cls.id).cargo) why = 'your cargo will not fit in her hold: sell it first';
    if (!why && (st.ship?.yard ?? []).length) why = 'your ship is in the yard';
    return { trade, net, down, borrowed, ok: !why, why, missing: missingLicences(st, offer.cls) };
}

export function buyShip(offerId, { finance = false, name = '' } = {}) {
    const st = S();
    const stock = yardStock(st);
    const offer = stock && [...stock.new, ...stock.used].find(o => o.id === offerId);
    if (!offer) throw new Error('that ship is not for sale here');
    if (areaOf(st) !== 'yard') throw new Error('ships are bought in person: go to the shipyard');
    const q = buyQuote(st, offer, { finance });
    if (!q.ok) throw new Error(q.why);
    const old = st.ship;
    st.captain.credits -= q.down;
    if (q.net < 0 && !finance) st.captain.credits += -q.net;
    ledger(st, `${offer.used ? 'Used' : 'New'} ${offer.cls.name}${old ? ', trade-in' : ''}`, -(finance ? q.down : q.net));
    // A bank loan on the old hull moves to the new one.
    for (const l of st.loans ?? []) if (l.collateral) l.collateral = true;
    const ship = buildShip(offer.cls.id, name || offer.name || `${offer.cls.name.split(/[- ]/)[0]} ${Math.floor(100 + Math.random() * 900)}`);
    if (offer.used) {
        ship.wear = { ...offer.wear };
        ship.hull = Math.round(ship.maxHull * offer.hull / 100);
        (econ(st).sold ??= []).push(offer.id);
        if (econ(st).sold.length > 30) econ(st).sold.shift();
    }
    if (old) { ship.supplies = old.supplies; ship.parts = old.parts; ship.fuel = Math.min(ship.maxFuel, old.fuel); }
    st.ship = ship;
    wearOf(st);
    if (q.borrowed) financeShip(st, q.borrowed);
    const text = `Bought the ${ship.name}, a ${offer.used ? 'used ' : ''}${offer.cls.name}, for ${fmt(offer.price)} cr${old ? ` less ${fmt(q.trade)} cr for the ${old.name}` : ''}${q.borrowed ? `, ${fmt(q.borrowed)} cr of it on a bank loan` : ''}.`;
    addLog(text, 'trade');
    st.pendingEvent ??= `${st.captain.name} has just bought a ship: the ${ship.name}, a ${offer.used ? 'well-used ' : 'new '}${offer.cls.name} (${offer.cls.role}). ${q.missing.length ? `They do not hold the licence to fly her legally (${q.missing.map(id => LICENCES[id].name).join(', ')}). ` : ''}Narrate taking possession.`;
    return text;
}

export function sellShip() {
    const st = S();
    const p = port(st);
    if (!st.ship) throw new Error('you have no ship to sell');
    if (!p || !(p.station.services.includes('shipyard') || p.station.services.includes('repair'))) throw new Error('nobody here buys ships');
    if (areaOf(st) !== 'yard') throw new Error('take the papers to the shipyard office: go to the shipyard');
    if (cargoUsed(st) > 2) throw new Error('empty the hold first');
    const price = Math.round(tradeIn(st) * (p.station.services.includes('shipyard') ? 1 : 0.8));
    const name = st.ship.name;
    st.ship = null;
    st.captain.credits += price;
    ledger(st, `Sold the ${name}`, price);
    // The bank takes its money first.
    for (const l of (st.loans ?? []).filter(x => x.collateral)) {
        const pay = Math.min(l.balance, st.captain.credits);
        st.captain.credits -= pay; l.balance -= pay; l.collateral = false; l.repo = false;
        if (pay) ledger(st, 'Ship loan settled from the sale', -pay);
    }
    st.loans = (st.loans ?? []).filter(l => l.balance >= 1);
    st.captain.debt = totalDebt(st); econ(st).debtSynced = st.captain.debt;
    addLog(`Sold the ${name} for ${fmt(price)} cr.`, 'trade');
    return `Sold the ${name} for ${fmt(price)} cr`;
}

// ---- Leaving a ship behind ----

export function layUpQuote(st = S()) {
    const p = port(st);
    if (!p || !st.ship) return null;
    const size = VESSELS[st.ship.classId]?.size ?? 2;
    const base = (DOCK_FEE[size] ?? 40) * (0.6 + 0.2 * p.sys.security);
    return { pad: Math.max(4, Math.round(base * 0.35)), hangar: Math.round(base * 1.4), risky: p.sys.security <= 2 };
}

export function layUp(mode) {
    const st = S();
    const p = port(st);
    const q = layUpQuote(st);
    if (!q) throw new Error('dock your ship at a station first');
    if (st.laidUp) throw new Error('you already have a ship laid up elsewhere');
    if (!['pad', 'hangar'].includes(mode)) throw new Error('use: pad or hangar');
    if ((st.ship.yard ?? []).length) throw new Error('she is in the yard: wait for the work to finish');
    st.laidUp = { ship: st.ship, cargo: st.cargo.splice(2), key: p.key, mode, fee: q[mode], since: st.minutes, paid: 0, place: `${p.station.name}, ${p.sys.name}` };
    st.ship = null;
    addLog(`The ${st.laidUp.ship.name} is laid up ${mode === 'pad' ? 'on an open pad' : 'in a locked hangar'} at ${p.station.name} for ${q[mode]} cr a day.`, 'ship');
    return `Laid up ${mode === 'pad' ? 'on an open pad' : 'in a locked hangar'}: ${q[mode]} cr a day`;
}

export function reclaim() {
    const st = S();
    const p = port(st);
    const l = st.laidUp;
    if (!l) throw new Error('you have no ship laid up');
    if (!p || p.key !== l.key) throw new Error(`she is at ${l.place}`);
    if (st.ship) throw new Error('you already have a ship here');
    st.ship = l.ship;
    st.cargo.push(...l.cargo);
    st.laidUp = null;
    addLog(`Back aboard the ${st.ship.name}.`, 'ship');
    return `Back aboard the ${st.ship.name}`;
}

function layUpDay(st) {
    const l = st.laidUp;
    if (!l) return;
    const due = Math.floor((st.minutes - l.since) / DAY) + 1;
    let owed = 0;
    while (l.paid < due) { l.paid++; owed += l.fee; }
    if (owed) {
        const paid = Math.min(Math.max(0, st.captain.credits), owed);
        st.captain.credits -= paid;
        ledger(st, `${l.mode === 'pad' ? 'Pad' : 'Hangar'} rent, ${l.ship.name}`, -owed);
        if (paid < owed) st.captain.debt = (st.captain.debt ?? 0) + owed - paid;
    }
    if (l.mode !== 'pad') return;
    const [sysId] = l.key.split('.').map(Number);
    const sec = getGalaxy(st.seed).systems[sysId].security;
    if (sec > 2) return;
    const roll = Math.random();
    if (sec === 0 && roll < 0.004) {
        addLog(`Word reaches you that the ${l.ship.name} is gone from her pad at ${l.place}. Stolen.`, 'ship');
        st.pendingEvent ??= `News reaches ${st.captain.name}: the ${l.ship.name}, left on an open pad at ${l.place}, has been stolen.`;
        st.laidUp = null;
    } else if (roll < 0.012 * (3 - sec)) {
        const lost = l.cargo.splice(0).reduce((n, c) => n + c.qty, 0);
        l.ship.parts = 0; l.ship.supplies = Math.round(l.ship.supplies / 2); l.ship.fuel = Math.round(l.ship.fuel / 2);
        addLog(`Thieves have been through the ${l.ship.name} on her pad at ${l.place}: stores and parts taken${lost ? `, ${lost} t of cargo gone` : ''}.`, 'ship');
    }
}

// ---- Flying without papers ----

export function paperCheck(st) {
    if (!st.ship || st.custody) return;
    const sys = getGalaxy(st.seed).systems[st.loc.system];
    if (sys.security < 3 || sys.faction === 'ashen') return;
    const cls = VESSELS[st.ship.classId];
    const missing = missingLicences(st, cls);
    if (!missing.length || Math.random() > 0.35) return;
    const fine = 1500 * (cls?.size ?? 2);
    const paid = Math.min(Math.max(0, st.captain.credits), fine);
    st.captain.credits -= paid;
    if (paid < fine) st.captain.debt = (st.captain.debt ?? 0) + fine - paid;
    ledger(st, 'Fine: flying without a licence', -fine);
    adjust(st.reputation, sys.faction, -2, -100, 100);
    addLog(`Traffic control in ${sys.name} checked your papers: fined ${fmt(fine)} cr for flying without the ${missing.map(id => LICENCES[id].name).join(' and ')}.`, 'trade');
    st.pendingEvent = `${st.pendingEvent ? `${st.pendingEvent} ` : ''}On arrival, ${sys.name} traffic control asked for the pilot's licence. ${st.captain.name} does not hold the ${missing.map(id => LICENCES[id].name).join(' or the ')} and has been fined ${fmt(fine)} credits.`;
}

export function lifeTick(st) {
    grantStartingLicences(st);
    surveyTick(st);
    const e = econ(st);
    const day = Math.floor(st.minutes / DAY);
    if ((e.lifeDay ?? day) < day || (st.laidUp && st.laidUp.paid === 0)) layUpDay(st);
    e.lifeDay = day;
    if ((e.inspected && Object.keys(e.inspected).length > 12)) e.inspected = Object.fromEntries(Object.entries(e.inspected).slice(-8));
}
void uid;
