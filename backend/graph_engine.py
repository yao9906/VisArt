import json
import networkx as nx
import os
from google import genai
from google.genai import types
import numpy as np
from typing import List, Dict, Any
from sklearn.metrics.pairwise import cosine_similarity

# Configure Gemini
# NOTE: Ensure GEMINI_API_KEY is set in environment variables
# Proxy support: Ensure http_proxy / https_proxy env vars are set if needed.

class VisualGraphRAG:
    def __init__(self, json_path: str):
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            print("Warning: GEMINI_API_KEY not found.")
            
        self.client = genai.Client(api_key=api_key)
        self.graph = nx.Graph()
        self.json_path = json_path
        self.embeddings_cache = {} # Simple in-memory cache
        self.task_nodes = []
        self.task_embeddings = None
        
        self.load_graph()
        self.build_indices()

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
            result = self.client.models.embed_content(
                model="text-embedding-004",
                contents=text,
                config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY")
            )
            return result.embeddings[0].values
        except Exception as e:
            print(f"Embedding error: {e}")
            return [0.0] * 768

    def build_indices(self):
        """Pre-computes embeddings for all Task nodes."""
        print("Generating embeddings for tasks (this may take a moment)...")
        texts = [t["text"] for t in self.task_nodes]
        
        # Batching could be better, but keeping it simple
        # In prod: use a vector DB like Chroma/FAISS
        embeddings = []
        for text in texts:
            embeddings.append(self.get_embedding(text))
            
        self.task_embeddings = np.array(embeddings)
        print("Indices built.")

    def retrieve(self, query: str, top_k: int = 3):
        """
        GraphRAG Retrieval Flow:
        1. Embed Query
        2. Vector Search -> Find Top Matching Task Nodes
        3. Traversal -> For each Task, get the Technique and Paper context
        4. (Optional) Sibling Search -> Find other Tasks using the same Technique
        """
        print(f"Retrieving for: {query}")
        query_vec = np.array(self.get_embedding(query)).reshape(1, -1)
        
        # 1. Vector Search
        sims = cosine_similarity(query_vec, self.task_embeddings)[0]
        top_indices = sims.argsort()[-top_k:][::-1]
        
        results = []
        for idx in top_indices:
            task_info = self.task_nodes[idx]
            task_id = task_info["id"]
            
            # 2. Graph Traversal (1-hop)
            # Find connected Technique
            neighbors = list(self.graph.neighbors(task_id))
            technique_node = next((n for n in neighbors if self.graph.nodes[n]["type"] == "Technique"), None)
            technique_name = self.graph.nodes[technique_node]["name"] if technique_node else "Unknown"
            
            # Find connected Paper
            paper_node = next((n for n in neighbors if self.graph.nodes[n]["type"] == "Paper"), None)
            paper_data = self.graph.nodes[paper_node] if paper_node else {}
            
            # 3. Graph Traversal (2-hop - "Sibling Discovery")
            # Find other tasks that use this SAME technique? (True GraphRAG benefit)
            related_tasks = []
            if technique_node:
                tech_neighbors = list(self.graph.neighbors(technique_node))
                # Get up to 2 other tasks using this technique
                for tn in tech_neighbors[:3]: 
                    if tn != task_id and self.graph.nodes[tn]["type"] == "Task":
                        related_tasks.append(self.graph.nodes[tn]["name"])
            
            results.append({
                "task": task_info["full_obj"]["task_name"],
                "description": task_info["full_obj"]["task_description"],
                "rationale": task_info["full_obj"]["rationale"],
                "technique": technique_name,
                "coming_from_paper": paper_data.get("title"),
                "related_applications": related_tasks # Evidence of reuse!
            })
            
        return results

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
