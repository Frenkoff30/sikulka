// Editor dílu: výběr klempířské šablony, nebo nakreslení vlastního tvaru bod po bodu.
import { $, esc, fmt, fmtN, numv, lenv, U, isExpr } from './format.js';
import { SHAPES, SHAPE_ORDER, defaults, geomOf, iconSVG, pathD, inside, profileSVG, BEND_PRESETS, presetSegs, mirrorPoly, MIR_OPTS, mirOf, MIR_SAME, isSymmetric } from './shapes.js';
import { polyXform } from './nest-engine.js';

let ed = null;       // rozpracovaný díl
let cb = null;       // {onSave(piece, idx, more), onDelete(idx)}
let lastT = 'rect';  // naposledy použitá šablona
const SNAPS = [1, 5, 10, 50];

export function initEditor() {
  $('tpls').innerHTML = SHAPE_ORDER.map((t) => `<button type="button" class="tpl" role="radio" data-t="${t}" aria-checked="false">${iconSVG(t)}<span>${SHAPES[t].n}</span></button>`).join('');
  $('tpls').addEventListener('click', (e) => { const b = e.target.closest('.tpl'); if (b) switchTemplate(b.dataset.t); });
  $('snapChips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; ed.snap = +b.dataset.s; syncSnap(); renderDraw(); });

  $('eFields').addEventListener('input', (e) => {
    const k = e.target.dataset.k; if (!k) return;
    ed.d.shape.p[k] = e.target.value;
    const ang = k === 'u', v = ang ? numv(e.target.value) : lenv(e.target.value);
    const eq = $('eq-' + k); if (eq) eq.textContent = isExpr(e.target.value) && !isNaN(v) ? '= ' + (ang ? fmtN(v) : fmt(v)) : '';
    renderPreview();
  });
  $('eName').addEventListener('input', (e) => { ed.d.name = e.target.value; });
  $('eQty').addEventListener('input', (e) => { ed.d.q = e.target.value; mirHint(geomOf(ed.d)); });
  $('eRot').addEventListener('change', (e) => { ed.d.rot = e.target.checked; });
  // zrcadlový díl
  $('eMir').innerHTML = MIR_OPTS.map(([n], k) => `<button type="button" role="radio" data-m="${k}" aria-checked="false">${k ? '<svg viewBox="0 0 20 14" aria-hidden="true"><path class="ico" d="M10 1v12M8 3.5L2 11h6zM12 3.5l6 7.5h-6z"/></svg>' : ''}${n}</button>`).join('');
  $('eMir').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; ed.d.mir = +b.dataset.m; syncMir(); if (SHAPES[ed.d.shape.t].custom) renderCustomInfo(); else renderPreview(); });
  document.querySelectorAll('#dlg [data-q]').forEach((b) => b.addEventListener('click', () => {
    const q = Math.max(1, (parseInt(ed.d.q, 10) || 0) + +b.dataset.q); ed.d.q = String(q); $('eQty').value = ed.d.q; mirHint(geomOf(ed.d));
  }));
  $('toCustom').addEventListener('click', toCustom);
  // ohýbaný profil
  $('bendPresets').innerHTML = BEND_PRESETS.map(([n], k) => `<button type="button" class="chip" data-pk="${k}">${n}</button>`).join('');
  $('bendPresets').addEventListener('click', (e) => { const b = e.target.closest('[data-pk]'); if (!b) return; ed.d.shape.segs = presetSegs(+b.dataset.pk); renderBend(); renderPreview(); });
  $('bendList').addEventListener('input', (e) => {
    const i = +e.target.dataset.s, k = e.target.dataset.k; if (isNaN(i) || !k) return;
    ed.d.shape.segs[i][k] = e.target.value;
    if (k === 'a') e.target.closest('.bbend').querySelectorAll('[data-ang]').forEach((c) => c.setAttribute('aria-pressed', String(numv(e.target.value) === +c.dataset.ang)));
    renderPreview();
  });
  $('bendList').addEventListener('click', (e) => {
    const segs = ed.d.shape.segs, b = e.target.closest('button'); if (!b) return;
    const i = +b.dataset.s;
    if (b.dataset.ang) segs[i].a = b.dataset.ang;
    else if (b.dataset.dir) segs[i].d = +b.dataset.dir;
    else if (b.dataset.sdel !== undefined) { if (segs.length <= 2) return; segs.splice(i, 1); delete segs[segs.length - 1].a; }
    else return;
    renderBend(); renderPreview();
  });
  $('bendAdd').addEventListener('click', () => {
    const segs = ed.d.shape.segs, last = segs[segs.length - 1];
    if (!last.a) { last.a = '90'; last.d = 1; }
    segs.push({ L: last.L });
    renderBend(); renderPreview();
    const ins = $('bendList').querySelectorAll('input[data-k="L"]'); const f = ins[ins.length - 1]; f.focus(); f.select();
  });
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
    const v = lenv(e.target.value); if (isNaN(v)) return;
    ed.d.shape.pts[i][c === 'x' ? 0 : 1] = Math.max(0, v); renderDraw(); renderCustomInfo();
  });
  $('coordList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    pushHist(); ed.d.shape.pts.splice(+b.dataset.del, 1); ed.sel = -1; redrawCustom();
  });
}

export function openEditor(piece, idx, callbacks) {
  cb = callbacks;
  $('snapChips').innerHTML = SNAPS.map((s) => `<button type="button" class="chip" data-s="${s}">mřížka ${fmt(s)} ${U()}</button>`).join('');
  $('sideU').textContent = U();
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
  src.mir = mirOf(src);
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
  $('eBend').hidden = !def.bend;
  syncMir();
  if (custom) { syncSnap(); redrawCustom(); return; }
  if (def.bend) { if (!(ed.d.shape.segs?.length >= 2)) ed.d.shape.segs = presetSegs(1); renderBend(); }
  $('eFields').innerHTML = def.f.map(([k, label, , , unit]) => {
    const v = ed.d.shape.p[k] ?? ''; const n = unit === '°' ? numv(v) : lenv(v);
    const kb = t === 'rect' && k === 'w' ? '' : ' inputmode="decimal"';
    return `<div class="field"><label for="ef-${k}">${label}</label><div class="inp"><input type="text" id="ef-${k}" data-k="${k}" value="${esc(v)}"${kb} autocomplete="off"><span>${unit === '°' ? '°' : U()}</span></div><div class="eq" id="eq-${k}">${isExpr(v) && !isNaN(n) ? '= ' + (unit === '°' ? fmtN(n) : fmt(n)) : ''}</div></div>`;
  }).join('') + (t === 'rect' ? `<p class="hint">Ohýbaný díl? Zvol nahoře <b>Ohýbaný profil</b> – rozvin spočítá sám.</p>` : '')
    + (def.bend ? `<p class="hint">Odečet = o kolik je pás kratší na každém ohybu (podle ohýbačky). Nech 0 a r. š. bude součet stran.</p>` : '');
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
  const def = SHAPES[ed.d.shape.t];
  if (g.bend) {
    $('ePrev').innerHTML = `<div class="pv-bend"><div class="pv-cap">Řez profilem</div>${profileSVG(g.bend, { labels: true })}<div class="pv-cap">Rozvin – kde orýsovat ohyby</div>${stripSVG(g.bend)}</div>`;
    $('eInfo').innerHTML = `<span class="big">Rozvinutá šířka <b>${fmt(g.bend.w)} ${U()}</b></span><span>Ohyby orýsuj od kraje <i class="dot"></i>: <b>${g.bend.marks.map(fmt).join(' · ')}</b> ${U()}</span>`;
    return;
  }
  $('ePrev').innerHTML = shapeSVG(g, SHAPES[ed.d.shape.t].edges, MIR_SAME.has(ed.d.shape.t) ? 0 : mirOf(ed.d));
  mirHint(g);
  const lines = (def.info ? def.info(g.p) : []).concat([`Zabere ${fmt(g.bh)} × ${fmt(g.bw)} ${U()} · ${(g.area / 1e6).toLocaleString('cs-CZ', { maximumFractionDigits: 3 })} m²`]);
  $('eInfo').innerHTML = lines.map((l) => `<span>${esc(l)}</span>`).join('');
}

/* ---------- ohýbaný profil ---------- */
function renderBend() {
  const segs = ed.d.shape.segs, n = segs.length;
  const angs = [45, 90, 135, 180];
  $('bendList').innerHTML = segs.map((s, i) => {
    const row = `<div class="bseg"><span class="bn">${i + 1}</span><span class="bl">strana</span><div class="inp"><input type="text" inputmode="decimal" data-s="${i}" data-k="L" value="${esc(s.L)}" aria-label="Délka ${i + 1}. strany" autocomplete="off"><span>${U()}</span></div>${n > 2 ? `<button type="button" class="del" data-s="${i}" data-sdel aria-label="Smazat ${i + 1}. stranu">✕</button>` : '<span></span>'}</div>`;
    if (i === n - 1) return row;
    const a = numv(s.a), up = s.d >= 0;
    return row + `<div class="bbend"><span class="bl">ohyb</span>
      <div class="bang">${angs.map((x) => `<button type="button" class="chip" data-s="${i}" data-ang="${x}" aria-pressed="${a === x}">${x === 180 ? '180° záhyb' : x + '°'}</button>`).join('')}<div class="inp ang"><input type="text" inputmode="decimal" data-s="${i}" data-k="a" value="${esc(s.a)}" aria-label="Úhel ${i + 1}. ohybu"><span>°</span></div></div>
      <div class="bdir"><button type="button" data-s="${i}" data-dir="1" aria-pressed="${up}">↑ nahoru</button><button type="button" data-s="${i}" data-dir="-1" aria-pressed="${!up}">↓ dolů</button></div></div>`;
  }).join('');
}

/** Rozvinutý pás s čárami ohybů a mírami od kraje. */
function stripSVG(b) {
  const W = b.w, H = Math.max(W * 0.22, 1), fs = W / 16, pad = fs * 2.2;
  const o = [`<rect x="0" y="0" width="${W}" height="${H}" class="pv-strip" vector-effect="non-scaling-stroke"/>`, `<circle cx="0" cy="${H / 2}" r="${fs * 0.32}" class="pf-s"/>`];
  b.marks.forEach((m, i) => {
    o.push(`<line x1="${m}" y1="0" x2="${m}" y2="${H}" class="pv-bl" vector-effect="non-scaling-stroke"/>`);
    o.push(`<text x="${m}" y="${-fs * 0.45 - (i % 2) * fs * 0.95}" class="pf-t" font-size="${fs * 0.8}" text-anchor="middle">${fmt(m)}</text>`);
  });
  o.push(`<text x="${W / 2}" y="${H + fs * 1.15}" class="pf-a" font-size="${fs * 0.75}" text-anchor="middle">r. š. ${fmt(W)} ${U()}</text>`);
  return `<svg viewBox="${-pad} ${-pad * 1.4} ${W + pad * 2} ${H + pad * 2.4}" class="pf strip" role="img" aria-label="Rozvinutý pás s ohyby">${o.join('')}</svg>`;
}

/** Náhled tvaru; mir 1 = zrcadlově, 2 = normální a vedle něj zrcadlový. */
function shapeSVG(g, edges, mir = 0) {
  const polys = mir === 0 ? [g.poly] : mir === 1 ? [mirrorPoly(g.poly)] : [g.poly, mirrorPoly(g.poly)];
  const ts = polys.map((p) => polyXform(p, 0)), t0 = ts[0];
  const gap = ts.length > 1 ? Math.max(t0.w, t0.hh) * 0.22 : 0;
  const W = ts.reduce((s, t) => s + t.w, 0) + gap * (ts.length - 1), H = t0.hh;
  const M = Math.max(W / ts.length, H), pad = M * 0.15, fs = M / 21;
  const o = []; let ox = 0;
  ts.forEach((t, k) => {
    const sh = (r) => r.map((p) => [p[0] + ox, p[1]]), o2 = sh(t.o);
    o.push(`<path d="${pathD([o2].concat(t.holes.map(sh)))}" fill-rule="evenodd" class="pv-p${mir === 2 && k ? ' mir' : ''}" style="fill:var(--p${ed.ci % 8})" vector-effect="non-scaling-stroke"/>`);
    if (edges && t.o.length <= 24) o.push(edgeLabels(o2, [o2], fs, M));
    if (mir === 2) o.push(`<text x="${ox + t.w / 2}" y="${H + fs * 2.2}" class="pv-cap2" font-size="${fs * 0.95}" text-anchor="middle">${k ? 'zrcadlově' : 'normálně'}</text>`);
    ox += t.w + gap;
  });
  if (mir === 2) o.push(`<line x1="${t0.w + gap / 2}" y1="${-pad * 0.3}" x2="${t0.w + gap / 2}" y2="${H + pad * 0.3}" class="pv-axis" vector-effect="non-scaling-stroke"/>`);
  const bot = mir === 2 ? fs * 3 : 0;
  return `<svg viewBox="${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2 + bot}" role="img" aria-label="Náhled tvaru">${o.join('')}</svg>`;
}

/* ---------- zrcadlový díl ---------- */
function syncMir() {
  const same = MIR_SAME.has(ed.d.shape.t);
  $('eMirBox').hidden = same;
  document.querySelectorAll('#eMir [data-m]').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.m === mirOf(ed.d))));
}
function mirHint(g) {
  const m = mirOf(ed.d), el = $('eMirHint');
  let t = '';
  if (g?.ok && m && isSymmetric(g.poly)) t = 'Tenhle tvar je souměrný – zrcadlový kus vyjde úplně stejný.';
  else if (m === 2) t = `Vyřízne se ${ed.d.q || 1}× normálně a ${ed.d.q || 1}× zrcadlově (levý i pravý).`;
  else if (m === 1) t = 'Díl se vyřízne převrácený zleva doprava.';
  el.textContent = t; el.hidden = !t;
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
  if (!pts.length) o.push(`<text x="${W / 2}" y="${H / 2}" class="dr-hint" font-size="${fs * 1.3}" text-anchor="middle">Ťukni sem a kresli obrys</text>`);
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
  mirHint(g);
  $('eInfo').innerHTML = g.ok
    ? `<span>Zabere ${fmt(g.bh)} × ${fmt(g.bw)} ${U()} · ${(g.area / 1e6).toLocaleString('cs-CZ', { maximumFractionDigits: 3 })} m²</span>`
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
  const L = lenv($('sideL').value), A = numv($('sideA').value || '0');
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
  const mir = MIR_SAME.has(ed.d.shape.t) ? 0 : mirOf(ed.d);
  const piece = { name: ed.d.name, q: ed.d.q, rot: !!ed.d.rot, ...(mir ? { mir } : {}), shape: { t: ed.d.shape.t, p: ed.d.shape.p, pts: ed.d.shape.t === 'custom' ? ed.d.shape.pts : [], ...(ed.d.shape.t === 'bend' ? { segs: ed.d.shape.segs } : {}) } };
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
