// HVFT VISION — audio_in.js
// One audio-input setting shared by every window (control, projector, deck, point cloud) via localStorage.
// - pick any input device: USB audio interface, built-in mic, aggregate/loopback devices
// - RAW capture: echo cancellation / noise suppression / auto gain OFF (they would eat and flatten the noise)
// - stereo when the interface offers it; listen to MIX, IN 1 (L) or IN 2 (R); input TRIM
// - falls back to the system default input if the chosen device is missing (unplugged)
;(function () {
  const KEY = 'hvft_audio_in'
  const DEF = { deviceId: '', label: '', channel: 'mix', gain: 1 }
  function cfg () { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')) } catch (e) { return Object.assign({}, DEF) } }
  function save (c) { try { localStorage.setItem(KEY, JSON.stringify(Object.assign({}, DEF, c))) } catch (e) {} }
  async function list () { try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput') } catch (e) { return [] } }
  const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 }, latency: { ideal: 0.01 } }
  async function open () {
    const c = cfg()
    let id = c.deviceId
    if (id || c.label) {   // deviceIds can change after a replug -> match by name too
      const l = await list(); const m = l.find(d => d.deviceId === id) || (c.label ? l.find(d => d.label === c.label) : null)
      id = m ? m.deviceId : ''
    }
    let stream = null, fellBack = false
    if (id && id !== 'default') { try { stream = await navigator.mediaDevices.getUserMedia({ audio: Object.assign({ deviceId: { exact: id } }, RAW) }) } catch (e) { stream = null } }
    if (!stream) { fellBack = !!(c.deviceId || c.label) && id !== 'default'; stream = await navigator.mediaDevices.getUserMedia({ audio: Object.assign({}, RAW) }) }
    return { stream, cfg: c, fellBack }
  }
  // source -> [IN 1 / IN 2 pick] -> trim gain ; returns the node to analyse
  function route (ac, stream, c) {
    c = c || cfg()
    const src = ac.createMediaStreamSource(stream), g = ac.createGain()
    g.gain.value = Math.max(0, Math.min(16, +c.gain || 1))
    if (c.channel === 'L' || c.channel === 'R') { const sp = ac.createChannelSplitter(2); src.connect(sp); sp.connect(g, c.channel === 'R' ? 1 : 0) }
    else src.connect(g)
    return g
  }
  function info (stream) {
    try { const t = stream.getAudioTracks()[0], s = t.getSettings ? t.getSettings() : {}; return { label: t.label || 'input', ch: s.channelCount || 0, sr: s.sampleRate || 0, ec: !!s.echoCancellation, ns: !!s.noiseSuppression, agc: !!s.autoGainControl } } catch (e) { return { label: 'input', ch: 0, sr: 0 } }
  }
  window.HVFT_AUDIO_IN = { KEY, cfg, save, list, open, route, info }
})()
