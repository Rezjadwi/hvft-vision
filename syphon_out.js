// HVFT VISION — syphon_out.js (Oct 7) — SYPHON OUT button (control page)
// Sends the deck mix (#deckcv) to the Syphon server in main.js ("HVFT VISION") so MadMapper / Resolume / OBS / VDMX
// on this Mac can take it as a live source. Frames are only read and sent while a Syphon client is connected
// (checked once a second), at up to 30 fps. Click = on/off. Shift+click = flip vertically (if a client shows it upside down).
;(function () {
  if (typeof window === 'undefined' || !window.hvft || !window.hvft.syphonEnable) return
  const H = window.hvft
  let on = false, clients = false, flip = false, err = '', last = 0, sent = 0, fpsT = 0, fps = 0
  try { flip = localStorage.getItem('hvft.syphon.flip') === '1' } catch (e) {}
  const btn = document.createElement('button')
  btn.style.cssText = 'position:fixed;left:calc(50% + 200px);bottom:4px;z-index:99998;font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;padding:7px 10px;border:1px solid #3a3a3a;background:#0d0d0dee;color:#777;cursor:pointer;white-space:nowrap'
  { const dk = document.getElementById('ioBtns'); if (dk) { btn.style.position = 'static'; btn.style.transform = 'none'; btn.style.left = 'auto'; btn.style.bottom = 'auto'; btn.style.padding = '4px 7px'; btn.style.fontSize = '9px'; btn.style.maxWidth = '190px'; dk.appendChild(btn) } else document.body.appendChild(btn) }
  const tmp = document.createElement('canvas'), tx = tmp.getContext('2d', { willReadFrequently: true })
  function paint () {
    btn.textContent = err ? ('SYPHON · ' + err.slice(0, 60)) : !on ? 'SYPHON OFF' : (clients ? '◉ SYPHON → ' + fps + ' fps' : '◉ SYPHON · waiting for a client') + (flip ? ' · FLIP' : '')
    btn.style.color = on ? (clients ? '#111' : '#F2A03D') : (err ? '#e2553c' : '#777')
    btn.style.background = on && clients ? '#F2A03D' : '#0d0d0dee'
  }
  btn.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (e.shiftKey) { flip = !flip; try { localStorage.setItem('hvft.syphon.flip', flip ? '1' : '0') } catch (er) {} paint(); return }
    const want = !on
    const r = await H.syphonEnable(want).catch(er => ({ on: false, error: String(er) }))
    on = !!(r && r.on); err = (r && r.error) ? String(r.error) : ''
    if (err) { try { console.error('[HVFT info] SYPHON: ' + err) } catch (er) {} }
    paint()
  })
  setInterval(async () => { if (!on) { clients = false; return } try { clients = !!(await H.syphonClients()) } catch (e) { clients = false } paint() }, 1000)
  function loop (now) {
    requestAnimationFrame(loop)
    if (!on || !clients || now - last < 32) return
    last = now
    const src = document.getElementById('deckcv'); if (!src || src.width < 4) return
    const w = src.width, h = src.height
    if (tmp.width !== w || tmp.height !== h) { tmp.width = w; tmp.height = h }
    tx.drawImage(src, 0, 0)
    const im = tx.getImageData(0, 0, w, h)
    try { H.syphonFrame({ w, h, data: im.data, flip }) } catch (e) {}
    sent++; if (now - fpsT > 1000) { fps = sent; sent = 0; fpsT = now; paint() }
  }
  requestAnimationFrame(loop)
  paint()
})()
