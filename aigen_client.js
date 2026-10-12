// HVFT VISION — aigen_client.js (Oct 12)
// AI GEN (local): camera frame -> ai_service (SD-Turbo on the Mac GPU) -> CH4, as fast as the GPU answers.
// Prompt-driven like Gemini, but local, free and continuous. Frames go straight to the channel as a canvas
// (layer_comp LIVE path) — no JPEG round-trip into the comp, no fade lag.
;(function () {
  const BASE = 'http://127.0.0.1:8765'
  const PRESETS = [
    ['90s COMIC', '1990s american superhero comic book art, bold black ink outlines, heavy crosshatching, dramatic black shadows, saturated early digital colors'],
    ['80s ANIME', '1980s anime film cel, hand drawn line art, soft painted background, pastel colors, film grain'],
    ['INK MANGA', 'black and white manga page, heavy brush ink, screentone shading, high contrast'],
    ['NOISE ZINE', 'photocopied punk noise zine, harsh xerox black and white, gritty halftone, torn paper'],
    ['OIL PAINT', 'expressive oil painting, thick impasto brush strokes, dramatic light'],
    ['CYBORG', 'chrome cyborg, biomechanical armor, glowing circuitry, dark sci-fi'],
    ['X-RAY', 'x-ray radiograph, glowing pale cyan bones and skeleton, pure black background'],
    ['FIRE', 'figure made of burning fire and embers, glowing lava cracks, black background']
  ]
  let prompt = PRESETS[0][1], strength = 0.5
  try { const p = localStorage.getItem('hvft_sd_prompt'); if (p) prompt = p; const s = parseFloat(localStorage.getItem('hvft_sd_strength')); if (!isNaN(s)) strength = s } catch (e) {}
  const S = window.HVFT_AIGEN = {
    on: false, status: 'AI GEN: stopped', fps: 0, ms: 0, presets: PRESETS,
    get prompt () { return prompt }, set prompt (v) { prompt = String(v || ''); try { localStorage.setItem('hvft_sd_prompt', prompt) } catch (e) {} },
    get strength () { return strength }, set strength (v) { strength = Math.max(0.2, Math.min(0.9, +v || 0.5)); try { localStorage.setItem('hvft_sd_strength', String(strength)) } catch (e) {} },
    start, stop, toggle () { return S.on ? stop() : start() }
  }
  const cap = document.createElement('canvas'), cx = cap.getContext('2d')
  const out = document.createElement('canvas'), ox = out.getContext('2d')
  let run = 0, inflight = 0, nOk = 0, t0 = 0
  const set = (m) => { S.status = m }
  async function health () { try { const r = await fetch(BASE + '/health', { cache: 'no-store' }); return await r.json() } catch (e) { return null } }

  async function start () {
    if (S.on) return
    S.on = true; const my = ++run
    set('AI GEN: starting the local engine…')
    if (window.hvft && window.hvft.aigenStart) {
      const r = await window.hvft.aigenStart().catch(e => ({ ok: false, error: e && e.message }))
      if (!r || !r.ok) { set('AI GEN: ' + ((r && r.error) || 'could not start')); S.on = false; return }
    }
    // wait until the model is loaded (first time: download ~2.6 GB)
    for (let k = 0; S.on && my === run; k++) {
      const h = await health()
      if (h && h.status === 'ready') break
      if (h && h.status === 'error') { set('AI GEN error: ' + h.msg); S.on = false; return }
      set('AI GEN: ' + (h ? h.msg : 'waiting for the engine…') + ' · ' + k + ' s')
      await new Promise(r => setTimeout(r, 1000))
    }
    if (!S.on || my !== run) return
    set('AI GEN: running'); nOk = 0; t0 = performance.now()
    pump(my); pump(my)            // 2 in flight: the next frame uploads while the GPU works on this one
  }
  function stop () {
    S.on = false; run++
    set('AI GEN: stopped'); S.fps = 0
    if (window.__deckClearAi) window.__deckClearAi()
  }
  async function frameBlob () {
    const src = (typeof aiSourceEl === 'function') ? await aiSourceEl() : null
    const sw = src ? (src.videoWidth || src.width || 0) : 0, sh = src ? (src.videoHeight || src.height || 0) : 0
    if (!sw || !sh) return null
    const k = 512 / Math.max(sw, sh), W = Math.max(64, Math.floor(sw * k / 64) * 64), H = Math.max(64, Math.floor(sh * k / 64) * 64)
    if (cap.width !== W) cap.width = W
    if (cap.height !== H) cap.height = H
    cx.drawImage(src, 0, 0, W, H)
    return new Promise(r => cap.toBlob(r, 'image/jpeg', 0.85))
  }
  async function pump (my) {
    while (S.on && my === run) {
      if (!window.HVFT_AI_LIVE_ON) { set('AI GEN: turn on CH4 first'); await new Promise(r => setTimeout(r, 500)); continue }
      const blob = await frameBlob()
      if (!blob) { await new Promise(r => setTimeout(r, 200)); continue }
      inflight++
      try {
        const res = await fetch(BASE + '/gen', { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg', 'X-Prompt': encodeURIComponent(prompt), 'X-Strength': String(strength), 'X-Seed': '42' } })
        if (!res.ok) { set('AI GEN: engine busy / ' + res.status); await new Promise(r => setTimeout(r, 500)); continue }
        const bmp = await createImageBitmap(await res.blob())
        if (!S.on || my !== run) { bmp.close && bmp.close(); break }
        if (out.width !== bmp.width) out.width = bmp.width
        if (out.height !== bmp.height) out.height = bmp.height
        ox.drawImage(bmp, 0, 0); bmp.close && bmp.close()
        window.HVFT_AI_LIVE_CANVAS = out; window.HVFT_AI_LIVE_T = performance.now()
        S.ms = +(res.headers.get('X-Ms') || 0); nOk++
        const dt = (performance.now() - t0) / 1000; if (dt > 2) { S.fps = nOk / dt; nOk = 0; t0 = performance.now() }
        set('AI GEN: ' + S.fps.toFixed(1) + ' fps · GPU ' + S.ms + ' ms')
      } catch (e) { set('AI GEN: engine not reachable — restarting'); await new Promise(r => setTimeout(r, 1000)); if (window.hvft && window.hvft.aigenStart) window.hvft.aigenStart() }
      finally { inflight-- }
    }
  }
  // status text into the inspector
  setInterval(() => { document.querySelectorAll('[data-sdstat]').forEach(el => { if (el.textContent !== S.status) el.textContent = S.status }) }, 400)
})()
