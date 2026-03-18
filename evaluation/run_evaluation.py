"""
VisArt Automated Evaluation Pipeline

Runs benchmark tasks against multiple system configurations,
computes 6 metrics (CCR, DQS, EMR, PE, AS, RSR), and saves results.

Usage:
    python evaluation/run_evaluation.py [--system visart_full] [--tasks all]
"""

import json
import os
import sys
import time
import re
import asyncio
import argparse
from typing import Dict, Any, List, Optional
from datetime import datetime
from dataclasses import dataclass, field, asdict

# Add parent dir so we can import backend modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

try:
    from constraint_engine import ConstraintEngine, DataProfile, TaskSpec
except ImportError:
    print("[WARN] constraint_engine not importable, running in metrics-only mode")
    ConstraintEngine = None


# ---------- Data Models ----------

@dataclass
class MetricResult:
    metric_id: str
    name: str
    value: float
    details: str = ""


@dataclass
class TaskResult:
    task_id: str
    system_id: str
    prompt: str
    generated_code: str = ""
    render_success: bool = False
    metrics: List[MetricResult] = field(default_factory=list)
    lint_report: Dict = field(default_factory=dict)
    constraint_report: Dict = field(default_factory=dict)
    elapsed_ms: int = 0
    error: str = ""
    timestamp: str = ""


@dataclass
class EvaluationRun:
    experiment_name: str
    system_id: str
    run_id: str
    timestamp: str
    task_results: List[TaskResult] = field(default_factory=list)
    aggregate_metrics: Dict[str, float] = field(default_factory=dict)


# ---------- Metric Calculators ----------

class MetricCalculator:
    """Computes 6 evaluation metrics from task results."""

    def __init__(self, knowledge_dir: str = None):
        self.engine = None
        if ConstraintEngine:
            try:
                self.engine = ConstraintEngine(knowledge_dir)
            except Exception as e:
                print(f"[WARN] ConstraintEngine init failed: {e}")

        # Load encoding effectiveness for PE metric
        self.encoding_ranks = {}
        eff_path = os.path.join(knowledge_dir or "knowledge", "encoding_effectiveness.json")
        if os.path.exists(eff_path):
            with open(eff_path, "r", encoding="utf-8") as f:
                self.encoding_ranks = json.load(f)

    def compute_ccr(self, viz_spec: Dict, data: List[Dict], prompt: str) -> MetricResult:
        """Constraint Compliance Rate: passed_hard / total_hard."""
        if not self.engine:
            return MetricResult("CCR", "Constraint Compliance Rate", -1.0, "Engine unavailable")

        profile = self.engine.analyze_data(data)
        task = self.engine.infer_task(prompt)
        report = self.engine.evaluate_constraints(viz_spec, profile, task)

        value = report.constraint_compliance_rate
        details = f"{report.passed_hard}/{report.total_hard} hard constraints passed"
        if report.hard_violations:
            violated = [v.constraint_id for v in report.hard_violations]
            details += f"; violations: {', '.join(violated)}"

        return MetricResult("CCR", "Constraint Compliance Rate", round(value, 3), details)

    def compute_dqs(self, viz_spec: Dict, data: List[Dict], prompt: str) -> MetricResult:
        """Design Quality Score: 0-100 from constraint penalties."""
        if not self.engine:
            return MetricResult("DQS", "Design Quality Score", -1.0, "Engine unavailable")

        profile = self.engine.analyze_data(data)
        task = self.engine.infer_task(prompt)
        report = self.engine.evaluate_constraints(viz_spec, profile, task)

        return MetricResult(
            "DQS", "Design Quality Score",
            round(report.design_quality_score, 1),
            f"Total penalty: {report.total_penalty:.1f}"
        )

    def compute_emr(self, generated_spec: Dict, expert_spec: Dict) -> MetricResult:
        """Encoding Match Rate: matched encodings / total expert encodings."""
        expert_encodings = expert_spec.get("encodings", {})
        gen_encodings = generated_spec.get("encodings", {})

        if not expert_encodings:
            return MetricResult("EMR", "Encoding Match Rate", 1.0, "No expert encodings to compare")

        matched = 0
        total = len(expert_encodings)
        details_parts = []

        for field_name, expected_channel in expert_encodings.items():
            actual = gen_encodings.get(field_name, "")
            if actual and (actual == expected_channel or expected_channel in str(actual)):
                matched += 1
                details_parts.append(f"✓ {field_name}→{expected_channel}")
            else:
                details_parts.append(f"✗ {field_name}: expected={expected_channel}, got={actual or 'missing'}")

        # Also check chart type match
        expert_chart = expert_spec.get("chart_type", "").lower().replace("_", "")
        gen_chart = generated_spec.get("chart_type", "").lower().replace("_", "")
        chart_match = expert_chart in gen_chart or gen_chart in expert_chart

        # Blend: 70% encoding match + 30% chart type match
        emr_raw = matched / total if total > 0 else 0
        value = emr_raw * 0.7 + (1.0 if chart_match else 0.0) * 0.3

        return MetricResult("EMR", "Encoding Match Rate", round(value, 3),
                          f"Chart: {'✓' if chart_match else '✗'}, Encodings: {matched}/{total}")

    def compute_pe(self, generated_spec: Dict, data: List[Dict]) -> MetricResult:
        """Perceptual Effectiveness: weighted encoding quality score."""
        if not self.engine:
            return MetricResult("PE", "Perceptual Effectiveness", -1.0, "Engine unavailable")

        profile = self.engine.analyze_data(data)
        task = self.engine.infer_task("")
        suggestions = self.engine.suggest_encoding(profile, task)

        if not suggestions:
            return MetricResult("PE", "Perceptual Effectiveness", 0.5, "No fields to evaluate")

        gen_encodings = generated_spec.get("encodings", {})
        total_score = 0
        max_score = 0

        for sug in suggestions:
            actual_channel = gen_encodings.get(sug.field_name, "")
            max_score += 1
            if actual_channel == sug.recommended_channel:
                total_score += 1.0  # Perfect match
            elif actual_channel in sug.alternative_channels:
                total_score += 0.6  # Acceptable alternative
            elif actual_channel:
                total_score += 0.2  # Some encoding exists

        value = total_score / max_score if max_score > 0 else 0
        return MetricResult("PE", "Perceptual Effectiveness", round(value, 3),
                          f"Score: {total_score:.1f}/{max_score}")

    def compute_as(self, viz_spec: Dict) -> MetricResult:
        """Accessibility Score: contrast + CVD safety."""
        score = 0.0
        checks = 0

        # Contrast check
        colors = viz_spec.get("colors_used", [])
        bg = viz_spec.get("background_color", "#FFFFFF")
        if colors and self.engine:
            good_contrast = sum(
                1 for c in colors if self.engine._contrast_ratio(c, bg) >= 3.0
            )
            contrast_ratio = good_contrast / len(colors) if colors else 1.0
            score += contrast_ratio
            checks += 1

        # CVD safety (check colormap)
        colormap = viz_spec.get("colormap", "").lower()
        cvd_safe_maps = ["viridis", "magma", "cividis", "inferno", "plasma"]
        banned_maps = ["jet", "rainbow", "hsv"]

        if colormap:
            if colormap in cvd_safe_maps:
                score += 1.0
            elif colormap in banned_maps:
                score += 0.0
            else:
                score += 0.5  # Unknown, partial credit
            checks += 1
        else:
            score += 0.7  # No colormap needed, mostly fine
            checks += 1

        value = score / checks if checks > 0 else 0.5
        return MetricResult("AS", "Accessibility Score", round(value, 3),
                          f"Contrast: {score:.1f}, Checks: {checks}")

    def compute_rsr(self, render_success: bool) -> MetricResult:
        """Rendering Success Rate (per-task, 0 or 1)."""
        return MetricResult(
            "RSR", "Rendering Success Rate",
            1.0 if render_success else 0.0,
            "Rendered successfully" if render_success else "Render failed"
        )

    def compute_all(
        self,
        generated_spec: Dict,
        expert_spec: Dict,
        data: List[Dict],
        prompt: str,
        render_success: bool
    ) -> List[MetricResult]:
        """Compute all 6 metrics."""
        return [
            self.compute_ccr(generated_spec, data, prompt),
            self.compute_dqs(generated_spec, data, prompt),
            self.compute_emr(generated_spec, expert_spec),
            self.compute_pe(generated_spec, data),
            self.compute_as(generated_spec),
            self.compute_rsr(render_success)
        ]


# ---------- Code Analyzer ----------

def extract_viz_spec_from_code(code: str) -> Dict[str, Any]:
    """
    Extract a best-effort visualization spec from D3 code via regex analysis.
    Used when no explicit viz_spec is provided.
    """
    spec: Dict[str, Any] = {}

    # Chart type detection
    if re.search(r'\.line\(\)|d3\.line', code):
        spec["chart_type"] = "line_chart"
        spec["mark_type"] = "line"
    elif re.search(r'\.arc\(\)|d3\.arc|d3\.pie', code):
        spec["chart_type"] = "pie_chart"
        spec["mark_type"] = "arc"
    elif re.search(r'<rect|\.attr\(["\']width|append\(["\']rect', code):
        spec["chart_type"] = "bar_chart"
        spec["mark_type"] = "bar"
    elif re.search(r'<circle|append\(["\']circle', code):
        spec["chart_type"] = "scatter_plot"
        spec["mark_type"] = "circle"
    elif re.search(r'd3\.treemap|d3\.hierarchy', code):
        spec["chart_type"] = "treemap"
        spec["mark_type"] = "rect"
    elif re.search(r'd3\.force|d3\.simulation|forceSimulation', code):
        spec["chart_type"] = "force_directed"
        spec["mark_type"] = "circle"
    else:
        spec["chart_type"] = "unknown"
        spec["mark_type"] = "unknown"

    # Interaction detection
    spec["has_tooltip"] = bool(re.search(r'tooltip|mouseover|mouseenter|title', code, re.I))
    spec["has_brush"] = bool(re.search(r'd3\.brush|brushX|brushY', code, re.I))
    spec["has_zoom"] = bool(re.search(r'd3\.zoom|zoomBehavior', code, re.I))
    spec["has_legend"] = bool(re.search(r'legend|Legend', code))
    spec["has_title"] = bool(re.search(r'\.text\(["\'].*["\']|<title', code))

    # Colormap detection
    colormap_match = re.search(r'interpolate(\w+)', code)
    if colormap_match:
        spec["colormap"] = colormap_match.group(1).lower()

    # Color extraction
    hex_colors = re.findall(r'#[0-9a-fA-F]{3,6}', code)
    spec["colors_used"] = list(set(hex_colors))[:12]

    # Renderer detection
    spec["renderer"] = "canvas" if "canvas" in code.lower() else "svg"

    # Encoding extraction (best effort)
    encodings = {}
    x_match = re.search(r'\.domain\(.*?d3\.extent\(data.*?["\'](\w+)["\']', code)
    if x_match:
        encodings["x"] = x_match.group(1)
    y_match = re.search(r'scaleLinear|scaleLog.*?\.domain\(.*?["\'](\w+)["\']', code)
    if y_match:
        encodings["y"] = y_match.group(1)
    spec["encodings"] = encodings

    return spec


# ---------- Main Evaluation Pipeline ----------

def run_single_task(
    task: Dict,
    system_config: Dict,
    calculator: MetricCalculator
) -> TaskResult:
    """Run a single benchmark task with a given system configuration."""
    start_time = time.time()
    result = TaskResult(
        task_id=task["id"],
        system_id=system_config.get("name", "unknown"),
        prompt=task["prompt"],
        timestamp=datetime.now().isoformat()
    )

    try:
        # In a real evaluation, this would call the actual LLM generation pipeline.
        # For now, we provide the evaluation framework structure.
        # The generated code would come from:
        #   - Baseline-A: Direct LLM call
        #   - Baseline-B: LLM + RAG context
        #   - VisArt-Full: LLM + Constraint context + Design Lint
        
        # Placeholder: In actual use, replace with real generation
        result.generated_code = f"// Placeholder for {task['id']} with {result.system_id}"
        result.render_success = True  # Would be determined by actual rendering

        # Extract viz spec from generated code (or use provided spec)
        viz_spec = extract_viz_spec_from_code(result.generated_code)

        # Compute all metrics
        result.metrics = calculator.compute_all(
            generated_spec=viz_spec,
            expert_spec=task.get("expert_spec", {}),
            data=task.get("data", []),
            prompt=task["prompt"],
            render_success=result.render_success
        )

    except Exception as e:
        result.error = str(e)
        result.render_success = False
        result.metrics = [
            MetricResult("RSR", "Rendering Success Rate", 0.0, f"Error: {str(e)}")
        ]

    result.elapsed_ms = int((time.time() - start_time) * 1000)
    return result


def aggregate_metrics(results: List[TaskResult]) -> Dict[str, float]:
    """Compute aggregate metrics across all tasks."""
    metric_sums: Dict[str, List[float]] = {}

    for result in results:
        for m in result.metrics:
            if m.value >= 0:  # Skip unavailable metrics (-1)
                if m.metric_id not in metric_sums:
                    metric_sums[m.metric_id] = []
                metric_sums[m.metric_id].append(m.value)

    aggregated = {}
    for metric_id, values in metric_sums.items():
        aggregated[f"{metric_id}_mean"] = round(sum(values) / len(values), 3) if values else 0
        aggregated[f"{metric_id}_min"] = round(min(values), 3) if values else 0
        aggregated[f"{metric_id}_max"] = round(max(values), 3) if values else 0

    return aggregated


def run_evaluation(
    benchmark_path: str = None,
    config_path: str = None,
    system_id: str = "visart_full",
    output_dir: str = None
):
    """Run full evaluation pipeline."""
    # Resolve paths
    eval_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(eval_dir)

    benchmark_path = benchmark_path or os.path.join(eval_dir, "benchmark", "visart_bench.json")
    config_path = config_path or os.path.join(eval_dir, "configs", "experiment_config.json")
    output_dir = output_dir or os.path.join(eval_dir, "results")
    knowledge_dir = os.path.join(project_dir, "knowledge")

    os.makedirs(output_dir, exist_ok=True)

    # Load benchmark
    print(f"\n{'='*60}")
    print(f"  VisArt-Bench Evaluation Pipeline")
    print(f"{'='*60}")

    with open(benchmark_path, "r", encoding="utf-8") as f:
        tasks = json.load(f)
    print(f"Loaded {len(tasks)} benchmark tasks")

    # Load config
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
    
    system_config = config["systems"].get(system_id, {})
    if not system_config:
        print(f"ERROR: System '{system_id}' not found in config")
        return

    print(f"System: {system_config['name']}")
    print(f"Config: {json.dumps(system_config['config'], indent=2)}")

    # Initialize metric calculator
    calculator = MetricCalculator(knowledge_dir)

    # Run tasks
    run_id = f"{system_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    results: List[TaskResult] = []

    for i, task in enumerate(tasks):
        print(f"\n[{i+1}/{len(tasks)}] Running task {task['id']}: {task['prompt'][:50]}...")
        result = run_single_task(task, system_config, calculator)
        results.append(result)

        # Print per-task metrics
        for m in result.metrics:
            status = "✓" if m.value >= 0.7 or (m.metric_id == "DQS" and m.value >= 70) else "✗"
            print(f"  {status} {m.metric_id}: {m.value} — {m.details}")

    # Aggregate
    agg = aggregate_metrics(results)

    run = EvaluationRun(
        experiment_name=config.get("experiment_name", ""),
        system_id=system_id,
        run_id=run_id,
        timestamp=datetime.now().isoformat(),
        task_results=results,
        aggregate_metrics=agg
    )

    # Save results
    output_path = os.path.join(output_dir, f"{run_id}.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(asdict(run), f, indent=2, ensure_ascii=False, default=str)

    # Print summary
    print(f"\n{'='*60}")
    print(f"  Evaluation Summary: {system_config['name']}")
    print(f"{'='*60}")
    for key, value in sorted(agg.items()):
        if "_mean" in key:
            metric_name = key.replace("_mean", "")
            print(f"  {metric_name:6s}  mean={value:.3f}  "
                  f"min={agg.get(f'{metric_name}_min', 0):.3f}  "
                  f"max={agg.get(f'{metric_name}_max', 0):.3f}")
    print(f"\nResults saved to: {output_path}")

    return run


# ---------- CLI ----------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VisArt-Bench Evaluation")
    parser.add_argument("--system", default="visart_full",
                       choices=["baseline_a", "baseline_b", "baseline_c", "visart_full"],
                       help="System to evaluate")
    parser.add_argument("--benchmark", default=None, help="Path to benchmark JSON")
    parser.add_argument("--config", default=None, help="Path to experiment config")
    parser.add_argument("--output", default=None, help="Output directory for results")
    args = parser.parse_args()

    run_evaluation(
        benchmark_path=args.benchmark,
        config_path=args.config,
        system_id=args.system,
        output_dir=args.output
    )
