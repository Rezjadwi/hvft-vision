// HVFT VISION — pengirim TIRUAN (pengganti iPhone untuk uji dari komputer).
// Membuat depth sintetis (sosok bergerak) dan mengirim ke depth_server via TCP.
//   node mock_sender.js [host] [port] [fps]
const net = require('net')
const { encodeFrame } = require('./depth_protocol.js')

const host = process.argv[2] || '127.0.0.1'
const port = Number(process.argv[3] || 7755)
const fps = Number(process.argv[4] || 24)
const W = 160, H = 120
const FX = W * 1.1, FY = W * 1.1, CX = W / 2, CY = H / 2

const sock = net.connect(port, host, () => {
  console.log(`mock -> ${host}:${port} @${fps}fps (${W}x${H})`)
  let t = 0, sent = 0
  const iv = setInterval(() => {
    t += 1 / fps
    const depthMM = new Uint16Array(W * H)
    const rgb = new Uint8Array(W * H * 3)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, u = (x - CX) / CX, v = (y - CY) / CY
      const bob = Math.sin(t * 1.3) * 0.03
      const dHead = Math.hypot(u * 1.6, (v + 0.35) * 1.6)
      const dBody = Math.hypot(u * 1.1, (v - 0.25) * 0.7)
      let z = 0, r = 0, g = 0, b = 0
      if (dHead < 0.42) { z = 1.7 + bob; r = g = b = 235 }
      else if (dBody < 0.62 && v > -0.35) { z = 1.75 + bob; r = 210; g = 220; b = 245 }
      else if (v > 0.55) { z = 2.4 + (v - 0.55) * 3.5; r = 40; g = 44; b = 60 }
      depthMM[i] = (z * 1000) | 0
      rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b
    }
    sock.write(encodeFrame({ w: W, h: H, fx: FX, fy: FY, cx: CX, cy: CY, depthMM, rgb }))
    if (++sent % fps === 0) process.stdout.write('.')
  }, 1000 / fps)
  sock.on('close', () => clearInterval(iv))
})
sock.on('error', e => console.error('gagal connect:', e.message))
