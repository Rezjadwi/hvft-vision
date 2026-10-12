// HVFT VISION — bg_tangle.js
// BG PATTERN "TANGLE" — audio-reactive background (ref: tangled light-string web cut into panels).
// A chaotic 3D rope wanders; its points are joined by a haze of faint chords + a bright main strand,
// accumulated like a long exposure. The frame is split into panels; on every beat the lit panels
// hard-cut, the web jumps and a light flare burns along a panel seam.
//   Mic OFF  -> one calm full-frame web drifting slowly (no cuts, no flicker).
//   LOW      -> rope speed + seam flare     MID -> web density      HIGH -> sparkle struts
//   BEAT     -> panel cut + web jump + accumulation reset
//   BRUTALITY -> up to 5 ropes (layers), each locked to a random frequency band (re-rolled per beat);
//               a rope jumps to a new panel whenever ITS band spikes; finer panel grid
// Registers into HVFT_EFFECTS / HVFT_FX_PARAMS / HVFT_GEN_FX (load right after effects.js).
;(function () {
  if (typeof HVFT_EFFECTS === 'undefined') return
  const ST = new WeakMap()   // per target canvas (each channel/pipe keeps its own web)
  const rnd = (s) => { s = Math.sin(s * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s) }

  function tanglePixels (f) { const out = f.out; out.fill(0); for (let j = 3; j < out.length; j += 4) out[j] = 255 }

  function newRope (seed) {
    const N = 180, pts = []
    for (let i = 0; i < N; i++) pts.push([0, 0, 0])
    return { N, pts, head: [(rnd(seed) - 0.5) * 0.6, (rnd(seed * 3) - 0.5) * 0.6, (rnd(seed * 5) - 0.5) * 0.6],
      ay: rnd(seed * 7) * 6, ax: 0.2 + rnd(seed * 11) * 0.9, sc: null, seed, cell: 0, prevE: 0, flare: 0, edge: 0 }
  }
  function newState (W, H) {
    const acc = document.createElement('canvas'); acc.width = W; acc.height = H
    return { ropes: [newRope(1)], seed: 1, lastCut: 0, acc, actx: acc.getContext('2d'), t0: performance.now(), bs: { prev: 0, seed: 1, bins: [], env: [] } }
  }

  // one rope = the chaotic head's recent trajectory (ring of past positions -> knots & loops)
  function stepRope (R, t, chaos, speed) {
    const sp = (0.02 + chaos * 0.05) * speed
    const hx = R.head, fq = 1.4 + chaos * 2.6, ph = R.seed * 1.7
    const vx = Math.sin(hx[1] * fq + t * 0.9 + ph) + Math.cos(hx[2] * fq * 1.3 - t * 0.6) + Math.sin(hx[1] * fq * 3.1 + hx[2]) * chaos
    const vy = Math.sin(hx[2] * fq * 1.1 + t * 0.7) + Math.cos(hx[0] * fq * 1.7 + t * 0.5 + ph) + Math.sin(hx[0] * fq * 2.7 - hx[2]) * chaos
    const vz = Math.sin(hx[0] * fq * 0.9 - t * 0.6) + Math.cos(hx[1] * fq * 1.2 + t * 0.4) + Math.sin(hx[2] * fq * 2.3 + hx[0] + ph) * chaos
    const P = R.pts
    for (let st = 0; st < 2; st++) {
      hx[0] += vx * sp / 2; hx[1] += vy * sp / 2; hx[2] += vz * sp / 2
      for (let j = 0; j < 3; j++) hx[j] -= hx[j] * 0.012
      const q = P.pop(); q[0] = hx[0]; q[1] = hx[1]; q[2] = hx[2]; P.unshift(q)
    }
  }
  function project (R, target) {
    const cy = Math.cos(R.ay), sy = Math.sin(R.ay), cx = Math.cos(R.ax), sx = Math.sin(R.ax)
    const scr = new Array(R.N)
    let mx = 0, my = 0
    for (let i = 0; i < R.N; i++) {
      const p = R.pts[i]
      const x1 = p[0] * cy + p[2] * sy, z1 = -p[0] * sy + p[2] * cy
      const y2 = p[1] * cx - z1 * sx, z2 = p[1] * sx + z1 * cx
      const pz = 1 / (1.6 + z2 * 0.5)
      scr[i] = [x1 * pz, y2 * pz]; mx += scr[i][0]; my += scr[i][1]
    }
    mx /= R.N; my /= R.N
    let rr = 0
    for (let i = 0; i < R.N; i++) { const dx = scr[i][0] - mx, dy = scr[i][1] - my; rr += dx * dx + dy * dy }
    rr = Math.sqrt(rr / R.N) || 1
    R.sc = R.sc == null ? target / rr : R.sc + (target / rr - R.sc) * 0.2
    for (let i = 0; i < R.N; i++) { scr[i][0] = (scr[i][0] - mx) * R.sc; scr[i][1] = (scr[i][1] - my) * R.sc }
    return scr
  }
  function drawRope (a, R, scr, ox, oy, o) {
    const { col, PAL, lw, dens, mid, low, high, live, e, fr } = o
    const boost = 1 + e * 2.2
    // haze chords
    const nCh = ((140 + dens * 520) * (1 + mid * 1.2) * (1 + e * 1.5)) | 0
    a.lineWidth = lw * 0.7
    a.strokeStyle = col(PAL ? 172 : 230, Math.min(0.5, (0.035 + dens * 0.03 + mid * 0.05) * (PAL ? 1.5 : 1) * boost))
    a.beginPath()
    for (let k = 0; k < nCh; k++) {
      const i = (rnd(k * 1.37 + R.seed) * R.N) | 0
      const j = (i + 4 + ((rnd(k * 2.71 + R.seed * 3) * 70) | 0)) % R.N
      a.moveTo(ox + scr[i][0], oy + scr[i][1]); a.lineTo(ox + scr[j][0], oy + scr[j][1])
    }
    a.stroke()
    // misty grain
    a.fillStyle = col(PAL ? 205 : 240, Math.min(0.9, (0.22 + mid * 0.3) * boost))
    const ng = ((260 + dens * 900) * (1 + e)) | 0
    for (let k = 0; k < ng; k++) {
      const i = (rnd(k * 3.3 + fr + R.seed) * (R.N - 1)) | 0, j = (i + 1 + ((rnd(k * 5.1 + fr) * 40) | 0)) % R.N, u = rnd(k * 7.7 + fr)
      a.fillRect(ox + scr[i][0] + (scr[j][0] - scr[i][0]) * u, oy + scr[i][1] + (scr[j][1] - scr[i][1]) * u, lw, lw)
    }
    // main strand
    a.lineWidth = lw * (1 + low * 1.5 + e * 3)
    a.strokeStyle = col(245, Math.min(1, 0.28 + low * 0.5 + e * 0.6))
    a.beginPath(); a.moveTo(ox + scr[0][0], oy + scr[0][1])
    for (let i = 1; i < R.N; i++) a.lineTo(ox + scr[i][0], oy + scr[i][1])
    a.stroke()
    // sparkle struts from a hub
    const hs = Math.max(high, e * 0.8)
    if (hs > 0.08 || !live) {
      const hub = (rnd(R.seed * 23) * R.N) | 0, ns = live ? (3 + hs * 18) | 0 : 3
      a.lineWidth = lw * 1.2; a.strokeStyle = PAL ? 'rgba(226,48,28,' + (live ? 0.35 + hs * 0.6 : 0.15) + ')' : col(255, live ? 0.25 + hs * 0.6 : 0.12)
      a.beginPath()
      for (let k = 0; k < ns; k++) { const j = (hub + 5 + ((rnd(k * 9.1 + R.seed) * 60) | 0)) % R.N; a.moveTo(ox + scr[hub][0], oy + scr[hub][1]); a.lineTo(ox + scr[j][0], oy + scr[j][1]) }
      a.stroke()
    }
  }

  function tangleVector (ctx, f, D) {
    const W = D.W | 0, H = D.H | 0
    let S = ST.get(ctx.canvas)
    if (!S || S.acc.width !== W || S.acc.height !== H) { S = newState(W, H); ST.set(ctx.canvas, S) }
    const now = performance.now(), t = (now - S.t0) / 1000
    const rc = _react(f), B = _bnd(f)
    const low = B[0] * rc, mid = B[1] * rc, high = B[2] * rc, beat = (f.onset || 0) * rc
    const live = rc > 0.001
    const K = (typeof _bgK === 'function') ? _bgK(f) : 0
    const dens = fxp(f, 'density', 0.6), chaos = fxp(f, 'chaos', 0.55), cutsP = fxp(f, 'cuts', 0.6), flareP = fxp(f, 'flare', 0.6)

    // ---- panel grid (BRUTALITY pushes one step finer) ----
    const GRIDS = [[1, 1], [2, 2], [3, 2], [4, 3], [5, 4]]
    let gi = !live || cutsP < 0.2 ? 0 : cutsP < 0.55 ? 1 : cutsP < 0.85 ? 2 : 3
    if (live && gi > 0 && K > 0.6) gi++
    const GC = GRIDS[gi][0], GR = GRIDS[gi][1], NC = GC * GR
    const cw = W / GC, ch = H / GR
    // ---- layers: more ropes with BRUTALITY, each locked to a random frequency band ----
    const nR = live ? 1 + Math.round(K * 4) : 1
    while (S.ropes.length < nR) { S.seed++; const r = newRope(S.seed * 7); r.cell = (rnd(S.seed * 13) * NC) | 0; S.ropes.push(r) }
    S.ropes.length = nR
    const E = (live && K > 0.02 && typeof _bgRandBands === 'function') ? _bgRandBands(f, S.bs, nR) : null
    const a = S.actx
    const cut = (R, flare) => {   // rope jumps to a fresh panel with a fresh exposure
      R.seed = R.seed * 1.31 + 7.7; R.cell = (rnd(R.seed * 3) * NC) | 0
      R.ay += (rnd(R.seed * 5) - 0.5) * 2.4; R.ax = 0.2 + rnd(R.seed * 11) * 0.9
      for (let j = 0; j < 3; j++) R.head[j] += (rnd(R.seed * 13 + j) - 0.5) * 1.2 * (0.4 + chaos)
      a.clearRect((R.cell % GC) * cw, ((R.cell / GC) | 0) * ch, cw, ch)
      R.flare = flare; R.edge = (rnd(R.seed * 17) * 4) | 0
    }
    // beat: every rope cuts
    if (live && beat > 0.45 && now - S.lastCut > 110) { S.lastCut = now; S.seed++; for (const R of S.ropes) cut(R, 1) }
    // random frequency: a rope cuts on its own band's spike
    if (E) S.ropes.forEach((R, i) => { const e = E[i]; if (e > 0.55 && R.prevE <= 0.55) cut(R, 0.6 + e * 0.4); R.prevE = e })
    if (!live) for (const R of S.ropes) R.cell = 0
    for (const R of S.ropes) { if (R.cell >= NC) R.cell = 0; R.flare *= 0.86 }

    // ---- expose all ropes onto the accumulation canvas ----
    const lut = f.lut
    const col = (v, al) => lut ? lutCss(lut, v, al) : 'rgba(' + v + ',' + v + ',' + v + ',' + al + ')'
    const PAL = !!(lut && lut.name === 'hvft')
    const lw = Math.max(0.5, W / 900), fr = (t * 30) | 0
    a.globalCompositeOperation = 'source-over'
    a.fillStyle = 'rgba(0,0,0,' + (live ? 0.12 + K * 0.08 : 0.06) + ')'; a.fillRect(0, 0, W, H)
    a.globalCompositeOperation = 'lighter'
    S.ropes.forEach((R, i) => {
      const e = E ? E[i] : 0
      stepRope(R, t, chaos, (1 + low * 2.5) * (1 + e * 3 * K))
      R.ay += 0.002 + low * 0.01 + e * 0.03
      const target = live ? Math.max(cw, ch) * (0.35 + rnd(R.seed * 31) * 0.4) * (1 + mid * 0.35 + e * 0.5) : Math.max(W, H) * 0.3
      const scr = project(R, target)
      const ox = live ? (R.cell % GC + 0.5 + (rnd(R.seed * 17) - 0.5) * 0.6) * cw : W * 0.5
      const oy = live ? (((R.cell / GC) | 0) + 0.5 + (rnd(R.seed * 19) - 0.5) * 0.6) * ch : H * 0.5
      drawRope(a, R, scr, ox, oy, { col, PAL, lw, dens, mid, low, high, live, e, fr })
      if (i === 0 && rnd(R.seed * 29) < fxp(f, 'accent', 0) * 0.6) {   // rare HVFT orange strand
        a.strokeStyle = 'rgba(242,160,61,0.35)'; a.lineWidth = lw
        a.beginPath(); for (let q = 20; q < 40; q++) a.lineTo(ox + scr[q][0], oy + scr[q][1]); a.stroke()
      }
    })

    // ---- composite: the panels lit by the ropes, each with its seam flare ----
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const lit = live ? [...new Set(S.ropes.map(R => R.cell))] : [0]
    for (const c of lit) {
      const px = (c % GC) * cw, py = ((c / GC) | 0) * ch
      ctx.save(); ctx.beginPath(); ctx.rect(px, py, cw, ch); ctx.clip()
      ctx.drawImage(S.acc, 0, 0)
      ctx.restore()
    }
    if (live && flareP > 0.01) for (const R of S.ropes) {
      const fl = R.flare * flareP * (0.4 + low * 1.4)
      if (fl <= 0.02) continue
      const px = (R.cell % GC) * cw, py = ((R.cell / GC) | 0) * ch, e = R.edge
      const vert = e < 2, fw = (vert ? cw : ch) * 0.1
      const gx0 = vert ? (e === 0 ? px : px + cw) : px, gy0 = vert ? py : (e === 2 ? py : py + ch)
      const g = vert ? ctx.createLinearGradient(gx0, 0, gx0 + (e === 0 ? fw : -fw), 0) : ctx.createLinearGradient(0, gy0, 0, gy0 + (e === 2 ? fw : -fw))
      g.addColorStop(0, col(255, Math.min(0.9, fl))); g.addColorStop(1, col(255, 0))
      ctx.fillStyle = g
      if (vert) ctx.fillRect(e === 0 ? px : px + cw - fw, py, fw, ch); else ctx.fillRect(px, e === 2 ? py : py + ch - fw, cw, fw)
      ctx.fillStyle = col(255, Math.min(1, fl * 1.4))   // hard 1px seam
      if (vert) ctx.fillRect(e === 0 ? px : px + cw - lw, py, lw, ch); else ctx.fillRect(px, e === 2 ? py : py + ch - lw, cw, lw)
    }
    if (live && NC > 1) {   // thin panel grid ghost
      const fmax = Math.max(0, ...S.ropes.map(R => R.flare))
      ctx.strokeStyle = col(200, 0.05 + fmax * 0.12); ctx.lineWidth = lw
      ctx.beginPath()
      for (let i = 1; i < GC; i++) { ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, H) }
      for (let j = 1; j < GR; j++) { ctx.moveTo(0, j * ch); ctx.lineTo(W, j * ch) }
      ctx.stroke()
    }
    ctx.restore()
  }

  HVFT_FX_PARAMS.tangle = [['density', 'Web Density', 0.6], ['chaos', 'Chaos', 0.55], ['cuts', 'Panel Cuts', 0.6], ['flare', 'Seam Flare', 0.6], ['accent', 'Orange Accent', 0]]
  if (typeof HVFT_GEN_FX !== 'undefined') HVFT_GEN_FX.add('tangle')
  if (!HVFT_EFFECTS.some(e => e.id === 'tangle')) HVFT_EFFECTS.push({ id: 'tangle', name: 'Tangle (pattern)', pixels: tanglePixels, vector: tangleVector, maxRes: 960, bgRes: 900 })
})()
