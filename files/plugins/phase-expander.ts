/**
 * phase-expander.ts
 *
 * Generic declarative expander. Compiles a phase-based plan (schema 4.0) into
 * a flat node graph (schema 3.0) by reading phase-spec.jsonl and
 * phase-schema.toml from the node-library for each phase type.
 *
 * Two-pass process:
 *   Pass 1 — expandPhase(): load spec, build nodes, track exit slots
 *   Pass 2 — wire(): connect exit slots to the next phase's entry node
 */

import * as fs from "fs";
import * as path from "path";
import { CONFIG_ROOT } from "./constants";
import type { PhaseRecord, DagNodeV3, DagMetadataV3 } from "./types";

// Sentinel used in children[] to mark unresolved inter-phase exit slots
const EXIT = "EXIT";

// ─── Node library helpers ─────────────────────────────────────────────────────

export function nodeLibPath(phaseType: string, componentType: string): string {
  return path.join(
    CONFIG_ROOT,
    "planning",
    "plan-session",
    "node-library",
    phaseType,
    componentType,
  );
}

function phaseLibPath(phaseType: string): string {
  return path.join(
    CONFIG_ROOT,
    "planning",
    "plan-session",
    "node-library",
    phaseType,
  );
}

// ─── Phase type discovery ─────────────────────────────────────────────────────

/** Returns all phase types available in the node-library (directory names). */
export function getAvailablePhaseTypes(): string[] {
  const nodeLibRoot = path.join(
    CONFIG_ROOT,
    "planning",
    "plan-session",
    "node-library",
  );
  return fs
    .readdirSync(nodeLibRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

/** Returns all user-authorable phase types (excludes entry-phase). */
export function getValidPhaseTypes(): string[] {
  return getAvailablePhaseTypes().filter((t) => t !== "entry-phase");
}

// ─── Phase schema loading ─────────────────────────────────────────────────────

interface FieldSchema {
  type: "scalar" | "list";
  required: boolean;
}

interface PhaseSchema {
  fields: Record<string, FieldSchema>;
}

const schemaCache = new Map<string, PhaseSchema>();

export function loadPhaseSchema(phaseType: string): PhaseSchema {
  if (schemaCache.has(phaseType)) return schemaCache.get(phaseType)!;
  const schemaPath = path.join(phaseLibPath(phaseType), "phase-schema.toml");
  if (!fs.existsSync(schemaPath)) {
    return { fields: {} };
  }
  const parsed = Bun.TOML.parse(fs.readFileSync(schemaPath, "utf-8")) as any;
  const schema: PhaseSchema = { fields: {} };
  for (const [name, def] of Object.entries(parsed.fields ?? {})) {
    const d = def as any;
    schema.fields[name] = {
      type: d.type === "list" ? "list" : "scalar",
      required: d.required === true,
    };
  }
  schemaCache.set(phaseType, schema);
  return schema;
}

// ─── Node spec loading ────────────────────────────────────────────────────────

interface NodeSpec {
  enforcement: string[];
  promptPath: string;
}

const nodeSpecCache = new Map<string, NodeSpec>();

function loadNodeSpec(phaseType: string, componentType: string): NodeSpec {
  const cacheKey = `${phaseType}/${componentType}`;
  if (nodeSpecCache.has(cacheKey)) return nodeSpecCache.get(cacheKey)!;
  const dir = nodeLibPath(phaseType, componentType);
  const specPath = path.join(dir, "node-spec.json");
  const promptPath = path.join(dir, "prompt.md");
  if (!fs.existsSync(specPath)) {
    throw new Error(
      `Node spec not found for "${phaseType}/${componentType}" at ${specPath}`,
    );
  }
  const spec = JSON.parse(fs.readFileSync(specPath, "utf-8")) as {
    enforcement: string[];
  };
  const result = { enforcement: spec.enforcement, promptPath };
  nodeSpecCache.set(cacheKey, result);
  return result;
}

// ─── Phase spec loading ───────────────────────────────────────────────────────

interface PhaseSpecNode {
  id: string;
  phase_type: string;
  component: string;
  children: string[];
  conditions: string[];
  inject: Record<string, string>;
}

const phaseSpecCache = new Map<string, PhaseSpecNode[]>();

function loadPhaseSpec(phaseType: string): PhaseSpecNode[] {
  if (phaseSpecCache.has(phaseType)) return phaseSpecCache.get(phaseType)!;
  const specPath = path.join(phaseLibPath(phaseType), "phase-spec.jsonl");
  if (!fs.existsSync(specPath)) {
    throw new Error(`Phase spec not found for type "${phaseType}" at ${specPath}`);
  }
  const lines = fs.readFileSync(specPath, "utf-8").split("\n").filter((l) => l.trim());
  const nodes = lines.map((line) => JSON.parse(line) as PhaseSpecNode);
  phaseSpecCache.set(phaseType, nodes);
  return nodes;
}

// ─── Inject map construction ──────────────────────────────────────────────────

function toInjectKey(fieldName: string): string {
  return fieldName.toUpperCase().replace(/-/g, "_");
}

function bullets(items: string[]): string {
  return items.map((q) => `- ${q}`).join("\n");
}

/**
 * Builds the uniform inject map for all nodes in a phase expansion.
 * Every TOML field is included: scalars as strings, lists as bullet points.
 * The phase id, type, and next (children) are also injected.
 */
function buildInjectMap(phase: PhaseRecord): Record<string, string> {
  const inject: Record<string, string> = {};

  // Always-present structural fields
  inject["PHASE_ID"] = phase.phase;
  inject["TYPE"] = phase.phase_type;
  inject["NEXT"] = phase.children.length > 0
    ? bullets(phase.children)
    : "";

  // All phase_options fields
  const schema = loadPhaseSchema(phase.phase_type);
  for (const [field, value] of Object.entries(phase.phase_options)) {
    const key = toInjectKey(field);
    const fieldDef = schema.fields[field];
    const isList = fieldDef?.type === "list" || Array.isArray(value);
    if (isList && Array.isArray(value)) {
      inject[key] = bullets(value as string[]);
    } else {
      inject[key] = String(value ?? "");
    }
  }

  return inject;
}

// ─── Phase expansion ──────────────────────────────────────────────────────────

interface PhaseExpansion {
  entryNodeId: string;
  nodes: DagNodeV3[];
  exitSlots: Array<{ nodeId: string; childIndex: number }>;
}

function expandPhase(phase: PhaseRecord): PhaseExpansion {
  const specNodes = loadPhaseSpec(phase.phase_type);
  const injectMap = buildInjectMap(phase);

  // Resolve {{PHASE_ID}} in a string
  const resolve = (s: string) => s.replaceAll("{{PHASE_ID}}", phase.phase);

  // Evaluate conditions: all named fields must be non-empty in phase_options
  const isIncluded = (specNode: PhaseSpecNode): boolean => {
    if (specNode.conditions.length === 0) return true;
    return specNode.conditions.every((field) => {
      const val = phase.phase_options[field];
      if (val === undefined || val === null) return false;
      if (Array.isArray(val)) return val.length > 0;
      return String(val).trim().length > 0;
    });
  };

  // Determine which spec nodes are included after condition evaluation
  const included = specNodes.filter(isIncluded);
  const includedIds = new Set(included.map((n) => resolve(n.id)));

  const nodes: DagNodeV3[] = [];
  const exitSlots: Array<{ nodeId: string; childIndex: number }> = [];

  for (const specNode of included) {
    const nodeId = resolve(specNode.id);
    const { enforcement, promptPath } = loadNodeSpec(specNode.phase_type, specNode.component);

    // Resolve children: skip excluded intra-phase nodes by following the chain forward
    const resolvedChildren = specNode.children.map((child) => {
      if (child === EXIT) return EXIT;
      let target = resolve(child);
      // If target was excluded, walk forward through the spec until we find
      // an included node or EXIT
      if (!includedIds.has(target)) {
        target = resolveSkipped(target, specNodes, includedIds, phase.phase, resolve);
      }
      return target;
    });

    const node: DagNodeV3 = {
      id: nodeId,
      prompt: promptPath,
      enforcement,
      component: specNode.component,
    };

    // Merge spec inject (reserved for future per-node overrides) with phase inject
    const nodeInject = Object.keys(specNode.inject).length > 0
      ? { ...injectMap, ...specNode.inject }
      : injectMap;

    if (Object.keys(nodeInject).length > 0) node.inject = nodeInject;

    if (resolvedChildren.length > 0) {
      node.children = resolvedChildren;
      resolvedChildren.forEach((child, i) => {
        if (child === EXIT) exitSlots.push({ nodeId, childIndex: i });
      });
    }

    nodes.push(node);
  }

  const entryNodeId = nodes.length > 0 ? nodes[0].id : "";
  return { entryNodeId, nodes, exitSlots };
}

/**
 * When a node was excluded by conditions, walk forward through the spec chain
 * to find the next included node (or EXIT if none found).
 */
function resolveSkipped(
  targetId: string,
  specNodes: PhaseSpecNode[],
  includedIds: Set<string>,
  _phaseId: string,
  resolve: (s: string) => string,
): string {
  // Find the excluded spec node and follow its first non-EXIT child
  const visited = new Set<string>();
  let current = targetId;
  while (!includedIds.has(current)) {
    if (visited.has(current)) return EXIT; // cycle guard
    visited.add(current);
    const specNode = specNodes.find((n) => resolve(n.id) === current);
    if (!specNode) return EXIT;
    const firstChild = specNode.children[0];
    if (!firstChild || firstChild === EXIT) return EXIT;
    current = resolve(firstChild);
  }
  return current;
}

// ─── Main compiler ────────────────────────────────────────────────────────────

export function compilePhasesToNodes(
  planId: string,
  phases: PhaseRecord[],
  entryPhaseId: string,
): { metadata: DagMetadataV3; nodes: DagNodeV3[] } {
  // Prepend the auto-injected entry-phase
  const entryPhaseRecord: PhaseRecord = {
    phase: "execution-kickoff",
    phase_type: "entry-phase" as any,
    phase_options: {},
    children: [entryPhaseId],
  };
  const allPhases = [entryPhaseRecord, ...phases];

  const expansions = new Map<string, PhaseExpansion>();
  for (const phase of allPhases) {
    expansions.set(phase.phase, expandPhase(phase));
  }

  const phaseMap = new Map<string, PhaseRecord>();
  for (const phase of allPhases) phaseMap.set(phase.phase, phase);

  const nodeMap = new Map<string, DagNodeV3>();
  for (const [, exp] of expansions) {
    for (const node of exp.nodes) nodeMap.set(node.id, node);
  }

  // Wire exit slots to the next phase's entry node.
  // If next = [] (terminal phase), EXIT sentinels are left in place and stripped below.
  for (const phase of allPhases) {
    const exp = expansions.get(phase.phase)!;
    if (exp.exitSlots.length === 0) continue;

    const childPhaseIds = phase.children ?? [];
    if (childPhaseIds.length === 0) continue; // terminal — EXIT will be stripped

    if (childPhaseIds.length === 1) {
      const childExp = expansions.get(childPhaseIds[0]);
      if (!childExp) throw new Error(`Phase "${childPhaseIds[0]}" not found during wiring`);
      for (const slot of exp.exitSlots) {
        const node = nodeMap.get(slot.nodeId)!;
        if (!node.children) node.children = [];
        while (node.children.length <= slot.childIndex) node.children.push(EXIT);
        node.children[slot.childIndex] = childExp.entryNodeId;
      }
    } else {
      // Branching: replace each EXIT slot with all N child phase entry nodes.
      // The spec typically has a single EXIT on the terminal node; fan it out to
      // all branch targets so the compiled node has one child per branch.
      for (const slot of exp.exitSlots) {
        const node = nodeMap.get(slot.nodeId)!;
        if (!node.children) node.children = [];
        // Remove the EXIT sentinel at this slot index
        node.children.splice(slot.childIndex, 1);
        // Insert all branch entry nodes at the same position
        const branchEntries: string[] = [];
        for (const childPhaseId of childPhaseIds) {
          const childExp = expansions.get(childPhaseId);
          if (!childExp) throw new Error(`Phase "${childPhaseId}" not found during wiring`);
          branchEntries.push(childExp.entryNodeId);
        }
        node.children.splice(slot.childIndex, 0, ...branchEntries);
      }
    }
  }

  // Get entry node from entry-phase expansion
  const kickoffExp = expansions.get("execution-kickoff")!;

  const allNodes: DagNodeV3[] = [...nodeMap.values()];

  // Clean up remaining EXIT sentinels
  for (const node of allNodes) {
    if (node.children) {
      node.children = node.children.filter((c) => c !== EXIT);
      if (node.children.length === 0) delete node.children;
    }
  }

  const metadata: DagMetadataV3 = {
    schema_version: "3.0",
    id: planId,
    entry_node_id: kickoffExp.entryNodeId,
  };

  return { metadata, nodes: allNodes };
}
