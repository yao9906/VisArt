
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { WorkflowNode, AgentRole } from '../types';

interface WorkflowTreeProps {
  nodes: WorkflowNode[];
  activeNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

const WorkflowTree: React.FC<WorkflowTreeProps> = ({ nodes, activeNodeId, onSelectNode }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const width = 300;
    const height = 60;
    const margin = { top: 10, right: 20, bottom: 10, left: 20 };

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Create hierarchy
    const stratify = d3.stratify<WorkflowNode>()
      .id(d => d.id)
      .parentId(d => d.parentId);

    const root = stratify(nodes);

    // Tree layout (horizontal)
    const treeLayout = d3.tree<WorkflowNode>().size([height - margin.top - margin.bottom, width - margin.left - margin.right]);
    treeLayout(root);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Links
    g.selectAll('.link')
      .data(root.links())
      .enter().append('path')
      .attr('class', 'link')
      .attr('fill', 'none')
      .attr('stroke', '#334155')
      .attr('stroke-width', 1.5)
      .attr('d', d3.linkHorizontal()
        .x((d: any) => d.y)
        .y((d: any) => d.x) as any);

    // Nodes
    const node = g.selectAll('.node')
      .data(root.descendants())
      .enter().append('g')
      .attr('class', 'node')
      .attr('transform', (d: any) => `translate(${d.y},${d.x})`)
      .style('cursor', 'pointer')
      .on('click', (e, d) => onSelectNode(d.data.id));

    // Role colors
    const getRoleColor = (role: AgentRole) => {
      switch (role) {
        case AgentRole.GENERATOR: return '#60a5fa';
        case AgentRole.CRITIC: return '#c084fc';
        case AgentRole.REFINER: return '#34d399';
        default: return '#94a3b8';
      }
    };

    node.append('circle')
      .attr('r', 5)
      .attr('fill', d => getRoleColor(d.data.role))
      .attr('stroke', d => d.data.id === activeNodeId ? '#fff' : 'none')
      .attr('stroke-width', 2)
      .style('filter', d => d.data.id === activeNodeId ? 'drop-shadow(0 0 4px rgba(255,255,255,0.8))' : 'none');

    // Tooltip simulation
    node.append('title')
      .text(d => `${d.data.role}: ${d.data.label}`);

  }, [nodes, activeNodeId, onSelectNode]);

  return (
    <div className="bg-slate-900/80 border border-slate-700 rounded-lg p-1 shadow-inner h-[80px] w-[320px] overflow-hidden flex flex-col">
      <div className="flex justify-between items-center px-2 mb-1">
        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Version History Tree</span>
        <span className="text-[8px] text-slate-600 font-mono">{nodes.length} States</span>
      </div>
      <svg ref={svgRef} width="100%" height="100%" viewBox="0 0 300 60" preserveAspectRatio="xMidYMid meet" />
    </div>
  );
};

export default WorkflowTree;
