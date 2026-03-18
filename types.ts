
export enum AgentRole {
  GENERATOR = 'Generator',
  CRITIC = 'Critic (RAG-Enabled)',
  REFINER = 'Refiner'
}

export interface AgentLog {
  role: AgentRole;
  content: string;
  timestamp: number;
}

export interface DesignGraphItem {
  task_name: string;
  task_description: string;
  design_technique: string;
  visual_encoding: string;
  rationale: string;
  interaction?: string | null;
}

export interface DesignGraphPaper {
  metadata: {
    domain: string;
    system_name: string;
  };
  core_metaphor: string;
  mappings: DesignGraphItem[];
}

export interface RAGKnowledgeItem {
  id: string;
  type: string;
  title?: string;
  topic?: string;
  rule?: string;
  condition?: string;
  evidence?: string;
  code?: string; // 来自 d3 知识库的代码片段
  source?: string;
  tags?: string[];
}

export interface RuleHit {
  topic: string;
  condition: string;
  rule: string;
  source: string;
  score: number;
  matchedKeywords: string[];
  reason: string;
}

export interface RuleHitsByLane {
  design: RuleHit[];
  color: RuleHit[];
  interaction: RuleHit[];
}

export interface VisualizationState {
  originalPrompt: string;
  standardCode: string;
  critique: string;
  refinedCode: string;
  isGenerating: boolean;
  logs: AgentLog[];
  retrievedItems: RAGKnowledgeItem[] | any[];
  ruleHits?: RuleHitsByLane;
  hoveredCategory: string | null;
  ragTrace?: any;
  analysis?: {
    insight: string;
    nextSteps: string;
  };
}

export interface WorkflowNode {
  id: string;
  parentId: string | null;
  label: string;
  role: AgentRole;
  snapshot: {
    standardCode: string;
    critique: string;
    refinedCode: string;
    retrievedItems: RAGKnowledgeItem[] | any[];
    ruleHits?: RuleHitsByLane;
    logs: AgentLog[];
    ragTrace?: any;
    analysis?: {
      insight: string;
      nextSteps: string;
    };
  };
  timestamp: number;
}
