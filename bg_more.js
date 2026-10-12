// HVFT VISION — bg_more.js
// Three more BG PATTERNs from Reza's references (Oct 5):
//   (Oct 5 b) GYRO + BEAM: the more frequencies sound (spectrum richness), the more objects. ECLIPSE grows/shrinks with the sound.
//   GYRO    — grainy particle gyroscopes: 2–4 orbital rings of dust around a grain-sphere core, rotating in 3D on
//             black with stars. BEAT = hard cut to a new composition (tiny ↔ huge, 1 ↔ several). MID = spin, LOW = thick/bright.
//   ECLIPSE — black-hole eclipse: dark disc, burning corona ring with plasma texture, smoke wisps and rays.
//             LOW = ring heat/thickness, BAND = corona size, BEAT = zoom punch + wisp burst (+ size cut).
//   BEAM    — diagonal light beam with a galactic bulge; particles orbit it in dotted helical trails.
//             MID = orbit speed, LOW = beam glow, HIGH = sparkle, BEAT = angle jump + white zoom smear.
// (Oct 5 c) NOISE CHAOS: each pattern reads the noise texture (spectral flux, self-calibrated) -> random jumps, tears,
//   stutter, echoes. Slider 'Noise Chaos'. Mic OFF = calm version of each. BRUTALITY (f.brutal) adds layers, each on its own random frequency (_bgRandBands).
// Everything is drawn as intensity through the channel LUT, so the per-channel COLOR applies.
;(function () {
  if (typeof HVFT_EFFECTS === 'undefined') return
  const rnd = (s) => { s = Math.sin(s * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s) }
  const ST = { gyro: new WeakMap(), eclipse: new WeakMap(), beam: new WeakMap() }
  function clearPx (f) { const o = f.out; o.fill(0); for (let j = 3; j < o.length; j += 4) o[j] = 255 }
  function aud (f) {
    const rc = _react(f), B = _bnd(f)
    return { rc, live: rc > 0.001, low: B[0] * rc, mid: B[1] * rc, high: B[2] * rc, beat: (f.onset || 0) * rc, K: (typeof _bgK === 'function') ? _bgK(f) : 0 }
  }
  function state (map, ctx) { let S = map.get(ctx.canvas); if (!S) { S = { t: 0, prev: 0, seed: 1, fr: 0, bs: { prev: 0, seed: 1, bins: [], env: [] } }; map.set(ctx.canvas, S) } return S }
  function bands (f, S, n, A) { return (A.live && A.K > 0.02 && typeof _bgRandBands === 'function') ? _bgRandBands(f, S.bs, n) : null }
  // intensity buffer -> LUT -> offscreen canvas
  function ibuf (S, W, H) {
    if (!S.ib || S.W !== W || S.H !== H) {
      S.W = W; S.H = H; S.ib = new Float32Array(W * H)
      S.cv = document.createElement('canvas'); S.cv.width = W; S.cv.height = H; S.cx = S.cv.getContext('2d'); S.img = S.cx.createImageData(W, H)
    }
    return S.ib
  }
  function fade (b, k) { for (let i = 0; i < b.length; i++) b[i] *= k }
  function flush (S, lut) {
    const d = S.img.data, b = S.ib
    for (let i = 0, j = 0; i < b.length; i++, j += 4) {
      let v = b[i]; v = v > 255 ? 255 : v | 0
      if (lut) { d[j] = lut[v * 3]; d[j + 1] = lut[v * 3 + 1]; d[j + 2] = lut[v * 3 + 2] } else { d[j] = d[j + 1] = d[j + 2] = v }
      d[j + 3] = 255
    }
    S.cx.putImageData(S.img, 0, 0)
  }
  function splat (b, W, H, x, y, v) { x = x | 0; y = y | 0; if (x < 0 || y < 0 || x >= W || y >= H) return; b[y * W + x] += v }
  function splat2 (b, W, H, x, y, v) { x = x | 0; y = y | 0; if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return; const i = y * W + x; b[i] += v; b[i + 1] += v * 0.45; b[i + W] += v * 0.45; b[i + W + 1] += v * 0.2 }
  // RICHNESS: how many frequencies are sounding (share of spectrum bins above the floor), smoothed:
  // fast rise, slow fall. Mic off -> 0. Harsh noise fills the spectrum -> close to 1.
  function richness (f, S, A) {
    const sp = f.spec
    if (!A.live || !sp || !sp.length) { S.rich = (S.rich || 0) * 0.9; return S.rich }
    let n = 0; for (let i = 3; i < sp.length; i++) if (sp[i] > 105) n++
    const r = n / (sp.length - 3)
    S.rich = S.rich == null ? r : S.rich + (r - S.rich) * (r > S.rich ? 0.5 : 0.15)
    return S.rich
  }
  // NOISE CHAOS — reads the incoming noise itself and calibrates itself (auto gain), so a harsh-noise wall and a quiet
  // input both use the full range. Mic off -> C = 0 and no spikes (calm versions).
  //   flux   how much the spectrum changes frame to frame (the texture of the noise), judged against its own running level
  //   spike  a flux burst above the running level -> random event (works even when a noise wall saturates the beat detector)
  //   cent   spectral centre 0..1 (dark/bassy noise -> low, hissy noise -> high)
  //   drive  frequency richness (absolute + self-normalised) -> object counts
  //   C      chaos amount 0..1 = flux × CHAOS slider × brutality
  function noise (f, S, A, chaosP) {
    const sp = f.spec, N = S.nz || (S.nz = { prev: null, fm: 0.02, fd: 0.01, rlo: 1, rhi: 0, ref: 0, cent: 0.5, C: 0 })
    const rich = richness(f, S, A)
    if (!A.live || !sp || !sp.length) { N.C *= 0.8; return { rich, richN: 0, drive: rich, C: N.C, spike: false, cent: 0.5, fluxN: 0 } }
    if (!N.prev || N.prev.length !== sp.length) N.prev = new Float32Array(sp.length)
    let fl = 0, sw = 0, sm = 0
    for (let i = 1; i < sp.length; i++) { const v = sp[i] / 255, d = v - N.prev[i]; if (d > 0) fl += d; N.prev[i] = v; sw += v * i; sm += v }
    fl /= sp.length
    N.fm += (fl - N.fm) * 0.04
    N.fd += (Math.abs(fl - N.fm) - N.fd) * 0.04
    const z = (fl - N.fm) / (N.fd + 0.004)
    const fluxN = Math.max(0, Math.min(1, 0.35 + z * 0.22))
    N.ref = Math.max(0, N.ref - 1)
    const sp1 = z > 1.3 && N.ref === 0; if (sp1) N.ref = 2
    N.rlo = Math.min(rich, N.rlo + 0.002); N.rhi = Math.max(rich, N.rhi - 0.002)
    const richN = Math.max(0, Math.min(1, (rich - N.rlo) / Math.max(0.08, N.rhi - N.rlo)))
    N.cent += ((sm > 0.01 ? sw / sm / sp.length : 0.5) - N.cent) * 0.2
    const target = Math.min(1, fluxN * (0.55 + A.K * 0.6) + (sp1 ? 0.45 : 0)) * chaosP
    N.C += (target - N.C) * (target > N.C ? 0.6 : 0.3)
    return { rich, richN, drive: rich * 0.6 + richN * 0.4, C: N.C, spike: sp1 && Math.random() < 0.3 + chaosP * 0.7, cent: N.cent, fluxN }
  }
  const J = () => Math.random() - 0.5
  const colF = (lut) => (v, al) => lut ? lutCss(lut, v, al) : 'rgba(' + v + ',' + v + ',' + v + ',' + al + ')'
  function stars (b, W, H, seed, n, v) { for (let i = 0; i < n; i++) splat(b, W, H, rnd(i * 3.1 + seed) * W, rnd(i * 7.7 + seed) * H, v * (0.3 + rnd(i * 1.3) * 0.7)) }

  // ================= GYRO =================
  function newGyro (seed, live, n) {
    const tiny = live && rnd(seed * 5) < 0.18
    const nr = 2 + ((rnd(seed * 11) * 2.2) | 0)
    const tilts = []; for (let k = 0; k < 6; k++) tilts.push([(rnd(seed * 13 + k) - 0.5) * 3.2, rnd(seed * 17 + k) * 6.28])
    return { x: live && n > 1 ? 0.15 + rnd(seed) * 0.7 : 0.5 + (live ? (rnd(seed) - 0.5) * 0.3 : 0), y: live && n > 1 ? 0.15 + rnd(seed * 3) * 0.7 : 0.5 + (live ? (rnd(seed * 3) - 0.5) * 0.3 : 0),
      s: live ? (tiny ? 0.035 : 0.12 + rnd(seed * 7) * (n > 1 ? 0.22 : 0.42)) : 0.26, nr, tilts, r0: rnd(seed * 19) * 6.28, r1: rnd(seed * 23) * 6.28, dir: rnd(seed * 29) < 0.5 ? -1 : 1 }
  }
  function rot (p, ax, az, ry, rx) {
    let [x, y, z] = p
    let c = Math.cos(ax), s = Math.sin(ax); let y1 = y * c - z * s, z1 = y * s + z * c; y = y1; z = z1
    c = Math.cos(az); s = Math.sin(az); let x1 = x * c - y * s; y1 = x * s + y * c; x = x1; y = y1
    c = Math.cos(ry); s = Math.sin(ry); x1 = x * c + z * s; z1 = -x * s + z * c; x = x1; z = z1
    c = Math.cos(rx); s = Math.sin(rx); y1 = y * c - z * s; z1 = y * s + z * c
    return [x, y1, z1]
  }
  function gyroVector (ctx, f, D) {
    const W = D.W | 0, H = D.H | 0, S = state(ST.gyro, ctx), A = aud(f), b = ibuf(S, W, H)
    const ringsP = fxp(f, 'rings', 0.5), grain = fxp(f, 'grain', 0.6), spin = fxp(f, 'spin', 0.5), cuts = fxp(f, 'cuts', 0.6), chaosP = fxp(f, 'chaos', 0.8)
    const Z = noise(f, S, A, chaosP), C = Z.C, rich = Z.drive
    // spin follows the noise: hissy (high centre) spins faster, flux makes it stutter
    S.t += (0.008 + spin * 0.03 * (1 + A.mid * 3 + A.low)) * (A.live ? (0.5 + Z.cent * 1.5) * (1 + C * 3 * Math.random()) : 1)
    // more frequencies sounding -> more gyros (1..8) and more rings; noise spikes wobble the count
    if (!A.live || Math.random() < 0.06) S.wob = 0
    const nObj = A.live ? Math.max(1, Math.min(8, 1 + Math.round(rich * 7 * (0.6 + A.K * 0.6)) + (S.wob || 0))) : 1
    const hit = A.beat > 0.45 && !S.prev; S.prev = A.beat > 0.45 ? 1 : 0
    if (!S.objs || (hit && rnd(S.seed * 9) < 0.35 + cuts * 0.65)) {
      S.seed++; S.objs = []; for (let i = 0; i < nObj; i++) S.objs.push(newGyro(S.seed * 13 + i, A.live, nObj))
      if (hit) b.fill(0)   // hard cut
    }
    while (S.objs.length < nObj) { S.seed++; S.objs.push(newGyro(S.seed * 13 + S.objs.length, A.live, Math.max(2, nObj))) }   // grow one by one
    if (S.objs.length > nObj) S.objs.length = nObj
    // NOISE SPIKE -> random event: teleport/re-tilt/reverse one gyro, sometimes a full recut; random trail length
    if (Z.spike) {
      if (Math.random() < 0.15 + C * 0.25) { S.seed++; S.objs = S.objs.map((_, i) => newGyro(S.seed * 13 + i, true, Math.max(2, S.objs.length))); b.fill(0) }
      else for (let q = 0, nq = 1 + (Math.random() * C * 3 | 0); q < nq; q++) {
        const o = S.objs[Math.random() * S.objs.length | 0], g = newGyro(Math.random() * 1e4, true, Math.max(2, S.objs.length))
        o.x = g.x; o.y = g.y; o.s = g.s * (0.5 + Math.random() * 1.4); o.tilts = g.tilts; o.dir = -o.dir; o.r0 += Math.random() * 3; o.sm = (Math.random() * 2 - 1) * 4
      }
      S.wob = Math.round(J() * 5 * C)
      S.trail = Math.random() < 0.5 ? 0.1 : 0.88
    }
    S.trail = S.trail == null ? 0.55 : S.trail + (0.55 - S.trail) * 0.12
    const E = bands(f, S, nObj, A)
    fade(b, A.live ? S.trail : 0.5)
    stars(b, W, H, 7, 160, 60)
    const dens = 1 / Math.sqrt(S.objs.length)   // keep the frame cost flat when many gyros appear
    const nRingDots = ((500 + grain * 1100) * dens) | 0, nCore = ((350 + grain * 900) * dens) | 0
    S.objs.forEach((o, i) => {
      const e = E ? E[i] : 0
      o.sm = (o.sm || 1) + (1 - (o.sm || 1)) * 0.03
      const R = Math.min(W, H) * o.s * (1 + A.low * 0.35 + e * 0.6) * (1 + J() * C * 0.7)   // size stutter
      const cx = o.x * W + J() * W * 0.05 * C, cy = o.y * H + J() * H * 0.05 * C              // shake
      const ry = S.t * o.dir * o.sm + o.r0, rx = S.t * 0.7 + o.r1
      const th = R * 0.07 * (1 + A.low * 1.6 + e)
      const br = 70 + A.low * 90 + e * 110
      const nr = Math.min(6, o.nr + Math.round(ringsP * 1.5) + Math.round(rich * 3))
      for (let k = 0; k < nr; k++) {
        const rr = R * (1 + k * 0.14) * (1 + J() * C * 0.4), [ax, az] = o.tilts[k], sp = S.t * (1.2 + k * 0.4)
        const g0 = Math.random() * 6.2832, gl = C > 0.12 ? Math.random() * C * 4 : 0   // torn ring: random gap
        for (let j = 0; j < nRingDots; j++) {
          const aa = j / nRingDots * 6.2832; if (gl && (aa - g0 + 12.5664) % 6.2832 < gl) continue
          const a = aa + sp, r = rr + (rnd(j * 1.7 + k * 31) - 0.5) * th
          const p = rot([Math.cos(a) * r, Math.sin(a) * r, (rnd(j * 3.3 + k) - 0.5) * th * 0.6], ax, az, ry, rx)
          const sc = 1 / (1 + p[2] / (R * 5)), dz = 0.55 + 0.45 * (-p[2] / (rr + 1e-3))
          splat(b, W, H, cx + p[0] * sc, cy + p[1] * sc, br * dz)
        }
      }
      for (let j = 0; j < nCore; j++) {   // grain sphere core
        const u = rnd(j * 2.1 + 5) * 2 - 1, ph = rnd(j * 4.7 + 9) * 6.2832, s = Math.sqrt(1 - u * u), rc = R * 0.36 * Math.cbrt(0.35 + rnd(j * 6.1) * 0.65)
        const p = rot([s * Math.cos(ph) * rc, u * rc, s * Math.sin(ph) * rc], 0, 0, ry * 0.6, rx * 0.4)
        splat(b, W, H, cx + p[0], cy + p[1], (br * 0.9) * (0.5 + 0.5 * (-p[2] / rc + 1) / 2))
      }
    })
    flush(S, f.lut)
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(S.cv, 0, 0); ctx.restore()
  }

  // ================= ECLIPSE =================
  function eclipseVector (ctx, f, D) {
    const W = D.W | 0, H = D.H | 0, S = state(ST.eclipse, ctx), A = aud(f), b = ibuf(S, W, H), col = colF(f.lut)
    const size = fxp(f, 'size', 0.5), corona = fxp(f, 'corona', 0.6), smoke = fxp(f, 'smoke', 0.6), cuts = fxp(f, 'cuts', 0.6), chaosP = fxp(f, 'chaos', 0.8)
    const Z = noise(f, S, A, chaosP), C = Z.C
    S.t += 0.01 * (A.live ? 0.5 + Z.cent * 1.5 + C * 2 : 1)
    const hit = A.beat > 0.45 && !S.prev; S.prev = A.beat > 0.45 ? 1 : 0
    if (S.zs == null) S.zs = 1
    if (hit) { S.zoom = 1; S.burst = 1; S.seed++; if (rnd(S.seed * 3) < cuts * 0.5) S.zs = 0.55 + rnd(S.seed * 5) * 0.75 }
    if (S.px == null) { S.px = 0.5; S.py = 0.5; S.echo = [] }
    // NOISE SPIKE -> the eclipse jumps somewhere else, snaps to a random size and leaves an echo eclipse behind
    if (Z.spike) {
      if (S.echo.length < 4) S.echo.push({ x: S.px, y: S.py, r: Math.min(1, S.zs) * 0.6, life: 1 })
      if (Math.random() < 0.5) { S.px = 0.2 + Math.random() * 0.6; S.py = 0.22 + Math.random() * 0.56 }
      if (Math.random() < 0.6) S.zs = 0.45 + Math.random() * 0.95
      S.burst = 1; S.zoom = Math.max(S.zoom || 0, Math.random())
      if (Math.random() < C * 0.5 && S.echo.length < 4) S.echo.push({ x: 0.1 + Math.random() * 0.8, y: 0.1 + Math.random() * 0.8, r: 0.15 + Math.random() * 0.35, life: 1 })
    } else { const back = A.live ? 0.01 + (1 - C) * 0.02 : 0.04; S.px += (0.5 - S.px) * back; S.py += (0.5 - S.py) * back; S.zs += (1 - S.zs) * back * 0.5 }
    S.zoom = (S.zoom || 0) * 0.82; S.burst = (S.burst || 0) * 0.8
    const sel = (f.bandSel || 0) * A.rc
    // GROW / SHRINK: loudness + richness drive the size (fast attack, slower release) -> 0.5× quiet … 1.9× loud
    const lvl = A.live ? Math.min(1.2, A.low * 0.7 + sel * 0.5 + Z.drive * 0.6 + A.beat * 0.3 + Z.fluxN * 0.3) : 0
    S.lev = S.lev == null ? lvl : S.lev + (lvl - S.lev) * (lvl > S.lev ? 0.6 : 0.2)
    const grow = A.live ? 0.6 + S.lev * 0.65 : 1 + Math.sin(S.t * 0.7) * 0.04
    // SMALLER HOLE (Oct 7, Reza: "black hole terlalu besar"): base radius 0.07+size*0.12 (was 0.12+size*0.16), gentler
    // jumps/growth, and a hard cap so even a loud spike never swallows the frame (radius <= 24 % of the short side)
    const R = Math.min(Math.min(W, H) * 0.24, Math.min(W, H) * (0.07 + size * 0.12) * S.zs * grow * (1 + S.zoom * 0.18) * (1 + J() * C * 0.35))   // size stutter
    const cx = W * S.px + J() * R * 0.35 * C, cy = H * S.py + J() * R * 0.35 * C                                  // shake
    // smoke wisps (intensity buffer with slow fade)
    fade(b, 0.94)
    if (!S.wisp) S.wisp = []
    const spawn = ((20 + smoke * 60) * (A.live ? 1 + A.low * 2 + C * 3 : 0.7) + S.burst * 400 * smoke) | 0
    for (let i = 0; i < spawn && S.wisp.length < 4000; i++) { const a = rnd(S.seed * 7 + S.fr * 13 + i) * 6.2832; S.wisp.push([cx + Math.cos(a) * R * 1.05, cy + Math.sin(a) * R * 1.05, a, 1, 0.6 + rnd(i + S.fr) * 1.4]) }
    S.fr++
    const sp = (0.6 + A.low * 2 + S.burst * 4) * (1 + C * 2)
    for (let i = S.wisp.length - 1; i >= 0; i--) {
      const q = S.wisp[i]
      const n = Math.sin(q[0] * 0.013 + S.t * 1.3) + Math.cos(q[1] * 0.011 - S.t)
      q[2] += n * 0.03 + 0.012 + J() * C * 0.8   // swirl (+ turbulence from the noise)
      q[0] += Math.cos(q[2]) * sp * q[4]; q[1] += Math.sin(q[2]) * sp * q[4]; q[3] -= 0.012
      if (q[3] <= 0 || q[0] < 0 || q[1] < 0 || q[0] >= W || q[1] >= H) { S.wisp[i] = S.wisp[S.wisp.length - 1]; S.wisp.pop(); continue }
      splat2(b, W, H, q[0], q[1], 70 * q[3] * (0.5 + smoke))
    }
    flush(S, f.lut)
    ctx.save(); ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(S.cv, 0, 0)
    const heat = Math.min(1, 0.45 + A.low * 0.7 + sel * 0.4 + S.zoom * 0.5)
    // wide smoky haze (fills the frame like the reference)
    const hz = ctx.createRadialGradient(cx, cy, R, cx, cy, Math.max(W, H) * 0.75)
    hz.addColorStop(0, col(150, 0.28 * heat)); hz.addColorStop(0.5, col(90, 0.1 * heat)); hz.addColorStop(1, col(40, 0))
    ctx.fillStyle = hz; ctx.fillRect(0, 0, W, H)
    // corona glow
    const cR = R * (1.6 + corona * 2.2) * (1 + sel * 0.6)
    const g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, cR)
    g.addColorStop(0, col(235, 0.55 * heat)); g.addColorStop(0.25, col(170, 0.22 * heat)); g.addColorStop(1, col(60, 0))
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, cR, 0, 6.2832); ctx.fill()
    // rays
    ctx.lineWidth = 1; ctx.strokeStyle = col(220, 0.08 + heat * 0.12); ctx.beginPath()
    const rseed = C > 0.2 ? S.fr * 0.37 : 0
    for (let i = 0; i < 70; i++) { const a = rnd(i * 2.7 + rseed) * 6.2832 + Math.sin(S.t * 0.3 + i) * 0.05, l = R * (1.2 + rnd(i * 5.3 + (S.fr >> 3)) * (1.2 + corona * 2) * (0.6 + A.high + sel) * (1 + C * Math.random() * 2.5)); ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l) }
    ctx.stroke()
    // burning ring with plasma texture
    const lw = R * (0.05 + A.low * 0.09 + S.zoom * 0.05)
    ctx.shadowColor = col(255, 0.9); ctx.shadowBlur = R * (0.25 + heat * 0.35)
    ctx.strokeStyle = col(250, 0.85 * heat + 0.15); ctx.lineWidth = lw * (1 + C * Math.random() * 2); ctx.beginPath()
    if (C > 0.04) { for (let k = 0; k <= 72; k++) { const a = k / 72 * 6.2832, r = R * 1.02 * (1 + J() * C * 0.32); k ? ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : ctx.moveTo(cx + r, cy) } ctx.closePath() }   // ring torn by the noise
    else ctx.arc(cx, cy, R * 1.02, 0, 6.2832)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.lineWidth = Math.max(1, R * 0.012)
    for (let k = 0; k < 18; k++) {   // jittery filaments hugging the ring
      const a0 = rnd(k * 3.3 + (S.fr >> 2)) * 6.2832, len = 0.5 + rnd(k * 7.1) * 1.6, rr = R * (1.0 + (rnd(k * 9.7 + (S.fr >> 1)) - 0.3) * 0.12 * (1 + A.high * 2))
      ctx.strokeStyle = col(255, 0.25 + heat * 0.4); ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a0 + len); ctx.stroke()
    }
    // BRUTALITY: ghost rings, each breaking up on its own random frequency
    const nG = A.live ? Math.round(A.K * 4) : 0, E = nG ? bands(f, S, nG, A) : null
    for (let k = 0; k < nG; k++) {
      const e = E[k]; if (e < 0.05) continue
      const rr = R * (1.35 + k * 0.38 + e * 0.15), segs = 3 + (k % 4)
      ctx.strokeStyle = col(230, 0.12 + e * 0.5); ctx.lineWidth = Math.max(1, R * 0.008 * (1 + e * 3))
      for (let sgi = 0; sgi < segs; sgi++) { const a0 = rnd(S.seed * 11 + k * 7 + sgi) * 6.2832 + S.t * (k % 2 ? 1 : -1); ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a0 + 0.3 + e * 1.4); ctx.stroke() }
    }
    // echo eclipses left behind by noise spikes (burning ring, fading out)
    for (let i = S.echo.length - 1; i >= 0; i--) {
      const q = S.echo[i]; q.life *= 0.86; if (q.life < 0.05 || !A.live) { S.echo.splice(i, 1); continue }
      const er = Math.min(W, H) * (0.07 + size * 0.12) * q.r * (1 + J() * C * 0.3), ex = q.x * W, ey = q.y * H
      ctx.shadowColor = col(255, 0.9); ctx.shadowBlur = er * 0.3; ctx.strokeStyle = col(250, 0.9 * q.life); ctx.lineWidth = er * 0.06
      ctx.beginPath(); ctx.arc(ex, ey, er, 0, 6.2832); ctx.stroke(); ctx.shadowBlur = 0
    }
    ctx.restore()
    // the eclipse disc itself (pure black, on top of the glow)
    ctx.save(); ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.97, 0, 6.2832); ctx.fill()
    for (const q of S.echo) { if (q.life < 0.35) continue; const er = Math.min(W, H) * (0.07 + size * 0.12) * q.r; ctx.beginPath(); ctx.arc(q.x * W, q.y * H, er * 0.95, 0, 6.2832); ctx.fill() }
    ctx.restore()
  }

  // ================= BEAM =================
  function newBeam (seed, live) { return { ang: live ? -1.05 + (rnd(seed) - 0.5) * 1.4 : -1.05, ox: live ? (rnd(seed * 3) - 0.5) * 0.25 : 0, oy: live ? (rnd(seed * 5) - 0.5) * 0.25 : 0 } }
  function beamVector (ctx, f, D) {
    const W = D.W | 0, H = D.H | 0, S = state(ST.beam, ctx), A = aud(f), b = ibuf(S, W, H), col = colF(f.lut)
    const width = fxp(f, 'width', 0.6), orbit = fxp(f, 'orbit', 0.6), smearP = fxp(f, 'smear', 0.6), tilt = fxp(f, 'tilt', 0.6), chaosP = fxp(f, 'chaos', 0.8)
    const Z = noise(f, S, A, chaosP), C = Z.C, rich = Z.drive
    S.t += (0.006 + orbit * 0.02 * (1 + A.mid * 3)) * (A.live ? (0.5 + Z.cent * 1.5) * (1 + C * 2) : 1)
    const nB = A.live ? Math.max(1, Math.min(7, 1 + Math.round(rich * 6 * (0.6 + A.K * 0.6)))) : 1   // more frequencies -> more beams
    const hit = A.beat > 0.45 && !S.prev; S.prev = A.beat > 0.45 ? 1 : 0
    if (!S.beams) S.beams = [newBeam(S.seed * 7, false)]
    while (S.beams.length < nB) { S.seed++; S.beams.push(newBeam(S.seed * 7 + S.beams.length, true)) }
    if (S.beams.length > nB) S.beams.length = nB
    if (hit) { S.seed++; S.smear = Math.min(1, (S.smear || 0) + 0.6 + A.low * 0.6); S.kick = 1; if (rnd(S.seed * 3) < tilt) S.beams.forEach((bm, i) => { const nb = newBeam(S.seed * 7 + i, true); bm.ang = nb.ang; bm.ox = nb.ox; bm.oy = nb.oy }) }
    // NOISE SPIKE -> beams fling to random angles/positions (one, several or all), smear + orbit scramble
    if (Z.spike) {
      S.smear = Math.min(1, (S.smear || 0) + 0.3 + C * 0.5); S.kick = 1; S.t += Math.random() * 3
      const all = Math.random() < 0.15 + C * 0.3
      S.beams.forEach((bm) => { if (all || Math.random() < 0.35 + C * 0.3) { bm.ang = Math.random() * 6.2832; bm.ox = J() * 0.85; bm.oy = J() * 0.8 } })
    }
    if (!A.live) S.beams[0].ang = -1.05 + Math.sin(S.t * 0.2) * 0.08
    S.beams.forEach((bm) => { bm.j = A.live ? J() * C * 0.14 : 0; bm.off = A.live && Math.random() < C * 0.22; bm.fl = 1 + J() * C * 1.4 })   // jitter / stutter / flicker
    S.smear = (S.smear || 0) * 0.86; S.kick = (S.kick || 0) * 0.85
    const E = bands(f, S, nB, A)
    fade(b, 0.93)
    stars(b, W, H, 3, 140, 30)
    const L = Math.hypot(W, H) * 0.6, dot = (S.fr++ & 1) === 0   // splat every other frame -> dotted trails
    const NP = ((160 + orbit * 520) * (1 + rich * 1.5)) | 0
    S.beams.forEach((bm, bi) => {
      const e = E ? E[bi] : 0
      const ca = Math.cos(bm.ang + bm.j), sa = Math.sin(bm.ang + bm.j), px = -sa, py = ca, cx = W * (0.5 + bm.ox), cy = H * (0.5 + bm.oy)
      if (dot) for (let i = 0; i < NP; i++) {
        const u = (rnd(i * 1.37 + bi * 91) * 2 - 1), au = Math.abs(u)
        const r0 = Math.min(W, H) * (0.03 + 0.32 * Math.pow(1 - au, 1.6)) * (0.4 + rnd(i * 4.1 + bi) * 0.9) * (1 + S.kick * 0.6 + e * 0.5)
        const ph = rnd(i * 2.9 + bi * 13) * 6.2832 + S.t * (2.5 + rnd(i * 5.5) * 3) * (rnd(i * 8.1) < 0.5 ? 1 : -1)
        const along = u * L * 0.8 + Math.sin(ph) * r0 * 0.45 + Math.sin(S.t * 0.4 + i) * r0 * 0.3   // tilted orbit -> loops
        const x = cx + ca * along + px * Math.cos(ph) * r0, y = cy + sa * along + py * Math.cos(ph) * r0
        const depth = 0.45 + 0.55 * (Math.sin(ph) * 0.5 + 0.5)
        splat2(b, W, H, x, y, (120 + A.high * 140 + e * 120) * depth * (0.6 + (1 - au) * 0.6))
      }
    })
    flush(S, f.lut)
    ctx.save(); ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(S.cv, 0, 0)
    // white zoom smear (feedback-style) on hits
    if (S.smear > 0.04 && smearP > 0.01) for (const z of [1.03, 1.07, 1.13, 1.2]) {
      ctx.globalAlpha = S.smear * smearP * 0.45 / z
      const zw = W * z, zh = H * z; ctx.drawImage(S.cv, (W - zw) / 2, (H - zh) / 2, zw, zh)
    }
    ctx.globalAlpha = 1
    S.beams.forEach((bm, bi) => {
      const e = E ? E[bi] : 0
      if (bm.off) return   // stutter: this beam drops out for a frame
      const ca = Math.cos(bm.ang + bm.j), sa = Math.sin(bm.ang + bm.j), cx = W * (0.5 + bm.ox), cy = H * (0.5 + bm.oy)
      const glow = (0.35 + width * 0.6) * (0.6 + A.low * 0.9 + e * 0.8 + S.kick * 0.6) * bm.fl
      // galactic bulge
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(bm.ang + bm.j); ctx.scale(1, 0.3)
      const gR = Math.min(W, H) * (0.3 + width * 0.25) * (1 + A.low * 0.4 + S.kick * 0.3) / Math.sqrt(S.beams.length)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, gR); g.addColorStop(0, col(255, Math.min(1, 1.1 * glow))); g.addColorStop(0.25, col(235, Math.min(1, 0.5 * glow))); g.addColorStop(0.6, col(170, 0.14 * glow)); g.addColorStop(1, col(80, 0))
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, gR, 0, 6.2832); ctx.fill(); ctx.restore()
      // core line + soft glow passes
      for (const [lw, al] of [[18, 0.05], [8, 0.12], [3, 0.35], [1.2, 0.95]]) {
        ctx.strokeStyle = col(255, Math.min(1, al * glow * (lw < 2 ? 1 : 1.2))); ctx.lineWidth = lw * (0.6 + width) * (1 + A.low * 1.2 + e)
        ctx.beginPath()
        if (C > 0.1) for (let sg = 0; sg < 10; sg++) { if (Math.random() < C * 0.4) continue; const u0 = -1 + sg * 0.2, u1 = u0 + 0.2; ctx.moveTo(cx + ca * L * u0, cy + sa * L * u0); ctx.lineTo(cx + ca * L * u1, cy + sa * L * u1) }   // broken beam
        else { ctx.moveTo(cx - ca * L, cy - sa * L); ctx.lineTo(cx + ca * L, cy + sa * L) }
        ctx.stroke()
      }
    })
    ctx.restore()
  }

  HVFT_FX_PARAMS.gyro = [['rings', 'Ring Count', 0.5], ['grain', 'Grain', 0.6], ['spin', 'Spin', 0.5], ['cuts', 'Beat Cuts', 0.6], ['chaos', 'Noise Chaos', 0.8]]
  HVFT_FX_PARAMS.eclipse = [['size', 'Size', 0.5], ['corona', 'Corona', 0.6], ['smoke', 'Smoke', 0.6], ['cuts', 'Beat Zoom', 0.6], ['chaos', 'Noise Chaos', 0.8]]
  HVFT_FX_PARAMS.beam = [['width', 'Beam Glow', 0.6], ['orbit', 'Orbit Particles', 0.6], ['smear', 'Smear', 0.6], ['tilt', 'Angle Jump', 0.6], ['chaos', 'Noise Chaos', 0.8]]
  for (const e of [
    { id: 'gyro', name: 'Gyro (pattern)', pixels: clearPx, vector: gyroVector, maxRes: 960, bgRes: 760 },
    { id: 'eclipse', name: 'Eclipse (pattern)', pixels: clearPx, vector: eclipseVector, maxRes: 960, bgRes: 760 },
    { id: 'beam', name: 'Beam (pattern)', pixels: clearPx, vector: beamVector, maxRes: 960, bgRes: 760 }
  ]) {
    if (typeof HVFT_GEN_FX !== 'undefined') HVFT_GEN_FX.add(e.id)
    if (!HVFT_EFFECTS.some(x => x.id === e.id)) HVFT_EFFECTS.push(e)
  }
})()
