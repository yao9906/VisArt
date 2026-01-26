# VizArt AI Agent Instructions

## Project Overview
VizArt is a **React + Vite + D3** application that uses **Google Gemini models** to generate, critique, and refine data visualizations. It features an automated workflow (Generator -> Critic -> Refiner) and renders D3 code in a sandboxed environment.

## Architecture & Core Components

- **State Management**: `App.tsx` manages the workflow state (`VisualizationState`), history (`workflowTree`), and orchestrates the AI agent pipeline.
- **AI Services**: `services/geminiService.ts` handles interactions with Gemini.
  - Uses `gemini-3-flash-preview` for generation and `gemini-3-flash-preview` for critique/refinement.
  - Implements a specialized "extractCode" logic to clean markdown and imports.
- **Rendering**: `components/D3Renderer.tsx` executes the generated code.
  - **Mechanism**: `new Function` with isolated scope.
  - **Inputs**: `d3`, `containerId`, `data`, `width`, `height`, `onHover`.
  - **Safety**: `data` is deep-cloned to prevent mutation of shared React state.

## Critical Development Rules

### 1. D3 Code Generation Logic (AI Prompts)
When modifying prompts in `services/geminiService.ts` or `constants.ts`, strict constraints apply to the generated D3 code:
- **No Imports**: Code must NOT contain `import`, `require`, or `d3.json`/`d3.csv`.
- **Global Scope**: `d3` is globally available.
- **Entry Point**: Must start with `const container = d3.select("#" + containerId);`.
- **Sizing**: Use provided `width` and `height` variables.
- **Data Handling**:
  - The `data` variable is a **FLAT ARRAY** of objects.
  - Hierarchy is implied by dot-notation in the `name` field (e.g., `"Ecosystem.BioTech.Lab"`).
  - **Constraint**: The D3 code MUST manually parse this string structure to build hierarchies (using `d3.stratify` carefully or custom logic) as intermediate nodes might be missing.

### 2. Data Flow & RAG
- **Design Rules**: Loaded from `design_rules.jsonl` (Scientific visualization rules).
- **Knowledge Base**: Loaded from `d3_knowledge_base_full.jsonl` (Code templates).
- **Retrieval**: The `Critic` step retrieves relevant rule IDs, which are then passed to the `Refiner`.

### 3. Conventions
- **Interactivity**: Generated code should report hover states via the `onHover` callback and use the `data-category` attribute for CSS-based highlighting (controlled by `D3Renderer`).
- **Styling**: Tailwind CSS is used for the application UI, but D3 visualizations use internal styles or inline attributes.

## Developer Workflow

### Setup
- **Env**: `.env.local` requires `GEMINI_API_KEY`.
- **Run**: `npm run dev` starts the Vite server.

### Debugging
- **Common Issue**: "D3 Execution Error" usually means the generated code tried to access `data.nodes` (assuming graph) instead of the flat array, or failed to handle the string-parsing for hierarchy.
- **Console**: Check the browser console for "Inner D3 Runtime Error".

## Directory Structure
- `components/`: UI and Renderer components.
- `services/`: AI logic and API calls.
- `*.jsonl`: Knowledge base files for RAG.
