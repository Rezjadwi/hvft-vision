// HVFT VISION — deck_ui.js  (MOCK-EXACT REBUILD: CHANNEL STACK + INSPECTOR + PREVIEW + BANKS)
// Fixed 4 channels, each -> fixed region:
//   CH1 CAMERA·PERSON -> R1 : camera + subject FX + global features + audio
//   CH2 CAMERA·SPACE  -> R2 : Depth-AI / PC-3D / LiDAR / Kinect + non-subject FX
//   CH3 MEDIA·TEXT    -> R3 : media / PNG / video / text
//   CH4 AI            -> R4 : AI Live (Reference/Gemini/Local) / AI Gen (AnimeGAN)
// Engine wiring is unchanged: LayerComp (compositor), pipe (look + audio), window.hvft.sendComp.
// Detail controls live in the right INSPECTOR; buttons there forward to the ORIGINAL controls
// (control.js handlers) instead of re-implementing them.
(function () {
  const cv = document.getElementById('deckcv')
  const bar = document.getElementById('deckbar')
  if (!cv || !bar || typeof LayerComp === 'undefined') return
  const INS = document.getElementById('inspector')
  const GFE = document.getElementById('gfeat')
  const comp = new LayerComp(cv); comp.setSize(1280, 720)
  window.__hvftMic = (on) => { try { comp.setMicOn(on) } catch (e) {} }
  window.__hvftMicRestart = () => { try { if (comp.restartAudio) comp.restartAudio() } catch (e) {} }

  // ---- effect palettes per channel ----
  const EFX_PERSON = [['none', '—'], ['dither', 'Dither Ghost'], ['burst', 'Particle Burst'], ['cyborg', 'Cyborg'], ['pointcloud', 'Point Cloud'], ['triangulate', 'Triangulate'], ['volumetric', 'Volumetric'], ['pixellines', 'Pixel Lines'], ['constellation', 'Constellation'], ['wave', 'Wave'], ['erode', 'Erode'], ['anime', 'Anime'], ['cutout', 'Cut-Out Collage'], ['trackcollage', 'Tracking Collage']]
  const EFX_ENV = [['none', '—'], ['dither', 'Dither Ghost'], ['burst', 'Particle Burst'], ['pointcloud', 'Point Cloud'], ['scan', 'Scan'], ['flux', 'Flux'], ['profil', 'Profile'], ['volumetric', 'Volumetric']]
  const EFX_BG = [['cymatics', 'Cymatics'], ['plasma', 'Plasma'], ['singularity', 'Singularity'], ['filament', 'Filament'], ['tangle', 'Tangle'], ['gyro', 'Gyro'], ['eclipse', 'Eclipse'], ['beam', 'Beam']]
  const BLENDS = [['normal', 'Normal'], ['screen', 'Screen'], ['add', 'Add'], ['multiply', 'Multiply']]
  const TXTMODES = [['random', 'Random'], ['kinetic', 'Kinetic'], ['mesh', 'Mesh'], ['dust', 'Dust'],
    // Oct 12: from Reza's 8 reference clips (txt_fx2.js)
    ['trackwave', 'Wave'], ['bandsquash', 'Squash'], ['shatter', 'Shatter'], ['extrude', 'Extrude'],
    ['scalestack', 'Stack'], ['griddrift', 'Grid'], ['spike', 'Spike'], ['lettergap', 'Gap']]
  const EFFLABEL = Object.fromEntries([].concat(EFX_PERSON, EFX_ENV, EFX_BG))

  // ---- connected cameras ----
  let CAMS = []
  function refreshCams () {
    try { navigator.mediaDevices.enumerateDevices().then(ds => { CAMS = ds.filter(d => d.kind === 'videoinput' && !/obs|virtual/i.test(d.label || '')); render() }).catch(() => {}) } catch (e) {}
  }
  try { window.HVFT_DECK_REFRESH = () => { try { render() } catch (e) {} } } catch (e) {}
  function netCamList () { try { return (typeof HVFT_CAMS !== 'undefined') ? [...HVFT_CAMS.values()].map(d => d.url) : [] } catch (e) { return [] } }
  function camOpts (cur) {
    const base = (CAMS.length ? CAMS.map((c, i) => ['cam#' + i, c.label || ('Camera ' + (i + 1))]) : [['cam#0', 'Camera 1'], ['cam#1', 'Camera 2']])
    try { if (typeof HVFT_CAMS !== 'undefined') for (const d of HVFT_CAMS.values()) base.push(['net:' + d.url, 'HVFT Cam (Android)' + (d.ip ? ' \u00b7 ' + d.ip : '')]) } catch (e) {}
    // Oct 12 fix: a channel still pointing at a phone that is NOT on this network had no matching option -> the select
    // SHOWED "FaceTime" while the channel was really on the dead phone, and picking FaceTime fired no change. List it honestly.
    if (cur && !base.some(o => o[0] === 'net:' + cur)) base.push(['net:' + cur, 'HVFT Cam · OFFLINE · ' + String(cur).replace(/^https?:\/\//, '')])
    return base
  }
  // Oct 12 (Reza: "kenapa sekarang ga bisa akses FaceTime"): a preset / LIVE slot remembered the phone (192.168.1.5) on another WiFi
  // -> the channel kept retrying it forever. Now: phone unreachable for ~20 s -> that channel falls back to the Mac camera by itself.
  function macCamIdx () { const k = CAMS.findIndex(c => /facetime|built-in|macbook/i.test(c.label || '')); return k >= 0 ? k : 0 }
  const netDead = {}
  setInterval(() => {
    const now = performance.now(), pipes = ((window.__comp && window.__comp.rt) || []).map(r => r && r.pipe).filter(p => p && p.netStat)
    let changed = false
    deck.layers.forEach((L, i) => {
      if (!L.net || L.on === false) return
      const p = pipes.find(q => q.netStat.url === L.net || q.netUrl === L.net)
      const live = p ? p.netStat.state === 'live' : (typeof HVFT_CAMS !== 'undefined' && HVFT_CAMS.has(L.net))
      if (live) { delete netDead[i]; return }
      if (!netDead[i]) { netDead[i] = now; return }
      if (now - netDead[i] < 20000) return
      console.error('[HVFTCAM-R] ch' + (i + 1) + ' phone ' + L.net + ' unreachable 20 s -> back to Mac camera')
      L.net = null; L.camIdx = macCamIdx(); delete netDead[i]; changed = true
    })
    if (changed) { buildComp(); render() }
  }, 2000)
  function useHvftCamCh (i, url) {
    console.error('[HVFTCAM-R] useHvftCamCh ch=' + i + ' url=' + url + ' selFn=' + (typeof selectCameraSource))
    const L = deck.layers[i]; L.src = 'cam'; L.net = url; L.camIdx = 0; sel = i
    try { if (typeof selectCameraSource === 'function') selectCameraSource('hvftcam:' + url) } catch (e) {}
    try { const sl = document.querySelector('#cam'); if (sl) { const v = 'hvftcam:' + url; if ([...sl.options].some(o => o.value === v)) sl.value = v } } catch (e) {}
    render(); buildComp()
  }

  // ---- deck model: 4 fixed channels + global features ----
  const mkStrobe = () => ({ on: false, mode: 'strobe', rate: 0.35, duty: 0.5, depth: 1, band: 'off', amt: 0.5, invert: false, white: false })
  const mkCh = (o) => Object.assign({ on: true, opacity: 1, blend: 'normal', effects: [], effect: 'none', camIdx: 0, url: '', kind: '', textCfg: null, fxParams: {}, fxLinks: {}, strobe: mkStrobe(), crop: false, bgfx: 'none', bgfxPower: 0.7, solo: false, bypass: false }, o)
  const BGFX = [['none', 'NONE'], ['plasma', 'PLASMA'], ['cymatics', 'CYMATICS'], ['singularity', 'SINGULARITY'], ['filament', 'FILAMENT'], ['tangle', 'TANGLE'], ['gyro', 'GYRO'], ['eclipse', 'ECLIPSE'], ['beam', 'BEAM']]
  const BGDESC = { none: 'No pattern — the black behind the subject stays black.', plasma: 'Churning plasma field fills the black behind the subject.', cymatics: 'Sound-wave interference rings; scrambles on hits.', singularity: 'Gravity-well particles collapse toward the centre.', filament: 'Branching lightning filaments strike on the beat.', gyro: 'Grainy particle gyroscopes — dust rings orbiting a grain-sphere core. Beat = hard cut to a new composition (tiny ↔ huge, one ↔ many); mid spins them.', eclipse: 'Black-hole eclipse — dark disc with a burning corona ring, rays and smoke wisps. Bass heats the ring, beat = zoom punch + smoke burst.', beam: 'Diagonal light beam with a galactic bulge; particles orbit it in dotted trails. Beat = angle jump + white zoom smear.', tangle: 'Tangled light-string web cut into panels — every beat hard-cuts the panels and burns a flare along a seam. Mic off = one calm web.' }
  const GMODES = [['strobe', 'STROBE'], ['flicker', 'FLICKER'], ['pulse', 'PULSE'], ['ramp', 'RAMP']]
  const hzOf = (r) => 0.5 + r * r * 29.5
  const gateHz = (r) => { const v = hzOf(r); return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' Hz' }
  let deck = {
    g: { hud: false, grid: false, blob: 'off' },
    layers: [
      mkCh({ role: 'cam', name: 'CAMERA · PERSON', region: 1, src: 'cam', camIdx: 0 }),
      mkCh({ role: 'depth', name: 'CAMERA · SPACE', region: 2, src: 'depthai', camIdx: 1 }),
      mkCh({ role: 'media', name: 'MEDIA · TEXT', region: 3, src: 'media', on: false, textCfg: { str: 'HVFT', size: 0.16, react: 1, oneFont: true, mode: 'random', fonts: [], letter: 0 } }),
      mkCh({ role: 'ai', name: 'AI', region: 4, src: 'ai', on: false })
    ]
  }
  let sel = 0
  let _efRotTick = 0

  function globalFeats () {
    const f = []
    if (deck.g.hud) f.push('hud')
    if (deck.g.grid) f.push('grid')
    if (deck.g.blob === 'white') f.push('blob'); else if (deck.g.blob === 'green') f.push('blobg'); else if (deck.g.blob === 'track') f.push('trackobj')
    return f
  }
  const anySolo = () => deck.layers.some(x => x.solo && x.on !== false)
  const audible = (L) => L.on !== false && !L.bypass && (!anySolo() || L.solo)

  // ---- composition ----
  function buildComp () {
    deck.layers.forEach(L => { if (L.src === 'animegan') L.src = 'ai'; if (L.name === 'AI LIVE · GEN' || L.name === 'AI · GEMINI') L.name = 'AI' })   // Oct 12: Anime GAN removed — old presets fall back to Gemini
    const gf = globalFeats()
    const active = []
    for (let i = deck.layers.length - 1; i >= 0; i--) {
      const L = deck.layers[i]
      if (!audible(L)) continue   // OFF, BYPASS, or muted by another channel's SOLO
      const feats = (L.role === 'cam' || L.role === 'depth') ? gf.slice() : []
      if (L.crop) feats.push('alpha')
      active.push({ src: L.src, camIdx: L.camIdx | 0, net: (L.src === 'cam' && L.net) ? L.net : null, netRot: L.netRot | 0, netFlip: !!L.netFlip, effect: L.effect, effects: L.effects, feats, url: L.url, kind: L.kind, textCfg: L.textCfg, color: colorOf(L), bgColor: L.bgColor || 'same', depthIn: (L.src === 'pc3d' && L.depthIn === 'kinect') ? 'kinect' : null, blend: L.blend, opacity: L.opacity, fxParams: L.fxParams || {}, fxLinks: L.fxLinks || {}, strobe: L.strobe || { on: false }, bgfx: L.bgfx || 'none', bgfxPower: (L.bgfxPower != null ? L.bgfxPower : 0.7), bgBrutal: (L.bgBrutal != null ? L.bgBrutal : 0.85), bgKey: L.bgKey || 'luma', bgKeyLvl: (L.bgKeyLvl != null ? L.bgKeyLvl : 0.3), isf: (L.isf && L.isf.id && L.isf.id !== 'none') ? L.isf : null, holo: L.holo !== false, on: true, _li: i })
    }
    comp.setLayers(active)
    if (window.hvft && window.hvft.sendComp) window.hvft.sendComp(active)
    updateAiCam()
    updateKinect()
    window.HVFT_AI_LIVE_ON = deck.layers.some(L => L.on !== false && L.src === 'ai')
    window.HVFT_GAN_ON = deck.layers.some(L => L.on !== false && L.src === 'animegan')
    const aiCh = deck.layers.find(L => L.on !== false && (L.src === 'ai' || L.src === 'animegan'))
    window.HVFT_AICAM = aiCh ? (aiCh.camIdx | 0) : (deck.layers[0].camIdx | 0)
    window.HVFT_AINET = aiCh ? (aiCh.net || null) : (deck.layers[0].src === 'cam' ? (deck.layers[0].net || null) : null)   // AI source = HVFT Cam phone
  }

  let _aiCamLast = -2, _aiOnLast = null
  function updateAiCam () {
    let cam = null
    let net = null
    for (let i = 0; i < deck.layers.length; i++) { const L = deck.layers[i]; if (L.on !== false && (L.src === 'depthai' || (L.src === 'pc3d' && L.depthIn !== 'kinect'))) { cam = L.camIdx | 0; net = L.net || null; break } }
    window.HVFT_AI_NET = net   // DEPTH-AI / PC-3D from the HVFT Cam phone
    const on = cam != null
    if (on) window.HVFT_AI_CAM = cam
    window.HVFT_AI_ON = on
    if (cam === _aiCamLast && on === _aiOnLast) return
    _aiCamLast = cam; _aiOnLast = on
    if (window.__requestAiDepth) { try { window.__requestAiDepth(on ? cam : null) } catch (e) {} }
  }
  // ---- KINECT v1: helper runs only while a channel uses it ----
  const usesKinect = L => L.src === 'kinect' || (L.src === 'pc3d' && L.depthIn === 'kinect')
  let _kinOn = null
  window.HVFT_KINECT_STATE = 'Kinect: off'
  function updateKinect () {
    const on = deck.layers.some(L => L.on !== false && usesKinect(L))
    if (on === _kinOn) return
    _kinOn = on
    if (window.hvft && window.hvft.kinectEnable) window.hvft.kinectEnable(on)
  }
  if (window.hvft && window.hvft.onKinectState) window.hvft.onKinectState(s => {
    window.HVFT_KINECT_STATE = s
    if (_kinOn) { const st = document.getElementById('status'); if (st) st.textContent = s }
  })
  window.__deckDepth = f => { try { comp.pushDepth(f) } catch (e) {} }
  function setSrcImage (src, url) {
    if (!url) return
    let hit = false
    deck.layers.forEach(L => { if (L.on !== false && L.src === src) { L.url = url; L.kind = 'image'; hit = true } })
    if (hit) buildComp()
  }
  window.__deckSetAiImage = (url) => setSrcImage('ai', url)
  window.__deckSetGanImage = (url) => setSrcImage('animegan', url)
  window.__deckClearAi = () => { let hit = false; deck.layers.forEach(L => { if (L.src === 'ai' && L.url) { L.url = ''; hit = true } }); window.HVFT_AI_LIVE_CANVAS = null; if (hit) buildComp(); render() }

  // =====================================================================
  //  GAUGE-HUD WIDGETS (canvas) — wrap an existing <input type=range>.
  //  Drag sets input.value + dispatches 'input', so every original handler still fires.
  // =====================================================================
  const ACC = '#F2A03D'
  const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace"
  function drawGauge (cvs, v01, label, valTxt, tone, mod01) {
    const dpr = window.devicePixelRatio || 1
    const W = cvs.clientWidth || 96, H = cvs.clientHeight || 96
    if (cvs.width !== Math.round(W * dpr)) { cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr) }
    const g = cvs.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H)
    const S = Math.min(W, H), cx = W / 2, cy = H / 2, r = S / 2 - Math.max(4, S * 0.07)
    const A0 = Math.PI * 0.75, span = Math.PI * 1.5
    const acc = tone === 'inert' ? '#4A4A4A' : (tone === 'mono' ? '#E8E8E8' : ACC)
    v01 = Math.max(0, Math.min(1, v01))
    // outer dotted ring
    g.fillStyle = '#2E2E2E'
    for (let i = 0; i <= 24; i++) { const a = A0 + span * i / 24; g.beginPath(); g.arc(cx + Math.cos(a) * (r + S * 0.055), cy + Math.sin(a) * (r + S * 0.055), Math.max(0.6, S * 0.008), 0, 7); g.fill() }
    // track
    g.lineCap = 'butt'; g.lineWidth = Math.max(3, S * 0.06)
    g.strokeStyle = '#1C1C1C'; g.beginPath(); g.arc(cx, cy, r, A0, A0 + span); g.stroke()
    // modulation arc (translucent accent)
    if (mod01 > 0.002 && tone !== 'inert') { g.strokeStyle = 'rgba(242,160,61,.4)'; g.beginPath(); g.arc(cx, cy, r, A0 + span * v01, A0 + span * Math.min(1, v01 + mod01)); g.stroke() }
    // value arc
    g.strokeStyle = acc; g.shadowColor = acc; g.shadowBlur = tone === 'inert' ? 0 : 4
    g.beginPath(); g.arc(cx, cy, r, A0, A0 + span * v01); g.stroke(); g.shadowBlur = 0
    // inner disc
    g.fillStyle = '#0B0B0B'; g.beginPath(); g.arc(cx, cy, r - S * 0.06, 0, 7); g.fill()
    // needle dot
    const an = A0 + span * v01
    g.fillStyle = tone === 'inert' ? '#6A6A6A' : '#F2F2F2'; g.beginPath(); g.arc(cx + Math.cos(an) * r, cy + Math.sin(an) * r, Math.max(1.6, S * 0.025), 0, 7); g.fill()
    // number + unit
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = tone === 'inert' ? '#7A7A7A' : '#F2F2F2'
    g.font = '700 ' + Math.round(S * 0.24) + 'px ' + MONO
    g.fillText(valTxt, cx, cy - (label ? S * 0.03 : 0))
    if (label) { g.fillStyle = '#7A7A7A'; g.font = '500 ' + Math.max(7, Math.round(S * 0.085)) + 'px ' + MONO; g.fillText(label, cx, cy + S * 0.17) }
  }
  function drawSeg (cvs, v01, tone, mod01) {
    const dpr = window.devicePixelRatio || 1
    const W = cvs.clientWidth || 120, H = cvs.clientHeight || 18
    if (cvs.width !== Math.round(W * dpr)) { cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr) }
    const g = cvs.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H)
    const N = Math.max(12, Math.min(36, Math.round(W / 7))), gap = 2, sw = (W - gap * (N - 1)) / N
    v01 = Math.max(0, Math.min(1, v01)); mod01 = mod01 || 0
    const on = Math.round(v01 * N), onM = Math.round(Math.min(1, v01 + mod01) * N)
    const acc = tone === 'inert' ? '#4A4A4A' : (tone === 'mono' ? '#E8E8E8' : ACC)
    for (let i = 0; i < N; i++) {
      const x = i * (sw + gap), full = (i % 4 === 0), h = full ? H : H * 0.74, y = H - h
      if (i < on) { g.fillStyle = acc; g.shadowColor = acc; g.shadowBlur = tone === 'inert' ? 0 : 5 } else if (i < onM && tone !== 'inert') { g.fillStyle = 'rgba(242,160,61,.38)'; g.shadowBlur = 0 } else { g.fillStyle = '#1E1E1E'; g.shadowBlur = 0 }
      const c = Math.min(3, sw * 0.4)
      g.beginPath(); g.moveTo(x + c, y); g.lineTo(x + sw, y); g.lineTo(x + sw - c, y + h); g.lineTo(x, y + h); g.closePath(); g.fill()
    }
    g.shadowBlur = 0
  }
  function micLive () { return !!window.HVFT_MIC_ON }
  function bandLevel (b) {
    const P = (typeof pipe !== 'undefined' && pipe) || {}
    const B = P.band || window.HVFT_AUDIO || {}
    let lv = 0
    if (b === 'onset') lv = P.onset || 0
    else if (b === 'sel') lv = P.bandSel || 0
    else lv = (B[b] != null ? B[b] : ((window.HVFT_AUDIO || {})[b] || 0))
    return Math.max(0, Math.min(1, +lv || 0))
  }
  function fmtOf (inp, t01) {
    const w = inp.dataset.wshow
    if (w === 'raw') return String(Math.round(+inp.value))
    if (w === 'hz') { const v = hzOf(+inp.value / 100); return v < 10 ? v.toFixed(1) : String(Math.round(v)) }
    return String(Math.round(t01 * 100))
  }
  function modOf (inp, t01) {
    const b = inp.dataset.band
    if (!b || b === 'off' || !micLive()) return 0
    const amt = Math.abs(+(inp.dataset.amt != null ? inp.dataset.amt : 0.5))
    return Math.max(0, Math.min(1 - t01, amt * bandLevel(b) * (1 - t01) * 1.6))
  }
  function enhanceWidgets (root) {
    if (!root) return
    root.querySelectorAll('input[type=range][data-w]').forEach(inp => {
      if (inp._w) { inp._draw && inp._draw(); return }
      inp._w = 1
      const kind = inp.dataset.w
      const wrap = document.createElement('div'); wrap.className = 'wgt ' + (kind === 'gauge' ? 'wgauge' : 'wseg')
      if (kind === 'gauge' && inp.dataset.wpx) { wrap.style.width = inp.dataset.wpx + 'px'; wrap.style.height = inp.dataset.wpx + 'px' }
      const cvs = document.createElement('canvas'); wrap.appendChild(cvs)
      inp.style.display = 'none'; inp.parentNode.insertBefore(wrap, inp)
      const mn = +inp.min, mx = +inp.max
      const to01 = () => (+inp.value - mn) / (mx - mn || 1)
      const set01 = (t) => { t = Math.max(0, Math.min(1, t)); inp.value = Math.round(mn + t * (mx - mn)); inp.dispatchEvent(new Event('input', { bubbles: true })) }
      const draw = () => {
        const tone = inp.dataset.tone || '', t = to01(), mod = modOf(inp, t)
        if (kind === 'gauge') drawGauge(cvs, t, inp.dataset.wlab || '', fmtOf(inp, t), tone, mod)
        else drawSeg(cvs, t, tone, mod)
        const rv = inp.parentNode && inp.parentNode.querySelector('.segv'); if (rv && kind === 'seg') rv.textContent = fmtOf(inp, t) + (inp.dataset.wunit || '')
      }
      inp._draw = draw
      inp.addEventListener('input', draw)
      let drag = false, sy = 0, s01 = 0
      const pt = (e) => (e.touches ? e.touches[0] : e)
      cvs.addEventListener('pointerdown', (e) => { drag = true; sy = pt(e).clientY; s01 = to01(); if (kind === 'seg') { const rc = cvs.getBoundingClientRect(); set01((pt(e).clientX - rc.left) / rc.width) } try { if (e.pointerId != null) cvs.setPointerCapture(e.pointerId) } catch (er) {} e.preventDefault(); e.stopPropagation() })
      window.addEventListener('pointermove', (e) => { if (!drag) return; if (kind === 'gauge') set01(s01 + (sy - pt(e).clientY) / 180); else { const rc = cvs.getBoundingClientRect(); set01((pt(e).clientX - rc.left) / rc.width) } })
      window.addEventListener('pointerup', () => { drag = false })
      cvs.addEventListener('click', (e) => e.stopPropagation())
      cvs.addEventListener('wheel', (e) => { set01(to01() + (e.deltaY < 0 ? 0.02 : -0.02)); e.preventDefault() }, { passive: false })
      draw()
    })
    try { requestAnimationFrame(() => root.querySelectorAll('input[type=range][data-w]').forEach(i => i._draw && i._draw())) } catch (e) {}
  }
  window.__hvftEnhance = enhanceWidgets; window.__hvftDrawSeg = drawSeg

  // ---- helpers ----
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const opt = (list, val) => list.map(([v, n]) => `<option value="${v}"${v === val ? ' selected' : ''}>${esc(n)}</option>`).join('')
  const BANDLET = { low: 'L', mid: 'M', high: 'H', sel: 'B', onset: 'BEAT', flat: 'N', crest: 'P', sharp: 'S', wide: 'W' }
  const LINKB = ['low', 'mid', 'high', 'flat', 'crest', 'sharp']   // L M H + noise TEXTURE (Meyda): N = noisiness, P = peaks / feedback tones, S = sharpness
  const BANDNAME = { low: 'LOW', mid: 'MID', high: 'HIGH', sel: 'BAND', onset: 'BEAT', flat: 'NOISE', crest: 'PEAK', sharp: 'SHARP', wide: 'WIDE' }
  const RET = '<svg class="ret" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M7 0v4M7 10v4M0 7h4M10 7h4" stroke="currentColor" stroke-width="1.2"/></svg>'
  function srcLabel (L) {
    switch (L.src) {
      case 'cam': return 'CAMERA'
      case 'depthai': return 'DEPTH-AI'
      case 'pc3d': return L.depthIn === 'kinect' ? 'PC-3D · KINECT' : 'PC-3D'
      case 'lidar': return 'LIDAR'
      case 'kinect': return 'KINECT'
      case 'text': return 'TEXT'
      case 'media': case 'logo': return 'MEDIA'
      case 'ai': return aiMode() === 'sd' ? 'AI GEN' : 'GEMINI'
      case 'animegan': return 'AI GEN'
      default: return String(L.src || '—').toUpperCase()
    }
  }
  function shortCam (label, k) {
    const GENERIC = /^(camera|cam|hd|the|built-?in|usb|video|webcam|device|\d+)$/i
    const w = String(label || '').replace(/\(.*?\)/g, ' ').trim().split(/\s+/).filter(x => x && !GENERIC.test(x))[0]
    return w ? w.toUpperCase().slice(0, 9) : 'CAM ' + (k + 1)
  }
  // CH4 AI mode (Oct 12): GEMINI (cloud, prompt, ~1 img/s) · AI GEN (local SD-Turbo on the Mac GPU, prompt, continuous)
  try { window.HVFT_AI_MODE = localStorage.getItem('hvft_ai_mode') || 'gemini' } catch (e) { window.HVFT_AI_MODE = 'gemini' }
  const aiMode = () => window.HVFT_AI_MODE === 'sd' ? 'sd' : 'gemini'
  function setAiMode (m) {
    if (m === aiMode()) return
    const gs = document.getElementById('aiStart')
    if (m === 'sd' && gs && gs.classList.contains('on')) gs.click()                         // only one AI engine at a time
    if (m === 'gemini' && window.HVFT_AIGEN && window.HVFT_AIGEN.on) window.HVFT_AIGEN.stop()
    window.HVFT_AI_MODE = m; try { localStorage.setItem('hvft_ai_mode', m) } catch (e) {}
    render(); renderInspector()
  }
  function sdPanel (L, i) {
    const G = window.HVFT_AIGEN; if (!G) return '<div class="hdim">AI GEN client missing</div>'
    let h = `<label>SOURCE CAMERA</label><select class="hin" data-k="${i}" data-f="aicam">${opt(camOpts(L.net), L.net ? ('net:' + L.net) : ('cam#' + (L.camIdx | 0)))}</select>`
    h += `<label>PROMPT</label><textarea class="hin" data-sdprompt="1" rows="2" style="width:100%;box-sizing:border-box;resize:vertical">${esc(G.prompt)}</textarea>`
    h += `<label>STYLE PRESETS</label><div class="kgrid k4">${G.presets.map(([n, p], k) => `<button class="kbtn ${G.prompt === p ? 'on' : ''}" data-sdpreset="${k}">${esc(n)}</button>`).join('')}</div>`
    h += `<div class="isfgrid"><div class="isfcell"><span class="klab">CHANGE</span><input class="hop" data-w="gauge" data-wpx="46" data-sdstr="1" type="range" min="20" max="90" value="${Math.round(G.strength * 100)}"></div></div>`
    h += `<div class="kgrid k1"><button class="kbtn ${G.on ? 'on' : 'go'}" data-sdtoggle="1">${G.on ? '■ STOP' : '▶ START'}</button></div>`
    h += `<div class="aistat" data-sdstat="1">${esc(G.status)}</div>`
    h += `<div class="hdim">Local on the Mac GPU (SD-Turbo), free & offline. First START downloads the model once (~2.6 GB). CHANGE = how far from the camera.</div>`
    return h
  }
  function aiBox (L) { return document.getElementById(L.src === 'animegan' ? 'ganStyle' : 'aiProv') }
  function aiStyleName (L) { if (L.src === 'ai') return aiMode() === 'sd' ? 'SD-TURBO · LOCAL' : 'CLOUD'; const box = aiBox(L); const b = box && box.querySelector('button.on'); return b ? b.textContent.replace(/\(.*?\)/g, '').trim().toUpperCase() : '—' }
  function stepList (L) {
    if (L.role === 'cam') return EFX_PERSON.map(x => x[0])
    if ((L.role === 'depth' && L.src !== 'pc3d') || (L.role === 'media' && L.src === 'text')) return EFX_ENV.map(x => x[0])
    return null
  }
  function fxName (L) {
    if (L.role === 'ai') return aiStyleName(L)
    if (L.role === 'depth' && L.src === 'pc3d') return '3D CLOUD'
    if (L.role === 'media' && L.src !== 'text') return '—'
    if (L.effects && L.effects.length > 1) return 'RANDOM ×' + L.effects.length
    const e = (L.effects && L.effects[0]) || L.effect
    return (e && e !== 'none') ? String(EFFLABEL[e] || e).toUpperCase() : '—'
  }
  function curFx (L) { return (L.effects && L.effects.length) ? L.effects.slice() : ((L.effect && L.effect !== 'none') ? [L.effect] : []) }
  function linkCount (L) {
    const list = curFx(L); let n = 0
    for (const k in (L.fxLinks || {})) { const lk = L.fxLinks[k]; if (lk && lk.band && lk.band !== 'off' && list.some(f => k.indexOf(f + '.') === 0)) n++ }
    return n
  }
  function chStatus (L) {
    if (L.on === false) return ['○ OFF', '']
    if (L.bypass) return ['◇ BYPASS', '']
    if (!audible(L)) return ['○ MUTED', '']
    const G = L.strobe
    return [(G && G.on) ? '● LIVE · STR ' + gateHz(G.rate).replace(' Hz', 'HZ') : '● LIVE', 'live']
  }

  // ---- CARD: SOURCE keys ----
  function sourceKeys (L, i) {
    if (L.role === 'cam') {
      const cl = CAMS.length ? CAMS : [{ label: 'Camera 1' }, { label: 'Camera 2' }]
      return cl.slice(0, 4).map((c, k) => `<button class="skey ${(L.src === 'cam' && (L.camIdx | 0) === k) ? 'on' : ''}" data-k="${i}" data-f="camkey" data-v="${k}" title="${esc(c.label || ('Camera ' + (k + 1)))}">${esc(shortCam(c.label, k))}</button>`).join('')
    }
    if (L.role === 'depth') return [['depthai', 'DEPTH-AI'], ['pc3d', 'PC-3D'], ['lidar', 'LIDAR'], ['kinect', 'KINECT']].map(([v, n]) => `<button class="skey ${(L.src === v || (v === 'kinect' && usesKinect(L))) ? 'on' : ''}" data-k="${i}" data-f="depthkey" data-v="${v}" title="${v === 'pc3d' ? 'PC-3D cloud — from Kinect if KINECT is active' : n}">${n}</button>`).join('')
    if (L.role === 'media') { const isT = L.src === 'text'; return `<button class="skey ${!isT ? 'on' : ''}" data-k="${i}" data-f="mediakind" data-v="media">MEDIA</button><button class="skey ${isT ? 'on' : ''}" data-k="${i}" data-f="mediakind" data-v="text">TEXT</button>` }
    return `<button class="skey ${aiMode() === 'gemini' ? 'on' : ''}" data-k="${i}" data-f="aimode" data-v="gemini">GEMINI</button><button class="skey ${aiMode() === 'sd' ? 'on' : ''}" data-k="${i}" data-f="aimode" data-v="sd">AI GEN</button>`
  }

  // ---- CHANNEL STACK ----
  function renderGlobal () {
    const h = '<b>GLOBAL</b>' +
      `<button class="gf ${deck.g.hud ? 'on' : ''}" data-g="hud">HUD</button>` +
      `<button class="gf ${deck.g.grid ? 'on' : ''}" data-g="grid">GRID</button>` +
      `<button class="gf ${deck.g.blob !== 'off' ? 'on' : ''}" data-g="blob">BLOB: ${deck.g.blob.toUpperCase()}</button>`
    if (GFE) { GFE.innerHTML = h; wire(GFE); return '' }
    return '<div class="gfeat">' + h + '</div>'
  }
  function render () {
    let h = renderGlobal()
    h += '<div class="chans">'
    deck.layers.forEach((L, i) => {
      const isSel = sel === i, aud = audible(L), [st, stc] = chStatus(L)
      const lc = linkCount(L), canStep = !!stepList(L) || L.role === 'ai'
      const bl = (BLENDS.find(b => b[0] === L.blend) || BLENDS[0])[1].toUpperCase()
      h += `<div class="chanW ${isSel ? 'sel' : ''}"><div class="chan frame ${L.on !== false ? '' : 'off'} ${isSel ? 'sel' : ''} ${aud ? 'aud' : ''}" data-k="${i}"><div class="fin">
        <div class="cRow1"><span class="ctag">CH.0${i + 1}</span><b class="cname">${esc(L.name)}</b>${isSel ? '<span class="clock">◎ LOCK</span>' : ''}
          <span class="creg">R${L.region}</span>
          <button class="con ctog ${L.on !== false ? 'on' : ''}" data-k="${i}" data-f="on"><i></i><span>${L.on !== false ? 'ON' : 'OFF'}</span></button></div>
        <div class="cBody">
          <div class="cL">
            <div class="crow"><span class="clab">▸ SOURCE</span><div class="skeys">${sourceKeys(L, i)}</div></div>
            <div class="crow"><span class="clab">▸ EFFECT</span><div class="cstep ${canStep ? '' : 'dis'}"><button class="stp" data-k="${i}" data-f="efstep" data-d="-1">◂</button><span class="cfx">${esc(fxName(L))}${lc ? ` <i>◎×${lc}</i>` : ''}</span><button class="stp" data-k="${i}" data-f="efstep" data-d="1">▸</button></div></div>
            <div class="crow"><span class="clab">▸ BLEND</span><div class="cbl"><button class="cblend" data-k="${i}" data-f="blendcyc">${bl} ▾</button><button class="csolo ${L.solo ? 'on' : ''}" data-k="${i}" data-f="solo">SOLO</button><button class="cbyp ${L.bypass ? 'on' : ''}" data-k="${i}" data-f="byp">BYP</button></div></div>
          </div>
          <div class="cR">
            <input class="hop" data-w="gauge" data-wpx="88" data-wlab="OPACITY" ${aud ? '' : 'data-tone="inert"'} data-k="${i}" data-f="op" type="range" min="0" max="100" value="${Math.round((L.opacity != null ? L.opacity : 1) * 100)}">
            <div class="opstat ${stc}">${st}</div>
          </div>
        </div></div></div></div>`
    })
    h += '</div>'
    bar.innerHTML = h
    renderInspector()
    wire(bar)
    enhanceWidgets(bar)
    updateLayerPreviews(true)
  }

  // ---- INSPECTOR sections ----
  function sourceDetail (L, i) {
    if (L.role === 'cam') {
      return `<label>CAMERA DEVICE</label><select class="hin" data-k="${i}" data-f="cam">${opt(camOpts(L.net), L.net ? ('net:' + L.net) : ('cam#' + (L.camIdx | 0)))}</select>
        ${L.net ? `<div class="hdim">HVFT Cam: the picture follows the way the phone is held (portrait / landscape) automatically.</div>` : ''}
        <div class="kgrid k1" style="margin-top:6px"><button class="kbtn ${(document.getElementById('mirror') || {}).classList && document.getElementById('mirror').classList.contains('on') ? 'on' : ''}" data-proxyclick="mirror">MIRROR · SELFIE VIEW</button></div>
        <div class="hdim">HUD / GRID / BLOB (channel-stack header) apply to camera channels.</div>`
    }
    if (L.role === 'depth') {
      const sv = (L.net && (L.src === 'depthai' || L.src === 'pc3d')) ? (L.src + '@' + L.net) : L.src === 'lidar' ? 'lidar' : L.src === 'kinect' ? 'kinect' : (L.src === 'pc3d' ? (L.depthIn === 'kinect' ? 'kpc3d' : 'pc3d#' + (L.camIdx | 0)) : 'depthai#' + (L.camIdx | 0))
      const cl = CAMS.length ? CAMS : [{ label: 'Camera 1' }, { label: 'Camera 2' }]
      const dOpts = cl.map((c, k) => ['depthai#' + k, 'Depth-AI · ' + (c.label || ('Camera ' + (k + 1))).slice(0, 22)])
        .concat(cl.map((c, k) => ['pc3d#' + k, 'PC-3D Cloud · ' + (c.label || ('Camera ' + (k + 1))).slice(0, 22)]))
        .concat(netCamList().flatMap(u => [['depthai@' + u, 'Depth-AI · HVFT Cam (phone)'], ['pc3d@' + u, 'PC-3D Cloud · HVFT Cam (phone)']]))
        .concat([['lidar', 'LiDAR 2D (iPhone)'], ['kinect', 'Kinect 2D (depth · RGB)'], ['kpc3d', 'PC-3D Cloud · Kinect']])
      let h = `<label>DEPTH SOURCE · CAMERA</label><select class="hin" data-k="${i}" data-f="depthsrc">${opt(dOpts, sv)}</select>`
      if (usesKinect(L)) {
        const kt = window.HVFT_KINECT_TILT != null ? window.HVFT_KINECT_TILT : 0
        h += `<label>KINECT</label><div class="aistat kstat">${esc(window.HVFT_KINECT_STATE || '—')}</div>
          <div class="kgrid k2"><div><span class="klab">TILT</span><input class="hop" data-w="seg" data-wunit="°" data-k="${i}" data-f="ktilt" type="range" min="-27" max="27" value="${kt}"></div>
          <button class="kbtn ${window.HVFT_KINECT_FULL ? 'on' : ''}" data-k="${i}" data-f="kfull">${window.HVFT_KINECT_FULL ? '640×480 FULL' : '320×240 FAST'}</button></div>
          <div class="kgrid k2"><button class="kbtn ${(window.HVFT_PC_OPT || {}).kMirror ? 'on' : ''}" data-k="${i}" data-f="pcfx" data-p="kMirror">MIRROR ↔</button>${L.src === 'pc3d' ? `<button class="kbtn ${(window.HVFT_PC_OPT || {}).flipY ? 'on' : ''}" data-k="${i}" data-f="pcfx" data-p="flipY">FLIP ↕</button>` : ''}</div>
          <div class="hdim">MIRROR off = true camera view (text reads correctly). Turn it on for a selfie-style mirror. FLIP turns the 3D cloud upside down.</div>
          <div class="hdim">Real depth in metres — set NEAR / FAR in DEPTH / BG CUT to cut the background. Range ≈ 0.5–4.5 m. Close freenect-glview first.</div>`
        if (L.src === 'kinect') {
          const LK = window.HVFT_DEPTH_LOOK || 'depth'
          const LOOKS = [['depth', 'DEPTH'], ['key', 'DEPTH KEY'], ['ir', 'IR NOISE'], ['contour', 'CONTOUR'], ['thermal', 'THERMAL'], ['plexus', 'PLEXUS']]
          h += `<label>KINECT LOOK</label><div class="kgrid k3">${LOOKS.map(([v, n]) => `<button class="kbtn ${LK === v ? 'on' : ''}" data-k="${i}" data-f="klook" data-v="${v}">${n}</button>`).join('')}</div>
          <div class="kgrid k2"><button class="kbtn ${window.HVFT_KINECT_IR ? 'on' : ''}" data-k="${i}" data-f="kir">IR CAMERA ${window.HVFT_KINECT_IR ? 'ON' : 'OFF'}</button><span class="hdim">IR = sees in total darkness (grey picture). DEPTH KEY uses it on a dark stage.</span></div>
          <div class="hdim">${({ depth: 'Depth as light: near = bright.', key: 'Your camera picture cut out by real depth (no AI) — clean edge, brightened automatically. Effects + BG PATTERN fill behind you.', ir: 'Raw infrared laser speckle as a harsh texture. LOW = gain, HIGH = xerox threshold, hit = negative flash.', contour: 'Body as stacked ridge lines. LOW = taller ridges, HIGH = jitter, hit = thicker lines.', thermal: 'HVFT heat map of depth.', plexus: 'Points + lines web from depth.' })[LK] || ''}</div>`
        }
      }
      if (L.src === 'pc3d') {
        const O = window.HVFT_PC_OPT || {}
        const PC_FX = [['glitch', 'GLITCH'], ['wave', 'WAVE'], ['disperse', 'DISPERSE'], ['mesh', 'MESH'], ['voxel', 'VOXEL'], ['ortho', 'ORTHO'], ['spin', 'AUTO-ORBIT']]
        const cur = O.style || 'classic'
        const ST = [['classic', 'CLASSIC'], ['precise', 'PRECISE'], ['scan', 'LIDAR SCAN'], ['volume', 'VOLUME SCAN'], ['spectral', 'SPECTRAL'], ['hyper4d', '4D']]
        const flag = ([p, n]) => `<button class="kbtn ${O[p] !== false ? 'on' : ''}" data-k="${i}" data-f="pcflag" data-p="${p}">${n}</button>`
        const orbit = `<button class="kbtn ${O.spin ? 'on' : ''}" data-k="${i}" data-f="pcfx" data-p="spin">ORBIT</button>`
        h += `<label>3D STYLE · drag preview = orbit</label><div class="kgrid">${ST.map(([v, n]) => `<button class="kbtn ${cur === v ? 'on' : ''}" data-k="${i}" data-f="pcstyle" data-v="${v}">${n}</button>`).join('')}</div>`
        if (L.depthIn === 'kinect') h += `<div class="kgrid k2"><button class="kbtn ${O.clean !== false ? 'on' : ''}" data-k="${i}" data-f="pcflag" data-p="clean">CLEAN DEPTH</button><span class="hdim">Removes Kinect shimmer, flying edge pixels and speckle holes. 640×480 FULL = every point.</span></div>`
        if (cur === 'precise') {
          const fx2 = ([p, n]) => `<button class="kbtn ${O[p] ? 'on' : ''}" data-k="${i}" data-f="pcfx" data-p="${p}">${n}</button>`
          h += `<div class="kgrid">${flag(['preEdge', 'OUTLINE'])}${flag(['preScan', 'SCAN LINE'])}${fx2(['preRgb', 'CAM COLOUR'])}${orbit}</div>
            <div class="kv3"><div><span class="klab">DOT SIZE</span><input class="hop" data-w="seg" data-k="${i}" data-f="pcpre" data-p="preGap" type="range" min="35" max="110" value="${Math.round((O.preGap != null ? O.preGap : 0.72) * 100)}"></div>
            <div><span class="klab">LIGHT</span><input class="hop" data-w="seg" data-k="${i}" data-f="pcpre" data-p="preShade" type="range" min="0" max="100" value="${Math.round((O.preShade != null ? O.preShade : 0.75) * 100)}"></div></div>
            <div class="hdim">Clear, tidy cloud: one dot per Kinect pixel on an exact grid (no shimmer), near hides far, studio light shows the 3D form, bright outline on the silhouette. DOT SIZE 100+ = closed surface, lower = neat dotted grid. CAM COLOUR = Kinect camera picture. Use 640×480 FULL for the most detail.</div>`
        } else if (cur === 'scan') {
          const LKS = [['room', 'ROOM'], ['cave', 'CAVE'], ['hvft', 'HVFT'], ['mono', 'MONO']], lk = O.scanLook || 'room'
          h += `<label>SCAN LOOK</label><div class="kgrid k4">${LKS.map(([v, n]) => `<button class="kbtn ${lk === v ? 'on' : ''}" data-k="${i}" data-f="pcscanlook" data-v="${v}">${n}</button>`).join('')}</div>
            <div class="kgrid">${[['scanAtmo', 'DUST'], ['bokeh', 'BOKEH'], ['spray', 'SPRAY'], ['sway', 'DRIFT']].map(flag).join('')}${orbit}</div>
            <div class="kv3"><div><span class="klab">TRAIL</span><input class="hop" data-w="seg" data-k="${i}" data-f="pcscantrail" type="range" min="0" max="90" value="${Math.round((O.scanTrail != null ? O.scanTrail : 0.6) * 100)}"></div>
            <div><span class="klab">ROOM</span><input class="hop" data-w="seg" data-k="${i}" data-f="pcscanroom" type="range" min="0" max="150" value="${Math.round((O.scanRoom != null ? O.scanRoom : 1) * 100)}"></div>
            <div><span class="klab">DETAIL</span><input class="hop" data-w="seg" data-k="${i}" data-f="pcscandetail" type="range" min="0" max="100" value="${Math.round((O.scanDetail != null ? O.scanDetail : 0.6) * 100)}"></div></div>
            <div class="kgrid k2"><button class="kbtn" data-k="${i}" data-f="pcscanreset">RESET ROOM</button><span class="hdim">More DETAIL = more grains per point (auto-limited so it stays smooth). Use 640×480 FULL for the finest detail.</span></div>
            <div class="hdim">Kinect as a LiDAR scanner: the room is remembered as fine dust with glowing edges (stays visible behind you), people become bright particle ghosts that shed spray onto the floor, dust clouds + bokeh float in the space. Start with the stage EMPTY (or step out and press RESET ROOM) so the Kinect learns the room. ROOM = warm room + white ghosts, CAVE = all teal.</div>`
        } else if (cur === 'hyper4d') {
          const M4 = [['hyper', 'HYPER ROTATE'], ['echo', 'TIME ECHO'], ['slice', 'TIME SLICE'], ['world', 'WORLDLINE']], m4 = O.h4mode || 'hyper'
          h += `<label>4D EFFECT</label><div class="kgrid">${M4.map(([v, n]) => `<button class="kbtn ${m4 === v ? 'on' : ''}" data-k="${i}" data-f="pc4d" data-v="${v}">${n}</button>`).join('')}</div>
            <div class="kgrid">${m4 === 'hyper' ? flag(['tess', 'TESSERACT']) : ''}${orbit}</div>
            <div><span class="klab">4D AMOUNT</span><input class="hop" data-w="seg" data-k="${i}" data-f="pc4amt" type="range" min="0" max="100" value="${Math.round((O.h4amt != null ? O.h4amt : 0.6) * 100)}"></div>
            <div><span class="klab">BODY DEPTH</span><input class="hop" data-w="seg" data-k="${i}" data-f="pcbody" type="range" min="10" max="90" value="${Math.round((O.bodyRange != null ? O.bodyRange : 0.25) * 100)}"></div>
            <div class="hdim">${({ hyper: 'The body is rotated through a 4th axis (XW / YW / ZW) and projected back to 3D; moving parts reach further into 4D. A tesseract cage spins in 4D. The noise drives how far and how fast it turns; silence = it settles back to your body.', echo: 'Past moments trail behind you along a time axis and fade (red = older). LOW = longer trail, MID = tighter spacing, bursts flip the direction.', slice: 'Slit-scan through time: every band of your body comes from a different moment (rows / columns / depth / rings). The time wave scrolls with the noise; bursts sometimes change the axis.', world: 'Every moving point leaves its path through the last frames as a 4D streak. LOW = longer streaks, HIGH = they shiver.' })[m4]}</div>`
        } else if (cur === 'volume') {
          h += `<div class="kgrid">${[['volBox', 'BOX'], ['volScan', 'SCAN'], ['dust', 'DUST'], ['sway', 'SWAY']].map(flag).join('')}${orbit}</div>
            <div class="hdim">Layered depth cloud · wireframe volume · scan plane sweeps near→far · bass lights the cyan surfaces, beats shift the slabs.</div>`
        } else if (cur === 'spectral') {
          h += `<div class="kgrid">${[['smoke', 'SMOKE'], ['dust', 'DUST'], ['stars', 'STARS'], ['sway', 'SWAY']].map(flag).join('')}${orbit}</div>
            <div><span class="klab">BODY DEPTH</span><input class="hop" data-w="seg" data-k="${i}" data-f="pcbody" type="range" min="10" max="90" value="${Math.round((O.bodyRange != null ? O.bodyRange : 0.25) * 100)}"></div>
            <div class="hdim">Nearest body becomes a particle ghost · silhouette glows · beats make it shed dust · teal smoke drifts around it.</div>`
        } else {
          h += `<label>3D CLOUD FX</label><div class="kgrid">${PC_FX.map(([p, n]) => `<button class="kbtn ${O[p] ? 'on' : ''}" data-k="${i}" data-f="pcfx" data-p="${p}">${n}</button>`).join('')}</div>`
        }
      }
      h += `<div class="kgrid k2"><button class="kbtn" data-open="lidar">DEPTH / BG CUT ▸</button><button class="kbtn" data-open="pc3d">PC-3D CLOUD ▸</button></div>`
      return h
    }
    if (L.role === 'media') {
      if (L.src === 'text') {
        const tc = L.textCfg || {}
        const chk = (typeof HVFT_FONTS !== 'undefined') ? HVFT_FONTS.map((ff, fi) => `<button class="fchk ${(tc.fonts && tc.fonts.indexOf(fi) >= 0) ? 'on' : ''}" data-k="${i}" data-f="fontpick" data-fi="${fi}">${esc(String(ff).split("'")[1] || ('F' + fi))}</button>`).join('') : ''
        return `<label>TEXT</label><textarea class="hin htx" data-k="${i}" data-f="txt" rows="2" placeholder="type text… (Enter = new line)">${esc(tc.str || '')}</textarea>
          <label>STYLE</label><div class="kgrid k4">${TXTMODES.map(([v, n]) => `<button class="kbtn ${(tc.mode || 'random') === v ? 'on' : ''}" data-k="${i}" data-f="txtmodek" data-v="${v}">${n.toUpperCase()}</button>`).join('')}</div>
          <div class="kv3">
            <div><span class="klab">SIZE</span><input class="hop" data-w="seg" data-k="${i}" data-f="txtsize" type="range" min="6" max="40" value="${Math.round((tc.size != null ? tc.size : 0.16) * 100)}"></div>
            <div><span class="klab">LETTER SPACING</span><input class="hop" data-w="seg" data-k="${i}" data-f="txtletter" type="range" min="0" max="60" value="${Math.round((tc.letter || 0) * 100)}"></div>
            <div><span class="klab">BEAT REACT</span><input class="hop" data-w="seg" data-k="${i}" data-f="txtreact" type="range" min="0" max="250" value="${Math.round((tc.react != null ? tc.react : 1) * 100)}"></div>
          </div>
          <label>ORIENTATION</label><div class="kgrid k3">
            <button class="kbtn ${tc.orient === 'v' ? '' : 'on'}" data-k="${i}" data-f="txtorient" data-v="h">HORIZONTAL</button>
            <button class="kbtn ${tc.orient === 'v' ? 'on' : ''}" data-k="${i}" data-f="txtorient" data-v="v">VERTICAL</button>
            <button class="kbtn ${tc.oneFont ? 'on' : ''}" data-k="${i}" data-f="txtone">1 FONT / LINE</button></div>
          <label>FONTS (tick · none = all random)</label><div class="fonts">${chk}</div>`
      }
      const fn = L.url ? L.url.split('/').pop().slice(0, 28) : 'drag an image or video here'
      return `<label>MEDIA FILE</label><div class="hdrop" data-k="${i}">▣ ${esc(fn)}</div><div class="hdim">PNG / JPG / MP4 / MOV / WEBM — dropping a file turns the channel ON.</div>`
    }
    // ai
    if (aiMode() === 'sd') return sdPanel(L, i)
    const box = aiBox(L)
    const btns = box ? [...box.querySelectorAll('button')] : []
    const isGan = false   // Oct 12: Anime GAN removed (Reza)
    let h = `<label>SOURCE CAMERA</label><select class="hin" data-k="${i}" data-f="aicam">${opt(camOpts(L.net), L.net ? ('net:' + L.net) : ('cam#' + (L.camIdx | 0)))}</select>`
    // mode-specific live controls (were only in SETTINGS)
    const pbtns = (id) => { const bx = document.getElementById(id); return bx ? [...bx.querySelectorAll('button')] : [] }
    const proxRow = (id, lab, k) => { const bs = pbtns(id); return bs.length ? `<label>${lab}</label><div class="kgrid ${k}">${bs.map((b, bi) => `<button class="kbtn ${b.classList.contains('on') ? 'on' : ''}" data-proxybtn="${id}" data-idx="${bi}">${esc(b.textContent.trim().slice(0, 16))}</button>`).join('')}</div>` : '' }
    if (isGan) h += proxRow('ganRes', 'QUALITY', 'k3') + proxRow('ganLook', 'LOOK', 'k3')
    else {
      const prov = (pbtns('aiProv').find(b => b.classList.contains('on')) || {}).dataset || {}
      // Oct 12 (Reza: "parameter API dll langsung di sini, ga perlu ke SETTINGS"): everything a mode needs is here
      const val = (id) => { const e = document.getElementById(id); return e ? e.value : '' }
      if (prov.p === 'gemini') {
        const ms = document.getElementById('aiModel')
        const mopts = ms ? [...ms.options].map(o => `<option value="${esc(o.value)}"${o.value === ms.value ? ' selected' : ''}>${esc(o.textContent)}</option>`).join('') : ''
        h += `<label>GEMINI API KEY</label><input class="hin" type="password" data-proxyval="aiKey" value="${esc(val('aiKey'))}" placeholder="paste your key (stored on this computer only)" autocomplete="off" style="width:100%;box-sizing:border-box">`
        if (!val('aiKey')) h += `<div class="hdim" style="color:#e2553c">No key yet — paste it above (aistudio.google.com › API keys).</div>`
        h += `<label>MODEL</label><select class="hin" data-proxysel="aiModel">${mopts}</select>`
        h += `<label>PROMPT</label><textarea class="hin" data-proxytext="aiPrompt" rows="2" style="width:100%;box-sizing:border-box;resize:vertical">${esc(val('aiPrompt'))}</textarea>` + proxRow('aiPresets', 'STYLE PRESETS', 'k3')
        h += `<label>STYLE REFERENCE IMAGE (optional)</label><div class="aidrop" data-proxydrop="aiGemRef">${esc((document.getElementById('aiGemRef') || {}).textContent || 'drop / click a style image')}</div>`
      } else if (prov.p === 'ref') {
        h += `<label>STYLE IMAGE</label><div class="aidrop" data-proxydrop="aiRefDrop">${esc((document.getElementById('aiRefDrop') || {}).textContent || 'drop / click a style image')}</div>`
        h += `<label>STYLE STRENGTH</label><div class="psrow"><input data-w="seg" data-wunit="%" data-proxy="aiRefS" type="range" min="10" max="100" value="${proxyVal('aiRefS', 100)}"><span class="segv"></span></div>`
        h += proxRow('aiChars', 'BECOME CHARACTER', 'k4')
      }
    }
    const sb = document.getElementById(isGan ? 'ganStart' : 'aiStart'), run = !!(sb && sb.classList.contains('on'))
    h += `<div class="kgrid k2"><button class="kbtn ${run ? 'on' : 'go'}" data-proxyclick="${isGan ? 'ganStart' : 'aiStart'}">${run ? '■ STOP' : '▶ START'}</button><button class="kbtn" data-proxyclick="${isGan ? 'ganOnce' : 'aiOnce'}">REFRESH ONCE</button></div>`
    h += `<div class="aistat" data-src="${isGan ? 'ganStat' : 'aiStat'}">—</div>`
    // Oct 12 ("ringkas bener"): the AI fine-tune lives here too (ADVANCED only) — SETTINGS no longer has AI sections
    if (ADV() && !isGan) {
      const prov = (pbtns('aiProv').find(b => b.classList.contains('on')) || {}).dataset || {}
      const val = (id) => { const e = document.getElementById(id); return e ? e.value : '' }
      const kn = (id, lab, show) => { const e = document.getElementById(id); if (!e) return ''; return `<div class="isfcell"><span class="klab">${lab}</span><input class="hop" data-w="gauge" data-wpx="46" ${show ? 'data-wshow="raw"' : ''} data-proxy="${id}" type="range" min="${e.min}" max="${e.max}" step="${e.step || 1}" value="${e.value}"></div>` }
      if (prov.p === 'gemini') h += `<label>FINE TUNE</label><div class="isfgrid">${kn('aiPar', 'PARALLEL', 1)}${kn('aiIv', 'MIN GAP s', 1)}</div>`
    }
    return h
  }
  // PARAMETER blocks can be minimized. Default: with several effects (RANDOM ×n) only the LIVE one is open;
  // a click on the effect header overrides and is remembered per channel (L.pcol).
  function pxCollapsed (L, fx, list) {
    const o = L.pcol && L.pcol[fx]
    if (o != null) return o
    return list.length > 1 && fx !== L.effect
  }
  // Inspector panels (SOURCE, PARAMETERS, STROBE, COLOR, CROP, BG…) collapse by clicking their title bar.
  let PANCOL = new Set()
  try { PANCOL = new Set(JSON.parse(localStorage.getItem('hvft_panels_col') || '[]')) } catch (e) {}
  const panKey = (sec) => { const t = sec.querySelector('.iph'); return t ? (t.firstChild && t.firstChild.nodeType === 3 ? t.firstChild.textContent : t.textContent).replace(/[▸▾]/g, '').trim().split(/\s+/)[0] : '' }
  function applyPanelCollapse (root) {
    root.querySelectorAll('section.ipanel').forEach(sec => {
      const k = panKey(sec); if (!k) return
      const col = PANCOL.has(k), t = sec.querySelector('.iph')
      sec.classList.toggle('pcol', col)
      if (t && t.firstChild && t.firstChild.nodeType === 3) t.firstChild.textContent = t.firstChild.textContent.replace(/^\s*[▸▾]/, col ? '▸' : '▾')
      if (t && !t._colWired) {
        t._colWired = true
        t.addEventListener('click', e => {
          if (e.target.closest('button,input,select,textarea,a')) return
          if (PANCOL.has(k)) PANCOL.delete(k); else PANCOL.add(k)
          try { localStorage.setItem('hvft_panels_col', JSON.stringify([...PANCOL])) } catch (er) {}
          applyPanelCollapse(root)
        })
      }
    })
  }
  function paramCells (L, i) {
    if (typeof HVFT_FX_PARAMS === 'undefined') return ''
    const list = curFx(L)
    if (L.role === 'ai' || (L.role === 'media' && L.src !== 'text') || (L.role === 'depth' && L.src === 'pc3d')) return '<div class="insEmpty">— NO PARAMETRIC FX ON THIS SOURCE —</div>'
    if (!list.length) return '<div class="insEmpty">— NO EFFECT · use EFFECT ◂ ▸ on the card —</div>'
    const aud = audible(L), mic = micLive()
    let h = ''
    if (list.length > 1) h += `<div class="pxall"><button class="kbtn" data-k="${i}" data-f="pxall" data-v="1">▸ COLLAPSE ALL</button><button class="kbtn" data-k="${i}" data-f="pxall" data-v="0">▾ EXPAND ALL</button></div>`
    list.forEach(fx => {
      const defs = HVFT_FX_PARAMS[fx]; if (!defs || !defs.length) return
      const PV = (L.fxParams && L.fxParams[fx]) || {}
      const nLink = defs.filter(([k]) => { const lk = L.fxLinks && L.fxLinks[fx + '.' + k]; return lk && lk.band && lk.band !== 'off' }).length
      const live = (fx === L.effect)
      if (pxCollapsed(L, fx, list)) {   // minimized: one compact row with every value, linked ones in orange
        const chips = defs.map(([k, nm, dv]) => { const v = (typeof PV[k] === 'number') ? PV[k] : dv; const lk = L.fxLinks && L.fxLinks[fx + '.' + k]; const on = lk && lk.band && lk.band !== 'off'; return `<span class="pxchip ${on ? 'lk' : ''}">${esc(nm)} <b>${Math.round(v * 100)}</b>${on ? ' ' + BANDLET[lk.band] : ''}</span>` }).join('')
        h += `<div class="pxblk col"><button class="pxhd" data-k="${i}" data-fx="${fx}" data-f="pxtog"><i>▸</i>${esc(String(EFFLABEL[fx] || fx).toUpperCase())}${live ? '<em>● LIVE</em>' : ''}<span>${defs.length} PARAM${nLink ? ' · ◎ ' + nLink : ''}</span></button><div class="pxsum">${chips}</div></div>`
        return
      }
      let gauges = '', segs = ''
      defs.forEach(([k, nm, dv], pi) => {
        const v = (typeof PV[k] === 'number') ? PV[k] : dv
        const lk = (L.fxLinks && L.fxLinks[fx + '.' + k]) || { band: 'off', amt: 0.5 }
        const band = (lk.band && lk.band !== 'off') ? lk.band : ''
        const amt = (lk.amt != null ? lk.amt : 0.5)
        const tone = aud ? '' : 'mono'
        const stat = band ? (mic ? `◎ REACTIVE · ${BANDNAME[band]}` : `⊘ NO SIGNAL · ${BANDLET[band]}`) : '○ MANUAL'
        const lmh = LINKB.map(b => `<button class="lbtn ${band === b ? 'on' : ''}" data-k="${i}" data-fx="${fx}" data-p="${k}" data-band="${b}">${BANDLET[b]}</button>`).join('')
        const amtG = `<input class="pxa" data-w="gauge" data-wpx="34" data-wshow="raw" ${band ? '' : 'data-tone="inert"'} data-k="${i}" data-fx="${fx}" data-p="${k}" type="range" min="-100" max="100" value="${Math.round(amt * 100)}">`
        const valIn = (kind, px) => `<input class="pxv" data-w="${kind}" ${px ? `data-wpx="${px}"` : ''} data-wlab="${kind === 'gauge' ? '%' : ''}" ${tone ? `data-tone="${tone}"` : ''} data-band="${band || 'off'}" data-amt="${amt}" data-k="${i}" data-fx="${fx}" data-p="${k}" type="range" min="0" max="100" value="${Math.round(v * 100)}">`
        if (pi < 3) {
          gauges += `<div class="pcell pg ${band ? 'linked' : ''} ${band && mic ? 'react' : ''}">
            <div class="phd">${RET}<span class="pname">${esc(nm)}</span></div>
            ${valIn('gauge', 112)}
            <div class="pstat" data-band="${band || 'off'}">${stat}</div>
            <div class="plink">${lmh}${amtG}</div></div>`
        } else {
          segs += `<div class="pcell ps ${band ? 'linked' : ''} ${band && mic ? 'react' : ''}">
            <div class="phd">${RET}<span class="pname">${esc(nm)}</span><span class="pstat" data-band="${band || 'off'}">${stat}</span><span class="plink">${lmh}${amtG}</span></div>
            <div class="psrow">${valIn('seg')}<span class="segv"></span></div></div>`
        }
      })
      h += `<div class="pxblk"><button class="pxhd" data-k="${i}" data-fx="${fx}" data-f="pxtog"><i>▾</i>${esc(String(EFFLABEL[fx] || fx).toUpperCase())}${live ? '<em>● LIVE</em>' : ''}<span>${defs.length} PARAM${nLink ? ' · ◎ ' + nLink : ''}</span></button><div class="pgrid">${gauges}</div>${segs}</div>`
    })
    h += '<div class="plegend"><span class="acc">◎ REACTIVE</span> · <span>⊘ NO SIGNAL</span> · <span>○ MANUAL</span><br>DRAG ↕ DIAL · DRAG ↔ METER · L / M / H = AUDIO BAND · SMALL DIAL = DEPTH</div>'
    return h
  }
  // ISF SHADER FX (isf_fx.js): GPU shader on top of the channel, its inputs as sliders + noise links
  function isfPanel (L, i) {
    const X = window.HVFT_ISF; if (!X) return ''
    const cfg = L.isf || {}, cur = cfg.id || 'none', meta = X.byId(cur)
    const cats = {}; X.list.forEach(e => { (cats[e.cat] = cats[e.cat] || []).push(e) })
    let opts = `<option value="none"${cur === 'none' ? ' selected' : ''}>— none —</option>`
    for (const c in cats) opts += `<optgroup label="${c}">` + cats[c].map(e => `<option value="${e.id}"${e.id === cur ? ' selected' : ''}>${esc(e.name)}</option>`).join('') + '</optgroup>'
    let h = `<section class="ipanel"><div class="iph">▸ ISF SHADER FX <span>${meta ? esc(meta.name) : '—'}</span><span class="acc">${X.list.length} SHADERS</span></div>
      <div class="kgrid k2"><select class="hin" data-k="${i}" data-f="isfid">${opts}</select>
      <div><span class="klab">MIX</span><input class="hop" data-w="seg" data-wunit="%" data-k="${i}" data-f="isfmix" type="range" min="0" max="100" value="${Math.round((cfg.mix != null ? cfg.mix : 1) * 100)}"></div></div>`
    if (meta && ADV()) {
      const V = cfg.v || {}, LK = cfg.link || {}
      // Oct 12 (Reza: "knob, bukan slider — hemat tempat"): one compact cell per input, 3 per row
      // value = knob · under it: band button (tap cycles — L M H N P S) + small knob = how hard the noise pushes
      h += '<div class="isfgrid">'
      for (const d of X.inputs(cur)) {
        const n = d.NAME, full = String(d.LABEL || n).toUpperCase(), lab = esc(full), lk = LK[n] || { band: 'off', amt: 0.5 }
        const on = lk.band && lk.band !== 'off'
        const mod = `<div class="isfmod"><button class="lbtn isfcyc ${on ? 'on' : ''}" data-k="${i}" data-f="isfcyc" data-p="${esc(n)}" title="noise link — tap: off › L › M › H › N › P › S">${on ? BANDLET[lk.band] : '–'}</button>` +
          `<input class="hop" data-w="gauge" data-wpx="26" data-wshow="raw" ${on ? '' : 'data-tone="inert"'} data-k="${i}" data-f="isfamt" data-p="${esc(n)}" type="range" min="-100" max="100" value="${Math.round((lk.amt != null ? lk.amt : 0.5) * 100)}"></div>`
        let body = ''
        if (d.TYPE === 'float') {
          const v = V[n] != null ? V[n] : X.defNorm(d)
          body = `<input class="hop" data-w="gauge" data-wpx="50" data-k="${i}" data-f="isfv" data-p="${esc(n)}" type="range" min="0" max="100" value="${Math.round(v * 100)}">` + mod
        } else if (d.TYPE === 'bool') {
          const v = V[n] != null ? !!V[n] : !!d.DEFAULT
          body = `<button class="kbtn isfbool ${v ? 'on' : ''}" data-k="${i}" data-f="isfbool" data-p="${esc(n)}">${v ? 'ON' : 'OFF'}</button>` + mod
        } else if (d.TYPE === 'long' && d.VALUES) {
          const v = V[n] != null ? +V[n] : (d.DEFAULT != null ? d.DEFAULT : d.VALUES[0])
          body = `<select class="hin" data-k="${i}" data-f="isflong" data-p="${esc(n)}">${d.VALUES.map((x, j) => `<option value="${x}"${+x === v ? ' selected' : ''}>${esc(String((d.LABELS && d.LABELS[j]) || x))}</option>`).join('')}</select>`
        } else if (d.TYPE === 'event') {
          body = `<div class="isfhit">⚡ HIT</div><span class="hdim">on every noise hit</span>`
        } else continue
        h += `<div class="isfcell" title="${lab}"><span class="klab">${lab}</span>${body}</div>`
      }
      h += '</div>'
    }
    h += ADV() ? `<div class="hdim">GPU shaders in the ISF format (VDMX / Resolume / MadMapper) on top of this channel. L M H = bands, N = noisiness, P = peaks / feedback tones, S = sharpness — the knob next to them sets how hard the noise pushes. Big knob = value · button under it = noise band (tap to cycle, – = off) · small knob = how hard. Mic OFF = no reaction.</div></section>` : `<div class="hdim">Pick a shader — it follows the noise by itself (LOW). MIX = how much of it.</div></section>`
    return h
  }
  function effectPool (L, i) {
    const list = stepList(L); if (!list) return ''
    const src = (L.role === 'cam' ? EFX_PERSON : EFX_ENV).filter(([v]) => v !== 'none')
    return `<section class="ipanel"><div class="iph">▸ EFFECT POOL <span>pick 2+ = random rotation</span></div><div class="kgrid k3">${src.map(([v, n]) => `<button class="kbtn efb ${(L.effects && L.effects.indexOf(v) >= 0) ? 'on' : ''}" data-k="${i}" data-e="${v}">${n.toUpperCase()}</button>`).join('')}</div></section>`
  }
  function strobePanel (L, i) {
    if (!ADV()) return strobeSimple(L, i)
    const G = L.strobe || (L.strobe = mkStrobe())
    const tone = G.on ? '' : 'inert'
    const per = Math.round(1000 / hzOf(G.rate))
    return `<section class="ipanel strobe ${G.on ? 'armed' : ''}"><div class="iph">▸ STROBE / FLICKER <span class="danger">DANGER</span><button class="gxon ${G.on ? 'on' : ''}" data-k="${i}" data-f="gon">${G.on ? 'ARMED' : 'SAFE'}</button></div>
      <div class="sgrid">
        <div class="sgL"><input class="pxv" data-w="gauge" data-wpx="136" data-wshow="hz" data-wlab="HZ · FREQ" ${tone ? `data-tone="${tone}"` : ''} data-k="${i}" data-f="grate" type="range" min="0" max="100" value="${Math.round(G.rate * 100)}"></div>
        <div class="sgR">
          <div class="kgrid k2">${GMODES.map(([v, n]) => `<button class="kbtn ${(G.mode || 'strobe') === v ? 'on' : ''}" data-k="${i}" data-f="gmodek" data-v="${v}">${n}</button>`).join('')}</div>
          <div class="kv"><span>PERIOD</span><b class="gperiod">${per} ms</b></div>
          <div class="kv"><span>RANGE</span><b>0.5–30 HZ</b></div>
        </div>
      </div>
      <div class="kv3">
        <div><span class="klab">DUTY</span><div class="psrow"><input class="pxv" data-w="seg" data-wunit="%" ${tone ? `data-tone="${tone}"` : ''} data-k="${i}" data-f="gduty" type="range" min="4" max="96" value="${Math.round(G.duty * 100)}"><span class="segv"></span></div></div>
        <div><span class="klab">DEPTH</span><div class="psrow"><input class="pxv" data-w="seg" data-wunit="%" ${tone ? `data-tone="${tone}"` : ''} data-k="${i}" data-f="gdepth" type="range" min="0" max="100" value="${Math.round(G.depth * 100)}"><span class="segv"></span></div></div>
        <div><span class="klab">FOLLOW AUDIO</span><div class="plink">${LINKB.map(b => `<button class="lbtn ${G.band === b ? 'on' : ''}" data-k="${i}" data-f="gband" data-band="${b}">${BANDLET[b]}</button>`).join('')}<input class="pxa" data-w="gauge" data-wpx="34" data-wshow="raw" ${(G.band && G.band !== 'off') ? '' : 'data-tone="inert"'} data-k="${i}" data-f="gamt" type="range" min="-100" max="100" value="${Math.round((G.amt != null ? G.amt : 0.5) * 100)}"></div></div>
      </div>
      <div class="kgrid k2"><button class="kbtn ${G.invert ? 'on' : ''}" data-k="${i}" data-f="ginv">INVERT</button><button class="kbtn ${G.white ? 'on' : ''}" data-k="${i}" data-f="gwhite">WHITE FLASH</button></div>
      <div class="hazard">⚠ PHOTOSENSITIVE OUTPUT</div></section>`
  }
  function proxyVal (id, d) { const t = document.getElementById(id); return t ? +t.value : d }
  // ===== SIMPLE vs ADVANCED (Oct 12) — panels ask "WHICH?", not "HOW MUCH?". Fixed best values in SIMPLE;
  // SETTINGS › ADVANCED shows every slider again (window.HVFT_ADV, localStorage hvft.advanced). =====
  try { window.HVFT_ADV = localStorage.getItem('hvft.advanced') === '1' } catch (e) { window.HVFT_ADV = false }
  const ADV = () => window.HVFT_ADV === true
  const STROBE_PRESETS = { slow: { rate: 0.25, duty: 0.5, depth: 1, band: 'off', amt: 0.5, mode: 'strobe' }, audio: { rate: 0.22, duty: 0.45, depth: 1, band: 'low', amt: 0.8, mode: 'strobe' }, fast: { rate: 0.72, duty: 0.35, depth: 1, band: 'off', amt: 0.5, mode: 'strobe' } }
  function strobePresetOf (G) { for (const k in STROBE_PRESETS) { const P = STROBE_PRESETS[k]; if (Math.abs((G.rate || 0) - P.rate) < 0.01 && (G.band || 'off') === P.band) return k } return '' }
  function strobeSimple (L, i) {
    const G = L.strobe || (L.strobe = mkStrobe()), cur = strobePresetOf(G)
    return `<section class="ipanel strobe ${G.on ? 'armed' : ''}"><div class="iph">▸ STROBE <span class="danger">DANGER</span><button class="gxon ${G.on ? 'on' : ''}" data-k="${i}" data-f="gon">${G.on ? 'ARMED' : 'SAFE'}</button></div>
      <div class="kgrid k3">${[['slow', 'SLOW'], ['audio', 'FOLLOW NOISE'], ['fast', 'FAST']].map(([v, n]) => `<button class="kbtn ${cur === v ? 'on' : ''}" data-k="${i}" data-f="gpreset" data-v="${v}">${n}</button>`).join('')}</div>
      <div class="kgrid k2"><button class="kbtn ${G.white ? 'on' : ''}" data-k="${i}" data-f="gwhite">WHITE FLASH</button><button class="kbtn ${G.invert ? 'on' : ''}" data-k="${i}" data-f="ginv">INVERT</button></div>
      <div class="hazard">⚠ PHOTOSENSITIVE OUTPUT</div></section>`
  }
  function cropSimple (L, i) {
    const camCh = (L.role === 'cam' || L.role === 'depth')
    return `<section class="ipanel"><div class="iph">▸ CUT-OUT <span>subject only</span></div>
      ${camCh ? `<div class="kgrid k1"><button class="kbtn ${L.crop ? 'on' : ''}" data-k="${i}" data-f="crop">CROP · TRANSPARENT BG</button></div><div class="hdim">ON = only the person stays; the channels below show around them (BG PATTERN of this channel pauses). Edges, flicker and clean-up are set automatically.</div>` : '<div class="hdim">CROP applies to camera / depth channels.</div>'}</section>`
  }
  function cropPanel (L, i) {
    if (L.role === 'media') return ''   // Oct 12: CUT-OUT only exists for camera / depth channels — hidden on TEXT / MEDIA
    if (!ADV()) return cropSimple(L, i)
    const camCh = (L.role === 'cam' || L.role === 'depth')
    const clean = document.getElementById('mclean'); const cOn = clean ? clean.classList.contains('on') : false
    return `<section class="ipanel"><div class="iph">▸ CROP / MATTE <span>subject cut-out</span></div>
      ${camCh ? `<div class="kgrid k1"><button class="kbtn ${L.crop ? 'on' : ''}" data-k="${i}" data-f="crop">CROP · TRANSPARENT BG</button></div>` : '<div class="hdim">CROP applies to camera / depth channels.</div>'}
      <div class="kv3">
        <div><span class="klab">FEATHER</span><div class="psrow"><input data-w="seg" data-wunit="%" data-proxy="mfeat" type="range" min="0" max="100" value="${proxyVal('mfeat', 32)}"><span class="segv"></span></div></div>
        <div><span class="klab">STABILIZE</span><div class="psrow"><input data-w="seg" data-wunit="%" data-proxy="mstab" type="range" min="0" max="100" value="${proxyVal('mstab', 45)}"><span class="segv"></span></div></div>
        <div><span class="klab">EXPAND</span><div class="psrow"><input data-w="seg" data-wunit="%" data-proxy="mexp" type="range" min="0" max="100" value="${proxyVal('mexp', 50)}"><span class="segv"></span></div></div>
      </div>
      <div class="kgrid k1"><button class="kbtn ${cOn ? 'on' : ''}" data-proxyclick="mclean" data-rerender="1">CLEAN · FILL HOLES + REMOVE SPECKS</button></div>
      <label>CUT-OUT MODEL</label><div class="kgrid k2">${[['mp', 'MEDIAPIPE · FAST'], ['rvm', 'RVM · SOFT EDGES']].map(([v, n]) => `<button class="kbtn ${((typeof pipe !== 'undefined' && pipe.settings && pipe.settings.matteModel === 'rvm') ? 'rvm' : 'mp') === v ? 'on' : ''}" data-f="mattemodel" data-v="${v}">${n}</button>`).join('')}</div>
      <div class="hdim">RVM (Robust Video Matting) = a video-matting AI with memory: hair and fingers stay soft and the cut-out does not flicker. Heavier on the GPU than MediaPipe; MediaPipe keeps cutting until RVM is ready. Only the person channel uses RVM; if it slows the app it switches itself back to MediaPipe.${(window.HVFT_RVM_INFO && window.HVFT_RVM_INFO().off) ? ' <b style="color:#e2553c">RVM OFF: ' + esc(window.HVFT_RVM_INFO().off) + '</b>' : ''}</div>
      <div class="hdim">Matte settings are global (all cut-out layers).</div></section>`
  }
  // per-pattern parameters (written to L.fxParams[pattern] -> pipeline _resolveFxParams)
  function bgParams (L, i, cur) {
    if (['tangle', 'gyro', 'eclipse', 'beam', 'milkdrop'].indexOf(cur) < 0 || typeof HVFT_FX_PARAMS === 'undefined' || !HVFT_FX_PARAMS[cur]) return ''
    const PV = (L.fxParams && L.fxParams[cur]) || {}
    const nx = cur === 'milkdrop' ? `<div class="kgrid k2"><button class="kbtn" data-f="milknext">NEXT PRESET ▸ [P]</button><span class="hdim mkname">${esc((window.HVFT_MILKDROP && window.HVFT_MILKDROP.preset) || '')}</span></div>` : ''
    return nx + `<div class="kgrid k2">${HVFT_FX_PARAMS[cur].map(([k, n, d]) => `<div><span class="klab">${esc(n.toUpperCase())}</span><div class="psrow"><input class="pxv" data-w="seg" data-wunit="%" data-k="${i}" data-fx="${cur}" data-p="${k}" type="range" min="0" max="100" value="${Math.round((PV[k] != null ? PV[k] : d) * 100)}"><span class="segv"></span></div></div>`).join('')}</div>`
  }
  // ---- per-channel COLOR (replaces the global COLOR setting) ----
  const COLORS = [['hvft', 'HVFT'], ['white', 'MONO'], ['blue', 'BLUE'], ['gray', 'GRAY'], ['violet', 'VIOLET'], ['random', 'RANDOM']]
  const COLDESC = { hvft: 'HVFT HOLO — teal-black → ember → HVFT orange → light amber. HOLO FX adds a cyan ghost fringe, fine scanlines and a slow refresh sweep.', white: 'Monochrome white on black.', blue: 'Cold blue tint.', gray: 'Soft grey-blue tint.', violet: 'Deep violet → magenta → amber → white (the burst reference palette).', random: 'Random colour: the hue jumps on every beat. Text: a random colour per letter, re-rolled on every hit.' }
  function colorOf (L) { return L.color || (L.src === 'text' ? 'random' : 'hvft') }
  // a real HUE SLIDER under the palette buttons: click / drag = your own colour ('hue:<deg>'), works for object + background
  const hueOf = (c) => (typeof c === 'string' && c.indexOf('hue:') === 0) ? (+c.slice(4) || 0) : null
  function hueBar (i, f, cur) {
    const h = hueOf(cur)
    return `<div class="huebar" data-k="${i}" data-f="${f}" title="drag = pick your own colour">${h != null ? `<i style="left:${(h / 360 * 100).toFixed(1)}%"></i>` : ''}</div>`
  }
  function colPreview (cur) {
    const h = hueOf(cur)
    return h != null ? `<div class="colbar" style="background:linear-gradient(90deg,#000,hsl(${h},90%,45%),hsl(${h},90%,75%),#fff)"></div>` : `<div class="colbar col-${cur}"></div>`
  }
  function colorPanel (L, i) {
    const cur = colorOf(L), h = hueOf(cur)
    const holo = cur === 'hvft' ? `<div class="kgrid k1"><button class="kbtn ${L.holo !== false ? 'on' : ''}" data-k="${i}" data-f="holo">HOLO FX ${L.holo !== false ? 'ON' : 'OFF'} · fringe · scanlines · sweep</button></div>` : ''
    return `<section class="ipanel"><div class="iph">▸ COLOR <span>this channel</span></div>
      ${(L.role === 'cam' || L.role === 'depth') ? '<div class="klab">OBJECT</div>' : ''}<div class="kgrid k3">${COLORS.map(([v, n]) => `<button class="kbtn ${cur === v ? 'on' : ''}" data-k="${i}" data-f="colkey" data-v="${v}">${n}</button>`).join('')}</div>
      ${colPreview(cur)}<div class="klab">${h != null ? 'CUSTOM HUE · ' + Math.round(h) + '°' : 'CUSTOM HUE · drag the bar'}</div>${hueBar(i, 'colhue', cur)}${holo}
      <div class="hdim">${h != null ? 'Your own colour: dark → the hue → white.' : esc(COLDESC[cur] || '')}</div>${bgColorRow(L, i)}</section>`
  }
  // BACKGROUND colour: the BG PATTERN can have its own colour (camera / depth channels)
  function bgColorRow (L, i) {
    if (!(L.role === 'cam' || L.role === 'depth')) return ''
    const cur = L.bgColor || 'same'
    return `<div class="klab" style="margin-top:8px">BACKGROUND (BG PATTERN)</div>
      <div class="kgrid k3">${[['same', 'SAME']].concat(COLORS).map(([v, n]) => `<button class="kbtn ${cur === v ? 'on' : ''}" data-k="${i}" data-f="bgcolkey" data-v="${v}">${n}</button>`).join('')}</div>
      ${cur === 'same' ? '<div class="hdim">Same colour as the object.</div>' : colPreview(cur)}${hueBar(i, 'bghue', cur)}`
  }
  function bgPanel (L, i) {
    const camCh = (L.role === 'cam' || L.role === 'depth'), medCh = (L.role === 'media')
    if (!camCh && !medCh) return `<section class="ipanel"><div class="iph">▸ BG PATTERN <span>behind subject</span></div><div class="hdim">Background patterns fill the black behind the subject on camera / depth / media-text channels (CH1 · CH2 · CH3).</div></section>`
    const cur = L.bgfx || 'none'
    // CH3 (Oct 9): TEXT = the letters stay in front, the pattern fills the black around them.
    // MEDIA = KEY BRIGHT (dark parts of the clip show the pattern, cheap) or KEY PERSON (AI cut-out of people in the clip)
    const isT = L.src === 'text', km = L.bgKey || 'luma'
    const keyRow = !medCh ? '' : (isT ? '<div class="hdim">TEXT: the letters stay in front, the pattern fills the black around them.</div>'
      : `<div><span class="klab">SUBJECT KEY · WHAT STAYS IN FRONT</span><div class="kgrid k3"><button class="kbtn ${km === 'luma' ? 'on' : ''}" data-k="${i}" data-f="bgkeymode" data-v="luma">KEY BRIGHT</button><button class="kbtn ${km === 'person' ? 'on' : ''}" data-k="${i}" data-f="bgkeymode" data-v="person">KEY PERSON (AI)</button></div>`
        + (km === 'luma' ? `<div class="psrow"><input class="pxv" data-w="seg" data-wunit="%" data-k="${i}" data-f="bgkeylvl" type="range" min="0" max="100" value="${Math.round((L.bgKeyLvl != null ? L.bgKeyLvl : 0.3) * 100)}"><span class="segv"></span></div><div class="hdim">KEY LEVEL: higher = more of the clip turns into pattern (only the brightest parts stay).</div>` : '<div class="hdim">People in the clip stay in front (AI cut-out, heavier).</div>') + '</div>')
    if (!ADV()) {
      return `<section class="ipanel"><div class="iph">▸ BG PATTERN <span>behind subject</span></div>
      <div class="kgrid k3">${BGFX.concat((window.HVFT_BG_EXTRA || []).map(x => [x[0], x[1]])).map(([v, n]) => `<button class="kbtn ${cur === v ? 'on' : ''}" data-k="${i}" data-f="bgkey" data-v="${v}">${n}</button>`).join('')}</div>
      ${cur !== 'none' ? `<div class="hdim">${esc(BGDESC[cur] || ((window.HVFT_BG_EXTRA || []).find(x => x[0] === cur) || [])[2] || '')}</div>` : ''}
      ${cur === 'milkdrop' ? `<div class="kgrid k2"><button class="kbtn" data-f="milknext">NEXT PRESET ▸ [P]</button><span class="hdim mkname">${esc((window.HVFT_MILKDROP && window.HVFT_MILKDROP.preset) || '')}</span></div>` : ''}${keyRow}</section>`
    }
    return `<section class="ipanel"><div class="iph">▸ BG PATTERN <span>behind subject</span></div>
      <div class="kgrid k3">${BGFX.concat((window.HVFT_BG_EXTRA || []).map(x => [x[0], x[1]])).map(([v, n]) => `<button class="kbtn ${cur === v ? 'on' : ''}" data-k="${i}" data-f="bgkey" data-v="${v}">${n}</button>`).join('')}</div>
      <div class="bgrow2">
        <div><input class="pxv" data-w="gauge" data-wpx="118" data-wlab="POWER" data-band="low" data-amt="1" ${cur === 'none' ? 'data-tone="inert"' : ''} data-k="${i}" data-f="bgpow" type="range" min="0" max="100" value="${Math.round((L.bgfxPower != null ? L.bgfxPower : 0.7) * 100)}"></div>
        <div class="bgtxt"><b>LIGHT POWER</b><span>How much the pattern dominates the light when hit by the LOW band.</span><span class="bgdesc">${esc(BGDESC[cur] || ((window.HVFT_BG_EXTRA || []).find(x => x[0] === cur) || [])[2] || '')}</span><div class="swatch sw-${cur}"><span>${cur.toUpperCase()}</span></div></div>
      </div>
      <div><span class="klab">BRUTALITY · LAYERS / RANDOM FREQ</span><div class="psrow"><input class="pxv" data-w="seg" data-wunit="%" data-k="${i}" data-f="bgbrut" type="range" min="0" max="100" value="${Math.round((L.bgBrutal != null ? L.bgBrutal : 0.85) * 100)}"><span class="segv"></span></div></div>
      <div class="hdim">Mic ON: the pattern itself escalates — more layers, each locked to a random frequency band that re-rolls on every beat; dark between hits, full light on the hit. 0% = the original pattern.</div>${keyRow}${bgParams(L, i, cur)}</section>`
  }
  function renderInspector () {
    if (!INS) return
    const L = deck.layers[sel]
    const fxn = fxName(L)
    let h = `<div class="insHead"><div class="itab">▸ INSPECTOR</div><span class="insTag">CH.0${sel + 1}</span><b class="insTitle">${esc(L.name)} ▸ ${esc(srcLabel(L))}${fxn !== '—' ? ' · ' + esc(fxn) : ''}</b><span class="caution">${audible(L) ? 'CAUTION · LIVE FX' : (L.on === false ? 'CHANNEL OFF' : 'NOT AUDIBLE')}</span></div>`
    h += `<div class="insBody"><div class="insColL">`
    h += `<section class="ipanel"><div class="iph">▸ SOURCE <span>${esc(srcLabel(L))}</span></div>${sourceDetail(L, sel)}</section>`
    if (ADV() && L.role !== 'ai') h += `<section class="ipanel"><div class="iph">▸ PARAMETERS <span>${esc(fxn)}</span><span class="acc">◎ AUDIO-LINK ${linkCount(L)}</span></div>${paramCells(L, sel)}</section>`
    h += effectPool(L, sel)
    h += isfPanel(L, sel)
    h += `</div><div class="insColR">`
    h += colorPanel(L, sel) + strobePanel(L, sel) + cropPanel(L, sel) + bgPanel(L, sel)
    h += `</div></div>`
    const sL = INS.querySelector('.insColL'), sR = INS.querySelector('.insColR')
    const keepL = sL ? sL.scrollTop : 0, keepR = sR ? sR.scrollTop : 0
    INS.innerHTML = h
    const nL = INS.querySelector('.insColL'), nR = INS.querySelector('.insColR')
    if (nL) nL.scrollTop = keepL; if (nR) nR.scrollTop = keepR
    wire(INS)
    enhanceWidgets(INS)
    applyPanelCollapse(INS)
    updateAiStat()
  }

  function setSrc (i, src, camIdx) { const L = deck.layers[i]; L.src = src; if (camIdx != null) L.camIdx = camIdx; sel = i; render(); buildComp() }
  function selectCh (i) {
    if (i === sel) return
    sel = i
    bar.querySelectorAll('.chan').forEach(x => { const on = +x.dataset.k === sel; x.classList.toggle('sel', on); x.parentNode.classList.toggle('sel', on) })
    render()
  }
  window.__deckSelect = selectCh
  // AI KEY: the Gemini key + model fields live in their own SETTINGS section (always visible)
  { const box = document.getElementById('aiKeyBox'); if (box) document.querySelectorAll('[data-mv="aikey"]').forEach(el => box.appendChild(el)) }
  // PROJ ▶ in the MIX header: open / close the projector (it goes to the extend screen by itself)
  { const pb = document.getElementById('projBtn')
    const paintPj = () => { if (!pb) return; const on = !!(window.HVFT_PROJ && window.HVFT_PROJ.active); pb.classList.toggle('on', on); pb.textContent = on ? '■ PROJECTOR ON' : '▶ PROJECTOR' }
    if (pb) pb.onclick = (e) => { e.stopPropagation(); if (window.HVFT_PROJ && window.HVFT_PROJ.active) window.HVFT_PROJ.close(); else { const s = document.getElementById('send'); if (s) s.click() } setTimeout(paintPj, 400) }
    setInterval(paintPj, 1000); paintPj() }
  { const ab = document.getElementById('advToggle')
    const paintAdv = () => { document.body.classList.toggle('adv', ADV()); if (ab) { ab.classList.toggle('on', ADV()); ab.textContent = ADV() ? 'ADVANCED · ALL SLIDERS (ON)' : 'SIMPLE · FIXED BEST VALUES (ADVANCED OFF)' } }
    if (ab) ab.onclick = (e) => { e.stopPropagation(); window.HVFT_ADV = !ADV(); try { localStorage.setItem('hvft.advanced', ADV() ? '1' : '0') } catch (er) {} paintAdv(); renderInspector() }
    paintAdv() }
  function openSettings (secName) {
    const p = document.getElementById('panel'); const g = document.getElementById('gear')
    if (p && p.classList.contains('hidden') && g) g.click()
    const sec = document.querySelector('.sec[data-sec="' + secName + '"]')
    if (sec) { if (!sec.classList.contains('open')) { const hd = sec.querySelector('.sech'); if (hd) hd.click() } try { sec.scrollIntoView({ block: 'start', behavior: 'smooth' }) } catch (e) {} }
  }

  function wire (root) {
    root.querySelectorAll('.chan').forEach(c => c.onclick = () => selectCh(+c.dataset.k))
    root.querySelectorAll('.gf').forEach(b => b.onclick = e => {
      e.stopPropagation(); const g = b.dataset.g
      if (g === 'hud') { deck.g.hud = !deck.g.hud; try { const ls = document.querySelector('.sec[data-sec="look"]'); if (ls) ls.classList.toggle('open', deck.g.hud) } catch (e) {} }
      else if (g === 'grid') deck.g.grid = !deck.g.grid
      else if (g === 'blob') { const o = ['off', 'white', 'green', 'track']; deck.g.blob = o[(o.indexOf(deck.g.blob) + 1) % o.length] }
      render(); buildComp()
    })
    // ON/OFF
    root.querySelectorAll('.con').forEach(b => b.onclick = e => { e.stopPropagation(); const i = +b.dataset.k; const L = deck.layers[i]; L.on = L.on === false; sel = i; render(); buildComp() })
    // opacity
    root.querySelectorAll('.hop[data-f="op"]').forEach(s => s.oninput = e => { e.stopPropagation(); const L = deck.layers[+s.dataset.k]; L.opacity = s.value / 100; buildComp() })
    // blend cycle / solo / bypass
    root.querySelectorAll('button[data-f="blendcyc"]').forEach(b => b.onclick = e => { e.stopPropagation(); const i = +b.dataset.k, L = deck.layers[i]; const k = BLENDS.findIndex(x => x[0] === L.blend); L.blend = BLENDS[(k + 1) % BLENDS.length][0]; sel = i; render(); buildComp() })
    root.querySelectorAll('button[data-f="solo"]').forEach(b => b.onclick = e => { e.stopPropagation(); const i = +b.dataset.k; deck.layers[i].solo = !deck.layers[i].solo; sel = i; render(); buildComp() })
    root.querySelectorAll('button[data-f="byp"]').forEach(b => b.onclick = e => { e.stopPropagation(); const i = +b.dataset.k; deck.layers[i].bypass = !deck.layers[i].bypass; sel = i; render(); buildComp() })
    // SOURCE keys
    root.querySelectorAll('button[data-f="camkey"]').forEach(b => b.onclick = e => { e.stopPropagation();
      const k = +b.dataset.k, idx = parseInt(b.dataset.v) || 0
      deck.layers[k].net = null
      try { if (typeof pipe !== 'undefined' && pipe.useNetCam && typeof CAMS !== 'undefined' && CAMS[idx] && typeof selectCameraSource === 'function') selectCameraSource(CAMS[idx].deviceId) } catch (er) {}
      setSrc(k, 'cam', idx)
    })
    root.querySelectorAll('button[data-f="depthkey"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const i = +b.dataset.k, L = deck.layers[i], v = b.dataset.v
      if (v === 'pc3d') {
        L.depthIn = (L.src === 'kinect') ? 'kinect' : (L.src === 'pc3d' ? L.depthIn : null); L.effects = []; L.effect = 'none'
        if (L.depthIn === 'kinect') { const O = window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; if (!O.style) { O.style = 'scan'; try { if (typeof pipe !== 'undefined' && pipe.settings) pipe.settings.pcOpt = O; if (typeof pushSettings === 'function') pushSettings() } catch (er) {} } }
        setSrc(i, 'pc3d', L.camIdx | 0); return
      }
      L.depthIn = null
      if (v === 'lidar') setSrc(i, 'lidar', 0)
      else setSrc(i, v, L.camIdx | 0)
    })
    root.querySelectorAll('button[data-f="netrot"]').forEach(b => b.onclick = e => { e.stopPropagation(); const L = deck.layers[+b.dataset.k]; L.netRot = ((L.netRot | 0) + 90) % 360; renderInspector(); buildComp() })
    root.querySelectorAll('button[data-f="netrot0"]').forEach(b => b.onclick = e => { e.stopPropagation(); const L = deck.layers[+b.dataset.k]; L.netRot = 0; renderInspector(); buildComp() })
    root.querySelectorAll('button[data-f="netflip"]').forEach(b => b.onclick = e => { e.stopPropagation(); const L = deck.layers[+b.dataset.k]; L.netFlip = !L.netFlip; renderInspector(); buildComp() })
    root.querySelectorAll('select[data-f="cam"]').forEach(s => s.onchange = e => { e.stopPropagation();
      const k = +s.dataset.k
      if (s.value.indexOf('net:') === 0) { useHvftCamCh(k, s.value.slice(4)); return }
      const idx = parseInt(s.value.split('#')[1]) || 0
      deck.layers[k].net = null
      try { if (typeof pipe !== 'undefined' && pipe.useNetCam && typeof CAMS !== 'undefined' && CAMS[idx] && typeof selectCameraSource === 'function') selectCameraSource(CAMS[idx].deviceId) } catch (er) {}
      setSrc(k, 'cam', idx)
    })
    root.querySelectorAll('select[data-f="depthsrc"]').forEach(s => s.onchange = e => {
      e.stopPropagation(); const v = s.value
      const L = deck.layers[+s.dataset.k]
      L.depthIn = null; L.net = null
      if (v.indexOf('@') > 0) { const [kind, u] = [v.slice(0, v.indexOf('@')), v.slice(v.indexOf('@') + 1)]; L.net = u; if (kind === 'pc3d') { L.effects = []; L.effect = 'none' } setSrc(+s.dataset.k, kind, 0); return }   // HVFT Cam phone
      if (v === 'lidar' || v === 'kinect') setSrc(+s.dataset.k, v, L.camIdx | 0)
      else if (v === 'kpc3d') { L.depthIn = 'kinect'; L.effects = []; L.effect = 'none'; { const O = window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; if (!O.style) { O.style = 'scan'; pcSync() } } setSrc(+s.dataset.k, 'pc3d', L.camIdx | 0) }
      else { const p = v.split('#'); if (p[0] === 'pc3d') { L.effects = []; L.effect = 'none' }; setSrc(+s.dataset.k, p[0] === 'pc3d' ? 'pc3d' : 'depthai', parseInt(p[1]) || 0) }
    })
    let _kTiltT = 0
    root.querySelectorAll('input[data-f="ktilt"]').forEach(s => s.oninput = e => {
      e.stopPropagation(); window.HVFT_KINECT_TILT = +s.value
      clearTimeout(_kTiltT); _kTiltT = setTimeout(() => { if (window.hvft && window.hvft.kinectCmd) window.hvft.kinectCmd('tilt ' + window.HVFT_KINECT_TILT) }, 120)
    })
    root.querySelectorAll('button[data-f="klook"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const t = document.querySelector('#dColor button[data-dc="' + b.dataset.v + '"]')
      if (t) t.click(); window.HVFT_DEPTH_LOOK = b.dataset.v; renderInspector()
    })
    root.querySelectorAll('button[data-f="kir"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); window.HVFT_KINECT_IR = !window.HVFT_KINECT_IR
      if (window.hvft && window.hvft.kinectCmd) window.hvft.kinectCmd('ir ' + ((window.HVFT_KINECT_IR || window.HVFT_DEPTH_LOOK === 'ir') ? 1 : 0))
      renderInspector()
    })
    root.querySelectorAll('button[data-f="kfull"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); window.HVFT_KINECT_FULL = !window.HVFT_KINECT_FULL
      if (window.hvft && window.hvft.kinectCmd) window.hvft.kinectCmd('full ' + (window.HVFT_KINECT_FULL ? 1 : 0))
      renderInspector()
    })
    root.querySelectorAll('button[data-f="mediakind"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const i = +b.dataset.k, L = deck.layers[i]; L.on = true
      if (b.dataset.v === 'text') { L.src = 'text'; if (!L.textCfg) L.textCfg = { str: 'HVFT', size: 0.16, react: 1, oneFont: true, mode: 'random' } }
      else { L.src = (L.kind === 'video' ? 'media' : (L.url ? 'logo' : 'media')) }
      sel = i; render(); buildComp()
    })
    root.querySelectorAll('button[data-f="aikind"]').forEach(b => b.onclick = e => { e.stopPropagation(); const L = deck.layers[+b.dataset.k]; L.on = true; setSrc(+b.dataset.k, b.dataset.v, L.camIdx) })
    root.querySelectorAll('select[data-f="aicam"]').forEach(s => s.onchange = e => { e.stopPropagation(); const L = deck.layers[+s.dataset.k]; if (s.value.indexOf('net:') === 0) { L.net = s.value.slice(4); L.camIdx = 0 } else { L.net = null; L.camIdx = parseInt(s.value.split('#')[1]) || 0 } buildComp() })
    // EFFECT stepper ◂ ▸
    root.querySelectorAll('button[data-f="efstep"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const i = +b.dataset.k, L = deck.layers[i], d = +b.dataset.d; sel = i
      if (L.role === 'ai') {
        const box = aiBox(L); const bs = box ? [...box.querySelectorAll('button')] : []
        if (bs.length) { const cur = Math.max(0, bs.findIndex(x => x.classList.contains('on'))); bs[(cur + d + bs.length) % bs.length].click() }
        render(); setTimeout(render, 120); return
      }
      const list = stepList(L); if (!list) { render(); return }
      const cur = (L.effects && L.effects.length === 1) ? L.effects[0] : ((L.effects && L.effects.length) ? L.effect : 'none')
      let k = list.indexOf(cur); if (k < 0) k = 0
      const nx = list[(k + d + list.length) % list.length]
      L.effects = nx === 'none' ? [] : [nx]; L.effect = nx
      render(); buildComp()
    })
    // CUT-OUT MODEL (MediaPipe / RVM) — global matte setting, pushed to every pipe + the projector
    root.querySelectorAll('button[data-f="mattemodel"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); if (typeof pipe !== 'undefined' && pipe.settings) { pipe.settings.matteModel = b.dataset.v === 'rvm' ? 'rvm' : 'mp'; if (typeof pushSettings === 'function') pushSettings() } renderInspector()
    })
    root.querySelectorAll('button[data-f="milknext"]').forEach(b => b.onclick = e => {   // MILKDROP next preset
      e.stopPropagation(); if (window.HVFT_MILKDROP) { window.HVFT_MILKDROP.next(); setTimeout(() => { const n = root.querySelector('.mkname'); if (n) n.textContent = window.HVFT_MILKDROP.preset || '' }, 60) }
    })
    // ISF SHADER FX
    const isfCfg = (L) => (L.isf || (L.isf = { id: 'none', mix: 1, v: {}, link: {} }))
    root.querySelectorAll('select[data-f="isfid"]').forEach(s => s.onchange = e => {
      e.stopPropagation(); const L = deck.layers[+s.dataset.k]
      L.isf = (s.value === 'none' || !window.HVFT_ISF) ? { id: 'none', mix: (L.isf && L.isf.mix) || 1, v: {}, link: {} } : window.HVFT_ISF.freshCfg(s.value, L.isf)
      renderInspector(); buildComp()
    })
    root.querySelectorAll('input[data-f="isfmix"]').forEach(s => s.oninput = e => { e.stopPropagation(); isfCfg(deck.layers[+s.dataset.k]).mix = s.value / 100; buildComp() })
    root.querySelectorAll('input[data-f="isfv"]').forEach(s => s.oninput = e => { e.stopPropagation(); const c = isfCfg(deck.layers[+s.dataset.k]); (c.v || (c.v = {}))[s.dataset.p] = s.value / 100; buildComp() })
    root.querySelectorAll('button[data-f="isfbool"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const L = deck.layers[+b.dataset.k], c = isfCfg(L), n = b.dataset.p, d = (window.HVFT_ISF ? window.HVFT_ISF.inputs(c.id) : []).find(x => x.NAME === n) || {}
      const cur = (c.v && c.v[n] != null) ? !!c.v[n] : !!d.DEFAULT; (c.v || (c.v = {}))[n] = !cur; renderInspector(); buildComp()
    })
    root.querySelectorAll('select[data-f="isflong"]').forEach(s => s.onchange = e => { e.stopPropagation(); const c = isfCfg(deck.layers[+s.dataset.k]); (c.v || (c.v = {}))[s.dataset.p] = +s.value; buildComp() })
    root.querySelectorAll('.lbtn[data-f="isflink"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const c = isfCfg(deck.layers[+b.dataset.k]); const LK = c.link || (c.link = {}); const cur = LK[b.dataset.p] || { band: 'off', amt: 0.5 }
      cur.band = (cur.band === b.dataset.band) ? 'off' : b.dataset.band; LK[b.dataset.p] = cur; renderInspector(); buildComp()
    })
    root.querySelectorAll('.lbtn[data-f="isfcyc"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const c = isfCfg(deck.layers[+b.dataset.k]); const LK = c.link || (c.link = {}); const cur = LK[b.dataset.p] || { band: 'off', amt: 0.5 }
      const seq = ['off'].concat(LINKB); cur.band = seq[(seq.indexOf(cur.band) + 1) % seq.length] || 'off'; LK[b.dataset.p] = cur; renderInspector(); buildComp()
    })
    root.querySelectorAll('input[data-f="isfamt"]').forEach(s => s.oninput = e => { e.stopPropagation(); const c = isfCfg(deck.layers[+s.dataset.k]); const LK = c.link || (c.link = {}); const cur = LK[s.dataset.p] || { band: 'off', amt: 0.5 }; cur.amt = s.value / 100; LK[s.dataset.p] = cur; buildComp() })
    // EFFECT POOL (multi -> random)
    root.querySelectorAll('.efb[data-e]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const L = deck.layers[+b.dataset.k], v = b.dataset.e
      if (!L.effects) L.effects = []
      const k = L.effects.indexOf(v); if (k >= 0) L.effects.splice(k, 1); else L.effects.push(v)
      L.effect = L.effects.length ? L.effects[L.effects.length - 1] : 'none'
      render(); buildComp()
    })
    // PARAM value + strobe rate/duty/depth + bg power
    root.querySelectorAll('.pxv').forEach(s => s.oninput = e => {
      e.stopPropagation(); const L = deck.layers[+s.dataset.k]
      if (s.dataset.fx) {
        const fx = s.dataset.fx; if (!L.fxParams) L.fxParams = {}; if (!L.fxParams[fx]) L.fxParams[fx] = {}
        L.fxParams[fx][s.dataset.p] = s.value / 100; buildComp()
      } else if (s.dataset.f) {
        const G = L.strobe || (L.strobe = mkStrobe())
        if (s.dataset.f === 'bgpow') L.bgfxPower = s.value / 100
        else if (s.dataset.f === 'bgbrut') L.bgBrutal = s.value / 100
        else if (s.dataset.f === 'bgkeylvl') L.bgKeyLvl = s.value / 100
        else {
          const key = { grate: 'rate', gduty: 'duty', gdepth: 'depth' }[s.dataset.f]; if (key) G[key] = s.value / 100
          if (key === 'rate') { const p = INS && INS.querySelector('.gperiod'); if (p) p.textContent = Math.round(1000 / hzOf(G.rate)) + ' ms'; const st = bar.querySelector('.chan[data-k="' + s.dataset.k + '"] .opstat'); if (st) st.textContent = chStatus(L)[0] }
        }
        buildComp()
      }
    })
    // L/M/H band link for params
    root.querySelectorAll('.lbtn[data-fx]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const L = deck.layers[+b.dataset.k], id = b.dataset.fx + '.' + b.dataset.p
      if (!L.fxLinks) L.fxLinks = {}; const cur = L.fxLinks[id] || { band: 'off', amt: 0.5 }
      cur.band = (cur.band === b.dataset.band) ? 'off' : b.dataset.band; L.fxLinks[id] = cur
      render(); buildComp()
    })
    root.querySelectorAll('.lbtn[data-f="gband"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const L = deck.layers[+b.dataset.k]; const G = L.strobe || (L.strobe = mkStrobe())
      G.band = (G.band === b.dataset.band) ? 'off' : b.dataset.band; renderInspector(); buildComp()
    })
    // modulation depth (param or strobe)
    root.querySelectorAll('.pxa').forEach(s => s.oninput = e => {
      e.stopPropagation(); const L = deck.layers[+s.dataset.k]
      if (s.dataset.fx) {
        const id = s.dataset.fx + '.' + s.dataset.p; if (!L.fxLinks) L.fxLinks = {}; const cur = L.fxLinks[id] || { band: 'off', amt: 0.5 }; cur.amt = s.value / 100; L.fxLinks[id] = cur
        const vi = root.querySelector('.pxv[data-fx="' + s.dataset.fx + '"][data-p="' + s.dataset.p + '"]'); if (vi) { vi.dataset.amt = cur.amt; vi._draw && vi._draw() }
      } else { (L.strobe || (L.strobe = mkStrobe())).amt = s.value / 100 }
      buildComp()
    })
    // STROBE
    root.querySelectorAll('button[data-f="gon"], button[data-f="ginv"], button[data-f="gwhite"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const L = deck.layers[+b.dataset.k]; const G = L.strobe || (L.strobe = mkStrobe())
      const f2 = b.dataset.f
      if (f2 === 'gon') G.on = !G.on; else if (f2 === 'ginv') G.invert = !G.invert; else G.white = !G.white
      render(); buildComp()
    })
    root.querySelectorAll('button[data-f="gpreset"]').forEach(b => b.onclick = e => { e.stopPropagation(); const L = deck.layers[+b.dataset.k]; const G = L.strobe || (L.strobe = mkStrobe()); Object.assign(G, STROBE_PRESETS[b.dataset.v] || {}); G.on = true; render(); buildComp() })
    root.querySelectorAll('button[data-f="gmodek"]').forEach(b => b.onclick = e => { e.stopPropagation(); const L = deck.layers[+b.dataset.k]; (L.strobe || (L.strobe = mkStrobe())).mode = b.dataset.v; renderInspector(); buildComp() })
    root.querySelectorAll('select[data-f="gmode"]').forEach(s => s.onchange = e => { e.stopPropagation(); const L = deck.layers[+s.dataset.k]; (L.strobe || (L.strobe = mkStrobe())).mode = s.value; buildComp() })
    // CROP + BG PATTERN
    root.querySelectorAll('button[data-f="crop"]').forEach(b => b.onclick = e => { e.stopPropagation(); const L = deck.layers[+b.dataset.k]; L.crop = !L.crop; render(); buildComp() })
    root.querySelectorAll('button[data-f="pxtog"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const L = deck.layers[+b.dataset.k], fx = b.dataset.fx
      const list = curFx(L); if (!L.pcol) L.pcol = {}
      L.pcol[fx] = !pxCollapsed(L, fx, list); renderInspector()
    })
    root.querySelectorAll('button[data-f="pxall"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const L = deck.layers[+b.dataset.k], c = b.dataset.v === '1'
      L.pcol = {}; curFx(L).forEach(fx => { L.pcol[fx] = c }); renderInspector()
    })
    // CUSTOM HUE bars (object / background) + HOLO FX toggle
    root.querySelectorAll('.huebar').forEach(bar => {
      const pick = (ev) => {
        const rc = bar.getBoundingClientRect(), h = Math.round(Math.max(0, Math.min(1, (ev.clientX - rc.left) / rc.width)) * 359)
        const L = deck.layers[+bar.dataset.k]; if (bar.dataset.f === 'bghue') L.bgColor = 'hue:' + h; else L.color = 'hue:' + h
        let mk = bar.querySelector('i'); if (!mk) { mk = document.createElement('i'); bar.appendChild(mk) } mk.style.left = (h / 359 * 100).toFixed(1) + '%'
        buildComp()
      }
      bar.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); bar.setPointerCapture && bar.setPointerCapture(ev.pointerId); bar._drag = true; pick(ev) })
      bar.addEventListener('pointermove', (ev) => { if (bar._drag) pick(ev) })
      bar.addEventListener('pointerup', () => { if (bar._drag) { bar._drag = false; renderInspector() } })
      bar.addEventListener('click', (ev) => ev.stopPropagation())
    })
    root.querySelectorAll('button[data-f="holo"]').forEach(b => b.onclick = e => { e.stopPropagation(); const L = deck.layers[+b.dataset.k]; L.holo = L.holo === false; renderInspector(); buildComp() })
    root.querySelectorAll('button[data-f="colkey"]').forEach(b => b.onclick = e => { e.stopPropagation(); deck.layers[+b.dataset.k].color = b.dataset.v; renderInspector(); buildComp() })
    root.querySelectorAll('button[data-f="bgcolkey"]').forEach(b => b.onclick = e => { e.stopPropagation(); deck.layers[+b.dataset.k].bgColor = b.dataset.v; renderInspector(); buildComp() })
    root.querySelectorAll('button[data-f="bgkeymode"]').forEach(b => b.onclick = e => { e.stopPropagation(); deck.layers[+b.dataset.k].bgKey = b.dataset.v; renderInspector(); buildComp() })
    root.querySelectorAll('button[data-f="bgkey"]').forEach(b => b.onclick = e => { e.stopPropagation(); deck.layers[+b.dataset.k].bgfx = b.dataset.v; renderInspector(); buildComp() })
    root.querySelectorAll('select[data-f="bgfx"]').forEach(s => s.onchange = e => { e.stopPropagation(); deck.layers[+s.dataset.k].bgfx = s.value; renderInspector(); buildComp() })
    // PC-3D cloud fx (global HVFT_PC_OPT)
    const pcSync = () => { try { if (typeof pipe !== 'undefined' && pipe.settings) pipe.settings.pcOpt = window.HVFT_PC_OPT; if (typeof pushSettings === 'function') pushSettings() } catch (er) {} }
    root.querySelectorAll('button[data-f="pcfx"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const p = b.dataset.p
      window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; window.HVFT_PC_OPT[p] = !window.HVFT_PC_OPT[p]; b.classList.toggle('on', !!window.HVFT_PC_OPT[p])
      pcSync()
    })
    // 3D STYLE (pc_styles.js) + its default-ON flags + body depth
    root.querySelectorAll('button[data-f="pcstyle"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; window.HVFT_PC_OPT.style = b.dataset.v; pcSync(); renderInspector()
    })
    root.querySelectorAll('button[data-f="pcflag"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const p = b.dataset.p; const O = window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}
      O[p] = O[p] === false; b.classList.toggle('on', O[p] !== false); pcSync()
    })
    root.querySelectorAll('button[data-f="pcscanlook"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const O = window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; O.scanLook = b.dataset.v; pcSync(); renderInspector()
    })
    root.querySelectorAll('button[data-f="pcscanreset"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const O = window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; O.scanReset = Date.now(); pcSync()
    })
    root.querySelectorAll('input[data-f="pcscantrail"]').forEach(s => s.oninput = e => {
      e.stopPropagation(); const O = window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; O.scanTrail = s.value / 100; pcSync()
    })
    root.querySelectorAll('input[data-f="pcscandetail"]').forEach(s => s.oninput = e => {
      e.stopPropagation(); const O = window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; O.scanDetail = s.value / 100; pcSync()
    })
    root.querySelectorAll('input[data-f="pcscanroom"]').forEach(s => s.oninput = e => {
      e.stopPropagation(); const O = window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; O.scanRoom = s.value / 100; pcSync()
    })
    root.querySelectorAll('button[data-f="pc4d"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const O = window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; O.h4mode = b.dataset.v; pcSync(); renderInspector()
    })
    root.querySelectorAll('input[data-f="pc4amt"]').forEach(s => s.oninput = e => {
      e.stopPropagation(); const O = window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; O.h4amt = s.value / 100; pcSync()
    })
    root.querySelectorAll('input[data-f="pcpre"]').forEach(s => s.oninput = e => {   // PRECISE sliders
      e.stopPropagation(); const O = window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; O[s.dataset.p] = s.value / 100; pcSync()
    })
    root.querySelectorAll('input[data-f="pcbody"]').forEach(s => s.oninput = e => {
      e.stopPropagation(); const O = window.HVFT_PC_OPT = window.HVFT_PC_OPT || {}; O.bodyRange = s.value / 100; pcSync()
    })
    // TEXT config
    root.querySelectorAll('[data-f="txt"]').forEach(t => t.oninput = e => { e.stopPropagation(); const L = deck.layers[+t.dataset.k]; if (!L.textCfg) L.textCfg = { size: 0.16, react: 1 }; L.textCfg.str = t.value; buildComp() })
    root.querySelectorAll('button[data-f="txtmodek"]').forEach(b => b.onclick = e => { e.stopPropagation(); const L = deck.layers[+b.dataset.k]; if (!L.textCfg) L.textCfg = {}; L.textCfg.mode = b.dataset.v; renderInspector(); buildComp() })
    root.querySelectorAll('select[data-f="txtmode"]').forEach(s => s.onchange = e => { e.stopPropagation(); const L = deck.layers[+s.dataset.k]; if (!L.textCfg) L.textCfg = {}; L.textCfg.mode = s.value; buildComp() })
    root.querySelectorAll('button[data-f="fontpick"]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const L = deck.layers[+b.dataset.k]; if (!L.textCfg) L.textCfg = {}; if (!Array.isArray(L.textCfg.fonts)) L.textCfg.fonts = []
      const fi = +b.dataset.fi, k = L.textCfg.fonts.indexOf(fi)
      if (k >= 0) { L.textCfg.fonts.splice(k, 1); b.classList.remove('on') } else { L.textCfg.fonts.push(fi); b.classList.add('on') }
      buildComp()
    })
    root.querySelectorAll('input[data-f="txtsize"]').forEach(r => r.oninput = e => { e.stopPropagation(); const L = deck.layers[+r.dataset.k]; if (!L.textCfg) L.textCfg = {}; L.textCfg.size = (parseInt(r.value) || 16) / 100; buildComp() })
    root.querySelectorAll('input[data-f="txtletter"]').forEach(r => r.oninput = e => { e.stopPropagation(); const L = deck.layers[+r.dataset.k]; if (!L.textCfg) L.textCfg = {}; L.textCfg.letter = (parseInt(r.value) || 0) / 100; buildComp() })
    root.querySelectorAll('input[data-f="txtreact"]').forEach(r => r.oninput = e => { e.stopPropagation(); const L = deck.layers[+r.dataset.k]; if (!L.textCfg) L.textCfg = {}; L.textCfg.react = (parseInt(r.value) || 100) / 100; buildComp() })
    root.querySelectorAll('button[data-f="txtone"]').forEach(b => b.onclick = e => { e.stopPropagation(); const L = deck.layers[+b.dataset.k]; if (!L.textCfg) L.textCfg = {}; L.textCfg.oneFont = !L.textCfg.oneFont; b.classList.toggle('on', L.textCfg.oneFont); buildComp() })
    root.querySelectorAll('button[data-f="txtorient"]').forEach(b => b.onclick = e => { e.stopPropagation(); const L = deck.layers[+b.dataset.k]; if (!L.textCfg) L.textCfg = {}; L.textCfg.orient = b.dataset.v; renderInspector(); buildComp() })
    // MEDIA drop
    root.querySelectorAll('.hdrop').forEach(d => {
      d.ondragover = e => { e.preventDefault(); d.classList.add('drop') }
      d.ondragleave = () => d.classList.remove('drop')
      d.ondrop = e => {
        e.preventDefault(); d.classList.remove('drop')
        const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return
        const info = window.hvft && window.hvft.fileInfo ? window.hvft.fileInfo(f) : null
        const url = info ? info.url : URL.createObjectURL(f); const nm = (info && info.name) || f.name
        const isVid = /\.(mp4|mov|webm|m4v|mkv)$/i.test(nm)
        const L = deck.layers[+d.dataset.k]; L.src = isVid ? 'media' : 'logo'; L.url = url; L.kind = isVid ? 'video' : 'image'; L.on = true
        render(); buildComp()
        // no path on disk (blob:) -> copy it into the app so the PROJECTOR and the PRESET can load it too
        if (!info && window.hvft && window.hvft.saveDrop) f.arrayBuffer().then(b => window.hvft.saveDrop(nm, b)).then(r => { if (r && r.ok && L.url === url) { L.url = r.url; render(); buildComp() } }).catch(() => {})
      }
    })
    // PROXIES -> original controls (control.js handlers do the real work)
    root.querySelectorAll('input[data-proxy]').forEach(s => s.oninput = e => { e.stopPropagation(); const t = document.getElementById(s.dataset.proxy); if (t) { t.value = s.value; t.dispatchEvent(new Event('input', { bubbles: true })) } })
    root.querySelectorAll('input[data-proxyval]').forEach(t => t.oninput = e => { e.stopPropagation(); const d = document.getElementById(t.dataset.proxyval); if (d) { d.value = t.value; d.dispatchEvent(new Event('input', { bubbles: true })); d.dispatchEvent(new Event('change', { bubbles: true })) } })
    root.querySelectorAll('select[data-proxysel]').forEach(t => t.onchange = e => { e.stopPropagation(); const d = document.getElementById(t.dataset.proxysel); if (d) { d.value = t.value; d.dispatchEvent(new Event('change', { bubbles: true })) } })
    root.querySelectorAll('[data-proxydrop]').forEach(z => {
      const tgt = () => document.getElementById(z.dataset.proxydrop)
      z.ondragover = e => { e.preventDefault(); e.stopPropagation(); z.classList.add('on') }
      z.ondragleave = e => { e.stopPropagation(); z.classList.remove('on') }
      z.ondrop = e => { e.preventDefault(); e.stopPropagation(); z.classList.remove('on'); const t = tgt(); if (t && t.ondrop) t.ondrop({ preventDefault () {}, stopPropagation () {}, dataTransfer: e.dataTransfer }); setTimeout(renderInspector, 500) }
      z.onclick = e => { e.stopPropagation(); const t = tgt(); if (t) t.click(); setTimeout(renderInspector, 1500) }
    })
    root.querySelectorAll('button[data-f="aimode"]').forEach(b => b.onclick = e => { e.stopPropagation(); const L = deck.layers[+b.dataset.k]; if (L.on === false) { L.on = true; buildComp() } setAiMode(b.dataset.v) })
    root.querySelectorAll('textarea[data-sdprompt]').forEach(t => t.oninput = e => { e.stopPropagation(); if (window.HVFT_AIGEN) window.HVFT_AIGEN.prompt = t.value })
    root.querySelectorAll('[data-sdpreset]').forEach(b => b.onclick = e => { e.stopPropagation(); const G = window.HVFT_AIGEN; if (!G) return; G.prompt = G.presets[+b.dataset.sdpreset][1]; renderInspector() })
    root.querySelectorAll('input[data-sdstr]').forEach(s => s.oninput = e => { e.stopPropagation(); if (window.HVFT_AIGEN) window.HVFT_AIGEN.strength = s.value / 100 })
    root.querySelectorAll('[data-sdtoggle]').forEach(b => b.onclick = async e => { e.stopPropagation(); const G = window.HVFT_AIGEN; if (!G) return; const p = G.toggle(); renderInspector(); try { await p } catch (er) {} renderInspector() })
    root.querySelectorAll('textarea[data-proxytext]').forEach(t => t.oninput = e => { e.stopPropagation(); const d = document.getElementById(t.dataset.proxytext); if (d) { d.value = t.value; d.dispatchEvent(new Event('input', { bubbles: true })); d.dispatchEvent(new Event('change', { bubbles: true })) } })
    root.querySelectorAll('[data-proxyclick]').forEach(b => b.onclick = e => { e.stopPropagation(); const t = document.getElementById(b.dataset.proxyclick); if (t) t.click(); setTimeout(renderInspector, 60); setTimeout(updateAiStat, 400) })
    root.querySelectorAll('[data-proxybtn]').forEach(b => b.onclick = e => { e.stopPropagation(); const box = document.getElementById(b.dataset.proxybtn); const t = box && box.querySelectorAll('button')[+b.dataset.idx]; if (t) t.click(); setTimeout(render, 80); setTimeout(render, 400) })
    root.querySelectorAll('[data-open]').forEach(b => b.onclick = e => { e.stopPropagation(); openSettings(b.dataset.open) })
  }
  function updateAiStat () { if (!INS) return; INS.querySelectorAll('.kstat').forEach(el => { const t = window.HVFT_KINECT_STATE || '—'; if (el.textContent !== t) el.textContent = t }); INS.querySelectorAll('.aistat[data-src]').forEach(el => { const t = document.getElementById(el.dataset.src); el.textContent = t ? (t.textContent || '—') : '—' }) }

  // ---- CH PREVIEW: 4 channel thumbnails (click = select) ----
  let _pv = null
  function updateLayerPreviews (force) {
    const host = document.getElementById('layerprev'); if (!host) return
    if (!_pv || !host.contains(_pv.cells[0].cv)) {
      host.innerHTML = [0, 1, 2, 3].map(i => `<div class="pvc" data-k="${i}"><canvas width="224" height="126"></canvas><span class="pvl"></span><span class="pvs"></span></div>`).join('')
      _pv = { cells: [...host.querySelectorAll('.pvc')].map(el => { const c = el.querySelector('canvas'); el.onclick = () => selectCh(+el.dataset.k); return { el, cv: c, ctx: c.getContext('2d'), l: el.querySelector('.pvl'), s: el.querySelector('.pvs') } }) }
      force = true
    }
    const clayers = comp.layers || []
    _pv.cells.forEach((t, i) => {
      const L = deck.layers[i]; if (!L) return
      const ctx = t.ctx, TW = t.cv.width, TH = t.cv.height
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, TW, TH)
        let src = null
        for (let k = 0; k < clayers.length; k++) { if (clayers[k] && clayers[k]._li === i) { src = comp.getLayerCanvas(k); break } }
        if (src && src.width > 2) { const s = Math.max(TW / src.width, TH / src.height), w = src.width * s, hh = src.height * s; ctx.drawImage(src, (TW - w) / 2, (TH - hh) / 2, w, hh) }
      }
      if (force) {
        const [st, stc] = chStatus(L)
        t.l.textContent = 'CH.0' + (i + 1) + ' · ' + srcLabel(L)
        t.s.textContent = st; t.s.className = 'pvs ' + stc
        t.el.classList.toggle('sel', sel === i); t.el.classList.toggle('off', !audible(L))
      }
    })
    if (force) { const nm = document.getElementById('pvName'); if (nm) nm.textContent = 'SELECTED · CH.0' + (sel + 1) + ' // ' + deck.layers[sel].name }
  }

  // ---- BANKS (scenes / presets) · DECK A/B × 8 ----
  // Oct 8: STORE → slot = save (or Shift+click a slot), click = recall, Alt/Option+click = clear.
  // AUTO-SAVE: the slot that is LIVE keeps saving itself every 3 s while you change the mix, and on close —
  // so whatever you built is in that slot next time. On launch the last LIVE slot (or the last mix) comes back.
  // Stored in presets/hvft_scenes.json via main.js (file, no size limit); localStorage is only a backup copy.
  const SCENE_N = 16
  let scenes = new Array(SCENE_N).fill(null)
  let sceneArm = false, curScene = -1, page = 0, lastMix = null, _lastSnap = '', _scLoaded = false
  try { const s = JSON.parse(localStorage.getItem('hvft_scenes2') || 'null'); if (Array.isArray(s)) for (let i = 0; i < SCENE_N; i++) scenes[i] = s[i] || null; else if (s && Array.isArray(s.scenes)) { for (let i = 0; i < SCENE_N; i++) scenes[i] = s.scenes[i] || null; curScene = s.cur != null ? s.cur : -1; lastMix = s.last || null } } catch (e) {}
  function persistScenes () {
    const data = { v: 2, scenes, cur: curScene, last: lastMix, t: Date.now() }
    try { if (window.hvft && window.hvft.scenesSave) window.hvft.scenesSave(data) } catch (e) {}
    try { localStorage.setItem('hvft_scenes2', JSON.stringify(data)) } catch (e) {}   // backup copy (may exceed quota — the file is the real store)
  }
  const LOOK_KEYS = ['color', 'bg', 'sens', 'hudScale', 'blobLine', 'gridCols', 'trackSize', 'audioAmt', 'audioBand', 'mirror', 'depthCut', 'depthFlip', 'lidarNear', 'lidarFar', 'lidarRelief', 'lidarGrain', 'matteModel', 'matteFeather', 'matteStab', 'matteExpand', 'matteClean']
  function grabLook () { const o = {}; try { if (typeof pipe !== 'undefined' && pipe.settings) { for (const k of LOOK_KEYS) o[k] = pipe.settings[k]; o.audio = Object.assign({}, pipe.settings.audio) } } catch (e) {} try { if (window.HVFT_PC_OPT) o.pcOpt = JSON.parse(JSON.stringify(window.HVFT_PC_OPT)) } catch (e) {} return o }
  function applyLook (look) {
    if (!look) return
    const L2 = Object.assign({}, look); const pc = L2.pcOpt; delete L2.pcOpt
    if (pc) { window.HVFT_PC_OPT = Object.assign(window.HVFT_PC_OPT || {}, pc) }
    try { if (typeof pipe !== 'undefined' && pipe.settings) { Object.assign(pipe.settings, L2); if (L2.audio) pipe.settings.audio = Object.assign({}, L2.audio); if (pc) pipe.settings.pcOpt = window.HVFT_PC_OPT } } catch (e) {}
    try { if (typeof applySettings === 'function') applySettings(pipe.settings) } catch (e) {}
    try { if (typeof pushSettings === 'function') pushSettings() } catch (e) {}
  }
  function sceneName () {
    const on = deck.layers.filter(L => L.on !== false).map(srcLabel)
    const pat = (deck.layers.find(L => L.on !== false && L.bgfx && L.bgfx !== 'none') || {}).bgfx
    return ((on.length ? on.join(' + ') : 'ALL OFF') + (pat ? ' · ' + pat.toUpperCase() : '')).slice(0, 34)
  }
  // the current mix as a storable snapshot (big AI frames — data: URLs — are left out, they regenerate live)
  function snapshot () {
    const layers = JSON.parse(JSON.stringify(deck.layers)).map(L => { if (L && typeof L.url === 'string' && L.url.indexOf('data:') === 0 && L.url.length > 100000) L.url = ''; return L })
    return { g: JSON.parse(JSON.stringify(deck.g)), layers, look: grabLook(), name: sceneName(), map: mapSnap() }
  }
  function saveScene (i) { if (i < 0 || i >= SCENE_N) return; scenes[i] = snapshot(); curScene = i; lastMix = scenes[i]; _lastSnap = JSON.stringify(scenes[i]); persistScenes(); renderSceneBar() }
  function clearScene (i) { if (i < 0 || i >= SCENE_N) return; scenes[i] = null; if (curScene === i) curScene = -1; persistScenes(); renderSceneBar() }
  function applySnap (s) {
    s = JSON.parse(JSON.stringify(s))
    deck.g = s.g || deck.g
    if (Array.isArray(s.layers) && s.layers.length === deck.layers.length) deck.layers = s.layers.map(L => Object.assign({}, L, { solo: false, bypass: false }))   // Oct 12: SOLO / BYP are live monitor toggles — never restored from a preset (a hidden BYP made CH3 'disappear')
    applyLook(s.look)
    if (s.map) applyMapSnap(s.map)   // MIX / MAPPING regions (CH full-page, 2x2, warp corners ...) belong to the preset
    sel = 0; render(); buildComp()
  }
  function recallScene (i) {
    if (i < 0 || i >= SCENE_N || !scenes[i]) return
    applySnap(scenes[i]); curScene = i; lastMix = scenes[i]; _lastSnap = JSON.stringify(scenes[i]); persistScenes(); renderSceneBar()
  }
  // AUTO-SAVE: every 3 s (only when something changed) + when the window closes
  function autoSave (force) {
    if (!_scLoaded) return
    let snap; try { snap = snapshot() } catch (e) { return }
    const str = JSON.stringify(snap)
    if (!force && str === _lastSnap) return
    _lastSnap = str; lastMix = snap
    if (curScene >= 0 && curScene < SCENE_N) scenes[curScene] = snap
    persistScenes(); renderSceneBar()
  }
  setInterval(() => autoSave(false), 3000)
  window.addEventListener('beforeunload', () => autoSave(true))
  function renderSceneBar () {
    const host = document.getElementById('sceneSlots'); if (!host) return
    let h = ''
    for (let n = 0; n < 8; n++) {
      const i = page * 8 + n, s = scenes[i], f = !!s
      const dots = f && Array.isArray(s.layers) ? s.layers.map(L => `<i class="${L.on !== false ? 'on' : ''}"></i>`).join('') : '<i></i><i></i><i></i><i></i>'
      h += `<button class="bnk ${f ? 'filled' : 'empty'} ${curScene === i ? 'cur' : ''}" data-sc="${i}" title="click = recall (empty slot = new preset from the current mix, becomes LIVE) · STORE then click / Shift+click = save here · Alt+click = clear"><span class="bnktop"><span class="bnkn">0${n + 1}</span>${curScene === i ? '<span class="bnklive">● LIVE · AUTO-SAVE</span>' : ''}<span class="bnkd">${dots}</span></span><span class="bnkl">${f ? esc(s.name || 'SCENE') : '— EMPTY'}</span></button>`
    }
    host.innerHTML = h
    host.querySelectorAll('.bnk').forEach(b => b.onclick = (e) => {
      const i = +b.dataset.sc
      if (e.altKey) { clearScene(i); return }
      if (sceneArm || e.shiftKey) { saveScene(i); sceneArm = false; const arm = document.getElementById('sceneArm'); if (arm) arm.classList.remove('on') }
      else if (!scenes[i]) saveScene(i)   // empty slot = start a NEW preset here from the current mix; from now on edits auto-save HERE
      else recallScene(i)
    })
    const A = document.getElementById('deckA'), B = document.getElementById('deckB')
    if (A) A.classList.toggle('on', page === 0); if (B) B.classList.toggle('on', page === 1)
  }
  ;(function wireScenes () {
    const arm = document.getElementById('sceneArm')
    if (arm) arm.onclick = () => { sceneArm = !sceneArm; arm.classList.toggle('on', sceneArm) }
    const A = document.getElementById('deckA'), B = document.getElementById('deckB')
    if (A) A.onclick = () => { page = 0; renderSceneBar() }
    if (B) B.onclick = () => { page = 1; renderSceneBar() }
    renderSceneBar()
    // load the file store, then bring back the last LIVE slot (or the last mix) — after the deck has settled
    const restore = () => {
      if (curScene >= 0 && scenes[curScene]) { page = curScene >= 8 ? 1 : 0; applySnap(scenes[curScene]) } else if (lastMix) applySnap(lastMix)
      _lastSnap = (() => { try { return JSON.stringify(snapshot()) } catch (e) { return '' } })()
      _scLoaded = true; renderSceneBar()
    }
    const go = async () => {
      try {
        const d = window.hvft && window.hvft.scenesLoad ? await window.hvft.scenesLoad() : null
        if (d && Array.isArray(d.scenes)) { for (let i = 0; i < SCENE_N; i++) scenes[i] = d.scenes[i] || null; curScene = d.cur != null ? d.cur : -1; lastMix = d.last || null }
      } catch (e) {}
      setTimeout(restore, 1500)
    }
    go()
  })()
  window.__deckScene = { save: saveScene, recall: recallScene, clear: clearScene, count: () => scenes.filter(Boolean).length, get cur () { return curScene } }

  if (window.hvft && window.hvft.onDepthFrame) window.hvft.onDepthFrame(f => comp.pushDepth(f))

  // =====================================================================
  //  MIX / MAPPING monitor — mirror of the projector regions (mapping.json),
  //  drawn with real corner warp, and EDITABLE here (MAP ▸) without the projector.
  // =====================================================================
  const QUAD = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]
  function quadCorners (q) { return [[q[0], q[1]], [q[0] + 0.5, q[1]], [q[0] + 0.5, q[1] + 0.5], [q[0], q[1] + 0.5]] }
  const defGrid = () => [0, 1, 2, 3].map(i => ({ corners: quadCorners(QUAD[i]), src: 'dl', dlIdx: i, url: '', kind: '', camIdx: 0, effect: '', fit: 'cover' }))
  let regionsM = null, mapEdit = false, mapSel = 0, _mapDirtyT = 0, _mapSaveT = 0, _mix = null
  function normMap (m) {
    if (Array.isArray(m) && m.length === 4 && Array.isArray(m[0]) && typeof m[0][0] === 'number') return [{ corners: m.map(p => [p[0], p[1]]), src: 'main', dlIdx: 0, url: '', kind: '', camIdx: 0, effect: '', fit: 'cover' }]
    if (Array.isArray(m) && m.length && m[0] && m[0].corners) return m.map(r => ({ corners: r.corners.map(p => [+p[0], +p[1]]), src: r.src || 'main', dlIdx: r.dlIdx | 0, url: r.url || '', kind: r.kind || '', camIdx: r.camIdx | 0, effect: r.effect || '', fit: r.fit === 'contain' ? 'contain' : 'cover' }))
    return null
  }
  async function loadPreviewMap () {
    if (!(window.hvft && window.hvft.getMap)) { if (!regionsM) regionsM = defGrid(); return }
    if (mapEdit || Date.now() - _mapDirtyT < 2500) return   // don't clobber local edits
    try { regionsM = normMap(await window.hvft.getMap()) || defGrid(); if (mapSel >= regionsM.length) mapSel = 0 } catch (e) { if (!regionsM) regionsM = defGrid() }
  }
  loadPreviewMap(); if (window.hvft && window.hvft.getMap) { try { setInterval(loadPreviewMap, 1200) } catch (e) {} }
  // presets: the mapping travels with the scene snapshot
  function mapSnap () { try { return regionsM ? regionsM.map(r => ({ corners: r.corners.map(p => [+p[0], +p[1]]), src: r.src, dlIdx: r.dlIdx | 0, url: r.url || '', kind: r.kind || '', camIdx: r.camIdx | 0, effect: r.effect || '', fit: r.fit || 'cover' })) : null } catch (e) { return null } }
  function applyMapSnap (m) { try { const n = normMap(m); if (!n) return; regionsM = n; mapSel = 0; saveMapSoon(); mapUI() } catch (e) {} }
  function saveMapSoon () {
    _mapDirtyT = Date.now()
    clearTimeout(_mapSaveT)
    _mapSaveT = setTimeout(() => {
      if (window.hvft && window.hvft.setMap && regionsM) window.hvft.setMap(regionsM.map(r => ({ corners: r.corners, src: r.src, url: r.url || '', kind: r.kind || '', camIdx: r.camIdx | 0, effect: r.effect || '', dlIdx: r.dlIdx | 0, fit: r.fit || 'cover' })))
    }, 140)
  }
  // affine-textured triangle (canvas 2D) — grid of them approximates the projector's corner warp
  function tri (ctx, img, x0, y0, x1, y1, x2, y2, u0, v0, u1, v1, u2, v2) {
    const cx = (u0 + u1 + u2) / 3, cy = (v0 + v1 + v2) / 3, g = 0.7
    const e = (x, y) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1; return [x + dx / l * g, y + dy / l * g] }
    const [a0, b0] = e(u0, v0), [a1, b1] = e(u1, v1), [a2, b2] = e(u2, v2)
    ctx.save(); ctx.beginPath(); ctx.moveTo(a0, b0); ctx.lineTo(a1, b1); ctx.lineTo(a2, b2); ctx.closePath(); ctx.clip()
    const den = x0 * (y2 - y1) - x1 * y2 + x2 * y1 + (x1 - x2) * y0
    if (Math.abs(den) < 1e-9) { ctx.restore(); return }
    const A = -(y0 * (u2 - u1) - y1 * u2 + y2 * u1 + (y1 - y2) * u0) / den
    const B = (x0 * (u2 - u1) - x1 * u2 + x2 * u1 + (x1 - x2) * u0) / den
    const C = (x0 * (y2 * u1 - y1 * u2) + y0 * (x1 * u2 - x2 * u1) + (x2 * y1 - x1 * y2) * u0) / den
    const D = -(y0 * (v2 - v1) - y1 * v2 + y2 * v1 + (y1 - y2) * v0) / den
    const E = (x0 * (v2 - v1) - x1 * v2 + x2 * v1 + (x1 - x2) * v0) / den
    const F = (x0 * (y2 * v1 - y1 * v2) + y0 * (x1 * v2 - x2 * v1) + (x2 * y1 - x1 * y2) * v0) / den
    ctx.transform(A, D, B, E, C, F); ctx.drawImage(img, 0, 0); ctx.restore()
  }
  function warpInto (ctx, img, P, fit) {
    const iw = img.width, ih = img.height
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
    const qw = (d(P[0], P[1]) + d(P[3], P[2])) / 2, qh = (d(P[0], P[3]) + d(P[1], P[2])) / 2
    if (qw < 2 || qh < 2) return
    let sx = 0, sy = 0, sw = iw, sh = ih, u0 = 0, v0 = 0, u1 = 1, v1 = 1
    const ta = qw / qh, sa = iw / ih
    if (fit !== 'contain') { if (sa > ta) { sw = ih * ta; sx = (iw - sw) / 2 } else { sh = iw / ta; sy = (ih - sh) / 2 } }
    else { if (sa > ta) { const k = ta / sa; v0 = (1 - k) / 2; v1 = 1 - v0 } else { const k = sa / ta; u0 = (1 - k) / 2; u1 = 1 - u0 } }
    const bl = (u, v) => { const a = (1 - u) * (1 - v), b = u * (1 - v), c = u * v, e = (1 - u) * v; return [a * P[0][0] + b * P[1][0] + c * P[2][0] + e * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + e * P[3][1]] }
    const N = 4
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const ua = i / N, ub = (i + 1) / N, va = j / N, vb = (j + 1) / N
      const s00 = [sx + ua * sw, sy + va * sh], s10 = [sx + ub * sw, sy + va * sh], s11 = [sx + ub * sw, sy + vb * sh], s01 = [sx + ua * sw, sy + vb * sh]
      const m = (u, v) => bl(u0 + u * (u1 - u0), v0 + v * (v1 - v0))
      const d00 = m(ua, va), d10 = m(ub, va), d11 = m(ub, vb), d01 = m(ua, vb)
      tri(ctx, img, s00[0], s00[1], s10[0], s10[1], s11[0], s11[1], d00[0], d00[1], d10[0], d10[1], d11[0], d11[1])
      tri(ctx, img, s00[0], s00[1], s11[0], s11[1], s01[0], s01[1], d00[0], d00[1], d11[0], d11[1], d01[0], d01[1])
    }
  }
  const PV_BLEND = { normal: 'source-over', screen: 'screen', add: 'lighter', multiply: 'multiply' }
  // DRAW ORDER (Oct 9) = the deck's: MIX regions at the bottom, CH4 .. CH1 above (CH1 on top), media / logo on top
  function regsInDrawOrder (regs) { const key = r => r.src === 'main' ? 0 : r.src === 'dl' ? 1 + (3 - Math.min(3, r.dlIdx | 0)) : 5; return regs.map((r, i) => [r, i]).sort((a, b) => (key(a[0]) - key(b[0])) || (a[1] - b[1])).map(x => x[0]) }
  function bbox (c) { const xs = c.map(p => p[0]), ys = c.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }
  function regOverlaps (c, list) { const A = bbox(c), aA = Math.max(1e-6, (A[2] - A[0]) * (A[3] - A[1])); for (const o of list) { const B = bbox(o), w = Math.min(A[2], B[2]) - Math.max(A[0], B[0]), h = Math.min(A[3], B[3]) - Math.max(A[1], B[1]); if (w > 0 && h > 0 && w * h / aA > 0.05) return true } return false }
  function regionOff (r, cl) { if (r.src !== 'dl') return false; for (let k = 0; k < cl.length; k++) if (cl[k] && (cl[k]._li | 0) === (r.dlIdx | 0)) return false; return true }
  function regionName (r) { return r.src === 'dl' ? 'CH' + ((r.dlIdx | 0) + 1) : (r.src === 'main' ? 'MIX' : String(r.src || '').toUpperCase()) }
  function drawMainPreview () {
    const cl = comp.layers || []
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height
    const regs = regionsM || defGrid()
    if (regs.some(r => r.src === 'main')) { if (!_mix) _mix = document.createElement('canvas'); if (_mix.width !== W || _mix.height !== H) { _mix.width = W; _mix.height = H } const mx = _mix.getContext('2d'); mx.clearRect(0, 0, W, H); mx.drawImage(cv, 0, 0) }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)
    const drawn = []
    regsInDrawOrder(regs).forEach(r => {
      let src = null, Lc = null
      if (r.src === 'dl') { for (let k = 0; k < cl.length; k++) { if (cl[k] && (cl[k]._li | 0) === (r.dlIdx | 0)) { src = comp.getLayerCanvas(k); Lc = cl[k]; break } } }
      else if (r.src === 'main') src = _mix
      const P = r.corners.map(p => [p[0] * W, p[1] * H])
      if (src && src.width > 2) {
        // overlapping channels mix like the MIX (blend + opacity); side by side they stay plain — same rule as the projector
        const ov = Lc && regOverlaps(r.corners, drawn)
        ctx.globalCompositeOperation = ov ? (PV_BLEND[Lc.blend || 'normal'] || 'source-over') : 'source-over'
        ctx.globalAlpha = ov ? (Lc.opacity != null ? Lc.opacity : 1) : 1
        try { warpInto(ctx, src, P, r.fit) } catch (e) {}
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1
        drawn.push(r.corners)
      }
    })
    const m = (window.HVFT_MASTER && typeof window.HVFT_MASTER.level === 'number') ? window.HVFT_MASTER.level : 1
    if (m < 0.999) { ctx.globalAlpha = 1 - Math.max(0, m); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1 }
    // outlines, labels, handles
    const sc = W / Math.max(1, cv.clientWidth || W)
    regs.forEach((r, ri) => {
      const off = regionOff(r, cl)
      if (off && !mapEdit) return   // channel OFF -> its mapped area disappears too (no outline to confuse the stack)
      const P = r.corners.map(p => [p[0] * W, p[1] * H]), isS = mapEdit && ri === mapSel
      if (off && !isS) {   // MAP EDIT: an OFF channel's area is only a faint ghost label, still selectable with TAB
        const cx = (P[0][0] + P[1][0] + P[2][0] + P[3][0]) / 4, cy = (P[0][1] + P[1][1] + P[2][1] + P[3][1]) / 4
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 ' + Math.round(10 * sc) + "px 'JetBrains Mono', monospace"; ctx.fillStyle = 'rgba(232,232,232,.28)'
        ctx.fillText('R' + (ri + 1) + ' · ' + regionName(r) + ' · OFF', cx, cy); return
      }
      ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(P[i][0], P[i][1]); ctx.closePath()
      if (mapEdit) { ctx.fillStyle = isS ? 'rgba(242,160,61,.10)' : 'rgba(255,255,255,.03)'; ctx.fill() }
      ctx.lineWidth = (isS ? 2.5 : 1.2) * sc; ctx.strokeStyle = mapEdit ? (isS ? '#F2A03D' : 'rgba(232,232,232,.55)') : 'rgba(242,160,61,.45)'
      if (mapEdit && !isS) ctx.setLineDash([6 * sc, 5 * sc]); ctx.stroke(); ctx.setLineDash([])
      if (mapEdit) {
        const cx = (P[0][0] + P[1][0] + P[2][0] + P[3][0]) / 4, cy = (P[0][1] + P[1][1] + P[2][1] + P[3][1]) / 4
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.font = '900 ' + Math.round(18 * sc) + "px 'Orbitron', monospace"; ctx.fillStyle = isS ? '#F2A03D' : 'rgba(232,232,232,.8)'
        ctx.fillText('R' + (ri + 1) + ' · ' + regionName(r), cx, cy - 8 * sc)
        ctx.font = '500 ' + Math.round(10 * sc) + "px 'JetBrains Mono', monospace"; ctx.fillStyle = 'rgba(232,232,232,.7)'
        ctx.fillText(r.fit === 'contain' ? 'CROP (FULL MEDIA)' : 'FILL', cx, cy + 12 * sc)
        if (isS) P.forEach((p, i) => {
          ctx.beginPath(); ctx.arc(p[0], p[1], 9 * sc, 0, 7); ctx.fillStyle = 'rgba(242,160,61,.35)'; ctx.fill()
          ctx.lineWidth = 2 * sc; ctx.strokeStyle = '#F2A03D'; ctx.stroke()
          ctx.fillStyle = '#F2F2F2'; ctx.font = '700 ' + Math.round(10 * sc) + "px 'JetBrains Mono', monospace"; ctx.fillText(String(i + 1), p[0], p[1])
        })
      }
    })
  }
  // ---- MAP editor (on the MIX monitor) ----
  const mapbar = document.getElementById('mapbar'), mapInfo = document.getElementById('mapInfo')
  function mapUI () {
    const r = regionsM && regionsM[mapSel]
    document.body.classList.toggle('mapedit', mapEdit)
    const mm = document.getElementById('mapmon'); if (mm) mm.classList.toggle('on', mapEdit)
    if (mapInfo && r) mapInfo.textContent = 'R' + (mapSel + 1) + '/' + regionsM.length + ' · ' + regionName(r) + ' · ' + (r.fit === 'contain' ? 'CROP' : 'FILL')
    if (mapbar) { const sb = mapbar.querySelector('[data-map="src"]'); if (sb && r) sb.textContent = 'SOURCE: ' + regionName(r) + ' ▸'; const fb = mapbar.querySelector('[data-map="fit"]'); if (fb && r) fb.textContent = r.fit === 'contain' ? 'CROP ⇄ FILL' : 'FILL ⇄ CROP' }
  }
  function setMapEdit (on) {
    mapEdit = (on == null) ? !mapEdit : !!on
    if (mapEdit && !regionsM) regionsM = defGrid()
    if (!mapEdit) saveMapSoon()
    cv.style.cursor = mapEdit ? 'crosshair' : ''
    mapUI()
  }
  window.__deckMapEdit = setMapEdit
  const SRC_CYCLE = ['main', 'dl0', 'dl1', 'dl2', 'dl3']
  function mapAction (a) {
    if (!regionsM) regionsM = defGrid()
    const r = regionsM[mapSel]
    if (a === 'prev') mapSel = (mapSel - 1 + regionsM.length) % regionsM.length
    else if (a === 'next') mapSel = (mapSel + 1) % regionsM.length
    else if (a === 'src' && r) { const cur = r.src === 'dl' ? 'dl' + (r.dlIdx | 0) : r.src; let k = SRC_CYCLE.indexOf(cur); const nx = SRC_CYCLE[(k + 1) % SRC_CYCLE.length]; if (nx === 'main') r.src = 'main'; else { r.src = 'dl'; r.dlIdx = +nx.slice(2) } saveMapSoon() }
    else if (a === 'fit' && r) { r.fit = r.fit === 'contain' ? 'cover' : 'contain'; saveMapSoon() }
    else if (a === 'add') { const c = r ? r.corners : quadCorners([0.25, 0.25]); regionsM.push({ corners: c.map(p => [Math.min(1, p[0] + 0.06), Math.min(1, p[1] + 0.06)]), src: 'main', dlIdx: 0, url: '', kind: '', camIdx: 0, effect: '', fit: 'cover' }); mapSel = regionsM.length - 1; saveMapSoon() }
    else if (a === 'del') { if (regionsM.length > 1) { regionsM.splice(mapSel, 1); mapSel = Math.min(mapSel, regionsM.length - 1); saveMapSoon() } }
    else if (a === 'reset') { regionsM = defGrid(); mapSel = 0; saveMapSoon() }
    else if (a === 'full' && r) { r.corners = [[0, 0], [1, 0], [1, 1], [0, 1]]; saveMapSoon() }
    else if (a === 'proj') { if (window.HVFT_PROJ && window.HVFT_PROJ.active) window.HVFT_PROJ.focus(); else if (window.hvft && window.hvft.mapMonitor) window.hvft.mapMonitor() }
    else if (a === 'done') { setMapEdit(false); return }
    mapUI()
  }
  // ---- ONE-CLICK OUTPUT LAYOUT (Oct 9): 2×2 · CH1..CH4 full screen · MIX full screen (saved in the preset) ----
  const FULLC = () => [[0, 0], [1, 0], [1, 1], [0, 1]]
  function setLayout (k) {
    if (k === 'grid') regionsM = defGrid()
    else if (k === 'mix') regionsM = [{ corners: FULLC(), src: 'main', dlIdx: 0, url: '', kind: '', camIdx: 0, effect: '', fit: 'cover' }]
    else {
      const ci = +k | 0
      regionsM = [{ corners: FULLC(), src: 'dl', dlIdx: ci, url: '', kind: '', camIdx: 0, effect: '', fit: 'cover' }]
      const L = deck.layers[ci]; if (L && L.on === false) { L.on = true; render(); buildComp() }   // FULL CHx on an OFF channel -> switch it on
    }
    mapSel = 0; saveMapSoon(); mapUI(); paintLayBtns()
  }
  function curLayout () {
    const R = regionsM; if (!R || !R.length) return ''
    const isFull = c => c.every((p, i) => Math.abs(p[0] - FULLC()[i][0]) < 0.01 && Math.abs(p[1] - FULLC()[i][1]) < 0.01)
    if (R.length === 1 && isFull(R[0].corners)) return R[0].src === 'main' ? 'mix' : (R[0].src === 'dl' ? String(R[0].dlIdx | 0) : '')
    const G = defGrid()
    if (R.length === 4 && R.every((r, i) => r.src === 'dl' && (r.dlIdx | 0) === i && r.corners.every((p, j) => Math.abs(p[0] - G[i].corners[j][0]) < 0.01 && Math.abs(p[1] - G[i].corners[j][1]) < 0.01))) return 'grid'
    return ''
  }
  let _layCur = null
  function paintLayBtns () {
    const host = document.getElementById('layBtns'); if (!host) return
    const c = curLayout(); if (c === _layCur) return; _layCur = c
    host.querySelectorAll('[data-lay]').forEach(b => b.classList.toggle('on', b.dataset.lay === c))
  }
  { const host = document.getElementById('layBtns'); if (host) host.querySelectorAll('[data-lay]').forEach(b => b.onclick = (e) => { e.stopPropagation(); setLayout(b.dataset.lay) }) }
  setInterval(paintLayBtns, 400)
  // ---- STAGE RESOLUTION (Oct 9): follow the projector's real shape (no stretching; the MIX monitor = the stage) ----
  function ratioName (a) {
    const L = [[16 / 9, '16:9'], [16 / 10, '16:10'], [4 / 3, '4:3'], [5 / 4, '5:4'], [21 / 9, '21:9'], [32 / 9, '32:9'], [1, '1:1'], [9 / 16, '9:16'], [3 / 4, '3:4']]
    for (const [v, n] of L) if (Math.abs(a / v - 1) < 0.015) return n
    return a.toFixed(2) + ':1'
  }
  let _stageA = 16 / 9, _stageL = 1280, _lastInfo = null
  // QUALITY (Oct 9): HD = channels render at the projector's own resolution (up to 1920) while it is open ·
  // CRISP = same + hard pixels (no blur when scaling: noise / dither / pixel FX stay razor sharp) · LITE = 1280 (lighter)
  let _qual = 'hd'; try { _qual = localStorage.getItem('hvft.quality') || 'hd' } catch (e) {}
  window.HVFT_CRISP = (_qual === 'crisp')
  function longSide (info) {
    const projOn = !!(window.HVFT_PROJ && window.HVFT_PROJ.active)
    if (_qual === 'lite' || !projOn || !info || !(info.w > 0)) return 1280
    return Math.max(1280, Math.min(1920, Math.max(info.w, info.h || 0)))
  }
  function applyStage (info, fromStore) {
    if (!info || !(info.aspect > 0.2)) return
    _lastInfo = info
    const a = Math.max(0.25, Math.min(5, info.aspect)), L = longSide(info)
    if (Math.abs(a - _stageA) > 0.004 || fromStore || L !== _stageL) {
      _stageA = a; _stageL = L
      const w = a >= 1 ? L : Math.round(L * 0.75 * a), h = a >= 1 ? Math.round(L / a) : Math.round(L * 0.75)
      comp.setSize(w, h)
      const st = document.getElementById('stage')
      if (st) { st.style.aspectRatio = String(a); const k = Math.min(1, a / (16 / 9)); st.style.width = (k * 100).toFixed(2) + '%'; st.style.marginLeft = st.style.marginRight = 'auto'; st.style.alignSelf = 'center' }
    }
    const el = document.getElementById('outRes')
    if (el) el.textContent = 'OUT ' + (info.w && info.h ? info.w + '×' + info.h + ' · ' : '') + ratioName(a) + (info.full ? ' · FULLSCREEN' : (info.w ? ' · WINDOW (F = FULLSCREEN)' : '')) + ' · RENDER ' + comp.W + '×' + comp.H
    if (!fromStore) { try { localStorage.setItem('hvft.stage', JSON.stringify(info)) } catch (e) {} }
  }
  try { const st = JSON.parse(localStorage.getItem('hvft.stage') || 'null'); if (st) applyStage(st, true) } catch (e) {}
  if (window.hvft && window.hvft.onOutInfo) window.hvft.onOutInfo(i => applyStage(i, false))
  if (window.hvft && window.hvft.getOutInfo) window.hvft.getOutInfo().then(i => { if (i) applyStage(i, false) }).catch(() => {})
  function setQuality (q) {
    _qual = q; window.HVFT_CRISP = (q === 'crisp'); try { localStorage.setItem('hvft.quality', q) } catch (e) {}
    if (_lastInfo) applyStage(_lastInfo, true); paintQual()
  }
  function paintQual () { const b = document.getElementById('qualBtn'); if (b) { b.textContent = { hd: 'HD', crisp: 'CRISP', lite: 'LITE' }[_qual] || 'HD'; b.classList.toggle('on', _qual !== 'lite') } }
  { const b = document.getElementById('qualBtn'); if (b) b.onclick = (e) => { e.stopPropagation(); setQuality({ hd: 'crisp', crisp: 'lite', lite: 'hd' }[_qual] || 'hd') } }
  paintQual()
  window.__deckStage = { apply: applyStage, refresh: () => { if (_lastInfo) applyStage(_lastInfo, true) }, setQuality, get aspect () { return _stageA }, layout: setLayout, get cur () { return curLayout() } }
  // PROJECTOR VIEW (proj_view.js, Oct 9): the projector window draws THIS page's channels — one engine, not two
  window.__deckProj = {
    comp,
    regions: () => regionsM || defGrid(),
    mix: () => _mix,
    get mapEdit () { return mapEdit }, get sel () { return mapSel },
    select (i) { if (regionsM && i >= 0 && i < regionsM.length) { mapSel = i; mapUI() } },
    setCorners (ri, cs) { if (!regionsM) regionsM = defGrid(); const r = regionsM[ri]; if (!r) return; r.corners = cs.map(p => [Math.max(-0.1, Math.min(1.1, p[0])), Math.max(-0.1, Math.min(1.1, p[1]))]); saveMapSoon() },
    toggleEdit (on) { setMapEdit(on) },
    applyStage, regionName
  }
  if (mapbar) mapbar.querySelectorAll('[data-map]').forEach(b => b.onclick = (e) => { e.stopPropagation(); mapAction(b.dataset.map) })
  const toN = (e) => { const rc = cv.getBoundingClientRect(); return [(e.clientX - rc.left) / rc.width, (e.clientY - rc.top) / rc.height] }
  function inQuad (x, y, c) { let ins = false; for (let i = 0, j = 3; i < 4; j = i++) { const xi = c[i][0], yi = c[i][1], xj = c[j][0], yj = c[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) ins = !ins } return ins }
  let mdrag = null
  cv.addEventListener('pointerdown', (e) => {
    if (!mapEdit || !regionsM) return
    const [x, y] = toN(e), rc = cv.getBoundingClientRect(), tol = 16 / rc.width
    let best = null, bd = 1e9
    regionsM.forEach((r, ri) => r.corners.forEach((p, ci) => { const dd = Math.hypot((p[0] - x) * rc.width, (p[1] - y) * rc.height); if (dd < bd) { bd = dd; best = [ri, ci] } }))
    if (best && bd <= 16) { mapSel = best[0]; mdrag = { mode: 'corner', ci: best[1], x, y } }
    else {
      let hit = -1; for (let ri = regionsM.length - 1; ri >= 0; ri--) { if (inQuad(x, y, regionsM[ri].corners)) { hit = ri; break } }
      if (hit >= 0) { mapSel = hit; mdrag = { mode: 'body', x, y, orig: regionsM[hit].corners.map(p => p.slice()) } }
    }
    void tol
    try { cv.setPointerCapture(e.pointerId) } catch (er) {}
    mapUI(); e.preventDefault()
  })
  cv.addEventListener('pointermove', (e) => {
    if (!mapEdit || !mdrag || !regionsM) return
    const [x, y] = toN(e), r = regionsM[mapSel], cl = (v) => Math.max(-0.1, Math.min(1.1, v))
    if (mdrag.mode === 'corner') r.corners[mdrag.ci] = [cl(x), cl(y)]
    else { const dx = x - mdrag.x, dy = y - mdrag.y; r.corners = mdrag.orig.map(p => [cl(p[0] + dx), cl(p[1] + dy)]) }
    saveMapSoon()
  })
  cv.addEventListener('pointerup', () => { mdrag = null })
  window.addEventListener('keydown', (e) => {
    if (!mapEdit || !regionsM) return
    const t = e.target; if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return
    const r = regionsM[mapSel], st = e.shiftKey ? 0.01 : 0.002
    const mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key]
    if (mv && r) { r.corners = r.corners.map(p => [p[0] + mv[0], p[1] + mv[1]]); saveMapSoon(); e.preventDefault(); e.stopPropagation() }
    else if (e.key === 'Tab') { mapAction(e.shiftKey ? 'prev' : 'next'); e.preventDefault(); e.stopPropagation() }
    else if (e.key === 'Escape' || e.key === 'Enter') { setMapEdit(false); e.preventDefault() }
  }, true)

  // ---- loop ----
  let _lastMic = null, _tick = 0
  function refreshLive () {
    const mic = micLive()
    if (mic !== _lastMic) {
      _lastMic = mic
      if (INS) INS.querySelectorAll('.pstat[data-band]').forEach(el => {
        const b = el.dataset.band; const cell = el.closest('.pcell')
        if (!b || b === 'off') el.textContent = '○ MANUAL'
        else el.textContent = mic ? '◎ REACTIVE · ' + BANDNAME[b] : '⊘ NO SIGNAL · ' + BANDLET[b]
        if (cell) cell.classList.toggle('react', !!(b && b !== 'off' && mic))
      })
    }
    if (INS && mic) INS.querySelectorAll('input[data-w][data-band]').forEach(i => { if (i.dataset.band !== 'off') i._draw && i._draw() })
    updateAiStat()
  }
  function loop () {
    if (typeof pipe !== 'undefined' && pipe.settings) comp.setControl(pipe.settings)
    comp.setAudio((typeof pipe !== 'undefined' && pipe.band) ? pipe.band : [0, 0, 0], (typeof pipe !== 'undefined' && pipe.onset) || 0, (typeof pipe !== 'undefined' && pipe.tick) || 0)
    if (++_efRotTick % 180 === 0) {
      let changed = false
      deck.layers.forEach(L => { if (L.on !== false && L.effects && L.effects.length > 1) { const p = L.effects[(Math.random() * L.effects.length) | 0]; if (p !== L.effect) { L.effect = p; changed = true } } })
      if (changed) buildComp()
    }
    comp.render(); drawMainPreview(); updateLayerPreviews(false)
    if (++_tick % 5 === 0) refreshLive()
    requestAnimationFrame(loop)
  }
  refreshCams(); render(); buildComp(); requestAnimationFrame(loop)
  try { navigator.mediaDevices.addEventListener('devicechange', refreshCams) } catch (e) {}
  window.__deck = deck
  window.__comp = comp   // TRACE RECORDER reads per-channel canvases
  // the hidden legacy pipe (#view, under the deck monitor) = audio analysis only (it rendered an invisible picture every frame)
  try { if (typeof pipe !== 'undefined' && pipe) { pipe.audioOnly = true; if (pipe.useNetCam && pipe.stopNetworkCamera) pipe.stopNetworkCamera(true) } } catch (e) {}   // + close a phone stream it opened at boot (the deck channel opens its own)
  window.__deckPreview = updateLayerPreviews
})()
