// Vykreslení výsledků: souhrn, výkresy tabulí (SVG), postup střihu, rozměření dílů.
import { fmt, m2, pct, plural, esc, $ } from './format.js';
import { polyXform } from './nest-engine.js';
import { pathD, labelSpot } from './shapes.js';
import { EPS, coilExact } from './rect-engine.js';

let uid = 0;

/* ---------- společné ---------- */
export function updateStatus(running, tried, note) {
  const el = $('status'); if (!el) return;
  el.className = 'status' + (running ? ' run' : '');
  el.innerHTML = `<i class="dot"></i>${running ? 'Hledám lepší rozložení… ' : 'Hotovo. '}Vyzkoušeno ${tried.toLocaleString('cs-CZ')} variant.${note ? ' ' + note : ''}`;
}

export function renderWarns(P) {
  const out = [];
  if (P.errs?.length) out.push(`<div class="warn"><b>Chybí zadání.</b> ${P.errs.map(esc).join(' ')}</div>`);
  if (P.bad?.length) out.push(`<div class="warn"><b>Tyhle díly mají chybné rozměry:</b><ul>${P.bad.map((d) => `<li>${esc(d.name)}: ${esc(d.err)}</li>`).join('')}</ul></div>`);
  if (P.invalid?.length) {
    const what = P.coil ? 'svitek' : 'tabuli';
    out.push(`<div class="warn"><b>Tyhle díly se nevejdou na ${what}:</b><ul>${P.invalid.map((d) => `<li>${esc(d.name || d.shapeName)} <span class="mono">${esc(d.sum)}</span>${d.wouldRot ? ' – otočený by se vešel, zapni „otáčet“' : ''}</li>`).join('')}</ul></div>`);
  }
  $('warns').innerHTML = out.join('');
}

export function renderEmpty(mode) {
  $('tools').hidden = true; $('sheets').innerHTML = '';
  $('summary').innerHTML = `<div class="empty"><svg viewBox="0 0 64 44" aria-hidden="true"><rect x="2" y="2" width="60" height="40" rx="2" class="em-s"/><path d="M22 2v40M22 22h40" class="em-c"/></svg><b>Zatím není co skládat</b><span>Zadej rozměr ${mode === 'coil' ? 'svitku' : 'tabule'} a přidej aspoň jeden díl. Plán se spočítá sám.</span></div>`;
}

function summaryHTML(o) {
  const tile = (k, v, s = '', cls = '') => `<div class="kpi ${cls}"><span class="k">${k}</span><span class="v">${v}</span>${s}</div>`;
  const main = o.coil
    ? tile('Odvinout ze svitku', `${(o.len / 1000).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<small>m</small>`, `<span class="s">šíře ${fmt(o.Y)} mm</span>`, 'main')
    : tile('Potřebuješ', `${o.n}<small>${plural(o.n, 'tabuli', 'tabule', 'tabulí')}</small>`, `<span class="s">${fmt(o.Y)} × ${fmt(o.X)} mm</span>`, 'main');
  let tiles = main
    + tile('Využití plechu', pct(o.util), `<span class="meter"><i style="width:${Math.min(100, o.util * 100).toFixed(1)}%"></i></span>`)
    + tile('Odpad a zbytky', m2(Math.max(0, o.total - o.pieceArea)) + ' m²', `<span class="s">z ${m2(o.total)} m² plechu</span>`);
  const extra = (o.extra || []).slice();
  const first = extra.shift();
  tiles += first ? tile(first[0], first[1], `<span class="s">${o.count} ${plural(o.count, 'díl', 'díly', 'dílů')}</span>`) : tile('Dílů', String(o.count));
  for (const [k, v] of extra) tiles += tile(k, v);
  return `<div class="sumbox"><div class="kpis">${tiles}</div><div class="status" id="status"></div></div>`;
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
    + `<text x="${X / 2}" y="${ty}" class="sv-dim" font-size="${fs}" text-anchor="middle">${coil ? 'délka ' : ''}${fmt(X)} mm</text>`
    + `<line x1="${-pad * 0.2}" y1="0" x2="${-pad * 0.2}" y2="${Y}" class="sv-dl" vector-effect="non-scaling-stroke"/>`
    + `<text x="${tx}" y="${Y / 2}" class="sv-dim" font-size="${fs}" text-anchor="middle" transform="rotate(-90 ${tx} ${Y / 2})">${fmt(Y)} mm</text>`;
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
  const btn = running ? '' : `<button type="button" class="btn ghost sm" data-manual="${g.from - 1}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5v15M2.5 10h15M10 2.5l-2.2 2.2M10 2.5l2.2 2.2M10 17.5l-2.2-2.2M10 17.5l2.2-2.2M2.5 10l2.2-2.2M2.5 10l2.2 2.2M17.5 10l-2.2-2.2M17.5 10l-2.2 2.2" class="ico"/></svg>Poskládat ručně</button>`;
  const tags = meta.split(' · ').map((t) => `<span class="tag">${t}</span>`).join('');
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
  const offs = [];
  res.sheets.forEach((s) => { for (const f of s.free) { const rw = Math.min(f.x + f.w - k, X) - f.x, rh = f.h - k; if (rw >= 100 && rh >= 100) offs.push({ w: rw, h: rh }); } });
  offs.sort((a, b) => b.w * b.h - a.w * a.h);
  const extra = [];
  if (offs[0] && P.cut === 'g') extra.push(['Největší zbytek', `${fmt(offs[0].h)} × ${fmt(offs[0].w)}`]);
  if (res.unplaced.length) extra.push(['Nevešlo se', String(res.unplaced.length)]);
  $('summary').innerHTML = summaryHTML({ coil: P.coil, n: nS, X: P.X, Y: P.Y, len: X, util: total ? pieceArea / total : 0, total, pieceArea, count, extra });
  updateStatus(running, best.tried || 0);
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
    if (P.coil && exact) items.push(`<li>Odviň a ustřihni ze svitku <span class="mono">${fmt(X)} mm</span>.</li>`);
    steps.forEach((n) => items.push(`<li>${stepText(n, P, X)}</li>`));
    cuts = items.length ? `<details class="cuts"${g.from === 1 ? ' open' : ''}><summary>Postup střihu · ${items.length} ${plural(items.length, 'krok', 'kroky', 'kroků')}</summary><ol>${items.join('')}</ol></details>` : '';
  } else cuts = `<p class="hint">Při volném řezu vyřež díly podle výkresu.</p>`;
  const meta = `využití ${pct(pa / (X * P.Y))} · ${s.placed.length} ${plural(s.placed.length, 'díl', 'díly', 'dílů')}`;
  return `<article class="sheet">${cardHead(g, P, meta, false)}<div class="svgbox">${svg}</div>${cuts}</article>`;
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
  return `${from}: střih ${n.dir === 'v' ? 'napříč' : 'podélně'} na <span class="mono">${fmt(off)} mm</span> → ${partLabel(n.a, P, X)} a ${partLabel(n.b, P, X)}`;
}
function rectSVG(s, P, X, nums, showCuts) {
  const k = P.kerf, Y = P.Y, M = Math.max(X, Y), fs = M / 42, pad = fs * 2.3, minF = M / 150;
  const o = [`<rect x="0" y="0" width="${X}" height="${Y}" class="sv-steel"/>`];
  if (P.cut === 'g') for (const f of s.free) {
    const rw = Math.min(f.x + f.w - k, X) - f.x, rh = f.h - k;
    if (rw < 20 || rh < 20) continue;
    o.push(`<rect x="${f.x}" y="${f.y}" width="${rw}" height="${rh}" class="sv-off" vector-effect="non-scaling-stroke"/>`);
    if (rw >= 80 && rh >= 80) o.push(fitText(['zbytek', `${fmt(rh)} × ${fmt(rw)}`], f.x + rw / 2, f.y + rh / 2, rw, rh, fs * 0.7, minF, 'sv-to', 'sv-ton'));
  } else {
    let big = null;
    for (const f of s.free) { const rw = Math.min(f.x + f.w - k, X) - f.x, rh = f.h - k; if (rw > 0 && rh > 0 && (!big || rw * rh > big.a)) big = { f, rw, rh, a: rw * rh }; }
    if (big && big.rw >= 80 && big.rh >= 80) {
      o.push(`<rect x="${big.f.x}" y="${big.f.y}" width="${big.rw}" height="${big.rh}" class="sv-off" vector-effect="non-scaling-stroke"/>`);
      o.push(fitText([`zbytek ${fmt(big.rh)}×${fmt(big.rw)}`], big.f.x + big.rw / 2, big.f.y + big.rh / 2, big.rw, big.rh, fs * 0.85, minF, 'sv-to'));
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
  const extra = [];
  if (!P.coil && nS) { const rem = X - exts[nS - 1]; if (rem >= 100) extra.push(['Celý zbytek', `${fmt(P.Y)} × ${fmt(Math.floor(rem))}`]); }
  if (L.unplaced.length) extra.push([L.manual ? 'V zásobníku' : 'Nevešlo se', String(L.unplaced.length)]);
  $('summary').innerHTML = summaryHTML({ coil: P.coil, n: nS, X: P.X, Y: P.Y, len: X, util: total ? pieceArea / total : 0, total, pieceArea, count, extra });
  if (L.manual) { const el = $('status'); el.className = 'status man-on'; el.innerHTML = `<i class="dot"></i>Ručně poskládáno. <button type="button" class="link" id="backAuto">Spočítat znovu automaticky</button>`; }
  else updateStatus(running, L.tried || 0, L.cell ? `Přesnost skládání ${fmt(L.cell)} mm.` : '');
  showTools(false);
  const sig = (s) => s.map((p) => `${p.i},${p.deg},${Math.round(p.x)},${Math.round(p.y)}`).sort().join('|');
  const sheets = L.sheets.map((s, k) => ({ placed: s, ext: exts[k] }));
  $('sheets').innerHTML = groupSheets(sheets, (s) => sig(s.placed)).map((g) => nestCard(g, P, X, running)).join('');
}

function nestCard(g, P, X, running) {
  const s = g.s, J = P.J, Y = P.Y;
  const M = Math.max(X, Y), fs = M / 42, pad = fs * 2.3, minF = M / 150;
  const o = [`<rect x="0" y="0" width="${X}" height="${Y}" class="sv-steel"/>`];
  let pa = 0;
  if (!P.coil) {
    const rem = X - s.ext;
    if (rem >= 30) {
      o.push(`<rect x="${s.ext}" y="0" width="${rem}" height="${Y}" class="sv-off" vector-effect="non-scaling-stroke"/>`);
      if (rem >= 100) o.push(fitText(['ZBYTEK', `${fmt(Y)} × ${fmt(Math.floor(rem))} mm`], s.ext + rem / 2, Y / 2, rem, Y, fs * 0.75, minF, 'sv-to', 'sv-ton'));
    }
  }
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
  const rows = pos.map((p, k) => `<tr><td class="n">${k + 1}</td><td class="d">${pc(p.info.ci)}<b>${esc(p.info.name || p.info.shapeName)}</b><span class="mono">${esc(p.info.sum)}</span></td><td class="mm">${fmt(p.ox)}</td><td class="mm">${fmt(p.oy)}</td><td class="r">${p.deg ? `↻ ${p.deg}°` : '–'}</td></tr>`).join('');
  const meta = `využití ${pct(pa / (X * Y))} · ${s.placed.length} ${plural(s.placed.length, 'díl', 'díly', 'dílů')}`;
  return `<article class="sheet">${cardHead(g, P, meta, running)}<div class="svgbox">${svgWrap(X, Y, pad, o.join(''))}</div>`
    + `<details class="cuts"${g.from === 1 ? ' open' : ''}><summary>Kde díly orýsovat · ${s.placed.length}</summary><p class="hint">Vzdálenosti v mm k levému hornímu rohu obrysu dílu, tak jak je nakreslený ve výkresu.</p><div class="tabwrap"><table class="postab"><thead><tr><th>#</th><th>Díl</th><th class="mm">Od levého kraje</th><th class="mm">Od horní hrany</th><th class="r">Otočit</th></tr></thead><tbody>${rows}</tbody></table></div></details></article>`;
}

function showTools(cuts) {
  $('tools').hidden = false;
  $('lgCut').hidden = !cuts;
  $('cutsToggle').hidden = !cuts;
}
