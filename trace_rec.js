// HVFT TRACE RECORDER (Oct 7) — learn how BG patterns and text react to the live noise.
// Records ~90 s: audio analysis at ~30 Hz, per-channel visual activity (motion + brightness) at ~15 Hz,
// channel settings once a second, and a small JPEG every 250 ms (deck mix on top, CH1–CH4 below).
// Saved by main.js into logs/trace_<stamp>/ (trace.jsonl + f_0001.jpg …).
// Starts by itself once per launch, 6 s after the mic is armed; Shift+T starts/stops another run by hand.
(function () {
  if (typeof window === 'undefined' || !window.hvft || !window.hvft.trace) return
  const DUR = 90000, A_MS = 33, V_MS = 66, F_MS = 250
  const send = (m) => { try { window.hvft.trace(m) } catch (e) {} }
  const P = () => (typeof pipe !== 'undefined' ? pipe : null)
  let on = false, t0 = 0, lastA = 0, lastV = 0, lastF = 0, lastM = 0, nF = 0, lines = [], frames = 0, fpsT = 0, fpsN = 0, fps = 0, autoDone = false, micSince = 0
  // tiny canvases for activity metrics (32×18 per channel) and the JPEG sheet (320×360)
  const tiny = document.createElement('canvas'); tiny.width = 32; tiny.height = 18
  const tx = tiny.getContext('2d', { willReadFrequently: true })
  const prev = []
  const sheet = document.createElement('canvas'); sheet.width = 320; sheet.height = 360
  const sx = sheet.getContext('2d')
  const hud = document.createElement('div')
  hud.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:99999;font:700 12px/1 monospace;padding:7px 10px;border:1px solid #F2A03D;background:#000c;color:#F2A03D;letter-spacing:.08em;display:none;pointer-events:none'
  document.body.appendChild(hud)

  const comp = () => window.__comp || null
  const mixCv = () => document.getElementById('deckcv')
  const layerCv = (i) => { const c = comp(); try { return c && c.getLayerCanvas ? c.getLayerCanvas(i) : null } catch (e) { return null } }
  const r3 = (v) => Math.round((v || 0) * 1000) / 1000

  function activity (cv, k) {   // mean luminance + mean abs change vs the previous sample (0..1)
    if (!cv || cv.width < 3) { prev[k] = null; return [0, 0] }
    tx.clearRect(0, 0, 32, 18); tx.drawImage(cv, 0, 0, 32, 18)
    const d = tx.getImageData(0, 0, 32, 18).data, n = 32 * 18, g = new Float32Array(n)
    let s = 0, df = 0
    for (let i = 0, j = 0; i < n; i++, j += 4) { const a = d[j + 3] / 255, v = (d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11) * a / 255; g[i] = v; s += v }
    const p = prev[k]; if (p) for (let i = 0; i < n; i++) df += Math.abs(g[i] - p[i])
    prev[k] = g
    return [r3(s / n), r3(p ? df / n : 0)]
  }
  function meta () {
    const D = window.__deck, pp = P()
    return {
      amt: pp && pp.settings ? pp.settings.audioAmt : null, band: pp && pp.settings ? pp.settings.audioBand : null,
      ain: (() => { try { const I = window.HVFT_AUDIO_IN; return I ? { cfg: I.cfg(), info: pp && pp.audioInfo } : null } catch (e) { return null } })(),
      ch: D ? D.layers.map((L, i) => ({ i: i + 1, on: L.on !== false, src: L.src, fx: L.effect, fxs: L.effects, bg: L.bgfx, bgP: L.bgfxPower, bgB: L.bgBrutal, col: L.color, op: L.opacity, blend: L.blend, txt: L.textCfg ? { mode: L.textCfg.mode, react: L.textCfg.react, size: L.textCfg.size, orient: L.textCfg.orient, str: (L.textCfg.str || '').slice(0, 40) } : null, strobe: L.strobe, par: L.fxParams, link: L.fxLinks })) : null
    }
  }
  function flush () { if (lines.length) { send({ k: 'lines', s: lines.join('\n') + '\n' }); lines = [] } }
  function start (why) {
    if (on) return
    on = true; t0 = performance.now(); lastA = lastV = lastF = lastM = 0; nF = 0; frames = 0; prev.length = 0
    const d = new Date(), z = (x) => String(x).padStart(2, '0')
    send({ k: 'begin', id: d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '_' + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds()) })
    lines.push(JSON.stringify({ k: 'start', why, ua: navigator.userAgent, dur: DUR }))
    hud.style.display = 'block'
  }
  function stop (why) {
    if (!on) return
    on = false; lines.push(JSON.stringify({ k: 'stop', why, t: Math.round(performance.now() - t0), frames: nF })); flush(); send({ k: 'end' })
    hud.textContent = '■ TRACE SAVED'; setTimeout(() => { if (!on) hud.style.display = 'none' }, 2500)
  }
  window.HVFT_TRACE = { start, stop, get on () { return on } }

  function tick (now) {
    requestAnimationFrame(tick)
    fpsN++; if (now - fpsT > 1000) { fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now }
    // auto start: once per launch, 6 s after the mic gate opened
    const mic = !!window.HVFT_MIC_ON
    if (!mic) micSince = 0; else if (!micSince) micSince = now
    if (!autoDone && mic && micSince && now - micSince > 6000) { autoDone = true; start('auto') }
    if (!on) return
    const t = Math.max(0, now - t0)
    if (t > DUR) { stop('time'); return }
    hud.textContent = '● TRACE ' + Math.ceil((DUR - t) / 1000) + 's  (⇧T stop)'
    const pp = P()
    if (now - lastA >= A_MS && pp) {
      lastA = now
      const A = window.HVFT_AUDIO || {}
      lines.push(JSON.stringify({ k: 'a', t: Math.round(t), lo: r3(A.low), mi: r3(A.mid), hi: r3(A.high), sel: r3(A.sel), on: r3(A.onset), amt: r3(A.amt), fl: r3(A.flat), cr: r3(A.crest), sh: r3(A.sharp), wd: r3(A.wide), fx: r3(pp.flux * 100), fa: r3(pp.fluxAvg * 100), ce: r3(pp.centroid), bn: pp.beatN | 0, top: Math.round(pp.dbTop || 0), mic: mic ? 1 : 0, fps: Math.round(fps * 10) / 10 }))
    }
    if (now - lastV >= V_MS) {
      lastV = now
      const v = { k: 'v', t: Math.round(t), mix: activity(mixCv(), 0) }
      for (let i = 0; i < 4; i++) v['c' + (i + 1)] = activity(layerCv(i), i + 1)
      lines.push(JSON.stringify(v))
    }
    if (now - lastM >= 1000) { lastM = now; lines.push(JSON.stringify(Object.assign({ k: 'm', t: Math.round(t) }, meta()))); flush() }
    if (now - lastF >= F_MS) {
      lastF = now
      try {
        sx.fillStyle = '#000'; sx.fillRect(0, 0, 320, 360)
        const m = mixCv(); if (m) sx.drawImage(m, 0, 0, 320, 180)
        for (let i = 0; i < 4; i++) { const c = layerCv(i); if (c) sx.drawImage(c, (i % 2) * 160, 180 + (i >> 1) * 90, 160, 90) }
        sx.fillStyle = '#F2A03D'; sx.font = '10px monospace'; sx.fillText((t / 1000).toFixed(2) + 's', 4, 12)
        const b64 = sheet.toDataURL('image/jpeg', 0.72).split(',')[1]
        send({ k: 'frame', n: ++nF, b64 })
        lines.push(JSON.stringify({ k: 'f', t: Math.round(t), n: nF }))
      } catch (e) {}
    }
  }
  requestAnimationFrame(tick)
  document.addEventListener('keydown', (e) => {
    const t = e.target, tag = t && t.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return
    if (e.shiftKey && (e.key === 'T' || e.key === 't')) { if (on) stop('key'); else start('key'); e.preventDefault() }
  })
})()
