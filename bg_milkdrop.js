// HVFT VISION — bg_milkdrop.js (Oct 7) — BG PATTERN "MILKDROP"
// Butterchurn (MIT, github.com/jberg/butterchurn) = the classic Milkdrop visualiser in WebGL2, with its preset packs
// (vendor/butterchurn*.min.js). It is fed the SAME live input as the rest of the app (window.HVFT_WAVE, written by the
// pipeline), never its own mic, so the mic gate still rules: mic OFF = silence, slow time, dimmed.
// One visualiser per page (shared by every channel that uses it) and it renders once per frame.
// Params: Preset Change (how easily a noise spike jumps to another preset; 0 = never), Blend Time (cross-fade between
// presets), Own Colours (100 % = the preset's colours, lower = run through the channel COLOR like the other patterns).
// P = next preset by hand (was Shift+M, which also toggled the mic [M]); also the NEXT PRESET button in the BG panel.
;(function () {
  if (typeof HVFT_EFFECTS === 'undefined') return
  const BC = window.butterchurn && (window.butterchurn.default || window.butterchurn)
  if (!BC || !BC.createVisualizer) return
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v
  let V = null, cv = null, ac = null, presets = null, keys = [], cur = '', failed = false
  let lastT = 0, lastChange = 0, prevHit = false, tmp = null, tctx = null, timg = null
  const silent = new Uint8Array(1024).fill(128)
  function allPresets () {
    if (presets) return presets
    presets = {}
    try { if (window.butterchurnPresets) Object.assign(presets, window.butterchurnPresets.getPresets()) } catch (e) {}
    try { if (window.butterchurnPresetsExtra) Object.assign(presets, window.butterchurnPresetsExtra.getPresets()) } catch (e) {}
    keys = Object.keys(presets)
    return presets
  }
  function next (blend) {
    if (!V || !keys.length) return
    let k = cur
    for (let n = 0; n < 6 && k === cur; n++) k = keys[(Math.random() * keys.length) | 0]
    cur = k; lastChange = performance.now()
    try { V.loadPreset(presets[k], blend || 0) } catch (e) {}
  }
  function ensure (w, h) {
    if (failed) return null
    if (V) { if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; try { V.setRendererSize(w, h) } catch (e) {} } return V }
    try {
      cv = document.createElement('canvas'); cv.width = w; cv.height = h
      ac = new (window.AudioContext || window.webkitAudioContext)()
      try { ac.suspend() } catch (e) {}   // only needed by the constructor; audio comes from HVFT_WAVE
      V = BC.createVisualizer(ac, cv, { width: w, height: h, pixelRatio: 1, textureRatio: 1 })
      allPresets(); next(0)
      return V
    } catch (e) { failed = true; V = null; try { console.error('[HVFT info] MILKDROP unavailable: ' + (e && e.message)) } catch (e2) {} return null }
  }
  window.HVFT_MILKDROP = { next: () => next(1.2), get preset () { return cur }, get count () { return keys.length } }
  try { document.addEventListener('keydown', e => { const t = e.target, tag = t && t.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return; if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'P' || e.key === 'p')) { next(1.2); e.preventDefault() } }) } catch (e) {}

  function milkV (ctx, f, D) {
    const W = D.W | 0, H = D.H | 0
    const v = ensure(W, H)
    if (!v) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return }
    const rc = typeof _react === 'function' ? _react(f) : 0
    const live = rc > 0.001 && !!window.HVFT_MIC_ON
    const change = fxp(f, 'change', 0.5), blend = fxp(f, 'blend', 0.5), own = fxp(f, 'colour', 1)
    const now = performance.now()
    if (now - lastT > 8) {   // one render per frame for every channel on this page
      const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 1 / 60
      lastT = now
      const wb = (live && window.HVFT_WAVE && window.HVFT_WAVE.length >= 1024) ? window.HVFT_WAVE : silent
      try { v.render({ audioLevels: { timeByteArray: wb, timeByteArrayL: wb, timeByteArrayR: wb }, elapsedTime: live ? dt : dt * 0.35 }) } catch (e) {}
      // noise spike -> maybe another preset (never more often than every 2.5 s); long quiet stretch -> drift on
      const A = window.HVFT_AUDIO || {}, hit = live && (A.onset || 0) > 0.45
      if (change > 0.01 && live) {
        if (hit && !prevHit && now - lastChange > 2500 && Math.random() < change * change * 0.35) next(blend * 4)
        else if (now - lastChange > 60000 * (1.1 - change)) next(blend * 4)
      }
      prevHit = hit
    }
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)
    if (!live) ctx.globalAlpha = 0.45
    if (own >= 0.99 || !f.lut) ctx.drawImage(cv, 0, 0, W, H)
    else {
      // through the channel COLOR: luminance -> LUT, mixed with the preset's own colours by "Own Colours"
      if (!tmp || tmp.width !== W || tmp.height !== H) { tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; tctx = tmp.getContext('2d', { willReadFrequently: true }); timg = null }
      tctx.drawImage(cv, 0, 0, W, H)
      const im = tctx.getImageData(0, 0, W, H), d = im.data, lut = f.lut, k = clamp(own, 0, 1)
      for (let j = 0; j < d.length; j += 4) {
        const l = (d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11) | 0
        d[j] = d[j] * k + lut[l * 3] * (1 - k); d[j + 1] = d[j + 1] * k + lut[l * 3 + 1] * (1 - k); d[j + 2] = d[j + 2] * k + lut[l * 3 + 2] * (1 - k)
      }
      tctx.putImageData(im, 0, 0)
      ctx.drawImage(tmp, 0, 0)
    }
    ctx.restore()
  }

  HVFT_FX_PARAMS.milkdrop = [['change', 'Preset Change', 0.5], ['blend', 'Blend Time', 0.5], ['colour', 'Own Colours', 1]]
  const e = { id: 'milkdrop', name: 'Milkdrop (pattern)', pixels: (f) => { const o = f.out; o.fill(0); for (let j = 3; j < o.length; j += 4) o[j] = 255 }, vector: milkV, maxRes: 960, bgRes: 640 }
  if (typeof HVFT_GEN_FX !== 'undefined') HVFT_GEN_FX.add('milkdrop')
  if (!HVFT_EFFECTS.some(x => x.id === 'milkdrop')) HVFT_EFFECTS.push(e)
  window.HVFT_BG_EXTRA = (window.HVFT_BG_EXTRA || []).concat([['milkdrop', 'MILKDROP', 'Classic Milkdrop visualiser (Butterchurn) fed by your noise — hundreds of presets; noise spikes jump to a new preset (Preset Change), Own Colours 100 % = preset colours, lower = channel COLOR. P = next preset.']])
})()
