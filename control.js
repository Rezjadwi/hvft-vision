// HVFT VISION — control.js (jendela kontrol)
const $ = s => document.querySelector(s)
const canvas = $('#view')
const pipe = new HvftPipeline(canvas)
pipe.onStatus = m => { $('#status').textContent = m }

let recorder = null, chunks = []

function setActive (container, attr, val) {
  if (!container) return   // sebagian tombol (res/polarity/pc) dihapus dari panel
  container.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset[attr] === val))
}
try { pipe.settings.res = 1280 } catch (e) {}   // resolusi efek dikunci ke tertinggi (output ikut layar terbaik)

// ===================== LAYER (ala Resolume) =====================
// L1 = BASE (kamera / video / gambar) -> diberi efek
// L2, L3 = overlay (PNG transparan / video alfa)
const LAYERS = [
  { name: 'L1 BASE', clips: [{ name: 'CAMERA', kind: 'camera', url: '', opacity: 1, scale: 1, x: 0.5, y: 0.5, blend: 'source-over' }, { name: 'LIDAR (iPhone)', kind: 'lidar', url: '', opacity: 1, scale: 1, x: 0.5, y: 0.5, blend: 'source-over' }, { name: 'DEPTH-AI', kind: 'depthai', url: '', opacity: 1, scale: 1, x: 0.5, y: 0.5, blend: 'source-over' }, { name: 'PC-3D', kind: 'pc3d', url: '', opacity: 1, scale: 1, x: 0.5, y: 0.5, blend: 'source-over' }], active: 0, visible: true },
  { name: 'L2 OVER', clips: [], active: -1, visible: true },
  { name: 'L3 OVER', clips: [], active: -1, visible: true }
]
let sel = { l: 0, c: 0 }

function defClip (name, kind, url, li) {
  return { name, kind, url, opacity: 1, scale: li === 0 ? 1 : 0.35, x: 0.5, y: 0.5,
    blend: 'source-over' }
}

function pushSettings () {
  if (!window.hvft) return
  const camSel = $('#cam')
  window.hvft.sendSettings(Object.assign({}, pipe.settings, {
    deviceId: camSel ? camSel.value : null,
    layers: LAYERS.map(L => {
      const c = L.clips[L.active]
      return c
        ? { kind: c.kind, url: c.url, opacity: c.opacity, scale: c.scale, x: c.x, y: c.y, blend: c.blend, visible: L.visible }
        : { kind: 'none', url: '', visible: L.visible }
    })
  }))
}

function applyClipToPipe (li) {
  const L = LAYERS[li]
  const c = L.clips[L.active]
  if (!c) { pipe.setLayerClip(li, 'none', ''); pipe.setLayerParams(li, { visible: L.visible }); return }
  pipe.setLayerClip(li, c.kind, c.url)
  pipe.setLayerParams(li, { opacity: c.opacity, scale: c.scale, x: c.x, y: c.y, blend: c.blend, visible: L.visible })
  if (li === 0) {
    if (c.kind === 'depthai') startAiDepth(); else stopAiDepth()
    if (c.kind === 'pc3d') startPc3d(); else stopPc3d()
  }
}

// ---- DEPTH-AI: estimasi kedalaman live dari kamera (Depth Anything V2 + WebGPU) ----
let depthEngine = null, aiOn = false, aiRAF = 0, aiFrames = 0
function aiOverlay (msg, show) {
  let el = document.getElementById('aiov')
  if (!el) {
    el = document.createElement('div'); el.id = 'aiov'
    el.style.cssText = 'position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);z-index:50;'
      + 'background:#0C0C0Cd0;border:1px solid #F2A03D;border-radius:10px;padding:14px 18px;'
      + 'color:#F2A03D;font:600 14px/1.5 ui-monospace,Menlo,monospace;text-align:center;max-width:70%;pointer-events:none'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.style.display = show ? 'block' : 'none'
}
async function startAiDepth () {
  if (aiOn) return
  aiOn = true; aiFrames = 0
  const gpu = ('gpu' in navigator) ? 'WebGPU available' : 'WebGPU NOT available (will be slow)'
  aiOverlay('DEPTH-AI: menyiapkan… (' + gpu + ')', true)
  if (!window.DepthEngine) { aiOverlay('DEPTH-AI: engine/ORT tak termuat (cek koneksi CDN)', true); return }
  if (!depthEngine) { depthEngine = new DepthEngine(); depthEngine.onState = m => { $('#status').textContent = 'DEPTH-AI: ' + m; if (aiFrames === 0) aiOverlay('DEPTH-AI: ' + m, true) } }
  if (!depthEngine.ready) { const ok = await depthEngine.init(); if (!ok) { aiOverlay('DEPTH-AI failed: ' + $('#status').textContent, true); aiOn = false; return } }
  const loop = async () => {
    if (!aiOn) return
    const f = await depthEngine.infer(pipe.video)
    if (f) {
      // push ke pipe control hanya kalau L1 control memang DEPTH-AI
      if (pipe.layers[0].kind === 'depthai') {
        pipe.pushLidarFrame({ w: f.w, h: f.h, fx: f.fx, fy: f.fy, cx: f.cx, cy: f.cy, depth: f.depthMM.buffer }, false)
      }
      // TAPI selalu siarkan ke output/region/point-cloud — mereka bisa pakai DEPTH-AI
      // walau L1 control sedang KAMERA. (dulu di-gate di sini -> region selalu hitam)
      if (window.hvft && window.hvft.sendAiDepth) window.hvft.sendAiDepth({ w: f.w, h: f.h, fx: f.fx, fy: f.fy, cx: f.cx, cy: f.cy, depth: f.depthMM.buffer, rgb: f.rgb.buffer })
      // PC-3D di L1: suapi langsung (tanpa lewat IPC)
      if (pipe.layers[0].kind === 'pc3d' && pcGpu) {
        pcDepthSeen++
        pcGpu.pushFrame({ w: f.w, h: f.h, fx: f.fx, fy: f.fy, cx: f.cx, cy: f.cy, depth: f.depthMM.buffer, rgb: f.rgb.buffer })
      }
      aiFrames++; if (aiFrames === 2) aiOverlay('', false)   // sudah jalan -> sembunyikan
    }
    aiRAF = requestAnimationFrame(loop)
  }
  aiRAF = requestAnimationFrame(loop)
}
function stopAiDepth () { aiOn = false; if (aiRAF) cancelAnimationFrame(aiRAF); aiOverlay('', false) }

// ---- DEPTH-AI untuk DECK (BERGANTIAN ringan) ----------------------------------
// Depth-AI 1 = kamera 0 + Depth Anything, Depth-AI 2 = kamera 1 + Depth Anything.
// Satu DepthEngine, satu inferensi aktif; mengikuti klip Depth-AI paling depan
// (deck_ui menaruh kamera targetnya di window.HVFT_AI_CAM / window.HVFT_AI_ON).
// Frame didorong LANGSUNG ke deck (jendela sama, tanpa IPC) + disiarkan ke
// window PC-3D/Output lewat sendAiDepth (dibubuhi aiCam agar routing benar).
let aiVideo = null, aiVidCam = -1, aiDeckOn = false, aiDeckRAF = 0
async function ensureAiVideo (cam) {
  if (!aiVideo) {
    aiVideo = document.createElement('video')
    aiVideo.muted = true; aiVideo.playsInline = true; aiVideo.autoplay = true
    aiVideo.style.cssText = 'position:absolute;left:-99999px;top:0;width:2px;height:2px'
    document.body.appendChild(aiVideo)
  }
  // HVFT Cam (phone) chosen for DEPTH-AI / PC-3D -> the shared phone <video> (netcam_hub.js)
  if (window.HVFT_AI_NET && window.HVFT_NETCAM) { const nv = window.HVFT_NETCAM.video(window.HVFT_AI_NET); if (nv) return nv; return null }
  if (aiVidCam === cam && aiVideo.srcObject) return aiVideo
  aiVidCam = cam
  try {
    const cams = (await HvftPipeline.listCameras()).filter(c => !/obs|virtual/i.test(c.label || ''))   // samakan dgn daftar deck (yg juga filter OBS) -> indeks kamera cocok
    const dev = cams[cam | 0]
    const cons = dev ? { deviceId: { exact: dev.deviceId } } : true
    if (aiVideo.srcObject) { try { aiVideo.srcObject.getTracks().forEach(t => t.stop()) } catch (e) {} }
    aiVideo.srcObject = await navigator.mediaDevices.getUserMedia({ video: cons, audio: false })
    await aiVideo.play().catch(() => {})
  } catch (e) { $('#status').textContent = 'Depth-AI camera ' + ((cam | 0) + 1) + ' failed: ' + (e && e.message ? e.message : e) }
  return aiVideo
}
async function startDeckAi () {
  if (aiDeckOn) return
  aiDeckOn = true
  if (!window.DepthEngine) { aiOverlay('DEPTH-AI: engine/ORT tak termuat (cek koneksi CDN)', true); aiDeckOn = false; return }
  if (!depthEngine) { depthEngine = new DepthEngine(); depthEngine.onState = m => { $('#status').textContent = 'DEPTH-AI: ' + m } }
  if (!depthEngine.ready) { const ok = await depthEngine.init(); if (!ok) { aiOverlay('DEPTH-AI failed: ' + $('#status').textContent, true); aiDeckOn = false; return } }
  const loop = async () => {
    if (!aiDeckOn) return
    if (window.HVFT_AI_ON && window.HVFT_AI_CAM != null) {
      const cam = window.HVFT_AI_CAM | 0
      const v = await ensureAiVideo(cam)
      if (v && (v.videoWidth || 0) > 0) {
        const f = await depthEngine.infer(v)
        if (f) {
          const pf = { w: f.w, h: f.h, fx: f.fx, fy: f.fy, cx: f.cx, cy: f.cy, ai: true, aiCam: cam, depth: f.depthMM.buffer, rgb: f.rgb.buffer }
          if (window.__deckDepth) { try { window.__deckDepth(pf) } catch (e) {} }                    // deck (jendela sama)
          if (window.hvft && window.hvft.sendAiDepth) window.hvft.sendAiDepth(pf)                     // PC-3D / Output window
        }
      }
    }
    aiDeckRAF = requestAnimationFrame(loop)
  }
  aiDeckRAF = requestAnimationFrame(loop)
}
function stopDeckAi () {
  aiDeckOn = false; if (aiDeckRAF) cancelAnimationFrame(aiDeckRAF); aiDeckRAF = 0
  if (aiVideo && aiVideo.srcObject) { try { aiVideo.srcObject.getTracks().forEach(t => t.stop()) } catch (e) {} aiVideo.srcObject = null; aiVidCam = -1 }
}
// hook dipanggil deck_ui (jendela sama): cam=indeks kamera untuk mengaktifkan, null untuk mematikan.
window.__requestAiDepth = (cam) => { if (cam == null) stopDeckAi(); else startDeckAi() }

// ---- kamera SUMBER untuk AI (CH4): PAKAI-ULANG stream kamera pipe kontrol (satu stream, andal).
// Buka stream baru sendiri sering ditolak macOS ("camera busy") -> R4 tak dapat kamera.
// Jadi kita arahkan kamera pipe kontrol (yang sudah dikelola & hidup) ke kamera pilihan CH4.
let _aiSrcCamSet = -2
async function aiSourceEl () {
  // HVFT Cam (phone) chosen as SOURCE CAMERA of AI LIVE / AI GEN -> the shared phone <video> (netcam_hub.js)
  if (window.HVFT_AINET && window.HVFT_NETCAM) { const nv = window.HVFT_NETCAM.video(window.HVFT_AINET); window.HVFT_AI_SRC_VIDEO = nv; return nv }
  const cam = (window.HVFT_AICAM != null) ? (window.HVFT_AICAM | 0) : 0
  if (cam !== _aiSrcCamSet) {
    _aiSrcCamSet = cam
    try {
      const cams = (await HvftPipeline.listCameras()).filter(c => !/obs|virtual/i.test(c.label || ''))
      const dev = cams[cam]
      if (dev && pipe && pipe.startCamera) await pipe.startCamera(dev.deviceId)
    } catch (e) { $('#status').textContent = 'AI R4: camera failed — ' + (e && e.message ? e.message : e) }
  }
  const v = (pipe && pipe.video && (pipe.video.videoWidth || 0) > 0) ? pipe.video : null
  window.HVFT_AI_SRC_VIDEO = v   // R4 pakai ini sbg BASIS kamera mentah (verifikasi sumber) sebelum/di antara restyle
  return v
}
// jaga kamera sumber AI tetap hidup selama CH4 nyala -> R4 selalu tampil kamera mentah walau restyle belum jalan
setInterval(() => { try { if (window.HVFT_AI_LIVE_ON || window.HVFT_GAN_ON) aiSourceEl() } catch (e) {} }, 600)

// ===================== POINT CLOUD 3D sebagai sumber L1 =====================
// Dirender ke canvas tersembunyi, canvas itu jadi sumber pipeline -> semua efek berlaku,
// dan otomatis ikut ke output/proyektor/mapping.
let pcGpu = null, pcCanvas = null, pcOut = null, pcOutCtx = null, pcRAF = 0, pcDepthSeen = 0, pcTick = 0
function startPc3d () {
  if (!pcCanvas) {
    pcCanvas = document.createElement('canvas')
    pcCanvas.width = 960; pcCanvas.height = 540   // samakan dgn buffer kerja -> tanpa penyusutan
    pcCanvas.style.cssText = 'position:absolute;left:-99999px;top:0'
    document.body.appendChild(pcCanvas)
    // canvas 2D perantara: hasil GPU disalin ke sini (readPixels), pipeline baca yang ini
    pcOut = document.createElement('canvas')
    pcOut.width = 960; pcOut.height = 540
    pcOut.style.cssText = 'position:absolute;left:-99999px;top:0'
    document.body.appendChild(pcOut)
    pcOutCtx = pcOut.getContext('2d', { willReadFrequently: true })
  }
  if (!pcGpu && window.PointCloudGPU) { try { pcGpu = new PointCloudGPU(pcCanvas) } catch (e) { pcGpu = null } }
  if (!pcGpu) { $('#status').textContent = 'PC-3D: module not loaded'; return }
  // pakai default modul (preset feel Reza) — jangan ditimpa lagi
  pipe.setExternalCanvas(pcOut)
  if (pcRAF) return
  const loop = () => {
    if (pipe.layers[0].kind !== 'pc3d') { pcRAF = 0; return }
    pcGpu.setAudio(pipe.band ? (pipe.band[0] || 0) : 0, pipe.onset || 0)
    if (pcOutCtx) pcGpu.renderCPU(pcOutCtx)
    pcRAF = requestAnimationFrame(loop)
  }
  pcRAF = requestAnimationFrame(loop)
  $('#status').textContent = 'PC-3D active — waiting for depth…'
  // kalau LiDAR tidak mengalir, jatuh ke DEPTH-AI (webcam) supaya tidak hitam terus
  const seen0 = pcDepthSeen
  setTimeout(() => {
    if (pipe.layers[0].kind !== 'pc3d') return
    if (pcDepthSeen === seen0) {
      $('#status').textContent = 'PC-3D: no LiDAR → switching to DEPTH-AI (webcam)…'
      startAiDepth()
    }
  }, 2500)
}
function stopPc3d () { if (pcRAF) cancelAnimationFrame(pcRAF); pcRAF = 0 }

// ---- panel PC-3D (mengatur pcGpu.opt secara live) ----
function pcSet (k, v) { if (pcGpu) pcGpu.opt[k] = v; if (typeof window !== 'undefined') { window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; window.HVFT_PC_OPT[k] = v; pipe.settings.pcOpt = window.HVFT_PC_OPT } }
if ($('#pcCol')) $('#pcCol').onclick = e => {
  const b = e.target.closest('button'); if (!b) return
  pcSet('color', b.dataset.pc); setActive($('#pcCol'), 'pc', b.dataset.pc)
}
const PCSLIDERS = [
  ['pcZ', 'zoom', 'pcZv', 100, v => (v / 100).toFixed(1) + '×'],
  ['pcD', 'densX', 'pcDv', 10, v => (v / 10).toFixed(1), v => { if (pcGpu) pcGpu.opt.meshStep = Math.max(1, Math.min(4, Math.round(5 - v / 10))) }],
  ['pcG', 'glow', 'pcGv', 100, v => (v / 100).toFixed(2)],
  ['pcPs', 'pointSize', 'pcPsv', 10, v => (v / 10).toFixed(1)],
  ['pcC', 'depthCut', 'pcCv', 100, v => v + '%'],
  ['pcF', 'farCut', 'pcFv', 10, v => (v / 10).toFixed(1)]
]
for (const [id, key, out, div, fmt, extra] of PCSLIDERS) {
  if (!$('#' + id)) continue
  $('#' + id).oninput = e => { pcSet(key, e.target.value / div); $('#' + out).textContent = fmt(e.target.value); if (extra) extra(Number(e.target.value)) }
}
function pcToggle (key, id) {
  if (typeof window !== 'undefined') { window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; window.HVFT_PC_OPT[key] = !window.HVFT_PC_OPT[key]; pipe.settings.pcOpt = window.HVFT_PC_OPT }
  if (pcGpu) pcGpu.opt[key] = window.HVFT_PC_OPT[key]
  const b = $('#' + id); if (b) b.classList.toggle('on', !!window.HVFT_PC_OPT[key])
}
if ($('#pcSpin')) $('#pcSpin').onclick = () => pcToggle('spin', 'pcSpin')
if ($('#pcFit')) $('#pcFit').onclick = () => { pcSet('zoom', 1.0); const s = $('#pcZ'); if (s) { s.value = 100; const q = $('#pcZv'); if (q) q.textContent = '1.0\u00d7' } if (window.HVFT_PC_OPT) { window.HVFT_PC_OPT._yaw = 0; window.HVFT_PC_OPT._pitch = 0 } if (pcGpu && pcGpu.fit) pcGpu.fit() }
if ($('#pcFlip')) $('#pcFlip').onclick = () => pcToggle('flipY', 'pcFlip')
if ($('#pcWave')) $('#pcWave').onclick = () => pcToggle('wave', 'pcWave')
if ($('#pcGlitch')) $('#pcGlitch').onclick = () => pcToggle('glitch', 'pcGlitch')
if ($('#pcMesh')) $('#pcMesh').onclick = () => pcToggle('mesh', 'pcMesh')
// orbit + zoom di KANVAS DECK (yang terlihat) -> ke deck PC-3D lewat opsi bersama
;(function () {
  const el = document.getElementById('deckcv'); if (!el) return
  let drag = false, lx = 0, ly = 0
  const O = () => (window.HVFT_PC_OPT = window.HVFT_PC_OPT || {})
  el.addEventListener('mousedown', e => { drag = true; lx = e.clientX; ly = e.clientY })
  window.addEventListener('mouseup', () => { drag = false })
  window.addEventListener('mousemove', e => { if (!drag) return; const o = O(); o._yaw = (o._yaw || 0) + (e.clientX - lx) * 0.008; o._pitch = Math.max(-1.4, Math.min(1.4, (o._pitch || 0) + (e.clientY - ly) * 0.008)); lx = e.clientX; ly = e.clientY; pipe.settings.pcOpt = o })
  el.addEventListener('wheel', e => { e.preventDefault(); const o = O(); const z = Math.max(0.4, Math.min(3.2, (o.zoom || 1) * (1 - e.deltaY * 0.001))); o.zoom = z; pipe.settings.pcOpt = o; const s = $('#pcZ'); if (s) { s.value = Math.round(z * 100); const q = $('#pcZv'); if (q) q.textContent = z.toFixed(1) + '\u00d7' } }, { passive: false })
})()

if ($('#pcSpace')) $('#pcSpace').onclick = () => {
  if (typeof window !== 'undefined') window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}
  const P = { color: 'rgbcam', densX: 4.5, densY: 1.5, pointSize: 6.5, glow: 1.3, depthCut: 0.0, farCut: 8.0, mesh: false, glitch: false, wave: false, spin: false, zoom: 1.0, meshStep: 1 }
  if (pcGpu) Object.assign(pcGpu.opt, P)
  if (window.HVFT_PC_OPT) Object.assign(window.HVFT_PC_OPT, P)
  pipe.settings.pcOpt = window.HVFT_PC_OPT
  if (typeof setActive === 'function') setActive($('#pcCol'), 'pc', 'rgbcam')
  const uiSet = (id, val, out, txt) => { const el = $('#' + id); if (el) el.value = val; const ov = $('#' + out); if (ov) ov.textContent = txt }
  uiSet('pcZ', 100, 'pcZv', '1.0\u00d7'); uiSet('pcD', 45, 'pcDv', '4.5'); uiSet('pcG', 130, 'pcGv', '1.30'); uiSet('pcC', 0, 'pcCv', '0%'); uiSet('pcF', 80, 'pcFv', '8.0')
  ;['pcGlitch', 'pcMesh', 'pcWave', 'pcSpin'].forEach(id => { const b = $('#' + id); if (b) b.classList.remove('on') })
  if (pcGpu && pcGpu.fit) pcGpu.fit()
  if (typeof pushSettings === 'function') pushSettings()
}

// ---- panel TEKS ----
if (!pipe.settings.textCfg) pipe.settings.textCfg = { str: '', overlay: false, size: 0.16, react: 1 }
if ($('#txtStr')) $('#txtStr').oninput = e => { pipe.settings.textCfg.str = e.target.value; pushSettings() }
if ($('#txtOverlay')) $('#txtOverlay').onclick = e => { pipe.settings.textCfg.overlay = !pipe.settings.textCfg.overlay; e.target.classList.toggle('on', pipe.settings.textCfg.overlay); pushSettings() }
if ($('#txtSz')) $('#txtSz').oninput = e => { pipe.settings.textCfg.size = e.target.value / 100; $('#txtSzv').textContent = e.target.value + '%'; pushSettings() }
if ($('#txtR')) $('#txtR').oninput = e => { pipe.settings.textCfg.react = e.target.value / 100; $('#txtRv').textContent = (e.target.value / 100).toFixed(1); pushSettings() }

// drag di preview utama = orbit PC-3D; scroll = zoom
;(function () {
  const el = document.getElementById('view'); if (!el) return
  let drag = false, lx = 0, ly = 0
  const active = () => pcGpu && pipe.layers[0].kind === 'pc3d'
  el.addEventListener('mousedown', e => { if (!active()) return; drag = true; lx = e.clientX; ly = e.clientY })
  window.addEventListener('mouseup', () => { drag = false })
  window.addEventListener('mousemove', e => {
    if (!drag || !active()) return
    pcGpu.cam.yaw += (e.clientX - lx) * 0.008
    pcGpu.cam.pitch = Math.max(-1.4, Math.min(1.4, pcGpu.cam.pitch + (e.clientY - ly) * 0.008))
    lx = e.clientX; ly = e.clientY
  })
  el.addEventListener('wheel', e => {
    if (!active()) return
    e.preventDefault()
    const z = Math.max(0.4, Math.min(3.2, (pcGpu.opt.zoom || 1) * (1 - e.deltaY * 0.001)))
    pcGpu.opt.zoom = z
    const s = document.getElementById('pcZ'); if (s) { s.value = Math.round(z * 100); document.getElementById('pcZv').textContent = z.toFixed(1) + '×' }
  }, { passive: false })
})()
if ($('#opendeck')) $('#opendeck').onclick = () => { if (window.hvft && window.hvft.openDeck) window.hvft.openDeck() }
if (window.hvft && window.hvft.onRequestAiDepth) window.hvft.onRequestAiDepth(on => {
  if (on) { startAiDepth(); return }
  const c0 = LAYERS[0].clips[LAYERS[0].active]
  if (!c0 || c0.kind !== 'depthai') stopAiDepth()   // jangan matikan kalau L1 control memang DEPTH-AI
})

function renderLayers () {
  const box = $('#layers')
  box.innerHTML = ''
  LAYERS.forEach((L, li) => {
    const row = document.createElement('div')
    row.className = 'lrow'
    const nm = document.createElement('span')
    nm.className = 'lname'; nm.textContent = L.name
    row.appendChild(nm)
    const eye = document.createElement('button')
    eye.className = 'leye' + (L.visible ? ' on' : '')
    eye.textContent = L.visible ? 'ON' : 'OFF'
    eye.onclick = () => { L.visible = !L.visible; applyClipToPipe(li); renderLayers(); pushSettings() }
    row.appendChild(eye)
    const slots = document.createElement('div')
    slots.className = 'lslots'
    L.clips.forEach((c, ci) => {
      const slot = document.createElement('div')
      slot.className = 'slot' + (sel.l === li && sel.c === ci ? ' sel' : '')
      const b = document.createElement('button')
      b.className = 'sname' + (L.active === ci ? ' on' : '') + ((c.kind !== 'camera' && c.kind !== 'lidar' && c.kind !== 'depthai' && c.kind !== 'pc3d') ? ' has-del' : '')
      b.textContent = (c.kind === 'camera' ? '◉ ' : c.kind === 'lidar' ? '◱ ' : c.kind === 'depthai' ? '◈ ' : c.kind === 'pc3d' ? '⬢ ' : c.kind === 'image' ? '▣ ' : '▶ ') + c.name
      b.title = c.name
      b.onclick = () => {
        L.active = (L.active === ci && li > 0) ? -1 : ci
        sel = { l: li, c: ci }
        applyClipToPipe(li); renderLayers(); syncClipPanel(); pushSettings()
        $('#status').textContent = L.active === ci ? L.name + ' → ' + c.name : L.name + ' empty'
      }
      slot.appendChild(b)
      if (c.kind !== 'camera' && c.kind !== 'lidar' && c.kind !== 'depthai' && c.kind !== 'pc3d') {
        const d = document.createElement('button')
        d.className = 'sdel'; d.textContent = '✕'; d.title = 'Delete clip'
        d.onclick = e => {
          e.stopPropagation()
          if (c.url.startsWith('blob:')) URL.revokeObjectURL(c.url)
          L.clips.splice(ci, 1)
          if (L.active === ci) L.active = li === 0 ? 0 : -1
          else if (L.active > ci) L.active--
          if (sel.l === li && sel.c >= L.clips.length) sel.c = Math.max(0, L.clips.length - 1)
          applyClipToPipe(li); renderLayers(); syncClipPanel(); pushSettings()
        }
        slot.appendChild(d)
      }
      slots.appendChild(slot)
    })
    const add = document.createElement('button')
    add.className = 'ladd'; add.textContent = '+ MEDIA'
    add.onclick = () => pickFiles(files => addFiles(files, li))
    slots.appendChild(add)
    row.appendChild(slots)
    box.appendChild(row)
  })
}

function isVideoName (n) { return /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(n) }
function isImageName (n) { return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n) }

function addFiles (fileList, li) {
  const L = LAYERS[li]
  let last = -1
  for (const f of fileList) {
    const info = window.hvft && window.hvft.fileInfo ? window.hvft.fileInfo(f) : null
    const name = info ? info.name : f.name
    const url = info ? info.url : URL.createObjectURL(f)
    const kind = isVideoName(name) ? 'video' : isImageName(name) ? 'image' : null
    if (!kind) continue
    L.clips.push(defClip(name.replace(/\.[^.]+$/, '').slice(0, 20), kind, url, li))
    last = L.clips.length - 1
  }
  if (last >= 0) {
    L.active = last; sel = { l: li, c: last }
    applyClipToPipe(li); renderLayers(); syncClipPanel(); pushSettings()
  }
}

function pickFiles (cb) {
  const inp = document.createElement('input')
  inp.type = 'file'; inp.accept = 'video/*,image/*'; inp.multiple = true
  inp.onchange = () => cb(inp.files)
  inp.click()
}

const drop = $('#drop')
window.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('show') })
window.addEventListener('dragleave', e => { if (e.relatedTarget === null) drop.classList.remove('show') })
window.addEventListener('drop', e => {
  e.preventDefault(); drop.classList.remove('show')
  if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files, sel.l)
})

// ---- panel KLIP ----
function selClip () { const L = LAYERS[sel.l]; return L ? L.clips[sel.c] : null }

function syncClipPanel () {
  const cn = $('#clipname'); if (!cn) return   // panel KLIP TERPILIH dihapus (kontrol pindah ke kartu kanal)
  const c = selClip()
  cn.textContent = c ? LAYERS[sel.l].name + ' · ' + c.name : '— no clip selected —'
  if (!c) return
  $('#cOp').value = Math.round(c.opacity * 100); $('#cOpv').textContent = $('#cOp').value + '%'
  $('#cSc').value = Math.round(c.scale * 100); $('#cScv').textContent = $('#cSc').value + '%'
  $('#cX').value = Math.round(c.x * 100); $('#cXv').textContent = $('#cX').value + '%'
  $('#cY').value = Math.round(c.y * 100); $('#cYv').textContent = $('#cY').value + '%'
  setActive($('#cBlend'), 'b', c.blend)
}

function editClip (key, v) {
  const c = selClip(); if (!c) return
  c[key] = v
  if (LAYERS[sel.l].active === sel.c) applyClipToPipe(sel.l)
  pushSettings()
}

if ($('#cOp')) {   // panel KLIP TERPILIH lama (dihapus) — jaga bila elemen tak ada
  $('#cOp').oninput = e => { editClip('opacity', e.target.value / 100); $('#cOpv').textContent = e.target.value + '%' }
  $('#cSc').oninput = e => { editClip('scale', e.target.value / 100); $('#cScv').textContent = e.target.value + '%' }
  $('#cX').oninput = e => { editClip('x', e.target.value / 100); $('#cXv').textContent = e.target.value + '%' }
  $('#cY').oninput = e => { editClip('y', e.target.value / 100); $('#cYv').textContent = e.target.value + '%' }
  $('#cBlend').onclick = e => { const b = e.target.closest('button'); if (!b) return; editClip('blend', b.dataset.b); setActive($('#cBlend'), 'b', b.dataset.b) }
  if ($('#cPulse')) $('#cPulse').onclick = e => { pipe.settings.layerPulse = !pipe.settings.layerPulse; e.target.classList.toggle('on', pipe.settings.layerPulse); pushSettings() }
}

// ===================== AKORDEON =====================
document.querySelectorAll('.sec').forEach(sec => {
  sec.querySelector('.sech').onclick = () => {
    sec.classList.toggle('open')
    sec.querySelector('.arw').textContent = sec.classList.contains('open') ? '▾' : '▸'
  }
})

// ===================== EFEK + ACAK =====================
document.querySelectorAll('.fx').forEach(b => {
  b.onclick = () => {
    pipe.settings.effect = b.dataset.fx
    document.querySelectorAll('.fx').forEach(x => x.classList.toggle('on', x === b))
    pushSettings()
  }
})

const RND_IV = [3000, 5000, 8000, 12000]
let rndOn = false, rndIdx = 1, rndLast = 0
$('#rnd').onclick = e => {
  rndOn = !rndOn; rndLast = 0
  e.target.textContent = 'Random: ' + (rndOn ? 'ON' : 'OFF')
  e.target.classList.toggle('on', rndOn)
}
$('#rndiv').onclick = e => {
  rndIdx = (rndIdx + 1) % RND_IV.length
  e.target.textContent = 'Every: ' + (RND_IV[rndIdx] / 1000) + 's'
}
setInterval(() => {
  if (!rndOn) return
  const now = Date.now()
  if (now - rndLast < RND_IV[rndIdx]) return
  rndLast = now
  const list = Array.from(document.querySelectorAll('.fx'))
  const cur = list.findIndex(b => b.classList.contains('on'))
  let n = cur
  if (list.length > 1) while (n === cur) n = Math.floor(Math.random() * list.length)
  list[n].click()
}, 250)

// ===================== SETTING =====================
const PICKS = [
  ['#colors', 'c', 'color'], ['#blob', 'b', 'blob'], ['#polarity', 'p', 'polarity'],
  ['#band', 'b', 'audioBand'], ['#fit', 'f', 'fit'], ['#track', 't', 'track'],
  ['#blobcm', 'bcm', 'blobColorMode']
]
for (const [selr, attr, key] of PICKS) {
  const el = $(selr); if (!el) continue   // #polarity dihapus -> lewati
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return
    pipe.settings[key] = b.dataset[attr]
    setActive($(selr), attr, b.dataset[attr])
    pushSettings()
  }
}
if ($('#blobInv')) $('#blobInv').onclick = e => {   // INVERT blob: kotak terisi solid
  pipe.settings.blobInvert = !pipe.settings.blobInvert
  e.target.classList.toggle('on', pipe.settings.blobInvert); pushSettings()
}
// ---- CROP SUBJEK (MATTE): feather / stabilizer / kikis-lebarkan / bersih ----
if ($('#mfeat')) $('#mfeat').oninput = e => { pipe.settings.matteFeather = e.target.value / 100; $('#mfeatv').textContent = e.target.value + '%'; pushSettings() }
if ($('#mstab')) $('#mstab').oninput = e => { pipe.settings.matteStab = e.target.value / 100; $('#mstabv').textContent = e.target.value + '%'; pushSettings() }
if ($('#mexp')) $('#mexp').oninput = e => { pipe.settings.matteExpand = e.target.value / 100; const px = Math.round((e.target.value / 100 - 0.5) * 6); $('#mexpv').textContent = (px > 0 ? '+' : '') + px; pushSettings() }
if ($('#mclean')) $('#mclean').onclick = e => { pipe.settings.matteClean = !pipe.settings.matteClean; e.target.classList.toggle('on', pipe.settings.matteClean); pushSettings() }
if ($('#res')) $('#res').onclick = e => {   // #res dihapus (resolusi dikunci) -> dijaga
  const b = e.target.closest('button'); if (!b) return
  pipe.settings.res = Number(b.dataset.r); setActive($('#res'), 'r', b.dataset.r); pushSettings()
}
if ($('#grid')) $('#grid').onclick = e => {   // #grid dipindah ke bar DECK (deck.g.grid) -> dijaga
  const b = e.target.closest('button'); if (!b) return
  pipe.settings.grid = b.dataset.g === 'on'; setActive($('#grid'), 'g', b.dataset.g); pushSettings()
}
$('#aud').onclick = e => {
  const b = e.target.closest('button'); if (!b) return
  const k = b.dataset.a
  pipe.settings.audio[k] = !pipe.settings.audio[k]
  b.classList.toggle('on', pipe.settings.audio[k]); pushSettings()
}
$('#mirror').onclick = e => {
  pipe.settings.mirror = !pipe.settings.mirror
  e.target.classList.toggle('on', pipe.settings.mirror); pushSettings()
}
if ($('#hud')) $('#hud').onclick = e => {   // HUD dipindah ke bar DECK (deck.g.hud) -> dijaga
  pipe.settings.hud = !pipe.settings.hud
  e.target.classList.toggle('on', pipe.settings.hud); pushSettings()
}
$('#apanel').onclick = e => {
  pipe.settings.audioPanel = !pipe.settings.audioPanel
  e.target.classList.toggle('on', pipe.settings.audioPanel); pushSettings()
}
$('#lGrain').onclick = e => {
  pipe.settings.lidarGrain = !pipe.settings.lidarGrain
  e.target.classList.toggle('on', pipe.settings.lidarGrain); pushSettings()
}
$('#lRelief').onclick = e => {
  pipe.settings.lidarRelief = !pipe.settings.lidarRelief
  e.target.classList.toggle('on', pipe.settings.lidarRelief); pushSettings()
}
$('#dFlip').onclick = e => {
  const b = e.target.closest('button'); if (!b) return
  pipe.settings.depthFlip = b.dataset.df
  setActive($('#dFlip'), 'df', b.dataset.df); pushSettings()
}
// WARNA Depth-AI/LiDAR: abu-abu depth <-> RGB kamera (flag global dibaca pipeline & efek point cloud)
if (typeof window !== 'undefined' && window.HVFT_DEPTH_RGB == null) window.HVFT_DEPTH_RGB = false
if (typeof window !== 'undefined' && window.HVFT_DEPTH_PLEXUS == null) window.HVFT_DEPTH_PLEXUS = false
if (typeof window !== 'undefined' && window.HVFT_DEPTH_THERMAL == null) window.HVFT_DEPTH_THERMAL = false
if (typeof window !== 'undefined' && window.HVFT_DEPTH_DISPLACE == null) window.HVFT_DEPTH_DISPLACE = false
if (typeof window !== 'undefined') { window.HVFT_DEPTH_KEY = !!window.HVFT_DEPTH_KEY; window.HVFT_DEPTH_IR = !!window.HVFT_DEPTH_IR; window.HVFT_DEPTH_CONTOUR = !!window.HVFT_DEPTH_CONTOUR }
if (typeof window !== 'undefined' && !window.HVFT_DISPLACE_OPT) window.HVFT_DISPLACE_OPT = { amount: 0.18 }
// opsi PLEXUS (jaring titik Depth-AI) — flag global dibaca pipeline di kedua window
if (typeof window !== 'undefined' && !window.HVFT_PLEXUS_OPT) {
  window.HVFT_PLEXUS_OPT = { spacing: 6, linkDist: 0.075, lineAlpha: 0.55, glow: 1.0, flash: 1.0, accent: 0.16, baseAlpha: 0.15 }
}
function plexusSet (k, v) {
  if (typeof window === 'undefined') return
  window.HVFT_PLEXUS_OPT = window.HVFT_PLEXUS_OPT || {}
  window.HVFT_PLEXUS_OPT[k] = v
  pipe.settings.plexusOpt = window.HVFT_PLEXUS_OPT
  pushSettings()
}
if ($('#dColor')) $('#dColor').onclick = e => {
  const b = e.target.closest('button'); if (!b) return
  const dc = b.dataset.dc
  window.HVFT_DEPTH_RGB = (dc === 'rgb')
  window.HVFT_DEPTH_PLEXUS = (dc === 'plexus')
  window.HVFT_DEPTH_THERMAL = (dc === 'thermal')
  window.HVFT_DEPTH_DISPLACE = (dc === 'displace')
  window.HVFT_DEPTH_KEY = (dc === 'key'); window.HVFT_DEPTH_IR = (dc === 'ir'); window.HVFT_DEPTH_CONTOUR = (dc === 'contour')
  // IR NOISE needs the Kinect's infrared stream; other looks go back to the IR CAMERA switch (default RGB)
  try { if (window.hvft && window.hvft.kinectCmd) window.hvft.kinectCmd('ir ' + ((dc === 'ir' || window.HVFT_KINECT_IR) ? 1 : 0)) } catch (e) {}
  window.HVFT_DEPTH_LOOK = dc
  try { if (window.__deckRender) window.__deckRender() } catch (e) {}
  pipe.settings.depthColor = dc
  pipe.settings.plexusOpt = window.HVFT_PLEXUS_OPT
  pipe.settings.displaceOpt = window.HVFT_DISPLACE_OPT
  const pc = $('#plexusCfg'); if (pc) pc.style.display = (dc === 'plexus') ? '' : 'none'
  const dpc = $('#displaceCfg'); if (dpc) dpc.style.display = (dc === 'displace') ? '' : 'none'
  setActive($('#dColor'), 'dc', dc); pushSettings()
}
if ($('#dispAmt')) $('#dispAmt').oninput = e => {
  const raw = Number(e.target.value)
  window.HVFT_DISPLACE_OPT = window.HVFT_DISPLACE_OPT || {}
  window.HVFT_DISPLACE_OPT.amount = raw / 100
  pipe.settings.displaceOpt = window.HVFT_DISPLACE_OPT
  const o = $('#dispAmtv'); if (o) o.textContent = raw + '%'
  pushSettings()
}
// slider PLEXUS -> window.HVFT_PLEXUS_OPT
const PX_SLIDERS = [
  ['pxDen', 'spacing', 'pxDenv', v => v | 0, v => String(v | 0)],
  ['pxLink', 'linkDist', 'pxLinkv', v => v / 1000, v => (v / 10).toFixed(1) + '%'],
  ['pxLa', 'lineAlpha', 'pxLav', v => v / 100, v => v + '%'],
  ['pxGlow', 'glow', 'pxGlowv', v => v / 10, v => (v / 10).toFixed(1)],
  ['pxFlash', 'flash', 'pxFlashv', v => v / 10, v => (v / 10).toFixed(1)],
  ['pxAcc', 'accent', 'pxAccv', v => v / 100, v => v + '%'],
  ['pxBase', 'baseAlpha', 'pxBasev', v => v / 100, v => v + '%']
]
for (const [id, key, out, conv, fmt] of PX_SLIDERS) {
  const el = $('#' + id); if (!el) continue
  el.oninput = e => { const raw = Number(e.target.value); plexusSet(key, conv(raw)); const o = $('#' + out); if (o) o.textContent = fmt(raw) }
}

const SLIDERS = [
  ['bg', 'bg', 'bgv', 100, v => v + '%'],
  ['sens', 'sens', 'sensv', 100, v => v + '%'],
  ['huds', 'hudScale', 'hudsv', 10, v => (v / 10).toFixed(1)],
  ['blw', 'blobLine', 'blwv', 10, v => (v / 10).toFixed(1)],
  ['gcols', 'gridCols', 'gcolsv', 1, v => String(v)],
  ['tsz', 'trackSize', 'tszv', 100, v => v + '%'],
  ['audamt', 'audioAmt', 'audv', 100, v => v + '%'],
  ['lN', 'lidarNear', 'lNv', 10, v => (v / 10).toFixed(1)],
  ['lF', 'lidarFar', 'lFv', 10, v => (v / 10).toFixed(1)],
  ['dC', 'depthCut', 'dCv', 100, v => v + '%']
]
for (const [id, key, out, div, fmt] of SLIDERS) {
  $('#' + id).oninput = e => {
    pipe.settings[key] = div === 1 ? Number(e.target.value) : e.target.value / div
    $('#' + out).textContent = fmt(e.target.value)
    pushSettings()
  }
}

$('#gear').onclick = () => $('#panel').classList.toggle('hidden')
if ($('#pcwin')) $('#pcwin').onclick = () => { if (window.hvft && window.hvft.openPointCloud) window.hvft.openPointCloud() }
if (window.hvft && window.hvft.onDepthState) window.hvft.onDepthState(s => { $('#status').textContent = 'LiDAR: ' + s })
if (window.hvft && window.hvft.onDepthFrame) window.hvft.onDepthFrame(f => {
  const b = LAYERS[0].clips[LAYERS[0].active]
  if (b && b.kind === 'lidar') pipe.pushLidarFrame(f)
  if (b && b.kind === 'pc3d') { pcDepthSeen++; if (pcGpu) pcGpu.pushFrame(f) }   // LiDAR maupun DEPTH-AI
})

// ---- HVFT Cam (Android) auto-discovery -> masuk dropdown CAMERA ----
if (window.hvft && window.hvft.onHvftCamUp) window.hvft.onHvftCamUp(async d => {
  if (!d || !d.url) return
  HVFT_CAMS.set(d.url, d)
  const s = $('#cam'); addHvftCamsToSelect(s)
  try { if (window.HVFT_DECK_REFRESH) window.HVFT_DECK_REFRESH() } catch (e) {}
  const val = 'hvftcam:' + d.url
  if (pipe.deviceId === val) return                 // sudah tersambung ke kamera ini
  if (userPickedCam) {                              // user sudah pilih kamera lain -> jangan timpa, cukup info
    $('#status').textContent = 'HVFT Cam siap di ' + (d.ip || d.url) + ' — pilih "HVFT Cam (Android)" di dropdown'
    return
  }
  try {                                             // AUTO-CONNECT: langsung sambung begitu HP ketemu
    if (s) s.value = val
    await selectCameraSource(val); pushSettings()
    $('#status').textContent = 'HVFT Cam (Android) tersambung otomatis · ' + (d.ip || d.url)
  } catch (e) { $('#status').textContent = 'HVFT Cam gagal auto-connect: ' + (e && e.message) }
})
if (window.hvft && window.hvft.onHvftCamDown) window.hvft.onHvftCamDown(d => {
  for (const [url, v] of HVFT_CAMS) {
    if (d && d.name && v.name === d.name) {
      HVFT_CAMS.delete(url)
      const s = $('#cam'); const val = 'hvftcam:' + url
      const o = s && [...s.options].find(x => x.value === val)
      if (o && s.value !== val) o.remove()   // kalau sedang dipakai, biarkan (reconnect sendiri)
    }
  }
})

// ===================== KAMERA / OUTPUT =====================
const HVFT_CAMS = new Map()   // url -> { url, ip, name } : HVFT Cam (Android) yang ketemu via mDNS
function addHvftCamsToSelect (s) {
  if (!s) return
  for (const d of HVFT_CAMS.values()) {
    const val = 'hvftcam:' + d.url
    if (![...s.options].some(o => o.value === val)) {
      const o = document.createElement('option')
      o.value = val; o.textContent = 'HVFT Cam (Android)' + (d.ip ? ' \u00b7 ' + d.ip : '')
      s.appendChild(o)
    }
  }
}
let userPickedCam = false   // true kalau user sengaja memilih kamera -> auto-connect HVFT Cam tak menimpa
async function selectCameraSource (val) {
  console.error('[HVFTCAM-R] selectCameraSource ' + val)
  if (val && val.indexOf('hvftcam:') === 0) return pipe.startNetworkCamera(val.slice(8))
  return pipe.startCamera(val || undefined)
}
async function refreshCameras () {
  const cams = await HvftPipeline.listCameras()  // iPhone can now be used as camera #2
  const s = $('#cam'); const prev = s.value; s.innerHTML = ''
  cams.forEach((c, i) => {
    const o = document.createElement('option')
    o.value = c.deviceId; o.textContent = c.label || ('Camera ' + (i + 1))
    s.appendChild(o)
  })
  addHvftCamsToSelect(s)
  if (prev && [...s.options].some(o => o.value === prev)) s.value = prev
  return cams
}
async function refreshDisplays () {
  if (!window.hvft) return
  const ds = await window.hvft.getDisplays()
  const s = $('#disp'); s.innerHTML = ''
  ds.forEach(d => {
    const o = document.createElement('option'); o.value = d.id; o.textContent = d.label; s.appendChild(o)
  })
  const ext = ds.find(d => !d.primary); if (ext) s.value = ext.id
}
// HVFT Cam (Android): opening the camera list looks for the phone on the WiFi once (no endless background scan)
if ($('#cam')) $('#cam').addEventListener('mousedown', () => { try { if (window.hvft && window.hvft.hvftcamRescan) window.hvft.hvftcamRescan() } catch (e) {} })
$('#cam').onchange = async e => {
  userPickedCam = true
  try { await selectCameraSource(e.target.value); pushSettings() }
  catch (err) { $('#status').textContent = 'failed to switch camera: ' + err.message }
}
// projector plugged in / out while running -> the display menu follows (external screen pre-selected)
if (window.hvft && window.hvft.onDisplaysChanged) window.hvft.onDisplaysChanged(() => { try { refreshDisplays() } catch (e) {} })
$('#send').onclick = async () => {
  if (!window.hvft) return
  // PROJECTOR VIEW (Oct 9): one engine — the projector draws this page's channels (proj_view.js). Legacy output.html only as fallback.
  let shared = false
  try { if (window.HVFT_PROJ && localStorage.getItem('hvft.proj.legacy') !== '1') shared = await window.HVFT_PROJ.open(Number($('#disp').value)) } catch (e) { shared = false }
  if (!shared) await window.hvft.openOutput(Number($('#disp').value), $('#cam').value || '')
  setTimeout(pushSettings, 800)
  $('#status').textContent = 'output active'
}
$('#closeout').onclick = async () => { if (window.hvft) await window.hvft.closeOutput() }
if ($('#gridR')) $('#gridR').onclick = () => { pipe.settings.regionPreset = 'grid2x2#' + Date.now(); try { pushSettings() } catch (e) {}; $('#status').textContent = 'Region: GRID 2×2 (R1–R4) sent to projector' }
if ($('#mapmon')) $('#mapmon').onclick = () => { if (window.hvft && window.hvft.mapMonitor) { window.hvft.mapMonitor(); $('#status').textContent = 'MAP MODE monitor: drag the 4 corner points · [S] MIX/REGION · press again = done' } else $('#status').textContent = 'Monitor not active — Send to Monitor first' }
$('#mic').onclick = async e => {
  const turnOn = !window.HVFT_MIC_ON
  if (turnOn) {
    const ok = await pipe.startAudio()                 // izin + tangkap mic (pipe utama)
    if (!ok) { e.target.classList.remove('on'); e.target.textContent = 'Mic denied'; return }
    window.HVFT_MIC_ON = true                           // GERBANG GLOBAL nyala -> semua pipe boleh merespons
    if (window.__hvftMic) window.__hvftMic(true)        // nyalakan mic di pipe lapis (yang kamu lihat)
    e.target.classList.add('on'); e.target.textContent = 'Mic: ON (click = turn off)'
    ainRefresh(); ainShow()                             // device names are readable once permission is granted
  } else {
    window.HVFT_MIC_ON = false                          // GERBANG GLOBAL mati -> NOL TOTAL di mana pun
    if (pipe.stopAudio) pipe.stopAudio()
    if (window.__hvftMic) window.__hvftMic(false)
    e.target.classList.remove('on'); e.target.textContent = 'Enable Mic'
  }
  try { pipe.settings.micOn = window.HVFT_MIC_ON; pushSettings() } catch (er) {}   // kabari proyektor
}

// ===================== AUDIO INPUT (USB interface) =====================
// Device / IN 1-2 / trim shared by every window via HVFT_AUDIO_IN (localStorage) and pushed to the projector.
const AIN = window.HVFT_AUDIO_IN
async function ainRefresh () {
  if (!AIN || !$('#ainDev')) return
  const c = AIN.cfg(), list = await AIN.list(), sel = $('#ainDev')
  sel.innerHTML = '<option value="">System default input</option>' + list.filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => `<option value="${d.deviceId}">${(d.label || ('Audio input ' + (i + 1))).replace(/</g, '&lt;')}</option>`).join('')
  const m = list.find(d => d.deviceId === c.deviceId) || list.find(d => c.label && d.label === c.label)
  sel.value = m ? m.deviceId : ''
  if (c.deviceId && !m) { const o = document.createElement('option'); o.value = c.deviceId; o.textContent = (c.label || 'saved input') + ' — NOT CONNECTED'; sel.appendChild(o); sel.value = c.deviceId }
  $('#ainCh').value = c.channel || 'mix'; $('#ainTrim').value = String(c.gain || 1)
}
function ainShow () {
  const el = $('#ainInfo'); if (!el) return
  const i = pipe.audioInfo
  if (!window.HVFT_MIC_ON || !i) { el.className = ''; el.textContent = 'INPUT · ' + (($('#ainDev') && $('#ainDev').selectedOptions[0]) ? $('#ainDev').selectedOptions[0].textContent : 'system default') + ' · mic off'; return }
  const c = AIN ? AIN.cfg() : {}
  const proc = (i.ec || i.ns || i.agc) ? ' · ⚠ OS PROCESSING ON' : ' · RAW'
  el.className = pipe.audioFellBack ? 'warn' : 'live'
  el.textContent = (pipe.audioFellBack ? '⚠ CHOSEN INPUT MISSING → DEFAULT · ' : '● ') + i.label + ' · ' + (i.ch ? i.ch + 'CH' : '?CH') + ' · ' + (i.sr ? Math.round(i.sr / 100) / 10 + 'k' : '') + ' · ' + ({ mix: 'MIX', L: 'IN 1', R: 'IN 2' }[c.channel] || 'MIX') + proc
}
async function ainApply () {
  if (!AIN) return
  try { if (document.activeElement && document.activeElement.tagName === 'SELECT') document.activeElement.blur() } catch (e) {}   // keys (M, O, 1-4…) must not type-ahead into the device list mid-show
  const sel = $('#ainDev'), o = sel.selectedOptions[0]
  AIN.save({ deviceId: sel.value, label: sel.value && o ? o.textContent.replace(/ — NOT CONNECTED$/, '') : '', channel: $('#ainCh').value, gain: +$('#ainTrim').value || 1 })
  if (window.HVFT_MIC_ON) {
    try { await pipe.restartAudio() } catch (e) {}
    try { if (window.__hvftMicRestart) window.__hvftMicRestart() } catch (e) {}
  }
  pipe.settings.audioIn = Object.assign(AIN.cfg(), { v: Date.now() }); try { pushSettings() } catch (e) {}   // projector follows
  ainShow(); $('#status').textContent = 'Audio input: ' + (o ? o.textContent : 'system default')
}
if (AIN && $('#ainDev')) {
  ['#ainDev', '#ainCh', '#ainTrim'].forEach(s => { $(s).onchange = ainApply })
  try { navigator.mediaDevices.addEventListener('devicechange', () => { ainRefresh().then(ainShow) }) } catch (e) {}   // hot-plug the interface
  ainRefresh().then(ainShow); setInterval(ainShow, 1500)
}

// ===================== PRESET =====================
let presets = {}
const PKEYS = ['effect', 'color', 'bg', 'sens', 'mirror', 'blob', 'hud', 'polarity', 'res',
  'audioAmt', 'audioBand', 'grid', 'gridCols', 'blobLine', 'fit', 'hudScale', 'layerPulse',
  'track', 'trackSize', 'depthCut', 'depthFlip', 'lidarNear', 'lidarFar', 'lidarRelief', 'lidarGrain',
  'blobColorMode', 'blobInvert']

function applySettings (s) {
  Object.assign(pipe.settings, s)
  if (!HVFT_EFFECTS.some(e => e.id === pipe.settings.effect)) pipe.settings.effect = 'pointcloud'
  document.querySelectorAll('.fx').forEach(x => x.classList.toggle('on', x.dataset.fx === pipe.settings.effect))
  setActive($('#colors'), 'c', pipe.settings.color)
  setActive($('#blob'), 'b', pipe.settings.blob)
  setActive($('#polarity'), 'p', pipe.settings.polarity)
  setActive($('#res'), 'r', String(pipe.settings.res || 960))
  setActive($('#fit'), 'f', pipe.settings.fit || 'contain')
  setActive($('#band'), 'b', pipe.settings.audioBand || 'all')
  setActive($('#grid'), 'g', pipe.settings.grid ? 'on' : 'off')
  setActive($('#track'), 't', pipe.settings.track || 'motion')
  setActive($('#blobcm'), 'bcm', pipe.settings.blobColorMode || 'mono')
  if ($('#blobInv')) $('#blobInv').classList.toggle('on', !!pipe.settings.blobInvert)
  setActive($('#dFlip'), 'df', pipe.settings.depthFlip || 'auto')
  if ($('#mirror')) $('#mirror').classList.toggle('on', pipe.settings.mirror)
  if ($('#hud')) $('#hud').classList.toggle('on', pipe.settings.hud !== false)
  $('#aud').querySelectorAll('button').forEach(b => b.classList.toggle('on', !!pipe.settings.audio[b.dataset.a]))
  for (const [id, key, out, div, fmt] of SLIDERS) {
    const v = div === 1 ? (pipe.settings[key] ?? 12) : Math.round((pipe.settings[key] ?? 0) * div)
    $('#' + id).value = v; $('#' + out).textContent = fmt(v)
  }
  pushSettings()
}

function markPresets () {
  const p = $('#presets'); if (!p) return   // PRESET lama dilebur ke SCENE -> UI dihapus
  p.querySelectorAll('button').forEach(b => b.classList.toggle('on', !!presets[b.dataset.s]))
}
async function loadPresetStore () {
  if (!window.hvft || !window.hvft.loadPresets) return
  try { presets = await window.hvft.loadPresets() || {}; markPresets() }
  catch (e) { presets = {}; $('#status').textContent = 'preset inactive — restart app (⌘Q)' }
}
async function usePreset (slot, save) {
  if (save) {
    const o = {}
    for (const k of PKEYS) o[k] = pipe.settings[k]
    o.audio = Object.assign({}, pipe.settings.audio)
    presets[slot] = o
    try { await window.hvft.savePresets(presets); markPresets(); $('#status').textContent = 'preset ' + slot + ' stored' }
    catch (e) { $('#status').textContent = 'failed to store preset' }
  } else if (presets[slot]) {
    applySettings(presets[slot]); $('#status').textContent = 'preset ' + slot + ' dimuat'
  } else $('#status').textContent = 'preset ' + slot + ' empty (shift-click = store)'
}
if ($('#presets')) $('#presets').onclick = e => {
  const b = e.target.closest('button'); if (!b) return
  usePreset(b.dataset.s, e.shiftKey)
}

// ===================== REKAM =====================
$('#rec').onclick = () => {
  const btn = $('#rec')
  if (recorder && recorder.state === 'recording') { recorder.stop(); return }
  const recCanvas = $('#deckcv') || canvas   // REKAM mix DECK (yang tampil & dikirim ke monitor), bukan pipeline lama #view
  const stream = recCanvas.captureStream(30)
  if (pipe.audioStream) pipe.audioStream.getAudioTracks().forEach(t => stream.addTrack(t))
  const mime = ['video/mp4;codecs=h264', 'video/webm;codecs=vp9', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) || ''
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12000000 } : undefined)
  chunks = []
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const ext = recorder.mimeType.includes('mp4') ? 'mp4' : 'webm'
    a.download = 'HVFT_VISION_' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + ext
    a.click()
    btn.classList.remove('active'); btn.textContent = 'REKAM'
    $('#status').textContent = 'recording saved (Downloads)'
  }
  recorder.start(); btn.classList.add('active'); btn.textContent = 'STOP'
}

// ===================== INDIKATOR SPEKTRUM =====================
const sctx = $('#spec').getContext('2d')
function drawSpec () {
  const cv = $('#spec'), w = cv.width, h = cv.height
  sctx.clearRect(0, 0, w, h)
  const s = pipe.spec, n = s.length, bw = w / n
  for (let i = 0; i < n; i++) {
    const v = s[i] / 255
    sctx.fillStyle = pipe.onset > 0.5 ? '#F2A03D' : 'rgba(235,235,235,0.75)'
    sctx.fillRect(i * bw, h - v * h, Math.max(1, bw - 1), v * h)
  }
  sctx.strokeStyle = 'rgba(242,160,61,0.35)'
  sctx.beginPath()
  for (const hz of [250, 2000]) {
    const x = w * (Math.log10(hz / 20) / Math.log10(10000 / 20))
    sctx.moveTo(x, 0); sctx.lineTo(x, h)
  }
  sctx.stroke()
  const b = pipe.band
  $('#specinfo').textContent =
    'low ' + b.low.toFixed(2) + ' · mid ' + b.mid.toFixed(2) + ' · high ' + b.high.toFixed(2) +
    ' · flux ' + pipe.flux.toFixed(3) + (pipe.onset > 0.5 ? '  ● ONSET' : '')
  requestAnimationFrame(drawSpec)
}

// ===================== SHORTCUT =====================
window.addEventListener('keydown', e => {
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return  // jangan rebut tombol saat mengetik
  // angka 1–8 = SCENE (dipegang deck_ui). Di sini cuma huruf aksi biar tak bentrok.
  if (e.key.toLowerCase() === 'h') { const gh = document.querySelector('#deckbar .gf[data-g="hud"]'); if (gh) gh.click(); else if ($('#hud')) $('#hud').click() }   // H = toggle HUD global (bar DECK)
  else if (e.key.toLowerCase() === 'r') $('#rec').click()
  else if (e.key.toLowerCase() === 'o') $('#send').click()   // O = Output to monitor (F belongs to MASTER fade — was a double action)
  else if (e.key.toLowerCase() === 's') $('#gear').click()
})

navigator.mediaDevices.addEventListener('devicechange', refreshCameras)
if (window.hvft) window.hvft.onOutputClosed(() => { $('#status').textContent = 'output closed' })

// ===================== BOOT =====================
async function boot () {
  let camUrl = null
  try { camUrl = (window.hvft && window.hvft.getHvftCamUrl && await window.hvft.getHvftCamUrl()) || null } catch (e) {}
  console.error('[HVFTCAM-R] boot camUrl=' + camUrl + ' userPicked=' + userPickedCam)
  if (camUrl) HVFT_CAMS.set(camUrl, { url: camUrl })
  if (camUrl && !userPickedCam) {
    try { await selectCameraSource('hvftcam:' + camUrl); $('#status').textContent = 'HVFT Cam (Android) tersambung otomatis · ' + camUrl.replace(/^https?:\/\//, '') }
    catch (e) { camUrl = null }
  }
  if (!camUrl) {
    try { await pipe.startCamera(null) } catch (e) { $('#status').textContent = 'camera denied: ' + e.message }
  }
  const cams = await refreshCameras()
  if (pipe.deviceId && String(pipe.deviceId).indexOf('hvftcam:') === 0) { $('#cam').value = pipe.deviceId }
  else if (cams.length && pipe.stream) {
    const track = pipe.stream.getVideoTracks()[0]
    const cur = cams.find(c => c.label === track.label)
    if (cur) $('#cam').value = cur.deviceId
  }
  await refreshDisplays()
  await loadPresetStore()
  renderLayers(); syncClipPanel(); drawSpec()
  pipe.start()
  $('#status').textContent = 'loading segmentation model…'
  await pipe.initModel()
}
boot()

// muat bank PNG untuk efek Media Mix
try { if (window.hvft && window.hvft.getCollage && typeof hvftLoadCollage === 'function') window.hvft.getCollage().then(list => hvftLoadCollage((list || []).map(x => x.url))) } catch (e) {}

// muat bank BACKGROUND untuk efek Cut-Out
try { if (window.hvft && window.hvft.getBackgrounds && typeof hvftLoadCutBg === 'function') window.hvft.getBackgrounds().then(list => hvftLoadCutBg((list || []).map(x => x.url))) } catch (e) {}

// ===================== AI LIVE (GEMINI) =====================
// Tangkap frame kamera -> Gemini 2.5 Flash Image (img2img) -> dorong hasil ke klip
// SUMBER 'AI Live' aktif (window.__deckSetAiImage). Per-gambar, disegarkan berkala.
;(function aiLive () {
  if (typeof GeminiEngine === 'undefined') return
  const eng = new GeminiEngine()
  const K = document.getElementById('aiKey')
  const P = document.getElementById('aiPrompt')
  const IV = document.getElementById('aiIv'), IVV = document.getElementById('aiIvV')
  const START = document.getElementById('aiStart'), ONCE = document.getElementById('aiOnce')
  const STAT = document.getElementById('aiStat')
  if (!START) return
  let on = false, interval = 0, timer = 0, lastStart = 0, runId = 0   // 0 = ASAP (pipeline menerus) · runId: results from an older run are dropped
  // pulihkan dari localStorage
  try { const sk = localStorage.getItem('hvft_ai_key'); if (sk && K) K.value = sk } catch (e) {}
  try { const sp = localStorage.getItem('hvft_ai_prompt'); if (sp && P) P.value = sp } catch (e) {}
  if (K) eng.setKey(K.value); if (P) eng.setPrompt(P.value)
  eng.onState = m => { if (STAT) STAT.textContent = m }

  if (K) K.addEventListener('input', () => { eng.setKey(K.value); try { localStorage.setItem('hvft_ai_key', K.value.trim()) } catch (e) {} })
  if (P) P.addEventListener('input', () => { eng.setPrompt(P.value); try { localStorage.setItem('hvft_ai_prompt', P.value) } catch (e) {} })
  // MODEL + PARALLEL (Gemini)
  const MSEL = document.getElementById('aiModel'), PAR = document.getElementById('aiPar'), PARV = document.getElementById('aiParV')
  try { const m = localStorage.getItem('hvft_ai_model'); if (m && MSEL) MSEL.value = m } catch (e) {}
  try { const n = parseInt(localStorage.getItem('hvft_ai_par')); if (n && PAR) PAR.value = n } catch (e) {}
  if (MSEL) { eng.model = MSEL.value || 'auto'; MSEL.addEventListener('change', () => { eng.model = MSEL.value || 'auto'; eng._bad = {}; eng.avgMs = 0; try { localStorage.setItem('hvft_ai_model', eng.model) } catch (e) {} MSEL.blur() }) }
  if (PAR) { eng.maxInflight = eng.parTarget = parseInt(PAR.value) || 3; if (PARV) PARV.textContent = PAR.value; PAR.addEventListener('input', () => { eng.maxInflight = eng.parTarget = parseInt(PAR.value) || 1; if (PARV) PARV.textContent = PAR.value; try { localStorage.setItem('hvft_ai_par', PAR.value) } catch (e) {} }) }
  // STYLE PRESETS: sharp prompts that keep the person clearly drawn (no studio/franchise names — Gemini refuses those)
  const PRESETS = {
    film: 'Redraw this exact photo as a hand-drawn 1980s Japanese anime film frame: clean thin black ink outlines on every person and object, cel-shaded skin with two flat tones, expressive anime eyes, soft hand-painted watercolor background, warm film grain. Keep the same people, pose, framing and composition. The character must be sharp, clear and fully drawn.',
    comic90: 'Redraw this exact photo as a 1990s American superhero comic book panel (Image Comics / Jim Lee era): heavy confident black inks with thick contour lines, dense crosshatching in the shadows, big solid black spot shadows, dramatic rim light, saturated early-digital colouring with smooth gradients, gritty high-contrast mood, crisp detailed line art. Keep the same people, pose and composition, clearly recognisable, as one finished comic panel.',
    comic: 'Redraw this exact photo as a 1980s American comic book panel: bold thick black ink outlines, heavy black spot shadows, Ben-Day halftone dots, flat saturated CMYK colours, dramatic lighting, crisp line art. Keep the same people, pose and composition; the person must be clearly drawn as a comic character.',
    manga: 'Redraw this exact photo as a black-and-white manga panel: crisp pen ink lines, screentone shading, speed lines, very high contrast, no colour. Keep the same people, pose and composition; the character must be sharp and clearly drawn.',
    paper: 'Turn this exact photo into a handmade layered paper-craft diorama. Every person becomes a cute paper-doll figure cut from matte cardstock and felt: round face, simple black dot eyes, tiny smile, rosy blush cheeks, hair made of layered cut-paper strands, clothes built from stacked paper pieces with quilted and stitched details. The background is rebuilt as layered paper scenery with depth, cut-paper buildings and cotton-paper clouds. Real paper thickness, soft shadows between layers, visible paper fibre texture, soft warm studio light. Keep the same number of people, their poses, clothing colours and the composition.',
    origami: 'Turn this exact photo into a photorealistic origami sculpture photographed in a studio: the face and skin folded from matte beige kraft paper into large low-poly faceted planes with sharp visible creases, the eyes, nose and lips still realistic and recognisable, the hair built from many folded dark paper pleats, clothes as folded paper panels. Dramatic soft key light from the side, pure black background, high detail. Keep the same person, expression, pose and framing.',
    zine: 'Redraw this exact photo as a photocopied 1980s punk noise-music zine page: harsh xerox black and white, high-contrast ink, gritty halftone, scratches and torn-paper texture. Keep the same person, pose and composition, clearly visible and drawn with bold lines.'
  }
  // STYLE REFERENCE (Gemini): a picture sent with every frame. PAPER CRAFT / ORIGAMI presets bring their own reference.
  const GREF = document.getElementById('aiGemRef'), GREFX = document.getElementById('aiGemRefX')
  const PRESET_REF = window.HVFT_STYLE_REFS || {}   // data URLs (refs/style_refs.js) -> canvas never tainted
  let refFromPreset = false
  function setGemRef (url, name, fromPreset) {
    const im = new Image()
    im.onload = () => {
      eng.setRef(im); refFromPreset = !!fromPreset
      if (GREF) { GREF.innerHTML = ''; const t = document.createElement('img'); t.src = url; t.style.cssText = 'height:40px;margin-right:8px'; GREF.appendChild(t); GREF.appendChild(document.createTextNode('✓ ' + (name || 'style').slice(0, 26))) }
      try { localStorage.setItem('hvft_ai_gemref', fromPreset ? 'preset:' + fromPreset : 'data:image/jpeg;base64,' + eng.refB64) } catch (e) {}
    }
    im.onerror = () => { if (STAT) STAT.textContent = 'style reference failed to load' }
    im.src = url
  }
  function clearGemRef () { eng.setRef(null); refFromPreset = false; if (GREF) GREF.textContent = 'drag a style image here (optional)'; try { localStorage.removeItem('hvft_ai_gemref') } catch (e) {} }
  if (GREF) {
    const pick = f => { if (!f) return; setGemRef(URL.createObjectURL(f), f.name, false) }   // blob URL = same origin, canvas stays readable
    GREF.ondragover = e => { e.preventDefault(); e.stopPropagation(); GREF.classList.add('drop') }
    GREF.ondragleave = e => { e.stopPropagation(); GREF.classList.remove('drop') }
    GREF.ondrop = e => { e.preventDefault(); e.stopPropagation(); GREF.classList.remove('drop'); pick(e.dataTransfer.files && e.dataTransfer.files[0]) }
    GREF.onclick = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => pick(inp.files[0]); inp.click() }
    try { const sv = localStorage.getItem('hvft_ai_gemref'); if (sv && sv.indexOf('preset:') === 0) { const k = sv.slice(7); if (PRESET_REF[k]) setGemRef(PRESET_REF[k], k.toUpperCase() + ' reference', k) } else if (sv && sv.indexOf('data:') === 0) setGemRef(sv, 'saved style', false) } catch (e) {}
  }
  if (GREFX) GREFX.onclick = clearGemRef
  const APR = document.getElementById('aiPresets')
  if (APR) APR.querySelectorAll('button').forEach(b => b.onclick = () => {
    const k = b.dataset.pp, t = PRESETS[k]; if (!t) return
    if (P) P.value = t; eng.setPrompt(t); try { localStorage.setItem('hvft_ai_prompt', t) } catch (e) {}
    APR.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b))
    if (PRESET_REF[k]) setGemRef(PRESET_REF[k], b.textContent + ' reference', k)
    else if (refFromPreset) clearGemRef()   // a preset's own reference must not leak into another style
    if (STAT) STAT.textContent = 'Prompt preset: ' + b.textContent + (PRESET_REF[k] ? ' (+ style reference)' : '')
  })
  if (IV) IV.addEventListener('input', () => { interval = parseInt(IV.value); if (isNaN(interval)) interval = 0; if (IVV) IVV.textContent = interval === 0 ? 'ASAP' : interval + 's' })

  // MODE: Referensi (realtime, default) | Gemini (prompt)
  const PROV = document.getElementById('aiProv'), LCFG = document.getElementById('aiLocalCfg'), GCFG = document.getElementById('aiGeminiCfg'), RCFG = document.getElementById('aiRefCfg'), PCFG = document.getElementById('aiPromptCfg')
  const URLE = document.getElementById('aiUrl'), DN = document.getElementById('aiDn'), DNV = document.getElementById('aiDnV'), STp = document.getElementById('aiSt'), STV = document.getElementById('aiStV')
  const CF = document.getElementById('aiCf'), CFV = document.getElementById('aiCfV')
  const refEng = (typeof StyleRefEngine !== 'undefined') ? new StyleRefEngine() : null
  if (refEng) refEng.onState = m => { if (STAT) STAT.textContent = m }
  // MORPH SUBJEK: kurung restyle ke badan+wajah (segmentasi orang) + fokus wajah opsional
  let curProv = 'ref'
  // realtime frames go to the channel as a CANVAS (layer_comp LIVE path); a JPEG snapshot only ~1×/s (presets, fallback)
  let snapT = 0
  function liveOut (cv) {
    window.HVFT_AI_LIVE_CANVAS = cv; window.HVFT_AI_LIVE_T = performance.now()
    if (performance.now() - snapT > 1000 && window.__deckSetAiImage) { snapT = performance.now(); window.__deckSetAiImage(cv.toDataURL('image/jpeg', 0.8)) }
  }
  function setProvider (p) {
    curProv = 'gemini'   // Oct 12 (Reza): AI = Gemini only — Draw Things, Reference, Anime GAN and the bridge were removed
    eng.provider = 'gemini'
    eng.maxSide = 256   // Gemini: input lebih kecil -> generasi & upload lebih cepat
    if (PROV) PROV.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.p === curProv))
    if (GCFG) GCFG.style.display = (curProv === 'gemini') ? 'block' : 'none'
    if (PCFG) PCFG.style.display = (curProv === 'gemini') ? 'block' : 'none'
    if (RCFG) RCFG.style.display = (curProv === 'ref') ? 'block' : 'none'
    try { localStorage.setItem('hvft_ai_provider', curProv) } catch (e) {}
    if (curProv === 'ref' && refEng && !refEng.ready && !refEng.loading) refEng.init()
  }
  // REFERENSI: drop gambar gaya + kekuatan
  const RDROP = document.getElementById('aiRefDrop'), RS = document.getElementById('aiRefS'), RSV = document.getElementById('aiRefSv')
  function loadStyle (url, nm) {
    const im = new Image()
    im.onload = () => { if (refEng) { refEng.setStyle(im); if (!refEng.ready && !refEng.loading) refEng.init() } if (RDROP) RDROP.textContent = '✓ style: ' + (nm || '').slice(0, 24) }
    im.onerror = () => { if (STAT) STAT.textContent = 'style failed to load' }
    im.src = url
  }
  if (RDROP) {
    RDROP.ondragover = e => { e.preventDefault(); e.stopPropagation(); RDROP.classList.add('drop') }
    RDROP.ondragleave = e => { e.stopPropagation(); RDROP.classList.remove('drop') }
    RDROP.ondrop = e => { e.preventDefault(); e.stopPropagation(); RDROP.classList.remove('drop'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return; const info = window.hvft && window.hvft.fileInfo ? window.hvft.fileInfo(f) : null; loadStyle(info ? info.url : URL.createObjectURL(f), (info && info.name) || f.name) }
    RDROP.onclick = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files[0]; if (!f) return; const info = window.hvft && window.hvft.fileInfo ? window.hvft.fileInfo(f) : null; loadStyle(info ? info.url : URL.createObjectURL(f), (info && info.name) || f.name) }; inp.click() }
  }
  if (RS) RS.addEventListener('input', () => { if (refEng) refEng.setStrength((parseInt(RS.value) || 100) / 100); if (RSV) RSV.textContent = RS.value + '%' })
  // KARAKTER CEPAT: 4 tombol -> jadikan referensi gaya (pipeline restyle yang sama), ganti live
  const ACH = document.getElementById('aiChars')
  if (ACH) ACH.querySelectorAll('button').forEach(b => b.onclick = () => {
    setProvider('ref')                                   // pakai pipeline Referensi (realtime, lokal)
    loadStyle(b.dataset.cu, 'Karakter ' + (b.textContent || ''))
    ACH.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b))
    if (!on && START) START.click()                      // auto-MULAI kalau belum jalan
  })
  if (PROV) PROV.querySelectorAll('button').forEach(b => b.onclick = () => setProvider(b.dataset.p))
  setProvider('gemini')

  async function tick () {
    if (!on) return
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    const live = window.HVFT_AI_LIVE_ON && pipe && pipe.video
    let ok = false
    if (live) {
      if (curProv === 'ref') {
        if (refEng && refEng.ready && refEng.styleEl) { const cv = await refEng.inferCanvas(await aiSourceEl()); if (cv) { liveOut(cv); ok = true } }
        else if (STAT && refEng && !refEng.styleEl) { STAT.textContent = 'Reference: drop a style image first' }
      } else {
        // FAST AI: start a new request whenever a slot is free, staggered by latency / parallel, so results keep
        // arriving every (latency ÷ parallel) instead of once per full latency.
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
        const N = eng.maxInflight
        const gap = Math.max(interval * 1000, (eng.avgMs || 3000) / N * 0.85)
        if (eng.inflight < N && now - lastStart >= gap && Date.now() >= eng.cooldownUntil) {
          lastStart = now
          const my = runId
          aiSourceEl().then(src => eng.restyle(src)).then(img => {
            if (img && on && my === runId && window.__deckSetAiImage) window.__deckSetAiImage(img)   // nothing lands after STOP
          }).catch(() => {})
        }
        ok = true
      }
    } else if (STAT) { STAT.textContent = 'AI: turn on CH4 → AI LIVE first' }
    // PIPELINE MENERUS: 'interval' = jeda MINIMUM antar-MULAI. Waktu generasi (yang sudah
    // makan beberapa detik) dikurangi dari jeda -> permintaan berikutnya menyusul tanpa waktu mati.
    let nextMs = 45
    if (curProv !== 'ref') nextMs = ok ? 80 : 1500   // pump checks free slots every 80 ms (requests run in the background)
    if (on) timer = setTimeout(tick, nextMs)
  }
  if (START) START.onclick = async () => {
    on = !on; runId++
    START.classList.toggle('on', on); START.textContent = on ? 'STOP' : 'MULAI'
    if (!on) { eng.abortAll(); if (window.__deckClearAi) window.__deckClearAi() }   // STOP = cancel requests in flight + back to the live camera
    if (on) {
      if (curProv === 'ref') { if (refEng) await refEng.init() }
      else { if (K) eng.setKey(K.value); if (P) eng.setPrompt(P.value) }
      tick()
    } else { if (timer) clearTimeout(timer); if (STAT) STAT.textContent = 'AI: stopped' }
  }
  if (ONCE) ONCE.onclick = async () => {
    if (!(window.HVFT_AI_LIVE_ON && pipe && pipe.video)) { if (STAT) STAT.textContent = 'AI: turn on CH4 → AI LIVE first'; return }
    if (curProv === 'ref') { if (refEng) { await refEng.init(); const img = await refEng.infer(await aiSourceEl()); if (img && window.__deckSetAiImage) window.__deckSetAiImage(img) } return }
    if (K) eng.setKey(K.value); if (P) eng.setPrompt(P.value)
    const img = await eng.restyle(await aiSourceEl())
    if (img && window.__deckSetAiImage) window.__deckSetAiImage(img)
  }
})()

// (Anime GAN removed Oct 12 — Reza: results looked wrong)

// ===================== MASTER: fade + BLACKOUT (panic) =====================
// Tirai hitam di atas seluruh output. window.HVFT_MASTER.level (0=hitam,1=penuh)
// dibaca LayerComp.render() -> berlaku ke preview deck & proyektor (via settings).
if (typeof window !== 'undefined' && !window.HVFT_MASTER) window.HVFT_MASTER = { level: 1 }
;(function master () {
  const FADE = document.getElementById('mFade'), FV = document.getElementById('mFv')
  const BO = document.getElementById('mBlack'), FIN = document.getElementById('mIn'), FOUT = document.getElementById('mOut')
  let ramp = 0, blackoutPrev = 1
  function sendMaster () { try { pipe.settings.master = { level: window.HVFT_MASTER.level }; pushSettings() } catch (e) {} }
  function updateBtn () { if (BO) { const on = window.HVFT_MASTER.level <= 0.001; BO.classList.toggle('on', on); BO.textContent = on ? '● BLACKOUT' : 'BLACKOUT' } }
  function setLevel (v) { v = v < 0 ? 0 : v > 1 ? 1 : v; window.HVFT_MASTER.level = v; if (FADE) FADE.value = Math.round(v * 100); if (FV) FV.textContent = Math.round(v * 100) + '%'; updateBtn(); sendMaster() }
  function rampTo (t, ms) { const from = window.HVFT_MASTER.level, t0 = performance.now(); if (ramp) cancelAnimationFrame(ramp); const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); setLevel(from + (t - from) * k); if (k < 1) ramp = requestAnimationFrame(step) }; step() }
  if (FADE) FADE.oninput = () => { if (ramp) cancelAnimationFrame(ramp); setLevel(FADE.value / 100) }
  if (FIN) FIN.onclick = () => rampTo(1, 800)
  if (FOUT) FOUT.onclick = () => rampTo(0, 800)
  if (BO) BO.onclick = () => { if (window.HVFT_MASTER.level > 0.001) { blackoutPrev = window.HVFT_MASTER.level || 1; if (ramp) cancelAnimationFrame(ramp); setLevel(0) } else setLevel(blackoutPrev || 1) }
  document.addEventListener('keydown', e => {
    const t = e.target, tag = t && t.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return
    const k = (e.key || '').toLowerCase()
    if (k === 'b') { if (BO) BO.onclick(); e.preventDefault() }
    else if (k === 'f') { rampTo(window.HVFT_MASTER.level > 0.5 ? 0 : 1, 800); e.preventDefault() }
  })
  updateBtn(); sendMaster()
})()

// GPU process crash notice from main -> AI engines move to CPU, LIDAR SCAN lightens (stability during a show)
try { if (window.hvft && window.hvft.onGpuCrashed) { window.__hvftGpuHook = 1; window.hvft.onGpuCrashed(n => { window.HVFT_GPU_CRASHES = n }) } } catch (e) {}
