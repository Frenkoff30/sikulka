// Skládání LIBOVOLNÝCH TVARŮ na obdélníkový plech (nesting).
//
// Princip: plech i každý díl se převedou na jemnou mřížku (např. 5 mm). Díl se do mřížky
// převádí "s rezervou" – každá buňka, které se tvar jen dotkne, se počítá jako obsazená,
// takže se díly v reálu nikdy nepřekryjí. Pak se díly pokládají co nejvíc doleva (k začátku
// tabule) a nahoru, zkouší se otočení po 90° a stovky různých pořadí. Vybere se varianta
// s nejmenším počtem tabulí a nejkratší spotřebou na poslední tabuli (zbude velký celý kus).
//
// Tento soubor běží ve Web Workeru (nest-worker.js), aby se aplikace při počítání nesekala.

export function niceCell(len, limit) {
  for (const v of [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100]) if (len / v <= limit) return v;
  return 200;
}

/** Otočí tvar o 0/90/180/270° a posune ho do počátku. Vrací {o, holes, w, hh}. */
export function polyXform(poly, deg) {
  const f = deg === 90 ? (p) => [-p[1], p[0]] : deg === 180 ? (p) => [-p[0], -p[1]] : deg === 270 ? (p) => [p[1], -p[0]] : (p) => [p[0], p[1]];
  const o = poly.o.map(f), holes = (poly.holes || []).map((r) => r.map(f));
  let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
  for (const p of o) { if (p[0] < mx) mx = p[0]; if (p[1] < my) my = p[1]; if (p[0] > Mx) Mx = p[0]; if (p[1] > My) My = p[1]; }
  const s = (p) => [p[0] - mx, p[1] - my];
  return { o: o.map(s), holes: holes.map((r) => r.map(s)), w: Mx - mx, hh: My - my };
}

/** Konzervativní rastr: buňka je plná, pokud do ní zasahuje jakákoli část tvaru. */
function rasterize(rings, w, h, c) {
  const cols = Math.max(1, Math.ceil(w / c - 1e-9)), rows = Math.max(1, Math.ceil(h / c - 1e-9));
  const g = new Uint8Array(cols * rows);
  const E = [];
  for (const r of rings) for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    if (p[0] === q[0] && p[1] === q[1]) continue;
    E.push([p[0], p[1], q[0], q[1]]);
  }
  const eps = c * 1e-6;
  const xs = [];
  for (let j = 0; j < rows; j++) {
    const y0 = j * c + eps, y1 = (j + 1) * c - eps, base = j * cols;
    // 1) buňky, kterými prochází hrana
    for (const [px, py, qx, qy] of E) {
      const loY = Math.min(py, qy), hiY = Math.max(py, qy);
      if (hiY < y0 || loY > y1) continue;
      let xa, xb;
      if (qy === py) { xa = px; xb = qx; }
      else {
        const ya = Math.max(y0, loY), yb = Math.min(y1, hiY);
        xa = px + (qx - px) * (ya - py) / (qy - py);
        xb = px + (qx - px) * (yb - py) / (qy - py);
      }
      const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
      let i0 = Math.floor(lo / c + 1e-9), i1 = Math.ceil(hi / c - 1e-9) - 1;
      if (i1 < i0) continue; // svislá hrana přesně na čáře mřížky
      if (i0 < 0) i0 = 0; if (i1 > cols - 1) i1 = cols - 1;
      for (let i = i0; i <= i1; i++) g[base + i] = 1;
    }
    // 2) buňky, jejichž střed leží uvnitř (sudo-liché pravidlo → díry fungují)
    const ym = (j + 0.5) * c; xs.length = 0;
    for (const [px, py, qx, qy] of E) if ((py > ym) !== (qy > ym)) xs.push(px + (qx - px) * (ym - py) / (qy - py));
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let i0 = Math.ceil(xs[k] / c - 0.5 - 1e-9), i1 = Math.floor(xs[k + 1] / c - 0.5 + 1e-9);
      if (i0 < 0) i0 = 0; if (i1 > cols - 1) i1 = cols - 1;
      for (let i = i0; i <= i1; i++) g[base + i] = 1;
    }
  }
  return { g, cols, rows };
}

/** Rozšíří masku o d buněk na všechny strany (kvůli prořezu). */
function dilate(m, d) {
  const cols = m.cols + 2 * d, rows = m.rows + 2 * d;
  const t = new Uint8Array(cols * m.rows);
  for (let y = 0; y < m.rows; y++) for (let x = 0; x < m.cols; x++) if (m.g[y * m.cols + x]) for (let k = 0; k <= 2 * d; k++) t[y * cols + x + k] = 1;
  const g = new Uint8Array(cols * rows);
  for (let y = 0; y < m.rows; y++) for (let x = 0; x < cols; x++) if (t[y * cols + x]) for (let k = 0; k <= 2 * d; k++) g[(y + k) * cols + x] = 1;
  return { g, cols, rows };
}

function runsOf(m) {
  const out = [];
  for (let y = 0; y < m.rows; y++) {
    const r = []; let x = 0; const b = y * m.cols;
    while (x < m.cols) {
      if (m.g[b + x]) { const a = x; while (x < m.cols && m.g[b + x]) x++; r.push(a, x - 1); } else x++;
    }
    out.push(r);
  }
  return out;
}

function hashM(m) { let h = m.cols * 7919 + m.rows; for (let i = 0; i < m.g.length; i++) if (m.g[i]) h = (Math.imul(h, 31) + i) | 0; return h; }

export function nestPrepare(J) {
  const cell = J.coil ? niceCell(J.Y, 320) : niceCell(Math.max(J.X, J.Y), 640);
  const R = Math.ceil(J.Y / cell - 1e-9), C = Math.ceil(J.X / cell - 1e-9);
  const dil = J.kerf > 0 ? Math.ceil(J.kerf / cell - 1e-9) : 0;
  const parts = J.parts.map((pt) => {
    const degs = pt.rot ? [0, 90, 180, 270] : [0];
    const oris = []; const seen = new Set();
    for (const deg of degs) {
      const t = polyXform(pt.poly, deg);
      if (t.w > J.X + 1e-6 || t.hh > J.Y + 1e-6) continue;
      const core = rasterize([t.o].concat(t.holes), t.w, t.hh, cell);
      if (core.cols > C || core.rows > R) continue;
      const sig = core.cols + 'x' + core.rows + ':' + hashM(core);
      if (seen.has(sig)) continue; seen.add(sig);
      const dm = dil ? dilate(core, dil) : core;
      oris.push({ deg, w: t.w, h: t.hh, cols: core.cols, rows: core.rows, core: runsOf(core), dm: runsOf(dm), d: dil });
    }
    return { oris };
  });
  return { cell, R, C, parts };
}

function fits(s, runs, gx, gy, C) {
  const pre = s.pre, W = C + 1;
  for (let r = 0; r < runs.length; r++) {
    const rr = runs[r]; if (!rr.length) continue;
    const base = (gy + r) * W + gx;
    for (let k = 0; k < rr.length; k += 2) if (pre[base + rr[k + 1] + 1] - pre[base + rr[k]] !== 0) return false;
  }
  return true;
}

function findPos(s, o, P, J, bound) {
  const c = P.cell;
  const gxMax = Math.min(Math.floor((J.X - o.w) / c + 1e-9), P.C - o.cols);
  const gyMax = Math.min(Math.floor((J.Y - o.h) / c + 1e-9), P.R - o.rows);
  for (let gx = 0; gx <= gxMax; gx++) {
    if (gx * c + o.w >= bound - 1e-9) return null;
    if (s.colCnt[gx] >= P.R) continue;
    for (let gy = 0; gy <= gyMax; gy++) if (fits(s, o.core, gx, gy, P.C)) return { gx, gy, ext: gx * c + o.w };
  }
  return null;
}

function placeOri(s, o, gx, gy, P) {
  const C = P.C, R = P.R, W = C + 1, d = o.d;
  for (let r = 0; r < o.dm.length; r++) {
    const row = gy - d + r; if (row < 0 || row >= R) continue;
    const rr = o.dm[r]; if (!rr.length) continue;
    for (let k = 0; k < rr.length; k += 2) {
      let a = gx - d + rr[k], b = gx - d + rr[k + 1];
      if (a < 0) a = 0; if (b > C - 1) b = C - 1;
      for (let x = a; x <= b; x++) { const idx = row * C + x; if (!s.occ[idx]) { s.occ[idx] = 1; s.colCnt[x]++; } }
    }
    let acc = 0; const base = row * W, ob = row * C; s.pre[base] = 0;
    for (let x = 0; x < C; x++) { acc += s.occ[ob + x]; s.pre[base + x + 1] = acc; }
  }
}

export function nestRun(P, order, J) {
  const R = P.R, C = P.C; const sheets = [], unplaced = [];
  const mk = () => ({ occ: new Uint8Array(R * C), pre: new Int32Array(R * (C + 1)), colCnt: new Int32Array(C), placed: [], ext: 0 });
  for (const pi of order) {
    const oris = P.parts[pi].oris;
    if (!oris.length) { unplaced.push(pi); continue; }
    let best = null;
    const tryS = (s) => {
      for (let oi = 0; oi < oris.length; oi++) {
        const p = findPos(s, oris[oi], P, J, best ? best.ext : Infinity);
        if (p && (!best || p.ext < best.ext - 1e-9)) best = { s, oi, gx: p.gx, gy: p.gy, ext: p.ext };
      }
    };
    for (const s of sheets) { tryS(s); if (best) break; }
    if (!best) {
      if (J.coil && sheets.length) { unplaced.push(pi); continue; }
      const s = mk(); tryS(s);
      if (!best) { unplaced.push(pi); continue; }
      sheets.push(s);
    }
    placeOri(best.s, oris[best.oi], best.gx, best.gy, P);
    best.s.placed.push([pi, best.oi, best.gx, best.gy]);
    if (best.ext > best.s.ext) best.s.ext = best.ext;
  }
  return { sheets, unplaced };
}

export function nestScore(res, J) {
  const n = res.sheets.length;
  if (J.coil) { let m = 0; for (const s of res.sheets) m = Math.max(m, s.ext); return [res.unplaced.length, m]; }
  return [res.unplaced.length, n, n ? res.sheets[n - 1].ext : 0];
}

function cmpArr(a, b) { for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; if (d > 1e-6) return 1; if (d < -1e-6) return -1; } return 0; }

function mutateOrder(o) {
  const a = o.slice(), n = a.length, R = (m) => Math.floor(Math.random() * m);
  const m = 1 + R(3);
  for (let t = 0; t < m; t++) {
    const i = R(n), j = R(n);
    if (Math.random() < 0.5) { const x = a[i]; a[i] = a[j]; a[j] = x; }
    else { const x = a.splice(i, 1)[0]; a.splice(j, 0, x); }
  }
  return a;
}

/** Řešič, který se dá pouštět po kouscích (step) – v workeru i v hlavním vlákně. */
export class NestSolver {
  constructor(J) {
    this.J = J; this.prep = nestPrepare(J);
    const items = []; J.parts.forEach((p, i) => { for (let c = 0; c < p.q; c++) items.push(i); });
    const keys = [
      (i) => -J.parts[i].area,
      (i) => -Math.max(J.parts[i].bw, J.parts[i].bh),
      (i) => -J.parts[i].bh,
      (i) => -J.parts[i].bw,
      (i) => -(J.parts[i].bw * J.parts[i].bh),
    ];
    this.queue = keys.map((f) => items.slice().sort((a, b) => (f(a) - f(b)) || (a - b)));
    this.best = null; this.tried = 0; this.t0 = Date.now(); this.done = false;
  }
  step(ms) {
    const t = Date.now(); let improved = false;
    while (Date.now() - t < ms) {
      let order;
      if (this.queue.length) order = this.queue.shift();
      else if (this.best && this.best.order.length > 1 && Date.now() - this.t0 < this.J.budget) order = mutateOrder(this.best.order);
      else { this.done = true; break; }
      const res = nestRun(this.prep, order, this.J); const sc = nestScore(res, this.J); this.tried++;
      if (!this.best || cmpArr(sc, this.best.sc) <= 0) {
        if (!this.best || cmpArr(sc, this.best.sc) < 0) improved = true;
        this.best = { order, res, sc };
      }
    }
    return { improved, done: this.done };
  }
  snapshot() {
    return {
      sheets: this.best.res.sheets.map((s) => ({ placed: s.placed, ext: s.ext })),
      unplaced: this.best.res.unplaced, sc: this.best.sc, tried: this.tried, cell: this.prep.cell,
      degs: this.prep.parts.map((p) => p.oris.map((o) => o.deg)),
    };
  }
}
