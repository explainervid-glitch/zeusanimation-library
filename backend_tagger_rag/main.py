import os
import json
import torch
import uvicorn
import asyncio
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from transformers import AutoModelForImageTextToText, AutoProcessor, BitsAndBytesConfig
from PIL import Image
from schemas import AssetBackground, AssetCharacter
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
# MODEL SELECTION — change this one line to switch models
# "qwen"  → Qwen2-VL-7B-Instruct (original)
# "gemma" → Gemma 4 E4B-it (new)
# ══════════════════════════════════════════════════════════════
ACTIVE_MODEL = "qwen"

MODEL_CONFIGS = {
    "qwen": {
        "path":  "./models/Qwen2-VL-7B-Instruct",
        "class": "qwen",
        "dtype": torch.float16,
    },
    "gemma": {
        "path":  "./models/gemma-4-E4B-it",
        "class": "gemma",
        "dtype": torch.bfloat16,
    },
}

config = MODEL_CONFIGS[ACTIVE_MODEL]

# ── BitsAndBytes 4-bit config ──────────────────────────────────
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=config["dtype"],
    bnb_4bit_use_double_quant=True,
    bnb_4bit_quant_storage=config["dtype"],   # required for Gemma 4; safe for Qwen too
)

# ── Load model & processor ─────────────────────────────────────
print(f"Loading model [{ACTIVE_MODEL}] (4-bit optimized)...")

if config["class"] == "qwen":
    from transformers import Qwen2VLForConditionalGeneration
    processor = AutoProcessor.from_pretrained(config["path"], trust_remote_code=True)
    model = Qwen2VLForConditionalGeneration.from_pretrained(
        config["path"],
        quantization_config=bnb_config,
        device_map="auto",
        attn_implementation="sdpa",
        trust_remote_code=True,
    )
else:  # gemma
    processor = AutoProcessor.from_pretrained(config["path"], padding_side="left")
    model = AutoModelForImageTextToText.from_pretrained(
        config["path"],
        quantization_config=bnb_config,
        device_map="auto",
        attn_implementation="sdpa",
        torch_dtype=torch.bfloat16,
    )

model.eval()
print(f"Model [{ACTIVE_MODEL}] ready.")

# ── System prompt ──────────────────────────────────────────────
SYSTEM_PROMPT = """You are an expert AI asset tagger for RAG pipelines. Analyze the image and output STRICT JSON matching the schema.
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

# SYSTEM_PROMPT = """You are an expert AI asset tagger for RAG pipelines. Analyze the image and output STRICT JSON matching the schema.

# 🚫 STRICT EXCLUSIONS (DO NOT VIOLATE):
# 1. ALL CHARACTERS ARE IN A STANDARD T-POSE/A-POSE. COMPLETELY IGNORE & DO NOT DESCRIBE poses, stances, arm/leg positions, or body dynamics.
# 2. NEVER use words like "standing", "arms outstretched", "facing forward", "pose", "stance", or similar.
# 3. Focus EXCLUSIVELY on: facial features, hairstyle, clothing, accessories, materials, color palette, and visual style.

# 📝 OUTPUT RULES:
# - Output ONLY valid JSON. No markdown, no explanations.
# - FileName: Use exactly the filename provided.
# - Detail: 1 concise sentence describing visual appearance.
# - Category: Broad domain (e.g., Business, Sci-Fi, Casual).
# - description.full: 2-3 detailed sentences about design, attire, and usage context. STRICTLY NO POSE MENTION.
# - metadata: Fill ONLY empty/null fields. DO NOT modify fields that already contain values.
# - search_context.keywords: 10-15 terms, mix of English & Bahasa Indonesia.
# - metadata.roles: List of specific scenes/contexts where this asset fits.

# 🔄 USING EXISTING FIELDS AS CONTEXT:
# - When existing fields are provided, use them as reference.
# - Elaborate consistently from filled fields to complete empty ones.
# - DO NOT skip empty fields. Use existing info to guide coherent, pose-free elaboration.
# """

# ── HELPERS ────────────────────────────────────────────────────

def is_empty(value) -> bool:
    """Check if value is considered empty and needs to be filled by AI."""
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    if isinstance(value, list) and len(value) == 0:
        return True
    return False


# Fields that must never be changed by AI
PROTECTED_FIELDS = {"Category", "asset_type", "style"}


def merge_ai_into_existing(existing: dict, ai_result: dict) -> dict:
    """
    Deep merge: ai_result only fills empty fields in existing.
    Fields that already have values are NOT overwritten.
    PROTECTED_FIELDS are never changed by AI.
    """
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
    Build schema containing only EMPTY fields from existing JSON.
    Used as AI prompt to focus only on empty fields.
    """
    partial = {}

    for key, schema_val in full_schema.items():
        existing_val = existing.get(key)

        if isinstance(schema_val, dict) and isinstance(existing_val, dict):
            sub = build_partial_schema(existing_val, schema_val)
            if sub:
                partial[key] = sub
        elif is_empty(existing_val):
            partial[key] = schema_val

    return partial


def generate_json(asset_type: str, filename: str, image: Image.Image,
                  existing_json: dict | None = None) -> dict:
    """Generate AI tags. If existing_json is provided, AI only fills empty fields."""

    # ── Image resize ───────────────────────────────────────────
    MAX_DIM = 768
    if max(image.size) > MAX_DIM:
        ratio = MAX_DIM / max(image.size)
        image = image.resize(
            (int(image.width * ratio), int(image.height * ratio)),
            Image.Resampling.LANCZOS
        )

    full_schema = (
        AssetBackground.model_json_schema()
        if asset_type == "background"
        else AssetCharacter.model_json_schema()
    )

    # ── Build prompt context ───────────────────────────────────
    if existing_json:
        empty_fields  = build_partial_schema(existing_json, full_schema)
        prompt_schema = empty_fields if empty_fields else full_schema
        context_note  = (
            f"\nEXISTING DATA (use as context for elaboration):\n"
            f"{json.dumps(existing_json, indent=2)}\n\n"
            f"DO NOT modify the filled fields above.\n"
            f"ELABORATE and FILL only these EMPTY fields based on the existing context:\n"
            f"{json.dumps(prompt_schema, indent=2)}\n\n"
            f"TIP: Use the existing filled fields (like 'detail', 'style', etc.) as reference to guide your elaboration.\n"
            f"Ensure all empty fields are completed consistently with the existing information."
        )
    else:
        prompt_schema = full_schema
        context_note  = f"\nOutput strictly JSON:\n{json.dumps(prompt_schema, indent=2)}"

    # ── Build messages & run inference (model-specific) ────────
    if config["class"] == "qwen":
        messages = [
            {"role": "user", "content": [
                {"type": "image", "image": image},
                {"type": "text",  "text": (
                    f"Filename: {filename}\n"
                    f"Asset Type: {asset_type}\n"
                    f"{SYSTEM_PROMPT}"
                    f"{context_note}"
                )}
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

    else:  # gemma
        user_text = (
            f"Filename: {filename}\n"
            f"Asset Type: {asset_type}\n"
            f"{context_note}"
        )
        messages = [
            {
                "role": "system",
                "content": [{"type": "text", "text": SYSTEM_PROMPT}]
            },
            {
                "role": "user",
                "content": [
                    {"type": "image"},
                    {"type": "text", "text": user_text}
                ]
            }
        ]
        inputs = processor.apply_chat_template(
            messages,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
            add_generation_prompt=True,
            images=[image],
        ).to(model.device)
        input_len = inputs["input_ids"].shape[-1]

    # ── Generate ───────────────────────────────────────────────
    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=400,
            do_sample=False,
            repetition_penalty=1.1,
            pad_token_id=processor.tokenizer.pad_token_id,
        )

    generated = processor.decode(
        output_ids[0][input_len:],
        skip_special_tokens=True
    ).strip()

    # ── Parse JSON from output ─────────────────────────────────
    start = generated.find("{")
    end   = generated.rfind("}") + 1
    if start == -1 or end == 0:
        raise ValueError(f"No JSON in output: {generated[:100]}")

    repaired = repair_json(generated[start:end], return_objects=True)
    if not isinstance(repaired, dict):
        raise ValueError("Output is not a dict")

    return repaired


# ── ENDPOINTS ──────────────────────────────────────────────────

@app.post("/auto-tag")
async def auto_tag(
    file:       UploadFile = File(...),
    asset_type: str        = Form(...),
    json_path:  str        = Form(default=""),
    filename:   str        = Form(default=""),
):
    if asset_type not in ("background", "character"):
        raise HTTPException(400, "asset_type must be 'background' or 'character'")

    try:
        image = Image.open(file.file).convert("RGB")
    except Exception as e:
        raise HTTPException(400, f"Invalid image: {str(e)}")

    asset_filename = filename or file.filename or "unknown"

    existing_json = None
    if json_path and os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                existing_json = json.load(f)
            print(f"Existing JSON found: {json_path}")
        except Exception as e:
            print(f"Failed to read existing JSON: {e}")

    try:
        ai_data = generate_json(asset_type, asset_filename, image, existing_json)

        if existing_json:
            merged = merge_ai_into_existing(existing_json, ai_data)
        else:
            schema_obj = AssetBackground if asset_type == "background" else AssetCharacter
            merged = schema_obj(**ai_data).model_dump()

        if "metadata" not in merged:
            merged["metadata"] = {}
        merged["metadata"]["asset_type"] = asset_type

        if json_path:
            try:
                os.makedirs(os.path.dirname(os.path.abspath(json_path)), exist_ok=True)
                with open(json_path, "w", encoding="utf-8") as f:
                    json.dump(merged, f, indent=4, ensure_ascii=False)
                print(f"Saved to asset path: {json_path}")
            except Exception as e:
                print(f"Failed to save JSON to {json_path}: {e}")
        else:
            print("json_path not provided - JSON not saved to disk")

        return merged

    except Exception as e:
        print(f"Error: {str(e)}")
        raise HTTPException(500, f"AI generation failed: {str(e)}")


@app.post("/batch-tag")
async def batch_tag(asset_type: str = Form("background")):
    if asset_type not in ("background", "character"):
        raise HTTPException(400, "asset_type must be 'background' or 'character'")

    INPUT_DIR = "./input"
    valid_ext = (".jpg", ".jpeg", ".png", ".webp", ".bmp")
    files = sorted([f for f in os.listdir(INPUT_DIR) if f.lower().endswith(valid_ext)])
    if not files:
        return {"status": "empty", "message": "No images found in ./input/"}

    results = []
    total = len(files)
    print(f"Batch tagging {total} images (type: {asset_type}, model: {ACTIVE_MODEL})...")

    for i, fname in enumerate(files, 1):
        img_path = os.path.join(INPUT_DIR, fname)
        try:
            await asyncio.sleep(0)
            image = Image.open(img_path).convert("RGB")
            if image.width == 0 or image.height == 0:
                raise ValueError("Image has 0 dimensions")

            ai_data    = generate_json(asset_type, fname, image)
            schema_obj = AssetBackground if asset_type == "background" else AssetCharacter
            result_obj = schema_obj(**ai_data).model_dump()
            result_obj["metadata"]["asset_type"] = asset_type
            result_obj["metadata"]["style"]      = result_obj["metadata"].get("style") or ""

            print(f"[{i}/{total}] Tagged: {fname}")
            results.append({"file": fname, "status": "success", "data": result_obj})

            if i % 5 == 0:
                torch.cuda.empty_cache()

        except Exception as e:
            print(f"[{i}/{total}] FAILED: {fname} - {e}")
            results.append({"file": fname, "status": "failed", "error": str(e)})

    torch.cuda.empty_cache()

    summary = {
        "status":  "completed",
        "total":   total,
        "success": sum(1 for r in results if r["status"] == "success"),
        "failed":  sum(1 for r in results if r["status"] == "failed"),
        "details": results,
    }
    print(f"Batch done. {summary['success']} success, {summary['failed']} failed.")
    return summary


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, log_level="info")