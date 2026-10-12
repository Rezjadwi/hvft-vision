// HVFT VISION — isf_fx.js (Oct 7) — ISF SHADER FX on any channel
// ISF = Interactive Shader Format, the shader standard of VDMX / Resolume / MadMapper.
// Renderer: interactive-shader-format-js (MIT, github.com/msfeldstein/interactive-shader-format-js) -> vendor/isf.js
// Shaders: Vidvox ISF-Files (MIT) — 60 curated in isf_pack.js (GLITCH / FEEDBACK / WARP / STYLE).
// Per channel: L.isf = { id, mix 0..1, v: { input: value }, link: { input: { band, amt } } }
//   float  : v = 0..1 across the shader's MIN..MAX; link band (L M H + N P S noise texture) pushes it with the noise
//   bool   : v = true/false; a linked bool flips while its band is high
//   long   : v = one of the shader's VALUES
//   event  : fires on every noise hit (onset rising edge) — e.g. Shockwave Pulse, Resize Glitch "glitch now"
//   image  : extra image inputs get the channel picture itself
// One hidden WebGL canvas per page; each channel keeps its own renderer (feedback buffers stay per channel).
// Mic OFF -> links and events do nothing (the shader still runs with its set values).
;(function () {
  const NS = window.interactiveShaderFormat
  if (!NS || !NS.Renderer || !window.HVFT_ISF_PACK) return
  const PACK = {}; for (const e of window.HVFT_ISF_PACK) PACK[e.id] = e
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v
  let glc = null, gl = null, failed = false
  const RS = new Map()     // key "<channel>|<id>" -> { r, id, hit }
  const META = {}          // id -> inputs (without inputImage)

  function ensureGL () {
    if (gl || failed) return gl
    try {
      glc = document.createElement('canvas'); glc.width = 1280; glc.height = 720
      gl = glc.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false })
      if (!gl) throw new Error('no webgl')
      ;['OES_texture_float', 'OES_texture_float_linear', 'WEBGL_color_buffer_float', 'OES_standard_derivatives'].forEach(x => { try { gl.getExtension(x) } catch (e) {} })
      glc.addEventListener('webglcontextlost', (e) => { e.preventDefault(); RS.clear() })
      glc.addEventListener('webglcontextrestored', () => { RS.clear() })
    } catch (e) { failed = true; gl = null; try { console.error('[HVFT info] ISF FX unavailable: ' + (e && e.message)) } catch (e2) {} }
    return gl
  }
  function inputs (id) {
    if (META[id]) return META[id]
    const P = PACK[id]; if (!P) return []
    try {
      const ps = new NS.Parser(); ps.parse(P.fs, P.vs || undefined)
      META[id] = (ps.inputs || []).filter(d => d.NAME !== 'inputImage')
    } catch (e) { META[id] = [] }
    return META[id]
  }
  function rendererFor (key, id) {
    let o = RS.get(key)
    if (o && o.id === id) return o
    if (o) { try { o.r.cleanup && o.r.cleanup() } catch (e) {} RS.delete(key) }
    const P = PACK[id]; if (!P || !ensureGL()) return null
    try {
      const r = new NS.Renderer(gl); r.loadSource(P.fs, P.vs || undefined)
      o = { r, id, hit: false, ok: !!r.valid }
      if (!o.ok) { try { console.error('[HVFT info] ISF ' + P.name + ' invalid: ' + String(r.error).slice(0, 120)) } catch (e) {} }
    } catch (e) { o = { r: null, id, ok: false } }
    RS.set(key, o)
    return o
  }
  function bandVal (A, b) { return b && b !== 'off' ? (+A[b] || 0) : 0 }
  // normalised default of a float input
  function defNorm (d) { const mn = d.MIN != null ? d.MIN : 0, mx = d.MAX != null ? d.MAX : 1; return mx > mn ? clamp(((d.DEFAULT != null ? d.DEFAULT : mn) - mn) / (mx - mn), 0, 1) : 0 }

  // run the shader on a channel canvas in place
  function apply (c, cv, cfg, key) {
    if (!cfg || !cfg.id || cfg.id === 'none') return false
    const W = cv.width, H = cv.height; if (W < 4 || H < 4) return false
    const o = rendererFor(key + '|' + cfg.id, cfg.id); if (!o || !o.ok) return false
    const r = o.r
    if (glc.width !== W || glc.height !== H) { glc.width = W; glc.height = H }
    const live = !!window.HVFT_MIC_ON, A = live ? (window.HVFT_AUDIO || {}) : {}
    const amt = A.amt == null ? 1 : A.amt
    const hit = live && (A.onset || 0) > 0.45, rise = hit && !o.hit; o.hit = hit
    const V = cfg.v || {}, LK = cfg.link || {}
    for (const d of inputs(cfg.id)) {
      const n = d.NAME, lk = LK[n], t = d.TYPE
      try {
        if (t === 'float') {
          let v = V[n] != null ? +V[n] : defNorm(d)
          if (lk && lk.band && lk.band !== 'off') v = clamp(v + bandVal(A, lk.band) * (lk.amt != null ? +lk.amt : 0.5) * amt, 0, 1)
          const mn = d.MIN != null ? d.MIN : 0, mx = d.MAX != null ? d.MAX : 1
          r.setValue(n, mn + (mx - mn) * v)
        } else if (t === 'bool') {
          let v = V[n] != null ? !!V[n] : !!d.DEFAULT
          if (lk && lk.band && lk.band !== 'off' && bandVal(A, lk.band) * amt > 0.62) v = !v
          r.setValue(n, v)
        } else if (t === 'long') {
          r.setValue(n, V[n] != null ? +V[n] : (d.DEFAULT != null ? d.DEFAULT : (d.VALUES ? d.VALUES[0] : 0)))
        } else if (t === 'event') {
          r.setValue(n, !!(rise && V[n] !== false))
        } else if (t === 'image') {
          r.setValue(n, cv)
        }
      } catch (e) {}
    }
    try {
      r.setValue('inputImage', cv); r.pushTextures(); r.draw(glc)
    } catch (e) { o.ok = false; return false }
    const mix = cfg.mix != null ? clamp(+cfg.mix, 0, 1) : 1
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0)
    if (mix >= 0.999) { c.globalCompositeOperation = 'copy'; c.globalAlpha = 1 } else { c.globalCompositeOperation = 'source-over'; c.globalAlpha = mix }
    c.drawImage(glc, 0, 0, W, H)
    c.restore()
    return true
  }
  // default set-up when a shader is picked: its first float follows LOW (harsh noise -> it moves straight away)
  function freshCfg (id, prev) {
    const cfg = { id, mix: prev && prev.mix != null ? prev.mix : 1, v: {}, link: {} }
    const f = inputs(id).find(d => d.TYPE === 'float')
    if (f) cfg.link[f.NAME] = { band: 'low', amt: 0.5 }
    return cfg
  }
  const LIST = window.HVFT_ISF_PACK.map(e => ({ id: e.id, name: e.name, cat: e.cat }))
  window.HVFT_ISF = { list: LIST, byId: (id) => LIST.find(e => e.id === id), inputs, apply, freshCfg, defNorm, drop: (key) => { for (const k of [...RS.keys()]) if (k.indexOf(key + '|') === 0) RS.delete(k) } }
})()
