
import fs from 'fs';

try {
    const raw = fs.readFileSync('designrag.txt', 'utf8');
    // Basic cleanup: remove trailing commas if any, ensure valid JSON list
    // The user said it's "extracted", might be just concatenated JSON objects
    // "}{" pattern -> "},{"
    let fixed = raw.trim();

    // Fix: Remove [cite_start] tags
    fixed = fixed.replace(/\[cite_start\]/g, '');

    // Remove trailing comma if present at the end of the string (before we maybe add ])
    if (fixed.endsWith(',')) fixed = fixed.slice(0, -1);
    
    // If it looks like { ... } { ... } (no commas)
    if (fixed.includes('}\n{') || fixed.includes('}{')) {
       fixed = fixed.replace(/}\s*{/g, '}, {');
    }
    
    // Fix: If it's just a comma separated list without brackets
    if (!fixed.startsWith('[')) fixed = '[' + fixed;
    if (!fixed.endsWith(']')) fixed = fixed + ']';
    
    // Validate
    JSON.parse(fixed); 
    
    fs.writeFileSync('vis_design_graph.json', fixed);
    console.log("Successfully created vis_design_graph.json");
} catch (e) {
    console.error("Error parsing JSON:", e.message);
    // Fallback: Try to rescue if it has trailing commas
    try {
        const raw = fs.readFileSync('designrag.txt', 'utf8').trim();
        // Remove known bad patterns if any
        let fixed = '[' + raw.replace(/,(\s*[\}\]])/g, '$1') + ']';
        JSON.parse(fixed);
        fs.writeFileSync('vis_design_graph.json', fixed);
        console.log("Successfully recovered and created vis_design_graph.json");
    } catch (e2) {
        console.error("Fatal Parse Error:", e2.message);
    }
}
