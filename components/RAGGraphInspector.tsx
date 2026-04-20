import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface RAGTraceProps {
    trace: any | null;
}

const normalizeTrace = (trace: any): { query: string; rootNodes: any[]; traversedEdges: any[] } => {
    if (!trace) {
        return { query: "", rootNodes: [], traversedEdges: [] };
    }

    // Legacy single-trace payload
    if (Array.isArray(trace.root_nodes) || Array.isArray(trace.traversed_edges)) {
        return {
            query: trace.query || "",
            rootNodes: Array.isArray(trace.root_nodes) ? trace.root_nodes : [],
            traversedEdges: Array.isArray(trace.traversed_edges) ? trace.traversed_edges : []
        };
    }

    // New subtask payload: aggregate child traces
    if (Array.isArray(trace.traces)) {
        const rootMap = new Map<string, any>();
        const edgeMap = new Map<string, any>();

        trace.traces.forEach((t: any, idx: number) => {
            const child = t?.trace || {};
            const childRoots = Array.isArray(child.root_nodes) ? child.root_nodes : [];
            const childEdges = Array.isArray(child.traversed_edges) ? child.traversed_edges : [];

            childRoots.forEach((n: any) => {
                const id = n?.id || `subtask_root_${idx}`;
                if (!rootMap.has(id)) {
                    rootMap.set(id, { ...n, id, label: n?.label || n?.task || id });
                }
            });

            childEdges.forEach((e: any, eIdx: number) => {
                const s = e?.source || `unknown_s_${idx}_${eIdx}`;
                const tg = e?.target || `unknown_t_${idx}_${eIdx}`;
                const key = `${s}->${tg}`;
                if (!edgeMap.has(key)) {
                    edgeMap.set(key, { ...e, source: s, target: tg });
                }
            });

            // If child trace has no graph nodes, still keep a pseudo node for the subtask.
            if (!childRoots.length) {
                const pseudoId = `subtask_${idx}`;
                if (!rootMap.has(pseudoId)) {
                    rootMap.set(pseudoId, {
                        id: pseudoId,
                        label: t?.query || `Subtask ${idx + 1}`,
                        type: "Subtask"
                    });
                }
            }
        });

        return {
            query: trace.query || trace?.decomposition?.synthesisGoal || "",
            rootNodes: Array.from(rootMap.values()),
            traversedEdges: Array.from(edgeMap.values())
        };
    }

    return { query: trace.query || "", rootNodes: [], traversedEdges: [] };
};

const RAGGraphInspector: React.FC<RAGTraceProps> = ({ trace }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!trace || !svgRef.current) return;

        const normalized = normalizeTrace(trace);

    const width = svgRef.current.clientWidth || 300;
    const height = svgRef.current.clientHeight || 200;
    
    // Clear previous
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Construct Graph Data
    const nodes: any[] = [{ id: "UserQuery", label: "Query", type: "Query", r: 15 }];
    const links: any[] = [];
    const nodeSet = new Set(["UserQuery"]);

    // 1. Vector Search Links (dashed)
        normalized.rootNodes.forEach((n) => {
      if (!nodeSet.has(n.id)) {
                const rawLabel = String(n.label || n.task || n.id || "Node");
                const shortLabel = rawLabel.length > 15 ? `${rawLabel.substring(0, 15)}...` : rawLabel;
                nodes.push({ id: n.id, label: shortLabel, type: n.type === "Subtask" ? "Subtask" : "Task", r: 10, full: rawLabel });
        nodeSet.add(n.id);
      }
      links.push({ source: "UserQuery", target: n.id, type: "similarity", dashed: true });
    });

    // 2. Graph Edges (solid)
        normalized.traversedEdges.forEach(e => {
        if (!nodeSet.has(e.source)) {
            nodes.push({ id: e.source, label: e.source, type:  e.source.startsWith('tech') ? 'Technique' : 'Paper', r: 8 }); 
            nodeSet.add(e.source);
        }
        if (!nodeSet.has(e.target)) {
            nodes.push({ id: e.target, label: e.target, type: e.target.startsWith('tech') ? 'Technique' : 'Node', r: 8 });
            nodeSet.add(e.target);
        }
        links.push({ source: e.source, target: e.target, type: "graph", dashed: false });
    });

    // 3. Simulation
    const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id((d: any) => d.id).distance(50))
        .force("charge", d3.forceManyBody().strength(-150))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide(20));

    // Render
    const g = svg.append("g");
    
    // Links
    const link = g.append("g")
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("stroke", (d: any) => d.dashed ? "#a5b4fc" : "#6366f1")
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", (d: any) => d.dashed ? "3,3" : "");

    // Nodes
    const node = g.append("g")
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", (d: any) => d.r)
        .attr("fill", (d: any) => {
            if (d.type === "Query") return "#10b981"; // User Input
            if (d.type === "Task") return "#f43f5e"; // Vector Result
            if (d.type === "Subtask") return "#0ea5e9";
            if (d.type === "Technique") return "#8b5cf6";
            return "#64748b";
        })
        .call(drag(simulation) as any);

    // Labels
    const labels = g.append("g")
        .selectAll("text")
        .data(nodes)
        .join("text")
        .text((d: any) => d.label)
        .attr("font-size", "7px")
        .attr("text-anchor", "middle")
        .attr("dy", -12)
        .attr("fill", "#475569");

    simulation.on("tick", () => {
        link
            .attr("x1", (d: any) => d.source.x)
            .attr("y1", (d: any) => d.source.y)
            .attr("x2", (d: any) => d.target.x)
            .attr("y2", (d: any) => d.target.y);
        node
            .attr("cx", (d: any) => d.x)
            .attr("cy", (d: any) => d.y);
        labels
            .attr("x", (d: any) => d.x)
            .attr("y", (d: any) => d.y);
    });

    function drag(simulation: any) {
        function dragstarted(event: any) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }
        function dragged(event: any) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }
        function dragended(event: any) {
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
        }
        return d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended);
    }
    
    // Zoom
    const zoom = d3.zoom().on("zoom", (e) => g.attr("transform", e.transform));
    svg.call(zoom as any);

  }, [trace]);

  if (!trace) return <div className="h-full flex items-center justify-center text-xs text-slate-400">Waiting for retrieval...</div>;

  return (
    <div className="w-full h-full relative">
        <svg ref={svgRef} className="w-full h-full" />
        <div className="absolute top-1 right-1 flex flex-col gap-1 pointer-events-none">
             <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-[8px] text-slate-500">Query</span></div>
             <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-rose-500"></div><span className="text-[8px] text-slate-500">Vector Hit</span></div>
             <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-violet-500"></div><span className="text-[8px] text-slate-500">Graph Neighbor</span></div>
        </div>
    </div>
  );
};

export default RAGGraphInspector;
