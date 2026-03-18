
import React, { useState, useEffect, useCallback } from 'react';
import Papa from 'papaparse';
import { AgentRole, AgentLog, VisualizationState, RAGKnowledgeItem, WorkflowNode, RuleHitsByLane } from './types';
import { COMPLEX_TEST_DATA } from './constants';
import { generateStandardViz, getCritiqueAndRetrieve, refineViz } from './services/geminiService';
import { runDesignLint, getConstraintContext, generateRepairPrompt, LintReport } from './services/lintService';
import AgentConsole from './components/AgentConsole';
import D3Renderer from './components/D3Renderer';
import RAGGraphInspector from './components/RAGGraphInspector';
import LintReportComponent from './components/LintReport';

// ── inline style helpers ──
const S = {
  app: { height: '100vh', display: 'flex', flexDirection: 'column' as const, background: 'var(--bg-app)', overflow: 'hidden' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 20px', height: '50px', flexShrink: 0,
    background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border-base)',
    boxShadow: '0 1px 0 var(--border-base)',
    zIndex: 40,
  },
  logoMark: {
    width: '30px', height: '30px', borderRadius: '9px',
    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(91,110,245,0.3)',
    flexShrink: 0,
  },
  logoTitle: { fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.3px', lineHeight: 1 },
  logoSub: { fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginTop: '1px' },
  promptBar: {
    padding: '10px 20px', flexShrink: 0,
    background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border-base)',
    display: 'flex', gap: '10px', alignItems: 'center',
    zIndex: 30,
  },
  main: { display: 'grid', gridTemplateColumns: '272px 1fr 272px', gap: '12px', padding: '12px', flexGrow: 1, minHeight: 0 },
  panel: {
    background: 'var(--bg-surface)', border: '1px solid var(--border-base)',
    borderRadius: '12px', overflow: 'hidden',
    display: 'flex', flexDirection: 'column' as const, height: '100%',
  },
  panelHeader: {
    padding: '9px 13px', flexShrink: 0,
    borderBottom: '1px solid var(--border-base)',
    background: 'var(--bg-subtle)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  panelBody: { flexGrow: 1, minHeight: 0, overflowY: 'auto' as const, padding: '12px' },
};

const App: React.FC = () => {
  const [data, setData] = useState<any[]>(COMPLEX_TEST_DATA);
  const [userInputPrompt, setUserInputPrompt] = useState<string>('');
  const [colorRules, setColorRules] = useState<RAGKnowledgeItem[]>([]);
  const [interactionRules, setInteractionRules] = useState<RAGKnowledgeItem[]>([]);
  const [designGraph, setDesignGraph] = useState<any[]>([]);
  const [d3Knowledge, setD3Knowledge] = useState<RAGKnowledgeItem[]>([]);
  const [history, setHistory] = useState<WorkflowNode[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [state, setState] = useState<VisualizationState>({
    originalPrompt: '', standardCode: '', critique: '', refinedCode: '',
    isGenerating: false, logs: [], retrievedItems: [],
    ruleHits: { design: [], color: [], interaction: [] }, hoveredCategory: null,
  });
  const [activeStep, setActiveStep] = useState<AgentRole | null>(null);
  const [feedbackInput, setFeedbackInput] = useState('');
  const [expandedRuleKeys, setExpandedRuleKeys] = useState<Set<string>>(new Set());
  const [lintReport, setLintReport] = useState<LintReport | null>(null);
  const [activePanel, setActivePanel] = useState<'rag' | 'data'>('rag');

  const toggleRuleExpand = (key: string) => setExpandedRuleKeys(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const safeStringify = (obj: any) => { try { return JSON.stringify(obj, null, 2); } catch { return '// Circular structure'; } };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    const reset = () => setState(prev => ({ ...prev, standardCode: '', refinedCode: '', critique: '', logs: [], retrievedItems: [], ruleHits: { design: [], color: [], interaction: [] }, ragTrace: undefined }));
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (file.name.toLowerCase().endsWith('.csv')) {
        Papa.parse(content, {
          header: true, dynamicTyping: true, skipEmptyLines: true,
          complete: (r) => { if (!r.errors.length || r.data.length) { setData(r.data); reset(); } }
        });
      } else {
        try { const json = JSON.parse(content); if (Array.isArray(json)) { setData(json); reset(); } } catch { alert('Failed to parse JSON.'); }
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    const parseKnowledge = (text: string): RAGKnowledgeItem[] => {
      const trimmed = text.trim(); if (!trimmed) return [];
      try { const p = JSON.parse(trimmed); if (Array.isArray(p)) return p; if (p && typeof p === 'object') return [p]; } catch { }
      return trimmed.split('\n').map(l => l.trim()).filter(l => l && l !== '[' && l !== ']')
        .map(l => { try { return JSON.parse(l.replace(/,$/, '')); } catch { return null; } }).filter(Boolean) as RAGKnowledgeItem[];
    };
    const loadJSONL = async (path: string) => { try { const r = await fetch(path); if (!r.ok) return []; return parseKnowledge(await r.text()); } catch { return []; } };
    const loadJSON = async (path: string) => { try { const r = await fetch(path); if (!r.ok) return []; return await r.json(); } catch { return []; } };
    Promise.all([loadJSONL('color_rules.jsonl'), loadJSONL('interaction_rules.jsonl'), loadJSONL('d3_knowledge_base_full.jsonl'), loadJSON('vis_design_graph.json')])
      .then(([color, interaction, kb, graph]) => { setColorRules(color); setInteractionRules(interaction); setD3Knowledge(kb); setDesignGraph(graph); });
  }, []);

  const addNode = useCallback((role: AgentRole, label: string, parentId: string | null, snapshot: WorkflowNode['snapshot']) => {
    const newNode: WorkflowNode = { id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`, parentId, label, role, snapshot, timestamp: Date.now() };
    setHistory(prev => [...prev, newNode]); setActiveNodeId(newNode.id); return newNode.id;
  }, []);

  const handleSelectNode = (nodeId: string) => {
    const node = history.find(n => n.id === nodeId); if (!node) return;
    setActiveNodeId(nodeId); setState(prev => ({ ...prev, ...node.snapshot, isGenerating: false }));
  };

  const runWorkflow = async () => {
    const finalPrompt = userInputPrompt.trim() || 'Map the hierarchical relationships between innovation hubs.';
    setState(prev => ({ ...prev, originalPrompt: finalPrompt, isGenerating: true, logs: [], standardCode: '', refinedCode: '', critique: '', retrievedItems: [], ruleHits: { design: [], color: [], interaction: [] }, ragTrace: undefined }));
    try {
      setActiveStep(AgentRole.CRITIC);
      const { critique, ids, graphContext, trace, ruleHits } = await getCritiqueAndRetrieve('', finalPrompt, designGraph, d3Knowledge, { colorRules, interactionRules });
      const d3Found = d3Knowledge.filter(i => ids.includes(i.id));
      const found = [...d3Found, ...(graphContext || [])];
      const emptyRuleHits: RuleHitsByLane = { design: [], color: [], interaction: [] };
      const ragLogs = [{ role: AgentRole.CRITIC, content: `Knowledge Graph Retrieval Complete. Context: ${found.length} items.`, timestamp: Date.now() }];
      const critId = addNode(AgentRole.CRITIC, 'Analysis', null, { standardCode: '', critique, refinedCode: '', retrievedItems: found, ruleHits: ruleHits || emptyRuleHits, logs: ragLogs, ragTrace: trace });
      setState(prev => ({ ...prev, critique, retrievedItems: found, ruleHits: ruleHits || emptyRuleHits, logs: ragLogs, ragTrace: trace }));

      setActiveStep(AgentRole.REFINER);
      const result = await refineViz(finalPrompt, '', critique, data, found, undefined, false, { colorRules, interactionRules });
      const refLogs = [...ragLogs, { role: AgentRole.REFINER, content: 'Visualization and Insight Generation Complete.', timestamp: Date.now() }];
      addNode(AgentRole.REFINER, 'Visualization', critId, { standardCode: '', critique, refinedCode: result.code, retrievedItems: found, ruleHits: ruleHits || emptyRuleHits, logs: refLogs, analysis: { insight: result.insight, nextSteps: result.nextSteps } });
      setState(prev => ({ ...prev, refinedCode: result.code, logs: refLogs, ruleHits: prev.ruleHits, analysis: { insight: result.insight, nextSteps: result.nextSteps } }));

      setTimeout(async () => {
        const container = document.getElementById('enhanced-viz');
        const lint = await runDesignLint(result.code, container, finalPrompt, data);
        setLintReport(lint);
      }, 1500);
    } catch (err) {
      setState(prev => ({ ...prev, logs: [...prev.logs, { role: AgentRole.GENERATOR, content: 'Error: ' + (err as Error).message, timestamp: Date.now() }] }));
    } finally { setState(prev => ({ ...prev, isGenerating: false })); setActiveStep(null); }
  };

  const handleUserRefine = async () => {
    if (!feedbackInput.trim() || state.isGenerating) return;
    const feedback = feedbackInput; setFeedbackInput('');
    setState(prev => ({ ...prev, isGenerating: true })); setActiveStep(AgentRole.REFINER);
    try {
      const isEvolving = !!state.refinedCode;
      const result = await refineViz(`${state.originalPrompt}. REFINEMENT: ${feedback}`, isEvolving ? state.refinedCode : state.standardCode, state.critique, data, state.retrievedItems, feedback, isEvolving, { colorRules, interactionRules });
      const iterLogs = [...state.logs, { role: AgentRole.REFINER, content: `Iteration: ${feedback}`, timestamp: Date.now() }];
      addNode(AgentRole.REFINER, 'Iteration', activeNodeId, { standardCode: state.standardCode, critique: state.critique, refinedCode: result.code, retrievedItems: state.retrievedItems, ruleHits: state.ruleHits, logs: iterLogs, analysis: { insight: result.insight, nextSteps: result.nextSteps } });
      setState(prev => ({ ...prev, refinedCode: result.code, logs: iterLogs, analysis: { insight: result.insight, nextSteps: result.nextSteps } }));
      setTimeout(async () => {
        const container = document.getElementById('enhanced-viz');
        const lint = await runDesignLint(result.code, container, state.originalPrompt + ' ' + feedback, data);
        setLintReport(lint);
      }, 1500);
    } catch { } finally { setState(prev => ({ ...prev, isGenerating: false })); setActiveStep(null); }
  };

  const laneConfig = [
    { key: 'design' as const, label: 'Design Principles', tagClass: 'tag-indigo', accentColor: 'var(--accent-primary)' },
    { key: 'color' as const, label: 'Color & Perception', tagClass: 'tag-amber', accentColor: 'var(--color-amber)' },
    { key: 'interaction' as const, label: 'Interaction Rules', tagClass: 'tag-emerald', accentColor: 'var(--color-emerald)' },
  ];

  return (
    <div style={S.app}>

      {/* ── Header ── */}
      <header style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
          <div style={S.logoMark}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div>
            <div style={S.logoTitle}>VisArt</div>
            <div style={S.logoSub}>Constraint-Guided Visual Analytics</div>
          </div>
        </div>

        {/* Center — live status */}
        {state.isGenerating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', background: 'rgba(91,110,245,0.06)', border: '1px solid rgba(91,110,245,0.15)', borderRadius: '20px', padding: '4px 12px' }}>
            <span className="status-dot active" />
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--accent-primary)' }}>Agent Processing...</span>
          </div>
        )}

        {/* Right badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span className="tag tag-muted mono">{(colorRules.length + interactionRules.length + d3Knowledge.length).toLocaleString()} items</span>
          {lintReport && (
            <span className={`tag ${lintReport.score >= 70 ? 'tag-emerald' : lintReport.score >= 40 ? 'tag-amber' : 'tag-rose'}`}>
              DQS {lintReport.grade} · {lintReport.score}
            </span>
          )}
          <span className="tag tag-indigo">RAG Ready</span>
        </div>
      </header>

      {/* ── Prompt bar ── */}
      <div style={S.promptBar}>
        <div style={{ position: 'relative', flexGrow: 1 }}>
          <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <input
            type="text" value={userInputPrompt}
            onChange={(e) => setUserInputPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runWorkflow()}
            placeholder="Describe your visualization — e.g. 'Show monthly revenue trends by product category over 2024...'"
            className="vis-input"
            style={{ paddingLeft: '34px' }}
          />
          <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '9px', color: 'var(--text-placeholder)', letterSpacing: '0.06em', textTransform: 'uppercase', pointerEvents: 'none' }}>⏎</div>
        </div>
        <button className="btn-primary" onClick={runWorkflow} disabled={state.isGenerating}>
          {state.isGenerating ? (
            <>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              Processing
            </>
          ) : (
            <>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              Run Pipeline
            </>
          )}
        </button>
      </div>

      {/* ── Main 3-column grid ── */}
      <main style={S.main}>

        {/* ═══ LEFT PANEL ═══ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '3px', background: 'var(--bg-muted)', borderRadius: '9px', padding: '3px', flexShrink: 0 }}>
            {(['rag', 'data'] as const).map(tab => (
              <button key={tab} onClick={() => setActivePanel(tab)}
                className={`tab-btn ${activePanel === tab ? 'active' : 'inactive'}`}>
                {tab === 'rag' ? '◈ RAG Context' : '⊞ Data Feed'}
              </button>
            ))}
          </div>

          {/* RAG Context */}
          {activePanel === 'rag' && (
            <div className="card custom-scrollbar" style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

              {state.ragTrace && (
                <div>
                  <div className="section-label" style={{ marginBottom: '6px' }}>Graph Trace</div>
                  <div style={{ height: '105px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-base)' }}>
                    <RAGGraphInspector trace={state.ragTrace} />
                  </div>
                </div>
              )}

              {laneConfig.map(lane => {
                const hits = state.ruleHits?.[lane.key] || [];
                return (
                  <div key={lane.key}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span className="section-label" style={{ color: lane.accentColor }}>{lane.label}</span>
                      <span className={`tag ${lane.tagClass}`}>{hits.length}</span>
                    </div>
                    {hits.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        {hits.map((hit, idx) => {
                          const k = `${lane.key}_${idx}_${hit.topic}`;
                          const expanded = expandedRuleKeys.has(k);
                          return (
                            <div key={k} className="rule-card">
                              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px' }}>
                                <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-primary)', flex: 1, lineHeight: 1.35 }}>{hit.topic}</span>
                                <div style={{ display: 'flex', gap: '4px', flexShrink: 0, alignItems: 'center' }}>
                                  <span className="tag tag-muted mono" style={{ fontSize: '7.5px' }}>{hit.score}</span>
                                  <button className="btn-secondary" onClick={() => toggleRuleExpand(k)}>{expanded ? '−' : '+'}</button>
                                </div>
                              </div>
                              <div style={{ fontSize: '9.5px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.55, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: expanded ? 999 : 2, WebkitBoxOrient: 'vertical' as any }}>
                                {hit.rule || 'Rule content unavailable.'}
                              </div>
                              {expanded && (
                                <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid var(--border-base)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                  {[['Condition', hit.condition], ['Source', hit.source], ['Reason', hit.reason]].map(([label, val]) =>
                                    val ? <div key={label} style={{ fontSize: '9px', color: 'var(--text-muted)' }}><b style={{ color: 'var(--text-secondary)' }}>{label}: </b>{val}</div> : null
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ fontSize: '9px', color: 'var(--text-placeholder)', fontStyle: 'italic', padding: '2px' }}>No matches yet.</div>
                    )}
                  </div>
                );
              })}

              {state.retrievedItems.length > 0 && (
                <div>
                  <div className="section-label" style={{ marginBottom: '6px', color: 'var(--accent-primary)' }}>GraphRAG Retrieved</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {state.retrievedItems.slice(0, 3).map((item: any, i) => (
                      <div key={i} className="rule-card" style={{ borderLeft: `2px solid var(--accent-primary)` }}>
                        <span className="tag tag-indigo" style={{ marginBottom: '4px', display: 'inline-block' }}>{item.type || (item.technique ? 'Graph-RAG' : 'Knowledge')}</span>
                        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '3px', lineHeight: 1.3 }}>{item.task || item.title || item.topic || 'Context Item'}</div>
                        <div style={{ fontSize: '9px', color: 'var(--text-secondary)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>{item.rationale || item.description || 'Retrieved context.'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Data Feed */}
          {activePanel === 'data' && (
            <div className="card" style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '12px', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <span className="section-label">Dataset</span>
                <label style={{ cursor: 'pointer' }}>
                  <span className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    Import CSV / JSON
                  </span>
                  <input type="file" accept=".json,.csv" style={{ display: 'none' }} onChange={handleFileUpload} />
                </label>
              </div>
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', flexShrink: 0 }}>
                <span className="tag tag-cyan">{data.length} rows</span>
                <span className="tag tag-muted">{data.length > 0 ? Object.keys(data[0]).length : 0} fields</span>
              </div>
              <div className="code-block custom-scrollbar" style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
                {safeStringify(data.slice(0, 10))}
                {data.length > 10 && <div style={{ color: 'var(--text-placeholder)', marginTop: '4px', fontSize: '8px' }}>... {data.length - 10} more rows</div>}
              </div>
            </div>
          )}
        </div>

        {/* ═══ CENTER PANEL ═══ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0 }}>
          {/* Visualization canvas */}
          <div style={{ flexGrow: 2, minHeight: 0, borderRadius: '12px', overflow: 'hidden' }}>
            <D3Renderer
              title="VisArt Rendering" containerId="enhanced-viz"
              code={state.refinedCode} data={data}
              isLoading={state.isGenerating}
              onHover={(cat) => setState(s => ({ ...s, hoveredCategory: cat }))}
              hoveredCategory={state.hoveredCategory}
            />
          </div>

          {/* Analysis panel */}
          {state.analysis && (
            <div className="card" style={{ flexShrink: 0, padding: '12px', display: 'flex', gap: '12px', minHeight: '120px', maxHeight: '175px' }}>
              {[
                { label: 'Key Insights', icon: '◎', iconColor: 'var(--accent-primary)', content: state.analysis.insight },
                { label: 'Next Steps', icon: '›', iconColor: 'var(--color-rose)', content: state.analysis.nextSteps },
              ].map((item, i) => (
                <React.Fragment key={item.label}>
                  {i > 0 && <div style={{ width: '1px', background: 'var(--border-base)', flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
                      <span style={{ fontWeight: 900, color: item.iconColor, fontSize: '12px' }}>{item.icon}</span>
                      <span className="section-label" style={{ color: item.iconColor }}>{item.label}</span>
                    </div>
                    <div className="analysis-prose custom-scrollbar" style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
                      {item.content}
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Lint report */}
          {lintReport && (
            <div style={{ flexShrink: 0 }}>
              <LintReportComponent
                report={lintReport}
                onAutoRepair={lintReport.score < 70 ? async () => {
                  const repairPrompt = generateRepairPrompt(lintReport);
                  if (!repairPrompt) return;
                  setState(prev => ({ ...prev, isGenerating: true }));
                  try {
                    const result = await refineViz(state.originalPrompt, state.refinedCode, repairPrompt, data, state.retrievedItems, repairPrompt, true, { colorRules, interactionRules });
                    setState(prev => ({ ...prev, refinedCode: result.code, isGenerating: false, analysis: { insight: result.insight, nextSteps: result.nextSteps } }));
                    setTimeout(async () => { const c = document.getElementById('enhanced-viz'); setLintReport(await runDesignLint(result.code, c, state.originalPrompt, data)); }, 1500);
                  } catch { setState(prev => ({ ...prev, isGenerating: false })); }
                } : undefined}
              />
            </div>
          )}
        </div>

        {/* ═══ RIGHT PANEL ═══ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0 }}>
          {/* Agent console */}
          <div style={{ flexGrow: 1, minHeight: 0, borderRadius: '12px', overflow: 'hidden' }}>
            <AgentConsole nodes={history} activeNodeId={activeNodeId} onSelectNode={handleSelectNode} isGenerating={state.isGenerating} currentLogs={state.logs} />
          </div>

          {/* Audit + Iterate */}
          <div className="card" style={{ flexShrink: 0, padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '210px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-emerald)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" /></svg>
              <span className="section-label" style={{ color: 'var(--color-emerald)' }}>Scientific Audit</span>
            </div>
            <div className="custom-scrollbar" style={{
              flexGrow: 1, overflowY: 'auto', minHeight: 0,
              background: 'var(--bg-subtle)', borderRadius: '8px', padding: '8px 10px',
              border: '1px solid var(--border-base)',
              fontSize: '10px', lineHeight: 1.7, color: 'var(--text-secondary)',
            }}>
              {state.critique
                ? state.critique
                : <span style={{ color: 'var(--text-placeholder)', fontStyle: 'italic' }}>Run the pipeline to see the scientific analysis from the Critic Agent...</span>}
            </div>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <textarea
                value={feedbackInput}
                onChange={(e) => setFeedbackInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleUserRefine()}
                placeholder="Request a refinement... (Enter to send)"
                className="vis-textarea"
                style={{ height: '56px' }}
              />
              <button onClick={handleUserRefine} className="btn-icon" style={{ position: 'absolute', right: '7px', bottom: '7px' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default App;
