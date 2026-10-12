// HVFT VISION — depth_engine.js (versi browser/renderer)
// Estimasi kedalaman monokular LIVE dari kamera Mac.
// Model: Depth Anything V2 Small (ONNX, onnx-community) via ONNX Runtime Web + WebGPU.
//   - WebGPU = pakai GPU Metal Mac (cepat). Fallback ke wasm kalau WebGPU tak ada.
//   - Apache-2.0 (bebas komersial). ~ realtime di Apple Silicon pada resolusi kecil.
// Output frame: { w,h, depthMM, rgb, fx,fy,cx,cy } — sama persis kontrak LiDAR,
// jadi langsung masuk pipe.pushLidarFrame(). Depth relatif -> mode Relief menormalkan.
// Global `ort` dimuat dari CDN (script ort.webgpu di control.html).

const HVFT_DA_MODEL =
  'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx'

// ONE ONNX RUN AT A TIME per window: the WebGPU backend refuses a second run while another session is running
// ("Session already started" when Depth-AI and Anime GAN overlap). Every engine queues through hvftOrtRun.
if (typeof window !== 'undefined' && !window.hvftOrtRun) {
  let _ortChain = Promise.resolve()
  window.hvftOrtRun = (session, feeds) => { const p = _ortChain.then(() => session.run(feeds)); _ortChain = p.catch(() => {}); return p }
}
class DepthEngine {
  constructor () {
    this.ready = false; this.loading = false; this.busy = false
    this.session = null
    this.S = 252            // ukuran input (kelipatan 14 utk ViT). 252=14*18. Kecil = cepat.
    this.provider = ''
    this.onState = () => {}
    this._ema = 0.6         // smoothing antar-frame (0 = tak halus, 0.8 = sangat halus)
  }

  async init () {
    if (this.ready || this.loading) return this.ready
    this.loading = true
    try {
      if (typeof ort === 'undefined') throw new Error('ORT not loaded yet')
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/'
      ort.env.wasm.numThreads = 1; ort.env.wasm.simd = true
      let buf = null
      if (window.hvft && window.hvft.getDepthModel) {
        this.onState('loading depth model...')
        const m = await window.hvft.getDepthModel()
        if (!m || !m.ok) throw new Error((m && m.error) || 'model failed')
        if (!m.cached) this.onState('model downloaded & cached (one time)')
        buf = m.buf
      } else {
        this.onState('downloading depth model (~100MB)...')
        const r = await fetch(HVFT_DA_MODEL)
        if (!r.ok) throw new Error('model download failed (' + r.status + ')')
        buf = await r.arrayBuffer()
      }
      this.onState('loading model on GPU...')
      // coba WebGPU dulu, jatuh ke wasm bila gagal
      try {
        if ((typeof window !== 'undefined' && window.HVFT_GPU_CRASHES > 0)) throw new Error('GPU crashed earlier -> CPU')   // stability first after a GPU-process crash
        this.session = await ort.InferenceSession.create(buf, {
          executionProviders: ['webgpu'], graphOptimizationLevel: 'all'
        })
        this.provider = 'webgpu'
      } catch (e) {
        this.session = await ort.InferenceSession.create(buf, {
          executionProviders: ['wasm'], graphOptimizationLevel: 'all'
        })
        this.provider = 'wasm'
      }
      this.inName = this.session.inputNames[0]
      this.outName = this.session.outputNames[0]
      this.ready = true
      this.onState('depth AI aktif (' + this.provider + ')')
    } catch (e) {
      this.ready = false
      this.onState('depth failed: ' + (e.message || '').slice(0, 70))
    } finally { this.loading = false }
    return this.ready
  }

  async infer (srcEl) {
    if (this.ready && this.provider === 'webgpu' && (typeof window !== 'undefined' && window.HVFT_GPU_CRASHES > 0)) {   // WebGPU session died with the GPU process -> reload on CPU
      this.ready = false; try { if (this.session && this.session.release) this.session.release() } catch (er) {}
      this.session = null; this.provider = ''; this.onState('GPU crashed — depth AI moving to CPU…'); this.init(); return null
    }
    if (!this.ready || this.busy) return null
    if (!srcEl || (srcEl.videoWidth === 0 && !srcEl.width)) return null
    this.busy = true
    try {
      const S = this.S
      if (!this._c) { this._c = document.createElement('canvas'); this._cx = this._c.getContext('2d', { willReadFrequently: true }) }
      if (this._c.width !== S) { this._c.width = S; this._c.height = S }
      this._cx.drawImage(srcEl, 0, 0, S, S)
      const img = this._cx.getImageData(0, 0, S, S).data
      const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225]
      const input = new Float32Array(3 * S * S)
      for (let i = 0; i < S * S; i++) {
        input[i] = (img[i * 4] / 255 - mean[0]) / std[0]
        input[S * S + i] = (img[i * 4 + 1] / 255 - mean[1]) / std[1]
        input[2 * S * S + i] = (img[i * 4 + 2] / 255 - mean[2]) / std[2]
      }
      const t = new ort.Tensor('float32', input, [1, 3, S, S])
      const out = await (window.hvftOrtRun ? window.hvftOrtRun(this.session, { [this.inName]: t }) : this.session.run({ [this.inName]: t }))
      const o = out[this.outName]
      const dmap = o.data, od = o.dims
      const ow = od[od.length - 1], oh = od[od.length - 2]
      let mn = Infinity, mx = -Infinity
      for (let i = 0; i < dmap.length; i++) { const v = dmap[i]; if (v < mn) mn = v; if (v > mx) mx = v }
      const rng = (mx - mn) || 1

      const W = 192, H = Math.max(2, Math.round(W * (srcEl.videoHeight || srcEl.height) / (srcEl.videoWidth || srcEl.width)))
      if (!this._em || this._emW !== W || this._emH !== H) { this._em = new Float32Array(W * H); this._emW = W; this._emH = H; this._em.fill(0) }
      const em = this._em, a = this._ema
      const depthMM = new Uint16Array(W * H)
      const rgb = new Uint8Array(W * H * 3)
      if (!this._rc) { this._rc = document.createElement('canvas'); this._rcx = this._rc.getContext('2d', { willReadFrequently: true }) }
      if (this._rc.width !== W || this._rc.height !== H) { this._rc.width = W; this._rc.height = H }
      this._rcx.drawImage(srcEl, 0, 0, W, H)
      const cimg = this._rcx.getImageData(0, 0, W, H).data
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const sx = Math.min(ow - 1, (x * ow / W) | 0)
          const sy = Math.min(oh - 1, (y * oh / H) | 0)
          const inv = (dmap[sy * ow + sx] - mn) / rng      // DA V2: besar = dekat
          const meter = 0.6 + (1 - inv) * 3.4              // ~0.6..4.0 m (relatif)
          const i = y * W + x
          const sm = em[i] === 0 ? meter : em[i] * a + meter * (1 - a)
          em[i] = sm
          depthMM[i] = (sm * 1000) | 0
          rgb[i * 3] = cimg[i * 4]; rgb[i * 3 + 1] = cimg[i * 4 + 1]; rgb[i * 3 + 2] = cimg[i * 4 + 2]
        }
      }
      return { w: W, h: H, depthMM, rgb, fx: W * 0.9, fy: W * 0.9, cx: W / 2, cy: H / 2 }
    } catch (e) {
      this.onState('inference failed: ' + (e.message || '').slice(0, 40))
      return null
    } finally { this.busy = false }
  }
}
window.DepthEngine = DepthEngine
