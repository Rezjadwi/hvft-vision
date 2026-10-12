// HVFT VISION — rvm_engine.js (Oct 8, v3) — RVM MATTE: Robust Video Matting (PeterL1n, GPL-3.0,
// github.com/PeterL1n/RobustVideoMatting), MobileNetV3 fp32 ONNX in vendor/models (read by main.js 'get-rvm-model').
// A video-matting net with memory: soft hair / finger edges and a cut-out that does not flicker.
// v3: the net runs in a WEB WORKER on the CPU (rvm_worker.js, ONNX Runtime wasm). v1/v2 ran on WebGPU inside the page
// and froze / crashed the control window on this Mac (busy GPU queue -> every canvas read-back waited).
//   * ONE active RVM per page: the deck channel pipe owns it (priority over the hidden legacy pipe); other pipes keep
//     MediaPipe (owner released after 2 s without frames)
//   * the page only scales the frame to <= 320 px and posts it; the worker answers with the alpha (~5–10 fps)
//   * a run slower than 600 ms three times in a row, or a worker error -> RVM off for this session, MediaPipe takes
//     over, the reason is logged ([HVFT info] RVM off: ...) and shown in the CROP / MATTE panel
// Needs internet once per launch for ONNX Runtime (CDN), like Depth-AI / Anime GAN.
;(function () {
  if (typeof window === 'undefined') return
  const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.wasm.min.js'
  const WASM_PATHS = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/'
  let wk = null, ready = false, starting = false, off = '', owner = null, ownerT = 0, ownerP = 0, slow = 0, seq = 0, pending = false
  function kill (why) {
    if (off) return
    off = why
    try { console.error('[HVFT info] RVM off: ' + why + ' -> MediaPipe cut-out') } catch (e) {}
    try { if (wk) wk.terminate() } catch (e) {}
    wk = null
  }
  async function start () {
    if (wk || starting || off) return
    starting = true
    try {
      const m = window.hvft && window.hvft.getRvmModel ? await window.hvft.getRvmModel() : null
      if (!m || !m.ok) throw new Error((m && m.error) || 'RVM model missing — restart the app')
      wk = new Worker('rvm_worker.js')
      wk.onmessage = (e) => {
        const d = e.data || {}
        if (d.type === 'ready') { ready = true; try { console.error('[HVFT info] RVM matte ready (worker / CPU)') } catch (er) {} }
        else if (d.type === 'alpha') {
          pending = false
          if (d.ms > 600) { if (++slow >= 3) kill('too slow (' + Math.round(d.ms) + ' ms per frame)') } else slow = 0
          if (owner) { owner.alpha = d.a; owner.aw = d.w; owner.ah = d.h; owner.t = performance.now() }
        } else if (d.type === 'skip') pending = false
        else if (d.type === 'error') kill('worker: ' + d.error)
      }
      wk.onerror = (e) => kill('worker failed: ' + ((e && e.message) || 'load error'))
      const cfg = window.HVFT_RVM_CFG || {}
      wk.postMessage({ type: 'init', buf: m.buf, ortUrl: cfg.ortUrl || ORT_URL, wasmPaths: cfg.wasmPaths || WASM_PATHS }, [m.buf])
    } catch (e) { kill('unavailable: ' + (e && e.message)) }
    starting = false
  }
  class HvftRvm {
    constructor () {
      this.alpha = null; this.aw = 0; this.ah = 0; this.t = 0
      this.cv = document.createElement('canvas'); this.cx = this.cv.getContext('2d', { willReadFrequently: true })
    }
    get failed () { return !!off }
    get active () { return owner === this && !off }
    reset () { this.alpha = null }
    // feed the newest frame (any canvas); returns immediately. Only the owning pipe sends frames.
    push (src, maxSide, prio) {   // prio 1 = a deck channel pipe (wins over the hidden legacy pipe)
      if (off || !src || !(src.width > 8)) return
      const now = performance.now(), pr = prio | 0
      if (owner && owner !== this && now - ownerT < 2000 && pr <= ownerP) return   // another pipe owns RVM
      if (owner !== this) { if (wk && ready) wk.postMessage({ type: 'reset' }) }
      owner = this; ownerT = now; ownerP = pr
      if (!wk) { start(); return }
      if (!ready || pending) return
      const ms = Math.min(maxSide || 320, 320), sc = Math.min(1, ms / Math.max(src.width, src.height))
      const w = Math.max(16, Math.round(src.width * sc / 4) * 4), h = Math.max(16, Math.round(src.height * sc / 4) * 4)
      if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h }
      this.cx.drawImage(src, 0, 0, w, h)
      const px = this.cx.getImageData(0, 0, w, h).data, N = w * h, f = new Float32Array(3 * N)
      for (let i = 0, j = 0; i < N; i++, j += 4) { f[i] = px[j] / 255; f[N + i] = px[j + 1] / 255; f[2 * N + i] = px[j + 2] / 255 }
      pending = true
      wk.postMessage({ type: 'run', id: ++seq, w, h, f, ds: Math.min(1, 224 / Math.min(w, h)) }, [f.buffer])
    }
  }
  window.HvftRvm = HvftRvm
  window.HVFT_RVM_INFO = () => ({ provider: wk ? 'worker-wasm' : '', off, owner: !!owner, ready })
})()
