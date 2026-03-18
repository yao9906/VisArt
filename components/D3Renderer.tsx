
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

const D3Renderer: React.FC<D3RendererProps> = ({ code, containerId, title, data, isLoading, onHover, hoveredCategory }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !code) return;
    const svg = d3.select(containerRef.current).select('svg');
    if (!svg.empty()) {
      svg.selectAll('[data-category]').transition().duration(250)
        .style('opacity', (d: any, i: any, nodes: any) => {
          if (!hoveredCategory) return 1;
          const cat = d3.select(nodes[i]).attr('data-category');
          return cat === hoveredCategory ? 1 : 0.15;
        });
    }
  }, [hoveredCategory, code]);

  useEffect(() => {
    if (!containerRef.current || !code) return;
    setError(null);

    const render = () => {
      if (!containerRef.current) return;
      const { clientWidth: width, clientHeight: height } = containerRef.current;
      if (width === 0 || height === 0) { setTimeout(render, 100); return; }
      containerRef.current.innerHTML = '';

      try {
        const clonedData = JSON.parse(JSON.stringify(data));
        const d3WithPlugins = { ...d3, hexbin, scalePower: d3.scalePow };

        let executeCode;
        try {
          executeCode = new Function('d3', 'containerId', 'data', 'onHover', 'width', 'height', `
            "use strict";
            try { ${code} } catch (e) { console.error("D3 Runtime Error:", e); throw e; }
          `);
        } catch (syntaxErr) {
          setError('Syntax Error: ' + (syntaxErr as any).message);
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
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: '#ffffff',
      border: '1px solid var(--border-base)',
      borderRadius: '12px', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px', flexShrink: 0,
        borderBottom: '1px solid var(--border-base)',
        background: 'var(--bg-subtle)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '7px', height: '7px', borderRadius: '50%',
            background: code ? '#059669' : '#d1d5db',
            boxShadow: code ? '0 0 0 2px rgba(5,150,105,0.2)' : 'none',
            transition: 'all 0.4s',
          }} />
          <span style={{ fontSize: '9.5px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            {title}
          </span>
        </div>
        <span style={{ fontSize: '8px', color: 'var(--text-placeholder)', fontFamily: 'JetBrains Mono, monospace' }}>
          #{containerId}
        </span>
      </div>

      {/* Canvas area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#fafafa' }}>

        {/* Loading state */}
        {isLoading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 20,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(6px)',
          }}>
            <div style={{ position: 'relative', marginBottom: '18px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '50%',
                border: '2px solid rgba(91,110,245,0.15)',
                borderTop: '2px solid var(--accent-primary)',
                animation: 'spin 0.9s linear infinite',
              }} />
              <div style={{
                position: 'absolute', inset: '7px', borderRadius: '50%',
                border: '2px solid rgba(124,93,249,0.12)',
                borderBottom: '2px solid var(--accent-secondary)',
                animation: 'spin 1.4s linear infinite reverse',
              }} />
            </div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-primary)', marginBottom: '4px' }}>
              Agent Synthesizing
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              Applying design constraints...
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            position: 'absolute', top: '12px', left: '12px', right: '12px', zIndex: 30,
            background: 'rgba(254,242,242,1)', border: '1px solid rgba(254,202,202,1)',
            borderRadius: '8px', padding: '10px 12px',
          }}>
            <div style={{ fontSize: '9px', fontWeight: 700, color: '#b91c1c', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ⚠ Execution Error
            </div>
            <div style={{ fontSize: '9px', color: '#7f1d1d', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.6, wordBreak: 'break-all' }}>
              {error}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!code && !isLoading && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100%', gap: '12px',
          }}>
            <div style={{
              width: '56px', height: '56px', borderRadius: '14px',
              background: 'var(--bg-muted)', border: '1px solid var(--border-base)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Canvas Empty</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                Run the pipeline to generate a visualization
              </div>
            </div>
          </div>
        )}

        <div
          id={containerId}
          ref={containerRef}
          style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', touchAction: 'none', opacity: code ? 1 : 0, transition: 'opacity 0.4s' }}
        />

        {/* Hint */}
        {code && (
          <div style={{ position: 'absolute', bottom: '8px', left: '50%', transform: 'translateX(-50%)', fontSize: '8px', color: 'var(--text-placeholder)', letterSpacing: '0.08em', textTransform: 'uppercase', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            Scroll to Zoom · Drag to Pan
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default D3Renderer;
