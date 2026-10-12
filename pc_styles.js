// HVFT VISION — pc_styles.js
// Depth-art render STYLES for the PC-3D cloud (CPU path of PointCloudGPU).
// Works with any depth input (Kinect / LiDAR = metric mm, Depth-AI = relative, invZ).
//   style 'volume'   — VOLUME SCAN : dense layered cloud, blue depth ramp, cyan surface patches,
//                      perspective wireframe box, moving scan plane, floating dust, 3D-anchored HUD labels.
//   style 'spectral' — SPECTRAL    : subject as shimmering white particle body with glowing silhouette,
//                      body evaporates into dust, dim real-colour background points,
//                      teal smoke tendrils (flow field) and a starfield.
// Selected with opt.style (window.HVFT_PC_OPT.style). Flags default ON unless set to false:
//   volBox, volScan, sway, smoke, dust, stars.  opt.bodyRange 0.1..0.9 (spectral subject depth).
;(function () {
  if (typeof PointCloudGPU === 'undefined') return
  const P = PointCloudGPU.prototype

  // ---------- helpers ----------
  const hash = (n) => { n |= 0; n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296 }
  const on = (O, k) => O[k] !== false
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v
  const smooth = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x) }
  const blob = (x, y) => 0.5 + 0.5 * Math.sin(x * 1.7 + Math.sin(y * 1.3) * 1.9) * Math.cos(y * 1.1 + Math.sin(x * 0.7) * 2.3)

  function add (d, q, r, g, b) {
    const nr = d[q] + r, ng = d[q + 1] + g, nb = d[q + 2] + b
    d[q] = nr > 255 ? 255 : nr; d[q + 1] = ng > 255 ? 255 : ng; d[q + 2] = nb > 255 ? 255 : nb
  }
  function splat (d, W, H, x, y, r, g, b, sz) {
    x |= 0; y |= 0
    if (x < 0 || y < 0 || x >= W || y >= H) return
    add(d, (y * W + x) * 4, r, g, b)
    if (sz >= 2) {
      const h = 0.45
      if (x + 1 < W) add(d, (y * W + x + 1) * 4, r * h, g * h, b * h)
      if (y + 1 < H) add(d, ((y + 1) * W + x) * 4, r * h, g * h, b * h)
      if (x + 1 < W && y + 1 < H) add(d, ((y + 1) * W + x + 1) * 4, r * 0.25, g * 0.25, b * 0.25)
    }
    if (sz >= 3) {
      const h = 0.3
      if (x > 0) add(d, (y * W + x - 1) * 4, r * h, g * h, b * h)
      if (y > 0) add(d, ((y - 1) * W + x) * 4, r * h, g * h, b * h)
    }
  }
  // dot size from the projected sample spacing (closes the gaps between samples = clearer surface)
  const aS = v => v > 2.3 ? 3 : v > 1.3 ? 2 : 1
  const aK = s => s >= 3 ? 0.5 : s === 2 ? 0.66 : 1
  // additive anti-alias-free line between float screen points (clipped per pixel)
  function line (d, W, H, x0, y0, x1, y1, r, g, b) {
    const dx = x1 - x0, dy = y1 - y0
    const n = Math.min(4000, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))))
    if (!(n > 0)) return
    const sx = dx / n, sy = dy / n
    let x = x0, y = y0
    for (let k = 0; k <= n; k++, x += sx, y += sy) {
      const xi = x | 0, yi = y | 0
      if (xi >= 0 && yi >= 0 && xi < W && yi < H) add(d, (yi * W + xi) * 4, r, g, b)
    }
  }

  // projector with optional Y-rotation about a pivot (model sway)
  function mkProj (m, W, H, px, pz, ang) {
    const c = Math.cos(ang), s = Math.sin(ang)
    const out = [0, 0, 0]
    const P3 = (X, Y, Z) => {
      const ax = X - px, az = Z - pz
      const Xr = px + ax * c + az * s, Zr = pz - ax * s + az * c
      const cw = m[3] * Xr + m[7] * Y + m[11] * Zr + m[15]
      out[2] = cw
      if (cw <= 0.02) return null
      out[0] = ((m[0] * Xr + m[4] * Y + m[8] * Zr + m[12]) / cw * 0.5 + 0.5) * W
      out[1] = (1 - ((m[1] * Xr + m[5] * Y + m[9] * Zr + m[13]) / cw * 0.5 + 0.5)) * H
      return out
    }
    // 3D segment -> screen line (drops segments behind the camera)
    P3.seg = (d, a, b, r, g, bl) => {
      const A = P3(a[0], a[1], a[2]); if (!A) return
      const ax = A[0], ay = A[1]
      const B = P3(b[0], b[1], b[2]); if (!B) return
      line(d, W, H, ax, ay, B[0], B[1], r, g, bl)
    }
    return P3
  }

  // unified view of one depth sample: metric XYZ + nearness 0(far)..1(near)
  function sampler (self, a) {
    const O = self.opt, L = a.L, lo = a.lo, hi = a.hi, span = a.span
    return (i, x, y, out) => {
      const z = L.depth[i] / 1000
      if (z <= 0.05 || z > a.far) return false
      let zn = (z - lo) / span; zn = zn < 0 ? 0 : zn > 1 ? 1 : zn
      if ((1 - zn) < a.cut) return false
      out.z = z
      out.X = (x - L.cx) / L.fx * z
      out.Y = (O.flipY ? (y - L.cy) : -(y - L.cy)) / L.fy * z
      out.Z = O.invZ ? (lo + hi - z) : z
      out.near = 1 - zn   // depth values are distances for every input (Kinect/LiDAR mm, Depth-AI pseudo-mm)
      return true
    }
  }

  // ======================================================================
  //  VOLUME SCAN
  // ======================================================================
  P._style_volume = function (a) {
    const HP = this.opt.pal === 'hvft'
    const O = this.opt, d = a.d, W = a.W, H = a.H, L = a.L, w = L.w, h = L.h, dep = L.depth, rgb = L.rgb
    const t = a.t, lo = a.lo, hi = a.hi, span = a.span
    const A = this.bass * O.react, K = this.onset * O.react
    const B = this.bounds || { cx: 0, cy: 0 }
    const pz = (lo + hi) / 2
    const ang = O.spin ? 0 : (on(O, 'sway') ? 0.16 + Math.sin(t * 0.17) * 0.16 : 0)
    const P3 = mkProj(a.m, W, H, B.cx, pz, ang)
    const get = sampler(this, a), s = {}
    const step = (w * h > 320000) ? 2 : 1   // Kinect 640x480 FULL = every sample (clearer)
    const kpx = Math.hypot(a.m[0], a.m[8]) * W * 0.5 * step / L.fx   // projected sample spacing -> dot size
    const scanOn = on(O, 'volScan')
    const ph = (t * 0.22) % 1
    const zs = O.invZ ? hi - ph * span : lo + ph * span, zsw = Math.max(0.03, span * 0.035)   // sweeps near -> far
    const realZ = Z => O.invZ ? lo + hi - Z : Z
    const frame = Math.floor(t * 8)
    const g0 = a.gain * 0.9
    let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9, n = 0
    for (let y = 0; y < h; y += step) {
      // horizontal strata + onset slab shift (layered "scan" look)
      const strata = (y % 3 === 1) ? 0.45 : 1
      const slab = K > 0.05 ? (hash(y * 131 + frame * 7919) - 0.5) * K * 0.35 * (hash(y >> 3) > 0.7 ? 1 : 0) : 0
      for (let x = 0; x < w; x += step) {
        const i = y * w + x
        if (!get(i, x, y, s)) continue
        if (strata < 1 && hash(i) > strata) continue
        const X = s.X + slab, Y = s.Y, Z = s.Z
        if (X < bx0) bx0 = X; if (X > bx1) bx1 = X; if (Y < by0) by0 = Y; if (Y > by1) by1 = Y
        const p = P3(X, Y, Z); if (!p) continue
        const nr = s.near
        // blue depth ramp: far deep-blue -> near pale white
        let r, g, b
        if (HP) { r = 110 + (255 - 110) * nr; g = 14 + (238 - 14) * nr * nr; b = 8 + (215 - 8) * nr * nr * nr }   // HVFT: far ember red -> near warm white
        else { r = 34 + (218 - 34) * nr; g = 54 + (226 - 54) * nr; b = 180 + (255 - 180) * nr }
        // cyan surface patches: flat surfaces inside slow noise blobs
        const iz = dep[i], ix = x + 1 < w ? dep[i + 1] : iz, iy = y + 1 < h ? dep[i + w] : iz
        const grad = (Math.abs(ix - iz) + Math.abs(iy - iz)) / Math.max(1, iz)
        const flat = 1 - smooth(0.004, 0.03, grad)
        const patch = flat * smooth(0.6, 0.8, blob(X * 1.3 + t * 0.05, Z * 1.3 - t * 0.03)) * (1 - smooth(0.6, 0.85, nr)) * (0.6 + A * 1.2)
        if (patch > 0.01) { const pc = HP ? [242, 160, 61] : [70, 190, 255]; r += (pc[0] - r) * patch; g += (pc[1] - g) * patch; b += (pc[2] - b) * patch }
        // real colour whisper (keeps texture of the scene)
        if (rgb) { const l = (rgb[i * 3] + rgb[i * 3 + 1] + rgb[i * 3 + 2]) / 765; const k = 0.55 + l * 0.9; r *= k; g *= k; b *= k }
        let gg = g0 * (0.7 + nr * 0.5)
        if (scanOn) { const sc = 1 - Math.abs(Z - zs) / zsw; if (sc > 0) { gg *= 1 + sc * 1.6; r += (255 - r) * sc * 0.6; g += (240 - g) * sc * 0.6 } }
        const vs = Math.max(patch > 0.35 ? 2 : 1, aS(kpx * s.z / p[2])), vk = gg * aK(vs)
        splat(d, W, H, p[0], p[1], r * vk, g * vk, b * vk, vs)
        n++
      }
    }
    // smoothed bounding box
    if (n > 50) {
      const nb = [bx0, bx1, by0, by1, lo, hi], v = this._vbox
      this._vbox = v ? v.map((q, k) => q + (nb[k] - q) * 0.12) : nb
    }
    const V = this._vbox || [-1, 1, -1, 1, lo, hi]
    const ex = (V[1] - V[0]) * 0.16, ey = (V[3] - V[2]) * 0.16, ez = (V[5] - V[4]) * 0.12
    const x0 = V[0] - ex, x1 = V[1] + ex, y0 = V[2] - ey, y1 = V[3] + ey, z0 = V[4] - ez, z1 = V[5] + ez
    // floating dust inside the volume
    if (on(O, 'dust')) {
      if (!this._vdust) { this._vdust = []; for (let k = 0; k < 520; k++) this._vdust.push([hash(k * 3 + 1), hash(k * 3 + 2), hash(k * 3 + 3), hash(k * 7 + 5)]) }
      for (const q of this._vdust) {
        const p = P3(x0 + (x1 - x0) * q[0], y0 + (y1 - y0) * q[1], z0 + (z1 - z0) * q[2]); if (!p) continue
        const tw = 0.35 + 0.65 * Math.max(0, Math.sin(t * (1.3 + q[3] * 2) + q[3] * 40))
        const c = (40 + 110 * tw) * (1 + A)
        if (HP) splat(d, W, H, p[0], p[1], c, c * 0.72, c * 0.45, 1); else splat(d, W, H, p[0], p[1], c * 0.85, c * 0.9, c, 1)
      }
    }
    // wireframe volume + diverging perspective rails + scan section
    const lab = []
    if (on(O, 'volBox')) {
      const cn = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]
      const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
      const gc = 62 + A * 60
      for (const [u, v] of E) { if (HP) P3.seg(d, cn[u], cn[v], gc + 6, gc * 0.8, gc * 0.6); else P3.seg(d, cn[u], cn[v], gc, gc + 2, gc + 8) }
      // rails: back corners through front corners, extended toward the viewer
      for (let k = 0; k < 4; k++) {
        const bq = cn[k + 4], fq = cn[k], ext = [fq[0] + (fq[0] - bq[0]) * 1.6, fq[1] + (fq[1] - bq[1]) * 1.6, fq[2] + (fq[2] - bq[2]) * 1.6]
        if (ext[2] < 0.12) { const tt = (fq[2] - 0.12) / Math.max(1e-3, fq[2] - ext[2]); ext[0] = fq[0] + (ext[0] - fq[0]) * tt; ext[1] = fq[1] + (ext[1] - fq[1]) * tt; ext[2] = 0.12 }
        P3.seg(d, fq, ext, 40, 42, 48)
      }
      // floor grid (depth lanes)
      for (let k = 1; k < 4; k++) { const xx = x0 + (x1 - x0) * k / 4; P3.seg(d, [xx, y0, z0], [xx, y0, z1], 26, 28, 34) }
      if (scanOn) {   // scan section — HVFT orange
        const sz = zs, oc = [242 * 0.55, 160 * 0.55, 61 * 0.55]
        P3.seg(d, [x0, y0, sz], [x1, y0, sz], ...oc); P3.seg(d, [x1, y0, sz], [x1, y1, sz], ...oc)
        P3.seg(d, [x1, y1, sz], [x0, y1, sz], ...oc); P3.seg(d, [x0, y1, sz], [x0, y0, sz], ...oc)
      }
      const la = P3(x0, y1, z0); if (la) lab.push([la[0] + 6, la[1] + 14, 'Z ' + lo.toFixed(2) + 'M'])
      const lb = P3(x1, (y0 + y1) / 2, (z0 + z1) / 2); if (lb) lab.push([lb[0] - 76, lb[1], (n / 1000).toFixed(1) + 'K PTS'])
      const lc = P3(x0, y0 + (y1 - y0) * 0.3, zs); if (scanOn && lc) lab.push([lc[0] + 6, lc[1], 'SCAN ' + realZ(zs).toFixed(2) + 'M'])
      const ld = P3((x0 + x1) / 2, y0, z1); if (ld) lab.push([ld[0] - 30, ld[1] - 8, String(100000 + ((hash(Math.floor(t * 0.5)) * 899999) | 0))])
    }
    a.ctx2d.putImageData(this._ci, 0, 0)
    if (lab.length) {
      const c = a.ctx2d, fs = Math.max(9, Math.round(H / 60))
      c.save(); c.font = fs + "px 'JetBrains Mono', ui-monospace, Menlo, monospace"; c.textBaseline = 'middle'
      for (const [lx, ly, s2] of lab) {
        c.fillStyle = 'rgba(215,222,235,0.78)'; c.fillText(s2, lx, ly)
        c.fillStyle = 'rgba(215,222,235,0.5)'   // barcode ticks
        for (let k = 0; k < 7; k++) if (hash(k + s2.length * 13) > 0.35) c.fillRect(lx + k * 3, ly - fs * 1.5, 1 + (hash(k * 5 + 1) > 0.6 ? 1 : 0), fs * 0.8)
      }
      c.restore()
    }
    return n
  }

  // ======================================================================
  //  SPECTRAL
  // ======================================================================
  P._style_spectral = function (a) {
    const HP = this.opt.pal === 'hvft'
    const O = this.opt, d = a.d, W = a.W, H = a.H, L = a.L, w = L.w, h = L.h, dep = L.depth, rgb = L.rgb
    const t = a.t, lo = a.lo, hi = a.hi, span = a.span
    const A = this.bass * O.react, K = this.onset * O.react
    const B = this.bounds || { cx: 0, cy: 0 }
    const pz = (lo + hi) / 2
    const ang = O.spin ? 0 : (on(O, 'sway') ? Math.sin(t * 0.12) * 0.16 : 0)
    const P3 = mkProj(a.m, W, H, B.cx, pz, ang)
    const get = sampler(this, a), s = {}
    const br = O.bodyRange != null ? O.bodyRange : 0.25
    const metric = O.metric != null ? !!O.metric : !O.invZ
    const bodyM = 0.35 + br * 2.6                // metric: metres behind the nearest point
    const isBody = (z, near) => metric ? (z - lo) < bodyM : near > 1 - br
    const fr = Math.floor(t * 60)
    const jit = 0.004 + K * 0.03 + A * 0.006
    const g0 = a.gain
    const body = []   // sampled subject points (for smoke / evaporation seeding)
    let n = 0, sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9, sz0 = 1e9, sz1 = -1e9
    const step = (w * h > 320000) ? 2 : 1   // Kinect 640x480 FULL = every sample (clearer)
    const kpx = Math.hypot(a.m[0], a.m[8]) * W * 0.5 * step / L.fx   // projected sample spacing -> dot size
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = y * w + x
        if (!get(i, x, y, s)) continue
        const z = s.z
        if (isBody(z, s.near)) {
          // silhouette = depth jump to a neighbour or a non-body neighbour
          const zl = x > step ? dep[i - step] / 1000 : 0, zr = x + step < w ? dep[i + step] / 1000 : 0
          const zu = y > step ? dep[i - w * step] / 1000 : 0, zd = y + step < h ? dep[i + w * step] / 1000 : 0
          const edge = (Math.abs(zl - z) > 0.06 || Math.abs(zr - z) > 0.06 || Math.abs(zu - z) > 0.06 || Math.abs(zd - z) > 0.06) ? 1 : 0
          const hr = hash(i * 7 + fr)
          const jj = hr > 0.9 ? jit * 7 : jit        // a few particles drift off -> soft grainy halo
          const X = s.X + (hash(i * 5 + fr) - 0.5) * jj * 2, Y = s.Y + (hash(i * 13 + fr) - 0.5) * jj * 2, Z = s.Z + (hash(i * 17 + fr) - 0.5) * jj * 3
          if (X < sx0) sx0 = X; if (X > sx1) sx1 = X; if (Y < sy0) sy0 = Y; if (Y > sy1) sy1 = Y; if (s.Z < sz0) sz0 = s.Z; if (s.Z > sz1) sz1 = s.Z
          const p = P3(X, Y, Z); if (!p) continue
          const ss = Math.max(hr > 0.9 ? 2 : 1, aS(kpx * z / p[2]))
          const k = g0 * (0.3 + edge * 0.55 + (hr > 0.985 ? 1.2 : 0)) * (1 + A * 0.5) * aK(ss)
          if (HP) { const o = edge ? 1 : 0; splat(d, W, H, p[0], p[1], 255 * k, (226 - o * 80) * k, (200 - o * 150) * k, ss) }   // warm white body, orange glowing silhouette
          else splat(d, W, H, p[0], p[1], 200 * k, 214 * k, 240 * k, ss)
          if ((i & 15) === 0) body.push(X, Y, Z, edge)
          n++
        } else if (hash(i * 3 + 11) < 0.42) {
          // background: sparse, dim, real colour (like a scanned street at night)
          const p = P3(s.X, s.Y, s.Z); if (!p) continue
          let r = 70, g = 82, b = 104
          if (rgb) { r = rgb[i * 3] * 0.9 + 12; g = rgb[i * 3 + 1] * 0.9 + 14; b = rgb[i * 3 + 2] * 0.9 + 22 }
          const k = g0 * (0.3 + s.near * 0.35)
          splat(d, W, H, p[0], p[1], r * k, g * k, b * k, 1)
          n++
        }
      }
    }
    const haveBody = body.length > 16
    if (haveBody) {
      const nb = [sx0, sx1, sy0, sy1, sz0, sz1], v = this._sbox
      this._sbox = v ? v.map((q, k) => q + (nb[k] - q) * 0.15) : nb
    }
    const SB = this._sbox || [-0.5, 0.5, -1, 0.8, lo, lo + 0.6]
    const bw = Math.max(0.3, SB[1] - SB[0]), bh = Math.max(0.5, SB[3] - SB[2])

    // --- evaporating dust from the body (edges shed particles, beats burst) ---
    if (on(O, 'dust')) {
      const ev = this._evap || (this._evap = [])
      if (haveBody) {
        const emit = 6 + (K * 120 | 0) + (A * 20 | 0)
        for (let k = 0; k < emit && ev.length < 2600; k++) {
          const j = ((hash(fr * 31 + k) * (body.length / 4)) | 0) * 4
          if (!body[j + 3] && hash(fr + k * 3) > 0.25) continue   // mostly from the silhouette
          ev.push([body[j], body[j + 1], body[j + 2], (hash(k + fr) - 0.5) * 0.004, 0.002 + hash(k * 9 + fr) * 0.006, (hash(k * 5 + fr) - 0.5) * 0.004, 1])
        }
      }
      for (let k = ev.length - 1; k >= 0; k--) {
        const q = ev[k]
        q[0] += q[3] + Math.sin(q[1] * 6 + t) * 0.0015; q[1] += q[4] * (1 + A * 2); q[2] += q[5]; q[6] -= 0.012
        if (q[6] <= 0) { ev[k] = ev[ev.length - 1]; ev.pop(); continue }
        const p = P3(q[0], q[1], q[2]); if (!p) continue
        const c = 170 * q[6] * g0
        if (HP) splat(d, W, H, p[0], p[1], c, c * 0.62, c * 0.3, 1); else splat(d, W, H, p[0], p[1], c * 0.85, c * 0.95, c, 1)
      }
    }

    // --- teal smoke tendrils: particles advected through a flow field, drawn as trails ---
    if (on(O, 'smoke')) {
      const SM = this._smoke || (this._smoke = [])
      const N = 520, NE = 7
      const cx = (SB[0] + SB[1]) / 2, cz = (SB[4] + SB[5]) / 2
      // slowly wandering emitters around the subject -> particles leave in wisps, not noise
      const em = []
      for (let e = 0; e < NE; e++) {
        const side = e % 2 ? 1 : -1
        em.push([cx + side * bw * (0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.13 + e * 2.1))),
          SB[2] + bh * (0.1 + 0.8 * (0.5 + 0.5 * Math.sin(t * 0.09 + e * 1.3))),
          cz + (Math.sin(t * 0.11 + e * 3.7)) * Math.max(0.4, span * 0.35)])
      }
      const spawn = (q, k) => {
        const E = em[(hash(k * 3 + fr) * NE) | 0], sp0 = 0.22
        q.length = 0
        q.push(E[0] + (hash(k + fr * 5) - 0.5) * sp0, E[1] + (hash(k * 7 + fr) - 0.5) * sp0, E[2] + (hash(k * 11 + fr) - 0.5) * sp0, 0, 90 + (hash(k * 13 + fr) * 170 | 0), [], hash(k * 17 + fr) * 6.28)
      }
      while (SM.length < N) { const q = []; spawn(q, SM.length); q[3] = (hash(SM.length) * q[4]) | 0; SM.push(q) }
      const sp = 0.007 * (1 + A * 2.2)
      const tc = HP ? [236, 84, 30] : [46, 200, 172]   // HVFT: red-orange smoke instead of teal
      for (let k = 0; k < SM.length; k++) {
        const q = SM[k]
        const x = q[0], y = q[1], z = q[2]
        const ph = q[6] || 0   // per-particle phase -> neighbours diverge into curls
        const vx = Math.sin(0.9 * y + t * 0.35 + ph) + 0.6 * Math.cos(1.3 * z - t * 0.25) + 0.5 * Math.sin(3.1 * y + ph * 2)
        const vy = 0.55 * Math.sin(1.1 * z + 0.7 * x + t * 0.3) + 0.35 + 0.3 * Math.cos(2.7 * x + ph)
        const vz = Math.cos(1.0 * x - t * 0.2 + ph) + 0.5 * Math.sin(0.8 * y + t * 0.4)
        const tr = q[5]
        tr.push(x, y, z); if (tr.length > 48) tr.splice(0, 3)
        q[0] = x + vx * sp; q[1] = y + vy * sp; q[2] = z + vz * sp * 0.6
        q[3]++
        if (q[3] > q[4]) { spawn(q, k + fr); continue }
        const life = q[3] / q[4], fade = Math.sin(Math.PI * life) * 0.3 * g0 * (1 + A * 1.4)
        for (let j = 3; j < tr.length; j += 3) {
          const f2 = fade * (j / tr.length)
          P3.seg(d, [tr[j - 3], tr[j - 2], tr[j - 1]], [tr[j], tr[j + 1], tr[j + 2]], tc[0] * f2, tc[1] * f2, tc[2] * f2)
        }
      }
    }

    // --- starfield behind everything ---
    if (on(O, 'stars')) {
      if (!this._stars) { this._stars = []; for (let k = 0; k < 650; k++) this._stars.push([hash(k * 5 + 1) * 2 - 1, hash(k * 5 + 2) * 2 - 1, hash(k * 5 + 3), hash(k * 5 + 4)]) }
      const R = Math.max(3, span * 2.5)
      for (const q of this._stars) {
        const p = P3(B.cx + q[0] * R * 1.6, B.cy + q[1] * R, O.invZ ? lo - 0.5 - q[2] * R : hi + 0.5 + q[2] * R); if (!p) continue
        const tw = 0.4 + 0.6 * Math.max(0, Math.sin(t * (0.6 + q[3] * 1.8) + q[3] * 50))
        const c = (q[3] > 0.93 ? 230 : 110) * tw
        if (HP && q[3] > 0.93) splat(d, W, H, p[0], p[1], c, c * 0.66, c * 0.25, q[3] > 0.97 ? 2 : 1)
        else splat(d, W, H, p[0], p[1], c * 0.8, c * 0.95, c * 0.92, q[3] > 0.97 ? 2 : 1)
      }
    }
    a.ctx2d.putImageData(this._ci, 0, 0)
    return n
  }
})()
