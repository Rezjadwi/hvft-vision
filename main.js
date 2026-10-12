const { app, BrowserWindow, ipcMain, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

// aktifkan WebGPU (untuk depth AI / ONNX Runtime Web di GPU Metal)
app.commandLine.appendSwitch('enable-unsafe-webgpu')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-features', 'Vulkan')   // restored: the original, known-good GPU setup of this app
// (REMOVED Oct 7: disable-features=SkiaGraphite turned the whole GPU off on this Mac/Chrome 152 -> WebGL disabled,
//  software compositing, MediaPipe person segmentation dead. Graphite stays ON; GPU-process crashes are recovered instead.)

// preset disimpan di folder data aplikasi, jadi tetap ada walau node_modules dihapus
const presetFile = () => path.join(app.getPath('userData'), 'presets.json')

const { startDepthClient } = require('./depth_client.js')
const { startKinect } = require('./kinect_bridge.js')   // Kinect v1 (libfreenect) -> same depth frames as LiDAR

// ---- HVFT Cam (Android) auto-discovery via mDNS/Bonjour ----
let hvftCamBonjour = null, hvftCamBrowser = null, lastHvftCamUrl = null
function hvftCamBroadcast (channel, payload) {
  for (const w of [controlWin, outputWin, deckWin, pcWin]) sendTo(w, channel, payload)
}
// send only to a window whose page is alive: not destroyed, not crashed, not in the middle of a reload
// (sending to a disposed render frame makes Electron print "Render frame was disposed" every time)
function sendTo (w, channel, payload) {
  try {
    if (!w || w.isDestroyed() || w.__hvftDown) return
    const wc = w.webContents
    if (!wc || wc.isDestroyed() || wc.isCrashed()) return
    wc.send(channel, payload)
  } catch (e) {}
}
// ---- CRASH WATCH: log why a window died (logs/hvft_crash.log in the app folder) and bring it back ----
const crashLogFile = () => path.join(__dirname, 'logs', 'hvft_crash.log')
function crashLog (line) {
  const txt = new Date().toISOString() + '  ' + line + '\n'
  try { console.log('[HVFT]', line) } catch (e) {}
  try { fs.mkdirSync(path.dirname(crashLogFile()), { recursive: true }); fs.appendFileSync(crashLogFile(), txt) } catch (e) {}
}
function watchWin (w, name) {
  const wc = w.webContents
  let errN = 0, errT = 0, reloads = 0, reloadT = 0
  wc.on('did-start-navigation', (e, url, inPlace, isMain) => {   // a reload/navigation disposes the page until it has loaded again
    const main = (e && e.isMainFrame != null) ? e.isMainFrame : isMain, same = (e && e.isSameDocument != null) ? e.isSameDocument : inPlace
    if (main !== false && !same) w.__hvftDown = true
  })
  wc.on('did-finish-load', () => { w.__hvftDown = false; if (lastHvftCamUrl) { const ip = (lastHvftCamUrl.match(/\/\/([^:]+)/) || [])[1] || null; sendTo(w, 'hvftcam-up', { url: lastHvftCamUrl, ip, port: 8080, name: 'HVFT Cam' }) } })
  wc.on('render-process-gone', (e, d) => {
    w.__hvftDown = true
    crashLog(name + ' window CRASHED: reason=' + (d && d.reason) + ' exitCode=' + (d && d.exitCode) + ' mem(MB)=' + Math.round(process.getSystemMemoryInfo().free / 1024) + ' free')
    const now = Date.now(); if (now - reloadT > 60000) reloads = 0
    if (d && d.reason !== 'clean-exit' && reloads < 3 && !w.isDestroyed()) {   // auto-recover (max 3x per minute)
      reloads++; reloadT = now
      setTimeout(() => { try { if (!w.isDestroyed()) { crashLog(name + ' window reloading after crash'); wc.reload() } } catch (er) {} }, 1200)
    }
  })
  w.on('unresponsive', () => crashLog(name + ' window UNRESPONSIVE (frozen)'))
  w.on('responsive', () => crashLog(name + ' window responsive again'))
  wc.on('console-message', (e, ...r) => {   // renderer errors -> log (rate limited)
    const lv = r[0], msg = r[1], line = r[2], src = r[3]
    const level = (e && e.level != null) ? e.level : lv, text = (e && e.message != null) ? e.message : msg
    if (!(level === 'error' || level === 3)) return
    if (/onnxruntime|\[W:/.test(String(text))) return   // ORT performance warnings are not errors
    const now = Date.now(); if (now - errT > 10000) { errN = 0; errT = now }
    if (++errN > 5) return
    const ln = (e && e.lineNumber != null) ? e.lineNumber : line, sid = (e && e.sourceId != null) ? e.sourceId : src
    crashLog(name + ' JS error: ' + String(text).slice(0, 300) + ' @' + String(sid || '').split('/').pop() + ':' + ln)
  })
}
function memLine () {   // memory per process type (MB) -> shows leaks / GPU memory pressure in the log
  try {
    const by = {}
    const pidName = {}   // which window owns which renderer (CONTROL / OUTPUT / ...) -> the log shows who grows
    for (const [n, w] of [['CONTROL', controlWin], ['OUTPUT', outputWin], ['DECK', deckWin], ['PC', pcWin]]) { try { if (w && !w.isDestroyed()) pidName[w.webContents.getOSProcessId()] = (pidName[w.webContents.getOSProcessId()] ? pidName[w.webContents.getOSProcessId()] + '+' : '') + n } catch (e) {} }
    for (const m of app.getAppMetrics()) { const k = (m.type === 'Tab' && pidName[m.pid]) ? 'Tab(' + pidName[m.pid] + ')' : m.type + (m.name ? '(' + m.name + ')' : ''); by[k] = (by[k] || 0) + Math.round((m.memory && m.memory.workingSetSize || 0) / 1024) }
    return Object.keys(by).map(k => k + '=' + by[k]).join(' ') + ' | free=' + Math.round(process.getSystemMemoryInfo().free / 1024)
  } catch (e) { return 'mem n/a' }
}
let gpuCrashes = 0
app.on('child-process-gone', (e, d) => {
  if (!d || d.reason === 'clean-exit') return
  if (d.type === 'GPU') gpuCrashes++
  crashLog('child process gone: type=' + d.type + ' reason=' + d.reason + ' exitCode=' + d.exitCode + (d.name ? ' name=' + d.name : '') + ' | gpuCrashes=' + gpuCrashes + ' | ' + memLine())
  // tell the pages: heavy GPU work (LIDAR SCAN on GPU) backs off after a GPU crash
  for (const w of BrowserWindow.getAllWindows()) sendTo(w, 'gpu-crashed', gpuCrashes)
})
// ---- OFFLINE MODELS (Oct 7): the person segmenter (+ object detector) load from vendor/models first (pipeline.js
// MODEL_LOCAL / DET_LOCAL), MediaPipe itself from vendor/tasks-vision. The models are downloaded here once, while online.
const OFFLINE_MODELS = [
  ['selfie_segmenter.tflite', 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'],
  ['efficientdet_lite2.tflite', 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite']
]
async function ensureOfflineModels () {
  const dir = path.join(__dirname, 'vendor', 'models')
  for (const [name, url] of OFFLINE_MODELS) {
    const file = path.join(dir, name)
    try { if (fs.existsSync(file) && fs.statSync(file).size > 50000) continue } catch (e) {}
    try {
      const res = await fetch(url); if (!res.ok) { crashLog('OFFLINE model ' + name + ' download failed ' + res.status); continue }
      const buf = Buffer.from(await res.arrayBuffer()); if (buf.length < 50000) continue
      fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.part', buf); fs.renameSync(file + '.part', file)
      crashLog('OFFLINE model cached: ' + name + ' (' + Math.round(buf.length / 1024) + ' KB)')
    } catch (e) { crashLog('OFFLINE model ' + name + ' not cached (offline?): ' + (e && e.message)) }
  }
}
app.whenReady().then(() => {
  crashLog('START electron=' + process.versions.electron + ' chrome=' + process.versions.chrome + ' switches: disable-features=' + app.commandLine.getSwitchValue('disable-features'))
  const gpuLog = tag => { try { const g = app.getGPUFeatureStatus(); crashLog('GPU status ' + tag + ': webgl=' + g.webgl + ' webgl2=' + g.webgl2 + ' gpu_compositing=' + g.gpu_compositing + ' rasterization=' + g.rasterization + ' webgpu=' + g.webgpu) } catch (e) {} }
  gpuLog('start'); setTimeout(() => gpuLog('+10s'), 10000)
  setTimeout(ensureOfflineModels, 4000)   // OFFLINE SHOW: cache the MediaPipe models in vendor/models once (needs internet the first time)
  let lastMem = 0
  setInterval(() => { try { const tot = app.getAppMetrics().reduce((a, m) => a + ((m.memory && m.memory.workingSetSize) || 0), 0) / 1024; if (Math.abs(tot - lastMem) > 400) { lastMem = tot; crashLog('MEM total=' + Math.round(tot) + 'MB ' + memLine()) } } catch (er) {} }, 60000)
})
process.on('uncaughtException', err => { crashLog('MAIN uncaught: ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err)) })
function startHvftCamDiscovery () {
  try {
    const { Bonjour } = require('bonjour-service')
    hvftCamBonjour = new Bonjour()
    hvftCamBrowser = hvftCamBonjour.find({ type: 'http' })
    crashLog('[HVFTCAM] mDNS discovery START')
    hvftCamBrowser.on('up', s => crashLog('[HVFTCAM] mDNS lihat service: name=' + (s && s.name) + ' port=' + (s && s.port)))
    const isHvft = s => (((s && s.name) || '')).toLowerCase().includes('hvft')
    const ipv4 = s => (((s && s.addresses) || []).find(a => /^\d{1,3}(\.\d{1,3}){3}$/.test(a))) || (s && s.referer && s.referer.address) || null
    hvftCamBrowser.on('up', s => { if (!isHvft(s)) return; const ip = ipv4(s); if (!ip) return; lastHvftCamUrl = 'http://' + ip + ':' + s.port; hvftCamSeenAt = Date.now(); crashLog('[HVFTCAM] mDNS MATCH -> ' + lastHvftCamUrl); hvftCamBroadcast('hvftcam-up', { url: lastHvftCamUrl, ip, port: s.port, name: s.name }) })
    hvftCamBrowser.on('down', s => { if (!isHvft(s)) return; hvftCamBroadcast('hvftcam-down', { name: s && s.name }) })
  } catch (e) { console.log('[HVFT Cam] discovery mati (bonjour-service belum di-install?):', e && e.message) }
}

// ---- HVFT Cam fallback: auto-scan subnet lokal (kalau mDNS diblok router) — tetap tanpa input IP ----
let hvftCamSeenAt = 0
function noteHvftCam (url, ip, name) {
  hvftCamSeenAt = Date.now()
  crashLog('[HVFTCAM] SCAN FOUND -> ' + url)
  lastHvftCamUrl = url
  hvftCamBroadcast('hvftcam-up', { url, ip, port: 8080, name: name || 'HVFT Cam' })
}
function probeHvftCam (ip, port, timeoutMs) {
  return new Promise(resolve => {
    const http = require('http')
    let done = false
    const finish = v => { if (!done) { done = true; resolve(v) } }
    const req = http.get({ host: ip, port, path: '/health', timeout: timeoutMs }, res => {
      if (res.statusCode !== 200) { res.resume(); return finish(false) }
      let body = ''
      res.on('data', d => { body += d; if (body.length > 200) req.destroy() })
      res.on('end', () => finish(/hvft/i.test(body)))
    })
    req.on('timeout', () => { try { req.destroy() } catch (e) {} ; finish(false) })
    req.on('error', () => finish(false))
  })
}
let hvftCamScanning = false
async function scanSubnetForHvftCam () {
  if (hvftCamScanning) return
  hvftCamScanning = true
  try { await scanSubnetOnce() } finally { hvftCamScanning = false }
}
async function scanSubnetOnce () {
  const os = require('os')
  const bases = new Set()
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] || []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const m = a.address.match(/^(\d+\.\d+\.\d+)\.(\d+)$/)
      if (!m) continue
      // hanya rentang privat (WiFi/hotspot): 192.168.x, 10.x, 172.16-31.x
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) bases.add(m[1] + '.|' + m[2])
    }
  }
  if (!bases.size) { crashLog('[HVFTCAM] scan: tidak ada interface privat (WiFi beda/terputus?)'); return }
  crashLog('[HVFTCAM] scan subnet: ' + [...bases].map(e => e.split('|')[0] + 'x').join(', '))
  const port = 8080, timeoutMs = 600
  for (const entry of bases) {
    const [base, selfLast] = entry.split('|')
    const hosts = []
    for (let i = 1; i <= 254; i++) { if (String(i) !== selfLast) hosts.push(base + '.' + i) }
    let idx = 0
    const worker = async () => {
      while (idx < hosts.length) {
        const ip = hosts[idx++]
        try { if (await probeHvftCam(ip, port, timeoutMs)) { noteHvftCam('http://' + ip + ':' + port, ip, 'HVFT Cam (' + ip + ')'); return } } catch (e) {}
      }
    }
    await Promise.all(Array.from({ length: 32 }, worker))   // 32 paralel per interface
  }
  if (Date.now() - hvftCamSeenAt > 5000) crashLog('[HVFTCAM] scan selesai: HP tidak ditemukan di subnet (cek izin Local Network / WiFi sama)')
}
function startHvftCamLanScan () {
  const tick = async () => {
    if (lastHvftCamUrl || Date.now() - hvftCamSeenAt < 30000) return   // phone already known (mDNS / earlier scan): no scan, no false 'not found'
    try { await scanSubnetForHvftCam() } catch (e) {}
  }
  // Oct 11: only a few scans after launch (2.5 s, 20 s, 60 s), then STOP. Before: a 254-host scan every 15 s forever —
  // network noise + log spam during the show when no HVFT Cam phone is used. Opening the camera list rescans on demand.
  setTimeout(tick, 2500); setTimeout(tick, 20000); setTimeout(tick, 60000)
}
let pcWin = null
let depthCli = null
let kinect = null, lastKinectState = 'Kinect: off'
let lastDepthState = 'klien depth belum jalan'
let lidarIp = '172.20.10.1'   // default USB hotspot; bisa diganti dari app
const lidarCfg = () => path.join(app.getPath('userData'), 'lidar.json')
try { lidarIp = JSON.parse(fs.readFileSync(lidarCfg(), 'utf8')).ip || lidarIp } catch (e) {}

let controlWin = null
let outputWin = null
let deckWin = null
let lastComp = null

function createControl() {
  controlWin = new BrowserWindow({
    width: 1180, height: 820, backgroundColor: '#000000',
    title: 'HVFT VISION',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }   // never slow the engine when the window is covered: the projector draws from it
  })
  watchWin(controlWin, 'CONTROL')
  // PROJECTOR VIEW (Oct 9): the control page opens the projector itself (window.open 'hvftproj' = same process) and draws
  // its own channels into it -> ONE engine. The old output.html ran a full second engine and crashed the GPU on 8 GB.
  controlWin.webContents.setWindowOpenHandler(({ frameName }) => {
    if (frameName !== 'hvftproj') return { action: 'deny' }
    const disp = pickProjDisplay()
    const wa = disp.workArea || disp.bounds
    projExternal = disp.id !== screen.getPrimaryDisplay().id
    projTarget = disp
    const B = projExternal ? disp.bounds : { x: wa.x + 40, y: wa.y + 40, width: Math.max(640, wa.width - 80), height: Math.max(400, wa.height - 80) }
    return { action: 'allow', overrideBrowserWindowOptions: { x: B.x, y: B.y, width: B.width, height: B.height, backgroundColor: '#000000', frame: true, title: 'HVFT VISION — PROJECTOR', autoHideMenuBar: true, webPreferences: { backgroundThrottling: false } } }
  })
  controlWin.webContents.on('did-create-window', (child, details) => {
    if (!details || details.frameName !== 'hvftproj') return
    if (outputWin && outputWin !== child && !outputWin.isDestroyed()) { try { outputWin.close() } catch (e) {} }
    outputWin = child
    child.on('unresponsive', () => crashLog('PROJECTOR window UNRESPONSIVE (frozen)'))   // no auto-reload: it is drawn by the control page
    if (projExternal && projTarget) projToDisplay(child, projTarget)   // straight onto the projector / LED, full screen — nothing to drag
    child.on('closed', () => { if (outputWin === child) { outputWin = null; sendTo(controlWin, 'output-closed') } })
  })
  controlWin.loadFile('control.html')   // default = real engine UI; HVFT_PROTO=1 opens the Claude Design prototype
  const fit=()=>{try{const [w,h]=controlWin.getContentSize();controlWin.webContents.setZoomFactor(Math.max(0.5,Math.min(1,w/1680,h/960)))}catch(e){}}
  controlWin.on('resize',fit);controlWin.webContents.on('did-finish-load',fit);controlWin.once('ready-to-show',()=>controlWin.maximize())
  controlWin.on('closed', () => { controlWin = null; if (outputWin) { outputWin.close() } })
}

app.whenReady().then(() => {
  // izinkan kamera/mikrofon otomatis
  const ses = require('electron').session.defaultSession
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(true))
  createControl()
  startHvftCamDiscovery()
  startHvftCamLanScan()
  // server penerima depth iPhone LiDAR — selalu nyala
  depthCli = startDepthClient({
    getIp: () => lidarIp,
    port: 7755,
    onState: s => { lastDepthState = s; sendTo(pcWin, 'depth-state', s); sendTo(controlWin, 'depth-state', s) },
    onFrame: f => {
      const payload = {
        w: f.w, h: f.h, fx: f.fx, fy: f.fy, cx: f.cx, cy: f.cy,
        depth: f.depthMM.buffer, rgb: f.rgb.buffer
      }
      sendTo(pcWin, 'depth-frame', payload)
      sendTo(controlWin, 'depth-frame', payload)
      sendTo(outputWin, 'depth-frame', payload)
      sendTo(deckWin, 'depth-frame', payload)
    }
  })
  // KINECT v1: helper process started only while a channel uses the KINECT source
  kinect = startKinect({
    binDir: path.join(app.getPath('userData'), 'kinect'),
    onState: s => { lastKinectState = s; for (const w of [controlWin, pcWin, deckWin]) sendTo(w, 'kinect-state', s) },
    onFrame: f => {
      const payload = { w: f.w, h: f.h, fx: f.fx, fy: f.fy, cx: f.cx, cy: f.cy, kinect: true, depth: f.depth, rgb: f.rgb }
      sendTo(controlWin, 'depth-frame', payload)
      sendTo(outputWin, 'depth-frame', payload)
      sendTo(pcWin, 'depth-frame', payload)
      sendTo(deckWin, 'depth-frame', payload)
    }
  })
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createControl() })
})
// RVM MATTE model (Robust Video Matting, GPL-3.0) shipped in vendor/models -> renderer (rvm_engine.js)
ipcMain.handle('get-rvm-model', async () => {
  try { const b = fs.readFileSync(path.join(__dirname, 'vendor', 'models', 'rvm_mobilenetv3_fp32.onnx')); return { ok: true, buf: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } } catch (e) { return { ok: false, error: 'RVM model missing: ' + e.message } }
})
// SYPHON OUT (Oct 7): the deck mix as a Syphon source "HVFT VISION" for MadMapper / Resolume / OBS / VDMX on this Mac.
// node-syphon (GPL-3.0, github.com/benoitlahoz/node-syphon): prebuilt arm64 addon in vendor/syphon/bin, Syphon.framework
// in vendor/syphon/Frameworks. The control page sends frames only while a Syphon client is connected.
let syphonA = null, syphonSrv = null, syphonErr = '', syphonPubErr = 0
function syphonAddon () {
  if (syphonA || syphonErr) return syphonA
  try { syphonA = require(path.join(__dirname, 'vendor', 'syphon', 'bin', 'syphon.node')) } catch (e) { syphonErr = String((e && e.message) || e); crashLog('SYPHON unavailable: ' + syphonErr.slice(0, 300)) }
  return syphonA
}
ipcMain.handle('syphon-enable', (e, on) => {
  if (!on) { if (syphonSrv) { try { syphonSrv.dispose() } catch (er) {} syphonSrv = null; crashLog('SYPHON off') } return { on: false } }
  const A = syphonAddon(); if (!A) return { on: false, error: syphonErr }
  if (!syphonSrv) { try { syphonSrv = new A.MetalServer('HVFT VISION'); crashLog('SYPHON on: server "HVFT VISION"') } catch (er) { crashLog('SYPHON server failed: ' + er.message); return { on: false, error: er.message } } }
  return { on: true }
})
ipcMain.handle('syphon-clients', () => { try { return !!(syphonSrv && syphonSrv.hasClients) } catch (e) { return false } })
ipcMain.on('syphon-frame', (e, f) => {
  if (!syphonSrv || !f || !f.data || !(f.w > 0) || !(f.h > 0)) return
  try { syphonSrv.publishImageData(f.data, { x: 0, y: 0, width: f.w, height: f.h }, { width: f.w, height: f.h }, !!f.flip) } catch (er) { if (syphonPubErr++ < 3) crashLog('SYPHON publish failed: ' + er.message) }
})
app.on('will-quit', () => { try { if (syphonSrv) syphonSrv.dispose() } catch (e) {} syphonSrv = null })
// SCENES / PRESETS (Oct 8): DECK A/B × 8 slots + the last live state, saved to presets/hvft_scenes.json in the app folder
// (a file, not localStorage: no size limit, survives restarts and can be backed up). Written atomically.
const scenesFile = () => path.join(__dirname, 'presets', 'hvft_scenes.json')
ipcMain.handle('scenes-load', () => { try { return JSON.parse(fs.readFileSync(scenesFile(), 'utf8')) } catch (e) { return null } })
ipcMain.on('scenes-save', (e, data) => {
  try { const f = scenesFile(); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(data)); fs.renameSync(f + '.tmp', f) } catch (er) { crashLog('SCENES save failed: ' + er.message) }
})
// TRACE RECORDER (Oct 7): control page -> logs/trace_<stamp>/trace.jsonl + f_0001.jpg … (trace_rec.js, Shift+T)
let traceDir = null
ipcMain.on('trace', (e, m) => {
  try {
    if (!m || typeof m !== 'object') return
    if (m.k === 'begin') { traceDir = path.join(__dirname, 'logs', 'trace_' + String(m.id).replace(/[^0-9_]/g, '')); fs.mkdirSync(traceDir, { recursive: true }); crashLog('TRACE start ' + traceDir); return }
    if (!traceDir) return
    if (m.k === 'lines' && typeof m.s === 'string') fs.appendFileSync(path.join(traceDir, 'trace.jsonl'), m.s)
    else if (m.k === 'frame' && typeof m.b64 === 'string') fs.writeFile(path.join(traceDir, 'f_' + String(m.n | 0).padStart(4, '0') + '.jpg'), Buffer.from(m.b64, 'base64'), () => {})
    else if (m.k === 'end') { crashLog('TRACE saved ' + traceDir); traceDir = null }
  } catch (er) {}
})
ipcMain.on('kinect-enable', (e, on) => { if (kinect) kinect.enable(!!on) })
ipcMain.on('kinect-cmd', (e, c) => { if (kinect) kinect.cmd(c) })
ipcMain.handle('get-kinect-state', () => lastKinectState)
app.on('will-quit', () => { if (kinect) kinect.stop() })

// ---- AI GEN local service (Oct 12): SD-Turbo img2img on the Mac GPU, prompt-driven (ai_service/aigen_server.py) ----
// Started on demand from CH4 ▸ AI GEN ▸ START, stays up until the app quits (re-start = instant, model stays loaded).
let aigenProc = null
function aigenLog (line) { try { fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true }); fs.appendFileSync(path.join(__dirname, 'logs', 'aigen.log'), new Date().toISOString() + '  ' + line + '\n') } catch (e) {} }
ipcMain.handle('aigen-start', async () => {
  if (aigenProc && aigenProc.exitCode === null) return { ok: true, running: true }
  const dir = path.join(__dirname, 'ai_service'), py = path.join(dir, '.venv', 'bin', 'python')
  if (!fs.existsSync(py)) return { ok: false, error: 'AI GEN not installed (ai_service/.venv missing)' }
  try {
    const { spawn } = require('child_process')
    aigenProc = spawn(py, ['aigen_server.py'], { cwd: dir, env: Object.assign({}, process.env, { PYTORCH_ENABLE_MPS_FALLBACK: '1', HF_HUB_DISABLE_TELEMETRY: '1' }) })
    aigenProc.stdout.on('data', d => String(d).split('\n').filter(Boolean).forEach(aigenLog))
    aigenProc.stderr.on('data', d => String(d).split('\n').filter(Boolean).forEach(l => { if (!/Warning|warn\(|FutureWarning|deprecat/i.test(l)) aigenLog('ERR ' + l) }))
    aigenProc.on('exit', c => { aigenLog('exit ' + c); aigenProc = null })
    aigenLog('started ' + py)
    return { ok: true, running: true, started: true }
  } catch (e) { return { ok: false, error: (e && e.message) || 'spawn failed' } }
})
app.on('will-quit', () => { try { if (aigenProc) aigenProc.kill() } catch (e) {} })
// leftovers: Anime GAN models downloaded before (Oct 12 removed) -> free the disk once
try { const md = path.join(app.getPath('userData'), 'models'); if (fs.existsSync(md)) fs.readdirSync(md).filter(n => /^animeganv3-.*\.onnx$/.test(n)).forEach(n => { try { fs.unlinkSync(path.join(md, n)) } catch (e) {} }) } catch (e) {}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

ipcMain.handle('get-displays', () => {
  const primary = screen.getPrimaryDisplay()
  return screen.getAllDisplays().map(d => ({
    id: d.id, label: (d.id === primary.id ? 'Main' : 'External') + ` ${d.size.width}x${d.size.height}`,
    bounds: d.bounds, primary: d.id === primary.id
  }))
})

ipcMain.handle('open-output', (e, { displayId, deviceId }) => {
  const disp = screen.getAllDisplays().find(d => d.id === displayId) || screen.getPrimaryDisplay()
  if (outputWin) { outputWin.close(); outputWin = null }
  const _wa = disp.workArea || disp.bounds   // AREA KERJA (di bawah menu bar) -> title bar bisa ditarik/digeser
  const win = outputWin = new BrowserWindow({
    x: _wa.x + 40, y: _wa.y + 40, width: Math.max(640, _wa.width - 80), height: Math.max(400, _wa.height - 80),
    frame: true, backgroundColor: '#000000', fullscreen: false, movable: true, resizable: true,   // proyektor: window normal bisa digeser/resize
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  })
  watchWin(win, 'OUTPUT')
  win.loadFile('output.html', { query: { deviceId: deviceId || '' } })
  // use THIS window (not the global): re-opening on another display closes the old window, whose late 'closed'
  // event used to null the global while the new window was still loading -> crash in did-finish-load
  win.webContents.on('did-finish-load', () => { if (lastComp) sendTo(win, 'comp', lastComp); if (lastSettings) sendTo(win, 'settings', lastSettings) })   // projector opened after MIC ON still gets the mic gate + look
  win.on('closed', () => { if (outputWin === win) { outputWin = null; sendTo(controlWin, 'output-closed') } })
  // external display (projector / LED) -> straight to FULLSCREEN so the picture covers the whole stage (F toggles)
  if (!(disp.id === screen.getPrimaryDisplay().id)) win.once('ready-to-show', () => { try { win.setFullScreen(true) } catch (e) {} })
  win.webContents.once('did-finish-load', () => { if (disp.id !== screen.getPrimaryDisplay().id) { try { win.setFullScreen(true) } catch (e) {} } })
  return true
})

ipcMain.handle('close-output', () => { if (outputWin) { outputWin.close(); outputWin = null } return true })

// MAP MONITOR: fokuskan jendela output lalu suruh masuk/keluar mode map (tak perlu klik monitor dulu)
ipcMain.handle('map-monitor', () => { if (outputWin && !outputWin.isDestroyed()) { try { outputWin.focus() } catch (e) {} sendTo(outputWin, 'map-monitor') } return true })

ipcMain.handle('load-presets', () => {
  try { return JSON.parse(fs.readFileSync(presetFile(), 'utf8')) } catch (e) { return {} }
})

ipcMain.handle('save-presets', (e, data) => {
  try {
    fs.mkdirSync(path.dirname(presetFile()), { recursive: true })
    fs.writeFileSync(presetFile(), JSON.stringify(data, null, 2))
    return true
  } catch (err) { return false }
})

const mapFile = () => path.join(app.getPath('userData'), 'mapping.json')
ipcMain.handle('get-map', () => { try { return JSON.parse(fs.readFileSync(mapFile(), 'utf8')) } catch (e) { return null } })
ipcMain.handle('set-map', (e, corners) => { try { fs.writeFileSync(mapFile(), JSON.stringify(corners)) } catch (e) {} return true })
ipcMain.handle('get-hvftcam-url', () => lastHvftCamUrl)
ipcMain.on('hvftcam-log', (e, m) => { try { fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true }); fs.appendFileSync(path.join(__dirname, 'logs', 'hvftcam.log'), new Date().toISOString() + '  ' + String(m).slice(0, 300) + '\n') } catch (er) {} })   // phone camera status, not rate-limited
ipcMain.handle('hvftcam-rescan', async () => { if (Date.now() - hvftCamSeenAt > 30000) { try { await scanSubnetForHvftCam() } catch (e) {} } return lastHvftCamUrl })   // camera list opened -> look for the phone once
ipcMain.handle('get-lidar-ip', () => lidarIp)
ipcMain.handle('set-lidar-ip', (e, ip) => {
  lidarIp = String(ip || '').trim() || '172.20.10.1'
  try { fs.mkdirSync(path.dirname(lidarCfg()), { recursive: true }); fs.writeFileSync(lidarCfg(), JSON.stringify({ ip: lidarIp })) } catch (er) {}
  if (depthCli) depthCli.refresh()
  return lidarIp
})

ipcMain.handle('open-deck', () => {
  if (deckWin) { deckWin.focus(); return true }
  deckWin = new BrowserWindow({
    width: 1200, height: 760, backgroundColor: '#000000', title: 'HVFT VISION — DECK',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  })
  watchWin(deckWin, 'DECK')
  deckWin.loadFile('deck.html')
  deckWin.on('closed', () => { deckWin = null })
  return true
})
ipcMain.on('comp', (e, c) => { lastComp = c; sendTo(outputWin, 'comp', c) })
// STAGE RESOLUTION (Oct 9): the projector window reports its real size -> control adapts the MIX monitor + render aspect
let lastOutInfo = null, projDisplayId = null, projExternal = false, projTarget = null
// PROJECTOR ON THE EXTERNAL SCREEN (Oct 12, Reza: "window muncul di monitor utama, harus digeser lalu full screen"):
// an external display wins automatically (the display menu in SETTINGS was filled at launch and often still said Main);
// the window is placed on it and made SIMPLE full screen (no new macOS Space: the laptop screen stays usable,
// no black second screen when "Displays have separate Spaces" is off, menu bar / dock hidden on the projector).
function pickProjDisplay () {
  const prim = screen.getPrimaryDisplay(), all = screen.getAllDisplays()
  const ext = all.filter(d => d.id !== prim.id)
  const chosen = all.find(d => d.id === projDisplayId)
  if (chosen && chosen.id !== prim.id) return chosen        // an external screen picked by hand
  if (ext.length) return ext.slice().sort((a, b) => (b.bounds.width * b.bounds.height) - (a.bounds.width * a.bounds.height))[0]   // else the biggest external one
  return prim                                               // no projector connected: a window on the laptop screen (preview)
}
function projToDisplay (win, disp) {
  if (!win || win.isDestroyed() || !disp) return
  try {
    if (win.isSimpleFullScreen && win.isSimpleFullScreen()) win.setSimpleFullScreen(false)
    if (win.isFullScreen()) win.setFullScreen(false)
    win.setBounds(disp.bounds)
    setTimeout(() => { try { if (!win.isDestroyed()) { win.setBounds(disp.bounds); win.setSimpleFullScreen(true); win.focus() } } catch (e) {} }, 120)
    crashLog('PROJECTOR -> display ' + disp.id + ' ' + disp.bounds.width + 'x' + disp.bounds.height + ' (simple full screen)')
  } catch (e) { crashLog('PROJECTOR move failed: ' + (e && e.message)) }
}
function projToWindow (win, disp) {   // back to an ordinary window (on the given screen, else the laptop screen)
  if (!win || win.isDestroyed()) return
  try {
    if (win.isSimpleFullScreen && win.isSimpleFullScreen()) win.setSimpleFullScreen(false)
    if (win.isFullScreen()) win.setFullScreen(false)
    const wa = (disp || screen.getPrimaryDisplay()).workArea
    win.setBounds({ x: wa.x + 60, y: wa.y + 60, width: Math.round(wa.width * 0.5), height: Math.round(wa.width * 0.5 * 9 / 16) })
  } catch (e) {}
}
// projector plugged in / pulled out while the app runs
app.whenReady().then(() => {
  screen.on('display-added', (e, d) => {
    sendTo(controlWin, 'displays-changed')
    if (outputWin && !outputWin.isDestroyed() && d && d.id !== screen.getPrimaryDisplay().id) { crashLog('display added -> projector moves there'); projToDisplay(outputWin, d) }
  })
  screen.on('display-removed', (e, d) => {
    sendTo(controlWin, 'displays-changed')
    if (!outputWin || outputWin.isDestroyed()) return
    const still = screen.getAllDisplays().some(x => x.id !== screen.getPrimaryDisplay().id)
    if (still) projToDisplay(outputWin, pickProjDisplay()); else { crashLog('projector display removed -> window on the laptop'); projToWindow(outputWin) }
  })
})
ipcMain.handle('proj-prepare', (e, displayId) => { projDisplayId = (displayId == null || displayId === '') ? null : Number(displayId); return true })
ipcMain.on('out-info', (e, info) => { lastOutInfo = info; sendTo(controlWin, 'out-info', info); sendTo(deckWin, 'out-info', info) })
ipcMain.handle('get-out-info', () => lastOutInfo)
// DROPPED FILES WITHOUT A PATH (from a browser / screenshot thumbnail): copy into media/drops so the projector window
// and saved presets can load them (a blob: URL only lives inside the control window until it closes)
ipcMain.handle('save-drop', (e, { name, buf }) => {
  try {
    const dir = path.join(__dirname, 'media', 'drops'); fs.mkdirSync(dir, { recursive: true })
    const safe = String(name || 'drop').replace(/[^\w.\-]+/g, '_').slice(-80) || 'drop'
    const fp = path.join(dir, Date.now() + '_' + safe)
    fs.writeFileSync(fp, Buffer.from(buf))
    return { ok: true, path: fp, url: require('url').pathToFileURL(fp).href }
  } catch (er) { return { ok: false, error: String(er && er.message) } }
})
ipcMain.handle('output-fullscreen', (e, on) => {
  if (!outputWin || outputWin.isDestroyed()) return false
  // F on the projector: full screen on/off (simple full screen on the screen it is on; off = an ordinary window)
  const isFull = (outputWin.isSimpleFullScreen && outputWin.isSimpleFullScreen()) || outputWin.isFullScreen()
  const want = (on == null) ? !isFull : !!on
  try {
    if (want) { const d = screen.getDisplayMatching(outputWin.getBounds()); projToDisplay(outputWin, d) }
    else projToWindow(outputWin, screen.getDisplayMatching(outputWin.getBounds()))
  } catch (er) {}
  return want
})
ipcMain.handle('open-pointcloud', () => {
  if (pcWin) { pcWin.focus(); return true }
  pcWin = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#000000', title: 'HVFT VISION — POINT CLOUD',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  })
  watchWin(pcWin, 'POINTCLOUD')
  pcWin.loadFile('pointcloud.html')          // renderer GPU (unproject di vertex shader)
  const pw = pcWin
  pw.webContents.on('did-finish-load', () => sendTo(pw, 'depth-state', lastDepthState))
  pw.on('closed', () => { if (pcWin === pw) pcWin = null })
  return true
})

// teruskan setting dari control -> output
let lastSettings = null
ipcMain.on('settings', (e, s) => { lastSettings = s; sendTo(outputWin, 'settings', s) })
ipcMain.on('request-ai-depth', (e, on) => { sendTo(controlWin, 'request-ai-depth', on) })
ipcMain.on('ai-depth-frame', (e, f) => {
  const pf = Object.assign({}, f, { ai: true })
  sendTo(pcWin, 'depth-frame', pf)
  sendTo(outputWin, 'depth-frame', pf)
  sendTo(deckWin, 'depth-frame', pf)
})
// ---- cache model DEPTH-AI di disk (unduh sekali) ----
ipcMain.handle('get-depth-model', async () => {
  const dir = path.join(app.getPath('userData'), 'models')
  const file = path.join(dir, 'depth-anything-v2-small.onnx')
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 1000000) {
      return { ok: true, cached: true, buf: fs.readFileSync(file).buffer }
    }
  } catch (e) {}
  const url = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx'
  try {
    const res = await fetch(url)
    if (!res.ok) return { ok: false, error: 'unduh gagal ' + res.status }
    const ab = await res.arrayBuffer()
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, Buffer.from(ab)) } catch (e) {}
    return { ok: true, cached: false, buf: ab }
  } catch (e) { return { ok: false, error: (e && e.message) || 'unduh gagal' } }
})

ipcMain.handle('get-collage', () => {
  try {
    const dir = path.join(__dirname, 'collage')
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter(n => /\.(png|jpe?g|webp|gif)$/i.test(n)).sort()
      .map(n => ({ name: n, url: pathToFileURL(path.join(dir, n)).href }))
  } catch (e) { return [] }
})

ipcMain.handle('get-backgrounds', () => {
  try {
    const dir = path.join(__dirname, 'backgrounds')
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter(n => /\.(png|jpe?g|webp)$/i.test(n)).sort()
      .map(n => ({ name: n, url: pathToFileURL(path.join(dir, n)).href }))
  } catch (e) { return [] }
})
