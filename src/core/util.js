// Shared helpers: seeded RNG, formatting, DOM escaping.

/** mulberry32 seeded PRNG. Returns a function producing floats in [0,1). */
export function makeRng(seed) {
    let a = (Number(seed) >>> 0) || 0x9e3779b9;
    return function rng() {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Stable 32-bit hash of any number of values. */
export function hash(...parts) {
    const str = parts.map(String).join('|');
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

export function weightedPick(rng, entries) {
    const total = entries.reduce((s, e) => s + e.w, 0);
    let r = rng() * total;
    for (const e of entries) {
        r -= e.w;
        if (r <= 0) return e;
    }
    return entries[entries.length - 1];
}

/** Unseeded dice for gameplay rolls. */
export const roll = (sides = 100) => 1 + Math.floor(Math.random() * sides);
export const rollRange = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

export function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
export const fmtCr = (n) => `${fmtInt(n)} cr`;
export const pct = (v, max) => (max > 0 ? clamp(Math.round((v / max) * 100), 0, 100) : 0);

export const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

export function norm(s) {
    return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Finds an item in a list by name, case-insensitive, with a loose prefix/contains fallback. */
export function findByName(list, name, key = 'name') {
    const n = norm(name);
    if (!n) return undefined;
    return list.find(x => norm(x[key]) === n)
        ?? list.find(x => norm(x[key]).startsWith(n))
        ?? list.find(x => norm(x[key]).includes(n));
}

export function debounce(fn, ms) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

/** Level word for a 0-100 gauge where high is good. */
export function gaugeClass(p) {
    if (p <= 15) return 'crit';
    if (p <= 35) return 'warn';
    return 'ok';
}
