// HVFT VISION — netcam_hub.js (Oct 11) — HVFT Cam (Android phone over WiFi) for EVERY camera consumer:
// AI LIVE / AI GEN (CH4: Gemini, Anime GAN, REF) and DEPTH-AI / PC-3D (CH2) read a normal <video>.
// One MJPEG connection per phone URL, drawn to a canvas -> canvas.captureStream -> <video> (shared by all of them).
// (A camera channel CH1 opens its own stream in pipeline.startNetworkCamera; the phone server serves several clients.)
;(function () {
  if (typeof window === 'undefined') return
  const hubs = new Map()
  function make (url) {
    const u = String(url || '').replace(/\/+$/, '')
    const h = { url: u, ok: false, w: 0, h: 0, img: null, cv: document.createElement('canvas'), video: document.createElement('video'), raf: 0, t0: performance.now(), retryT: 0 }
    h.cx = h.cv.getContext('2d')
    h.video.muted = true; h.video.playsInline = true; h.video.autoplay = true
    h.video.style.cssText = 'position:absolute;left:-99999px;top:0;width:2px;height:2px'
    document.body.appendChild(h.video)
    const log = (m) => { try { if (window.hvft && window.hvft.hvftcamLog) window.hvft.hvftcamLog('[hub] ' + m) } catch (e) {} }
    const open = () => {
      if (h.img) { try { h.img.onerror = null; h.img.src = '' } catch (e) {} }
      const img = new Image(); img.crossOrigin = 'anonymous'
      img.onerror = () => { h.ok = false; log('stream error ' + u + ' -> retry in 3 s'); clearTimeout(h.retryT); h.retryT = setTimeout(open, 3000) }
      img.src = u + '/video'
      h.img = img; h.t0 = performance.now()
      log('open ' + u + '/video')
    }
    const loop = () => {
      h.raf = requestAnimationFrame(loop)
      const im = h.img, iw = (im && im.naturalWidth) || 0, ih = (im && im.naturalHeight) || 0
      if (!iw || !ih) { if (!h.ok && performance.now() - h.t0 > 8000) { h.t0 = performance.now(); log('no picture -> reconnect'); open() } return }
      if (h.cv.width !== iw || h.cv.height !== ih) { h.cv.width = iw; h.cv.height = ih }
      try { h.cx.drawImage(im, 0, 0, iw, ih); if (!h.ok) log('first frame ' + iw + 'x' + ih); h.ok = true; h.w = iw; h.h = ih } catch (e) {}
    }
    open(); h.raf = requestAnimationFrame(loop)
    try { h.video.srcObject = h.cv.captureStream(30); h.video.play().catch(() => {}) } catch (e) { log('captureStream failed ' + (e && e.message)) }
    return h
  }
  // <video> showing the phone (null until the first frame arrived)
  function video (url) {
    if (!url) return null
    const u = String(url).replace(/\/+$/, '')
    let h = hubs.get(u); if (!h) { h = make(u); hubs.set(u, h) }
    return (h.ok && (h.video.videoWidth || 0) > 0) ? h.video : null
  }
  function status (url) { const h = hubs.get(String(url || '').replace(/\/+$/, '')); return h ? { ok: h.ok, w: h.w, h: h.h } : null }
  window.HVFT_NETCAM = { video, status }
})()
