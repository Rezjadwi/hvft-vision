// HVFT VISION — depth_client.js
// Mac jadi KLIEN: connect ke iPhone (penerima) di IP:port, terima frame depth.
// Arah dibalik supaya IP tujuan bisa diatur dari aplikasi (tak perlu rebuild Unity).
const net = require('net')
const { FrameParser } = require('./depth_protocol.js')

function startDepthClient ({ getIp, port = 7755, onFrame, onState } = {}) {
  let sock = null, stopped = false, parser = null
  let curIp = null

  function connect () {
    if (stopped) return
    const ip = (getIp && getIp()) || '172.20.10.1'
    curIp = ip
    parser = new FrameParser(f => onFrame && onFrame(f))
    sock = net.connect({ host: ip, port }, () => onState && onState('connected to iPhone ' + ip + ':' + port))
    sock.on('data', d => parser.push(d))
    sock.on('error', () => {})
    sock.on('close', () => {
      if (stopped) return
      onState && onState('waiting for iPhone at ' + ip + ' …')
      setTimeout(connect, 900)   // coba lagi
    })
  }

  // kalau IP berubah dari app, putuskan supaya reconnect ke IP baru
  function refresh () {
    const ip = (getIp && getIp()) || '172.20.10.1'
    if (ip !== curIp && sock) { try { sock.destroy() } catch (e) {} }
  }

  onState && onState('searching for iPhone…')
  connect()
  return { refresh, stop () { stopped = true; try { sock && sock.destroy() } catch (e) {} } }
}

module.exports = { startDepthClient }
