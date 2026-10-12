// txt_fx2.js — 8 TEXT styles learned from Reza's reference clips (Oct 12, 2026).
// Each style is a continuous reaction to the noise (no onset-triggered page flips): silent / mic OFF = clean,
// readable, frozen; louder = more of the style. White on transparent (the layer comp puts it over black / BG).
//   TRACK WAVE  · word column, letter-spacing waves travel down the stack           (ref: YOUR NUMBER ONE)
//   BAND SQUASH · horizontal bands of the glyph squashed / stretched like an accordion  (ref: big "A")
//   SHATTER     · text cut into glass shards by thin lines, shards slip apart           (ref: INSIDE)
//   EXTRUDE     · small block in 3D tilt, letters smeared into long solid extrusions     (ref: CONCRETE LINE SYSTEM)
//   SCALE STACK · words stacked edge to edge, each row a different giant scale, cropped  (ref: TYPE SENSES)
//   GRID DRIFT  · letters on a fine grid wander cell by cell and come home in silence    (ref: TO FLOW ALONG TIME)
//   SPIKE       · letter edges pulled into thorns toward a moving point (□)             (ref: POINTS)
//   LETTER GAP  · list of words, gaps open between random letters, row boxes            (ref: STORY ABSURD …)
;(function () {
  const GROT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
  const famOf = (cfg) => {
    const fi = cfg && Array.isArray(cfg.fonts) && cfg.fonts.length ? cfg.fonts[0] : -1
    if (fi >= 0 && typeof HVFT_FONTS !== 'undefined' && HVFT_FONTS[fi]) return { w: '', fam: HVFT_FONTS[fi] }
    return { w: '700 ', fam: GROT }
  }
  const fnt = (F, px) => F.w + Math.max(6, px | 0) + 'px ' + F.fam
  const sizeK = (cfg) => ((cfg && cfg.size != null) ? cfg.size : 0.16) / 0.16
  const linesOf = (raw) => { const l = String(raw || '').split('\n').map(s => s.trim().toUpperCase()).filter(Boolean); return l.length ? l : ['HVFT'] }
  const wordsOf = (raw) => { const w = String(raw || '').toUpperCase().split(/\s+/).filter(Boolean); return w.length ? w : ['HVFT'] }
  const lerp = (a, b, t) => a + (b - a) * t
  const aud = (f, cfg) => f._txA || (typeof _txAud === 'function' ? _txAud(f, cfg) : { low: 0, mid: 0, high: 0, onset: 0, e: 0, rc: 0 })
  // deterministic random (seeded) — same seed = same result, so a frozen frame stays frozen
  const rnd = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }
  // per-layer state (keyed by the text config object; falls back to the mode name)
  const ST = new WeakMap(), STK = {}
  const stateOf = (cfg, mode) => {
    let s = cfg && typeof cfg === 'object' ? ST.get(cfg) : STK[mode]
    if (!s || s.mode !== mode) { s = { mode, lv: 0, ph: 0, n: 0 }; if (cfg && typeof cfg === 'object') ST.set(cfg, s); else STK[mode] = s }
    s.n++
    return s
  }
  // ONE driver for all 8 styles, calibrated on KINETIC (Oct 12, Reza: "balance sama dengan Kinetic"):
  //  · drive = HOW REACTIVE × the layer's REACT, same curve as Kinetic (40 % = full) — mic OFF = 0
  //  · dv = each band's deviation from its OWN running mean (adaptive): steady harsh noise keeps moving
  //    but never pins everything at max; quiet input still moves
  //  · lv = 0.45 base while noise plays + deviation + loudness → bounded 0..1 for every style
  //  · kick = Kinetic's burst rule (onset edge or band flux, ≥ 4 frames apart); structure changes only on a kick
  //  · calm after ~4 s of silence, leaves calm as soon as noise is back
  function drv (s, f, cfg) {
    const B = f.band || {}, AR = Array.isArray(B)
    const rc = f.audioOn ? Math.min(1, (f.audAmt == null ? 0.4 : f.audAmt) * 2.5) : 0
    const react = (cfg && cfg.react != null) ? cfg.react : 1, drive = rc * Math.min(1.5, 0.35 + react * 1.15)
    const env = [((AR ? B[0] : B.low) || 0) * rc, ((AR ? B[1] : B.mid) || 0) * rc, ((AR ? B[2] : B.high) || 0) * rc], onset = (f.onset || 0) * rc
    const K = s.K || (s.K = { mu: [0, 0, 0], sd: [0.05, 0.05, 0.05], pd: [0, 0, 0], dv: [0, 0, 0], b: [0, 0, 0], quiet: 999, calm: true, prev: 0, last: -99, n: 0 })
    K.n++
    let flux = 0
    for (let k = 0; k < 3; k++) {
      K.mu[k] += (env[k] - K.mu[k]) * 0.04
      K.sd[k] += (Math.abs(env[k] - K.mu[k]) - K.sd[k]) * 0.06
      const d = (env[k] - K.mu[k]) / Math.max(0.012, K.sd[k] * 1.8)
      K.dv[k] = drive > 0 ? (d > 1 ? 1 : d < -1 ? -1 : d) : 0
      flux += Math.max(0, K.dv[k] - K.pd[k]); K.pd[k] = K.dv[k]
    }
    const loud = (env[0] + env[1] + env[2]) / 3
    K.quiet = loud < 0.06 ? K.quiet + 1 : 0
    if (drive <= 0 || K.quiet > 120) K.calm = true; else if (loud > 0.08) K.calm = false
    K.kick = drive > 0 && !K.calm && K.n - K.last > 3 && ((onset > 0.3 && K.prev <= 0.3) || flux > 0.9); K.prev = onset
    if (K.kick) K.last = K.n
    const dn = Math.sqrt(Math.min(1, drive / 1.5)), ad = (Math.abs(K.dv[0]) + Math.abs(K.dv[1]) + Math.abs(K.dv[2])) / 3
    const tgt = K.calm ? 0 : dn * Math.min(1, 0.45 + 0.3 * ad + 0.25 * Math.max(0, Math.min(1, (loud - 0.15) / 0.6)))
    s.lv = lerp(s.lv, tgt, tgt > s.lv ? 0.2 : 0.06); if (drive <= 0) s.lv *= 0.8
    for (let k = 0; k < 3; k++) K.b[k] = s.lv * (0.5 + 0.5 * K.dv[k])     // per-band push, 0..lv, follows the band's own swings
    K.lv = s.lv; K.drive = dn
    return K
  }
  // structure change (new cut / zone / drag / step): on a kick, at least gMin frames apart; at most gMax frames without one
  const due = (s, K, gMin, gMax) => { s.since = (s.since || 0) + 1; if (K.lv < 0.03) return false; if ((K.kick && s.since >= gMin) || s.since >= gMax) { s.since = 0; return true } return false }
  // off-screen canvases (reused)
  const mk = () => { const c = document.createElement('canvas'); c.c = c.getContext('2d'); return c }
  const fit = (c, W, H) => { if (c.width !== W || c.height !== H) { c.width = W; c.height = H } c.c.setTransform(1, 0, 0, 1, 0, 0); c.c.globalAlpha = 1; c.c.globalCompositeOperation = 'source-over'; c.c.clearRect(0, 0, W, H); return c.c }
  // big centred stack of the lines (cached by text / size / font)
  function stackCanvas (s, raw, cfg, W, H, scale) {
    const F = famOf(cfg), key = raw + '|' + W + '|' + H + '|' + (cfg.size || 0) + '|' + F.fam + '|' + (scale || 1) + '|' + (cfg.letter || 0)
    if (s.stk && s.stkKey === key) return s.stk
    const c = s.stk || mk(); const x = fit(c, W, H)
    const L = linesOf(raw), n = L.length
    let px = Math.min(H / n * 0.86, H * 0.16 * sizeK(cfg) * 2.4) * (scale || 1)
    x.font = fnt(F, px); x.letterSpacing = Math.round((cfg.letter || 0) * px) + 'px'; let wd = 1; for (const l of L) wd = Math.max(wd, x.measureText(l).width)
    if (wd > W * 0.92) px *= W * 0.92 / wd
    x.font = fnt(F, px); x.letterSpacing = Math.round((cfg.letter || 0) * px) + 'px'; x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'
    const lh = px * 1.02, y0 = H / 2 - (n - 1) * lh / 2
    L.forEach((l, i) => x.fillText(l, W / 2, y0 + i * lh))
    s.stk = c; s.stkKey = key; s.stkPx = px; s.edge = null
    return c
  }
  const LINE = 'rgba(255,255,255,0.38)'

  // 1 ─ TRACK WAVE
  function trackwave (ctx, f, D, cfg, raw) {
    const W = D.W, H = D.H, s = stateOf(cfg, 'trackwave'), K = drv(s, f, cfg), lv = K.lv
    s.ph += (0.006 + 0.012 * K.drive + K.b[1] * 0.02 + K.b[0] * 0.015) * (lv > 0.01 ? 1 : 0)
    const F = famOf(cfg), L = linesOf(raw)
    const px = Math.max(8, H * 0.034 * sizeK(cfg)), lh = px * 1.02
    const rows = Math.max(L.length, Math.floor(H * 0.96 / lh)), y0 = (H - rows * lh) / 2 + lh / 2
    ctx.font = fnt(F, px); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    const base = px * (0.06 + (cfg.letter || 0)), amp = px * (0.2 + lv * 2.4)
    const mw = s.mw && s.mwKey === ctx.font ? s.mw : (s.mw = {}, s.mwKey = ctx.font, s.mw)
    for (let r = 0; r < rows; r++) {
      const word = L[r % L.length], ch = [...word]
      const wv = Math.pow(Math.max(0, Math.sin(r * 0.42 - s.ph * 3)), 3) + 0.7 * Math.pow(Math.max(0, Math.sin(r * 0.19 + s.ph * 1.6 + 1)), 5)
      const sp = base + (lv > 0.01 ? amp * wv * (0.6 + K.b[2] * 0.8) : 0)
      let tot = 0; for (const c of ch) tot += (mw[c] || (mw[c] = ctx.measureText(c).width))
      tot += (ch.length - 1) * sp
      let x = W / 2 - tot / 2; const y = y0 + r * lh
      for (const c of ch) { ctx.fillText(c, x, y); x += mw[c] + sp }
    }
  }

  // 2 ─ BAND SQUASH  (v2, Oct 12 — matched to the "A" clip)
  // The glyph stays whole; 1–3 ZONES of 2–5 thin adjacent bands each re-sample a slice taken higher up the glyph,
  // vertically squashed → its shoulders / counter repeat as stacked lobes. Thin rules mark every band edge, full width.
  function glyphBox (s, src, W, H) {
    if (s.box && s.boxKey === s.stkKey) return s.box
    let y0 = H, y1 = 0
    try { const d = src.c.getImageData(0, 0, W, H).data; for (let y = 0; y < H; y += 2) { for (let x = 0; x < W; x += 3) if (d[(y * W + x) * 4 + 3] > 100) { if (y < y0) y0 = y; if (y > y1) y1 = y; break } } } catch (e) {}
    if (y1 <= y0) { y0 = H * 0.3; y1 = H * 0.7 }
    s.box = { y0, y1, h: y1 - y0 }; s.boxKey = s.stkKey
    return s.box
  }
  function bandsquash (ctx, f, D, cfg, raw) {
    const W = D.W, H = D.H, s = stateOf(cfg, 'bandsquash'), K = drv(s, f, cfg), lv = K.lv
    const src = stackCanvas(s, raw, cfg, W, H, 1.15), B = glyphBox(s, src, W, H)
    if (lv < 0.015) { s.zones = null; ctx.drawImage(src, 0, 0); return }
    if (!s.zones || due(s, K, 7, 30)) {                          // new zone layout (rate follows the noise)
      const k = (s.k = (s.k || 0) + 1), nz = 1 + Math.round(rnd(k, 1) * Math.min(2, lv * 3))
      s.zones = []
      for (let z = 0; z < nz; z++) {
        const nb = 2 + Math.floor(rnd(k, 10 + z) * 4), bands = []
        for (let b = 0; b < nb; b++) bands.push({ h: 0.05 + rnd(k, 20 + z * 9 + b) * 0.09, src: rnd(k, 40 + z * 9 + b) * 0.45, sq: 1.6 + rnd(k, 60 + z * 9 + b) * 2.6 })
        s.zones.push({ y: 0.12 + rnd(k, 80 + z) * 0.76, v: (rnd(k, 90 + z) - 0.5) * 0.01, bands })
      }
    }
    s.out = s.out || mk(); const o = fit(s.out, W, H)
    o.drawImage(src, 0, 0)
    const rules = []
    const grow = Math.min(1, lv * 1.5) * (0.8 + K.b[0] * 0.4)
    for (const z of s.zones) {
      z.y += z.v * (1.6 + K.b[1] * 3 + K.dv[1] * 0.8); if (z.y < 0.08 || z.y > 0.92) z.v = -z.v
      let y = B.y0 + z.y * B.h
      for (const b of z.bands) {
        const dh = Math.max(2, b.h * B.h * grow); if (y + dh > B.y1) break
        const sh = Math.min(B.h, dh * b.sq * (0.75 + K.b[2] * 0.6 + K.dv[0] * 0.15)), sy = B.y0 + b.src * B.h
        o.clearRect(0, y, W, dh)
        o.drawImage(src, 0, sy, W, sh, 0, y, W, dh)
        rules.push(y); y += dh
      }
      rules.push(y)
    }
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.globalAlpha = Math.min(1, lv * 3); ctx.lineWidth = Math.max(1, W * 0.0011); ctx.beginPath()
    for (const y of rules) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5) }
    ctx.stroke(); ctx.restore()
    ctx.drawImage(s.out, 0, 0)
  }

  // 3 ─ SHATTER
  function clipHalf (poly, nx, ny, d) {   // keep points with p·n <= d
    const out = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], da = a[0] * nx + a[1] * ny - d, db = b[0] * nx + b[1] * ny - d
      if (da <= 0) out.push(a)
      if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]) }
    }
    return out
  }
  function shatter (ctx, f, D, cfg, raw) {
    const W = D.W, H = D.H, s = stateOf(cfg, 'shatter'), K = drv(s, f, cfg), lv = K.lv
    const src = stackCanvas(s, raw, cfg, W, H, 0.9)
    if (lv < 0.02) { s.sh = null; ctx.drawImage(src, 0, 0); return }
    if (!s.sh || due(s, K, 8, 40)) {
      s.seed = (s.seed || 1) + 1
      let polys = [[[0, 0], [W, 0], [W, H], [0, H]]]; const cuts = []
      const m = 3 + Math.round(lv * 5)
      for (let k = 0; k < m; k++) {
        const px = W * (0.5 + (rnd(s.seed, k) - 0.5) * 0.7), py = H * (0.5 + (rnd(s.seed, k + 50) - 0.5) * 0.7), an = rnd(s.seed, k + 99) * Math.PI
        const nx = Math.cos(an), ny = Math.sin(an), d = px * nx + py * ny
        const nxt = []
        for (const p of polys) { const a = clipHalf(p, nx, ny, d), b = clipHalf(p, -nx, -ny, -d); if (a.length > 2) nxt.push(a); if (b.length > 2) nxt.push(b) }
        polys = nxt.length > 44 ? nxt.slice(0, 44) : nxt
        cuts.push([px - ny * W * 2, py + nx * W * 2, px + ny * W * 2, py - nx * W * 2])
      }
      s.sh = polys.map((p, i) => { const a = rnd(s.seed, i + 200) * Math.PI * 2, m2 = rnd(s.seed, i + 300); return { p, dx: Math.cos(a) * m2, dy: Math.sin(a) * m2, r: (rnd(s.seed, i + 400) - 0.5), cx: p.reduce((t, q) => t + q[0], 0) / p.length, cy: p.reduce((t, q) => t + q[1], 0) / p.length } })
      s.cuts = cuts
    }
    const mag = W * (0.008 + 0.035 * lv) * (0.6 + K.b[0] * 0.9 + K.dv[1] * 0.15), rot = 0.06 * lv * (1 + K.dv[2] * 0.4)
    s.out = s.out || mk(); const o = fit(s.out, W, H)
    o.strokeStyle = 'rgba(255,255,255,0.28)'; o.lineWidth = 1
    for (const q of s.sh) {
      o.save(); o.translate(q.cx + q.dx * mag, q.cy + q.dy * mag); o.rotate(q.r * rot); o.translate(-q.cx, -q.cy)
      o.beginPath(); q.p.forEach((pt, j) => j ? o.lineTo(pt[0], pt[1]) : o.moveTo(pt[0], pt[1])); o.closePath()
      o.save(); o.clip(); o.drawImage(src, 0, 0); o.restore(); o.stroke(); o.restore()
    }
    o.beginPath(); for (const c of s.cuts) { o.moveTo(c[0], c[1]); o.lineTo(c[2], c[3]) } o.globalAlpha = 0.35; o.stroke(); o.globalAlpha = 1
    ctx.drawImage(s.out, 0, 0)
  }

  // 4 ─ EXTRUDE  (v2, Oct 12 — matched to the CONCRETE LINE SYSTEM clip)
  // Small tilted text block(s). A CUT runs through a block (a column or a row); the part past the cut slides far away
  // and the 1-px slice at the cut is stretched to bridge the gap → a long ruled bar ("CONC ═════ RETE").
  function blockOf (s, i, lines, F, px, ls) {
    s.blks = s.blks || []
    const key = lines.join('\n') + '|' + px + '|' + F.fam + '|' + (ls || 0)
    let b = s.blks[i]
    if (b && b.key === key) return b
    const c = (b && b.c) || mk(); c.c.font = fnt(F, px); c.c.letterSpacing = Math.round((ls || 0) * px) + 'px'; let wd = 1; for (const l of lines) wd = Math.max(wd, c.c.measureText(l).width)
    const bw = Math.ceil(wd + 4), bh = Math.ceil(lines.length * px * 0.9 + 4), x = fit(c, bw, bh)
    x.font = fnt(F, px); x.letterSpacing = Math.round((ls || 0) * px) + 'px'; x.fillStyle = '#fff'; x.textAlign = 'left'; x.textBaseline = 'top'
    lines.forEach((l, j) => x.fillText(l, 2, 2 + j * px * 0.9))
    b = s.blks[i] = { c, key, w: bw, h: bh }
    return b
  }
  function extrude (ctx, f, D, cfg, raw) {
    const W = D.W, H = D.H, s = stateOf(cfg, 'extrude'), K = drv(s, f, cfg), lv = K.lv
    const F0 = famOf(cfg), F = F0.w ? { w: '700 ', fam: F0.fam } : F0
    // blank line = second block (side by side, like the clip); otherwise one block
    const paras = String(raw || '').toUpperCase().split(/\n\s*\n/).map(p => p.split('\n').map(l => l.trim()).filter(Boolean)).filter(p => p.length).slice(0, 2)
    if (!paras.length) paras.push(['HVFT'])
    const px = Math.max(8, H * 0.045 * sizeK(cfg))
    const blocks = paras.map((p, i) => blockOf(s, i, p, F, px, cfg.letter))
    s.t = (s.t || 0) + 1
    if (!s.cut || due(s, K, 30, 120)) {
      const k = (s.k = (s.k || 0) + 1)
      s.cut = blocks.map((b, i) => {
        const col = rnd(k, i + 1) < 0.6
        const ang = col ? (rnd(k, i + 7) < 0.5 ? -1 : 1) * (0.35 + rnd(k, i + 8) * 0.9) : (Math.PI / 2) * (rnd(k, i + 7) < 0.7 ? 1 : -1) + (rnd(k, i + 8) - 0.5) * 0.7
        return { col, at: 0.25 + rnd(k, i + 3) * 0.55, ang, len: 0.07 + rnd(k, i + 5) * 0.18, on: rnd(k, i + 9) < 0.55 + lv * 0.45 }
      })
      s.tilt = { r: (rnd(k, 50) - 0.5) * 0.9, sk: (rnd(k, 51) - 0.5) * 0.9 }
    }
    const e = Math.min(1, lv * 1.3)
    s.r = lerp(s.r || 0, s.tilt.r * e, 0.15); s.sk = lerp(s.sk || 0, s.tilt.sk * e, 0.15)
    s.L = s.L || []
    const gap = W * 0.06, totW = blocks.reduce((t, b) => t + b.w, 0) + gap * (blocks.length - 1)
    let x0 = -totW / 2
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(s.r); ctx.transform(1, 0, s.sk, 1, 0, 0)
    blocks.forEach((b, i) => {
      const c = s.cut[i] || s.cut[0], tgt = c.on ? Math.min(W, H) * c.len * e * (0.65 + K.b[0] * 0.6) : 0
      s.L[i] = lerp(s.L[i] || 0, tgt, 0.22); const L = s.L[i]
      const vx = Math.cos(c.ang) * L, vy = Math.sin(c.ang) * L, bx = x0, by = -b.h / 2
      if (L < 1) ctx.drawImage(b.c, bx, by)
      else if (c.col) {
        const cx = Math.max(1, Math.floor(b.w * c.at))
        ctx.drawImage(b.c, 0, 0, cx, b.h, bx, by, cx, b.h)                                  // part before the cut
        ctx.save(); ctx.translate(bx + cx, by); ctx.transform(vx, vy, 0, 1, 0, 0); ctx.drawImage(b.c, cx, 0, 1, b.h, 0, 0, 1, b.h); ctx.restore()   // stretched slice = the bar
        ctx.drawImage(b.c, cx, 0, b.w - cx, b.h, bx + cx + vx, by + vy, b.w - cx, b.h)   // part past the cut, slid away
      } else {
        const cy = Math.max(1, Math.floor(b.h * c.at))
        ctx.drawImage(b.c, 0, 0, b.w, cy, bx, by, b.w, cy)
        ctx.save(); ctx.translate(bx, by + cy); ctx.transform(1, 0, vx, vy, 0, 0); ctx.drawImage(b.c, 0, cy, b.w, 1, 0, 0, b.w, 1); ctx.restore()
        ctx.drawImage(b.c, 0, cy, b.w, b.h - cy, bx + vx, by + cy + vy, b.w, b.h - cy)
      }
      x0 += b.w + gap
    })
    ctx.restore()
  }

  // 5 ─ SCALE STACK
  function scalestack (ctx, f, D, cfg, raw) {
    const W = D.W, H = D.H, s = stateOf(cfg, 'scalestack'), K = drv(s, f, cfg), lv = K.lv
    const Wd = wordsOf(raw), F = famOf(cfg)
    const R = Math.max(5, Math.min(11, Wd.length + 3))
    if (!s.rows || s.rows.length !== R || s.wKey !== raw) {
      s.wKey = raw; s.wi = 0
      s.rows = Array.from({ length: R }, (_, i) => { const h = 0.35 + Math.pow(rnd(i, 11), 2) * 2.6; return { w: Wd[i % Wd.length], h, t: h, al: Math.floor(rnd(i, 5) * 3) } })
    }
    if (due(s, K, 4, 24)) {                       // one row picks a new size (and maybe a new word)
      const k = (s.k = (s.k || 0) + 1), r = s.rows[Math.floor(rnd(k, 1) * R)]
      r.t = 0.25 + Math.pow(rnd(k, 2), 1.6) * (2 + lv * 3)
      if (rnd(k, 3) < 0.5) { s.wi = (s.wi + 1) % Wd.length; r.w = Wd[(s.wi + R) % Wd.length]; r.al = Math.floor(rnd(k, 4) * 3) }
    }
    const sp = 0.08 + lv * 0.15 + K.b[0] * 0.1
    let tot = 0; for (const r of s.rows) { r.h = lerp(r.h, r.t, sp); tot += r.h }
    let y = 0
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic'
    for (const r of s.rows) {
      const rh = r.h / tot * H, fs = rh * 1.34
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, W, rh); ctx.clip()
      ctx.font = fnt(F, fs); ctx.letterSpacing = Math.round((cfg.letter || 0) * fs) + 'px'; const tw = ctx.measureText(r.w).width
      const x = r.al === 0 ? 0 : r.al === 1 ? (W - tw) / 2 : W - tw
      ctx.fillText(r.w, x, y + rh + fs * 0.12); ctx.letterSpacing = '0px'
      ctx.restore()
      y += rh
    }
    ctx.save(); ctx.strokeStyle = LINE; ctx.lineWidth = Math.max(1, H * 0.0012); ctx.beginPath(); y = 0
    for (const r of s.rows) { y += r.h / tot * H; ctx.moveTo(0, y); ctx.lineTo(W, y) }
    ctx.stroke(); ctx.restore()
  }

  // 6 ─ GRID DRIFT
  function griddrift (ctx, f, D, cfg, raw) {
    const W = D.W, H = D.H, s = stateOf(cfg, 'griddrift'), K = drv(s, f, cfg), lv = K.lv
    const F = famOf(cfg), L = linesOf(raw)
    const maxLen = Math.max(...L.map(l => l.length))
    const cols = maxLen + 6, rowsN = L.length * 2 + 3
    const cell = Math.min(W * 0.9 / cols, H * 0.9 / rowsN, H * 0.07 * sizeK(cfg))
    const gx = (W - cols * cell) / 2, gy = (H - rowsN * cell) / 2
    if (!s.lt || s.ltKey !== raw) {
      s.ltKey = raw; s.lt = []
      L.forEach((l, li) => [...l].forEach((c, ci) => { if (c !== ' ') { const hx = 3 + Math.floor((maxLen - l.length) / 2) + ci, hy = 2 + li * 2; s.lt.push({ c, hx, hy, tx: hx, ty: hy, x: hx, y: hy }) } }))
    }
    const stepNow = lv < 0.03 ? ((s.t = (s.t || 0) + 1) % 8 === 0) : due(s, K, 4, 24)   // silence: walk home
    if (stepNow) {
      const k = (s.k = (s.k || 0) + 1), rad = 1 + Math.round(lv * 3)
      s.lt.forEach((p, i) => {
        if (lv > 0.03 && rnd(k, i) < lv * 0.6) {
          const d = rnd(k, i + 500) < 0.5 ? [rnd(k, i + 700) < 0.5 ? -1 : 1, 0] : [0, rnd(k, i + 900) < 0.5 ? -1 : 1]
          p.tx = Math.max(p.hx - rad, Math.min(p.hx + rad, p.tx + d[0])); p.ty = Math.max(p.hy - rad, Math.min(p.hy + rad, p.ty + d[1]))
          p.tx = Math.max(0, Math.min(cols - 1, p.tx)); p.ty = Math.max(0, Math.min(rowsN - 1, p.ty))
        } else { p.tx += Math.sign(p.hx - p.tx); p.ty += Math.sign(p.hy - p.ty) }
      })
    }
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1; ctx.beginPath()
    for (let i = 0; i <= cols; i++) { ctx.moveTo(gx + i * cell, gy); ctx.lineTo(gx + i * cell, gy + rowsN * cell) }
    for (let j = 0; j <= rowsN; j++) { ctx.moveTo(gx, gy + j * cell); ctx.lineTo(gx + cols * cell, gy + j * cell) }
    ctx.stroke(); ctx.restore()
    ctx.font = fnt(F, cell * 1.05); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const ez = 0.2 + K.b[1] * 0.2
    for (const p of s.lt) { p.x = lerp(p.x, p.tx, ez); p.y = lerp(p.y, p.ty, ez); ctx.fillText(p.c, gx + (p.x + 0.5) * cell, gy + (p.y + 0.5) * cell) }
  }

  // 7 ─ SPIKE  (v2, Oct 12 — matched to the POINTS clip)
  // A few points on the letter outline are DRAGGED (liquify-style) into long, smooth, tapered, slightly curved thorns
  // that fan toward a handle □; the shape holds, then a new drag. Pixel warp on a half-res mask, only inside each thorn's box.
  function spike (ctx, f, D, cfg, raw) {
    const W = D.W, H = D.H, s = stateOf(cfg, 'spike'), K = drv(s, f, cfg), lv = K.lv
    const src = stackCanvas(s, raw, cfg, W, H, 0.8)
    ctx.drawImage(src, 0, 0)
    const q = Math.max(1, Math.round(W / 420)), mw = Math.ceil(W / q), mh = Math.ceil(H / q)
    if (!s.mask || s.maskKey !== s.stkKey + '|' + q) {
      s.maskKey = s.stkKey + '|' + q; s.mask = null; s.edge = []
      try {
        const t = s.mc || (s.mc = mk()); const x = fit(t, mw, mh); x.drawImage(src, 0, 0, mw, mh)
        const d = x.getImageData(0, 0, mw, mh).data, M = new Uint8Array(mw * mh)
        for (let i = 0; i < M.length; i++) M[i] = d[i * 4 + 3]
        s.mask = M
        for (let y = 1; y < mh - 1; y += 2) for (let x2 = 1; x2 < mw - 1; x2 += 2) { const i = y * mw + x2; if (M[i] > 128 && (M[i - 1] < 128 || M[i + 1] < 128 || M[i - mw] < 128 || M[i + mw] < 128)) s.edge.push([x2, y]) }
      } catch (e) {}
      s.ov = null
    }
    if (lv < 0.02 || !s.mask || !s.edge.length) { s.sp = null; return }
    if (!s.sp || due(s, K, 8, 40)) {      // new drag: handle jumps, thorns regrow
      const k = (s.k = (s.k || 0) + 1)
      const hx = mw * (0.12 + rnd(k, 1) * 0.76), hy = mh * (rnd(k, 2) < 0.5 ? 0.12 + rnd(k, 3) * 0.25 : 0.63 + rnd(k, 3) * 0.25)
      const n = 2 + Math.round(lv * 4 + rnd(k, 4) * 2)
      s.hd = [hx, hy]; s.sp = []
      for (let i = 0; i < n; i++) {
        const c = s.edge[Math.floor(rnd(k, 100 + i) * s.edge.length)]
        let dx = hx - c[0], dy = hy - c[1]; const dl = Math.hypot(dx, dy) || 1
        const main = i === 0, away = !main && rnd(k, 200 + i) < 0.25
        const a = Math.atan2(dy, dx) + (main ? 0 : (rnd(k, 300 + i) - 0.5) * 0.9) + (away ? Math.PI : 0)
        const len = (main ? dl : dl * (0.35 + rnd(k, 400 + i) * 0.7) * (away ? 0.5 : 1)) * 0.95
        const bend = (rnd(k, 500 + i) - 0.5) * 0.5 * len
        s.sp.push({ c, dx: Math.cos(a) * len, dy: Math.sin(a) * len, bx: -Math.sin(a) * bend, by: Math.cos(a) * bend, r: (s.stkPx || 80) / q * (0.11 + rnd(k, 600 + i) * 0.22), g: 0 })
      }
    }
    // solid, smooth, curved blades (vector) rooted on the outline — reads like the glyph's corner dragged out
    const reach = 0.5 + lv * 0.3 + K.b[0] * 0.3 + K.dv[1] * 0.22
    ctx.save(); ctx.fillStyle = '#fff'; ctx.beginPath()
    for (const p of s.sp) {
      p.g = lerp(p.g, reach * (1 + 0.18 * Math.sin(K.n * 0.21 + p.r)), 0.35)
      const cx = p.c[0] * q, cy = p.c[1] * q, Dx = p.dx * p.g * q, Dy = p.dy * p.g * q, r = p.r * q
      const L = Math.hypot(Dx, Dy) || 1, nx = -Dy / L, ny = Dx / L
      const bx = p.bx * p.g * q, by = p.by * p.g * q
      const tx = cx + Dx + bx * 0.3, ty = cy + Dy + by * 0.3
      const mx = cx + Dx * 0.45 + bx, my = cy + Dy * 0.45 + by
      const ix = cx - Dx / L * r * 0.6, iy = cy - Dy / L * r * 0.6           // root sits inside the letter
      ctx.moveTo(ix + nx * r, iy + ny * r)
      ctx.quadraticCurveTo(mx + nx * r * 0.45, my + ny * r * 0.45, tx, ty)
      ctx.quadraticCurveTo(mx - nx * r * 0.25, my - ny * r * 0.25, ix - nx * r * 0.7, iy - ny * r * 0.7)
      ctx.closePath()
    }
    ctx.fill()
    const hq = (s.stkPx || 80) * 0.2; ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, W * 0.0013)
    const h0 = s.sp[0]; if (h0) ctx.strokeRect((h0.c[0] + h0.dx * h0.g) * q + h0.bx * h0.g * q * 0.3 - hq / 2, (h0.c[1] + h0.dy * h0.g) * q + h0.by * h0.g * q * 0.3 - hq / 2, hq, hq)
    ctx.restore()
  }
  function g0 (v) { return v }

  // 8 ─ LETTER GAP
  function lettergap (ctx, f, D, cfg, raw) {
    const W = D.W, H = D.H, s = stateOf(cfg, 'lettergap'), K = drv(s, f, cfg), lv = K.lv
    s.ph += (0.01 + 0.03 * K.drive + K.b[1] * 0.04 + K.b[2] * 0.03) * (lv > 0.01 ? 1 : 0)
    const Wd = wordsOf(raw), F = famOf(cfg)
    const fs = Math.max(8, H * 0.028 * sizeK(cfg)), rh = fs * 1.12
    const rows = Math.max(Wd.length, Math.floor(H * 0.92 / rh)), y0 = (H - rows * rh) / 2 + rh / 2, x0 = W * 0.06
    ctx.font = fnt(F, fs); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    const mw = s.mw && s.mwKey === ctx.font ? s.mw : (s.mw = {}, s.mwKey = ctx.font, s.mw)
    const maxG = fs * (0.05 + lv * 1.8 + K.b[0] * 0.7)
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = 1
    for (let r = 0; r < rows; r++) {
      const ch = [...Wd[r % Wd.length]], y = y0 + r * rh
      let x = x0
      for (let i = 0; i < ch.length; i++) {
        const c = ch[i]; ctx.fillText(c, x, y); x += (mw[c] || (mw[c] = ctx.measureText(c).width))
        if (i < ch.length - 1) {
          const nz = 0.5 + 0.5 * Math.sin(r * 1.73 + i * 2.31 + s.ph * (1 + ((r * 7 + i * 3) % 5) * 0.35))
          x += fs * (0.04 + (cfg.letter || 0)) + maxG * Math.max(0, nz - 0.5) * 2
        }
      }
      if (lv > 0.01) ctx.strokeRect(x0 - 2, y - rh / 2 + 1, Math.min(W - x0, x - x0 + 4), rh - 2)
    }
    ctx.restore()
  }

  const MODES = { trackwave, bandsquash, shatter, extrude, scalestack, griddrift, spike, lettergap }
  if (typeof window !== 'undefined') window.HVFT_TXFX2 = MODES
})()
