const { contextBridge, ipcRenderer, webUtils } = require('electron')
const { pathToFileURL } = require('url')
contextBridge.exposeInMainWorld('hvft', {
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  openOutput: (displayId, deviceId) => ipcRenderer.invoke('open-output', { displayId, deviceId }),
  closeOutput: () => ipcRenderer.invoke('close-output'),
  mapMonitor: () => ipcRenderer.invoke('map-monitor'),
  onMapMonitor: (cb) => ipcRenderer.on('map-monitor', () => cb()),
  sendSettings: (s) => ipcRenderer.send('settings', s),
  loadPresets: () => ipcRenderer.invoke('load-presets'),
  savePresets: (d) => ipcRenderer.invoke('save-presets', d),
  onSettings: (cb) => ipcRenderer.on('settings', (e, s) => cb(s)),
  onOutputClosed: (cb) => ipcRenderer.on('output-closed', () => cb()),
  openPointCloud: () => ipcRenderer.invoke('open-pointcloud'),
  onDepthFrame: (cb) => ipcRenderer.on('depth-frame', (e, f) => cb(f)),
  onDepthState: (cb) => ipcRenderer.on('depth-state', (e, s) => cb(s)),
  kinectEnable: (on) => ipcRenderer.send('kinect-enable', !!on),
  kinectCmd: (c) => ipcRenderer.send('kinect-cmd', String(c)),
  onKinectState: (cb) => ipcRenderer.on('kinect-state', (e, s) => cb(s)),
  trace: (m) => ipcRenderer.send('trace', m),
  scenesLoad: () => ipcRenderer.invoke('scenes-load'), scenesSave: (d) => ipcRenderer.send('scenes-save', d),   // SCENES / PRESETS
  getRvmModel: () => ipcRenderer.invoke('get-rvm-model'),   // RVM MATTE
  syphonEnable: (on) => ipcRenderer.invoke('syphon-enable', !!on), syphonClients: () => ipcRenderer.invoke('syphon-clients'), syphonFrame: (f) => ipcRenderer.send('syphon-frame', f),   // SYPHON OUT   // TRACE RECORDER (trace_rec.js)
  onGpuCrashed: (cb) => ipcRenderer.on('gpu-crashed', (e, n) => cb(n)),   // GPU process died -> pages lighten their GPU work
  getKinectState: () => ipcRenderer.invoke('get-kinect-state'),
  getLidarIp: () => ipcRenderer.invoke('get-lidar-ip'),
  setLidarIp: (ip) => ipcRenderer.invoke('set-lidar-ip', ip),
  getMap: () => ipcRenderer.invoke('get-map'),
  setMap: (corners) => ipcRenderer.invoke('set-map', corners),
  sendAiDepth: (f) => ipcRenderer.send('ai-depth-frame', f),
  requestAiDepth: (on) => ipcRenderer.send('request-ai-depth', on),
  openDeck: () => ipcRenderer.invoke('open-deck'),
  sendComp: (c) => ipcRenderer.send('comp', c),
  onDisplaysChanged: (cb) => ipcRenderer.on('displays-changed', () => cb()),   // projector plugged in / out
  projPrepare: (displayId) => ipcRenderer.invoke('proj-prepare', displayId),   // PROJECTOR VIEW: which display the next projector window opens on
  outInfo: (i) => ipcRenderer.send('out-info', i), onOutInfo: (cb) => ipcRenderer.on('out-info', (e, i) => cb(i)), getOutInfo: () => ipcRenderer.invoke('get-out-info'), outputFullscreen: (on) => ipcRenderer.invoke('output-fullscreen', on),   // STAGE RESOLUTION
  onComp: (cb) => ipcRenderer.on('comp', (e, c) => cb(c)),
  onRequestAiDepth: (cb) => ipcRenderer.on('request-ai-depth', (e, on) => cb(on)),
  getDepthModel: () => ipcRenderer.invoke('get-depth-model'),
  getCollage: () => ipcRenderer.invoke('get-collage'),
  getBackgrounds: () => ipcRenderer.invoke('get-backgrounds'),
  aigenStart: () => ipcRenderer.invoke('aigen-start'),
  // HVFT Cam (Android) auto-discovery
  onHvftCamUp: (cb) => ipcRenderer.on('hvftcam-up', (e, d) => cb(d)),
  onHvftCamDown: (cb) => ipcRenderer.on('hvftcam-down', (e, d) => cb(d)),
  getHvftCamUrl: () => ipcRenderer.invoke('get-hvftcam-url'),
  hvftcamLog: (m) => ipcRenderer.send('hvftcam-log', m),
  hvftcamRescan: () => ipcRenderer.invoke('hvftcam-rescan'),   // scan the WiFi for the HVFT Cam phone once (camera list opened)
  saveDrop: (name, buf) => ipcRenderer.invoke('save-drop', { name, buf }),   // keep a dropped file without a path (projector + presets need a real file)
  // Electron 32+ tidak lagi menaruh .path di File; pakai webUtils
  fileInfo: (file) => {
    try {
      const p = webUtils.getPathForFile(file)
      if (!p) return null   // dragged from a browser / screenshot thumbnail: no file on disk -> saveDrop copies it into the app
      return { path: p, url: pathToFileURL(p).href, name: p.split('/').pop() }
    } catch (e) { return null }
  }
})
