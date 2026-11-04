// Editor dílu: výběr klempířské šablony, nebo nakreslení vlastního tvaru bod po bodu.
import { $, esc, fmt, numv, isExpr } from './format.js';
import { SHAPES, SHAPE_ORDER, defaults, geomOf, iconSVG, pathD, inside } from './shapes.js';
import { polyXform } from './nest-engine.js';

let ed = null;       // rozpracovaný díl
let cb = null;       // {onSave(piece, idx, more), onDelete(idx)}
let lastT = 'rect';  // naposledy použitá šablona
const SNAPS = [1, 5, 10, 50];

export function initEditor() {
  $('tpls').innerHTML = SHAPE_ORDER.map((t) => `<button type="button" class="tpl" role="radio" data-t="${t}" aria-checked="false">${iconSVG(t)}<span>${SHAPES[t].n}</span></button>`).join('');
  $('tpls').addEventListener('click', (e) => { const b = e.target.closest('.tpl'); if (b) switchTemplate(b.dataset.t); });
  $('snapChips').innerHTML = SNAPS.map((s) => `<button type="button" class="chip" data-s="${s}">mřížka ${s} mm</button>`).join('');
  $('snapChips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; ed.snap = +b.dataset.s; syncSnap(); renderDraw(); });

  $('eFields').addEventListener('input', (e) => {
    const k = e.target.dataset.k; if (!k) return;
    ed.d.shape.p[k] = e.target.value;
    const v = numv(e.target.value);
    const eq = $('eq-' + k); if (eq) eq.textContent = isExpr(e.target.value) && !isNaN(v) ? '= ' + fmt(v) : '';
    renderPreview();
  });
  $('eName').addEventListener('input', (e) => { ed.d.name = e.target.value; });
  $('eQty').addEventListener('input', (e) => { ed.d.q = e.target.value; });
  $('eRot').addEventListener('change', (e) => { ed.d.rot = e.target.checked; });
  document.querySelectorAll('#dlg [data-q]').forEach((b) => b.addEventListener('click', () => {
    const q = Math.max(1, (parseInt(ed.d.q, 10) || 0) + +b.dataset.q); ed.d.q = String(q); $('eQty').value = ed.d.q;
  }));
  $('toCustom').addEventListener('click', toCustom);
  $('dlgX').addEventListener('click', closeEditor);
  $('dlg').addEventListener('click', (e) => { if (e.target === $('dlg')) closeEditor(); });
  $('eSave').addEventListener('click', () => save(false));
  $('eMore').addEventListener('click', () => save(true));
  $('eDelete').addEventListener('click', () => { if (ed.idx >= 0) { const i = ed.idx; closeEditor(); cb.onDelete(i); } });
  $('dlg').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
    else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.target.closest('#eDraw')) { e.preventDefault(); save(false); }
  });

  // kreslení
  const svg = $('drawSvg');
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);
  $('dUndo').addEventListener('click', () => { if (ed.hist.length) { ed.d.shape.pts = ed.hist.pop(); ed.sel = Math.min(ed.sel, ed.d.shape.pts.length - 1); redrawCustom(); } });
  $('dDel').addEventListener('click', () => {
    const pts = ed.d.shape.pts; if (!pts.length) return; pushHist();
    const i = ed.sel >= 0 ? ed.sel : pts.length - 1; pts.splice(i, 1); ed.sel = Math.min(i, pts.length - 1); redrawCustom();
  });
  $('dClear').addEventListener('click', () => { if (!ed.d.shape.pts.length) return; pushHist(); ed.d.shape.pts = []; ed.sel = -1; redrawCustom(); });
  $('sideAdd').addEventListener('click', addSide);
  $('sideL').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSide(); } });
  $('sideA').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSide(); } });
  $('coordList').addEventListener('input', (e) => {
    const i = +e.target.dataset.i, c = e.target.dataset.c; if (isNaN(i) || !c) return;
    const v = numv(e.target.value); if (isNaN(v)) return;
    ed.d.shape.pts[i][c === 'x' ? 0 : 1] = Math.max(0, v); renderDraw(); renderCustomInfo();
  });
  $('coordList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    pushHist(); ed.d.shape.pts.splice(+b.dataset.del, 1); ed.sel = -1; redrawCustom();
  });
}

export function openEditor(piece, idx, callbacks) {
  cb = callbacks;
  const src = piece ? JSON.parse(JSON.stringify(piece)) : { name: '', q: '1', rot: true, shape: { t: lastT, p: defaults(lastT), pts: [] } };
  if (!src.shape.p) src.shape.p = defaults(src.shape.t);
  if (!src.shape.pts) src.shape.pts = [];
  ed = { idx, d: src, mem: {}, sel: -1, drag: -1, hist: [], snap: 10, ext: 0, ci: idx >= 0 ? idx : callbacks.nextIndex, ret: document.activeElement };
  ed.mem[src.shape.t] = src.shape.p;
  $('dlgT').textContent = idx >= 0 ? 'Upravit díl' : 'Nový díl';
  $('eDelete').hidden = idx < 0;
  $('eMore').hidden = idx >= 0;
  $('eName').value = src.name || '';
  $('eQty').value = src.q;
  $('eRot').checked = !!src.rot;
  $('eErr').hidden = true;
  $('dlg').hidden = false;
  document.body.classList.add('noscroll');
  renderForm();
  setTimeout(() => { const f = $('eFields').querySelector('input') || $('eName'); f.focus(); if (f.select) f.select(); }, 30);
}

function closeEditor() {
  $('dlg').hidden = true;
  document.body.classList.remove('noscroll');
  if (ed?.ret?.focus) ed.ret.focus();
}

function switchTemplate(t) {
  if (t === ed.d.shape.t) return;
  ed.mem[ed.d.shape.t] = ed.d.shape.p;
  ed.d.shape.t = t;
  ed.d.shape.p = ed.mem[t] || defaults(t);
  ed.ext = 0;
  $('eErr').hidden = true;
  renderForm();
}

function toCustom() {
  const g = geomOf(ed.d); if (!g.ok) return;
  ed.mem[ed.d.shape.t] = ed.d.shape.p;
  ed.d.shape.pts = g.poly.o.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
  ed.d.shape.t = 'custom'; ed.hist = []; ed.sel = -1; ed.ext = 0;
  renderForm();
}

function renderForm() {
  const t = ed.d.shape.t, def = SHAPES[t];
  document.querySelectorAll('#tpls .tpl').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.t === t)));
  const custom = !!def.custom;
  $('eFields').hidden = custom; $('eDraw').hidden = !custom;
  $('ePrev').hidden = custom; $('drawSvg').toggleAttribute('hidden', !custom);
  $('toCustom').hidden = custom || !def.edges;
  if (custom) { syncSnap(); redrawCustom(); return; }
  $('eFields').innerHTML = def.f.map(([k, label, , , unit]) => {
    const v = ed.d.shape.p[k] ?? ''; const n = numv(v);
    const kb = t === 'rect' && k === 'w' ? '' : ' inputmode="decimal"';
    return `<div class="field"><label for="ef-${k}">${label}</label><div class="inp"><input type="text" id="ef-${k}" data-k="${k}" value="${esc(v)}"${kb} autocomplete="off"><span>${unit}</span></div><div class="eq" id="eq-${k}">${isExpr(v) && !isNaN(n) ? '= ' + fmt(n) : ''}</div></div>`;
  }).join('') + (t === 'rect' ? `<p class="hint">Šířku můžeš zadat jako <b>rozvin</b>: 20+120+150+20</p>` : '');
  renderPreview();
}

function renderPreview() {
  const g = geomOf(ed.d);
  if (!g.ok) {
    $('ePrev').innerHTML = `<div class="pv-bad">${esc(g.err)}</div>`;
    $('eInfo').innerHTML = '';
    return;
  }
  $('eErr').hidden = true;
  $('ePrev').innerHTML = shapeSVG(g, SHAPES[ed.d.shape.t].edges);
  const def = SHAPES[ed.d.shape.t];
  const lines = (def.info ? def.info(g.p) : []).concat([`Zabere obdélník ${fmt(g.bh)} × ${fmt(g.bw)} mm · plocha ${(g.area / 1e6).toLocaleString('cs-CZ', { maximumFractionDigits: 3 })} m²`]);
  $('eInfo').innerHTML = lines.map((l) => `<span>${esc(l)}</span>`).join('');
}

function shapeSVG(g, edges) {
  const t = polyXform(g.poly, 0), M = Math.max(t.w, t.hh), pad = M * 0.15, fs = M / 21;
  const o = [`<path d="${pathD([t.o].concat(t.holes))}" fill-rule="evenodd" class="pv-p" style="fill:var(--p${ed.ci % 8})" vector-effect="non-scaling-stroke"/>`];
  if (edges && t.o.length <= 24) o.push(edgeLabels(t.o, [t.o], fs, M));
  return `<svg viewBox="${-pad} ${-pad} ${t.w + pad * 2} ${t.hh + pad * 2}" role="img" aria-label="Náhled tvaru">${o.join('')}</svg>`;
}

function edgeLabels(pts, rings, fs, M) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < M * 0.03) continue;
    let nx = dy / L, ny = -dx / L;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (inside(rings, mx + nx * M * 0.01, my + ny * M * 0.01)) { nx = -nx; ny = -ny; }
    out.push(`<text x="${mx + nx * fs * 0.95}" y="${my + ny * fs * 0.95}" class="pv-t" font-size="${fs}" text-anchor="middle" dominant-baseline="central">${fmt(L)}</text>`);
  }
  return out.join('');
}

/* ---------- vlastní tvar (kreslení) ---------- */
function syncSnap() { document.querySelectorAll('#snapChips .chip').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.s === ed.snap))); }
function pushHist() { ed.hist.push(JSON.parse(JSON.stringify(ed.d.shape.pts))); if (ed.hist.length > 100) ed.hist.shift(); }
function redrawCustom() { renderDraw(); renderCoords(); renderCustomInfo(); }

function view() {
  const pts = ed.d.shape.pts;
  let mx = 0, my = 0; for (const p of pts) { mx = Math.max(mx, p[0]); my = Math.max(my, p[1]); }
  const need = Math.max(600, Math.ceil(Math.max(mx, my / 0.7) * 1.25 / 100) * 100);
  if (need > ed.ext) ed.ext = need;
  const W = ed.ext, H = Math.max(Math.round(W * 0.7), Math.ceil(my * 1.2 / 100) * 100);
  return { W, H };
}

function renderDraw() {
  const svg = $('drawSvg'), pts = ed.d.shape.pts, { W, H } = view();
  const fs = W / 48, pad = fs * 1.6;
  let g = 10; for (const s of [10, 25, 50, 100, 250, 500, 1000]) { g = s; if (W / s <= 40) break; }
  const o = [];
  for (let x = 0; x <= W + 1e-6; x += g) { const major = Math.round(x / g) % 5 === 0; o.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" class="${major ? 'dg-M' : 'dg-m'}"/>`); if (major) o.push(`<text x="${x}" y="${-fs * 0.5}" class="dg-t" font-size="${fs * 0.8}" text-anchor="middle">${fmt(x)}</text>`); }
  for (let y = 0; y <= H + 1e-6; y += g) { const major = Math.round(y / g) % 5 === 0; o.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="${major ? 'dg-M' : 'dg-m'}"/>`); if (major && y > 0) o.push(`<text x="${-fs * 0.4}" y="${y}" class="dg-t" font-size="${fs * 0.8}" text-anchor="end" dominant-baseline="central">${fmt(y)}</text>`); }
  if (pts.length >= 3) o.push(`<path d="${pathD([pts])}" class="dr-fill" style="fill:var(--p${ed.ci % 8})" vector-effect="non-scaling-stroke"/>`);
  else if (pts.length === 2) o.push(`<polyline points="${pts.map((p) => p.join(',')).join(' ')}" class="dr-line" vector-effect="non-scaling-stroke"/>`);
  if (pts.length >= 2) o.push(edgeLabels(pts.length >= 3 ? pts : [pts[0], pts[1]], [pts], fs, W));
  const r = W / 90;
  pts.forEach((p, i) => {
    o.push(`<circle cx="${p[0]}" cy="${p[1]}" r="${i === ed.sel ? r * 1.5 : r}" class="${i === ed.sel ? 'dr-v sel' : 'dr-v'}" vector-effect="non-scaling-stroke"/>`);
    o.push(`<text x="${p[0] + r * 1.6}" y="${p[1] - r * 1.6}" class="dr-n" font-size="${fs * 0.8}">${i + 1}</text>`);
  });
  if (!pts.length) o.push(`<text x="${W / 2}" y="${H / 2}" class="dr-hint" font-size="${fs * 1.3}" text-anchor="middle">Ťukni sem a začni kreslit obrys</text>`);
  svg.setAttribute('viewBox', `${-pad * 2.2} ${-pad * 1.4} ${W + pad * 3.4} ${H + pad * 2.6}`);
  svg.innerHTML = o.join('');
}

function renderCoords() {
  const pts = ed.d.shape.pts;
  $('ptCount').textContent = pts.length;
  $('coordList').innerHTML = pts.length ? pts.map((p, i) => `<div class="crow${i === ed.sel ? ' sel' : ''}"><span class="mono">${i + 1}</span>
    <div class="inp"><input type="text" inputmode="decimal" data-i="${i}" data-c="x" value="${fmt(p[0]).replace(/\s/g, '')}" aria-label="Bod ${i + 1} vodorovně"><span>x</span></div>
    <div class="inp"><input type="text" inputmode="decimal" data-i="${i}" data-c="y" value="${fmt(p[1]).replace(/\s/g, '')}" aria-label="Bod ${i + 1} svisle"><span>y</span></div>
    <button type="button" class="del" data-del="${i}" aria-label="Smazat bod ${i + 1}">✕</button></div>`).join('') : '<p class="hint">Zatím žádné body.</p>';
}

function renderCustomInfo() {
  const g = geomOf(ed.d);
  $('eInfo').innerHTML = g.ok
    ? `<span>Zabere obdélník ${fmt(g.bh)} × ${fmt(g.bw)} mm · plocha ${(g.area / 1e6).toLocaleString('cs-CZ', { maximumFractionDigits: 3 })} m²</span>`
    : `<span>${esc(g.err)}</span>`;
}

function toSvg(e) {
  const svg = $('drawSvg'), pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [p.x, p.y];
}
const snapPt = (p) => [Math.max(0, Math.round(p[0] / ed.snap) * ed.snap), Math.max(0, Math.round(p[1] / ed.snap) * ed.snap)];

function onDown(e) {
  if (!ed || SHAPES[ed.d.shape.t].custom !== true) return;
  e.preventDefault();
  const p = toSvg(e), pts = ed.d.shape.pts, hitR = ed.ext / 40;
  let hit = -1, hd = Infinity;
  pts.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < hitR && d < hd) { hd = d; hit = i; } });
  pushHist();
  if (hit >= 0) ed.sel = hit;
  else {
    const q = snapPt(p);
    if (ed.sel >= 0 && ed.sel < pts.length - 1) { pts.splice(ed.sel + 1, 0, q); ed.sel++; }
    else { pts.push(q); ed.sel = pts.length - 1; }
  }
  ed.drag = ed.sel;
  try { $('drawSvg').setPointerCapture(e.pointerId); } catch { /* ukazatel už není aktivní */ }
  renderDraw(); renderCustomInfo();
}
function onMove(e) {
  if (!ed || ed.drag < 0) return;
  const q = snapPt(toSvg(e)), p = ed.d.shape.pts[ed.drag];
  if (p[0] === q[0] && p[1] === q[1]) return;
  ed.d.shape.pts[ed.drag] = q; renderDraw();
}
function onUp() { if (!ed || ed.drag < 0) return; ed.drag = -1; renderCoords(); renderCustomInfo(); }

function addSide() {
  const L = numv($('sideL').value), A = numv($('sideA').value || '0');
  if (!(L > 0) || isNaN(A)) { $('sideL').focus(); return; }
  const pts = ed.d.shape.pts; pushHist();
  if (!pts.length) pts.push([0, 0]);
  const last = pts[ed.sel >= 0 ? ed.sel : pts.length - 1];
  const a = A * Math.PI / 180;
  const q = [Math.round((last[0] + L * Math.cos(a)) * 10) / 10, Math.round((last[1] - L * Math.sin(a)) * 10) / 10];
  // když by bod vyjel do záporu, posuneme celý tvar
  if (q[0] < 0 || q[1] < 0) { const sx = Math.max(0, -q[0]), sy = Math.max(0, -q[1]); for (const p of pts) { p[0] += sx; p[1] += sy; } q[0] += sx; q[1] += sy; }
  if (ed.sel >= 0 && ed.sel < pts.length - 1) { pts.splice(ed.sel + 1, 0, q); ed.sel++; } else { pts.push(q); ed.sel = pts.length - 1; }
  $('sideL').value = ''; $('sideL').focus();
  redrawCustom();
}

function save(more) {
  ed.d.name = $('eName').value.trim();
  const q = parseInt(numv($('eQty').value), 10);
  ed.d.q = String(q > 0 ? Math.min(q, 999) : 1);
  const g = geomOf(ed.d);
  if (!g.ok) { $('eErr').textContent = g.err; $('eErr').hidden = false; return; }
  lastT = ed.d.shape.t;
  const piece = { name: ed.d.name, q: ed.d.q, rot: !!ed.d.rot, shape: { t: ed.d.shape.t, p: ed.d.shape.p, pts: ed.d.shape.t === 'custom' ? ed.d.shape.pts : [] } };
  const idx = ed.idx;
  if (more) {
    cb.onSave(piece, idx, true);
    ed.ci = cb.nextIndex = (cb.nextIndex || 0) + 1;
    ed.d.name = ''; $('eName').value = ''; ed.d.q = '1'; $('eQty').value = '1';
    ed.d.shape = JSON.parse(JSON.stringify(piece.shape));
    renderForm();
    const f = $('eFields').querySelector('input') || $('eName'); f.focus(); if (f.select) f.select();
  } else { closeEditor(); cb.onSave(piece, idx, false); }
}
