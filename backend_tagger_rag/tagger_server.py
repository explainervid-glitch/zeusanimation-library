import os
import gc
import json
import torch
import uvicorn
import asyncio
import av
import numpy as np
import tempfile
import threading
from typing import List
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from transformers import Qwen2VLForConditionalGeneration, AutoProcessor, BitsAndBytesConfig
from PIL import Image
from schemas import AssetBackground, AssetCharacter, AssetAnimation, AssetInspiration
from json_repair import repair_json

# ── Optimasi TF32 untuk RTX 30xx/40xx ─────────────────────────
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True

app = FastAPI(title="AI Asset Tagger Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ══════════════════════════════════════════════════════════════
# MODEL — Qwen2-VL-7B handles both image AND video natively.
# Supports: background, character, inspiration (image)
#           animation/movement (video via /auto-tag-video)
# ══════════════════════════════════════════════════════════════
MODEL_PATH = "./models/Qwen2-VL-7B-Instruct"

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16,
    bnb_4bit_use_double_quant=True,
)

# The model is loaded lazily and can be unloaded again, so the GPU can be
# handed over to the LLM server when the tagger isn't in use.
# Controlled from the Control Center UI (/model/load, /model/unload).
model       = None
processor   = None
_model_lock = threading.Lock()


def _ensure_model():
    """Load Qwen into VRAM if it isn't already. Called before every inference."""
    global model, processor
    with _model_lock:
        if model is None or processor is None:
            print("Loading Qwen2-VL-7B (4-bit optimized)...")
            processor = AutoProcessor.from_pretrained(MODEL_PATH, trust_remote_code=True)
            model = Qwen2VLForConditionalGeneration.from_pretrained(
                MODEL_PATH,
                quantization_config=bnb_config,
                device_map="auto",
                attn_implementation="sdpa",
                trust_remote_code=True,
            )
            model.eval()
            print("Model ready.")
    return model, processor


def _unload_model():
    """Drop the model and free VRAM so another server can use the GPU."""
    global model, processor
    with _model_lock:
        model     = None
        processor = None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    print("Tagger model unloaded — GPU freed.")


def _vram():
    if not torch.cuda.is_available():
        return None
    return {
        "used_gb":  round(torch.cuda.memory_allocated() / 1e9, 2),
        "total_gb": round(torch.cuda.get_device_properties(0).total_memory / 1e9, 2),
    }


# ── Model control (used by the Control Center UI) ─────────────
@app.get("/")
async def control_center():
    page = os.path.join(os.path.dirname(os.path.abspath(__file__)), "control_center.html")
    if not os.path.exists(page):
        raise HTTPException(404, "control_center.html not found")
    return FileResponse(page)


@app.get("/model-status")
async def model_status():
    return {
        "success":  True,
        "service":  "tagger",
        "model":    os.path.basename(MODEL_PATH),
        "loaded":   model is not None,
        "vram":     _vram(),
    }


@app.post("/model/load")
async def model_load():
    _ensure_model()
    return {"success": True, "loaded": True, "vram": _vram()}


@app.post("/model/unload")
async def model_unload():
    _unload_model()
    return {"success": True, "loaded": False, "vram": _vram()}

# ══════════════════════════════════════════════════════════════
# SYSTEM PROMPTS — separate per asset type for better focus
# ══════════════════════════════════════════════════════════════

# ── Background & Character ────────────────────────────────────
# SYSTEM_PROMPT_IMAGE = """You are an expert AI asset tagger for RAG pipelines. Analyze the image and output STRICT JSON matching the schema.
# RULES:
# - Output ONLY valid JSON. No markdown, no explanations.
# - FileName: Use exactly the filename provided.
# - Detail: 1 concise sentence describing the main visual subject.
# - Category: Broad domain (e.g. Office, Nature, Technology).
# - description.full: 2-4 detailed sentences covering visual style, mood, setting, and usage context.
# - metadata: Fill ONLY empty/null fields. DO NOT change fields that already have a value.
# - search_context.keywords: 10-15 terms, mix of English AND Bahasa Indonesia (e.g. 'background', 'latar belakang', 'scene', 'pemandangan').
# - metadata.roles: List of scene types or video contexts this asset suits. Be specific.

# IMPORTANT - USING EXISTING FIELDS AS CONTEXT:
# - When existing fields are provided, use them as reference to elaborate the empty ones.
# - DO NOT skip empty fields just because some fields are already filled.
# - Ensure all filled and generated fields are consistent with each other.
# """

SYSTEM_PROMPT_IMAGE = """You are an expert AI asset tagger for RAG pipelines. Analyze the image and output STRICT JSON matching the schema.
RULES:
- Output ONLY valid JSON. No markdown, no explanations.
- FileName: Use exactly the filename provided.
- Detail: 1 concise sentence.
- Category: Broad domain.
- description.full: detailed sentences (must be filled with content) avoid to describe pose.
- metadata: Fill ONLY empty/null fields. DO NOT change fields that already have a value.
- search_context.keywords: 10-15 terms, mix of English AND Bahasa Indonesia (e.g. 'background', 'latar belakang', 'scene', 'pemandangan').
- metadata.roles: List of what kind of scenes/characters would use this asset/suitable for. Be specific.

IMPORTANT - USING EXISTING FIELDS AS CONTEXT:
- When existing fields are provided (not empty), use them as context and reference.
- Elaborate consistently from the existing filled fields to complete the empty fields.
- Example: If "detail" is filled, use it to guide elaboration of description.full, keywords, and metadata.roles with coherent and consistent information.
- DO NOT skip empty fields just because some fields are already filled - instead, use the filled fields to inform your elaboration.
"""

# ── Inspiration ───────────────────────────────────────────────
SYSTEM_PROMPT_INSPIRATION = """You are an expert AI asset tagger for creative inspiration assets used in explainer video production. Analyze the image and output STRICT JSON matching the schema.
RULES:
- Output ONLY valid JSON. No markdown, no explanations.
- FileName: Use exactly the filename provided.
- Detail: 1 concise sentence describing what is shown in the image.
- Category: The visual or creative category (e.g. Advertising, Infographic, Character Design, UI/UX).
- description.full: 2-4 sentences describing the visual style, composition, mood, and what makes this a useful creative reference.
- metadata.mood: single emotional tone word (e.g. energetic, clean, playful, professional, bold).
- metadata.roles: list of production contexts where this reference would be useful (e.g. "product promotion", "social media ad", "explainer intro").
- search_context.scene_prompt: 1 sentence describing when a video producer would search for this reference.
- search_context.keywords: 10-15 terms, mix of English AND Bahasa Indonesia (e.g. 'advertising', 'iklan', 'promotion', 'promosi').
- Fill ONLY empty/null fields. DO NOT change fields that already have a value.

IMPORTANT - USING EXISTING FIELDS AS CONTEXT:
- When existing fields are provided (not empty), use them as context and reference.
- Elaborate consistently from the existing filled fields to complete the empty fields.
- Example: If "detail" is filled, use it to guide elaboration of description.full, keywords, and metadata.roles with coherent and consistent information.
- DO NOT skip empty fields just because some fields are already filled - instead, use the filled fields to inform your elaboration.
"""

# ── Animation / Movement (video) ──────────────────────────────

SYSTEM_PROMPT_VIDEO = """You are an expert AI asset tagger for character animation assets used in explainer video production. Watch all provided frames carefully and output STRICT JSON matching the schema.

STRICT SUBJECT ABSTRACTION (NON-NEGOTIABLE):
2. NEVER use specific identities: "A robot", "An old man", "A woman", "A baby", "A man", "A girl", "An elderly", etc.
3. Treat ALL visuals as GENERIC ANIMATION RIGS. Describe ONLY the motion, posture, pacing, and action. COMPLETELY IGNORE age, gender, species, clothing style, or specific appearance.

RULES:
- Output ONLY valid JSON. No markdown, no explanations.
- FileName: Use exactly the filename provided.
- Detail: 1 concise sentence describing the core animation action and always starting with "A character" or "A Person" word (e.g. "A character walks forward while nodding in agreement").
- description.full: 2-4 sentences covering motion type, speed/pace, emotional tone, ideal production use case, and always start with "A character" or "A Person" word.
- metadata.mood: single emotional tone word (positive/neutral/negative/energetic/calm/serious/happy etc).
- metadata.action: snake_case verb phrase for the core motion (e.g. walking_forward, head_nod_agree, arm_raise, wave_goodbye).
- metadata.loopable: true if the animation cycles seamlessly, false if it has a distinct start and end.
- metadata.duration_sec: estimate animation duration in seconds based on the frames shown.
- metadata.roles: list of specific scene types or production moments this animation suits (e.g. "happy scene","agreement scene", "presentation walkthrough", "sporting event").
- search_context.scene_prompt: 1 sentence describing when a video producer would search for this animation.
- search_context.keywords: 10-15 terms, mix of English AND Bahasa Indonesia (e.g. 'walk', 'jalan', 'agree', 'setuju', 'nod', 'mengangguk').
- Fill ONLY empty/null fields. DO NOT change fields that already have a value.

IMPORTANT - USING EXISTING FIELDS AS CONTEXT:
- When existing fields are provided (not empty), use them as context and reference.
- Elaborate consistently from the existing filled fields to complete the empty fields.
- Example: If "detail" is filled, use it to guide elaboration of description.full, keywords, and metadata.roles with coherent and consistent information.
- DO NOT skip empty fields just because some fields are already filled - instead, use the filled fields to inform your elaboration.
"""

# ── Style guide drafting (analyse a few samples → per-style hint) ──
STYLE_GUIDE_PROMPT = """These images are ALL from ONE art style in an animation asset pack. Study what they have in common.

Write a short guide (2-4 sentences) that tells an AI image tagger how to correctly read this style, covering:
- the colour palette and shading (e.g. monochrome, flat, desaturated, cel-shaded, realistic)
- how ground / surfaces / materials are rendered

Then add 1-2 sentences of "common misreads" — specific things an AI tagger might WRONGLY infer from this style (for example: reading stylised grey ground as snow, or a dark palette as night-time).

Write it as direct guidance addressed to the tagger. Output ONLY the guidance text — no preamble, no markdown, no headings, no bullet symbols."""

# ══════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════

def is_empty(value) -> bool:
    """
    None = definitely empty (unset).
    Empty string / empty list = empty.
    0 / False are NOT considered empty — they may be intentional values.
    Only None is the sentinel for unfilled bool/numeric fields.
    """
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    if isinstance(value, list) and len(value) == 0:
        return True
    return False


# FileName and Category are organised by the system (folder layout + categories
# JSON) — the AI must never rewrite them. They are skipped during the merge.
PROTECTED_FIELDS = {"FileName", "Category", "asset_type", "style"}

# ── Flat schema templates ──────────────────────────────────────
# Used instead of model_json_schema() which produces nested $defs/$ref
# that build_partial_schema cannot walk correctly.
# Keys with None = string field, [] = list field, {} = nested dict.
SCHEMA_TEMPLATES = {
    "background": {
        "FileName":    "",
        "Detail":      "",
        "Category":    "",
        "description": {"full": ""},
        "metadata": {
            "mood":        "",
            "lighting":    "",
            "time_of_day": "",
            "roles":       [],
            "props":       [],
        },
        "search_context": {
            "scene_prompt": "",
            "keywords":     [],
        },
    },
    "character": {
        "FileName":    "",
        "Detail":      "",
        "Category":    "",
        "description": {"full": ""},
        "metadata": {
            "vibe":   "",
            "gender": "",
            "age":    "",
            "roles":  [],
            "props":  [],
        },
        "search_context": {
            "scene_prompt": "",
            "keywords":     [],
        },
    },
    "inspiration": {
        "FileName":    "",
        "Detail":      "",
        "Category":    "",
        "description": {"full": ""},
        "metadata": {
            "mood":  "",
            "roles": [],
        },
        "search_context": {
            "scene_prompt": "",
            "keywords":     [],
        },
    },
    "animation": {
        "FileName":    "",
        "Detail":      "",
        "Category":    "",
        "description": {
            "short": "",
            "full":  "",
        },
        "metadata": {
            "mood":         "",
            "action":       "",
            "loopable":     None,   # None = unfilled bool
            "duration_sec": None,   # None = unfilled float
            "roles":        [],
        },
        "search_context": {
            "scene_prompt": "",
            "keywords":     [],
        },
    },
}


def merge_ai_into_existing(existing: dict, ai_result: dict) -> dict:
    """Deep merge: ai_result fills only empty fields. PROTECTED_FIELDS never touched."""
    merged = dict(existing)
    for key, ai_val in ai_result.items():
        if key in PROTECTED_FIELDS:
            continue
        if key not in merged:
            merged[key] = ai_val
        elif isinstance(ai_val, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge_ai_into_existing(merged[key], ai_val)
        elif isinstance(ai_val, list) and isinstance(merged.get(key), list):
            if is_empty(merged[key]):
                merged[key] = ai_val
        else:
            if is_empty(merged.get(key)):
                merged[key] = ai_val
    return merged


def build_partial_schema(existing: dict, full_schema: dict) -> dict:
    """
    Return schema containing only EMPTY fields from existing JSON.
    Uses SCHEMA_TEMPLATES values as the schema — simple flat dicts, no $ref.
    None in template = this is a bool/numeric field, treat as empty only if
    existing value is also None or missing.
    """
    partial = {}
    for key, schema_val in full_schema.items():
        existing_val = existing.get(key)
        if isinstance(schema_val, dict) and isinstance(existing_val, dict):
            # Recurse into nested dicts (description, metadata, search_context)
            sub = build_partial_schema(existing_val, schema_val)
            if sub:
                partial[key] = sub
        elif isinstance(schema_val, dict) and existing_val is None:
            # Nested dict missing entirely from existing
            partial[key] = schema_val
        else:
            if is_empty(existing_val):
                partial[key] = schema_val
    return partial


def _style_block(style_guide: str) -> str:
    """Turn a per-style visual guide into a prompt block placed BEFORE the
    field instructions, so the model calibrates its perception to the pack's
    art style (e.g. 'monochrome ground is stylized terrain, NOT snow').
    Empty guide = empty string = behaviour unchanged."""
    if not style_guide or not style_guide.strip():
        return ""
    return (
        "\nSTYLE CONTEXT (read this FIRST — it overrides your visual assumptions):\n"
        f"{style_guide.strip()}\n"
    )


def _context_block(existing_json: dict | None, filename: str = "") -> str:
    """Surface the asset's known FileName and Detail so the model uses them as
    context when filling the other fields (description, keywords, metadata).
    These are organised by the system and must NOT be changed."""
    j = existing_json or {}
    name   = (j.get("FileName") or filename or "").strip()
    detail = (j.get("Detail") or "").strip()
    if not name and not detail:
        return ""
    lines = ["\nASSET CONTEXT (use these to keep the generated fields accurate and consistent; do NOT change them):"]
    if name:
        lines.append(f"- FileName: {name}")
    if detail:
        lines.append(f"- Detail: {detail}")
    return "\n".join(lines) + "\n"


def _parse_json_from_output(raw: str) -> dict:
    """Extract and repair JSON from raw model output."""
    start = raw.find("{")
    end   = raw.rfind("}") + 1
    if start == -1 or end == 0:
        raise ValueError(f"No JSON found in output: {raw[:120]}")
    repaired = repair_json(raw[start:end], return_objects=True)
    if not isinstance(repaired, dict):
        raise ValueError("Repaired output is not a dict")
    return repaired


def _build_context_note(existing_json: dict | None, full_schema: dict) -> tuple[dict, str]:
    """Build prompt_schema and context_note string based on existing JSON."""
    if existing_json:
        empty_fields  = build_partial_schema(existing_json, full_schema)
        prompt_schema = empty_fields if empty_fields else full_schema
        context_note  = (
            f"\nEXISTING DATA (use as context):\n"
            f"{json.dumps(existing_json, indent=2)}\n\n"
            f"DO NOT modify filled fields above.\n"
            f"FILL only these EMPTY fields:\n"
            f"{json.dumps(prompt_schema, indent=2)}\n\n"
            f"Use existing fields to guide elaboration consistently."
        )
    else:
        prompt_schema = full_schema
        context_note  = f"\nOutput strictly JSON:\n{json.dumps(prompt_schema, indent=2)}"
    return prompt_schema, context_note


def _qwen_image_inference(image: Image.Image, prompt_text: str, max_new_tokens: int = 512) -> str:
    """Run Qwen2-VL inference for a single image. Returns raw output string."""
    _ensure_model()
    messages = [
        {"role": "user", "content": [
            {"type": "image", "image": image},
            {"type": "text",  "text": prompt_text},
        ]}
    ]
    text_prompt = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    inputs = processor(
        text=[text_prompt],
        images=[image],
        return_tensors="pt",
        max_pixels=768 * 768,
        min_pixels=256 * 256,
    ).to(model.device)

    input_len = inputs["input_ids"].shape[1]

    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            repetition_penalty=1.1,
            pad_token_id=processor.tokenizer.pad_token_id,
        )

    return processor.decode(
        output_ids[0][input_len:],
        skip_special_tokens=True
    ).strip()


def _qwen_multi_image_inference(images: list, prompt_text: str, max_new_tokens: int = 300) -> str:
    """Run Qwen2-VL over several images at once. Used to draft a style guide
    from a handful of sample assets. Returns raw output string."""
    _ensure_model()
    content = [{"type": "image", "image": im} for im in images]
    content.append({"type": "text", "text": prompt_text})
    messages = [{"role": "user", "content": content}]

    text_prompt = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    inputs = processor(
        text=[text_prompt],
        images=images,
        return_tensors="pt",
        max_pixels=640 * 640,   # modest per-image res so several fit in VRAM
        min_pixels=128 * 128,
    ).to(model.device)

    input_len = inputs["input_ids"].shape[1]

    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            repetition_penalty=1.1,
            pad_token_id=processor.tokenizer.pad_token_id,
        )

    return processor.decode(
        output_ids[0][input_len:],
        skip_special_tokens=True
    ).strip()


def _qwen_video_inference(video_frames: np.ndarray, prompt_text: str, max_new_tokens: int = 600) -> str:
    """Run Qwen2-VL inference for video frames. Returns raw output string."""
    _ensure_model()
    messages = [
        {"role": "user", "content": [
            {
                "type":  "video",
                "video": video_frames,   # np.ndarray (N, H, W, 3)
                "fps":   1.0,
            },
            {"type": "text", "text": prompt_text},
        ]}
    ]
    text_prompt = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    inputs = processor(
        text=[text_prompt],
        videos=[video_frames],
        return_tensors="pt",
        max_pixels=640 * 640,    # per-frame detail vs VRAM (16 frames). 512² → 640²
        min_pixels=128 * 128,
    ).to(model.device)

    input_len = inputs["input_ids"].shape[1]

    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            repetition_penalty=1.1,
            pad_token_id=processor.tokenizer.pad_token_id,
        )

    return processor.decode(
        output_ids[0][input_len:],
        skip_special_tokens=True
    ).strip()


# ══════════════════════════════════════════════════════════════
# VIDEO FRAME EXTRACTION
# ══════════════════════════════════════════════════════════════

NUM_FRAMES = 20


def read_video_frames(video_path: str, num_frames: int = NUM_FRAMES) -> np.ndarray:
    """
    Sample num_frames frames uniformly from video using PyAV.
    Returns np.ndarray shape (num_frames, H, W, 3) RGB.
    """
    container = av.open(video_path)
    stream    = container.streams.video[0]
    total     = stream.frames

    if total == 0:
        frames_list = [f for f in container.decode(video=0)]
        total = len(frames_list)
        indices = set(np.linspace(0, total - 1, min(num_frames, total), dtype=int).tolist())
        sampled = [f for i, f in enumerate(frames_list) if i in indices]
    else:
        indices = set(np.linspace(0, total - 1, min(num_frames, total), dtype=int).tolist())
        sampled = []
        container.seek(0)
        for i, frame in enumerate(container.decode(video=0)):
            if i in indices:
                sampled.append(frame)
            if len(sampled) == num_frames:
                break

    container.close()
    return np.stack([f.to_ndarray(format="rgb24") for f in sampled])


# ══════════════════════════════════════════════════════════════
# GENERATION FUNCTIONS
# ══════════════════════════════════════════════════════════════

def generate_image_json(asset_type: str, filename: str, image: Image.Image,
                        existing_json: dict | None = None, style_guide: str = "") -> dict:
    """Tag background or character image asset."""

    MAX_DIM = 768
    if max(image.size) > MAX_DIM:
        ratio = MAX_DIM / max(image.size)
        image = image.resize(
            (int(image.width * ratio), int(image.height * ratio)),
            Image.Resampling.LANCZOS
        )

    full_schema = SCHEMA_TEMPLATES[asset_type]
    _, context_note = _build_context_note(existing_json, full_schema)

    prompt_text = (
        f"Filename: {filename}\n"
        f"Asset Type: {asset_type}\n"
        f"{_style_block(style_guide)}"
        f"{_context_block(existing_json, filename)}"
        f"{SYSTEM_PROMPT_IMAGE}"
        f"{context_note}"
    )

    raw = _qwen_image_inference(image, prompt_text, max_new_tokens=512)
    return _parse_json_from_output(raw)


def generate_inspiration_json(filename: str, image: Image.Image,
                              existing_json: dict | None = None, style_guide: str = "") -> dict:
    """Tag inspiration/reference image asset."""

    MAX_DIM = 768
    if max(image.size) > MAX_DIM:
        ratio = MAX_DIM / max(image.size)
        image = image.resize(
            (int(image.width * ratio), int(image.height * ratio)),
            Image.Resampling.LANCZOS
        )

    full_schema = SCHEMA_TEMPLATES["inspiration"]
    _, context_note = _build_context_note(existing_json, full_schema)

    prompt_text = (
        f"Filename: {filename}\n"
        f"Asset Type: inspiration\n"
        f"{_style_block(style_guide)}"
        f"{_context_block(existing_json, filename)}"
        f"{SYSTEM_PROMPT_INSPIRATION}"
        f"{context_note}"
    )

    raw = _qwen_image_inference(image, prompt_text, max_new_tokens=512)
    return _parse_json_from_output(raw)


def generate_video_json(filename: str, video_frames: np.ndarray,
                        existing_json: dict | None = None, style_guide: str = "") -> dict:
    """Tag animation/movement video asset."""

    full_schema = SCHEMA_TEMPLATES["animation"]
    _, context_note = _build_context_note(existing_json, full_schema)

    prompt_text = (
        f"Filename: {filename}\n"
        f"Asset Type: animation\n"
        f"{_style_block(style_guide)}"
        f"{_context_block(existing_json, filename)}"
        f"{SYSTEM_PROMPT_VIDEO}"
        f"{context_note}"
    )

    raw = _qwen_video_inference(video_frames, prompt_text, max_new_tokens=600)
    return _parse_json_from_output(raw)


# ══════════════════════════════════════════════════════════════
# SHARED UTILS
# ══════════════════════════════════════════════════════════════

def _load_existing_json(json_path: str) -> dict | None:
    if not json_path or not os.path.exists(json_path):
        return None
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        print(f"Existing JSON loaded: {json_path}")
        return data
    except Exception as e:
        print(f"Failed to read existing JSON: {e}")
        return None


def _save_json(json_path: str, data: dict) -> None:
    if not json_path:
        print("json_path not provided — JSON not saved to disk")
        return
    try:
        os.makedirs(os.path.dirname(os.path.abspath(json_path)), exist_ok=True)
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        print(f"Saved: {json_path}")
    except Exception as e:
        print(f"Failed to save JSON to {json_path}: {e}")


# ══════════════════════════════════════════════════════════════
# ENDPOINTS
# ══════════════════════════════════════════════════════════════

IMAGE_ASSET_TYPES = ("background", "character", "inspiration")
ALL_ASSET_TYPES   = IMAGE_ASSET_TYPES + ("animation",)


@app.post("/auto-tag")
async def auto_tag(
    file:        UploadFile = File(...),
    asset_type:  str        = Form(...),
    json_path:   str        = Form(default=""),
    filename:    str        = Form(default=""),
    style_guide: str        = Form(default=""),
):
    """
    Tag a static image asset.
    asset_type: 'background' | 'character' | 'inspiration'
    """
    if asset_type not in IMAGE_ASSET_TYPES:
        raise HTTPException(400, f"asset_type must be one of: {IMAGE_ASSET_TYPES}")

    try:
        image = Image.open(file.file).convert("RGB")
    except Exception as e:
        raise HTTPException(400, f"Invalid image: {str(e)}")

    asset_filename = filename or file.filename or "unknown"
    existing_json  = _load_existing_json(json_path)

    try:
        if asset_type == "inspiration":
            ai_data = generate_inspiration_json(asset_filename, image, existing_json, style_guide)
        else:
            ai_data = generate_image_json(asset_type, asset_filename, image, existing_json, style_guide)

        if existing_json:
            merged = merge_ai_into_existing(existing_json, ai_data)
        else:
            schema_map = {
                "background":  AssetBackground,
                "character":   AssetCharacter,
                "inspiration": AssetInspiration,
            }
            merged = schema_map[asset_type](**ai_data).model_dump()

        if "metadata" not in merged:
            merged["metadata"] = {}
        merged["metadata"]["asset_type"] = asset_type

        # FileName is system-managed: keep the existing organised value, or the
        # provided filename for a brand-new asset — never the AI's guess.
        merged["FileName"] = (existing_json or {}).get("FileName") or asset_filename

        _save_json(json_path, merged)
        return merged

    except Exception as e:
        print(f"[/auto-tag] Error: {e}")
        raise HTTPException(500, f"AI generation failed: {str(e)}")


@app.post("/auto-tag-video")
async def auto_tag_video(
    file:        UploadFile = File(...),
    json_path:   str        = Form(default=""),
    filename:    str        = Form(default=""),
    style_guide: str        = Form(default=""),
):
    """
    Tag an animation/movement video asset.
    Accepts mp4/mov/webm. Uses Qwen2-VL's native video understanding.
    Same server, same model, same port 8000.
    """
    suffix   = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        asset_filename = filename or file.filename or "unknown"
        existing_json  = _load_existing_json(json_path)

        video_frames = read_video_frames(tmp_path, NUM_FRAMES)
        print(f"[/auto-tag-video] {len(video_frames)} frames — {asset_filename}")

        ai_data = generate_video_json(asset_filename, video_frames, existing_json, style_guide)

        if existing_json:
            merged = merge_ai_into_existing(existing_json, ai_data)
        else:
            merged = AssetAnimation(**ai_data).model_dump()

        if "metadata" not in merged:
            merged["metadata"] = {}
        merged["metadata"]["asset_type"] = "animation"

        # FileName is system-managed: keep the existing organised value, or the
        # provided filename for a brand-new asset — never the AI's guess.
        merged["FileName"] = (existing_json or {}).get("FileName") or asset_filename

        _save_json(json_path, merged)
        return merged

    except Exception as e:
        print(f"[/auto-tag-video] Error: {e}")
        raise HTTPException(500, f"AI generation failed: {str(e)}")

    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


@app.post("/generate-style-guide")
async def generate_style_guide(files: List[UploadFile] = File(...)):
    """Draft a per-style tagger hint by analysing a few sample images.
    Returns { success, hint }. The app shows this as an editable draft."""
    if not files:
        raise HTTPException(400, "No sample images provided")

    images = []
    for f in files[:6]:   # cap samples so several fit in VRAM
        try:
            img = Image.open(f.file).convert("RGB")
            MAX_DIM = 640
            if max(img.size) > MAX_DIM:
                ratio = MAX_DIM / max(img.size)
                img = img.resize(
                    (int(img.width * ratio), int(img.height * ratio)),
                    Image.Resampling.LANCZOS
                )
            images.append(img)
        except Exception as e:
            print(f"[/generate-style-guide] skip bad image: {e}")

    if not images:
        raise HTTPException(400, "No valid images among the samples")

    try:
        raw = _qwen_multi_image_inference(images, STYLE_GUIDE_PROMPT, max_new_tokens=300)
        return {"success": True, "hint": raw.strip()}
    except Exception as e:
        print(f"[/generate-style-guide] Error: {e}")
        raise HTTPException(500, f"Style guide generation failed: {str(e)}")


@app.post("/batch-tag")
async def batch_tag(asset_type: str = Form("background")):
    """Batch tag images in ./input/ — supports background, character, inspiration."""
    if asset_type not in IMAGE_ASSET_TYPES:
        raise HTTPException(400, f"asset_type must be one of: {IMAGE_ASSET_TYPES}")

    INPUT_DIR = "./input"
    valid_ext = (".jpg", ".jpeg", ".png", ".webp", ".bmp")
    files = sorted([f for f in os.listdir(INPUT_DIR) if f.lower().endswith(valid_ext)])
    if not files:
        return {"status": "empty", "message": "No images found in ./input/"}

    schema_map = {
        "background":  AssetBackground,
        "character":   AssetCharacter,
        "inspiration": AssetInspiration,
    }

    results = []
    total   = len(files)
    print(f"Batch tagging {total} images (type: {asset_type})...")

    for i, fname in enumerate(files, 1):
        img_path = os.path.join(INPUT_DIR, fname)
        try:
            await asyncio.sleep(0)
            image = Image.open(img_path).convert("RGB")
            if image.width == 0 or image.height == 0:
                raise ValueError("Image has 0 dimensions")

            if asset_type == "inspiration":
                ai_data = generate_inspiration_json(fname, image)
            else:
                ai_data = generate_image_json(asset_type, fname, image)

            result_obj = schema_map[asset_type](**ai_data).model_dump()
            result_obj["metadata"]["asset_type"] = asset_type
            if "style" in result_obj.get("metadata", {}):
                result_obj["metadata"]["style"] = result_obj["metadata"].get("style") or ""

            print(f"[{i}/{total}] Tagged: {fname}")
            results.append({"file": fname, "status": "success", "data": result_obj})

            if i % 5 == 0:
                torch.cuda.empty_cache()

        except Exception as e:
            print(f"[{i}/{total}] FAILED: {fname} — {e}")
            results.append({"file": fname, "status": "failed", "error": str(e)})

    torch.cuda.empty_cache()
    return {
        "status":  "completed",
        "total":   total,
        "success": sum(1 for r in results if r["status"] == "success"),
        "failed":  sum(1 for r in results if r["status"] == "failed"),
        "details": results,
    }


@app.post("/batch-tag-video")
async def batch_tag_video():
    """Batch tag mp4 files in ./input/ for animation assets."""
    INPUT_DIR = "./input"
    valid_ext = (".mp4", ".mov", ".webm", ".avi")
    files = sorted([f for f in os.listdir(INPUT_DIR) if f.lower().endswith(valid_ext)])
    if not files:
        return {"status": "empty", "message": "No video files found in ./input/"}

    results = []
    total   = len(files)
    print(f"Batch tagging {total} videos...")

    for i, fname in enumerate(files, 1):
        vid_path = os.path.join(INPUT_DIR, fname)
        try:
            await asyncio.sleep(0)
            video_frames = read_video_frames(vid_path, NUM_FRAMES)
            ai_data      = generate_video_json(fname, video_frames)
            result_obj   = AssetAnimation(**ai_data).model_dump()
            result_obj["metadata"]["asset_type"] = "animation"

            print(f"[{i}/{total}] Tagged: {fname}")
            results.append({"file": fname, "status": "success", "data": result_obj})

            if i % 3 == 0:
                torch.cuda.empty_cache()

        except Exception as e:
            print(f"[{i}/{total}] FAILED: {fname} — {e}")
            results.append({"file": fname, "status": "failed", "error": str(e)})

    torch.cuda.empty_cache()
    return {
        "status":  "completed",
        "total":   total,
        "success": sum(1 for r in results if r["status"] == "success"),
        "failed":  sum(1 for r in results if r["status"] == "failed"),
        "details": results,
    }


if __name__ == "__main__":
    # Preload unless TAGGER_PRELOAD=0 — set that when you want the GPU left free
    # for the LLM until you switch to the tagger in the Control Center.
    if os.getenv("TAGGER_PRELOAD", "1") != "0":
        try:
            _ensure_model()
        except Exception as e:
            print(f"[Tagger] Model failed to preload: {e}")
    print("[Tagger] Control Center: http://localhost:8000/")
    uvicorn.run("tagger_server:app", host="0.0.0.0", port=8000, log_level="info")


# ══════════════════════════════════════════════════════════════
# SCHEMA NOTE — add to schemas.py if not already there:
#
# class InspirationMetadata(BaseModel):
#     mood:         str       = ""
#     roles:        list[str] = []
#     asset_type:   str       = "inspiration"
#
# class InspirationDescription(BaseModel):
#     full: str = ""
#
# class InspirationSearchContext(BaseModel):
#     scene_prompt: str       = ""
#     keywords:     list[str] = []
#
# class AssetInspiration(BaseModel):
#     FileName:       str                        = ""
#     Detail:         str                        = ""
#     Category:       str                        = ""
#     description:    InspirationDescription     = InspirationDescription()
#     metadata:       InspirationMetadata        = InspirationMetadata()
#     search_context: InspirationSearchContext   = InspirationSearchContext()
#
# ── AssetAnimation (if not yet in schemas.py) ──
#
# class AnimationDescription(BaseModel):
#     short: str = ""
#     full:  str = ""
#
# class AnimationMetadata(BaseModel):
#     mood:         str       = ""
#     action:       str       = ""
#     loopable:     bool      = False
#     duration_sec: float     = 0.0
#     asset_type:   str       = "animation"
#     roles:        list[str] = []
#
# class AnimationSearchContext(BaseModel):
#     scene_prompt: str       = ""
#     keywords:     list[str] = []
#
# class AssetAnimation(BaseModel):
#     FileName:       str                    = ""
#     Detail:         str                    = ""
#     Category:       str                    = ""
#     description:    AnimationDescription   = AnimationDescription()
#     metadata:       AnimationMetadata      = AnimationMetadata()
#     search_context: AnimationSearchContext = AnimationSearchContext()
# ══════════════════════════════════════════════════════════════