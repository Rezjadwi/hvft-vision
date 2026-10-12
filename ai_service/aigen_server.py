# HVFT VISION — AI GEN local service (Apple Silicon / Metal "mps")
# Prompt-driven img2img, as close to realtime as an M1 allows:
#   SD-Turbo (1 UNet step, no CFG) + TAESD tiny decoder + cached prompt embedding + fixed seed (less flicker).
# The app (main.js) starts this automatically with ai_service/.venv/bin/python — nothing to run by hand.
# HTTP on 127.0.0.1:8765
#   GET  /health -> {"status": "loading|ready|error", "device": "mps", "ms": <last gen ms>, "msg": "..."}
#   POST /gen    -> body = JPEG frame; headers X-Prompt (URI-encoded), X-Strength (0.2..0.9), X-Seed
#                   reply = JPEG, header X-Ms = generation time
import io, os, sys, time, json, math, shutil, threading, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("HVFT_AIGEN_PORT", "8765"))
MODEL = os.environ.get("HVFT_AIGEN_MODEL", "stabilityai/sd-turbo")
TINY_VAE = "madebyollin/taesd"
state = {"status": "loading", "device": "?", "ms": 0, "msg": "starting"}

def log(*a):
    print("[aigen]", *a, flush=True)

# leftovers from the old X-Ray service (Reza: remove models we no longer use)
for old in ["~/.cache/huggingface/hub/models--Lykon--dreamshaper-8"]:
    p = os.path.expanduser(old)
    if os.path.isdir(p):
        shutil.rmtree(p, ignore_errors=True)
        log("removed unused model", p)

pipe = None
dev = "cpu"
dtype = None
lock = threading.Lock()
emb = {"prompt": None, "e": None}

def load():
    global pipe, dev, dtype
    try:
        state["msg"] = "loading torch"
        import torch
        from diffusers import AutoPipelineForImage2Image, AutoencoderTiny
        dev = "mps" if torch.backends.mps.is_available() else "cpu"
        dtype = torch.float16 if dev == "mps" else torch.float32
        state["device"] = dev
        state["msg"] = "loading " + MODEL + " (first time downloads ~2.6 GB, once)"
        log(state["msg"])
        try:
            p = AutoPipelineForImage2Image.from_pretrained(MODEL, torch_dtype=dtype, variant="fp16" if dtype == torch.float16 else None)
        except Exception as e:
            log("fp16 variant not available, loading default:", e)
            p = AutoPipelineForImage2Image.from_pretrained(MODEL, torch_dtype=dtype)
        try:
            state["msg"] = "loading tiny decoder"
            p.vae = AutoencoderTiny.from_pretrained(TINY_VAE, torch_dtype=dtype)
        except Exception as e:
            log("tiny VAE failed, keeping the full VAE:", e)
        p = p.to(dev)
        p.set_progress_bar_config(disable=True)
        try:
            p.safety_checker = None
        except Exception:
            pass
        pipe = p
        state["msg"] = "warming up"
        from PIL import Image
        gen(Image.new("RGB", (512, 384), (90, 90, 90)), "warm up", 0.5, 1)
        state["status"] = "ready"
        state["msg"] = "ready on " + dev
        log(state["msg"])
    except Exception as e:
        state["status"] = "error"
        state["msg"] = str(e)[:200]
        log("LOAD FAILED:", e)

def prompt_embeds(prompt):
    import torch
    if emb["prompt"] != prompt:
        with torch.inference_mode():
            r = pipe.encode_prompt(prompt, dev, 1, False)
        emb["e"] = r[0] if isinstance(r, (tuple, list)) else r
        emb["prompt"] = prompt
    return emb["e"]

def gen(img, prompt, strength, seed):
    import torch
    strength = max(0.2, min(0.9, float(strength)))
    steps = max(2, int(math.ceil(1.0 / strength)))          # SD-Turbo: steps x strength >= 1  -> exactly 1 UNet pass
    g = torch.Generator("cpu").manual_seed(int(seed))         # same seed every frame = calmer, less flicker
    with lock, torch.inference_mode():
        t0 = time.time()
        out = pipe(prompt_embeds=prompt_embeds(prompt), image=img, num_inference_steps=steps, strength=strength,
                   guidance_scale=0.0, generator=g).images[0]
        state["ms"] = int((time.time() - t0) * 1000)
    return out

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a):
        pass
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Expose-Headers", "X-Ms")
    def _send(self, code, body, ctype, extra=None):
        self.send_response(code); self._cors()
        self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.send_header("Content-Length", "0"); self.end_headers()
    def do_GET(self):
        self._send(200, json.dumps(state).encode(), "application/json")
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(n)
        if state["status"] != "ready":
            return self._send(503, json.dumps(state).encode(), "application/json")
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(data)).convert("RGB")
            w, h = img.size
            w, h = max(64, (w // 64) * 64), max(64, (h // 64) * 64)
            if (w, h) != img.size:
                img = img.resize((w, h))
            prompt = urllib.parse.unquote(self.headers.get("X-Prompt", "")) or "comic book art"
            out = gen(img, prompt, self.headers.get("X-Strength", "0.5"), self.headers.get("X-Seed", "42"))
            buf = io.BytesIO(); out.save(buf, format="JPEG", quality=85)
            self._send(200, buf.getvalue(), "image/jpeg", {"X-Ms": str(state["ms"])})
        except Exception as e:
            log("gen error:", e)
            self._send(500, str(e).encode(), "text/plain")

if __name__ == "__main__":
    threading.Thread(target=load, daemon=True).start()
    log("listening on http://127.0.0.1:%d" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
