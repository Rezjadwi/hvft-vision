// HVFT VISION — rvm_worker.js (Oct 8) — runs RVM (Robust Video Matting, GPL-3.0) OFF the main thread, on the CPU
// (ONNX Runtime wasm). v1 ran on WebGPU in the page and froze / crashed the control window on this Mac:
// the GPU queue was busy, every per-frame canvas read-back had to wait. Here the page only posts small frames.
/* global ort */
let sess = null, rec = null, busy = false
self.onmessage = async (e) => {
  const m = e.data || {}
  try {
    if (m.type === 'init') {
      importScripts(m.ortUrl)
      ort.env.wasm.wasmPaths = m.wasmPaths
      ort.env.wasm.numThreads = 1
      sess = await ort.InferenceSession.create(m.buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
      self.postMessage({ type: 'ready' })
    } else if (m.type === 'reset') {
      rec = null
    } else if (m.type === 'run') {
      if (!sess || busy) { self.postMessage({ type: 'skip', id: m.id }); return }
      busy = true
      const { w, h, f, ds } = m
      const T = (d, dims) => new ort.Tensor('float32', d, dims)
      const z = () => T(new Float32Array(1), [1, 1, 1, 1])
      if (!rec || rec.w !== w || rec.h !== h) rec = { w, h, r: [z(), z(), z(), z()] }
      const t0 = performance.now()
      const out = await sess.run({ src: T(f, [1, 3, h, w]), r1i: rec.r[0], r2i: rec.r[1], r3i: rec.r[2], r4i: rec.r[3], downsample_ratio: T(new Float32Array([ds]), [1]) })
      rec.r = [out.r1o, out.r2o, out.r3o, out.r4o]
      const a = new Float32Array(out.pha.data)
      busy = false
      self.postMessage({ type: 'alpha', id: m.id, w, h, a, ms: performance.now() - t0 }, [a.buffer])
    }
  } catch (err) {
    busy = false
    self.postMessage({ type: 'error', error: String((err && err.message) || err) })
  }
}
