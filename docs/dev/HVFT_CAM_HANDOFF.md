# HVFT Cam → HVFT Vision: Handoff Debug Brief (Okt 11, 2026)

## Tujuan
Feed kamera Android (APK HVFT Cam, MJPEG di `http://<ip>:8080/video`, mDNS "HVFT Cam")
muncul & auto-connect sebagai sumber kamera di dalam HVFT Vision (Electron), tanpa browser,
dan bisa dipilih per-channel (CH) di deck. APK: `~/Documents/HVFT_PROJECTS/APK-CAM-ANDROID`.

## STATUS: hampir jalan, tapi gambar belum stabil di deck
Discovery & dropdown SUDAH beres. Stream SUDAH pernah terdecode. Masih ada 2 ganjalan.

## Yang SUDAH terbukti JALAN (dari logs/hvft_crash.log, tag [HVFTCAM] & [HVFTCAM-R])
- mDNS nemu HP tiap boot: `[HVFTCAM] mDNS MATCH -> http://192.168.1.5:8080`.
- Entri "HVFT Cam (Android) · 192.168.1.5" muncul di dropdown SETTINGS **dan** per-channel (CH).
- Auto-connect saat boot: `boot camUrl=...` → `selectCameraSource hvftcam:...` → `startNetworkCamera .../video`.
- MJPEG terdecode beneran: pernah muncul `netCanvas FRAME PERTAMA 720x960` (jadi CORS/izin OK, decode OK).
- captureStream wiring aktif: `pipe.video <- netCanvas.captureStream`.

## Masalah #1 — frame intermiten
Pada run 13:40 ada `FRAME PERTAMA 720x960`. Pada run 13:44 (dua kali) **tidak ada** FRAME PERTAMA
→ `<img src=/video>` tak mengirim frame di run itu. Hipotesis kuat:
- Android `MjpegServer.kt` kemungkinan **single-client / blocking accept**: koneksi /video lama
  tak ditutup → koneksi baru (tiap startNetworkCamera / restart) nge-hang. Perlu: tutup socket
  stale, dukung reconnect, dan jaga stream tetap jalan saat layar HP mati (foreground service +
  wake lock). Cek apakah server benar-benar push frame terus-menerus.
- Atau layar HP terkunci / app ke background → CameraX pause.
- VERIFIKASI CEPAT (di Terminal macOS asli, BUKAN VM): `curl -N http://192.168.1.5:8080/video | head -c 2000`
  harus terus mengalir header `--boundary` + `Content-Type: image/jpeg`. Kalau nge-hang → masalah di server HP.

## Masalah #2 — override balik ke kamera device
Log: ~14 dtk setelah boot muncul `selectCameraSource <deviceId-hash>` → `startCamera dev=<hash>`
(mis. 13:40:57) yang menimpa net-cam balik ke FaceTime. Perlu dicari pemanggilnya & dibuat
net-cam "sticky":
- Pemanggil selectCameraSource(<deviceId>) / startCamera(<deviceId>): `#cam.onchange`,
  `boot()`, cabang device di deck_ui `select[data-f="cam"]` / `button[data-f="camkey"]`,
  atau restore preset/scene (`loadPresetStore` / `scenes`) yang menerapkan deviceId tersimpan,
  atau `aiSourceEl()` (control.js ~163, dipanggil setInterval 600ms **hanya** bila
  `window.HVFT_AI_LIVE_ON || HVFT_GAN_ON`).
- Deck juga set `window.HVFT_AICAM = deck.layers[0].camIdx` (buildComp); bila AI/GAN nyala,
  `aiSourceEl()` akan `pipe.startCamera(CAMS[camIdx].deviceId)` → menimpa net-cam.

## Pertanyaan verifikasi untuk fixer
1. Apakah compositor deck/projector menggambar kamera dari `pipe.video`? (captureStream sudah
   mengisi `pipe.video` dgn feed HP). Kalau deck pakai sumber lain (stream getUserMedia sendiri /
   elemen lain), itu yang bikin tetap FaceTime — arahkan ke `pipe.srcEl()` / `pipe.video`.
2. Pastikan server HP mengirim frame kontinu & tahan reconnect (Masalah #1).
3. Buat net-cam sticky: jangan biarkan restore/aiSourceEl menimpa saat user memilih HVFT Cam.

## File yang DIUBAH (+ backup .pre* ada di folder)
- `main.js`        — mDNS discovery log + **auto-scan subnet** fallback + replay `hvftcam-up` saat window did-finish-load. (backup `main.js.prehvftscan`)
- `pipeline.js`    — `startNetworkCamera(url)`/`stopNetworkCamera()`, netCanvas draw loop, **captureStream → pipe.video**, srcEl/srcSize. (backup `pipeline.js.prehvftcam`)
- `control.js`     — `selectCameraSource()` (cabang `hvftcam:`), `HVFT_CAMS` map + dropdown SETTINGS, onHvftCamUp/Down + auto-connect, boot HVFT-first. (backup `control.js.prehvftcam`)
- `deck_ui.js`     — HVFT Cam masuk `camOpts()` per-channel, `useHvftCamCh()`, cabang net di `select[data-f="cam"]` & camkey, `window.HVFT_DECK_REFRESH`. (backup `deck_ui.js.prehvftcam`)
- APK `MjpegServer.kt`: `/health` balas tanda tangan `"HVFT Cam id.hvft.hvftcam ok"`.

## Logging diagnostik (bisa dibersihkan setelah beres)
- main.js: `crashLog('[HVFTCAM] ...')` di discovery & scan.
- pipeline.js/control.js/deck_ui.js: `console.error('[HVFTCAM-R] ...')` → tertangkap di
  `logs/hvft_crash.log` sebagai "CONTROL JS error: [HVFTCAM-R] ...".
- Baca: `grep "HVFTCAM" logs/hvft_crash.log | tail -40`.

## Cara balikin cepat kalau perlu
`cp main.js.prehvftscan main.js; cp pipeline.js.prehvftcam pipeline.js; cp control.js.prehvftcam control.js; cp deck_ui.js.prehvftcam deck_ui.js`
