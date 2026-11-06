// Ruční skládání: díly se dají na plechu chytit, posunout, otočit, odložit do zásobníku a zase vrátit.
// Kontrola překryvu je přesná (podle obrysů), díl se přichytává ke krajům plechu a k sousedním dílům.
import { $, fmt, esc, U } from './format.js';
import { pathD, inside, ringArea } from './shapes.js';
import { shapeOf } from './render.js';

let M = null;

/* ---------- geometrie pro kontrolu překryvu ---------- */
function geo(i, deg) {
  const key = i + '|' + deg;
  let g = M.geo.get(key);
  if (g) return g;
  const { t, spot } = shapeOf(M.P, i, deg);
  const rings = [t.o].concat(t.holes);
  const edges = [];
  for (const r of rings) for (let k = 0; k < r.length; k++) { const a = r[k], b = r[(k + 1) % r.length]; edges.push([a[0], a[1], b[0], b[1]]); }
  // kontrolní body těsně uvnitř obrysu (rohy a středy hran) + vnitřní bod
  const o = t.o, sg = Math.sign(ringArea(o)) || 1, eps = Math.max(t.w, t.hh) * 1e-4 + 0.02, smp = [[spot.px ?? spot.x, spot.py ?? spot.y]];
  const n = o.length, step = Math.max(1, Math.floor(n / 64));
  for (let k = 0; k < n; k += step) {
    const a = o[k], b = o[(k + 1) % n], c = o[(k - 1 + n) % n];
    const nrm = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1; return [-dy / L * sg, dx / L * sg]; };
    const n1 = nrm(a, b), n0 = nrm(c, a);
    smp.push([(a[0] + b[0]) / 2 + n1[0] * eps, (a[1] + b[1]) / 2 + n1[1] * eps]);
    smp.push([a[0] + (n0[0] + n1[0]) * eps, a[1] + (n0[1] + n1[1]) * eps]);
  }
  g = { t, rings, edges, smp: smp.filter((p) => inside(rings, p[0], p[1])) };
  M.geo.set(key, g);
  return g;
}
const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
function cross(e, f, dx, dy) {
  const a1 = orient(e[0], e[1], e[2], e[3], f[0] + dx, f[1] + dy), a2 = orient(e[0], e[1], e[2], e[3], f[2] + dx, f[3] + dy);
  if (a1 * a2 >= -1e-9) return false;
  const b1 = orient(f[0] + dx, f[1] + dy, f[2] + dx, f[3] + dy, e[0], e[1]), b2 = orient(f[0] + dx, f[1] + dy, f[2] + dx, f[3] + dy, e[2], e[3]);
  return b1 * b2 < -1e-9;
}
function overlaps(p, q) {
  const A = geo(p.i, p.deg), B = geo(q.i, q.deg);
  if (p.x + A.t.w <= q.x + 0.01 || q.x + B.t.w <= p.x + 0.01 || p.y + A.t.hh <= q.y + 0.01 || q.y + B.t.hh <= p.y + 0.01) return false;
  const dx = q.x - p.x, dy = q.y - p.y; // B v souřadnicích A
  for (const e of A.edges) {
    const ex0 = Math.min(e[0], e[2]), ex1 = Math.max(e[0], e[2]), ey0 = Math.min(e[1], e[3]), ey1 = Math.max(e[1], e[3]);
    if (ex1 < dx || ex0 > dx + B.t.w || ey1 < dy || ey0 > dy + B.t.hh) continue;
    for (const f of B.edges) if (cross(e, f, dx, dy)) return true;
  }
  for (const s of B.smp) if (inside(A.rings, s[0] + dx, s[1] + dy)) return true;
  for (const s of A.smp) if (inside(B.rings, s[0] - dx, s[1] - dy)) return true;
  return false;
}
function problemOf(sheet, idx) {
  const p = sheet[idx], g = geo(p.i, p.deg);
  if (p.x < -0.01 || p.y < -0.01 || p.x + g.t.w > M.X + 0.01 || p.y + g.t.hh > M.P.Y + 0.01) return 'out';
  for (let k = 0; k < sheet.length; k++) if (k !== idx && overlaps(p, sheet[k])) return 'hit';
  return null;
}

/* ---------- otevření / zavření ---------- */
export function openManual(P, layout, si, onDone) {
  const used = Math.max(1, ...layout.sheets.flat().map((p) => p.x + shapeOf(P, p.i, p.deg).t.w));
  M = {
    P, onDone, si: Math.min(si, layout.sheets.length - 1), sel: -1, drag: null, geo: new Map(),
    X: P.coil ? Math.max(used * 1.35, used + 600) : P.J.X,
    sheets: layout.sheets.map((s) => s.map((p) => ({ ...p }))),
    tray: layout.unplaced.slice(),
  };
  if (!M.sheets.length) M.sheets.push([]);
  $('man').hidden = false; document.body.classList.add('noscroll');
  bindOnce();
  draw(); msg('Táhni díly prstem nebo myší. Ťuknutím díl vybereš.');
}
function close(save) {
  if (save) {
    for (const s of M.sheets) for (let k = 0; k < s.length; k++) if (problemOf(s, k)) { msg('Nejdřív oprav červené díly (posuň je, nebo je dej do zásobníku).', true); return; }
    const sheets = M.sheets.filter((s) => s.length);
    M.onDone({ sheets, unplaced: M.tray.slice() });
  }
  $('man').hidden = true; document.body.classList.remove('noscroll');
}

let bound = false;
function bindOnce() {
  if (bound) return; bound = true;
  $('mDone').addEventListener('click', () => close(true));
  $('mCancel').addEventListener('click', () => close(false));
  $('mPrev').addEventListener('click', () => { if (M.si > 0) { M.si--; M.sel = -1; draw(); } });
  $('mNext').addEventListener('click', () => {
    if (M.si < M.sheets.length - 1) M.si++;
    else if (!M.P.coil) { M.sheets.push([]); M.si++; msg('Přidána prázdná tabule.'); }
    M.sel = -1; draw();
  });
  $('mRot').addEventListener('click', rotateSel);
  $('mOut').addEventListener('click', () => {
    const s = M.sheets[M.si]; if (M.sel < 0) return msg('Nejdřív ťukni na díl.');
    M.tray.push(s[M.sel].i); s.splice(M.sel, 1); M.sel = -1; draw();
  });
  $('mTray').addEventListener('click', (e) => { const b = e.target.closest('[data-tray]'); if (b) fromTray(+b.dataset.tray); });
  const svg = $('mSvg');
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);
  $('man').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close(false);
    if ((e.key === 'r' || e.key === 'R') && M.sel >= 0) rotateSel();
    if ((e.key === 'Delete' || e.key === 'Backspace') && M.sel >= 0) $('mOut').click();
  });
}

function msg(t, bad) { const el = $('mMsg'); el.textContent = t; el.classList.toggle('bad', !!bad); }

/* ---------- kreslení ---------- */
function draw() {
  const P = M.P, X = M.X, Y = P.Y, s = M.sheets[M.si];
  const Mx = Math.max(X, Y), fs = Mx / 42, pad = fs * 1.6;
  $('mTitle').textContent = P.coil ? 'Svitek' : `Tabule ${M.si + 1} z ${M.sheets.length}`;
  $('mPrev').disabled = M.si === 0;
  $('mNext').textContent = M.si < M.sheets.length - 1 ? '›' : '+';
  $('mNext').setAttribute('aria-label', M.si < M.sheets.length - 1 ? 'Další tabule' : 'Přidat tabuli');
  $('mNext').hidden = P.coil;
  $('mPrev').hidden = P.coil;
  const o = [`<rect x="0" y="0" width="${X}" height="${Y}" class="m-sheet" vector-effect="non-scaling-stroke"/>`];
  const gs = Mx > 2000 ? 500 : 100;
  for (let x = gs; x < X; x += gs) o.push(`<line x1="${x}" y1="0" x2="${x}" y2="${Y}" class="m-grid"/>`);
  for (let y = gs; y < Y; y += gs) o.push(`<line x1="0" y1="${y}" x2="${X}" y2="${y}" class="m-grid"/>`);
  s.forEach((p, k) => o.push(pieceG(p, k, problemOf(s, k))));
  o.push(`<text x="${X / 2}" y="${-pad * 0.35}" class="sv-dim" font-size="${fs}" text-anchor="middle">${fmt(X)} ${U()}</text>`);
  $('mSvg').setAttribute('viewBox', `${-pad} ${-pad} ${X + pad * 2} ${Y + pad * 2}`);
  $('mSvg').innerHTML = o.join('');
  $('mRot').disabled = $('mOut').disabled = M.sel < 0;
  const counts = new Map(); for (const i of M.tray) counts.set(i, (counts.get(i) || 0) + 1);
  $('mTray').innerHTML = counts.size ? [...counts].map(([i, n]) => {
    const info = P.byPi[P.J.parts[i].pi];
    return `<button type="button" class="tray-it" data-tray="${i}"><span class="pc" style="background:var(--p${info.ci})"></span><b>${esc(info.name || info.shapeName)}</b> <span class="mono">${esc(info.sum)}</span>${n > 1 ? ` <span class="badge">${n}×</span>` : ''}</button>`;
  }).join('') : '<span class="hint">Prázdný. Díl sem dáš tlačítkem „Do zásobníku“.</span>';
  const bad = s.some((_, k) => problemOf(s, k));
  if (bad) msg('Červený díl se překrývá nebo přečnívá přes kraj.', true);
}
function pieceG(p, k, prob) {
  const g = geo(p.i, p.deg), info = M.P.byPi[M.P.J.parts[p.i].pi];
  const cls = 'm-piece' + (k === M.sel ? ' sel' : '') + (prob ? ' bad' : '');
  const Mx = Math.max(M.X, M.P.Y), label = info.name || info.sum, { spot } = shapeOf(M.P, p.i, p.deg);
  const fsz = Math.min(Mx / 48, spot.aw * 0.9 / (label.length * 0.58), spot.ah * 0.7);
  const txt = fsz >= Mx / 110 ? `<text x="${spot.x}" y="${spot.y}" font-size="${fsz}" text-anchor="middle" dominant-baseline="central" class="m-lbl">${esc(label)}</text>` : '';
  return `<g class="${cls}" data-k="${k}" transform="translate(${p.x} ${p.y})"><path d="${pathD(g.rings)}" fill-rule="evenodd" style="fill:var(--p${info.ci})" vector-effect="non-scaling-stroke"/>${txt}</g>`;
}

/* ---------- ovládání ---------- */
function toSvg(e) { const svg = $('mSvg'), pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const p = pt.matrixTransform(svg.getScreenCTM().inverse()); return [p.x, p.y]; }
function unitsPerPx() { const m = $('mSvg').getScreenCTM(); return m ? 1 / m.a : 1; }

function onDown(e) {
  const gEl = e.target.closest('[data-k]');
  if (!gEl) { M.sel = -1; draw(); return; }
  e.preventDefault();
  const k = +gEl.dataset.k, p = M.sheets[M.si][k], [mx, my] = toSvg(e);
  M.sel = k; M.drag = { k, dx: mx - p.x, dy: my - p.y, ox: p.x, oy: p.y, moved: false };
  try { $('mSvg').setPointerCapture(e.pointerId); } catch { /* ukazatel už není aktivní */ }
  draw();
}
function onMove(e) {
  if (!M.drag) return;
  const [mx, my] = toSvg(e), s = M.sheets[M.si], p = s[M.drag.k], g = geo(p.i, p.deg);
  let x = mx - M.drag.dx, y = my - M.drag.dy;
  // přichytávání ke krajům a sousedům
  const thr = unitsPerPx() * 14;
  const xs = [0, M.X - g.t.w], ys = [0, M.P.Y - g.t.hh];
  s.forEach((q, j) => { if (j === M.drag.k) return; const h = geo(q.i, q.deg).t; xs.push(q.x + h.w, q.x - g.t.w, q.x, q.x + (h.w - g.t.w) / 2); ys.push(q.y + h.hh, q.y - g.t.hh, q.y, q.y + (h.hh - g.t.hh) / 2); });
  const snap = (v, arr) => { let b = v, bd = thr; for (const a of arr) { const d = Math.abs(a - v); if (d < bd) { bd = d; b = a; } } return bd < thr ? b : Math.round(v); };
  x = snap(x, xs); y = snap(y, ys);
  p.x = x; p.y = y; M.drag.moved = true;
  const el = $('mSvg').querySelector(`[data-k="${M.drag.k}"]`);
  if (el) { el.setAttribute('transform', `translate(${x} ${y})`); el.classList.toggle('bad', !!problemOf(s, M.drag.k)); }
  msg(`Zleva ${fmt(x)} ${U()} · shora ${fmt(y)} ${U()}`);
}
function onUp() {
  if (!M.drag) return;
  const s = M.sheets[M.si], k = M.drag.k; M.drag = null;
  const pr = problemOf(s, k);
  draw();
  if (!pr) msg('Díl položen.');
}
function rotateSel() {
  const s = M.sheets[M.si]; if (M.sel < 0) return;
  const p = s[M.sel], part = M.P.J.parts[p.i];
  if (!part.rot) return msg('Tenhle díl má zakázané otáčení (upravíš v dílu „Lze otáčet“).', true);
  const g0 = geo(p.i, p.deg).t; const cx = p.x + g0.w / 2, cy = p.y + g0.hh / 2;
  p.deg = (p.deg + 90) % 360;
  const g1 = geo(p.i, p.deg).t; p.x = Math.round(cx - g1.w / 2); p.y = Math.round(cy - g1.hh / 2);
  draw();
}
function fromTray(i) {
  const s = M.sheets[M.si], part = M.P.J.parts[i];
  const degs = part.rot ? [0, 90, 180, 270] : [0];
  const step = Math.max(5, Math.round(Math.min(M.X, M.P.Y) / 120));
  for (const deg of degs) {
    const g = geo(i, deg);
    for (let x = 0; x + g.t.w <= M.X + 0.01; x += step) for (let y = 0; y + g.t.hh <= M.P.Y + 0.01; y += step) {
      const cand = { i, deg, x, y }; s.push(cand);
      if (!problemOf(s, s.length - 1)) { M.tray.splice(M.tray.indexOf(i), 1); M.sel = s.length - 1; draw(); msg('Díl položen na první volné místo. Můžeš ho posunout.'); return; }
      s.pop();
    }
  }
  const g = geo(i, 0); s.push({ i, deg: 0, x: Math.max(0, (M.X - g.t.w) / 2), y: Math.max(0, (M.P.Y - g.t.hh) / 2) });
  M.tray.splice(M.tray.indexOf(i), 1); M.sel = s.length - 1; draw();
  msg('Na tabuli už není volné místo. Uvolni ho, nebo přidej tabuli (+).', true);
}
