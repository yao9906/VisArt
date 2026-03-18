"""
VisArt Constraint Engine — Formalized Visualization Design Reasoning

This module implements a four-layer constraint reasoning engine that:
1. Profiles data characteristics (Layer 1)
2. Infers visualization tasks from user prompts (Layer 2)
3. Evaluates constraint compliance of generated visualizations (Layer 3-4)
4. Suggests optimal encoding strategies based on academic effectiveness rankings

References:
- Munzner (2014) Nested Model
- Cleveland & McGill (1984) Perceptual Ranking
- Mackinlay (1986) Expressiveness & Effectiveness
- Brehmer & Munzner (2013) Task Typology
- Draco 2 (CMU DIG) Constraint Framework
"""

import json
import os
import re
import math
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field, asdict
from datetime import datetime


# ---------- Data Models ----------

@dataclass
class FieldProfile:
    """Profile of a single data field."""
    name: str
    field_type: str  # "quantitative", "nominal", "ordinal", "temporal"
    cardinality: int = 0
    cardinality_level: str = "low"  # "low" (<10), "mid" (10-50), "high" (>50)
    min_val: Any = None
    max_val: Any = None
    has_nulls: bool = False
    sample_values: list = field(default_factory=list)


@dataclass
class DataProfile:
    """Complete profile of the input dataset."""
    row_count: int = 0
    field_count: int = 0
    fields: List[FieldProfile] = field(default_factory=list)
    density_level: str = "sparse"     # "sparse" (<1K), "medium" (1K-10K), "high" (10K-100K), "extreme" (>100K)
    data_structure: str = "flat"      # "flat", "hierarchical", "network", "temporal", "spatial"
    has_temporal: bool = False
    has_geo: bool = False
    quantitative_fields: List[str] = field(default_factory=list)
    nominal_fields: List[str] = field(default_factory=list)
    ordinal_fields: List[str] = field(default_factory=list)
    temporal_fields: List[str] = field(default_factory=list)


@dataclass
class TaskSpec:
    """Inferred visualization task specification (Brehmer-Munzner)."""
    why: str = "discover"    # consume.discover / consume.present / consume.enjoy
    search: str = "explore"  # lookup / browse / locate / explore
    query: str = "summarize" # identify / compare / summarize
    raw_intent: str = ""     # original user prompt


@dataclass
class ConstraintViolation:
    """A single constraint violation."""
    constraint_id: str
    constraint_name: str
    constraint_type: str  # "hard" or "soft"
    layer: str
    description: str
    rationale: str
    source: str
    weight: int = 0  # for soft constraints
    penalty: float = 0.0


@dataclass
class ConstraintReport:
    """Full constraint evaluation report."""
    hard_violations: List[ConstraintViolation] = field(default_factory=list)
    soft_violations: List[ConstraintViolation] = field(default_factory=list)
    total_penalty: float = 0.0
    design_quality_score: float = 100.0
    passed_hard: int = 0
    total_hard: int = 0
    constraint_compliance_rate: float = 1.0
    suggestions: List[str] = field(default_factory=list)


@dataclass
class EncodingSuggestion:
    """A suggested visual encoding strategy."""
    field_name: str
    field_type: str
    recommended_channel: str
    rank: int
    alternative_channels: List[str] = field(default_factory=list)
    rationale: str = ""


# ---------- Constraint Engine ----------

class ConstraintEngine:
    """
    Formalized constraint reasoning engine for visualization design.
    
    Replaces simple keyword-matching with structured reasoning using
    the four-layer constraint ontology.
    """

    def __init__(self, knowledge_dir: str = None):
        """Initialize engine with knowledge base files."""
        if knowledge_dir is None:
            # Try to resolve knowledge directory
            for candidate in ["knowledge", "../knowledge", os.path.join(os.path.dirname(__file__), "..", "knowledge")]:
                if os.path.isdir(candidate):
                    knowledge_dir = candidate
                    break
        
        self.knowledge_dir = knowledge_dir or "knowledge"
        self.hard_constraints = self._load_json("constraints/hard_constraints.json") or []
        self.soft_constraints = self._load_json("constraints/soft_constraints.json") or []
        self.encoding_effectiveness = self._load_json("encoding_effectiveness.json") or {}
        self.task_taxonomy = self._load_json("task_taxonomy.json") or {}
        self.density_strategies = self._load_json("interaction/density_strategies.json") or []
        self.palettes = self._load_json("color/palettes.json") or {}
        
        print(f"[ConstraintEngine] Loaded {len(self.hard_constraints)} hard + {len(self.soft_constraints)} soft constraints from {self.knowledge_dir}")

    def _load_json(self, relative_path: str) -> Any:
        """Load a JSON file from the knowledge directory."""
        full_path = os.path.join(self.knowledge_dir, relative_path)
        if not os.path.exists(full_path):
            print(f"[ConstraintEngine] Warning: {full_path} not found")
            return None
        try:
            with open(full_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[ConstraintEngine] Error loading {full_path}: {e}")
            return None

    # ---- Layer 1: Data Profiling ----

    def analyze_data(self, data: List[Dict[str, Any]]) -> DataProfile:
        """
        Analyze dataset characteristics to build a DataProfile.
        Determines field types, cardinality, density level, and data structure.
        """
        if not data:
            return DataProfile()

        profile = DataProfile(row_count=len(data), field_count=len(data[0]) if data else 0)

        # Density classification
        n = profile.row_count
        if n < 1000:
            profile.density_level = "sparse"
        elif n < 10000:
            profile.density_level = "medium"
        elif n < 100000:
            profile.density_level = "high"
        else:
            profile.density_level = "extreme"

        # Analyze each field
        if data:
            keys = list(data[0].keys())
            for key in keys:
                values = [row.get(key) for row in data if row.get(key) is not None]
                fp = self._profile_field(key, values)
                profile.fields.append(fp)

                if fp.field_type == "quantitative":
                    profile.quantitative_fields.append(key)
                elif fp.field_type == "nominal":
                    profile.nominal_fields.append(key)
                elif fp.field_type == "ordinal":
                    profile.ordinal_fields.append(key)
                elif fp.field_type == "temporal":
                    profile.temporal_fields.append(key)
                    profile.has_temporal = True

        # Detect data structure
        profile.data_structure = self._detect_structure(data, profile)

        # Detect geo fields
        field_names_lower = [f.name.lower() for f in profile.fields]
        geo_signals = {"lat", "latitude", "lng", "longitude", "lon", "geo", "location", "coordinates"}
        profile.has_geo = bool(geo_signals & set(field_names_lower))

        return profile

    def _profile_field(self, name: str, values: list) -> FieldProfile:
        """Profile a single field to determine its type and statistics."""
        if not values:
            return FieldProfile(name=name, field_type="nominal")

        # Sample for analysis
        sample = values[:500] if len(values) > 500 else values
        unique_count = len(set(str(v) for v in sample))

        # Temporal detection
        temporal_patterns = [
            r"\d{4}-\d{2}-\d{2}",  # ISO date
            r"\d{1,2}/\d{1,2}/\d{2,4}",  # US date
            r"\d{4}",  # Year only
        ]
        temporal_keywords = {"date", "time", "year", "month", "day", "timestamp", "created", "updated"}
        
        is_temporal = name.lower() in temporal_keywords or any(
            name.lower().endswith(kw) for kw in ["_date", "_time", "_at"]
        )
        if not is_temporal and sample:
            str_vals = [str(v) for v in sample[:20]]
            match_count = sum(1 for v in str_vals if any(re.match(p, v) for p in temporal_patterns))
            is_temporal = match_count > len(str_vals) * 0.5

        if is_temporal:
            fp = FieldProfile(name=name, field_type="temporal", cardinality=unique_count)
        # Numeric detection
        elif all(isinstance(v, (int, float)) for v in sample):
            numeric_vals = [float(v) for v in sample]
            fp = FieldProfile(
                name=name, field_type="quantitative",
                cardinality=unique_count,
                min_val=min(numeric_vals),
                max_val=max(numeric_vals),
                sample_values=sample[:5]
            )
        elif self._try_numeric(sample):
            numeric_vals = [float(v) for v in sample if self._is_numeric(v)]
            fp = FieldProfile(
                name=name, field_type="quantitative",
                cardinality=unique_count,
                min_val=min(numeric_vals) if numeric_vals else None,
                max_val=max(numeric_vals) if numeric_vals else None,
                sample_values=sample[:5]
            )
        else:
            # String/categorical
            fp = FieldProfile(
                name=name,
                field_type="nominal",
                cardinality=unique_count,
                sample_values=sample[:5]
            )

        # Cardinality classification
        if fp.cardinality < 10:
            fp.cardinality_level = "low"
        elif fp.cardinality < 50:
            fp.cardinality_level = "mid"
        else:
            fp.cardinality_level = "high"

        # Check for nulls
        fp.has_nulls = len(values) < len(values)  # simplified

        return fp

    def _try_numeric(self, values: list) -> bool:
        """Check if >70% of values are numeric."""
        numeric_count = sum(1 for v in values if self._is_numeric(v))
        return numeric_count > len(values) * 0.7

    def _is_numeric(self, v) -> bool:
        try:
            float(v)
            return True
        except (ValueError, TypeError):
            return False

    def _detect_structure(self, data: List[Dict], profile: DataProfile) -> str:
        """Detect whether data is flat, hierarchical, network, temporal, or spatial."""
        if profile.has_temporal:
            return "temporal"
        
        field_names = {f.name.lower() for f in profile.fields}
        
        # Network detection
        network_signals = {"source", "target", "from", "to", "edge", "node", "link"}
        if len(network_signals & field_names) >= 2:
            return "network"
        
        # Hierarchical detection
        hierarchy_signals = {"parent", "children", "level", "depth", "path"}
        if len(hierarchy_signals & field_names) >= 2:
            return "hierarchical"
        
        # Spatial detection
        geo_signals = {"lat", "latitude", "lng", "longitude", "lon", "geo", "x", "y"}
        if len(geo_signals & field_names) >= 2:
            return "spatial"
        
        return "flat"

    # ---- Layer 2: Task Inference ----

    def infer_task(self, user_prompt: str) -> TaskSpec:
        """
        Infer visualization task from natural language prompt.
        Maps to Brehmer-Munzner task typology using keyword analysis.
        (In production, this would use the LLM for more nuanced inference.)
        """
        prompt_lower = user_prompt.lower()
        task = TaskSpec(raw_intent=user_prompt)

        # Why: discover vs present vs enjoy
        present_signals = ["show", "present", "display", "report", "dashboard", "communicate"]
        discover_signals = ["explore", "find", "analyze", "investigate", "discover", "pattern", "insight", "anomaly", "cluster"]
        if any(s in prompt_lower for s in discover_signals):
            task.why = "discover"
        elif any(s in prompt_lower for s in present_signals):
            task.why = "present"
        else:
            task.why = "discover"  # default

        # Search type
        lookup_signals = ["what is", "get the value", "look up", "specific", "exactly"]
        browse_signals = ["find all", "filter", "which", "list", "search for"]
        locate_signals = ["where", "when", "locate", "region", "area", "time period"]
        explore_signals = ["explore", "overview", "pattern", "distribution", "relationship", "correlat"]
        
        if any(s in prompt_lower for s in explore_signals):
            task.search = "explore"
        elif any(s in prompt_lower for s in locate_signals):
            task.search = "locate"
        elif any(s in prompt_lower for s in browse_signals):
            task.search = "browse"
        elif any(s in prompt_lower for s in lookup_signals):
            task.search = "lookup"
        else:
            task.search = "explore"

        # Query type
        compare_signals = ["compare", "versus", "vs", "differ", "between", "across", "contrast"]
        summarize_signals = ["distribution", "overall", "total", "average", "summary", "aggregate", "trend", "overview"]
        identify_signals = ["identify", "outlier", "anomaly", "specific", "highlight", "detail"]
        
        if any(s in prompt_lower for s in compare_signals):
            task.query = "compare"
        elif any(s in prompt_lower for s in summarize_signals):
            task.query = "summarize"
        elif any(s in prompt_lower for s in identify_signals):
            task.query = "identify"
        else:
            task.query = "summarize"

        return task

    # ---- Layer 3-4: Constraint Evaluation ----

    def evaluate_constraints(
        self,
        viz_spec: Dict[str, Any],
        data_profile: DataProfile,
        task: TaskSpec
    ) -> ConstraintReport:
        """
        Evaluate a visualization specification against all hard and soft constraints.
        
        viz_spec should contain:
        - chart_type: str
        - encodings: dict (field_name -> channel)
        - colors_used: list of hex colors
        - has_legend: bool
        - has_title: bool
        - has_tooltip: bool
        - has_brush: bool
        - has_zoom: bool
        - mark_type: str
        - colormap: str (if applicable)
        """
        report = ConstraintReport()

        # Evaluate hard constraints
        for hc in self.hard_constraints:
            violated, description = self._check_hard_constraint(hc, viz_spec, data_profile, task)
            report.total_hard += 1
            if violated:
                report.hard_violations.append(ConstraintViolation(
                    constraint_id=hc["id"],
                    constraint_name=hc["name"],
                    constraint_type="hard",
                    layer=hc.get("layer", "unknown"),
                    description=description,
                    rationale=hc.get("rationale", ""),
                    source=hc.get("source", ""),
                    penalty=20.0
                ))
            else:
                report.passed_hard += 1

        # Evaluate soft constraints
        for sc in self.soft_constraints:
            violated, description = self._check_soft_constraint(sc, viz_spec, data_profile, task)
            if violated:
                weight = sc.get("weight", 1)
                penalty = weight * 2.0
                report.soft_violations.append(ConstraintViolation(
                    constraint_id=sc["id"],
                    constraint_name=sc["name"],
                    constraint_type="soft",
                    layer=sc.get("layer", "unknown"),
                    description=description,
                    rationale=sc.get("rationale", ""),
                    source=sc.get("source", ""),
                    weight=weight,
                    penalty=penalty
                ))

        # Calculate scores
        hard_penalty = sum(v.penalty for v in report.hard_violations)
        soft_penalty = sum(v.penalty for v in report.soft_violations)
        report.total_penalty = hard_penalty + soft_penalty
        report.design_quality_score = max(0, 100 - report.total_penalty)
        report.constraint_compliance_rate = (
            report.passed_hard / report.total_hard if report.total_hard > 0 else 1.0
        )

        # Generate suggestions
        report.suggestions = self._generate_suggestions(report, data_profile, task)

        return report

    def _check_hard_constraint(
        self, hc: Dict, viz_spec: Dict, profile: DataProfile, task: TaskSpec
    ) -> Tuple[bool, str]:
        """Check a single hard constraint. Returns (violated, description)."""
        cid = hc.get("id", "")
        
        # HC-ENC-001: Nominal data must not use ordered channels
        if cid == "HC-ENC-001":
            encodings = viz_spec.get("encodings", {})
            for field_name, channel in encodings.items():
                fp = self._find_field(field_name, profile)
                if fp and fp.field_type == "nominal" and channel in ["color_luminance", "size", "length"]:
                    return True, f"Nominal field '{field_name}' mapped to ordered channel '{channel}'"
            return False, ""

        # HC-ENC-002: Quantitative data must not use shape
        if cid == "HC-ENC-002":
            encodings = viz_spec.get("encodings", {})
            for field_name, channel in encodings.items():
                fp = self._find_field(field_name, profile)
                if fp and fp.field_type == "quantitative" and channel == "shape":
                    return True, f"Quantitative field '{field_name}' mapped to shape channel"
            return False, ""

        # HC-ENC-003: Nominal x-axis must not use line marks
        if cid == "HC-ENC-003":
            mark = viz_spec.get("mark_type", "")
            x_field = viz_spec.get("encodings", {}).get("x", "")
            if x_field:
                fp = self._find_field(x_field, profile) if isinstance(x_field, str) else None
                if fp and fp.field_type == "nominal" and mark == "line":
                    return True, f"Line mark used with nominal x-axis field '{x_field}'"
            return False, ""

        # HC-ENC-004: Static 2D must not use 3D
        if cid == "HC-ENC-004":
            chart_type = viz_spec.get("chart_type", "").lower()
            if "3d" in chart_type:
                return True, "3D visualization detected in static 2D output"
            return False, ""

        # HC-COLOR-001: Contrast ratio >= 3:1
        if cid == "HC-COLOR-001":
            colors = viz_spec.get("colors_used", [])
            bg = viz_spec.get("background_color", "#FFFFFF")
            for color in colors:
                ratio = self._contrast_ratio(color, bg)
                if ratio < 3.0:
                    return True, f"Color {color} has contrast ratio {ratio:.1f}:1 against {bg} (min 3:1)"
            return False, ""

        # HC-COLOR-002: Rainbow/Jet ban for continuous
        if cid == "HC-COLOR-002":
            colormap = viz_spec.get("colormap", "").lower()
            if colormap in ["jet", "rainbow", "hsv", "spectral"]:
                return True, f"Banned colormap '{colormap}' used for quantitative data"
            return False, ""

        # HC-COLOR-003: Red-green distinction ban
        if cid == "HC-COLOR-003":
            colors = viz_spec.get("colors_used", [])
            colors_lower = [c.lower() for c in colors]
            has_pure_red = any(c in ["#ff0000", "#f00", "red"] for c in colors_lower)
            has_pure_green = any(c in ["#00ff00", "#0f0", "#008000", "green"] for c in colors_lower)
            if has_pure_red and has_pure_green:
                return True, "Pure red and green used together for distinction"
            return False, ""

        # HC-COLOR-005: Max 12 categories with hue
        if cid == "HC-COLOR-005":
            colors = viz_spec.get("colors_used", [])
            if len(set(colors)) > 12:
                return True, f"Using {len(set(colors))} distinct colors (max 12)"
            return False, ""

        # HC-COLOR-006: Diverging scale requires midpoint
        if cid == "HC-COLOR-006":
            colormap = viz_spec.get("colormap", "").lower()
            diverging_maps = ["rdbu", "rdgy", "rdylgn", "brbg", "prgn", "piyg", "diverging"]
            if any(dm in colormap for dm in diverging_maps):
                # Check if data has a natural midpoint
                has_midpoint = viz_spec.get("has_meaningful_midpoint", False)
                if not has_midpoint:
                    return True, f"Diverging colormap '{colormap}' used without meaningful data midpoint"
            return False, ""

        # HC-MARK-001: Minimum mark size
        if cid == "HC-MARK-001":
            min_mark = viz_spec.get("min_mark_size_px", 3)
            if min_mark < 2.5:
                return True, f"Mark size {min_mark}px is below minimum 2.5px"
            return False, ""

        # HC-DATA-001: Dynamic domain
        if cid == "HC-DATA-001":
            if viz_spec.get("hardcoded_domain", False):
                return True, "Scale domain is hardcoded instead of computed from data"
            return False, ""

        # For unmatched constraints, skip
        return False, ""

    def _check_soft_constraint(
        self, sc: Dict, viz_spec: Dict, profile: DataProfile, task: TaskSpec
    ) -> Tuple[bool, str]:
        """Check a single soft constraint. Returns (violated, description)."""
        cid = sc.get("id", "")

        # SC-EFF-002: Temporal data should use line marks
        if cid == "SC-EFF-002":
            mark = viz_spec.get("mark_type", "")
            if profile.has_temporal and mark not in ["line", "area"]:
                return True, f"Temporal data displayed with '{mark}' mark instead of line/area"
            return False, ""

        # SC-INTER-001: Density > 1K should use Canvas
        if cid == "SC-INTER-001":
            if profile.density_level in ["medium", "high", "extreme"]:
                renderer = viz_spec.get("renderer", "svg").lower()
                if renderer == "svg":
                    return True, f"N={profile.row_count} but still using SVG (recommend Canvas)"
            return False, ""

        # SC-INTER-002: Density > 10K should use aggregation
        if cid == "SC-INTER-002":
            if profile.density_level in ["high", "extreme"]:
                has_aggregation = viz_spec.get("has_aggregation", False)
                if not has_aggregation:
                    return True, f"N={profile.row_count} without aggregation strategy"
            return False, ""

        # SC-INTER-004: Explore task requires brush/filter
        if cid == "SC-INTER-004":
            if task.search == "explore":
                has_brush = viz_spec.get("has_brush", False)
                has_filter = viz_spec.get("has_filter", False)
                has_tooltip = viz_spec.get("has_tooltip", False)
                if not (has_brush or has_filter) and not has_tooltip:
                    return True, "Explore task without any interactive filtering or tooltips"
            return False, ""

        # SC-DESIGN-001: Title and legend
        if cid == "SC-DESIGN-001":
            has_title = viz_spec.get("has_title", False)
            has_legend = viz_spec.get("has_legend", False)
            if not has_title and not has_legend:
                return True, "Visualization has neither title nor legend"
            return False, ""

        # SC-DESIGN-005: Complex charts require interaction
        if cid == "SC-DESIGN-005":
            chart_type = viz_spec.get("chart_type", "").lower()
            complex_types = ["scatter", "parallel", "network", "force", "chord"]
            if any(ct in chart_type for ct in complex_types):
                has_tooltip = viz_spec.get("has_tooltip", False)
                has_brush = viz_spec.get("has_brush", False)
                if not has_tooltip and not has_brush:
                    return True, f"Complex chart type '{chart_type}' without interactive features"
            return False, ""

        # SC-COLOR-001: Perceptual uniformity for continuous color
        if cid == "SC-COLOR-001":
            colormap = viz_spec.get("colormap", "").lower()
            if colormap and colormap not in ["viridis", "magma", "cividis", "inferno", "plasma", "blues", "greens", "reds"]:
                encodings = viz_spec.get("encodings", {})
                uses_continuous_color = any(ch == "color" for ch in encodings.values())
                if uses_continuous_color:
                    return True, f"Non-perceptually-uniform colormap '{colormap}' for continuous data"
            return False, ""

        # SC-EFF-005: Familiarity for general audience
        if cid == "SC-EFF-005":
            chart_type = viz_spec.get("chart_type", "").lower()
            avoid_types = ["parallel_coordinates", "chord", "sankey", "sunburst"]
            audience = viz_spec.get("audience", "general")
            if audience == "general" and any(at in chart_type for at in avoid_types):
                return True, f"Complex chart type '{chart_type}' for general audience"
            return False, ""

        return False, ""

    def _find_field(self, field_name: str, profile: DataProfile) -> Optional[FieldProfile]:
        """Find a field profile by name."""
        for f in profile.fields:
            if f.name == field_name or f.name.lower() == field_name.lower():
                return f
        return None

    # ---- Encoding Suggestion ----

    def suggest_encoding(self, data_profile: DataProfile, task: TaskSpec) -> List[EncodingSuggestion]:
        """
        Suggest optimal visual encodings based on data profile and task.
        Uses Cleveland-McGill effectiveness rankings.
        """
        suggestions = []
        data_types = self.encoding_effectiveness.get("data_types", {})

        for fp in data_profile.fields:
            type_info = data_types.get(fp.field_type, {})
            rankings = type_info.get("channel_ranking", [])

            if rankings:
                top = rankings[0]
                alternatives = [r["channel"] for r in rankings[1:4]]
                suggestions.append(EncodingSuggestion(
                    field_name=fp.name,
                    field_type=fp.field_type,
                    recommended_channel=top["channel"],
                    rank=top["rank"],
                    alternative_channels=alternatives,
                    rationale=f"Rank {top['rank']} for {fp.field_type} data ({', '.join(type_info.get('hard_rules', [])[:1])})"
                ))

        return suggestions

    # ---- Density Strategy ----

    def get_density_strategy(self, data_profile: DataProfile) -> Dict[str, Any]:
        """Get recommended rendering and interaction strategy based on data density."""
        for strategy in self.density_strategies:
            label = strategy.get("label", "").lower()
            if data_profile.density_level == "sparse" and "low" in label:
                return strategy
            elif data_profile.density_level == "medium" and "medium" in label:
                return strategy
            elif data_profile.density_level == "high" and "high" in label and "extreme" not in label:
                return strategy
            elif data_profile.density_level == "extreme" and "extreme" in label:
                return strategy
        return {}

    # ---- Color Palette Recommendation ----

    def recommend_palette(self, data_profile: DataProfile, viz_spec: Dict = None) -> Dict[str, Any]:
        """Recommend appropriate color palette based on data characteristics."""
        categorical_palettes = self.palettes.get("categorical", [])
        sequential_palettes = self.palettes.get("sequential", [])
        diverging_palettes = self.palettes.get("diverging", [])

        # Determine palette type based on data
        if data_profile.nominal_fields:
            # Find largest categorical field cardinality
            max_card = max(
                (f.cardinality for f in data_profile.fields if f.field_type == "nominal"),
                default=5
            )
            # Default to CVD-safe
            palette = next((p for p in categorical_palettes if p.get("cvd_safe")), categorical_palettes[0] if categorical_palettes else None)
            return {
                "type": "categorical",
                "palette": palette,
                "max_categories": max_card,
                "note": "CVD-safe palette recommended for unknown audience" if palette and palette.get("cvd_safe") else ""
            }
        elif data_profile.quantitative_fields:
            palette = next((p for p in sequential_palettes if p.get("cvd_safe") and p.get("perceptually_uniform")), 
                          sequential_palettes[0] if sequential_palettes else None)
            return {
                "type": "sequential",
                "palette": palette,
                "note": "Perceptually uniform, CVD-safe sequential palette"
            }
        
        return {"type": "categorical", "palette": categorical_palettes[0] if categorical_palettes else None}

    # ---- Utility Functions ----

    def _contrast_ratio(self, fg: str, bg: str) -> float:
        """Calculate WCAG contrast ratio between two hex colors."""
        try:
            fg_lum = self._relative_luminance(fg)
            bg_lum = self._relative_luminance(bg)
            lighter = max(fg_lum, bg_lum)
            darker = min(fg_lum, bg_lum)
            return (lighter + 0.05) / (darker + 0.05)
        except:
            return 21.0  # Assume pass if can't parse

    def _relative_luminance(self, hex_color: str) -> float:
        """Calculate relative luminance per WCAG 2.1."""
        hex_color = hex_color.strip("#")
        if len(hex_color) == 3:
            hex_color = "".join(c * 2 for c in hex_color)
        r, g, b = int(hex_color[0:2], 16) / 255, int(hex_color[2:4], 16) / 255, int(hex_color[4:6], 16) / 255
        
        r = r / 12.92 if r <= 0.03928 else ((r + 0.055) / 1.055) ** 2.4
        g = g / 12.92 if g <= 0.03928 else ((g + 0.055) / 1.055) ** 2.4
        b = b / 12.92 if b <= 0.03928 else ((b + 0.055) / 1.055) ** 2.4
        
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    def _generate_suggestions(self, report: ConstraintReport, profile: DataProfile, task: TaskSpec) -> List[str]:
        """Generate human-readable suggestions from constraint violations."""
        suggestions = []
        
        for v in report.hard_violations:
            suggestions.append(f"🔴 CRITICAL: {v.description} — {v.rationale} [{v.source}]")
        
        for v in report.soft_violations:
            severity = "🟡" if v.weight >= 2 else "🔵"
            suggestions.append(f"{severity} SUGGESTION (w={v.weight}): {v.description} — {v.rationale}")
        
        # Add density-based suggestion
        strategy = self.get_density_strategy(profile)
        if strategy:
            rendering = strategy.get("rendering", {})
            ctx = rendering.get("context", "SVG")
            suggestions.append(f"📊 Density Strategy ({profile.density_level}, N={profile.row_count}): Use {ctx} rendering")

        return suggestions

    # ---- Public API: Full Analysis ----

    def full_analysis(self, data: List[Dict[str, Any]], user_prompt: str) -> Dict[str, Any]:
        """
        Run complete constraint analysis pipeline:
        1. Profile data
        2. Infer task
        3. Suggest encodings
        4. Recommend palette and density strategy
        
        Returns a structured package for LLM prompt injection.
        """
        profile = self.analyze_data(data)
        task = self.infer_task(user_prompt)
        encoding_suggestions = self.suggest_encoding(profile, task)
        density_strategy = self.get_density_strategy(profile)
        palette_rec = self.recommend_palette(profile)

        # Build structured constraint context for LLM
        constraint_context = {
            "data_profile": {
                "row_count": profile.row_count,
                "density_level": profile.density_level,
                "data_structure": profile.data_structure,
                "fields": [
                    {
                        "name": f.name,
                        "type": f.field_type,
                        "cardinality": f.cardinality,
                        "cardinality_level": f.cardinality_level
                    }
                    for f in profile.fields
                ]
            },
            "task_spec": {
                "why": task.why,
                "search": task.search,
                "query": task.query,
                "raw_intent": task.raw_intent
            },
            "encoding_suggestions": [
                {
                    "field": s.field_name,
                    "field_type": s.field_type,
                    "recommended_channel": s.recommended_channel,
                    "alternatives": s.alternative_channels,
                    "rationale": s.rationale
                }
                for s in encoding_suggestions
            ],
            "density_strategy": {
                "level": profile.density_level,
                "rendering_context": density_strategy.get("rendering", {}).get("context", "SVG"),
                "mark_strategy": density_strategy.get("rendering", {}).get("mark_strategy", ""),
                "interaction": density_strategy.get("interaction", {})
            },
            "palette_recommendation": palette_rec,
            "applicable_hard_constraints": [
                {"id": hc["id"], "name": hc["name"], "constraint": str(hc.get("constraint", ""))}
                for hc in self.hard_constraints[:10]  # Top relevant
            ],
            "applicable_soft_constraints": [
                {"id": sc["id"], "name": sc["name"], "weight": sc.get("weight", 1), "preference": str(sc.get("preference", ""))}
                for sc in self.soft_constraints[:10]
            ]
        }

        return constraint_context


# ---- Singleton ----

_engine_instance = None

def get_constraint_engine() -> ConstraintEngine:
    """Get or create the singleton ConstraintEngine."""
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = ConstraintEngine()
    return _engine_instance
