import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Compile } from "typebox/compile";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ModelSchema = Type.Object({
  id: Type.String(),
  max_model_len: Type.Integer(),
});

type Model = Static<typeof ModelSchema>;

const ModelsSchema = Type.Object({
  object: Type.Literal("list"),
  data: Type.Array(ModelSchema),
});

type Models = Static<typeof ModelsSchema>;

const InputMode = Type.Union([Type.Literal("text"), Type.Literal("image")]);

const ModelOverrideSchema = Type.Object({
  id: Type.String(),
  reasoning: Type.Optional(Type.Boolean()),
  input: Type.Optional(Type.Array(InputMode)),
});

type ModelOverride = Static<typeof ModelOverrideSchema>;

const ConfigSchema = Type.Object({
  baseUrl: Type.Optional(Type.String()),
  apiKey: Type.Optional(Type.String()),
  modelOverrides: Type.Optional(Type.Array(ModelOverrideSchema)),
});

type Config = Static<typeof ConfigSchema>;

export default async function (pi: ExtensionAPI) {
  const config = loadConfig();
  const baseUrl = config.baseUrl ?? "http://127.0.0.1:8000/v1";
  const models = await fetchModels(baseUrl);
  const overrides = buildOverrides(config);

  pi.registerProvider("vllm", {
    baseUrl,
    apiKey: config.apiKey,
    api: "openai-completions",
    models: models.map((model) =>
      applyOverrides(model, overrides.get(model.id)),
    ),
  });
}

function loadConfig(): Config {
  const path = join(getAgentDir(), "vllm.json");
  if (!existsSync(path)) return {};
  return Compile(ConfigSchema).Decode(JSON.parse(readFileSync(path, "utf8")));
}

async function fetchModels(baseUrl: string): Promise<Model[]> {
  try {
    const response = await fetch(`${baseUrl}/models`);
    const payload: Models = Compile(ModelsSchema).Parse(await response.json());
    return payload.data;
  } catch {
    return [];
  }
}

function buildOverrides(config: Config): Map<string, ModelOverride> {
  return new Map((config.modelOverrides ?? []).map((ov) => [ov.id, ov]));
}

function applyOverrides(
  model: Model,
  override: ModelOverride | undefined,
): ProviderModelConfig {
  return {
    id: model.id,
    name: model.id,
    reasoning: override?.reasoning ?? false,
    input: override?.input ?? ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.max_model_len,
    maxTokens: Math.floor(model.max_model_len / 4),
  };
}
