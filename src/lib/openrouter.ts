import { COMMAND_SCHEMA, type CommandBatch } from '../types/commands';

export const MODELS = [
  { id: 'deepseek/deepseek-v4-flash:floor', label: 'DeepSeek V4 Flash (cheapest)' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
  { id: 'google/gemma-2-9b-it:free', label: 'Gemma 2 9B (free)' },
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

export async function parsePromptWithAI(
  apiKey: string,
  model: ModelId,
  userPrompt: string,
  sceneSummary: string,
): Promise<CommandBatch> {
  const messages: ChatMessage[] = [
    { role: 'system', content: COMMAND_SCHEMA },
    {
      role: 'user',
      content: `Current scene: ${sceneSummary}\n\nUser request: ${userPrompt}`,
    },
  ];

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://box3d-ai-sandbox',
      'X-Title': 'Box3D AI Sandbox',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from model');

  return parseCommandJson(content);
}

export function parseCommandJson(raw: string): CommandBatch {
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
  const parsed = JSON.parse(cleaned) as CommandBatch;
  if (!Array.isArray(parsed.commands)) {
    throw new Error('Invalid command batch: missing commands array');
  }
  return parsed;
}

/** Offline fallback for simple phrases when no API key is set. */
export function localParse(prompt: string): CommandBatch | null {
  const lower = prompt.toLowerCase().trim();

  if (/clear|reset|empty/.test(lower)) {
    return { message: 'Cleared the scene.', commands: [{ action: 'clear' }] };
  }

  if (/pause|stop/.test(lower)) {
    return { message: 'Simulation paused.', commands: [{ action: 'pause', paused: true }] };
  }

  if (/resume|play|unpause/.test(lower)) {
    return { message: 'Simulation resumed.', commands: [{ action: 'pause', paused: false }] };
  }

  const countMatch = lower.match(/(\d+)\s*(box|boxes|sphere|spheres|ball|balls)/);
  const count = countMatch ? parseInt(countMatch[1], 10) : 1;
  const shape = /sphere|ball/.test(lower) ? 'sphere' : 'box';
  const fromSky = /sky|fall|drop|rain/.test(lower);

  if (/box|boxes|sphere|ball|drop|fall|sky|spawn|generate|create/.test(lower)) {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
  return {
      message: `Spawning ${count} ${shape}${count > 1 ? 'es' : ''}${fromSky ? ' from the sky' : ''}.`,
      commands: [
        {
          action: 'spawn',
          shape,
          position: { x: 0, y: fromSky ? 12 : 3, z: 0 },
          size: { x: 1, y: 1, z: 1 },
          radius: 0.5,
          color: colors[Math.floor(Math.random() * colors.length)],
          fromSky,
          count,
        },
      ],
    };
  }

  if (/low gravity|moon/.test(lower)) {
    return {
      message: 'Moon gravity enabled.',
      commands: [{ action: 'setGravity', gravity: { x: 0, y: -1.6, z: 0 } }],
    };
  }

  if (/zero gravity|no gravity|space/.test(lower)) {
    return {
      message: 'Zero gravity.',
      commands: [{ action: 'setGravity', gravity: { x: 0, y: 0, z: 0 } }],
    };
  }

  if (/explode|boom|blast/.test(lower)) {
    return {
      message: 'Boom!',
      commands: [{ action: 'explode', position: { x: 0, y: 2, z: 0 }, radius: 6, strength: 25 }],
    };
  }

  return null;
}
