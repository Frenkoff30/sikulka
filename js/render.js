// Vykreslení výsledků: souhrn, výkresy tabulí (SVG), postup střihu, rozměření dílů.
import { fmt, m2, pct, plural, esc, $, U } from './format.js';
import { polyXform } from './nest-engine.js';
import { pathD, labelSpot } from './shapes.js';
import { EPS, coilExact } from './rect-engine.js';

let uid = 0;

/* ---------- společné ---------- */
export function updateStatus(running) {
  const el = $('status'); if (!el) return;
  el.className = 'status' + (running ? ' run' : '');
  el.hidden = !running;
  el.innerHTML = running ? '<i class="dot"></i>Hledám lepší rozložení…' : '';
}

export function renderWarns(P) {
  const out = [];
  if (P.errs?.length) out.push(`<div class="warn"><b>Chybí zadání.</b> ${P.errs.map(esc).join(' ')}</div>`);
  if (P.bad?.length) out.push(`<div class="warn"><b>Tyhle díly mají chybné rozměry:</b><ul>${P.bad.map((d) => `<li>${esc(d.name)}: ${esc(d.err)}</li>`).join('')}</ul></div>`);
  if (P.invalid?.length) {
    const what = P.coil ? 'svitek' : 'tabuli';
    out.push(`<div class="warn"><b>Tyhle díly se nevejdou na ${what}:</b><ul>${P.invalid.map((d) => `<li>${esc(d.name || d.shapeName)} <span class="mono">${esc(d.sum)}</span>${d.wouldRot ? ' – otočený by se vešel, zapni „může se otočit“' : ''}</li>`).join('')}</ul></div>`);
  }
  $('warns').innerHTML = out.join('');
}

export function renderEmpty(mode) {
  $('tools').hidden = true; $('sheets').innerHTML = '';
  $('summary').innerHTML = `<div class="empty"><svg viewBox="0 0 64 44" aria-hidden="true"><rect x="2" y="2" width="60" height="40" rx="2" class="em-s"/><path d="M22 2v40M22 22h40" class="em-c"/></svg><b>Zatím není co skládat</b><span>Zadej ${mode === 'coil' ? 'svitek' : 'tabuli'} a přidej díly – plán se spočítá sám.</span><div class="btnrow"><button type="button" class="btn primary" id="emptyAdd"><svg viewBox="0 0 20 20" aria-hidden="true"><path class="ico" d="M10 4v12M4 10h12"/></svg>Přidat díl</button><button type="button" class="btn ghost" id="loadEx">Načíst ukázku</button></div></div>`;
}

function summaryHTML(o) {
  const tile = (k, v, s = '', cls = '') => `<div class="kpi ${cls}"><span class="k">${k}</span><span class="v">${v}</span>${s}</div>`;
  const main = o.coil
    ? tile('Odvinout ze svitku', `${(o.len / 1000).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<small>m</small>`, `<span class="s">šíře ${fmt(o.Y)} ${U()}</span>`, 'main')
    : tile('Potřebuješ', `${o.n}<small>${plural(o.n, 'tabuli', 'tabule', 'tabulí')}</small>`, `<span class="s">${fmt(o.Y)} × ${fmt(o.X)} ${U()}</span>`, 'main');
  const left = Math.max(0, o.total - o.pieceArea);
  let tiles = main
    + tile('Využití', pct(o.util), `<span class="meter"><i style="width:${Math.min(100, o.util * 100).toFixed(1)}%"></i></span>`)
    + tile('Zbyde plechu', `${m2(left)}<small>m²</small>`, `<span class="s">z ${m2(o.total)} m² plechu</span>`, 'left');
  if (o.miss) tiles += tile(o.missLabel || 'Nevešlo se', String(o.miss), `<span class="s">${plural(o.miss, 'díl', 'díly', 'dílů')}</span>`, 'bad');
  return `<div class="sumbox"><div class="kpis">${tiles}</div><div class="status" id="status" hidden></div></div>`;
}

function hatch(M) {
  const id = 'h' + (++uid), ps = M / 90;
  return { id, defs: `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="${ps}" height="${ps}" patternTransform="rotate(45)"><rect width="${ps}" height="${ps}" class="sv-wbg"/><line x1="0" y1="0" x2="0" y2="${ps}" class="sv-wln" stroke-width="${ps * 0.4}"/></pattern></defs>` };
}

function fitText(lines, cx, cy, aw, ah, maxF, minF, cls, firstCls, fallback) {
  const calc = (ls) => {
    const cl = Math.max(...ls.map((s) => s.length));
    const f1 = Math.min(maxF, aw * 0.88 / (cl * 0.6), ah * 0.8 / (ls.length * 1.28));
    const f2 = Math.min(maxF, ah * 0.88 / (cl * 0.6), aw * 0.8 / (ls.length * 1.28));
    return f2 > f1 * 1.2 ? { f: f2, rot: true } : { f: f1, rot: false };
  };
  let ls = lines, c = calc(ls);
  if (fallback && ls.length > 1) {
    // když by celý popisek byl drobný, ukaž radši jen velké číslo dílu
    const cf = calc(fallback);
    if (c.f < minF || (c.f < maxF * 0.6 && cf.f > c.f * 1.5)) { ls = fallback; c = cf; }
  } else if (c.f < minF && ls.length > 1) { ls = [ls[ls.length - 1]]; c = calc(ls); firstCls = null; }
  if (c.f < minF) return '';
  const spans = ls.map((t, i) => `<tspan x="${cx}" y="${cy + (i - (ls.length - 1) / 2) * c.f * 1.28}"${i === 0 && firstCls ? ` class="${firstCls}"` : ''}>${esc(t)}</tspan>`).join('');
  return `<text class="${cls}" font-size="${c.f}" text-anchor="middle" dominant-baseline="central"${c.rot ? ` transform="rotate(-90 ${cx} ${cy})"` : ''}>${spans}</text>`;
}

function frame(X, Y, coil, fs, pad) {
  const ty = -pad * 0.5, tx = -pad * 0.5;
  return `<rect x="0" y="0" width="${X}" height="${Y}" class="sv-edge" vector-effect="non-scaling-stroke"/>`
    + `<line x1="0" y1="${-pad * 0.2}" x2="${X}" y2="${-pad * 0.2}" class="sv-dl" vector-effect="non-scaling-stroke"/>`
    + `<text x="${X / 2}" y="${ty}" class="sv-dim" font-size="${fs}" text-anchor="middle">${coil ? 'délka ' : ''}${fmt(X)} ${U()}</text>`
    + `<line x1="${-pad * 0.2}" y1="0" x2="${-pad * 0.2}" y2="${Y}" class="sv-dl" vector-effect="non-scaling-stroke"/>`
    + `<text x="${tx}" y="${Y / 2}" class="sv-dim" font-size="${fs}" text-anchor="middle" transform="rotate(-90 ${tx} ${Y / 2})">${fmt(Y)} ${U()}</text>`;
}
function svgWrap(X, Y, pad, inner) {
  const vbW = X + pad * 1.25, vbH = Y + pad * 1.25, aspect = vbW / vbH;
  const style = aspect > 5 ? ` style="min-width:${Math.round(aspect * 90)}px"` : '';
  return `<svg viewBox="${-pad} ${-pad} ${vbW} ${vbH}" role="img" aria-label="Výkres rozložení dílů na plechu"${style}>${inner}</svg>`;
}
function groupSheets(sheets, sig) {
  const groups = [];
  sheets.forEach((s, i) => { const g = sig(s); const last = groups[groups.length - 1]; if (last && last.sig === g) last.n++; else groups.push({ sig: g, s, from: i + 1, n: 1 }); });
  return groups;
}
function cardHead(g, P, meta, running) {
  const title = P.coil ? 'Svitek' : (g.n > 1 ? `Tabule ${g.from}–${g.from + g.n - 1}` : `Tabule ${g.from}`);
  const btn = running ? '' : `<button type="button" class="btn ghost sm" data-manual="${g.from - 1}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5v15M2.5 10h15M10 2.5l-2.2 2.2M10 2.5l2.2 2.2M10 17.5l-2.2-2.2M10 17.5l2.2-2.2M2.5 10l2.2-2.2M2.5 10l2.2 2.2M17.5 10l-2.2-2.2M17.5 10l-2.2 2.2" class="ico"/></svg><span>Upravit</span></button>`;
  const tags = meta.split(' · ').map((t, i) => `<span class="tag${i === 1 ? ' left' : ''}">${t}</span>`).join('');
  return `<div class="sh-head"><h3>${title}</h3>${g.n > 1 ? `<span class="tag strong">${g.n}× stejně</span>` : ''}${tags}${btn}</div>`;
}
const pc = (ci) => `<span class="pc" style="background:var(--p${ci % 8})"></span>`;

/* ---------- OBDÉLNÍKY (přesně, s postupem střihu) ---------- */
export function renderRect(best, P, running, opts) {
  const k = P.kerf;
  let res = best.res, X = P.X, exact = false;
  if (P.coil) { const ex = running ? null : coilExact(best, P); if (ex) { res = ex; exact = true; } X = best.sc[1]; }
  let pieceArea = 0, count = 0;
  for (const s of res.sheets) for (const p of s.placed) { pieceArea += (p.w - k) * (p.h - k); count++; }
  const nS = res.sheets.length, total = P.coil ? X * P.Y : nS * X * P.Y;
  $('summary').innerHTML = summaryHTML({ coil: P.coil, n: nS, X: P.X, Y: P.Y, len: X, util: total ? pieceArea / total : 0, total, pieceArea, count, miss: res.unplaced.length });
  updateStatus(running);
  showTools(P.cut === 'g');
  const sig = (s) => s.placed.map((p) => `${p.it.pi}:${Math.round(p.x)},${Math.round(p.y)},${p.r}`).sort().join('|');
  $('sheets').innerHTML = groupSheets(res.sheets, sig).map((g) => rectCard(g, P, X, exact, opts)).join('');
}

function rectCard(g, P, X, exact, opts) {
  const k = P.kerf, s = g.s;
  let pa = 0; for (const p of s.placed) pa += (p.w - k) * (p.h - k);
  const steps = (P.cut === 'g' && s.root) ? collectSteps(s.root) : [];
  const nums = new Map(); steps.forEach((n, i) => nums.set(n, i + 1));
  const svg = rectSVG(s, P, X, nums, P.cut === 'g' && opts.showCuts);
  let cuts;
  if (P.cut === 'g') {
    const items = [];
    if (P.coil && exact) items.push(`<li>Odviň a ustřihni ze svitku <span class="mono">${fmt(X)} ${U()}</span>.</li>`);
    steps.forEach((n) => items.push(`<li>${stepText(n, P, X)}</li>`));
    cuts = items.length ? `<details class="cuts"><summary>Postup střihu <span class="cnt">${items.length}</span></summary><ol>${items.join('')}</ol></details>` : '';
  } else cuts = '';
  const meta = `${pct(pa / (X * P.Y))} využito · zbyde ${m2(Math.max(0, X * P.Y - pa))} m²`;
  return `<article class="sheet">${cardHead(g, P, meta, false)}<div class="svgbox">${svg}</div>${cuts}</article>`;
}
/** Největší použitelné zbytky obdélníkového rozložení (aspoň MIN_OFF × MIN_OFF, nejvýš MAX_OFF kusů). */
function offcuts(s, P, X) {
  const k = P.kerf, out = [];
  for (const f of s.free) { const w = Math.min(f.x + f.w - k, X) - f.x, h = f.h - k; if (w >= MIN_OFF && h >= MIN_OFF) out.push({ x: f.x, y: f.y, w, h }); }
  return out.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, MAX_OFF);
}
function collectSteps(root) { const out = []; (function w(n) { if (!n || n.kind !== 'split') return; out.push(n); w(n.a); w(n.b); })(root); return out; }
function realDims(n, P, X) { const k = P.kerf; return { rx: Math.min(n.x + n.w - k, X) - n.x, ry: n.h - k }; }
function partLabel(n, P, X) {
  if (!n) return 'odřezek do odpadu';
  if (n.kind === 'piece') { const d = P.byPi[n.it.pi]; return `${pc(d.ci)}<b>${esc(d.name || 'díl')}</b> <span class="mono">${fmt(d.w)} × ${fmt(d.l)}</span>`; }
  if (P.coil && n.x + n.w >= P.X + P.kerf - EPS) return 'zbytek svitku';
  const { rx, ry } = realDims(n, P, X);
  return `${n.kind === 'free' ? 'zbytek' : 'kus'} <span class="mono">${fmt(ry)} × ${fmt(rx)}</span>`;
}
function stepText(n, P, X) {
  const k = P.kerf; const { rx, ry } = realDims(n, P, X);
  const from = (P.coil && n.x + n.w >= P.X + k - EPS) ? 'Ze svitku' : `Kus <span class="mono">${fmt(ry)} × ${fmt(rx)}</span>`;
  const off = n.dir === 'v' ? n.a.w - k : n.a.h - k;
  return `${from}: střih ${n.dir === 'v' ? 'napříč' : 'podélně'} na <span class="mono">${fmt(off)} ${U()}</span> → ${partLabel(n.a, P, X)} a ${partLabel(n.b, P, X)}`;
}
function rectSVG(s, P, X, nums, showCuts) {
  const k = P.kerf, Y = P.Y, M = Math.max(X, Y), fs = M / 42, pad = fs * 2.3, minF = M / 150;
  const o = [`<rect x="0" y="0" width="${X}" height="${Y}" class="sv-steel"/>`];
  for (const r of offcuts(s, P, X)) {
    o.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" class="sv-off" vector-effect="non-scaling-stroke"/>`);
    o.push(fitText(['ZBYTEK', `${m2(r.w * r.h)} m²`], r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, fs * 0.7, minF, 'sv-to', 'sv-ton'));
  }
  if (false) {
    let big = null;
    for (const f of s.free) { const rw = Math.min(f.x + f.w - k, X) - f.x, rh = f.h - k; if (rw > 0 && rh > 0 && (!big || rw * rh > big.a)) big = { f, rw, rh, a: rw * rh }; }
    if (big && big.rw >= 80 && big.rh >= 80) {
      o.push(`<rect x="${big.f.x}" y="${big.f.y}" width="${big.rw}" height="${big.rh}" class="sv-off" vector-effect="non-scaling-stroke"/>`);
      o.push(fitText(['ZBYTEK', `${m2(big.rw * big.rh)} m²`], big.f.x + big.rw / 2, big.f.y + big.rh / 2, big.rw, big.rh, fs * 0.75, minF, 'sv-to', 'sv-ton'));
    }
  }
  for (const p of s.placed) {
    const pw = p.w - k, ph = p.h - k, d = P.byPi[p.it.pi];
    o.push(`<rect x="${p.x}" y="${p.y}" width="${pw}" height="${ph}" class="sv-piece" style="fill:var(--p${d.ci})" vector-effect="non-scaling-stroke"/>`);
    const dims = `${fmt(d.w)}×${fmt(d.l)}${p.r ? ' ↻' : ''}`;
    o.push(fitText(d.name ? [d.name, dims] : [dims], p.x + pw / 2, p.y + ph / 2, pw, ph, fs * 0.8, minF, 'sv-t', d.name ? 'sv-tn' : null));
  }
  if (showCuts && nums.size) {
    const lines = [], badges = [], r = fs * 0.62;
    nums.forEach((num, n) => {
      const x0 = n.x, x1 = Math.min(n.x + n.w - k, X), y0 = n.y, y1 = n.y + n.h - k;
      let cx, cy;
      if (n.dir === 'v') { const x = n.x + n.a.w - k / 2; lines.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" class="sv-cut" vector-effect="non-scaling-stroke"/>`); cx = x; cy = (y0 + y1) / 2; }
      else { const y = n.y + n.a.h - k / 2; lines.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" class="sv-cut" vector-effect="non-scaling-stroke"/>`); cx = (x0 + x1) / 2; cy = y; }
      badges.push(`<circle cx="${cx}" cy="${cy}" r="${r}" class="sv-bd"/><text x="${cx}" y="${cy}" class="sv-bt" font-size="${r * 1.15}" text-anchor="middle" dominant-baseline="central">${num}</text>`);
    });
    o.push(lines.join(''), badges.join(''));
  }
  o.push(frame(X, Y, P.coil, fs * 0.8, pad));
  return svgWrap(X, Y, pad, o.join(''));
}

/* ---------- TVARY (nesting) ---------- */
function xf(P, i, deg) {
  P._xf = P._xf || new Map();
  const key = i + '|' + deg;
  let v = P._xf.get(key);
  if (!v) { const t = polyXform(P.J.parts[i].poly, deg); v = { t, spot: labelSpot(t) }; P._xf.set(key, v); }
  return v;
}

/** Výsledek skládání tvarů z workeru → jednotné rozložení {sheets:[[{i,deg,x,y}]], ...} */
export function layoutFromSnap(snap) {
  return {
    sheets: snap.sheets.map((s) => s.placed.map(([i, oi, gx, gy]) => ({ i, deg: snap.degs[i][oi], x: gx * snap.cell, y: gy * snap.cell }))),
    unplaced: snap.unplaced.slice(), tried: snap.tried, cell: snap.cell,
  };
}
/** Výsledek přesného obdélníkového skládání → jednotné rozložení (pro ruční úpravy). */
export function layoutFromRect(best, P) {
  const res = (P.coil && coilExact(best, P)) || best.res;
  const idx = new Map(P.J.parts.map((p, i) => [p.pi, i]));
  return {
    sheets: res.sheets.map((s) => s.placed.map((p) => ({ i: idx.get(p.it.pi), deg: p.r ? 90 : 0, x: p.x, y: p.y }))),
    unplaced: res.unplaced.map((it) => idx.get(it.pi)), tried: best.tried, cell: 0,
  };
}
export const shapeOf = (P, i, deg) => xf(P, i, deg);

export function renderLayout(L, P, running) {
  const J = P.J;
  const exts = L.sheets.map((s) => s.reduce((m, p) => Math.max(m, p.x + xf(P, p.i, p.deg).t.w), 0));
  let X = J.X;
  if (P.coil) X = Math.max(1, ...exts);
  let pieceArea = 0, count = 0;
  for (const s of L.sheets) for (const p of s) { pieceArea += J.parts[p.i].area; count++; }
  const nS = L.sheets.length, total = P.coil ? X * P.Y : nS * X * P.Y;
  const sig = (s) => s.map((p) => `${p.i},${p.deg},${Math.round(p.x)},${Math.round(p.y)}`).sort().join('|');
  const sheets = L.sheets.map((s, k) => ({ placed: s, ext: exts[k] }));
  const groups = groupSheets(sheets, (s) => sig(s.placed));
  // volný plech mezi díly a za nimi → použitelné zbytky
  for (const g of groups) g.free = freeRects(g.s.placed, P, X);
  $('summary').innerHTML = summaryHTML({ coil: P.coil, n: nS, X: P.X, Y: P.Y, len: X, util: total ? pieceArea / total : 0, total, pieceArea, count, miss: L.unplaced.length, missLabel: L.manual ? 'V zásobníku' : '' });
  if (L.manual) { const el = $('status'); el.hidden = false; el.className = 'status man-on'; el.innerHTML = `<i class="dot"></i>Ručně poskládáno · <button type="button" class="link" id="backAuto">spočítat znovu</button>`; }
  else updateStatus(running);
  showTools(false);
  $('sheets').innerHTML = groups.map((g) => nestCard(g, P, X, running)).join('');
}

/** Najde na plechu největší volné obdélníky (mezi díly i za nimi), které se dají ještě použít.
    Plech se převede na mřížku, buňky zasažené dílem jsou plné, a hledá se největší prázdný obdélník. */
const MIN_OFF = 200, MAX_OFF = 3; // vyznačí se jen pár velkých zbytků (aspoň 200 × 200 mm)
function freeRects(placed, P, X) {
  let pieceArea = 0; for (const p of placed) pieceArea += P.J.parts[p.i].area;
  const Y = P.Y, c = Math.max(4, Math.max(X, Y) / 320);
  const cols = Math.ceil(X / c - 1e-9), rows = Math.ceil(Y / c - 1e-9);
  const g = new Uint8Array(cols * rows);
  const mark = (x, y) => { const i = Math.floor(x / c), j = Math.floor(y / c); if (i >= 0 && j >= 0 && i < cols && j < rows) g[j * cols + i] = 1; };
  for (const p of placed) {
    const { t } = xf(P, p.i, p.deg);
    const rings = [t.o].concat(t.holes).map((r) => r.map((q) => [q[0] + p.x, q[1] + p.y]));
    // obrys dílu
    for (const r of rings) for (let k = 0; k < r.length; k++) {
      const a = r[k], b = r[(k + 1) % r.length], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (c * 0.3)) + 1;
      for (let m = 0; m <= n; m++) mark(a[0] + (b[0] - a[0]) * m / n, a[1] + (b[1] - a[1]) * m / n);
    }
    // vnitřek dílu (díry zůstanou volné)
    const j0 = Math.max(0, Math.floor(p.y / c)), j1 = Math.min(rows - 1, Math.floor((p.y + t.hh) / c));
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5) * c, xs = [];
      for (const r of rings) for (let k = 0; k < r.length; k++) {
        const a = r[k], b = r[(k + 1) % r.length];
        if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.floor(xs[k] / c)), i1 = Math.min(cols - 1, Math.floor(xs[k + 1] / c));
        for (let i = i0; i <= i1; i++) g[j * cols + i] = 1;
      }
    }
  }
  // největší prázdný obdélník (histogram po řádcích), pak další – nejvýš MAX_OFF kusů
  const minC = Math.ceil(MIN_OFF / c), out = [], h = new Int32Array(cols), st = new Int32Array(cols + 1);
  for (let round = 0; round < MAX_OFF; round++) {
    let best = null;
    h.fill(0);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) h[i] = g[j * cols + i] ? 0 : h[i] + 1;
      let sp = 0;
      for (let i = 0; i <= cols; i++) {
        const hi = i < cols ? h[i] : 0;
        while (sp && h[st[sp - 1]] >= hi) {
          const hh = h[st[--sp]], left = sp ? st[sp - 1] + 1 : 0, w = i - left;
          if (hh >= minC && w >= minC && (!best || hh * w > best.a)) best = { a: hh * w, i: left, j: j - hh + 1, w, h: hh };
        }
        st[sp++] = i;
      }
    }
    if (!best) break;
    for (let j = best.j; j < best.j + best.h; j++) g.fill(1, j * cols + best.i, j * cols + best.i + best.w);
    const x = best.i * c, y = best.j * c;
    out.push({ x, y, w: Math.floor(Math.min(X, x + best.w * c) - x), h: Math.floor(Math.min(Y, y + best.h * c) - y) });
  }
  out.blobs = leftoverBlobs(g, cols, rows, c, X * Y - pieceArea - out.reduce((a, r) => a + r.w * r.h, 0));
  return out;
}

/** Zbylý šedý plech rozdělený na souvislé oblasti – každá dostane svou plochu a místo pro popisek.
    Plocha se dopočítá přesně: součet všech oblastí + vyznačené zbytky = plech − díly. */
function leftoverBlobs(g, cols, rows, c, exactLeft) {
  const N = cols * rows, lab = new Int32Array(N).fill(-1), dist = new Float32Array(N);
  // vzdálenost od nejbližšího dílu / okraje (dvouprůchodová)
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i;
    if (g[k]) { dist[k] = 0; continue; }
    const up = j ? dist[k - cols] : 0, lf = i ? dist[k - 1] : 0;
    dist[k] = Math.min(up, lf) + 1;
  }
  for (let j = rows - 1; j >= 0; j--) for (let i = cols - 1; i >= 0; i--) {
    const k = j * cols + i; if (g[k]) continue;
    const dn = j < rows - 1 ? dist[k + cols] : 0, rt = i < cols - 1 ? dist[k + 1] : 0;
    dist[k] = Math.min(dist[k], Math.min(dn, rt) + 1);
  }
  const blobs = [], stack = [];
  let total = 0;
  for (let k0 = 0; k0 < N; k0++) {
    if (g[k0] || lab[k0] >= 0) continue;
    const id = blobs.length; let n = 0, best = k0;
    lab[k0] = id; stack.push(k0);
    while (stack.length) {
      const k = stack.pop(); n++;
      if (dist[k] > dist[best]) best = k;
      const i = k % cols, j = (k - i) / cols;
      if (i > 0 && !g[k - 1] && lab[k - 1] < 0) { lab[k - 1] = id; stack.push(k - 1); }
      if (i < cols - 1 && !g[k + 1] && lab[k + 1] < 0) { lab[k + 1] = id; stack.push(k + 1); }
      if (j > 0 && !g[k - cols] && lab[k - cols] < 0) { lab[k - cols] = id; stack.push(k - cols); }
      if (j < rows - 1 && !g[k + cols] && lab[k + cols] < 0) { lab[k + cols] = id; stack.push(k + cols); }
    }
    total += n;
    const bi = best % cols, bj = (best - bi) / cols, r = dist[best] * c;
    blobs.push({ n, x: (bi + 0.5) * c, y: (bj + 0.5) * c, aw: r * 2, ah: r * 2 });
  }
  for (const b of blobs) b.area = total ? Math.max(0, exactLeft) * b.n / total : 0;
  return blobs;
}

function nestCard(g, P, X, running) {
  const s = g.s, J = P.J, Y = P.Y;
  const M = Math.max(X, Y), fs = M / 42, pad = fs * 2.3, minF = M / 150;
  const o = [`<rect x="0" y="0" width="${X}" height="${Y}" class="sv-steel"/>`];
  let pa = 0;
  for (const r of g.free || []) {
    o.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" class="sv-off" vector-effect="non-scaling-stroke"/>`);
    o.push(fitText(['ZBYTEK', `${m2(r.w * r.h)} m²`], r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, fs * 0.75, minF, 'sv-to', 'sv-ton'));
  }
  // plocha šedého plechu mezi díly – u každé oblasti zvlášť
  for (const b of g.free?.blobs || []) if (b.area >= 0.005e6) o.push(fitText([`${m2(b.area)} m²`], b.x, b.y, b.aw * 1.3, b.ah, fs * 0.6, minF * 1.1, 'sv-to sv-ta'));
  // díly seřazené zleva doprava – stejné číslo ve výkresu i v tabulce
  const pos = s.placed.map((p) => ({ ...p, ox: p.x, oy: p.y })).sort((a, b) => a.ox - b.ox || a.oy - b.oy);
  const labels = [];
  pos.forEach((p, k) => {
    const { t, spot } = xf(P, p.i, p.deg);
    const info = P.byPi[J.parts[p.i].pi]; pa += J.parts[p.i].area; p.info = info;
    o.push(`<path d="${pathD([t.o].concat(t.holes), p.ox, p.oy)}" fill-rule="evenodd" class="sv-piece" style="fill:var(--p${info.ci})" vector-effect="non-scaling-stroke"/>`);
    labels.push(fitText([`${k + 1}. ${info.name || info.shapeName}`, info.sum], p.ox + spot.x, p.oy + spot.y, spot.aw, spot.ah, fs * 0.8, minF, 'sv-t', 'sv-tn', [String(k + 1)]));
  });
  o.push(labels.join(''));
  o.push(frame(X, Y, P.coil, fs * 0.8, pad));
  const rows = pos.map((p, k) => `<tr><td class="n">${k + 1}</td><td class="d">${pc(p.info.ci)}<b>${esc(p.info.name || p.info.shapeName)}</b><span class="mono">${esc(p.info.sum)}</span></td><td class="mm">${fmt(p.ox)}</td><td class="mm">${fmt(p.oy)}</td><td class="r">${p.deg ? `o ${p.deg}°` : 'ne'}</td></tr>`).join('');
  const meta = `${pct(pa / (X * Y))} využito · zbyde ${m2(Math.max(0, X * Y - pa))} m²`;
  return `<article class="sheet">${cardHead(g, P, meta, running)}<div class="svgbox">${svgWrap(X, Y, pad, o.join(''))}</div>`
    + `<details class="cuts"><summary>Pozice dílů na plechu <span class="cnt">${s.placed.length}</span></summary><div class="tabwrap"><table class="postab"><thead><tr><th>#</th><th>Díl</th><th class="mm" title="Vzdálenost od levé hrany plechu k dílu">Od levé hrany (${U()})</th><th class="mm" title="Vzdálenost od horní hrany plechu k dílu">Od horní hrany (${U()})</th><th class="r" title="O kolik je díl na plechu otočený proti tomu, jak jsi ho zadal">Otočený</th></tr></thead><tbody>${rows}</tbody></table></div></details></article>`;
}

function showTools(cuts) {
  $('tools').hidden = false;
  $('lgCut').hidden = !cuts;
  $('cutsToggle').hidden = !cuts;
}
