# llm_server.py — ZeusPack LLM gateway (text generation)
#
# Serves ONE stable contract to the app:
#     POST /generate  { system, prompt, max_tokens } -> { success, text }
# ...and lets you swap what's BEHIND it (local Gemma, Anthropic, Gemini, or any
# OpenAI-compatible endpoint like GLM / DeepSeek / Qwen / vLLM) from a web GUI
# at  http://<server>:8002/  — no code edits, no restart.
#
# Port 8002 — separate from the tagger (8000) and RAG (8001).
# Cloud providers are called over plain REST (requests), so no extra SDKs.
import os
import gc
import json
import threading
from typing import Optional

import requests
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from gpu_queue import GpuQueue

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH  = os.path.join(BASE_DIR, "models", "gemma-4-E4B-it")
CONFIG_PATH = os.path.join(BASE_DIR, "llm_config.json")
ADMIN_HTML  = os.path.join(BASE_DIR, "control_center.html")

# ══════════════════════════════════════════════════════════════
# CONFIG — persisted to llm_config.json, edited from the web GUI
# ══════════════════════════════════════════════════════════════
DEFAULT_CONFIG = {
    "provider":    "local",   # local | anthropic | gemini | openai
    "model":       "",        # cloud model id (ignored for local)
    "base_url":    "",        # only for provider "openai" (GLM/DeepSeek/vLLM…)
    "api_key":     "",
    "max_tokens":  512,       # default when the caller doesn't specify
    "concurrency": 1,         # jobs at once — keep 1 for local GPU, raise for cloud
}
PROVIDER_IDS = ("local", "anthropic", "gemini", "openai")


def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg.update(json.load(f) or {})
        except Exception as e:
            print(f"[LLM] Could not read {CONFIG_PATH}: {e}")
    # env vars win on first boot, so you can seed a key without the GUI
    cfg["api_key"] = cfg.get("api_key") or os.getenv("LLM_API_KEY", "")
    return cfg


def save_config(cfg: dict) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


CONFIG = load_config()

app = FastAPI(title="ZeusPack LLM Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# One queue in front of every provider. Local GPU wants concurrency 1; cloud
# APIs handle parallelism, so the GUI lets you raise it.
llm_queue = GpuQueue("LLM", concurrency=int(CONFIG.get("concurrency") or 1), max_waiting=12)


def _rebuild_queue(concurrency: int) -> None:
    """Swap in a queue with a new concurrency. In-flight jobs finish on the old one."""
    global llm_queue
    llm_queue = GpuQueue("LLM", concurrency=max(1, int(concurrency)), max_waiting=12)


# ══════════════════════════════════════════════════════════════
# PROVIDERS — every one has the same signature:
#     (system, prompt, max_tokens) -> str
# ══════════════════════════════════════════════════════════════
_pipe      = None
_pipe_lock = threading.Lock()


def _get_pipe():
    """Load the local Gemma pipeline on first use (so pointing at a cloud
    provider costs no VRAM at all)."""
    global _pipe
    with _pipe_lock:
        if _pipe is None:
            import torch
            from transformers import pipeline
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            print(f"Loading Gemma 4 from {MODEL_PATH} ...")
            _pipe = pipeline(task="any-to-any", model=MODEL_PATH,
                             device_map="auto", dtype="auto")
            print("Gemma 4 ready.")
    return _pipe


def _extract_text(out) -> str:
    """Pull the assistant reply out of the pipeline output, whether it comes
    back as a plain string or a chat-message list (list-of-parts)."""
    try:
        gen = out[0]["generated_text"]
    except Exception:
        return ""
    if isinstance(gen, str):
        return gen.strip()
    if isinstance(gen, list) and gen:
        content = gen[-1].get("content", "")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            return " ".join(c.get("text", "") for c in content if isinstance(c, dict)).strip()
    return ""


def _gen_local(cfg, system, prompt, max_tokens) -> str:
    messages = []
    if system.strip():
        messages.append({"role": "system", "content": [{"type": "text", "text": system}]})
    messages.append({"role": "user", "content": [{"type": "text", "text": prompt}]})
    out = _get_pipe()(
        messages,
        return_full_text=False,
        generate_kwargs={"max_new_tokens": max_tokens, "do_sample": False},
    )
    return _extract_text(out)


def _gen_anthropic(cfg, system, prompt, max_tokens) -> str:
    r = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key":         cfg["api_key"],
            "anthropic-version": "2023-06-01",
            "content-type":      "application/json",
        },
        json={
            "model":      cfg["model"] or "claude-sonnet-5",
            "max_tokens": max_tokens,
            "system":     system,
            "messages":   [{"role": "user", "content": prompt}],
        },
        timeout=120,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"Anthropic {r.status_code}: {r.text[:300]}")
    data = r.json()
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()


def _gen_gemini(cfg, system, prompt, max_tokens) -> str:
    model = cfg["model"] or "gemini-2.0-flash"
    r = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        params={"key": cfg["api_key"]},
        headers={"content-type": "application/json"},
        json={
            "system_instruction": {"parts": [{"text": system}]} if system.strip() else None,
            "contents":           [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig":   {"maxOutputTokens": max_tokens},
        },
        timeout=120,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"Gemini {r.status_code}: {r.text[:300]}")
    data = r.json()
    try:
        parts = data["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts).strip()
    except Exception:
        return ""


def _gen_openai(cfg, system, prompt, max_tokens) -> str:
    """Any OpenAI-compatible endpoint: GLM (Zhipu), DeepSeek, Qwen, vLLM, …"""
    base = (cfg["base_url"] or "https://api.openai.com/v1").rstrip("/")
    msgs = []
    if system.strip():
        msgs.append({"role": "system", "content": system})
    msgs.append({"role": "user", "content": prompt})
    r = requests.post(
        f"{base}/chat/completions",
        headers={
            "Authorization": f"Bearer {cfg['api_key']}",
            "content-type":  "application/json",
        },
        json={"model": cfg["model"], "max_tokens": max_tokens, "messages": msgs},
        timeout=120,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"LLM API {r.status_code}: {r.text[:300]}")
    data = r.json()
    try:
        return (data["choices"][0]["message"]["content"] or "").strip()
    except Exception:
        return ""


PROVIDERS = {
    "local":     _gen_local,
    "anthropic": _gen_anthropic,
    "gemini":    _gen_gemini,
    "openai":    _gen_openai,
}


def _generate_sync(system: str, prompt: str, max_tokens: int) -> str:
    """Runs inside the queue's worker thread. Reads CONFIG live, so a provider
    change from the GUI takes effect on the very next request."""
    cfg = dict(CONFIG)
    fn  = PROVIDERS.get(cfg["provider"])
    if fn is None:
        raise RuntimeError(f"Unknown provider '{cfg['provider']}'")
    if cfg["provider"] != "local" and not cfg.get("api_key"):
        raise RuntimeError(f"No API key set for provider '{cfg['provider']}' — add one in the web GUI.")
    return fn(cfg, system, prompt, max_tokens)


# ══════════════════════════════════════════════════════════════
# API
# ══════════════════════════════════════════════════════════════
class GenPayload(BaseModel):
    system:     str = ""
    prompt:     str
    max_tokens: int = 0        # 0 = use the configured default


class ConfigPayload(BaseModel):
    provider:    Optional[str] = None
    model:       Optional[str] = None
    base_url:    Optional[str] = None
    api_key:     Optional[str] = None
    max_tokens:  Optional[int] = None
    concurrency: Optional[int] = None


def _public_config() -> dict:
    """Config for the GUI — never echoes the API key back, just whether one is set."""
    c = dict(CONFIG)
    c.pop("api_key", None)
    c["has_api_key"] = bool(CONFIG.get("api_key"))
    c["providers"]   = list(PROVIDER_IDS)
    c["local_model"] = os.path.basename(MODEL_PATH)
    c["local_loaded"] = _pipe is not None
    return c


@app.get("/")
async def admin_page():
    """The unified Control Center GUI (shared by all three servers)."""
    if not os.path.exists(ADMIN_HTML):
        raise HTTPException(404, "control_center.html not found next to llm_server.py")
    return FileResponse(ADMIN_HTML)


def _unload_local():
    """Drop the local Gemma pipeline and free VRAM for the tagger."""
    global _pipe
    with _pipe_lock:
        _pipe = None
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
    print("Local LLM unloaded — GPU freed.")


def _vram():
    try:
        import torch
        if not torch.cuda.is_available():
            return None
        return {
            "used_gb":  round(torch.cuda.memory_allocated() / 1e9, 2),
            "total_gb": round(torch.cuda.get_device_properties(0).total_memory / 1e9, 2),
        }
    except Exception:
        return None


@app.get("/model-status")
async def model_status():
    """Only meaningful for the 'local' provider — cloud providers use no VRAM."""
    return {
        "success":  True,
        "service":  "llm",
        "provider": CONFIG["provider"],
        "model":    os.path.basename(MODEL_PATH) if CONFIG["provider"] == "local" else (CONFIG["model"] or CONFIG["provider"]),
        "loaded":   _pipe is not None,
        "vram":     _vram(),
    }


@app.post("/model/load")
async def model_load():
    if CONFIG["provider"] != "local":
        return {"success": True, "loaded": False, "message": "Cloud provider — nothing to load."}
    _get_pipe()
    return {"success": True, "loaded": True, "vram": _vram()}


@app.post("/model/unload")
async def model_unload():
    _unload_local()
    return {"success": True, "loaded": False, "vram": _vram()}


@app.get("/llm-status")
async def llm_status():
    label = os.path.basename(MODEL_PATH) if CONFIG["provider"] == "local" else (CONFIG["model"] or CONFIG["provider"])
    return {"success": True, "model": label, "provider": CONFIG["provider"]}


@app.get("/queue-status")
async def queue_status():
    """Live queue gauge — the app polls this to show 'in line' feedback."""
    return {"success": True, **llm_queue.stats()}


@app.get("/config")
async def get_config():
    return {"success": True, **_public_config()}


@app.post("/config")
async def set_config(p: ConfigPayload):
    global CONFIG
    new = dict(CONFIG)

    if p.provider is not None:
        if p.provider not in PROVIDER_IDS:
            raise HTTPException(400, f"provider must be one of {PROVIDER_IDS}")
        new["provider"] = p.provider
    if p.model      is not None: new["model"]    = p.model.strip()
    if p.base_url   is not None: new["base_url"] = p.base_url.strip()
    if p.max_tokens is not None: new["max_tokens"] = max(1, int(p.max_tokens))
    # Blank api_key means "keep the existing one" (the GUI never sees it).
    if p.api_key is not None and p.api_key.strip():
        new["api_key"] = p.api_key.strip()

    if p.concurrency is not None:
        new["concurrency"] = max(1, int(p.concurrency))
        if new["concurrency"] != CONFIG.get("concurrency"):
            _rebuild_queue(new["concurrency"])

    CONFIG = new
    save_config(CONFIG)
    print(f"[LLM] config updated → provider={CONFIG['provider']} model={CONFIG['model'] or '-'}")
    return {"success": True, **_public_config()}


@app.post("/generate")
async def generate(p: GenPayload):
    if not p.prompt.strip():
        raise HTTPException(400, "Empty prompt")
    max_tokens = p.max_tokens or int(CONFIG.get("max_tokens") or 512)
    try:
        text = await llm_queue.run(_generate_sync, p.system, p.prompt, max_tokens)
        return {"success": True, "text": text, "queue": llm_queue.stats(),
                "provider": CONFIG["provider"]}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[LLM] generate error: {e}")
        raise HTTPException(500, str(e))


if __name__ == "__main__":
    # Preload the local model only when that's the selected provider, so
    # pointing at a cloud API leaves the GPU completely free.
    if CONFIG.get("provider") == "local":
        try:
            _get_pipe()
        except Exception as e:
            print(f"[LLM] Local model failed to load: {e}")
    print(f"[LLM] provider = {CONFIG['provider']}  |  GUI: http://localhost:8002/")
    uvicorn.run(app, host="0.0.0.0", port=8002, log_level="info")
