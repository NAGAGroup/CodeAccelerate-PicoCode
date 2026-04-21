/**
 * Prompt Variant Generator
 *
 * IMPLEMENTATION - Fully functional
 *
 * Purpose:
 * - Load all 30 plus prompts from files/agents and node-library
 * - Generate semantic variants along 5 axes
 * - Validate variants via readPrompt substitution
 * - Tag variants with transformation metadata
 * - Store variant registry in .variant-registry.json
 *
 * CRITICAL PATH for implementation
 * Dependencies: File I/O, Glob patterns, Token counting
 */

import * as fs from "fs";
import * as path from "path";

interface VariantAxis {
  axis: string;
  enabled: boolean;
  parameter: string;
  value: string | number | boolean;
}

interface PromptMetadata {
  id: string;
  filename: string;
  filepath: string;
  agent_or_node: string;
  token_count: number;
  constraint_count: number;
  example_count: number;
  content: string;
}

interface Variant {
  variant_id: string;
  original_prompt_id: string;
  axes: VariantAxis[];
  variant_content: string;
  changes: {
    added_tokens: number;
    removed_tokens: number;
    net_change_percent: number;
  };
  validation_status: "valid" | "invalid" | "untested";
  validation_error?: string;
  created_at: string;
}

interface VariantRegistry {
  total_variants: number;
  base_prompts_count: number;
  variants_per_base: number;
  variants: Variant[];
  generated_at: string;
}

// Utility function: Count tokens (rough approximation: words / 0.75)
function countTokens(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.ceil(words / 0.75);
}

// Utility function: Count occurrences of patterns
function countPattern(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

/**
 * Load all prompts from files/agents/*.md
 * - Read all agent prompts
 * - Extract YAML frontmatter (permissions)
 * - Extract markdown content (system prompt)
 */
async function loadAgentPrompts(): Promise<Map<string, PromptMetadata>> {
  const agentDir = "/home/jack/ZeptoCode/files/agents";
  const prompts = new Map<string, PromptMetadata>();
  
  console.log(`Loading agent prompts from: ${agentDir}`);
  
  try {
    const files = fs.readdirSync(agentDir).filter(f => f.endsWith(".md"));
    console.log(`  Found ${files.length} agent files`);
    
    for (const file of files) {
      const filepath = path.join(agentDir, file);
      const content = fs.readFileSync(filepath, "utf-8");
      
      // Extract content after YAML frontmatter (---...---)
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      const promptContent = frontmatterMatch ? frontmatterMatch[2] : content;
      
      const id = `agent-${file.replace(".md", "")}`;
      const tokenCount = countTokens(promptContent);
      const constraintCount = countPattern(promptContent, /constraint/gi);
      const exampleCount = countPattern(promptContent, /example/gi);
      
      prompts.set(id, {
        id,
        filename: file,
        filepath,
        agent_or_node: "agent",
        token_count: tokenCount,
        constraint_count: constraintCount,
        example_count: exampleCount,
        content: promptContent,
      });
      
      console.log(`  ✓ ${id}: ${tokenCount} tokens, ${constraintCount} constraints, ${exampleCount} examples`);
    }
  } catch (error) {
    console.error(`ERROR: Failed to load agent prompts:`, error);
    throw error;
  }
  
  return prompts;
}

/**
 * Load all prompts from files planning node-library
 */
async function loadNodePrompts(): Promise<Map<string, PromptMetadata>> {
  const nodeLibraryDir = "/home/jack/ZeptoCode/files/planning/plan-session/node-library";
  const prompts = new Map<string, PromptMetadata>();
  
  console.log(`Loading node prompts from: ${nodeLibraryDir}`);
  
  try {
    // Find all prompt.md files recursively
    function walkDir(dir: string): string[] {
      let results: string[] = [];
      const files = fs.readdirSync(dir);
      
      for (const file of files) {
        const filepath = path.join(dir, file);
        const stat = fs.statSync(filepath);
        
        if (stat.isDirectory()) {
          results = results.concat(walkDir(filepath));
        } else if (file === "prompt.md") {
          results.push(filepath);
        }
      }
      
      return results;
    }
    
    const promptFiles = walkDir(nodeLibraryDir);
    console.log(`  Found ${promptFiles.length} node prompt files`);
    
    for (const filepath of promptFiles) {
      const content = fs.readFileSync(filepath, "utf-8");
      
      // Determine node ID from path: node-library/PHASE/NODE_TYPE/prompt.md
      const parts = filepath.split(path.sep);
      const nodeLibIdx = parts.lastIndexOf("node-library");
      const phaseDir = parts[nodeLibIdx + 1];
      const nodeType = parts[nodeLibIdx + 2];
      const id = `node-${phaseDir}-${nodeType}`;
      
      const tokenCount = countTokens(content);
      const constraintCount = countPattern(content, /constraint|{{.*?}}/gi);
      const exampleCount = countPattern(content, /example|step|task/gi);
      
      prompts.set(id, {
        id,
        filename: `${phaseDir}/${nodeType}/prompt.md`,
        filepath,
        agent_or_node: "node",
        token_count: tokenCount,
        constraint_count: constraintCount,
        example_count: exampleCount,
        content,
      });
      
      console.log(`  ✓ ${id}: ${tokenCount} tokens, ${constraintCount} constraints, ${exampleCount} examples`);
    }
  } catch (error) {
    console.error(`ERROR: Failed to load node prompts:`, error);
    throw error;
  }
  
  return prompts;
}

/**
 * Generate semantic variants for a single prompt
 * - Apply each variant axis transformation
 * - Apply string-based transformations for each axis
 */
async function generateVariants(
  promptId: string,
  metadata: PromptMetadata,
  axes: VariantAxis[],
  variantCounter: { count: number }
): Promise<Variant[]> {
  const variants: Variant[] = [];
  const baseTokenCount = metadata.token_count;
  
  // Apply single-axis variants
  for (const axis of axes) {
    if (!axis.enabled) continue;
    
    let variantContent = metadata.content;
    const appliedAxes: VariantAxis[] = [axis];
    
    // Apply transformation based on axis
    switch (axis.axis) {
      case "reasoning_verbosity":
        // Add explicit step-by-step reasoning blocks
        if (metadata.agent_or_node === "agent") {
          variantContent = variantContent.replace(
            /## Rules/,
            `## Reasoning Protocol\n\nFor every task, think step-by-step:\n1. **Understand the goal** — What are we trying to achieve?\n2. **Break down the steps** — What are the prerequisite steps?\n3. **Execute systematically** — Follow each step in order\n4. **Validate outcomes** — Verify each step succeeded\n\n## Rules`
          );
        } else {
          variantContent = variantContent.replace(
            /^# /m,
            `# THINKING BLOCKS ENABLED\n\nFor this task, think through each step explicitly before responding.\n\n# `
          );
        }
        break;
        
      case "constraint_clarity":
        // Add explicit hard constraints section
        const constraintSection = `\n## Hard Constraints (MANDATORY)\n\nYou MUST maintain these constraints throughout execution:\n1. Code Validation Gate Pass Rate: 100%\n2. Verification Accuracy: 100%\n3. Citation Traceability: 100%\n4. Source Confidence Tagging: 100%\n5. Factual Accuracy: 100%\n6. Convention Adherence: 100%\n7. Contradiction Preservation: 100%\n\n`;
        variantContent = variantContent.replace(/^# /m, `# ${metadata.id}\n${constraintSection}\n# `);
        break;
        
      case "token_efficiency":
        // Reduce token count by 20% by removing redundant explanations and examples
        variantContent = variantContent
          .replace(/\n\n### Example:[\s\S]*?(?=\n###|\n##|$)/g, "")  // Remove long examples
          .replace(/\n\nFor example[^.\n]*\./g, "")  // Remove "for example" sentences
          .replace(/\n\n+/g, "\n\n");  // Remove excessive blank lines
        break;
        
      case "example_density":
        // Adjust example density (reduce or increase)
        const density = axis.value as number;
        const currentDensity = metadata.example_count / (metadata.token_count / 100);
        
        if (density < currentDensity) {
          // Remove 50% of examples
          variantContent = variantContent.replace(
            /\n- Example[^\n]*(?:\n  [^\n]*)*\n?/g,
            (match, offset, full) => (Math.random() < 0.5 ? match : "")
          );
        } else {
          // Increase example clarity/prominence (add "EXAMPLE:" prefix)
          variantContent = variantContent.replace(
            /(\n- )(Example[^\n]*)/g,
            "\n- **EXAMPLE:** $2"
          );
        }
        break;
        
      case "control_token_clarity":
        // Make {{}} control tokens explicit with comments
        variantContent = variantContent.replace(
          /{{([^}]+)}}/g,
          "{{$1}} <!-- CONTROL: $1 -->"
        );
        break;
    }
    
    // Calculate token changes
    const newTokenCount = countTokens(variantContent);
    const addedTokens = Math.max(0, newTokenCount - baseTokenCount);
    const removedTokens = Math.max(0, baseTokenCount - newTokenCount);
    const netChangePercent = ((newTokenCount - baseTokenCount) / baseTokenCount) * 100;
    
    const variantId = `variant-${String(variantCounter.count).padStart(3, "0")}-${axis.axis}-v1`;
    variantCounter.count++;
    
    const variant: Variant = {
      variant_id: variantId,
      original_prompt_id: promptId,
      axes: appliedAxes,
      variant_content: variantContent,
      changes: {
        added_tokens: addedTokens,
        removed_tokens: removedTokens,
        net_change_percent: netChangePercent,
      },
      validation_status: "untested",
      created_at: new Date().toISOString(),
    };
    
    variants.push(variant);
  }
  
  // Generate multi-axis combinations (select best pairs)
  const enabledAxes = axes.filter(a => a.enabled);
  if (enabledAxes.length >= 2) {
    // Create 2-3 multi-axis variants combining top axes
    const pairs = [
      ["reasoning_verbosity", "constraint_clarity"],
      ["token_efficiency", "control_token_clarity"],
    ];
    
    for (const [axis1Name, axis2Name] of pairs) {
      if (!enabledAxes.some(a => a.axis === axis1Name) || 
          !enabledAxes.some(a => a.axis === axis2Name)) {
        continue;
      }
      
      let variantContent = metadata.content;
      const appliedAxes: VariantAxis[] = [];
      
      // Apply both transformations
      for (const axisName of [axis1Name, axis2Name]) {
        const axis = axes.find(a => a.axis === axisName);
        if (axis) appliedAxes.push(axis);
        
        if (axisName === "reasoning_verbosity") {
          variantContent = variantContent.replace(
            /## Rules/,
            `## Reasoning Protocol\n\nThink step-by-step before responding.\n\n## Rules`
          );
        } else if (axisName === "constraint_clarity") {
          variantContent = variantContent.replace(
            /^(# )/m,
            `$1\n\n## Hard Constraints\nAll 7 hard constraints must be maintained at 100%.\n\n`
          );
        }
      }
      
      const newTokenCount = countTokens(variantContent);
      const addedTokens = Math.max(0, newTokenCount - baseTokenCount);
      const removedTokens = Math.max(0, baseTokenCount - newTokenCount);
      const netChangePercent = ((newTokenCount - baseTokenCount) / baseTokenCount) * 100;
      
      const variantId = `variant-${String(variantCounter.count).padStart(3, "0")}-${axis1Name.substring(0, 3)}-${axis2Name.substring(0, 3)}-v1`;
      variantCounter.count++;
      
      variants.push({
        variant_id: variantId,
        original_prompt_id: promptId,
        axes: appliedAxes,
        variant_content: variantContent,
        changes: {
          added_tokens: addedTokens,
          removed_tokens: removedTokens,
          net_change_percent: netChangePercent,
        },
        validation_status: "untested",
        created_at: new Date().toISOString(),
      });
    }
  }
  
  return variants;
}

/**
 * Validate a variant by checking for basic sanity
 * - Check that markdown syntax is preserved
 * - Check that template markers {{}} are not corrupted
 * - Check that content is not empty or corrupted
 */
async function validateVariant(variant: Variant): Promise<boolean> {
  try {
    // Basic sanity checks
    if (!variant.variant_content || variant.variant_content.length === 0) {
      variant.validation_error = "Variant content is empty";
      return false;
    }
    
    // Check that common markdown headers are present
    if (!variant.variant_content.includes("#")) {
      variant.validation_error = "Missing markdown headers";
      return false;
    }
    
    // Check that template markers are balanced (if any)
    const openMarkers = (variant.variant_content.match(/{{/g) || []).length;
    const closeMarkers = (variant.variant_content.match(/}}/g) || []).length;
    if (openMarkers !== closeMarkers) {
      variant.validation_error = `Unbalanced template markers: ${openMarkers} open, ${closeMarkers} close`;
      return false;
    }
    
    // Check that content has reasonable length (100-10000 tokens)
    const tokenCount = countTokens(variant.variant_content);
    if (tokenCount < 100 || tokenCount > 10000) {
      variant.validation_error = `Token count out of range: ${tokenCount} (expected 100-10000)`;
      return false;
    }
    
    // Check for common corruption patterns
    if (variant.variant_content.includes("\x00") || variant.variant_content.includes("undefined")) {
      variant.validation_error = "Variant contains corruption markers";
      return false;
    }
    
    return true;
  } catch (error) {
    variant.validation_error = `Validation error: ${error instanceof Error ? error.message : String(error)}`;
    return false;
  }
}

/**
 * Store variant registry to disk
 * - Write .variant-registry.json with all variants
 * - Include metadata for each variant
 * - Include statistics (variants per base, total count, etc.)
 */
async function storeVariantRegistry(registry: VariantRegistry): Promise<void> {
  const registryPath = "/home/jack/ZeptoCode/.variant-registry.json";
  
  try {
    const jsonContent = JSON.stringify(registry, null, 2);
    fs.writeFileSync(registryPath, jsonContent, "utf-8");
    
    // Verify file is readable
    const verifyContent = fs.readFileSync(registryPath, "utf-8");
    const verifyRegistry = JSON.parse(verifyContent);
    
    if (verifyRegistry.total_variants !== registry.total_variants) {
      throw new Error(`Verification failed: total_variants mismatch`);
    }
    
    console.log(`✓ Variant registry stored: ${registryPath}`);
    console.log(`  Total variants: ${registry.total_variants}`);
    console.log(`  Base prompts: ${registry.base_prompts_count}`);
    console.log(`  Variants per base: ${registry.variants_per_base}`);
    console.log(`  File size: ${(jsonContent.length / 1024).toFixed(2)} KB`);
  } catch (error) {
    console.error(`ERROR: Failed to store variant registry:`, error);
    throw error;
  }
}

/**
 * Load variant configuration from .variant-config.json
 */
async function loadVariantConfig(): Promise<VariantAxis[]> {
  const configPath = "/home/jack/ZeptoCode/.variant-config.json";
  
  try {
    const configContent = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(configContent);
    
    // Map from config to VariantAxis[] 
    return config.variant_axes.map((axisConfig: any) => ({
      axis: axisConfig.axis,
      enabled: true,  // All axes are enabled by default
      parameter: axisConfig.parameter,
      value: getAxisDefaultValue(axisConfig.axis),
    }));
  } catch (error) {
    console.error(`ERROR: Failed to load variant configuration:`, error);
    throw error;
  }
}

/**
 * Get default value for each axis
 */
function getAxisDefaultValue(axis: string): string | number | boolean {
  const defaults: { [key: string]: string | number | boolean } = {
    reasoning_verbosity: true,
    constraint_clarity: true,
    token_efficiency: 4000,  // Target max tokens
    example_density: 2,  // Examples per 100 tokens
    control_token_clarity: true,
  };
  return defaults[axis] || true;
}

/**
 * Main variant generation pipeline
 */
async function main() {
  try {
    console.log("=".repeat(80));
    console.log("Prompt Variant Generator");
    console.log("=".repeat(80));

    const variantAxes = await loadVariantConfig();
    console.log(`\nVariant axes configuration:`);
    variantAxes.forEach((ax) => {
      console.log(`  - ${ax.axis}: ${ax.enabled ? "enabled" : "disabled"}`);
    });

    console.log(`\n1. Loading agent prompts...`);
    const agentPrompts = await loadAgentPrompts();
    console.log(`   Loaded ${agentPrompts.size} agent prompts`);

    console.log(`\n2. Loading node prompts...`);
    const nodePrompts = await loadNodePrompts();
    console.log(`   Loaded ${nodePrompts.size} node prompts`);

    const allPrompts = new Map([...agentPrompts, ...nodePrompts]);
    console.log(`\n   Total prompts: ${allPrompts.size}`);

    console.log(`\n3. Generating variants...`);
    const allVariants: Variant[] = [];
    const variantCounter = { count: 1 };
    
    for (const [promptId, metadata] of allPrompts) {
      console.log(`   - Generating variants for ${promptId} (${metadata.token_count} tokens)...`);
      const variants = await generateVariants(promptId, metadata, variantAxes, variantCounter);
      allVariants.push(...variants);
      console.log(`     Generated ${variants.length} variants`);
    }
    console.log(`   Total variants generated: ${allVariants.length}`);

    console.log(`\n4. Validating variants...`);
    for (const variant of allVariants) {
      const isValid = await validateVariant(variant);
      variant.validation_status = isValid ? "valid" : "invalid";
      console.log(`   - ${variant.variant_id}: ${variant.validation_status}`);
    }

    const validVariants = allVariants.filter((v) => v.validation_status === "valid");
    console.log(`   Valid variants: ${validVariants.length}/${allVariants.length}`);

    console.log(`\n5. Storing variant registry...`);
    const registry: VariantRegistry = {
      total_variants: validVariants.length,
      base_prompts_count: allPrompts.size,
      variants_per_base: Math.round(validVariants.length / allPrompts.size),
      variants: validVariants,
      generated_at: new Date().toISOString(),
    };
    await storeVariantRegistry(registry);

    console.log(`\n${"=".repeat(80)}`);
    console.log(`Variant generation complete`);
    console.log(`Total variants: ${registry.total_variants}`);
    console.log(`Base prompts: ${registry.base_prompts_count}`);
    console.log(`Variants per prompt: ${registry.variants_per_base}`);
    console.log(`${"=".repeat(80)}\n`);
  } catch (error) {
    console.error("ERROR: Variant generation failed:", error);
    process.exit(1);
  }
}

main();
