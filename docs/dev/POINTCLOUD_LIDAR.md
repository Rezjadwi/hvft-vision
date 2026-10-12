# HVFT VISION — Point Cloud dari iPhone LiDAR

## ✅ JALAN (4 Sep 2026) — arah DIBALIK
- Mac = KLIEN, iPhone = PENERIMA. IP iPhone diisi dari APP (kolom "IP iPhone"
  di jendela Point Cloud), tak perlu rebuild Unity lagi kalau IP berubah.
- USB Personal Hotspot: iPhone selalu 172.20.10.1 (default kolom IP).
- File Mac: depth_client.js (klien), main.js (get/set-lidar-ip, IPC), 
  pointcloud_test.html (kolom IP). depth_protocol.js tetap. 
  depth_server.js sudah tidak dipakai.
- iPhone: DepthStreamSender.cs versi LISTENER (TcpListener :7755).
  REBUILD SEKALI dengan versi ini, setelah itu tak perlu lagi.
- Uji tanpa iPhone: `node mock_listener.js` lalu isi kolom IP app = 127.0.0.1.

## Yang sudah jadi (sisi Mac, sudah diuji)
- `pointcloud_test.html` — renderer WebGL: depth -> XYZ, warna RGB/Depth/Putih,
  kamera orbit. Pakai depth sintetis kalau belum ada iPhone; otomatis pindah ke
  data live begitu frame masuk.
- `depth_protocol.js` — kontrak kabel (encode/parse frame). Teruji: tahan
  fragmentasi TCP + frame beruntun.
- `depth_server.js` — server TCP penerima (port 7755), dijalankan `main.js`.
- `mock_sender.js` — pengirim TIRUAN (pengganti iPhone) untuk uji dari Mac.
- `main.js` + `preload.js` — server depth selalu nyala; tombol "Point Cloud 3D"
  di daftar efek kiri membuka jendela renderer; frame diteruskan via IPC.

## Cara uji SEKARANG (tanpa iPhone)
Dua terminal di folder ini:
```
# terminal 1
npm start                       # buka app; klik "◱ Point Cloud 3D" di kiri
# terminal 2
node mock_sender.js 127.0.0.1 7755 24
```
Jendela point cloud harus berpindah dari sosok sintetis ke sosok yang DIKIRIM
(status atas berubah "depth: terhubung…"). Kalau ini jalan, jalur Mac 100% siap.

## Kontrak kabel (1 frame TCP, little-endian)
```
[uint32] panjang payload
payload:
  [uint16] w
  [uint16] h
  [float32 x4] fx, fy, cx, cy      # intrinsik kamera depth
  [uint16 x w*h] depth milimeter   # 0 = tidak valid
  [uint8  x w*h*3] rgb
```
Bandwidth 256x192 @30fps ≈ 7.4 MB/s (LAN aman).

## Sisi iPhone — KERANGKA SUDAH ADA
`DepthStreamSender.cs` sudah ditulis di
`3_HVFT_PROJECTS/3_HVFT_AR/HVFT_DepthWireframe/DepthStreamSender.cs`.
Tinggal: pasang di scene AR, isi `occlusionManager` + `cameraManager`, set
`macIP` = IP Mac, build iOS. Belum teruji di device (perlu Unity+iPhone) —
kemungkinan perlu setel flipX/flipY di Inspector agar orientasi cocok.

## Detail (kalau perlu tulis ulang)
Di project `3_HVFT_AR` (sudah baca `environmentDepthTexture`), tambah 1 script C#
`DepthStreamSender.cs`:

1. Ambil depth tiap frame dari `AROcclusionManager.environmentDepthTexture`
   (format R32Float, meter) -> `AsyncGPUReadback` ke CPU.
2. Ambil RGB dari `ARCameraManager` (frame.capturedImage / kamera background),
   downscale ke ukuran depth (mis. 256x192).
3. Ambil intrinsik: `ARCameraManager.TryGetIntrinsics(out XRCameraIntrinsics k)`
   -> fx=k.focalLength.x, fy=k.focalLength.y, cx=k.principalPoint.x,
   cy=k.principalPoint.y (skalakan ke resolusi depth).
4. Encode sesuai kontrak: depth meter*1000 -> uint16 mm; tulis lewat
   `TcpClient` ke IP Mac : 7755. Pakai `BinaryWriter`, LITTLE-ENDIAN.
5. IP Mac lihat di System Settings -> Network (mis. 192.168.x.x); iPhone & Mac
   satu WiFi/hotspot. Kirim di thread terpisah, drop frame kalau socket penuh.

Catatan orientasi: depth ARKit portrait sering perlu rotate90 / flip
(README_DepthWireframe.md sudah mencatat ini). Kalau point cloud miring/kebalik,
setel di pengirim sebelum kirim, bukan di renderer.

## Berikutnya setelah live jalan
- Efek HVFT (point cloud glitch, noise wave, warna palet) di ruang 3D.
- Tombol gesture 3D (Ray/Inside) pakai posisi tangan dari depth.
- Kirim output point cloud ke monitor 2 / proyektor (WebGL yang sama dengan corner-pin).
