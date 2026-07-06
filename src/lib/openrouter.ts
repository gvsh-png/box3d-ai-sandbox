import { SANDBOX_API_DOCS, type ScriptResponse } from '../types/script';
import type { CommandBatch } from '../types/commands';
import { buildScriptMessages, type ConversationTurn } from './conversation';

export const MODELS = [
  { id: 'deepseek/deepseek-v4-flash:nitro', label: 'DeepSeek V4 Flash (fastest)' },
  { id: 'deepseek/deepseek-v4-flash:floor', label: 'DeepSeek V4 Flash (cheapest)' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)' },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];

const STORAGE_KEY = 'box3d-openrouter-api-key';
const MODEL_KEY = 'box3d-openrouter-model';

export function getStoredApiKey(): string {
  return localStorage.getItem(STORAGE_KEY) ?? '';
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key);
}

export function getStoredModel(): ModelId {
  const stored = localStorage.getItem(MODEL_KEY);
  if (stored && MODELS.some((m) => m.id === stored)) return stored as ModelId;
  return MODELS[0].id;
}

export function setStoredModel(model: ModelId): void {
  localStorage.setItem(MODEL_KEY, model);
}

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

/** Ask the AI to generate executable sandbox JavaScript. */
export async function generateScriptWithAI(
  apiKey: string,
  model: ModelId,
  userPrompt: string,
  sceneSummary: string,
  history: ConversationTurn[] = [],
): Promise<ScriptResponse> {
  const messages: ChatMessage[] = buildScriptMessages(
    SANDBOX_API_DOCS,
    history,
    sceneSummary,
    userPrompt,
  );

  const body = {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 8192,
    response_format: { type: 'json_object' as const },
    provider: { sort: 'latency' as const },
  };

  let res = await openRouterFetch(apiKey, body);
  let data = await res.json();
  let content = extractContent(data);

  if (!content) {
    const { response_format: _, ...noJson } = body;
    res = await openRouterFetch(apiKey, noJson);
    if (!res.ok) throw new Error(`OpenRouter retry failed: ${await res.text()}`);
    data = await res.json();
    content = extractContent(data);
  }

  if (!content) throw new Error('Empty response from model — try rephrasing or a different model.');

  return parseScriptResponse(content);
}

function openRouterFetch(apiKey: string, body: object): Promise<Response> {
  return fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://box3d-ai-sandbox',
      'X-Title': 'Box3D AI Sandbox',
    },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
    return res;
  });
}

function extractContent(data: {
  choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
}): string | undefined {
  const msg = data.choices?.[0]?.message;
  if (!msg) return undefined;
  if (msg.content?.trim()) return msg.content;
  if (msg.reasoning?.trim()) {
    const match = msg.reasoning.match(/\{[\s\S]*"script"[\s\S]*\}/);
    if (match) return match[0];
  }
  return undefined;
}

export function parseScriptResponse(raw: string): ScriptResponse {
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonStr = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const parsed = JSON.parse(jsonStr) as ScriptResponse & { commands?: unknown };

  if (typeof parsed.script === 'string' && parsed.script.trim()) {
    return {
      message: parsed.message ?? 'Script ready.',
      script: parsed.script,
    };
  }

  // Legacy JSON commands — convert to a script
  if (Array.isArray(parsed.commands)) {
    return {
      message: parsed.message ?? 'Converted commands to script.',
      script: commandsToScript(parsed as CommandBatch),
    };
  }

  throw new Error('Invalid response: missing script field');
}

function commandsToScript(batch: CommandBatch): string {
  const lines = batch.commands.map((c) => `sandbox.executeCommand(${JSON.stringify(c)});`);
  return lines.join('\n');
}

/**
 * Strict fast-path only — instant without API.
 */
export function tryLocalParse(prompt: string): CommandBatch | null {
  const lower = prompt.toLowerCase().trim();

  if (/^(clear|reset|empty)$/.test(lower) || /^delete\s+(everything|all)$/.test(lower)) {
    return { message: 'Cleared the scene.', commands: [{ action: 'clear' }] };
  }

  if (/^(pause|stop)$/.test(lower)) {
    return { message: 'Simulation paused.', commands: [{ action: 'pause', paused: true }] };
  }

  if (/^(resume|play|unpause)$/.test(lower)) {
    return { message: 'Simulation resumed.', commands: [{ action: 'pause', paused: false }] };
  }

  if (/^(low gravity|moon gravity|moon)$/.test(lower)) {
    return { message: 'Moon gravity enabled.', commands: [{ action: 'setGravity', gravity: { x: 0, y: -1.6, z: 0 } }] };
  }

  if (/^(zero gravity|no gravity|space)$/.test(lower)) {
    return { message: 'Zero gravity.', commands: [{ action: 'setGravity', gravity: { x: 0, y: 0, z: 0 } }] };
  }

  if (/^(explode|boom|blast)$/.test(lower)) {
    return {
      message: 'Boom!',
      commands: [{ action: 'explode', position: { x: 0, y: 2, z: 0 }, radius: 6, strength: 25 }],
    };
  }

  const numbered = lower.match(
    /^(?:(?:spawn|drop|generate|create)\s+)?(\d+)\s+(big\s+)?(boxes?|cubes?|spheres?|balls?)(?:\s+from\s+(?:the\s+)?sky)?$/,
  );
  if (numbered) {
    const count = parseInt(numbered[1], 10);
    const isBig = !!numbered[2];
    const shape = /sphere|ball/.test(numbered[3]) ? 'sphere' : 'box';
    const fromSky = /sky/.test(lower);
    const size = isBig ? { x: 2.5, y: 2.5, z: 2.5 } : { x: 1, y: 1, z: 1 };
    return {
      message: `Spawning ${count} ${isBig ? 'big ' : ''}${shape}${count > 1 ? 's' : ''}${fromSky ? ' from the sky' : ''}.`,
      commands: [
        {
          action: 'spawn',
          shape,
          position: { x: 0, y: fromSky ? 12 : 3, z: 0 },
          size,
          radius: isBig ? 1.2 : 0.5,
          fromSky,
          count,
        },
      ],
    };
  }

  return null;
}

/** @deprecated */
export const parsePromptWithAI = generateScriptWithAI;
export const localParse = tryLocalParse;
