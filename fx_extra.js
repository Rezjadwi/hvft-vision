// HVFT VISION — fx_extra.js
// Two channel effects from Reza's YouTube references (Sept 28):
//   'dither' DITHER GHOST  — camera/depth subject as an ordered (Bayer 8×8) dither ghost with
//                            long-exposure trails; KICK = exposure flash + denser dots,
//                            SNARE/HIGH = raster tear lines + threshold slicing. Mic off = soft dim ghost.
//   'burst'  PARTICLE BURST — subject becomes a point cloud of particles that sit on the silhouette,
//                            curl-noise turbulence follows the level, every BEAT blasts them outward,
//                            they re-gather; huge peaks = high-key silhouette flash. Trails via decay.
// Both paint an intensity buffer through the channel's colour LUT (per-channel COLOR panel),
// so HVFT / VIOLET / RANDOM / MONO all apply. Load right after effects.js.
;(function () {
  if (typeof HVFT_EFFECTS === 'undefined') return
  const ST = { dither: new WeakMap(), burst: new WeakMap() }   // per effect, per pipe (keyed by its persistent output buffer)
  const BAYER = (() => {     // 8×8 ordered-dither thresholds 0..255
    const m = [[0, 2], [3, 1]]
    let b = m
    for (let n = 2; n < 8; n *= 2) {
      const nb = []
      for (let y = 0; y < n * 2; y++) { nb.push([]); for (let x = 0; x < n * 2; x++) nb[y].push(4 * b[y % n][x % n] + m[(y / n) | 0][(x / n) | 0]) }
      b = nb
    }
    const t = new Uint8Array(64); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) t[y * 8 + x] = ((b[y][x] + 0.5) / 64 * 255) | 0
    return t
  })()
  const rnd = (n) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296 }
  function aud (f) {
    const b = f.band || {}, A = Array.isArray(b)
    const rc = f.audioOn ? (f.audAmt == null ? 1 : Math.min(1, f.audAmt * 2.5)) : 0
    return { low: ((A ? b[0] : b.low) || 0) * rc, mid: ((A ? b[1] : b.mid) || 0) * rc, high: ((A ? b[2] : b.high) || 0) * rc, onset: (f.onset || 0) * rc, rc }
  }
  function writeLut (out, i, lut, v) {
    v = v < 0 ? 0 : v > 255 ? 255 : v | 0
    const j = i * 4
    if (lut) { out[j] = lut[v * 3]; out[j + 1] = lut[v * 3 + 1]; out[j + 2] = lut[v * 3 + 2] } else { out[j] = out[j + 1] = out[j + 2] = v }
    out[j + 3] = 255
  }
  function state (id, f, init) {
    const M = ST[id]
    let S = M.get(f.out)
    if (!S || S.W !== f.W || S.H !== f.H) { S = init(); S.W = f.W; S.H = f.H; M.set(f.out, S) }
    return S
  }

  // ======================= DITHER GHOST =======================
  function ditherPixels (f) {
    const { W, H, lum, mask, out, lut } = f
    const N = W * H
    const S = state('dither', f, () => ({ acc: new Float32Array(N), prevOn: 0, flash: 0, tears: [] }))
    const a = aud(f), live = a.rc > 0
    const dot = 1 + Math.round(fxp(f, 'dot', 0.35) * 3)             // dither cell 1..4 px
    const trail = 0.70 + fxp(f, 'trail', 0.6) * 0.27                  // exposure decay
    const expo = fxp(f, 'expo', 0.6), glitch = fxp(f, 'glitch', 0.6)
    // kick = exposure flash; beat edge = new tear set
    const hit = a.onset > 0.45
    if (hit && !S.prevOn) {
      S.flash = 1
      S.tears = []
      const n = (2 + a.high * 10 + a.onset * 6) * glitch | 0
      for (let k = 0; k < n; k++) S.tears.push([(rnd(f.tick * 31 + k) * H) | 0, 2 + (rnd(f.tick * 17 + k) * H * 0.05) | 0, ((rnd(f.tick * 7 + k) - 0.5) * W * 0.3) | 0, rnd(k * 3 + f.tick) < 0.35])
    }
    S.prevOn = hit ? 1 : 0
    S.flash *= 0.82
    const gain = live ? 0.55 + a.low * 1.6 * expo + S.flash * 0.9 * expo : 0.42
    const acc = S.acc
    for (let i = 0; i < N; i++) {
      const v = (mask[i] ? lum[i] : lum[i] * 0.12) * gain          // luma key: subject lit, background sunk
      const d = acc[i] * trail
      acc[i] = v > d ? v : d
    }
    // row tears (snare / highs) — horizontal offset + threshold inversion slices
    const tearRow = new Int16Array(H), inv = new Uint8Array(H)
    if (live) for (const [y0, h, dx, sl] of S.tears) for (let y = y0; y < Math.min(H, y0 + h); y++) { tearRow[y] = dx * (0.3 + S.flash); if (sl) inv[y] = 1 }
    const bias = live ? a.high * 40 : 0
    for (let y = 0; y < H; y++) {
      const by = ((y / dot) | 0) & 7, dx = tearRow[y], iv = inv[y]
      for (let x = 0; x < W; x++) {
        let sx = x - dx; if (sx < 0) sx += W; else if (sx >= W) sx -= W
        const v = acc[y * W + sx]
        let on = v > 14 && v + bias > BAYER[by * 8 + (((x / dot) | 0) & 7)]   // floor keeps the void black
        if (iv) on = !on && v > 14
        writeLut(out, y * W + x, lut, on ? (v > 200 ? 255 : 150 + v * 0.4) : 0)
      }
    }
  }

  // ======================= PARTICLE BURST =======================
  function burstPixels (f) {
    const { W, H, mask, lum, out, lut, tick } = f
    const N = W * H
    const cap = 2500 + (fxp(f, 'count', 0.55) * 7000 | 0)
    const S = state('burst', f, () => ({ acc: new Float32Array(N), px: new Float32Array(9500), py: new Float32Array(9500), vx: new Float32Array(9500), vy: new Float32Array(9500), hx: new Float32Array(9500), hy: new Float32Array(9500), n: 0, prevOn: 0, strobe: 0, cx: W / 2, cy: H / 2 }))
    const a = aud(f), live = a.rc > 0
    const turb = fxp(f, 'turb', 0.55), burst = fxp(f, 'burst', 0.7), trail = 0.78 + fxp(f, 'trail', 0.55) * 0.18
    const flashP = fxp(f, 'flash', 0.5)
    // collect silhouette homes (stride sample) + centroid
    const step = Math.max(2, Math.round(Math.sqrt(N / cap) * 1.1))
    const homes = []
    let sx = 0, sy = 0
    for (let y = (tick % step); y < H; y += step) for (let x = ((tick >> 1) % step); x < W; x += step) { const i = y * W + x; if (mask[i] && lum[i] > 8) { const jx = x + rnd(i * 3 + 1) * step - step / 2, jy = y + rnd(i * 5 + 2) * step - step / 2; homes.push(jx, jy); sx += x; sy += y } }
    const nh = homes.length >> 1
    if (nh) { S.cx += (sx / nh - S.cx) * 0.2; S.cy += (sy / nh - S.cy) * 0.2 }
    // (re)assign homes; spawn new particles at their home
    const want = Math.min(cap, nh)
    while (S.n < want) { const k = S.n++, h = ((rnd(k * 13 + tick) * nh) | 0) * 2; S.px[k] = S.hx[k] = homes[h]; S.py[k] = S.hy[k] = homes[h + 1]; S.vx[k] = S.vy[k] = 0 }
    if (S.n > want) S.n = Math.max(want, (S.n * 0.9) | 0)
    for (let k = 0; k < S.n && nh; k++) if (rnd(k * 7 + tick) < 0.012) { const h = ((rnd(k * 29 + tick * 3) * nh) | 0) * 2; S.hx[k] = homes[h]; S.hy[k] = homes[h + 1] }
    // beat -> radial blast; huge peak -> strobe
    const hit = a.onset > 0.45
    if (hit && !S.prevOn) {
      const force = (2 + a.low * 10) * burst * (W / 320)
      for (let k = 0; k < S.n; k++) {
        const dx = S.px[k] - S.cx, dy = S.py[k] - S.cy, l = Math.hypot(dx, dy) || 1
        const r = 0.4 + rnd(k * 5 + tick)
        S.vx[k] += dx / l * force * r; S.vy[k] += dy / l * force * r - force * 0.2 * r
      }
      if (a.onset > 0.9 && a.low > 0.65 && rnd(tick) < flashP * 0.35) S.strobe = 2   // rare: only the biggest peaks
    }
    S.prevOn = hit ? 1 : 0
    // integrate: spring home + curl turbulence + drag
    const t = tick * 0.02, spring = live ? 0.07 - a.low * 0.045 : 0.1
    const tf = (0.15 + turb * 0.9) * (live ? 0.3 + a.mid * 3 + a.low * 2 : 0.08) * (W / 480)
    const sc = 6 / W
    for (let k = 0; k < S.n; k++) {
      const x = S.px[k] * sc, y = S.py[k] * sc
      const cxn = Math.sin(y * 3.1 + t) + Math.cos(x * 2.3 - t * 0.7) * 0.6, cyn = Math.cos(x * 2.9 - t * 0.8) - Math.sin(y * 1.7 + t) * 0.6
      S.vx[k] = (S.vx[k] + (S.hx[k] - S.px[k]) * spring + cxn * tf * 0.35) * 0.88
      S.vy[k] = (S.vy[k] + (S.hy[k] - S.py[k]) * spring + cyn * tf * 0.35) * 0.88
      S.px[k] += S.vx[k]; S.py[k] += S.vy[k]
    }
    // expose onto the decaying intensity buffer
    const acc = S.acc
    const tr = live ? trail : 0.6   // silent: crisp dotted silhouette
  for (let i = 0; i < N; i++) acc[i] *= tr
    const bright = live ? 150 + a.low * 90 + a.high * 40 : 120
    for (let k = 0; k < S.n; k++) {
      const x = S.px[k] | 0, y = S.py[k] | 0
      if (x < 0 || y < 0 || x >= W || y >= H) continue
      const sp = Math.min(1, Math.hypot(S.vx[k], S.vy[k]) * 0.15)   // fast particles burn hotter (colour ramps up)
      const i = y * W + x, v = bright * (0.7 + sp * 0.9)
      acc[i] = Math.min(255, acc[i] + v)
      if (x + 1 < W) acc[i + 1] = Math.min(255, acc[i + 1] + v * 0.35)
      if (y + 1 < H) acc[i + W] = Math.min(255, acc[i + W] + v * 0.35)
    }
    if (S.strobe > 0) {   // high-key flash: frame blown out, performer silhouette dark
      S.strobe--
      for (let i = 0; i < N; i++) writeLut(out, i, lut, mask[i] ? 0 : 235)
      return
    }
    for (let i = 0; i < N; i++) writeLut(out, i, lut, acc[i])
  }

  HVFT_FX_PARAMS.dither = [['dot', 'Dot Size', 0.35], ['trail', 'Trail', 0.6], ['expo', 'Kick Exposure', 0.6], ['glitch', 'Snare Tears', 0.6]]
  HVFT_FX_PARAMS.burst = [['count', 'Particles', 0.55], ['turb', 'Turbulence', 0.55], ['burst', 'Beat Blast', 0.7], ['trail', 'Trail', 0.55], ['flash', 'Peak Flash', 0.5]]
  for (const e of [
    { id: 'dither', name: 'Dither Ghost', pixels: ditherPixels, vector: null, maxRes: 640 },
    { id: 'burst', name: 'Particle Burst', pixels: burstPixels, vector: null, maxRes: 720 }
  ]) if (!HVFT_EFFECTS.some(x => x.id === e.id)) HVFT_EFFECTS.push(e)
})()
