import { getValidPhaseTypes, loadPhaseSchema } from "../../phase-expander";

export const BRANCHING_PHASE_TYPE_SET = new Set<string>();

/** Validate phase_options for a given phase type using its phase-schema.toml. */
export function validatePhaseOptions(
  phase_type: string,
  opts: Record<string, unknown>,
): void {
  const schema = loadPhaseSchema(phase_type);
  for (const [field, def] of Object.entries(schema.fields)) {
    if (!def.required) continue;
    if (!(field in opts) || opts[field] === null || opts[field] === undefined) {
      throw new Error(
        `Phase type '${phase_type}' requires '${field}' in phase_options.`,
      );
    }
    if (def.type === "list" && !Array.isArray(opts[field])) {
      throw new Error(`'${field}' must be an array of strings.`);
    }
    if (def.type === "scalar" && typeof opts[field] !== "string" && typeof opts[field] !== "boolean" && typeof opts[field] !== "number") {
      throw new Error(`'${field}' must be a scalar value.`);
    }
  }
}

/** Returns the set of user-authorable phase types from the node-library. */
export function getValidPhaseTypeSet(): Set<string> {
  return new Set(getValidPhaseTypes());
}
