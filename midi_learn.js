// HVFT VISION — midi_learn.js (Oct 7) — MIDI controller mapping with MIDI LEARN
// Library: WEBMIDI.js v3 (Apache-2.0, github.com/djipco/webmidi) -> vendor/webmidi.iife.min.js
// The MIDI button (bottom-left) shows the connected controller.
//   click        = LEARN on/off. In LEARN: click any slider / knob / button in the app, then move a knob / fader or
//                  hit a pad -> they are linked (a new move on the same control replaces the old link).
//   Shift+click  = clear every link.
// Knobs / faders (CC) drive sliders over their full range; pads (notes) and CC buttons press buttons.
// A mapped control of another channel: its channel is selected first, then the move is applied.
// Links are saved on this computer (localStorage 'hvft.midi.map').
;(function () {
  if (typeof window === 'undefined' || !window.WebMidi) return
  const WM = window.WebMidi
  const KEY = 'hvft.midi.map'
  let map = {}; try { map = JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch (e) { map = {} }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(map)) } catch (e) {} }
  let learn = false, target = null, devs = [], lastMsg = ''
  // ---- UI ----
  const btn = document.createElement('button')
  btn.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:4px;z-index:99998;font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;padding:7px 10px;border:1px solid #3a3a3a;background:#0d0d0dee;color:#9a9a9a;cursor:pointer;max-width:380px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
  { const dk = document.getElementById('ioBtns'); if (dk) { btn.style.position = 'static'; btn.style.transform = 'none'; btn.style.left = 'auto'; btn.style.bottom = 'auto'; btn.style.padding = '4px 7px'; btn.style.fontSize = '9px'; btn.style.maxWidth = '190px'; dk.appendChild(btn) } else document.body.appendChild(btn) }
  const css = document.createElement('style')
  css.textContent = '.midi-learn-on .wgt, .midi-learn-on button, .midi-learn-on select{outline:1px dashed #F2A03D55} .midi-tgt{outline:2px solid #F2A03D !important} .midi-mapped{box-shadow:inset 0 0 0 1px #4fd1c588}'
  document.head.appendChild(css)
  function paint () {
    const n = Object.keys(map).length
    const dev = devs.length ? devs.join(' + ') : 'no controller'
    btn.textContent = learn ? (target ? '● LEARN · move a knob / hit a pad' : '● LEARN · click a control in the app') : ('MIDI · ' + dev + ' · ' + n + ' LINK' + (n === 1 ? '' : 'S') + (lastMsg ? ' · ' + lastMsg : ''))
    btn.style.color = learn ? '#111' : (devs.length ? '#F2A03D' : '#777')
    btn.style.background = learn ? '#F2A03D' : '#0d0d0dee'
    document.body.classList.toggle('midi-learn-on', learn)
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (e.shiftKey) { map = {}; save(); learn = false; setTarget(null); paint(); markMapped(); return }
    learn = !learn; if (!learn) setTarget(null); paint()
  })
  // ---- which control: a stable selector from its data-* attributes (the inspector is re-rendered often) ----
  const ATTR = ['k', 'f', 'fx', 'p', 'v', 'band', 'e', 'g', 'b', 'open']
  function controlOf (el) {
    if (!el || el === btn) return null
    const wg = el.closest && el.closest('.wgt')
    if (wg) { const inp = wg.nextElementSibling; if (inp && inp.tagName === 'INPUT') return inp }
    return el.closest ? el.closest('input[type=range], button, select') : null
  }
  function selOf (el) {
    if (el.id) return '#' + CSS.escape(el.id)
    let s = el.tagName.toLowerCase()
    if (el.tagName === 'INPUT') s += '[type=range]'
    let any = false
    for (const a of ATTR) { if (a === 'band' && el.tagName === 'INPUT') continue; const v = el.dataset ? el.dataset[a] : undefined; if (v != null) { s += '[data-' + a + '="' + CSS.escape(v) + '"]'; any = true } }
    if (!any && el.className && typeof el.className === 'string') { const c = el.className.split(/\s+/).filter(x => x && x !== 'on' && x !== 'sel')[0]; if (c) s += '.' + CSS.escape(c) }
    return s
  }
  function setTarget (el) {
    document.querySelectorAll('.midi-tgt').forEach(x => x.classList.remove('midi-tgt'))
    target = el
    if (el) { const w = (el.tagName === 'INPUT' && el.previousElementSibling && el.previousElementSibling.classList.contains('wgt')) ? el.previousElementSibling : el; w.classList.add('midi-tgt') }
  }
  document.addEventListener('pointerdown', (e) => {
    if (!learn) return
    const c = controlOf(e.target); if (!c) return
    e.preventDefault(); e.stopPropagation()
    setTarget(c); paint()
  }, true)
  document.addEventListener('click', (e) => { if (learn && controlOf(e.target)) { e.preventDefault(); e.stopPropagation() } }, true)
  function markMapped () {
    document.querySelectorAll('.midi-mapped').forEach(x => x.classList.remove('midi-mapped'))
    for (const id in map) {
      try { const el = document.querySelector(map[id].sel); if (!el) continue; const w = (el.tagName === 'INPUT' && el.previousElementSibling && el.previousElementSibling.classList.contains('wgt')) ? el.previousElementSibling : el; w.classList.add('midi-mapped') } catch (e) {}
    }
  }
  setInterval(markMapped, 1500)
  // ---- apply a MIDI move ----
  function find (m) {
    let el = null; try { el = document.querySelector(m.sel) } catch (e) {}
    if (el) return el
    if (m.k != null) {   // control of another channel -> select that channel first
      const ch = document.querySelector('.chan[data-k="' + m.k + '"]')
      if (ch) { try { ch.click() } catch (e) {} try { el = document.querySelector(m.sel) } catch (e) {} }
    }
    return el
  }
  function applyTo (m, v01, press) {
    const el = find(m); if (!el) return
    if (el.tagName === 'INPUT') {
      const mn = +el.min || 0, mx = el.max !== '' ? +el.max : 100
      const nv = Math.round(mn + v01 * (mx - mn))
      if (+el.value === nv) return
      el.value = nv; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
      if (el._draw) el._draw()
    } else if (el.tagName === 'SELECT') {
      const n = el.options.length; if (!n) return
      const i = Math.min(n - 1, Math.floor(v01 * n)); if (el.selectedIndex === i) return
      el.selectedIndex = i; el.dispatchEvent(new Event('change', { bubbles: true }))
    } else if (press) {
      el.click()
    }
  }
  function onMsg (id, kind, v01, press, label) {
    if (learn && target) {
      for (const k in map) if (map[k].sel === selOf(target)) delete map[k]
      map[id] = { sel: selOf(target), k: target.dataset ? target.dataset.k : undefined, kind }
      save(); lastMsg = label + ' linked'; learn = false; setTarget(null); paint(); markMapped(); return
    }
    const m = map[id]; if (!m) return
    applyTo(m, v01, press)
    lastMsg = label; paint()
  }
  const held = {}
  function attach (inp) {
    if (inp._hvft) return; inp._hvft = 1
    inp.addListener('controlchange', (e) => {
      const ch = e.message.channel, n = e.controller.number, raw = e.rawValue != null ? e.rawValue : Math.round((e.value || 0) * 127)
      const id = 'cc:' + ch + ':' + n, on = raw >= 64, rise = on && !held[id]; held[id] = on
      onMsg(id, 'cc', raw / 127, rise, 'CC' + n + ' ch' + ch)
    })
    inp.addListener('noteon', (e) => {
      const ch = e.message.channel, n = e.note.number, id = 'note:' + ch + ':' + n
      onMsg(id, 'note', (e.rawAttack != null ? e.rawAttack : 127) / 127, true, 'NOTE ' + n + ' ch' + ch)
    })
  }
  function refresh () { devs = WM.inputs.map(i => i.name); WM.inputs.forEach(attach); paint() }
  paint()
  WM.enable().then(() => {
    refresh()
    WM.addListener('connected', refresh); WM.addListener('disconnected', refresh)
  }).catch((err) => { btn.textContent = 'MIDI · unavailable'; try { console.error('[HVFT info] MIDI unavailable: ' + (err && err.message)) } catch (e) {} })
  window.HVFT_MIDI = { get map () { return map }, clear: () => { map = {}; save(); paint() } }
})()
