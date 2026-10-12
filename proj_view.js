// HVFT VISION — proj_view.js (Oct 9) — PROJECTOR VIEW: one engine, not two.
// Before: the projector window (output.html) ran a SECOND copy of everything — every channel pipeline, cameras,
// segmenter, BG patterns, ISF, Milkdrop, plus a hidden legacy pipe. On the 8 GB M1 that doubled RAM / GPU load,
// the GPU process crashed (exit 8704) 3× in a minute, Chromium switched the GPU off and the projector went WHITE.
// Now: the projector is an about:blank window opened BY the control page (same process, same origin). It only warps
// the channels the control page already renders (deck_ui.js window.__deckProj) onto the stage with WebGL:
// FILL / CROP per region, draw order MIX → CH4 … CH1 (CH1 on top), channel BLEND + OPACITY where regions overlap,
// MASTER / BLACKOUT, and the MAP EDIT outlines + draggable corners on the real stage.
// Keys on the projector: F = fullscreen · M = map edit · TAB = next region · ESC = close projector.
;(function () {
  if (typeof window === 'undefined') return
  let w = null, st = null, active = false
  const P = () => window.__deckProj
  function log (m) { try { console.error('[HVFT info] PROJECTOR: ' + m) } catch (e) {} }

  // ---------------- WebGL (inside the projector document) ----------------
  const VS = 'attribute vec2 aPos; attribute vec3 aTP; varying vec3 vTP; void main(){ gl_Position = vec4(aPos,0.0,1.0); vTP = aTP; }'
  const FS = 'precision mediump float; varying vec3 vTP; uniform sampler2D uTex; uniform float uA; uniform float uPre;' +
    ' void main(){ vec4 c = texture2DProj(uTex, vTP); c.a *= uA; if (uPre > 0.5) c.rgb *= c.a; gl_FragColor = c; }'
  function initGL (s) {
    const gl = s.cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: false, alpha: false })
    s.gl = gl; s.tex = new WeakMap()
    if (!gl) return false
    const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); return o }
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr)
    s.aPos = gl.getAttribLocation(pr, 'aPos'); s.aTP = gl.getAttribLocation(pr, 'aTP')
    s.uA = gl.getUniformLocation(pr, 'uA'); s.uPre = gl.getUniformLocation(pr, 'uPre')
    s.pb = gl.createBuffer(); s.tb = gl.createBuffer()
    gl.enable(gl.BLEND); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    return true
  }
  function texFor (s, src) {
    const gl = s.gl; let t = s.tex.get(src)
    if (!t) {
      t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      s.tex.set(src, t)
    }
    gl.bindTexture(gl.TEXTURE_2D, t)
    const f = window.HVFT_CRISP ? gl.NEAREST : gl.LINEAR   // CRISP = hard pixels on the stage too
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    return t
  }
  function setBlend (s, mode, op) {
    const gl = s.gl
    gl.uniform1f(s.uA, op == null ? 1 : Math.max(0, Math.min(1, op)))
    if (mode === 'screen') { gl.uniform1f(s.uPre, 1); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR) }
    else if (mode === 'add') { gl.uniform1f(s.uPre, 0); gl.blendFunc(gl.SRC_ALPHA, gl.ONE) }
    else if (mode === 'multiply') { gl.uniform1f(s.uPre, 1); gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA) }
    else { gl.uniform1f(s.uPre, 0); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA) }
  }
  function computeQ (c) {
    const p0 = c[0], p1 = c[1], p2 = c[2], p3 = c[3]
    const d0x = p2[0] - p0[0], d0y = p2[1] - p0[1], d1x = p3[0] - p1[0], d1y = p3[1] - p1[1]
    const den = d0x * d1y - d0y * d1x, q = [1, 1, 1, 1]
    if (Math.abs(den) > 1e-6) {
      const t = ((p1[0] - p0[0]) * d1y - (p1[1] - p0[1]) * d1x) / den
      const I = [p0[0] + t * d0x, p0[1] + t * d0y], D = (a) => Math.hypot(a[0] - I[0], a[1] - I[1])
      const u0 = D(p0), u2 = D(p2), u1 = D(p1), u3 = D(p3)
      if (u0 > 1e-6 && u2 > 1e-6) { q[0] = (u0 + u2) / u2; q[2] = (u0 + u2) / u0 }
      if (u1 > 1e-6 && u3 > 1e-6) { q[1] = (u1 + u3) / u3; q[3] = (u1 + u3) / u1 }
    }
    return q
  }
  const UVB = [[0, 1], [1, 1], [1, 0], [0, 0]], ORDER = [0, 1, 2, 0, 2, 3]
  function fitQuad (W, H, corners, sw, sh, fit) {
    const d = (a, b) => Math.hypot((a[0] - b[0]) * W, (a[1] - b[1]) * H)
    const qw = (d(corners[0], corners[1]) + d(corners[3], corners[2])) / 2, qh = (d(corners[0], corners[3]) + d(corners[1], corners[2])) / 2
    let u0 = 0, u1 = 1, v0 = 0, v1 = 1, cs = corners
    if (sw > 1 && sh > 1 && qw > 1 && qh > 1) {
      const ta = qw / qh, sa = sw / sh
      if (fit === 'contain') {
        let a0 = 0, a1 = 1, b0 = 0, b1 = 1
        if (sa > ta) { const k = ta / sa; b0 = (1 - k) / 2; b1 = 1 - b0 } else { const k = sa / ta; a0 = (1 - k) / 2; a1 = 1 - a0 }
        const Pt = (u, v) => [(1 - u) * (1 - v) * corners[0][0] + u * (1 - v) * corners[1][0] + u * v * corners[2][0] + (1 - u) * v * corners[3][0], (1 - u) * (1 - v) * corners[0][1] + u * (1 - v) * corners[1][1] + u * v * corners[2][1] + (1 - u) * v * corners[3][1]]
        cs = [Pt(a0, b0), Pt(a1, b0), Pt(a1, b1), Pt(a0, b1)]
      } else if (sa > ta) { const k = ta / sa; u0 = (1 - k) / 2; u1 = 1 - u0 } else { const k = sa / ta; v0 = (1 - k) / 2; v1 = 1 - v0 }
    }
    return { cs, u0, u1, v0, v1 }
  }
  function drawQuad (s, corners, sw, sh, fit) {
    const gl = s.gl, F = fitQuad(s.cv.width, s.cv.height, corners, sw, sh, fit || 'cover'), c = F.cs
    const q = computeQ(c), pos = [], tp = []
    for (const i of ORDER) { const U = F.u0 + UVB[i][0] * (F.u1 - F.u0), V = F.v0 + UVB[i][1] * (F.v1 - F.v0); pos.push(c[i][0] * 2 - 1, 1 - c[i][1] * 2); tp.push(U * q[i], V * q[i], q[i]) }
    gl.bindBuffer(gl.ARRAY_BUFFER, s.pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(s.aPos); gl.vertexAttribPointer(s.aPos, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, s.tb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tp), gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(s.aTP); gl.vertexAttribPointer(s.aTP, 3, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
  const order = (regs) => { const key = r => r.src === 'main' ? 0 : r.src === 'dl' ? 1 + (3 - Math.min(3, r.dlIdx | 0)) : 5; return regs.map((r, i) => [r, i]).sort((a, b) => (key(a[0]) - key(b[0])) || (a[1] - b[1])) }
  const bbox = c => { const xs = c.map(p => p[0]), ys = c.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }
  function overlaps (c, list) { const A = bbox(c), aA = Math.max(1e-6, (A[2] - A[0]) * (A[3] - A[1])); for (const o of list) { const B = bbox(o), x = Math.min(A[2], B[2]) - Math.max(A[0], B[0]), y = Math.min(A[3], B[3]) - Math.max(A[1], B[1]); if (x > 0 && y > 0 && x * y / aA > 0.05) return true } return false }

  // ---------------- frame ----------------
  function frame () {
    if (!active || !w || w.closed) { stop(); return }
    st.raf = w.requestAnimationFrame(frame)
    const D = P(); if (!D) return
    const dpr = Math.min(2, w.devicePixelRatio || 1)
    const W = Math.max(2, Math.round(w.innerWidth * dpr)), H = Math.max(2, Math.round(w.innerHeight * dpr))
    if (st.cv.width !== W || st.cv.height !== H) { st.cv.width = W; st.cv.height = H; st.ov.width = W; st.ov.height = H }
    // stage size -> control (channels render in the stage's shape)
    const sig = W + 'x' + H
    if (sig !== st.sig) { st.sig = sig; try { D.applyStage({ w: W, h: H, aspect: W / H, dpr, sw: Math.round(w.screen.width * dpr), sh: Math.round(w.screen.height * dpr), full: (w.innerWidth >= w.screen.width - 2 && w.innerHeight >= w.screen.height - 2) }, false) } catch (e) {} }
    if (!st.gl || st.lost) { if (!st.lost && (++st.retry % 60 === 0)) initGL(st); drawOverlay(D, W, H, true); return }
    const gl = st.gl
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT)
    const cl = (D.comp && D.comp.layers) || [], drawn = []
    for (const [r] of order(D.regions())) {
      let src = null, Lc = null
      if (r.src === 'dl') { for (let k = 0; k < cl.length; k++) if (cl[k] && (cl[k]._li | 0) === (r.dlIdx | 0)) { src = D.comp.getLayerCanvas(k); Lc = cl[k]; break } }
      else if (r.src === 'main') src = D.mix()
      if (!src || !(src.width > 2)) continue   // channel OFF / not running -> its area stays black
      try {
        texFor(st, src)
        if (Lc && overlaps(r.corners, drawn)) setBlend(st, Lc.blend || 'normal', Lc.opacity); else setBlend(st, 'normal', 1)
        drawQuad(st, r.corners, src.width, src.height, r.fit)
        drawn.push(r.corners)
      } catch (e) {}
    }
    setBlend(st, 'normal', 1)
    drawOverlay(D, W, H, false)
  }
  // MASTER fade / BLACKOUT + MAP EDIT outlines on the real stage
  function drawOverlay (D, W, H, noGL) {
    const x = st.ox; x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H)
    // ⚡ CHAOS (chaos_fx.js): brightness / contrast / invert on the stage picture + white flash; MASTER black goes on top
    const C = window.HVFT_CHAOS && window.HVFT_CHAOS.s
    if (C) { const f = C.filter || ''; if (st.cv.style.filter !== f) st.cv.style.filter = f; if (C.white > 0.004) { x.globalAlpha = Math.min(1, C.white); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.globalAlpha = 1 } }
    const m = (window.HVFT_MASTER && typeof window.HVFT_MASTER.level === 'number') ? window.HVFT_MASTER.level : 1
    if (m < 0.999) { x.globalAlpha = 1 - Math.max(0, m); x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.globalAlpha = 1 }
    if (noGL) { x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.fillStyle = '#F2A03D'; x.font = '700 ' + Math.round(H / 40) + 'px monospace'; x.textAlign = 'center'; x.fillText(st.lost ? 'GPU RESTARTING…' : 'WAITING FOR GPU…', W / 2, H / 2) }
    const edit = D.mapEdit
    st.cv.style.cursor = st.ov.style.cursor = edit ? 'crosshair' : 'none'
    if (!edit) return
    const regs = D.regions(), sc = Math.max(1, W / 1280)
    regs.forEach((r, ri) => {
      const p = r.corners.map(q => [q[0] * W, q[1] * H]), isS = ri === D.sel
      x.beginPath(); x.moveTo(p[0][0], p[0][1]); for (let i = 1; i < 4; i++) x.lineTo(p[i][0], p[i][1]); x.closePath()
      x.lineWidth = (isS ? 3 : 1.5) * sc; x.strokeStyle = isS ? '#F2A03D' : 'rgba(232,232,232,.6)'; if (!isS) x.setLineDash([8 * sc, 6 * sc]); x.stroke(); x.setLineDash([])
      const cx = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4, cy = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '900 ' + Math.round(22 * sc) + 'px monospace'; x.fillStyle = isS ? '#F2A03D' : 'rgba(232,232,232,.85)'
      x.fillText('R' + (ri + 1) + ' · ' + (D.regionName ? D.regionName(r) : ''), cx, cy)
      if (isS) p.forEach((q, i) => { x.beginPath(); x.arc(q[0], q[1], 12 * sc, 0, 7); x.fillStyle = 'rgba(242,160,61,.35)'; x.fill(); x.lineWidth = 2 * sc; x.strokeStyle = '#F2A03D'; x.stroke(); x.fillStyle = '#fff'; x.font = '700 ' + Math.round(11 * sc) + 'px monospace'; x.fillText(String(i + 1), q[0], q[1]) })
    })
    x.textAlign = 'left'; x.font = '700 ' + Math.round(12 * sc) + 'px monospace'; x.fillStyle = '#F2A03D'
    x.fillText('MAP EDIT ON STAGE · DRAG CORNER / BODY · TAB NEXT · M = DONE · F = FULLSCREEN', 16 * sc, 22 * sc)
  }

  // ---------------- open / close ----------------
  function buildDoc () {
    const d = w.document
    d.title = 'HVFT VISION — PROJECTOR'
    d.body.innerHTML = ''
    const css = d.createElement('style')
    css.textContent = 'html,body{margin:0;height:100%;background:#000;overflow:hidden} canvas{position:fixed;left:0;top:0;width:100vw;height:100vh;display:block;cursor:none}'
    d.head.appendChild(css)
    const cv = d.createElement('canvas'), ov = d.createElement('canvas')
    d.body.appendChild(cv); d.body.appendChild(ov)
    st = { cv, ov, ox: ov.getContext('2d'), gl: null, lost: false, retry: 0, sig: '', raf: 0, drag: null }
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); st.lost = true; log('GPU context lost — waiting for it to come back') }, false)
    cv.addEventListener('webglcontextrestored', () => { st.lost = false; initGL(st); log('GPU context restored') }, false)
    if (!initGL(st)) log('no WebGL yet — retrying')
    // keys
    w.addEventListener('keydown', (e) => {
      const k = (e.key || '').toLowerCase(), D = P()
      if (k === 'f') { try { window.hvft && window.hvft.outputFullscreen && window.hvft.outputFullscreen() } catch (er) {} }
      else if (k === 'escape') { if (D && D.mapEdit) D.toggleEdit(false); else close() }
      else if (k === 'm' && D) D.toggleEdit()
      else if (k === 'tab' && D && D.mapEdit) { const n = D.regions().length; D.select(((D.sel + (e.shiftKey ? -1 : 1)) % n + n) % n); e.preventDefault() }
    })
    // drag corners / body right on the stage (MAP EDIT)
    const toN = (e) => [e.clientX / Math.max(1, w.innerWidth), e.clientY / Math.max(1, w.innerHeight)]
    ov.addEventListener('pointerdown', (e) => {
      const D = P(); if (!D || !D.mapEdit) return
      const [x, y] = toN(e), regs = D.regions(), W = w.innerWidth, H = w.innerHeight
      let best = null, bd = 1e9
      regs.forEach((r, ri) => r.corners.forEach((p, ci) => { const dd = Math.hypot((p[0] - x) * W, (p[1] - y) * H); if (dd < bd) { bd = dd; best = [ri, ci] } }))
      if (best && bd <= 24) { D.select(best[0]); st.drag = { ri: best[0], ci: best[1] } }
      else {
        for (let ri = regs.length - 1; ri >= 0; ri--) { const c = regs[ri].corners; let ins = false; for (let i = 0, j = 3; i < 4; j = i++) { if (((c[i][1] > y) !== (c[j][1] > y)) && (x < (c[j][0] - c[i][0]) * (y - c[i][1]) / ((c[j][1] - c[i][1]) || 1e-9) + c[i][0])) ins = !ins } if (ins) { D.select(ri); st.drag = { ri, body: true, x, y, orig: c.map(p => p.slice()) }; break } }
      }
      try { ov.setPointerCapture(e.pointerId) } catch (er) {}
    })
    ov.addEventListener('pointermove', (e) => {
      const D = P(); if (!D || !st.drag) return
      const [x, y] = toN(e), r = D.regions()[st.drag.ri]; if (!r) return
      if (st.drag.body) D.setCorners(st.drag.ri, st.drag.orig.map(p => [p[0] + x - st.drag.x, p[1] + y - st.drag.y]))
      else { const cs = r.corners.map(p => p.slice()); cs[st.drag.ci] = [x, y]; D.setCorners(st.drag.ri, cs) }
    })
    ov.addEventListener('pointerup', () => { st.drag = null })
    w.addEventListener('beforeunload', () => { active = false })
  }
  async function open (displayId) {
    if (active && w && !w.closed) { focus(); return true }
    try { if (window.hvft && window.hvft.projPrepare) await window.hvft.projPrepare(displayId) } catch (e) {}
    w = window.open('about:blank', 'hvftproj')
    if (!w) { log('window.open blocked -> legacy output window'); return false }
    active = true
    try { buildDoc() } catch (e) { log('build failed: ' + e.message); try { w.close() } catch (er) {} active = false; return false }
    st.raf = w.requestAnimationFrame(frame)
    log('open (shared engine)')
    return true
  }
  function stop () {
    if (!active && !w) return
    active = false
    try { if (st && st.raf && w) w.cancelAnimationFrame(st.raf) } catch (e) {}
    w = null
    try { if (window.__deckStage && window.__deckStage.refresh) window.__deckStage.refresh() } catch (e) {}   // back to the light preview size
    try { const el = document.getElementById('outRes'); if (el) el.textContent = (el.textContent || '').replace(/ · (FULLSCREEN|WINDOW.*)$/, '') + ' · PROJECTOR CLOSED' } catch (e) {}
  }
  function close () { try { if (w && !w.closed) w.close() } catch (e) {} stop() }
  function focus () { try { if (w && !w.closed) w.focus() } catch (e) {} }
  setInterval(() => { if (active && (!w || w.closed)) stop() }, 1000)
  window.addEventListener('beforeunload', () => close())   // control page reloads -> the projector it draws must not stay orphaned
  window.HVFT_PROJ = { open, close, focus, get active () { return !!(active && w && !w.closed) } }
})()
