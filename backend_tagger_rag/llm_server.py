# llm_server.py — ZeusPack local LLM (text generation)
# Serves Gemma 4 (E4B, any-to-any multimodal) for RAG-grounded text generation.
# Port 8002 — separate from the tagger (8000) and RAG (8001).
# Requires transformers >= 5.10.1 (you have 5.10.2). Run in the tagger's .venv.
# Model lives in ./models/gemma-4-E4B-it
import os
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import pipeline

# ── TF32 speedups for RTX 30xx/40xx ───────────────────────────
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "models", "gemma-4-E4B-it")

app = FastAPI(title="ZeusPack LLM Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ══════════════════════════════════════════════════════════════
# MODEL — load once at startup (Gemma 4 uses the pipeline API)
# ══════════════════════════════════════════════════════════════
print(f"Loading Gemma 4 from {MODEL_PATH} ...")
pipe = pipeline(
    task="any-to-any",        # Gemma 4 is multimodal (text / image / audio)
    model=MODEL_PATH,
    device_map="auto",
    dtype="auto",
)
print("Gemma 4 ready.")


class GenPayload(BaseModel):
    system:     str = ""
    prompt:     str
    max_tokens: int = 512


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
            return " ".join(
                c.get("text", "") for c in content if isinstance(c, dict)
            ).strip()
    return ""


@app.get("/llm-status")
async def llm_status():
    return {"success": True, "model": os.path.basename(MODEL_PATH)}


@app.post("/generate")
async def generate(p: GenPayload):
    if not p.prompt.strip():
        raise HTTPException(400, "Empty prompt")
    try:
        messages = []
        if p.system.strip():
            messages.append({"role": "system", "content": [{"type": "text", "text": p.system}]})
        messages.append({"role": "user", "content": [{"type": "text", "text": p.prompt}]})

        out = pipe(
            messages,
            return_full_text=False,
            generate_kwargs={"max_new_tokens": p.max_tokens, "do_sample": False},
        )
        return {"success": True, "text": _extract_text(out)}
    except Exception as e:
        print(f"[LLM] generate error: {e}")
        raise HTTPException(500, str(e))


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002, log_level="info")
