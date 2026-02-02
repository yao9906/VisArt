import json
import networkx as nx
import os
import pickle
from google import genai
from google.genai import types
import numpy as np
from typing import List, Dict, Any
from sklearn.metrics.pairwise import cosine_similarity

# Configure Gemini
# NOTE: Ensure GEMINI_API_KEY is set in environment variables
# Proxy support: Ensure http_proxy / https_proxy env vars are set if needed.
CACHE_FILE = "embeddings_cache.pkl"

class VisualGraphRAG:
    def __init__(self, json_path: str):
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            print("Warning: GEMINI_API_KEY not found in environment.")
        
        # Explicitly check for proxy to debug location issues
        proxy = os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")
        print(f"DEBUG: Using Proxy -> {proxy}")
        
        # Configure Client with explicit HTTP options if needed
        # version='v1' forces REST/HTTP if available, though Client defaults are usually smart.
        self.client = genai.Client(
            api_key=api_key,
            http_options={'api_version': 'v1beta'} 
        )
        self.graph = nx.Graph()
        self.json_path = json_path
        self.task_nodes = []
        self.task_embeddings = None
        
        self.load_graph()
        self.load_or_build_indices()

    def load_graph(self):
        """Builds the Knowledge Graph from the JSON file."""
        if not os.path.exists(self.json_path):
            print(f"Warning: {self.json_path} not found.")
            return

        with open(self.json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        print(f"Building Graph from {len(data)} papers...")
        
        for p_idx, paper in enumerate(data):
            # 1. Create Paper Node
            paper_id = f"paper_{p_idx}"
            paper_meta = paper.get("metadata", {})
            self.graph.add_node(paper_id, type="Paper", 
                                title=paper_meta.get("system_name", "Unknown"),
                                domain=paper_meta.get("domain", "Vis"))
            
            mappings = paper.get("mappings", [])
            for m_idx, mapping in enumerate(mappings):
                # 2. Create Task Node
                task_id = f"task_{p_idx}_{m_idx}"
                task_desc = mapping.get("task_description", "")
                task_name = mapping.get("task_name", "Unnamed Task")
                
                self.graph.add_node(task_id, type="Task", 
                                    name=task_name,
                                    description=task_desc,
                                    rationale=mapping.get("rationale", ""))
                
                # Edge: Paper -> Task
                self.graph.add_edge(paper_id, task_id, relation="DEFINES_TASK")
                
                # 3. Create/Link Technique Node (Shared Entity)
                # Normalize technique name to allow linking different papers
                technique_raw = mapping.get("design_technique", "General")
                technique_id = f"tech_{hash(technique_raw)}"
                
                if not self.graph.has_node(technique_id):
                    self.graph.add_node(technique_id, type="Technique", name=technique_raw)
                
                # Edge: Task -> Technique
                self.graph.add_edge(task_id, technique_id, relation="USES_TECHNIQUE")
                
                # Store for indexing
                self.task_nodes.append({
                    "id": task_id,
                    "text": f"{task_name}: {task_desc}", # Embedding content
                    "full_obj": mapping
                })
        
        print(f"Graph Built: {self.graph.number_of_nodes()} nodes, {self.graph.number_of_edges()} edges.")

    def get_embedding(self, text: str):
        """Wraps Gemini Embedding API (New SDK)."""
        try:
            # Short-circuit if empty text
            if not text.strip():
                 return [0.0] * 768

            # Try-catch specifically for the API call
            # Using embedding-001 for broader compatibility if text-embedding-004 fails (404)
            result = self.client.models.embed_content(
                model="models/embedding-001",
                contents=text,
                config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY")
            )
            # Support both list and ndarray return types from SDK
            return result.embeddings[0].values
        except Exception as e:
            # VERY IMPORTANT: Log the error type
            error_msg = str(e)
            if "400" in error_msg and "User location" in error_msg:
                print("EROR: Region Blocked. Please switch Proxy to USA/Singapore/Taiwan.")
            elif "404" in error_msg:
                 print("ERROR: Model not found. Check model name.")
            else:
                 print(f"Embedding error: {error_msg}")
            
            return [0.0] * 768

    def load_or_build_indices(self):
        """Loads embeddings from cache if available, otherwise computes and saves them."""
        # Safety check: Ensure task_nodes exist
        if not self.task_nodes:
             print("ERROR: No task nodes loaded. Cannot build indices.")
             self.task_embeddings = np.zeros((1, 768)) # Dummy to prevent crash
             return

        if os.path.exists(CACHE_FILE):
            print(f"Loading cached embeddings from {CACHE_FILE}...")
            try:
                with open(CACHE_FILE, 'rb') as f:
                    cache_data = pickle.load(f)
                    if len(cache_data['embeddings']) == len(self.task_nodes):
                        self.task_embeddings = cache_data['embeddings']
                        print("Cache loaded successfully.")
                        return
                    else:
                        print("Cache mismatch. Rebuilding...")
            except Exception as e:
                print(f"Cache load failed: {e}. Rebuilding...")

        print("Generating embeddings for tasks (this may take a moment)...")
        texts = [t["text"] for t in self.task_nodes]
        embeddings = []
        for text in texts:
            embeddings.append(self.get_embedding(text))
            
        self.task_embeddings = np.array(embeddings)
        
        try:
            with open(CACHE_FILE, 'wb') as f:
                pickle.dump({'embeddings': self.task_embeddings}, f)
            print(f"Indices built and saved to {CACHE_FILE}.")
        except Exception as e:
            print(f"Failed to save cache: {e}")

    def retrieve(self, query: str, top_k: int = 3):
        """
        GraphRAG Retrieval with Trace Data for Visualization
        """
        print(f"Retrieving for: {query}")
        
        # Safety check for uninitialized index
        if self.task_embeddings is None or len(self.task_embeddings) == 0:
             print("ERROR: Embeddings index is empty.")
             return { "results": [], "trace": None }

        try:
            query_vec = np.array(self.get_embedding(query)).reshape(1, -1)
            
            # 1. Vector Search
            sims = cosine_similarity(query_vec, self.task_embeddings)[0]
            top_indices = sims.argsort()[-top_k:][::-1]
            
            results = []
            
            # Structure for Frontend Visualization
            trace_steps = {
                "query": query,
                "root_nodes": [], 
                "traversed_edges": []
            }

            for idx in top_indices:
                # Boundary check (in case logic mismatch)
                if idx >= len(self.task_nodes): continue

                task_info = self.task_nodes[idx]
                task_id = task_info["id"]
                score = float(sims[idx])
                
                trace_steps["root_nodes"].append({
                    "id": task_id, 
                    "label": task_info["full_obj"]["task_name"],
                    "score": score,
                    "type": "Task"
                })

                # 2. Graph Traversal (1-hop)
                if task_id in self.graph: 
                    neighbors = list(self.graph.neighbors(task_id))
                    
                    technique_node = next((n for n in neighbors if self.graph.nodes[n]["type"] == "Technique"), None)
                    technique_name = self.graph.nodes[technique_node]["name"] if technique_node else "Unknown"
                    
                    if technique_node:
                        trace_steps["traversed_edges"].append({
                            "source": task_id, "target": technique_node, "relation": "USES_TECHNIQUE"
                        })

                    paper_node = next((n for n in neighbors if self.graph.nodes[n]["type"] == "Paper"), None)
                    paper_data = self.graph.nodes[paper_node] if paper_node else {}
                    
                    if paper_node:
                        trace_steps["traversed_edges"].append({
                            "source": paper_node, "target": task_id, "relation": "DEFINES_TASK"
                        })

                    # 3. Graph Traversal (2-hop)
                    related_tasks = []
                    if technique_node:
                        tech_neighbors = list(self.graph.neighbors(technique_node))
                        for tn in tech_neighbors[:3]: 
                            if tn != task_id and self.graph.nodes[tn]["type"] == "Task":
                                related_tasks.append(self.graph.nodes[tn]["name"])
                                trace_steps["traversed_edges"].append({
                                    "source": technique_node, "target": tn, "relation": "USED_BY"
                                })
                    
                    results.append({
                        "task": task_info["full_obj"]["task_name"],
                        "description": task_info["full_obj"]["task_description"],
                        "rationale": task_info["full_obj"]["rationale"],
                        "technique": technique_name,
                        "coming_from_paper": paper_data.get("title"),
                        "related_applications": related_tasks,
                        "id": task_id
                    })
            
            return {
                "results": results,
                "trace": trace_steps
            }
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"Retrieval Logic Failed: {e}")
            return { "results": [], "trace": None }

# Singleton instance placeholder
rag_system = None

def get_rag_system():
    global rag_system
    if rag_system is None:
        # Assuming run from root or backend folder logic
        path = "vis_design_graph.json" 
        if not os.path.exists(path):
            path = "../vis_design_graph.json"
        
        rag_system = VisualGraphRAG(path)
    return rag_system

if __name__ == "__main__":
    # Test run
    rag = get_rag_system()
    res = rag.retrieve("Visualize high density temporal sequences")
    print(json.dumps(res, indent=2))
