/**
 * GET /v1/models
 * GET /v1/models/:model
 *
 * Proxies to OpenCode's /provider endpoint and returns all models from all
 * connected providers in OpenAI-compatible format.
 *
 * Model IDs are returned as "providerID/modelID" — the same format the
 * /v1/chat/completions endpoint expects.
 */

import { Hono } from "hono";

function opencodeBaseUrl(): string {
  const host = process.env.OPENCODE_HOST ?? "127.0.0.1";
  const port = process.env.OPENCODE_PORT ?? "4096";
  return `http://${host}:${port}`;
}

interface OCModel {
  id: string;
  name?: string;
  [key: string]: unknown;
}

interface OCProvider {
  id: string;
  models?: Record<string, OCModel>;
  [key: string]: unknown;
}

interface OCProviderResponse {
  all?: OCProvider[];
  connected?: string[];
  [key: string]: unknown;
}

async function fetchModels(): Promise<Array<{ id: string; owned_by: string; created: number }>> {
  const res = await fetch(`${opencodeBaseUrl()}/provider`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`OpenCode /provider returned ${res.status}`);
  }

  const data = (await res.json()) as OCProviderResponse;
  const connected = new Set(data.connected ?? []);
  const providers: OCProvider[] = (data.all ?? []).filter((p) => connected.has(p.id));
  const created = Math.floor(Date.now() / 1000);
  const models: Array<{ id: string; owned_by: string; created: number }> = [];

  for (const provider of providers) {
    for (const modelId of Object.keys(provider.models ?? {})) {
      models.push({
        id: `${provider.id}/${modelId}`,
        owned_by: provider.id,
        created,
      });
    }
  }

  return models;
}

export const modelsRouter = new Hono();

modelsRouter.get("/", async (c) => {
  try {
    const models = await fetchModels();
    return c.json({ object: "list", data: models.map((m) => ({ ...m, object: "model" })) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: { message: `Failed to fetch models from OpenCode: ${msg}`, type: "server_error" } }, 502);
  }
});

modelsRouter.get("/:model{.+}", async (c) => {
  const modelId = c.req.param("model");
  try {
    const models = await fetchModels();
    const found = models.find((m) => m.id === modelId);
    if (!found) {
      return c.json({ error: { message: `Model '${modelId}' not found`, type: "invalid_request_error" } }, 404);
    }
    return c.json({ ...found, object: "model" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: { message: `Failed to fetch models from OpenCode: ${msg}`, type: "server_error" } }, 502);
  }
});
