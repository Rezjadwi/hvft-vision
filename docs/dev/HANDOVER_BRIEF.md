# HVFT VISION — Brief Sesi Berikutnya (versi Mac / Electron)

Sesi 3 Sep 2026. Aplikasi SUDAH JALAN. Jangan mulai dari nol — baca ini,
lalu `npm start` dan lanjutkan dari daftar "Rencana besok".

## Cara jalan
```bash
cd ~/"Documents/HVFT_PROJECTS/HVFT VISION MAC SOFTWARE"
npm install     # kalau node_modules belum ada
npm start
npm run dist    # DMG (belum pernah diuji)
```
Node dipasang lewat conda-forge (v26 alpha). Electron 44.1.1, electron-builder 26.
Kalau `npm run dist` bermasalah, curigai Node alpha ini dulu — ganti Node LTS 24.

## Kondisi sekarang (selesai)
- 6 efek diport LANGSUNG dari Kotlin `HVFT_PROJECTS/2_HVFT_VISION`:
  PointCloud, Triangulate, Volumetric, PixelLines, Scan + Constellation
  (yang terakhir dari `1_VisiFX/ConstellationRenderer.kt`). Recon DIHAPUS
  atas permintaan. Panel waveform di kanvas juga dihapus.
- Render dua lapis: `pixels(f)` per-piksel di buffer kerja (640/960/1280),
  `vector(ctx,f,D)` di resolusi layar. Blit cover/contain — rasio kamera dijaga.
- Segmentasi MediaPipe dijalankan pada KANVAS KERJA, jadi kamera / file video /
  gambar diperlakukan sama. Ada deteksi polaritas mask otomatis.
- Audio berbasis FREKUENSI (bukan dB): pita low/mid/high, spectral flux → onset,
  centroid. Menggerakkan kerapatan titik, letupan tepi, strobe, jaring
  Constellation. Indikator spektrum ada di panel.
- Playlist media (kamera + video/gambar, drag & drop, tombol ✕), overlay
  (logo/video) dengan blend, opacity, posisi, denyut onset, opsi di belakang.
- BlobTracker port penuh (flood-fill, glide, garis penghubung, tebal diatur),
  grid latar `dotGridMasked`, preset 6 slot (JSON di userData), UI responsif,
  skala HUD.

## Point cloud (dipilih: iPhone LiDAR -> Mac)
Renderer WebGL sudah ada: `pointcloud_test.html` (buka di browser) — unproject
depth -> XYZ, warna RGB/Depth/Putih, kamera orbit, diberi depth SINTETIS dulu.
Kontrak frame: { w,h, depth(m), rgb, fx,fy,cx,cy }.
Sumber `3_HVFT_AR` = app Unity on-device (bukan pengirim) — perlu ditambah
jembatan stream ke Mac.
Langkah: (1) kontrak kabel WebSocket (2) server penerima di main.js Electron
(bisa diuji dgn pengirim tiruan) (3) pengirim C# di Unity: environmentDepthTexture
+ RGB -> encode -> kirim (butuh Xcode + iPhone fisik).


## ✅ LIDAR POINT CLOUD JALAN (4 Sep 2026)
iPhone LiDAR -> Mac TERBUKTI end-to-end. 12k+ titik, 60fps, warna RGB asli.
- Koneksi: USB Personal Hotspot (iPhone = 172.20.10.1 TETAP, Mac = 172.20.10.2).
  Ini sekaligus menyelesaikan masalah IP WiFi yang berubah-ubah.
- Project Unity: HVFT_PROJECTS/3_HVFT_AR/HVFT_AR_Sender (Unity 6.5, AR Foundation 6.6,
  ARKit). Script: Assets/HVFT/DepthStreamSender.cs (Mac IP di Inspector XR Origin).
- Buka di Mac: HVFT VISION -> tombol '◱ Point Cloud 3D' di kiri. Server :7755 auto.
- Untuk build ulang iOS: Unity File->Build Profiles->Build, buka di Xcode, sign, Run.
  App iPhone TIDAK menampilkan apa2 (pengirim diam); jaga tetap foreground (Auto-Lock Never).
- CATATAN: kalau IP Mac berubah, ganti field Mac IP di Unity + build ulang. USB hotspot
  bikin ini jarang perlu. Opsi permanen: balik arah koneksi (Mac connect ke 172.20.10.1).

## BERIKUTNYA: efek HVFT di point cloud
Renderer WebGL (pointcloud_test.html) siap. Tambah: palet monokrom (Putih/Biru/Gray),
glitch, noise wave, reaksi audio frekuensi -> ke titik 3D. Lalu output ke proyektor.

## Rencana lama (urut)
1. **Corner-pin WebGL untuk SATU surface** di jendela output — 4 sudut ditarik,
   simpan/muat kalibrasi. Proyektor baru ada besok; ini yang harus dibuktikan
   presisi lebih dulu, sebelum multi-surface.
2. **Interface media gaya Resolume**: playlist sekarang masih satu-sumber-aktif.
   Targetnya pustaka media + kisi klip, bisa di-assign ke surface mana pun.
3. **Multi-surface / kubus 3 sisi**: tiap surface punya sumber + efek + overlay
   sendiri. Anggaran CPU: ~2 ms per pipeline di 960px, jadi resolusi harus
   per-surface, bukan global. PixelLines mahal (17 ms) — batasi.
4. Flip/rotasi per surface, blend mode antar surface.
5. **Depth sungguhan** untuk point cloud 3D:
   - Jalur B: MiDaS / Depth Anything lewat ONNX Runtime Web (model sama dengan
     `DepthHelper.kt` Android — MiDaS v2.1 small). Jalankan di worker 10–15 Hz,
     interpolasi antar frame.
   - Jalur C: LiDAR iPhone (project `3_HVFT_AR`) di-stream ke Mac via WebSocket
     — paling akurat, jalan di gelap total.
   - Titik 3D padat butuh WebGL — renderer yang sama dengan corner-pin.

## Jebakan yang sudah ditemui (jangan diulang)
- `cd "~/..."` — zsh tidak memekarkan `~` di dalam kutip.
- Electron lama ditandai malware palsu oleh XProtect → pakai Electron terbaru.
- `ERR_REQUIRE_ESM` saat install Electron → Node < 22.9.
- Ubah `main.js` butuh restart penuh (⌘Q), bukan reload jendela.
- Benchmark efek harus lewat file/`require`, bukan `eval` (deoptimasi ~10×).
