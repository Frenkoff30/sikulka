// Nářez plechu – hlavní logika aplikace: zadání, seznam dílů, výpočet, zakázky, instalace.
import { $, esc, fmt, numv, lenv, toUnit, setUnit, U, UNITS, plural, m2 } from './format.js';
import { SHAPES, defaults, geomOf, thumbSVG, profileSVG, mirrorPoly, mirOf } from './shapes.js';
import { buildConfigs, runRect, evalRect, cmp, mutate, EPS } from './rect-engine.js';
import { NestSolver } from './nest-engine.js';
import { renderWarns, renderEmpty, renderBlank, renderRect, renderLayout, layoutFromSnap, layoutFromRect, updateStatus } from './render.js';
import { initEditor, openEditor } from './editor.js';
import { openManual } from './manual.js';

/* ---------- stav ---------- */
const KEY = 'narez-plechu-v2', KEY_V1 = 'narez-plechu-v1', JOBS = 'narez-zakazky-v1', THEME = 'narez-vzhled-v2', STOCK = 'narez-sklad-v1';
const pc = (name, t, p, q, rot = true) => ({ name, q: String(q), rot, shape: { t, p: Object.assign(defaults(t), p), pts: [] } });
const example = () => ({
  unit: 'mm', mode: 'sheet', W: '1250', L: '2500', cut: 'g', kerf: '0', showCuts: true, example: true, manual: null,
  pieces: [
    pc('Lemovka', 'rect', { w: '150', l: '2000' }, 2),
    pc('Oplechování římsy', 'bevel', { w: '250', L1: '1200', L2: '950' }, 2),
    pc('Štít vikýře', 'tri', { a: '800', v: '400', s: '400' }, 2),
    pc('Stříška komínu', 'cone', { D: '600', d: '0', v: '250' }, 1),
    pc('Manžeta', 'ring', { D: '400', d: '200' }, 1),
    pc('Záslepka', 'circle', { D: '150' }, 2),
  ],
});
const MIRB = 100000;  // klíč zrcadlového kusu = MIRB + pořadí dílu
const pcsOf = (p) => (parseInt(numv(p.q), 10) || 0) * (mirOf(p) === 2 ? 2 : 1);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
function loadState() {
  let s = store.get(KEY);
  if (s && Array.isArray(s.pieces)) return s;
  const v1 = store.get(KEY_V1);
  if (v1 && Array.isArray(v1.pieces)) {
    return Object.assign(example(), v1, {
      example: false, manual: null,
      pieces: v1.pieces.map((p) => ({ name: p.name || '', q: p.q || '1', rot: p.rot !== false, shape: { t: 'rect', p: { w: p.w || '', l: p.l || '' }, pts: [] } })),
    });
  }
  // první spuštění: prázdná pracovní plocha
  return Object.assign(example(), { pieces: [], example: false });
}
let state = loadState();
if (!UNITS[state.unit]) state.unit = 'mm';
setUnit(state.unit);
const save = () => store.set(KEY, state);

/* ---------- motiv ---------- */
// Aplikace je vždy světlá. Tmavý režim jen když si ho člověk sám zapne tlačítkem.
function applyTheme() {
  const t = store.get(THEME) === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  $('btnTheme').setAttribute('aria-label', t === 'dark' ? 'Přepnout na světlý vzhled' : 'Přepnout na tmavý vzhled');
  $('btnTheme').title = $('btnTheme').getAttribute('aria-label');
  $('themeL').textContent = t === 'dark' ? 'Světlý' : 'Tmavý';
}
$('btnTheme').addEventListener('click', () => { store.set(THEME, store.get(THEME) === 'dark' ? 'light' : 'dark'); applyTheme(); });

/* ---------- jednotky ---------- */
// Všechny délky v zadání jsou uložené v jednotce zakázky. Při přepnutí se přepočítají.
const lenKeys = (p) => (SHAPES[p.shape?.t]?.f || []).filter((f) => f[4] !== '°').map((f) => f[0]);
function convertUnit(to) {
  const from = state.unit; if (from === to) return;
  const cv = (v) => { const mm = lenv(v, from); return isNaN(mm) ? v : toUnit(mm, to); };
  state.W = cv(state.W); state.L = cv(state.L);
  if (String(state.kerf ?? '').trim() !== '') state.kerf = cv(state.kerf);
  for (const p of state.pieces) {
    for (const k of lenKeys(p)) if (p.shape.p && k in p.shape.p) p.shape.p[k] = cv(p.shape.p[k]);
    for (const s of p.shape.segs || []) s.L = cv(s.L);
  }
  state.unit = to; setUnit(to);
}
function syncUnits() {
  document.querySelectorAll('#units [data-u]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.u === state.unit)));
  document.querySelectorAll('.u-l').forEach((e) => { e.textContent = U(); });
}
$('units').addEventListener('click', (e) => {
  const b = e.target.closest('[data-u]'); if (!b || b.dataset.u === state.unit) return;
  convertUnit(b.dataset.u); renderStatic(); renderPieces(); save();
  // plán zůstává stejný, jen se přepíšou čísla do nové jednotky
  if (!shown) return schedule();
  const P = shown.P;
  for (const v of Object.values(P.byPi)) { const g = geomOf(state.pieces[v.src]); if (g.ok) v.sum = g.sum; }
  for (const v of P.invalid || []) { const g = geomOf(state.pieces[v.src]); if (g.ok) v.sum = g.sum; }
  renderWarns(P); rerender();
});
function rerender() {
  if (!shown) return;
  if (shown.kind === 'rect') renderRect(shown.best, shown.P, !!shown.running, { showCuts: state.showCuts });
  else renderLayout(shown.L, shown.P, !!shown.running);
}

/* ---------- materiál a řezání ---------- */
function renderStatic() {
  $('m-' + state.mode).checked = true;
  $('c-' + state.cut).checked = true;
  $('sW').value = state.W; $('sL').value = state.L; $('kerf').value = state.kerf;
  $('showCuts').checked = !!state.showCuts;
  ['sW', 'sL', 'kerf'].forEach((id) => $(id).classList.remove('bad'));
  syncUnits(); syncMode();
}
function syncMode() {
  const coil = state.mode === 'coil';
  $('fL').hidden = coil;
  $('sWl').textContent = coil ? 'Šířka svitku' : 'Šířka';
}
[['sW', 'W'], ['sL', 'L'], ['kerf', 'kerf']].forEach(([id, k]) => $(id).addEventListener('input', (e) => {
  state[k] = e.target.value; const v = numv(e.target.value);
  e.target.classList.toggle('bad', k === 'kerf' ? (e.target.value.trim() !== '' && !(v >= 0)) : !(v > 0));
  schedule();
}));
document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => { state.mode = r.value; syncMode(); schedule(); }));
document.querySelectorAll('input[name=cut]').forEach((r) => r.addEventListener('change', () => { state.cut = r.value; schedule(); }));
$('showCuts').addEventListener('change', (e) => { state.showCuts = e.target.checked; save(); if (shown?.kind === 'rect') rerender(); });

/* ---------- seznam dílů ---------- */
function renderPieces() {
  const list = state.pieces.map((p, i) => {
    const g = geomOf(p), def = SHAPES[p.shape?.t] || SHAPES.rect, mir = mirOf(p);
    const mtag = mir === 1 ? '<span class="mtag" title="Vyřízne se zrcadlově">⇋ zrcadlově</span>' : mir === 2 ? '<span class="mtag" title="Vyřízne se normálně i zrcadlově – od každého zadaný počet">⇋ + zrcadlový</span>' : '';
    return `<div class="pcard${g.ok ? '' : ' bad'}" data-i="${i}">
  <button type="button" class="thumb" data-act="edit" aria-label="Upravit díl ${i + 1}">${g.ok ? (g.bend ? profileSVG(g.bend, { size: 44 }) : thumbSVG(mir === 1 ? mirrorPoly(g.poly) : g.poly, i, 52)) : '<span class="thumb-x">?</span>'}</button>
  <button type="button" class="pinfo" data-act="edit" title="${esc((p.name ? p.name + ' – ' : '') + def.n)}"><b>${esc(p.name || def.n)}</b><span>${g.ok ? `<span class="mono">${esc(g.sum)}</span>` : esc(g.err)}</span>${g.ok ? mtag : ''}</button>
  <label class="switch sm" title="Program smí díl při skládání otočit napříč (o 90°). Vypni u plechu se směrem – drážky, lak."><input type="checkbox" data-f="rot" ${p.rot ? 'checked' : ''}><i></i>smí se otočit</label>
  <div class="qty" role="group" aria-label="Počet kusů"><button type="button" data-act="minus" aria-label="Ubrat kus">−</button><input type="text" inputmode="numeric" data-f="q" value="${esc(p.q)}" aria-label="Počet kusů dílu ${i + 1}"><button type="button" data-act="plus" aria-label="Přidat kus">+</button></div>
  <button type="button" class="del" data-act="del" aria-label="Smazat díl ${i + 1}" title="Smazat">✕</button>
</div>`;
  }).join('');
  $('plist').innerHTML = list || `<div class="plist-empty">Zatím žádné díly</div>`;
  $('exNote').hidden = !state.example;
  $('wipe').hidden = !state.pieces.length;
  const n = state.pieces.reduce((s, p) => s + pcsOf(p), 0);
  $('pcount').textContent = state.pieces.length ? `${n} ${plural(n, 'kus', 'kusy', 'kusů')}` : '';
  renderJobName();
}
function renderJobName() { $('jobName0').textContent = state.jobName || 'Neuložená zakázka'; }

/* ---------- mobil: záložky Zadání / Plán ---------- */
function setView(v) {
  $('layout').dataset.view = v;
  document.querySelectorAll('.tabbar [data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === v)));
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.tabbar [data-tab]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.tab)));
new MutationObserver(() => {
  const main = $('summary').querySelector('.kpi.main .v');
  const badge = $('tbBadge');
  if (main) {
    const v = main.firstChild.textContent.trim(), unit = main.querySelector('small')?.textContent || '';
    badge.textContent = unit === 'm' ? `${v} m` : `${v} ${plural(+v, 'tabule', 'tabule', 'tabulí')}`;
    badge.hidden = false;
  } else badge.hidden = true;
}).observe($('summary'), { childList: true, subtree: true });
$('jobChip').addEventListener('click', () => $('btnJobs').click());
$('plist').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const i = +b.closest('.pcard').dataset.i, p = state.pieces[i];
  if (b.dataset.act === 'edit') editPiece(i);
  else if (b.dataset.act === 'del') {
    const removed = state.pieces.splice(i, 1)[0];
    state.example = false; renderPieces(); schedule();
    toast(`Díl „${removed.name || SHAPES[removed.shape.t].n}“ smazán.`, () => { state.pieces.splice(i, 0, removed); renderPieces(); schedule(); });
  } else if (b.dataset.act === 'minus' || b.dataset.act === 'plus') {
    const q = Math.max(1, (parseInt(numv(p.q), 10) || 1) + (b.dataset.act === 'plus' ? 1 : -1));
    p.q = String(Math.min(999, q)); b.parentElement.querySelector('input').value = p.q;
    state.example = false; updateCount(); schedule();
  }
});
$('plist').addEventListener('input', (e) => {
  const card = e.target.closest('.pcard'); if (!card || e.target.dataset.f !== 'q') return;
  state.pieces[+card.dataset.i].q = e.target.value; state.example = false; updateCount(); schedule();
});
$('plist').addEventListener('change', (e) => {
  const card = e.target.closest('.pcard'); if (!card || e.target.dataset.f !== 'rot') return;
  state.pieces[+card.dataset.i].rot = e.target.checked; state.example = false; schedule();
});
function updateCount() { const n = state.pieces.reduce((s, p) => s + pcsOf(p), 0); $('pcount').textContent = `${n} ${plural(n, 'kus', 'kusy', 'kusů')}`; $('exNote').hidden = true; }

function editPiece(i) {
  openEditor(i >= 0 ? state.pieces[i] : null, i, {
    nextIndex: state.pieces.length,
    onSave(piece, idx, more) {
      if (idx >= 0) state.pieces[idx] = piece; else state.pieces.push(piece);
      state.example = false; renderPieces(); schedule();
      if (more) toast(`Díl uložen. Zadej další.`);
    },
    onDelete(idx) { $('plist').querySelector(`.pcard[data-i="${idx}"] [data-act="del"]`)?.click(); },
  });
}
$('addP').addEventListener('click', () => editPiece(-1));
$('wipe').addEventListener('click', () => {
  const old = JSON.parse(JSON.stringify(state));
  state.pieces = []; state.example = false; state.manual = null; state.jobName = '';
  renderPieces(); schedule();
  toast('Všechny díly smazány.', () => { state = old; setUnit(state.unit); renderStatic(); renderPieces(); schedule(); });
});
$('clearAll').addEventListener('click', () => { state.pieces = []; state.example = false; state.manual = null; renderPieces(); schedule(); editPiece(-1); });

/* ---------- zadání → úloha ---------- */
function signature() {
  // v mm, aby přepnutí jednotek nezahodilo ruční rozložení
  const mmP = (p) => Object.fromEntries(Object.entries(p.shape.p || {}).map(([k, v]) => [k, lenKeys(p).includes(k) ? lenv(v) : numv(v)]));
  return JSON.stringify([state.mode, lenv(state.W), state.mode === 'coil' ? '' : lenv(state.L), lenv(state.kerf), state.pieces.map((p) => [p.q, !!p.rot, mirOf(p), p.shape.t, p.shape.t === 'custom' ? p.shape.pts : mmP(p), (p.shape.segs || []).map((s) => [lenv(s.L), numv(s.a), s.d])])]);
}
function makeProblem() {
  const coil = state.mode === 'coil';
  const Y = lenv(state.W); let X = coil ? Infinity : lenv(state.L);
  const kv = lenv(state.kerf), kerf = kv > 0 ? kv : 0;
  const errs = [], invalid = [], bad = [], byPi = {}, valid = [];
  if (!(Y > 0)) errs.push(coil ? 'Zadej šířku svitku.' : 'Zadej šířku tabule.');
  if (!coil && !(X > 0)) errs.push('Zadej délku tabule.');
  if (errs.length) return { errs, count: 0 };
  state.pieces.forEach((p, pi) => {
    let q = parseInt(numv(p.q), 10); if (!(q > 0)) return; q = Math.min(q, 999);
    const g = geomOf(p);
    if (!g.ok) { bad.push({ name: p.name || g.name, err: g.err }); return; }
    const rot = !!p.rot, mir = mirOf(p), base = (p.name || '').trim();
    // zrcadlový kus je samostatný tvar s vlastním klíčem (MIRB + pořadí dílu)
    const variants = mir === 0 ? [false] : mir === 1 ? [true] : [false, true];
    for (const m of variants) {
      const key = m ? MIRB + pi : pi;
      const info = { pi: key, src: pi, mir: m, name: m ? `${base || g.name} – zrcadlově` : base, sum: g.sum, shapeName: g.name, ci: pi % 8, poly: m ? mirrorPoly(g.poly) : g.poly, area: g.area, bw: g.bw, bh: g.bh, q, rot, isRect: g.isRect, w: g.isRect ? g.p.w : 0, l: g.isRect ? g.p.l : 0, bend: g.bend };
      const f0 = g.bw <= X + 1e-6 && g.bh <= Y + 1e-6, f1 = rot && g.bh <= X + 1e-6 && g.bw <= Y + 1e-6;
      if (!f0 && !f1) { info.wouldRot = !rot && g.bh <= X + 1e-6 && g.bw <= Y + 1e-6; invalid.push(info); continue; }
      byPi[key] = info; valid.push(info);
    }
  });
  const count = valid.reduce((s, v) => s + v.q, 0);
  if (count > 1500) return { errs: [`Moc kusů najednou (${count}). Rozděl zakázku, nejvýš 1 500 kusů.`], count: 0, invalid, bad };
  let Xc = X;
  if (coil) { Xc = 1; for (const v of valid) Xc += v.q * (Math.min(v.bh <= Y + 1e-6 ? v.bw : Infinity, v.rot && v.bw <= Y + 1e-6 ? v.bh : Infinity) + kerf); }
  const J = { X: Xc, Y, kerf, coil, parts: valid.map((v) => ({ pi: v.pi, poly: v.poly, rot: v.rot, q: v.q, area: v.area, bw: v.bw, bh: v.bh })), budget: Math.min(9000, 2500 + count * 60) };
  const base = { coil, X: Xc, Y, kerf, cut: state.cut, errs, invalid, bad, byPi, count, J, sig: signature() };
  if (valid.every((v) => v.isRect)) {
    const items = [];
    for (const v of valid) {
      const o = [];
      if (v.l <= Xc + EPS && v.w <= Y + EPS) o.push(0);
      if (v.rot && Math.abs(v.w - v.l) > EPS && v.w <= Xc + EPS && v.l <= Y + EPS) o.push(1);
      for (let c = 0; c < v.q; c++) items.push({ pi: v.pi, dx: v.l, dy: v.w, orients: o, id: items.length });
    }
    return Object.assign(base, { kind: 'rect', items });
  }
  return Object.assign(base, { kind: 'nest' });
}

/* ---------- výpočet ---------- */
let job = 0, timer = null, worker = null, fbTimer = null, shown = null;
function schedule() { save(); clearTimeout(timer); timer = setTimeout(solve, 250); }
function stopWork() { if (worker) { worker.terminate(); worker = null; } clearTimeout(fbTimer); }

function solve() {
  const id = ++job; stopWork();
  const P = makeProblem();
  renderWarns(P);
  if (P.errs.length) { shown = null; renderEmpty(state.mode); return; }
  if (!P.count) { shown = null; renderBlank(P); return; }
  if (state.manual) {
    if (state.manual.sig === P.sig) { showManual(P); return; }
    state.manual = null; save(); toast('Zadání se změnilo, ruční rozložení jsem zahodil a počítám znovu.');
  }
  if (P.kind === 'rect') solveRect(P, id); else solveNest(P, id);
}

function solveRect(P, id) {
  const queue = buildConfigs(P), n = P.items.length;
  const budget = n > 400 ? 2200 : n > 120 ? 1500 : 1000;
  let best = null, tried = 0, lastRender = 0, dirty = false; const t0 = performance.now();
  const opts = { showCuts: state.showCuts };
  const step = () => {
    if (id !== job) return;
    const ts = performance.now();
    while (performance.now() - ts < 35) {
      let cfg;
      if (queue.length && performance.now() - t0 < budget * 3) cfg = queue.shift();
      else if (best && n > 1) { queue.length = 0; cfg = mutate(best, P); } else { queue.length = 0; break; }
      const res = runRect(cfg, P), sc = evalRect(res, P); tried++;
      if (!best || cmp(sc, best.sc) <= 0) { if (!best || cmp(sc, best.sc) < 0) dirty = true; best = { order: cfg.order, fit: cfg.fit, split: cfg.split, res, sc }; }
      if (!queue.length && (performance.now() - t0 > budget || n <= 1)) break;
    }
    const now = performance.now(), done = !queue.length && (now - t0 > budget || n <= 1);
    best.tried = tried;
    if (done) { shown = { kind: 'rect', best, P, running: false }; renderRect(best, P, false, opts); return; }
    if (dirty && now - lastRender > 250) { lastRender = now; dirty = false; shown = { kind: 'rect', best, P, running: true }; renderRect(best, P, true, opts); }
    else updateStatus(true);
    setTimeout(step, 0);
  };
  updateStatus(true);
  setTimeout(step, 0);
}

function solveNest(P, id) {
  const onSnap = (snap) => {
    if (id !== job) return;
    const L = layoutFromSnap(snap), done = snap.t === 'done';
    shown = { kind: 'layout', L, P, running: !done };
    renderLayout(L, P, !done);
  };
  const fallback = () => {
    const S = new NestSolver(P.J); let last = 0;
    const loop = () => {
      if (id !== job) return;
      const r = S.step(40), now = Date.now();
      if (S.best && (r.done || (r.improved && now - last > 250) || now - last > 700)) { last = now; onSnap(Object.assign({ t: r.done ? 'done' : 'best' }, S.snapshot())); }
      if (!r.done) fbTimer = setTimeout(loop, 0);
    };
    loop();
  };
  if (!$('summary').querySelector('.sumbox')) $('summary').innerHTML = `<div class="sumbox"><div class="status run" id="status"><i class="dot"></i>Skládám tvary…</div></div>`;
  try {
    worker = new Worker(new URL('./nest-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => onSnap(e.data);
    worker.onerror = (ev) => { ev.preventDefault?.(); stopWork(); fallback(); };
    worker.postMessage(P.J);
  } catch { worker = null; fallback(); }
}

/* ---------- ruční skládání ---------- */
function showManual(P) {
  const idx = new Map(P.J.parts.map((p, i) => [p.pi, i]));
  const L = {
    manual: true, tried: 0, cell: 0,
    sheets: state.manual.sheets.map((s) => s.map(([pi, deg, x, y, m]) => ({ i: idx.get(pi), deg, x, y, m: !!m }))),
    unplaced: state.manual.tray.map((pi) => idx.get(pi)),
  };
  shown = { kind: 'layout', L, P };
  renderLayout(L, P, false);
}
$('sheets').addEventListener('click', (e) => {
  const sb = e.target.closest('[data-stock]');
  if (sb) { const [w, l, n] = sb.dataset.stock.split('|').map(Number); addStock(w, l, n, '', state.jobName || ''); return; }
  const b = e.target.closest('[data-manual]'); if (!b || !shown) return;
  const P = shown.P;
  const L = shown.kind === 'rect' ? layoutFromRect(shown.best, P) : shown.L;
  openManual(P, L, +b.dataset.manual, (res) => {
    state.manual = {
      sig: P.sig,
      sheets: res.sheets.map((s) => s.map((p) => [P.J.parts[p.i].pi, p.deg, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, p.m ? 1 : 0])),
      tray: res.unplaced.map((i) => P.J.parts[i].pi),
    };
    save(); showManual(P); toast('Ruční rozložení uloženo.');
  });
});
$('summary').addEventListener('click', (e) => {
  const id = e.target.closest('button')?.id;
  if (id === 'backAuto') { state.manual = null; save(); solve(); }
  else if (id === 'emptyAdd') editPiece(-1);
  else if (id === 'loadEx') {
    const u = state.unit; state = example(); setUnit('mm'); convertUnit(u);
    renderStatic(); renderPieces(); schedule();
  }
});

/* ---------- zakázky ---------- */
function jobs() { return store.get(JOBS) || []; }
function renderJobs() {
  const list = jobs();
  $('jobList').innerHTML = list.length ? list.map((j, k) => {
    const n = j.data.pieces.length;
    return `<div class="job"><div><b>${esc(j.name)}</b><span class="hint">${new Date(j.date).toLocaleDateString('cs-CZ')} · ${n} ${plural(n, 'díl', 'díly', 'dílů')} · ${j.data.mode === 'coil' ? 'svitek ' + esc(j.data.W) : esc(j.data.W) + ' × ' + esc(j.data.L)} ${esc(j.data.unit || 'mm')}</span></div>
      <button type="button" class="btn ghost sm" data-open="${k}">Otevřít</button><button type="button" class="del" data-jdel="${k}" aria-label="Smazat zakázku ${esc(j.name)}">✕</button></div>`;
  }).join('') : '<p class="hint">Zatím žádné uložené zakázky.</p>';
}
$('btnJobs').addEventListener('click', () => { renderJobs(); $('jobName').value = state.jobName || ''; $('jobsDlg').hidden = false; document.body.classList.add('noscroll'); $('jobName').focus(); });
const closeJobs = () => { $('jobsDlg').hidden = true; document.body.classList.remove('noscroll'); };
$('jobsX').addEventListener('click', closeJobs);
$('jobsDlg').addEventListener('click', (e) => { if (e.target === $('jobsDlg')) closeJobs(); });
$('jobsDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeJobs(); });
$('jobForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('jobName').value.trim() || `Zakázka ${new Date().toLocaleDateString('cs-CZ')}`;
  const list = jobs().filter((j) => j.name !== name);
  state.jobName = name;
  list.unshift({ name, date: Date.now(), data: JSON.parse(JSON.stringify(state)) });
  if (!store.set(JOBS, list)) return toast('Uložení se nepovedlo – paměť prohlížeče je plná nebo zakázaná.');
  save(); renderJobName(); renderJobs(); toast(`Zakázka „${name}“ uložena.`);
});
$('jobList').addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]'), d = e.target.closest('[data-jdel]');
  const list = jobs();
  if (o) { state = JSON.parse(JSON.stringify(list[+o.dataset.open].data)); state.example = false; if (!UNITS[state.unit]) state.unit = 'mm'; setUnit(state.unit); state.jobName = list[+o.dataset.open].name; renderStatic(); renderPieces(); schedule(); closeJobs(); toast(`Otevřena zakázka „${list[+o.dataset.open].name}“.`); }
  if (d) { const [rm] = list.splice(+d.dataset.jdel, 1); store.set(JOBS, list); renderJobs(); toast(`Zakázka „${rm.name}“ smazána.`, () => { const l = jobs(); l.splice(+d.dataset.jdel, 0, rm); store.set(JOBS, l); renderJobs(); }); }
});
$('jobNew').addEventListener('click', () => {
  state = Object.assign(example(), { pieces: [], example: false, jobName: '', unit: state.unit, W: state.W, L: state.L, mode: state.mode, cut: state.cut, kerf: state.kerf });
  renderStatic(); renderPieces(); schedule(); closeJobs(); editPiece(-1);
});

/* ---------- sklad zbytků ---------- */
// Položka: { id, w: šířka mm, l: délka mm, q: kusů, note, job, date }
const stock = () => store.get(STOCK) || [];
function addStock(w, l, q, note, job) {
  const list = stock();
  const same = list.find((s) => s.w === w && s.l === l && (s.note || '') === note);
  if (same) { same.q += q; same.date = Date.now(); } else list.unshift({ id: Date.now().toString(36), w, l, q, note, job, date: Date.now() });
  if (!store.set(STOCK, list)) return toast('Uložení se nepovedlo – paměť prohlížeče je plná nebo zakázaná.');
  renderStockBadge(); if (!$('stockDlg').hidden) renderStock();
  toast(`Do skladu: ${q > 1 ? q + '× ' : ''}${fmt(w)} × ${fmt(l)} ${U()}`, () => {
    const L = stock(), it = L.find((s) => s.w === w && s.l === l && (s.note || '') === note);
    if (it) { it.q -= q; store.set(STOCK, L.filter((s) => s.q > 0)); renderStockBadge(); if (!$('stockDlg').hidden) renderStock(); }
  });
}
function renderStockBadge() { const n = stock().reduce((a, s) => a + s.q, 0); $('stockN').textContent = n; $('stockN').hidden = !n; }
function stockThumb(s) {
  const k = 34 / Math.max(s.w, s.l), w = Math.max(3, s.l * k), h = Math.max(3, s.w * k);
  return `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><rect x="${(40 - w) / 2}" y="${(40 - h) / 2}" width="${w}" height="${h}" class="st-r"/></svg>`;
}
function renderStock() {
  const list = stock().sort((a, b) => b.w * b.l - a.w * a.l);
  store.set(STOCK, list);
  const n = list.reduce((a, s) => a + s.q, 0), area = list.reduce((a, s) => a + s.w * s.l * s.q, 0);
  $('stockSum').textContent = n ? `${n} ${plural(n, 'kus', 'kusy', 'kusů')} · ${m2(area)} m²` : '';
  $('stockList').innerHTML = list.length ? list.map((s, k) => `<div class="stock">
    ${stockThumb(s)}
    <div class="st-i"><b class="mono">${fmt(s.w)} × ${fmt(s.l)} ${U()}</b><span class="hint">${m2(s.w * s.l)} m²${s.note ? ' · ' + esc(s.note) : ''}${s.job ? ' · z „' + esc(s.job) + '“' : ''}</span></div>
    <span class="st-q">${s.q}×</span>
    <button type="button" class="btn ghost sm" data-use="${k}" title="Nastavit tenhle zbytek jako plech a poskládat na něj díly">Použít</button>
    <button type="button" class="del" data-sdel="${k}" aria-label="Ubrat jeden kus ${fmt(s.w)} × ${fmt(s.l)}" title="Ubrat kus (spotřebovaný)">−</button>
  </div>`).join('') : '<p class="hint st-empty">Sklad je prázdný.</p>';
}
$('btnStock').addEventListener('click', () => { renderStock(); syncUnits(); $('stockDlg').hidden = false; document.body.classList.add('noscroll'); $('stW').focus(); });
const closeStock = () => { $('stockDlg').hidden = true; document.body.classList.remove('noscroll'); };
$('stockX').addEventListener('click', closeStock);
$('stockDlg').addEventListener('click', (e) => { if (e.target === $('stockDlg')) closeStock(); });
$('stockDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeStock(); });
$('stockForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const w = lenv($('stW').value), l = lenv($('stL').value);
  $('stW').classList.toggle('bad', !(w > 0)); $('stL').classList.toggle('bad', !(l > 0));
  if (!(w > 0 && l > 0)) return;
  addStock(Math.round(w), Math.round(l), 1, $('stNote').value.trim(), '');
  $('stW').value = ''; $('stL').value = ''; $('stW').focus();
});
$('stockList').addEventListener('click', (e) => {
  const u = e.target.closest('[data-use]'), d = e.target.closest('[data-sdel]');
  const list = stock();
  if (u) {
    const s = list[+u.dataset.use];
    state.mode = 'sheet'; state.W = toUnit(s.w); state.L = toUnit(s.l); state.manual = null;
    renderStatic(); schedule(); closeStock(); setView('plan');
    toast(`Plech nastaven na zbytek ${fmt(s.w)} × ${fmt(s.l)} ${U()}.`);
  }
  if (d) {
    const k = +d.dataset.sdel, s = list[k], old = JSON.parse(JSON.stringify(list));
    s.q -= 1; store.set(STOCK, list.filter((x) => x.q > 0)); renderStock(); renderStockBadge();
    toast(`Ze skladu ubrán kus ${fmt(s.w)} × ${fmt(s.l)} ${U()}.`, () => { store.set(STOCK, old); renderStock(); renderStockBadge(); });
  }
});

/* ---------- tisk ---------- */
$('btnPrint').addEventListener('click', () => window.print());
window.addEventListener('beforeprint', () => document.querySelectorAll('#sheets details').forEach((d) => { d.dataset.wasOpen = d.open ? '1' : ''; d.open = true; }));
window.addEventListener('afterprint', () => document.querySelectorAll('#sheets details').forEach((d) => { if (d.dataset.wasOpen === '') d.open = false; }));

/* ---------- toast ---------- */
let toastT = null;
function toast(text, undo) {
  const t = $('toast');
  t.innerHTML = `<span>${esc(text)}</span>${undo ? '<button type="button" class="link" id="toastUndo">Vrátit</button>' : ''}`;
  t.hidden = false; clearTimeout(toastT);
  if (undo) $('toastUndo').onclick = () => { undo(); t.hidden = true; };
  toastT = setTimeout(() => { t.hidden = true; }, undo ? 6000 : 3000);
}

/* ---------- instalace jako aplikace ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('btnInstall').hidden = false; });
$('btnInstall').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('btnInstall').hidden = true; });
window.addEventListener('appinstalled', () => { $('btnInstall').hidden = true; toast('Aplikace je nainstalovaná.'); });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

/* ---------- start ---------- */
applyTheme();
renderStockBadge();
initEditor();
renderStatic();
renderPieces();
solve();
