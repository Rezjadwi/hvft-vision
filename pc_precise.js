// HVFT VISION — pc_precise.js (Oct 7)
// 3D STYLE 'precise' = PRECISE: the Kinect point cloud drawn CLEAR and TIDY (Reza: "lebih jelas dan lebih rapih").
//   GRID       : one point per Kinect pixel on an exact grid — no random scatter, so nothing shimmers frame to frame.
//   Z-BUFFER   : near points hide far ones (no additive blow-out); every dot is a crisp round disc whose size follows
//                the projected grid spacing, so the lattice stays even at any zoom / orbit (opt.preGap: 1 = closed
//                surface, lower = neat dotted lattice).
//   LIGHT      : surface normals from the cleaned depth -> soft studio light (key from top-left + rim) shows the form;
//                far points fade a little for depth (opt.preShade = light amount).
//   OUTLINE    : silhouette / depth-step points drawn brighter (opt.preEdge, default ON).
//   SCAN LINE  : one thin line slowly sweeps the body (opt.preScan, default ON).
//   COLOUR     : channel COLOR palette by nearness, or the Kinect camera picture (opt.preRgb).
//   Density adapts (step 1 → 2 → 3) so the style stays near ~14 ms per frame.
//   Audio (continuous; mic OFF = completely still): LOW = brightness + dot breathing, MID = scan-line speed,
//   HIGH = outline glow.
;(function () {
  if (typeof PointCloudGPU === 'undefined') return
  const P = PointCloudGPU.prototype
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v
  function hsl (h, s, l) {
    const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)) }
    return [f(0) * 255, f(8) * 255, f(4) * 255]
  }
  // near (n = 1) … far (n = 0) colour for the channel COLOR
  function pal (p) {
    if (p === 'blue') return n => [40 + 170 * n, 70 + 160 * n, 170 + 85 * n]
    if (p === 'white' || p === 'mono') return n => { const v = 120 + 135 * n; return [v, v, v + 6] }
    if (p === 'gray') return n => { const v = 95 + 115 * n; return [v, v, v] }
    if (p && (p === 'random' || p.indexOf('hue:') === 0)) {
      const A = hsl(p === 'random' ? 200 : (+p.slice(4) || 0), 0.75, 0.62)
      return n => [A[0] * (0.45 + 0.55 * n) + 40 * n, A[1] * (0.45 + 0.55 * n) + 40 * n, A[2] * (0.45 + 0.55 * n) + 40 * n]
    }
    // HVFT HOLO (Oct 7): far deep ember -> HVFT orange -> amber -> light orange (hologram look from the teal-black far end)
    const ST = [[0, 70, 26, 10], [0.45, 236, 112, 32], [0.78, 255, 182, 92], [1, 255, 226, 184]]
    return n => { let k = 1; while (k < ST.length - 1 && n > ST[k][0]) k++; const a = ST[k - 1], b = ST[k], t = Math.max(0, Math.min(1, (n - a[0]) / (b[0] - a[0]))); return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t] }
  }
  const discs = []   // offsets of a round dot per diameter 1..10
  function disc (s) {
    if (discs[s]) return discs[s]
    const o = [], r = s / 2, c = (s - 1) / 2
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const dx = x - c, dy = y - c; if (dx * dx + dy * dy <= r * r + 0.2) o.push(x - Math.floor(s / 2), y - Math.floor(s / 2)) }
    return (discs[s] = o)
  }
  // light direction in camera space (x right, y down, z away): from top-left, in front
  const LX = -0.45, LY = -0.55, LZ = -0.70, LN = Math.hypot(LX, LY, LZ), lx = LX / LN, ly = LY / LN, lz = LZ / LN

  P._style_precise = function (a) {
    const O = this.opt, d = a.d, W = a.W, H = a.H, L = a.L, w = L.w, h = L.h, m = a.m, dep = L.depth, rgb = L.rgb
    const lo = a.lo, span = a.span, far = a.far, cut = a.cut, t = a.t
    const T0 = performance.now()
    // ---- audio (continuous, smoothed; mic OFF -> ag = 0 -> nothing moves) ----
    const ag = this.aud ? (this.aud.audioOn ? this.aud.audAmt : 0) : 0
    const S = this._pre || (this._pre = { lo: 0, mi: 0, hi: 0, scan: 0.1, last: t, step: 1, ms: 8 })
    const dt = clamp(t - S.last, 0, 0.1); S.last = t
    S.lo += ((this.bass || 0) * ag - S.lo) * 0.35
    S.mi += ((this.mid || 0) * ag - S.mi) * 0.25
    S.hi += ((this.high || 0) * ag - S.hi) * 0.4
    S.scan = (S.scan + dt * (0.08 + S.mi * 0.7) * (ag > 0 ? 1 : 0.5)) % 1.25
    // ---- density: exact grid, step adapts to the frame time ----
    if (S.ms > 16 && S.step < 3) S.step++
    else if (S.ms < 7 && S.step > 1) S.step--
    const step = O.preStep || S.step
    if (!this._pz || this._pz.length !== W * H) this._pz = new Float32Array(W * H)
    const zb = this._pz; zb.fill(1e9)
    // pixels per metre at depth cw (both grid axes, works under orbit)
    const kpx = 0.5 * (Math.hypot(m[0] * W * 0.5, m[1] * H * 0.5) + Math.hypot(m[4] * W * 0.5, m[5] * H * 0.5))
    const gap = clamp(O.preGap != null ? O.preGap : 0.72, 0.3, 1.2) * (1 + S.lo * 0.16)
    const shadeAmt = clamp(O.preShade != null ? O.preShade : 0.75, 0, 1)
    const useRgb = !!(O.preRgb && rgb), C = pal(O.pal)
    const edgeOn = O.preEdge !== false, scanOn = O.preScan !== false
    const bright = 0.86 + S.lo * 0.32, eGlow = 1 + S.hi * 1.2
    const fx = L.fx, fy = L.fy, cx = L.cx, cy = L.cy, fl = !!O.flipY, inv = !!O.invZ, zsum = lo + (a.hi != null ? a.hi : lo + span)
    const scanRow = (S.scan - 0.1) * h, scanW = Math.max(1.5, h * 0.01)
    let cnt = 0
    for (let y = step; y < h - step; y += step) {
      const sr = scanOn ? clamp(1 - Math.abs(y - scanRow) / scanW, 0, 1) : 0
      const row = y * w, Yk = (fl ? (y - cy) : -(y - cy)) / fy
      for (let x = step; x < w - step; x += step) {
        const i = row + x, zr = dep[i]; if (!zr) continue
        const z = zr / 1000; if (z <= 0.05 || z > far) continue
        let zn = (z - lo) / span; zn = zn < 0 ? 0 : zn > 1 ? 1 : zn
        // soft BG CUT: points just behind the cut fade out instead of blinking in/out with the Kinect noise
        const kc = (1 - zn) - cut; if (kc < -0.06) continue
        const fadeCut = kc >= 0 ? 1 : 1 + kc / 0.06
        const near = 1 - zn
        // EDGE: a real depth step to a neighbour, or the end of the surface (a hole 2 cells wide = silhouette,
        // a single missing sample = just a Kinect hole, not an edge). Threshold grows with the Kinect's own
        // depth quantisation (~2.85 mm·m⁻² × z²) so a noisy far wall does not light up as outlines.
        const thr = Math.max(60, zr * 0.05, 8.5 * z * z * 3)
        const st2 = step * 2
        const nE = (o, o2) => { const q = dep[i + o]; if (!q) { const q2 = (i + o2 >= 0 && i + o2 < dep.length) ? dep[i + o2] : 0; return !q2 } return q - zr > thr || zr - q > thr }
        const edge = nE(-step, -st2) || nE(step, st2) || nE(-step * w, -st2 * w) || nE(step * w, st2 * w)
        // NORMAL from a wide baseline (±2 cells, valid same-surface samples only) -> smooth, readable light
        let lam = 0.7, rim = 0
        {
          const bx = Math.min(x, w - 1 - x, st2), by = Math.min(y, h - 1 - y, st2)
          const l = dep[i - bx], r2 = dep[i + bx], u = dep[i - by * w], dn = dep[i + by * w], wt = thr * 2
          const okL = l && Math.abs(l - zr) < wt, okR = r2 && Math.abs(r2 - zr) < wt, okU = u && Math.abs(u - zr) < wt, okD = dn && Math.abs(dn - zr) < wt
          const sx2 = bx * zr / fx, sy2 = by * zr / fy
          const gx = !sx2 ? 0 : okL && okR ? (r2 - l) / (2 * sx2) : okR ? (r2 - zr) / sx2 : okL ? (zr - l) / sx2 : 0
          const gy = !sy2 ? 0 : okU && okD ? (dn - u) / (2 * sy2) : okD ? (dn - zr) / sy2 : okU ? (zr - u) / sy2 : 0
          const nl = Math.sqrt(gx * gx + gy * gy + 1)
          lam = (gx * lx + gy * ly - lz) / nl   // normal toward the camera = (gx, gy, -1)/|n|
          rim = 1 - 1 / nl; rim *= rim
        }
        // far surfaces get flatter light (Kinect depth is coarse there) -> calm, tidy background
        const sA = shadeAmt * (0.2 + 0.8 * near)
        const shade = (1 - sA) + sA * (0.22 + 0.78 * (lam > 0 ? lam : 0) + rim * 0.55)
        const fog = 0.5 + 0.5 * near
        let r, g, b
        if (useRgb) { const c = C(near); r = rgb[i * 3] * 1.15 * 0.8 + c[0] * 0.2; g = rgb[i * 3 + 1] * 1.15 * 0.8 + c[1] * 0.2; b = rgb[i * 3 + 2] * 1.15 * 0.8 + c[2] * 0.2 }
        else { const c = C(near); r = c[0]; g = c[1]; b = c[2] }
        let k = shade * fog * bright * fadeCut
        r *= k; g *= k; b *= k
        if (edgeOn && edge) { const e = 0.55 * eGlow; r = r * (1 - 0.4) + 255 * e * 0.4 + r * 0.25; g = g * 0.6 + 255 * e * 0.4 + g * 0.25; b = b * 0.6 + 255 * e * 0.4 + b * 0.25 }
        if (sr > 0) { const s2 = sr * (0.55 + S.mi * 0.6) * 160; r += s2; g += s2; b += s2 }
        // project
        const X = (x - cx) / fx * z, Y = Yk * z, Z = inv ? (zsum - z) : z
        const cw = m[3] * X + m[7] * Y + m[11] * Z + m[15]
        if (cw <= 0.02) continue
        const sx = ((m[0] * X + m[4] * Y + m[8] * Z + m[12]) / cw * 0.5 + 0.5) * W
        const sy = (1 - ((m[1] * X + m[5] * Y + m[9] * Z + m[13]) / cw * 0.5 + 0.5)) * H
        if (sx < -10 || sy < -10 || sx > W + 10 || sy > H + 10) continue
        const sp = step * z / fx * kpx / cw
        let s = Math.round(sp * gap * (edge && edgeOn ? 1.12 : 1)); s = s < 1 ? 1 : s > 10 ? 10 : s
        r = r > 255 ? 255 : r; g = g > 255 ? 255 : g; b = b > 255 ? 255 : b
        const px = sx | 0, py = sy | 0
        if (s === 1) {
          if (px < 0 || py < 0 || px >= W || py >= H) continue
          const pi = py * W + px; if (cw >= zb[pi]) continue
          zb[pi] = cw; const q = pi * 4; d[q] = r; d[q + 1] = g; d[q + 2] = b
        } else {
          const o = disc(s)
          for (let k2 = 0; k2 < o.length; k2 += 2) {
            const xx = px + o[k2], yy = py + o[k2 + 1]
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
            const pi = yy * W + xx; if (cw >= zb[pi]) continue
            zb[pi] = cw; const q = pi * 4; d[q] = r; d[q + 1] = g; d[q + 2] = b
          }
        }
        cnt++
      }
    }
    a.ctx2d.putImageData(this._ci, 0, 0)
    S.ms = S.ms * 0.85 + (performance.now() - T0) * 0.15
    return cnt
  }
})()
