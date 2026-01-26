
import { GoogleGenAI, Type } from "@google/genai";
import { SYSTEM_INSTRUCTIONS } from "../constants";
import { RAGKnowledgeItem, DesignGraphPaper } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
// Use local backend if available, otherwise fallback to mock
const BACKEND_URL = "http://localhost:8000";

// DYNAMIC DATA SCHEMA GENERATOR
const getDataHint = (data: any[]) => {
  if (!data || data.length === 0) return "Data is empty.";
  const sample = data.slice(0, 2);
  const keys = Object.keys(sample[0]);
  return `
CRITICAL DATA INSTRUCTION:
The 'data' variable is provided in the global scope. 
It is a FLAT ARRAY of objects. 
Keys detected in the first row: ${JSON.stringify(keys)}.
Sample Data (First 2 rows): 
${JSON.stringify(sample)}

ADAPTABLE STRATEGY:
- IF the data has 'lat'/'long' or 'x'/'y', use a Coordinate System (Scatterplot/Map).
- IF the data represents a TIME SERIES (has 'date'/'time'), use a temporal axis.
- IF hierarchy is implied (e.g., 'name' field with dots "A.B.C"), manually parse it to build a tree. DO NOT assume it is pre-stratified.
- OTHERWISE, treat as categorical/quantitative data.
DO NOT assume 'data' is a graph object { nodes, links } unless the columns explicitly show source/target.
`;
};

export const getCritiqueAndRetrieve = async (
  code: string, 
  prompt: string,
  designGraph: DesignGraphPaper[] | any[], 
  d3Knowledge: RAGKnowledgeItem[]
): Promise<{ critique: string, ids: string[], graphContext?: any[] }> => {
  const ai = getAI();
  
  // --- REAL GRAPHRAG INTEGRATION ---
  let relevantGraphContext: any[] = [];
  try {
    // Try to fetch from Python Backend
    const ragResponse = await fetch(`${BACKEND_URL}/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: prompt, top_k: 3 })
    });
    
    if (ragResponse.ok) {
        relevantGraphContext = await ragResponse.json();
    } else {
        throw new Error("Backend not available");
    }
  } catch (e) {
    console.warn("GraphRAG Backend offline. Falling back to client-side simulation.");
    
    // --- FALLBACK (Client-Side Simulation) ---
    // 1. Flatten the Graph for the context
    // We extract all "Task Mappings" as independent searchable units
    const tasks = designGraph.flatMap((paper, pIdx) => 
      (paper.mappings || []).map((m: any, mIdx: number) => ({
        id: `task_${pIdx}_${mIdx}`,
        task: m.task_name,
        description: m.task_description,
        technique: m.design_technique,
        rationale: m.rationale,
        system: paper.metadata?.system_name || "Unknown"
      }))
    );
    relevantGraphContext = tasks; // Note: In simplistic simulation, we let Gemini select from ALL tasks, but for fallback logic consistency we assign tasks here.
    // Actually, in fallback mode we pass the full list to Gemini to pick.
    // So we keep the original logic for fallback below.
  }

  // Fallback Logic Setup (if backend failed, we need 'tasks' defined)
  const tasks = designGraph.flatMap((paper, pIdx) => 
    (paper.mappings || []).map((m: any, mIdx: number) => ({
      id: `task_${pIdx}_${mIdx}`,
      task: m.task_name,
      description: m.task_description, // Ensure property name matches what Gemini expects
      technique: m.design_technique,
      rationale: m.rationale,
      system: paper.metadata?.system_name || "Unknown"
    }))
  );

  const d3Summary = d3Knowledge.map(k => ({ 
    id: k.id, 
    title: k.title,
    tags: k.tags 
  }));

  // Construct context string based on source
  let knowledgeContext = "";
  if (relevantGraphContext.length > 0 && relevantGraphContext !== tasks) {
     // Backend Success path
     knowledgeContext = `GraphRAG RETRIEVED KNOWLEDGE (Verified Scientific Tasks):
     ${JSON.stringify(relevantGraphContext.map(t => ({
        "Goal": t.task,
        "Technique": t.technique,
        "Reasoning": t.rationale,
        "ComingFromPaper": t.coming_from_paper,
        "RelatedUses": (t.related_applications || []).join(", ") 
     })))}`;
  } else {
    // Fallback path
    const tasksSummary = JSON.stringify(tasks.map(t => ({ id: t.id, task: t.task, desc: t.description })));
    knowledgeContext = `AVAILABLE VISUALIZATION TASKS (KNOWLEDGE GRAPH NODES): ${tasksSummary}`;
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `
    USER INTENT: "${prompt}"
    CURRENT CODE: ${code}
    
    ${knowledgeContext}
    
    D3 TEMPLATES: ${JSON.stringify(d3Summary)}
    
    Task:
    1. Analyze the User Intent using the Retrieved Knowledge.
    2. If GraphRAG Knowledge is present, USE IT (Technique & Reasoning) to justify your critique.
    3. Identify violations in the Current Code.
    4. Recommend a D3 Template ID for structural upgrade.
    
    Return JSON: { 
      "critique": "string", 
      "relevantTaskIds": ["id1", "id2"], 
      "recommendedD3Id": "id" 
    }`,
    config: { 
      systemInstruction: SYSTEM_INSTRUCTIONS.CRITIC,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          critique: { type: Type.STRING },
          relevantTaskIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendedD3Id: { type: Type.STRING }
        },
        required: ["critique", "relevantTaskIds", "recommendedD3Id"]
      }
    }
  });

  try {
    const result = JSON.parse(response.text || "{}");
    const selectedTaskIds = result.relevantTaskIds || [];
    const bestD3Id = result.recommendedD3Id ? [result.recommendedD3Id] : [];
    
    // If we used backend, relevantGraphContext is already set.
    // If we used fallback, we need to filter the tasks based on Gemini's selection.
    let finalContext = relevantGraphContext;
    if (relevantGraphContext === tasks) {
         finalContext = tasks.filter(t => selectedTaskIds.includes(t.id));
    }

    return {
      critique: result.critique || "Analysis completed.",
      ids: bestD3Id,
      graphContext: finalContext
    };
  } catch (e) {
    console.error("Agent Error", e);
    return { critique: "Error parsing agent response.", ids: [] };
  }
};

export const refineViz = async (
  baseCode: string, 
  critique: string, 
  data: any, 
  retrievedItems: any[], // Can be D3 items or Graph items
  userFeedback?: string,
  isEvolving: boolean = false
): Promise<string> => {
  const ai = getAI();
  
  // Format context flexibly
  const context = retrievedItems.map(item => {
    if (item.task) {
      // It's a Graph Task item
      return {
        type: "DESIGN_PRINCIPLE",
        principle: `Task: ${item.task}. Technique: ${item.technique}. Rationale: ${item.rationale}`
      };
    } else {
      // It's a D3 Template
      return {
        id: item.id,
        title: item.title,
        implementation_logic: item.code || item.rule,
        type: item.type
      };
    }
  });

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `
    ${getDataHint(data)}
    REFERENCE KNOWLEDGE: ${JSON.stringify(context)}
    CRITIQUE: ${critique}
    ${userFeedback ? `USER FEEDBACK: "${userFeedback}"` : ""}
    
    Task: Output refined D3 code for "#enhanced-viz".
    
    STRICT RULES:
    1. DO NOT include any 'import' or 'require' statements.
    2. DO NOT use 'd3.json' or 'd3.csv'. Use the variable 'data' directly.
    3. Use the provided 'width' and 'height' variables for SVG sizing.
    4. Start your code by selecting the container: 'const container = d3.select("#" + containerId);'.
    5. You MUST wrap all elements in a <g class="zoom-container"> for d3.zoom support.
    6. Ensure every mark has a 'data-category' attribute for syncing.
    7. Ensure small values (min 2.5px) are visible.
    8. IF the user asks for a Map or Spatial layout and you detect 'lat'/'long', use d3.geoMercator or d3.scaleLinear (if raw coordinates).
    9. IF dealing with hierarchical names (e.g. "A.B.C"), ONLY THEN use split('.') logic. Do not force it on flat data.
    `,
    config: { systemInstruction: SYSTEM_INSTRUCTIONS.REFINER }
  });
  
  return extractCode(response.text || "");
};

const extractCode = (text: string): string => {
  let code = text;
  const match = text.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
  if (match) code = match[1];
  
  return code
    .replace(/import\s+[\s\S]*?from\s+['"].*?['"];?/g, '')
    .replace(/const\s+d3\s+=\s+require\(.*?\);?/g, '')
    .trim();
};

export const generateStandardViz = async (prompt: string, data: any): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `
    ${getDataHint(data)}
    Generate standard D3 code for data with keys: ${JSON.stringify(Object.keys(data[0] || {}))}.
    Query: "${prompt}".

    RULES: 
    1. No imports. No d3.json. Use 'data' variable directly.
    2. Use 'width' and 'height' variables.
    3. Start by selecting the container: 'const container = d3.select("#" + containerId);'.
    4. The 'data' variable is an ARRAY. Do NOT try to access data.nodes or data.links unless columns imply graph.
    5. Handle parsing formatting if everything is string (from CSV). ensure numbers are converted.
    `,
    config: { systemInstruction: SYSTEM_INSTRUCTIONS.GENERATOR }
  });
  
  return extractCode(response.text || "");
};
