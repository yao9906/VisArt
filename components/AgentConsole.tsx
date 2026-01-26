
import React, { useEffect, useRef } from 'react';
import { AgentLog, AgentRole, WorkflowNode } from '../types';

interface AgentConsoleProps {
  nodes: WorkflowNode[];
  activeNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  isGenerating: boolean;
  currentLogs: AgentLog[]; // To show logs occurring *before* a node is finalized
}

const AgentConsole: React.FC<AgentConsoleProps> = ({ nodes, activeNodeId, onSelectNode, isGenerating, currentLogs }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [nodes.length, currentLogs.length, isGenerating]);

  // Updated colors for Light Theme
  const getAgentColor = (role: AgentRole) => {
    switch (role) {
      case AgentRole.GENERATOR: return 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100';
      case AgentRole.CRITIC: return 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100';
      case AgentRole.REFINER: return 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
      default: return 'border-slate-200 bg-slate-50 text-slate-600';
    }
  };

  const getRoleIcon = (role: AgentRole) => {
    switch (role) {
      case AgentRole.GENERATOR: return '⚡';
      case AgentRole.CRITIC: return '🧐';
      case AgentRole.REFINER: return '🎨';
      default: return '🤖';
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl flex flex-col h-full shadow-sm overflow-hidden relative group hover:shadow-md transition-shadow">
      <div className="bg-slate-50/80 backdrop-blur-sm px-3 py-2 border-b border-slate-200 z-10">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-sm" />
          Workflow History & Console
        </h3>
      </div>
      
      <div className="flex-grow overflow-y-auto p-3 space-y-3 custom-scrollbar bg-white">
        {nodes.length === 0 && !isGenerating && (
          <div className="text-center py-10 opacity-40">
             <div className="text-2xl mb-2 grayscale">⚡</div>
             <div className="text-[10px] uppercase tracking-widest text-slate-400">Ready to synthesize</div>
          </div>
        )}

        {/* Render History Nodes as Clickable Cards */}
        {nodes.map((node) => {
          const isActive = node.id === activeNodeId;
          const lastLog = node.snapshot.logs[node.snapshot.logs.length - 1];
          
          return (
            <div 
              key={node.id}
              onClick={() => onSelectNode(node.id)}
              className={`
                relative p-3 rounded-lg border cursor-pointer transition-all duration-200 group
                ${isActive ? 'ring-2 ring-indigo-500/30 shadow-md scale-[1.01]' : 'opacity-80 hover:opacity-100'}
                ${getAgentColor(node.role)}
              `}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5">
                  <span>{getRoleIcon(node.role)}</span>
                  {node.role}
                </span>
                <span className="text-[8px] font-mono opacity-60">{new Date(node.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
              </div>
              
              <div className="text-[10px] font-bold mb-1.5">{node.label}</div>
              
              <div className="text-[9px] font-mono leading-relaxed opacity-90 pl-2 border-l border-current/20 line-clamp-4">
                {lastLog?.content || "Processing..."}
              </div>

              {isActive && (
                <div className="absolute -right-1 -top-1 w-2 h-2 bg-indigo-500 rounded-full animate-ping" />
              )}
            </div>
          );
        })}

        {/* Show active processing state if generating but not yet a node */}
        {isGenerating && (
          <div className="p-3 rounded-lg border border-indigo-100 bg-indigo-50/50 animate-pulse">
            <div className="flex items-center gap-2 mb-2">
               <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
               <span className="text-[9px] font-bold text-indigo-600 uppercase">Agent Working...</span>
            </div>
            {currentLogs.length > 0 && (
               <div className="text-[9px] text-slate-500 font-mono pl-2 border-l border-indigo-200">
                 {currentLogs[currentLogs.length - 1].content}
               </div>
            )}
          </div>
        )}
        
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

export default AgentConsole;
