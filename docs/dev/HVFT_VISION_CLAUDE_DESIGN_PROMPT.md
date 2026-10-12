# CLAUDE DESIGN BRIEF — "HVFT VISION" LIVE VISUAL CONTROL UI (v2 — FUTURISTIC HUD)

Copy everything below the line into Claude Design. Written to be self-contained.

---

## ROLE
You are a senior UI/visual designer for pro audiovisual software. Design the control interface for **HVFT VISION**, a live visual (VJ) desktop app. Deliver a polished, production-ready UI as a **single self-contained HTML page** (inline CSS + inline SVG, no external assets, no frameworks) that previews full-screen. This must look like a real, usable **cockpit for live performance** — not a landing page, not decorative concept art. Function first, but the skin is aggressively futuristic.

## WHO IT'S FOR
HVFT is a harsh-noise / experimental musician (artist name **HVFT**, real name Reza). This runs on a laptop on a dark stage driving a projector. The operator is often the performer. Controls must be **large, glanceable, legible in the dark, hard to mis-hit**. The whole thing should feel like a weapon system / spacecraft HUD, not a consumer app.

## CORE AESTHETIC — NON-NEGOTIABLE
- **Strictly monochrome + ONE accent.** Near-black `#0A0A0A` base, white/greys, and a single accent **orange `#F2A03D`** used only for live/active/armed/selected/"danger" states. No other hues.
- **Futuristic cyberpunk HUD / harsh-noise brutalism.** Think: sci-fi weapon UI, targeting reticles, telemetry readouts, industrial hazard decals, Y2K acid-graphic sticker energy. Dense, technical, alive — brutal but ordered.

## TYPOGRAPHY
- **Display / headers / wordmark:** a wide, futuristic techno display face in the spirit of **"Gun"** (that squared, extended, slightly italic sci-fi style seen in moto/acid graphics like `HVRDCOR`, `GROMGEAR`). If unavailable, approximate with a wide geometric like `Orbitron`, `Michroma`, `Rajdhani`, or heavy letter-spaced condensed caps. Big, stretched, uppercase.
- **Data / labels / values:** monospace (`ui-monospace`, Menlo, `Space Mono`, `JetBrains Mono`). Numbers must feel like telemetry.
- Use bracketed/serial chrome everywhere: `[ CH.01 ]`, `▸ SUMBER`, `SN-7XK02`, tiny barcodes, tick marks, small-caps, katakana accents (e.g. 病気 / 桃 / 危険) as decorative texture — sparse, never blocking controls.

## VISUAL LANGUAGE / HUD ASSETS TO USE (this is the new direction)
Build the controls themselves out of futuristic HUD parts (draw them as inline SVG/CSS), inspired by cyberpunk brush kits, targeting HUDs, and dark neon data-card mockups:

- **Radial gauges / dials** for the most important continuous parameters (opacity, strobe Hz, Kuasa Cahaya, link amount) — arcs and rings like a telemetry gauge / activity ring, with the value in big mono numerals in the center and a glowing orange arc showing the level. Reticle crosshairs and tick rings around them.
- **Segmented loading-bar sliders** for the rest — horizontal meters made of ticked segments/notches (like a sci-fi loading bar), filled portion glowing orange, with the numeric value on the right.
- **Cyber-window frames** around every panel: notched/beveled/cut corners, hairline borders, little corner brackets `⌐ ¬ L ⌐`, a title tab, status dots, and a subtle hazard/serial stripe. Panels should read as modular HUD windows, not plain rounded cards.
- **Decal / label chrome:** small industrial stickers and tags — barcodes, serial numbers (`DS4-1774822-5`), `CAUTION` / `DANGER` / biohazard-style chips, mini reticles — used as accents on headers and status areas.
- **Toggles as armed switches:** big physical-feeling arm/disarm switches with an orange glow when live (especially the MIC arm). Reticle/target lock on the selected channel.
- **Idle / background texture:** very subtle — faint scanlines, dither/noise, a wireframe skull or wireframe head or lightning motif ghosted at low opacity behind empty zones (harsh-noise identity), plus a fine HUD grid. Never let texture reduce control legibility.
- Borrow the *treatment* of premium dark neon data-card UIs (glowing single-accent readouts, crisp mono numerals, segmented meters) but recolor everything to mono + orange `#F2A03D`.

## LAYOUT MODEL (proven VJ ergonomics, from Resolume — keep this structure)
A single control window with these zones:

1. **TOP TRANSPORT BAR (full width):** `HVFT VISION` wordmark in the Gun-style display face; a big **MIC ARM** switch (armed/disarmed); master **AUDIO REACTIVITY** dial labeled `SEBERAPA REAKTIF`; **BPM / TAP**; master opacity / **BLACKOUT**; FPS + status telemetry readout; a **MAP** button that opens projector mapping. Live indicators glow orange only when active.

2. **LEFT — MONITORS (stacked):** large **PROGRAM** preview (projector feed) on top with a glowing orange HUD frame when live; smaller **PREVIEW** below. Checkerboard where transparent, reticle overlay in the corners.

3. **CENTER-LEFT — CHANNEL STACK (heart of the app):** exactly **4 fixed channels** `CH.01–CH.04`, stacked as HUD modules. Each: channel tag, a **SOURCE** selector (Camera / Media / Text / Generator), an **EFFECT** selector, arm/on switch, an **opacity** gauge, **blend mode**, solo/bypass. Selected channel gets a target-lock highlight in orange. Only 4, fixed — make each substantial.

4. **CENTER-RIGHT — INSPECTOR (for the selected channel):** where per-effect control lives:
   - **PARAMETERS:** the selected effect's parameters as a mix of **radial gauges** (2–3 key ones) and **segmented bar sliders** (the rest), each labeled, each showing its value. **Every parameter has an AUDIO-LINK control** — a small target/badge binding it to a band (**LOW / MID / HIGH**) plus a link-amount mini-gauge; when linked show an orange "reactive" reticle/indicator (this is the pro audio-linking feature — make it feel like weapon telemetry).
   - **STROBE / FLICKER block:** arm switch, **mode** selector (STROBE / FLICKER / PULSE / RAMP), and a **frequency dial in real Hz** (0.5–30 Hz) with the Hz shown huge in the gauge center.
   - **CROP / MATTE block:** segmented sliders for Feather, Stabilize, Expand, Clean; a FILL/CROP fit toggle.
   - **LATAR POLA (background pattern) block:** selector NONE / PLASMA / CYMATICS / SINGULARITY / FILAMENT, plus a **KUASA CAHAYA** radial gauge ("how much the pattern dominates the light when hit by frequency"). Brutal reactive backgrounds.

5. **BOTTOM — DECK / BANK STRIP:** a horizontal rail of preset "banks" / scenes (like Resolume deck tabs + column triggers) to recall a whole look live — named trigger buttons styled as HUD keys.

## SECOND VIEW — PROJECTOR MAPPING (design as a second state)
Model on Resolume Advanced Output. Full-screen dark canvas; default is a **2×2 grid of 4 slices** (one per channel), each a quad with **4 big draggable round orange corner handles** (numbered corners) for corner-pin / keystone warp. Persistent thin outlines on all 4 slices even when a channel is black. On-canvas HUD toolbar with clear keys: `FILL / CROP`, `SUMBER`, `BIDANG ▸`, `+ TAMBAH`, `− HAPUS`, `RESET` (back to 2×2), `SELESAI`. A small telemetry/help status line.

## STATE / INTERACTION TO SHOW VISUALLY
- **MIC gate:** when **disarmed**, all audio-link reticles go inert/grey, nothing pulses — the HUD reads "no signal". When **armed**, reactive elements glow/pulse orange. Armed vs disarmed must be unmistakable.
- Distinguish **manual** vs **audio-linked** parameters (orange reactive reticle + band letter L/M/H).
- Everything readable from 1–2 m in a dark room.

## DELIVERABLE
- One self-contained HTML file: primary **control window**, plus the **mapping mode** as a second state (toggle or second section).
- Realistic placeholder content: 4 named channels; a selected effect with 4–6 params (2–3 as radial gauges, 2 shown audio-linked); strobe at e.g. 12 Hz; LATAR POLA = PLASMA with Kuasa Cahaya ~70%; a couple of preset banks.
- Real hierarchy, spacing, and component states (hover/active/selected/armed). Draw gauges, reticles, segmented bars, cyber-window frames, and decals as inline SVG/CSS. Subtle scanline/noise texture via CSS.
- Terse technical HUD labels, mixing English + Indonesian: `SEBERAPA REAKTIF`, `KUASA CAHAYA`, `LATAR POLA`, `SUMBER`, `BIDANG`, `TAMBAH`, `HAPUS`, `SELESAI`, plus serials/barcodes/katakana as decoration.

## THE VIBE IN ONE LINE
Resolume's ergonomics rebuilt as a **futuristic monochrome cyberpunk weapon-HUD** — Gun-style display type, telemetry gauges, targeting reticles, segmented meters, industrial decals, harsh-noise texture — white-on-black with a single orange `#F2A03D` signal, for a harsh-noise artist performing live in the dark. Dangerous, precise, alive.
