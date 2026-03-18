"""
VisArt Evaluation Results Analyzer

Loads evaluation results, performs statistical analysis,
generates comparison tables and visualizations for paper.

Usage:
    python evaluation/analyze_results.py
"""

import json
import os
import glob
from typing import Dict, List, Any
from collections import defaultdict


# ---------- Data Loading ----------

def load_all_results(results_dir: str = None) -> Dict[str, Dict]:
    """Load all result files from results directory, grouped by system_id."""
    results_dir = results_dir or os.path.join(os.path.dirname(__file__), "results")
    
    if not os.path.exists(results_dir):
        print(f"Results directory not found: {results_dir}")
        return {}

    grouped: Dict[str, List[Dict]] = defaultdict(list)
    for path in sorted(glob.glob(os.path.join(results_dir, "*.json"))):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        system_id = data.get("system_id", "unknown")
        grouped[system_id].append(data)

    print(f"Loaded results for {len(grouped)} system(s): {', '.join(grouped.keys())}")
    return dict(grouped)


# ---------- Comparison Table ----------

def generate_comparison_table(grouped_results: Dict[str, List[Dict]]) -> str:
    """Generate markdown comparison table of metric means across systems."""
    metrics = ["CCR", "DQS", "EMR", "PE", "AS", "RSR"]
    
    # Header
    header = "| System | " + " | ".join(metrics) + " |"
    separator = "|--------|" + "|".join(["------:" for _ in metrics]) + "|"
    
    rows = []
    for system_id, runs in sorted(grouped_results.items()):
        # Average across runs
        avg_metrics = {}
        for m in metrics:
            key = f"{m}_mean"
            values = [run.get("aggregate_metrics", {}).get(key, 0) for run in runs]
            avg_metrics[m] = sum(values) / len(values) if values else 0
        
        row = f"| {system_id:15s} | " + " | ".join(
            f"{avg_metrics[m]:.3f}" for m in metrics
        ) + " |"
        rows.append(row)

    table = "\n".join([header, separator] + rows)
    print("\n" + table)
    return table


def generate_latex_table(grouped_results: Dict[str, List[Dict]]) -> str:
    """Generate LaTeX table for paper inclusion."""
    metrics = ["CCR", "DQS", "EMR", "PE", "AS", "RSR"]
    
    system_labels = {
        "baseline_a": "Baseline-A (Raw LLM)",
        "baseline_b": "Baseline-B (LLM+RAG)",
        "baseline_c": "Baseline-C (LLM+Draco)",
        "visart_full": "\\textbf{VisArt-Full}"
    }
    
    lines = [
        "\\begin{table}[t]",
        "\\centering",
        "\\caption{Comparison of visualization quality metrics across systems. "
        "Higher is better for all metrics. Best results in \\textbf{bold}.}",
        "\\label{tab:comparison}",
        f"\\begin{{tabular}}{{l{'c' * len(metrics)}}}",
        "\\toprule",
        "System & " + " & ".join(metrics) + " \\\\",
        "\\midrule"
    ]
    
    # Compute values
    all_values: Dict[str, Dict[str, float]] = {}
    for system_id, runs in grouped_results.items():
        avg = {}
        for m in metrics:
            key = f"{m}_mean"
            values = [run.get("aggregate_metrics", {}).get(key, 0) for run in runs]
            avg[m] = sum(values) / len(values) if values else 0
        all_values[system_id] = avg
    
    # Find best per metric
    best = {}
    for m in metrics:
        vals = {sid: v[m] for sid, v in all_values.items() if v[m] > 0}
        best[m] = max(vals.values()) if vals else 0
    
    # Generate rows
    for system_id in ["baseline_a", "baseline_b", "baseline_c", "visart_full"]:
        if system_id not in all_values:
            continue
        label = system_labels.get(system_id, system_id)
        vals = all_values[system_id]
        cells = []
        for m in metrics:
            v = vals[m]
            if m == "DQS":
                cell = f"{v:.1f}"
            else:
                cell = f"{v:.3f}"
            if abs(v - best[m]) < 0.001 and v > 0:
                cell = f"\\textbf{{{cell}}}"
            cells.append(cell)
        lines.append(f"{label} & {' & '.join(cells)} \\\\")
    
    lines.extend([
        "\\bottomrule",
        "\\end{tabular}",
        "\\end{table}"
    ])
    
    latex = "\n".join(lines)
    print(f"\n{latex}")
    return latex


# ---------- Ablation Analysis ----------

def generate_ablation_table(grouped_results: Dict[str, List[Dict]]) -> str:
    """Generate ablation study table."""
    ablation_configs = {
        "full": "Full System",
        "no_lint": "-Design Lint",
        "no_constraint": "-Constraint Engine",
        "no_autofix": "-Auto Repair",
        "base": "RAG Only"
    }
    
    metrics = ["CCR", "DQS", "EMR"]
    header = "| Configuration | " + " | ".join(metrics) + " | Δ DQS |"
    separator = "|" + "|".join(["------:" for _ in range(len(metrics) + 2)]) + "|"
    
    rows = []
    full_dqs = 0
    
    for config_id, label in ablation_configs.items():
        runs = grouped_results.get(config_id, [])
        if not runs:
            rows.append(f"| {label:20s} | " + " | ".join(["—" for _ in metrics]) + " | — |")
            continue
        
        avg = {}
        for m in metrics:
            key = f"{m}_mean"
            values = [run.get("aggregate_metrics", {}).get(key, 0) for run in runs]
            avg[m] = sum(values) / len(values) if values else 0
        
        if config_id == "full":
            full_dqs = avg.get("DQS", 0)
        
        delta = avg.get("DQS", 0) - full_dqs
        delta_str = f"{delta:+.1f}" if config_id != "full" else "—"
        
        row = f"| {label:20s} | " + " | ".join(
            f"{avg[m]:.3f}" for m in metrics
        ) + f" | {delta_str} |"
        rows.append(row)

    table = "\n".join([header, separator] + rows)
    print(f"\n{table}")
    return table


# ---------- Per-Category Breakdown ----------

def category_breakdown(grouped_results: Dict[str, List[Dict]]) -> str:
    """Break down metrics by task category for detailed analysis."""
    system_id = "visart_full"
    runs = grouped_results.get(system_id, [])
    
    if not runs:
        return "No results for visart_full"

    category_metrics: Dict[str, Dict[str, List[float]]] = defaultdict(lambda: defaultdict(list))
    
    for run in runs:
        for task_result in run.get("task_results", []):
            task_id = task_result.get("task_id", "")
            category = task_id.split("-")[0]  # e.g., "TREND" from "TREND-001"
            for m in task_result.get("metrics", []):
                if isinstance(m, dict) and m.get("value", -1) >= 0:
                    category_metrics[category][m["metric_id"]].append(m["value"])

    metrics = ["CCR", "DQS", "EMR", "PE"]
    header = "| Category | N | " + " | ".join(metrics) + " |"
    separator = "|----------|---|" + "|".join(["------:" for _ in metrics]) + "|"
    
    rows = []
    for category in sorted(category_metrics.keys()):
        cat_data = category_metrics[category]
        n = len(cat_data.get("CCR", []))
        vals = []
        for m in metrics:
            v = cat_data.get(m, [])
            vals.append(f"{sum(v)/len(v):.3f}" if v else "—")
        rows.append(f"| {category:8s} | {n} | " + " | ".join(vals) + " |")

    table = "\n".join([header, separator] + rows)
    print(f"\n{table}")
    return table


# ---------- User Study Template ----------

def generate_user_study_form() -> Dict[str, Any]:
    """Generate the user study questionnaire template."""
    return {
        "title": "VisArt User Study — Visualization Quality Assessment",
        "participant_info": {
            "id": "",
            "expertise": "expert|intermediate|novice",
            "vis_experience_years": 0,
            "age_range": ""
        },
        "instructions": (
            "For each pair of visualizations, rate each one on the scales below "
            "and indicate your preference. Take your time to examine each visualization carefully."
        ),
        "tasks": [
            {
                "task_id": "TASK_ID",
                "prompt": "PROMPT",
                "vis_a": {"system": "SYSTEM_A", "image": "path_to_image_a"},
                "vis_b": {"system": "SYSTEM_B", "image": "path_to_image_b"},
                "ratings": {
                    "design_quality": {"vis_a": 0, "vis_b": 0, "scale": "1-7 Likert"},
                    "task_effectiveness": {"vis_a": 0, "vis_b": 0, "scale": "1-7 Likert"},
                    "aesthetics": {"vis_a": 0, "vis_b": 0, "scale": "1-7 Likert"},
                    "readability": {"vis_a": 0, "vis_b": 0, "scale": "1-7 Likert"}
                },
                "preference": "A|B|No preference",
                "comments": ""
            }
        ],
        "analysis_method": "Wilcoxon Signed-Rank Test (paired, non-parametric)"
    }


# ---------- Main ----------

if __name__ == "__main__":
    results = load_all_results()
    
    if not results:
        print("\nNo evaluation results found. Run evaluation first:")
        print("  python evaluation/run_evaluation.py --system baseline_a")
        print("  python evaluation/run_evaluation.py --system visart_full")
        
        # Generate empty templates
        print("\n--- User Study Template ---")
        form = generate_user_study_form()
        form_path = os.path.join(os.path.dirname(__file__), "configs", "user_study_template.json")
        with open(form_path, "w", encoding="utf-8") as f:
            json.dump(form, f, indent=2, ensure_ascii=False)
        print(f"User study template saved to: {form_path}")
    else:
        print("\n=== System Comparison ===")
        generate_comparison_table(results)
        
        print("\n=== LaTeX Table ===")
        generate_latex_table(results)
        
        print("\n=== Ablation Study ===")
        generate_ablation_table(results)
        
        print("\n=== Category Breakdown ===")
        category_breakdown(results)
