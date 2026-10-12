// HVFT VISION — plexus_engine.js
// Efek "PLEXUS": siluet Depth-AI diubah jadi JARINGAN titik bercahaya.
//   • Titik menyala di area subjek (mask depth). Makin dekat = makin terang.
//   • Garis tipis menyambung titik-titik terdekat -> jaring/konstelasi.
//   • Gerakan (motion antar-frame) memicu KILATAN cahaya + BLOB energi (metaball additif).
//   • Monokrom putih-di-hitam + aksen oranye HVFT (#F2A03D). Cocok VJ.
// Dipanggil dari HvftPipeline.pushLidarFrame() dengan mask depth + rgb kamera.
// Tanpa dependensi. Aman di renderer (butuh <canvas>) & di-guard utk node test.

class PlexusFX {
  constructor () {
    this.prev = null; this.pw = 0; this.ph = 0
    this.t = 0
    this._sprW = null; this._sprO = null
  }

  static defaults () {
    return {
      spacing: 6,        // jarak sampling titik (px depth-map). kecil = lebih padat
      thresh: 0.07,      // ambang mask utk menaruh titik (buang latar)
      linkDist: 0.075,   // jarak maksimum garis (fraksi lebar layar)
      maxLinks: 3,       // batas garis per titik (anti-berantakan)
      pointSize: 1.7,    // radius inti titik (skala @720p)
      glow: 1.0,         // pengali radius glow titik
      flash: 1.0,        // pengali kecerahan dari gerakan (kilatan)
      lineAlpha: 0.55,   // opasitas dasar garis
      accent: 0.16,      // porsi node/garis beraksen oranye (0..1)
      jitter: 0.6,       // guncangan organik titik (px depth-map)
      motionBlob: 1.0,   // besar blob energi dari gerakan
      baseAlpha: 0.15,   // kecerahan siluet dasar (badan) di bawah jaring
      color: 'white'     // 'white' (mono) | 'rgb' (warna kamera)
    }
  }

  _resetIf (w, h) {
    if (this.pw !== w || this.ph !== h || !this.prev) {
      this.prev = new Float32Array(w * h); this.pw = w; this.ph = h
    }
  }

  // sprite glow lembut (di-cache) -> drawImage jauh lebih cepat drpd radial-gradient per titik
  _sprite (orange) {
    const cached = orange ? this._sprO : this._sprW
    if (cached) return cached
    if (typeof document === 'undefined') return null
    const s = 64
    const c = document.createElement('canvas'); c.width = s; c.height = s
    const x = c.getContext('2d')
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    if (orange) {
      g.addColorStop(0, 'rgba(255,214,150,1)')
      g.addColorStop(0.28, 'rgba(242,160,61,0.55)')
      g.addColorStop(1, 'rgba(242,160,61,0)')
    } else {
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.28, 'rgba(232,242,255,0.55)')
      g.addColorStop(1, 'rgba(210,228,255,0)')
    }
    x.fillStyle = g; x.fillRect(0, 0, s, s)
    if (orange) this._sprO = c; else this._sprW = c
    return c
  }

  // render jaring ke ctx (ukuran W*H).
  //   mask : Float32 (w*h) 0..1  = seberapa "subjek" (1=dekat/terang)
  //   rgb  : Uint8   (w*h*3) | null (utk color:'rgb')
  //   base : HTMLCanvas siluet grayscale kecil | null (digambar tipis di bawah)
  //   flip : boolean balik vertikal
  render (ctx, W, H, mask, rgb, w, h, opt, flip, base) {
    if (!ctx || !mask || !w || !h) return
    const O = Object.assign(PlexusFX.defaults(), opt || {})
    this._resetIf(w, h)
    this.t += 0.016
    const prev = this.prev
    const step = Math.max(2, O.spacing | 0)
    const linkPx = Math.max(4, O.linkDist * W)
    const linkPx2 = linkPx * linkPx
    const sxx = W / w, syy = H / h
    const R = Math.max(0.6, O.pointSize * (W / 720))
    const sprW = this._sprite(false)
    const sprO = this._sprite(true)

    ctx.clearRect(0, 0, W, H)

    // 0) siluet dasar tipis (badan tetap kebaca di bawah jaring)
    if (base && O.baseAlpha > 0.001) {
      ctx.save()
      ctx.globalAlpha = O.baseAlpha
      ctx.imageSmoothingEnabled = true
      if (flip) { ctx.translate(0, H); ctx.scale(1, -1) }
      ctx.drawImage(base, 0, 0, W, H)
      ctx.restore()
    }

    // 1) kumpulkan titik dari sel grid pada area subjek
    const pts = []
    for (let gy = (step >> 1); gy < h; gy += step) {
      for (let gx = (step >> 1); gx < w; gx += step) {
        const i = gy * w + gx
        const m = mask[i]
        if (m < O.thresh) continue
        const mo = Math.abs(m - prev[i])              // motion antar-frame
        // drift organik per-titik (stabil, tak kedip liar)
        const hh = (((gx * 73856093) ^ (gy * 19349663)) >>> 0)
        const ph = (hh % 1000) / 1000 * 6.2832
        const jx = Math.cos(this.t * 0.8 + ph) * O.jitter
        const jy = Math.sin(this.t * 0.9 + ph * 1.3) * O.jitter
        let px = (gx + 0.5 + jx) * sxx
        let py = (gy + 0.5 + jy) * syy
        if (flip) py = H - py
        let cr = 235, cg = 242, cb = 255
        if (O.color === 'rgb' && rgb) { cr = rgb[i * 3]; cg = rgb[i * 3 + 1]; cb = rgb[i * 3 + 2] }
        const acc = (hh % 100) < O.accent * 100
        pts.push({ x: px, y: py, b: m, mo, cr, cg, cb, acc })
      }
    }
    prev.set(mask)   // simpan utk motion frame berikut

    // 2) spatial hash -> garis antar titik terdekat
    const cell = linkPx
    const grid = new Map()
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k]
      const kk = ((p.x / cell) | 0) + ',' + ((p.y / cell) | 0)
      let arr = grid.get(kk); if (!arr) { arr = []; grid.set(kk, arr) }
      arr.push(k)
    }

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = Math.max(0.5, W / 1500)
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k]
      const cx = (p.x / cell) | 0, cy = (p.y / cell) | 0
      let links = 0
      for (let oy = -1; oy <= 1 && links < O.maxLinks; oy++) {
        for (let ox = -1; ox <= 1 && links < O.maxLinks; ox++) {
          const arr = grid.get((cx + ox) + ',' + (cy + oy)); if (!arr) continue
          for (let a = 0; a < arr.length; a++) {
            const j = arr[a]; if (j <= k) continue
            const q = pts[j]
            const dx = q.x - p.x, dy = q.y - p.y
            const d2 = dx * dx + dy * dy
            if (d2 > linkPx2) continue
            const d = Math.sqrt(d2)
            const al = O.lineAlpha * (1 - d / linkPx) * Math.min(1, (p.b + q.b) * 0.6)
            if (al < 0.02) continue
            if (p.acc || q.acc) ctx.strokeStyle = 'rgba(242,160,61,' + al.toFixed(3) + ')'
            else ctx.strokeStyle = 'rgba(215,230,250,' + al.toFixed(3) + ')'
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke()
            links++
            if (links >= O.maxLinks) break
          }
        }
      }
    }

    // 3) BLOB energi + KILATAN dari gerakan (glow besar additif -> membentuk blob)
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k]
      const energy = Math.min(1, p.mo * 7 * O.flash)
      if (energy < 0.05) continue
      const rad = (R * 5 + energy * R * 16) * O.motionBlob * O.glow
      const a = Math.min(0.95, 0.25 + energy)
      if (sprW) {
        ctx.globalAlpha = a
        ctx.drawImage(sprW, p.x - rad, p.y - rad, rad * 2, rad * 2)
        if (p.acc || energy > 0.5) { ctx.globalAlpha = a * 0.7; ctx.drawImage(sprO, p.x - rad * 1.2, p.y - rad * 1.2, rad * 2.4, rad * 2.4) }
      } else {
        ctx.globalAlpha = a
        ctx.fillStyle = 'rgba(255,255,255,1)'
        ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, 6.2832); ctx.fill()
      }
    }
    ctx.globalAlpha = 1

    // 4) glow titik (halus) + inti keras
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k]
      const gr = R * (2.0 + p.b * 2.6) * O.glow
      const a = 0.10 + p.b * 0.38
      const spr = p.acc ? sprO : sprW
      if (spr) {
        ctx.globalAlpha = a
        ctx.drawImage(spr, p.x - gr, p.y - gr, gr * 2, gr * 2)
      } else {
        ctx.globalAlpha = a
        ctx.fillStyle = p.acc ? 'rgba(242,160,61,1)' : 'rgba(235,242,255,1)'
        ctx.beginPath(); ctx.arc(p.x, p.y, gr, 0, 6.2832); ctx.fill()
      }
    }
    ctx.globalAlpha = 1

    // inti keras (titik tajam) — hanya utk titik terang / bergerak
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k]
      if (p.b < 0.14 && p.mo < 0.02) continue
      const cr = R * (0.55 + p.b * 0.75)
      ctx.fillStyle = p.acc ? 'rgba(255,206,140,0.95)' : 'rgba(255,255,255,0.95)'
      ctx.beginPath(); ctx.arc(p.x, p.y, cr, 0, 6.2832); ctx.fill()
    }

    ctx.restore()
  }
}

if (typeof window !== 'undefined') window.PlexusFX = PlexusFX
if (typeof module !== 'undefined' && module.exports) module.exports = { PlexusFX }
