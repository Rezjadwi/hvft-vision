# HVFT VISION — AI GEN (local)

Prompt-driven img2img on the Mac GPU: SD-Turbo (1 step, no CFG) + TAESD tiny decoder.
The app starts it by itself (CH4 ▸ AI GEN ▸ START) with `.venv/bin/python aigen_server.py`
and stops it when the app quits. Log: `../logs/aigen.log`.

- First START downloads the model once (~2.6 GB, needs internet) into ~/.cache/huggingface.
- Port 127.0.0.1:8765 (GET /health, POST /gen).
- Change model: env `HVFT_AIGEN_MODEL` (default `stabilityai/sd-turbo`).
- If `.venv` is ever missing: `python3 -m venv .venv && .venv/bin/pip install torch torchvision diffusers transformers accelerate pillow safetensors`
