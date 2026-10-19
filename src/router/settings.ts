import { z } from 'zod';

export const DEFAULT_GEMMA_MODEL = 'gemma-4-26b-a4b-it';
export const DEFAULT_OLLAMA_MODEL = 'gemma4:31b';

const ModelName = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);

export const RouterSettingsSchema = z.object({
  primary: z.enum(['gemma', 'ollama']),
  gemmaModel: ModelName,
  ollamaModel: ModelName,
});

export type RouterSettings = z.infer<typeof RouterSettingsSchema>;

export const DEFAULT_ROUTER_SETTINGS: RouterSettings = {
  primary: 'gemma',
  gemmaModel: DEFAULT_GEMMA_MODEL,
  ollamaModel: DEFAULT_OLLAMA_MODEL,
};

let currentSettings: RouterSettings = { ...DEFAULT_ROUTER_SETTINGS };

export function getRouterSettings(): RouterSettings {
  return { ...currentSettings };
}

export function setRouterSettings(settings: RouterSettings): void {
  currentSettings = RouterSettingsSchema.parse(settings);
}
