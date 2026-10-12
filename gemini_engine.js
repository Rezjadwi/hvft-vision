// HVFT VISION — gemini_engine.js
// "AI LIVE" — restyle frame kamera jadi gaya apa pun via Gemini 2.5 Flash Image (Nano Banana).
// Per-gambar (~beberapa detik), BUKAN 30fps: tangkap frame -> Gemini img2img -> tampilkan/cross-fade.
// Kunci API disimpan LOKAL (localStorage) oleh pengguna; hanya dikirim ke Google, tak ke tempat lain.

const GEMINI_MODEL = 'gemini-2.5-flash-image'   // legacy default (kept for compatibility)
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/'
const GEMINI_URL = GEMINI_BASE + GEMINI_MODEL + ':generateContent'
// FAST AI (Oct 6): newest image models, fastest first. AUTO walks this list and skips a model the API does not offer.
//   think: supports thinkingConfig.thinkingLevel ('minimal' = fastest) · size: imageConfig.imageSize to request
const GEMINI_MODELS = [
  { id: 'gemini-3.1-flash-lite-image', label: '3.1 Flash-Lite', think: true, size: null },
  { id: 'gemini-3.1-flash-image', label: '3.1 Flash 512', think: true, size: '512px' },
  { id: 'gemini-2.5-flash-image', label: '2.5 Flash', think: false, size: null }
]

class GeminiEngine {
  constructor () {
    this.key = ''
    this.prompt = 'ubah foto ini menjadi ilustrasi anime dengan garis tinta kasar, kontras tinggi, cel-shading tegas'
    this.inflight = 0                  // requests running now (Gemini: several overlap = pipelined)
    this.maxInflight = 3               // running limit (drops after a 429, climbs back to parTarget)
    this.parTarget = 3                 // PARALLEL slider (1-4)
    this._okRun = 0                    // successes since the last rate limit
    this.seq = 0; this.lastShown = 0   // drop results that arrive after a newer one
    this.avgMs = 0                     // measured latency (EMA)
    this.cooldownUntil = 0             // back-off after errors / rate limit
    this.model = 'auto'                // 'auto' or one GEMINI_MODELS id
    this.usedModel = ''
    this._bad = {}; this._plain = {}   // models the API does not offer · models that reject the speed config
    this._done = []                    // completion times -> images per second
    this.refB64 = null                 // STYLE REFERENCE image (Gemini): sent with every frame, the AI copies its look
    this.maxSide = 256                 // kecil = cepat (detail turun, gaya tetap kena). Gemini live 256 (dari control.js
    this.onState = null
    this.provider = 'gemini'           // 'gemini' (cloud) — Draw Things removed Oct 12
    this.localUrl = 'http://127.0.0.1:7860'
    this.denoise = 0.6                 // img2img: makin rendah = makin setia ke subjek
    this.steps = 20                    // SD1.5 biasa butuh ~20; model Turbo/LCM cukup 4-8
    this.cfg = 7                       // SD1.5 ~7; Turbo/LCM ~1-2
    this.sampler = 'Euler a'           // Turbo/LCM -> 'LCM'
    this.seed = 12345                  // seed tetap = hasil KONSISTEN antar-frame
    this.seedLock = false              // kunci seed (kurangi kedip/berubah-ubah)
    this.cnModel = ''                  // nama model ControlNet depth di Draw Things (kosong = off)
    this.cnWeight = 1.0                 // kekuatan ControlNet
    this.cnModule = 'depth'            // preprocessor ControlNet
    try {
      this.cap = document.createElement('canvas')
      this.capCtx = this.cap.getContext('2d')
    } catch (e) { this.cap = null; this.capCtx = null }
  }
  setKey (k) { this.key = (k || '').trim() }
  setPrompt (p) { if (p != null) this.prompt = p }
  _state (m) { if (this.onState) { try { this.onState(m) } catch (e) {} } }

  // tangkap elemen (video/canvas) -> base64 PNG (tanpa prefix "data:...,")
  _grab (srcEl) {
    if (!srcEl || !this.capCtx) return null
    const sw = srcEl.videoWidth || srcEl.width || 0
    const sh = srcEl.videoHeight || srcEl.height || 0
    if (!sw || !sh) return null
    const s = Math.min(1, this.maxSide / Math.max(sw, sh))
    const w = Math.max(64, Math.round(sw * s / 64) * 64), h = Math.max(64, Math.round(sh * s / 64) * 64)   // kelipatan 64 (syarat Draw Things/SD)
    if (this.cap.width !== w) this.cap.width = w
    if (this.cap.height !== h) this.cap.height = h
    this.capCtx.drawImage(srcEl, 0, 0, w, h)
    const url = this.cap.toDataURL('image/jpeg', 0.6)   // JPEG mutu sedang = payload kecil -> upload cepat
    return url.slice(url.indexOf(',') + 1)
  }

  get busy () { return this.inflight >= this.maxInflight }
  _aspect () {
    const r = (this.cap && this.cap.height) ? this.cap.width / this.cap.height : 1
    const opts = [['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['16:9', 16 / 9], ['9:16', 9 / 16], ['3:2', 1.5], ['2:3', 2 / 3]]
    let best = opts[0]; for (const o of opts) if (Math.abs(Math.log(o[1] / r)) < Math.abs(Math.log(best[1] / r))) best = o
    return best[0]
  }
  _buildBody (b64, m) {
    const gc = { responseModalities: ['IMAGE'] }
    if (m && !this._plain[m.id]) {   // speed config (dropped automatically if a model refuses it)
      const ic = { aspectRatio: this._aspect() }; if (m.size) ic.imageSize = m.size
      gc.imageConfig = ic
      if (m.think) gc.thinkingConfig = { thinkingLevel: 'minimal' }
    }
    const parts = this.refB64
      ? [{ text: 'IMAGE 1 = STYLE REFERENCE. IMAGE 2 = live camera photo. Redraw IMAGE 2 in exactly the visual style, materials, texture, lighting and rendering of IMAGE 1. Keep IMAGE 2\'s people (same number), faces, poses, clothes and composition; do NOT copy the content, people or background of IMAGE 1. ' + this.prompt },
        { inline_data: { mime_type: 'image/jpeg', data: this.refB64 } },
        { inline_data: { mime_type: 'image/jpeg', data: b64 } }]
      : [{ text: this.prompt }, { inline_data: { mime_type: 'image/jpeg', data: b64 } }]
    return { contents: [{ parts }], generationConfig: gc }
  }
  // STYLE REFERENCE: any image element -> small JPEG (384 px) kept as base64; null clears it
  setRef (el) {
    if (!el) { this.refB64 = null; return }
    const w0 = el.naturalWidth || el.width, h0 = el.naturalHeight || el.height; if (!w0 || !h0) return
    const s = Math.min(1, 384 / Math.max(w0, h0)), c = document.createElement('canvas')
    c.width = Math.round(w0 * s); c.height = Math.round(h0 * s); c.getContext('2d').drawImage(el, 0, 0, c.width, c.height)
    const u = c.toDataURL('image/jpeg', 0.75); this.refB64 = u.slice(u.indexOf(',') + 1)
  }
  _models () {
    const pick = GEMINI_MODELS.find(m => m.id === this.model)
    const rest = GEMINI_MODELS.filter(m => m !== pick && !this._bad[m.id])
    return pick ? [pick].concat(rest) : rest
  }
  _rate () { const now = Date.now(); this._done = this._done.filter(t => now - t < 6000); return this._done.length / 6 }

  // cari bagian gambar di respons (dukung inlineData / inline_data)
  _extract (j) {
    const cands = j && j.candidates
    if (!Array.isArray(cands)) return null
    for (const c of cands) {
      const parts = c && c.content && c.content.parts
      if (!Array.isArray(parts)) continue
      for (const p of parts) {
        const d = p && (p.inlineData || p.inline_data)
        if (d && d.data) {
          const mime = d.mimeType || d.mime_type || 'image/png'
          return 'data:' + mime + ';base64,' + d.data
        }
      }
    }
    return null
  }

  // restyle satu frame -> dataURL gambar hasil (atau null). Aman dipanggil berkala.
  // Several calls may run at once (Gemini); a result older than one already shown is dropped (no going back in time).
  async restyle (srcEl) {
    if (this.busy) return null
    const b64 = this._grab(srcEl)
    if (!b64) { this._state('Camera source not ready'); return null }
    const my = ++this.seq, t0 = Date.now()
    this.inflight++
    try {
      const img = await this._gemini(b64)
      if (!img) return null
      const ms = this._callMs || (Date.now() - t0); this.avgMs = this.avgMs ? this.avgMs * 0.7 + ms * 0.3 : ms
      this._done.push(Date.now())
      if (this.maxInflight < this.parTarget && ++this._okRun >= 10) { this.maxInflight++; this._okRun = 0 }   // recover after a rate limit
      if (my < this.lastShown) return null
      this.lastShown = my
      this._state('AI: ' + (this.avgMs / 1000).toFixed(1) + ' s · ' + this._rate().toFixed(2) + ' img/s · ' + this.inflight + '/' + this.maxInflight + ' running · ' + (this.usedModel || ''))
      return img
    } finally { this.inflight-- }
  }

  // STOP must really stop (Oct 12): every request carries an AbortController; abortAll() cancels the ones in flight
  abortAll () { this.stopped = true; if (this._acs) { for (const ac of this._acs) { try { ac.abort() } catch (e) {} } this._acs.clear() } }
  async _gemini (b64) {
    if (!this.key) { this._state('Enter a Gemini API key first'); return null }
    this.stopped = false
    const ac = new AbortController(); (this._acs || (this._acs = new Set())).add(ac)
    if (!this.avgMs) this._state('AI: drawing…')
    try {
      let res = null, m = null
      for (const cand of this._models()) {
        m = cand
        const tc = Date.now()
        res = await fetch(GEMINI_BASE + m.id + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key }, body: JSON.stringify(this._buildBody(b64, m)), signal: ac.signal })
        if (res.ok) { this._callMs = Date.now() - tc; break }
        const t = await res.text().catch(() => '')
        if (res.status === 400 && !this._plain[m.id] && /imageConfig|imageSize|aspectRatio|thinking|Unknown name|Invalid JSON payload|not supported/i.test(t)) {
          this._plain[m.id] = true   // this model refuses the speed config -> retry it plain
          res = await fetch(GEMINI_BASE + m.id + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key }, body: JSON.stringify(this._buildBody(b64, m)), signal: ac.signal })
          if (res.ok) { this._callMs = Date.now() - tc; break }
        }
        if (res.status === 404 || (res.status === 400 && /model|not found|not supported/i.test(t))) { this._bad[m.id] = true; continue }   // model not offered -> next
        if (res.status === 429) { this.cooldownUntil = Date.now() + 4000; this.maxInflight = Math.max(1, this.maxInflight - 1); this._okRun = 0; this._state('AI: rate limit (429) — slowing down to ' + this.maxInflight + ' parallel'); return null }
        this.cooldownUntil = Date.now() + 1500
        this._state('AI failed ' + res.status + ': ' + t.slice(0, 90)); return null
      }
      if (!res || !res.ok) { this._state('AI: no Gemini image model available for this key'); this.cooldownUntil = Date.now() + 3000; return null }
      this.usedModel = m.label
      const j = await res.json()
      const img = this._extract(j)
      if (!img) {
        let why = ''
        try {
          const c = j && j.candidates && j.candidates[0]
          if (c && c.finishReason && c.finishReason !== 'STOP') why = c.finishReason
          const parts = c && c.content && c.content.parts
          const t = parts && parts.find(p => p && p.text)
          if (t) why = (why ? why + ' · ' : '') + String(t.text).slice(0, 70)
          if (j && j.promptFeedback && j.promptFeedback.blockReason) why = 'diblokir: ' + j.promptFeedback.blockReason
        } catch (e) {}
        this._state('AI: no image returned' + (why ? ' — ' + why : ' (prompt may be refused / copyrighted style)')); return null
      }
      if (this.stopped || ac.signal.aborted) return null
      this._state('AI: ready'); return img
    } catch (e) { if (!(ac.signal.aborted || (e && e.name === 'AbortError'))) this._state('AI error: ' + (e && e.message ? e.message : e)); return null }
    finally { this._acs.delete(ac) }
  }
}
if (typeof window !== 'undefined') window.GeminiEngine = GeminiEngine
if (typeof window !== 'undefined') window.GEMINI_MODELS = GEMINI_MODELS
if (typeof module !== 'undefined' && module.exports) module.exports = { GeminiEngine, GEMINI_URL, GEMINI_MODEL, GEMINI_MODELS }
