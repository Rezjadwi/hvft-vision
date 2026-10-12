// HVFT VISION — layer_comp.js
// Kompositor berlapis ala Resolume. Sebuah komposisi = daftar lapis (bawah→atas).
// Tiap lapis: { src, effect, feat, blend, opacity, on, url, kind, camIdx, textCfg }
//   src: 'cam'|'lidar'|'depthai'|'pc3d'|'media'|'logo'|'text'
//   feat (FITUR per-lapis): 'hud'|'blob'|'blobg'|'grid'|'trackobj' (null = tanpa)
// Lapis ber-efek = 1 HvftPipeline offscreen (reuse semua efek/kamera/depth).
// pc3d = pipe base 'pc3d' + PointCloudGPU feeder. logo = gambar. text = drawHvftText.
// render() komposit semua lapis (blend + opacity) ke kanvas keluaran.

const HVFT_BLEND = { normal: 'source-over', screen: 'screen', add: 'lighter', multiply: 'multiply' }

class LayerComp {
  constructor (outCanvas) {
    this.out = outCanvas
    this.ctx = outCanvas.getContext('2d')
    this.layers = []
    this.rt = []                 // runtime per lapis
    this.ctrl = null             // setting look global (warna/audio) diterapkan ke pipe lapis
    this.W = outCanvas.width || 1280
    this.H = outCanvas.height || 720
    this.band = [0, 0, 0]; this.onset = 0; this.tick = 0
    this.host = document.createElement('div')
    this.host.style.cssText = 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden'
    document.body.appendChild(this.host)
    this.cams = []
    const _refreshCams = () => { try { navigator.mediaDevices.enumerateDevices().then(ds => { this.cams = ds.filter(d => d.kind === 'videoinput' && !/obs|virtual/i.test(d.label || '')) }).catch(() => {}) } catch (e) {} }
    _refreshCams()   // filter OBS/Virtual -> indeks kamera cocok dgn daftar deck (CH1/CH2)
    try { navigator.mediaDevices.addEventListener('devicechange', _refreshCams) } catch (e) {}   // iPhone connect/disconnect -> perbarui
  }
  setSize (w, h) {
    this.W = w; this.H = h; if (this.out.width !== w) this.out.width = w; if (this.out.height !== h) this.out.height = h
    // STAGE ASPECT (Oct 9): channel pipes render in the new shape too (their canvas size follows its CSS box)
    for (const r of (this.rt || [])) { const p = r && r.pipe; if (p && p.canvas) { p.canvas.style.width = w + 'px'; p.canvas.style.height = h + 'px'; p.fixedSize = [w, h] } if (r && r.pcOut && (r.pcOut.width !== w || r.pcOut.height !== h)) { r.pcOut.width = w; r.pcOut.height = h } }
  }
  setControl (s) { this.ctrl = s }
  setAudio (band, onset, tick) {
    // pipe.band is {low,mid,high}; older code reads band[0]. Keep both shapes on one array.
    const b = band || [0, 0, 0], A = Array.isArray(b)
    const h = [(A ? b[0] : b.low) || 0, (A ? b[1] : b.mid) || 0, (A ? b[2] : b.high) || 0]
    h.low = h[0]; h.mid = h[1]; h.high = h[2]
    this.band = h; this.onset = onset || 0; this.tick = tick || 0
  }
  // per-channel colour: L.color ('hvft'|'white'|'blue'|'gray'|'random'); RANDOM = new hue on every beat
  _colorOf (L) { return L.color || (L.src === 'text' ? 'random' : 'hvft') }
  _lutFor (name) {
    this._luts = this._luts || {}
    if (!this._luts[name] && typeof buildLut === 'function') this._luts[name] = buildLut(name)
    return this._luts[name] || null
  }
  _pipeColor (i, L) {
    const c = this._colorOf(L)
    if (c !== 'random') return c
    const rt = this.rt[i] || {}
    const hit = this.onset > 0.45
    if (rt._hue == null || (hit && !rt._hit)) rt._hue = (Math.random() * 360) | 0
    rt._hit = hit
    return 'hue:' + rt._hue
  }
  // BACKGROUND colour (L.bgColor): 'same'/unset = follow the object colour; RANDOM rolls its own hue per beat
  _bgPipeColor (i, L) {
    const c = L.bgColor
    if (!c || c === 'same') return null
    if (c !== 'random') return c
    const rt = this.rt[i] || {}
    const hit = this.onset > 0.45
    if (rt._bgHue == null || (hit && !rt._bgHit)) rt._bgHue = (Math.random() * 360) | 0
    rt._bgHit = hit
    return 'hue:' + rt._bgHue
  }
  _audF () { return { audioOn: typeof window !== 'undefined' && !!window.HVFT_MIC_ON, audAmt: Math.min(1, ((this.ctrl && this.ctrl.audioAmt != null) ? this.ctrl.audioAmt : 0.4) * 2.5) } }   // 40 % = full reaction

  setLayers (cfg) {
    // buang runtime lapis yang hilang
    if (cfg.length < this.rt.length) {
      for (let i = cfg.length; i < this.rt.length; i++) this._dispose(i)
      this.rt.length = cfg.length
    }
    this.layers = cfg
  }
  _dispose (i) {
    const rt = this.rt[i]; if (!rt) return
    try { if (rt.pipe) rt.pipe.stop() } catch (e) {}
    try { if (rt.pipe && rt.pipe.canvas) rt.pipe.canvas.remove() } catch (e) {}
    try { if (rt.pcOut) rt.pcOut.remove() } catch (e) {}
    this.rt[i] = null
  }

  _mkPipe () {
    const cv = document.createElement('canvas')
    cv.style.cssText = 'width:' + this.W + 'px;height:' + this.H + 'px'
    this.host.appendChild(cv)
    const p = new HvftPipeline(cv)
    p._inComp = true   // deck channel pipe (RVM ownership priority)
    p.fixedSize = [this.W, this.H]
    p.settings.fit = 'cover'; p.settings.res = this.W
    p.start(); p.initModel().catch(() => {})
    if (this._micOn) p.startAudio().catch(() => {})   // tangkap mic HANYA kalau Mic global nyala (bukan otomatis)
    return p
  }

  // audio input changed (device / IN 1-2 / trim) -> reopen every listening layer pipe
  restartAudio () { const rt = this.rt || []; for (let i = 0; i < rt.length; i++) { const p = rt[i] && rt[i].pipe; if (p && p.restartAudio) { try { p.restartAudio().catch(() => {}) } catch (e) {} } } }

  // GERBANG MIC: nyalakan/matikan penangkapan mic di SEMUA pipe lapis sekaligus.
  setMicOn (on) {
    this._micOn = !!on
    const rt = this.rt || []
    for (let i = 0; i < rt.length; i++) {
      const p = rt[i] && rt[i].pipe
      if (!p) continue
      if (on) { try { p.startAudio().catch(() => {}) } catch (e) {} }
      else if (p.stopAudio) { try { p.stopAudio() } catch (e) {} }
    }
  }

  // FITUR per-lapis: satu lapis bisa punya BANYAK fitur sekaligus (feats = array).
  _applyFeat (p, feats) {
    const has = k => Array.isArray(feats) && feats.indexOf(k) >= 0
    p.settings.hud = has('hud')
    p.settings.grid = has('grid')
    p.settings.alpha = has('alpha')   // cut-out: latar transparan (segmentasi orang dari kamera)
    if (has('trackobj')) { p.settings.blob = 'white'; p.settings.track = 'object' }
    else if (has('blobg')) { p.settings.blob = 'green'; p.settings.track = 'motion' }
    else if (has('blob')) { p.settings.blob = 'white'; p.settings.track = 'motion' }
    else p.settings.blob = 'off'
  }

  _ensure (i) {
    const L = this.layers[i]
    let rt = this.rt[i]; if (!rt) rt = this.rt[i] = {}
    const logoFx = (L.src === 'logo' && ((L.effect && L.effect !== 'none') || (L.bgfx && L.bgfx !== 'none')))   // Logo / dropped PNG + efek / BG PATTERN -> lewat pipe
    const textFx = (L.src === 'text' && ((L.effect && L.effect !== 'none') || (L.bgfx && L.bgfx !== 'none')))    // TEKS + efek / BG PATTERN -> lewat pipe (kanvas teks jadi sumber)
    const usePipe = (L.src === 'cam' || L.src === 'lidar' || L.src === 'kinect' || L.src === 'depthai' || L.src === 'pc3d' || L.src === 'media' || logoFx || textFx)
    if (usePipe) {
      if (!rt.pipe) rt.pipe = this._mkPipe()
      const p = rt.pipe
      // terapkan look global (warna/audio), tapi efek + FITUR per-lapis milik lapis
      if (this.ctrl) { Object.assign(p.settings, this.ctrl); p.settings.fit = 'cover'; p.settings.res = this.W }
      p.fixedSize = [this.W, this.H]
      p.settings.color = this._pipeColor(i, L)   // COLOR is per channel now (OBJECT)
      p.settings.bgColor = this._bgPipeColor(i, L)   // BACKGROUND colour (null = same as object)
      p.settings.effect = (L.effect && L.effect !== '') ? L.effect : 'none'
      this._applyFeat(p, L.feats)
      p.settings.fxParams = L.fxParams || {}     // nilai slider parameter efek (milik lapis ini)
      p.settings.fxLinks = L.fxLinks || {}       // link parameter -> band audio (milik lapis ini)
      p.settings.strobe = { on: false }   // gate lapis dipasang di _paintLayer, JANGAN di dalam pipe (hindari dobel)
      p.settings.bgfx = L.bgfx || 'none'  // LATAR POLA: pola pengisi latar di belakang subjek (kanal sama)
      p.settings.bgBrutal = (L.bgBrutal != null ? L.bgBrutal : 0.85)   // BRUTALITY of the audio-reactive background
      p.settings.bgfxPower = (L.bgfxPower != null ? L.bgfxPower : 0.7)   // KUASA CAHAYA (audio menaikkan terang pola)
      p.settings.bgKeyLvl = (L.bgKeyLvl != null ? L.bgKeyLvl : 0.3)
      p.netRot = 0; p.netFlip = false   // HVFT Cam: orientation comes from the phone itself (APK follows how it is held) — no manual rotate
      p.settings.bgKey = (L.src === 'media' || L.src === 'logo') ? (L.bgKey || 'luma') : null   // CH3 MEDIA + BG PATTERN: 'luma' = dark parts show the pattern, 'person' = AI cut-out
      if (L.textCfg) p.settings.textCfg = L.textCfg
      // KINECT: the global selfie MIRROR is for webcams; on the Kinect it turned the picture/text backwards ("Smile" read reversed).
      // Kinect = true camera view by default; KINECT MIRROR (HVFT_PC_OPT.kMirror) flips it on purpose.
      if (L.src === 'kinect' || (L.src === 'pc3d' && L.depthIn === 'kinect')) p.settings.mirror = !!(typeof window !== 'undefined' && window.HVFT_PC_OPT && window.HVFT_PC_OPT.kMirror)
      const key = L.src + ':' + (L.camIdx | 0) + ':' + (L.url || '') + ':' + (L.depthIn || '') + ':' + (L.net || '')
      if (rt.key !== key) {
        rt.key = key
        if (L.src === 'cam' && L.net) { p.setLayerClip(0, 'camera', ''); p.startNetworkCamera(L.net).catch(() => {}) }   // HVFT Cam (Android phone over WiFi) in THIS channel
        else if (L.src === 'cam') { p.setLayerClip(0, 'camera', ''); const c = this.cams[L.camIdx | 0]; p.startCamera(c ? c.deviceId : null).catch(() => {}) }
        else if (L.src === 'media') { p.setLayerClip(0, L.kind || (/(mp4|mov|webm|m4v)$/i.test(L.url || '') ? 'video' : 'image'), L.url || '') }
        else if (L.src === 'logo') { p.setLayerClip(0, 'image', L.url || '') }   // logo ber-efek: dimuat sebagai gambar di pipe
        else if (L.src === 'pc3d') {
          if (!rt.pcGpu && window.PointCloudGPU) {
            rt.pcOut = document.createElement('canvas'); rt.pcOut.width = this.W; rt.pcOut.height = this.H
            rt.pcOut.style.cssText = 'position:absolute;left:-99999px;top:0'
            document.body.appendChild(rt.pcOut)
            rt.pcCtx = rt.pcOut.getContext('2d', { willReadFrequently: true })
            // feed Depth-AI webcam: tegak(flipY) + depth benar(invZ) + penuh(zoom) + lebih terang/rapat/besar
            try { rt.pcGpu = new PointCloudGPU(document.createElement('canvas'), { noGL: true }); if (rt.pcGpu) { const o = rt.pcGpu.opt; o.flipY = true; o.invZ = true; o.zoom = 1.0; o.glow = 3.0; o.pointSize = 9.0; o.densX = 4.5; o.densY = 1.5; o.farCut = 8.0; if (rt.pcGpu.fit) rt.pcGpu.fit() } } catch (e) { rt.pcGpu = null }
          }
          p.setLayerClip(0, 'pc3d', ''); if (rt.pcOut) p.setExternalCanvas(rt.pcOut)
        } else if (L.src === 'text') {   // TEKS ber-efek: render teks ke kanvas, umpan ke pipe sbg sumber 'ext'
          if (!rt.textOut) { rt.textOut = document.createElement('canvas'); rt.textOut.width = this.W; rt.textOut.height = this.H; rt.textCtx = rt.textOut.getContext('2d') }
          p.setLayerClip(0, 'ext', ''); if (rt.textOut) p.setExternalCanvas(rt.textOut)
        } else if (L.src === 'kinect') { p.setLayerClip(0, 'lidar', '') }   // Kinect = metric depth, same 2D path as LiDAR
        else { p.setLayerClip(0, L.src, '') } // lidar / depthai
      }
      if (L.src === 'text' && rt.textCtx) {   // segarkan kanvas teks tiap frame (pipe membacanya sbg sumber)
        if (rt.textOut.width !== this.W || rt.textOut.height !== this.H) { rt.textOut.width = this.W; rt.textOut.height = this.H }
        rt.textCtx.setTransform(1, 0, 0, 1, 0, 0); rt.textCtx.clearRect(0, 0, this.W, this.H)
        this._drawTextTo(rt.textCtx, L)
      }
      if (L.src === 'pc3d' && rt.pcGpu && rt.pcCtx) {
        if (typeof window !== 'undefined' && window.HVFT_PC_OPT) {
          const O = window.HVFT_PC_OPT; Object.assign(rt.pcGpu.opt, O)
          if (!O.spin && rt.pcGpu.cam) { if (O._yaw != null) rt.pcGpu.cam.yaw = O._yaw; if (O._pitch != null) rt.pcGpu.cam.pitch = O._pitch } // orbit dari panel
        }
        if (L.depthIn === 'kinect') { const o = rt.pcGpu.opt; o.invZ = true; o.metric = true; o.flipY = !(window.HVFT_PC_OPT && window.HVFT_PC_OPT.flipY);   /* upright input needs flipY=true in PointCloudGPU; FLIP button inverts */ if (!o._kinFar) { o.farCut = 4.5; o.zoom = 1.0; o._kinFar = 1; if (rt.pcGpu.fit) rt.pcGpu.fit() } }   // Kinect: real mm depth, upright
        else if (rt.pcGpu.opt._kinFar) { const o = rt.pcGpu.opt; o.invZ = true; o.metric = false; o.flipY = true; o.farCut = 8.0; o.zoom = 1.0; o._kinFar = 0; if (rt.pcGpu.fit) rt.pcGpu.fit() }
        rt.pcGpu.opt.pal = this._colorOf(L)   // channel COLOR -> 3D cloud palette
        rt.pcGpu.aud = this._audF(); rt.pcGpu.setAudio(this.band[0] || 0, this.onset, this.band[1] || 0, this.band[2] || 0); rt.pcGpu.renderCPU(rt.pcCtx)
      }
    } else if (L.src === 'logo' || L.src === 'ai' || L.src === 'animegan') {   // ai/animegan = gambar hasil restyle (url = dataURL, disegarkan berkala)
      if (rt.pipe) {   // buang pipe BASI dari src sebelumnya (mis. 'media'/'cam') -> kalau tidak, _paintLayer gambar pipe lama, bukan gambar logo/AI
        try { rt.pipe.stop() } catch (e) {}
        try { if (rt.pipe.canvas) rt.pipe.canvas.remove() } catch (e) {}
        rt.pipe = null; rt.key = null
      }
      if ((L.src === 'ai' || L.src === 'animegan') && !L.url) { rt.el = null; rt.prevEl = null; rt.url = '' }   // AI stopped -> live camera only
      else if (!rt.el || rt.url !== L.url) {
        const isAi = (L.src === 'ai' || L.src === 'animegan')
        if (isAi && rt.el && rt.el.complete && (rt.el.naturalWidth || 0) > 0) rt.prevEl = rt.el   // keep the last image until the new one is decoded
        rt.url = L.url; rt.el = new Image(); rt.fadeT0 = 0
        rt.el.onload = () => { rt.fadeT0 = (typeof performance !== 'undefined' ? performance.now() : Date.now()) }
        rt.el.src = L.url || ''
      }
    } else if (L.src === 'text') {   // TEKS tanpa efek: buang pipe basi (kalau sebelumnya ber-efek)
      if (rt.pipe) { try { rt.pipe.stop() } catch (e) {} try { if (rt.pipe.canvas) rt.pipe.canvas.remove() } catch (e) {} rt.pipe = null; rt.key = null }
    }
    return rt
  }

  pushDepth (f) {
    const isAi = !!f.ai
    for (let i = 0; i < this.layers.length; i++) {
      const L = this.layers[i], rt = this.rt[i]; if (!rt) continue
      if (L.src === 'kinect') { if (f.kinect && rt.pipe) rt.pipe.pushLidarFrame(f, false) }   // Kinect frames arrive upright
      else if (L.src === 'pc3d' && L.depthIn === 'kinect') { if (f.kinect && rt.pcGpu) rt.pcGpu.pushFrame(f) }
      else if (L.src === 'lidar' && !isAi && !f.kinect && rt.pipe) rt.pipe.pushLidarFrame(f, true)
      else if (L.src === 'depthai' && isAi && rt.pipe && (f.aiCam == null || (f.aiCam | 0) === (L.camIdx | 0))) rt.pipe.pushLidarFrame(f, false)   // Depth-AI 1/2 -> kamera camIdx (bergantian)
      else if (L.src === 'pc3d' && rt.pcGpu && !f.kinect) rt.pcGpu.pushFrame(f)
    }
  }
  needsAiDepth () { return this.layers.some(L => L.src === 'depthai' || (L.src === 'pc3d' && L.depthIn !== 'kinect')) }

  _drawFitTo (ctx, src, sw, sh) {
    ctx.imageSmoothingEnabled = !(typeof window !== 'undefined' && window.HVFT_CRISP)   // CRISP = hard pixels, no blur when scaling
    const s = Math.max(this.W / sw, this.H / sh)
    const w = sw * s, h = sh * s
    ctx.drawImage(src, (this.W - w) / 2, (this.H - h) / 2, w, h)
  }
  _drawTextTo (ctx, L) {
    if (typeof drawHvftText !== 'function') return
    const lut = this._lutFor(this._colorOf(L))
    const f = Object.assign({ W: this.W, H: this.H, onset: this.onset, band: this.band, tick: this.tick, lut, hudScale: (this.ctrl && this.ctrl.hudScale) || 1 }, this._audF())
    drawHvftText(ctx, f, { W: this.W, H: this.H }, L.textCfg || { str: L.str || '' })
  }
  // kanvas per-lapis (dipakai untuk OUTPUT PER-LAYER / mapping tiap region ke satu layer)
  _layer (i) {
    if (!this.lcv) this.lcv = []
    let o = this.lcv[i]
    if (!o) { const cv = document.createElement('canvas'); o = this.lcv[i] = { cv, ctx: cv.getContext('2d') } }
    if (o.cv.width !== this.W || o.cv.height !== this.H) { o.cv.width = this.W; o.cv.height = this.H }
    return o
  }
  _paintLayer (i, rt) {
    const L = this.layers[i]; const o = this._layer(i); const c = o.ctx
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'
    c.clearRect(0, 0, this.W, this.H)
    let drew = false
    if (L.src === 'text' && !(rt.pipe && rt.pipe.canvas && rt.pipe.canvas.width > 2)) { this._drawTextTo(c, L); drew = true }
    else if ((L.src === 'logo' || L.src === 'ai' || L.src === 'animegan') && !(rt.pipe && rt.pipe.canvas && rt.pipe.canvas.width > 2)) {
      // AI (ai/animegan): tampilkan KAMERA MENTAH sbg basis dulu (verifikasi sumber), lalu restyle di atasnya bila sudah ada
      if (L.src === 'ai' || L.src === 'animegan') {
        const rv = (typeof window !== 'undefined') ? window.HVFT_AI_SRC_VIDEO : null
        if (rv && (rv.videoWidth || 0) > 2) { this._drawFitTo(c, rv, rv.videoWidth, rv.videoHeight); drew = true }
      }
      // CROSSFADE between AI frames (350 ms) and never fall back to the raw camera while the next frame decodes
      const okEl = el => el && el.complete && (el.naturalWidth || 0) > 0
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()), FADE = 350
      // Oct 12 LIVE path: realtime AI (Reference / Gemini REALTIME BRIDGE) hands over a canvas every frame —
      // drawn directly: no JPEG encode/decode, no comp rebuild, no 350 ms fade lag
      const lc = (L.src === 'ai' && typeof window !== 'undefined') ? window.HVFT_AI_LIVE_CANVAS : null
      if (lc && lc.width > 2 && now - (window.HVFT_AI_LIVE_T || 0) < 700) { this._drawFitTo(c, lc, lc.width, lc.height); drew = true; rt.prevEl = null }
      else {
      const curOk = okEl(rt.el), a = (curOk && rt.fadeT0) ? Math.min(1, (now - rt.fadeT0) / FADE) : (curOk ? 1 : 0)
      if (rt.prevEl && okEl(rt.prevEl) && a < 1) { this._drawFitTo(c, rt.prevEl, rt.prevEl.naturalWidth, rt.prevEl.naturalHeight); drew = true }
      if (curOk) {
        c.globalAlpha = rt.prevEl ? a : 1; this._drawFitTo(c, rt.el, rt.el.naturalWidth, rt.el.naturalHeight); c.globalAlpha = 1; drew = true
        if (a >= 1) rt.prevEl = null
      }
      }
    }
    else if (rt.pipe && rt.pipe.canvas.width > 2) { this._drawFitTo(c, rt.pipe.canvas, rt.pipe.canvas.width, rt.pipe.canvas.height); drew = true }
    // HVFT Cam (phone) not live yet -> say so on the channel (instead of a silent black / old picture)
    if (L.src === 'cam' && L.net && rt.pipe && rt.pipe.netStat && rt.pipe.netStat.state !== 'live') {
      const S = rt.pipe.netStat, sec = Math.round((performance.now() - S.t0) / 1000)
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'
      c.fillStyle = '#000'; c.fillRect(0, 0, this.W, this.H)
      c.fillStyle = S.state === 'error' ? '#e2553c' : '#F2A03D'; c.textAlign = 'center'; c.textBaseline = 'middle'
      c.font = '700 ' + Math.round(this.H / 22) + 'px monospace'
      c.fillText('HVFT CAM · ' + (S.state === 'error' ? 'NO STREAM' : 'CONNECTING') + ' · ' + String(S.url || '').replace(/^https?:\/\//, ''), this.W / 2, this.H / 2 - this.H / 30)
      c.font = '500 ' + Math.round(this.H / 34) + 'px monospace'; c.fillStyle = '#9a9a9a'
      c.fillText('try ' + S.tries + ' · ' + sec + ' s · keep the phone app open, screen on, same WiFi', this.W / 2, this.H / 2 + this.H / 30)
      drew = true
    }
    // FITUR teks: overlay teks DI ATAS isi lapis — hanya lapis yang menyematkan 'teks'
    if (L.feats && L.feats.indexOf('teks') >= 0 && L.textCfg && (L.textCfg.str || '').trim() && typeof drawHvftText === 'function') {
      const lut = this._lutFor(this._colorOf(L))
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'
      drawHvftText(c, Object.assign({ W: this.W, H: this.H, onset: this.onset, band: this.band, tick: this.tick, lut, hudScale: (this.ctrl && this.ctrl.hudScale) || 1 }, this._audF()), { W: this.W, H: this.H }, L.textCfg)
      drew = true
    }
    // ISF SHADER FX (isf_fx.js) on top of this channel's picture (before the strobe, so the strobe still gates it)
    if (drew && L.isf && L.isf.id && L.isf.id !== 'none' && typeof window !== 'undefined' && window.HVFT_ISF) { try { window.HVFT_ISF.apply(c, o.cv, L.isf, i) } catch (e) {} }
    // HOLO (Oct 7): the HVFT colour as a hologram — cyan ghost fringe, fine scanlines and a slow refresh sweep
    if (drew && L.holo !== false && this._colorOf(L) === 'hvft') { try { this._holo(c, o.cv, this.W, this.H) } catch (e) {} }
    // STROBE / FLICKER lapis ini: fase mati = transparan (lapis bawah tembus) atau kilat putih.
    // Dipasang di kanvas lapis sendiri supaya preview, komposit, DAN surface mapping ikut berkedip.
    if (drew && L.strobe && L.strobe.on && typeof hvftGateLevel === 'function') {
      const lv = hvftGateLevel(L.strobe, (typeof performance !== 'undefined' ? performance.now() : Date.now()), (typeof window !== 'undefined' && window.HVFT_AUDIO) || {})
      if (lv < 0.999) {
        c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1
        if (L.strobe.white) { c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgba(255,255,255,' + (1 - lv) + ')' }
        else { c.globalCompositeOperation = 'destination-out'; c.fillStyle = 'rgba(0,0,0,' + (1 - lv) + ')' }
        c.fillRect(0, 0, this.W, this.H)
        c.globalCompositeOperation = 'source-over'
      }
    }
    return drew ? o.cv : null
  }
  _holo (c, cv, W, H) {
    const t = performance.now() / 1000
    const A = (typeof window !== 'undefined' && window.HVFT_MIC_ON && window.HVFT_AUDIO) || {}
    const hi = A.high || 0, lo = A.low || 0
    const g = this._holoG || (this._holoG = document.createElement('canvas'))
    if (g.width !== W || g.height !== H) { g.width = W; g.height = H; this._holoP = null }
    const gx = g.getContext('2d')
    gx.globalCompositeOperation = 'copy'; gx.globalAlpha = 1; gx.drawImage(cv, 0, 0)
    // cyan ghost = the picture × cyan (dark stays dark, only the light gets a cyan fringe), alpha kept
    gx.globalCompositeOperation = 'multiply'; gx.fillStyle = 'rgb(60,235,255)'; gx.fillRect(0, 0, W, H)
    gx.globalCompositeOperation = 'destination-in'; gx.drawImage(cv, 0, 0)
    const u = Math.max(1, W / 1280), off = u * (2 + hi * 4)
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0)
    // cyan ghost fringe (screen = only brightens, on top of everything)
    c.globalCompositeOperation = 'screen'; c.globalAlpha = 0.2 + hi * 0.15; c.drawImage(g, -off, 0)
    c.globalAlpha = 0.1; c.drawImage(g, off * 0.6, 0)
    // fine scanlines: every 3rd row loses some light (stays transparent where the layer is transparent)
    if (!this._holoP) {
      const pc = document.createElement('canvas'), n = Math.max(3, Math.round(3 * u)); pc.width = 4; pc.height = n
      const px = pc.getContext('2d'); px.fillStyle = 'rgba(0,0,0,0.34)'; px.fillRect(0, n - Math.max(1, Math.round(u)), 4, Math.max(1, Math.round(u)))
      this._holoP = c.createPattern(pc, 'repeat')
    }
    c.globalCompositeOperation = 'destination-out'; c.globalAlpha = 1; c.fillStyle = this._holoP; c.fillRect(0, 0, W, H)
    // slow refresh sweep (brightens only what is there); the bass pushes it a little
    const y = (((t * (0.22 + lo * 0.25)) % 1.3) - 0.15) * H, bh = H * 0.12
    const gr = c.createLinearGradient(0, y - bh, 0, y + bh)
    gr.addColorStop(0, 'rgba(190,255,250,0)'); gr.addColorStop(0.5, 'rgba(190,255,250,' + (0.32 + lo * 0.25).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(190,255,250,0)')
    c.globalCompositeOperation = 'overlay'; c.fillStyle = gr; c.fillRect(0, y - bh, W, bh * 2)   // overlay: black stays black, light gets the sweep
    c.restore()
  }
  getLayerCanvas (i) { const o = this.lcv && this.lcv[i]; return (o && o.cv && o.cv.width > 2) ? o.cv : null }
  layerCount () { return this.layers.length }

  render () {
    const ctx = this.ctx
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, this.W, this.H)
    for (let i = 0; i < this.layers.length; i++) {
      const L = this.layers[i]
      if (L.on === false) { const o = this._layer(i); o.ctx.setTransform(1, 0, 0, 1, 0, 0); o.ctx.clearRect(0, 0, this.W, this.H); continue } // OFF -> kosongkan kanvas lapis (surface mapping ikut mati)
      const rt = this._ensure(i)
      const cv = this._paintLayer(i, rt)   // gambar isi lapis ke kanvasnya sendiri
      if (!cv) continue
      ctx.globalAlpha = (L.opacity != null ? L.opacity : 1)
      ctx.globalCompositeOperation = HVFT_BLEND[L.blend || 'normal'] || 'source-over'
      ctx.drawImage(cv, 0, 0)             // lalu komposit ke keluaran utama
    }
    // MASTER fade / BLACKOUT: tirai hitam di atas semua (0 = blackout, 1 = penuh).
    // Berlaku ke preview deck (kontrol) & proyektor (outDeck) — keduanya pakai kelas ini.
    const m = (typeof window !== 'undefined' && window.HVFT_MASTER && typeof window.HVFT_MASTER.level === 'number') ? window.HVFT_MASTER.level : 1
    if (m < 0.999) { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1 - Math.max(0, m); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, this.W, this.H) }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1
  }
}
window.LayerComp = LayerComp
