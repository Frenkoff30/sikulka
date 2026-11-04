// Přesné skládání OBDÉLNÍKŮ.
//  - "g" = tabulové nůžky: jen průběžné (gilotinové) střihy, vrací strom střihů → postup krok za krokem
//  - "f" = volný řez: MaxRects (díly se můžou zaklesnout)
// Prořez (kerf) se řeší zvětšením dílu i tabule o kerf.

export const EPS = 1e-6;

const tie = (a, b) => (a.pi - b.pi) || (a.id - b.id);
const SORTS = {
  area: (a, b) => (b.dx * b.dy - a.dx * a.dy) || (Math.max(b.dx, b.dy) - Math.max(a.dx, a.dy)) || tie(a, b),
  maxs: (a, b) => (Math.max(b.dx, b.dy) - Math.max(a.dx, a.dy)) || (Math.min(b.dx, b.dy) - Math.min(a.dx, a.dy)) || tie(a, b),
  mins: (a, b) => (Math.min(b.dx, b.dy) - Math.min(a.dx, a.dy)) || (Math.max(b.dx, b.dy) - Math.max(a.dx, a.dy)) || tie(a, b),
  len: (a, b) => (b.dx - a.dx) || (b.dy - a.dy) || tie(a, b),
  wid: (a, b) => (b.dy - a.dy) || (b.dx - a.dx) || tie(a, b),
  per: (a, b) => ((b.dx + b.dy) - (a.dx + a.dy)) || (b.dx * b.dy - a.dx * a.dy) || tie(a, b),
};
const FITS = ['baf', 'bssf', 'blsf', 'left', 'top'];
const SPLITS = ['slas', 'llas', 'sas', 'las', 'maxa', 'v', 'h'];

function fitScore(fit, F, DX, DY) {
  const rw = F.w - DX, rh = F.h - DY;
  switch (fit) {
    case 'baf': return (F.w * F.h - DX * DY) + Math.min(rw, rh) * 1e-3;
    case 'bssf': return Math.min(rw, rh) * 1e7 + Math.max(rw, rh);
    case 'blsf': return Math.max(rw, rh) * 1e7 + Math.min(rw, rh);
    case 'left': return (F.x + DX) * 1e9 + (F.y + DY) * 1e3 + Math.min(rw, rh) * 1e-3;
    default: return (F.y + DY) * 1e9 + (F.x + DX) * 1e3 + Math.min(rw, rh) * 1e-3;
  }
}

function findBest(sheets, it, k, fit) {
  let best = null;
  for (const s of sheets) {
    for (const F of s.free) {
      for (const r of it.orients) {
        const DX = (r ? it.dy : it.dx) + k, DY = (r ? it.dx : it.dy) + k;
        if (DX > F.w + EPS || DY > F.h + EPS) continue;
        const sc = fitScore(fit, F, DX, DY);
        if (!best || sc < best.sc) best = { s, F, r, DX, DY, sc };
      }
    }
    if (best) return best;
  }
  return null;
}

function runG(order, P, fit, split) {
  const k = P.kerf, W = P.X + k, H = P.Y + k;
  const sheets = [], unplaced = [];
  const newSheet = () => { const root = { x: 0, y: 0, w: W, h: H, kind: 'free' }; const s = { root, free: [root], placed: [] }; sheets.push(s); return s; };
  for (const it of order) {
    let b = findBest(sheets, it, k, fit);
    if (!b) {
      if (P.coil && sheets.length) { unplaced.push(it); continue; }
      const s = newSheet(); b = findBest([s], it, k, fit);
      if (!b) { sheets.pop(); unplaced.push(it); continue; }
    }
    placeG(b.s, b.F, b.DX, b.DY, b.r, it, split, k);
  }
  return { sheets, unplaced };
}

function placeG(s, F, DX, DY, r, it, split, k) {
  const rw = F.w - DX, rh = F.h - DY;
  s.free.splice(s.free.indexOf(F), 1);
  const free = (x, y, w, h) => { if (w > k + EPS && h > k + EPS) { const n = { x, y, w, h, kind: 'free' }; s.free.push(n); return n; } return null; };
  const piece = (x, y) => { const n = { x, y, w: DX, h: DY, kind: 'piece', it, r }; s.placed.push(n); return n; };
  const cut = (n, dir, a, b) => { n.kind = 'split'; n.dir = dir; n.a = a; n.b = b; };
  const hasW = rw > EPS, hasH = rh > EPS;
  if (hasW && hasH) {
    let v;
    switch (split) {
      case 'sas': v = F.w > F.h; break;
      case 'las': v = F.w <= F.h; break;
      case 'slas': v = rw > rh; break;
      case 'llas': v = rw <= rh; break;
      case 'maxa': v = Math.max(rw * F.h, DX * rh) >= Math.max(F.w * rh, rw * DY); break;
      case 'v': v = true; break;
      default: v = false;
    }
    if (v) {
      const A = { x: F.x, y: F.y, w: DX, h: F.h, kind: 'free' };
      const B = free(F.x + DX, F.y, rw, F.h); cut(F, 'v', A, B);
      const p = piece(F.x, F.y); const C = free(F.x, F.y + DY, DX, rh); cut(A, 'h', p, C);
    } else {
      const A = { x: F.x, y: F.y, w: F.w, h: DY, kind: 'free' };
      const B = free(F.x, F.y + DY, F.w, rh); cut(F, 'h', A, B);
      const p = piece(F.x, F.y); const C = free(F.x + DX, F.y, rw, DY); cut(A, 'v', p, C);
    }
  } else if (hasW) {
    const p = piece(F.x, F.y); const B = free(F.x + DX, F.y, rw, F.h); cut(F, 'v', p, B);
  } else if (hasH) {
    const p = piece(F.x, F.y); const B = free(F.x, F.y + DY, F.w, rh); cut(F, 'h', p, B);
  } else {
    F.kind = 'piece'; F.it = it; F.r = r; F.w = DX; F.h = DY; s.placed.push(F);
  }
}

function runM(order, P, fit) {
  const k = P.kerf, W = P.X + k, H = P.Y + k;
  const sheets = [], unplaced = [];
  const newSheet = () => { const s = { free: [{ x: 0, y: 0, w: W, h: H }], placed: [] }; sheets.push(s); return s; };
  for (const it of order) {
    let b = findBest(sheets, it, k, fit);
    if (!b) {
      if (P.coil && sheets.length) { unplaced.push(it); continue; }
      const s = newSheet(); b = findBest([s], it, k, fit);
      if (!b) { sheets.pop(); unplaced.push(it); continue; }
    }
    const n = { x: b.F.x, y: b.F.y, w: b.DX, h: b.DY, kind: 'piece', it, r: b.r };
    b.s.placed.push(n); splitFree(b.s, n, k);
  }
  return { sheets, unplaced };
}

function splitFree(s, n, k) {
  const out = [];
  for (const F of s.free) {
    if (n.x >= F.x + F.w - EPS || n.x + n.w <= F.x + EPS || n.y >= F.y + F.h - EPS || n.y + n.h <= F.y + EPS) { out.push(F); continue; }
    if (n.x > F.x + EPS) out.push({ x: F.x, y: F.y, w: n.x - F.x, h: F.h });
    if (n.x + n.w < F.x + F.w - EPS) out.push({ x: n.x + n.w, y: F.y, w: F.x + F.w - n.x - n.w, h: F.h });
    if (n.y > F.y + EPS) out.push({ x: F.x, y: F.y, w: F.w, h: n.y - F.y });
    if (n.y + n.h < F.y + F.h - EPS) out.push({ x: F.x, y: n.y + n.h, w: F.w, h: F.y + F.h - n.y - n.h });
  }
  const f = out.filter((r) => r.w > k + EPS && r.h > k + EPS);
  const res = [];
  for (let i = 0; i < f.length; i++) {
    const a = f[i]; let drop = false;
    for (let j = 0; j < f.length; j++) {
      if (i === j) continue; const b = f[j];
      if (a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS) {
        const eq = Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS && Math.abs(a.w - b.w) < EPS && Math.abs(a.h - b.h) < EPS;
        if (!eq || j < i) { drop = true; break; }
      }
    }
    if (!drop) res.push(a);
  }
  s.free = res;
}

export function runRect(cfg, P) { return P.cut === 'g' ? runG(cfg.order, P, cfg.fit, cfg.split) : runM(cfg.order, P, cfg.fit); }

export function evalRect(res, P) {
  const k = P.kerf;
  if (P.coil) { let mx = 0; for (const s of res.sheets) for (const p of s.placed) mx = Math.max(mx, p.x + p.w); return [res.unplaced.length, Math.max(0, mx - k)]; }
  const n = res.sheets.length; let used = 0;
  if (n) for (const p of res.sheets[n - 1].placed) used += p.w * p.h;
  let lf = 0; for (const s of res.sheets) for (const f of s.free) lf = Math.max(lf, (f.w - k) * (f.h - k));
  return [res.unplaced.length, n, used, -lf];
}

export function cmp(a, b) { for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; if (d > 1e-6) return 1; if (d < -1e-6) return -1; } return 0; }

export function buildConfigs(P) {
  const out = []; const splits = P.cut === 'g' ? SPLITS : [null];
  const fits = P.coil ? ['left', 'baf', 'bssf', 'blsf', 'top'] : FITS;
  for (const so of Object.keys(SORTS)) {
    const order = P.items.slice().sort(SORTS[so]);
    for (const f of fits) for (const sp of splits) out.push({ order, fit: f, split: sp });
  }
  return out;
}

export function mutate(b, P) {
  const o = b.order.slice(), n = o.length, R = (m) => Math.floor(Math.random() * m);
  const m = 1 + R(3);
  for (let t = 0; t < m; t++) {
    const i = R(n), j = R(n);
    if (Math.random() < 0.5) { const tmp = o[i]; o[i] = o[j]; o[j] = tmp; }
    else { const x = o.splice(i, 1)[0]; o.splice(j, 0, x); }
  }
  const fit = Math.random() < 0.2 ? FITS[R(FITS.length)] : b.fit;
  const split = P.cut === 'g' ? (Math.random() < 0.2 ? SPLITS[R(SPLITS.length)] : b.split) : null;
  return { order: o, fit, split };
}

/** Pro jednu odvinutou délku svitku zkusí přesné rozložení (pro čistý postup střihu). */
export function coilExact(best, P) {
  if (best._exact !== undefined) return best._exact;
  const L = best.sc[1]; const P2 = Object.assign({}, P, { coil: false, X: L });
  const res = runRect(best, P2);
  best._exact = (res.sheets.length === 1 && !res.unplaced.length) ? res : null;
  return best._exact;
}
