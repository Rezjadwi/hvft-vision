// HVFT VISION — bg_flash.js — FLASH PATTERNS (Oct 7)
// Disturbing, flashing BG PATTERNs for harsh noise. They read the RANDOMNESS of the noise itself:
//   flux   how much the spectrum changes frame to frame, judged against its own running level (self-calibrating,
//          so a constant noise wall still twitches)
//   spike  a flux burst above that level -> random event (re-cut, invert, teleport)
//   hot(i) one spectrum bin vs its own running mean -> each cell / slab / ring follows its own frequency
//   cent   spectral centre (bassy noise -> coarse patterns, hissy noise -> fine patterns)
// Patterns:
//   NOISE STROBE  full / partial frame strobe; every hot burst = a flash (white, black, half, quarter, bars)
//   STROBE GRID   random grid, every cell locked to its own frequency -> flickering chequer; re-cut on spikes
//   MOIRE         2–3 interfering ring / line gratings, hard black-white; vibrates, inverts and jumps with the noise
//   TV STATIC     snow + rolling bars + torn rows + vertical-hold slips; white/black frame flashes on spikes
//   BARCODE TEAR  horizontal slabs of barcode stripes, each slab on its own frequency, sliding and flashing
//   HYPNO TUNNEL  black/white square-or-round rings rushing in/out, twisting; direction flips on spikes
// Mic OFF = calm, slow, dim versions (no flashing). Everything is intensity through the channel LUT (COLOR applies).
// Params (each pattern): Flash (strobe strength), Noise Chaos (how much the noise randomness drives cuts), + one own.
;(function () {
  if (typeof HVFT_EFFECTS === 'undefined') return
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v
  const ST = new WeakMap()
  function clearPx (f) { const o = f.out; o.fill(0); for (let j = 3; j < o.length; j += 4) o[j] = 255 }
  function st (ctx, id) {
    let m = ST.get(ctx.canvas); if (!m) { m = {}; ST.set(ctx.canvas, m) }
    return m[id] || (m[id] = { fr: 0, t: 0, seed: (Math.random() * 1e6) | 0, fm: 0.02, fd: 0.01, ref: 0, prev: null, bm: null, cent: 0.5 })
  }
  let _r = (Math.random() * 1e9) >>> 0
  const R = () => (_r = (Math.imul(_r, 1664525) + 1013904223) >>> 0) / 4294967296
  const H32 = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2d); return ((h ^ (h >>> 15)) >>> 0) / 4294967296 }
  // ---- read the noise ----
  function nz (f, S) {
    const rc = typeof _react === 'function' ? _react(f) : 0, B = typeof _bnd === 'function' ? _bnd(f) : [0, 0, 0]
    const o = { live: rc > 0.001, low: B[0] * rc, mid: B[1] * rc, high: B[2] * rc, beat: (f.onset || 0) * rc, flux: 0, z: 0, spike: false, cent: S.cent, sp: null }
    const sp = f.spec
    if (!o.live || !sp || !sp.length) return o
    if (!S.prev || S.prev.length !== sp.length) { S.prev = new Float32Array(sp.length); S.bm = new Float32Array(sp.length) }
    let fl = 0, sw = 0, sm = 0
    for (let i = 1; i < sp.length; i++) { const v = sp[i] / 255, d = v - S.prev[i]; if (d > 0) fl += d; S.prev[i] = v; S.bm[i] += (v - S.bm[i]) * 0.05; sw += v * i; sm += v }
    fl /= sp.length
    S.fm += (fl - S.fm) * 0.04; S.fd += (Math.abs(fl - S.fm) - S.fd) * 0.04
    o.z = (fl - S.fm) / (S.fd + 0.004); o.flux = clamp(0.35 + o.z * 0.22, 0, 1)
    S.ref = Math.max(0, S.ref - 1); if ((o.z > 1.3 || o.beat > 0.5) && S.ref === 0) { o.spike = true; S.ref = 2 }
    S.cent += ((sm > 0.01 ? sw / sm / sp.length : 0.5) - S.cent) * 0.2; o.cent = S.cent; o.sp = sp
    return o
  }
  // a bin against its own running mean: > 0 = that frequency is "hot" right now
  const hot = (S, N, k) => { if (!N.sp) return 0; const n = N.sp.length - 2, i = 1 + (((k % n) + n) % n); return N.sp[i] / 255 - S.bm[i] * 0.92 }
  const colOf = (lut) => (v) => { v = clamp(v | 0, 0, 255); return lut ? 'rgb(' + lut[v * 3] + ',' + lut[v * 3 + 1] + ',' + lut[v * 3 + 2] + ')' : 'rgb(' + v + ',' + v + ',' + v + ')' }
  // small intensity buffer -> LUT -> crisp upscale
  function ibuf (S, w, h) {
    if (!S.ib || S.w !== w || S.h !== h) { S.w = w; S.h = h; S.ib = new Uint8ClampedArray(w * h); S.bcv = document.createElement("canvas"); S.bcv.width = w; S.bcv.height = h; S.bcx = S.bcv.getContext("2d"); S.img = S.bcx.createImageData(w, h) }
    return S.ib
  }
  function flush (ctx, S, lut, W, H) {
    const d = S.img.data, b = S.ib
    for (let i = 0, j = 0; i < b.length; i++, j += 4) { const v = b[i]; if (lut) { d[j] = lut[v * 3]; d[j + 1] = lut[v * 3 + 1]; d[j + 2] = lut[v * 3 + 2] } else d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255 }
    S.bcx.putImageData(S.img, 0, 0)
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(S.bcv, 0, 0, W, H); ctx.restore()
  }
  const P3 = (id, own) => [['flash', 'Flash', 0.8], ['chaos', 'Noise Chaos', 0.8], own]

  // ================= NOISE STROBE =================
  function strobeV (ctx, f, D) {
    const W = D.W, H = D.H, S = st(ctx, 'fstrobe'), N = nz(f, S), col = colOf(f.lut)
    const flash = fxp(f, 'flash', 0.8), chaos = fxp(f, 'chaos', 0.8), rate = fxp(f, 'rate', 0.6)
    S.fr++
    ctx.fillStyle = col(0); ctx.fillRect(0, 0, W, H)
    if (!N.live) { const v = 14 + 10 * Math.sin(S.fr * 0.03); ctx.fillStyle = col(v); ctx.fillRect(0, 0, W, H); return }   // calm: slow dim breathing
    // probability of a flash this frame follows the noise texture; spikes always flash
    const p = clamp((N.flux - 0.3) * 1.6 * rate + N.high * 0.25 * rate + N.low * 0.15, 0, 0.95) * (0.4 + chaos * 0.6)
    if (!(N.spike || R() < p)) { if (R() < N.flux * 0.3) { ctx.fillStyle = col(30 + N.low * 60); ctx.fillRect(0, 0, W, H) } return }
    const v = 255 * flash * (0.6 + 0.4 * R())
    const kind = N.spike ? (R() < 0.6 ? 0 : 1 + ((R() * 5) | 0)) : ((R() * 6) | 0)
    ctx.fillStyle = col(v)
    if (kind === 0) ctx.fillRect(0, 0, W, H)                                                  // full frame
    else if (kind === 1) { const hx = R() < 0.5; hx ? ctx.fillRect(R() < 0.5 ? 0 : W / 2, 0, W / 2, H) : ctx.fillRect(0, R() < 0.5 ? 0 : H / 2, W, H / 2) }   // half
    else if (kind === 2) { const q = (R() * 4) | 0; ctx.fillRect((q & 1) * W / 2, (q >> 1) * H / 2, W / 2, H / 2) }    // quarter
    else if (kind === 3) { const n = 3 + ((R() * 14) | 0); for (let k = 0; k < n; k++) if (R() < 0.5) ctx.fillRect(0, k * H / n, W, H / n + 1) }   // bars
    else if (kind === 4) { const n = 3 + ((R() * 20) | 0); for (let k = 0; k < n; k++) if (R() < 0.5) ctx.fillRect(k * W / n, 0, W / n + 1, H) }   // columns
    else { ctx.fillRect(0, 0, W, H); ctx.fillStyle = col(0); const b = Math.min(W, H) * (0.1 + R() * 0.35); ctx.fillRect(W / 2 - b, H / 2 - b, b * 2, b * 2) }   // frame with a black hole
  }

  // ================= STROBE GRID =================
  function gridV (ctx, f, D) {
    const W = D.W, H = D.H, S = st(ctx, 'fgrid'), N = nz(f, S), col = colOf(f.lut)
    const flash = fxp(f, 'flash', 0.8), chaos = fxp(f, 'chaos', 0.8), cells = fxp(f, 'cells', 0.5)
    S.fr++
    if (!S.g || (N.spike && R() < 0.35 + chaos * 0.6) || (N.live && R() < N.flux * chaos * 0.03)) {
      const big = R() < 0.25
      S.g = { c: big ? 2 + ((R() * 3) | 0) : 3 + ((R() * (4 + cells * 26)) | 0), r: big ? 2 + ((R() * 2) | 0) : 2 + ((R() * (3 + cells * 15)) | 0), off: (R() * 997) | 0, inv: R() < 0.25, jit: R() < 0.4 }
    }
    const G = S.g, cw = W / G.c, ch = H / G.r
    ctx.fillStyle = col(0); ctx.fillRect(0, 0, W, H)
    const thr = 0.03 - N.flux * 0.06
    for (let r = 0; r < G.r; r++) {
      const sh = (G.jit && N.live) ? (H32(r + S.fr, G.off) - 0.5) * cw * N.flux * chaos * 2 : 0   // rows slip sideways on rough noise
      for (let c = 0; c < G.c; c++) {
        let v
        if (!N.live) v = 18 + 16 * (0.5 + 0.5 * Math.sin(S.fr * 0.02 + c * 0.9 + r * 1.3))   // calm chequer breathing
        else {
          const h = hot(S, N, G.off + c * 7 + r * 13)
          const on = h > thr || H32(c * 31 + r, S.fr) < N.high * 0.18 * chaos
          v = on ? 255 * flash * (0.55 + 0.45 * clamp(h * 4 + 0.5, 0, 1)) : (H32(c, r + S.fr) < 0.06 ? 60 : 0)
        }
        if (N.live && (G.inv !== (N.spike && R() < 0.5))) v = 255 - v   // inversion only while the noise plays
        if (v < 2) continue
        ctx.fillStyle = col(v); ctx.fillRect(Math.floor(c * cw + sh), Math.floor(r * ch), Math.ceil(cw) - (cells > 0.7 ? 1 : 0), Math.ceil(ch) - (cells > 0.7 ? 1 : 0))
      }
    }
  }

  // ================= MOIRE =================
  function moireV (ctx, f, D) {
    const W = D.W, H = D.H, S = st(ctx, 'fmoire'), N = nz(f, S)
    const flash = fxp(f, 'flash', 0.8), chaos = fxp(f, 'chaos', 0.8), fine = fxp(f, 'fine', 0.5)
    const w = Math.min(W, 360), h = Math.max(2, Math.round(w * H / W)), b = ibuf(S, w, h)
    S.fr++
    if (!S.m || (N.spike && R() < 0.3 + chaos * 0.6)) {
      const n = 2 + (R() < 0.4 ? 1 : 0)
      S.m = { mode: (R() * 3) | 0, c: [], inv: 0 }
      for (let k = 0; k < n; k++) S.m.c.push({ x: R(), y: R(), a: R() * 6.28, k: 0.6 + R() * 1.4, ph: R() * 6.28, sp: (R() - 0.5) * 2 })
      if (N.live) S.m.inv = 3   // the cut itself flashes inverted for a few frames
    }
    const M = S.m
    const base = (0.18 + fine * 0.5) * (0.6 + (N.live ? N.cent : 0.5) * 1.2)   // hissy noise = finer gratings
    const spd = N.live ? 0.05 + N.low * 0.4 + N.mid * 0.3 + N.flux * chaos * 0.5 : 0.01
    for (const c of M.c) { c.ph += spd * c.sp * 6 + (N.live ? (R() - 0.5) * N.flux * chaos * 2.5 : 0); if (N.live && R() < N.high * 0.05 * chaos) { c.x = R(); c.y = R() } }
    const inv = (M.inv-- > 0) || (N.live && R() < (N.flux - 0.5) * 0.4 * chaos)
    const hiV = N.live ? 255 * flash : 70, loV = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 1
        for (let k = 0; k < M.c.length; k++) {
          const c = M.c[k], dx = x - c.x * w, dy = y - c.y * h
          let q
          if (M.mode === 0 || (M.mode === 2 && k === 0)) q = Math.sqrt(dx * dx + dy * dy)            // rings
          else q = dx * Math.cos(c.a) + dy * Math.sin(c.a)                                           // straight lines
          s *= Math.sin(q * base * c.k + c.ph)
        }
        let v = s > 0 ? hiV : loV
        if (inv) v = hiV - v
        b[y * w + x] = v
      }
    }
    flush(ctx, S, f.lut, W, H)
  }

  // ================= TV STATIC =================
  function staticV (ctx, f, D) {
    const W = D.W, H = D.H, S = st(ctx, 'fstatic'), N = nz(f, S)
    const flash = fxp(f, 'flash', 0.8), chaos = fxp(f, 'chaos', 0.8), roll = fxp(f, 'roll', 0.6)
    const w = Math.min(W, 320), h = Math.max(2, Math.round(w * H / W)), b = ibuf(S, w, h)
    S.fr++
    const live = N.live
    if (!S.prev2 || S.prev2.length !== w * h) S.prev2 = new Uint8ClampedArray(w * h)
    const P = S.prev2
    S.roll = (S.roll || 0) + (live ? (0.3 + N.mid * 3) * roll : 0.15)
    if (live && R() < N.flux * chaos * 0.08) S.slip = ((R() * h) | 0)   // vertical hold slip
    const slip = S.slip || 0; if (S.slip) S.slip = (S.slip * 0.7) | 0
    const dens = live ? 0.35 + N.low * 0.5 + N.flux * 0.4 : 0.12
    const flashF = live && N.spike && R() < 0.35 * flash ? (R() < 0.6 ? 255 : 1) : 0   // whole frame white (or black) on a spike
    for (let y = 0; y < h; y++) {
      const yy = (y + slip) % h
      const bar = 0.55 + 0.45 * Math.sin((yy + S.roll * 8) * 0.045)        // rolling bars
      const tear = live && H32(y, S.fr) < N.flux * chaos * 0.12 ? ((H32(y, S.fr + 7) - 0.5) * w * 0.6) | 0 : 0   // torn rows copy the last frame shifted
      for (let x = 0; x < w; x++) {
        const i = yy * w + x
        let v
        if (tear) { const sx = (x + tear + w) % w; v = P[y * w + sx] }
        else v = (R() < dens ? 255 * R() : R() * 40) * bar * (live ? 1 : 0.35)
        if (flashF) v = flashF === 255 ? 255 * flash : 0
        b[i] = v
      }
    }
    P.set(b)
    flush(ctx, S, f.lut, W, H)
  }

  // ================= BARCODE TEAR =================
  function barsV (ctx, f, D) {
    const W = D.W, H = D.H, S = st(ctx, 'fbars'), N = nz(f, S), col = colOf(f.lut)
    const flash = fxp(f, 'flash', 0.8), chaos = fxp(f, 'chaos', 0.8), slabs = fxp(f, 'slabs', 0.5)
    S.fr++
    if (!S.s || (N.spike && R() < 0.3 + chaos * 0.6)) {
      const n = 3 + ((R() * (4 + slabs * 24)) | 0), sl = []
      let y = 0
      for (let k = 0; k < n; k++) {
        const hh = (k === n - 1) ? 1 - y : Math.max(0.01, (1 - y) * (0.1 + R() * 0.5) / Math.max(1, (n - k) * 0.35))
        const bars = []; let x = 0; while (x < 1) { const bw = 0.004 + R() * R() * 0.08; bars.push([x, bw * (0.3 + R() * 0.7)]); x += bw }
        sl.push({ y, h: hh, bars, off: R(), dir: R() < 0.5 ? -1 : 1, bin: (R() * 200) | 0, inv: R() < 0.2, sp: 0.2 + R() * 1.8 })
        y += hh; if (y >= 1) break
      }
      S.s = sl
    }
    ctx.fillStyle = col(0); ctx.fillRect(0, 0, W, H)
    for (const s of S.s) {
      const hv = N.live ? hot(S, N, s.bin) : 0
      s.off += (N.live ? (0.002 + Math.max(0, hv) * 0.08 + N.flux * chaos * 0.02 * R()) * s.sp : 0.0006 * s.sp) * s.dir
      if (N.live && R() < N.flux * chaos * 0.03) s.dir = -s.dir
      const lit = !N.live ? 50 : (hv > 0.02 - N.flux * 0.05 ? 255 * flash : (R() < 0.1 ? 120 : 35))
      const y0 = Math.floor(s.y * H), hh = Math.ceil(s.h * H)
      const inv = s.inv !== (N.spike && R() < 0.4)
      if (inv) { ctx.fillStyle = col(lit); ctx.fillRect(0, y0, W, hh) }
      ctx.fillStyle = col(inv ? 0 : lit)
      for (const [bx, bw] of s.bars) {
        let x = (bx + s.off) % 1; if (x < 0) x += 1
        ctx.fillRect(Math.floor(x * W), y0, Math.max(1, Math.ceil(bw * W)), hh)
        if (x + bw > 1) ctx.fillRect(Math.floor((x - 1) * W), y0, Math.max(1, Math.ceil(bw * W)), hh)
      }
    }
  }

  // ================= HYPNO TUNNEL =================
  // HYPNO TUNNEL follows the noise (Oct 8, trace: it moved on its own — constant brightness, time-driven):
  //   level = brightness (quiet = dim, wall = full), LOW = rush speed (silence = it stops), N (noisiness) = ring density,
  //   P (peaks / feedback tones) = twist, HIGH = shake, every hit = invert + jump + maybe flip direction / shape.
  function tunnelV (ctx, f, D) {
    const W = D.W, H = D.H, S = st(ctx, 'ftunnel'), N = nz(f, S)
    const flash = fxp(f, 'flash', 0.8), chaos = fxp(f, 'chaos', 0.8), twist = fxp(f, 'twist', 0.5)
    const w = Math.min(W, 400), h = Math.max(2, Math.round(w * H / W)), b = ibuf(S, w, h)
    const HA = (N.live && window.HVFT_AUDIO) || {}, flat = HA.flat || 0, crest = HA.crest || 0
    S.fr++
    if (S.dir == null) { S.dir = 1; S.sq = true; S.cx = 0.5; S.cy = 0.5; S.lev = 0 }
    const lev = N.live ? Math.max(N.low, N.mid, N.high) : 0
    S.lev += (lev - S.lev) * (lev > S.lev ? 0.6 : 0.25)
    if (N.live && (N.spike || N.beat > 0.5) && !S.hitP) { S.inv = 2; if (R() < 0.35 + chaos * 0.4) S.dir = -S.dir; if (R() < 0.3) S.sq = !S.sq; if (R() < chaos * 0.6) { S.cx = 0.3 + R() * 0.4; S.cy = 0.3 + R() * 0.4 } S.kick = 1 }
    S.hitP = N.live && (N.spike || N.beat > 0.5)
    S.kick = (S.kick || 0) * 0.7
    S.cx += (0.5 - S.cx) * 0.02; S.cy += (0.5 - S.cy) * 0.02
    S.t += N.live ? (0.01 + N.low * 1.4 + N.flux * chaos * 0.5 + S.kick * 1.2) * S.dir : 0.015
    const rings = (6 + twist * 4) * (0.45 + (N.live ? flat * 1.1 + N.cent * 0.4 : 0.5)) / Math.min(w, h) * 26
    const tw = twist * (N.live ? 0.6 + crest * 4 + N.mid * 1.5 : 1.2)
    const jx = N.live ? (R() - 0.5) * N.high * chaos * w * 0.05 : 0, jy = N.live ? (R() - 0.5) * N.high * chaos * h * 0.05 : 0
    const inv = (S.inv-- > 0) || (N.live && R() < (N.flux - 0.6) * 0.4 * chaos)
    const hiV = N.live ? 255 * flash * Math.min(1, 0.18 + S.lev * 0.95 + S.kick * 0.3) : 60
    const cx = S.cx * w + jx, cy = S.cy * h + jy
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy
        const d = S.sq ? Math.max(Math.abs(dx), Math.abs(dy) * w / h) : Math.sqrt(dx * dx + dy * dy)
        const a = Math.atan2(dy, dx)
        const q = Math.log(d + 1) * rings * 6 + a * tw / 3.1416 - S.t   // log spacing = rushing into depth
        let v = ((Math.floor(q) & 1) ? hiV : 0)
        if (inv) v = hiV - v
        b[y * w + x] = v * Math.min(1, d / (Math.min(w, h) * 0.04))   // tiny dark core
      }
    }
    flush(ctx, S, f.lut, W, H)
  }

  HVFT_FX_PARAMS.fstrobe = P3('fstrobe', ['rate', 'Strobe Rate', 0.6])
  HVFT_FX_PARAMS.fgrid = P3('fgrid', ['cells', 'Cell Count', 0.5])
  HVFT_FX_PARAMS.fmoire = P3('fmoire', ['fine', 'Fineness', 0.5])
  HVFT_FX_PARAMS.fstatic = P3('fstatic', ['roll', 'Roll Speed', 0.6])
  HVFT_FX_PARAMS.fbars = P3('fbars', ['slabs', 'Slab Count', 0.5])
  HVFT_FX_PARAMS.ftunnel = P3('ftunnel', ['twist', 'Twist', 0.5])
  const LIST = [
    ['fstrobe', 'N.STROBE', 'Noise Strobe (pattern)', strobeV, 640, 'Strobe that follows the noise: every rough burst = a flash (full / half / quarter / bars / frame with a black hole). Mic off = dim breathing.'],
    ['fgrid', 'S.GRID', 'Strobe Grid (pattern)', gridV, 640, 'Random grid; every cell flickers on its own frequency. Noise spikes re-cut the grid, rough noise makes rows slip.'],
    ['fmoire', 'MOIRE', 'Moire (pattern)', moireV, 640, 'Interfering black/white ring and line gratings that vibrate, invert and jump with the noise. Hissy noise = finer.'],
    ['fstatic', 'STATIC', 'TV Static (pattern)', staticV, 480, 'Snow, rolling bars, torn rows and vertical-hold slips; spikes flash the whole frame white or black.'],
    ['fbars', 'BARCODE', 'Barcode Tear (pattern)', barsV, 760, 'Horizontal slabs of barcode stripes, each slab on its own frequency — they slide, flash and invert.'],
    ['ftunnel', 'TUNNEL', 'Hypno Tunnel (pattern)', tunnelV, 640, 'Black/white rings rushing into depth and twisting; bass = speed, spikes flip the direction and invert.']
  ]
  window.HVFT_BG_EXTRA = (window.HVFT_BG_EXTRA || []).concat(LIST.map(e => [e[0], e[1], e[5]]))
  for (const [id, , name, vector, bgRes] of LIST) {
    const e = { id, name, pixels: clearPx, vector, maxRes: 960, bgRes }
    if (typeof HVFT_GEN_FX !== 'undefined') HVFT_GEN_FX.add(id)
    if (!HVFT_EFFECTS.some(x => x.id === id)) HVFT_EFFECTS.push(e)
  }
})()
