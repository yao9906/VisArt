
import React, { useEffect, useRef } from 'react';
import { AgentLog, AgentRole, WorkflowNode } from '../types';

interface AgentConsoleProps {
  nodes: WorkflowNode[];
  activeNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  isGenerating: boolean;
  currentLogs: AgentLog[];
}

const roleConfig: Record<string, { color: string; bg: string; border: string; label: string; icon: JSX.Element }> = {
  [AgentRole.CRITIC]: {
    color: '#4a5ce4', bg: 'rgba(91,110,245,0.06)', border: 'rgba(91,110,245,0.25)', label: 'Critic',
    icon: <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
  },
  [AgentRole.REFINER]: {
    color: '#059669', bg: 'rgba(5,150,105,0.06)', border: 'rgba(5,150,105,0.25)', label: 'Refiner',
    icon: <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>,
  },
  [AgentRole.GENERATOR]: {
    color: '#0891b2', bg: 'rgba(8,145,178,0.06)', border: 'rgba(8,145,178,0.25)', label: 'Generator',
    icon: <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>,
  },
};

const AgentConsole: React.FC<AgentConsoleProps> = ({ nodes, activeNodeId, onSelectNode, isGenerating, currentLogs }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [nodes.length, currentLogs.length, isGenerating]);

  const getCfg = (role: AgentRole) => roleConfig[role] || { color: '#64748b', bg: 'rgba(100,116,139,0.06)', border: 'rgba(100,116,139,0.2)', label: String(role), icon: <span>◈</span> };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#ffffff',
      border: '1px solid var(--border-base)',
      borderRadius: '12px', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 13px', flexShrink: 0,
        borderBottom: '1px solid var(--border-base)',
        background: 'var(--bg-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>
            Workflow Console
          </span>
        </div>
        <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          {nodes.length} node{nodes.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Node list */}
      <div className="custom-scrollbar" style={{ flexGrow: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>

        {nodes.length === 0 && !isGenerating && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 0', gap: '10px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: 'var(--bg-muted)', border: '1px solid var(--border-base)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', fontWeight: 600 }}>
              No workflow nodes yet
            </span>
          </div>
        )}

        {nodes.length > 0 && (
          <div style={{ position: 'relative' }}>
            {/* Timeline connector */}
            {nodes.length > 1 && (
              <div style={{ position: 'absolute', left: '13px', top: '20px', bottom: '10px', width: '1px', background: 'linear-gradient(to bottom, var(--border-soft), transparent)', pointerEvents: 'none' }} />
            )}

            {nodes.map((node, idx) => {
              const isActive = node.id === activeNodeId;
              const cfg = getCfg(node.role);
              const lastLog = node.snapshot.logs?.[node.snapshot.logs.length - 1];
              const time = new Date(node.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

              return (
                <div key={node.id} style={{ display: 'flex', gap: '8px', marginBottom: idx === nodes.length - 1 ? 0 : '6px', alignItems: 'flex-start' }}>
                  {/* Role icon dot */}
                  <div style={{
                    width: '26px', height: '26px', borderRadius: '7px', flexShrink: 0,
                    background: isActive ? cfg.bg : 'var(--bg-muted)',
                    border: `1px solid ${isActive ? cfg.border : 'var(--border-base)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: isActive ? cfg.color : 'var(--text-muted)',
                    cursor: 'pointer', transition: 'all 0.18s',
                    zIndex: 1,
                  }} onClick={() => onSelectNode(node.id)}>
                    {cfg.icon}
                  </div>

                  {/* Card */}
                  <div
                    onClick={() => onSelectNode(node.id)}
                    className={`workflow-node${isActive ? ' active' : ''}`}
                    style={{ flex: 1, position: 'relative' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: cfg.color }}>
                          {cfg.label}
                        </span>
                        <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-primary)' }}>· {node.label}</span>
                      </div>
                      <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{time}</span>
                    </div>
                    <div style={{
                      fontSize: '9px', lineHeight: 1.55, color: 'var(--text-muted)',
                      fontFamily: 'JetBrains Mono, monospace',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
                    }}>
                      {lastLog?.content || 'Processing...'}
                    </div>
                    {isActive && (
                      <div style={{ position: 'absolute', top: '-3px', right: '-3px', width: '7px', height: '7px', borderRadius: '50%', background: cfg.color, boxShadow: `0 0 0 2px ${cfg.bg}, 0 0 0 3px ${cfg.border}` }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Live generation */}
        {isGenerating && (
          <div style={{
            background: 'rgba(91,110,245,0.04)', border: '1px solid rgba(91,110,245,0.18)',
            borderRadius: '8px', padding: '10px 12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
              <div style={{
                width: '14px', height: '14px', borderRadius: '50%',
                border: '2px solid rgba(91,110,245,0.15)',
                borderTop: '2px solid var(--accent-primary)',
                animation: 'spin 0.8s linear infinite', flexShrink: 0,
              }} />
              <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--accent-primary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Agent Processing
              </span>
            </div>
            {currentLogs.length > 0 && (
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', paddingLeft: '8px', borderLeft: '2px solid rgba(91,110,245,0.2)', lineHeight: 1.5 }}>
                {currentLogs[currentLogs.length - 1].content}
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default AgentConsole;
