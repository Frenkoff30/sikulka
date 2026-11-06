// Tvary dílů: klempířské šablony + vlastní nakreslený tvar, a geometrie kolem nich.
// Souřadnice: x doprava (podél DÉLKY plechu), y dolů (přes ŠÍŘKU plechu), vše v mm.
import { numv, lenv, toUnit, fmt, fmtN, U, esc } from './format.js';
import { polyXform } from './nest-engine.js';

const TAU = Math.PI * 2;

// Oblouky: vnější oblouky se kreslí opsaným mnohoúhelníkem (díl je o chlup větší, nikdy menší),
// vnitřní oblouky a díry vepsaným (díra o chlup menší) → v reálu se díly nikdy nepřekryjí.
function arc(cx, cy, r, a0, a1, outer) {
  const span = Math.abs(a1 - a0);
  const per = Math.min(180, Math.max(48, Math.round(r / 4)));
  const n = Math.max(6, Math.ceil(per * span / TAU));
  const st = (a1 - a0) / n;
  const rr = outer ? r / Math.cos(Math.abs(st) / 2) : r;
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + st * i; out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
  return out;
}
function circle(r, outer) {
  const n = Math.min(180, Math.max(48, Math.round(r / 4)));
  const st = TAU / n; const rr = outer ? r / Math.cos(st / 2) : r;
  return Array.from({ length: n }, (_, i) => [rr * Math.cos(i * st), rr * Math.sin(i * st)]);
}
function coneGeo(p) {
  const s = Math.hypot(p.v, (p.D - p.d) / 2);
  const R = s * p.D / (p.D - p.d), r = R - s, th = Math.PI * p.D / R;
  return { s, R, r, th };
}

// pole: [klíč, popisek, výchozí, druh ('pos' > 0, 'nonneg' ≥ 0, 'any'), jednotka]
export const SHAPES = {
  rect: {
    n: 'Obdélník', edges: true,
    f: [['w', 'Šířka', 250, 'pos', 'mm'], ['l', 'Délka', 1000, 'pos', 'mm']],
    poly: (p) => ({ o: [[0, 0], [p.l, 0], [p.l, p.w], [0, p.w]], holes: [] }),
    sum: (p) => `${fmt(p.w)} × ${fmt(p.l)}`,
  },
  bevel: {
    n: 'Šikmý konec', edges: true,
    f: [['w', 'Šířka', 250, 'pos', 'mm'], ['L1', 'Delší hrana', 1200, 'pos', 'mm'], ['L2', 'Kratší hrana', 950, 'pos', 'mm']],
    poly: (p) => ({ o: [[0, 0], [p.L1, 0], [p.L2, p.w], [0, p.w]], holes: [] }),
    sum: (p) => `${fmt(p.w)} × ${fmt(p.L1)}/${fmt(p.L2)}`,
  },
  trap: {
    n: 'Lichoběžník', edges: true,
    f: [['A', 'Dolní základna', 900, 'pos', 'mm'], ['B', 'Horní základna', 500, 'pos', 'mm'], ['v', 'Výška', 300, 'pos', 'mm'], ['s', 'Odsazení horní základny', 200, 'any', 'mm']],
    poly: (p) => ({ o: [[0, p.v], [p.A, p.v], [p.s + p.B, 0], [p.s, 0]], holes: [] }),
    sum: (p) => `${fmt(p.A)}/${fmt(p.B)} × ${fmt(p.v)}`,
  },
  tri: {
    n: 'Trojúhelník', edges: true,
    f: [['a', 'Základna', 800, 'pos', 'mm'], ['v', 'Výška', 400, 'pos', 'mm'], ['s', 'Špička od levého rohu', 400, 'any', 'mm']],
    poly: (p) => ({ o: [[0, p.v], [p.a, p.v], [p.s, 0]], holes: [] }),
    sum: (p) => `${fmt(p.a)} × ${fmt(p.v)}`,
  },
  rtri: {
    n: 'Pravoúhlý trojúhelník', edges: true,
    f: [['a', 'Vodorovná odvěsna', 600, 'pos', 'mm'], ['b', 'Svislá odvěsna', 300, 'pos', 'mm']],
    poly: (p) => ({ o: [[0, 0], [0, p.b], [p.a, p.b]], holes: [] }),
    sum: (p) => `${fmt(p.a)} × ${fmt(p.b)}`,
  },
  para: {
    n: 'Kosodélník', edges: true,
    f: [['L', 'Délka', 800, 'pos', 'mm'], ['v', 'Výška', 300, 'pos', 'mm'], ['s', 'Posun', 150, 'any', 'mm']],
    poly: (p) => ({ o: [[p.s, 0], [p.s + p.L, 0], [p.L, p.v], [0, p.v]], holes: [] }),
    sum: (p) => `${fmt(p.L)} × ${fmt(p.v)}`,
  },
  lshape: {
    n: 'L-tvar', edges: true,
    f: [['A', 'Celková délka', 600, 'pos', 'mm'], ['B', 'Celková výška', 400, 'pos', 'mm'], ['t1', 'Šířka spodního ramene', 150, 'pos', 'mm'], ['t2', 'Šířka svislého ramene', 150, 'pos', 'mm']],
    check: (p) => (p.t1 >= p.B ? 'Spodní rameno musí být užší než celková výška.' : p.t2 >= p.A ? 'Svislé rameno musí být užší než celková délka.' : null),
    poly: (p) => ({ o: [[0, 0], [p.t2, 0], [p.t2, p.B - p.t1], [p.A, p.B - p.t1], [p.A, p.B], [0, p.B]], holes: [] }),
    sum: (p) => `${fmt(p.A)} × ${fmt(p.B)}`,
  },
  circle: {
    n: 'Kruh',
    f: [['D', 'Průměr', 300, 'pos', 'mm']],
    poly: (p) => ({ o: circle(p.D / 2, true), holes: [] }),
    sum: (p) => `Ø ${fmt(p.D)}`,
    info: (p) => [`Průměr ${fmt(p.D)} ${U()}`, `Obvod ${fmt(Math.PI * p.D)} ${U()}`],
  },
  ring: {
    n: 'Kroužek',
    f: [['D', 'Vnější průměr', 400, 'pos', 'mm'], ['d', 'Vnitřní průměr', 200, 'pos', 'mm']],
    check: (p) => (p.d >= p.D ? 'Vnitřní průměr musí být menší než vnější.' : null),
    poly: (p) => ({ o: circle(p.D / 2, true), holes: [circle(p.d / 2, false).reverse()] }),
    sum: (p) => `Ø ${fmt(p.D)} / ${fmt(p.d)}`,
    info: (p) => [`Vnější Ø ${fmt(p.D)} ${U()}, vnitřní Ø ${fmt(p.d)} ${U()}`, `Šířka mezikruží ${fmt((p.D - p.d) / 2)} ${U()}`, 'Do díry se můžou vejít menší díly.'],
  },
  sector: {
    n: 'Kruhová výseč',
    f: [['R', 'Poloměr', 500, 'pos', 'mm'], ['u', 'Úhel', 90, 'pos', '°']],
    check: (p) => (p.u > 360 ? 'Úhel může být nejvýš 360°.' : null),
    poly: (p) => {
      if (p.u >= 360) return { o: circle(p.R, true), holes: [] };
      const th = p.u * Math.PI / 180;
      return { o: [[0, 0]].concat(arc(0, 0, p.R, Math.PI / 2 - th / 2, Math.PI / 2 + th / 2, true)), holes: [] };
    },
    sum: (p) => `R ${fmt(p.R)} · ${fmtN(p.u)}°`,
    info: (p) => [`Poloměr ${fmt(p.R)} ${U()}, úhel ${fmtN(p.u)}°`, `Délka oblouku ${fmt(p.R * p.u * Math.PI / 180)} ${U()}`],
  },
  cone: {
    n: 'Plášť kužele',
    f: [['D', 'Dolní průměr', 600, 'pos', 'mm'], ['d', 'Horní průměr (0 = špička)', 0, 'nonneg', 'mm'], ['v', 'Výška kužele', 250, 'pos', 'mm']],
    check: (p) => (p.d >= p.D ? 'Horní průměr musí být menší než dolní. Válec zadej jako obdélník.' : null),
    poly: (p) => {
      const { R, r, th } = coneGeo(p);
      const a0 = Math.PI / 2 - th / 2, a1 = Math.PI / 2 + th / 2;
      const outer = arc(0, 0, R, a0, a1, true);
      const o = r > 0.05 ? outer.concat(arc(0, 0, r, a1, a0, false)) : outer.concat([[0, 0]]);
      return { o, holes: [] };
    },
    sum: (p) => (p.d > 0 ? `D ${fmt(p.D)} / d ${fmt(p.d)} · v ${fmt(p.v)}` : `D ${fmt(p.D)} · v ${fmt(p.v)}`),
    info: (p) => {
      const { s, R, r, th } = coneGeo(p);
      return [`Rozvin: R ${fmt(R)} ${U()}${r > 0.05 ? `, r ${fmt(r)} ${U()}` : ''}`, `Úhel výseče ${fmtN(th * 180 / Math.PI)}°`, `Délka površky ${fmt(s)} ${U()}`, 'Bez přídavku na spoj – ten přičti k průměru.'];
    },
  },
  custom: { n: 'Vlastní tvar', edges: true, custom: true },
};
export const SHAPE_ORDER = ['rect', 'bevel', 'trap', 'tri', 'rtri', 'para', 'lshape', 'circle', 'ring', 'sector', 'cone', 'custom'];

export function defaults(t) {
  const d = SHAPES[t]; const p = {};
  if (d && d.f) for (const f of d.f) p[f[0]] = f[4] === '°' ? String(f[2]) : toUnit(f[2]);
  return p;
}

/* ---------- geometrie ---------- */
export function ringArea(r) { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
export function polyArea(poly) { return Math.abs(ringArea(poly.o)) - poly.holes.reduce((s, h) => s + Math.abs(ringArea(h)), 0); }
export function inside(rings, x, y) {
  let c = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function segX(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
export function selfIntersects(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    if (segX(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  }
  return false;
}
export function pathD(rings, ox = 0, oy = 0) {
  return rings.map((r) => 'M' + r.map((p) => (p[0] + ox).toFixed(2) + ' ' + (p[1] + oy).toFixed(2)).join('L') + 'Z').join('');
}

/** Vyhodnotí díl: tvar, plocha, obrys, chyby. */
export function geomOf(pc) {
  const t = SHAPES[pc.shape?.t] ? pc.shape.t : 'rect';
  const def = SHAPES[t];
  let poly, p = null;
  if (def.custom) {
    const pts = (pc.shape.pts || []).map((q) => [+q[0], +q[1]]).filter((q) => isFinite(q[0]) && isFinite(q[1]));
    if (pts.length < 3) return { ok: false, t, name: def.n, err: 'Nakresli aspoň 3 body obrysu.' };
    if (selfIntersects(pts)) return { ok: false, t, name: def.n, err: 'Obrys se kříží sám se sebou.' };
    poly = { o: pts, holes: [] };
    if (Math.abs(ringArea(pts)) < 1) return { ok: false, t, name: def.n, err: 'Tvar nemá žádnou plochu.' };
  } else {
    p = {};
    for (const [k, label, , kind, un] of def.f) {
      const raw = pc.shape.p?.[k];
      const v = un === '°' ? numv(raw) : lenv(raw);
      if (isNaN(v) || (kind === 'pos' && !(v > 0)) || (kind === 'nonneg' && v < 0)) return { ok: false, t, name: def.n, err: `Zkontroluj „${label}“.` };
      p[k] = v;
    }
    const e = def.check && def.check(p);
    if (e) return { ok: false, t, name: def.n, err: e };
    poly = def.poly(p);
  }
  const n = polyXform(poly, 0);
  const sum = def.custom ? `${fmt(n.w)} × ${fmt(n.hh)}` : def.sum(p);
  return { ok: true, t, name: def.n, p, poly: { o: n.o, holes: n.holes }, area: polyArea(n), bw: n.w, bh: n.hh, sum, isRect: t === 'rect' };
}

/** Místo pro popisek uvnitř tvaru: bod co nejdál od okrajů + volná šířka/výška kolem něj. */
export function labelSpot(t) {
  const rings = [t.o].concat(t.holes);
  const segs = [];
  for (const r of rings) for (let i = 0; i < r.length; i++) segs.push([r[i], r[(i + 1) % r.length]]);
  const dist = (x, y) => {
    let m = Infinity;
    for (const [a, b] of segs) {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
      let u = L ? ((x - a[0]) * dx + (y - a[1]) * dy) / L : 0; u = Math.max(0, Math.min(1, u));
      const ex = a[0] + u * dx - x, ey = a[1] + u * dy - y; const d = ex * ex + ey * ey;
      if (d < m) m = d;
    }
    return Math.sqrt(m);
  };
  let best = null; const N = 14;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = (i + 0.5) / N * t.w, y = (j + 0.5) / N * t.hh;
    if (!inside(rings, x, y)) continue;
    const d = dist(x, y);
    if (!best || d > best.d) best = { x, y, d };
  }
  if (!best) return { x: t.w / 2, y: t.hh / 2, aw: 0, ah: 0 };
  const st = Math.max(t.w, t.hh) / N / 3;
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const x = best.x + i * st, y = best.y + j * st;
    if (!inside(rings, x, y)) continue;
    const d = dist(x, y); if (d > best.d) best = { x, y, d };
  }
  const span = (horiz) => {
    const xs = [];
    for (const [a, b] of segs) {
      if (horiz) { if ((a[1] > best.y) !== (b[1] > best.y)) xs.push(a[0] + (b[0] - a[0]) * (best.y - a[1]) / (b[1] - a[1])); }
      else if ((a[0] > best.x) !== (b[0] > best.x)) xs.push(a[1] + (b[1] - a[1]) * (best.x - a[0]) / (b[0] - a[0]));
    }
    xs.sort((a, b) => a - b);
    const v = horiz ? best.x : best.y;
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k] <= v && v <= xs[k + 1]) return { lo: xs[k], hi: xs[k + 1] };
    return { lo: v - best.d, hi: v + best.d };
  };
  const h = span(true), v = span(false);
  return { x: (h.lo + h.hi) / 2, y: (v.lo + v.hi) / 2, aw: h.hi - h.lo, ah: v.hi - v.lo, d: best.d, px: best.x, py: best.y };
}

/** Malý náhled tvaru do seznamu dílů. */
export function thumbSVG(poly, ci, size = 52) {
  const n = polyXform(poly, 0);
  const pad = 4, s = (size - pad * 2) / Math.max(n.w, n.hh, 1e-6);
  const ox = (size - n.w * s) / 2, oy = (size - n.hh * s) / 2;
  const sc = (r) => r.map((p) => [p[0] * s, p[1] * s]);
  const d = pathD([sc(n.o)].concat(n.holes.map(sc)), ox, oy);
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><path d="${d}" fill-rule="evenodd" class="th-p" style="fill:var(--p${ci % 8})"/></svg>`;
}

/** Ikona šablony (pro výběr tvaru). */
export function iconSVG(t) {
  let poly;
  if (t === 'custom') poly = { o: [[0, 30], [10, 0], [26, 8], [40, 2], [34, 30], [18, 22]], holes: [] };
  else poly = SHAPES[t].poly(Object.fromEntries(SHAPES[t].f.map((f) => [f[0], f[2]])));
  const n = polyXform(poly, 0);
  const W = 44, H = 34, s = Math.min(W / n.w, H / n.hh);
  const ox = (W - n.w * s) / 2 + 2, oy = (H - n.hh * s) / 2 + 2;
  const sc = (r) => r.map((p) => [p[0] * s, p[1] * s]);
  return `<svg viewBox="0 0 48 38" aria-hidden="true"><path d="${pathD([sc(n.o)].concat(n.holes.map(sc)), ox, oy)}" fill-rule="evenodd" class="ic-p"/></svg>`;
}

export const shapeTitle = (pc) => esc(pc.name || SHAPES[pc.shape?.t]?.n || 'Díl');
