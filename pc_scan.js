// HVFT VISION — pc_scan.js
// 3D STYLE 'scan' = LIDAR SCAN look made from the Kinect (refs: ghost scans of rooms / caves).
//   ROOM MEMORY : the Kinect is static, so the room is remembered per pixel (stable depth, slowly re-learnt). The room
//                 stays visible even behind you and in Kinect shadows, drawn as fine dust; edges (depth + colour) glow.
//   GHOSTS      : anything in front of the room memory = a bright particle ghost with a glowing silhouette; particles
//                 spray off the body and settle on the floor. (Someone in frame at start is learnt as room until they
//                 move away — or step out and press RESET ROOM.)
//   LONG EXPOSURE: every frame scatters new sub-pixel points into a fading buffer -> dense fine grain, no blocks.
//   ATMOSPHERE  : drifting dust clouds + soft bokeh spheres. A slow camera drift shows the depth.
//   opt.scanLook 'room' | 'cave' | 'hvft' | 'mono'; opt.scanTrail 0..0.92; opt.scanRoom 0..1.5; opt.scanReset (token)
//   opt.scanDetail 0..1: grains per projected pixel (budget 60k..320k samples/frame, and the density also adapts so
//   the style stays near opt.scanMs = 18 ms per frame on this machine). Every grain is a
//   sub-pixel sample (bilinear depth on the same surface) lit by the levelled camera picture + local contrast +
//   grazing-angle rim, so texture (faces, folds, wood, stone) shows up — 640x480 FULL gives the most detail.
//   flags (default ON): scanAtmo, bokeh, spray, sway.
//   Audio (continuous, noise-normalised; mic OFF = no reaction): LOW = ghost glow + jitter, MID = dust drift + room
//   shimmer, HIGH = spray + bokeh flicker; bursts send a scan plane through the room.
;(function () {
  if (typeof PointCloudGPU === 'undefined') return
  const P = PointCloudGPU.prototype
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v
  const blob = (x, y) => 0.5 + 0.5 * Math.sin(x * 1.7 + Math.sin(y * 1.3) * 1.9) * Math.cos(y * 1.1 + Math.sin(x * 0.7) * 2.3)
  const LOOKS = {
    room: { room: [120, 112, 100], edge: [235, 220, 196], rgbMix: 0.5, body: [214, 214, 236], bodyEdge: [255, 255, 255], atmo: [70, 200, 180], bokeh: [[90, 210, 192], [45, 60, 70]] },
    cave: { room: [30, 105, 100], edge: [120, 236, 214], rgbMix: 0, body: [175, 245, 228], bodyEdge: [235, 255, 250], atmo: [70, 200, 185], bokeh: [[95, 225, 205], [30, 70, 70]] },
    hvft: { room: [110, 34, 16], edge: [242, 160, 61], rgbMix: 0, body: [255, 232, 210], bodyEdge: [255, 250, 240], atmo: [226, 90, 30], bokeh: [[242, 160, 61], [70, 30, 20]] },
    mono: { room: [95, 95, 95], edge: [230, 230, 230], rgbMix: 0, body: [228, 228, 234], bodyEdge: [255, 255, 255], atmo: [160, 160, 160], bokeh: [[205, 205, 205], [60, 60, 60]] }
  }

  P._style_scan = function (a) {
    const O = this.opt, d = a.d, W = a.W, H = a.H, L = a.L, w = L.w, h = L.h, t = a.t
    const lo = a.lo, hi = a.hi, span = a.span, far = a.far, m = a.m, dep = L.depth, rgb = L.rgb
    const LK = LOOKS[O.scanLook] || LOOKS.room
    const T0 = performance.now()
    // ---- audio ----
    const ag = this.aud ? (this.aud.audioOn ? this.aud.audAmt : 0) : 1
    const react = O.react != null ? O.react : 0.7, drive = ag * Math.min(1.5, 0.4 + react)
    const env = [this.bass * ag, (this.mid || 0) * ag, (this.high || 0) * ag], K = (this.onset || 0) * ag
    const S = this._sc || (this._sc = { mu: [0.3, 0.3, 0.3], sd: [0.05, 0.05, 0.05], dv: [0, 0, 0], pd: [0, 0, 0], fr: 0, kick: -99, pulse: -1, sp: [], bc: null, floor: null, last: t })
    S.fr++
    const dt = clamp(t - S.last, 0.001, 0.1); S.last = t
    let flux = 0
    for (let k = 0; k < 3; k++) {
      S.mu[k] += (env[k] - S.mu[k]) * 0.04
      S.sd[k] += (Math.abs(env[k] - S.mu[k]) - S.sd[k]) * 0.06
      S.dv[k] = drive > 0 ? clamp((env[k] - S.mu[k]) / Math.max(0.012, S.sd[k] * 1.8), -1, 1) : 0
      flux += Math.max(0, S.dv[k] - S.pd[k]); S.pd[k] = S.dv[k]
    }
    const lv = k => clamp(env[k] * 0.6 + Math.max(0, S.dv[k]) * 0.8, 0, 1.5) * drive
    const A0 = lv(0), A1 = lv(1), A2 = lv(2)
    const burst = drive > 0 && S.fr - S.kick > 5 && (K > 0.35 || flux > 0.9)
    if (burst) { S.kick = S.fr; if (S.pulse < 0) S.pulse = 0 }
    // ---- long-exposure buffer ----
    const NP = W * H * 3
    if (!this._sacc || this._sacc.length !== NP) this._sacc = new Float32Array(NP)
    const acc = this._sacc, decay = clamp(O.scanTrail != null ? O.scanTrail : 0.6, 0, 0.92), ink = 1 - decay
    // ---- room memory ----
    const n = w * h
    if (!this._sbg || this._sbg.length !== n || (O.scanReset && O.scanReset !== this._sResetSeen)) { this._sbg = new Float32Array(n); this._sResetSeen = O.scanReset; S.sp.length = 0 }
    const bg = this._sbg
    for (let i = 0; i < n; i++) {
      const z = dep[i] / 1000; if (z <= 0.05 || z > far) continue
      const b = bg[i]; if (!b) { bg[i] = z; continue }
      const dz = z - b
      if (dz > -0.06 && dz < 0.06) bg[i] = b + dz * 0.08
      else if (dz > 0) bg[i] = b + dz * 0.04   // something that stood there moved away -> slowly learn the farther room
    }
    // ---- view: slow drift around the subject ----
    const B = this.bounds || { cx: 0, cy: 0, rad: 1 }
    const R = clamp(B.rad || 1, 0.5, 3)
    const pv = S.bc || [B.cx, B.cy, (lo + hi) / 2]
    const ang = O.spin ? 0 : (O.sway !== false ? Math.sin(t * 0.08) * 0.2 + Math.sin(t * 0.031) * 0.08 : 0)
    const ca = Math.cos(ang), sa = Math.sin(ang), px = pv[0], pz = pv[2]
    const fy = O.flipY ? 1 : -1, invZ = !!O.invZ
    const toZ = z => invZ ? (lo + hi - z) : z
    let PX = 0, PY = 0, PW = 1
    // view matrix x drift rotation x screen transform folded into three rows: sx = Ax.P / cw, sy = Ay.P / cw, cw = Aw.P
    const tX = px - px * ca - pz * sa, tZ = pz + px * sa - pz * ca, hW = W * 0.5, hH = H * 0.5, M = this._sM || (this._sM = new Float64Array(16))
    for (let j = 0; j < 4; j++) { M[j] = m[j] * ca - m[8 + j] * sa; M[4 + j] = m[4 + j]; M[8 + j] = m[j] * sa + m[8 + j] * ca; M[12 + j] = m[j] * tX + m[8 + j] * tZ + m[12 + j] }
    const ax0 = (M[0] + M[3]) * hW, ax1 = (M[4] + M[7]) * hW, ax2 = (M[8] + M[11]) * hW, ax3 = (M[12] + M[15]) * hW
    const ay0 = (M[3] - M[1]) * hH, ay1 = (M[7] - M[5]) * hH, ay2 = (M[11] - M[9]) * hH, ay3 = (M[15] - M[13]) * hH
    const aw0 = M[3], aw1 = M[7], aw2 = M[11], aw3 = M[15]
    const proj = (X, Y, Z) => {
      const cw = aw0 * X + aw1 * Y + aw2 * Z + aw3; if (cw <= 0.02) return false
      const iw = 1 / cw; PW = cw; PX = (ax0 * X + ax1 * Y + ax2 * Z + ax3) * iw; PY = (ay0 * X + ay1 * Y + ay2 * Z + ay3) * iw
      return true
    }
    const put = (r, g, b) => { const x = PX | 0, y = PY | 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const q = (y * W + x) * 3; acc[q] += r; acc[q + 1] += g; acc[q + 2] += b }
    let rs = (S.fr * 2654435761 + 12345) >>> 0
    const rnd = () => (rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296
    const nearOf = z => { let zn = (z - lo) / span; zn = zn < 0 ? 0 : zn > 1 ? 1 : zn; return 1 - zn }
    const gain = a.gain * ink * 2.2   // steady-state brightness does not depend on the trail length
    const roomAmt = O.scanRoom != null ? O.scanRoom : 1
    let pz0 = -1
    if (S.pulse >= 0) { S.pulse += dt / 0.8; if (S.pulse > 1) S.pulse = -1; else pz0 = lo + S.pulse * span }
    let cnt = 0
    // ---- GPU path (pc_scan_gl.js, WebGL2): ~0.3–2 M grains + bloom. The CPU path below is the fallback. ----
    if (O.scanGPU !== false && typeof this._scanGL === 'function') {
      let ng = 0
      try { ng = this._scanGL({ a, O, LK, W, H, L, w, h, t, dt, lo, hi, span, far, dep, rgb, bg, M, fy, invZ, A0, A1, A2, K, S, pz0, decay, roomAmt, detail: clamp(O.scanDetail != null ? O.scanDetail : 0.6, 0, 1), pv, R, rnd }) } catch (e) { console.warn('[pc_scan] GPU path failed, using CPU:', e && e.message); this._sg = false }
      if (ng > 0) return ng
    }
    // ---- DETAIL MAPS (depth resolution): auto-levelled luminance, local contrast (texture), grazing-angle rim ----
    const detail = clamp(O.scanDetail != null ? O.scanDetail : 0.6, 0, 1)
    if (!this._sLum || this._sLum.length !== n) { this._sLum = new Float32Array(n); this._sHp = new Float32Array(n); this._sRb = new Float32Array(n); this._sRd = new Float32Array(n) }
    const LUM = this._sLum, HP = this._sHp, RB = this._sRb, RD = this._sRd
    if (rgb) { for (let i = 0, q = 0; i < n; i++, q += 3) LUM[i] = (rgb[q] * 0.3 + rgb[q + 1] * 0.59 + rgb[q + 2] * 0.11) / 255 } else LUM.fill(0.5)
    let ls = 0, ls2 = 0, lc = 0
    for (let i = 0; i < n; i += 7) { ls += LUM[i]; ls2 += LUM[i] * LUM[i]; lc++ }
    const lmu = ls / lc, lsd = Math.sqrt(Math.max(4e-4, ls2 / lc - lmu * lmu))
    const lb = 0.2 / lsd, la = 0.5 - lmu * lb   // levelled luminance = la + lb * L  (mean 0.5, sd 0.2) -> dark stages keep detail
    const fx2 = 2 / L.fx
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        HP[i] = (LUM[i] - (LUM[i - 1] + LUM[i + 1] + LUM[i - w] + LUM[i + w] + LUM[i - w - 1] + LUM[i - w + 1] + LUM[i + w - 1] + LUM[i + w + 1]) * 0.125) * lb
        const b = bg[i]
        if (b) {
          const bl2 = bg[i - 1], br2 = bg[i + 1], bu = bg[i - w], bd = bg[i + w]
          const gx = (bl2 && br2) ? br2 - bl2 : 0, gy = (bu && bd) ? bd - bu : 0, sp = b * fx2, s2 = (gx * gx + gy * gy) / (sp * sp)
          RB[i] = s2 > 300 ? 0 : 1 - 1 / Math.sqrt(1 + s2)   // surfaces seen at a grazing angle glow (folds, walls, furniture sides)
        } else RB[i] = 0
        const z = dep[i]
        if (z) {
          const zl = dep[i - 1], zr = dep[i + 1], zu = dep[i - w], zd = dep[i + w]
          const gx = (zl && zr) ? (zr - zl) / 1000 : 0, gy = (zu && zd) ? (zd - zu) / 1000 : 0, sp = z / 1000 * fx2, s2 = (gx * gx + gy * gy) / (sp * sp)
          RD[i] = (!zl || !zr || !zu || !zd || s2 > 300) ? 1 : 1 - 1 / Math.sqrt(1 + s2)
        } else RD[i] = 0
      }
    }
    // sample budget: the density follows the projected pixel size, and adapts so a frame stays inside the budget
    const budget = 60000 + detail * 260000
    const dsc = S.dsc || (S.dsc = 1)
    const dens = (0.3 + detail * 1.2) * dsc
    const kpx0 = Math.hypot(m[0], m[8]) * W * 0.5 / L.fx
    const nsOf = (z, mul) => { const sp = kpx0 * z / PW, e = sp * sp * dens * mul; return e < 1 ? (rnd() < e ? 1 : 0) : Math.min(14, Math.round(e)) }
    // ---- ROOM ----
    const ifx = 1 / L.fx, ify = 1 / L.fy, lohi = lo + hi, RI = 2.3283064365386963e-10
    let sd = (S.fr * 7919 + 17) | 0   // local RNG for the hot loops (not captured by a closure -> fast)
    if (roomAmt > 0) {
      const rgbK = rgb ? LK.rgbMix : 0
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x, b = bg[i]; if (!b) continue
          const g1 = Math.abs(bg[i + 1] - b) + Math.abs(bg[i - 1] - b) + Math.abs(bg[i + w] - b) + Math.abs(bg[i - w] - b)
          const edge = clamp((g1 / b - 0.012) * 9, 0, 1)
          if (!proj((x - L.cx) * ifx * b, fy * (y - L.cy) * ify * b, invZ ? lohi - b : b)) continue
          const ns = nsOf(b, 1); if (!ns) continue
          const nr = nearOf(b), hp = HP[i] > 0 ? HP[i] : 0
          const glow = clamp(edge * 0.8 + RB[i] * 0.7 + hp * 2.5, 0, 1)
          let k = gain * roomAmt * (0.2 + 0.85 * glow) * (0.45 + 0.55 * nr) * (0.85 + A0 * 0.4) / Math.max(1, ns * 0.55)
          if (pz0 > 0) { const s = 1 - Math.abs(b - pz0) / 0.12; if (s > 0) k *= 1 + s * 4 }
          let r = LK.room[0] + (LK.edge[0] - LK.room[0]) * glow, g = LK.room[1] + (LK.edge[1] - LK.room[1]) * glow, bl = LK.room[2] + (LK.edge[2] - LK.room[2]) * glow
          if (rgbK) {   // the real colour, half desaturated, keeps the room recognisable
            const q = i * 3, gr = (rgb[q] + rgb[q + 1] + rgb[q + 2]) / 3
            r = r * (1 - rgbK) + (rgb[q] + gr) * 0.75 * rgbK; g = g * (1 - rgbK) + (rgb[q + 1] + gr) * 0.75 * rgbK; bl = bl * (1 - rgbK) + (rgb[q + 2] + gr) * 0.75 * rgbK
          }
          const tl = b * 0.04
          for (let s = 0; s < ns; s++) {
            sd = (Math.imul(sd, 1664525) + 1013904223) | 0; const u = (sd >>> 0) * RI - 0.5
            sd = (Math.imul(sd, 1664525) + 1013904223) | 0; const v = (sd >>> 0) * RI - 0.5
            const di = u < 0 ? -1 : 1, dj = v < 0 ? -w : w, fu = u < 0 ? -u : u, fv = v < 0 ? -v : v, gu = 1 - fu, gv = 1 - fv
            const z1 = bg[i + di], z2 = bg[i + dj], z3 = bg[i + di + dj]
            let zz = b   // bilinear depth inside the same surface -> smooth continuous grain instead of terraces
            if (z1 && z2 && z3 && z1 - b < tl && b - z1 < tl && z2 - b < tl && b - z2 < tl && z3 - b < tl && b - z3 < tl) zz = (b * gu + z1 * fu) * gv + (z2 * gu + z3 * fu) * fv
            const sl = (LUM[i] * gu + LUM[i + di] * fu) * gv + (LUM[i + dj] * gu + LUM[i + di + dj] * fu) * fv
            const X = (x + u - L.cx) * ifx * zz, Y = fy * (y + v - L.cy) * ify * zz, Z = invZ ? lohi - zz : zz
            const cw = aw0 * X + aw1 * Y + aw2 * Z + aw3; if (cw <= 0.02) continue
            const iw = 1 / cw, sx = (ax0 * X + ax1 * Y + ax2 * Z + ax3) * iw, sy = (ay0 * X + ay1 * Y + ay2 * Z + ay3) * iw
            if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue
            let kk = (0.25 + (la + lb * sl) * 1.3) * k   // texture: the camera picture modulates every grain
            if (kk < 0.12 * k) kk = 0.12 * k
            const o = ((sy | 0) * W + (sx | 0)) * 3
            acc[o] += r * kk; acc[o + 1] += g * kk; acc[o + 2] += bl * kk; cnt++
          }
        }
      }
    }
    // ---- GHOSTS ----
    const seeds = []
    let sx = 0, sy = 0, sz = 0, nb = 0, flo = -1e9
    const jr = 0.002 + A0 * 0.012 + K * 0.03, jr2 = jr * 2
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, zm = dep[i], z = zm / 1000
        if (z <= 0.05 || z > far) continue
        const b = bg[i]
        if (!(b && b - z > 0.15)) continue   // ghost = in front of the remembered room (step out + RESET ROOM to re-learn)
        const zl = dep[i - 1], zr = dep[i + 1], zu = dep[i - w], zd = dep[i + w], th = 80
        const edge = (!zl || !zr || !zu || !zd || Math.abs(zl - zm) > th || Math.abs(zr - zm) > th || Math.abs(zu - zm) > th || Math.abs(zd - zm) > th) ? 1 : 0
        const X0 = (x - L.cx) * ifx * z, Y0 = fy * (y - L.cy) * ify * z, Z0 = invZ ? lohi - z : z
        sx += X0; sy += Y0; sz += Z0; nb++
        if (Y0 * fy > flo) flo = Y0 * fy
        if (edge && (nb & 7) === 0) seeds.push(X0, Y0, Z0)
        if (!proj(X0, Y0, Z0)) continue
        const ns = nsOf(z, 1.4); if (!ns) continue
        const hp = HP[i] > 0 ? HP[i] : -HP[i] * 0.4
        const glow = clamp(RD[i] * 0.85 + hp * 2.2, 0, 1)   // silhouette + folds + face/clothes texture
        const col = glow > 0.6 ? LK.bodyEdge : LK.body, c0 = col[0], c1 = col[1], c2 = col[2]
        const k = gain * (0.16 + glow * 1.1 + A0 * 0.3 + K * 0.3) * (0.6 + 0.4 * nearOf(z)) / Math.max(1, ns * 0.5)
        const tl = zm * 0.04
        for (let s = 0; s < ns; s++) {
          sd = (Math.imul(sd, 1664525) + 1013904223) | 0; const halo = (sd >>> 0) * RI > 0.96 ? 7 : 1
          sd = (Math.imul(sd, 1664525) + 1013904223) | 0; const u = (sd >>> 0) * RI - 0.5
          sd = (Math.imul(sd, 1664525) + 1013904223) | 0; const v = (sd >>> 0) * RI - 0.5
          sd = (Math.imul(sd, 1664525) + 1013904223) | 0; const ja = ((sd >>> 0) * RI - 0.5) * jr2 * halo
          sd = (Math.imul(sd, 1664525) + 1013904223) | 0; const jb = ((sd >>> 0) * RI - 0.5) * jr2 * halo
          sd = (Math.imul(sd, 1664525) + 1013904223) | 0; const jc = ((sd >>> 0) * RI - 0.5) * jr2 * halo
          const di = u < 0 ? -1 : 1, dj = v < 0 ? -w : w, fu = u < 0 ? -u : u, fv = v < 0 ? -v : v, gu = 1 - fu, gv = 1 - fv
          const z1 = dep[i + di], z2 = dep[i + dj], z3 = dep[i + di + dj]
          let zz = z
          if (z1 && z2 && z3 && z1 - zm < tl && zm - z1 < tl && z2 - zm < tl && zm - z2 < tl && z3 - zm < tl && zm - z3 < tl) zz = ((zm * gu + z1 * fu) * gv + (z2 * gu + z3 * fu) * fv) / 1000
          const sl = (LUM[i] * gu + LUM[i + di] * fu) * gv + (LUM[i + dj] * gu + LUM[i + di + dj] * fu) * fv
          const X = (x + u - L.cx) * ifx * zz + ja, Y = fy * (y + v - L.cy) * ify * zz + jb, Z = (invZ ? lohi - zz : zz) + jc
          const cw = aw0 * X + aw1 * Y + aw2 * Z + aw3; if (cw <= 0.02) continue
          const iw = 1 / cw, px2 = (ax0 * X + ax1 * Y + ax2 * Z + ax3) * iw, py2 = (ay0 * X + ay1 * Y + ay2 * Z + ay3) * iw
          if (px2 < 0 || py2 < 0 || px2 >= W || py2 >= H) continue
          let kk = (halo > 1 ? k * 0.45 : k) * (0.35 + (la + lb * sl) * 1.1)
          if (kk < 0) kk = 0
          const o = ((py2 | 0) * W + (px2 | 0)) * 3
          acc[o] += c0 * kk; acc[o + 1] += c1 * kk; acc[o + 2] += c2 * kk; cnt++
        }
      }
    }
    if (nb > 50) {
      const c = [sx / nb, sy / nb, sz / nb]
      S.bc = S.bc ? S.bc.map((v, k) => v + (c[k] - v) * 0.1) : c
      S.floor = S.floor == null ? flo : S.floor + (flo - S.floor) * 0.05
    }
    // ---- SPRAY: particles shed from the silhouette, falling and settling on the floor ----
    if (O.spray !== false) {
      const sp = S.sp
      if (seeds.length) {
        const emit = Math.round(4 + A2 * 28 + K * 70)
        for (let e = 0; e < emit && sp.length < 2600; e++) {
          const j = ((rnd() * seeds.length / 3) | 0) * 3
          sp.push([seeds[j], seeds[j + 1], seeds[j + 2], (rnd() - 0.5) * 0.012, -fy * rnd() * 0.004, (rnd() - 0.5) * 0.012, 1])
        }
      }
      const gv = 0.0007 * fy, fl = S.floor != null ? S.floor : 1e9, sk = gain * 0.55
      for (let k = sp.length - 1; k >= 0; k--) {
        const q = sp[k]
        q[0] += q[3]; q[1] += q[4]; q[2] += q[5]; q[4] += gv
        if (q[1] * fy > fl) { q[1] = fl * fy; q[4] *= -0.2; q[3] *= 0.85; q[5] *= 0.85 }
        q[6] -= 0.007 + A2 * 0.004
        if (q[6] <= 0) { sp[k] = sp[sp.length - 1]; sp.pop(); continue }
        if (!proj(q[0], q[1], q[2])) continue
        const f = sk * q[6]
        put(LK.body[0] * f, LK.body[1] * f, LK.body[2] * f)
      }
    }
    // ---- ATMOSPHERE: drifting dust clouds ----
    const R2 = Math.min(R, 1.6), bx0 = pv[0] - R2 * 2, bxw = R2 * 4, by0 = pv[1] - R2 * 1.1, byh = R2 * 2.2
    const z0 = Math.max(0.3, lo - 0.3), zw = (hi + 0.6) - z0
    if (O.scanAtmo !== false) {
      if (!this._satm) {
        const A = []; let s = 99991
        const r2 = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
        while (A.length < 7000 * 4) { const u = r2(), v = r2(), ww = r2(); if (blob(u * 6, ww * 6 + v * 2) * (0.35 + 0.65 * (1 - v)) > 0.5) A.push(u, v, ww, r2()) }
        this._satm = A
      }
      S.drift = (S.drift || 0) + dt * 0.008 * (1 + A1 * 4)
      const At = this._satm, drift = S.drift, ak = gain * 0.55
      for (let k = 0; k < At.length; k += 4) {
        const u = (At[k] + drift + At[k + 3] * 0.02) % 1
        const z = z0 + At[k + 2] * zw
        if (!proj(bx0 + u * bxw, by0 + (fy > 0 ? At[k + 1] : 1 - At[k + 1]) * byh, toZ(z))) continue
        const f = ak * (0.45 + 0.55 * Math.sin(t * 1.3 + At[k + 3] * 40)) * (1 + A1 * 0.6)
        if (f > 0) put(LK.atmo[0] * f, LK.atmo[1] * f, LK.atmo[2] * f)
      }
    }
    // ---- BOKEH spheres ----
    if (O.bokeh !== false) {
      if (!this._sbok) { const A = []; let s = 7771; const r2 = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; for (let k = 0; k < 40; k++) A.push([r2(), r2(), r2(), 0.02 + r2() * r2() * 0.07, r2() < 0.2, r2() * 6.28]); this._sbok = A }
      const ppm = Math.abs(m[5]) * H * 0.5
      for (const q of this._sbok) {
        const z = z0 + q[2] * zw
        if (!proj(bx0 + q[0] * bxw, by0 + q[1] * byh, toZ(z))) continue
        const rp = clamp(q[3] * ppm / PW, 1.2, 13), c = q[4] ? LK.bokeh[1] : LK.bokeh[0]
        const fl = clamp(0.55 + 0.45 * Math.sin(t * (0.4 + q[3] * 30) + q[5]) + A2 * 0.7 * Math.max(0, Math.sin(t * 9 + q[5] * 3)), 0, 1.6)
        const kb = gain * 0.7 * fl, cx = PX, cy = PY, ri = Math.ceil(rp)
        for (let dy = -ri; dy <= ri; dy++) {
          const yy = (cy + dy) | 0; if (yy < 0 || yy >= H) continue
          for (let dx = -ri; dx <= ri; dx++) {
            const dd = (dx * dx + dy * dy) / (rp * rp); if (dd > 1) continue
            const xx = (cx + dx) | 0; if (xx < 0 || xx >= W) continue
            const f = kb * (1 - dd * dd) * 0.5, o = (yy * W + xx) * 3
            acc[o] += c[0] * f; acc[o + 1] += c[1] * f; acc[o + 2] += c[2] * f
          }
        }
      }
    }
    // ---- out ----
    const d32 = (this._sD32 && this._sD32.buffer === d.buffer) ? this._sD32 : (this._sD32 = new Uint32Array(d.buffer, d.byteOffset, W * H))
    for (let i = 0, q = 0; i < W * H; i++, q += 3) {   // write RGBA as one 32-bit store, then fade for the next frame
      let r = acc[q], g = acc[q + 1], b = acc[q + 2]
      r = r > 255 ? 255 : r | 0; g = g > 255 ? 255 : g | 0; b = b > 255 ? 255 : b | 0
      d32[i] = 0xff000000 | (b << 16) | (g << 8) | r
      acc[q] = acc[q] * decay; acc[q + 1] = acc[q + 1] * decay; acc[q + 2] = acc[q + 2] * decay
    }
    // adapt the grain density: stay inside the sample budget AND the frame-time target (opt.scanMs, default 18 ms)
    const el = performance.now() - T0, tgt = O.scanMs || 18
    S.dsc = clamp(dsc * Math.min(clamp(budget / Math.max(1, cnt), 0.8, 1.2), clamp(tgt / Math.max(1, el), 0.85, 1.12)), 0.08, 1.5)
    a.ctx2d.putImageData(this._ci, 0, 0)
    return cnt
  }
})()
