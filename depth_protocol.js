// HVFT VISION — kontrak kabel depth (iPhone LiDAR -> Mac)
// Satu frame TCP, length-prefixed, little-endian. Mudah ditulis Unity C# (TcpClient).
//
//   [uint32] panjang payload (byte, tidak termasuk 4 byte ini)
//   payload:
//     [uint16] w
//     [uint16] h
//     [float32 x4] fx, fy, cx, cy   (intrinsik kamera depth)
//     [uint16 x w*h] depth milimeter (0 = tidak valid)
//     [uint8  x w*h*3] rgb
//
// Depth uint16 mm cukup untuk 0..65 m; RGB mentah agar Unity tak perlu encoder.

const HEADER = 4 + 2 + 2 + 16   // panjang-prefix + w + h + 4 float

function encodeFrame ({ w, h, fx, fy, cx, cy, depthMM, rgb }) {
  const body = 4 + 16 + w * h * 2 + w * h * 3
  const buf = Buffer.allocUnsafe(4 + body)
  let o = 0
  buf.writeUInt32LE(body, o); o += 4
  buf.writeUInt16LE(w, o); o += 2
  buf.writeUInt16LE(h, o); o += 2
  buf.writeFloatLE(fx, o); o += 4
  buf.writeFloatLE(fy, o); o += 4
  buf.writeFloatLE(cx, o); o += 4
  buf.writeFloatLE(cy, o); o += 4
  for (let i = 0; i < w * h; i++) { buf.writeUInt16LE(depthMM[i] | 0, o); o += 2 }
  for (let i = 0; i < w * h * 3; i++) { buf[o++] = rgb[i] }
  return buf
}

// parser streaming: makan Buffer, keluarkan frame lengkap
class FrameParser {
  constructor (onFrame) { this.onFrame = onFrame; this.buf = Buffer.alloc(0) }
  push (chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    for (;;) {
      if (this.buf.length < 4) return
      const body = this.buf.readUInt32LE(0)
      if (this.buf.length < 4 + body) return
      const p = this.buf.subarray(4, 4 + body)
      this.buf = this.buf.subarray(4 + body)
      this.onFrame(this.decode(p))
    }
  }
  decode (p) {
    let o = 0
    const w = p.readUInt16LE(o); o += 2
    const h = p.readUInt16LE(o); o += 2
    const fx = p.readFloatLE(o); o += 4
    const fy = p.readFloatLE(o); o += 4
    const cx = p.readFloatLE(o); o += 4
    const cy = p.readFloatLE(o); o += 4
    const depthMM = new Uint16Array(w * h)
    for (let i = 0; i < w * h; i++) { depthMM[i] = p.readUInt16LE(o); o += 2 }
    const rgb = new Uint8Array(p.subarray(o, o + w * h * 3))
    return { w, h, fx, fy, cx, cy, depthMM, rgb }
  }
}

module.exports = { encodeFrame, FrameParser, HEADER }
