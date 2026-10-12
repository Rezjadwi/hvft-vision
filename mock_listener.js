// HVFT VISION — mock iPhone (PENERIMA) untuk uji arah baru tanpa iPhone.
// Jalankan, lalu di app isi kolom "IP iPhone" = 127.0.0.1.
//   node mock_listener.js [port] [fps]
const net = require('net')
const { encodeFrame } = require('./depth_protocol.js')
const port = Number(process.argv[2] || 7755)
const fps = Number(process.argv[3] || 24)
const W = 160, H = 120, FX = W * 1.1, FY = W * 1.1, CX = W / 2, CY = H / 2

const srv = net.createServer(sock => {
  console.log('Mac tersambung:', sock.remoteAddress)
  let t = 0
  const iv = setInterval(() => {
    t += 1 / fps
    const d = new Uint16Array(W * H), rgb = new Uint8Array(W * H * 3)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, u = (x - CX) / CX, v = (y - CY) / CY
      const dHead = Math.hypot(u * 1.6, (v + 0.35) * 1.6), dBody = Math.hypot(u * 1.1, (v - 0.25) * 0.7)
      let z = 0, r = 0, g = 0, b = 0
      if (dHead < 0.42) { z = 1.7 + Math.sin(t * 1.3) * 0.03; r = g = b = 235 }
      else if (dBody < 0.62 && v > -0.35) { z = 1.75; r = 210; g = 220; b = 245 }
      else if (v > 0.55) { z = 2.4 + (v - 0.55) * 3.5; r = 40; g = 44; b = 60 }
      d[i] = (z * 1000) | 0; rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b
    }
    sock.write(encodeFrame({ w: W, h: H, fx: FX, fy: FY, cx: CX, cy: CY, depthMM: d, rgb }))
  }, 1000 / fps)
  sock.on('close', () => clearInterval(iv))
  sock.on('error', () => clearInterval(iv))
})
srv.listen(port, '0.0.0.0', () => console.log(`mock iPhone menunggu Mac di :${port} (isi IP app = 127.0.0.1)`))
