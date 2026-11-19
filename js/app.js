"use strict";
const $ = id => document.getElementById(id);
const RES = 20;               // raster resolution, pixels per mm
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Segoe UI Symbol",sans-serif';
const images = [];            // {name, img}
let tiles = [];               // generated tiles
let customFontCounter = 0;

function P() {
  const n = id => parseFloat($(id).value);
  return {
    phrase: $('phrase').value, font: $('font').value, weight: $('weight').value,
    height: n('height'), iconHeight: n('iconHeight'), thick: n('thick'),
    pitch: n('pitch'), pegStyle: $('pegStyle').value, tabW: n('tabW'), tabH: n('tabH'), pinD: n('pinD'),
    pegL: n('pegL'), margin: n('margin'), maxPegs: Math.max(1, Math.round(n('maxPegs'))), offset: n('offset'),
    imgMode: $('imgMode').value, thresh: n('thresh'),
    which: $('which').value, copies: Math.max(1, Math.round(n('copies'))),
    bedX: n('bedX'), bedY: n('bedY'), gap: n('gap'),
  };
}

/* ---------------- Rasterising glyphs / images to a binary mask ---------------- */
const scratch = document.createElement('canvas');
const sctx = scratch.getContext('2d', { willReadFrequently: true });

// returns {mask, w, h, baseline} ; baseline = pixel row of the text baseline
function maskFromCanvas(ctx, w, h, test, baselineRow, baselineIsBottom) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  const full = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (test(d[i], d[i + 1], d[i + 2], d[i + 3])) {
      full[y * w + x] = 1;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const pad = 1, cw = x1 - x0 + 1 + 2 * pad, ch = y1 - y0 + 1 + 2 * pad;
  const mask = new Uint8Array(cw * ch);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
    mask[(y - y0 + pad) * cw + (x - x0 + pad)] = full[y * w + x];
  const baseline = baselineIsBottom ? ch - pad : baselineRow - y0 + pad;
  return { mask, w: cw, h: ch, baseline };
}

function rasterGlyph(ch, p, isEmoji) {
  const family = isEmoji ? EMOJI_FONT : p.font + ', ' + EMOJI_FONT;
  const weight = isEmoji ? 400 : p.weight;
  sctx.font = `${weight} 200px ${family}`;
  let fpx;
  if (isEmoji) {
    const m = sctx.measureText(ch);
    const hh = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || 200;
    fpx = 200 * p.iconHeight * RES / hh;
  } else {
    const cap = sctx.measureText('H').actualBoundingBoxAscent || 140;
    fpx = 200 * p.height * RES / cap;
  }
  sctx.font = `${weight} ${fpx}px ${family}`;
  const m = sctx.measureText(ch);
  const pad = Math.ceil(fpx * 0.15) + 4;
  const L = Math.ceil(Math.max(m.actualBoundingBoxLeft || 0, 0)), R = Math.ceil(Math.max(m.actualBoundingBoxRight || m.width, 1));
  const A = Math.ceil(Math.max(m.actualBoundingBoxAscent || fpx, 1)), D = Math.ceil(Math.max(m.actualBoundingBoxDescent || 0, 0));
  const w = L + R + 2 * pad, h = A + D + 2 * pad;
  scratch.width = w; scratch.height = h;
  sctx.clearRect(0, 0, w, h);
  sctx.font = `${weight} ${fpx}px ${family}`;
  sctx.textBaseline = 'alphabetic';
  sctx.fillStyle = '#000';
  sctx.fillText(ch, pad + L, pad + A);
  return maskFromCanvas(sctx, w, h, (r, g, b, a) => a >= 128, pad + A, isEmoji);
}

function imageTest(p, hasAlpha) {
  let mode = p.imgMode;
  if (mode === 'auto') mode = hasAlpha ? 'alpha' : 'dark';
  const t = p.thresh;
  if (mode === 'alpha') return (r, g, b, a) => a >= t;
  if (mode === 'dark') return (r, g, b, a) => a >= 128 && (0.299 * r + 0.587 * g + 0.114 * b) < t;
  return (r, g, b, a) => a >= 128 && (0.299 * r + 0.587 * g + 0.114 * b) >= t;
}

function rasterImage(img, p) {
  const ih = img.naturalHeight || img.height || 100, iw = img.naturalWidth || img.width || 100;
  // first find the content bbox at native-ish resolution, then scale so the traced content is iconHeight tall
  const probeScale = Math.min(1, 1000 / Math.max(iw, ih));
  let w = Math.max(1, Math.round(iw * probeScale)), h = Math.max(1, Math.round(ih * probeScale));
  scratch.width = w; scratch.height = h; sctx.clearRect(0, 0, w, h); sctx.drawImage(img, 0, 0, w, h);
  const d = sctx.getImageData(0, 0, w, h).data;
  let hasAlpha = false; for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { hasAlpha = true; break; }
  const test = imageTest(p, hasAlpha);
  const probe = maskFromCanvas(sctx, w, h, test, 0, true);
  if (!probe) return null;
  const contentH = probe.h - 2;
  const scale = (p.iconHeight * RES) / contentH * probeScale;
  w = Math.max(1, Math.round(iw * scale)); h = Math.max(1, Math.round(ih * scale));
  if (w * h > 1600 * 1600) { const k = 1600 / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
  scratch.width = w; scratch.height = h; sctx.clearRect(0, 0, w, h);
  sctx.imageSmoothingQuality = 'high'; sctx.drawImage(img, 0, 0, w, h);
  return maskFromCanvas(sctx, w, h, test, 0, true);
}

/* ---------------- Tracing a binary mask into polygons ---------------- */
function trace(mask, w, h) {
  const W = w + 1, E = [], out = new Map();
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const add = (x0, y0, x1, y1) => {
    const id = E.length >> 2; E.push(x0, y0, x1, y1);
    const k = y0 * W + x0; let a = out.get(k); if (!a) out.set(k, a = []); a.push(id);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (!at(x, y - 1)) add(x, y, x + 1, y);
    if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!at(x - 1, y)) add(x, y + 1, x, y);
  }
  const n = E.length >> 2, used = new Uint8Array(n), loops = [];
  for (let s = 0; s < n; s++) {
    if (used[s]) continue;
    const loop = []; let cur = s;
    for (;;) {
      used[cur] = 1;
      const x0 = E[cur * 4], y0 = E[cur * 4 + 1], x1 = E[cur * 4 + 2], y1 = E[cur * 4 + 3];
      loop.push([x0, y0]);
      const cands = out.get(y1 * W + x1).filter(id => !used[id] || id === s);
      if (!cands.length) break;
      let next = cands[0];
      if (cands.length > 1) {           // saddle: keep diagonal pixels separate (turn right)
        const dx = x1 - x0, dy = y1 - y0;
        for (const c of cands) {
          const ex = E[c * 4 + 2] - E[c * 4], ey = E[c * 4 + 3] - E[c * 4 + 1];
          if (dx * ey - dy * ex > 0) { next = c; break; }
        }
      }
      if (next === s) break;
      cur = next;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}
function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function dpSimplify(pts, eps) {   // Douglas-Peucker on an open polyline
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / len;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplifyClosed(loop, eps) {
  let far = 0, fd = -1;
  for (let i = 1; i < loop.length; i++) { const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const a = dpSimplify(loop.slice(0, far + 1), eps);
  const b = dpSimplify(loop.slice(far).concat([loop[0]]), eps);
  const r = a.concat(b.slice(1, -1));
  return r.length >= 3 ? r : loop;
}

// mask -> list of {outer:[[x,y]...], holes:[[...]]} in mm, y up, baseline at y=0
function maskToShapes(m) {
  const loops = trace(m.mask, m.w, m.h);
  const outers = [], holes = [];
  for (const l of loops) {
    const a = signedArea(l);
    if (Math.abs(a) < 2) continue;                // ignore specks (< 2 px²)
    (a > 0 ? outers : holes).push({ raw: l, area: Math.abs(a), holes: [] });
  }
  for (const h of holes) {                        // find the smallest outer containing this hole
    const [x0, y0] = h.raw[0], [x1, y1] = h.raw[1];
    const dx = x1 - x0, dy = y1 - y0;
    const tx = x0 + dx / 2 + dy * 0.5, ty = y0 + dy / 2 - dx * 0.5;
    let best = null;
    for (const o of outers) if (o.area > h.area && pointInPoly(tx, ty, o.raw) && (!best || o.area < best.area)) best = o;
    if (best) best.holes.push(h);
  }
  const toMM = (l, wantCCW) => {
    let pts = simplifyClosed(l, 0.8).map(([x, y]) => [x / RES, (m.baseline - y) / RES]);
    if ((signedArea(pts) > 0) !== wantCCW) pts.reverse();
    return pts;
  };
  return outers.map(o => ({ outer: toMM(o.raw, true), holes: o.holes.map(h => toMM(h.raw, false)) }));
}

/* ---------------- Peg placement ---------------- */
function findPegs(m, p, shiftMM) {
  const fw = p.pegStyle === 'tab' ? p.tabW : p.pinD;   // footprint width (along groove)
  const fh = p.pegStyle === 'tab' ? p.tabH : p.pinD;   // footprint height (across groove)
  const needW = (fw + 2 * p.margin) * RES, halfH = (fh / 2 + p.margin) * RES;
  const yMinMM = -(m.h - m.baseline) / RES, yMaxMM = m.baseline / RES;
  const cands = [];
  let k0 = Math.floor((yMinMM - p.offset - shiftMM) / p.pitch);
  for (let k = k0; ; k++) {
    const yMM = p.offset + shiftMM + k * p.pitch;
    if (yMM > yMaxMM) break;
    if (yMM < yMinMM) continue;
    const py = m.baseline - yMM * RES;
    const ya = Math.floor(py - halfH), yb = Math.ceil(py + halfH);
    if (ya < 0 || yb >= m.h) continue;
    let run = -1;
    for (let x = 0; x <= m.w; x++) {
      let ok = x < m.w;
      if (ok) for (let y = ya; y <= yb; y++) if (!m.mask[y * m.w + x]) { ok = false; break; }
      if (ok && run < 0) run = x;
      if (!ok && run >= 0) {
        const len = x - run;
        if (len >= needW) {
          const c = (run + x) / 2 / RES;
          cands.push({ x: c, y: yMM, w: len / RES });
          if (len >= 3 * needW) {            // long runs: also offer both ends (good for wide letters)
            const e = (needW / 2) / RES;
            cands.push({ x: run / RES + e, y: yMM, w: len / RES }, { x: x / RES - e, y: yMM, w: len / RES });
          }
        }
        run = -1;
      }
    }
  }
  if (!cands.length) return [];
  // centre of mass of the shape
  let sx = 0, cnt = 0;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.mask[y * m.w + x]) { sx += x; cnt++; }
  const cx = sx / cnt / RES;
  const chosen = [cands.reduce((b, c) => Math.abs(c.x - cx) - c.w * 0.05 < Math.abs(b.x - cx) - b.w * 0.05 ? c : b)];
  while (chosen.length < p.maxPegs) {
    let best = null, bd = 0;
    for (const c of cands) {
      const d = Math.min(...chosen.map(s => Math.hypot(s.x - c.x, s.y - c.y)));
      if (d > bd) { bd = d; best = c; }
    }
    if (!best || bd < Math.max(4, fw * 3)) break;
    chosen.push(best);
  }
  return chosen;
}

/* ---------------- Mesh building ---------------- */
function newMesh() { return { pos: [], idx: [] }; }
function extrude(mesh, outer, holes, z0, z1) {
  const flat = [], holeIdx = [], rings = [outer, ...holes];
  for (const r of rings) { if (r !== outer) holeIdx.push(flat.length / 2); for (const q of r) flat.push(q[0], q[1]); }
  const tris = earcut(flat, holeIdx, 2);
  const n = flat.length / 2, base = mesh.pos.length / 3;
  for (let i = 0; i < n; i++) mesh.pos.push(flat[2 * i], flat[2 * i + 1], z0);
  for (let i = 0; i < n; i++) mesh.pos.push(flat[2 * i], flat[2 * i + 1], z1);
  for (let t = 0; t < tris.length; t += 3) {
    let a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const cr = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) - (flat[2 * b + 1] - flat[2 * a + 1]) * (flat[2 * c] - flat[2 * a]);
    if (cr < 0) { const tmp = b; b = c; c = tmp; }
    mesh.idx.push(base + n + a, base + n + b, base + n + c);   // top (+z)
    mesh.idx.push(base + a, base + c, base + b);               // bottom (-z)
  }
  let o = 0;
  for (const r of rings) {
    const L = r.length;
    for (let i = 0; i < L; i++) {
      const a = base + o + i, b = base + o + (i + 1) % L;
      mesh.idx.push(a, b, b + n, a, b + n, a + n);
    }
    o += L;
  }
}
function rectPoly(cx, cy, w, h) { return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]]; }
function circlePoly(cx, cy, r, n = 24) { const a = []; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; a.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } return a; }

function buildTile(label, m, p) {
  const t = { label, mask: m, pegs: [], shift: 0, warn: null };
  t.shapes = maskToShapes(m);
  t.pegs = findPegs(m, p, 0);
  if (!t.pegs.length) {                 // try nudging the glyph up/down to reach a groove
    for (let s = 0.25; s <= p.pitch / 2 + 1e-6 && !t.pegs.length; s += 0.25)
      for (const sg of [s, -s]) { const pg = findPegs(m, p, sg); if (pg.length) { t.pegs = pg; t.shift = sg; break; } }
    if (t.pegs.length) t.warn = `"${label}" has no solid spot on the groove grid – it sits ${Math.abs(t.shift).toFixed(2)} mm ${t.shift > 0 ? 'lower' : 'higher'} than the other letters.`;
    else t.warn = `"${label}": no spot is wide enough for a peg (try a bolder font, bigger letters, smaller pegs or a smaller margin). Generated without pegs.`;
  }
  const mesh = newMesh();
  for (const s of t.shapes) extrude(mesh, s.outer, s.holes, 0, p.thick);
  const overlap = Math.min(0.4, p.thick / 2);
  for (const pg of t.pegs) {
    const poly = p.pegStyle === 'tab' ? rectPoly(pg.x, pg.y, p.tabW, p.tabH) : circlePoly(pg.x, pg.y, p.pinD / 2);
    extrude(mesh, poly, [], -p.pegL, overlap);
  }
  t.mesh = mesh;               // natural orientation: front face at z = thick, pegs towards -z
  return t;
}

/* ---------------- Phrase parsing ---------------- */
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter() : null;
const isEmoji = s => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s);
function parsePhrase(text) {   // -> lines of items {type:'char'|'space'|'img', value}
  return text.split('\n').map(line => {
    const items = [];
    for (const part of line.split(/(\{\d+\})/)) {
      const mm = part.match(/^\{(\d+)\}$/);
      if (mm) { items.push({ type: 'img', value: parseInt(mm[1]) }); continue; }
      const chars = seg ? [...seg.segment(part)].map(s => s.segment) : Array.from(part);
      for (const c of chars) items.push(/^\s+$/.test(c) ? { type: 'space' } : { type: 'char', value: c });
    }
    return items;
  });
}

/* ---------------- Generate ---------------- */
async function generate() {
  const p = P();
  $('pitchLbl').textContent = p.pitch;
  document.querySelectorAll('.tabonly').forEach(e => e.style.display = p.pegStyle === 'tab' ? '' : 'none');
  document.querySelectorAll('.roundonly').forEach(e => e.style.display = p.pegStyle === 'round' ? '' : 'none');
  $('status').textContent = 'generating…';
  try { await document.fonts.load(`${p.weight} 40px ${p.font}`, 'AHgy'); } catch (e) {}
  const lines = parsePhrase(p.phrase);
  const cache = new Map(), warnings = [];
  const getTile = it => {
    const key = it.type + ':' + it.value;
    if (cache.has(key)) return cache.get(key);
    let m = null, label = it.value;
    if (it.type === 'img') {
      const im = images[it.value - 1];
      label = `image ${it.value}`;
      if (!im) { warnings.push(`{${it.value}} – no image #${it.value} uploaded yet.`); cache.set(key, null); return null; }
      m = rasterImage(im.img, p);
    } else m = rasterGlyph(it.value, p, isEmoji(it.value));
    const t = m ? buildTile(label, m, p) : null;
    if (!m) warnings.push(`"${label}" rendered empty – skipped.`);
    if (t && t.warn) warnings.push(t.warn);
    cache.set(key, t);
    return t;
  };
  const layout = lines.map(line => line.map(it => it.type === 'space' ? { space: true } : { tile: getTile(it) }));
  // which tiles to print
  const list = [];
  const seen = new Set();
  for (const line of layout) for (const it of line) {
    if (!it.tile) continue;
    if (p.which === 'unique') { if (seen.has(it.tile)) continue; seen.add(it.tile); }
    for (let c = 0; c < p.copies; c++) list.push(it.tile);
  }
  tiles = list;
  drawBoard(layout, p);
  const placed = layoutPlate(list, p, warnings);
  viewer.setMeshes(placed, p);
  $('warnings').innerHTML = [...new Set(warnings)].map(w => `<li>${escapeHtml(w)}</li>`).join('');
  const nPegs = list.reduce((s, t) => s + t.pegs.length, 0);
  $('status').textContent = `${list.length} pieces, ${nPegs} pegs`;
  ['dl3mf', 'dlstl', 'dlzip'].forEach(id => $(id).disabled = !list.length);
  window.__placed = placed;
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// face-down print orientation + shelf packing on the bed
function layoutPlate(list, p, warnings) {
  const placed = [];
  let x = p.gap, y = p.gap, rowH = 0, overflow = false;
  for (const t of list) {
    const pos = t.mesh.pos;
    // rotate 180° about Y: (x,y,z) -> (-x, y, thick - z)
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const X = -pos[i], Y = pos[i + 1];
      if (X < minx) minx = X; if (X > maxx) maxx = X; if (Y < miny) miny = Y; if (Y > maxy) maxy = Y;
    }
    const w = maxx - minx, h = maxy - miny;
    if (x + w > p.bedX - p.gap && x > p.gap) { x = p.gap; y += rowH + p.gap; rowH = 0; }
    if (y + h > p.bedY) overflow = true;
    const dx = x - minx, dy = y - miny;
    const out = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) { out[i] = -pos[i] + dx; out[i + 1] = pos[i + 1] + dy; out[i + 2] = p.thick - pos[i + 2]; }
    placed.push({ label: t.label, pos: out, idx: t.mesh.idx });
    x += w + p.gap; rowH = Math.max(rowH, h);
  }
  if (overflow) warnings.push(`Pieces don't fit on one ${p.bedX}×${p.bedY} mm bed – split the job, or use the ZIP / 3MF and arrange in your slicer.`);
  return placed;
}

/* ---------------- 2D board preview ---------------- */
function drawBoard(layout, p) {
  const c = $('board'), ctx = c.getContext('2d');
  const spaceW = p.height * 0.45, letterGap = p.height * 0.08;
  const lineStep = Math.ceil((Math.max(p.height, p.iconHeight) * 1.45) / p.pitch) * p.pitch;
  let maxW = 0;
  const lineWidths = layout.map(line => {
    let w = 0;
    for (const it of line) w += it.space ? spaceW : it.tile ? it.tile.mask.w / RES + letterGap : 0;
    maxW = Math.max(maxW, w); return w;
  });
  const margin = 10, top = Math.max(p.height, p.iconHeight) * 1.15 + margin;
  const totalW = Math.max(maxW + 2 * margin, 120), totalH = top + (layout.length - 1) * lineStep + p.height * 0.5 + margin;
  const cssW = c.clientWidth || 800, scale = Math.min(cssW / totalW, 6);
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(totalW * scale * dpr); c.height = Math.round(totalH * scale * dpr);
  c.style.height = (totalH * scale) + 'px';
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.fillStyle = '#2b2b2b'; ctx.fillRect(0, 0, totalW, totalH);
  // grooves: baseline of line 0 is at y=top; grooves at baseline - offset - k*pitch
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 0.6;
  const g0 = top - p.offset;
  for (let y = g0 - Math.ceil(g0 / p.pitch) * p.pitch; y < totalH; y += p.pitch) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(totalW, y); ctx.stroke(); }
  layout.forEach((line, li) => {
    const base = top + li * lineStep;
    let x = margin + (maxW - lineWidths[li]) / 2;
    for (const it of line) {
      if (it.space) { x += spaceW; continue; }
      const t = it.tile; if (!t) continue;
      if (!t.img) t.img = maskImage(t.mask);
      const ty = base + t.shift - t.mask.baseline / RES;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(t.img, x, ty, t.mask.w / RES, t.mask.h / RES);
      ctx.fillStyle = '#e53935';
      for (const pg of t.pegs) {
        const px = x + pg.x, py = base + t.shift - pg.y;
        if (p.pegStyle === 'tab') ctx.fillRect(px - p.tabW / 2, py - p.tabH / 2, p.tabW, p.tabH);
        else { ctx.beginPath(); ctx.arc(px, py, p.pinD / 2, 0, 7); ctx.fill(); }
      }
      x += t.mask.w / RES + letterGap;
    }
  });
}
function maskImage(m) {
  const cv = document.createElement('canvas'); cv.width = m.w; cv.height = m.h;
  const cx = cv.getContext('2d'), id = cx.createImageData(m.w, m.h);
  for (let i = 0; i < m.mask.length; i++) if (m.mask[i]) { id.data[4 * i] = 245; id.data[4 * i + 1] = 245; id.data[4 * i + 2] = 240; id.data[4 * i + 3] = 255; }
  cx.putImageData(id, 0, 0); return cv;
}

/* ---------------- WebGL viewer ---------------- */
const viewer = (() => {
  const cv = $('gl'), gl = cv.getContext('webgl', { antialias: true });
  if (!gl) return { setMeshes() {} };
  const vs = `attribute vec3 p; attribute vec3 n; attribute vec3 c; uniform mat4 mvp; uniform float lit; varying vec3 vc;
    void main(){ gl_Position = mvp*vec4(p,1.0);
      vec3 L1 = normalize(vec3(0.4,-0.6,0.8)), L2 = normalize(vec3(-0.5,0.7,0.4));
      float d = 0.35 + 0.55*abs(dot(n,L1)) + 0.2*max(dot(n,L2),0.0);
      vc = mix(c, c*d, lit); }`;
  const fs = `precision mediump float; varying vec3 vc; void main(){ gl_FragColor = vec4(vc,1.0); }`;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
  const loc = { p: gl.getAttribLocation(prog, 'p'), n: gl.getAttribLocation(prog, 'n'), c: gl.getAttribLocation(prog, 'c'), mvp: gl.getUniformLocation(prog, 'mvp'), lit: gl.getUniformLocation(prog, 'lit') };
  let tri = null, triCount = 0, lines = null, lineCount = 0, center = [110, 110, 0], dist = 300, theta = -Math.PI / 2, phi = 0.9;
  const palette = [[0.85, 0.3, 0.25], [0.25, 0.5, 0.85], [0.95, 0.7, 0.2], [0.3, 0.7, 0.4], [0.6, 0.4, 0.8], [0.9, 0.5, 0.7]];
  function buf(data) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; }
  function setMeshes(placed, p) {
    const arr = [];
    placed.forEach((m, mi) => {
      const col = palette[mi % palette.length], P = m.pos, I = m.idx;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        for (const v of [a, b, c]) arr.push(P[v], P[v + 1], P[v + 2], nx, ny, nz, col[0], col[1], col[2]);
      }
    });
    if (tri) gl.deleteBuffer(tri);
    tri = buf(new Float32Array(arr)); triCount = arr.length / 9;
    const la = [], gc = [0.7, 0.7, 0.7], step = 10;
    for (let x = 0; x <= p.bedX + 1e-6; x += step) la.push(x, 0, 0, 0, 0, 1, ...gc, x, p.bedY, 0, 0, 0, 1, ...gc);
    for (let y = 0; y <= p.bedY + 1e-6; y += step) la.push(0, y, 0, 0, 0, 1, ...gc, p.bedX, y, 0, 0, 0, 1, ...gc);
    if (lines) gl.deleteBuffer(lines);
    lines = buf(new Float32Array(la)); lineCount = la.length / 9;
    let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
    for (const m of placed) for (let v = 0; v < m.pos.length; v += 3) { mx = Math.min(mx, m.pos[v]); Mx = Math.max(Mx, m.pos[v]); my = Math.min(my, m.pos[v + 1]); My = Math.max(My, m.pos[v + 1]); }
    if (placed.length) { center = [(mx + Mx) / 2, (my + My) / 2, 0]; dist = Math.max(60, Math.max(Mx - mx, My - my) * 1.5); }
    else { center = [p.bedX / 2, p.bedY / 2, 0]; dist = Math.max(p.bedX, p.bedY) * 1.4; }
    draw();
  }
  function persp(f, a, n, fa) { const t = 1 / Math.tan(f / 2); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0]; }
  function lookAt(e, c, u) {
    let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]]; let l = Math.hypot(...z); z = z.map(v => v / l);
    let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; l = Math.hypot(...x); x = x.map(v => v / l);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1];
  }
  function mul(a, b) { const r = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; r[i * 4 + j] = s; } return r; }
  function bind(b) {
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(loc.n); gl.vertexAttribPointer(loc.n, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(loc.c); gl.vertexAttribPointer(loc.c, 3, gl.FLOAT, false, 36, 24);
  }
  function draw() {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0.91, 0.91, 0.91, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
    const eye = [center[0] + dist * Math.cos(phi) * Math.cos(theta), center[1] + dist * Math.cos(phi) * Math.sin(theta), center[2] + dist * Math.sin(phi)];
    const mvp = mul(persp(0.8, w / Math.max(h, 1), 1, 5000), lookAt(eye, center, [0, 0, 1]));
    gl.useProgram(prog); gl.uniformMatrix4fv(loc.mvp, false, new Float32Array(mvp));
    if (lines) { bind(lines); gl.uniform1f(loc.lit, 0); gl.drawArrays(gl.LINES, 0, lineCount); }
    if (tri) { bind(tri); gl.uniform1f(loc.lit, 1); gl.drawArrays(gl.TRIANGLES, 0, triCount); }
  }
  let drag = null;
  cv.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!drag) return; const dx = e.clientX - drag[0], dy = e.clientY - drag[1]; drag[0] = e.clientX; drag[1] = e.clientY;
    theta -= dx * 0.01; phi = Math.min(1.55, Math.max(-1.55, phi + dy * 0.01)); draw();
  });
  cv.addEventListener('pointerup', () => drag = null);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => { e.preventDefault(); dist *= Math.exp(e.deltaY * 0.001); dist = Math.min(3000, Math.max(20, dist)); draw(); }, { passive: false });
  window.addEventListener('resize', draw);
  return { setMeshes };
})();

/* ---------------- Export: STL, 3MF, ZIP ---------------- */
function stlBinary(meshes) {
  let nt = 0; for (const m of meshes) nt += m.idx.length / 3;
  const buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf);
  const hdr = 'letterboard letters'; for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i));
  dv.setUint32(80, nt, true);
  let o = 84;
  for (const m of meshes) {
    const P = m.pos, I = m.idx;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true); o += 12;
      for (const v of [a, b, c]) { dv.setFloat32(o, P[v], true); dv.setFloat32(o + 4, P[v + 1], true); dv.setFloat32(o + 8, P[v + 2], true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
  }
  return new Uint8Array(buf);
}
function xmlEsc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])); }
function model3mf(meshes) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n<resources>\n'];
  meshes.forEach((m, i) => {
    out.push(`<object id="${i + 1}" name="${xmlEsc(m.label)}" type="model"><mesh><vertices>\n`);
    const P = m.pos;
    for (let v = 0; v < P.length; v += 3) out.push(`<vertex x="${+P[v].toFixed(4)}" y="${+P[v + 1].toFixed(4)}" z="${+P[v + 2].toFixed(4)}"/>\n`);
    out.push('</vertices><triangles>\n');
    const I = m.idx;
    for (let t = 0; t < I.length; t += 3) out.push(`<triangle v1="${I[t]}" v2="${I[t + 1]}" v3="${I[t + 2]}"/>\n`);
    out.push('</triangles></mesh></object>\n');
  });
  out.push('</resources>\n<build>\n');
  meshes.forEach((m, i) => out.push(`<item objectid="${i + 1}"/>\n`));
  out.push('</build>\n</model>\n');
  return new TextEncoder().encode(out.join(''));
}
function make3mf(meshes) {
  const te = new TextEncoder();
  return zip([
    { name: '[Content_Types].xml', data: te.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
    { name: '_rels/.rels', data: te.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
    { name: '3D/3dmodel.model', data: model3mf(meshes) },
  ]);
}
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC_T[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) {   // store-only zip
  const te = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const nm = te.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
    lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nm, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true);
    ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + sz;
  }
  const cdSize = central.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function safeName(s, i) {
  const t = s.replace(/[^A-Za-z0-9 _-]/g, ch => ch.codePointAt(0).toString(16)).replace(/\s+/g, '_');
  return `${String(i + 1).padStart(2, '0')}_${t || 'char'}`;
}
$('dlstl').onclick = () => download(new Blob([stlBinary(window.__placed)], { type: 'model/stl' }), 'letterboard_letters.stl');
$('dl3mf').onclick = () => download(make3mf(window.__placed), 'letterboard_letters.3mf');
$('dlzip').onclick = () => {
  const p = P();
  // individual STLs in print orientation, each moved to the origin
  const files = window.__placed.map((m, i) => {
    let mx = Infinity, my = Infinity; for (let v = 0; v < m.pos.length; v += 3) { mx = Math.min(mx, m.pos[v]); my = Math.min(my, m.pos[v + 1]); }
    const pos = m.pos.map((v, j) => j % 3 === 0 ? v - mx : j % 3 === 1 ? v - my : v);
    return { name: safeName(m.label, i) + '.stl', data: stlBinary([{ pos, idx: m.idx }]) };
  });
  download(zip(files), 'letterboard_letters.zip');
};

/* ---------------- UI wiring ---------------- */
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(() => generate().catch(e => { console.error(e); $('status').textContent = 'error: ' + e.message; }), 250); }
document.querySelectorAll('.controls input:not([type=file]), .controls select, .controls textarea').forEach(el => el.addEventListener('input', schedule));
$('fontfile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const name = 'UserFont' + (++customFontCounter);
  const face = new FontFace(name, await f.arrayBuffer());
  await face.load(); document.fonts.add(face);
  const opt = document.createElement('option'); opt.value = `"${name}"`; opt.textContent = f.name;
  $('font').appendChild(opt); $('font').value = opt.value; schedule();
});
$('imgfile').addEventListener('change', e => {
  for (const f of e.target.files) {
    const img = new Image();
    img.onload = () => { images.push({ name: f.name, img }); renderImgList(); schedule(); };
    img.src = URL.createObjectURL(f);
  }
  e.target.value = '';
});
function renderImgList() {
  $('imgList').innerHTML = '';
  images.forEach((im, i) => {
    const fig = document.createElement('figure'), cv = document.createElement('canvas');
    cv.width = 112; cv.height = 112; const c = cv.getContext('2d');
    const s = Math.min(112 / im.img.naturalWidth, 112 / im.img.naturalHeight);
    c.drawImage(im.img, (112 - im.img.naturalWidth * s) / 2, (112 - im.img.naturalHeight * s) / 2, im.img.naturalWidth * s, im.img.naturalHeight * s);
    fig.appendChild(cv); fig.appendChild(document.createTextNode(`{${i + 1}}`)); $('imgList').appendChild(fig);
  });
}
// built-in demo image {1}: a star, so the default phrase shows the image feature
(() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 4 L62 38 L98 38 L69 59 L80 94 L50 73 L20 94 L31 59 L2 38 L38 38 Z" fill="black"/></svg>`;
  const img = new Image();
  img.onload = () => { images.push({ name: 'star (demo)', img }); renderImgList(); schedule(); };
  img.src = 'data:image/svg+xml;base64,' + btoa(svg);
})();
schedule();
