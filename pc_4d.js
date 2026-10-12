// HVFT VISION — pc_4d.js
// (1) CLEAN DEPTH for the Kinect point cloud (opt.clean, default ON):
//     temporal denoise (holds + smooths static depth, snaps on real motion), hole hold (3 frames),
//     flying-pixel removal at depth edges, isolated speckle removal, edge-aware 3x3 smoothing.
// (2) 3D STYLE '4D' (opt.style = 'hyper4d') — the 4th dimension is TIME and a hyper-axis W:
//     opt.h4mode  'hyper'  HYPER ROTATE : every point gets a W coordinate (nearness + motion); the body is rotated
//                                         in the XW / YW / ZW planes and projected 4D→3D. A tesseract cage spins in 4D.
//                 'echo'   TIME ECHO    : past frames trail behind the body along a time axis, fading.
//                 'slice'  TIME SLICE   : slit-scan through time — each part of the body comes from a different moment
//                                         (rows / columns / depth / rings), the time wave scrolls continuously.
//                 'world'  WORLDLINE    : every moving point draws its path through the last frames as a 4D streak.
//     opt.h4amt 0..1 (4D amount), opt.tess (tesseract cage, default ON).
//     Audio (harsh noise, continuous): each band is normalised to its own running mean, so steady noise still drives
//     it; LOW = time length / W depth, MID = time-wave speed, HIGH = sway / jitter; bursts kick. Mic OFF = no reaction
//     (a slow drift only).
;(function () {
  if (typeof PointCloudGPU === 'undefined') return
  const P = PointCloudGPU.prototype
  const NH = 36   // frames of history kept for the 4D modes

  const hash = (n) => { n |= 0; n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296 }
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v
  function add (d, q, r, g, b) {
    const nr = d[q] + r, ng = d[q + 1] + g, nb = d[q + 2] + b
    d[q] = nr > 255 ? 255 : nr; d[q + 1] = ng > 255 ? 255 : ng; d[q + 2] = nb > 255 ? 255 : nb
  }
  // sized dot: size follows the projected sample spacing -> a closed, clear surface instead of sparse grain
  function dot (d, W, H, x, y, r, g, b, sz) {
    x |= 0; y |= 0
    if (sz < 1.6) {
      if (x < 0 || y < 0 || x >= W || y >= H) return
      add(d, (y * W + x) * 4, r, g, b)
      if (sz >= 1.25) { if (x + 1 < W) add(d, (y * W + x + 1) * 4, r * 0.35, g * 0.35, b * 0.35); if (y + 1 < H) add(d, ((y + 1) * W + x) * 4, r * 0.35, g * 0.35, b * 0.35) }
      return
    }
    // bigger spacing: scatter fine 1px grains inside the cell (never solid blocks)
    const ns = Math.min(9, Math.round(sz * sz * 0.55)), k = 1.25 / Math.sqrt(ns)
    for (let e = 0; e < ns; e++) {
      const xx = (x + (Math.random() - 0.5) * sz) | 0, yy = (y + (Math.random() - 0.5) * sz) | 0
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) add(d, (yy * W + xx) * 4, r * k, g * k, b * k)
    }
  }
  function line (d, W, H, x0, y0, x1, y1, r, g, b) {
    const dx = x1 - x0, dy = y1 - y0
    const n = Math.min(3000, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))))
    if (!(n > 0)) return
    const sx = dx / n, sy = dy / n
    let x = x0, y = y0
    for (let k = 0; k <= n; k++, x += sx, y += sy) {
      const xi = x | 0, yi = y | 0
      if (xi >= 0 && yi >= 0 && xi < W && yi < H) add(d, (yi * W + xi) * 4, r, g, b)
    }
  }
  function mkP (m, W, H) {
    return (X, Y, Z, o) => {
      const cw = m[3] * X + m[7] * Y + m[11] * Z + m[15]
      if (cw <= 0.02) return false
      o.w = cw
      o.x = ((m[0] * X + m[4] * Y + m[8] * Z + m[12]) / cw * 0.5 + 0.5) * W
      o.y = (1 - ((m[1] * X + m[5] * Y + m[9] * Z + m[13]) / cw * 0.5 + 0.5)) * H
      return true
    }
  }
  function hsl (h, s, l) {
    const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)) }
    return [f(0) * 255, f(8) * 255, f(4) * 255]
  }
  // channel colour (opt.pal) -> base colour by nearness; acc = accent for old time / cage
  function palette (pal, t) {
    if (pal === 'blue') return { c: n => [34 + 184 * n, 54 + 172 * n, 180 + 75 * n], acc: [60, 120, 255], old: [40, 60, 200] }
    if (pal === 'white' || pal === 'mono') return { c: n => { const v = 110 + 145 * n; return [v, v, v] }, acc: [255, 255, 255], old: [120, 120, 120] }
    if (pal === 'gray') return { c: n => { const v = 90 + 120 * n; return [v, v, v] }, acc: [200, 200, 200], old: [90, 90, 90] }
    if (pal && (pal === 'random' || pal.indexOf('hue:') === 0)) {
      const hu = pal === 'random' ? (t * 25) % 360 : +pal.slice(4) || 0
      const A = hsl(hu, 0.85, 0.6), O = hsl((hu + 150) % 360, 0.85, 0.5)
      return { c: n => [A[0] * (0.35 + 0.65 * n) + 60 * n, A[1] * (0.35 + 0.65 * n) + 60 * n, A[2] * (0.35 + 0.65 * n) + 60 * n], acc: A, old: O }
    }
    // HVFT heat: near warm white -> far ember; old time = red-orange
    return { c: n => { const q = 1 - n; return [255 - 150 * q, 238 - 222 * Math.sqrt(q), 215 - 207 * Math.sqrt(q)] }, acc: [242, 160, 61], old: [226, 48, 28] }
  }

  // ---------------- CLEAN DEPTH + HISTORY ----------------
  const _push = P.pushFrame
  P.pushFrame = function (f) {
    _push.call(this, f)
    const L = this.live; if (!L || !f) return
    if (f.kinect && this.opt.clean !== false) L.depth = this._clean4(L.depth, L.w, L.h)
    if (this.opt.style === 'hyper4d') this._histPush(L)
    else if (this._hist) this._hist = null
  }
  P._clean4 = function (dep, w, h) {
    const n = w * h
    if (!this._cPrev || this._cPrev.length !== n) { this._cPrev = new Uint16Array(n); this._cHold = new Uint8Array(n); this._cTmp = new Uint16Array(n) }
    const pv = this._cPrev, hd = this._cHold, tmp = this._cTmp
    for (let i = 0; i < n; i++) {   // temporal: hold short holes, smooth static depth, snap on motion
      let z = dep[i]; const p = pv[i]
      if (!z) { if (p && hd[i] < 3) { z = p; hd[i]++ } else hd[i] = 0 }
      else {
        hd[i] = 0
        if (p) { const tol = Math.max(25, p * 0.02), dd = z - p; if (dd < tol && dd > -tol) z = p + dd * 0.35 }
      }
      tmp[i] = z
    }
    pv.set(tmp)
    const out = new Uint16Array(n)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, z = tmp[i]; if (!z) continue
        const thr = Math.max(40, z * 0.03, 8.6e-6 * z * z)   // + 3× the Kinect depth quantisation (grows with z²) -> far walls are not shredded into holes
        const zl = tmp[i - 1], zr = tmp[i + 1], zu = tmp[i - w], zd = tmp[i + w]
        // flying pixel: sits between a near and a far neighbour (mixed edge sample)
        if (zl && zr && ((zl - z > thr && z - zr > thr) || (zr - z > thr && z - zl > thr))) continue
        if (zu && zd && ((zu - z > thr && z - zd > thr) || (zd - z > thr && z - zu > thr))) continue
        let s = z * 2, c = 2
        const nb = [zl, zr, zu, zd, tmp[i - w - 1], tmp[i - w + 1], tmp[i + w - 1], tmp[i + w + 1]]
        for (let k = 0; k < 8; k++) { const q = nb[k]; if (q && q - z < thr && z - q < thr) { s += q; c++ } }
        if (c <= 3) continue   // isolated speckle
        out[i] = s / c
      }
    }
    return out
  }
  P._histPush = function (L) {
    const n = L.w * L.h
    let Hh = this._hist
    if (!Hh || Hh.n !== n) Hh = this._hist = { n, buf: [], idx: -1, cnt: 0 }
    Hh.idx = (Hh.idx + 1) % NH
    if (!Hh.buf[Hh.idx]) Hh.buf[Hh.idx] = new Uint16Array(n)
    Hh.buf[Hh.idx].set(L.depth); Hh.cnt = Math.min(NH, Hh.cnt + 1)
  }
  P._histGet = function (lag) {
    const Hh = this._hist; if (!Hh || !Hh.cnt) return null
    lag = Math.max(0, Math.min(lag | 0, Hh.cnt - 1))
    return Hh.buf[(Hh.idx - lag + NH * 4) % NH]
  }
  const _setAudio = P.setAudio
  P.setAudio = function (bass, onset, mid, high) { _setAudio.call(this, bass, onset); this.mid = mid || 0; this.high = high || 0 }

  // ---------------- 3D STYLE: 4D ----------------
  P._style_hyper4d = function (a) {
    const O = this.opt, d = a.d, W = a.W, H = a.H, L = a.L, w = L.w, h = L.h, t = a.t
    const lo = a.lo, hi = a.hi, span = a.span, far = a.far, cut = a.cut, m = a.m, dep = L.depth
    if (!this._hist || !this._hist.cnt) this._histPush(L)
    const ag = this.aud ? (this.aud.audioOn ? this.aud.audAmt : 0) : 1
    const react = O.react != null ? O.react : 0.7
    const amt = O.h4amt != null ? O.h4amt : 0.6
    const env = [this.bass * ag, (this.mid || 0) * ag, (this.high || 0) * ag], K = (this.onset || 0) * ag
    const S = this._h4 || (this._h4 = { mu: [0.3, 0.3, 0.3], sd: [0.05, 0.05, 0.05], dv: [0, 0, 0], pd: [0, 0, 0], ph: [0, 1.3, 2.1], pv: [0, 0, 0], amp: [0, 0, 0], last: 0, axis: 0, lastAxis: -999, kick: -99, fr: 0, sph: 0, dir: 1 })
    S.fr++
    const dt = clamp(t - (S.last || t - 1 / 60), 0.001, 0.1); S.last = t
    const drive = ag * Math.min(1.5, 0.4 + react)
    const dv = S.dv; let flux = 0
    for (let k = 0; k < 3; k++) {
      S.mu[k] += (env[k] - S.mu[k]) * 0.04
      S.sd[k] += (Math.abs(env[k] - S.mu[k]) - S.sd[k]) * 0.06
      dv[k] = drive > 0 ? clamp((env[k] - S.mu[k]) / Math.max(0.012, S.sd[k] * 1.8), -1, 1) : 0
      flux += Math.max(0, dv[k] - S.pd[k]); S.pd[k] = dv[k]
    }
    const burst = drive > 0 && S.fr - S.kick > 4 && ((K > 0.35) || flux > 0.9)
    if (burst) S.kick = S.fr
    const mode = O.h4mode || 'hyper'
    const PL = palette(O.pal, t)
    const B = this.bounds || { cx: 0, cy: 0, rad: 1 }
    const cx = B.cx, cy = B.cy, cz = (lo + hi) / 2
    const R = clamp(B.rad || 1, 0.4, 3)
    const step = w * h > 160000 ? 2 : 1
    const kpx = Math.hypot(m[0], m[8]) * W * 0.5 * step / L.fx
    const gain = a.gain
    const metric = O.metric != null ? !!O.metric : !O.invZ
    const br = O.bodyRange != null ? O.bodyRange : 0.25, bodyM = 0.35 + br * 2.6
    const pr = mkP(m, W, H), q = { x: 0, y: 0, w: 1 }, q2 = { x: 0, y: 0, w: 1 }
    const fy = O.flipY ? 1 : -1, invZ = !!O.invZ
    const toZ = z => invZ ? (lo + hi - z) : z
    const nearOf = z => { let zn = (z - lo) / span; zn = zn < 0 ? 0 : zn > 1 ? 1 : zn; return 1 - zn }
    const isBody = (z, nr) => metric ? (z - lo) < bodyM : nr > 1 - br
    const aSz = (z, cw, k) => clamp(kpx * z / cw * (k || 1), 1, 4)
    let n = 0
    const lab = []
    const zOf = (D, i) => { const z = D[i] / 1000; if (z <= 0.05 || z > far) return 0; if (nearOf(z) < cut) return 0; return z }

    if (mode === 'echo') {
      // ---------- TIME ECHO ----------
      const NE = clamp(Math.round(3 + amt * 5 + drive * (env[0] + Math.max(0, dv[0])) * 3), 2, 12)
      const gap = clamp(Math.round(2 + (1 - env[1]) * 2 + (1 - amt) * 2), 1, 6)
      const tz = span * 0.09 * (0.5 + amt) * (1 + drive * (env[0] + Math.max(0, dv[0])) * 1.3)
      if (burst && hash(S.fr * 7) > 0.6) S.dir = -S.dir
      const tx = tz * 0.45 * S.dir, ty = tz * 0.18
      const st2 = step * 2
      for (let k = NE; k >= 1; k--) {
        const D = this._histGet(k * gap); if (!D) continue
        const fade = Math.pow(1 - k / (NE + 1), 1.3) * (0.55 + amt * 0.4)
        const mix = k / NE
        const jx = Math.sin(t * 2.1 + k * 1.7) * R * 0.03 * drive * Math.max(0, dv[2]) * 3
        for (let y = 0; y < h; y += st2) {
          for (let x = (k & 1) ? 1 : 0; x < w; x += st2) {
            const i = y * w + x, z = zOf(D, i); if (!z) continue
            const nr = nearOf(z); if (!isBody(z, nr)) continue
            const X = (x - L.cx) / L.fx * z + tx * k + jx, Y = fy * (y - L.cy) / L.fy * z + ty * k, Z = toZ(z) - tz * k   // older = farther from the viewer (camera sits on +Z)
            if (!pr(X, Y, Z, q)) continue
            const c = PL.c(nr), o = PL.old, gk = gain * fade * 0.8
            dot(d, W, H, q.x, q.y, (c[0] + (o[0] - c[0]) * mix) * gk, (c[1] + (o[1] - c[1]) * mix) * gk, (c[2] + (o[2] - c[2]) * mix) * gk, aSz(z, q.w) * 1.4)
            n++
          }
        }
      }
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = y * w + x, z = zOf(dep, i); if (!z) continue
          const nr = nearOf(z), body = isBody(z, nr)
          if (!body && (i & 1)) continue
          if (!pr((x - L.cx) / L.fx * z, fy * (y - L.cy) / L.fy * z, toZ(z), q)) continue
          const c = PL.c(nr), gk = gain * (body ? 0.75 + K * 0.4 : 0.22)
          dot(d, W, H, q.x, q.y, c[0] * gk, c[1] * gk, c[2] * gk, aSz(z, q.w))
          n++
        }
      }
      lab.push('4D / TIME ECHO', 'T-' + (NE * gap) + ' FR / ' + NE + ' ECHOES')
    } else if (mode === 'slice') {
      // ---------- TIME SLICE (slit-scan through time) ----------
      const cnt = this._hist ? this._hist.cnt : 1
      const maxLag = clamp(Math.round(6 + amt * 14 + drive * (env[0] + Math.max(0, dv[0])) * 8), 1, Math.max(1, cnt - 1))
      S.sph += dt * (0.06 + 0.1 * amt + drive * (0.25 * env[1] + 0.5 * Math.max(0, dv[1])))
      if (burst && S.fr - S.lastAxis > 90 && hash(S.fr * 3) > 0.5) { S.axis = (S.axis + 1 + ((hash(S.fr + 7) * 3) | 0)) % 4; S.lastAxis = S.fr }
      const frames = []; for (let l = 0; l <= maxLag; l++) frames.push(this._histGet(l) || dep)
      const ax = S.axis, rmax = Math.hypot(w, h) / 2
      const tri = v => { const f = v - Math.floor(v / 2) * 2; return f < 1 ? f : 2 - f }
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = y * w + x
          let u
          if (ax === 0) u = y / h
          else if (ax === 1) u = x / w
          else if (ax === 2) { const z0 = zOf(dep, i); u = z0 ? 1 - nearOf(z0) : 0 }
          else u = Math.hypot(x - w / 2, y - h / 2) / rmax
          const lf = tri(u * 1.6 + S.sph), lag = Math.round(lf * maxLag)
          const D = frames[lag], z = zOf(D, i); if (!z) continue
          const nr = nearOf(z)
          if (!pr((x - L.cx) / L.fx * z, fy * (y - L.cy) / L.fy * z, toZ(z), q)) continue
          const c = PL.c(nr), o = PL.old, mix = lf * 0.7
          const gk = gain * (0.35 + 0.55 * nr) * (1 - lf * 0.25) * (1 + K * 0.3)
          dot(d, W, H, q.x, q.y, (c[0] + (o[0] - c[0]) * mix) * gk, (c[1] + (o[1] - c[1]) * mix) * gk, (c[2] + (o[2] - c[2]) * mix) * gk, aSz(z, q.w))
          n++
        }
      }
      lab.push('4D / TIME SLICE · ' + ['ROWS', 'COLUMNS', 'DEPTH', 'RINGS'][ax], 'dT 0-' + maxLag + ' FR')
    } else if (mode === 'world') {
      // ---------- WORLDLINE ----------
      const NL = 9, gap = 2
      const tz = span * 0.03 * (0.5 + amt) * (1 + drive * (env[0] + Math.max(0, dv[0])) * 1.5)
      const sw = R * 0.02 * drive * (env[2] + Math.max(0, dv[2]))
      const Ds = []; for (let l = 0; l <= NL; l++) Ds.push(this._histGet(l * gap) || dep)
      for (let y = 0; y < h; y += step) {   // the present: solid body
        for (let x = 0; x < w; x += step) {
          const i = y * w + x, z = zOf(dep, i); if (!z) continue
          const nr = nearOf(z), body = isBody(z, nr)
          if (!body && (i & 1)) continue
          if (!pr((x - L.cx) / L.fx * z, fy * (y - L.cy) / L.fy * z, toZ(z), q)) continue
          const c = PL.c(nr), gk = gain * (body ? 0.55 : 0.18)
          dot(d, W, H, q.x, q.y, c[0] * gk, c[1] * gk, c[2] * gk, aSz(z, q.w))
          n++
        }
      }
      const ls = step * 3
      for (let y = 0; y < h; y += ls) {
        for (let x = (y / ls & 1) ? 1 : 0; x < w; x += ls) {
          const i = y * w + x, z0 = zOf(dep, i); if (!z0) continue
          const nr = nearOf(z0); if (!isBody(z0, nr)) continue
          const zN = zOf(Ds[NL], i), mv = zN ? Math.min(1, Math.abs(z0 - zN) * 3) : 0.6
          const k0 = gain * (0.12 + mv * 0.9 + amt * 0.12)
          if (k0 < 0.05) continue
          let px = 0, py = 0, ok = false
          for (let l = 0; l <= NL; l++) {
            const z = zOf(Ds[l], i); if (!z) break
            const X = (x - L.cx) / L.fx * z + Math.sin(l * 0.8 + t * 3 + i) * sw, Y = fy * (y - L.cy) / L.fy * z, Z = toZ(z) - tz * l
            if (!pr(X, Y, Z, q2)) break
            if (ok) {
              const f2 = k0 * (1 - l / (NL + 1)), c = l < 3 ? PL.c(nr) : PL.old
              line(d, W, H, px, py, q2.x, q2.y, c[0] * f2, c[1] * f2, c[2] * f2)
            }
            px = q2.x; py = q2.y; ok = true
          }
        }
      }
      lab.push('4D / WORLDLINE', 'dT ' + (NL * gap) + ' FR')
    } else {
      // ---------- HYPER ROTATE (XW / YW / ZW + 4D perspective) ----------
      for (let k = 0; k < 3; k++) {
        const lvl = env[k] * 0.6 + Math.max(0, dv[k]) * 0.9
        const ampT = drive > 0 ? clamp(0.14 + amt * (0.3 + 1.1 * drive * lvl), 0, 1.45) : 0.1 + amt * 0.08   // mic off = slow 4D breathing only
        S.amp[k] += (ampT - S.amp[k]) * 0.12
        const spT = 0.25 + k * 0.09 + drive * lvl * 2.4
        S.pv[k] += (spT - S.pv[k]) * 0.1
        if (burst) { S.pv[k] += (0.8 + hash(S.fr * 5 + k) * 2.2) * amt * drive; S.amp[k] = Math.min(1.45, S.amp[k] + 0.25 * amt * drive) }
        S.ph[k] += S.pv[k] * dt
      }
      const a1 = S.amp[0] * Math.sin(S.ph[0]), a2 = S.amp[1] * Math.sin(S.ph[1]), a3 = S.amp[2] * Math.sin(S.ph[2])
      const c1 = Math.cos(a1), s1 = Math.sin(a1), c2 = Math.cos(a2), s2 = Math.sin(a2), c3 = Math.cos(a3), s3 = Math.sin(a3)
      const Dw = R * 2.8, wK = R * (0.5 + amt * 0.9)
      const bc = S.bc || [cx, cy, cz, 0.85], ox = bc[0], oy = bc[1], oz = bc[2], bn = bc[3]   // pivot = body centre (last frame)
      let sbx = 0, sby = 0, sbz = 0, sbn = 0, nbp = 0
      const Dp = this._histGet(5)
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = y * w + x, z = zOf(dep, i); if (!z) continue
          const nr = nearOf(z)
          let vel = 0
          if (Dp) { const zp = Dp[i] / 1000; if (zp > 0.05) vel = Math.min(1, Math.abs(z - zp) * 4) }
          const body = isBody(z, nr)
          if (!body && (i & 1)) continue
          const wv = (nr - bn) * wK + vel * R * 0.8 * (0.4 + amt) + Math.sin(x * 0.05 + y * 0.031 + t * 0.7) * R * 0.06 * amt
          const X0 = (x - L.cx) / L.fx * z, Y0 = fy * (y - L.cy) / L.fy * z, Z0 = toZ(z)
          if (body) { sbx += X0; sby += Y0; sbz += Z0; sbn += nr; nbp++ }
          const X = X0 - ox, Y = Y0 - oy, Z = Z0 - oz
          const x2 = X * c1 - wv * s1, w2 = X * s1 + wv * c1
          const y2 = Y * c2 - w2 * s2, w3 = Y * s2 + w2 * c2
          const z2 = Z * c3 - w3 * s3, w4 = Z * s3 + w3 * c3
          const den = Dw - w4; if (den <= 0.05) continue
          const k4 = clamp(Dw / den, 0.45, 1.9)
          if (!pr(ox + x2 * k4, oy + y2 * k4, oz + z2 * k4, q)) continue
          const c = PL.c(nr), gk = gain * (body ? 0.35 + 0.65 * nr : 0.16) * (0.55 + 0.45 * k4) * (1 + vel * 1.2)
          dot(d, W, H, q.x, q.y, c[0] * gk, c[1] * gk, c[2] * gk, aSz(z, q.w, Math.sqrt(k4)))
          n++
        }
      }
      if (nbp > 50) { const nb = [sbx / nbp, sby / nbp, sbz / nbp, sbn / nbp]; S.bc = S.bc ? S.bc.map((v, k) => v + (nb[k] - v) * 0.2) : nb }
      // TESSERACT cage: same 4D rotation + its own constant spin, so it is always visibly 4D
      if (O.tess !== false) {
        const sc = R * 0.8, b1 = a1 + t * 0.31, b2 = a2 + t * 0.19, b3 = a3 + t * 0.13
        const C1 = Math.cos(b1), S1 = Math.sin(b1), C2 = Math.cos(b2), S2 = Math.sin(b2), C3 = Math.cos(b3), S3 = Math.sin(b3)
        const V = []
        for (let v = 0; v < 16; v++) {
          const X = (v & 1 ? 1 : -1) * sc, Y = (v & 2 ? 1 : -1) * sc, Z = (v & 4 ? 1 : -1) * sc * 0.8, Wv = (v & 8 ? 1 : -1) * sc
          const x2 = X * C1 - Wv * S1, w2 = X * S1 + Wv * C1
          const y2 = Y * C2 - w2 * S2, w3 = Y * S2 + w2 * C2
          const z2 = Z * C3 - w3 * S3, w4 = Z * S3 + w3 * C3
          const k4 = clamp(Dw / Math.max(0.05, Dw * 1.15 - w4), 0.3, 3)
          V.push(pr(ox + x2 * k4, oy + y2 * k4, oz + z2 * k4, q) ? [q.x, q.y, (v & 8) ? 1 : 0] : null)
        }
        const ac = PL.acc, gc = (0.28 + 0.4 * env[0] + 0.5 * K) * (0.6 + amt * 0.6)
        for (let v = 0; v < 16; v++) for (let bit = 1; bit < 16; bit <<= 1) {
          const u = v | bit; if (u === v) continue
          const A = V[v], Bv = V[u]; if (!A || !Bv) continue
          const kk = bit === 8 ? gc * 0.55 : gc * (A[2] ? 0.7 : 1)
          line(d, W, H, A[0], A[1], Bv[0], Bv[1], ac[0] * kk, ac[1] * kk, ac[2] * kk)
        }
      }
      lab.push('4D / HYPER ROTATE', 'XW ' + a1.toFixed(2) + '  YW ' + a2.toFixed(2) + '  ZW ' + a3.toFixed(2))
    }
    a.ctx2d.putImageData(this._ci, 0, 0)
    if (lab.length) {
      const c = a.ctx2d, fs = Math.max(9, Math.round(H / 62))
      c.save(); c.font = fs + "px 'JetBrains Mono', ui-monospace, Menlo, monospace"; c.textBaseline = 'top'
      c.fillStyle = 'rgba(242,160,61,0.85)'; c.fillText(lab[0], fs, fs)
      c.fillStyle = 'rgba(215,222,235,0.6)'; for (let k = 1; k < lab.length; k++) c.fillText(lab[k], fs, fs + k * fs * 1.4)
      c.restore()
    }
    return n
  }
})()
