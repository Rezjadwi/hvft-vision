// HVFT VISION — pc_gpu.js
// Renderer point cloud 3D di GPU (pendekatan TouchDesigner): depth diunggah sebagai
// tekstur, unprojection + wave/glitch dikerjakan di VERTEX SHADER, blending aditif.
// Dipakai ulang: jendela Point Cloud, sumber L1 BASE di control, dan region di output.
// Kontrak frame sama dengan LiDAR/DEPTH-AI: {w,h,fx,fy,cx,cy,depth,rgb}.

const PC_VS = `
precision highp float;
attribute vec2 aUV;
uniform sampler2D uDepth;
uniform sampler2D uCol;
uniform vec2 uDSize;
uniform vec2 uRange;
uniform vec4 uIntr;
uniform mat4 uMVP;
uniform float uPointSize, uFlipY, uTime;
uniform float uBass, uOnset, uReact;
uniform float uWave, uGlitch, uDisperse;
uniform vec3 uCenter;
varying float vT; varying float vA; varying vec3 vC;
float h11 (float p) { return fract(sin(p * 127.1) * 43758.5453); }
void main () {
  vec4 t = texture2D(uDepth, aUV);
  vA = t.a; vT = t.r;
  vC = texture2D(uCol, aUV).rgb;
  float z = uRange.x + t.r * (uRange.y - uRange.x);
  vec2 px = aUV * uDSize;
  float X = (px.x - uIntr.z) / uIntr.x * z;
  float Y = (px.y - uIntr.w) / uIntr.y * z;
  Y = mix(-Y, Y, uFlipY);
  vec3 P = vec3(X, Y, z);
  P.z += sin((P.x + P.y) * 5.0 + uTime * 4.0) * uBass * uReact * 0.12 * uWave;
  float row = floor(aUV.y * 46.0);
  float g = h11(row + floor(uTime * 6.0) * 13.0) - 0.5;
  P.x += g * uOnset * uReact * 0.55 * uGlitch;
  vec3 d = P - uCenter;
  float dl = max(0.0001, length(d));
  float psh = (uBass * 0.7 + uOnset * 0.5) * uReact * 0.45 * uDisperse;
  P += d / dl * psh * (0.4 + h11(aUV.x * 91.7 + aUV.y * 37.3));
  gl_Position = uMVP * vec4(P, 1.0);
  gl_PointSize = uPointSize * (1.0 + uOnset * 0.8 * uReact) / max(0.25, gl_Position.w);
  if (vA < 0.45) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`
const PC_FS = `
precision mediump float;
varying float vT; varying float vA; varying vec3 vC;
uniform int uMode; uniform float uGlow;
void main () {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float a = pow(1.0 - r, 1.7);
  vec3 c = mix(vec3(0.88, 0.94, 1.0), vec3(0.14, 0.26, 0.96), pow(vT, 1.3));
  if (uMode == 1) c = vec3(1.0);
  else if (uMode == 2) c = vC;
  gl_FragColor = vec4(c * a * uGlow, a);
}`

class PointCloudGPU {
  constructor (canvas, o) {
    this.cv = canvas
    // --- state SELALU disiapkan lebih dulu, sebelum menyentuh WebGL ---
    // default = preset "feel" pilihan Reza (mesh scanline padat, warna kamera)
    this.opt = {
      densX: 3.4, densY: 1.12, pointSize: 5.2, glow: 1.76, farCut: 6.0, depthCut: 0.03,
      flipY: false, color: 'rgbcam', react: 0.70, wave: false, glitch: true, disperse: false,
      spin: false, spinSpeed: 0.0035, zoom: 1.0, mesh: false, meshThr: 0.05, meshStep: 2,
      voxel: false, voxelSize: 4, ortho: false
    }
    this.cam = { yaw: 0, pitch: 0, dist: 3.2, tx: 0, ty: -0.1, tz: 2.0 }
    this.live = null; this.bounds = null; this.fitPending = true
    this.gridW = 0; this.gridH = 0; this.nPts = 0
    this.dW = 0; this.dH = 0; this.dBuf = null; this.cBuf = null
    this.lo = 0.3; this.hi = 4.0; this.emaLo = null; this.emaHi = null
    this.bass = 0; this.onset = 0; this.t0 = performance.now()
    this.ok = false
    // --- WebGL opsional: hanya dipakai jalur GPU; kegagalan tidak fatal ---
    let gl = null
    if (o && o.noGL) { this.gl = null; return }   // CPU renderer only (layer comps / regions): don't burn a WebGL context
    try { gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true }) } catch (e) { gl = null }
    this.gl = gl
    if (!gl) return
    this.ok = true
    const sh = (ty, src) => {
      const s = gl.createShader(ty); gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
      return s
    }
    const p = this.prog = gl.createProgram()
    gl.attachShader(p, sh(gl.VERTEX_SHADER, PC_VS))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, PC_FS))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
    gl.useProgram(p)
    this.A_UV = gl.getAttribLocation(p, 'aUV')
    const U = n => gl.getUniformLocation(p, n)
    this.u = {
      depth: U('uDepth'), col: U('uCol'), dsize: U('uDSize'), range: U('uRange'), intr: U('uIntr'),
      mvp: U('uMVP'), ps: U('uPointSize'), flip: U('uFlipY'), time: U('uTime'),
      bass: U('uBass'), onset: U('uOnset'), react: U('uReact'),
      wave: U('uWave'), glitch: U('uGlitch'), disp: U('uDisperse'),
      center: U('uCenter'), mode: U('uMode'), glow: U('uGlow')
    }
    const mk = () => {
      const t = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    this.texD = mk(); this.texC = mk()
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    this.uvBuf = gl.createBuffer()
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    gl.clearColor(0, 0, 0, 1)

    // default = preset "feel" pilihan Reza (mesh scanline padat, warna kamera)
  }

  pushFrame (f) {
    if (!f) return          // jangan bergantung pada WebGL: jalur CPU tetap perlu frame
    this.live = {
      w: f.w, h: f.h, fx: f.fx, fy: f.fy, cx: f.cx, cy: f.cy,
      depth: new Uint16Array(f.depth), rgb: f.rgb ? new Uint8Array(f.rgb) : null
    }
  }
  setAudio (bass, onset) { this.bass = bass || 0; this.onset = onset || 0 }
  fit () { this.fitPending = true; this._fitReset = true }

  _grid (gw, gh) {
    if (gw === this.gridW && gh === this.gridH) return
    const gl = this.gl
    this.gridW = gw; this.gridH = gh; this.nPts = gw * gh
    const arr = new Float32Array(this.nPts * 2)
    let k = 0
    for (let j = 0; j < gh; j++) {
      const v = (j + 0.5) / gh
      for (let i = 0; i < gw; i++) { arr[k++] = (i + 0.5) / gw; arr[k++] = v }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf)
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW)
  }

  _upload () {
    const L = this.live; if (!L) return false
    const gl = this.gl, w = L.w, h = L.h, dep = L.depth, far = this.opt.farCut
    if (w !== this.dW || h !== this.dH) {
      this.dW = w; this.dH = h
      this.dBuf = new Uint8Array(w * h * 4); this.cBuf = new Uint8Array(w * h * 3)
    }
    let mn = 1e9, mx = -1e9
    for (let i = 0; i < w * h; i++) {
      const z = dep[i] / 1000
      if (z > 0.05 && z <= far) { if (z < mn) mn = z; if (z > mx) mx = z }
    }
    if (!(mx - mn > 0.03)) { mn = 0.3; mx = far }
    this.emaLo = this.emaLo == null ? mn : this.emaLo + (mn - this.emaLo) * 0.25
    this.emaHi = this.emaHi == null ? mx : this.emaHi + (mx - this.emaHi) * 0.25
    this.lo = this.emaLo; this.hi = Math.max(this.emaHi, this.lo + 0.05)
    const span = this.hi - this.lo, cut = this.opt.depthCut
    const dB = this.dBuf, cB = this.cBuf
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9, any = 0
    for (let i = 0; i < w * h; i++) {
      const z = dep[i] / 1000
      let ok = (z > 0.05 && z <= far) ? 1 : 0
      let zn = 0
      if (ok) {
        zn = (z - this.lo) / span
        zn = zn < 0 ? 0 : zn > 1 ? 1 : zn
        if ((1 - zn) < cut) ok = 0
      }
      const q = i * 4
      dB[q] = (zn * 255) | 0; dB[q + 1] = 0; dB[q + 2] = 0; dB[q + 3] = ok ? 255 : 0
      if (ok) {
        const x = i % w, y = (i / w) | 0
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x
        if (y < by0) by0 = y; if (y > by1) by1 = y
        any++
      }
      if (L.rgb) { cB[i * 3] = L.rgb[i * 3]; cB[i * 3 + 1] = L.rgb[i * 3 + 1]; cB[i * 3 + 2] = L.rgb[i * 3 + 2] }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texD)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, dB)
    gl.bindTexture(gl.TEXTURE_2D, this.texC)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, cB)
    if (any > 40) {
      const zc = (this.lo + this.hi) / 2
      const Xa = (bx0 - L.cx) / L.fx * zc, Xb = (bx1 - L.cx) / L.fx * zc
      const Ya = -(by1 - L.cy) / L.fy * zc, Yb = -(by0 - L.cy) / L.fy * zc
      const rad = Math.max(0.3, 0.5 * Math.hypot(Xb - Xa, Yb - Ya, this.hi - this.lo))
      this.bounds = { cx: (Xa + Xb) / 2, cy: (Ya + Yb) / 2, cz: zc, rad }
    }
    return true
  }

  // Salin hasil GPU ke canvas 2D lewat readPixels.
  // drawImage() dari canvas WebGL tersembunyi bisa mengembalikan hitam; ini selalu benar.
  blitTo (ctx2d) {
    if (!this.ok) return false
    const gl = this.gl, W = this.cv.width, H = this.cv.height
    if (!this._px || this._px.length !== W * H * 4) {
      this._px = new Uint8Array(W * H * 4)
      this._img = ctx2d.createImageData(W, H)
    }
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, this._px)
    // nilai piksel mentah dari GPU (untuk diagnostik): 0 = readback benar-benar kosong
    let mx = 0
    for (let i = 0; i < this._px.length; i += 128) { const v = this._px[i]; if (v > mx) mx = v }
    this.lastPxMax = mx
    // readPixels mulai dari kiri-BAWAH -> baris dibalik
    const d = this._img.data, rb = W * 4
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * rb
      d.set(this._px.subarray(src, src + rb), y * rb)
    }
    // Konteks dibuat dengan alpha:false -> readPixels bisa mengembalikan alpha 0.
    // Tanpa ini putImageData menghasilkan canvas transparan penuh = hitam di pipeline.
    for (let i = 3; i < d.length; i += 4) d[i] = 255
    ctx2d.putImageData(this._img, 0, 0)
    return true
  }

  // ---- Renderer PERANGKAT LUNAK (murni JS -> canvas 2D) ----
  // Dipakai untuk sumber L1 di app. Tanpa WebGL, tanpa readback, tanpa canvas
  // tersembunyi -> tidak ada jalur yang bisa gagal diam-diam.
  // garis aditif tipis (Bresenham) ke buffer ImageData
  _line (d, W, H, x0, y0, x1, y1, r, g, b) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
    let err = dx - dy
    // buang garis yang terlalu panjang (regangan tepi) -> jangan tembak melintang layar
    if (dx > W * 0.25 || dy > H * 0.25) return
    for (let n = 0; n < 512; n++) {
      if (x0 >= 0 && y0 >= 0 && x0 < W && y0 < H) {
        const q = (y0 * W + x0) * 4
        const nr = d[q] + r, ng = d[q + 1] + g, nb = d[q + 2] + b
        d[q] = nr > 255 ? 255 : nr; d[q + 1] = ng > 255 ? 255 : ng; d[q + 2] = nb > 255 ? 255 : nb
      }
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 > -dy) { err -= dy; x0 += sx }
      if (e2 < dx) { err += dx; y0 += sy }
    }
  }

  renderCPU (ctx2d) {
    const L = this.live; if (!L) return false
    const O = this.opt
    const W = ctx2d.canvas.width, H = ctx2d.canvas.height
    if (!this._ci || this._ci.width !== W || this._ci.height !== H) this._ci = ctx2d.createImageData(W, H)
    const d = this._ci.data
    d.fill(0)
    for (let i = 3; i < d.length; i += 4) d[i] = 255

    // normalisasi kedalaman (sama seperti jalur GPU)
    const w = L.w, h = L.h, dep = L.depth, far = O.farCut
    let mn = 1e9, mx = -1e9
    for (let i = 0; i < w * h; i++) { const z = dep[i] / 1000; if (z > 0.05 && z <= far) { if (z < mn) mn = z; if (z > mx) mx = z } }
    if (!(mx - mn > 0.03)) { mn = 0.3; mx = far }
    this.emaLo = this.emaLo == null ? mn : this.emaLo + (mn - this.emaLo) * 0.25
    this.emaHi = this.emaHi == null ? mx : this.emaHi + (mx - this.emaHi) * 0.25
    const lo = this.emaLo, hi = Math.max(this.emaHi, lo + 0.05), span = hi - lo
    this.lo = lo; this.hi = hi

    // batas 3D asli dari titik yang lolos -> auto-fit yang benar (bukan tebakan)
    const cutB = this.opt.depthCut
    let bnx = 1e9, bny = 1e9, bxx = -1e9, bxy = -1e9, nb = 0
    for (let y2 = 0; y2 < h; y2 += 2) {
      for (let x2 = 0; x2 < w; x2 += 2) {
        const i2 = y2 * w + x2
        const z2 = dep[i2] / 1000
        if (z2 <= 0.05 || z2 > far) continue
        let zn2 = (z2 - lo) / span; zn2 = zn2 < 0 ? 0 : zn2 > 1 ? 1 : zn2
        if ((1 - zn2) < cutB) continue
        const X2 = (x2 - L.cx) / L.fx * z2
        const Y2 = (O.flipY ? (y2 - L.cy) : -(y2 - L.cy)) / L.fy * z2
        if (X2 < bnx) bnx = X2; if (X2 > bxx) bxx = X2
        if (Y2 < bny) bny = Y2; if (Y2 > bxy) bxy = Y2
        nb++
      }
    }
    const zc = (lo + hi) / 2
    if (nb > 40) {
      this.bounds = { cx: (bnx + bxx) / 2, cy: (bny + bxy) / 2, cz: zc,
        rad: Math.max(0.3, 0.5 * Math.hypot(bxx - bnx, bxy - bny, hi - lo)) }
    } else if (!this.bounds) this.bounds = { cx: 0, cy: 0, cz: zc, rad: 1.2 }
    const C = this.cam
    if (this.fitPending && this.bounds) {
      const B = this.bounds
      C.tx = B.cx; C.ty = B.cy; C.tz = B.cz
      // fov vertikal 1.0 rad -> tan(0.5)=0.546; beri ruang supaya tidak meluber
      this.baseDist = Math.max(0.8, Math.min(14, B.rad / 0.72))
      this.fitPending = false
    }
    if (this.baseDist) C.dist = O.fit !== false ? this.baseDist : this.baseDist / (O.zoom || 1)   // FIT: zoom becomes a 2D scale on top of the fit
    if (O.spin) C.yaw += O.spinSpeed

    // matriks proyeksi * tampilan
    const asp = W / Math.max(1, H)
    const f = 1 / Math.tan(0.5), nf = 1 / (0.05 - 60)
    let proj = [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (60 + 0.05) * nf, -1, 0, 0, 2 * 60 * 0.05 * nf, 0]
    // KAMERA ORTOGRAFIS: proporsi flat (tak menyusut oleh jarak) + tetap ada kedalaman
    if (O.ortho) {
      const oh = Math.max(0.2, (this.bounds ? this.bounds.rad : 1.5)) / (O.fit !== false ? 1 : (O.zoom || 1))
      const ow = oh * asp
      proj = [1 / ow, 0, 0, 0, 0, 1 / oh, 0, 0, 0, 0, 2 * nf, 0, 0, 0, (60 + 0.05) * nf, 1]
    }
    const ex = C.tx + Math.sin(C.yaw) * Math.cos(C.pitch) * C.dist
    const ey = C.ty + Math.sin(C.pitch) * C.dist
    const ez = C.tz + Math.cos(C.yaw) * Math.cos(C.pitch) * C.dist
    let zx = ex - C.tx, zy = ey - C.ty, zz = ez - C.tz
    const zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl
    let sx0 = zz, sy0 = 0, sz0 = -zx
    const sl = Math.hypot(sx0, sy0, sz0) || 1; sx0 /= sl; sy0 /= sl; sz0 /= sl
    const tx0 = sy0 * zz - sz0 * zy, ty0 = sz0 * zx - sx0 * zz, tz0 = sx0 * zy - sy0 * zx
    const view = [sx0, tx0, zx, 0, sy0, ty0, zy, 0, sz0, tz0, zz, 0,
      -(sx0 * ex + sy0 * ey + sz0 * ez), -(tx0 * ex + ty0 * ey + tz0 * ez), -(zx * ex + zy * ey + zz * ez), 1]
    const m = new Float64Array(16)
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
      m[i * 4 + j] = proj[j] * view[i * 4] + proj[4 + j] * view[i * 4 + 1] + proj[8 + j] * view[i * 4 + 2] + proj[12 + j] * view[i * 4 + 3]

    // ---- FIT TO FRAME: measure the cloud's projected extent, then scale/centre it in screen space ----
    // (2D transform folded into the clip matrix -> applies to every mode & style; zoom slider still multiplies)
    if (O.fit !== false) {
      const xs = [], ys = [], stp = Math.max(2, Math.round(Math.sqrt(w * h / 2500)))
      for (let y = 0; y < h; y += stp) {
        for (let x = 0; x < w; x += stp) {
          const i = y * w + x, z = dep[i] / 1000
          if (z <= 0.05 || z > far) continue
          let zn = (z - lo) / span; zn = zn < 0 ? 0 : zn > 1 ? 1 : zn
          if ((1 - zn) < O.depthCut) continue
          const X = (x - L.cx) / L.fx * z, Y = (O.flipY ? (y - L.cy) : -(y - L.cy)) / L.fy * z, Z = O.invZ ? (lo + hi - z) : z
          const cw = m[3] * X + m[7] * Y + m[11] * Z + m[15]; if (cw <= 0.02) continue
          xs.push((m[0] * X + m[4] * Y + m[8] * Z + m[12]) / cw); ys.push((m[1] * X + m[5] * Y + m[9] * Z + m[13]) / cw)
        }
      }
      if (xs.length > 60) {
        xs.sort((a, b) => a - b); ys.sort((a, b) => a - b)
        const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, (a.length * f) | 0))]
        const x0 = q(xs, 0.02), x1 = q(xs, 0.98), y0 = q(ys, 0.02), y1 = q(ys, 0.98)
        const mg = O.fitMargin != null ? O.fitMargin : 0.94
        let sc = Math.min(2 * mg / Math.max(1e-3, x1 - x0), 2 * mg / Math.max(1e-3, y1 - y0))
        sc = Math.max(0.25, Math.min(8, sc)) * Math.max(0.2, O.zoom || 1)
        const tox = -sc * (x0 + x1) / 2, toy = -sc * (y0 + y1) / 2
        const F = this._fitT
        if (!F || this._fitReset) { this._fitT = { s: sc, ox: tox, oy: toy }; this._fitReset = false }
        else { F.s += (sc - F.s) * 0.08; F.ox += (tox - F.ox) * 0.08; F.oy += (toy - F.oy) * 0.08 }
      }
      const F = this._fitT
      if (F) {
        for (const [r, o] of [[0, F.ox], [1, F.oy]]) {
          m[r] = F.s * m[r] + o * m[3]; m[4 + r] = F.s * m[4 + r] + o * m[7]
          m[8 + r] = F.s * m[8 + r] + o * m[11]; m[12 + r] = F.s * m[12 + r] + o * m[15]
        }
      }
    }

    const t = (performance.now() - this.t0) / 1000
    const gain = O.glow * 0.52        // akumulasi aditif cepat jenuh -> tekan (naik utk ruangan gelap)
    const psBase = Math.max(1, O.pointSize * (H / 540))
    const cut = O.depthCut
    const rgb = L.rgb
    let drawn = 0

    // ---- DEPTH-ART STYLES (pc_styles.js): VOLUME SCAN / SPECTRAL ----
    if (O.style && O.style !== 'classic' && typeof this['_style_' + O.style] === 'function') {
      let ns = 0
      try { ns = this['_style_' + O.style]({ ctx2d, d, W, H, m, L, lo, hi, span, t, far, gain, cut }) } catch (e) { ns = 0; ctx2d.putImageData(this._ci, 0, 0) }
      this.nPts = ns
      return ns > 0
    }
    // ---- MODE VOXEL: kubus padat ber-oklusi (z-buffer), gaya block/instancing ----
    if (O.voxel) {
      if (!this._zbuf || this._zbuf.length !== W * H) this._zbuf = new Float32Array(W * H)
      const zb = this._zbuf; zb.fill(Infinity)
      const vsBase = Math.max(2, (O.voxelSize || 4) * (H / 540))
      for (let y = 0; y < h; y++) {
        const gsh = O.glitch ? ((Math.sin(y * 12.9898 + Math.floor(t * 6) * 13.0) * 43758.5453) % 1 - 0.5) * this.onset * O.react * 0.55 : 0
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          const z = dep[i] / 1000
          if (z <= 0.05 || z > far) continue
          let zn = (z - lo) / span; zn = zn < 0 ? 0 : zn > 1 ? 1 : zn
          if ((1 - zn) < cut) continue
          let X = (x - L.cx) / L.fx * z
          let Y = (O.flipY ? (y - L.cy) : -(y - L.cy)) / L.fy * z
          let Z = O.invZ ? (lo + hi - z) : z
          if (O.wave) Z += Math.sin((X + Y) * 5 + t * 4) * this.bass * O.react * 0.12
          X += gsh
          const cw = m[3] * X + m[7] * Y + m[11] * Z + m[15]
          if (cw <= 0.02) continue
          const sx = ((m[0] * X + m[4] * Y + m[8] * Z + m[12]) / cw * 0.5 + 0.5) * W | 0
          const sy = (1 - ((m[1] * X + m[5] * Y + m[9] * Z + m[13]) / cw * 0.5 + 0.5)) * H | 0
          const ndcz = (m[2] * X + m[6] * Y + m[10] * Z + m[14]) / cw
          let r, g, b
          if (O.color === 'rgbcam' && rgb) { r = rgb[i * 3]; g = rgb[i * 3 + 1]; b = rgb[i * 3 + 2] }
          else if (O.color === 'white') { r = 235; g = 240; b = 255 }
          else if (O.pal === 'hvft') { const q = Math.pow(zn, 1.2); r = 255 - 150 * q; g = 238 - 222 * Math.sqrt(q); b = 215 - 207 * Math.sqrt(q) }   // HVFT: near warm white -> far ember
        else { const q = Math.pow(zn, 1.3); r = (0.88 + (0.14 - 0.88) * q) * 255; g = (0.94 + (0.26 - 0.94) * q) * 255; b = (1.0 + (0.96 - 1.0) * q) * 255 }
          const vs = Math.max(2, (vsBase / cw) | 0)
          const x0 = sx - (vs >> 1), y0 = sy - (vs >> 1)
          for (let oy = 0; oy < vs; oy++) {
            const yy = y0 + oy; if (yy < 0 || yy >= H) continue
            const edgeY = (oy === 0 || oy === vs - 1)
            for (let ox = 0; ox < vs; ox++) {
              const xx = x0 + ox; if (xx < 0 || xx >= W) continue
              const pi = yy * W + xx
              if (ndcz >= zb[pi]) continue           // sudah ada kubus lebih dekat -> oklusi
              zb[pi] = ndcz
              let sh = 1
              if (edgeY || ox === 0 || ox === vs - 1) sh = 0.5   // garis tepi kubus (pemisah blok)
              else { const hl = 1 - (ox + oy) / (vs * 2); sh = 0.8 + hl * 0.4 }   // pencahayaan palsu kiri-atas
              const q = pi * 4
              d[q] = Math.min(255, r * sh); d[q + 1] = Math.min(255, g * sh); d[q + 2] = Math.min(255, b * sh)
            }
          }
          drawn++
        }
      }
      this.nPts = drawn
      ctx2d.putImageData(this._ci, 0, 0)
      return drawn > 0
    }

    // ---- MODE MESH (wireframe): sambung titik tetangga jadi jaring kawat ----
    if (O.mesh) {
      const N = w * h
      if (!this._mpx || this._mpx.length !== N) {
        this._mpx = new Int32Array(N); this._mpy = new Int32Array(N)
        this._mpz = new Float32Array(N); this._mpv = new Uint8Array(N)
      }
      const PX = this._mpx, PY = this._mpy, PZ = this._mpz, PV = this._mpv
      for (let y = 0; y < h; y++) {
        const gsh = O.glitch ? ((Math.sin(y * 12.9898 + Math.floor(t * 6) * 13.0) * 43758.5453) % 1 - 0.5) * this.onset * O.react * 0.55 : 0
        for (let x = 0; x < w; x++) {
          const i = y * w + x; PV[i] = 0
          const z = dep[i] / 1000
          if (z <= 0.05 || z > far) continue
          let zn = (z - lo) / span; zn = zn < 0 ? 0 : zn > 1 ? 1 : zn
          if ((1 - zn) < cut) continue
          let X = (x - L.cx) / L.fx * z
          let Y = (O.flipY ? (y - L.cy) : -(y - L.cy)) / L.fy * z
          let Z = O.invZ ? (lo + hi - z) : z
          if (O.wave) Z += Math.sin((X + Y) * 5 + t * 4) * this.bass * O.react * 0.12
          X += gsh
          const cw = m[3] * X + m[7] * Y + m[11] * Z + m[15]
          if (cw <= 0.02) continue
          const sx = ((m[0] * X + m[4] * Y + m[8] * Z + m[12]) / cw * 0.5 + 0.5) * W | 0
          const sy = (1 - ((m[1] * X + m[5] * Y + m[9] * Z + m[13]) / cw * 0.5 + 0.5)) * H | 0
          PX[i] = sx; PY[i] = sy; PZ[i] = zn; PV[i] = 1
        }
      }
      const thr = O.meshThr, ms = Math.max(1, O.meshStep | 0), lb = Math.min(0.6, O.glow * 0.09)
      for (let y = 0; y < h; y += ms) {
        for (let x = 0; x < w; x += ms) {
          const i = y * w + x
          if (!PV[i]) continue
          let r, g, b
          if (O.color === 'rgbcam' && rgb) { r = rgb[i * 3]; g = rgb[i * 3 + 1]; b = rgb[i * 3 + 2] }
          else if (O.color === 'white') { r = 235; g = 240; b = 255 }
          else { const q = Math.pow(PZ[i], 1.3); r = (0.85 + (0.16 - 0.85) * q) * 255; g = (0.92 + (0.30 - 0.92) * q) * 255; b = 255 }
          r *= lb; g *= lb; b *= lb
          const ri = i + ms, di = i + ms * w
          if (x + ms < w && PV[ri] && Math.abs(PZ[i] - PZ[ri]) < thr) { this._line(d, W, H, PX[i], PY[i], PX[ri], PY[ri], r, g, b); drawn++ }
          if (y + ms < h && PV[di] && Math.abs(PZ[i] - PZ[di]) < thr) { this._line(d, W, H, PX[i], PY[i], PX[di], PY[di], r, g, b); drawn++ }
        }
      }
      this.nPts = drawn
      ctx2d.putImageData(this._ci, 0, 0)
      return drawn > 0
    }

    for (let y = 0; y < h; y++) {
      // slab baris bergeser saat hentakan (glitch)
      const gsh = O.glitch ? ((Math.sin(y * 12.9898 + Math.floor(t * 6) * 13.0) * 43758.5453) % 1 - 0.5) * this.onset * O.react * 0.55 : 0
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const z = dep[i] / 1000
        if (z <= 0.05 || z > far) continue
        let zn = (z - lo) / span
        zn = zn < 0 ? 0 : zn > 1 ? 1 : zn
        if ((1 - zn) < cut) continue
        let X = (x - L.cx) / L.fx * z
        let Y = (O.flipY ? (y - L.cy) : -(y - L.cy)) / L.fy * z
        let Z = O.invZ ? (lo + hi - z) : z
        if (O.wave) Z += Math.sin((X + Y) * 5 + t * 4) * this.bass * O.react * 0.12
        X += gsh
        const cw = m[3] * X + m[7] * Y + m[11] * Z + m[15]
        if (cw <= 0.02) continue
        const cxv = m[0] * X + m[4] * Y + m[8] * Z + m[12]
        const cyv = m[1] * X + m[5] * Y + m[9] * Z + m[13]
        const sx = ((cxv / cw) * 0.5 + 0.5) * W | 0
        const sy = (1 - ((cyv / cw) * 0.5 + 0.5)) * H | 0
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue
        let r, g, b
        if (O.color === 'rgbcam' && rgb) { r = rgb[i * 3]; g = rgb[i * 3 + 1]; b = rgb[i * 3 + 2] }
        else if (O.color === 'white') { r = 255; g = 255; b = 255 }
        else if (O.pal === 'hvft') { const q = Math.pow(zn, 1.2); r = 255 - 150 * q; g = 238 - 222 * Math.sqrt(q); b = 215 - 207 * Math.sqrt(q) }   // HVFT: near warm white -> far ember
        else { const q = Math.pow(zn, 1.3); r = (0.88 + (0.14 - 0.88) * q) * 255; g = (0.94 + (0.26 - 0.94) * q) * 255; b = (1.0 + (0.96 - 1.0) * q) * 255 }
        r *= gain; g *= gain; b *= gain
        const sp = Math.max(1, Math.min(3, (psBase / cw) | 0))
        const half = sp * 0.5, inv = 1 / (half * half + 0.0001)
        for (let oy = 0; oy < sp; oy++) {
          const yy = sy + oy; if (yy >= H) break
          const dy = oy - half + 0.5
          for (let ox = 0; ox < sp; ox++) {
            const xx = sx + ox; if (xx >= W) break
            const dx = ox - half + 0.5
            const rr = (dx * dx + dy * dy) * inv
            if (rr > 1) continue
            const wg = (1 - rr) * (1 - rr)       // inti terang, tepi lembut
            const q = (yy * W + xx) * 4
            const nr = d[q] + r * wg, ng2 = d[q + 1] + g * wg, nb2 = d[q + 2] + b * wg
            d[q] = nr > 255 ? 255 : nr
            d[q + 1] = ng2 > 255 ? 255 : ng2
            d[q + 2] = nb2 > 255 ? 255 : nb2
          }
        }
        drawn++
      }
    }
    this.nPts = drawn
    ctx2d.putImageData(this._ci, 0, 0)
    return drawn > 0
  }

  render () {
    if (!this.ok) return false
    const gl = this.gl
    gl.viewport(0, 0, this.cv.width, this.cv.height)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!this._upload()) return false
    const O = this.opt, C = this.cam
    if (O.spin) C.yaw += O.spinSpeed
    if (this.fitPending && this.bounds) {
      C.tx = this.bounds.cx; C.ty = this.bounds.cy; C.tz = this.bounds.cz
      C.dist = Math.max(0.5, Math.min(12, this.bounds.rad / 0.82))
      this.fitPending = false
    }
    this._grid(Math.max(8, Math.round(this.dW * O.densX)), Math.max(4, Math.round(this.dH * O.densY)))
    const t = (performance.now() - this.t0) / 1000
    const asp = this.cv.width / Math.max(1, this.cv.height)
    const f = 1 / Math.tan(0.5), nf = 1 / (0.05 - 60)
    const proj = new Float32Array([f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (60 + 0.05) * nf, -1, 0, 0, 2 * 60 * 0.05 * nf, 0])
    const ex = C.tx + Math.sin(C.yaw) * Math.cos(C.pitch) * C.dist
    const ey = C.ty + Math.sin(C.pitch) * C.dist
    const ez = C.tz + Math.cos(C.yaw) * Math.cos(C.pitch) * C.dist
    let zx = ex - C.tx, zy = ey - C.ty, zz = ez - C.tz
    const zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl
    let sx = zz, sy = 0, sz = -zx
    const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl
    const tx = sy * zz - sz * zy, ty = sz * zx - sx * zz, tz = sx * zy - sy * zx
    const view = new Float32Array([sx, tx, zx, 0, sy, ty, zy, 0, sz, tz, zz, 0,
      -(sx * ex + sy * ey + sz * ez), -(tx * ex + ty * ey + tz * ez), -(zx * ex + zy * ey + zz * ez), 1])
    const mvp = new Float32Array(16)
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
      mvp[i * 4 + j] = view[j] * proj[i * 4] + view[4 + j] * proj[i * 4 + 1] + view[8 + j] * proj[i * 4 + 2] + view[12 + j] * proj[i * 4 + 3]

    gl.useProgram(this.prog)
    const u = this.u
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texD); gl.uniform1i(u.depth, 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texC); gl.uniform1i(u.col, 1)
    gl.uniformMatrix4fv(u.mvp, false, mvp)
    gl.uniform2f(u.dsize, this.dW, this.dH)
    gl.uniform2f(u.range, this.lo, this.hi)
    gl.uniform4f(u.intr, this.live.fx, this.live.fy, this.live.cx, this.live.cy)
    gl.uniform1f(u.ps, O.pointSize * (this.cv.height / 540))
    gl.uniform1f(u.flip, O.flipY ? 1 : 0)
    gl.uniform1f(u.time, t)
    gl.uniform1f(u.bass, this.bass); gl.uniform1f(u.onset, this.onset); gl.uniform1f(u.react, O.react)
    gl.uniform1f(u.wave, O.wave ? 1 : 0)
    gl.uniform1f(u.glitch, O.glitch ? 1 : 0)
    gl.uniform1f(u.disp, O.disperse ? 1 : 0)
    const b = this.bounds || { cx: 0, cy: 0, cz: 2 }
    gl.uniform3f(u.center, b.cx, b.cy, b.cz)
    gl.uniform1i(u.mode, O.color === 'white' ? 1 : O.color === 'rgbcam' ? 2 : 0)
    gl.uniform1f(u.glow, O.glow)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf)
    gl.enableVertexAttribArray(this.A_UV)
    gl.vertexAttribPointer(this.A_UV, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.POINTS, 0, this.nPts)
    return true
  }
}
window.PointCloudGPU = PointCloudGPU
