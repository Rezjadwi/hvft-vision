// HVFT VISION — pipeline.js
// Kamera -> segmentasi orang (MediaPipe) -> buffer kerja (rasio kamera) ->
// efek per-piksel (effects.js) -> blit cover-crop ke layar -> lapis vektor/HUD.
//
// Buffer kerja SELALU mengikuti rasio kamera, lalu di-crop saat ditempel ke
// layar. Jadi jendela boleh diubah bentuknya tanpa gambar jadi gepeng.

const MP_LOCAL = './vendor/tasks-vision/vision_bundle.mjs'
const MP_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
const MP_WASM_LOCAL = './vendor/tasks-vision/wasm'
const MP_WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL_LOCAL = './vendor/models/selfie_segmenter.tflite'
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'
// deteksi objek/orang — model yang sama dengan VisiFX (ObjectDetectorHelper.kt)
const DET_LOCAL = './vendor/models/efficientdet_lite2.tflite'
const DET_CDN = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite'
const FACE_CDN = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
// label COCO -> Indonesia (seperti VisiFX)
const LABEL_ID = {
  person: 'ORANG', chair: 'KURSI', 'dining table': 'MEJA', 'tv': 'LAYAR', laptop: 'LAPTOP',
  'cell phone': 'PONSEL', bottle: 'BOTOL', cup: 'GELAS', book: 'BUKU', clock: 'JAM',
  backpack: 'TAS', handbag: 'TAS', keyboard: 'KEYBOARD', mouse: 'MOUSE', couch: 'SOFA',
  bed: 'RANJANG', 'potted plant': 'TANAMAN', vase: 'VAS', car: 'MOBIL', bicycle: 'SEPEDA',
  motorcycle: 'MOTOR', 'wine glass': 'GELAS', remote: 'REMOTE', scissors: 'GUNTING'
}

// ---------- STROBE / FLICKER berbasis FREKUENSI (Hz nyata, bukan per-frame) ----------
// G = { on, mode:'strobe'|'flicker'|'pulse'|'ramp', rate:0..1, duty:0..1, depth:0..1,
//       band:'off|low|mid|high|sel|onset', amt:-1..1, invert, white }
// rate 0..1 -> 0.5..30 Hz (kurva kuadratik: ujung bawah lebih halus diatur).
// A = { low, mid, high, sel, onset, amt } nilai audio saat ini.
// Mengembalikan LEVEL 0..1 (1 = penuh terlihat). Dipakai pipeline DAN komposer lapis.
function hvftGateLevel (G, now, A) {
  if (!G || !G.on) return 1
  A = A || {}
  let r = +G.rate; if (!(r >= 0)) r = 0.35
  if (G.band && G.band !== 'off') {
    let e = 0
    if (G.band === 'low') e = A.low || 0
    else if (G.band === 'mid') e = A.mid || 0
    else if (G.band === 'high') e = A.high || 0
    else if (G.band === 'sel') e = A.sel || 0
    else if (G.band === 'onset') e = A.onset || 0
    else e = A[G.band] || 0   // TEXTURE links (Meyda): flat / crest / sharp / wide
    r += e * (+G.amt || 0) * (A.amt == null ? 1 : A.amt)
  }
  r = r < 0 ? 0 : r > 1 ? 1 : r
  const hz = 0.5 + r * r * 29.5
  const duty = (G.duty == null) ? 0.5 : Math.max(0.02, Math.min(0.98, +G.duty))
  const t = now / 1000
  const ph = (t * hz) % 1
  const mode = G.mode || 'strobe'
  let lv
  if (mode === 'flicker') {                       // acak per-langkah: kedip tak beraturan
    const stp = Math.floor(t * hz) | 0
    lv = (((hash(stp & 0x7fffffff, 17) % 1000) / 1000) < duty) ? 1 : 0
  } else if (mode === 'pulse') {                  // naik-turun halus (tanpa kedip keras)
    lv = 0.5 + 0.5 * Math.cos(6.2832 * ph)
    lv = Math.pow(lv, Math.max(0.15, (1 - duty) * 4))
  } else if (mode === 'ramp') {                   // gigi gergaji: terang lalu meredup
    lv = 1 - ph
  } else {                                        // 'strobe': on/off dengan tepi HALUS (anti kasar)
    // ramp lembut di kedua tepi (smoothstep) supaya tak "clack" kotak; makin cepat -> tepi makin tipis
    const edge = Math.min(0.16, 0.10 + (1 - r) * 0.10)
    const up = ph < edge ? ph / edge : 1                        // nyala
    const dn = ph > duty ? (ph < duty + edge ? 1 - (ph - duty) / edge : 0) : 1   // padam
    let g = Math.min(up, dn); g = g < 0 ? 0 : g > 1 ? 1 : g
    lv = g * g * (3 - 2 * g)                                    // smoothstep
  }
  if (G.invert) lv = 1 - lv
  const depth = (G.depth == null) ? 1 : Math.max(0, Math.min(1, +G.depth))
  return 1 - depth * (1 - lv)
}
if (typeof window !== 'undefined') window.hvftGateLevel = hvftGateLevel
// GERBANG MIC GLOBAL — default MATI. Tombol Mic yang menyalakannya. Semua pipe menghormati flag ini.
if (typeof window !== 'undefined' && typeof window.HVFT_MIC_ON === 'undefined') window.HVFT_MIC_ON = false

class HvftPipeline {
  constructor (canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: true })
    this.video = document.createElement('video')
    this.video.autoplay = true; this.video.playsInline = true; this.video.muted = true
    // ---- HVFT Cam (Android) via WiFi: MJPEG masuk ke <img>, digambar ke kanvas ini jadi sumber base ----
    this.netCanvas = document.createElement('canvas'); this.netCanvas.width = 1280; this.netCanvas.height = 720
    this.netCtx = this.netCanvas.getContext('2d')
    this.netImg = null; this.useNetCam = false; this.netRAF = 0; this.netUrl = null; this.netOk = false
    // ---- LAYER ----
    // layers[0] = BASE (kamera / video / gambar) -> yang diberi efek
    // layers[1..] = overlay (PNG transparan / video alfa / video biasa)
    this.layers = [
      { role: 'base', kind: 'camera', url: '', el: null, opacity: 1, blend: 'source-over', x: 0.5, y: 0.5, scale: 1, visible: true },
      { role: 'over', kind: 'none', url: '', el: null, opacity: 1, blend: 'lighter', x: 0.5, y: 0.5, scale: 0.35, visible: true },
      { role: 'over', kind: 'none', url: '', el: null, opacity: 1, blend: 'lighter', x: 0.5, y: 0.5, scale: 0.35, visible: true }
    ]
    // kanvas kerja (resolusi efek) + kanvas keluaran piksel
    this.work = document.createElement('canvas')
    this.wctx = this.work.getContext('2d', { willReadFrequently: true })
    this.paint = document.createElement('canvas')
    this.pctx = this.paint.getContext('2d')
    // ---- LiDAR sebagai sumber base: siluet depth digambar ke kanvas ini ----
    this.lidarCanvas = document.createElement('canvas')
    this.lidarCanvas.width = 720; this.lidarCanvas.height = 540
    this.lidarCtx = this.lidarCanvas.getContext('2d')
    this.lidarSmall = document.createElement('canvas')
    this.lidarSmallCtx = this.lidarSmall.getContext('2d', { willReadFrequently: true })
    this.lidarLive = false

    this.W = 0; this.H = 0
    this.segmenter = null
    this.modelReady = false
    this.running = false
    this.tick = 0
    this.spec = new Uint8Array(72)        // spektrum untuk indikator panel
    this.band = { low: 0, mid: 0, high: 0 }
    this.bandSel = 0
    this.flux = 0                          // spectral flux (perubahan spektrum)
    this.fluxAvg = 0
    this.onset = 0                         // envelope serangan, 0..1
    this.centroid = 0                      // pusat massa spektrum, 0..1
    this.audioOn = false
    this.blobs = []
    this.borderEma = 0
    this.settings = {
      textCfg: { str: '', overlay: false, size: 0.16, react: 1 },
      effect: 'pointcloud', color: 'hvft', bg: 0.0, sens: 0.5,
      mirror: true, blob: 'off', hud: true, polarity: 'auto', res: 960,
      fit: 'contain',  // 'contain' = utuh (mengikuti lebar window), 'cover' = isi penuh & crop
      // reaksi audio berbasis FREKUENSI (bukan level dB) — untuk musik noise
      audio: { density: true, burst: true, strobe: true, mesh: true },
      audioAmt: 0.4,
      audioBand: 'all',  // 'low' | 'mid' | 'high' | 'all'
      grid: false, gridCols: 12,      // GroundPlane.dotGridMasked
      blobLine: 1.2,                  // tebal garis blob tracker
      track: 'motion',                // 'motion' (frame-diff) | 'object' (EfficientDet)
      trackSize: 0.06,                // UKURAN KOTAK TETAP — tidak ikut besar objek
      blobColorMode: 'mono',          // 'mono' | 'green' | 'orange' | 'multi' (warna beda tiap blob)
      blobInvert: false,              // INVERT: kotak terisi (solid) bukan garis
      hudScale: 0.7,                  // ukuran HUD poster
      layerPulse: true,
      lidarNear: 0.3, lidarFar: 4.0, lidarGrain: false, lidarRelief: true,   // kontrol siluet LiDAR
      depthCut: 0.35,                 // potong latar: buang piksel yang lebih JAUH dari ambang (0..0.95)
      depthFlip: 'auto',              // 'auto' | 'normal' | 'flip' — override balik vertikal depth
      audioPanel: false,
      fxParams: {},                   // { '<idEfek>': { '<param>': 0..1 } }  — nilai slider per efek
      fxLinks: {},                    // { '<idEfek>.<param>': { band:'off|low|mid|high|sel|onset', amt:-1..1 } }
      strobe: { on: false, mode: 'strobe', rate: 0.35, duty: 0.5, depth: 1, band: 'off', amt: 0.5, invert: false, white: false },
      // KUALITAS CROP (matte alpha) — penting saat pakai pola sebagai LATAR di belakang subjek
      matteFeather: 0.32,             // 0..1 -> 0..7 px: haluskan tepi (anti gerigi)
      matteStab: 0.45,                // 0..1 -> redam kedip tepi antar-frame (anti "mendidih")
      matteExpand: 0.5,               // 0.5 = netral; <0.5 kikis (buang fringe latar) · >0.5 lebarkan
      matteClean: true,               // isi lubang kecil + buang bintik di siluet
      bgfx: 'none',                   // LATAR POLA: pola (plasma/cymatics) mengisi AREA LATAR di belakang subjek, di kanal yang sama
      bgBase: 0.75,                   // terang dasar pola latar (0..1)
      bgfxPower: 0.7                  // KUASA CAHAYA: seberapa besar audio menaikkan terang pola latar (0..1)
    }
    this.lut = buildLut('white')
    this.lutName = 'white'
    this.onStatus = () => {}
  }

  // ---------- kamera ----------
  static async listCameras () {
    try { await navigator.mediaDevices.getUserMedia({ video: true }).then(s => s.getTracks().forEach(t => t.stop())) } catch (e) {}
    const devs = await navigator.mediaDevices.enumerateDevices()
    return devs.filter(d => d.kind === 'videoinput')
  }

  async startCamera (deviceId) {
    try { console.error('[HVFTCAM-R] startCamera dev=' + (deviceId || 'default')) } catch (e) {}
    this.stopNetworkCamera(true)
    if (this.stream) this.stream.getTracks().forEach(t => t.stop())
    const c = { video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false }
    if (deviceId) c.video.deviceId = { exact: deviceId }
    this.stream = await navigator.mediaDevices.getUserMedia(c)
    this.video.srcObject = this.stream
    await this.video.play()
    this.deviceId = deviceId || null
    return this.stream
  }

  // ---------- HVFT Cam (Android) lewat WiFi — MJPEG, tanpa app pihak ketiga ----------
  async startNetworkCamera (url) {
    // the hidden legacy pipe (audio only) must not open the phone stream: the deck channel does (one MJPEG client)
    if (this.audioOnly) { try { console.error('[HVFTCAM-R] legacy pipe skips HVFT Cam (deck channel opens it)') } catch (e) {} return true }
    this.stopNetworkCamera(false)
    if (this.stream) { try { this.stream.getTracks().forEach(t => t.stop()) } catch (e) {} ; this.stream = null }
    try { this.video.srcObject = null } catch (e) {}
    this.netUrl = String(url || '').replace(/\/+$/, '')
    this.netOk = false
    // STATUS (Oct 11): shown on the channel itself + logs/hvftcam.log (not rate-limited) · auto-retry when it fails / stays black
    const nlog = (m) => { try { if (window.hvft && window.hvft.hvftcamLog) window.hvft.hvftcamLog(m) } catch (e) {} try { console.error('[HVFTCAM-R] ' + m) } catch (e) {} }
    this.netStat = { state: 'connecting', url: this.netUrl, w: 0, h: 0, t0: performance.now(), tries: (this.netStat && this.netStat.url === this.netUrl ? this.netStat.tries : 0) + 1, err: '' }
    nlog('startNetworkCamera ' + this.netUrl + '/video (try ' + this.netStat.tries + ')')
    const img = new Image()
    img.crossOrigin = 'anonymous'              // server MJPEG kirim CORS * -> kanvas tidak ter-taint
    img.onerror = (ev) => { this.netOk = false; if (this.netStat) { this.netStat.state = 'error'; this.netStat.err = 'stream unreachable' } nlog('netImg ERROR (stream unreachable / CORS / Local Network) ' + this.netUrl) }
    img.onload = () => { nlog('netImg ONLOAD ' + (img.naturalWidth || 0) + 'x' + (img.naturalHeight || 0)) }
    img.src = this.netUrl + '/video'           // multipart/x-mixed-replace: Chromium meng-update <img> terus (exact path: the phone server matches '/video' only)
    this.netImg = img
    clearTimeout(this._netRetry)
    const watch = () => {   // no picture after 6 s, or an error -> reconnect (phone app restarted / WiFi hiccup / single-client server busy)
      if (!this.useNetCam || this.netUrl !== (this.netStat && this.netStat.url)) return
      if (this.netStat.state !== 'live') { nlog('no picture yet (' + this.netStat.state + ') -> reconnect'); this.startNetworkCamera(this.netUrl); return }
      this._netRetry = setTimeout(watch, 6000)
    }
    this._netRetry = setTimeout(watch, 6000)
    this.useNetCam = true
    this.deviceId = 'hvftcam:' + this.netUrl
    const loop = () => {
      if (!this.useNetCam) return
      try {
        const iw = (this.netImg && this.netImg.naturalWidth) || 0
        const ih = (this.netImg && this.netImg.naturalHeight) || 0
        if (iw && ih) {
          // ROTATE / FLIP (Oct 11): the phone sends its sensor picture (720×960 portrait) whatever way it is held ->
          // the channel turns it (L.netRot 0/90/180/270, L.netFlip) so a landscape phone gives an upright landscape picture
          const rot = ((this.netRot | 0) % 360 + 360) % 360, side = (rot === 90 || rot === 270)
          const cw = side ? ih : iw, chh = side ? iw : ih
          if (this.netCanvas.width !== cw || this.netCanvas.height !== chh) { this.netCanvas.width = cw; this.netCanvas.height = chh }
          const x = this.netCtx; x.setTransform(1, 0, 0, 1, 0, 0)
          x.translate(cw / 2, chh / 2); if (rot) x.rotate(rot * Math.PI / 180); if (this.netFlip) x.scale(-1, 1)
          x.drawImage(this.netImg, -iw / 2, -ih / 2, iw, ih); x.setTransform(1, 0, 0, 1, 0, 0)
          if (!this.netOk) { nlog('FIRST FRAME ' + iw + 'x' + ih + ' after ' + Math.round(performance.now() - this.netStat.t0) + ' ms') }
          this.netOk = true
          if (this.netStat) { this.netStat.state = 'live'; this.netStat.w = iw; this.netStat.h = ih; this.netStat.tries = 0 }
        }
      } catch (e) {}
      this.netRAF = requestAnimationFrame(loop)
    }
    cancelAnimationFrame(this.netRAF); this.netRAF = requestAnimationFrame(loop)
    try {
      const st = this.netCanvas.captureStream(30)
      if (this.video.srcObject) { try { this.video.srcObject.getTracks().forEach(t => t.stop()) } catch (e) {} }
      this.video.srcObject = st
      this.video.play().catch(() => {})
      console.error('[HVFTCAM-R] pipe.video <- netCanvas.captureStream (semua konsumen video = HVFT Cam)')
    } catch (e) { console.error('[HVFTCAM-R] captureStream GAGAL: ' + (e && e.message)) }
    return true
  }

  stopNetworkCamera (resetFlag) {
    clearTimeout(this._netRetry)
    if (this.netRAF) { cancelAnimationFrame(this.netRAF); this.netRAF = 0 }
    if (this.netImg) { try { this.netImg.onerror = null; this.netImg.src = '' } catch (e) {} ; this.netImg = null }
    this.netOk = false
    if (resetFlag !== false) this.useNetCam = false
  }

  // ---------- layer ----------
  mkEl (kind) {
    if (kind === 'image') return new Image()
    const v = document.createElement('video')
    v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true
    return v
  }

  // canvas dari renderer luar (mis. PointCloudGPU) dipakai sebagai sumber L1
  setExternalCanvas (cv) { this.extCanvas = cv }

  setLayerClip (i, kind, url) {
    const L = this.layers[i]; if (!L) return
    L.kind = kind; L.url = url || ''
    if (kind === 'camera' || kind === 'none' || kind === 'lidar' || kind === 'depthai' || kind === 'pc3d' || kind === 'ext') { L.el = null; return }
    L.el = this.mkEl(kind)
    L.el.src = url
    if (kind !== 'image') L.el.play().catch(() => {})
  }

  setLayerParams (i, o) { Object.assign(this.layers[i] || {}, o) }

  // terima 1 frame LiDAR (depth mm) -> gambar siluet grayscale ke lidarCanvas
  pushLidarFrame (f, flipY = true) {
    const w = f.w, h = f.h
    const sm = this.lidarSmall
    if (sm.width !== w || sm.height !== h) { sm.width = w; sm.height = h }
    let dep = new Uint16Array(f.depth)
    if (f.kinect) {   // Kinect leaves 0 (no reading) speckles/holes in hair & edges -> fill short gaps from the neighbours
      const df = new Uint16Array(dep)
      for (let y = 0; y < h; y++) { let last = 0, run = 0; for (let x = 0; x < w; x++) { const i = y * w + x; if (df[i]) { last = df[i]; run = 0 } else if (last && ++run <= 6) df[i] = last } }
      for (let x = 0; x < w; x++) { let last = 0, run = 0; for (let y = 0; y < h; y++) { const i = y * w + x; if (df[i]) { last = df[i]; run = 0 } else if (last && ++run <= 4) df[i] = last } }
      dep = df
    }
    const near = this.settings.lidarNear ?? 0.3
    const far = this.settings.lidarFar ?? 4.0
    const grain = !!this.settings.lidarGrain
    const relief = this.settings.lidarRelief !== false   // auto-kontras ke kedalaman subjek
    // POTONG LATAR hanya untuk DEPTH-AI (kedalamannya relatif, tanpa meter).
    // LiDAR sudah punya skala meter asli -> pakai slider DEKAT/JAUH.
    const isAi = this.layers[0].kind === 'depthai'
    const cut = isAi ? Math.min(0.95, Math.max(0, this.settings.depthCut ?? 0)) : 0
    const img = this.lidarSmallCtx.createImageData(w, h)
    const d = img.data
    // mode Relief: normalisasi ke min/max kedalaman subjek (dalam jendela near..far)
    // + smoothing EMA antar-frame agar rentang tidak gonjang-ganjing.
    let lo = near, hi = far
    if (relief) {
      let zmin = 1e9, zmax = -1e9
      for (let i = 0; i < w * h; i++) {
        const z = dep[i] / 1000
        if (z > 0.05 && z >= near && z <= far) { if (z < zmin) zmin = z; if (z > zmax) zmax = z }
      }
      if (zmax - zmin < 0.05) { zmin = near; zmax = far }   // tak ada subjek → fallback
      this._lidLo = this._lidLo == null ? zmin : this._lidLo + (zmin - this._lidLo) * 0.25
      this._lidHi = this._lidHi == null ? zmax : this._lidHi + (zmax - this._lidHi) * 0.25
      lo = this._lidLo; hi = Math.max(this._lidHi, lo + 0.05)
    }
    const span = hi - lo
    const useRgb = (typeof window !== 'undefined' && window.HVFT_DEPTH_RGB) && f.rgb   // RGB: subjek pakai warna kamera, latar dipotong depth
    const crgb = useRgb ? new Uint8Array(f.rgb) : null
    // PLEXUS: kalau mode aktif, kumpulkan peta "subjek" (mask) utk jaring titik
    const plexusOn = (typeof window !== 'undefined' && !!window.HVFT_DEPTH_PLEXUS)
    const maskArr = plexusOn ? new Float32Array(w * h) : null
    // TERMAL: colormap HVFT (dekat=oranye/putih-panas, jauh=gelap) — gaya depth-map editor
    const thermal = (typeof window !== 'undefined' && !!window.HVFT_DEPTH_THERMAL)
    // DISPLACE: geser piksel kamera berdasar kedalaman -> relief/parallax
    const displaceOn = (typeof window !== 'undefined' && !!window.HVFT_DEPTH_DISPLACE) && f.rgb
    const dispRgb = displaceOn ? new Uint8Array(f.rgb) : null
    const dispAmt = (typeof window !== 'undefined' && window.HVFT_DISPLACE_OPT && window.HVFT_DISPLACE_OPT.amount != null) ? window.HVFT_DISPLACE_OPT.amount : 0.18
    // KINECT LOOKS (Oct 7): DEPTH KEY (camera/IR picture cut out by real depth, auto-levelled -> works on a dark stage),
    // IR NOISE (raw infrared speckle as a harsh texture, audio-driven), CONTOUR (depth drawn as ridge lines, see _contour)
    const W0 = typeof window !== 'undefined' ? window : {}
    const keyOn = !!W0.HVFT_DEPTH_KEY && !!f.rgb, irOn = !!W0.HVFT_DEPTH_IR && !!f.rgb, contourOn = !!W0.HVFT_DEPTH_CONTOUR
    const krgb = (keyOn || irOn) ? new Uint8Array(f.rgb) : null
    const rcA = this.audioOn ? this._effAmt() : 0, BDa = this.band || {}
    const aLow = (BDa.low || 0) * rcA, aHigh = (BDa.high || 0) * rcA, aOn = (this.onset || 0) * rcA
    let kLo = 0, kSpan = 255
    if (keyOn) {   // brightness range of the subject only (EMA) -> stretch it to full range
      let mn = 255, mx = 0
      for (let i = 0; i < w * h; i += 2) { const z = dep[i] / 1000; if (z > 0.05 && z >= near && z <= far) { const y = (krgb[i * 3] * 77 + krgb[i * 3 + 1] * 150 + krgb[i * 3 + 2] * 29) >> 8; if (y < mn) mn = y; if (y > mx) mx = y } }
      if (mx > mn) { this._kLo = this._kLo == null ? mn : this._kLo + (mn - this._kLo) * 0.2; this._kHi = this._kHi == null ? mx : this._kHi + (mx - this._kHi) * 0.2 }
      kLo = this._kLo || 0; kSpan = Math.max(24, (this._kHi || 255) - kLo)
    }
    const irGain = 2.2 + aLow * 6, irBin = aHigh > 0.45, irInv = aOn > 0.9
    for (let i = 0; i < w * h; i++) {
      const z = dep[i] / 1000
      let lum = 0
      if (z > 0.05 && z >= near && z <= far) {
        lum = 1 - (z - lo) / span
        lum = lum < 0 ? 0 : lum > 1 ? 1 : lum
        // jendela kedalaman: buang latar (lebih jauh dari ambang), lalu regangkan kontras subjek
        if (cut > 0) lum = lum <= cut ? 0 : (lum - cut) / (1 - cut)
        if (maskArr) maskArr[i] = lum   // mask halus (sebelum grain) utk plexus
        if (grain) { const hx = ((i * 2654435761) >>> 0 & 255) / 255; lum = lum > hx ? 1 : lum * 0.12 }
      }
      const p = i * 4
      if (irOn) {
        let v = (krgb[i * 3] - 6) * irGain * (lum > 0 ? 1.25 : 0.7)   // body pops out of the speckle field
        if (irBin) v = v > 110 ? 255 : 0                                  // HIGH = harsh xerox threshold
        if (irInv) v = 255 - v                                            // hit = one negative frame
        const c = v < 0 ? 0 : v > 255 ? 255 : v | 0
        if (this.lut && this.lut.name === 'hvft') { d[p] = this.lut[c * 3]; d[p + 1] = this.lut[c * 3 + 1]; d[p + 2] = this.lut[c * 3 + 2] } else { d[p] = c; d[p + 1] = c; d[p + 2] = c }
        d[p + 3] = 255
      } else if (keyOn) {
        if (lum > 0) {
          let r = (krgb[i * 3] - kLo) * 255 / kSpan, g = (krgb[i * 3 + 1] - kLo) * 255 / kSpan, b = (krgb[i * 3 + 2] - kLo) * 255 / kSpan
          const y = 0.299 * r + 0.587 * g + 0.114 * b; if (y < 18) { const a = 18 - y; r += a; g += a; b += a }   // never black inside the key -> mask stays whole
          d[p] = r < 0 ? 0 : r > 255 ? 255 : r; d[p + 1] = g < 0 ? 0 : g > 255 ? 255 : g; d[p + 2] = b < 0 ? 0 : b > 255 ? 255 : b
        } else { d[p] = 0; d[p + 1] = 0; d[p + 2] = 0 }
        d[p + 3] = 255
      } else if (useRgb) {
        if (lum > 0 && crgb) { d[p] = crgb[i * 3]; d[p + 1] = crgb[i * 3 + 1]; d[p + 2] = crgb[i * 3 + 2] } else { d[p] = 0; d[p + 1] = 0; d[p + 2] = 0 }
        d[p + 3] = 255
      } else if (displaceOn) {
        // geser piksel subjek horizontal sesuai kedalaman (dekat geser kanan, jauh kiri) -> relief
        if (lum > 0) {
          const x = i % w, y = (i / w) | 0
          let zn = 1 - (z - lo) / span; zn = zn < 0 ? 0 : zn > 1 ? 1 : zn
          let sxk = x + (((zn - 0.5) * dispAmt * w) | 0)
          if (sxk < 0) sxk = 0; else if (sxk >= w) sxk = w - 1
          const si = (y * w + sxk) * 3
          d[p] = dispRgb[si]; d[p + 1] = dispRgb[si + 1]; d[p + 2] = dispRgb[si + 2]
        } else { d[p] = 0; d[p + 1] = 0; d[p + 2] = 0 }
        d[p + 3] = 255
      } else if (thermal) {
        // 0 hitam -> #F2A03D (242,160,61) -> putih-kuning panas (255,240,190)
        const v = lum
        let r, g, b
        if (v < 0.6) { const q = v / 0.6; r = q * 242; g = q * 160; b = q * 61 }
        else { const q = (v - 0.6) / 0.4; r = 242 + q * 13; g = 160 + q * 80; b = 61 + q * 129 }
        d[p] = r | 0; d[p + 1] = g | 0; d[p + 2] = b | 0; d[p + 3] = 255
      } else {
        const c = (lum * 255) | 0
        if (this.lut && this.lut.name === 'hvft') { d[p] = this.lut[c * 3]; d[p + 1] = this.lut[c * 3 + 1]; d[p + 2] = this.lut[c * 3 + 2] } else { d[p] = c; d[p + 1] = c; d[p + 2] = c }   // HVFT palette on LiDAR/Kinect depth
        d[p + 3] = 255
      }
    }
    this.lidarSmallCtx.putImageData(img, 0, 0)
    // upscale halus ke lidarCanvas (rasio 4:3) supaya efek punya resolusi
    const LC = this.lidarCanvas
    LC.height = Math.round(LC.width * h / w)
    const fo = this.settings.depthFlip || 'auto'
    const doFlip = fo === 'auto' ? flipY : (fo === 'flip')
    if (contourOn) { this._contour(dep, w, h, near, far, lo, span, doFlip, aLow, aHigh, aOn); this.lidarLive = true; return }
    // ===== PLEXUS: jaring titik bercahaya + garis + kilatan gerakan =====
    if (plexusOn && typeof PlexusFX !== 'undefined') {
      if (!this._plexus) this._plexus = new PlexusFX()
      const prgb = crgb || (f.rgb ? new Uint8Array(f.rgb) : null)
      const popt = (typeof window !== 'undefined') ? window.HVFT_PLEXUS_OPT : null
      this.lidarCtx.imageSmoothingEnabled = true
      try {
        this._plexus.render(this.lidarCtx, LC.width, LC.height, maskArr, prgb, w, h, popt, doFlip, sm)
      } catch (e) { /* jaga-jaga: jangan hentikan loop */ }
      this.lidarLive = true
      return
    }
    this.lidarCtx.imageSmoothingEnabled = !grain
    this.lidarCtx.clearRect(0, 0, LC.width, LC.height)
    if (doFlip) {
      this.lidarCtx.save()
      this.lidarCtx.translate(0, LC.height); this.lidarCtx.scale(1, -1)   // balik vertikal (LiDAR)
      this.lidarCtx.drawImage(sm, 0, 0, LC.width, LC.height)
      this.lidarCtx.restore()
    } else {
      this.lidarCtx.drawImage(sm, 0, 0, LC.width, LC.height)               // webcam sudah tegak
    }
    this.lidarLive = true
  }

  // CONTOUR: depth as stacked ridge lines (the "Unknown Pleasures" look). The body rises out of each line; lower lines
  // hide the ones behind them. LOW = taller ridges, HIGH = jitter, hit = thicker lines.
  _contour (dep, w, h, near, far, lo, span, flip, aLow, aHigh, aOn) {
    const LC = this.lidarCanvas, c = this.lidarCtx, CW = LC.width, CH = LC.height
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.fillStyle = '#000'; c.fillRect(0, 0, CW, CH)
    const N = 56, amp = CH * (0.14 + aLow * 0.22), step = 2
    const lut = this.lut, col = v => (lut && lut.name === 'hvft') ? 'rgb(' + lut[v * 3] + ',' + lut[v * 3 + 1] + ',' + lut[v * 3 + 2] + ')' : 'rgb(' + v + ',' + v + ',' + v + ')'
    c.lineJoin = 'round'
    const pts = new Float32Array(Math.ceil(w / step) * 2 + 4)
    for (let r = 0; r < N; r++) {
      const sy = Math.min(h - 1, Math.round((r + 0.5) * h / N)), row = flip ? (h - 1 - sy) : sy
      const base = CH * 0.1 + (r + 0.5) / N * CH * 0.86
      let prev = 0, maxRel = 0, n = 0
      for (let x = 0; x < w; x += step) {
        const z = dep[row * w + x] / 1000
        let rel = (z > 0.05 && z >= near && z <= far) ? 1 - (z - lo) / span : 0
        rel = rel < 0 ? 0 : rel > 1 ? 1 : rel
        rel = prev * 0.45 + rel * 0.55; prev = rel
        if (rel > maxRel) maxRel = rel
        const jit = (aHigh > 0.05 && rel > 0.02) ? (Math.random() - 0.5) * aHigh * 14 : 0
        pts[n++] = x / (w - 1) * CW; pts[n++] = base - rel * amp + jit
      }
      c.beginPath(); c.moveTo(0, CH); for (let k = 0; k < n; k += 2) c.lineTo(pts[k], pts[k + 1]); c.lineTo(CW, CH); c.closePath(); c.fillStyle = '#000'; c.fill()
      c.beginPath(); for (let k = 0; k < n; k += 2) { if (k) c.lineTo(pts[k], pts[k + 1]); else c.moveTo(pts[k], pts[k + 1]) }
      c.lineWidth = 1.3 + aOn * 2.2; c.strokeStyle = col(maxRel > 0.05 ? 255 : 225); c.stroke()
    }
  }

  srcEl () {
    const L = this.layers[0]
    if (L.kind === 'pc3d' || L.kind === 'ext') return this.extCanvas || this.video
    if (L.kind === 'lidar' || L.kind === 'depthai') return this.lidarCanvas
    if (L.kind === 'camera' || !L.el) return this.useNetCam ? this.netCanvas : this.video
    return L.el
  }

  srcSize () {
    const L = this.layers[0]
    if (L.kind === 'pc3d' || L.kind === 'ext') return this.extCanvas ? [this.extCanvas.width, this.extCanvas.height] : [0, 0]
    if (L.kind === 'lidar' || L.kind === 'depthai') return this.lidarCanvas ? [this.lidarCanvas.width, this.lidarCanvas.height] : [0, 0]
    const el = this.srcEl()
    if (L.kind === 'image' && el !== this.video) return [el.naturalWidth || 0, el.naturalHeight || 0]
    if (this.useNetCam && el === this.netCanvas) return [el.width || 0, el.height || 0]
    return [el.videoWidth || 0, el.videoHeight || 0]
  }

  elSize (L) {
    if (!L.el) return [0, 0]
    return L.kind === 'image' ? [L.el.naturalWidth || 0, L.el.naturalHeight || 0]
      : [L.el.videoWidth || 0, L.el.videoHeight || 0]
  }

  drawLayers (ctx, D) {
    for (let i = 1; i < this.layers.length; i++) {
      const L = this.layers[i]
      if (!L.visible || L.kind === 'none' || !L.el) continue
      const [ow, oh] = this.elSize(L)
      if (!ow || !oh) continue
      const pulse = (this.audioOn && this.settings.layerPulse) ? 1 + this.onset * 0.12 * (this.settings.audioAmt || 0) : 1
      const w = D.W * (L.scale || 0.35) * pulse
      const h = w * oh / ow
      ctx.save()
      ctx.globalAlpha = L.opacity ?? 1
      ctx.globalCompositeOperation = L.blend || 'lighter'
      ctx.drawImage(L.el, D.W * (L.x ?? 0.5) - w / 2, D.H * (L.y ?? 0.5) - h / 2, w, h)
      ctx.restore()
    }
  }

  async startAudio () {
    try {
      if (this.audioStream) this.stopAudio()   // restart cleanly (device / channel change)
      const AI = (typeof window !== 'undefined') ? window.HVFT_AUDIO_IN : null
      let s, src, c = null
      const ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' })
      try {
        if (AI) { const o = await AI.open(); s = o.stream; c = o.cfg; src = AI.route(ac, s, c); this.audioFellBack = o.fellBack }
        else { s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); src = ac.createMediaStreamSource(s) }
      } catch (e) { try { ac.close() } catch (e2) {} throw e }
      try { if (ac.state === 'suspended') await ac.resume() } catch (e) {}
      this.audioStream = s
      this.audioInfo = AI ? AI.info(s) : null
      // interface unplugged mid-show -> retry (falls back to the default input until it is back)
      try { s.getAudioTracks()[0].onended = () => { if (this.audioOn) setTimeout(() => { this.startAudio().catch(() => {}) }, 800) } } catch (e) {}
      const an = ac.createAnalyser()
      an.fftSize = 1024
      an.smoothingTimeConstant = 0.2   // tight to the sound (was 0.6 → 0.35)
      src.connect(an)
      this.analyser = an
      this.audioBuf = new Float32Array(an.fftSize)
      this.freqBuf = new Uint8Array(an.frequencyBinCount)
      this.audioCtxRef = ac
      this.audioOn = true
      return true
    } catch (e) { return false }
  }

  // device / channel / trim changed -> reopen only if this pipe is listening
  restartAudio () { return this.audioOn ? this.startAudio() : Promise.resolve(false) }

  // Hentikan penangkapan mic pipe ini (lepas track + tutup context). Dipakai saat Mic dimatikan.
  stopAudio () {
    try { if (this.audioStream) this.audioStream.getTracks().forEach(t => t.stop()) } catch (e) {}
    try { if (this.audioCtxRef && this.audioCtxRef.close) this.audioCtxRef.close() } catch (e) {}
    this.analyser = null; this.audioStream = null; this.audioCtxRef = null; this.audioOn = false
    this.band.low = 0; this.band.mid = 0; this.band.high = 0; this.bandSel = 0; this.onset = 0; this.flux = 0; this.tex = null
  }

  // ---------- model segmentasi ----------
  // ONE person segmenter per page, shared by every pipe (each MediaPipe GPU task owns a WebGL context; one per pipe ran
  // the page out of WebGL contexts -> "StartGraph failed: kGpuService" -> no auto subject detection).
  // GPU delegate first, CPU delegate as fallback (the selfie model is tiny, CPU is fast enough).
  static _loadSeg (forceCpu) {
    const C = HvftPipeline
    if (C._segP && !forceCpu) return C._segP
    const tryLoad = async (mod, wasmPath, modelPath, delegate) => {
      const vision = await import(/* webpackIgnore: true */ mod)
      const files = await vision.FilesetResolver.forVisionTasks(wasmPath)
      C._vision = vision; C._visionFiles = files
      const seg = await vision.ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: modelPath, delegate },
        runningMode: 'VIDEO',
        outputCategoryMask: true,
        outputConfidenceMasks: false
      })
      // smoke test: a GPU graph that cannot start throws here instead of failing silently later
      const t = document.createElement('canvas'); t.width = 64; t.height = 48; t.getContext('2d').fillRect(0, 0, 64, 48)
      C._segTs = Math.max((C._segTs || 0) + 1, performance.now())
      const r = seg.segmentForVideo(t, C._segTs); if (r && r.categoryMask) r.categoryMask.close()
      return seg
    }
    let gl2 = false
    try { const pc = document.createElement('canvas'); const g = pc.getContext('webgl2'); gl2 = !!g; if (g) { const x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext() } } catch (e) {}
    const order = (forceCpu || !gl2) ? ['CPU'] : ['GPU', 'CPU']   // no WebGL2 on this page -> don't even try the GPU graph
    C._segP = (async () => {
      for (const del of order) {
        for (const [m, w, md, tag] of [[MP_LOCAL, MP_WASM_LOCAL, MODEL_LOCAL, 'local'], [MP_CDN, MP_WASM_CDN, MODEL_CDN, 'CDN']]) {
          try { const seg = await tryLoad(m, w, md, del); C._segDel = del; C._segTag = tag; try { console.error('[HVFT info] person segmenter ready: ' + tag + ' ' + del + (gl2 ? '' : ' (page has no WebGL2)')) } catch (er) {} return seg } catch (e) { try { console.warn('[seg] ' + tag + ' ' + del + ' failed:', e && e.message) } catch (er) {} }
        }
      }
      try { console.error('[HVFT info] person segmenter FAILED on GPU and CPU -> luminance fallback') } catch (er) {}
      return null
    })()
    return C._segP
  }

  async initModel () {
    const seg = await HvftPipeline._loadSeg(false)
    this.segmenter = seg; this.vision = HvftPipeline._vision; this.visionFiles = HvftPipeline._visionFiles   // dipakai ulang oleh detektor objek
    this.modelReady = !!seg
    this.onStatus(seg ? 'model: ' + HvftPipeline._segTag + ' (' + HvftPipeline._segDel + ') OK' : 'model failed — luminance fallback')
    return this.modelReady
  }
  // runtime failure (GPU context lost etc.): rebuild the shared segmenter on the CPU, all pipes pick it up
  _segFailed () {
    const C = HvftPipeline
    C._segFails = (C._segFails || 0) + 1
    if (C._segFails < 3 || C._segRebuilding || C._segDel === 'CPU') return
    C._segRebuilding = true; this.modelReady = false
    try { console.warn('[seg] segmentation keeps failing -> CPU segmenter') } catch (e) {}
    C._loadSeg(true).then(seg => { C._segRebuilding = false; C._segFails = 0; C._segGen = (C._segGen || 0) + 1; C._seg = seg })
  }

  // ---------- deteksi objek (EfficientDet-Lite2, seperti VisiFX) ----------
  async initDetector () {
    if (this.detector || this.detLoading || !this.vision) return
    this.detLoading = true
    const mk = async (path, delegate) => this.vision.ObjectDetector.createFromOptions(this.visionFiles, {
      baseOptions: { modelAssetPath: path, delegate },
      runningMode: 'VIDEO',
      scoreThreshold: 0.15,
      maxResults: 40
    })
    // urutan coba: lokal+GPU -> lokal+CPU -> CDN+GPU -> CDN+CPU
    const attempts = [[DET_LOCAL, 'GPU'], [DET_LOCAL, 'CPU'], [DET_CDN, 'GPU'], [DET_CDN, 'CPU']]
    for (const [path, del] of attempts) {
      try { this.detector = await mk(path, del); break } catch (e) { this.detector = null }
    }
    if (this.detector) this.onStatus('deteksi objek aktif')
    else this.onStatus('object detection failed (model/GPU)')
    this.detLoading = false
  }

  // ---------- deteksi WAJAH (BlazeFace) — untuk efek Profil ----------
  async initFaceDetector () {
    if (this.faceDet || this.faceLoading || !this.vision) return
    this.faceLoading = true
    const mk = async (del) => this.vision.FaceDetector.createFromOptions(this.visionFiles, {
      baseOptions: { modelAssetPath: FACE_CDN, delegate: del },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.35
    })
    for (const del of ['GPU', 'CPU']) {
      try { this.faceDet = await mk(del); break } catch (e) { this.faceDet = null }
    }
    this.onStatus(this.faceDet ? 'deteksi wajah aktif' : 'face detection failed')
    this.faceLoading = false
  }

  updateFaces (ts) {
    if (!this.faceDet) { this.initFaceDetector(); return }
    if ((this.tick & 3) === 0) {
      let res
      try { res = this.faceDet.detectForVideo(this.work, ts) } catch (e) { return }
      const list = []
      for (const d of (res && res.detections) || []) {
        const b = d.boundingBox; if (!b) continue
        const cat = (d.categories && d.categories[0]) || {}
        list.push({ x: b.originX + b.width / 2, y: b.originY + b.height / 2, w: b.width, h: b.height, face: true, label: 'FACE', e: Math.round((cat.score || 0) * 100) })
      }
      list.sort((a, b) => b.e - a.e)
      this.rawDet = list.slice(0, 12)
    }
    const prev = this.blobs || []
    this.blobs = (this.rawDet || []).map(d => {
      let best = null, bd = Infinity
      for (const q of prev) { const dd = (d.x - q.x) ** 2 + (d.y - q.y) ** 2; if (dd < bd) { bd = dd; best = q } }
      if (best && bd < (this.W * 0.14) ** 2) return { x: best.x + (d.x - best.x) * 0.4, y: best.y + (d.y - best.y) * 0.4, w: d.w, h: d.h, face: true, label: d.label, e: d.e }
      return d
    })
  }

  // jalankan tiap beberapa frame saja; hasilnya dilacak antar-frame supaya melayang
  updateObjects (ts) {
    if (!this.detector) { this.initDetector(); return }
    if ((this.tick & 3) === 0) {
      let res
      try { res = this.detector.detectForVideo(this.work, ts) } catch (e) { return }
      const list = []
      for (const d of (res && res.detections) || []) {
        const b = d.boundingBox
        if (!b) continue
        const cat = (d.categories && d.categories[0]) || {}
        const name = cat.categoryName || '?'
        list.push({
          x: b.originX + b.width / 2,
          y: b.originY + b.height / 2,
          w: b.width, h: b.height,
          label: LABEL_ID[name] || name.toUpperCase().slice(0, 10),
          e: Math.round((cat.score || 0) * 100)
        })
      }
      list.sort((a, b) => b.e - a.e)
      this.rawDet = list.slice(0, 6)
    }
    // glide: tarik ke deteksi terdekat frame sebelumnya (BlobTracker.kt)
    const prev = this.blobs || []
    const out = (this.rawDet || []).map(d => {
      let best = null, bd = Infinity
      for (const q of prev) {
        const dd = (d.x - q.x) ** 2 + (d.y - q.y) ** 2
        if (dd < bd) { bd = dd; best = q }
      }
      if (best && bd < (this.W * 0.18) ** 2) {
        return { x: best.x + (d.x - best.x) * 0.35, y: best.y + (d.y - best.y) * 0.35, w: d.w, h: d.h, label: d.label, e: d.e }
      }
      return d
    })
    this.blobs = out
  }

  // ---------- buffer ----------
  ensureBuffers () {
    const [vw, vh] = this.srcSize()
    const eff = HVFT_EFFECTS.find(x => x.id === this.settings.effect)
    let target = this.settings.res || 960
    if (eff && eff.maxRes) target = Math.min(target, eff.maxRes)
    let W, H
    if (!vw || !vh) {
      const GEN = (typeof HVFT_GEN_FX !== 'undefined') && HVFT_GEN_FX.has(this.settings.effect)
      if (!GEN) return                            // sumber belum siap: jangan rusak buffer
      const cw = this.canvas.width || 16, ch = this.canvas.height || 9   // pola generatif: pakai aspek kanvas tampilan
      W = Math.max(2, Math.min(target, cw))
      H = Math.max(2, Math.round(W * ch / cw))
    } else {
      W = Math.min(target, vw)
      H = Math.max(2, Math.round(W * vh / vw))
    }
    if (W === this.W && H === this.H) return
    this.W = W; this.H = H
    this.work.width = W; this.work.height = H
    this.paint.width = W; this.paint.height = H
    this.mask = new Uint8Array(W * H)
    this.lum = new Uint8Array(W * H)
    this.prevLum = new Uint8Array(W * H)
    this.outImg = this.pctx.createImageData(W, H)
    this.nodes = new Float32Array(260 * 2)
  }

  grabFrame () {
    const { W, H } = this
    this.wctx.save()
    // titik-titik point cloud jauh lebih redup daripada gambar kamera; naikkan dulu
    // supaya ambang mask & efek (yang dirancang untuk kamera) punya sinyal cukup.
    if (this.layers[0].kind === 'pc3d') this.wctx.filter = 'brightness(1.05) contrast(1.05)'
    const _k0 = this.layers[0].kind
    // MIRROR = selfie flip for live cameras only; text (ext) and media files must never read backwards
    if (this.settings.mirror && _k0 !== 'ext' && _k0 !== 'image' && _k0 !== 'video') { this.wctx.translate(W, 0); this.wctx.scale(-1, 1) }
    this.wctx.drawImage(this.srcEl(), 0, 0, W, H)
    this.wctx.restore()
    this.srcImg = this.wctx.getImageData(0, 0, W, H)
    const d = this.srcImg.data
    this.prevLum.set(this.lum)
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      this.lum[i] = (d[j] * 77 + d[j + 1] * 151 + d[j + 2] * 28) >> 8
    }
  }

  // ---------- mask ----------
  updateMaskFromModel (ts) {
    const C = HvftPipeline
    // RVM MATTE (rvm_engine.js, Oct 7): soft, temporally stable cut-out. Async: the newest alpha is used; MediaPipe
    // keeps cutting until the first one arrives (or if RVM is not available).
    if (this._matteS().matteModel === 'rvm' && typeof HvftRvm !== 'undefined') {
      const R = this._rvm || (this._rvm = new HvftRvm())
      R.push(this.work, 384, this._inComp ? 1 : 0)
      if (R.alpha && !R.failed && performance.now() - R.t < 1500) { this._alphaToMask(R); return true }
    } else if (this._rvm) { this._rvm = null }
    this.rvmSoft = null
    if (C._seg && C._segGen && this._segGen !== C._segGen) { this._segGen = C._segGen; this.segmenter = C._seg; this.modelReady = true }   // picked up the rebuilt (CPU) segmenter
    if (!this.segmenter) return false
    let res
    // disegmentasi dari KANVAS KERJA, bukan elemen video: berlaku untuk kamera,
    // file video, maupun gambar — dan sudah ikut mirror, jadi tak perlu dipetakan ulang
    // shared segmenter -> timestamps must keep increasing across all pipes
    C._segTs = Math.max((C._segTs || 0) + 1, ts)
    try { res = this.segmenter.segmentForVideo(this.work, C._segTs) } catch (e) { this._segFailed(); return false }
    const cm = res && res.categoryMask
    if (!cm) { this._segFailed(); return false }
    C._segFails = 0
    const raw = cm.getAsUint8Array()
    const mw = cm.width, mh = cm.height
    const { W, H, mask } = this
    for (let y = 0; y < H; y++) {
      const sy = Math.min(mh - 1, (y * mh / H) | 0)
      const row = sy * mw
      for (let x = 0; x < W; x++) {
        const sx = Math.min(mw - 1, ((x * mw / W) | 0))
        const v = raw[row + sx]
        mask[y * W + x] = (v === 1 || v > 127) ? 1 : 0
      }
    }
    cm.close()
    this.applyPolarity()
    this.cleanMask()
    return true
  }

  // RVM alpha (aw×ah) -> soft matte (W×H, bilinear) + the binary mask the effects use
  _alphaToMask (R) {
    const { W, H, mask } = this, A = R.alpha, aw = R.aw, ah = R.ah, N = W * H
    if (!this.rvmSoft || this.rvmSoft.length !== N) this.rvmSoft = new Float32Array(N)
    const S = this.rvmSoft
    for (let y = 0; y < H; y++) {
      const fy = Math.min(ah - 1.001, Math.max(0, (y + 0.5) * ah / H - 0.5)), y0 = fy | 0, ty = fy - y0
      for (let x = 0; x < W; x++) {
        const fx = Math.min(aw - 1.001, Math.max(0, (x + 0.5) * aw / W - 0.5)), x0 = fx | 0, tx = fx - x0, i0 = y0 * aw + x0
        const a = A[i0] * (1 - tx) + A[i0 + 1] * tx, b = A[i0 + aw] * (1 - tx) + A[i0 + aw + 1] * tx
        const v = a * (1 - ty) + b * ty, k = y * W + x
        S[k] = v; mask[k] = v > 0.5 ? 1 : 0
      }
    }
  }

  // mask langsung dari siluet LiDAR: piksel tak-hitam = subjek (latar sudah dipotong)
  updateMaskFromLidar () {
    const { W, H, mask, lum } = this
    const k0 = this.layers && this.layers[0] && this.layers[0].kind
    const thr = (this.settings.bgKey === 'luma' && (k0 === 'image' || k0 === 'video')) ? 10 + ((this.settings.bgKeyLvl == null) ? 0.3 : this.settings.bgKeyLvl) * 200 : 10   // CH3 media KEY level
    for (let i = 0; i < W * H; i++) mask[i] = lum[i] > thr ? 1 : 0
    this.cleanMask()
  }

  updateMaskFallback () {
    const { W, H, mask, lum, prevLum } = this
    const thr = 60 + (1 - this.settings.sens) * 90
    for (let i = 0; i < W * H; i++) {
      mask[i] = (lum[i] > thr || Math.abs(lum[i] - prevLum[i]) > 16) ? 1 : 0
    }
    this.cleanMask()
  }

  // piksel tepi bingkai hampir selalu latar; kalau mayoritas tertandai subjek,
  // berarti polaritas model terbalik
  applyPolarity () {
    const { W, H, mask } = this
    let on = 0, tot = 0
    for (let x = 0; x < W; x += 2) { if (mask[x]) on++; if (mask[(H - 1) * W + x]) on++; tot += 2 }
    for (let y = 0; y < H; y += 2) { if (mask[y * W]) on++; if (mask[y * W + W - 1]) on++; tot += 2 }
    this.borderEma = this.borderEma * 0.88 + (on / tot) * 0.12
    const mode = this.settings.polarity || 'auto'
    const inv = mode === 'invert' || (mode === 'auto' && this.borderEma > 0.6)
    if (inv) for (let i = 0; i < W * H; i++) mask[i] = mask[i] ? 0 : 1
  }

  // Point cloud = titik jarang di atas hitam. Ambang tinggi + cleanMask (mengikis)
  // akan menghapusnya. Di sini: ambang rendah, lalu DILASI supaya titik menyambung
  // jadi satu tubuh sehingga efek punya subjek yang utuh.
  updateMaskFromPoints () {
    const { W, H, mask, lum } = this
    if (!this._ptmp || this._ptmp.length !== W * H) this._ptmp = new Uint8Array(W * H)
    const t = this._ptmp
    for (let i = 0; i < W * H; i++) t[i] = lum[i] > 2 ? 1 : 0
    mask.fill(0)
    for (let y = 1; y < H - 1; y++) {
      const r = y * W
      for (let x = 1; x < W - 1; x++) {
        const i = r + x
        if (t[i] || t[i - 1] || t[i + 1] || t[i - W] || t[i + W] ||
            t[i - W - 1] || t[i - W + 1] || t[i + W - 1] || t[i + W + 1]) mask[i] = 1
      }
    }
  }

  cleanMask () {
    const { W, H, mask } = this
    if (!this._mtmp || this._mtmp.length !== W * H) this._mtmp = new Uint8Array(W * H)
    const out = this._mtmp
    out.fill(0)
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x
        const s = mask[i - 1] + mask[i + 1] + mask[i - W] + mask[i + W] + mask[i]
        out[i] = s >= 3 ? 1 : 0
      }
    }
    mask.set(out)
  }

  // Analisis FREKUENSI, bukan amplitudo.
  // Musik noise punya level nyaris rata terus-menerus, jadi dB tidak informatif;
  // yang berubah adalah SEBARAN spektrum. Maka:
  //   band low/mid/high  -> energi per pita
  //   spectral flux      -> deteksi serangan (onset), tahan terhadap noise rata
  //   centroid           -> "terang/gelap"-nya bunyi
  updateAudio () {
    // GERBANG MIC GLOBAL: satu saklar untuk SEMUA pipe (utama, lapis, proyektor).
    // Tombol Mic di panel kanan mengatur window.HVFT_MIC_ON. Mati = NOL TOTAL, tak ada yang merespons suara.
    const _micOn = (typeof window === 'undefined') ? true : !!window.HVFT_MIC_ON
    if (!_micOn || !this.analyser || !this.audioOn) {
      this.onset = 0; this.flux = 0
      this.band.low = 0; this.band.mid = 0; this.band.high = 0
      this.bandSel = 0
      if (typeof window !== 'undefined') window.HVFT_AUDIO = { low: 0, mid: 0, high: 0, sel: 0, onset: 0, amt: 0 }
      return
    }
    const an = this.analyser
    // AUTO-RANGE (Oct 6): an interface can sit at -40 dBFS or be slammed to 0 dBFS. Read the spectrum in dB and map it
    // into a 48 dB window that follows the recent peak (jumps up at once, relaxes over ~10 s): the analysis never clips
    // into a flat wall and never starves on a quiet input. The floor clamp keeps room hiss dark when nothing plays.
    if (!this.fdb || this.fdb.length !== an.frequencyBinCount) this.fdb = new Float32Array(an.frequencyBinCount)
    an.getFloatFrequencyData(this.fdb)
    let pk = -200
    for (let i = 2; i < this.fdb.length; i++) if (this.fdb[i] > pk) pk = this.fdb[i]
    if (this.dbTop == null) this.dbTop = -30
    this.dbTop += (pk - this.dbTop) * (pk > this.dbTop ? 0.5 : 0.004)
    { const RANGE = 48, top = Math.max(-55, this.dbTop) + 2, bot = top - RANGE
      for (let i = 0; i < this.fdb.length; i++) { const v = (this.fdb[i] - bot) / RANGE * 255; this.freqBuf[i] = v > 0 ? (v < 255 ? v : 255) : 0 } }
    if (!this.waveBuf || this.waveBuf.length !== an.fftSize) this.waveBuf = new Uint8Array(an.fftSize)
    an.getByteTimeDomainData(this.waveBuf)
    if (typeof window !== 'undefined') window.HVFT_WAVE = this.waveBuf   // MILKDROP (Butterchurn) reads the live wave from here
    const bins = this.freqBuf.length
    const nyq = (this.audioCtxRef ? this.audioCtxRef.sampleRate : 44100) / 2
    const binHz = nyq / bins
    const idx = hz => Math.min(bins - 1, Math.max(0, Math.round(hz / binHz)))

    const bandEnergy = (lo, hi) => {
      const a = idx(lo), b = idx(hi)
      let s = 0
      for (let i = a; i <= b; i++) s += this.freqBuf[i]
      return s / ((b - a + 1) * 255)
    }
    // per-band AUTO-CONTRAST: 55 % relative to the band's own running floor/peak (so a constant noise wall still moves)
    // + 45 % absolute level. HOW REACTIVE above 40 % drives the bands harder (×1 … ×1.84).
    const amtS = this.settings.audioAmt == null ? 0.4 : this.settings.audioAmt
    const drive = 1 + Math.max(0, amtS - 0.4) * 1.4
    const AG = this._agc || (this._agc = {})
    const norm = (k, v) => {
      let a = AG[k]; if (!a) a = AG[k] = { lo: v, hi: v + 0.1 }
      // Oct 8 (trace 4: LOW still >= 0.9 19 % of the time): floor and peak follow the current wall within ~2 s, so a
      // steady wall sits mid-range and every swell / dip inside it shows (was: floor stuck at the deepest dip)
      a.lo += (v - a.lo) * (v < a.lo ? 0.12 : 0.015)
      a.hi += (v - a.hi) * (v > a.hi ? 0.5 : 0.015)
      const n = Math.max(0, Math.min(1, (v - a.lo) / Math.max(0.12, a.hi - a.lo)))
      // Oct 8 (trace analysis): with a steady harsh-noise wall LOW sat at the ceiling 13 % of the time and never went
      // below 0.2 — the 45 % absolute part kept everything high. Now 75 % relative contrast + 25 % absolute -> the bands
      // use the whole 0..1 range and the visuals keep moving inside a constant wall.
      return Math.min(1, (0.75 * n + 0.25 * Math.min(1, v * 1.1)) * drive)
    }
    const smooth = (prev, v) => prev + (v - prev) * (v > prev ? 0.9 : 0.45)   // near-instant attack, quick release (precise)
    this.band.low = smooth(this.band.low, norm('low', bandEnergy(20, 250)))
    this.band.mid = smooth(this.band.mid, norm('mid', bandEnergy(250, 2000)))
    this.band.high = smooth(this.band.high, norm('high', bandEnergy(2000, 10000)))
    const sel = this.settings.audioBand || 'all'
    this.bandSel = sel === 'low' ? this.band.low
      : sel === 'mid' ? this.band.mid
        : sel === 'high' ? this.band.high
          : Math.max(this.band.low, this.band.mid, this.band.high)

    // spectral flux: jumlah kenaikan energi antar-frame (onset untuk bunyi noise)
    if (!this.prevSpec || this.prevSpec.length !== bins) this.prevSpec = new Float32Array(bins)
    let flux = 0, cenNum = 0, cenDen = 0
    for (let i = 0; i < bins; i++) {
      const v = this.freqBuf[i]
      const d = v - this.prevSpec[i]
      if (d > 0) flux += d
      this.prevSpec[i] = v
      cenNum += i * v; cenDen += v
    }
    this.flux = flux / (bins * 255)
    this.centroid = cenDen > 0 ? (cenNum / cenDen) / bins : 0
    this.fluxAvg = this.fluxAvg * 0.94 + this.flux * 0.06
    this.fluxDev = (this.fluxDev || 0) * 0.94 + Math.abs(this.flux - this.fluxAvg) * 0.06
    // onset: classic ratio OR a jump above the flux's own spread (catches texture hits inside a noise wall)
    // PRECISE HITS (Oct 6): the onset is a sharp pulse (1 → 0.4 → 0.16) with a 2-frame refractory, so it always drops
    // under 0.45 between hits. Every effect that waits for a rising edge (cuts, re-rolls, random colours, chaos) now
    // catches EVERY hit instead of merging fast hits into one long one. beatN counts hits.
    this._onRef = Math.max(0, (this._onRef || 0) - 1)
    const trig = this.flux > this.fluxAvg * 1.6 + 0.004 || this.flux > this.fluxAvg + this.fluxDev * 1.8 + 0.002
    if (trig && this._onRef === 0) { this.onset = 1; this._onRef = 2; this.beatN = (this.beatN || 0) + 1 } else this.onset *= 0.4
    // TEXTURE (Meyda, Oct 7): harsh noise changes its TEXTURE more than its level -> noisiness (spectral flatness),
    // peakiness (crest: feedback tones poking out of the wall), sharpness and width — each auto-ranged like the bands.
    if (typeof Meyda !== 'undefined') {
      try {
        if (!this.tdBuf || this.tdBuf.length !== an.fftSize) this.tdBuf = new Float32Array(an.fftSize)
        an.getFloatTimeDomainData(this.tdBuf)
        Meyda.bufferSize = an.fftSize; Meyda.sampleRate = this.audioCtxRef ? this.audioCtxRef.sampleRate : 48000
        const r = Meyda.extract(['spectralFlatness', 'spectralCrest', 'perceptualSharpness', 'spectralSpread'], this.tdBuf)
        if (r) {
          const T = this.tex || (this.tex = { flat: 0, crest: 0, sharp: 0, wide: 0 })
          const fin = v => (v === v && isFinite(v)) ? v : 0
          const nz = (k, v) => {
            let a = AG['t_' + k]; if (!a) a = AG['t_' + k] = { lo: v, hi: v + 0.05 }
            a.lo += (v - a.lo) * (v < a.lo ? 0.2 : 0.004); a.hi += (v - a.hi) * (v > a.hi ? 0.4 : 0.006)
            const rel = Math.max(0, Math.min(1, (v - a.lo) / Math.max(0.04, a.hi - a.lo)))
            return Math.min(1, 0.6 * rel + 0.4 * Math.min(1, v))   // 60 % change vs its own range + 40 % absolute
          }
          T.flat = smooth(T.flat, nz('flat', Math.min(1, fin(r.spectralFlatness) / 0.85)))
          T.crest = smooth(T.crest, nz('crest', Math.min(1, Math.log(1 + fin(r.spectralCrest)) / 3.4)))
          T.sharp = smooth(T.sharp, nz('sharp', Math.min(1, fin(r.perceptualSharpness))))
          T.wide = smooth(T.wide, nz('wide', Math.min(1, fin(r.spectralSpread) / 256)))
        }
      } catch (e) {}
    }
    // dipakai komposer lapis (strobe/flicker per lapis) — satu nilai bersama per jendela
    if (typeof window !== 'undefined' && this.audioOn) window.HVFT_AUDIO = { low: this.band.low, mid: this.band.mid, high: this.band.high, sel: this.bandSel, onset: this.onset, amt: this._effAmt(), flat: this.tex ? this.tex.flat : 0, crest: this.tex ? this.tex.crest : 0, sharp: this.tex ? this.tex.sharp : 0, wide: this.tex ? this.tex.wide : 0 }

    // spektrum ringkas (skala log) untuk indikator di panel
    const nb = this.spec.length
    for (let i = 0; i < nb; i++) {
      const f0 = 20 * Math.pow(10000 / 20, i / nb)
      const f1 = 20 * Math.pow(10000 / 20, (i + 1) / nb)
      const a = idx(f0), b = Math.max(a, idx(f1))
      let m = 0
      for (let k = a; k <= b; k++) if (this.freqBuf[k] > m) m = this.freqBuf[k]
      this.spec[i] = m
    }
  }

  // ---------- BlobTracker.kt ----------
  // Gerakan (frame-diff) di area BUKAN subjek -> dikelompokkan jadi blob,
  // dilacak antar-frame ("melayang"), lalu digambar kotak + garis penghubung.
  updateBlobs () {
    if (this.settings.blob === 'off') { this.blobs = []; this.sn = 0; return }
    const { W, H, lum, prevLum, mask } = this
    const cols = 44, rows = Math.max(8, Math.round(44 * H / W))
    if (this.bcols !== cols || this.brows !== rows) {
      this.bcols = cols; this.brows = rows
      this.motion = new Float32Array(cols * rows)
      this.bprev = null
    }
    const gray = new Float32Array(cols * rows)
    for (let gy = 0; gy < rows; gy++) {
      const sy = Math.min(H - 1, ((gy + 0.5) * H / rows) | 0)
      for (let gx = 0; gx < cols; gx++) {
        const sx = Math.min(W - 1, ((gx + 0.5) * W / cols) | 0)
        gray[gy * cols + gx] = lum[sy * W + sx]
      }
    }
    const motion = this.motion
    if (this.bprev) {
      for (let i = 0; i < cols * rows; i++) {
        const gx = i % cols, gy = (i / cols) | 0
        const sx = Math.min(W - 1, ((gx + 0.5) * W / cols) | 0)
        const sy = Math.min(H - 1, ((gy + 0.5) * H / rows) | 0)
        const fg = mask[sy * W + sx] === 1
        const diff = fg ? 0 : Math.abs(gray[i] - this.bprev[i])
        motion[i] = Math.max(diff, motion[i] * 0.80)
      }
    }
    this.bprev = gray

    // flood fill blob
    const thr = 26
    const visited = new Uint8Array(cols * rows)
    const bx = [], by = [], be = []
    const stack = []
    for (let s = 0; s < cols * rows; s++) {
      if (visited[s] || motion[s] < thr) continue
      let sxSum = 0, sySum = 0, eSum = 0, cnt = 0
      stack.length = 0; stack.push(s); visited[s] = 1
      while (stack.length) {
        const i = stack.pop()
        const gx = i % cols, gy = (i / cols) | 0
        sxSum += gx; sySum += gy; eSum += motion[i]; cnt++
        const nb = [i - 1, i + 1, i - cols, i + cols]
        for (let k = 0; k < 4; k++) {
          const j = nb[k]
          if (j < 0 || j >= cols * rows) continue
          if (k === 0 && gx === 0) continue
          if (k === 1 && gx === cols - 1) continue
          if (!visited[j] && motion[j] >= thr) { visited[j] = 1; stack.push(j) }
        }
      }
      if (cnt >= 2) {
        bx.push((sxSum / cnt) / cols * W)
        by.push((sySum / cnt) / rows * H)
        be.push(eSum / cnt)
      }
    }
    if (!bx.length) { this.blobs = []; this.sn = 0; return }
    // 6 blob terkuat
    const order = be.map((v, i) => i).sort((a, b) => be[b] - be[a]).slice(0, 6)
    const nx = [], ny = [], ne = []
    for (const id of order) { nx.push(bx[id]); ny.push(by[id]); ne.push(be[id]) }
    // smoothing "melayang": tarik ke blob terdekat frame lalu
    const sxArr = this.sx || [], syArr = this.sy || [], sn = this.sn || 0
    for (let k = 0; k < nx.length; k++) {
      let bestD = Infinity, bj = -1
      for (let j = 0; j < sn; j++) {
        const d = (nx[k] - sxArr[j]) ** 2 + (ny[k] - syArr[j]) ** 2
        if (d < bestD) { bestD = d; bj = j }
      }
      if (bj >= 0 && bestD < (W * 0.18) ** 2) {
        nx[k] = sxArr[bj] + (nx[k] - sxArr[bj]) * 0.35
        ny[k] = syArr[bj] + (ny[k] - syArr[bj]) * 0.35
      }
    }
    this.sx = nx; this.sy = ny; this.sn = nx.length
    this.blobs = nx.map((x, k) => ({ x, y: ny[k], e: ne[k] }))
  }

  drawBlobs (ctx, D) {
    if (!this.blobs.length) return
    const mode = this.settings.blobColorMode || 'mono'
    const inv = !!this.settings.blobInvert
    const green = mode === 'green' || (mode === 'mono' && this.settings.blob === 'green')   // tombol DECK 'hijau' tetap jalan
    const beat = Math.min(1, this.bandSel * 0.6 + this.onset * 0.7)
    const lw = this.settings.blobLine || 1.2
    // warna per-blob: 'multi' = tiap blob hue beda; oranye/hijau/mono(LUT)
    const colOf = (k, a) => {
      if (mode === 'multi') { const h = (k * 61 + ((this.tick / 20) | 0) * 6) % 360; return `hsla(${h},92%,60%,${a})` }
      if (mode === 'orange') return `rgba(242,160,61,${a})`
      if (green) return `rgba(70,245,130,${a})`
      return lutCss(this.lut, 255, a)   // mono (ikut LUT warna)
    }
    ctx.save()
    // garis penghubung antar blob
    const linkDist = D.W * (0.35 + beat * 0.2)
    ctx.strokeStyle = colOf(0, 0.22 + beat * 0.42); ctx.lineWidth = lw * 0.8
    ctx.beginPath()
    for (let a = 0; a < this.blobs.length; a++) {
      for (let b = a + 1; b < this.blobs.length; b++) {
        const ax = D.mx(this.blobs[a].x), ay = D.my(this.blobs[a].y)
        const bx2 = D.mx(this.blobs[b].x), by2 = D.my(this.blobs[b].y)
        if (Math.hypot(ax - bx2, ay - by2) < linkDist) { ctx.moveTo(ax, ay); ctx.lineTo(bx2, by2) }
      }
    }
    ctx.stroke()
    // kotak UKURAN TETAP + label. INVERT -> kotak terisi solid.
    const s0 = D.W * (this.settings.trackSize || 0.055) * (1 + beat * 0.35)
    ctx.lineWidth = lw
    ctx.font = `${Math.min(15, Math.max(8, D.W * 0.014)) | 0}px ui-monospace, Menlo, monospace`
    this.blobs.forEach((b, k) => {
      const s = s0, x = D.mx(b.x), y = D.my(b.y)
      const stroke = colOf(k, 1)
      if (inv) { ctx.fillStyle = colOf(k, 0.4 + beat * 0.3); ctx.fillRect(x - s, y - s, s * 2, s * 2) }
      ctx.strokeStyle = stroke
      ctx.strokeRect(x - s, y - s, s * 2, s * 2)
      ctx.fillStyle = stroke; ctx.beginPath(); ctx.arc(x, y, 2, 0, 6.2832); ctx.fill()
      ctx.fillStyle = colOf(k, 0.72)
      const tag = b.label
        ? b.label + ' ' + String(b.e).padStart(2, '0')
        : 'TRK' + String((k * 131 + ((this.tick / 30) | 0)) % 1000).padStart(3, '0')
      ctx.fillText(tag, x + s + 3, y - s + 12)
    })
    ctx.restore()
  }

  // ---------- loop ----------
  start () {
    if (this.running) return
    this.running = true
    const loop = () => {
      if (!this.running) return
      try { this.renderFrame() } catch (e) { console.error(e) }
      this._raf = requestAnimationFrame(loop)
    }
    this._raf = requestAnimationFrame(loop)
  }
  stop () { this.running = false; if (this._raf) cancelAnimationFrame(this._raf) }

  resizeToDisplay () {
    // deck channel pipes render at exactly the channel size (LayerComp sets fixedSize): the retina ×2 canvas was 4× the
    // pixels / memory and was scaled straight back down into the channel anyway
    if (this.fixedSize) { const [w, h] = this.fixedSize; if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h } return }
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const r = this.canvas.getBoundingClientRect()
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }
  }

  // matte alpha dari mask subjek (tepi dihaluskan saat di-scale)
  // box blur separabel pada Float32 (running-sum) — feather tepi matte
  _boxBlurF (buf, W, H, r) {
    if (r < 1) return
    const N = W * H
    if (!this._mbTmp || this._mbTmp.length !== N) this._mbTmp = new Float32Array(N)
    const tmp = this._mbTmp, win = r * 2 + 1
    for (let y = 0; y < H; y++) {
      const row = y * W; let s = 0
      for (let k = -r; k <= r; k++) s += buf[row + (k < 0 ? 0 : k >= W ? W - 1 : k)]
      for (let x = 0; x < W; x++) {
        tmp[row + x] = s / win
        const xo = x - r, xi = x + r + 1
        s += buf[row + (xi >= W ? W - 1 : xi)] - buf[row + (xo < 0 ? 0 : xo)]
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0
      for (let k = -r; k <= r; k++) s += tmp[(k < 0 ? 0 : k >= H ? H - 1 : k) * W + x]
      for (let y = 0; y < H; y++) {
        buf[y * W + x] = s / win
        const yo = y - r, yi = y + r + 1
        s += tmp[(yi >= H ? H - 1 : yi) * W + x] - tmp[(yo < 0 ? 0 : yo) * W + x]
      }
    }
  }

  // morfologi 4-tetangga pada Float32: iters>0 dilasi (max), iters<0 erosi (min)
  _morphF (buf, W, H, iters) {
    const n = Math.abs(iters); if (!n) return
    const max = iters > 0, N = W * H
    if (!this._mmTmp || this._mmTmp.length !== N) this._mmTmp = new Float32Array(N)
    const tmp = this._mmTmp
    for (let it = 0; it < n; it++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x
          let v = buf[i]
          const up = y > 0 ? buf[i - W] : v, dn = y < H - 1 ? buf[i + W] : v
          const lf = x > 0 ? buf[i - 1] : v, rt = x < W - 1 ? buf[i + 1] : v
          v = max ? Math.max(v, up, dn, lf, rt) : Math.min(v, up, dn, lf, rt)
          tmp[i] = v
        }
      }
      buf.set(tmp)
    }
  }

  // Matte CROP: dari mask biner -> isi lubang & buang bintik -> redam kedip antar-frame
  // -> kikis/lebarkan -> feather tepi. Menghasilkan alpha HALUS supaya pola di belakang
  // subjek tidak terlihat gerigi/bocor. Semua diproses di resolusi kerja (murah).
  // SIMPLE mode (Oct 12, Reza: "fix yang terbaik, tanpa kontrol parameter"): the cut-out uses fixed best values —
  // feather 35 %, expand 42 % (trims the background halo), clean ON, MediaPipe — and STABILIZE follows the motion
  // (still = calm edges, fast moves = no lag). SETTINGS › ADVANCED (window.HVFT_ADV) brings the sliders back.
  _matteS () {
    const S = this.settings
    if (typeof window !== 'undefined' && window.HVFT_ADV === true) return S
    return Object.assign({}, S, { matteFeather: 0.35, matteExpand: 0.42, matteClean: true, matteModel: 'mp', _autoStab: true })
  }
  _buildMatte () {
    const { W, H, mask } = this
    const N = W * H
    if (!this.matte) { this.matte = document.createElement('canvas'); this.mctx = this.matte.getContext('2d') }
    if (this.matte.width !== W || this.matte.height !== H) { this.matte.width = W; this.matte.height = H; this.matteImg = this.mctx.createImageData(W, H); this.maskSoft = null }
    if (!this.matteImg) this.matteImg = this.mctx.createImageData(W, H)
    if (!this.maskSoft || this.maskSoft.length !== N) { this.maskSoft = new Float32Array(N); this.maskTgt = new Float32Array(N) }
    const S = this._matteS()
    const tgt = this.maskTgt
    const rvm = !!(this.rvmSoft && this.rvmSoft.length === N && S.matteModel === 'rvm')
    if (rvm) tgt.set(this.rvmSoft)   // RVM: soft alpha straight from the net (hair / fingers), no morphology
    else for (let i = 0; i < N; i++) tgt[i] = mask[i] ? 1 : 0
    // isi lubang + buang bintik: close(1) lalu open(1) = dilasi,erosi,erosi,dilasi
    if (S.matteClean !== false && !rvm) { this._morphF(tgt, W, H, 1); this._morphF(tgt, W, H, -1); this._morphF(tgt, W, H, -1); this._morphF(tgt, W, H, 1) }
    // kikis (buang fringe latar) / lebarkan crop
    const expand = Math.round((((S.matteExpand == null) ? 0.5 : S.matteExpand) - 0.5) * 6)   // -3..3 px
    if (expand) this._morphF(tgt, W, H, expand)
    // peredaman temporal: kurangi tepi "mendidih" tanpa bikin lambat merespon
    const soft = this.maskSoft
    let stabIn = (S.matteStab == null) ? 0.45 : S.matteStab
    if (S._autoStab && this.lum && this.prevLum && this.lum.length === N) {   // AUTO: motion between frames -> how much to calm the edge
      let d = 0, n = 0; for (let i = 0; i < N; i += 13) { d += Math.abs(this.lum[i] - this.prevLum[i]); n++ }
      const m = n ? d / n : 0; this._motE = (this._motE == null) ? m : this._motE * 0.8 + m * 0.2
      stabIn = Math.max(0.12, Math.min(0.62, 0.62 - this._motE / 30))
    }
    const stab = clamp(stabIn, 0, 1) * (rvm ? 0.45 : 0.85)   // RVM is already temporally stable
    if (stab > 0.01) { for (let i = 0; i < N; i++) soft[i] = soft[i] * stab + tgt[i] * (1 - stab) } else soft.set(tgt)
    // feather tepi (anti gerigi)
    const r = Math.round(((S.matteFeather == null) ? 0.32 : S.matteFeather) * (rvm ? 3 : 7))   // RVM edges are already soft
    if (r > 0) this._boxBlurF(soft, W, H, r)
    const md = this.matteImg.data
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      md[j] = 255; md[j + 1] = 255; md[j + 2] = 255
      let a = soft[i] * 255; md[j + 3] = a < 0 ? 0 : a > 255 ? 255 : a
    }
    this.mctx.putImageData(this.matteImg, 0, 0)
  }

  // Gabungkan nilai parameter efek: default -> nilai slider -> modulasi audio (band terpilih).
  // Semua parameter ternormalisasi 0..1 sehingga link audio bisa dipakai seragam.
  _resolveFxParams (id) {
    const base = (typeof fxDefaults === 'function') ? fxDefaults(id) : {}
    const S = this.settings || {}
    const saved = (S.fxParams && S.fxParams[id]) || null
    if (saved) for (const k in saved) { const v = saved[k]; if (typeof v === 'number') base[k] = v }
    const links = S.fxLinks || null
    if (links) {
      const amt = this._effAmt()
      const B = this.band || {}
      for (const k in base) {
        const L = links[id + '.' + k]
        if (!L || !L.band || L.band === 'off') continue
        const d = +L.amt || 0
        if (!d) continue
        let e = 0
        if (L.band === 'low') e = B.low || 0
        else if (L.band === 'mid') e = B.mid || 0
        else if (L.band === 'high') e = B.high || 0
        else if (L.band === 'onset') e = this.onset || 0
        else if (L.band === 'sel') e = this.bandSel || 0
        else { const HA = (typeof window !== 'undefined' && window.HVFT_AUDIO) || {}; e = (this.tex && this.tex[L.band] != null) ? this.tex[L.band] : (HA[L.band] || 0) }   // TEXTURE links
        base[k] = Math.max(0, Math.min(1, base[k] + e * d * amt))
      }
    }
    return base
  }

  // LATAR POLA: render pola (plasma/cymatics) full-frame ke kanvas kecil (this.bgpaint),
  // untuk dipasang di belakang subjek pada kanal yang sama. Resolusi dibatasi supaya ringan.
  // HOW REACTIVE slider -> effective reaction: 40 % (default) already = full reaction (was only 40 % strength);
  // above 40 % the slider drives the bands harder instead (see updateAudio).
  _effAmt () { const a = this.settings.audioAmt == null ? 0.4 : this.settings.audioAmt; return Math.max(0, Math.min(1, a * 2.5)) }
  // BACKGROUND colour can differ from the object colour (settings.bgColor; null = same as the object)
  _bgLut () {
    const n = this.settings.bgColor
    if (!n || typeof buildLut !== 'function') return this.lut
    if (this._bgLutName !== n) { this._bgLutName = n; this._bgLutV = buildLut(n) }
    return this._bgLutV || this.lut
  }

  _renderBgPattern (id) {
    const eff = HVFT_EFFECTS.find(e => e.id === id)
    if (!eff || !eff.pixels) return false
    const aspect = this.H / Math.max(1, this.W)
    const bw = Math.max(2, Math.min(this.W, eff.bgRes || 440)), bh = Math.max(2, Math.round(bw * aspect))   // resolusi lebih tinggi -> tak kasar
    if (!this.bgpaint) { this.bgpaint = document.createElement('canvas'); this.bgpctx = this.bgpaint.getContext('2d') }
    if (this.bgpaint.width !== bw || this.bgpaint.height !== bh) { this.bgpaint.width = bw; this.bgpaint.height = bh; this.bgImg = this.bgpctx.createImageData(bw, bh) }
    if (!this.bgImg) this.bgImg = this.bgpctx.createImageData(bw, bh)
    const out = this.bgImg.data
    out.fill(0); for (let j = 3; j < out.length; j += 4) out[j] = 255
    const f2 = {
      W: bw, H: bh, rgb: null, lum: null, mask: null, out,
      tick: this.tick, sens: this.settings.sens, bg: 0, lut: this._bgLut(),
      band: this.band, bandSel: this.bandSel, onset: this.onset,
      audioOn: this.audioOn, aud: this.settings.audio || {}, audAmt: this._effAmt(),
      hudScale: 0, masked: false, P: this._resolveFxParams(id),
      spec: this.spec, brutal: (this.settings.bgBrutal == null ? 0.85 : this.settings.bgBrutal)   // per-pattern escalation (random-frequency layers)
    }
    eff.pixels(f2)
    if ((id === 'plasma' || id === 'cymatics') && !(this.audioOn && (this.settings.bgBrutal == null ? 0.85 : this.settings.bgBrutal) > 0.5)) this._smoothRGB(out, bw, bh)   // brutal = keep it raw / sharp   // haluskan gradien pola piksel
    this.bgpctx.putImageData(this.bgImg, 0, 0)
    if (eff.vector) {   // pola berbasis vektor (singularity/filament) menggambar isinya di tahap ini
      const D2 = { W: bw, H: bh, s: 1, ox: 0, oy: 0, mx: x => x, my: y => y }
      try { eff.vector(this.bgpctx, f2, D2) } catch (e) {}
    }
    return true
  }

  // blur kotak 3x3 ringan pada RGBA (haluskan pola piksel biar tak kasar). Alpha dijaga.
  // Background light: KUASA CAHAYA. With BRUTALITY the pattern sinks dark between hits and is blown to full
  // light by band/beat (no extra glitch layer — the escalation lives inside each pattern, see effects.js _bgK).
  _drawBgBrutal (ctx, DW, DH) {
    const bgBase = (this.settings.bgBase == null) ? 0.75 : this.settings.bgBase
    const power = (this.settings.bgfxPower == null) ? 0.7 : this.settings.bgfxPower
    const amt = this.settings.audioAmt == null ? 0.4 : this.settings.audioAmt
    const rc = this.audioOn ? Math.min(1, amt * 2.5) : 0
    const k = Math.max(0, Math.min(1, this.settings.bgBrutal == null ? 0.85 : this.settings.bgBrutal)) * rc
    const BD = this.band || {}, low = (BD.low || 0) * rc, on = (this.onset || 0) * rc, sel = (this.bandSel || 0) * rc
    let dim
    if (k < 0.02) dim = bgBase + (this.audioOn ? ((this.bandSel || 0) * 0.8 + (this.onset || 0) * 0.6) * amt : 0) * power * 1.6
    else dim = bgBase * (1 - k * 0.55) + (sel * 1.1 + on * 0.9 + low * 0.5) * power * (1.6 + k * 1.6)
    const src = this.bgpaint
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, dim))
    ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, DW, DH)
    ctx.restore()
  }

  _smoothRGB (d, W, H) {
    if (!this._smTmp || this._smTmp.length !== d.length) this._smTmp = new Uint8ClampedArray(d.length)
    const t = this._smTmp
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        let r = 0, g = 0, b = 0, n = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= H) continue
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= W) continue
            const j = (yy * W + xx) * 4; r += d[j]; g += d[j + 1]; b += d[j + 2]; n++
          }
        }
        t[i] = r / n; t[i + 1] = g / n; t[i + 2] = b / n; t[i + 3] = 255
      }
    }
    d.set(t)
  }

  renderFrame () {
    // AUDIO-ONLY (Oct 9): the hidden legacy pipe of a page that runs the DECK only feeds the audio analysis
    // (bands / onset for every channel). It no longer grabs camera frames, segments and renders an invisible picture.
    if (this.audioOnly) { this.tick++; this.updateAudio(); return }
    this.tick++
    const GENFX = (typeof HVFT_GEN_FX !== 'undefined') && HVFT_GEN_FX.has(this.settings.effect)   // pola generatif
    const [vw] = this.srcSize()
    const GEN = GENFX && !vw   // HANYA bypass sumber bila tak ada feed. Bila ADA kamera -> jalankan segmentasi supaya pola bisa di-CROP ke tubuh
    if (!vw && !GENFX) return
    this.resizeToDisplay()
    this.ensureBuffers()
    if (!this.W || !this.H || !this.outImg) return
    if (this.lutName !== this.settings.color) {
      this.lutName = this.settings.color
      this.lut = buildLut(this.lutName)
    }
    HVFT_HUD_ON = this.settings.hud !== false

    if (!GEN) {
      this.grabFrame()
      const _k0 = this.layers[0].kind
      if (_k0 === 'pc3d') this.updateMaskFromPoints()
      else if (_k0 === 'lidar' || _k0 === 'depthai' || _k0 === 'ext' || (this.settings.bgKey === 'luma' && (_k0 === 'image' || _k0 === 'video') && this.settings.bgfx && this.settings.bgfx !== 'none')) this.updateMaskFromLidar()   // CH3 media BG: bright = subject (cheap luma key)   // ext (TEKS): teks terang = subjek -> efek kena teks
      else if (!((this.modelReady || this._matteS().matteModel === 'rvm') && this.updateMaskFromModel(performance.now()))) this.updateMaskFallback()   // RVM works even without MediaPipe
    } else {
      this.blobs = []   // generatif: tak ada subjek/mask
    }
    this.updateAudio()
    if (!GEN) {
      if (this.settings.effect === 'profil') this.updateFaces(performance.now())
      else if (this.settings.effect === 'trackcollage') this.updateObjects(performance.now())
      else if (this.settings.blob === 'off') this.blobs = []
      else if (this.settings.track === 'object') { if (this.detector) this.updateObjects(performance.now()); else { this.initDetector(); this.updateBlobs() } }  // fallback gerak sambil model objek loading
      else this.updateBlobs()
    }

    const { W, H } = this
    const src = this.srcImg ? this.srcImg.data : null
    const out = this.outImg.data
    // latar: hitam, atau kamera diredupkan sesuai slider Latar
    const bg = GEN ? 0 : this.settings.bg
    if (bg > 0.004) {
      for (let j = 0; j < src.length; j += 4) {
        out[j] = src[j] * bg; out[j + 1] = src[j + 1] * bg; out[j + 2] = src[j + 2] * bg; out[j + 3] = 255
      }
    } else {
      out.fill(0)
      for (let j = 3; j < out.length; j += 4) out[j] = 255
    }

    const eff = HVFT_EFFECTS.find(e => e.id === this.settings.effect) || HVFT_EFFECTS[0]
    const f = {
      W, H, rgb: src, lum: this.lum, mask: this.mask, out,
      tick: this.tick, sens: this.settings.sens, bg,
      lut: this.lut, nodes: this.nodes, nn: 0, bbox: [0, 0, 0, 0], count: 0,
      band: this.band, bandSel: this.bandSel, onset: this.onset,
      centroid: this.centroid, flux: this.flux, spec: this.spec,
      audioOn: this.audioOn, aud: this.settings.audio || {}, audAmt: this._effAmt(),
      hudScale: this.settings.hudScale || 1,
      workCanvas: this.work, blobs: this.blobs || [], textCfg: this.settings.textCfg, brutal: (this.settings.bgBrutal == null ? 0.85 : this.settings.bgBrutal)
    }
    // pola generatif + CROP + ada kamera => pola MENGISI siluet tubuh (gambar sbg mask)
    const maskedPat = GENFX && !!vw && !!this.settings.alpha
    f.masked = maskedPat
    f.P = this._resolveFxParams(eff.id)
    if (eff.pixels) eff.pixels(f)

    // blit cover-crop: rasio kamera dipertahankan, kelebihan sisi dipotong
    const ctx = this.ctx
    const DW = this.canvas.width, DH = this.canvas.height
    this.pctx.putImageData(this.outImg, 0, 0)
    const s = this.settings.fit === 'cover'
      ? Math.max(DW / W, DH / H)     // isi penuh, sisi berlebih dipotong
      : Math.min(DW / W, DH / H)     // utuh: mengikuti lebar/tinggi window, rasio kamera dijaga
    const ox = (DW - W * s) / 2, oy = (DH - H * s) / 2
    const ALPHA = !!this.settings.alpha
    const bgfxId = this.settings.bgfx
    // LATAR POLA: pola mengisi AREA LATAR di belakang subjek (kanal sama). Hanya utk efek subjek biasa.
    const BGFX = !!vw && bgfxId && bgfxId !== 'none' && (typeof HVFT_GEN_FX !== 'undefined' && HVFT_GEN_FX.has(bgfxId)) && !GENFX && !ALPHA
    const D = { W: DW, H: DH, s, ox, oy, mx: x => x * s + ox, my: y => y * s + oy }
    if (BGFX) {
      this._renderBgPattern(bgfxId)
      this._buildMatte()
      if (!this.bodytmp) { this.bodytmp = document.createElement('canvas'); this.bodyctx = this.bodytmp.getContext('2d') }
      if (this.bodytmp.width !== DW || this.bodytmp.height !== DH) { this.bodytmp.width = DW; this.bodytmp.height = DH }
      const b = this.bodyctx
      b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = 'source-over'; b.clearRect(0, 0, DW, DH); b.imageSmoothingEnabled = !(typeof window !== 'undefined' && window.HVFT_CRISP)
      b.drawImage(this.paint, 0, 0, W, H, ox, oy, W * s, H * s)                       // efek subjek
      b.globalCompositeOperation = 'destination-in'; b.drawImage(this.matte, 0, 0, W, H, ox, oy, W * s, H * s)   // dipotong ke tubuh
      b.globalCompositeOperation = 'source-over'
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, DW, DH)
      ctx.imageSmoothingEnabled = !(typeof window !== 'undefined' && window.HVFT_CRISP)
      // KUASA CAHAYA: pola "menguasai cahaya" saat kena frekuensi. base = terang dasar,
      // power = seberapa besar audio (band terpilih + onset) menaikkan terang pola.
      this._drawBgBrutal(ctx, DW, DH)                                                  // POLA di latar + BRUTAL audio
      ctx.imageSmoothingEnabled = !(typeof window !== 'undefined' && window.HVFT_CRISP)
      ctx.drawImage(this.bodytmp, 0, 0)                                                // subjek di depan
    } else {
      if (ALPHA) ctx.clearRect(0, 0, DW, DH)
      else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, DW, DH) }
      ctx.imageSmoothingEnabled = !(typeof window !== 'undefined' && window.HVFT_CRISP)
      ctx.drawImage(this.paint, 0, 0, W, H, ox, oy, W * s, H * s)
    }
    if (maskedPat) {         // POLA MENGISI TUBUH: gambar isi pola (piksel + vektor) lalu potong ke siluet
      if (eff.vector) eff.vector(ctx, f, D)
      this._buildMatte()
      ctx.save(); ctx.globalCompositeOperation = 'destination-in'; ctx.imageSmoothingEnabled = true
      ctx.drawImage(this.matte, 0, 0, W, H, ox, oy, W * s, H * s); ctx.restore()
    } else if (ALPHA) {      // cut-out subjek biasa (efek non-pola): buang latar -> alpha
      this._buildMatte()
      ctx.save(); ctx.globalCompositeOperation = 'destination-in'; ctx.imageSmoothingEnabled = true
      ctx.drawImage(this.matte, 0, 0, W, H, ox, oy, W * s, H * s); ctx.restore()
    }

    if (this.settings.grid && !ALPHA) drawDotGrid(ctx, f, D, this.settings.gridCols || 12, true)
    if (eff.vector && !ALPHA) eff.vector(ctx, f, D)
    // overlay TEKS di atas efek apa pun
    const tc = this.settings.textCfg
    if (!ALPHA && tc && tc.overlay && tc.str && this.settings.effect !== 'teks' && typeof drawHvftText === 'function') drawHvftText(ctx, f, D, tc)
    if (!ALPHA) this.drawBlobs(ctx, D)
    if (!ALPHA) this.drawLayers(ctx, D)
    if (this.settings.audioPanel && this.audioOn && !ALPHA) this.drawAudioPanel(ctx, DW, DH)

    // strobing: kilat singkat pada serangan spektrum (onset), bukan pada level
    if (this.audioOn && f.aud.strobe && this.onset > 0.05 && !this.settings.alpha) {
      const a = this.onset * this.onset * 0.45 * f.audAmt
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = lutCss(this.lut, 255, a)
      ctx.fillRect(0, 0, DW, DH)
      ctx.restore()
    }
    this._applyGate(ctx, DW, DH)
  }

  gateLevel (now) {
    const A = { low: (this.band || {}).low || 0, mid: (this.band || {}).mid || 0, high: (this.band || {}).high || 0, sel: this.bandSel || 0, onset: this.onset || 0, amt: this._effAmt() }
    return hvftGateLevel(this.settings.strobe, now, A)
  }

  _applyGate (ctx, DW, DH) {
    const G = this.settings.strobe
    if (!G || !G.on) return
    const lv = this.gateLevel(performance.now())
    if (lv >= 0.999) return
    ctx.save()
    if (G.white) {                                  // fase mati = KILAT PUTIH (bukan gelap)
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = lutCss(this.lut, 255, 1 - lv)
    } else {                                        // fase mati = TRANSPARAN (lapis bawah terlihat)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0,0,0,' + (1 - lv) + ')'
    }
    ctx.fillRect(0, 0, DW, DH)
    ctx.restore()
  }

  drawAudioPanel (ctx, DW, DH) {
    const lut = this.lut
    const pw = Math.min(DW * 0.42, 520), ph = pw * 0.30
    const px = (DW - pw) / 2, py = DH - ph - DH * 0.03
    const pad = pw * 0.03, ix = px + pad, iw = pw - pad * 2
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(px, py, pw, ph)
    ctx.strokeStyle = lutCss(lut, 220, 0.6); ctx.lineWidth = 1; ctx.strokeRect(px, py, pw, ph)
    const sh = ph * 0.42, sy = py + pad, spec = this.spec, nb = spec.length, bw = iw / nb
    ctx.fillStyle = lutCss(lut, 235, 0.82)
    for (let i = 0; i < nb; i++) { const h = (spec[i] / 255) * sh; ctx.fillRect(ix + i * bw, sy + sh - h, Math.max(1, bw * 0.7), h) }
    const wy = py + ph * 0.62, wa = ph * 0.16, wb = this.waveBuf
    if (wb) {
      ctx.strokeStyle = lutCss(lut, 240, 0.85); ctx.lineWidth = 1.2; ctx.beginPath()
      const N = 130
      for (let i = 0; i < N; i++) { const sVal = wb[(i / N * wb.length) | 0] / 128 - 1; const x = ix + iw * i / (N - 1); const y = wy + sVal * wa; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y) }
      ctx.stroke()
    }
    const fs = clamp(pw * 0.028, 9, 14) | 0
    ctx.font = fs + 'px ui-monospace, Menlo, monospace'
    ctx.fillStyle = lutCss(lut, 210, 0.82)
    const sel = this.settings.audioBand || 'all'
    ctx.fillText('+ ' + sel + '   ' + this.bandSel.toFixed(4), ix, py + ph - pad * 0.6)
    ctx.setLineDash([6, 5]); ctx.strokeStyle = lutCss(lut, 180, 0.55); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(px + pw * 0.62, py + ph - pad); ctx.lineTo(px + pw - pad, py + ph - pad); ctx.stroke(); ctx.setLineDash([])
    ctx.restore()
  }
}

window.HvftPipeline = HvftPipeline
