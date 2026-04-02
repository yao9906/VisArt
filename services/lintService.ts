/**
 * VisArt Design Lint Service
 * 
 * Automated visualization quality auditing system that analyzes
 * LLM-generated D3 code and rendered SVG output.
 * 
 * Three analysis layers:
 * 1. Static Analysis — code pattern checking before execution
 * 2. Runtime Analysis — SVG DOM inspection after rendering
 * 3. Constraint Compliance — backend constraint engine evaluation
 * 
 * References:
 * - WCAG 2.1 (contrast ratios)
 * - Borland & Taylor 2007 (colormap bans)
 * - Tufte 1983 (data-ink ratio)
 * - Ware 2004 (discriminability limits)
 */

const BACKEND_URL = "http://localhost:8000";

// ---- Types ----

export interface LintViolation {
    id: string;
    rule: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    source?: string;
    penalty: number;
}

export interface LintReport {
    score: number;                     // 0-100 Design Quality Score
    grade: string;                     // A/B/C/D/F
    staticViolations: LintViolation[];
    runtimeViolations: LintViolation[];
    constraintViolations: LintViolation[];
    suggestions: string[];
    timestamp: number;
}

// ---- Static Analysis (Code-level) ----

function staticAnalysis(code: string): LintViolation[] {
    const violations: LintViolation[] = [];

    // LINT-S01: Hardcoded domain/range
    const domainMatch = code.match(/\.domain\(\s*\[\s*[\d"']/g);
    if (domainMatch) {
        violations.push({
            id: 'LINT-S01',
            rule: 'Hardcoded domain/range',
            severity: 'error',
            message: `Scale domain appears hardcoded (${domainMatch.length} occurrence(s)). Use d3.extent() or data-driven domain.`,
            penalty: 10
        });
    }

    // LINT-S02: No empty data handling
    if (!code.includes('data.length') && !code.includes('!data') && !code.includes('data?.')) {
        violations.push({
            id: 'LINT-S02',
            rule: 'No empty data handling',
            severity: 'warning',
            message: 'No check for empty data array. Add guard: if (!data || data.length === 0) return;',
            penalty: 3
        });
    }

    // LINT-S03: Import/require usage
    if (/\b(import|require)\s*\(/.test(code) || /^import\s+/m.test(code)) {
        violations.push({
            id: 'LINT-S03',
            rule: 'Import/require detected',
            severity: 'error',
            message: 'Code contains import/require statements. D3 renderer provides d3 as a global.',
            penalty: 10
        });
    }

    // LINT-S04: Mark size hardcoded as small constant
    const radiusMatch = code.match(/\.attr\(\s*["']r["']\s*,\s*(\d+)\s*\)/);
    if (radiusMatch && parseInt(radiusMatch[1]) < 2) {
        violations.push({
            id: 'LINT-S04',
            rule: 'Mark size too small',
            severity: 'warning',
            message: `Mark radius is ${radiusMatch[1]}px (hardcoded). Minimum recommended: 2.5px.`,
            penalty: 3
        });
    }

    // LINT-S05: Rainbow/Jet colormap usage
    if (/interpolateRainbow|interpolateJet|interpolateHSV|d3\.scaleSequential.*rainbow/i.test(code)) {
        violations.push({
            id: 'LINT-S05',
            rule: 'Banned colormap',
            severity: 'error',
            message: 'Rainbow/Jet colormap detected. Use Viridis/Magma/Cividis instead (Borland & Taylor 2007).',
            source: 'Borland & Taylor 2007',
            penalty: 10
        });
    }

    // LINT-S06: No tooltip implementation
    if (!code.includes('tooltip') && !code.includes('mouseover') && !code.includes('mouseenter') && !code.includes('onHover')) {
        violations.push({
            id: 'LINT-S06',
            rule: 'No tooltip/hover interaction',
            severity: 'info',
            message: 'No tooltip or hover interaction detected. Consider adding for details-on-demand.',
            penalty: 0
        });
    }

    return violations;
}

// ---- Runtime Analysis (SVG DOM-level) ----

function runtimeAnalysis(svgContainer: HTMLElement | null): LintViolation[] {
    const violations: LintViolation[] = [];

    if (!svgContainer) {
        violations.push({
            id: 'LINT-R01',
            rule: 'No SVG container',
            severity: 'error',
            message: 'SVG container not found. Rendering may have failed.',
            penalty: 10
        });
        return violations;
    }

    const svg = svgContainer.querySelector('svg');
    if (!svg) {
        violations.push({
            id: 'LINT-R02',
            rule: 'Empty canvas',
            severity: 'error',
            message: 'No SVG element found in container.',
            penalty: 10
        });
        return violations;
    }

    // LINT-R02: Empty canvas check
    const marks = svg.querySelectorAll('circle, rect, path, line, text, polygon, ellipse');
    if (marks.length === 0) {
        violations.push({
            id: 'LINT-R02',
            rule: 'Empty canvas',
            severity: 'error',
            message: 'SVG contains no graphical marks (circles, rects, paths, etc.).',
            penalty: 10
        });
        return violations;
    }

    // LINT-R03: Contrast ratio check
    const bgColor = getComputedBgColor(svgContainer);
    const lowContrastColors: string[] = [];
    marks.forEach(mark => {
        const fill = getComputedStyle(mark).fill;
        if (fill && fill !== 'none') {
            const ratio = contrastRatio(parseColor(fill), parseColor(bgColor));
            if (ratio < 3.0) {
                lowContrastColors.push(fill);
            }
        }
    });
    if (lowContrastColors.length > 0) {
        violations.push({
            id: 'LINT-R03',
            rule: 'Low contrast ratio',
            severity: 'error',
            message: `${lowContrastColors.length} mark(s) have contrast ratio < 3:1 against background (WCAG 2.1 SC 1.4.11).`,
            source: 'WCAG 2.1',
            penalty: 10
        });
    }

    // LINT-R04: Mark visibility (minimum size)
    let tinyMarkCount = 0;
    marks.forEach(mark => {
        const bbox = (mark as SVGGraphicsElement).getBBox?.();
        if (bbox && bbox.width < 2 && bbox.height < 2) {
            tinyMarkCount++;
        }
    });
    if (tinyMarkCount > 0) {
        violations.push({
            id: 'LINT-R04',
            rule: 'Marks too small',
            severity: 'warning',
            message: `${tinyMarkCount} mark(s) are smaller than 2×2px and may be invisible.`,
            source: 'Heer & Bostock 2010',
            penalty: 3
        });
    }

    // LINT-R05: Color count check
    const uniqueColors = new Set<string>();
    marks.forEach(mark => {
        const fill = getComputedStyle(mark).fill;
        if (fill && fill !== 'none' && fill !== 'transparent') {
            uniqueColors.add(fill);
        }
    });
    if (uniqueColors.size > 12) {
        violations.push({
            id: 'LINT-R05',
            rule: 'Excessive color categories',
            severity: 'warning',
            message: `${uniqueColors.size} distinct colors used (max recommended: 12). Consider grouping or faceting.`,
            source: 'Ware 2004',
            penalty: 3
        });
    }

    // LINT-R06: Label readability
    const textElements = svg.querySelectorAll('text');
    let smallTextCount = 0;
    textElements.forEach(text => {
        const fontSize = parseFloat(getComputedStyle(text).fontSize || '12');
        if (fontSize < 8) {
            smallTextCount++;
        }
    });
    if (smallTextCount > 0) {
        violations.push({
            id: 'LINT-R06',
            rule: 'Text too small',
            severity: 'warning',
            message: `${smallTextCount} text element(s) have font-size < 8px, may be unreadable.`,
            penalty: 3
        });
    }

    // LINT-R07: Legend check
    const hasLegend = svg.querySelector('.legend, [class*="legend"], text[class*="legend"]') !== null;
    const hasDirectLabels = textElements.length > 2; // rough heuristic
    if (!hasLegend && !hasDirectLabels && uniqueColors.size > 1) {
        violations.push({
            id: 'LINT-R07',
            rule: 'No legend',
            severity: 'warning',
            message: 'Multiple colors used but no legend found. Add legend or direct labels.',
            penalty: 3
        });
    }

    // LINT-R08: Axis check
    const hasAxis = svg.querySelector('.tick, .axis, .domain') !== null;
    if (!hasAxis) {
        violations.push({
            id: 'LINT-R08',
            rule: 'No axes',
            severity: 'warning',
            message: 'No axis elements (ticks/domain) found. Consider adding axes for context.',
            penalty: 3
        });
    }

    // LINT-R09: Overplotting estimation
    if (marks.length > 100) {
        const positions = new Map<string, number>();
        let overlapCount = 0;
        marks.forEach(mark => {
            const bbox = (mark as SVGGraphicsElement).getBBox?.();
            if (bbox) {
                // Quantize position to detect overlap
                const key = `${Math.round(bbox.x / 3)},${Math.round(bbox.y / 3)}`;
                const count = (positions.get(key) || 0) + 1;
                positions.set(key, count);
                if (count > 1) overlapCount++;
            }
        });
        const overlapRatio = overlapCount / marks.length;
        if (overlapRatio > 0.3) {
            violations.push({
                id: 'LINT-R09',
                rule: 'Overplotting detected',
                severity: 'warning',
                message: `~${Math.round(overlapRatio * 100)}% of marks overlap. Consider jittering, opacity, or aggregation.`,
                source: 'Few 2006',
                penalty: 3
            });
        }
    }

    return violations;
}

// ---- Scoring ----

function calculateScore(violations: LintViolation[]): { score: number; grade: string } {
    const totalPenalty = violations.reduce((sum, v) => sum + v.penalty, 0);
    const score = Math.max(0, 100 - totalPenalty);

    let grade: string;
    if (score >= 90) grade = 'A';
    else if (score >= 75) grade = 'B';
    else if (score >= 60) grade = 'C';
    else if (score >= 40) grade = 'D';
    else grade = 'F';

    return { score, grade };
}

// ---- Color Utility Functions ----

function parseColor(colorStr: string): [number, number, number] {
    if (!colorStr) return [0, 0, 0];

    // rgb(r, g, b) format
    const rgbMatch = colorStr.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
        return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
    }

    // hex format
    let hex = colorStr.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length === 6) {
        return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16)
        ];
    }

    return [0, 0, 0];
}

function relativeLuminance(r: number, g: number, b: number): number {
    const [rs, gs, bs] = [r / 255, g / 255, b / 255].map(c =>
        c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    );
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
    const fgLum = relativeLuminance(...fg);
    const bgLum = relativeLuminance(...bg);
    const lighter = Math.max(fgLum, bgLum);
    const darker = Math.min(fgLum, bgLum);
    return (lighter + 0.05) / (darker + 0.05);
}

function getComputedBgColor(element: HTMLElement): string {
    const bg = getComputedStyle(element).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    return 'rgb(255, 255, 255)'; // default white
}

// ---- Backend Constraint Analysis ----

async function backendConstraintAnalysis(
    query: string,
    data: any[],
    vizSpec: Record<string, any>
): Promise<LintViolation[]> {
    try {
        const response = await fetch(`${BACKEND_URL}/lint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, data: data.slice(0, 100), viz_spec: vizSpec })
        });

        if (!response.ok) return [];

        const result = await response.json();
        const violations: LintViolation[] = [];

        for (const hv of (result.hard_violations || [])) {
            violations.push({
                id: hv.id,
                rule: hv.name,
                severity: 'error',
                message: `[Hard Constraint] ${hv.description}. ${hv.rationale}`,
                source: hv.source,
                penalty: hv.penalty || 20
            });
        }

        for (const sv of (result.soft_violations || [])) {
            violations.push({
                id: sv.id,
                rule: sv.name,
                severity: 'warning',
                message: `[Soft w=${sv.weight}] ${sv.description}`,
                penalty: sv.penalty || 3
            });
        }

        return violations;
    } catch {
        // Backend unavailable, skip constraint analysis
        return [];
    }
}

// ---- Backend Constraint Context (for LLM prompt injection) ----

export async function getConstraintContext(
    query: string,
    data: any[]
): Promise<Record<string, any> | null> {
    try {
        const response = await fetch(`${BACKEND_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, data: data.slice(0, 100) })
        });

        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

// ---- Public API ----

/**
 * Run full Design Lint analysis on generated visualization.
 * 
 * @param code - The generated D3.js code string
 * @param svgContainer - The rendered SVG container DOM element
 * @param query - The original user prompt
 * @param data - The input dataset
 * @param vizSpec - Optional visualization specification for constraint checking
 */
export async function runDesignLint(
    code: string,
    svgContainer: HTMLElement | null,
    query: string = '',
    data: any[] = [],
    vizSpec: Record<string, any> = {}
): Promise<LintReport> {
    // Layer 1: Static code analysis
    const staticViolations = staticAnalysis(code);

    // Layer 2: Runtime SVG analysis
    const runtimeViolations = runtimeAnalysis(svgContainer);

    // Layer 3: Backend constraint evaluation (async)
    const constraintViolations = await backendConstraintAnalysis(query, data, vizSpec);

    // Combine all violations
    const allViolations = [...staticViolations, ...runtimeViolations, ...constraintViolations];
    const { score, grade } = calculateScore(allViolations);

    // Generate suggestions
    const suggestions: string[] = [];
    if (score < 70) {
        suggestions.push('⚠️ Score below 70 — consider auto-repair cycle');
    }
    const errorCount = allViolations.filter(v => v.severity === 'error').length;
    if (errorCount > 0) {
        suggestions.push(`🔴 ${errorCount} critical issue(s) found — fix hard constraint violations first`);
    }

    return {
        score,
        grade,
        staticViolations,
        runtimeViolations,
        constraintViolations,
        suggestions,
        timestamp: Date.now()
    };
}

/**
 * Generate a repair prompt from lint violations for LLM auto-fix.
 */
export function generateRepairPrompt(report: LintReport): string {
    if (report.score >= 70) return '';

    const issues = [
        ...report.staticViolations.filter(v => v.severity === 'error'),
        ...report.runtimeViolations.filter(v => v.severity === 'error'),
        ...report.constraintViolations.filter(v => v.severity === 'error')
    ];

    if (issues.length === 0) return '';

    const issueText = issues.map((v, i) =>
        `${i + 1}. [${v.id}] ${v.message}`
    ).join('\n');

    return `The following critical design issues were detected by the automated Design Lint system.
Fix ALL of the following violations while preserving the existing visualization logic:

${issueText}

Requirements:
- Do NOT change the chart type or visual concept
- Fix only the specific issues listed above
- Ensure WCAG 2.1 contrast ratio >= 3:1
- Use perceptually uniform colormaps (Viridis/Magma/Cividis) for continuous data
- Do not use Rainbow/Jet colormaps
- Ensure all marks are >= 2.5px visible size`;
}
