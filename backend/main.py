from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import os
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from graph_engine import get_rag_system

# --- PROXY CONFIGURATION ---
# Set V2Ray proxy explicitly if not already in env
# Default V2Ray HTTP/Socks ports are often 10809 (HTTP) or 10808 (Socks)
# Adjust if your user-settings are different.
PROXY_URL = os.environ.get("HTTP_PROXY") or "http://127.0.0.1:10809"
if "HTTP_PROXY" not in os.environ:
    os.environ["HTTP_PROXY"] = PROXY_URL
if "HTTPS_PROXY" not in os.environ:
    os.environ["HTTPS_PROXY"] = PROXY_URL

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print(f"Initializing Knowledge Graph with Proxy: {PROXY_URL}...")
    try:
        get_rag_system()
        print("Graph Ready.")
    except Exception as e:
        print(f"Graph Init Failed: {e}")
    yield
    # Shutdown (if needed)

app = FastAPI(title="VisArt GraphRAG API", lifespan=lifespan)

# Allow Frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class QueryRequest(BaseModel):
    query: str
    top_k: int = 3

class RetrievalResult(BaseModel):
    task: str
    description: str
    rationale: str
    technique: str
    coming_from_paper: Optional[str] = None
    related_applications: List[str] = []

# Removed deprecated @app.on_event("startup") in favor of lifespan

@app.post("/retrieve", response_model=List[RetrievalResult])
async def retrieve_context(request: QueryRequest):
    try:
        rag = get_rag_system()
        results = rag.retrieve(request.query, request.top_k)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health_check():
    return {"status": "active", "backend": "GraphRAG NetworkX"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
