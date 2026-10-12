// HVFT VISION — kinect_bridge.js (main process)
// Runs kinect/kinect_bridge (libfreenect, Kinect v1) as a child process and turns its
// stdout into depth frames with the same shape as the iPhone LiDAR frames.
// The helper is compiled automatically on first use with the Mac's own compiler + Homebrew libfreenect.
const { spawn, execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, 'kinect', 'kinect_bridge.c')

function brewPrefix () {
  const c = [process.env.HOMEBREW_PREFIX, '/opt/homebrew', '/usr/local'].filter(Boolean)
  for (const p of c) {
    if (fs.existsSync(path.join(p, 'include', 'libfreenect', 'libfreenect.h')) || fs.existsSync(path.join(p, 'include', 'libfreenect.h'))) return p
  }
  return null
}

function ensureBinary (binDir, cb) {
  const bin = path.join(binDir, 'kinect_bridge')
  try {
    const sb = fs.statSync(bin), ss = fs.statSync(SRC)
    if (sb.mtimeMs >= ss.mtimeMs) return cb(null, bin)
  } catch (e) {}
  const pre = brewPrefix()
  if (!pre) return cb(new Error('libfreenect not found — run: brew install libfreenect'))
  try { fs.mkdirSync(binDir, { recursive: true }) } catch (e) {}
  const cc = fs.existsSync('/usr/bin/cc') ? '/usr/bin/cc' : 'cc'
  const args = ['-O2', '-o', bin, SRC, '-I' + path.join(pre, 'include', 'libfreenect'), '-I' + path.join(pre, 'include'),
    '-L' + path.join(pre, 'lib'), '-lfreenect', '-Wl,-rpath,' + path.join(pre, 'lib')]
  execFile(cc, args, { timeout: 60000 }, (err, so, se) => {
    if (err) return cb(new Error('compile failed: ' + String(se || err.message).split('\n').slice(0, 3).join(' ')))
    cb(null, bin)
  })
}

// fast stream parser (length-prefixed frames, see depth_protocol.js)
function mkParser (onFrame) {
  let buf = Buffer.alloc(0)
  return chunk => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
    for (;;) {
      if (buf.length < 4) return
      const body = buf.readUInt32LE(0)
      if (buf.length < 4 + body) return
      const p = buf.subarray(4, 4 + body); buf = buf.subarray(4 + body)
      const w = p.readUInt16LE(0), h = p.readUInt16LE(2), n = w * h
      const fx = p.readFloatLE(4), fy = p.readFloatLE(8), cx = p.readFloatLE(12), cy = p.readFloatLE(16)
      const depth = new ArrayBuffer(n * 2); new Uint8Array(depth).set(p.subarray(20, 20 + n * 2))
      const rgb = new ArrayBuffer(n * 3); new Uint8Array(rgb).set(p.subarray(20 + n * 2, 20 + n * 5))
      onFrame({ w, h, fx, fy, cx, cy, depth, rgb, kinect: true })
    }
  }
}

function startKinect ({ binDir, onFrame, onState } = {}) {
  let want = false, proc = null, timer = null, full = false, lastTilt = null, lastIr = 0
  const say = s => { onState && onState(s) }

  function launch () {
    timer = null
    if (!want || proc) return
    say('Kinect: preparing driver…')
    ensureBinary(binDir, (err, bin) => {
      if (err) { say('Kinect: ' + err.message); if (want) timer = setTimeout(launch, 8000); return }
      if (!want || proc) return
      const p = spawn(bin, full ? ['--full'] : [], { stdio: ['pipe', 'pipe', 'pipe'] })
      proc = p
      p.stdout.on('data', mkParser(f => onFrame && onFrame(f)))
      let eb = ''
      p.stderr.on('data', d => {
        eb += d.toString(); let k
        while ((k = eb.indexOf('\n')) >= 0) {
          const line = eb.slice(0, k).trim(); eb = eb.slice(k + 1)
          if (line.startsWith('STATE ')) {
            const s = line.slice(6)
            say('Kinect: ' + s.replace(/^(LIVE|WAIT|BUSY|ERROR)\s+/, (m, t) => t === 'LIVE' ? '● ' : t === 'ERROR' ? '✕ ' : '… '))
            if (/^LIVE Kinect streaming \d/.test(s)) { if (lastTilt != null) send('tilt ' + lastTilt); if (lastIr) send('ir 1') }
          }
        }
      })
      p.on('error', e => say('Kinect: ✕ ' + e.message))
      p.on('exit', () => {
        if (proc === p) proc = null
        if (want) { say('Kinect: reconnecting…'); timer = setTimeout(launch, 1500) } else say('Kinect: off')
      })
    })
  }
  function send (cmd) { try { if (proc && proc.stdin.writable) proc.stdin.write(String(cmd) + '\n') } catch (e) {} }
  function enable (on) {
    on = !!on
    if (on === want) return
    want = on
    if (on) { if (!timer) launch() } else {
      if (timer) { clearTimeout(timer); timer = null }
      if (proc) { try { proc.stdin.end() } catch (e) {} try { proc.kill('SIGTERM') } catch (e) {} }
      say('Kinect: off')
    }
  }
  return {
    enable,
    cmd (c) {
      const m = /^tilt\s+(-?[\d.]+)/.exec(String(c)); if (m) lastTilt = +m[1]
      const ir = /^ir\s+([01])/.exec(String(c)); if (ir) lastIr = +ir[1]
      if (String(c) === 'full 1' || String(c) === 'full 0') { const f = String(c) === 'full 1'; if (f !== full) { full = f; if (proc) try { proc.kill('SIGTERM') } catch (e) {} } return }
      send(c)
    },
    stop () { enable(false) }
  }
}

module.exports = { startKinect }
