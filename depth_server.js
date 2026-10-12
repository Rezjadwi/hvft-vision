// HVFT VISION — server penerima depth (TCP, di proses utama Electron / Node).
// iPhone (Unity TcpClient) connect ke IP Mac:port, kirim frame per depth_protocol.
const net = require('net')
const { FrameParser } = require('./depth_protocol.js')

function startDepthServer ({ port = 7755, onFrame, onState } = {}) {
  const server = net.createServer(sock => {
    const who = sock.remoteAddress + ':' + sock.remotePort
    onState && onState('connected: ' + who)
    const parser = new FrameParser(f => onFrame && onFrame(f))
    sock.on('data', d => parser.push(d))
    sock.on('error', () => {})
    sock.on('close', () => onState && onState('terputus: ' + who))
  })
  server.on('error', e => onState && onState('server error: ' + e.message))
  server.listen(port, '0.0.0.0', () => onState && onState('waiting for iPhone at :' + port))
  return server
}

module.exports = { startDepthServer }
