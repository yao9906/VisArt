
import React from 'react';
import { LintReport as LintReportType } from '../services/lintService';

interface LintReportProps {
    report: LintReportType | null;
    onAutoRepair?: () => void;
}

const gradeRingClass: Record<string, string> = {
    A: 'score-ring-A', B: 'score-ring-B', C: 'score-ring-C', D: 'score-ring-D', F: 'score-ring-F',
};

const severityConfig: Record<string, { color: string; dotStyle: React.CSSProperties }> = {
    error: { color: '#be123c', dotStyle: { background: '#f43f5e', boxShadow: '0 0 0 2px rgba(244,63,94,0.15)' } },
    warning: { color: '#b45309', dotStyle: { background: '#f59e0b', boxShadow: '0 0 0 2px rgba(245,158,11,0.15)' } },
    info: { color: '#1d4ed8', dotStyle: { background: '#6366f1', boxShadow: '0 0 0 2px rgba(99,102,241,0.15)' } },
};

const LintReportComponent: React.FC<LintReportProps> = ({ report, onAutoRepair }) => {
    if (!report) return null;

    const allViolations = [...report.staticViolations, ...report.runtimeViolations, ...report.constraintViolations];
    const errorCount = allViolations.filter(v => v.severity === 'error').length;
    const warnCount = allViolations.filter(v => v.severity === 'warning').length;
    const infoCount = allViolations.filter(v => v.severity === 'info').length;

    return (
        <div style={{
            background: '#ffffff',
            border: '1px solid var(--border-base)',
            borderRadius: '10px', overflow: 'hidden',
            fontFamily: "'Inter', sans-serif",
            boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--bg-subtle)',
                borderBottom: '1px solid var(--border-base)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
                        </svg>
                        <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>
                            Design Lint
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: '5px' }}>
                        {errorCount > 0 && <span className="tag tag-rose">🔴 {errorCount} error{errorCount > 1 ? 's' : ''}</span>}
                        {warnCount > 0 && <span className="tag tag-amber">🟡 {warnCount} warn</span>}
                        {infoCount > 0 && <span className="tag tag-indigo">🔵 {infoCount} info</span>}
                        {allViolations.length === 0 && <span className="tag tag-emerald">✓ Clean</span>}
                    </div>
                </div>

                {/* Score ring */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div className={`score-ring ${gradeRingClass[report.grade] || 'score-ring-C'}`}>
                        {report.grade}
                    </div>
                    <div>
                        <div style={{
                            fontSize: '19px', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                            color: report.score >= 70 ? '#059669' : report.score >= 40 ? '#d97706' : '#e11d48',
                        }}>
                            {report.score}
                        </div>
                        <div style={{ fontSize: '8px', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>/100 DQS</div>
                    </div>
                </div>
            </div>

            {/* Violations */}
            {allViolations.length > 0 && (
                <div style={{ overflowY: 'visible' }} className="custom-scrollbar">
                    {allViolations.map((v, i) => {
                        const cfg = severityConfig[v.severity] || severityConfig.info;
                        return (
                            <div key={`${v.id}-${i}`} className="lint-row" style={{ background: i % 2 === 0 ? '#ffffff' : 'var(--bg-subtle)' }}>
                                <div className="status-dot" style={{ ...cfg.dotStyle, marginTop: '3px', width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0 }} />
                                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '8px', color: 'var(--text-muted)', minWidth: '58px', flexShrink: 0 }}>
                                    {v.id}
                                </span>
                                <span style={{ fontSize: '9.5px', color: 'var(--text-secondary)', lineHeight: 1.5, flex: 1 }}>
                                    {v.message}
                                    {v.source && <span style={{ color: 'var(--text-muted)', marginLeft: '4px', fontSize: '8px' }}>[{v.source}]</span>}
                                </span>
                                {v.penalty > 0 && (
                                    <span style={{ fontSize: '8px', color: cfg.color, fontWeight: 700, flexShrink: 0, marginLeft: '4px' }}>−{v.penalty}</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {allViolations.length === 0 && (
                <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px' }}>✅</span>
                    <span style={{ fontSize: '10px', color: '#059669', fontWeight: 500 }}>
                        No design violations detected — clean bill of health!
                    </span>
                </div>
            )}

            {/* Auto-repair */}
            {report.score < 70 && onAutoRepair && (
                <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-base)', background: 'var(--bg-subtle)' }}>
                    <button className="btn-repair" onClick={onAutoRepair}>
                        🔧 Auto-Repair ({errorCount} critical issue{errorCount !== 1 ? 's' : ''})
                    </button>
                </div>
            )}
        </div>
    );
};

export default LintReportComponent;
