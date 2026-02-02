
import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { hexbin } from 'd3-hexbin';

interface D3RendererProps {
  code: string;
  containerId: string;
  title: string;
  data: any;
  isLoading?: boolean;
  onHover?: (category: string | null) => void;
  hoveredCategory?: string | null;
}

const D3Renderer: React.FC<D3RendererProps> = ({ 
  code, 
  containerId, 
  title, 
  data, 
  isLoading, 
  onHover,
  hoveredCategory 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync highlighting based on hoveredCategory
  useEffect(() => {
    if (!containerRef.current || !code) return;
    
    const svg = d3.select(containerRef.current).select('svg');
    if (!svg.empty()) {
      svg.selectAll(`[data-category]`)
         .transition().duration(250)
         .style('opacity', (d: any, i: any, nodes: any) => {
           if (!hoveredCategory) return 1;
           const cat = d3.select(nodes[i]).attr('data-category');
           return cat === hoveredCategory ? 1 : 0.1;
         });
    }
  }, [hoveredCategory, code]);

  useEffect(() => {
    if (!containerRef.current || !code) return;
    setError(null);

    const render = () => {
      if (!containerRef.current) return;
      const { clientWidth: width, clientHeight: height } = containerRef.current;
      
      // Retry if container is not yet measured
      if (width === 0 || height === 0) {
        setTimeout(render, 100);
        return;
      }

      containerRef.current.innerHTML = '';
      
      try {
        // IMPORTANT: Deep clone data to prevent AI-generated code from adding 
        // circular references (like .parent) to the shared React state.
        const clonedData = JSON.parse(JSON.stringify(data));
        
        // Inject plugins and fixes for common AI hallucinations
        const d3WithPlugins = { 
          ...d3, 
          hexbin,
          // AI often hallucinates 'scalePower' instead of 'scalePow'
          scalePower: d3.scalePow 
        };

        // Explicitly pass variables into the isolated function scope
        // Note: We do NOT declare 'container' here to avoid naming conflicts if the LLM code defines it.
        // The LLM is instructed to use d3.select("#" + containerId).
        let executeCode;
        try {
          executeCode = new Function('d3', 'containerId', 'data', 'onHover', 'width', 'height', `
            "use strict";
            try {
              ${code}
            } catch (e) {
              console.error("Inner D3 Runtime Error:", e);
              throw e;
            }
          `);
        } catch (syntaxErr) {
           console.error("D3 Code Syntax Error:", syntaxErr);
           setError("Generated Code Syntax Error: " + (syntaxErr as any).message);
           return;
        }
        
        executeCode(d3WithPlugins, containerId, clonedData, onHover, width, height);
      } catch (err: any) {
        console.error(`D3 Execution Error [${containerId}]:`, err);
        setError(err.message);
      }
    };

    render();
  }, [code, containerId, data]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-white rounded-xl border border-slate-200 overflow-hidden relative group shadow-inner">
      <div className="bg-slate-50/80 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-200 flex justify-between items-center z-10 backdrop-blur-md">
        <span className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${code ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          {title}
        </span>
        <div className="flex items-center gap-3">
           {isLoading && <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />}
           <span className="text-[9px] text-slate-400 font-mono">#{containerId}</span>
        </div>
      </div>
      
      <div className="flex-grow relative min-h-0 overflow-hidden bg-slate-50/30">
        {isLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/60 backdrop-blur-sm transition-all duration-500">
             <div className="w-10 h-10 border-2 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mb-4" />
             <div className="flex flex-col items-center gap-1">
               <span className="text-[10px] text-indigo-600 font-bold uppercase tracking-tighter animate-pulse">Agent is thinking...</span>
               <span className="text-[9px] text-slate-500">Synthesizing D3 Logic</span>
             </div>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-x-4 top-4 z-30 p-3 bg-red-50 border border-red-200 rounded-lg backdrop-blur-md shadow-sm">
            <div className="text-[10px] font-bold text-red-600 uppercase mb-1 text-center">Execution Error</div>
            <div className="text-[9px] text-red-800 font-mono text-center break-words opacity-90">{error}</div>
          </div>
        )}

        {!code && !isLoading && (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2 opacity-60">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-[10px] font-medium tracking-widest uppercase">Canvas Empty</span>
          </div>
        )}

        <div 
          id={containerId} 
          ref={containerRef} 
          className="w-full h-full flex items-center justify-center overflow-hidden transition-opacity duration-700"
          style={{ touchAction: 'none', opacity: code ? 1 : 0 }}
        />
      </div>
      
      {code && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 bg-white/90 px-3 py-1 rounded-full text-[8px] text-slate-500 pointer-events-none border border-slate-200 uppercase tracking-widest whitespace-nowrap shadow-xl scale-95 group-hover:scale-100">
          Scroll to Zoom • Drag to Explore
        </div>
      )}
    </div>
  );
};

export default D3Renderer;
