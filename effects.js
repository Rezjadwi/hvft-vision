// HVFT VISION — effects.js
// Port langsung dari versi Android (Kotlin): PointCloudEffect, VolumetricEffect,
// TriangulateEffect, PixelLinesEffect, ScanEffect, ReconEffect + Palette,
// Plexus, WaveformHud, HvftHud.
//
// Dua lapis render, sama seperti di Android:
//   pixels(f)      -> tulis per-piksel ke buffer resolusi kerja (f.out)
//   vector(ctx,f,D)-> garis/teks/HUD digambar di resolusi layar supaya tajam

// ---------- Palette.kt ----------
const HVFT_TINT = {
  white: [1, 1, 1],
  blue: [0.35, 0.70, 1.0],
  gray: [0.86, 0.90, 1.0]
}
const HVFT_ACCENT = 'rgb(117,84,61)'   // Palette.ACCENT
const HVFT_ORANGE = '#F2A03D'          // aksen UI

// HVFT palette: black -> ember red -> HVFT red-orange -> #F2A03D -> warm white (heat ramp, brand colours)
// HVFT = HOLO ORANGE (Oct 7, Reza: orange but futuristic, like a hologram): teal-black shadows -> ember -> HVFT orange
// -> amber -> the brightest light turns cyan-white like a hologram highlight. (old heat ramp: [[0,0,0,0],[70,96,8,6],[135,226,48,28],[195,242,160,61],[255,255,244,228]])
// v2 (Oct 8): the top stays LIGHT ORANGE (binary effects like DITHER / EDGES use only the top colour — a cyan top turned
// the whole body cyan); the hologram feel comes from the teal-black shadows + HOLO FX (cyan fringe, scanlines, sweep).
const HVFT_HEAT = [[0, 0, 0, 0], [34, 4, 12, 16], [92, 110, 36, 8], [150, 238, 116, 32], [205, 255, 168, 64], [240, 255, 206, 138], [255, 255, 228, 184]]
function buildLut (name) {
  if (name === 'hvft') {
    const lut = new Uint8Array(256 * 3)
    for (let v = 0; v < 256; v++) {
      let k = 1; while (k < HVFT_HEAT.length - 1 && v > HVFT_HEAT[k][0]) k++
      const a = HVFT_HEAT[k - 1], b = HVFT_HEAT[k], t = (v - a[0]) / Math.max(1, b[0] - a[0])
      for (let c = 0; c < 3; c++) lut[v * 3 + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * t)
    }
    lut.name = 'hvft'
    return lut
  }
  if (name === 'random') { const lut = buildLut('white'); lut.name = 'random'; return lut }
  if (name === 'violet') {   // deep violet -> magenta -> amber -> white (burst reference palette)
    const ST = [[0, 0, 0, 0], [70, 58, 15, 92], [140, 194, 24, 122], [205, 255, 138, 61], [255, 255, 250, 240]]
    const lut = new Uint8Array(256 * 3)
    for (let v = 0; v < 256; v++) {
      let k = 1; while (k < ST.length - 1 && v > ST[k][0]) k++
      const a = ST[k - 1], b = ST[k], t = (v - a[0]) / Math.max(1, b[0] - a[0])
      for (let c = 0; c < 3; c++) lut[v * 3 + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * t)
    }
    lut.name = 'violet'
    return lut
  }
  if (typeof name === 'string' && name.indexOf('hue:') === 0) {   // tinted ramp from a hue (RANDOM colour picks one per beat)
    const h = (+name.slice(4) || 0) / 60, x = 1 - Math.abs(h % 2 - 1)
    const c = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x]
    const lut = new Uint8Array(256 * 3)
    for (let v = 0; v < 256; v++) { const w = Math.max(0, (v - 170) / 85) * 0.55; for (let k = 0; k < 3; k++) lut[v * 3 + k] = Math.min(255, Math.round(v * (c[k] * (1 - w) + w))) }
    lut.name = name
    return lut
  }
  const m = HVFT_TINT[name] || HVFT_TINT.white
  const lut = new Uint8Array(256 * 3)
  lut.name = name
  for (let v = 0; v < 256; v++) {
    lut[v * 3] = v * m[0]
    lut[v * 3 + 1] = v * m[1]
    lut[v * 3 + 2] = v * m[2]
  }
  return lut
}
function lutCss (lut, v, a) {
  v = v < 0 ? 0 : v > 255 ? 255 : v | 0
  return `rgba(${lut[v * 3]},${lut[v * 3 + 1]},${lut[v * 3 + 2]},${a})`
}

// hash yang sama persis dengan versi Kotlin
function hash (x, y) {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663))
  h = h ^ (h >>> 13)
  return h & 0x7fffffff
}
function bin (v, n) {
  let s = (v & ((1 << n) - 1)).toString(2)
  while (s.length < n) s = '0' + s
  return s
}
function clamp (v, a, b) { return v < a ? a : v > b ? b : v }

// tulis satu piksel bernilai v (0..255) lewat LUT palet
function px (out, i, lut, v) {
  v = v < 0 ? 0 : v > 255 ? 255 : v | 0
  const j = i << 2, k = v * 3
  out[j] = lut[k]; out[j + 1] = lut[k + 1]; out[j + 2] = lut[k + 2]; out[j + 3] = 255
}

// ---------- Plexus.kt ----------
function plexus (ctx, pts, n, maxDist, maxLinks) {
  const md2 = maxDist * maxDist
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2], ay = pts[i * 2 + 1]
    let links = 0, j = i + 1
    while (j < n && links < maxLinks) {
      const bx = pts[j * 2], by = pts[j * 2 + 1]
      const dx = ax - bx, dy = ay - by
      if (dx * dx + dy * dy < md2) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); links++ }
      j++
    }
  }
  ctx.stroke()
}

function roundRect (ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ---------- HvftHud.kt ----------
let HVFT_HUD_ON = true
function drawHvftHud (ctx, W, H, tick, scale) {
  if (!HVFT_HUD_ON) return
  const k = scale || 1
  const u = Math.min(W, H * 1.6) * 0.012 * k     // ikut sisi terpendek -> tidak membesar di window lebar
  const m = Math.min(W, H * 1.6) * 0.045 * k
  const slow = (tick / 12) | 0
  ctx.save()
  ctx.lineCap = 'butt'
  const white = '#FFFFFF'
  const dim = 'rgba(255,255,255,0.67)'

  // tanda + di 4 sudut
  ctx.strokeStyle = white; ctx.lineWidth = 2
  const cross = (cx, cy, s) => {
    ctx.beginPath()
    ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy)
    ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s)
    ctx.stroke()
  }
  cross(m, m, u * 0.9); cross(W - m, m, u * 0.9)
  cross(m, H - m, u * 0.9); cross(W - m, H - m, u * 0.9)

  // kiri-atas: tag utama
  ctx.fillStyle = white
  ctx.fillRect(m, m + u, u * 1.2, u * 1.2)
  ctx.font = `${(u * 2.6) | 0}px ui-monospace, Menlo, monospace`
  ctx.fillText('HVFT', m + u * 1.7, m + u * 2.3)
  ctx.fillStyle = dim
  ctx.font = `${Math.max(8, u * 1.0) | 0}px ui-monospace, Menlo, monospace`
  ctx.fillText('NON MAGNETIC TAPE COMPLETE', m, m + u * 3.4)

  // kanan-atas: blok CAUTION garis miring
  const cbw = W * 0.26, cbh = H * 0.045
  const cbx = W - m - cbw, cby = m + u
  ctx.fillStyle = white
  ctx.font = `${Math.max(9, u * 1.3) | 0}px ui-monospace, Menlo, monospace`
  ctx.fillText('S08  CAUTION', cbx, cby - u * 0.4)
  ctx.save()
  ctx.beginPath(); ctx.rect(cbx, cby, cbw, cbh); ctx.clip()
  ctx.strokeStyle = white; ctx.lineWidth = cbh * 0.28
  const gap = cbh * 0.7
  for (let sx = cbx - cbh; sx < cbx + cbw; sx += gap) {
    ctx.beginPath(); ctx.moveTo(sx, cby + cbh); ctx.lineTo(sx + cbh, cby); ctx.stroke()
  }
  ctx.restore()
  ctx.strokeStyle = white; ctx.lineWidth = 1.6
  ctx.strokeRect(cbx, cby, cbw, cbh)

  // barcode di bawah blok caution
  ctx.fillStyle = white
  let bx = cbx
  let i = 0
  const by = cby + cbh + u * 0.8, bh = u * 1.6
  while (bx < cbx + cbw) {
    const bw = 1.5 + (hash(i, 7) % 4)                 // BEKU (bukan 'slow') -> barcode tak berkedip tanpa audio
    if ((hash(i, 8) & 1) === 1) ctx.fillRect(bx, by, bw, bh)
    bx += bw + 1.5; i++
  }

  // teks vertikal tepi kiri
  ctx.save()
  ctx.translate(m * 0.6, H * 0.5); ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = dim
  ctx.font = `${Math.max(8, u * 1.1) | 0}px ui-monospace, Menlo, monospace`
  ctx.fillText('NCN MAGNETIC TAPE / SYSTEM ACTIVE', -H * 0.22, 0)
  ctx.restore()

  // label bawah: 対角線 & 水平 dengan bar
  const lby = H - m - u * 2.2
  ctx.fillStyle = white
  ctx.fillRect(m, lby, W * 0.30, 4)
  ctx.font = `${Math.max(10, u * 1.4) | 0}px ui-monospace, Menlo, monospace`
  ctx.fillText('対角線', m + u * 0.4, lby - u * 0.6)
  ctx.fillRect(W * 0.52, lby, W * 0.30, 4)
  ctx.fillText('水平', W * 0.52 + u * 0.4, lby - u * 0.6)

  // footer kode biner
  ctx.fillStyle = dim
  ctx.font = `${Math.max(8, u * 0.95) | 0}px ui-monospace, Menlo, monospace`
  ctx.fillText('NCN MAGNETIC  //REC  ' + bin(slow, 8), m, H - m - u * 0.3)   // counter pelan (per ~12 frame), tak kedip cepat
  ctx.restore()
}

// =====================================================================
// EFEK
// f = { W, H, rgb, lum, mask, tick, sens, bg, lut, out, nodes, nn, bbox }
// D = { W, H, s }  (s = skala kerja -> layar)
// =====================================================================

// ---------- PointCloudEffect.kt ----------
const NODE_CAP = 240
function pcPixels (f) {
  const { W, H, lum, mask, out, lut, tick } = f
  const burst = (f.audioOn && f.aud.burst) ? 1 + f.onset * 2.2 * f.audAmt : 1
  const disp = Math.max(3, (Math.max(W, H) * (0.012 + fxp(f, 'spread', 0.45) * 0.085) * burst) | 0)
  const breathe = 1 + 0.05 * Math.sin(tick * 0.12) + (f.audioOn && f.aud.density ? f.bandSel * 0.35 * f.audAmt : 0)
  const sens = 90 + (fxp(f, 'density', 0.50) * 1.5 + (f.audioOn && f.aud.density ? f.bandSel * 0.5 * f.audAmt : 0)) * 80
  let nn = 0
  const nodes = f.nodes
  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) {
      const i = row + x
      if (!mask[i]) continue
      const l = lum[i]
      const hxy = hash(x, y)
      if ((hxy & 1023) < sens + l * 3.5) {
        const tw = 0.72 + 0.28 * (((hxy + tick) & 31) / 31)
        px(out, i, lut, clamp(l * (0.45 + fxp(f, 'bright', 0.45) * 2.0) * breathe * tw, 24, 255))
        if (nn < NODE_CAP && (hash(x, y + 5) & 255) < 5) {
          nodes[nn * 2] = x; nodes[nn * 2 + 1] = y; nn++
        }
      }
      // sebaran tepi (disintegrasi siluet)
      const edge = x === 0 || x === W - 1 || y === 0 || y === H - 1 ||
        !mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W]
      if (edge && ((hash(x, y + 3) + tick) & 3) === 0) {
        const driftX = ((((tick / 3) | 0) + hxy) & 7) - 3
        const driftY = ((((tick / 4) | 0) + hash(x, y + 7)) & 7) - 5
        const ox = (((hash(x + 1, y) & 255) / 255) - 0.5) * 2 * disp + driftX
        const oy = (((hash(x, y + 1) & 255) / 255) - 0.9) * 2 * disp + driftY
        const tx = (x + ox) | 0, ty = (y + oy) | 0
        if (tx >= 0 && tx < W && ty >= 0 && ty < H) {
          px(out, ty * W + tx, lut, clamp(l * 0.75 * breathe, 30, 220))
        }
      }
    }
  }
  f.nn = nn
}

function pcVector (ctx, f, D) {
  const { nodes, nn, lut, tick } = f
  if (nn > 1) {
    const p = new Float32Array(nn * 2)
    for (let k = 0; k < nn; k++) { p[k * 2] = D.mx(nodes[k * 2]); p[k * 2 + 1] = D.my(nodes[k * 2 + 1]) }
    ctx.strokeStyle = lutCss(lut, 230, 0.24); ctx.lineWidth = 1
    plexus(ctx, p, nn, Math.max(D.W, D.H) * (0.015 + fxp(f, 'link', 0.40) * 0.13), 3)
    // ID biner mengambang
    ctx.fillStyle = lutCss(lut, 220, 0.59)
    ctx.font = `${clamp(D.W * 0.016, 10, 18) | 0}px ui-monospace, Menlo, monospace`
    const step = Math.max(1, (nn / 6) | 0)
    for (let k = 0; k < nn; k += step) {
      ctx.fillText(bin(hash(k, (tick / 6) | 0), 6), p[k * 2] + 6, p[k * 2 + 1])
    }
  }
  drawHvftHud(ctx, D.W, D.H, tick, f.hudScale)
}

// ---------- VolumetricEffect.kt ----------
const VOL_CAP = 220
function volPixels (f) {
  const { W, H, lum, mask, out, lut } = f
  const sens = 90 + (fxp(f, 'density', 0.50) * 1.5 + (f.audioOn && f.aud.density ? f.bandSel * 0.5 * f.audAmt : 0)) * 120
  const _vb = 0.45 + fxp(f, 'bright', 0.45) * 2.1
  let nn = 0, count = 0
  let minX = W, minY = H, maxX = 0, maxY = 0
  const nodes = f.nodes
  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) {
      const i = row + x
      if (!mask[i]) continue
      const l = lum[i]
      if ((hash(x, y) & 1023) < sens + l * 3.4) {
        px(out, i, lut, l * _vb)
        count++
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
        if (nn < VOL_CAP && (hash(x, y + 5) & 255) < 6) {
          nodes[nn * 2] = x; nodes[nn * 2 + 1] = y; nn++
        }
      }
    }
  }
  f.nn = nn; f.count = count
  f.bbox = [minX, minY, maxX, maxY]
}

function volVector (ctx, f, D) {
  const { nodes, nn, lut, tick, mask, W } = f
  if (nn > 1) {
    const p = new Float32Array(nn * 2)
    for (let k = 0; k < nn; k++) { p[k * 2] = D.mx(nodes[k * 2]); p[k * 2 + 1] = D.my(nodes[k * 2 + 1]) }
    ctx.strokeStyle = lutCss(lut, 235, 0.27); ctx.lineWidth = 1
    plexus(ctx, p, nn, Math.max(D.W, D.H) * (0.015 + fxp(f, 'link', 0.50) * 0.14), 3)
  }
  const [minX, minY, maxX, maxY] = f.bbox
  if (maxX > minX && maxY > minY) {
    const bw = maxX - minX, bh = maxY - minY
    const slow = (tick / 10) | 0
    const _nTxt = 1 + Math.round(fxp(f, 'text', 0.45) * 39)   // 1..40 readout
    for (let k = 0; k < _nTxt; k++) {
      const hh = hash(k * 131 + slow, k * 977 + slow * 3)
      const sx = minX + (hh % bw)
      const sy = minY + ((hh >>> 9) % bh)
      if (!mask[sy * W + sx]) continue
      const fr = (sy - minY) / (bh + 1)
      const mode = hh & 3
      let txt
      if (mode === 0) txt = String(hh % 100000).padStart(5, '0')
      else if (mode === 1) txt = '0.' + String(hh % 1000).padStart(3, '0')
      else if (mode === 2) txt = `x${((sx - minX) * 99 / bw) | 0} y${((sy - minY) * 99 / bh) | 0}`
      else txt = `${hh % 10}.${(hh >>> 4) % 10}`
      if (mode === 2) {
        ctx.fillStyle = lutCss(lut, 210, 0.59)
        ctx.font = `${((9 + fr * 3) * D.s) | 0}px ui-monospace, Menlo, monospace`
      } else {
        ctx.fillStyle = lutCss(lut, 245, 0.90)
        ctx.font = `${((10 + fr * 4) * D.s) | 0}px ui-monospace, Menlo, monospace`
      }
      ctx.fillText(txt, D.mx(sx), D.my(sy))
    }
    ctx.fillStyle = lutCss(lut, 245, 0.92)
    ctx.font = `${(13 * D.s) | 0}px ui-monospace, Menlo, monospace`
    ctx.fillText(`VOL ${f.count}  NODES ${nn}`,
      Math.max(D.mx(minX), D.W * 0.06), Math.max(D.my(minY - 12), 24))
  }
  drawHvftHud(ctx, D.W, D.H, tick, f.hudScale)
}

// ---------- TriangulateEffect.kt ----------
// latar = video diredupkan (lum * 0.28), subjek = wireframe Delaunay
function triPixels (f) {
  const { W, H, lum, out, lut } = f
  const _bg = 0.04 + fxp(f, 'bg', 0.28) * 0.62
  for (let i = 0; i < W * H; i++) px(out, i, lut, lum[i] * _bg)
}

const TriState = { px: new Float32Array(0), py: new Float32Array(0), n: 0, tris: new Int32Array(0), age: 999 }

function triBuild (f) {
  const { W, H, mask } = f
  const fg = (x, y) => x >= 0 && x < W && y >= 0 && y < H && mask[y * W + x] === 1
  const xl = [], yl = []
  // 1) titik KONTUR, ditipiskan per sel
  const bcell = Math.max(4, (W / 34) | 0)
  const seen = new Set()
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (fg(x, y) && (!fg(x - 1, y) || !fg(x + 1, y) || !fg(x, y - 1) || !fg(x, y + 1))) {
        const key = ((x / bcell) | 0) * 100000 + ((y / bcell) | 0)
        if (!seen.has(key)) { seen.add(key); xl.push(x); yl.push(y) }
      }
    }
  }
  // 2) titik ISI — grid jitter di dalam objek
  const step = Math.max(4, (W / 24) | 0)
  for (let gy = (step / 2) | 0; gy < H; gy += step) {
    for (let gx = (step / 2) | 0; gx < W; gx += step) {
      if (fg(gx, gy)) {
        const jx = (((hash(gx, gy) & 255) / 255) - 0.5) * step * 0.3
        const jy = (((hash(gx, gy + 7) & 255) / 255) - 0.5) * step * 0.3
        xl.push(gx + jx); yl.push(gy + jy)
      }
    }
  }
  let n = xl.length
  if (n < 3) { TriState.n = 0; TriState.tris = new Int32Array(0); return }
  const CAP = 520
  if (n > CAP) {
    const nx = [], ny = []
    const stp = n / CAP
    for (let fpos = 0; nx.length < CAP && fpos < n; fpos += stp) {
      const idx = fpos | 0; nx.push(xl[idx]); ny.push(yl[idx])
    }
    xl.length = 0; yl.length = 0
    for (let k = 0; k < nx.length; k++) { xl.push(nx[k]); yl.push(ny[k]) }
    n = xl.length
  }
  const vx = new Float32Array(n + 3), vy = new Float32Array(n + 3)
  for (let k = 0; k < n; k++) { vx[k] = xl[k]; vy[k] = yl[k] }
  vx[n] = -W * 4; vy[n] = -H
  vx[n + 1] = W * 5; vy[n + 1] = -H
  vx[n + 2] = W * 0.5; vy[n + 2] = H * 6

  // Bowyer–Watson
  const tri = [[n, n + 1, n + 2]]
  const edges = []
  for (let p = 0; p < n; p++) {
    edges.length = 0
    for (let t = tri.length - 1; t >= 0; t--) {
      const tt = tri[t]
      if (inCircle(vx[tt[0]], vy[tt[0]], vx[tt[1]], vy[tt[1]], vx[tt[2]], vy[tt[2]], vx[p], vy[p])) {
        edges.push([tt[0], tt[1]], [tt[1], tt[2]], [tt[2], tt[0]])
        tri.splice(t, 1)
      }
    }
    const em = edges.length
    for (let i = 0; i < em; i++) {
      const e = edges[i]; if (e[0] < 0) continue
      let cnt = 1
      for (let j = i + 1; j < em; j++) {
        const f2 = edges[j]; if (f2[0] < 0) continue
        if ((e[0] === f2[0] && e[1] === f2[1]) || (e[0] === f2[1] && e[1] === f2[0])) { cnt++; f2[0] = -1 }
      }
      if (cnt === 1) tri.push([e[0], e[1], p])
    }
  }
  // saring: tanpa vertex super, edge wajar, pusat di dalam objek, bukan sliver
  const outTri = []
  const maxEdge = W * 0.16
  const minArea = W * H * 0.00006
  for (const tt of tri) {
    const a = tt[0], b = tt[1], cc = tt[2]
    if (a >= n || b >= n || cc >= n) continue
    if (Math.hypot(vx[a] - vx[b], vy[a] - vy[b]) > maxEdge) continue
    if (Math.hypot(vx[b] - vx[cc], vy[b] - vy[cc]) > maxEdge) continue
    if (Math.hypot(vx[cc] - vx[a], vy[cc] - vy[a]) > maxEdge) continue
    const cxp = (vx[a] + vx[b] + vx[cc]) / 3, cyp = (vy[a] + vy[b] + vy[cc]) / 3
    if (!fg(cxp | 0, cyp | 0)) continue
    const area = Math.abs((vx[b] - vx[a]) * (vy[cc] - vy[a]) - (vx[cc] - vx[a]) * (vy[b] - vy[a])) * 0.5
    if (area < minArea) continue
    outTri.push(a, b, cc)
  }
  TriState.px = vx.slice(0, n); TriState.py = vy.slice(0, n); TriState.n = n
  TriState.tris = Int32Array.from(outTri)
}

function inCircle (ax, ay, bx, by, cx, cy, pxx, pyy) {
  const adx = ax - pxx, ady = ay - pyy
  const bdx = bx - pxx, bdy = by - pyy
  const cdx = cx - pxx, cdy = cy - pyy
  const ad = adx * adx + ady * ady
  const bd = bdx * bdx + bdy * bdy
  const cd = cdx * cdx + cdy * cdy
  const det = adx * (bdy * cd - cdy * bd) - ady * (bdx * cd - cdx * bd) + ad * (bdx * cdy - cdx * bdy)
  const orient = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  return orient >= 0 ? det > 0 : det < 0
}

function triVector (ctx, f, D) {
  // mask diperbarui tiap frame; rebuild tiap 3 frame (Android: tiap update mask ~90ms)
  if (TriState.age++ >= 3) { triBuild(f); TriState.age = 0 }
  const { lut, tick } = f
  const n = TriState.n
  if (n > 1) {
    const p = new Float32Array(n * 2)
    for (let k = 0; k < n; k++) { p[k * 2] = D.mx(TriState.px[k]); p[k * 2 + 1] = D.my(TriState.py[k]) }
    ctx.strokeStyle = lutCss(lut, 210, 0.04 + fxp(f, 'web', 0.35) * 0.46); ctx.lineWidth = 1
    plexus(ctx, p, n, D.W * (0.02 + fxp(f, 'link', 0.50) * 0.16), 2)
    const tr = TriState.tris
    ctx.beginPath()
    for (let i = 0; i < tr.length; i += 3) {
      const a = tr[i], b = tr[i + 1], d = tr[i + 2]
      ctx.moveTo(p[a * 2], p[a * 2 + 1])
      ctx.lineTo(p[b * 2], p[b * 2 + 1])
      ctx.lineTo(p[d * 2], p[d * 2 + 1])
      ctx.closePath()
    }
    ctx.strokeStyle = lutCss(lut, 245, 0.92); ctx.lineWidth = Math.max(0.4, 0.3 + fxp(f, 'line', 0.35) * 2.4)
    ctx.stroke()
  }
  drawHvftHud(ctx, D.W, D.H, tick, f.hudScale)
}

// ---------- PixelLinesEffect.kt ----------
// PIXEL LINES follows the noise (Oct 8, trace: it was static — the strokes came from a fixed hash, no audio at all):
//   LOW = stroke length, MID = density, HIGH = sparks + shimmer, N (noisiness) = curl, every hit = new stroke pattern,
//   overall level = brightness. Mic OFF = the original still look.
let _plSeed = 0, _plHit = false, _plSh = 0
function plPixels (f) {
  const { W, H, lum, mask, out, lut } = f
  const rc = _react(f), B = _bnd(f), lo = B[0] * rc, mi = B[1] * rc, hi = B[2] * rc
  const HA = (typeof window !== 'undefined' && window.HVFT_MIC_ON && window.HVFT_AUDIO) || {}, flat = (HA.flat || 0) * rc
  const hit = rc > 0.001 && (f.onset || 0) > 0.45
  if (hit && !_plHit) _plSeed = (_plSeed + 7919 + ((Math.random() * 1e6) | 0)) | 0   // every hit: a new stroke pattern
  _plHit = hit
  _plSh = rc > 0.001 && Math.random() < hi * 0.6 ? (_plSh + 1) & 7 : _plSh            // HIGH: partial shimmer
  // Android memakai W*0.10 (terlalu jauh keluar badan di layar lebar);
  // di sini panjang goresan mengikuti slider Sensitivitas
  const maxLen = W * (0.006 + fxp(f, 'len', 0.40) * 0.14) * (rc > 0.001 ? 0.45 + lo * 1.5 : 1)
  const _pd = 90 + fxp(f, 'density', 0.45) * 220 + mi * 260        // ambang kepadatan goresan
  const _pdrift = Math.max(1.2, (14.5 - fxp(f, 'drift', 0.35) * 13) * (1 - flat * 0.75))     // pembagi drift: kecil = melengkung kuat
  const _pspk = (1 << Math.max(3, 10 - Math.round(fxp(f, 'spark', 0.30) * 6 + hi * 3))) - 1   // mask percik
  const gain = rc > 0.001 ? 0.55 + Math.max(lo, mi, hi) * 0.7 : 1
  const sx0 = _plSeed % 1021, sy0 = ((_plSeed / 1021) | 0) % 997
  const put = (x, y, v) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return
    const i = (y * W + x) << 2
    const cur = out[i + 1]
    v = v < 0 ? 0 : v > 255 ? 255 : v | 0
    if (cur < lut[v * 3 + 1]) {
      out[i] = lut[v * 3]; out[i + 1] = lut[v * 3 + 1]; out[i + 2] = lut[v * 3 + 2]; out[i + 3] = 255
    }
  }
  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) {
      const i = row + x
      if (!mask[i]) continue
      const l = Math.min(255, lum[i] * gain)
      const hv = hash(x + sx0 + (((y & 7) === _plSh) ? 13 : 0), y + sy0)
      if ((hv & 1023) < _pd + l * 3.2) {
        const sign = (hv & 1) === 0 ? 1 : -1
        const len = ((l / 255) * maxLen * (0.35 + ((hv >> 4) & 15) / 15)) | 0
        const drift = ((hv >> 8) & 3) - 1
        for (let s = 0; s <= len; s++) {
          const v = (l * (1 - s / (len + 1))) | 0
          if (v < 8) break
          put(x + s * sign, y + ((s * drift) / _pdrift) | 0, v)
        }
      }
      if ((hv & _pspk) === 0) put(x + (((hv >> 3) & 31) - 15), y + (((hv >> 9) & 31) - 15), l)
    }
  }
}
function plVector (ctx, f, D) { drawHvftHud(ctx, D.W, D.H, f.tick) }

// ---------- ScanEffect.kt ----------
// semua vektor: titik lingkaran, kubus wireframe bbox, node berkolom
function scanVector (ctx, f, D) {
  const { W, H, lum, mask, lut, tick } = f
  const safe = D.W * 0.14
  const _sd = 0.35 + fxp(f, 'dot', 0.35) * 3.6           // ukuran titik
  const _sbr = 10 + fxp(f, 'bright', 0.45) * 190         // dasar kecerahan titik
  let minX = W, minY = H, maxX = 0, maxY = 0, any = false
  const cand = []
  for (let y = 1; y < H - 1; y += 2) {
    for (let x = 1; x < W - 1; x += 2) {
      const i = y * W + x
      if (mask[i] && mask[i - 1] && mask[i + 1] && mask[i - W] && mask[i + W]) {
        any = true
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
        const l = lum[i]
        if (l > 26) {
          ctx.fillStyle = lutCss(lut, 245, clamp(_sbr + l * 0.7, 0, 255) / 255)
          ctx.beginPath(); ctx.arc(D.mx(x), D.my(y), Math.max(0.5, _sd * D.s), 0, 6.2832); ctx.fill()
        }
        if (((hash(x, y) >>> 6) & 63) === 0) cand.push([x, y])
      }
    }
  }
  if (!any) {
    scanHudText(ctx, D, lut, safe, f.hudScale)
    return
  }
  const x0 = D.mx(minX), y0 = D.my(minY), x1 = D.mx(maxX), y1 = D.my(maxY)
  const _sdp = fxp(f, 'depth', 0.40) * 2.5               // offset kubus wireframe
  const dxx = (x1 - x0) * 0.12 * _sdp, dyy = (y1 - y0) * 0.06 * _sdp
  ctx.strokeStyle = lutCss(lut, 220, 0.63); ctx.lineWidth = 1.4
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
  ctx.strokeStyle = lutCss(lut, 210, 0.35); ctx.lineWidth = 1
  ctx.strokeRect(x0 + dxx, y0 - dyy, x1 - x0, y1 - y0)
  ctx.beginPath()
  ctx.moveTo(x0, y0); ctx.lineTo(x0 + dxx, y0 - dyy)
  ctx.moveTo(x1, y0); ctx.lineTo(x1 + dxx, y0 - dyy)
  ctx.moveTo(x0, y1); ctx.lineTo(x0 + dxx, y1 - dyy)
  ctx.moveTo(x1, y1); ctx.lineTo(x1 + dxx, y1 - dyy)
  ctx.stroke()

  const fs = clamp(D.W * 0.019, 12, 22)
  ctx.font = `${fs | 0}px ui-monospace, Menlo, monospace`
  const minDist = D.W * 0.16
  const chosen = []
  for (const nd of cand) {
    const nx = D.mx(nd[0]), ny = D.my(nd[1])
    let ok = true
    for (const ch of chosen) {
      if (Math.hypot(nx - D.mx(ch[0]), ny - D.my(ch[1])) < minDist) { ok = false; break }
    }
    if (ok) chosen.push(nd)
    if (chosen.length >= 1 + Math.round(fxp(f, 'node', 0.50) * 11)) break   // 1..12 node berlabel
  }
  const colX = D.W * 0.60, lineH = fs * 1.7
  const startY = Math.max(y0 + fs, fs * 1.5)
  for (let idx = 0; idx < chosen.length; idx++) {
    const nd = chosen[idx]
    const nx = D.mx(nd[0]), ny = D.my(nd[1]), ly = startY + idx * lineH
    ctx.fillStyle = lutCss(lut, 255, 1)
    ctx.fillRect(nx - 4, ny - 4, 8, 8)
    ctx.strokeStyle = lutCss(lut, 220, 0.71); ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.moveTo(nx + 4, ny); ctx.lineTo(colX - 10, ny); ctx.lineTo(colX - 10, ly - fs * 0.3)
    ctx.stroke()
    const num = hash(nd[0], nd[1]) & 0xFFFFF
    ctx.fillStyle = lutCss(lut, 235, 0.86)
    ctx.fillText(`sk[${(num % 5) + 1}] ${String(num % 100000).padStart(5, '0')}`, colX, ly)
  }
  scanHudText(ctx, D, lut, safe, f.hudScale)
}

function scanHudText (ctx, D, lut, safe, k) {
  ctx.fillStyle = lutCss(lut, 235, 0.86)
  const fs = clamp(D.W * 0.020, 12, 24) * (k || 1)
  ctx.font = `${fs | 0}px ui-monospace, Menlo, monospace`
  const top = fs * 1.8
  ctx.fillText('HVFT VISION', safe, top)
  ctx.fillText('POINT CLOUD / SUBJECT: HUMAN', safe, top + fs * 1.3)
  ctx.fillText('RES 0.1MM  ·  SCAN ACTIVE', safe, top + fs * 2.6)
}



// ---------- GroundPlane.dotGrid / dotGridMasked ----------
// Garis tipis + titik di perempatan. Titik dilewati kalau jatuh di atas subjek
// (dotGridMasked), jadi grid terasa berada DI BELAKANG orangnya.
function drawDotGrid (ctx, f, D, cols, masked) {
  const step = D.W / Math.max(4, cols)
  ctx.save()
  ctx.strokeStyle = 'rgba(200,200,200,0.094)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= D.W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, D.H) }
  for (let y = 0; y <= D.H; y += step) { ctx.moveTo(0, y); ctx.lineTo(D.W, y) }
  ctx.stroke()
  ctx.fillStyle = lutCss(f.lut, 255, 0.47)
  const { W, H, mask } = f
  for (let y = 0; y <= D.H; y += step) {
    for (let x = 0; x <= D.W; x += step) {
      if (masked) {
        // balik ke koordinat buffer kerja untuk mengecek mask
        const wx = Math.round((x - D.ox) / D.s), wy = Math.round((y - D.oy) / D.s)
        if (wx >= 0 && wx < W && wy >= 0 && wy < H && mask[wy * W + wx]) continue
      }
      ctx.beginPath(); ctx.arc(x, y, 2, 0, 6.2832); ctx.fill()
    }
  }
  ctx.restore()
}

// ---------- ConstellationRenderer.kt (VisiFX) ----------
// Titik-titik pada tepi (gradien) di dalam subjek, saling terhubung garis,
// hub di centroid. Di VisiFX titik diambil per kotak deteksi; di sini
// area subjek datang dari mask segmentasi.
function conPixels (f) {
  const { W, H, lum, out, lut, bg } = f
  const a = Math.max(0.18, bg)          // dimPaint alpha 45/255 ≈ 0.18
  for (let i = 0; i < W * H; i++) px(out, i, lut, lum[i] * a)
}

function conVector (ctx, f, D) {
  const { W, H, lum, mask, lut, tick } = f
  const step = Math.max(2, (Math.min(W, H) / 78) | 0)
  const pts = []
  let minX = W, minY = H, maxX = 0, maxY = 0, any = false
  for (let y = step; y < H - step; y += step) {
    for (let x = step; x < W - step; x += step) {
      const i = y * W + x
      if (!mask[i]) continue
      any = true
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      pts.push(x, y)   // isi seluruh objek -> plexus rapat menutup tubuh
    }
  }
  if (!any) return
  // batasi jumlah titik (VisiFX: 32 per objek) — di sini ikut Sensitivitas
  const target = (24 + fxp(f, 'nodes', 0.45) * 520) | 0
  let sel = pts
  if (pts.length / 2 > target) {
    const k = Math.ceil((pts.length / 2) / target)
    sel = []
    for (let i = 0; i < pts.length / 2; i++) if (i % k === 0) sel.push(pts[i * 2], pts[i * 2 + 1])
  }
  const n = sel.length / 2
  const P = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) { P[i * 2] = D.mx(sel[i * 2]); P[i * 2 + 1] = D.my(sel[i * 2 + 1]) }

  // jarak sambung: 0.30 × sisi terpanjang bbox, dimodulasi frekuensi terpilih
  const bw = (maxX - minX) * D.s, bh = (maxY - minY) * D.s
  const react = (f.audioOn && f.aud.mesh) ? (0.7 + f.bandSel * 0.9 * f.audAmt) : 1
  const thr = Math.max(bw, bh) * (0.03 + fxp(f, 'link', 0.45) * 0.30) * react
  const thr2 = thr * thr

  ctx.save()
  ctx.lineWidth = 1.3
  ctx.strokeStyle = lutCss(lut, 235, 0.59)
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const ax = P[i * 2], ay = P[i * 2 + 1]
    for (let j = i + 1; j < n; j++) {
      const dx = ax - P[j * 2], dy = ay - P[j * 2 + 1]
      if (dx * dx + dy * dy < thr2) { ctx.moveTo(ax, ay); ctx.lineTo(P[j * 2], P[j * 2 + 1]) }
    }
  }
  ctx.stroke()

  // titik: glow besar + inti kecil (ukuran ikut onset)
  const boom = (f.audioOn && f.aud.burst) ? 1 + f.onset * 1.6 * f.audAmt : 1
  const _cg = 0.2 + fxp(f, 'glow', 0.45) * 2.0
  const rg = 5 * _cg * D.s * 0.6 * boom, rd = 2 * D.s * 0.6 * boom
  ctx.fillStyle = lutCss(lut, 220, 0.27)
  for (let i = 0; i < n; i++) {
    ctx.beginPath(); ctx.arc(P[i * 2], P[i * 2 + 1], rg, 0, 6.2832); ctx.fill()
  }
  // inti titik dengan KEDIP ACAK: sebagian titik lebih terang, berpindah seiring waktu
  for (let i = 0; i < n; i++) {
    const bx = sel[i * 2], by = sel[i * 2 + 1]
    const seed = hash(bx, by)
    const ph = (seed & 1023) / 1023 * 6.2832
    const _ctw = fxp(f, 'twinkle', 0.50) * (f.audioOn ? (f.audAmt == null ? 1 : f.audAmt) : 0)   // kedip HANYA saat mic nyala
    let tw = 0.72 + 0.55 * _ctw * (0.5 + 0.5 * Math.sin(tick * (0.012 + _ctw * 0.20) + ph))
    if (_ctw > 0.01 && (((seed >> 5) ^ ((tick / 14) | 0)) % Math.max(2, 26 - Math.round(_ctw * 24))) === 0) tw = 1.15   // flare acak (audio)
    ctx.fillStyle = lutCss(lut, clamp(255 * tw, 40, 255), Math.min(1, 0.5 + tw * 0.55))
    ctx.beginPath(); ctx.arc(P[i * 2], P[i * 2 + 1], rd * (0.65 + tw * 0.7), 0, 6.2832); ctx.fill()
  }
  // hub di centroid + label
  const hx = D.mx((minX + maxX) / 2), hy = D.my((minY + maxY) / 2)
  ctx.fillStyle = lutCss(lut, 235, 0.90)
  ctx.beginPath(); ctx.arc(hx, hy, 4.2 * D.s * 0.6, 0, 6.2832); ctx.fill()
  ctx.strokeStyle = lutCss(lut, 210, 0.47); ctx.lineWidth = 1.4
  ctx.beginPath(); ctx.arc(hx, hy, 14 * D.s * 0.6, 0, 6.2832); ctx.stroke()
  ctx.fillStyle = lutCss(lut, 235, 0.78)
  ctx.font = `${((D.H * 0.02) * (f.hudScale || 1)) | 0}px ui-monospace, Menlo, monospace`
  ctx.fillText(`SUBJ // NODES ${n}`, D.mx(minX), Math.max(D.my(minY) - 8, D.H * 0.03))
  ctx.restore()
  drawHvftHud(ctx, D.W, D.H, tick, f.hudScale)
}


// ---------- daftar efek ----------
// ---------- Wave: subjek (depth/kamera) jadi relief garis gelombang ----------
// Latar = grayscale subjek diredupkan (wajah tetap terbaca); di atasnya garis
// horizontal rapat yang TIMBUL mengikuti kedalaman/kecerahan (heightfield),
// beranimasi halus + bisa dipompa audio. Look "wave relief portrait".
function wavePixels (f) {
  const { W, H, lum, mask, out, lut } = f
  const dim = 0.40
  for (let i = 0, j = 0; i < W * H; i++, j += 4) {
    if (mask[i]) {
      const l = lum[i]
      out[j] = lut[l * 3] * dim; out[j + 1] = lut[l * 3 + 1] * dim; out[j + 2] = lut[l * 3 + 2] * dim
    } else { out[j] = 0; out[j + 1] = 0; out[j + 2] = 0 }
    out[j + 3] = 255
  }
}
function waveVector (ctx, f, D) {
  const { W, H, lum, mask, lut, tick } = f
  const gap = Math.max(2, (11 - fxp(f, 'density', 0.50) * 9) | 0)   // parameter Kerapatan Garis
  const xs = 2
  const audio = f.audioOn ? (1 + f.onset * f.audAmt * 1.6 + f.bandSel * f.audAmt * 0.6) : 1
  const amp = H * (0.012 + fxp(f, 'amp', 0.45) * 0.20) * audio
  ctx.lineWidth = Math.max(0.5, (0.25 + fxp(f, 'thick', 0.30) * 2.4) * D.s)
  ctx.strokeStyle = lutCss(lut, 235, 0.55)
  const t = tick * (0.006 + fxp(f, 'speed', 0.40) * 0.11)
  for (let y = gap; y < H - 1; y += gap) {
    let started = false
    for (let x = 0; x < W; x += xs) {
      const i = y * W + x
      if (mask[i]) {
        const l = lum[i] / 255
        const disp = (l - 0.12) * amp * (0.92 + 0.08 * Math.sin(x * 0.05 + t + y * 0.03))
        const sx = D.mx(x), sy = D.my(y - disp)
        if (!started) { ctx.beginPath(); ctx.moveTo(sx, sy); started = true }
        else ctx.lineTo(sx, sy)
      } else if (started) { ctx.stroke(); started = false }
    }
    if (started) ctx.stroke()
  }
}

// ---------- Flux: partikel mengalir menyusuri tubuh + jejak cahaya ----------
// Beda dari Constellation. Ribuan partikel hidup di dalam mask objek, bergerak
// menyusuri kontur kedalaman (tegak lurus gradien = isocontour) + curl-noise,
// meninggalkan trail memudar (kanvas akumulasi). Terang & gerak dipompa audio.
let fluxP = null, fluxTC = null, fluxTCX = null, fluxMaskPts = null
function fluxPixels (f) {
  // ghost volume: subjek grayscale diredupkan sebagai latar
  const { W, H, lum, mask, out, lut } = f
  const dim = 0.03 + fxp(f, 'bg', 0.28) * 0.75
  for (let i = 0, j = 0; i < W * H; i++, j += 4) {
    if (mask[i]) { const l = lum[i]; out[j] = lut[l * 3] * dim; out[j + 1] = lut[l * 3 + 1] * dim; out[j + 2] = lut[l * 3 + 2] * dim }
    else { out[j] = 0; out[j + 1] = 0; out[j + 2] = 0 }
    out[j + 3] = 255
  }
}
function fluxVector (ctx, f, D) {
  const { W, H, lum, mask, lut, tick } = f
  // kumpulkan titik dalam objek
  const _fn = fxp(f, 'nodes', 0.45)
  const st = clamp((Math.min(W, H) / (18 + _fn * 80)) | 0, 2, 12)
  const ax = [], ay = [], al = []
  let cx = 0, cy = 0, minX = W, minY = H, maxX = 0, maxY = 0
  for (let y = st; y < H - st; y += st) for (let x = st; x < W - st; x += st) {
    const i = y * W + x
    if (!mask[i]) continue
    ax.push(x); ay.push(y); al.push(lum[i]); cx += x; cy += y
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  let n = ax.length
  if (n < 8) return
  cx /= n; cy /= n
  // batasi jumlah node
  const target = clamp((120 + _fn * 560) | 0, 120, 680)   // dibatasi: O(n^2) link -> jauh lebih ringan
  if (n > target) {
    const k = Math.ceil(n / target)
    const bx = [], by = [], bl = []
    for (let i = 0; i < n; i += k) { bx.push(ax[i]); by.push(ay[i]); bl.push(al[i]) }
    ax.length = 0; ay.length = 0; al.length = 0
    for (let i = 0; i < bx.length; i++) { ax.push(bx[i]); ay.push(by[i]); al.push(bl[i]) }
    n = ax.length
  }
  // DISPERSI (ledak) ikut audio: dorong keluar dari centroid
  const maxDim = Math.max(maxX - minX, maxY - minY)
  const push = f.audioOn ? (f.onset * f.audAmt * 0.9 + f.bandSel * f.audAmt * 0.5) : 0
  const amp = maxDim * push * (0.06 + fxp(f, 'burst', 0.50) * 1.0)
  const PX = new Float32Array(n), PY = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let x = ax[i], y = ay[i]
    if (amp > 0.5) {
      const dx = x - cx, dy = y - cy, dl = Math.hypot(dx, dy) || 1
      const hv = (hash(ax[i], ay[i]) & 255) / 255
      const p = amp * (0.35 + hv)
      x += dx / dl * p; y += dy / dl * p
    }
    PX[i] = D.mx(x); PY[i] = D.my(y)
  }
  // PLEXUS: sambung node yang ASALNYA berdekatan (garis melar saat ledak)
  const thrB = st * (0.8 + fxp(f, 'link', 0.45) * 5.8), thrB2 = thrB * thrB
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineWidth = Math.max(1, 0.7 * D.s)
  ctx.strokeStyle = lutCss(lut, 210, 0.16 + (f.audioOn ? f.onset * 0.12 : 0))
  ctx.beginPath()
  let drawn = 0
  for (let i = 0; i < n && drawn < 4200; i++) {
    for (let j = i + 1; j < n && drawn < 4200; j++) {
      const dx = ax[i] - ax[j], dy = ay[i] - ay[j]
      if (dx * dx + dy * dy < thrB2) { ctx.moveTo(PX[i], PY[i]); ctx.lineTo(PX[j], PY[j]); drawn++ }
    }
  }
  ctx.stroke()
  // TITIK: putih berkedip
  const rr = Math.max(1, 0.9 * D.s)
  for (let i = 0; i < n; i++) {
    const seed = hash(ax[i], ay[i])
    const _frc = f.audioOn ? (f.audAmt == null ? 1 : f.audAmt) : 0   // kedip HANYA saat mic nyala
    let tw = 0.8 + 0.4 * _frc * (0.5 + 0.5 * Math.sin(tick * 0.08 + seed))
    if (_frc > 0.01 && ((seed >> 5) ^ ((tick / 13) | 0)) % 12 === 0) tw = 1.1
    ctx.fillStyle = lutCss(lut, clamp(255 * tw, 40, 255), Math.min(1, 0.5 + tw * 0.5))
    ctx.fillRect(PX[i] - rr / 2, PY[i] - rr / 2, rr, rr)
  }
  ctx.restore()
}

// ---------- X-Ray: styling X-ray biru + sapuan CT-scan (gimmick reveal) ----------
// Prosedural & realtime (bukan tulang asli — itu jalur diffusion). Tubuh jadi
// translusen biru + tepi menyala; sebuah bar CT-scan menyapu turun & "menerangi".
// --- X-Ray AI (diffusion) state; di-set dari control.js ---
let xrayAIOn = false, xrayAIImg = null, xrayReveal = 1
window.hvftXray = {
  setOn: (v) => { xrayAIOn = v },
  push: (img) => { xrayAIImg = img; xrayReveal = 0 }
}
// X-Ray v2 — memakai KEDALAMAN: ketebalan tubuh diperkirakan dari jarak-ke-tepi siluet
// dikali kedekatan depth, lalu diserap ala Beer-Lambert (itu yang bikin X-ray punya isi).
let xrDist = null, xrW = 0, xrH = 0
function xrayPixels (f) {
  const { W, H, lum, mask, out, tick } = f
  if (xrayAIOn && xrayAIImg) { out.fill(0); for (let j = 3; j < out.length; j += 4) out[j] = 255; return }
  if (!xrDist || xrW !== W || xrH !== H) { xrDist = new Float32Array(W * H); xrW = W; xrH = H }
  const d = xrDist
  const INF = 1e6
  for (let i = 0; i < W * H; i++) d[i] = mask[i] ? INF : 0
  // distance transform chamfer 2 lintasan (jarak tiap piksel ke tepi subjek)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x; if (d[i] === 0) continue
      let m = d[i]
      if (x > 0) { const v = d[i - 1] + 1; if (v < m) m = v }
      if (y > 0) { const v = d[i - W] + 1; if (v < m) m = v }
      if (x > 0 && y > 0) { const v = d[i - W - 1] + 1.414; if (v < m) m = v }
      if (x < W - 1 && y > 0) { const v = d[i - W + 1] + 1.414; if (v < m) m = v }
      d[i] = m
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; if (d[i] === 0) continue
      let m = d[i]
      if (x < W - 1) { const v = d[i + 1] + 1; if (v < m) m = v }
      if (y < H - 1) { const v = d[i + W] + 1; if (v < m) m = v }
      if (x < W - 1 && y < H - 1) { const v = d[i + W + 1] + 1.414; if (v < m) m = v }
      if (x > 0 && y < H - 1) { const v = d[i + W - 1] + 1.414; if (v < m) m = v }
      d[i] = m
    }
  }
  const scale = 1 / Math.max(6, W * 0.035)
  const scanY = (tick * (H / 110)) % H
  const bandW = H * 0.05, inv2 = 1 / (2 * bandW * bandW)
  for (let y = 0; y < H; y++) {
    const dyb = y - scanY
    const bandv = Math.exp(-(dyb * dyb) * inv2)
    for (let x = 0; x < W; x++) {
      const i = y * W + x, j = i * 4
      if (!mask[i]) { out[j] = 2; out[j + 1] = 4; out[j + 2] = 11; out[j + 3] = 255; continue }
      const th = d[i] * scale                    // ketebalan semu
      const dep = lum[i] / 255                   // kedekatan (depth) / terang (kamera)
      const dens = th * (0.55 + dep * 0.9)
      let a = 1 - Math.exp(-1.35 * dens)         // Beer-Lambert: makin tebal makin padat
      const bone = Math.pow(Math.min(1, th * 0.55), 2.2)   // inti = "tulang"
      a = Math.min(1, a * 0.80 + bone * 0.58)
      const skin = Math.exp(-th * 1.6) * 0.32    // tepi kulit tipis bercahaya
      let v = a * 228 + skin * 150 + bandv * 62
      if (v > 255) v = 255
      out[j] = v * 0.60; out[j + 1] = v * 0.76; out[j + 2] = Math.min(255, v + 26); out[j + 3] = 255
    }
  }
}
function xrayVector (ctx, f, D) {
  const { H, tick } = f
  if (xrayAIOn && xrayAIImg) {
    const iw = xrayAIImg.naturalWidth, ih = xrayAIImg.naturalHeight
    if (iw && ih) {
      const sc = Math.max(D.W / iw, D.H / ih), w = iw * sc, h = ih * sc, ox = (D.W - w) / 2, oy = (D.H - h) / 2
      xrayReveal = Math.min(1, xrayReveal + 0.025)
      const ry = xrayReveal * D.H
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, D.W, ry); ctx.clip()
      ctx.filter = 'grayscale(1) contrast(1.32) brightness(1.06)'
      ctx.drawImage(xrayAIImg, ox, oy, w, h)
      ctx.filter = 'none'
      ctx.globalCompositeOperation = 'color'; ctx.fillStyle = 'rgb(74,124,178)'; ctx.fillRect(ox, oy, w, h)
      ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(150,180,210)'; ctx.fillRect(ox, oy, w, h)
      ctx.restore()
      if (xrayReveal < 1) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'
        const g = ctx.createLinearGradient(0, ry - 20, 0, ry + 20)
        g.addColorStop(0, 'rgba(120,200,255,0)'); g.addColorStop(0.5, 'rgba(170,230,255,0.7)'); g.addColorStop(1, 'rgba(120,200,255,0)')
        ctx.fillStyle = g; ctx.fillRect(0, ry - 20, D.W, 40)
        ctx.strokeStyle = 'rgba(215,245,255,0.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, ry); ctx.lineTo(D.W, ry); ctx.stroke(); ctx.restore()
      }
      ctx.fillStyle = 'rgba(150,210,255,0.85)'
      const fs2 = clamp(D.W * 0.016, 10, 16) | 0; ctx.font = fs2 + 'px ui-monospace, Menlo, monospace'
      ctx.fillText('X-RAY // REKONSTRUKSI ' + (xrayReveal < 1 ? (xrayReveal * 100 | 0) + '%' : 'OK'), 12, D.H - 14)
    }
    return
  }
  const scanY = (tick * (H / 90)) % H
  const sy = D.my(scanY)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const g = ctx.createLinearGradient(0, sy - 16, 0, sy + 16)
  g.addColorStop(0, 'rgba(120,200,255,0)'); g.addColorStop(0.5, 'rgba(150,225,255,0.5)'); g.addColorStop(1, 'rgba(120,200,255,0)')
  ctx.fillStyle = g; ctx.fillRect(0, sy - 16, D.W, 32)
  ctx.strokeStyle = 'rgba(205,240,255,0.9)'; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(D.W, sy); ctx.stroke()
  ctx.restore()
  ctx.fillStyle = 'rgba(150,210,255,0.85)'
  const fs = clamp(D.W * 0.016, 10, 16) | 0
  ctx.font = fs + 'px ui-monospace, Menlo, monospace'
  ctx.fillText('CT-SCAN // ' + String((scanY / H * 100) | 0).padStart(3, '0') + '%  //REKONSTRUKSI', 12, D.H - 14)
}

// ---------- Profil: deteksi orang + pop-up wajah + profil palsu (surveillance HVFT) ----------
function profilPixels (f) {
  const { W, H, lum, out, lut } = f
  const dim = 0.05 + fxp(f, 'bg', 0.50) * 1.0
  for (let i = 0, j = 0; i < W * H; i++, j += 4) { const l = lum[i]; out[j] = lut[l * 3] * dim; out[j + 1] = lut[l * 3 + 1] * dim; out[j + 2] = lut[l * 3 + 2] * dim; out[j + 3] = 255 }
}
function profilVector (ctx, f, D) {
  const { W, H, lut, tick, blobs, workCanvas } = f
  const sc = D.s
  const fs = clamp(D.W * (0.006 + fxp(f, 'font', 0.40) * 0.022), 7, 34) | 0
  ctx.font = fs + 'px ui-monospace, Menlo, monospace'
  const faceH = clamp(D.W * 0.05, 40, 90), faceW = faceH
  const _pmax = 1 + Math.round(fxp(f, 'panels', 0.45) * 11)   // 1..12 panel
  const _pbw = 0.25 + fxp(f, 'box', 0.40) * 2.4
  let n = 0
  for (const b of (blobs || [])) {
    if (n++ > _pmax) break
    const bw = (b.w || W * 0.12), bh = (b.h || H * 0.14)
    const x0 = D.mx(b.x - bw / 2), y0 = D.my(b.y - bh / 2)
    const x1 = D.mx(b.x + bw / 2), y1 = D.my(b.y + bh / 2)
    // kotak + sudut
    ctx.strokeStyle = lutCss(lut, 235, 0.85); ctx.lineWidth = Math.max(0.5, 1.2 * _pbw * sc)
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
    const t = Math.min(14, (x1 - x0) * 0.22)
    ctx.beginPath()
    ctx.moveTo(x0, y0 + t); ctx.lineTo(x0, y0); ctx.lineTo(x0 + t, y0)
    ctx.moveTo(x1 - t, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + t)
    ctx.stroke()
    // profil palsu (seed stabil di sekitar posisi)
    const seed = hash(Math.round(b.x / 8), Math.round(b.y / 8))
    const gender = (seed & 1) ? 'MAN' : 'FEM'
    const age = 18 + (seed % 32)
    const hgt = 155 + ((seed >> 3) % 42)
    const id = (seed % 100000)
    const match = 68 + ((seed >> 5) % 31)
    // panel di kanan kotak (clamp ke layar)
    const pw = faceW + D.W * 0.14, ph = Math.max(faceH + 8, fs * 4.6)
    let px = x1 + 10, py = y0
    if (px + pw > D.W) px = x0 - pw - 10
    if (px < 0) px = 4
    if (py + ph > D.H) py = D.H - ph - 2
    // garis penghubung
    ctx.strokeStyle = lutCss(lut, 210, 0.5); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x1, y0 + 6); ctx.lineTo(px, py + 6); ctx.stroke()
    // panel
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(px, py, pw, ph)
    ctx.strokeStyle = lutCss(lut, 225, 0.7); ctx.lineWidth = 1; ctx.strokeRect(px, py, pw, ph)
    // crop wajah (bagian atas kotak) dari frame mentah
    if (workCanvas) {
      const cx = Math.max(0, b.x - bw / 2), cy = Math.max(0, b.y - bh / 2), cw = Math.min(W - cx, bw), ch = Math.min(H - cy, bh * (b.face ? 1 : 0.55))
      try { ctx.drawImage(workCanvas, cx, cy, cw, ch, px + 4, py + 4, faceW, faceH) } catch (e) {}
      ctx.strokeStyle = lutCss(lut, 200, 0.6); ctx.strokeRect(px + 4, py + 4, faceW, faceH)
    }
    // teks profil
    const tx = px + faceW + 12; let ty = py + fs + 2
    ctx.fillStyle = lutCss(lut, 250, 0.95)
    ctx.fillText(gender + ' / ' + age, tx, ty); ty += fs * 1.25
    ctx.fillStyle = lutCss(lut, 220, 0.82)
    ctx.fillText('H ' + hgt + 'cm', tx, ty); ty += fs * 1.25
    ctx.fillText('ID ' + String(id).padStart(5, '0'), tx, ty); ty += fs * 1.25
    ctx.fillStyle = lutCss(lut, 235, 0.9)
    ctx.fillText('MATCH ' + match + '%', tx, ty)
  }
  // sapuan SCANNING + status target (biar jelas efek hidup walau 0 deteksi)
  const sw = (tick * 3) % D.W
  ctx.strokeStyle = lutCss(lut, 245, 0.18); ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(sw, 0); ctx.lineTo(sw, D.H); ctx.stroke()
  ctx.font = fs + 'px ui-monospace, Menlo, monospace'
  ctx.fillStyle = lutCss(lut, 245, 0.9)
  ctx.fillText((n ? 'TARGETS: ' + n : 'SCANNING\u2026 NO TARGET') , 14, D.H - 40)
  drawHvftHud(ctx, D.W, D.H, tick, f.hudScale)
}


// ---------- Erosi: subjek 3D hancur/nyusun-ulang + smear horizontal (audio) ----------
// Referensi: patung/bust yang meleleh jadi irisan & serat ikut bass/onset. Monokrom.
let erodeEnv = 0
function erodePixels (f) {
  const { W, H, lum, mask, out, lut, onset, band, audioOn, audAmt, tick, sens } = f
  out.fill(0)
  for (let j = 3; j < out.length; j += 4) out[j] = 255
  const bass = band ? (band[0] || 0) : 0
  const drive = audioOn ? Math.min(1, (0.7 * onset + 0.6 * bass) * (0.5 + (audAmt || 0))) : 0.10
  // nafas: meleleh cepat saat hentakan, menyusun ulang pelan
  erodeEnv = drive > erodeEnv ? drive : erodeEnv * 0.93 + drive * 0.07
  const E = erodeEnv
  const _egh = fxp(f, 'ghost', 0.35) * 0.9       // kekuatan bayangan subjek asli
  const _eht = 1 - fxp(f, 'hatch', 0.45) * 0.8   // gelapnya garis hatching
  const slabH = Math.max(3, (H * 0.045) | 0)     // baris dikelompokkan jadi slab (bukan per-baris = kasar)
  const ts = (tick / 14) | 0
  for (let y = 0; y < H; y++) {
    const sl = (y / slabH) | 0
    const rn = (hash(sl, ts) % 2000) / 2000 - 0.5
    const rn2 = (hash(sl * 7 + 1, ts) % 1000) / 1000
    const fy = (y - sl * slabH) / slabH
    const ease = 0.6 + 0.4 * Math.sin(Math.PI * fy)          // tepi slab lembut, tengah penuh
    const shift = (rn * E * W * (0.03 + fxp(f, 'melt', 0.45) * 0.48) * ease) | 0
    const trail = Math.max(1, (1 + E * (2 + fxp(f, 'trail', 0.40) * 70) * (0.45 + rn2)) | 0)
    const dir = rn < 0 ? -1 : 1
    const rowBase = y * W
    for (let x = 0; x < W; x++) {
      const i = rowBase + x
      if (!mask[i]) continue
      const l = lum[i]; if (l < 6) continue
      // ghost: subjek asli tetap terbaca walau sedang meleleh
      const gv = (l * _egh) | 0, gj = (rowBase + x) * 4
      if (lut[gv * 3] > out[gj]) { out[gj] = lut[gv * 3]; out[gj + 1] = lut[gv * 3 + 1]; out[gj + 2] = lut[gv * 3 + 2] }
      const px = x + shift
      for (let t = 0; t <= trail; t++) {
        const xx = px + t * dir
        if (xx < 0 || xx >= W) break
        const a = 1 - t / (trail + 1)
        const v = (l * a * a) | 0                              // falloff kuadratik = serat halus
        if (v < 4) break
        const jj = (rowBase + xx) * 4
        if (lut[v * 3] > out[jj]) { out[jj] = lut[v * 3]; out[jj + 1] = lut[v * 3 + 1]; out[jj + 2] = lut[v * 3 + 2] }
      }
    }
  }
  // hatching scanline halus (tekstur garis tipis seperti referensi)
  for (let y = 1; y < H; y += 3) {
    const rowBase = y * W
    for (let x = 0; x < W; x++) {
      const jj = (rowBase + x) * 4
      out[jj] *= _eht; out[jj + 1] *= _eht; out[jj + 2] *= _eht
    }
  }
}
function erodeVector (ctx, f, D) {
  const { lut, tick } = f
  // grid kotak samar
  ctx.strokeStyle = lutCss(lut, 255, 0.045); ctx.lineWidth = 1
  const step = D.W / 26
  ctx.beginPath()
  for (let x = 0; x <= D.W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, D.H) }
  for (let y = 0; y <= D.H; y += step) { ctx.moveTo(0, y); ctx.lineTo(D.W, y) }
  ctx.stroke()
  // bracket kiri-atas + mini readout
  const fs = clamp(D.W * 0.011, 8, 13) | 0
  ctx.font = fs + 'px ui-monospace, Menlo, monospace'
  const bx = D.W * 0.06, by = D.H * 0.12, bw = D.W * 0.16, bh = fs * 3
  ctx.strokeStyle = lutCss(lut, 220, 0.6); ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(bx, by + 8); ctx.lineTo(bx, by); ctx.lineTo(bx + bw, by)
  ctx.moveTo(bx + bw, by); ctx.lineTo(bx + bw, by + bh)
  ctx.stroke()
  ctx.fillStyle = lutCss(lut, 235, 0.8)
  ctx.fillText('EROSI // MESH', bx + 6, by + fs + 2)
  ctx.fillStyle = lutCss(lut, 200, 0.6)
  ctx.fillText('recon ' + ('0000' + (tick % 10000)).slice(-4), bx + 6, by + fs * 2 + 4)
  // tick koordinat samar kiri-tengah
  ctx.fillStyle = lutCss(lut, 180, 0.5)
  ctx.fillText('0', D.W * 0.03, D.H * 0.5)
  drawHvftHud(ctx, D.W, D.H, tick, f.hudScale)
}


// ---------- TEKS: kata dengan font acak, posisi/ukuran/warna ikut beat ----------
const HVFT_FONTS = ['AlmostJapanese','Audiowide','Beringas','BlackGraffiti','BlackOpsOne','CaliforniaGraffiti','CrazyPink','Cromback','DoHyeon','Funkrocker','GraffitiUrban','GraffitiXenoa','Hanbai','HelvairGraffiti','HitMePunk12','HitMePunk3','HitMePunk8','IF','KertoGrunge','Kotaru','Lordcorps','MiddlecaseNext','Mustasurma','PoppinsBlack','PostNoBills','PottaOne','ProtestGuerrilla','PunkKid','Refurbished','Regbout','Renji','Retrera','Rusted','Spacedock','SpikyFrog','StencilForce','StencilPixel7','Stencilan','StreetEagle','UrbanSlash','VtksSmash','VtksZkla','WarbandStencil'].map(f => "'" + f + "', system-ui")
const HVFT_TXT_COLORS = ['#FFFFFF', '#F2A03D', '#FF3B30', '#3B82F6', '#22D3A5', '#C084FC', '#FDE047', '#FF7AB6']
const HVFT_SCRAMBLE = '!<>-_\\/[]{}=+*^?#________'
let _txShuffle = 0, _txPrevOnset = 0
// Oct 12 fix: the inspector's FONTS ticks / 1 FONT PER LINE / LETTER SPACING never reached the renderers
function _txPool (cfg) { const F = cfg && Array.isArray(cfg.fonts) ? cfg.fonts.filter(i => HVFT_FONTS[i]).map(i => HVFT_FONTS[i]) : []; return F.length ? F : HVFT_FONTS }
// audio snapshot for text (works with band as {low,mid,high} or [l,m,h]; honours the mic gate + SEBERAPA REAKTIF)
function _txAud (f, cfg) {
  const b = f.band || {}, A = Array.isArray(b)
  const low = (A ? b[0] : b.low) || 0, mid = (A ? b[1] : b.mid) || 0, high = (A ? b[2] : b.high) || 0
  const on = f.audioOn != null ? !!f.audioOn : !!(typeof window !== 'undefined' && window.HVFT_MIC_ON)
  const amt = f.audAmt != null ? f.audAmt : 0.4
  const rc = on ? Math.min(1, amt * 2.5) : 0          // 40% "SEBERAPA REAKTIF" = full chaos, 0% = frozen
  const react = (cfg && cfg.react != null) ? cfg.react : 1
  const e = Math.min(1.6, (low * 1.4 + mid * 0.5 + high * 0.7 + (f.onset || 0) * 1.3) * rc * react)
  return { low: low * rc, mid: mid * rc, high: high * rc, onset: (f.onset || 0) * rc, e, rc }
}
// RANDOM text line. Silent = clean, readable stack. Hit by sound = as random & harsh as possible:
// per-letter random font / glyph scramble / drop-outs / scale / stretch / tilt / scatter,
// inverted blocks, outlines, ghost echoes, whole-line jumps + tilt, tear bars, debris, giant flash letters.
function _hvftTextLine (ctx, f, D, cfg, line, cx, cyv, li) {
  const A = f._txA || _txAud(f, cfg), p = Math.min(1, A.e)
  const tick = f.tick || 0, lut = f.lut
  const fr = p > 0.05 ? tick : (tick >> 4)              // loud -> fresh randomness every frame
  const R = (a, b) => (hash(a * 7919 + (li || 0) * 131 + 17, b * 997 + fr * 3 + _txShuffle * 977) % 10000) / 10000
  const POOL = _txPool(cfg)
  const lineFi = hash(line.length * 31 + (line.charCodeAt(0) || 0) + (li || 0) * 101, _txShuffle) % POOL.length
  const baseFont = POOL[lineFi]
  const LS = cfg.letter || 0
  const chars = line.toUpperCase().split('')
  const baseSize = D.H * (cfg.size != null ? cfg.size : 0.16)
  const size = baseSize * (1 + A.low * 0.35 + (p > 0.3 ? (R(1, 1) - 0.3) * p * 0.9 : 0))
  const lx = cx + (p > 0.2 ? (R(2, 2) - 0.5) * D.W * 0.55 * p : 0)
  const ly = cyv + (p > 0.2 ? (R(3, 3) - 0.5) * D.H * 0.4 * p : 0)
  const rot = p > 0.25 ? (R(4, 4) - 0.5) * 0.7 * p : 0
  const RND = !!(lut && lut.name === 'random')
  const baseHue = hash((li || 0) * 7 + 3, _txShuffle * 13 + 5) % 360          // one hue per line, new on every beat
  const col0 = (v) => (typeof lutCss === 'function' && lut) ? lutCss(lut, v, 1) : 'rgb(' + v + ',' + v + ',' + v + ')'
  let _ci = 0
  const col = RND ? (v) => {   // RANDOM: silent = line hue (small drift per letter); hit = any hue per letter, every frame
    const k = _ci++, hu = p > 0.05 ? (R(k, 50) * 360) | 0 : (baseHue + (R(k, 51) - 0.5) * 50 + 360) % 360
    return 'hsl(' + hu + ',100%,' + (v >= 240 ? 58 + (R(k, 52) * 18 | 0) : 48) + '%)'
  } : col0
  const GLY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$!?/\\<>[]=+*'
  ctx.save(); ctx.translate(lx, ly); ctx.rotate(rot)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = (size | 0) + 'px ' + baseFont
  let total = 0
  const ws = chars.map(c => { const w = c === ' ' ? size * 0.4 : ctx.measureText(c).width; total += w + size * (0.06 + LS); return w })
  let x = -total / 2
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i]; const w = ws[i], cxc = x + w / 2
    x += w + size * (0.06 + LS)
    if (ch === ' ') continue
    if (p > 0.05 && R(i, 11) < p * 0.2) continue                                        // letter drops out
    if (R(i, 12) < p * 0.55) ch = R(i, 13) < 0.5 ? HVFT_SCRAMBLE[(R(i, 25) * HVFT_SCRAMBLE.length) | 0] : GLY[(R(i, 26) * GLY.length) | 0]
    const fnt = (!cfg.oneFont && R(i, 14) < p * 0.95) ? POOL[(R(i, 15) * POOL.length) | 0] : baseFont
    const sc = Math.max(0.3, 1 + (R(i, 16) - 0.35) * p * 1.8)
    const sx = R(i, 17) < p * 0.4 ? 0.45 + R(i, 27) * 2.0 : 1
    const jx = (R(i, 18) - 0.5) * size * 0.9 * p, jy = (R(i, 19) - 0.5) * size * 1.1 * p
    ctx.save(); ctx.translate(cxc + jx, jy); ctx.rotate((R(i, 20) - 0.5) * 1.1 * p); ctx.scale(sx * sc, sc)
    ctx.font = (size | 0) + 'px ' + fnt
    const st = R(i, 21)
    if (p > 0.15 && st < p * 0.18) {                                                     // inverted block
      const bw = w * 1.1, bh = size * 0.95
      ctx.fillStyle = col(245); ctx.fillRect(-bw / 2, -bh / 2, bw, bh)
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillText(ch, 0, 0); ctx.globalCompositeOperation = 'source-over'
    } else if (p > 0.1 && st < p * 0.42) {                                              // outline
      ctx.strokeStyle = col(245); ctx.lineWidth = Math.max(1.2, size * 0.03); ctx.strokeText(ch, 0, 0)
    } else { ctx.fillStyle = col(245); ctx.fillText(ch, 0, 0) }
    if (p > 0.2 && R(i, 22) < p * 0.35) {                                                // ghost echo
      ctx.globalAlpha = 0.35; ctx.fillStyle = col(200); ctx.fillText(ch, (R(i, 23) - 0.5) * size * 0.8, (R(i, 24) - 0.5) * size * 0.5); ctx.globalAlpha = 1
    }
    ctx.restore()
  }
  if (p > 0.25) {                                                                        // tear bars + debris
    ctx.fillStyle = col(240)
    const nb = (2 + p * 8) | 0
    for (let k = 0; k < nb; k++) { const bw2 = total * (0.1 + R(k, 31) * 1.2), bh2 = Math.max(1, size * (0.01 + R(k, 32) * 0.06)); ctx.fillRect((R(k, 33) - 0.5) * total * 1.4 - bw2 / 2, (R(k, 34) - 0.5) * size * 1.6, bw2, bh2) }
    const nd = (p * 26) | 0
    for (let k = 0; k < nd; k++) { const q = size * (0.03 + R(k, 35) * 0.12); ctx.fillRect((R(k, 36) - 0.5) * total * 1.3, (R(k, 37) - 0.5) * size * 1.8, q, q * (0.3 + R(k, 38))) }
  }
  ctx.restore()
  if (p > 0.6 && R(99, 41) < (p - 0.5) * 0.35) {                                       // giant flash letter
    ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = col(255); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = ((D.H * 1.1) | 0) + 'px ' + POOL[(R(99, 42) * POOL.length) | 0]
    ctx.fillText(chars[(R(99, 43) * chars.length) | 0] || 'X', D.W * (0.2 + R(99, 44) * 0.6), D.H * 0.5)
    ctx.restore()
  }
}
// HVFT VISION — Media Mix (kolase PNG / new-media-art live). Disisipkan ke effects.js.
// Bank PNG dimuat dari folder collage/ (hvftLoadCollage). Efek menyusun banyak potongan
// PNG jadi kolase hidup: posisi/skala/rotasi ter-seed, hanyut ikut waktu, MENYUSUN ULANG
// tiap onset audio, membesar ikut beat. Bergantung global: hash, lutCss.
let _collageImgs = []
let _collageShuffle = 0, _collagePrevOnset = 0

function hvftLoadCollage (urls) {
  _collageImgs = (urls || []).map(u => {
    const el = new Image(); const rec = { el, ok: false, url: u }
    el.onload = () => { rec.ok = true }; el.onerror = () => { rec.ok = false }
    try { el.src = u } catch (e) {}
    return rec
  })
  return _collageImgs.length
}
function hvftCollageCount () { return _collageImgs.filter(r => r.ok).length }
function hvftCollageShuffle () { return _collageShuffle }

// latar = kanvas kolase (hitam). Subjek tidak dipakai; kolase murni.
function mediamixPixels (f) {
  const out = f.out
  out.fill(0)
  for (let j = 3; j < out.length; j += 4) out[j] = 255
}

function mediamixVector (ctx, f, D) {
  const onset = f.onset || 0, band = f.band || [0, 0, 0], tick = f.tick || 0
  const beat = band[0] || 0
  if (onset > 0.35 && _collagePrevOnset <= 0.35) _collageShuffle++
  _collagePrevOnset = onset
  const imgs = _collageImgs.filter(r => r.ok && r.el && (r.el.naturalWidth || 0) > 0)
  if (!imgs.length) {
    ctx.save()
    ctx.fillStyle = (typeof lutCss === 'function' && f.lut) ? lutCss(f.lut, 230, 0.9) : 'rgba(240,240,240,0.9)'
    ctx.font = (D.W * 0.02 | 0) + 'px ui-monospace, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.fillText('MEDIA MIX — bank PNG kosong', D.W / 2, D.H / 2 - D.W * 0.012)
    ctx.fillText('taruh file .png/.jpg di folder  collage/  lalu reload', D.W / 2, D.H / 2 + D.W * 0.014)
    ctx.restore()
    return
  }
  const N = 1 + Math.round(fxp(f, 'count', 0.45) * 47)     // 1..48 potongan
  const _msz = 0.25 + fxp(f, 'size', 0.45) * 2.0
  const _mdr = fxp(f, 'drift', 0.35) * 2.6
  const _msp = fxp(f, 'spin', 0.35) * 2.6
  for (let i = 0; i < N; i++) {
    const seed = hash(i * 61 + 7, _collageShuffle)
    const rec = imgs[hash(i * 13 + 1, _collageShuffle) % imgs.length]
    const img = rec.el
    const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1
    // ukuran bervariasi lebar: sebagian besar (latar), sebagian kecil (aksen)
    const big = (seed % 100) < 30
    const baseW = D.W * ((big ? 0.42 : 0.14) + (seed % 100) / 100 * (big ? 0.28 : 0.18)) * _msz * (1 + beat * 0.55)
    const sc = baseW / iw
    const w = iw * sc, h = ih * sc
    // posisi ter-seed + hanyut lembut
    const px = D.W * ((seed % 1000) / 1000) + Math.sin(tick * 0.03 + i) * D.W * 0.03 * _mdr
    const py = D.H * (((seed >> 10) % 1000) / 1000) + Math.cos(tick * 0.025 + i * 1.3) * D.H * 0.03 * _mdr
    let rot = ((seed >> 3) % 628) / 100 + Math.sin(tick * 0.02 + i) * 0.18 * _msp
    if (onset > 0.4) rot += ((((seed >> 5) % 200) / 200) - 0.5) * 0.7   // sentak rotasi saat onset
    ctx.save()
    ctx.translate(px, py); ctx.rotate(rot)
    ctx.globalAlpha = 0.82 + (seed % 18) / 100
    ctx.drawImage(img, -w / 2, -h / 2, w, h)
    ctx.restore()
  }
  ctx.globalAlpha = 1
}

// HVFT VISION — Cut-Out Kolase ("Tracking Cut Out Collage"). Disisipkan ke effects.js.
// Subjek disegmentasi -> dipotong dgn TEPI PUTIH robek -> ECHO buffer N frame (jejak gerak).
// LATAR = bank gambar gaya MAJALAH/ZINE full-frame yang BISA GANTI-GANTI (hvftLoadCutBg),
// berganti tiap hentakan audio & otomatis tiap ~2 detik. Bergantung global: hash, document.
let _cutCv, _cutCtx, _borCv, _borCtx, _sprCv, _sprCtx, _cutImg
let _cutHist = [], _cutHN = 6, _cutHi = 0, _cutPrevOn = 0
let _cutBgs = [], _cutBgIdx = 0, _cutBgTick = 0
function hvftLoadCutBg (urls) {
  _cutBgs = (urls || []).map(u => { const el = new Image(); const rec = { el, ok: false }; el.onload = () => { rec.ok = true }; el.onerror = () => { rec.ok = false }; try { el.src = u } catch (e) {} return rec })
  return _cutBgs.length
}
function hvftCutBgCount () { return _cutBgs.filter(r => r.ok).length }
function _cutEnsure (W, H) {
  if (!_cutCv) {
    _cutCv = document.createElement('canvas'); _cutCtx = _cutCv.getContext('2d')
    _borCv = document.createElement('canvas'); _borCtx = _borCv.getContext('2d')
    _sprCv = document.createElement('canvas'); _sprCtx = _sprCv.getContext('2d')
  }
  if (_cutCv.width !== W || _cutCv.height !== H) {
    for (const c of [_cutCv, _borCv, _sprCv]) { c.width = W; c.height = H }
    _cutImg = _cutCtx.createImageData(W, H)
  }
  if (_cutHist.length !== _cutHN) {
    _cutHist = []
    for (let k = 0; k < _cutHN; k++) { const c = document.createElement('canvas'); _cutHist.push({ cv: c, ctx: c.getContext('2d'), ready: false }) }
  }
  for (const h of _cutHist) { if (h.cv.width !== W || h.cv.height !== H) { h.cv.width = W; h.cv.height = H; h.ready = false } }
}
function _drawCover (ctx, im, DW, DH) {
  const iw = im.naturalWidth || im.width || 1, ih = im.naturalHeight || im.height || 1
  const s = Math.max(DW / iw, DH / ih), w = iw * s, h = ih * s
  ctx.drawImage(im, (DW - w) / 2, (DH - h) / 2, w, h)
}
// latar cadangan = kamera (kalau bank background kosong)
function cutoutPixels (f) {
  const out = f.out, rgb = f.rgb
  out.set(rgb)
  for (let j = 3; j < out.length; j += 4) out[j] = 255
}
function cutoutVector (ctx, f, D) {
  const W = f.W, H = f.H, mask = f.mask, rgb = f.rgb
  const onset = f.onset || 0, band = f.band || [0, 0, 0]
  const beat = band[0] || 0
  _cutEnsure(W, H)
  // 1) SUBJEK: piksel kamera di area mask, sisanya transparan
  const d = _cutImg.data
  for (let i = 0, j = 0; i < W * H; i++, j += 4) { d[j] = rgb[j]; d[j + 1] = rgb[j + 1]; d[j + 2] = rgb[j + 2]; d[j + 3] = mask[i] ? 255 : 0 }
  _cutCtx.putImageData(_cutImg, 0, 0)
  // 2) TEPI PUTIH robek = piksel luar-mask dekat subjek (radius r), diacak agar robek
  const r = Math.max(1, (W * (0.002 + fxp(f, 'tear', 0.40) * 0.055)) | 0)
  const _crg = 20 + fxp(f, 'rough', 0.60) * 80        // 20..100: makin besar = tepi makin padat
  for (let y = 0; y < H; y++) {
    const yb = y * W
    for (let x = 0; x < W; x++) {
      const i = yb + x
      let edge = 0
      if (!mask[i]) {
        if ((x - r >= 0 && mask[i - r]) || (x + r < W && mask[i + r]) ||
            (y - r >= 0 && mask[i - r * W]) || (y + r < H && mask[i + r * W]) ||
            (x - r >= 0 && y - r >= 0 && mask[i - r * W - r]) || (x + r < W && y - r >= 0 && mask[i - r * W + r]) ||
            (x - r >= 0 && y + r < H && mask[i + r * W - r]) || (x + r < W && y + r < H && mask[i + r * W + r])) edge = 1
      }
      const j = i * 4
      if (edge && (hash(x * 7 + y * 13, 0) % 100) < _crg) { d[j] = 255; d[j + 1] = 255; d[j + 2] = 255; d[j + 3] = 255 }
      else { d[j] = 0; d[j + 1] = 0; d[j + 2] = 0; d[j + 3] = 0 }
    }
  }
  _borCtx.putImageData(_cutImg, 0, 0)
  // 3) SPRITE = tepi putih + subjek ; dorong ke buffer riwayat
  _sprCtx.clearRect(0, 0, W, H); _sprCtx.drawImage(_borCv, 0, 0); _sprCtx.drawImage(_cutCv, 0, 0)
  const slot = _cutHist[_cutHi]; slot.ctx.clearRect(0, 0, W, H); slot.ctx.drawImage(_sprCv, 0, 0); slot.ready = true
  // 4) LATAR MAJALAH yang GANTI-GANTI (tiap onset + otomatis tiap ~2 dtk)
  if (onset > 0.4 && _cutPrevOn <= 0.4) _cutBgIdx++
  _cutPrevOn = onset
  if (++_cutBgTick > Math.max(4, 300 - fxp(f, 'swap', 0.45) * 296)) { _cutBgTick = 0; _cutBgIdx++ }   // makin besar = makin sering ganti
  const bgs = _cutBgs.filter(rr => rr.ok && rr.el && (rr.el.naturalWidth || 0) > 0)
  if (bgs.length) {
    const idx = ((_cutBgIdx % bgs.length) + bgs.length) % bgs.length
    ctx.save(); ctx.globalAlpha = 1
    _drawCover(ctx, bgs[idx].el, D.W, D.H)
    // sedikit denyut zoom saat beat
    ctx.restore()
  }
  // 5) ECHO: gambar riwayat TERLAMA -> TERBARU (jejak sepanjang lintasan), subjek terbaru di atas
  ctx.save(); ctx.imageSmoothingEnabled = true
  for (let e = _cutHN - 1; e >= 0; e--) {
    const idx = (_cutHi - e + _cutHN) % _cutHN
    const h = _cutHist[idx]; if (!h.ready) continue
    ctx.globalAlpha = (e === 0) ? 1 : clamp((0.10 + (_cutHN - 1 - e) / (_cutHN - 1) * 0.42) * fxp(f, 'echo', 0.45) * 2.2, 0, 1)
    ctx.drawImage(h.cv, 0, 0, W, H, D.ox, D.oy, W * D.s, H * D.s)
  }
  ctx.restore()
  _cutHi = (_cutHi + 1) % _cutHN
  void beat
}

// HVFT VISION — Tracking Kolase (Video C/D look). Disisipkan ke effects.js.
// Subjek(-subjek) TAMPIL BERWARNA di atas HITAM (cut-out), tiap objek terdeteksi diberi
// BOUNDING BOX (merah/hijau) + ALAS PUTIH (pedestal) di bawah kaki + label TRK + skor.
// Butuh blob objek: pipeline otomatis updateObjects saat effect='trackcollage'.
// Bergantung global: hash.
function trackPixels (f) {
  const out = f.out, rgb = f.rgb, mask = f.mask, N = f.W * f.H
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    if (mask[i]) { out[j] = rgb[j]; out[j + 1] = rgb[j + 1]; out[j + 2] = rgb[j + 2] } else { out[j] = 0; out[j + 1] = 0; out[j + 2] = 0 }
    out[j + 3] = 255
  }
}
function trackVector (ctx, f, D) {
  const blobs = f.blobs || []
  const beat = (f.band && f.band[0]) || 0
  ctx.save()
  ctx.textBaseline = 'alphabetic'
  const _tlb = 0.3 + fxp(f, 'label', 0.40) * 2.2
  const _tbw = 0.2 + fxp(f, 'box', 0.40) * 2.4
  const _tcr = fxp(f, 'corner', 0.45) * 1.0        // 0 = tanpa sudut, 1 = sudut panjang
  const _tpd = fxp(f, 'pedestal', 0.40) * 2.5
  ctx.font = (Math.max(7, D.W * 0.011 * _tlb) | 0) + 'px ui-monospace, Menlo, monospace'
  for (let k = 0; k < blobs.length; k++) {
    const b = blobs[k]
    const cx = D.mx(b.x), cy = D.my(b.y)
    const w = ((b.w || f.W * 0.12) * D.s), h = ((b.h || f.H * 0.28) * D.s)
    const x0 = cx - w / 2, y0 = cy - h / 2, py = y0 + h
    const col = (k % 2 === 0) ? '#ff3b30' : '#39f582'
    // ALAS PUTIH (pedestal trapesium) di bawah kaki
    const ph = Math.max(1, D.H * 0.02 * _tpd)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath(); ctx.moveTo(cx - w * 0.42, py); ctx.lineTo(cx + w * 0.42, py); ctx.lineTo(cx + w * 0.6, py + ph); ctx.lineTo(cx - w * 0.6, py + ph); ctx.closePath(); ctx.fill()
    // BOUNDING BOX + sudut
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(0.5, D.W * 0.002 * _tbw * (1 + beat * 0.6))
    ctx.strokeRect(x0, y0, w, h)
    const t = Math.min(w, h) * 0.22 * _tcr
    ctx.beginPath()
    ctx.moveTo(x0, y0 + t); ctx.lineTo(x0, y0); ctx.lineTo(x0 + t, y0)
    ctx.moveTo(x0 + w - t, y0); ctx.lineTo(x0 + w, y0); ctx.lineTo(x0 + w, y0 + t)
    ctx.moveTo(x0, y0 + h - t); ctx.lineTo(x0, y0 + h); ctx.lineTo(x0 + t, y0 + h)
    ctx.moveTo(x0 + w - t, y0 + h); ctx.lineTo(x0 + w, y0 + h); ctx.lineTo(x0 + w, y0 + h - t)
    ctx.lineWidth = Math.max(0.6, D.W * 0.0032 * _tbw); ctx.stroke()
    // LABEL
    const sc = (b.e != null) ? b.e : (hash(k * 13 + 1, (f.tick >> 5)) % 99)
    const tag = (b.label || ('TRK' + String((k * 131) % 1000).padStart(3, '0')))
    ctx.fillStyle = col
    const lbh = D.W * 0.016 * _tlb
    ctx.fillRect(x0, y0 - lbh, ctx.measureText(tag + ' ' + sc).width + 8, lbh)
    ctx.fillStyle = '#000'
    ctx.fillText(tag + ' ' + sc, x0 + 4, y0 - lbh * 0.25)
  }
  ctx.restore()
}

// HVFT VISION — mode teks lanjutan (disisipkan ke effects.js sebelum drawHvftText).
// Bergantung pada global: hash, HVFT_FONTS, _txShuffle, document.
// Semua monokrom putih-di-hitam (bisa di-LUT oleh kompositor).

// bangun baris ter-stack yang MUAT LEBAR frame (banyak kata tidak memanjang/terpotong).
// Baris = pisah Enter; ukuran diskalakan agar baris terlebar <= 94% lebar & muat tinggi.
function _txStack (ctx, raw, font, W, H, sizeFrac) {
  let lines = (raw || '').split('\n').map(s => s.trim().toUpperCase()).filter(Boolean)
  if (!lines.length) lines = ['HVFT']
  const n = lines.length
  let size = Math.min(H / n * 0.9, H * (sizeFrac != null ? sizeFrac : 0.16) * 2.4)
  ctx.font = (size | 0) + 'px ' + font
  let widest = 1
  for (const ln of lines) widest = Math.max(widest, ctx.measureText(ln).width)
  if (widest > W * 0.94) size *= (W * 0.94) / widest
  return { lines, size: Math.max(8, size) }
}

// KINETIK (warp) — ala video AE "PANTER": DUA baris besar bertumpuk mengisi frame,
// blok MENYKALA UNIFORM (meledak) ikut beat + menggeser sampai huruf TERPOTONG tepi frame.
// Putih pekat di hitam, satu font. cfg.kOutline (0..100) porsi baris outline (default 0 = isi penuh).
// KINETIC — LIVE CUT PACK (Oct 7, iteration 5). Built for HARSH NOISE (a continuous sound, not beats): the frame is
// ALWAYS filled with type and the layout never "changes page" — it MOVES all the time.
// Layout = a guillotine tree of cuts; every cut line is a spring on its own band (LOW / MID / HIGH). Each band is
// normalised against its own running mean + deviation, so even a steady wall of noise keeps every spring busy.
// WORD CUTTING: words are chopped into fragments (NEG|ARA, N|EGA|RA) laid out in reading order.
//   All type is HORIZONTAL (no rotation). Bold clean fonts only. (SLICE / CROP cells were tried and removed.)
// Bursts kick the springs + flash one cell; now and then (>= ~2.5 s apart) the tree is rebuilt and GLIDES there.
// Silent / mic off = calm rows with a slow breathing drift (zero audio reaction).
const HVFT_KIN_FONTS = [   // bold, clean faces only (macOS system + bundled); each falls back to a heavy sans
  "900 100px 'Helvetica Neue', 'Arial Black', sans-serif", "900 100px 'Avenir Next Condensed', 'Arial Black', sans-serif",
  "900 100px 'Avenir Next', 'Arial Black', sans-serif", "700 100px 'DIN Condensed', 'Arial Black', sans-serif",
  "400 100px Impact, 'Arial Black', sans-serif", "900 100px 'Arial Black', sans-serif", "700 100px Futura, 'Arial Black', sans-serif",
  "400 100px 'PoppinsBlack', 'Arial Black', sans-serif", "400 100px 'BlackOpsOne', 'Arial Black', sans-serif", "400 100px 'DoHyeon', 'Arial Black', sans-serif"
]
const _KIN_R = [0.25, 1 / 3, 0.4, 0.5, 0.6, 2 / 3, 0.75]
const _kin = { key: '', tree: null, leaves: null, calm: true, prev: 0, lastBuild: -999, lastKick: -99, quiet: 0, tw: 1, from: null, seed: 0,
  mu: [0.3, 0.3, 0.3], sd: [0.05, 0.05, 0.05], dv: [0, 0, 0], pd: [0, 0, 0], flash: -1, flashT: 0 }
function _kinTok (raw) {
  const words = raw.replace(/\s*\n\s*/g, ' ').trim().split(/\s+/).filter(Boolean).map(w => w.toUpperCase())
  if (!words.length) return { words: ['HVFT'], tok: ['HVFT'], repeat: true }
  if (words.length <= 3) return { words, tok: [words.join(' ')].concat(words.length > 1 ? words : []), repeat: true }
  const per = Math.ceil(words.length / 12), tok = []
  for (let i = 0; i < words.length; i += per) tok.push(words.slice(i, i + per).join(' '))
  return { words, tok, repeat: false }
}
function _kinChop (w, rnd, maxP) {   // creative word cut: NEGARA -> NEG|ARA, N|EGA|RA, NEGA|RA ...
  const L = w.length
  if (L < 3 || maxP < 2) return [w]
  const np = Math.min(maxP, L < 6 ? 2 : 2 + Math.floor(rnd() * 2))
  for (let a = 0; a < 8; a++) {
    const minL = rnd() < 0.3 ? 1 : 2, cuts = []
    for (let k = 0; k < np - 1; k++) cuts.push(1 + Math.floor(rnd() * (L - 1)))
    cuts.sort((x, y) => x - y)
    const pts = [0].concat(cuts, [L]), parts = []
    let ok = true
    for (let k = 0; k < pts.length - 1; k++) { if (pts[k + 1] - pts[k] < minL) { ok = false; break } parts.push(w.slice(pts[k], pts[k + 1])) }
    if (ok) return parts
  }
  const h = Math.ceil(L / 2); return [w.slice(0, h), w.slice(h)]
}
function _kinSeq (T, n, rnd, cut) {   // short text: phrase / words / chopped words, in reading order
  const out = []; let g = Math.floor(rnd() * T.words.length)
  while (out.length < n) {
    if (T.words.length > 1 && rnd() < 0.2) { out.push(T.words.join(' ')); continue }
    const w = T.words[g++ % T.words.length]
    if (rnd() < cut) { const p = _kinChop(w, rnd, 3); for (const q of p) out.push(q) } else out.push(w)
  }
  return out.slice(0, 10)
}
function _kinSeqLong (T, rnd, cut) {   // long text: keep reading order, chop some long single words
  const out = []
  for (const t of T.tok) {
    if (t.indexOf(' ') < 0 && t.length >= 5 && out.length < 15 && rnd() < cut * 0.7) { const p = _kinChop(t, rnd, t.length >= 8 ? 3 : 2); for (const q of p) out.push(q) }
    else out.push(t)
  }
  return out
}
const _kinMcache = {}
function _kinMeasure (ctx, t, font) {
  const k = font + '|' + t; if (_kinMcache[k]) return _kinMcache[k]
  ctx.font = font
  const m = ctx.measureText(t)
  const L = m.actualBoundingBoxLeft != null ? m.actualBoundingBoxLeft : 0, R = m.actualBoundingBoxRight != null ? m.actualBoundingBoxRight : m.width
  const A = m.actualBoundingBoxAscent != null ? m.actualBoundingBoxAscent : 72, D = m.actualBoundingBoxDescent != null ? m.actualBoundingBoxDescent : 0
  const r = { L, A, w: Math.max(1, L + R), h: Math.max(1, A + D) }
  if (Object.keys(_kinMcache).length > 800) for (const q in _kinMcache) delete _kinMcache[q]
  _kinMcache[k] = r; return r
}
function _kinDist (r, m) { return Math.abs(Math.log((r.w / m.w) / (r.h / m.h))) }
// tree helpers: node = { leaf:true } | { v:bool (vertical cut = side by side), base, f, vel, k, sg, ph, a, b }
function _kinNode (v, base, a, b, rnd) { return { v, base, f: base, vel: 0, k: Math.floor(rnd() * 3), sg: rnd() < 0.5 ? -1 : 1, ph: rnd() * 6.28, a, b } }
function _kinRandTree (x, y, w, h, n, rnd) {   // random tidy guillotine tree with exactly n leaves
  if (n <= 1) return { leaf: true }
  const v = w > h * 1.3 ? rnd() < 0.8 : h > w * 1.3 ? rnd() < 0.2 : rnd() < 0.5
  const f = _KIN_R[Math.floor(rnd() * _KIN_R.length)], na = Math.max(1, Math.min(n - 1, Math.round(n * f + (rnd() - 0.5))))
  return v ? _kinNode(true, f, _kinRandTree(x, y, w * f, h, na, rnd), _kinRandTree(x + w * f, y, w * (1 - f), h, n - na, rnd), rnd)
    : _kinNode(false, f, _kinRandTree(x, y, w, h * f, na, rnd), _kinRandTree(x, y + h * f, w, h * (1 - f), n - na, rnd), rnd)
}
function _kinChain (v, weights, kids, rnd) {   // a row/column chain as nested binary cuts
  if (kids.length === 1) return kids[0]
  const tot = weights.reduce((a, b) => a + b, 0), f = weights[0] / tot
  return _kinNode(v, f, kids[0], _kinChain(v, weights.slice(1), kids.slice(1), rnd), rnd)
}
function _kinRowTree (seq, rows, rnd, calm) {   // reading-order rows; each row = columns sized by token length
  const n = seq.length, counts = new Array(rows).fill(1)
  for (let i = rows; i < n; i++) counts[calm ? Math.floor(i * rows / n) : Math.floor(rnd() * rows)]++
  const rowsN = [], hw = []; let ti = 0
  for (let r = 0; r < rows; r++) {
    const cols = [], ws = []
    for (let k = 0; k < counts[r]; k++) { cols.push({ leaf: true }); ws.push(Math.max(2, seq[ti + k].length) * (calm ? 1 : 0.7 + rnd() * 0.6)) }
    rowsN.push(_kinChain(true, ws, cols, rnd)); hw.push(calm ? 1 : 0.6 + rnd() * 1.2); ti += counts[r]
  }
  return _kinChain(false, hw, rowsN, rnd)
}
function _kinLeaves (node, x, y, w, h, out) {   // live leaf rects in reading order
  if (node.leaf) { out.push({ x, y, w, h }); return out }
  const f = node.f
  if (node.v) { _kinLeaves(node.a, x, y, w * f, h, out); _kinLeaves(node.b, x + w * f, y, w * (1 - f), h, out) }
  else { _kinLeaves(node.a, x, y, w, h * f, out); _kinLeaves(node.b, x, y + h * f, w, h * (1 - f), out) }
  return out
}
function _kinEachCut (node, fn) { if (!node || node.leaf) return; fn(node); _kinEachCut(node.a, fn); _kinEachCut(node.b, fn) }
function _kinSpr (rnd) { return { o: 0, v: 0, k: Math.floor(rnd() * 3), sg: rnd() < 0.5 ? -1 : 1, ph: rnd() * 6.28 } }
function _kinBuild (ctx, W, H, T, sd, react, calm) {
  let s = (sd * 2654435761 + 7) >>> 0
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  const KF = _kin.pool || HVFT_KIN_FONTS
  const fonts = calm ? [KF[0]] : [KF[Math.floor(rnd() * KF.length)]]
  if (!calm && rnd() < 0.5) fonts.push(KF[Math.floor(rnd() * KF.length)])
  const rq = Math.min(1, 0.4 + react * 0.6), cut = 0.45 + 0.4 * rq
  let best = null
  const tries = calm ? (T.repeat ? 4 : Math.min(8, T.tok.length)) : 28
  for (let c = 0; c < tries; c++) {
    let tree, seq
    if (calm) {
      const rows = c + 1
      if (T.repeat) { seq = new Array(rows).fill(T.tok[0]); tree = _kinChain(false, new Array(rows).fill(1), seq.map(() => ({ leaf: true })), rnd) }
      else { seq = T.tok; tree = _kinRowTree(seq, rows, rnd, true) }
    } else if (T.repeat) {
      seq = _kinSeq(T, 3 + Math.floor(rnd() * 6), rnd, cut)
      tree = rnd() < 0.5 ? _kinRandTree(0, 0, W, H, seq.length, rnd) : _kinRowTree(seq, Math.max(1, Math.min(seq.length, 2 + Math.floor(rnd() * 3))), rnd, false)
    } else {
      seq = _kinSeqLong(T, rnd, cut)
      tree = _kinRowTree(seq, Math.max(1, Math.min(seq.length, 2 + Math.floor(rnd() * 4))), rnd, false)
    }
    const rects = _kinLeaves(tree, 0, 0, W, H, []), n = rects.length
    let cost = 0
    const leaves = rects.map((r, i) => {
      const t = seq[i] || seq[i % seq.length], font = fonts[i % fonts.length], m = _kinMeasure(ctx, t, font), d = _kinDist(r, m)
      cost += d * d + (r.w * r.h < W * H * 0.025 ? 2 : 0) + (d > 1.3 ? 4 : 0)
      return { t, font, m, inv: false, out: false, sl: null, cr: null }
    })
    cost /= n
    if (!best || cost < best.cost) best = { cost, tree, leaves }
    else if (!calm && cost < best.cost * 1.15 && rnd() < 0.35) best = { cost, tree, leaves }   // a little variety among the good ones
  }
  if (!calm) {
    best.leaves.forEach(l => {
      l.inv = rnd() < 0.1 * rq; l.out = !l.inv && rnd() < 0.07 * rq
      // SLICE / CROP cells removed (Reza: not wanted) — l.sl / l.cr stay null
    })
  }
  return best
}
function _kinRebuild (ctx, W, H, T, calm, react, tick) {
  const old = _kin.tree ? _kinLeaves(_kin.tree, 0, 0, W, H, []) : null
  _kin.seed++
  const b = _kinBuild(ctx, W, H, T, _kin.seed * 7919 + (tick & 1023), react, calm)
  _kin.tree = b.tree; _kin.leaves = b.leaves; _kin.calm = calm; _kin.flash = -1
  if (old) { _kin.from = old; _kin.tw = 0 } else { _kin.from = null; _kin.tw = 1 }
}
function _kinStep (p, target, kick) {   // shared spring
  p.v += (target - p.o) * 0.3 + kick; p.v *= 0.66; p.o += p.v
}
function _txKinetic (ctx, f, D, cfg, raw) {
  const W = D.W, H = D.H, tick = f.tick || 0
  const B = f.band || {}, rc = f.audioOn ? Math.min(1, (f.audAmt == null ? 0.4 : f.audAmt) * 2.5) : 0
  const bl = (B.low != null ? B.low : (Array.isArray(B) ? B[0] : 0)) || 0, bm = (B.mid != null ? B.mid : (Array.isArray(B) ? B[1] : 0)) || 0, bh = (B.high != null ? B.high : (Array.isArray(B) ? B[2] : 0)) || 0
  const env = [bl * rc, bm * rc, bh * rc], onset = (f.onset || 0) * rc
  const react = (cfg.react != null ? cfg.react : 1), drive = rc * Math.min(1.5, 0.35 + react * 1.15)
  // noise-adaptive deviation per band: -1..1 relative to the band's own running mean (steady noise still moves)
  const dv = _kin.dv; let flux = 0
  for (let k = 0; k < 3; k++) {
    _kin.mu[k] += (env[k] - _kin.mu[k]) * 0.04
    _kin.sd[k] += (Math.abs(env[k] - _kin.mu[k]) - _kin.sd[k]) * 0.06
    const d = (env[k] - _kin.mu[k]) / Math.max(0.012, _kin.sd[k] * 1.8)
    dv[k] = drive > 0 ? (d > 1 ? 1 : d < -1 ? -1 : d) : 0
    flux += Math.max(0, dv[k] - _kin.pd[k]); _kin.pd[k] = dv[k]
  }
  _kin.pool = (cfg.fonts && cfg.fonts.length) ? _txPool(cfg) : null   // ticked FONTS replace the kinetic font set
  const T = _kinTok(raw), key = raw + '|' + W + 'x' + H + '|' + (cfg.fonts || []).join(',')
  const loud = (env[0] + env[1] + env[2]) / 3
  _kin.quiet = loud < 0.06 ? _kin.quiet + 1 : 0
  let burst = drive > 0 && tick - _kin.lastKick > 3 && ((onset > 0.3 && _kin.prev <= 0.3) || flux > 0.9); _kin.prev = onset
  if (burst) _kin.lastKick = tick
  if (key !== _kin.key || !_kin.tree) { _kin.key = key; _kin.tree = null; _kin.leaves = null; _kinRebuild(ctx, W, H, T, true, react, tick); _kin.lastBuild = tick }
  else if (drive > 0 && _kin.calm && loud > 0.08) { _kinRebuild(ctx, W, H, T, false, react, tick); _kin.lastBuild = tick }   // noise starts -> leave the calm rows
  else if (!_kin.calm && _kin.quiet > 120) { _kinRebuild(ctx, W, H, T, true, react, tick); _kin.lastBuild = tick }   // ~4 s silence -> calm rows
  else if (!_kin.calm && burst && tick - _kin.lastBuild > 75 && (hash(tick, _kin.seed) & 1)) { _kinRebuild(ctx, W, H, T, false, react, tick); _kin.lastBuild = tick }   // occasional new tree (glides)
  else if (_kin.calm && tick % 60 === 0 && _kin.tw >= 1) { for (const q in _kinMcache) delete _kinMcache[q]; _kin.leaves.forEach(l => { l.m = _kinMeasure(ctx, l.t, l.font) }) }   // fonts load late
  const t = tick
  // SPRINGS: every cut follows its band deviation + level + drift; bursts kick them
  const G = 0.3 * drive, amp = _kin.calm ? 0.025 : 0.04 + 0.2 * drive
  _kinEachCut(_kin.tree, n => {
    const target = n.base + n.sg * (dv[n.k] * G + (env[n.k] - 0.35) * 0.2 * drive) + Math.sin(t * (0.02 + n.k * 0.011) + n.ph) * amp * 0.4
    if (burst) n.vel += n.sg * (0.05 + 0.1 * drive) * (n.k === 0 ? 1.3 : 1)
    n.vel += (target - n.f) * 0.3; n.vel *= 0.66; n.f += n.vel
    n.f = n.f < 0.1 ? 0.1 : n.f > 0.9 ? 0.9 : n.f
  })
  if (burst && _kin.leaves.length > 1) { _kin.flash = hash(tick, 77) % _kin.leaves.length; _kin.flashT = 4 }
  if (_kin.flashT > 0) _kin.flashT--; else _kin.flash = -1
  _kin.tw = Math.min(1, _kin.tw + 1 / 12)
  const live = _kinLeaves(_kin.tree, 0, 0, W, H, [])
  const e = 1 - Math.pow(1 - _kin.tw, 3), F = _kin.from
  const g = Math.max(1, Math.min(W, H) * 0.011), gx = g * 2.2
  const lightness = 205 + Math.round(50 * Math.min(1, Math.max(0, dv[0]) * 0.7 + onset))
  const col = 'rgb(' + lightness + ',' + lightness + ',' + lightness + ')'
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  for (let i = 0; i < live.length; i++) {
    const c = _kin.leaves[i]; if (!c) continue
    const L = live[i]
    let r = L
    if (F && e < 1) { const o = F[i] || F[i % F.length]; r = { x: o.x + (L.x - o.x) * e, y: o.y + (L.y - o.y) * e, w: o.w + (L.w - o.w) * e, h: o.h + (L.h - o.h) * e } }
    const m = c.m
    const jx = dv[2] > 0.3 ? ((hash(i * 7 + 1, tick) % 1000) / 1000 - 0.5) * W * 0.008 * dv[2] * drive : 0
    const cw = Math.max(1, r.w - gx * 2), ch = Math.max(1, r.h - g * 2), bx = r.x + gx + jx, by = r.y + g
    const cx = bx + cw / 2, cy = by + ch / 2
    const inv = c.inv !== (i === _kin.flash)
    let txt = c.t
    if (burst) txt = txt.split('').map((q, k) => (q !== ' ' && (hash(k * 13 + i, tick) & 15) === 0) ? '#*/?'[hash(k, tick) & 3] : q).join('')   // one-frame glitch, solid glyphs only
    const dt = (x, y, sw, sh) => {
      ctx.save(); ctx.translate(x, y); ctx.scale(sw / m.w, sh / m.h); ctx.font = c.font
      const ox = -m.w / 2 + m.L, oy = -m.h / 2 + m.A
      if (inv) { ctx.fillStyle = '#000'; ctx.fillText(txt, ox, oy) }
      else if (c.out) { ctx.strokeStyle = col; ctx.lineWidth = 3 * m.w / Math.max(1, sw); ctx.strokeText(txt, ox, oy) }
      else { ctx.fillStyle = col; ctx.fillText(txt, ox, oy) }
      ctx.restore()
    }
    ctx.save()
    if (inv) { ctx.fillStyle = col; ctx.fillRect(bx, by, cw, ch) }
    ctx.beginPath(); ctx.rect(bx, by, cw, ch); ctx.clip()
    if (c.sl) {   // HORIZONTAL SLICES: strips slide sideways on their band (wrap-around)
      const n = c.sl.length, sh = ch / n, cutG = Math.max(1, g * 0.45)
      for (let j = 0; j < n; j++) {
        const p = c.sl[j]
        _kinStep(p, p.sg * dv[p.k] * 0.35 * drive + Math.sin(t * 0.045 + p.ph) * 0.03 * (_kin.calm ? 0 : 1), burst ? p.sg * (0.06 + 0.12 * drive) : 0)
        const sx = (p.o - Math.floor(p.o)) * cw
        ctx.save(); ctx.beginPath(); ctx.rect(bx, by + j * sh, cw, sh - (j < n - 1 ? cutG : 0)); ctx.clip()
        dt(cx + sx, cy, cw, ch); dt(cx + sx - cw, cy, cw, ch)
        ctx.restore()
      }
    } else if (c.cr) {   // CROP: oversized type pans so letters are cut by the cell edge
      const p = c.cr
      _kinStep(p, p.sg * dv[p.k] * 0.9 * drive + Math.sin(t * 0.03 + p.ph) * 0.3, burst ? p.sg * 0.2 * drive : 0)
      const pan = p.o < -1 ? -1 : p.o > 1 ? 1 : p.o, z = p.z
      dt(cx + pan * cw * (z - 1) / 2, cy, cw * z, ch * Math.min(z, 1.25))
    } else dt(cx, cy, cw, ch)
    ctx.restore()
  }
}

// MESH — teks dirender lalu di-warp per-kolom jadi gelombang ikut irama + garis mesh tipis.
function _txMesh (ctx, f, D, cfg, raw) {
  const W = D.W, H = D.H, tick = f.tick || 0
  const B = f.band || {}, rc = f.audioOn ? (f.audAmt == null ? 1 : f.audAmt) : 0
  const onset = (f.onset || 0) * rc, beat = (B.low || 0) * rc
  const react = cfg.react != null ? cfg.react : 1
  const FP = _txPool(cfg), font = FP[hash(1, _txShuffle) % FP.length]
  const t = document.createElement('canvas'); t.width = W; t.height = H
  const tc = t.getContext('2d'); if (!tc) return
  tc.fillStyle = '#fff'; tc.textAlign = 'center'; tc.textBaseline = 'middle'
  const st = _txStack(tc, raw, font, W, H, cfg.size)   // baris ter-stack, muat lebar
  tc.font = (st.size | 0) + 'px ' + font; tc.letterSpacing = Math.round((cfg.letter || 0) * st.size) + 'px'
  const lh = H / st.lines.length
  st.lines.forEach((ln, i) => tc.fillText(ln, W / 2, lh * (i + 0.5)))
  const size = st.size
  // KASAR: warp lebih kuat + kolom LEBAR (blocky) + sobekan horizontal acak per-kolom
  const amp = (H * 0.03) * (1 + beat * react * 5) + (onset > 0.35 ? H * 0.05 * react : 0)
  const step = Math.max(8, Math.floor(W / 90))          // kolom lebar -> tampak kasar/blocky
  for (let x = 0; x < W; x += step) {
    const dy = Math.sin(x * 0.03 + tick * 0.12) * amp
    const tear = (((hash((x / step) | 0, (tick >> 2)) % 100) / 100) - 0.5) * step * (1.2 + beat * 3)   // geser blok = sobek
    ctx.drawImage(t, x, 0, step, H, x + tear, dy, step, H)
  }
  // garis mesh lebih tegas & rapat (kasar)
  ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = Math.max(1.4, W * 0.0016)
  const gx = Math.max(8, Math.floor(W / 30))
  ctx.beginPath()
  for (let x = 0; x <= W; x += gx) {
    const dy = Math.sin(x * 0.03 + tick * 0.12) * amp
    ctx.moveTo(x, H * 0.5 - size * 0.8 + dy); ctx.lineTo(x, H * 0.5 + size * 0.8 + dy)
  }
  for (let y = H * 0.5 - size; y <= H * 0.5 + size; y += gx) { ctx.moveTo(0, y); ctx.lineTo(W, y) }   // garis horizontal -> jaring kasar
  ctx.stroke()
}

// DUST — teks jadi debu point-cloud: piksel huruf jadi titik, meledak/berjitter ikut audio.
function _txDust (ctx, f, D, cfg, raw) {
  const W = D.W, H = D.H, tick = f.tick || 0
  const B = f.band || {}, rc = f.audioOn ? (f.audAmt == null ? 1 : f.audAmt) : 0
  const low = (B.low || 0) * rc          // DUST: HANYA frekuensi LOW yang memicu perubahan
  const react = cfg.react != null ? cfg.react : 1
  const FP = _txPool(cfg), font = FP[hash(2, _txShuffle) % FP.length]
  const t = document.createElement('canvas'); t.width = W; t.height = H
  const tc = t.getContext('2d'); if (!tc) return
  tc.fillStyle = '#fff'; tc.textAlign = 'center'; tc.textBaseline = 'middle'
  const st = _txStack(tc, raw, font, W, H, cfg.size)   // baris ter-stack, muat lebar
  tc.font = (st.size | 0) + 'px ' + font; tc.letterSpacing = Math.round((cfg.letter || 0) * st.size) + 'px'
  const lh = H / st.lines.length
  st.lines.forEach((ln, i) => tc.fillText(ln, W / 2, lh * (i + 0.5)))
  let img; try { img = tc.getImageData(0, 0, W, H) } catch (e) { return }
  const d = img.data
  const stride = 5
  const explode = low * react * (W * 0.12)               // ledak ikut LOW saja
  const jit = 1 + low * react * 16                        // diam saat low kecil, bergetar saat bass masuk
  const dot = Math.max(1, W * 0.0016)
  ctx.fillStyle = '#fff'
  for (let y = 0; y < H; y += stride) {
    for (let x = 0; x < W; x += stride) {
      if (d[(y * W + x) * 4 + 3] < 128) continue
      const hsh = hash(x * 13 + y * 7, tick >> 2)
      const jx = ((hsh % 100) / 100 - 0.5) * jit
      const jy = (((hsh >> 7) % 100) / 100 - 0.5) * jit
      const ex = (x - W / 2), ey = (y - H / 2); const el = Math.hypot(ex, ey) || 1
      const ox = ex / el * explode * ((hsh >> 3 & 7) / 7)
      const oy = ey / el * explode * ((hsh >> 6 & 7) / 7)
      ctx.fillRect(x + jx + ox, y + jy + oy, dot, dot)
    }
  }
}

function _drawHvftTextCore (ctx, f, D, cfg) {
  const raw = (cfg && cfg.str ? cfg.str : '').toString()
  if (!raw.trim()) return
  // ORIENTASI VERTIKAL: putar kanvas -90° lalu gambar di ruang lebar-tinggi ditukar
  const V = !!(cfg && cfg.orient === 'v')
  let restore = false
  if (V) { ctx.save(); ctx.translate(D.W / 2, D.H / 2); ctx.rotate(-Math.PI / 2); ctx.translate(-D.H / 2, -D.W / 2); restore = true }
  const DD = V ? { W: D.H, H: D.W } : D
  const _mode = (cfg && cfg.mode) || 'random'
  if (_mode === 'kinetic') { _txKinetic(ctx, f, DD, cfg, raw); if (restore) ctx.restore(); return }
  if (_mode === 'mesh') { _txMesh(ctx, f, DD, cfg, raw); if (restore) ctx.restore(); return }
  if (_mode === 'dust') { _txDust(ctx, f, DD, cfg, raw); if (restore) ctx.restore(); return }
  // Oct 12: 8 styles from Reza's reference clips (txt_fx2.js)
  if (typeof window !== 'undefined' && window.HVFT_TXFX2 && window.HVFT_TXFX2[_mode]) { try { window.HVFT_TXFX2[_mode](ctx, f, DD, cfg, raw) } catch (e) {} if (restore) ctx.restore(); return }
  const onset = f.onset || 0
  if (onset > 0.35 && _txPrevOnset <= 0.35) _txShuffle++
  _txPrevOnset = onset
  // banyak baris: pisah dengan Enter. 1 baris = tengah; banyak = disebar acak.
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length)
  const n = lines.length
  // NETRAL: tumpukan rapi di tengah (bukan tersebar acak), spasi seragam
  const gap = DD.H * (cfg.size != null ? cfg.size : 0.16) * 1.35
  const y0 = DD.H * 0.5 - (n - 1) * gap / 2
  for (let li = 0; li < n; li++) {
    _hvftTextLine(ctx, f, DD, cfg, lines[li], DD.W * 0.5, y0 + li * gap, li)
  }
  if (restore) ctx.restore()
}
// TEXT entry point: draws the chosen mode; when sound hits, the text is drawn off-screen first and
// composited back in torn / shifted / stuttered / dropped horizontal slices (harsh, random, every frame).
let _txOff = null
function drawHvftText (ctx, f, D, cfg) {
  cfg = cfg || {}
  const A = _txAud(f, cfg)
  f._txA = A
  const cv = ctx && ctx.canvas
  const PAL = f.lut && (f.lut.name === 'hvft' || f.lut.name === 'random') ? f.lut.name : ''
  if ((A.e < 0.04 && !PAL) || !cv || typeof document === 'undefined' || !cv.width) { _drawHvftTextCore(ctx, f, D, cfg); return }
  if (!_txOff) { _txOff = document.createElement('canvas'); _txOff.c = _txOff.getContext('2d') }
  if (_txOff.width !== cv.width || _txOff.height !== cv.height) { _txOff.width = cv.width; _txOff.height = cv.height }
  const o = _txOff.c
  o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1; o.clearRect(0, 0, cv.width, cv.height)
  try { if (ctx.getTransform) o.setTransform(ctx.getTransform()) } catch (e) {}
  _drawHvftTextCore(o, f, D, cfg)
  o.setTransform(1, 0, 0, 1, 0, 0)
  if (PAL) _txPalette(ctx, _txOff, A, f.tick || 0, PAL)
  const kinQuiet = cfg.mode === 'kinetic' || !!(typeof window !== 'undefined' && window.HVFT_TXFX2 && window.HVFT_TXFX2[cfg.mode])   // KINETIC: the moving layout IS the reaction -> no tear on top (stays readable)
  if (A.e >= 0.04 && !kinQuiet) _txTear(ctx, _txOff, A, f.tick || 0)
  else if (PAL || kinQuiet) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(_txOff, 0, 0); ctx.restore() }
}
// HVFT colour for text: orange + red offset copies behind (two-tone when silent, split wider & random when hit),
// and on hits the white letters get torn bands of orange / red / ember painted onto them.
let _txTint = null
function _txTinted (src, col) {
  if (!_txTint) { _txTint = document.createElement('canvas'); _txTint.c = _txTint.getContext('2d') }
  if (_txTint.width !== src.width || _txTint.height !== src.height) { _txTint.width = src.width; _txTint.height = src.height }
  const t = _txTint.c
  t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, src.width, src.height)
  t.drawImage(src, 0, 0); t.globalCompositeOperation = 'source-atop'; t.fillStyle = col; t.fillRect(0, 0, src.width, src.height)
  t.globalCompositeOperation = 'source-over'
  return _txTint
}
function _txPalette (ctx, src, A, tick, mode) {
  const W = src.width, H = src.height, p = Math.min(1, A.e)
  const R = (a, b) => (hash(a * 409 + 3, b * 211 + (p > 0.05 ? tick : 0) * 7 + _txShuffle * 53) % 10000) / 10000
  const k = W * (0.004 + p * 0.03)
  const RND = mode === 'random', hb = hash(11, _txShuffle * 13 + 5) % 360
  const hc = (a) => 'hsl(' + (((a % 360) + 360) % 360 | 0) + ',100%,55%)'
  const c1 = RND ? hc(p > 0.05 ? R(1, 9) * 360 : hb + 150) : '#E2301C', c2 = RND ? hc(p > 0.05 ? R(2, 9) * 360 : hb + 210) : '#F2A03D'
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 0.9; ctx.drawImage(_txTinted(src, c1), k * (0.6 + (R(1, 1) - 0.5) * 2 * p), k * 0.5 * (1 + (R(1, 2) - 0.5) * 4 * p))
  ctx.globalAlpha = 0.95; ctx.drawImage(_txTinted(src, c2), -k * (0.5 + (R(2, 1) - 0.5) * 2 * p), -k * 0.3 * (1 + (R(2, 2) - 0.5) * 4 * p))
  ctx.restore()
  // paint colour bands onto the white letters themselves (in the source, so tearing carries them)
  const o = src.c || src.getContext('2d')
  o.save(); o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = 'source-atop'
  const n = p > 0.05 ? (3 + p * 14) | 0 : 1
  const cols = RND ? null : ['#F2A03D', '#E2301C', '#FF6A1A', '#FFF4E4']
  if (p <= 0.05) { if (!RND) { o.globalAlpha = 0.18; o.fillStyle = '#F2A03D'; o.fillRect(0, H * 0.55, W, H * 0.45) } }   // silent: warm lower half (HVFT) / letters keep their line hue (RANDOM)
  else for (let i = 0; i < n; i++) {
    const y = R(i, 3) * H, h = H * (0.01 + R(i, 4) * 0.12)
    o.globalAlpha = 0.55 + R(i, 5) * 0.45; o.fillStyle = RND ? hc(R(i, 6) * 360) : cols[(R(i, 6) * cols.length) | 0]; o.fillRect(0, y, W, h)
  }
  o.restore()
}
function _txTear (ctx, src, A, tick) {
  const W = src.width, H = src.height, p = Math.min(1, A.e)
  const R = (a, b) => (hash(a * 613 + 7, b * 331 + tick * 5 + _txShuffle * 131) % 10000) / 10000
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1
  let y = 0, k = 0
  while (y < H && k < 400) {
    const bh = Math.max(2, (H * (0.008 + R(k, 1) * (0.07 - p * 0.03))) | 0)
    const hit = R(k, 2) < 0.2 + p * 0.6
    const dx = hit ? (R(k, 3) - 0.5) * W * 0.35 * p : 0
    if (!(hit && R(k, 4) < p * 0.14)) {                                                  // some slices vanish
      ctx.drawImage(src, 0, y, W, bh, dx, y, W, bh)
      if (hit && R(k, 5) < p * 0.25) ctx.drawImage(src, 0, y, W, bh, dx + (R(k, 6) - 0.5) * W * 0.5, y, W, bh)   // stutter copy
    }
    y += bh; k++
  }
  if (p > 0.35 && R(90, 1) < p) {                                                        // vertical smear of one thin band
    const sy = (R(90, 2) * H) | 0, sh = Math.max(2, (H * 0.02) | 0), th = H * (0.05 + R(90, 3) * 0.25 * p)
    ctx.globalAlpha = 0.8; ctx.drawImage(src, 0, sy, W, sh, 0, sy, W, th); ctx.globalAlpha = 1
  }
  ctx.restore()
}
function textPixels (f) {
  const { W, H, lum, out, lut } = f
  const dim = 0.14
  for (let i = 0, j = 0; i < W * H; i++, j += 4) { const l = lum[i]; out[j] = lut[l * 3] * dim; out[j + 1] = lut[l * 3 + 1] * dim; out[j + 2] = lut[l * 3 + 2] * dim; out[j + 3] = 255 }
}
function textVector (ctx, f, D) {
  drawHvftText(ctx, f, D, (f.textCfg || { str: 'HVFT' }))
  drawHvftHud(ctx, D.W, D.H, f.tick, f.hudScale)
}


// ---------- Tanpa Efek: tampilkan sumber apa adanya (passthrough) ----------
function nonePixels (f) {
  const { W, H, rgb, out } = f
  out.set(rgb.subarray(0, W * H * 4))
}

// ---------- CYBORG: tubuh jadi robot berpelat + eksoskeleton + reticle (prosedural, non-AI) ----------
function cyborgPixels (f) {
  const { W, H, lum, mask, out, lut } = f
  const ps = 2 + Math.round(fxp(f, 'plate', 0.45) * 3)   // 2..5 -> pelat 8..64px
  const seam = (1 << (ps + 1)) - 1, half = (seam + 1) >> 1
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) { px(out, i, lut, 0); continue }
    const x = i % W, y = (i / W) | 0
    let v = 34 + lum[i] * 0.34               // dasar logam gelap, shading ikut kamera
    v += (((x >> ps) ^ (y >> ps)) & 1) ? 9 : -6  // pelat kotak-kotak
    if ((x & seam) === 0 || (y & seam) === 0) v = 140 + lum[i] * 0.3   // garis sambungan pelat
    if ((x & seam) === half && (y & seam) === half) v = 205            // baut/rivet
    px(out, i, lut, clamp(v, 12, 255))
  }
}
function cyborgVector (ctx, f, D) {
  const { W, H, mask, lut, tick } = f
  const step = Math.max(2, (Math.min(W, H) / 70) | 0)
  let minX = W, minY = H, maxX = 0, maxY = 0, any = false
  const edge = [], inner = []
  for (let y = step; y < H - step; y += step) {
    for (let x = step; x < W - step; x += step) {
      const i = y * W + x; if (!mask[i]) continue
      any = true; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y
      if (!mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W]) edge.push(x, y)
      else if ((hash(x, y) & 7) === 0) inner.push(x, y)
    }
  }
  if (!any) return
  const bw = (maxX - minX) * D.s, bh = (maxY - minY) * D.s
  const fl = fxp(f, 'flash', 0.50) * 2
  const beat = (f.audioOn ? f.onset * (f.audAmt || 1) : 0) * fl
  ctx.save()
  // 1) kontur armor (tepi bercahaya)
  ctx.fillStyle = lutCss(lut, 255, 0.9)
  const er = Math.max(0.6, D.W * (0.0005 + fxp(f, 'armor', 0.50) * 0.0026))
  for (let k = 0; k < edge.length; k += 2) { ctx.beginPath(); ctx.arc(D.mx(edge[k]), D.my(edge[k + 1]), er, 0, 6.2832); ctx.fill() }
  // 2) eksoskeleton: sambung sendi terdekat + node sendi (aksen oranye)
  const P = []; for (let k = 0; k < inner.length; k += 2) P.push(D.mx(inner[k]), D.my(inner[k + 1]))
  const thr = Math.max(bw, bh) * (0.035 + fxp(f, 'mesh', 0.45) * 0.24), thr2 = thr * thr
  ctx.strokeStyle = lutCss(lut, 235, 0.5); ctx.lineWidth = Math.max(1, D.W * 0.0014)
  ctx.beginPath()
  for (let i = 0; i < P.length; i += 2) for (let j = i + 2; j < P.length; j += 2) { const dx = P[i] - P[j], dy = P[i + 1] - P[j + 1]; if (dx * dx + dy * dy < thr2) { ctx.moveTo(P[i], P[i + 1]); ctx.lineTo(P[j], P[j + 1]) } }
  ctx.stroke()
  for (let i = 0, k = 0; i < P.length; i += 2, k += 2) {
    const acc = (hash(inner[k] | 0, inner[k + 1] | 0) & 7) === 0
    ctx.fillStyle = acc ? 'rgba(242,160,61,0.92)' : lutCss(lut, 220, 0.6)
    const r = (acc ? 3.2 : 1.8) * D.s * 0.6 * (1 + beat * 0.6)
    ctx.beginPath(); ctx.arc(P[i], P[i + 1], r, 0, 6.2832); ctx.fill()
  }
  // 3) reticle di kepala (atas bbox)
  const hx = D.mx((minX + maxX) / 2), hy = D.my(minY + (maxY - minY) * 0.12)
  const rs = Math.max(bw, bh) * 0.12 * (1 + beat * 0.3)
  ctx.strokeStyle = lutCss(lut, 255, 0.85); ctx.lineWidth = Math.max(1, D.W * 0.0016)
  ctx.strokeRect(hx - rs, hy - rs, rs * 2, rs * 2)
  ctx.beginPath(); ctx.moveTo(hx - rs * 1.4, hy); ctx.lineTo(hx - rs, hy); ctx.moveTo(hx + rs, hy); ctx.lineTo(hx + rs * 1.4, hy); ctx.moveTo(hx, hy - rs * 1.4); ctx.lineTo(hx, hy - rs); ctx.stroke()
  // 4) scanline menyapu vertikal
  const rng = (maxY - minY) || 1
  const sy = D.my(minY + ((tick * 2) % rng))
  ctx.strokeStyle = lutCss(lut, 255, 0.32); ctx.lineWidth = Math.max(1, D.W * 0.002)
  ctx.beginPath(); ctx.moveTo(D.mx(minX), sy); ctx.lineTo(D.mx(maxX), sy); ctx.stroke()
  ctx.restore()
  drawHvftHud(ctx, D.W, D.H, tick, f.hudScale)
}

// ---------- PARAMETER EFEK (semua 0..1) + AUDIO-LINK ----------
// Tiap efek mendeklarasikan parameternya; UI kanal otomatis membuat slider-nya,
// dan tiap parameter bisa di-link ke band audio (low/mid/high/onset).
const HVFT_FX_PARAMS = {
  pointcloud: [['density', 'Kepadatan', 0.50], ['bright', 'Kecerahan', 0.45], ['spread', 'Sebaran Tepi', 0.45], ['link', 'Jarak Sambung', 0.40]],
  wave: [['density', 'Kerapatan Garis', 0.50], ['amp', 'Amplitudo', 0.45], ['speed', 'Kecepatan', 0.40], ['thick', 'Tebal Garis', 0.30]],
  triangulate: [['bg', 'Latar', 0.28], ['link', 'Jarak Sambung', 0.50], ['line', 'Tebal Garis', 0.35], ['web', 'Jaring Halus', 0.35]],
  cyborg: [['plate', 'Ukuran Pelat', 0.45], ['armor', 'Tebal Armor', 0.50], ['mesh', 'Rapat Eksoskeleton', 0.45], ['flash', 'Kilat Beat', 0.50]],
  volumetric: [['density', 'Kepadatan', 0.50], ['bright', 'Kecerahan', 0.45], ['link', 'Jarak Sambung', 0.50], ['text', 'Jumlah Readout', 0.45]],
  pixellines: [['len', 'Panjang Goresan', 0.40], ['density', 'Kepadatan', 0.45], ['drift', 'Lengkung', 0.35], ['spark', 'Percik', 0.30]],
  scan: [['dot', 'Ukuran Titik', 0.35], ['bright', 'Kecerahan Titik', 0.45], ['depth', 'Kedalaman Kubus', 0.40], ['node', 'Jumlah Node', 0.50]],
  constellation: [['nodes', 'Jumlah Node', 0.45], ['link', 'Jarak Sambung', 0.45], ['glow', 'Pijar', 0.45], ['twinkle', 'Kedip', 0.50]],
  flux: [['bg', 'Latar', 0.28], ['nodes', 'Jumlah Node', 0.45], ['link', 'Jarak Sambung', 0.45], ['burst', 'Ledak', 0.50]],
  profil: [['bg', 'Latar', 0.50], ['panels', 'Jumlah Panel', 0.45], ['box', 'Tebal Kotak', 0.40], ['font', 'Ukuran Teks', 0.40]],
  erode: [['melt', 'Geser Leleh', 0.45], ['trail', 'Panjang Serat', 0.40], ['ghost', 'Bayangan Asli', 0.35], ['hatch', 'Hatching', 0.45]],
  mediamix: [['count', 'Jumlah Potongan', 0.45], ['size', 'Ukuran', 0.45], ['drift', 'Hanyut', 0.35], ['spin', 'Putaran', 0.35]],
  cutout: [['tear', 'Lebar Robek', 0.40], ['rough', 'Kasar Tepi', 0.60], ['echo', 'Jejak Echo', 0.45], ['swap', 'Ganti Latar', 0.45]],
  trackcollage: [['box', 'Tebal Kotak', 0.40], ['corner', 'Sudut', 0.45], ['pedestal', 'Tinggi Alas', 0.40], ['label', 'Ukuran Label', 0.40]],
  // ---- POLA LATAR generatif (audio-reactive) ----
  cymatics: [['scale', 'Kerapatan Gelombang', 0.60], ['ripple', 'Riak', 0.62], ['sharp', 'Ketajaman Garis', 0.62], ['accent', 'Aksen Oranye', 0.22]],
  plasma: [['scale', 'Skala', 0.55], ['flow', 'Aliran', 0.50], ['density', 'Kepekatan', 0.70], ['accent', 'Aksen Oranye', 0.22]],
  singularity: [['beams', 'Panjang Sinar', 0.62], ['burst', 'Ledak Pusat', 0.66], ['scatter', 'Sebaran Partikel', 0.66], ['chroma', 'Dispersi Warna', 0.55]],
  filament: [['branch', 'Cabang', 0.62], ['wander', 'Liuk', 0.60], ['glow', 'Pijar', 0.66], ['accent', 'Aksen Oranye', 0.22]]
}
// Efek GENERATIF (pola latar): tak butuh sumber kamera — pipeline tetap jalan tanpa feed.
const HVFT_GEN_FX = new Set(['cymatics', 'plasma', 'singularity', 'filament'])
if (typeof window !== 'undefined') window.HVFT_GEN_FX = HVFT_GEN_FX
function fxDefaults (id) { const L = HVFT_FX_PARAMS[id] || []; const o = {}; for (let i = 0; i < L.length; i++) o[L[i][0]] = L[i][2]; return o }
function fxp (f, k, d) { const P = f && f.P; const v = P ? P[k] : undefined; return (typeof v === 'number') ? v : d }

// ---------- POLA LATAR generatif (audio-reactive) ----------
// value-noise ringan (untuk plasma). hash(x,y) sudah global.
function _vn (ix, iy) { return (hash(ix, iy) & 0xffff) / 0xffff }
function vnoise (x, y) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = _vn(xi, yi), b = _vn(xi + 1, yi), c = _vn(xi, yi + 1), d = _vn(xi + 1, yi + 1)
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
}
function fbm (x, y, oct) { let s = 0, amp = 0.5, fr = 1; for (let i = 0; i < oct; i++) { s += amp * vnoise(x * fr, y * fr); fr *= 2; amp *= 0.5 } return s }
// nilai band audio yang aman (this.band = objek {low,mid,high})
function _bnd (f) { const b = f.band || {}; return [b.low || 0, b.mid || 0, b.high || 0] }
function _react (f) { return f.audioOn ? (f.audAmt == null ? 1 : f.audAmt) : 0 }
// tuang RGB langsung ke out (untuk aksen oranye di luar LUT mono)
function _add (out, i, r, g, b) { const j = i * 4; out[j] = Math.min(255, out[j] + r); out[j + 1] = Math.min(255, out[j + 1] + g); out[j + 2] = Math.min(255, out[j + 2] + b) }

// ===== BRUTALITY: each pattern escalates itself (no shared glitch layer) =====
// k = BRUTALITY × mic gate (0 when the mic is off -> patterns look exactly like before).
// _bgRandBands picks n random spectrum bins, re-rolled on every beat, and returns twitchy 0..1 envelopes,
// so every extra layer of a pattern answers a different, random frequency.
const _bgSt = new WeakMap()
function _bgState (f, id) {
  const key = f.out || f
  let m = _bgSt.get(key); if (!m) { m = {}; _bgSt.set(key, m) }
  return m[id] || (m[id] = { prev: 0, seed: 1, bins: [], env: [] })
}
function _bgK (f) {
  const rc = f.audioOn ? Math.min(1, (f.audAmt == null ? 0.4 : f.audAmt) * 2.5) : 0
  return (f.brutal == null ? 0.85 : f.brutal) * rc
}
function _bgRandBands (f, S, n) {
  const sp = f.spec, nb = sp ? sp.length : 0
  const hit = (f.onset || 0) > 0.45
  if ((hit && !S.prev) || S.bins.length !== n) {
    S.seed++; S.bins = []
    for (let i = 0; i < n; i++) S.bins.push(nb ? hash(S.seed * 31 + i * 7, 77 + i) % nb : 0)
  }
  S.prev = hit ? 1 : 0
  // noise-adaptive: each bin is judged against its own running level, so a constant harsh-noise wall still flickers
  if (nb && (!S.mean || S.mean.length !== nb)) S.mean = new Float32Array(nb)
  for (let i = 0; i < nb; i++) S.mean[i] += (sp[i] / 255 - S.mean[i]) * 0.03
  const out = []
  for (let i = 0; i < n; i++) {
    const raw = nb ? sp[S.bins[i]] / 255 : 0, m = nb ? S.mean[S.bins[i]] * 0.85 : 0
    let v = Math.max(0, (raw - m - 0.12) / Math.max(0.15, 1 - m - 0.12))
    v = Math.max(Math.min(1, v), Math.max(0, (raw - 0.22) / 0.78) * 0.4)   // keep a floor of the old absolute response
    const e = S.env[i] || 0
    S.env[i] = v > e ? v : e * 0.6                // instant attack, fast release
    out.push(S.env[i])
  }
  return out
}

// 1) CYMATICS — basin gelombang berdiri simetris, garis nodal menyala (ref #1)
function cymaticsPixels (f) {
  const { W, H, out, lut } = f
  const rc = _react(f), B = _bnd(f)
  const low = B[0], high = B[2]
  const scale = 3 + fxp(f, 'scale', 0.45) * 12
  const ripple = 0.2 + fxp(f, 'ripple', 0.50) * 1.9
  const sharp = 5 + fxp(f, 'sharp', 0.50) * 46
  const accent = fxp(f, 'accent', 0.18)
  const onset = (f.onset || 0) * rc
  const drift = f.tick * 0.02 * (1 + low * 2.2 * rc)
  const amp = ripple * (0.45 + low * 2.6 * rc)
  const hi = 0.8 + high * 1.6 * rc
  // ACAK saat kena suara: frekuensi & fase gelombang di-goyang chaos -> pola cacah tak beraturan
  const chaos = (low * 1.4 + onset * 2.2) * rc
  const cs = f.tick * 0.07
  // BRUTALITY: extra interference sources, each on its own random frequency; more mirror folds; razor lines
  const K = _bgK(f), KS = _bgState(f, 'cym')
  const nL = K > 0.02 ? 2 + Math.round(K * 5) : 0
  const RB = nL ? _bgRandBands(f, KS, nL) : null
  const nbS = f.spec ? f.spec.length : 72
  const LX = [], LY = [], LF = [], LA = []
  for (let i = 0; i < nL; i++) {
    LX.push((hash(KS.seed * 13 + i, 5) % 1000) / 1000 * 2 - 1); LY.push((hash(KS.seed * 17 + i, 9) % 1000) / 1000)
    LF.push(8 + (KS.bins[i] / nbS) * 70); LA.push(RB[i] * K * 0.8)
  }
  const folds = K > 0.02 ? 1 + (KS.seed % (1 + Math.round(K * 4))) : 1
  let laSum = 0; for (let i = 0; i < nL; i++) laSum += LA[i]
  const norm = 1 / (1 + laSum * 0.45)            // keep the field in range so the extra layers ADD lines
  const sharpK = sharp * (1 + K * 0.7)
  for (let y = 0; y < H; y++) {
    const ny = y / H
    const rowBias = 0.35 + 0.95 * ny            // menyala di bawah, gelap di atas (basin)
    const striate = 0.6 + 0.4 * Math.sin(ny * H * 0.11)
    const jf = chaos > 0.001 ? (1 + Math.sin(ny * 9 + cs) * chaos * 0.6) : 1   // skala gelombang di-acak per-baris
    for (let x = 0; x < W; x++) {
      const fx0 = (x / W) * folds, nx = Math.abs((fx0 - Math.floor(fx0)) * 2 - 1)   // simetri cermin (lebih banyak lipatan saat brutal)
      let fld = Math.sin(nx * scale * jf + Math.sin(ny * 3.0 + drift) * amp) * Math.cos(ny * scale * 0.6 - drift)
      fld += 0.5 * Math.sin((nx * nx + ny * ny) * scale * 1.35 * jf - drift * 1.5)
      if (chaos > 0.001) fld += Math.sin(nx * 40 + ny * 37 + cs * 3) * chaos * 0.5   // cacah frekuensi tinggi saat keras
      for (let l = 0; l < nL; l++) { if (LA[l] < 0.01) continue; const dx = nx - LX[l], dy = ny - LY[l]; fld += LA[l] * Math.sin(Math.sqrt(dx * dx + dy * dy) * LF[l] - cs * (2 + l)) }
      const line = Math.pow(1 - Math.min(1, Math.abs(fld * norm)), sharpK)   // garis nodal
      const v = clamp(line * 255 * striate * rowBias * hi * (1 + K * 1.1), 0, 255)
      const i = y * W + x
      px(out, i, lut, v)
      if (accent > 0.01 && v > 120) _add(out, i, (v - 120) * accent * 1.1, (v - 120) * accent * 0.45, 0)   // aksen oranye di puncak
    }
  }
}
function cymaticsVector (ctx, f, D) { if (!f.masked && f.hudScale) drawHvftHud(ctx, D.W, D.H, f.tick, f.hudScale) }

// 2) PLASMA — volume nebula/asap (fbm ridge) dalam bingkai prisma (ref #2)
function plasmaPixels (f) {
  const { W, H, out, lut } = f
  const rc = _react(f), B = _bnd(f)
  const low = B[0], high = B[2]
  const scale = 2 + fxp(f, 'scale', 0.45) * 8
  const flow = fxp(f, 'flow', 0.40)
  const dens = 0.5 + fxp(f, 'density', 0.50) * 1.9
  const accent = fxp(f, 'accent', 0.18)
  const onset = (f.onset || 0) * rc
  const t = f.tick * 0.01 * (0.3 + flow * 2.2) * (1 + low * 1.4 * rc)
  const s = scale / W
  const gain = dens * (0.7 + low * 0.7 * rc)              // kontribusi audio dibatasi -> tak jadi layar putih
  const hi = 0.85 + high * 0.5 * rc
  const thr = 0.42 - low * 0.10 * rc                      // ambang awan: bass -> awan meluas
  // KACAU saat kena suara: domain-warp berdenyut (bass) + sentakan (onset) -> gerak tak beraturan
  const chaos = (low * 1.6 + onset * 2.4) * rc
  const ct = f.tick * 0.05
  // BRUTALITY: razor contour ridges, each level on its own random frequency + warp jump on every beat
  const K = _bgK(f), KS = _bgState(f, 'pla')
  const nL = K > 0.02 ? 2 + Math.round(K * 5) : 0
  const RB = nL ? _bgRandBands(f, KS, nL) : null
  const LV = [], LW = []
  for (let i = 0; i < nL; i++) { LV.push(0.25 + (hash(KS.seed * 7 + i, 3) % 1000) / 1000 * 0.6); LW.push(18 + K * 70) }
  const jump = K > 0.02 ? (KS.seed % 97) * 3.7 * K : 0
  const gainK = gain * (1 + K * 0.8)
  for (let y = 0; y < H; y++) {
    const wy = chaos > 0.001 ? Math.cos(y * 0.05 + ct * 1.3) * chaos * 0.5 : 0
    for (let x = 0; x < W; x++) {
      const wx = chaos > 0.001 ? Math.sin(x * 0.045 + ct) * chaos * 0.5 : 0
      const n = fbm(x * s + t + wx + jump, y * s - t * 0.5 + wy - jump * 0.6, 4)
      const c = (n - thr) / (1 - thr)                       // hanya area padat (n>thr) menyala -> ada rongga gelap
      let v = c <= 0 ? 0 : clamp(Math.pow(c, 1.7) * 255 * gainK * hi, 0, 255)
      for (let l = 0; l < nL; l++) { if (RB[l] < 0.03) continue; const r = 1 - Math.abs(n - LV[l]) * LW[l]; if (r > 0) v = Math.min(255, v + r * r * 255 * RB[l] * (0.8 + K)) }
      const i = y * W + x
      px(out, i, lut, v)
      if (accent > 0.01 && v > 100) _add(out, i, (v - 100) * accent, (v - 100) * accent * 0.4, (v - 100) * accent * 0.2)
    }
  }
}
function plasmaVector (ctx, f, D) {
  if (f.masked) return                                   // mengisi tubuh: tanpa bingkai prisma/HUD
  const { lut, tick } = f
  const B = _bnd(f), rc = _react(f)
  // bingkai prisma: dua tepi vertikal + diagonal atas (echo ref #2)
  const w = D.W, h = D.H
  const x0 = w * 0.33, x1 = w * 0.67, top = h * 0.10, bot = h * 0.90
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = lutCss(lut, 255, 0.20 + B[1] * 0.5 * rc); ctx.lineWidth = Math.max(1, w * 0.0012)
  ctx.beginPath()
  ctx.moveTo(x0, top); ctx.lineTo(x0, bot); ctx.moveTo(x1, top); ctx.lineTo(x1, bot)
  ctx.moveTo(x0, top); ctx.lineTo(x1, top - h * 0.03); ctx.moveTo(x0, bot); ctx.lineTo(x1, bot - h * 0.03)
  ctx.stroke()
  ctx.restore()
  if (f.hudScale) drawHvftHud(ctx, D.W, D.H, tick, f.hudScale)
}

// 3) SINGULARITY — salib sinar + ledak pusat + dispersi warna + partikel + [HERE] (ref #3)
function singPixels (f) { const out = f.out; out.fill(0); for (let j = 3; j < out.length; j += 4) out[j] = 255 }
function singVector (ctx, f, D) {
  const { lut, tick } = f
  const rc = _react(f), B = _bnd(f), onset = f.onset || 0
  const low = B[0], mid = B[1], high = B[2]
  const cx = D.W * 0.5, cy = D.H * 0.5
  const beams = fxp(f, 'beams', 0.50), burst = fxp(f, 'burst', 0.50)
  const scatter = fxp(f, 'scatter', 0.50)
  const chroma = fxp(f, 'chroma', 0.50) * D.W * 0.012 * (0.4 + high * 2.2 * rc)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const bl = D.H * (0.28 + beams * 0.72) * (0.6 + mid * 1.3 * rc)
  const cols = ['rgba(90,255,170,', 'rgba(255,120,80,', 'rgba(150,120,255,']   // dispersi kromatik RGB
  ctx.lineWidth = Math.max(1, D.W * 0.0013)
  for (let c = 0; c < 3; c++) {
    const off = (c - 1) * chroma
    ctx.strokeStyle = cols[c] + '0.5)'
    ctx.beginPath()
    ctx.moveTo(cx + off, cy - bl); ctx.lineTo(cx + off, cy + bl)
    ctx.moveTo(cx - bl, cy + off * 0.3); ctx.lineTo(cx + bl, cy + off * 0.3)
    ctx.stroke()
  }
  // inti kilat
  const R = D.W * (0.02 + burst * 0.11) * (1 + onset * 2.6 * rc)
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.3, 'rgba(255,225,190,0.5)'); g.addColorStop(1, 'rgba(242,160,61,0)')
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill()
  // partikel tersebar dari pusat
  const N = (40 + scatter * 280) | 0
  const chaos = (onset * 2.4 + mid * 1.2) * rc                 // makin kacau saat kena suara
  const ts = ((tick >> 2) + (chaos > 0.3 ? (tick & 3) : 0))    // reshuffle cepat saat onset
  for (let i = 0; i < N; i++) {
    let a = (hash(i * 61 + 7, i * 13) % 6283) / 1000
    a += (((hash(i * 17, ts) % 1000) / 1000) - 0.5) * chaos * 3   // sudut di-acak (semburat tak beraturan)
    const rr = (hash(i * 29, i * 97 + ts) % 1000) / 1000
    const dist = D.W * (0.02 + rr * (0.24 + burst * 0.3)) * (1 + onset * 1.8 * rc + low * 0.6 * rc)
    const pxx = cx + Math.cos(a) * dist, pyy = cy + Math.sin(a) * dist * 0.82
    const sz = Math.max(0.5, D.W * 0.001 * (0.5 + (1 - rr)))
    ctx.fillStyle = (i % 9 === 0) ? 'rgba(242,160,61,0.85)' : ('rgba(228,230,240,' + (0.12 + (1 - rr) * 0.6) + ')')
    ctx.fillRect(pxx - sz / 2, pyy - sz / 2, sz, sz)
  }
  // BRUTALITY: more singularities across the frame, each on its own random frequency (positions re-roll per beat)
  const K = _bgK(f)
  if (K > 0.02) {
    const KS = _bgState(f, 'sing'), nL = 2 + Math.round(K * 5), RB = _bgRandBands(f, KS, nL)
    for (let l = 0; l < nL; l++) {
      const e = RB[l]; if (e < 0.04) continue
      const sx = D.W * (0.08 + (hash(KS.seed * 11 + l, 1) % 1000) / 1000 * 0.84), sy = D.H * (0.08 + (hash(KS.seed * 19 + l, 2) % 1000) / 1000 * 0.84)
      const ang = (hash(KS.seed * 23 + l, 3) % 6283) / 1000, bl2 = D.H * (0.15 + e * 0.9) * (0.6 + K)
      ctx.lineWidth = Math.max(1, D.W * 0.0013 * (1 + e * 2))
      for (let c = 0; c < 3; c++) {
        const off = (c - 1) * chroma * (1 + e)
        ctx.strokeStyle = cols[c] + (0.25 + e * 0.6).toFixed(2) + ')'
        ctx.beginPath()
        for (let q = 0; q < 2 + (K > 0.6 ? 1 : 0); q++) {
          const a = ang + q * Math.PI / (2 + (K > 0.6 ? 1 : 0))
          ctx.moveTo(sx - Math.cos(a) * bl2 + off, sy - Math.sin(a) * bl2); ctx.lineTo(sx + Math.cos(a) * bl2 + off, sy + Math.sin(a) * bl2)
        }
        ctx.stroke()
      }
      const R2 = D.W * (0.01 + e * 0.08)
      const g2 = ctx.createRadialGradient(sx, sy, 0, sx, sy, R2)
      g2.addColorStop(0, 'rgba(255,255,255,' + Math.min(1, 0.4 + e).toFixed(2) + ')'); g2.addColorStop(1, 'rgba(242,160,61,0)')
      ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(sx, sy, R2, 0, 6.2832); ctx.fill()
      const np = (20 + e * 160 * K) | 0
      ctx.fillStyle = 'rgba(232,234,244,' + (0.3 + e * 0.6).toFixed(2) + ')'
      for (let i = 0; i < np; i++) {
        const a = (hash(i * 31 + l, KS.seed * 7 + (tick >> 1)) % 6283) / 1000, d = D.W * ((hash(i * 7 + l, KS.seed) % 1000) / 1000) * (0.03 + e * 0.25)
        ctx.fillRect(sx + Math.cos(a) * d, sy + Math.sin(a) * d * 0.82, 1.5, 1.5)
      }
    }
  }
  ctx.restore()
  if (f.masked) return                                   // mengisi tubuh: tanpa teks/HUD dekoratif
  // HUD [HERE] ×3
  ctx.fillStyle = lutCss(lut, 235, 0.72)
  ctx.font = `${(D.W * 0.02) | 0}px ui-monospace, Menlo, monospace`
  for (let k = 0; k < 3; k++) ctx.fillText('[HERE]', D.W * 0.77, D.H * 0.76 + k * D.W * 0.03)
  if (f.hudScale) drawHvftHud(ctx, D.W, D.H, tick, f.hudScale)
}

// 4) FILAMENT — dendrit/urat bercabang menyala (ref #4)
function filPixels (f) { const out = f.out; out.fill(0); for (let j = 3; j < out.length; j += 4) out[j] = 255 }
function filLimb (ctx, lut, x, y, ang, len, depth, w, wander, glow, accent, tick) {
  if (depth <= 0 || len < 3) return
  const steps = 6
  ctx.lineWidth = Math.max(0.4, w)
  ctx.strokeStyle = (accent > 0.4 && (depth & 1)) ? ('rgba(242,160,61,' + (0.08 + glow * 0.4) + ')') : lutCss(lut, 235, 0.10 + glow * 0.5)
  ctx.beginPath(); ctx.moveTo(x, y)
  let px2 = x, py2 = y, a = ang
  for (let s = 0; s < steps; s++) {
    a += (((hash((x | 0) + s * 13, (y | 0) + depth * 7 + (tick >> 4)) % 1000) / 1000) - 0.5) * wander
    px2 += Math.cos(a) * len / steps; py2 += Math.sin(a) * len / steps
    ctx.lineTo(px2, py2)
  }
  ctx.stroke()
  const nb = hash(x | 0, y | 0) % 3            // 0..2 cabang
  for (let b = 0; b <= nb; b++) filLimb(ctx, lut, px2, py2, a + (b - nb / 2) * 0.7, len * 0.68, depth - 1, w * 0.7, wander, glow, accent, tick)
}
function filVector (ctx, f, D) {
  const { lut, tick } = f
  const rc = _react(f), B = _bnd(f), onset = f.onset || 0
  const branch = 3 + fxp(f, 'branch', 0.50) * 13
  const wander = 0.3 + fxp(f, 'wander', 0.50) * 1.7
  const glow = fxp(f, 'glow', 0.50)
  const accent = fxp(f, 'accent', 0.18)
  const cx = D.W * 0.5, cy = D.H * 0.62
  // PETIR BESAR: bass/onset -> bolt memanjang, MELEBAR, jauh lebih terang & bercabang-cabang tajam
  const bolt = (B[0] * 1.8 + onset * 3.0) * rc
  const grow = 0.55 + bolt * 1.3
  const gGlow = Math.min(1, glow + bolt * 0.9)                        // menyala saat kena suara
  const jag = wander * (1 + bolt * 1.8)                              // makin tajam/zigzag = petir
  const width = Math.max(0.6, D.W * (0.002 + bolt * 0.006))          // batang menebal
  const depth0 = 3 + (branch > 9 ? 1 : 0) + (bolt > 1.2 ? 1 : 0)     // percabangan ekstra saat keras
  const roots = Math.max(1, (branch / 3) | 0)
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'
  if (bolt > 0.4) { ctx.shadowColor = 'rgba(255,255,255,0.9)'; ctx.shadowBlur = D.W * 0.01 * bolt }   // halo petir
  for (let r = 0; r < roots; r++) {
    const a0 = -Math.PI / 2 + (r - (roots - 1) / 2) * 0.4 + Math.sin(tick * 0.02 + r) * 0.22
    filLimb(ctx, lut, cx + (r - roots / 2) * D.W * 0.02, cy, a0, D.H * 0.20 * grow, depth0, width, jag, gGlow, accent, tick)
  }
  // BRUTALITY: more lightning roots striking from random points, each fired by its own random frequency
  const K = _bgK(f)
  if (K > 0.02) {
    const KS = _bgState(f, 'fil'), nL = 2 + Math.round(K * 6), RB = _bgRandBands(f, KS, nL)
    for (let l = 0; l < nL; l++) {
      const e = RB[l]; if (e < 0.06) continue
      const edge = hash(KS.seed * 5 + l, 4) % 4, u = (hash(KS.seed * 9 + l, 6) % 1000) / 1000
      const ox = edge === 0 ? 0 : edge === 1 ? D.W : u * D.W, oy = edge === 2 ? 0 : edge === 3 ? D.H : u * D.H
      const a0 = Math.atan2(D.H * 0.5 - oy, D.W * 0.5 - ox) + ((hash(KS.seed * 3 + l, 8) % 1000) / 1000 - 0.5) * 1.4
      filLimb(ctx, lut, ox, oy, a0, D.H * (0.12 + e * 0.45) * (0.7 + K), 3 + (e > 0.5 ? 2 : 1), Math.max(0.6, D.W * 0.002 * (1 + e * 3)), jag * (1 + e), Math.min(1, glow + e), accent, tick + l * 97)
    }
  }
  ctx.restore()
  if (!f.masked && f.hudScale) drawHvftHud(ctx, D.W, D.H, tick, f.hudScale)
}

const HVFT_EFFECTS = [
  { id: 'none', name: 'Tanpa Efek', pixels: nonePixels, vector: null },
  { id: 'cyborg', name: 'Cyborg', pixels: cyborgPixels, vector: cyborgVector, maxRes: 900 },
  // maxRes dibatasi -> jauh lebih ringan di venue (piksel & node lebih sedikit)
  { id: 'pointcloud', name: 'Point Cloud', pixels: pcPixels, vector: pcVector, maxRes: 720 },
  { id: 'triangulate', name: 'Triangulate', pixels: triPixels, vector: triVector, maxRes: 720 },
  { id: 'volumetric', name: 'Volumetric', pixels: volPixels, vector: volVector, maxRes: 640 },
  // goresan panjang -> biaya per piksel tinggi, dibatasi resolusinya
  { id: 'pixellines', name: 'Pixel Lines', pixels: plPixels, vector: plVector, maxRes: 680 },
  { id: 'scan', name: 'Scan', pixels: null, vector: scanVector, maxRes: 720 },
  { id: 'constellation', name: 'Constellation', pixels: conPixels, vector: conVector, maxRes: 640 },
  { id: 'wave', name: 'Wave', pixels: wavePixels, vector: waveVector, maxRes: 800 },
  { id: 'flux', name: 'Flux', pixels: fluxPixels, vector: fluxVector, maxRes: 620 },
  { id: 'profil', name: 'Profil', pixels: profilPixels, vector: profilVector, maxRes: 760 },
  { id: 'erode', name: 'Erosi', pixels: erodePixels, vector: erodeVector, maxRes: 720 },
  { id: 'mediamix', name: 'Media Mix', pixels: mediamixPixels, vector: mediamixVector },
  { id: 'cutout', name: 'Cut-Out Kolase', pixels: cutoutPixels, vector: cutoutVector, maxRes: 640 },
  { id: 'trackcollage', name: 'Tracking Kolase', pixels: trackPixels, vector: trackVector, maxRes: 720 },
  // POLA LATAR generatif (audio-reactive) — taruh di kanal bawah, subjek + CROP di atasnya
  { id: 'cymatics', name: 'Cymatics (pola)', pixels: cymaticsPixels, vector: cymaticsVector, maxRes: 420 },
  { id: 'plasma', name: 'Plasma (pola)', pixels: plasmaPixels, vector: plasmaVector, maxRes: 340 },
  { id: 'singularity', name: 'Singularity (pola)', pixels: singPixels, vector: singVector, maxRes: 960 },
  { id: 'filament', name: 'Filament (pola)', pixels: filPixels, vector: filVector, maxRes: 960 }
]
