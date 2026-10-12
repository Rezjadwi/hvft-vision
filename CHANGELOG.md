# Changelog

## v0.1.0 — first public source (October 2026)

First public version of HVFT VISION, the noise-reactive VJ app for macOS (Apple Silicon).

### Deck and output
- Four-channel deck: CH1 is the camera with the person cut out; CH2 is depth, Kinect or LiDAR; CH3 is media or kinetic text; CH4 is AI.
- The projector has a single render engine. It moves to the external display automatically, goes fullscreen and follows hot-plugging.
- 4-corner mapping, one-click layouts (2×2 / CHx / MIX) and HD / CRISP / LITE quality.
- Preset decks A and B with 8 slots each, plus a LIVE slot that auto-saves and is restored on launch.
- SIMPLE / ADVANCED inspector.

### Audio
- Audio analysis splits sound into LOW / MID / HIGH bands plus Meyda textures (noisiness, peaks, sharpness).
- HOW REACTIVE sets how strongly sound drives the effects; 40 % is full reaction.
- When the mic is off, nothing moves.

### Visuals
- Background patterns: 15 in total, including Milkdrop via Butterchurn with 245 presets.
- 60 ISF shaders with knob parameters.
- 12 kinetic text styles: Random, Kinetic, Mesh, Dust, Wave, Squash, Shatter, Extrude, Stack, Grid, Spike, Gap.
- CHAOS flash, strobe, HVFT HOLO colour palette and custom hue.

### Depth and matting
- Depth Anything V2 (ONNX Runtime Web), Kinect v1 (libfreenect bridge) and iPhone LiDAR.
- Point-cloud styles: PRECISE, LIDAR SCAN, VOLUME SCAN, SPECTRAL and 4D.
- Person cut-out with MediaPipe Selfie Segmenter, or RVM for soft edges.

### AI on CH4
- Gemini image models (cloud, using your own key) with style presets and a style reference image.
- AI GEN: local Stable Diffusion Turbo on Apple Silicon (PyTorch MPS + diffusers + TAESD), with 8 style presets.

### Inputs, outputs and tools
- HVFT Cam: Android phone as a wireless camera (MJPEG over Wi-Fi, found automatically through mDNS).
- MIDI learn and Syphon output.
- Trace recorder: records audio and frames so you can check how closely the visuals follow the sound.
