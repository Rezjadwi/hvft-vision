// HVFT VISION — output.js (proyektor) · MULTI-REGION corner-pin
// Pipeline utama -> #view (hidden). #map (WebGL) menggambar N region, tiap region
// = quad ter-warp + sumber sendiri: 'main' (mix pipeline) atau media (logo/video).
// Simpan/muat regions ke userData/mapping.json via IPC. Edit di layar proyektor.

const params = new URLSearchParams(location.search)
const deviceId = params.get('deviceId') || null
const view = document.getElementById('view')
const pipe = new HvftPipeline(view)

// ---- DECK (komposisi berlapis) sebagai sumber 'main' ----
let outDeck = null, compActive = false
function ensureDeck () {
  if (outDeck || typeof LayerComp === 'undefined') return outDeck
  const [ow, oh] = deckSizeFor(stageAspect())
  const dc = document.createElement('canvas'); dc.width = ow; dc.height = oh
  outDeck = new LayerComp(dc); outDeck.setSize(ow, oh); outDeck._aspect = stageAspect()
  if (window.HVFT_MIC_ON) outDeck.setMicOn(true)   // layer pipes (BG PATTERN, effects) capture the mic too
  return outDeck
}
if (window.hvft && window.hvft.onComp) window.hvft.onComp(c => {
  ensureDeck(); if (!outDeck) return
  compActive = Array.isArray(c) && c.length > 0
  outDeck.setLayers(c || [])
})

// ---- STAGE RESOLUTION (Oct 9): read the real output size, render the channels in THAT shape (no stretching) ----
function stageAspect () { const w = window.innerWidth || 1280, h = window.innerHeight || 720; return Math.max(0.25, Math.min(5, w / Math.max(1, h))) }
function deckSizeFor (a) {   // long side <= 1600 (or the projector width), keeps the stage aspect
  const L = Math.min(1600, OUT_RES)
  return a >= 1 ? [L, Math.max(64, Math.round(L / a))] : [Math.max(64, Math.round(Math.min(1200, L) * a)), Math.min(1200, L)]
}
let _outSig = ''
function reportStage (force) {
  const dpr = window.devicePixelRatio || 1, a = stageAspect()
  if (outDeck && Math.abs((outDeck._aspect || 0) - a) > 0.004) { const [w, h] = deckSizeFor(a); outDeck.setSize(w, h); outDeck._aspect = a }
  const info = { w: Math.round((window.innerWidth || 0) * dpr), h: Math.round((window.innerHeight || 0) * dpr), aspect: a, dpr, sw: Math.round(screen.width * dpr), sh: Math.round(screen.height * dpr), full: (window.innerWidth >= screen.width - 2 && window.innerHeight >= screen.height - 2) }
  const sig = info.w + 'x' + info.h + ':' + info.full
  if (!force && sig === _outSig) return
  _outSig = sig
  try { if (window.hvft && window.hvft.outInfo) window.hvft.outInfo(info) } catch (e) {}
}
window.addEventListener('resize', () => setTimeout(() => reportStage(false), 60))
setInterval(() => reportStage(false), 1000)
setTimeout(() => reportStage(true), 300)

// resolusi kerja mendekati lebar proyektor -> tajam saat fullscreen
const OUT_RES = Math.max(1280, Math.min(1920, Math.round((window.innerWidth || 1280) * Math.min(2, window.devicePixelRatio || 1))))
// FIT bidang: 'cover' = FILL (penuhi bidang, sisi lebih dipotong) · 'contain' = CROP/FIT (media utuh, ada bar kosong)
let mainFit = 'cover'
;(async () => {
  pipe.settings.fit = mainFit
  pipe.settings.res = OUT_RES
  try { if (deviceId && deviceId.indexOf('hvftcam:') === 0) await pipe.startNetworkCamera(deviceId.slice(8)); else await pipe.startCamera(deviceId || undefined) }
  catch (e) { try { await pipe.startCamera(null) } catch (e2) {} }
  pipe.start()
  await pipe.initModel()
  // TIDAK auto-tangkap mic. Menyala hanya kalau control mengirim micOn (gerbang global).
})()

let lastCtrlSettings = null
let ctrlLayers = null
const lineEls = {}
function lineEl (idx) {
  const L = ctrlLayers && ctrlLayers[idx]
  if (!L || !L.url || L.kind === 'none' || L.visible === false) return null
  let rec = lineEls[idx]
  if (!rec || rec.url !== L.url) {
    let el
    if (L.kind === 'video') { el = document.createElement('video'); el.src = L.url; el.loop = true; el.muted = true; el.autoplay = true; el.playsInline = true; el.play().catch(() => {}) }
    else { el = new Image(); el.src = L.url }
    rec = { url: L.url, el }; lineEls[idx] = rec
  }
  return rec.el
}
function applyCtrlTo (pp, keepEffect) {
  if (!lastCtrlSettings) return
  const eff = pp.settings.effect
  const res = pp.settings.res
  const fit = pp.settings.fit || 'cover'      // jangan timpa FILL/CROP per bidang
  Object.assign(pp.settings, lastCtrlSettings)
  pp.settings.fit = fit
  pp.settings.res = res || 1280
  if (keepEffect) pp.settings.effect = eff
}
if (window.hvft) {
  window.hvft.onSettings(s => {
    const layers = s.layers; delete s.layers
    if (s.pcOpt && typeof window !== 'undefined') window.HVFT_PC_OPT = s.pcOpt
    if (typeof s.depthColor !== 'undefined' && typeof window !== 'undefined') { window.HVFT_DEPTH_RGB = (s.depthColor === 'rgb'); window.HVFT_DEPTH_PLEXUS = (s.depthColor === 'plexus'); window.HVFT_DEPTH_THERMAL = (s.depthColor === 'thermal'); window.HVFT_DEPTH_DISPLACE = (s.depthColor === 'displace'); window.HVFT_DEPTH_KEY = (s.depthColor === 'key'); window.HVFT_DEPTH_IR = (s.depthColor === 'ir'); window.HVFT_DEPTH_CONTOUR = (s.depthColor === 'contour') }   // WARNA Depth-AI RGB / PLEXUS / TERMAL / DISPLACE juga di proyektor
    if (s.plexusOpt && typeof window !== 'undefined') window.HVFT_PLEXUS_OPT = s.plexusOpt   // opsi jaring plexus ke proyektor
    if (s.displaceOpt && typeof window !== 'undefined') window.HVFT_DISPLACE_OPT = s.displaceOpt   // opsi displace ke proyektor
    if (s.master && typeof window !== 'undefined') window.HVFT_MASTER = s.master   // fade/blackout master ke proyektor
    // GERBANG MIC dari control -> nyalakan/matikan tangkap mic di proyektor (utama + region)
    if (typeof window !== 'undefined') {
      const want = !!s.micOn
      if (want !== !!window.HVFT_MIC_ON) {
        window.HVFT_MIC_ON = want
        if (want) { pipe.startAudio().catch(() => {}); for (const r of regions) if (r.pipe) r.pipe.startAudio().catch(() => {}) }
        else { if (pipe.stopAudio) pipe.stopAudio(); for (const r of regions) if (r.pipe && r.pipe.stopAudio) r.pipe.stopAudio() }
        if (outDeck && outDeck.setMicOn) outDeck.setMicOn(want)   // deck layers in the projector react too
      }
    }
    // AUDIO INPUT from control (USB interface / IN 1-2 / trim) -> reopen every listening pipe in the projector
    if (s.audioIn && typeof window !== 'undefined' && s.audioIn.v !== window._hvftAinV) {
      const first = window._hvftAinV == null; window._hvftAinV = s.audioIn.v
      try { if (window.HVFT_AUDIO_IN) window.HVFT_AUDIO_IN.save(s.audioIn) } catch (e) {}
      if (!first && window.HVFT_MIC_ON) {
        try { pipe.restartAudio().catch(() => {}) } catch (e) {}
        for (const r of regions) if (r.pipe && r.pipe.restartAudio) r.pipe.restartAudio().catch(() => {})
        try { if (outDeck && outDeck.restartAudio) outDeck.restartAudio() } catch (e) {}
      }
    }
    if (s.regionPreset && s.regionPreset !== _lastPreset) { _lastPreset = s.regionPreset; if (String(s.regionPreset).indexOf('grid2x2') === 0) presetGrid2x2() }   // preset tata letak dari control
    if (layers) ctrlLayers = layers
    lastCtrlSettings = Object.assign({}, s)
    Object.assign(pipe.settings, s); pipe.settings.fit = mainFit; pipe.settings.res = OUT_RES
    for (const r of regions) { if (r.pipe) applyCtrlTo(r.pipe, true) }
    if (!layers) return
    layers.forEach((L, i) => {
      if (!pipe.layers[i]) return
      const cur = pipe.layers[i]
      if (L.kind !== cur.kind || L.url !== cur.url) pipe.setLayerClip(i, L.kind, L.url)
      pipe.setLayerParams(i, { opacity: L.opacity, scale: L.scale, x: L.x, y: L.y, blend: L.blend, visible: L.visible })
    })
  })
}
if (window.hvft && window.hvft.onDepthFrame) window.hvft.onDepthFrame(f => {
  const isAi = !!f.ai
  if (outDeck) outDeck.pushDepth(f)
  const k = pipe.layers[0].kind
  // hanya terima frame yang cocok dengan sumbernya (AI vs LiDAR) supaya tidak saling timpa
  if ((k === 'depthai' && isAi) || (k === 'lidar' && !isAi)) pipe.pushLidarFrame(f, !isAi)
  for (const r of regions) {
    if (!r.pipe) continue
    if (r.src === 'depthai' && isAi) r.pipe.pushLidarFrame(f, false)
    else if (r.src === 'lidar' && !isAi) r.pipe.pushLidarFrame(f, true)
    if (r.src === 'pc3d' && r.pcGpu) r.pcGpu.pushFrame(f)
  }
})
// Depth-AI hanya jalan kalau control menyalakannya — minta otomatis saat ada region DEPTH-AI
let aiReq = null
function syncAiRequest () {
  const need = regions.some(r => r.src === 'depthai')
  if (need === aiReq) return
  aiReq = need
  if (window.hvft && window.hvft.requestAiDepth) window.hvft.requestAiDepth(need)
}
setInterval(syncAiRequest, 1500)

// ===================== MULTI-REGION MAP (WebGL) =====================
const map = document.getElementById('map')
const gl = map.getContext('webgl', { antialias: true, preserveDrawingBuffer: false })
// GPU gone (crash / switched off by Chromium) -> no WebGL: stay black and retry instead of dying on a white window
if (!gl) { try { document.body.style.background = '#000'; console.error('[HVFT info] OUTPUT: no WebGL (GPU down) -> retry in 4 s') } catch (e) {} setTimeout(() => location.reload(), 4000); throw new Error('HVFT output: no WebGL') }
map.addEventListener('webglcontextlost', (e) => { e.preventDefault(); try { console.error('[HVFT info] OUTPUT: GPU context lost -> reload when it is back') } catch (er) {} }, false)
map.addEventListener('webglcontextrestored', () => { location.reload() }, false)
gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

// region: { corners:[[x,y]x4 TL,TR,BR,BL], src:'main'|'media', url, kind, el, tex }
let regions = [{ corners: [[0, 0], [1, 0], [1, 1], [0, 1]], src: 'main', url: '', kind: '', el: null, tex: null }]
let sel = 0

const VS = `attribute vec2 aPos; attribute vec3 aTP; varying vec3 vTP;
  void main(){ gl_Position = vec4(aPos,0.0,1.0); vTP = aTP; }`
const FS = `precision mediump float; varying vec3 vTP; uniform sampler2D uTex; uniform float uA; uniform float uPre;
  void main(){ vec4 c = texture2DProj(uTex, vTP); c.a *= uA; if (uPre > 0.5) c.rgb *= c.a; gl_FragColor = c; }`
function mkSh (t, src) { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s }
const prog = gl.createProgram()
gl.attachShader(prog, mkSh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, mkSh(gl.FRAGMENT_SHADER, FS))
gl.linkProgram(prog); gl.useProgram(prog)
const aPos = gl.getAttribLocation(prog, 'aPos'), aTP = gl.getAttribLocation(prog, 'aTP')
const uA = gl.getUniformLocation(prog, 'uA'), uPre = gl.getUniformLocation(prog, 'uPre')
gl.uniform1f(uA, 1); gl.uniform1f(uPre, 0)
// channel BLEND on the projector when mapped channels overlap (same look as the MIX): normal / screen / add / multiply
function setBlend (mode, op) {
  gl.uniform1f(uA, op == null ? 1 : Math.max(0, Math.min(1, op)))
  if (mode === 'screen') { gl.uniform1f(uPre, 1); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR) }
  else if (mode === 'add') { gl.uniform1f(uPre, 0); gl.blendFunc(gl.SRC_ALPHA, gl.ONE) }
  else if (mode === 'multiply') { gl.uniform1f(uPre, 1); gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA) }
  else { gl.uniform1f(uPre, 0); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA) }
}
const posBuf = gl.createBuffer(), tpBuf = gl.createBuffer()
function mkTex () {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  return t
}
const mainTex = mkTex()

function computeQ (c) {
  const p0 = c[0], p1 = c[1], p2 = c[2], p3 = c[3]
  const d0x = p2[0] - p0[0], d0y = p2[1] - p0[1], d1x = p3[0] - p1[0], d1y = p3[1] - p1[1]
  const den = d0x * d1y - d0y * d1x, q = [1, 1, 1, 1]
  if (Math.abs(den) > 1e-6) {
    const t = ((p1[0] - p0[0]) * d1y - (p1[1] - p0[1]) * d1x) / den
    const I = [p0[0] + t * d0x, p0[1] + t * d0y]
    const D = (a) => Math.hypot(a[0] - I[0], a[1] - I[1])
    const u0 = D(p0), u2 = D(p2), u1 = D(p1), u3 = D(p3)
    if (u0 > 1e-6 && u2 > 1e-6) { q[0] = (u0 + u2) / u2; q[2] = (u0 + u2) / u0 }
    if (u1 > 1e-6 && u3 > 1e-6) { q[1] = (u1 + u3) / u3; q[3] = (u1 + u3) / u1 }
  }
  return q
}
const UVB = [[0, 1], [1, 1], [1, 0], [0, 0]], ORDER = [0, 1, 2, 0, 2, 3]
// FIT (Oct 9): FILL = cover (edges cropped), CROP = contain (whole picture, black bars). The quad's real shape in
// pixels is compared with the source's shape, so nothing is ever stretched — only the corner warp you set yourself.
function fitQuad (corners, sw, sh, fit) {
  const W = map.width || 1, H = map.height || 1
  const d = (a, b) => Math.hypot((a[0] - b[0]) * W, (a[1] - b[1]) * H)
  const qw = (d(corners[0], corners[1]) + d(corners[3], corners[2])) / 2, qh = (d(corners[0], corners[3]) + d(corners[1], corners[2])) / 2
  let u0 = 0, u1 = 1, v0 = 0, v1 = 1, cs = corners
  if (sw > 1 && sh > 1 && qw > 1 && qh > 1) {
    const ta = qw / qh, sa = sw / sh
    if (fit === 'contain') {
      let a0 = 0, a1 = 1, b0 = 0, b1 = 1
      if (sa > ta) { const k = ta / sa; b0 = (1 - k) / 2; b1 = 1 - b0 } else { const k = sa / ta; a0 = (1 - k) / 2; a1 = 1 - a0 }
      const P = (u, v) => [(1 - u) * (1 - v) * corners[0][0] + u * (1 - v) * corners[1][0] + u * v * corners[2][0] + (1 - u) * v * corners[3][0], (1 - u) * (1 - v) * corners[0][1] + u * (1 - v) * corners[1][1] + u * v * corners[2][1] + (1 - u) * v * corners[3][1]]
      cs = [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)]
    } else {
      if (sa > ta) { const k = ta / sa; u0 = (1 - k) / 2; u1 = 1 - u0 } else { const k = sa / ta; v0 = (1 - k) / 2; v1 = 1 - v0 }
    }
  }
  return { cs, u0, u1, v0, v1 }
}
function drawQuad (corners, sw, sh, fit) {
  const F = fitQuad(corners, sw || 0, sh || 0, fit || 'cover'); corners = F.cs
  const q = computeQ(corners), pos = [], tp = []
  for (const i of ORDER) { const U = F.u0 + UVB[i][0] * (F.u1 - F.u0), V = F.v0 + UVB[i][1] * (F.v1 - F.v0); pos.push(corners[i][0] * 2 - 1, 1 - corners[i][1] * 2); tp.push(U * q[i], V * q[i], q[i]) }
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ARRAY_BUFFER, tpBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tp), gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(aTP); gl.vertexAttribPointer(aTP, 3, gl.FLOAT, false, 0, 0)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
}
function srcReady (el) { return el && (el.videoWidth > 0 || (el.naturalWidth || 0) > 0 || el.width > 0) }

// ---- kamera untuk region 'cam' (sumber+efek sendiri per-region) ----
let outCams = []
async function loadCams () { try { const ds = await navigator.mediaDevices.enumerateDevices(); outCams = ds.filter(d => d.kind === 'videoinput') } catch (e) {} }
loadCams()
const EFF_IDS = (typeof HVFT_EFFECTS !== 'undefined') ? HVFT_EFFECTS.map(e => e.id) : ['pointcloud']
function ensureRegionPipe (r) {
  if (!r.pipe) {
    r.rcv = document.createElement('canvas')
    r.rcv.style.cssText = 'position:absolute;left:-99999px;top:0;width:1280px;height:720px;visibility:hidden'
    document.body.appendChild(r.rcv)
    r.pipe = new HvftPipeline(r.rcv)
    r.pipe.settings.fit = r.fit || 'cover'
    r.pipe.settings.res = 1280
    r.pipe.settings.effect = r.effect || 'pointcloud'
    r._base = ''; r._effect = r.pipe.settings.effect
    r.pipe.start()
    r.pipe.initModel().catch(() => {})
    if (window.HVFT_MIC_ON) r.pipe.startAudio().catch(() => {})   // tangkap mic hanya bila gerbang global nyala
    applyCtrlTo(r.pipe, true)
  }
  if (r.src === 'cam') {
    const key = 'cam:' + (r.camIdx | 0)
    if (r._base !== key) { r._base = key; r.pipe.setLayerClip(0, 'camera', ''); const c = outCams[r.camIdx | 0]; r.pipe.startCamera(c ? c.deviceId : null).catch(() => {}) }
  } else if (r.src === 'media') {
    const key = 'media:' + r.url
    if (r._base !== key && r.url) { r._base = key; const kind = r.kind || (isVid(r.url) ? 'video' : 'image'); r.pipe.setLayerClip(0, kind, r.url) }
  } else if (r.src === 'lidar' || r.src === 'depthai') {
    if (r._base !== r.src) { r._base = r.src; r.pipe.setLayerClip(0, r.src, '') }
  } else if (r.src === 'pc3d') {
    if (!r.pcGpu && window.PointCloudGPU) {
      r.pcOut = document.createElement('canvas'); r.pcOut.width = 1280; r.pcOut.height = 720
      r.pcOut.style.cssText = 'position:absolute;left:-99999px;top:0'
      document.body.appendChild(r.pcOut)
      r.pcCtx = r.pcOut.getContext('2d', { willReadFrequently: true })
      try { r.pcGpu = new PointCloudGPU(document.createElement('canvas'), { noGL: true }) } catch (e) { r.pcGpu = null }
    }
    if (r.pcGpu) {
      if (r._base !== 'pc3d') { r._base = 'pc3d'; r.pipe.setLayerClip(0, 'pc3d', ''); r.pipe.setExternalCanvas(r.pcOut) }
      r.pcGpu.setAudio(r.pipe.band ? (r.pipe.band[0] || 0) : 0, r.pipe.onset || 0)
      r.pcGpu.renderCPU(r.pcCtx)
    }
  }
  if (r.effect && r._effect !== r.effect) { r._effect = r.effect; r.pipe.settings.effect = r.effect }
  const wantFit = r.fit || 'cover'                                    // FILL/CROP per bidang, jaga tiap frame
  if (r.pipe.settings.fit !== wantFit) r.pipe.settings.fit = wantFit
}

// DRAW ORDER (Oct 9) = the deck's: MIX regions at the bottom, then CH4 .. CH1 (CH1 on top), then media / logo overlays
function regionsInDrawOrder () {
  const key = r => r.src === 'main' ? 0 : r.src === 'dl' ? 1 + (3 - Math.min(3, r.dlIdx | 0)) : 5
  return regions.map((r, i) => [r, i]).sort((a, b) => (key(a[0]) - key(b[0])) || (a[1] - b[1])).map(x => x[0])
}
function bboxOf (c) { const xs = c.map(p => p[0]), ys = c.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }
function overlapsAny (c, list) {
  const A = bboxOf(c), aA = Math.max(1e-6, (A[2] - A[0]) * (A[3] - A[1]))
  for (const o of list) { const B = bboxOf(o); const w = Math.min(A[2], B[2]) - Math.max(A[0], B[0]), h = Math.min(A[3], B[3]) - Math.max(A[1], B[1]); if (w > 0 && h > 0 && w * h / aA > 0.05) return true }
  return false
}
function drawMap () {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = map.clientWidth * dpr | 0, h = map.clientHeight * dpr | 0
  if (map.width !== w || map.height !== h) { map.width = w; map.height = h }
  gl.viewport(0, 0, map.width, map.height)
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT)
  // upload main sekali
  // sumber 'main' = deck komposisi bila aktif, kalau tidak pakai pipe lama
  let mainSrc = view
  if (compActive && outDeck) {
    if (lastCtrlSettings) outDeck.setControl(lastCtrlSettings)
    outDeck.setAudio(pipe.band || [0, 0, 0], pipe.onset || 0, pipe.tick || 0)
    outDeck.render()
    mainSrc = outDeck.out
  }
  let mainOk = mainSrc.width > 0 && mainSrc.height > 0
  if (mainOk) { gl.bindTexture(gl.TEXTURE_2D, mainTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mainSrc) }
  const drawn = []
  for (const r of regionsInDrawOrder()) {
    let tex = null, sw = 0, sh = 0, Lc = null
    if (r.src === 'main') { if (mainOk) { tex = mainTex; sw = mainSrc.width; sh = mainSrc.height } }
    else if (r.src === 'logo') { if (r.logoEl && r.logoEl.complete && (r.logoEl.naturalWidth || 0) > 0) { if (!r.tex) r.tex = mkTex(); gl.bindTexture(gl.TEXTURE_2D, r.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, r.logoEl); tex = r.tex } }
    else if (r.src === 'l2' || r.src === 'l3') { const el = lineEl(r.src === 'l2' ? 1 : 2); if (srcReady(el)) { if (!r.tex) r.tex = mkTex(); gl.bindTexture(gl.TEXTURE_2D, r.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el); tex = r.tex } }
    else if (r.src === 'dl') { // dlIdx = INDEKS KANAL (CH) via _li, stabil walau kanal OFF berubah
      let lcv = null
      if (compActive && outDeck && outDeck.getLayerCanvas) { const cl = outDeck.layers || []; for (let k = 0; k < cl.length; k++) { if (cl[k] && (cl[k]._li | 0) === (r.dlIdx | 0)) { lcv = outDeck.getLayerCanvas(k); break } } }
      if (compActive && outDeck) { const cl = outDeck.layers || []; for (let k = 0; k < cl.length; k++) if (cl[k] && (cl[k]._li | 0) === (r.dlIdx | 0)) { Lc = cl[k]; break } }
      if (lcv && lcv.width > 0) { if (!r.tex) r.tex = mkTex(); gl.bindTexture(gl.TEXTURE_2D, r.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lcv); tex = r.tex; sw = lcv.width; sh = lcv.height } }
    else if (r.src === 'cam' || r.src === 'media' || r.src === 'lidar' || r.src === 'depthai' || r.src === 'pc3d') { ensureRegionPipe(r); if (r.rcv && r.rcv.width > 0 && r.rcv.height > 0) { if (!r.tex) r.tex = mkTex(); gl.bindTexture(gl.TEXTURE_2D, r.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, r.rcv); tex = r.tex } }
    if (!tex) continue
    if (!sw) { const e = (r.src === 'logo') ? r.logoEl : (r.src === 'l2' || r.src === 'l3') ? lineEl(r.src === 'l2' ? 1 : 2) : r.rcv; if (e) { sw = e.videoWidth || e.naturalWidth || e.width || 0; sh = e.videoHeight || e.naturalHeight || e.height || 0 } }
    gl.bindTexture(gl.TEXTURE_2D, tex)
    // overlapping mapped channels mix like the MIX (blend + opacity); side by side they stay plain
    if (Lc && overlapsAny(r.corners, drawn)) setBlend(Lc.blend || 'normal', Lc.opacity); else setBlend('normal', 1)
    drawQuad(r.corners, sw, sh, r.fit)
    drawn.push(r.corners)
  }
  setBlend('normal', 1)
  requestAnimationFrame(drawMap)
}
requestAnimationFrame(drawMap)

// ---- media per region ----
function isVid (n) { return /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(n) }
function setRegionMedia (i, url, name) {
  const r = regions[i]; if (!r) return
  r.src = 'media'; r.url = url; r.kind = isVid(name) ? 'video' : 'image'; r.tex = null; r._base = ''
  if (!r.effect) r.effect = 'pointcloud'   // media = BASE yang kena efek
  saveMap(); showTip()
}
function setRegionLogo (i, url, name) {
  const r = regions[i]; if (!r) return
  r.src = 'logo'; r.url = url; r.kind = 'image'; r.tex = null; r._base = ''
  r.logoEl = new Image(); r.logoEl.src = url
  saveMap(); showTip()
}
function clearRegionMedia (i) { const r = regions[i]; if (!r) return; r.src = 'main'; r.url = ''; r.kind = ''; r.el = null; r.tex = null; saveMap(); showTip() }

// ---- PRESET tata letak: GRID 2x2, R1=CH1 .. R4=CH4 (dl per _li) ----
let _lastPreset = ''
function presetGrid2x2 () {
  const mk = (idx, c) => ({ corners: c, src: 'dl', dlIdx: idx, url: '', kind: '', el: null, tex: null, camIdx: 0, effect: '' })
  regions = [
    mk(0, [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]]),       // R1 kiri-atas   -> CH1
    mk(1, [[0.5, 0], [1, 0], [1, 0.5], [0.5, 0.5]]),       // R2 kanan-atas  -> CH2
    mk(2, [[0, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]]),       // R3 kiri-bawah  -> CH3
    mk(3, [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]])        // R4 kanan-bawah -> CH4
  ]
  sel = 0
  try { saveMap() } catch (e) {}
  try { if (editing) placeHandles(); if (typeof showTip === 'function') showTip() } catch (e) {}
}

// ---- edit: seret sudut region terpilih ----
const handles = [...document.querySelectorAll('.handle')]
function placeHandles () {
  const W = window.innerWidth, H = window.innerHeight, c = regions[sel].corners
  handles.forEach((el, i) => { el.style.left = (c[i][0] * W) + 'px'; el.style.top = (c[i][1] * H) + 'px' })
  markSel()
}
let editing = false, drag = -1, selCorner = 0
function markSel () { handles.forEach((el, idx) => el.classList.toggle('selc', idx === selCorner)) }
function setEdit (on) { editing = on; document.body.classList.toggle('edit', on); if (on) { try { window.focus() } catch (e) {} placeHandles(); showTip() } }
function showTip () {
  const r = regions[sel]
  // sumber cuma dua macam: MIX (whole mix) atau REGION N (kanal deck / R1..R4)
  const srcTxt = (r.src === 'dl') ? ('REGION ' + ((r.dlIdx | 0) + 1)) : 'MIX (whole mix)'
  const fitTxt = (r.fit === 'contain') ? 'CROP (full media)' : 'FILL (full, cropped)'
  document.getElementById('maptip').innerHTML =
    'MAP MODE · SURFACE ' + (sel + 1) + '/' + regions.length + ' — ' + srcTxt + ' · ' + fitTxt + '<br>' +
    '[S] SOURCE: MIX / REGION 1–N · [F] FILL/CROP · drag point / arrows · [1–9] pick surface · [A] add · [Bksp] delete · [M] done · [R] reset'
}
// SERET: klik di mana pun (mode map) langsung tangkap sudut TERDEKAT — lebih gampang dari harus pas di titik
let _lastMx = 0, _lastMy = 0
function _ptInQuad (px, py, c, W, H) {   // titik di dalam kotak (grid) ?
  let inside = false
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = c[i][0] * W, yi = c[i][1] * H, xj = c[j][0] * W, yj = c[j][1] * H
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}
function _grabNearest (e) {
  if (!editing) return
  if (e.target && e.target.closest && e.target.closest('#maptools')) return   // klik tombol toolbar -> bukan seret
  const W = window.innerWidth, H = window.innerHeight, mx = e.clientX, my = e.clientY
  // 1) cari SUDUT terdekat dari SEMUA grid -> klik dekat sudut mana pun langsung pilih grid itu + tarik sudutnya
  let bestR = -1, bestC = 0, bd = Infinity
  for (let r = 0; r < regions.length; r++) { const c = regions[r].corners; for (let i = 0; i < 4; i++) { const dx = c[i][0] * W - mx, dy = c[i][1] * H - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; bestR = r; bestC = i } } }
  if (bestR >= 0 && Math.sqrt(bd) < 70) { sel = bestR; drag = bestC; selCorner = bestC }
  else {   // 2) klik di TENGAH kotak -> geser SELURUH grid
    let hitR = -1
    for (let r = 0; r < regions.length; r++) if (_ptInQuad(mx, my, regions[r].corners, W, H)) { hitR = r; break }
    if (hitR < 0) return
    sel = hitR; drag = -2; _lastMx = mx; _lastMy = my
  }
  placeHandles(); markSel(); showTip(); e.preventDefault()
}
window.addEventListener('mousedown', _grabNearest)
window.addEventListener('mousemove', e => {
  if (drag === -1) return
  const W = window.innerWidth, H = window.innerHeight
  if (drag === -2) {   // geser seluruh grid (semua 4 sudut ditranslasi)
    const dx = (e.clientX - _lastMx) / W, dy = (e.clientY - _lastMy) / H
    _lastMx = e.clientX; _lastMy = e.clientY
    const c = regions[sel].corners
    for (let i = 0; i < 4; i++) { c[i][0] = Math.min(1, Math.max(0, c[i][0] + dx)); c[i][1] = Math.min(1, Math.max(0, c[i][1] + dy)) }
    placeHandles()
  } else {   // seret satu sudut
    regions[sel].corners[drag] = [Math.min(1, Math.max(0, e.clientX / W)), Math.min(1, Math.max(0, e.clientY / H))]
    placeHandles()
  }
})
window.addEventListener('mouseup', () => { if (drag !== -1) { drag = -1; saveMap() } })
window.addEventListener('resize', () => { if (editing) placeHandles() })

// drop file -> media region terpilih
window.addEventListener('dragover', e => e.preventDefault())
window.addEventListener('drop', e => {
  e.preventDefault()
  const f = e.dataTransfer.files[0]; if (!f) return
  const info = window.hvft && window.hvft.fileInfo ? window.hvft.fileInfo(f) : null
  const url = info ? info.url : URL.createObjectURL(f)
  const nm = (info && info.name) || f.name
  if (isVid(nm)) setRegionMedia(sel, url, nm)
  else setRegionLogo(sel, url, nm)
})

let saveT = 0
function saveMap () {
  if (!(window.hvft && window.hvft.setMap)) return
  const data = regions.map(r => ({ corners: r.corners, src: r.src, url: r.url, kind: r.kind, camIdx: r.camIdx | 0, effect: r.effect || '', dlIdx: r.dlIdx | 0, fit: r.fit || 'cover' }))
  clearTimeout(saveT); saveT = setTimeout(() => window.hvft.setMap(data), 120)
  try { syncAiRequest() } catch (e) {}
}
async function loadMap () {
  if (!(window.hvft && window.hvft.getMap)) return
  const m = await window.hvft.getMap()
  if (!m) { presetGrid2x2(); return }   // default awal = 4 GRID (2x2), bukan satu bidang penuh
  // kompat lama: array 4 titik = satu region main
  if (Array.isArray(m) && m.length === 4 && Array.isArray(m[0]) && typeof m[0][0] === 'number') {
    regions = [{ corners: m.map(p => [p[0], p[1]]), src: 'main', url: '', kind: '', el: null, tex: null }]
  } else if (Array.isArray(m) && m.length && m[0].corners) {
    regions = m.map(r => {
      const reg = { corners: r.corners.map(p => [p[0], p[1]]), src: r.src || 'main', url: r.url || '', kind: r.kind || '', el: null, tex: null, camIdx: r.camIdx | 0, effect: r.effect || '', dlIdx: r.dlIdx | 0, fit: r.fit === 'contain' ? 'contain' : 'cover' }
      if (reg.src === 'media' && reg.url) setRegionMediaEl(reg)
      else if (reg.src === 'logo' && reg.url) { reg.logoEl = new Image(); reg.logoEl.src = reg.url }
      return reg
    })
  }
  sel = 0
}
function setRegionMediaEl (reg) {
  let el
  if (reg.kind === 'video') { el = document.createElement('video'); el.src = reg.url; el.loop = true; el.muted = true; el.autoplay = true; el.playsInline = true; el.play().catch(() => {}) }
  else { el = new Image(); el.src = reg.url }
  reg.el = el
}
loadMap()
// LIVE MAP SYNC: pick up mapping edited on the control window's MIX / MAPPING monitor
window.__mapSig = ''
;(async () => { try { window.__mapSig = JSON.stringify(await window.hvft.getMap()) } catch (e) {} })()
setInterval(async () => {
  if (editing || !(window.hvft && window.hvft.getMap)) return
  try { const m = await window.hvft.getMap(); const sig = JSON.stringify(m); if (sig !== window.__mapSig) { window.__mapSig = sig; await loadMap() } } catch (e) {}
}, 600)

// tombol MAP MONITOR dari jendela kontrol -> masuk/keluar mode map (jadi tak perlu fokus keyboard di monitor)
if (window.hvft && window.hvft.onMapMonitor) window.hvft.onMapMonitor(() => setEdit(!editing))

// Satu tempat untuk semua aksi MAP — dipanggil keyboard DAN tombol klik (biar tak bergantung fokus keyboard).
function mapAction (k, shift) {
  if (k === 'm') { setEdit(!editing); return }
  if (!editing) return
  if (k >= '1' && k <= '9') { const i = +k - 1; if (i < regions.length) { sel = i; placeHandles(); showTip() } }
  else if (k === 'next') { sel = (sel + 1) % regions.length; placeHandles(); showTip() }   // pilih bidang berikutnya (tombol)
  else if (k === 'a') { const c = regions[sel].corners; regions.push({ corners: c.map(p => [Math.min(1, p[0] + 0.08), Math.min(1, p[1] + 0.08)]), src: 'main', url: '', kind: '', el: null, tex: null }); sel = regions.length - 1; placeHandles(); showTip(); saveMap() }
  else if (k === 'backspace') { if (regions.length > 1) { regions.splice(sel, 1); sel = Math.max(0, sel - 1); placeHandles(); showTip(); saveMap() } }
  else if (k === 'g') { clearRegionMedia(sel) }
  else if (k === 'r') { presetGrid2x2() }   // RESET -> kembali ke 4 GRID (2x2), bukan full layar
  else if (k === 'f') {   // FILL (full, cropped) <-> CROP (media utuh, ada bar)
    const r = regions[sel]
    r.fit = (r.fit === 'contain') ? 'cover' : 'contain'
    if (r.pipe) r.pipe.settings.fit = r.fit
    if (r.src === 'main') { mainFit = r.fit; pipe.settings.fit = mainFit }
    showTip(); saveMap()
  }
  else if (k === 's') {
    const r = regions[sel]
    const states = ['main']
    const _cl = (compActive && outDeck && outDeck.layers) ? outDeck.layers : []
    for (let i = 0; i < _cl.length; i++) if (_cl[i]) states.push('dl' + (_cl[i]._li | 0))
    let cur = states.indexOf(r.src === 'dl' ? 'dl' + (r.dlIdx | 0) : 'main')
    if (cur < 0) cur = 0
    const nx = states[(cur + 1) % states.length]
    if (nx === 'main') { r.src = 'main' } else { r.src = 'dl'; r.dlIdx = parseInt(nx.slice(2)) || 0 }
    showTip(); saveMap()
  }
  else if (k.startsWith('arrow')) {
    const stp = shift ? 0.012 : 0.002, c = regions[sel].corners[selCorner]
    if (k === 'arrowleft') c[0] -= stp; else if (k === 'arrowright') c[0] += stp
    else if (k === 'arrowup') c[1] -= stp; else if (k === 'arrowdown') c[1] += stp
    c[0] = Math.min(1, Math.max(0, c[0])); c[1] = Math.min(1, Math.max(0, c[1]))
    placeHandles(); saveMap()
  }
}
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase()
  if (k === 'escape') { window.close(); return }
  if (k.startsWith('arrow')) e.preventDefault()
  if (k === 'f' && !editing) { try { if (window.hvft && window.hvft.outputFullscreen) window.hvft.outputFullscreen() } catch (er) {} return }   // F = FULLSCREEN on / off
  mapAction(k, e.shiftKey)
})
// TOMBOL KLIK overlay MAP (tak butuh fokus keyboard). stopPropagation supaya klik tombol tak menangkap titik sudut.
;(function wireMapButtons () {
  const bar = document.getElementById('maptools')
  if (!bar) return
  bar.addEventListener('mousedown', e => e.stopPropagation())   // jangan picu _grabNearest
  bar.querySelectorAll('button').forEach(b => { b.onclick = e => { e.stopPropagation(); mapAction(b.dataset.mt, false); if (b.dataset.mt !== 'm') try { window.focus() } catch (er) {} } })
})()

// muat bank PNG untuk efek Media Mix
try { if (window.hvft && window.hvft.getCollage && typeof hvftLoadCollage === 'function') window.hvft.getCollage().then(list => hvftLoadCollage((list || []).map(x => x.url))) } catch (e) {}

// muat bank BACKGROUND untuk efek Cut-Out
try { if (window.hvft && window.hvft.getBackgrounds && typeof hvftLoadCutBg === 'function') window.hvft.getBackgrounds().then(list => hvftLoadCutBg((list || []).map(x => x.url))) } catch (e) {}

// GPU process crash notice from main -> AI engines move to CPU, LIDAR SCAN lightens (stability during a show)
try { if (window.hvft && window.hvft.onGpuCrashed) { window.__hvftGpuHook = 1; window.hvft.onGpuCrashed(n => { window.HVFT_GPU_CRASHES = n }) } } catch (e) {}
