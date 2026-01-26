
import React, { useState, useEffect, useCallback } from 'react';
import Papa from 'papaparse';
import { AgentRole, AgentLog, VisualizationState, RAGKnowledgeItem, WorkflowNode } from './types';
import { COMPLEX_TEST_DATA } from './constants';
import { generateStandardViz, getCritiqueAndRetrieve, refineViz } from './services/geminiService';
import AgentConsole from './components/AgentConsole';
import D3Renderer from './components/D3Renderer';

const App: React.FC = () => {
  const [data, setData] = useState<any[]>(COMPLEX_TEST_DATA);
  const [userInputPrompt, setUserInputPrompt] = useState<string>('');
  
  const [designRules, setDesignRules] = useState<RAGKnowledgeItem[]>([]); // Keep for backward compat if needed
  const [designGraph, setDesignGraph] = useState<any[]>([]); // New Graph Data
  const [d3Knowledge, setD3Knowledge] = useState<RAGKnowledgeItem[]>([]);
  
  const [history, setHistory] = useState<WorkflowNode[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  const [state, setState] = useState<VisualizationState>({
    originalPrompt: '',
    standardCode: '',
    critique: '',
    refinedCode: '',
    isGenerating: false,
    logs: [],
    retrievedItems: [],
    hoveredCategory: null
  });

  const [activeStep, setActiveStep] = useState<AgentRole | null>(null);
  const [feedbackInput, setFeedbackInput] = useState('');

  // Safe stringify to prevent circular structure crashes in preview
  const safeStringify = (obj: any) => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return "// [Warning] Circular data structure detected in preview.";
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const resetVizState = () => {
      setState(prev => ({ 
        ...prev, 
        standardCode: '', 
        refinedCode: '', 
        critique: '', 
        logs: [],
        retrievedItems: []
      }));
    };

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string; 
      
      if (file.name.toLowerCase().endsWith('.csv')) {
        Papa.parse(content, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => {
             if (results.errors.length > 0 && !results.data.length) {
                alert("CSV Parsing Failed: " + results.errors[0].message);
                return;
             }
             console.log("Parsed CSV Data:", results.data);
             setData(results.data);
             resetVizState();
          }
        });
      } else {
        try {
          const json = JSON.parse(content);
          if (Array.isArray(json)) {
            setData(json);
            resetVizState();
          } else {
            alert("Invalid Data Format: Please upload a JSON Array.");
          }
        } catch (err) {
          alert("Failed to parse JSON file.");
        }
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    const loadJSONL = async (path: string) => {
      try {
        const resp = await fetch(path);
        if (!resp.ok) return [];
        const text = await resp.text();
        return text.split('\n')
          .filter(line => line.trim())
          .map(line => {
            try { return JSON.parse(line); } catch(e) { return null; }
          })
          .filter(Boolean) as RAGKnowledgeItem[];
      } catch (e) {
        return [];
      }
    };

    const loadJSON = async (path: string) => {
      try {
        const resp = await fetch(path);
        if (!resp.ok) return [];
        return await resp.json();
      } catch (e) {
        return [];
      }
    };

    Promise.all([
      loadJSONL('design_rules.jsonl'), // Optional fallback
      loadJSONL('d3_knowledge_base_full.jsonl'),
      loadJSON('vis_design_graph.json')
    ]).then(([rules, kb, graph]) => {
      setDesignRules(rules);
      setD3Knowledge(kb);
      setDesignGraph(graph);
    });
  }, []);

  const addNode = useCallback((role: AgentRole, label: string, parentId: string | null, snapshot: WorkflowNode['snapshot']) => {
    const newNode: WorkflowNode = {
      id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      parentId, label, role, snapshot, timestamp: Date.now()
    };
    setHistory(prev => [...prev, newNode]);
    setActiveNodeId(newNode.id);
    return newNode.id;
  }, []);

  const handleSelectNode = (nodeId: string) => {
    const node = history.find(n => n.id === nodeId);
    if (!node) return;
    setActiveNodeId(nodeId);
    setState(prev => ({ ...prev, ...node.snapshot, isGenerating: false }));
  };

  const runWorkflow = async () => {
    const finalPrompt = userInputPrompt.trim() || 'Map the hierarchical relationships between innovation hubs. Highlight dependencies and ensure extreme value visibility.';
    
    // Reset state for new run but keep history
    setState(prev => ({ 
      ...prev, 
      originalPrompt: finalPrompt, 
      isGenerating: true, 
      logs: [],
      // standardCode: '', // Keep previous visual while loading for better UX? No, clear it.
      standardCode: '',
      refinedCode: '',
      critique: '',
      retrievedItems: [] 
    }));

    try {
      // 1. Baseline
      setActiveStep(AgentRole.GENERATOR);
      const standardCode = await generateStandardViz(finalPrompt, data);
      const standardLogs = [{ role: AgentRole.GENERATOR, content: "Structural baseline synthesized from data schema.", timestamp: Date.now() }];
      
      const genSnapshot = { standardCode, critique: '', refinedCode: '', retrievedItems: [], logs: standardLogs };
      const genId = addNode(AgentRole.GENERATOR, "Baseline", null, genSnapshot);
      setState(prev => ({ ...prev, standardCode, logs: standardLogs }));

      // 2. Critique & Retrieval
      setActiveStep(AgentRole.CRITIC);
      const { critique, ids, graphContext } = await getCritiqueAndRetrieve(standardCode, finalPrompt, designGraph, d3Knowledge);
      
      const d3Found = d3Knowledge.filter(i => ids.includes(i.id));
      const found = [...d3Found, ...(graphContext || [])];
      
      const criticLogs = [...standardLogs, { role: AgentRole.CRITIC, content: `Design Audit: ${critique.substring(0, 150)}...`, timestamp: Date.now() }];
      
      const critSnapshot = { standardCode, critique, refinedCode: '', retrievedItems: found, logs: criticLogs };
      const critId = addNode(AgentRole.CRITIC, "Audit", genId, critSnapshot);
      setState(prev => ({ ...prev, critique, retrievedItems: found, logs: criticLogs }));

      // 3. Refinement
      setActiveStep(AgentRole.REFINER);
      const refinedCode = await refineViz(standardCode, critique, data, found);
      const refinerLogs = [...criticLogs, { role: AgentRole.REFINER, content: "Enhanced D3 implementation complete.", timestamp: Date.now() }];
      
      const refSnapshot = { standardCode, critique, refinedCode, retrievedItems: found, logs: refinerLogs };
      addNode(AgentRole.REFINER, "Refinement", critId, refSnapshot);
      setState(prev => ({ ...prev, refinedCode, logs: refinerLogs }));

    } catch (err) {
      const errorLog = { role: AgentRole.GENERATOR, content: "Workflow Error: " + (err as Error).message, timestamp: Date.now() };
      setState(prev => ({ ...prev, logs: [...prev.logs, errorLog] }));
    } finally {
      setState(prev => ({ ...prev, isGenerating: false }));
      setActiveStep(null);
    }
  };

  const handleUserRefine = async () => {
    if (!feedbackInput.trim() || state.isGenerating) return;
    const feedback = feedbackInput;
    setFeedbackInput('');
    setState(prev => ({ ...prev, isGenerating: true }));
    setActiveStep(AgentRole.REFINER);

    try {
      const isEvolving = !!state.refinedCode;
      const base = isEvolving ? state.refinedCode : state.standardCode;
      const newCode = await refineViz(base, state.critique, data, state.retrievedItems, feedback, isEvolving);
      
      const iterationLogs = [...state.logs, { role: AgentRole.REFINER, content: `Manual Iteration: ${feedback}`, timestamp: Date.now() }];
      addNode(AgentRole.REFINER, "Iteration", activeNodeId, {
        standardCode: state.standardCode,
        critique: state.critique,
        refinedCode: newCode,
        retrievedItems: state.retrievedItems,
        logs: iterationLogs
      });
      setState(prev => ({ ...prev, refinedCode: newCode, logs: iterationLogs }));
    } catch (err) {
      console.error(err);
    } finally {
      setState(prev => ({ ...prev, isGenerating: false }));
      setActiveStep(null);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50 text-slate-800 overflow-hidden font-sans">
      {/* Compressed Header */}
      <header className="border-b border-slate-200 bg-white px-4 py-2 flex items-center justify-between shrink-0 shadow-sm z-30">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-gradient-to-br from-indigo-500 to-purple-600 rounded shadow-md shadow-indigo-500/20">
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight leading-none text-slate-800">VizArt <span className="text-slate-400 font-light italic">RAG-Lab</span></h1>
          </div>
        </div>

        <div className="text-[9px] text-slate-400 font-mono border border-slate-100 px-2 py-1 rounded bg-slate-50">
          Knowledge: {designRules.length + d3Knowledge.length} Items | RAG Ready
        </div>
      </header>

      {/* Compressed Control Bar */}
      <div className="bg-white/80 backdrop-blur-md border-b border-slate-200 px-4 py-2 shrink-0 z-20">
        <div className="flex gap-2">
          <div className="relative flex-grow">
            <input 
              type="text"
              value={userInputPrompt}
              onChange={(e) => setUserInputPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runWorkflow()}
              placeholder="Map innovation hubs and dependencies..."
              className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-400 shadow-inner"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] text-slate-400 font-mono pointer-events-none uppercase tracking-tighter">Enter to Analyze</div>
          </div>
          <button 
            onClick={runWorkflow}
            disabled={state.isGenerating}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg font-bold text-[10px] uppercase tracking-widest text-white transition-all shadow-md shadow-indigo-600/20 whitespace-nowrap active:scale-95"
          >
            {state.isGenerating ? "Processing" : "Run Pipeline"}
          </button>
        </div>
      </div>

      {/* Expanded Main Content Area */}
      <main className="flex-grow p-4 grid grid-cols-12 gap-4 min-h-0 bg-slate-50/50">
        {/* Left Column: Data & Context */}
        <div className="col-span-3 flex flex-col gap-4 min-h-0">
          <section className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm h-32 shrink-0 flex flex-col relative group hover:shadow-md transition-shadow">
             <div className="flex justify-between items-center mb-2 shrink-0">
                <h2 className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Data Feed</h2>
                <label className="cursor-pointer text-[9px] bg-slate-100 hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 px-2 py-0.5 rounded border border-slate-200 hover:border-indigo-200 transition-all flex items-center gap-1 group/btn">
                  <span>📂 Import CSV/JSON</span>
                  <input type="file" accept=".json,.csv" className="hidden" onChange={handleFileUpload} />
                </label>
             </div>
             <div className="overflow-auto custom-scrollbar flex-grow bg-slate-50 rounded-lg p-2 font-mono text-[8px] text-slate-600 border border-slate-100 whitespace-pre">
                {safeStringify(data)}
             </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex-grow flex flex-col min-h-0 group hover:shadow-md transition-shadow">
            <h2 className="text-[9px] font-black text-indigo-500 uppercase mb-2 tracking-widest flex items-center gap-2 shrink-0">
              RAG Grounding
            </h2>
            <div className="overflow-y-auto space-y-2 custom-scrollbar pr-1 flex-grow">
              {state.retrievedItems.map((item: any, i) => (
                <div key={i} className="bg-indigo-50/50 border border-indigo-100 rounded-md p-2 hover:bg-indigo-50 transition-colors cursor-help group">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[7px] uppercase text-indigo-600 font-black px-1 py-0.5 bg-indigo-100 rounded tracking-tighter">
                      {item.type || (item.technique ? 'GRAPH-RAG' : 'KNOWLEDGE')}
                    </span>
                    <span className="text-[7px] text-slate-400 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                      {item.id || `#${i}`}
                    </span>
                  </div>
                  <h4 className="text-[10px] font-bold text-slate-700 leading-tight mb-0.5">
                    {item.task || item.title || item.topic || "Context Item"}
                  </h4>
                  
                  <div className="text-[8px] text-slate-500">
                     {item.technique && (
                        <div className="mb-0.5 text-indigo-800/80 font-mono">
                           &lt;{item.technique}&gt;
                        </div>
                     )}
                     <p className="italic line-clamp-3">
                        {item.rationale || item.description || item.rule || item.evidence || "Retrieved context."}
                     </p>
                     {item.coming_from_paper && (
                        <div className="mt-1 opacity-60 text-[7px] border-t border-indigo-200/50 pt-1 flex items-center gap-1">
                            <span>📄</span> {item.coming_from_paper}
                        </div>
                     )}
                  </div>
                </div>
              ))}
              {state.retrievedItems.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 italic text-[9px] text-center">
                  No context items yet.
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Center Column: Visualizations (Maximizing Height) */}
        <div className="col-span-6 flex flex-col gap-4 min-h-0">
          <div className="flex-1 min-h-0 shadow-sm rounded-xl">
            <D3Renderer 
              title="Phase 1: Baseline" 
              containerId="standard-viz" 
              code={state.standardCode} 
              data={data} 
              isLoading={activeStep === AgentRole.GENERATOR} 
              onHover={(cat) => setState(s => ({ ...s, hoveredCategory: cat }))} 
              hoveredCategory={state.hoveredCategory} 
            />
          </div>
          <div className="flex-[1.5] min-h-0 shadow-sm rounded-xl">
            <D3Renderer 
              title="Phase 3: Scientific Refinement" 
              containerId="enhanced-viz" 
              code={state.refinedCode} 
              data={data} 
              isLoading={state.isGenerating && activeStep !== AgentRole.GENERATOR} 
              onHover={(cat) => setState(s => ({ ...s, hoveredCategory: cat }))} 
              hoveredCategory={state.hoveredCategory} 
            />
          </div>
        </div>

        {/* Right Column: Console & Feedback */}
        <div className="col-span-3 flex flex-col gap-4 min-h-0">
          <div className="flex-grow min-h-0 shadow-sm rounded-xl">
            <AgentConsole 
              nodes={history} 
              activeNodeId={activeNodeId} 
              onSelectNode={handleSelectNode}
              isGenerating={state.isGenerating}
              currentLogs={state.logs}
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col h-1/3 min-h-[150px] overflow-hidden shadow-sm relative hover:shadow-md transition-shadow">
            <h2 className="text-[9px] font-black text-emerald-600 uppercase mb-2 tracking-widest flex items-center gap-2 shrink-0">
              Scientific Audit
            </h2>
            <div className="flex-grow overflow-y-auto text-[10px] text-slate-600 mb-2 leading-relaxed custom-scrollbar bg-slate-50 rounded-lg p-2 border border-slate-100">
              {state.critique ? state.critique : <span className="text-slate-400 italic">Analysis pending...</span>}
            </div>
            <div className="relative shrink-0">
              <textarea 
                value={feedbackInput}
                onChange={(e) => setFeedbackInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleUserRefine()}
                placeholder="Iterate..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-[10px] text-slate-800 focus:bg-white focus:ring-1 focus:ring-indigo-500 outline-none h-12 resize-none transition-all placeholder:text-slate-400"
              />
              <button onClick={handleUserRefine} className="absolute right-1 bottom-1.5 p-1 bg-indigo-600 hover:bg-indigo-700 rounded text-white shadow transition-all active:scale-90">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
