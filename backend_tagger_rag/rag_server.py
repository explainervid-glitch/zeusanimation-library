# rag_server.py — ZeusPack RAG Server v2
# Stack: Qdrant (local) + FastEmbed (ONNX, no GPU needed)
# Port: 8001 — fully separate from tagger (port 8000)
# Install: pip install qdrant-client fastembed

import os
import uuid
from typing import List, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    FilterSelector,
    MatchValue,
    PointIdsList,
    PointStruct,
    VectorParams,
)
from fastembed import TextEmbedding
from gpu_queue import GpuQueue

# ══════════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════════
BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
QDRANT_PATH = os.path.join(BASE_DIR, "qdrant_db")
COLLECTION  = "assets"
EMBED_MODEL = "BAAI/bge-small-en-v1.5"   # 33MB ONNX, fast, decent multilingual
EMBED_DIM   = 384

# ══════════════════════════════════════════════════════════════
# APP
# ══════════════════════════════════════════════════════════════
app = FastAPI(title="ZeusPack RAG Server v2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ══════════════════════════════════════════════════════════════
# MODELS — load once at startup
# ══════════════════════════════════════════════════════════════
print("Loading FastEmbed model (ONNX, CPU)...")
embedder = TextEmbedding(EMBED_MODEL)
print(f"Embedder ready: {EMBED_MODEL}")

# ── QUEUE ─────────────────────────────────────────────────────
# Search is fast (~tens of ms: CPU embedding + Qdrant), so serial is plenty for
# a <20-person team. concurrency=1 also sidesteps the embedded (local-file)
# Qdrant client, which isn't built for concurrent access. The line is capped so
# a team-wide burst can't pile up unbounded.
rag_queue = GpuQueue("RAG", concurrency=1, max_waiting=48)

print("Initializing Qdrant (local file)...")
qdrant = QdrantClient(path=QDRANT_PATH)

# Create collection if it doesn't exist
collections = [c.name for c in qdrant.get_collections().collections]
if COLLECTION not in collections:
    qdrant.create_collection(
        collection_name=COLLECTION,
        vectors_config=VectorParams(size=EMBED_DIM, distance=Distance.COSINE),
    )
    print(f"Created collection '{COLLECTION}' (dim={EMBED_DIM})")
else:
    count = qdrant.count(COLLECTION).count
    print(f"Loaded collection '{COLLECTION}' — {count} assets indexed")

# ══════════════════════════════════════════════════════════════
# SCHEMAS
# ══════════════════════════════════════════════════════════════

class RagAssetPayload(BaseModel):
    asset_id:      int
    style_id:      int
    style_type_id: int
    asset_type:    str   # background | character | animation | inspiration
    category:      str
    json_data:     dict
    json_path:     str = ""   # stable key — used to derive the point id + join back
    pack_id:       str = ""   # pack root path — scopes search + delete-by-pack

class RagBulkPayload(BaseModel):
    assets: List[RagAssetPayload]

class RagSearchPayload(BaseModel):
    query:    str
    style_id: int
    pack_id:  Optional[str] = None   # scope results to one pack (avoids cross-pack mixing)
    limit:    Optional[int] = 10

class RagDeletePackPayload(BaseModel):
    pack_id: str

# ══════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════

def _arr(val) -> str:
    if isinstance(val, list):
        return " ".join(str(v) for v in val if v)
    return str(val) if val else ""


# ── Stable, pack-unique point IDs ─────────────────────────────
# Point ids are derived from the asset's json_path (a stable, pack-unique file
# path) instead of the SQLite autoincrement id. Rescans reassign autoincrement
# ids, which used to orphan every vector; deriving the id from json_path means
# the same asset keeps the same point id across rescans (upsert overwrites),
# so the index never fills with stale duplicates.
def _stable_key(asset: RagAssetPayload) -> str:
    return asset.json_path or (
        f"{asset.pack_id}|{asset.style_id}|{asset.asset_type}|{asset.category}|{asset.asset_id}"
    )


def _point_id(stable_key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, stable_key))


def _build_text(asset: RagAssetPayload) -> str:
    """
    Concatenate all searchable fields into one string.

    NOTE: category/asset_type are included ONCE (not repeated) as light
    context. Earlier versions repeated them 2x as a "weight boost" — this
    caused embeddings to skew heavily toward whatever asset_type/category
    a result had, drowning out the actual semantic content of the query.
    Combined with a renderer-side bug that appended the *last selected
    category's type* to every query, results were dominated by category
    metadata instead of the user's actual search intent.
    """
    j = asset.json_data
    m = j.get("metadata",       {}) or {}
    d = j.get("description",    {}) or {}
    s = j.get("search_context", {}) or {}

    # Order matters: BGE-small only reads ~512 tokens, so the richest,
    # most descriptive fields go FIRST and the light category/type context
    # goes LAST. FileName (often a meaningless slug) and the duplicate
    # Category are dropped — they only added noise.
    parts = [
        d.get("full",         ""),
        d.get("short",        ""),
        s.get("scene_prompt", ""),
        _arr(s.get("keywords",  [])),
        j.get("Detail",       ""),
        m.get("mood",         ""),
        m.get("action",       ""),
        m.get("lighting",     ""),
        m.get("time_of_day",  ""),
        m.get("vibe",         ""),
        m.get("gender",       ""),
        m.get("age",          ""),
        _arr(m.get("roles",   [])),
        _arr(m.get("props",   [])),
        # Light context last — least important for ranking
        asset.category or "",
        asset.asset_type or "",
    ]
    return " ".join(p for p in parts if p and str(p).strip())


def _embed_one(text: str) -> list:
    """Embed a single string, return as list."""
    return list(next(embedder.embed([text])))


def _embed_many(texts: list) -> list:
    """Embed a list of strings, return list of vectors."""
    return list(embedder.embed(texts))


def _embed_query(text: str) -> list:
    """Embed a SEARCH QUERY. BGE models expect a short query-instruction
    prefix, which FastEmbed applies via query_embed(); documents stay
    un-prefixed via plain embed(). This asymmetry is how BGE is meant to be
    used and measurably improves retrieval. Falls back to embed() on older
    fastembed builds that lack query_embed()."""
    try:
        return list(next(embedder.query_embed([text])))
    except AttributeError:
        return list(next(embedder.embed([text])))

# ══════════════════════════════════════════════════════════════
# ENDPOINTS
# ══════════════════════════════════════════════════════════════

@app.get("/rag-status")
async def rag_status():
    count = qdrant.count(COLLECTION).count
    return {
        "success":      True,
        "indexed":      count,
        "qdrant_path":  QDRANT_PATH,
        "embed_model":  EMBED_MODEL,
        "embed_dim":    EMBED_DIM,
    }


@app.post("/rag-index/upsert")
async def rag_index_upsert(asset: RagAssetPayload):
    """Index or re-index a single asset."""
    try:
        text   = _build_text(asset)
        vector = _embed_one(text)

        qdrant.upsert(
            collection_name=COLLECTION,
            points=[PointStruct(
                id      = _point_id(_stable_key(asset)),
                vector  = vector,
                payload = {
                    "asset_id":      asset.asset_id,
                    "json_path":     asset.json_path,
                    "pack_id":       asset.pack_id,
                    "style_id":      asset.style_id,
                    "style_type_id": asset.style_type_id,
                    "asset_type":    asset.asset_type,
                    "category":      asset.category,
                    "text":          text[:500],  # store snippet for debug
                }
            )]
        )
        print(f"[RAG] Upserted asset_id={asset.asset_id} ({asset.json_data.get('FileName', '?')})")
        return {"success": True, "asset_id": asset.asset_id}
    except Exception as e:
        print(f"[RAG] Upsert error: {e}")
        raise HTTPException(500, str(e))


@app.post("/rag-index/bulk")
async def rag_index_bulk(payload: RagBulkPayload):
    """Bulk index assets. Called in batches of 500 from Electron after rescan."""
    if not payload.assets:
        return {"success": True, "indexed": 0}

    print(f"[RAG] Bulk indexing {len(payload.assets)} assets...")

    texts   = [_build_text(a) for a in payload.assets]
    vectors = _embed_many(texts)

    points  = [
        PointStruct(
            id      = _point_id(_stable_key(asset)),
            vector  = vectors[i],
            payload = {
                "asset_id":      asset.asset_id,
                "json_path":     asset.json_path,
                "pack_id":       asset.pack_id,
                "style_id":      asset.style_id,
                "style_type_id": asset.style_type_id,
                "asset_type":    asset.asset_type,
                "category":      asset.category,
            }
        )
        for i, asset in enumerate(payload.assets)
    ]

    try:
        qdrant.upsert(collection_name=COLLECTION, points=points)
        count = qdrant.count(COLLECTION).count
        print(f"[RAG] Batch done — total in collection: {count}")
        return {
            "success": True,
            "indexed": len(points),
            "total":   count,
        }
    except Exception as e:
        print(f"[RAG] Bulk error: {e}")
        raise HTTPException(500, str(e))


@app.delete("/rag-index/{asset_id}")
async def rag_index_delete(asset_id: int):
    """Best-effort single delete by stored asset_id. (Point ids are UUIDs now,
    so we filter on the payload rather than the id.) Re-embed is authoritative."""
    try:
        qdrant.delete(
            collection_name=COLLECTION,
            points_selector=FilterSelector(filter=Filter(must=[
                FieldCondition(key="asset_id", match=MatchValue(value=asset_id))
            ])),
        )
        print(f"[RAG] Deleted points with asset_id={asset_id}")
        return {"success": True, "asset_id": asset_id}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/rag-index/delete-pack")
async def rag_delete_pack(payload: RagDeletePackPayload):
    """Delete every vector belonging to one pack (by pack_id). Called before a
    full re-embed so a pack's vectors are replaced cleanly with no orphans."""
    try:
        qdrant.delete(
            collection_name=COLLECTION,
            points_selector=FilterSelector(filter=Filter(must=[
                FieldCondition(key="pack_id", match=MatchValue(value=payload.pack_id))
            ])),
        )
        count = qdrant.count(COLLECTION).count
        print(f"[RAG] Deleted pack '{payload.pack_id}' — {count} points remain")
        return {"success": True, "total": count}
    except Exception as e:
        print(f"[RAG] delete-pack error: {e}")
        raise HTTPException(500, str(e))


@app.post("/rag-reset")
async def rag_reset():
    """Nuke the whole collection and recreate it empty. One-time cleanup to
    clear the legacy backlog of stale (int-id) points."""
    try:
        qdrant.delete_collection(COLLECTION)
        qdrant.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=EMBED_DIM, distance=Distance.COSINE),
        )
        print("[RAG] Collection reset (empty)")
        return {"success": True, "indexed": 0}
    except Exception as e:
        print(f"[RAG] reset error: {e}")
        raise HTTPException(500, str(e))


@app.get("/queue-status")
async def queue_status():
    """Live queue gauge — the app polls this to show 'in line' feedback."""
    return {"success": True, **rag_queue.stats()}


def _do_search(query: str, style_id: int, pack_id, limit: int) -> list:
    """The actual (blocking) embed + Qdrant query — runs in the queue's worker."""
    # Embed query — uses BGE's query-instruction prefix (see _embed_query)
    query_vec = _embed_query(query)

    # Scope by style_id, plus pack_id when provided so results never mix across
    # packs (both packs reuse the same style_id numbers).
    must = [FieldCondition(key="style_id", match=MatchValue(value=style_id))]
    if pack_id:
        must.append(FieldCondition(key="pack_id", match=MatchValue(value=pack_id)))
    search_filter = Filter(must=must)

    try:
        # qdrant-client >= 1.7
        response = qdrant.query_points(
            collection_name = COLLECTION,
            query           = query_vec,
            query_filter    = search_filter,
            limit           = limit,
            with_payload    = True,
        )
        hits = response.points
    except AttributeError:
        # qdrant-client < 1.7 fallback
        hits = qdrant.search(
            collection_name = COLLECTION,
            query_vector    = query_vec,
            query_filter    = search_filter,
            limit           = limit,
            with_payload    = True,
        )

    # Point ids are UUIDs now — return the payload fields (json_path is the
    # stable key the app joins back to its current SQLite on).
    return [
        {
            "asset_id":      hit.payload.get("asset_id"),
            "json_path":     hit.payload.get("json_path"),
            "style_type_id": hit.payload.get("style_type_id"),
            "asset_type":    hit.payload.get("asset_type"),
            "category":      hit.payload.get("category"),
            "score":         round(hit.score, 4),
        }
        for hit in hits
    ]


@app.post("/rag-search")
async def rag_search(payload: RagSearchPayload):
    """Semantic search scoped to style_id (queued so team bursts stay orderly)."""
    if not payload.query.strip():
        return {"success": True, "results": []}

    count = qdrant.count(COLLECTION).count
    if count == 0:
        return {"success": True, "results": [], "message": "Index empty — run rescan first"}

    try:
        results = await rag_queue.run(
            _do_search, payload.query.strip(), payload.style_id, payload.pack_id, payload.limit
        )
        return {"success": True, "results": results, "queue": rag_queue.stats()}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[RAG] Search error: {e}")
        raise HTTPException(500, str(e))


# ══════════════════════════════════════════════════════════════
# ENTRY
# ══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")