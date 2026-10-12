// HVFT VISION — kinect_bridge.c
// Kinect v1 (Xbox 360 / Kinect for Windows) via libfreenect  ->  stdout
// Frames use the same wire format as depth_protocol.js (iPhone LiDAR):
//   [u32 bodyLen][u16 w][u16 h][f32 fx fy cx cy][u16 depthMM x w*h][u8 rgb x w*h*3]   (little-endian)
// Depth = FREENECT_DEPTH_REGISTERED (millimetres, aligned to the RGB camera, 0 = invalid).
// Status lines go to stderr as "STATE <text>".  Commands on stdin: "tilt <deg>", "led <0-6>", "ir 1|0".
// IR mode: the video stream switches to the infrared camera (works in total darkness, shows the laser speckle);
// the IR picture is sent in the rgb bytes as grey (r=g=b). RGB and IR cannot stream at the same time on Kinect v1.
// Build (main.js does this automatically):
//   cc -O2 -o kinect_bridge kinect_bridge.c -I$(brew --prefix)/include/libfreenect -L$(brew --prefix)/lib -lfreenect
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <signal.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/select.h>
#include <sys/time.h>
#include "libfreenect.h"

#define FW 640
#define FH 480

static volatile sig_atomic_t quit = 0;
static uint16_t depthBuf[FW * FH];
static uint8_t rgbBuf[FW * FH * 3];
static volatile int newDepth = 0, haveRgb = 0;
static int STEP = 2;
static volatile int irMode = 0, wantIr = 0;
static int withMotor = 1;
static uint32_t vbytes = FW * FH * 3;

static void state (const char *s) { fprintf(stderr, "STATE %s\n", s); fflush(stderr); }
static void on_sig (int s) { (void)s; quit = 1; }

static void depth_cb (freenect_device *d, void *v, uint32_t ts) { (void)d; (void)ts; memcpy(depthBuf, v, sizeof depthBuf); newDepth = 1; }
static void video_cb (freenect_device *d, void *v, uint32_t ts) {
  (void)d; (void)ts;
  if (irMode) {   // IR 8-bit 640x488 -> grey into the top 640x480 of rgbBuf
    const uint8_t *s = (const uint8_t *)v; const int n = FW * FH;
    for (int i = 0; i < n && (uint32_t)i < vbytes; i++) { uint8_t g = s[i]; rgbBuf[i * 3] = g; rgbBuf[i * 3 + 1] = g; rgbBuf[i * 3 + 2] = g; }
  } else memcpy(rgbBuf, v, sizeof rgbBuf);
  haveRgb = 1;
}

static int put_u16 (uint8_t *p, uint16_t v) { p[0] = v & 255; p[1] = v >> 8; return 2; }
static int put_u32 (uint8_t *p, uint32_t v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; return 4; }
static int put_f32 (uint8_t *p, float f) { uint32_t u; memcpy(&u, &f, 4); return put_u32(p, u); }

static int emit (void) {
  const int w = FW / STEP, h = FH / STEP, n = w * h;
  static uint8_t *out = NULL; static size_t cap = 0;
  const uint32_t body = 4 + 16 + (uint32_t)n * 2 + (uint32_t)n * 3;
  if (cap < body + 4) { free(out); cap = body + 4; out = malloc(cap); if (!out) return -1; }
  uint8_t *p = out;
  p += put_u32(p, body); p += put_u16(p, (uint16_t)w); p += put_u16(p, (uint16_t)h);
  // Kinect v1 RGB intrinsics (registered depth lives in RGB space), scaled to the output size
  p += put_f32(p, 525.0f / STEP); p += put_f32(p, 525.0f / STEP);
  p += put_f32(p, 319.5f / STEP); p += put_f32(p, 239.5f / STEP);
  // depth: nearest valid sample in each STEPxSTEP block (keeps edges clean, avoids averaging with 0)
  for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
    uint16_t best = 0;
    for (int j = 0; j < STEP; j++) for (int i = 0; i < STEP; i++) {
      uint16_t z = depthBuf[(y * STEP + j) * FW + x * STEP + i];
      if (z && (!best || z < best)) best = z;
    }
    p += put_u16(p, best);
  }
  // rgb: box average
  for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
    unsigned r = 0, g = 0, b = 0;
    for (int j = 0; j < STEP; j++) for (int i = 0; i < STEP; i++) {
      const uint8_t *s = rgbBuf + ((y * STEP + j) * FW + x * STEP + i) * 3; r += s[0]; g += s[1]; b += s[2];
    }
    const unsigned k = STEP * STEP;
    *p++ = r / k; *p++ = g / k; *p++ = b / k;
  }
  size_t len = (size_t)(p - out), o = 0;
  while (o < len) { ssize_t wr = write(1, out + o, len - o); if (wr <= 0) return -1; o += (size_t)wr; }
  return 0;
}

static int stdin_closed (void) {   // parent (Electron) gone -> stop waiting
  fd_set fs; struct timeval tv = { 0, 0 }; char c[64];
  FD_ZERO(&fs); FD_SET(0, &fs);
  if (select(1, &fs, NULL, NULL, &tv) > 0 && read(0, c, sizeof c) == 0) return 1;
  return 0;
}

static void poll_stdin (freenect_device *dev) {
  static char line[128]; static int ln = 0;
  fd_set fs; struct timeval tv = { 0, 0 };
  FD_ZERO(&fs); FD_SET(0, &fs);
  if (select(1, &fs, NULL, NULL, &tv) <= 0) return;
  char c[64]; ssize_t r = read(0, c, sizeof c);
  if (r == 0) { quit = 1; return; }            // parent closed stdin -> exit
  for (ssize_t k = 0; k < r; k++) {
    if (c[k] == '\n' || ln >= (int)sizeof line - 1) {
      line[ln] = 0; ln = 0;
      double v;
      if (sscanf(line, "tilt %lf", &v) == 1) { if (!withMotor) continue; if (v < -27) v = -27; if (v > 27) v = 27; freenect_set_tilt_degs(dev, v); }
      else if (sscanf(line, "led %lf", &v) == 1) { if (withMotor) freenect_set_led(dev, (freenect_led_options)(int)v); }
      else if (sscanf(line, "ir %lf", &v) == 1) wantIr = v > 0.5 ? 1 : 0;
    } else line[ln++] = c[k];
  }
}

int main (int argc, char **argv) {
  for (int a = 1; a < argc; a++) if (!strcmp(argv[a], "--full")) STEP = 1;
  signal(SIGTERM, on_sig); signal(SIGINT, on_sig); signal(SIGPIPE, on_sig);
  freenect_context *ctx = NULL;
  if (freenect_init(&ctx, NULL) < 0) { state("ERROR libfreenect init failed"); return 1; }
  freenect_set_log_level(ctx, FREENECT_LOG_FATAL);
  freenect_device *dev = NULL;
  int lastWait = -1;
  while (!quit) {
    if (stdin_closed()) { quit = 1; break; }
    freenect_select_subdevices(ctx, withMotor ? (freenect_device_flags)(FREENECT_DEVICE_MOTOR | FREENECT_DEVICE_CAMERA) : FREENECT_DEVICE_CAMERA);
    int n = freenect_num_devices(ctx);
    if (n < 1) { if (lastWait != 0) state("WAIT no Kinect on USB — plug it in (and its power adapter)"); lastWait = 0; sleep(1); continue; }
    if (freenect_open_device(ctx, &dev, 0) == 0) break;
    if (withMotor) { withMotor = 0; continue; }  // some models (1473) refuse the motor subdevice -> camera only
    withMotor = 1;
    if (lastWait != 1) state("BUSY Kinect found but in use — close other Kinect apps (freenect-glview)");
    lastWait = 1; sleep(2);
  }
  if (quit) { freenect_shutdown(ctx); return 0; }
  freenect_set_depth_mode(dev, freenect_find_depth_mode(FREENECT_RESOLUTION_MEDIUM, FREENECT_DEPTH_REGISTERED));
  freenect_set_video_mode(dev, freenect_find_video_mode(FREENECT_RESOLUTION_MEDIUM, FREENECT_VIDEO_RGB));
  freenect_set_depth_callback(dev, depth_cb);
  freenect_set_video_callback(dev, video_cb);
  if (freenect_start_depth(dev) < 0 || freenect_start_video(dev) < 0) { state("ERROR could not start Kinect streams"); freenect_close_device(dev); freenect_shutdown(ctx); return 2; }
  if (withMotor) freenect_set_led(dev, LED_GREEN);
  { char m[96]; snprintf(m, sizeof m, "LIVE Kinect streaming %dx%d depth+rgb%s", FW / STEP, FH / STEP, withMotor ? " · tilt ready" : ""); state(m); }
  struct timeval tv = { 0, 100000 };
  while (!quit) {
    if (freenect_process_events_timeout(ctx, &tv) < 0) { state("ERROR Kinect disconnected"); break; }
    if (newDepth && haveRgb) { newDepth = 0; if (emit() < 0) break; }
    poll_stdin(dev);
    if (wantIr != irMode) {   // switch the video stream RGB <-> IR
      freenect_stop_video(dev);
      const freenect_frame_mode vm = freenect_find_video_mode(FREENECT_RESOLUTION_MEDIUM, wantIr ? FREENECT_VIDEO_IR_8BIT : FREENECT_VIDEO_RGB);
      vbytes = (uint32_t)vm.bytes; irMode = wantIr; haveRgb = 0;
      freenect_set_video_mode(dev, vm);
      if (freenect_start_video(dev) < 0) { state("ERROR could not restart the video stream"); break; }
      state(irMode ? "LIVE Kinect streaming depth+IR (infrared, works in the dark)" : "LIVE Kinect streaming depth+rgb");
    }
  }
  freenect_stop_depth(dev); freenect_stop_video(dev);
  if (withMotor) freenect_set_led(dev, LED_OFF);
  freenect_close_device(dev); freenect_shutdown(ctx);
  return quit ? 0 : 3;
}
