// HVFT VISION — pc_scan_gl.js
// GPU renderer (WebGL2) for 3D STYLE 'scan' (LIDAR SCAN). Same look as the CPU path in pc_scan.js but with
// ~1–2 million sub-pixel grains per frame, HDR long-exposure accumulation, bloom glow and soft bokeh — the
// "ghost scan" look of Reza's references. The CPU path stays as the fallback (opt.scanGPU = false, or no WebGL2).
// Called from P._style_scan with everything it already computed (audio, room memory, view matrix).
;(function () {
  if (typeof PointCloudGPU === 'undefined') return
  const P = PointCloudGPU.prototype
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v

  const VS_PTS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uD; uniform sampler2D uB; uniform sampler2D uC;
uniform ivec2 uSz; uniform int uK; uniform int uMode; uniform int uHasC;
uniform mat4 uM; uniform vec4 uIn;
uniform float uFy, uInvZ, uLoHi, uLo, uSpan, uFar, uCut;
uniform float uFrame, uLa, uLb, uGain, uJr, uPz, uA0, uKk, uRoom, uRgbMix, uKpx, uPs;
uniform vec3 uCol0, uCol1;
out vec3 vC;
float hsh (uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return float(x) * (1.0 / 4294967295.0); }
float luma (vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
void main () {
  gl_PointSize = uPs; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vC = vec3(0.0);
  int id = gl_VertexID, pix = id / uK; int x = pix % uSz.x, y = pix / uSz.x;
  if (x < 1 || y < 1 || x >= uSz.x - 1 || y >= uSz.y - 1) return;
  float z0 = texelFetch(uD, ivec2(x, y), 0).r;
  if (z0 <= 0.05 || z0 > uFar) return;
  float near = 1.0 - clamp((z0 - uLo) / uSpan, 0.0, 1.0);
  if (near < uCut) return;
  if (uMode == 1) { float b = texelFetch(uB, ivec2(x, y), 0).r; if (!(b > 0.0 && b - z0 > 0.15)) return; }
  float zl = texelFetch(uD, ivec2(x - 1, y), 0).r, zr = texelFetch(uD, ivec2(x + 1, y), 0).r;
  float zu = texelFetch(uD, ivec2(x, y - 1), 0).r, zd = texelFetch(uD, ivec2(x, y + 1), 0).r;
  float gx = (zl > 0.0 && zr > 0.0) ? zr - zl : 0.0, gy = (zu > 0.0 && zd > 0.0) ? zd - zu : 0.0;
  float sp = z0 * 2.0 / uIn.x, s2 = (gx * gx + gy * gy) / (sp * sp);
  float edge, rim;
  if (uMode == 0) {
    float g1 = abs(zr - z0) + abs(zl - z0) + abs(zd - z0) + abs(zu - z0);
    edge = clamp((g1 / z0 - 0.012) * 9.0, 0.0, 1.0);
    rim = s2 > 300.0 ? 0.0 : 1.0 - inversesqrt(1.0 + s2);
  } else {
    bool brk = zl <= 0.0 || zr <= 0.0 || zu <= 0.0 || zd <= 0.0 || abs(zl - z0) > 0.08 || abs(zr - z0) > 0.08 || abs(zu - z0) > 0.08 || abs(zd - z0) > 0.08;
    edge = brk ? 1.0 : 0.0;
    rim = (brk || s2 > 300.0) ? 1.0 : 1.0 - inversesqrt(1.0 + s2);
  }
  uint seed = uint(id) * 747796405u + uint(uFrame) * 2891336453u + uint(uMode) * 977u;
  float u = hsh(seed) - 0.5, v = hsh(seed ^ 0x9e3779b9u) - 0.5;
  int dx = u < 0.0 ? -1 : 1, dy = v < 0.0 ? -1 : 1; float fu = abs(u), fv = abs(v);
  float z1 = texelFetch(uD, ivec2(x + dx, y), 0).r, z2 = texelFetch(uD, ivec2(x, y + dy), 0).r, z3 = texelFetch(uD, ivec2(x + dx, y + dy), 0).r;
  float tl = z0 * 0.04, zz = z0;
  if (z1 > 0.0 && z2 > 0.0 && z3 > 0.0 && abs(z1 - z0) < tl && abs(z2 - z0) < tl && abs(z3 - z0) < tl) zz = mix(mix(z0, z1, fu), mix(z2, z3, fu), fv);
  vec2 tc = (vec2(float(x), float(y)) + 0.5 + vec2(u, v)) / vec2(uSz), px = 1.0 / vec2(uSz);
  vec3 cc = uHasC == 1 ? texture(uC, tc).rgb : vec3(0.5);
  float lum = luma(cc);
  float lbl = uHasC == 1 ? (luma(texture(uC, tc + vec2(px.x, 0.0)).rgb) + luma(texture(uC, tc - vec2(px.x, 0.0)).rgb) + luma(texture(uC, tc + vec2(0.0, px.y)).rgb) + luma(texture(uC, tc - vec2(0.0, px.y)).rgb)) * 0.25 : lum;
  float hp = (lum - lbl) * uLb, Lv = uLa + uLb * lum;
  vec3 Pw = vec3((float(x) + u - uIn.z) / uIn.x * zz, uFy * (float(y) + v - uIn.w) / uIn.y * zz, uInvZ > 0.5 ? uLoHi - zz : zz);
  float k; vec3 col;
  if (uMode == 0) {
    float glow = clamp(edge * 0.8 + rim * 0.7 + max(hp, 0.0) * 2.5, 0.0, 1.0);
    col = mix(uCol0, uCol1, glow);
    if (uRgbMix > 0.0 && uHasC == 1) { float gr = (cc.r + cc.g + cc.b) / 3.0; col = mix(col, (cc + gr) * 0.75 * 255.0, uRgbMix); }
    k = uGain * uRoom * 0.75 * (0.14 + 0.9 * glow) * (0.45 + 0.55 * near) * (0.85 + uA0 * 0.4);
    if (uPz > 0.0) { float s = 1.0 - abs(z0 - uPz) / 0.12; if (s > 0.0) k *= 1.0 + s * 4.0; }
    k *= clamp(0.25 + Lv * 1.3, 0.12, 2.0);
  } else {
    float h2 = hp > 0.0 ? hp : -hp * 0.4;
    float glow = clamp(rim * 0.85 + h2 * 2.2, 0.0, 1.0);
    col = glow > 0.6 ? uCol1 : uCol0;
    float halo = hsh(seed ^ 0x1234567u) > 0.96 ? 7.0 : 1.0;
    Pw += (vec3(hsh(seed ^ 0xabcdu), hsh(seed ^ 0x5555u), hsh(seed ^ 0x7777u)) - 0.5) * uJr * 2.0 * halo;
    k = uGain * 0.8 * (0.07 + glow * 1.25 + uA0 * 0.3 + uKk * 0.3) * (0.6 + 0.4 * near) * max(0.0, 0.35 + Lv * 1.1) * (halo > 1.0 ? 0.45 : 1.0);
  }
  vec4 cp = uM * vec4(Pw, 1.0);
  if (cp.w <= 0.02) return;
  float spx = uKpx * z0 / cp.w;   // projected size of one depth pixel (screen px)
  k *= min(1.0, 1.8 * spx * spx / float(uK));   // sparse = bright grains, dense = smooth surface
  float sg = hsh(seed ^ 0x2468aceu); k *= 0.2 + 1.6 * sg * sg;   // sparkle: uneven grains read as scanned dust, not a solid surface
  vC = col * (k / 255.0);
  gl_Position = cp;
}`
  const FS_PTS = `#version 300 es
precision highp float; in vec3 vC; out vec4 o; void main () { o = vec4(vC, 1.0); }`
  // sprites: dust / spray (1 px) and bokeh (soft discs)
  const VS_SPR = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aP;   // xyz + world radius (0 = 1 px grain)
layout(location = 1) in vec3 aC;   // colour (already scaled)
uniform mat4 uM; uniform float uPpm;
out vec3 vC; out float vR;
void main () {
  vec4 cp = uM * vec4(aP.xyz, 1.0);
  vC = aC; vR = 0.0; gl_PointSize = 1.0;
  if (aP.w > 0.0 && cp.w > 0.02) { float s = clamp(aP.w * uPpm / cp.w * 2.0, 2.0, 28.0); gl_PointSize = s; vR = s; vC = aC / max(1.0, s * s * 0.25); }
  gl_Position = cp.w > 0.02 ? cp : vec4(2.0, 2.0, 2.0, 1.0);
}`
  const FS_SPR = `#version 300 es
precision highp float; in vec3 vC; in float vR; out vec4 o;
void main () { float f = 1.0; if (vR > 0.0) { float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; f = (1.0 - d * d * d * d) * 2.0; } o = vec4(vC * f, 1.0); }`
  const VS_Q = `#version 300 es
out vec2 vU; void main () { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vU = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`
  const FS_FADE = `#version 300 es
precision highp float; uniform sampler2D uT; uniform float uK; in vec2 vU; out vec4 o; void main () { o = vec4(texture(uT, vU).rgb * uK, 1.0); }`
  const FS_BLUR = `#version 300 es
precision highp float; uniform sampler2D uT; uniform vec2 uDir; in vec2 vU; out vec4 o;
void main () { vec3 c = texture(uT, vU).rgb * 0.227;
  c += (texture(uT, vU + uDir * 1.385).rgb + texture(uT, vU - uDir * 1.385).rgb) * 0.316;
  c += (texture(uT, vU + uDir * 3.231).rgb + texture(uT, vU - uDir * 3.231).rgb) * 0.070; o = vec4(c, 1.0); }`
  const FS_FINAL = `#version 300 es
precision highp float; uniform sampler2D uA; uniform sampler2D uBl; uniform float uBloom, uExp, uFrame; in vec2 vU; out vec4 o;
float hsh (vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uFrame * 0.618) * 43758.5453); }
void main () {
  vec3 c = texture(uA, vU).rgb + texture(uBl, vU).rgb * uBloom;
  c = 1.0 - exp(-c * uExp);                                   // soft HDR roll-off
  vec2 q = vU - 0.5; c *= 1.0 - dot(q, q) * 0.55;               // gentle vignette
  c += (hsh(gl_FragCoord.xy) - 0.5) * 0.018;                   // film grain
  o = vec4(max(c, 0.0), 1.0); }`

  function mkProg (gl, vs, fs) {
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o }
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name) }
    return { p, u }
  }
  function mkTex (gl, filter) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }
  function mkRT (gl, w, h) {
    const t = mkTex(gl, gl.LINEAR); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT)
    return { t, f, w, h, ok }
  }

  P._scanGLSetup = function (W, H) {
    if (this._sg === false) return null
    let g = this._sg
    try {
      if (!g) {
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H
        const gl = cv.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
        if (!gl || !gl.getExtension('EXT_color_buffer_float')) { this._sg = false; return null }
        g = this._sg = { cv, gl, W: 0, H: 0, lost: false }
        cv.addEventListener('webglcontextlost', e => { e.preventDefault(); g.lost = true })
        cv.addEventListener('webglcontextrestored', () => { this._sg = null })   // rebuild everything on the next frame
        g.pts = mkProg(gl, VS_PTS, FS_PTS); g.spr = mkProg(gl, VS_SPR, FS_SPR)
        g.fade = mkProg(gl, VS_Q, FS_FADE); g.blur = mkProg(gl, VS_Q, FS_BLUR); g.fin = mkProg(gl, VS_Q, FS_FINAL)
        g.vao = gl.createVertexArray()
        g.sVao = gl.createVertexArray(); g.sBuf = gl.createBuffer()
        gl.bindVertexArray(g.sVao); gl.bindBuffer(gl.ARRAY_BUFFER, g.sBuf)
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 28, 0)
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 16)
        gl.bindVertexArray(null)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      }
      if (g.lost) return null
      const gl = g.gl
      if (g.W !== W || g.H !== H) {
        g.cv.width = W; g.cv.height = H; g.W = W; g.H = H
        g.acc = [mkRT(gl, W, H), mkRT(gl, W, H)]; g.cur = 0
        const bw = Math.max(2, W >> 2), bh = Math.max(2, H >> 2)
        g.b1 = mkRT(gl, bw, bh); g.b2 = mkRT(gl, bw, bh)
        if (!g.acc[0].ok || !g.b1.ok) { this._sg = false; return null }
      }
      return g
    } catch (e) { console.warn('[pc_scan_gl] WebGL2 path off:', e && e.message); this._sg = false; return null }
  }

  P._scanGL = function (q) {
    const { a, O, LK, W, H, L, w, h, t, lo, hi, span, far, dep, rgb, bg, M, fy, invZ, A0, A1, A2, K, S, pz0, decay, roomAmt, detail, pv, R, rnd } = q
    if (typeof window !== 'undefined' && !window.__hvftGpuHook && window.hvft && window.hvft.onGpuCrashed) { window.__hvftGpuHook = 1; window.hvft.onGpuCrashed(nc => { window.HVFT_GPU_CRASHES = nc }) }
    if (typeof window !== 'undefined' && (window.HVFT_GPU_CRASHES || 0) >= 3 && !/output\.html$/.test(location.pathname)) return 0   // after repeated GPU crashes the previews use the CPU path
    const g = this._scanGLSetup(W, H); if (!g) return 0
    const gl = g.gl, n = w * h
    // ---- textures: depth (m), room memory (m), camera ----
    if (!g.dz || g.dz.length !== n) g.dz = new Float32Array(n)
    const dz = g.dz; for (let i = 0; i < n; i++) dz[i] = dep[i] * 0.001
    if (g.tw !== w || g.th !== h) {   // allocate the input textures ONCE per size (immutable storage), then only sub-upload
      for (const k of ['tD', 'tB', 'tC']) { try { gl.deleteTexture(g[k]) } catch (e) {} }
      g.tD = mkTex(gl, gl.NEAREST); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, w, h)
      g.tB = mkTex(gl, gl.NEAREST); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, w, h)
      g.tC = mkTex(gl, gl.LINEAR); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB8, w, h)
      g.tw = w; g.th = h
    }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tD); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.FLOAT, dz)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, g.tB); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.FLOAT, bg)
    let la = 0.5, lb = 0
    if (rgb) {
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, g.tC); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGB, gl.UNSIGNED_BYTE, rgb)
      let ls = 0, ls2 = 0, lc = 0
      for (let i = 0; i < n; i += 7) { const q3 = i * 3, l = (rgb[q3] * 0.3 + rgb[q3 + 1] * 0.59 + rgb[q3 + 2] * 0.11) / 255; ls += l; ls2 += l * l; lc++ }
      const lmu = ls / lc, lsd = Math.sqrt(Math.max(4e-4, ls2 / lc - lmu * lmu)); lb = 0.2 / lsd; la = 0.5 - lmu * lb
    }
    // ---- ghost centroid / floor / spray seeds (sparse CPU scan) ----
    const seeds = []; let sx = 0, sy = 0, sz = 0, nb = 0, flo = -1e9
    const lohi = lo + hi, ifx = 1 / L.fx, ify = 1 / L.fy
    for (let y = 2; y < h - 2; y += 2) {
      for (let x = 2; x < w - 2; x += 2) {
        const i = y * w + x, z = dz[i]; if (z <= 0.05 || z > far) continue
        const b = bg[i]; if (!(b && b - z > 0.15)) continue
        const X = (x - L.cx) * ifx * z, Y = fy * (y - L.cy) * ify * z, Z = invZ ? lohi - z : z
        sx += X; sy += Y; sz += Z; nb++; if (Y * fy > flo) flo = Y * fy
        const zl = dz[i - 2], zr = dz[i + 2], zu = dz[i - 2 * w], zd = dz[i + 2 * w]
        if ((!zl || !zr || !zu || !zd || Math.abs(zl - z) > 0.08 || Math.abs(zr - z) > 0.08 || Math.abs(zu - z) > 0.08 || Math.abs(zd - z) > 0.08) && (nb & 1)) seeds.push(X, Y, Z)
      }
    }
    if (nb > 15) { const c = [sx / nb, sy / nb, sz / nb]; S.bc = S.bc ? S.bc.map((v, k) => v + (c[k] - v) * 0.1) : c; S.floor = S.floor == null ? flo : S.floor + (flo - S.floor) * 0.05 }
    // ---- sprites: spray + dust + bokeh -> one buffer ----
    const ink = 1 - decay, gain = a.gain * ink * 2.2, sprite = []
    const pushS = (X, Y, Z, rad, c, f) => { sprite.push(X, Y, Z, rad, c[0] * f / 255, c[1] * f / 255, c[2] * f / 255) }
    if (O.spray !== false) {
      const sp = S.sp
      if (seeds.length) { const emit = Math.round(4 + A2 * 28 + K * 70); for (let e = 0; e < emit && sp.length < 4000; e++) { const j = ((rnd() * seeds.length / 3) | 0) * 3; sp.push([seeds[j], seeds[j + 1], seeds[j + 2], (rnd() - 0.5) * 0.012, -fy * rnd() * 0.004, (rnd() - 0.5) * 0.012, 1]) } }
      const gv = 0.0007 * fy, fl = S.floor != null ? S.floor : 1e9
      for (let k = sp.length - 1; k >= 0; k--) {
        const p = sp[k]; p[0] += p[3]; p[1] += p[4]; p[2] += p[5]; p[4] += gv
        if (p[1] * fy > fl) { p[1] = fl * fy; p[4] *= -0.2; p[3] *= 0.85; p[5] *= 0.85 }
        p[6] -= 0.007 + A2 * 0.004
        if (p[6] <= 0) { sp[k] = sp[sp.length - 1]; sp.pop(); continue }
        pushS(p[0], p[1], p[2], 0, LK.body, gain * 0.7 * p[6])
      }
    }
    const R2 = Math.min(R, 1.6), bx0 = pv[0] - R2 * 2, bxw = R2 * 4, by0 = pv[1] - R2 * 1.1, byh = R2 * 2.2
    const z0 = Math.max(0.3, lo - 0.3), zw = (hi + 0.6) - z0, toZ = z => invZ ? lohi - z : z
    if (O.scanAtmo !== false) {
      if (!this._satm2) {
        const A = []; let s = 99991; const r2 = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
        const blob = (x, y) => 0.5 + 0.5 * Math.sin(x * 1.7 + Math.sin(y * 1.3) * 1.9) * Math.cos(y * 1.1 + Math.sin(x * 0.7) * 2.3)
        while (A.length < 30000 * 4) { const u = r2(), v = r2(), ww = r2(); if (blob(u * 6, ww * 6 + v * 2) * (0.35 + 0.65 * (1 - v)) > 0.5) A.push(u, v, ww, r2()) }
        this._satm2 = A
      }
      S.drift = (S.drift || 0) + (q.dt || 0.016) * 0.008 * (1 + A1 * 4)
      const At = this._satm2, ak = gain * 0.4 * (1 + A1 * 0.6)
      for (let k = 0; k < At.length; k += 4) {
        const f = ak * (0.45 + 0.55 * Math.sin(t * 1.3 + At[k + 3] * 40)); if (f <= 0) continue
        const u = (At[k] + S.drift + At[k + 3] * 0.02) % 1
        pushS(bx0 + u * bxw, by0 + (fy > 0 ? At[k + 1] : 1 - At[k + 1]) * byh, toZ(z0 + At[k + 2] * zw), 0, LK.atmo, f)
      }
    }
    if (O.bokeh !== false) {
      if (!this._sbok) { const A = []; let s = 7771; const r2 = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; for (let k = 0; k < 40; k++) A.push([r2(), r2(), r2(), 0.02 + r2() * r2() * 0.07, r2() < 0.2, r2() * 6.28]); this._sbok = A }
      for (const b of this._sbok) {
        const fl = clamp(0.55 + 0.45 * Math.sin(t * (0.4 + b[3] * 30) + b[5]) + A2 * 0.7 * Math.max(0, Math.sin(t * 9 + b[5] * 3)), 0, 1.6)
        pushS(bx0 + b[0] * bxw, by0 + b[1] * byh, toZ(z0 + b[2] * zw), b[3], b[4] ? LK.bokeh[1] : LK.bokeh[0], gain * 9 * fl)
      }
    }
    // ---- render ----
    const Mf = g.Mf || (g.Mf = new Float32Array(16)); for (let i = 0; i < 16; i++) Mf[i] = M[i]
    const src = g.acc[g.cur], dst = g.acc[1 - g.cur]; g.cur = 1 - g.cur
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f); gl.viewport(0, 0, W, H)
    gl.disable(gl.BLEND); gl.useProgram(g.fade.p); gl.bindVertexArray(g.vao)
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, src.t); gl.uniform1i(g.fade.u.uT, 3); gl.uniform1f(g.fade.u.uK, decay)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE)
    // grains per depth pixel: ~0.3M .. 2M points per pass
    const isOut = typeof location !== 'undefined' && /output\.html$/.test(location.pathname)
    const crashes = (typeof window !== 'undefined' && window.HVFT_GPU_CRASHES) || 0
    const target = (250000 + detail * 1000000) * (isOut ? 1 : 0.35) / (1 + crashes)   // projector = full, dashboard/deck preview = light
    const Kk = clamp(Math.round(target / n), 1, 16)
    const pu = g.pts.u; gl.useProgram(g.pts.p)
    gl.uniform1i(pu.uD, 0); gl.uniform1i(pu.uB, 1); gl.uniform1i(pu.uC, 2); gl.uniform1i(pu.uHasC, rgb ? 1 : 0)
    gl.uniform2i(pu.uSz, w, h); gl.uniform1i(pu.uK, Kk); gl.uniformMatrix4fv(pu.uM, false, Mf)
    gl.uniform4f(pu.uIn, L.fx, L.fy, L.cx, L.cy)
    gl.uniform1f(pu.uFy, fy); gl.uniform1f(pu.uInvZ, invZ ? 1 : 0); gl.uniform1f(pu.uLoHi, lohi); gl.uniform1f(pu.uLo, lo); gl.uniform1f(pu.uSpan, span); gl.uniform1f(pu.uFar, far); gl.uniform1f(pu.uCut, a.cut || 0)
    gl.uniform1f(pu.uFrame, S.fr & 0xffffff); gl.uniform1f(pu.uLa, la); gl.uniform1f(pu.uLb, lb); gl.uniform1f(pu.uGain, gain); gl.uniform1f(pu.uPz, pz0)
    gl.uniform1f(pu.uA0, A0); gl.uniform1f(pu.uKk, K); gl.uniform1f(pu.uJr, 0.002 + A0 * 0.012 + K * 0.03); gl.uniform1f(pu.uRoom, roomAmt)
    gl.uniform1f(pu.uRgbMix, rgb ? LK.rgbMix : 0); gl.uniform1f(pu.uKpx, Math.hypot(M[0], M[8]) * W * 0.5 / L.fx); gl.uniform1f(pu.uPs, W > 1400 ? 1.4 : 1.0)
    if (roomAmt > 0) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tB)   // room pass reads the memory
      gl.uniform1i(pu.uMode, 0); gl.uniform3f(pu.uCol0, LK.room[0], LK.room[1], LK.room[2]); gl.uniform3f(pu.uCol1, LK.edge[0], LK.edge[1], LK.edge[2])
      gl.drawArrays(gl.POINTS, 0, n * Kk)
      gl.bindTexture(gl.TEXTURE_2D, g.tD)
    }
    gl.uniform1i(pu.uMode, 1); gl.uniform3f(pu.uCol0, LK.body[0], LK.body[1], LK.body[2]); gl.uniform3f(pu.uCol1, LK.bodyEdge[0], LK.bodyEdge[1], LK.bodyEdge[2])
    gl.drawArrays(gl.POINTS, 0, n * Math.min(32, Math.round(Kk * 1.4)))
    if (sprite.length) {
      gl.useProgram(g.spr.p); gl.uniformMatrix4fv(g.spr.u.uM, false, Mf); gl.uniform1f(g.spr.u.uPpm, Math.abs(M[5]) * H * 0.5)
      gl.bindVertexArray(g.sVao); gl.bindBuffer(gl.ARRAY_BUFFER, g.sBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sprite), gl.DYNAMIC_DRAW)
      gl.drawArrays(gl.POINTS, 0, sprite.length / 7); gl.bindVertexArray(g.vao)
    }
    // bloom: acc -> b1 (1/4) -> blur H -> b2 -> blur V -> b1
    gl.disable(gl.BLEND); gl.useProgram(g.blur.p); gl.uniform1i(g.blur.u.uT, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.b1.f); gl.viewport(0, 0, g.b1.w, g.b1.h)
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, dst.t); gl.uniform2f(g.blur.u.uDir, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.b2.f); gl.bindTexture(gl.TEXTURE_2D, g.b1.t); gl.uniform2f(g.blur.u.uDir, 1.6 / g.b1.w, 0); gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.b1.f); gl.bindTexture(gl.TEXTURE_2D, g.b2.t); gl.uniform2f(g.blur.u.uDir, 0, 1.6 / g.b1.h); gl.drawArrays(gl.TRIANGLES, 0, 3)
    // final
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H)
    gl.useProgram(g.fin.p)
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, dst.t); gl.uniform1i(g.fin.u.uA, 3)
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, g.b1.t); gl.uniform1i(g.fin.u.uBl, 4)
    gl.uniform1f(g.fin.u.uBloom, (O.scanGlow != null ? O.scanGlow : 0.8) * (1 + A0 * 0.5 + K * 0.6)); gl.uniform1f(g.fin.u.uExp, 1.0); gl.uniform1f(g.fin.u.uFrame, S.fr % 1000)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
    // hand the frame to the 2D pipeline
    a.ctx2d.drawImage(g.cv, 0, 0, W, H)
    return n * Kk
  }
})()
