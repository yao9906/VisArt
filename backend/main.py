from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
import json
import re
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from graph_engine import get_rag_system
from constraint_engine import get_constraint_engine
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# --- PROXY CONFIGURATION ---
# Set V2Ray proxy explicitly if not already in env
# Default V2Ray HTTP/Socks ports are often 10809 (HTTP) or 10808 (Socks)
# Adjust if your user-settings are different.
PROXY_URL = os.environ.get("HTTP_PROXY") or "http://127.0.0.1:7890"
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
    try:
        engine = get_constraint_engine()
        print(f"Constraint Engine Ready.")
    except Exception as e:
        print(f"Constraint Engine Init Failed: {e}")
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
    id: Optional[str] = None

class RuleHit(BaseModel):
    topic: str
    condition: str = ""
    rule: str = ""
    source: str = ""
    score: float = 0.0
    matched_keywords: List[str] = []
    reason: str = ""

class MixedDesignPackage(BaseModel):
    tasks: List[RetrievalResult] = []
    color_rules: List[RuleHit] = []
    interaction_rules: List[RuleHit] = []

class RetrievalResponse(BaseModel):
    results: List[RetrievalResult]
    trace: Optional[Dict[str, Any]] = None
    mixed_package: Optional[MixedDesignPackage] = None


def _resolve_file(path_from_root: str) -> str:
    """Resolve file path whether running from project root or backend folder."""
    if os.path.exists(path_from_root):
        return path_from_root
    fallback = os.path.join("..", path_from_root)
    return fallback


def _load_rules_file(path_from_root: str) -> List[Dict[str, Any]]:
    path = _resolve_file(path_from_root)
    if not os.path.exists(path):
        return []

    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read().strip()
        if not raw:
            return []

        # 1) JSON array/object first
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [x for x in parsed if isinstance(x, dict)]
            if isinstance(parsed, dict):
                return [parsed]
        except Exception:
            pass

        # 2) JSONL fallback (tolerant)
        rows: List[Dict[str, Any]] = []
        for line in raw.splitlines():
            line = line.strip()
            if not line or line in ("[", "]"):
                continue
            line = re.sub(r",\s*$", "", line)
            try:
                obj = json.loads(line)
                if isinstance(obj, dict):
                    rows.append(obj)
            except Exception:
                continue
        return rows
    except Exception:
        return []


def _tokenize(text: str) -> List[str]:
    return [t for t in re.split(r"\W+", (text or "").lower()) if t]


def _rank_rules(query: str, rules: List[Dict[str, Any]], top_k: int = 3) -> List[RuleHit]:
    q_tokens = set(_tokenize(query))
    has_time_signal = bool(re.search(r"time|temporal|trend|date|year|month|day|timeline", query, re.IGNORECASE))

    scored = []
    for r in rules:
        text = " ".join([
            str(r.get("topic", "")),
            str(r.get("condition", "")),
            str(r.get("rule", "")),
            str(r.get("evidence", "")),
            str(r.get("source", "")),
            " ".join(r.get("tags", []) or [])
        ])
        r_tokens = _tokenize(text)
        matched = list({t for t in r_tokens if t in q_tokens})[:6]
        overlap = len(matched)
        bonus = 0
        if has_time_signal and re.search(r"time|temporal|axis|line|brush|zoom|focus|context", text, re.IGNORECASE):
            bonus = 2
        score = float(overlap + bonus)

        reason = "基于语义相关性"
        if matched:
            reason = f"关键词匹配: {', '.join(matched)}"
        if bonus > 0:
            reason += "；时间语义加权"

        scored.append(RuleHit(
            topic=str(r.get("topic") or r.get("title") or "Untitled Rule"),
            condition=str(r.get("condition") or ""),
            rule=str(r.get("rule") or ""),
            source=str(r.get("source") or ""),
            score=score,
            matched_keywords=matched,
            reason=reason
        ))

    scored.sort(key=lambda x: x.score, reverse=True)
    return scored[:top_k]

# Removed deprecated @app.on_event("startup") in favor of lifespan

@app.post("/retrieve", response_model=RetrievalResponse)
async def retrieve_context(request: QueryRequest):
    try:
        rag = get_rag_system()
        # Returns { "results": [...], "trace": {...} }
        base = rag.retrieve(request.query, request.top_k)

        # Build mixed design package (Task + Color + Interaction)
        color_rules = _load_rules_file("color_rules.jsonl")
        interaction_rules = _load_rules_file("interaction_rules.jsonl")

        mixed = MixedDesignPackage(
            tasks=base.get("results", []),
            color_rules=_rank_rules(request.query, color_rules, top_k=request.top_k),
            interaction_rules=_rank_rules(request.query, interaction_rules, top_k=request.top_k),
        )

        return {
            "results": base.get("results", []),
            "trace": base.get("trace"),
            "mixed_package": mixed
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health_check():
    return {"status": "active", "backend": "GraphRAG NetworkX + ConstraintEngine"}


# ---- Phase 2: Constraint Engine Endpoints ----

class AnalyzeRequest(BaseModel):
    query: str
    data: List[Dict[str, Any]] = []


@app.post("/analyze")
async def analyze_data(request: AnalyzeRequest):
    """
    Full constraint analysis pipeline:
    1. Profile data characteristics (field types, density, structure)
    2. Infer visualization task from user prompt (Brehmer-Munzner)
    3. Suggest encodings based on Cleveland-McGill effectiveness
    4. Recommend palette and density strategy
    
    Returns structured constraint context for LLM prompt injection.
    """
    try:
        engine = get_constraint_engine()
        result = engine.full_analysis(request.data, request.query)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class LintRequest(BaseModel):
    query: str
    data: List[Dict[str, Any]] = []
    viz_spec: Dict[str, Any] = {}


@app.post("/lint")
async def lint_visualization(request: LintRequest):
    """
    Evaluate a visualization specification against all constraints.
    Returns ConstraintReport with violations, score, and suggestions.
    """
    try:
        engine = get_constraint_engine()
        profile = engine.analyze_data(request.data)
        task = engine.infer_task(request.query)
        report = engine.evaluate_constraints(request.viz_spec, profile, task)
        
        return {
            "design_quality_score": report.design_quality_score,
            "constraint_compliance_rate": report.constraint_compliance_rate,
            "hard_violations": [
                {
                    "id": v.constraint_id,
                    "name": v.constraint_name,
                    "description": v.description,
                    "rationale": v.rationale,
                    "source": v.source,
                    "penalty": v.penalty
                }
                for v in report.hard_violations
            ],
            "soft_violations": [
                {
                    "id": v.constraint_id,
                    "name": v.constraint_name,
                    "description": v.description,
                    "weight": v.weight,
                    "penalty": v.penalty
                }
                for v in report.soft_violations
            ],
            "total_penalty": report.total_penalty,
            "suggestions": report.suggestions
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
