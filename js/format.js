// Pomocné funkce: čísla, výrazy, formátování (česky)

/** Spočítá jednoduchý výraz: 20+120+150+20, 2*(100+5), 1250/2. Čárka = desetinná tečka. */
export function evalExpr(str) {
  const s = String(str ?? '').replace(/,/g, '.').replace(/\s+/g, '');
  if (!s) return NaN;
  let i = 0;
  const num = () => {
    const st = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    if (st === i) throw 0;
    const v = parseFloat(s.slice(st, i));
    if (isNaN(v)) throw 0;
    return v;
  };
  const factor = () => {
    if (s[i] === '(') { i++; const v = expr(); if (s[i] !== ')') throw 0; i++; return v; }
    if (s[i] === '-') { i++; return -factor(); }
    if (s[i] === '+') { i++; return factor(); }
    return num();
  };
  const term = () => {
    let v = factor();
    while (s[i] === '*' || s[i] === '/') { const op = s[i++]; const r = factor(); v = op === '/' ? v / r : v * r; }
    return v;
  };
  const expr = () => {
    let v = term();
    while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  };
  try { const v = expr(); if (i !== s.length) return NaN; return isFinite(v) ? v : NaN; } catch { return NaN; }
}

/** Číslo z políčka, zaokrouhlené na 0,1. */
export const numv = (v) => { const x = evalExpr(v); return isNaN(x) ? NaN : Math.round(x * 10) / 10; };
/** Je v políčku výraz (ne jen číslo)? */
export const isExpr = (v) => { const s = String(v ?? '').trim(); return /[+*/()]/.test(s) || /\d\s*-\s*\d/.test(s); };

/* ---------- jednotky ----------
   Uvnitř aplikace se počítá vždy v mm. Člověk ale může zadávat a číst v mm, cm nebo m. */
export const UNITS = { mm: { f: 1, d: 1 }, cm: { f: 10, d: 2 }, m: { f: 1000, d: 3 } };
let unit = 'mm';
export const setUnit = (u) => { unit = UNITS[u] ? u : 'mm'; };
/** Zkratka aktuální jednotky (mm / cm / m). */
export const U = () => unit;
/** Délka z políčka (v aktuální jednotce) → mm, zaokrouhleno na 0,1 mm. */
export const lenv = (v, u = unit) => { const x = evalExpr(v); return isNaN(x) ? NaN : Math.round(x * UNITS[u].f * 10) / 10; };
/** Délka v mm → číslo v dané jednotce (pro políčka a převod), bez mezer. */
export const toUnit = (mm, u = unit) => String(+(mm / UNITS[u].f).toFixed(4)).replace('.', ',');
/** Obecné číslo (úhly, počty). */
export const fmtN = (v) => (Math.round(v * 10) / 10).toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
/** Délka v mm → text v aktuální jednotce. */
export const fmt = (v) => (v / UNITS[unit].f).toLocaleString('cs-CZ', { maximumFractionDigits: UNITS[unit].d });
export const m2 = (a) => (a / 1e6).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct = (v) => Math.round(v * 100) + ' %';
export const plural = (n, a, b, c) => (n === 1 ? a : n >= 2 && n <= 4 ? b : c);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (id) => document.getElementById(id);
