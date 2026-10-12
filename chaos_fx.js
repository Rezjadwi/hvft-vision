// HVFT VISION — chaos_fx.js (Oct 10) — ⚡ CHAOS: stage-wide light flashes + brightness that follow the noise.
// Reza: "kilatan cahaya dan lebih terang — maksimalkan agar lebih tampak chaos".
// One state per frame (window.HVFT_CHAOS.s) read by the projector (proj_view.js) and the MIX monitor:
//   brightness / contrast  = always a little brighter, and LOUDER noise = brighter + harder (continuous, follows the wall)
//   hit  (onset)           = a white FLASH that snaps back in ~80 ms; some hits INVERT the whole stage; some double-strike
//   HIGH band              = fine white flicker / grain light on top (the hiss of the noise)
// Mic OFF = no flashes (only the static brightness lift). BLACKOUT / MASTER still covers everything (drawn on top).
// Level: deck.g.chaos (0 / 0.5 / 1, saved in the preset) — button ⚡ in the MIX / MAPPING header.
;(function () {
  if (typeof window === 'undefined') return
  const S = { gain: 1, con: 1, sat: 1, white: 0, inv: false }
  let flash = 0, invUntil = 0, dbl = 0, wasHit = false, last = performance.now()
  function level () { const d = window.__deck; const v = d && d.g && d.g.chaos; return (v == null) ? 1 : Math.max(0, Math.min(1, +v)) }
  function step () {
    const now = performance.now(), dt = Math.min(100, now - last); last = now
    const k = level(), mic = !!window.HVFT_MIC_ON
    const A = window.HVFT_AUDIO || {}, P = (typeof pipe !== 'undefined' && pipe) ? pipe : null
    const B = (P && P.band) || A, on = (P && P.onset) || A.onset || 0
    const lo = +B.low || 0, mi = +B.mid || 0, hi = +B.high || 0, lvl = Math.max(lo, mi, hi)
    flash *= Math.exp(-dt / 55)                                   // fast snap back (~80 ms visible)
    if (mic && k > 0) {
      const hit = on > 0.5
      if (hit && !wasHit) {
        flash = 1
        if (Math.random() < 0.35 * k) invUntil = now + 45 + Math.random() * 70   // INVERT strike
        if (Math.random() < 0.3 * k) dbl = now + 60 + Math.random() * 50          // second strike right after
      }
      wasHit = hit
      if (dbl && now >= dbl) { flash = Math.max(flash, 0.85); dbl = 0 }
      S.white = Math.min(1, k * (flash * 0.9 + hi * hi * 0.22 * Math.random()))   // flash + HIGH-band flicker
      S.gain = 1 + k * (0.18 + 0.75 * lvl + 0.5 * flash)                           // louder = brighter
      S.con = 1 + k * (0.15 + 0.45 * lvl)
      S.sat = 1 + k * 0.25 * lvl
      S.inv = now < invUntil
    } else {
      wasHit = false; dbl = 0; invUntil = 0
      S.white = 0; S.inv = false; S.gain = 1 + k * 0.18; S.con = 1 + k * 0.15; S.sat = 1
    }
    const m = (window.HVFT_MASTER && typeof window.HVFT_MASTER.level === 'number') ? Math.max(0, window.HVFT_MASTER.level) : 1
    S.white *= m   // BLACKOUT / fade also kills the flashes
    S.filter = 'brightness(' + S.gain.toFixed(3) + ') contrast(' + S.con.toFixed(3) + ') saturate(' + S.sat.toFixed(3) + ')' + (S.inv ? ' invert(1)' : '')
    // MIX monitor shows it too (CSS only: the pixels Syphon / trace read stay clean)
    const cv = document.getElementById('deckcv'); if (cv && cv.style.filter !== S.filter) cv.style.filter = S.filter
    let fx = document.getElementById('chaosFx')
    if (!fx) { const st = document.getElementById('stage'); if (st) { fx = document.createElement('div'); fx.id = 'chaosFx'; fx.style.cssText = 'position:absolute;inset:0;z-index:4;background:#fff;opacity:0;pointer-events:none'; st.appendChild(fx) } }
    if (fx) { const o = S.white.toFixed(3); if (fx.style.opacity !== o) fx.style.opacity = o }
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
  function paint () { const b = document.getElementById('chaosBtn'); if (!b) return; const k = level(); b.textContent = k <= 0 ? '⚡ OFF' : k < 0.75 ? '⚡ 50' : '⚡ MAX'; b.classList.toggle('on', k > 0) }
  function cycle () { const d = window.__deck; if (!d) return; if (!d.g) d.g = {}; const k = level(); d.g.chaos = k <= 0 ? 0.5 : k < 0.75 ? 1 : 0; paint() }
  setTimeout(() => { const b = document.getElementById('chaosBtn'); if (b) b.onclick = (e) => { e.stopPropagation(); cycle() }; paint() }, 300)
  setInterval(paint, 1000)   // a recalled preset can change the level
  window.HVFT_CHAOS = { s: S, level, cycle }
})()
