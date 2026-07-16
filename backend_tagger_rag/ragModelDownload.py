# Run this once in a separate script or python shell
# from C:\exp\ai-asset-tagger
from huggingface_hub import snapshot_download

snapshot_download(repo_id="BAAI/bge-m3",                local_dir="./models/bge-m3")
snapshot_download(repo_id="BAAI/bge-reranker-v2-m3",   local_dir="./models/bge-reranker-v2-m3")