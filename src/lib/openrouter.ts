import { COMMAND_SCHEMA, type CommandBatch } from '../types/commands';

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
      temperature: 0.1,
      max_tokens: 256,
      response_format: { type: 'json_object' },
      provider: {
        sort: 'latency',
      },
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

/** Offline fallback — also used for instant responses on simple spawn phrases. */
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

  const countMatch = lower.match(/(\d+)\s*(box|boxes|cube|cubes|sphere|spheres|ball|balls)?/);
  const count = countMatch ? parseInt(countMatch[1], 10) : /spawn|drop|generate|create/.test(lower) ? 1 : 0;
  const shape = /sphere|ball/.test(lower) ? 'sphere' : 'box';
  const fromSky = /sky|fall|drop|rain|from the/.test(lower);
  const isBig = /big|large|huge|giant/.test(lower);
  const size = isBig ? { x: 2.5, y: 2.5, z: 2.5 } : { x: 1, y: 1, z: 1 };
  const sizeLabel = isBig ? 'big ' : '';

  if (count > 0 && /box|boxes|cube|cubes|sphere|ball|spawn|drop|generate|create|sky|fall|rain/.test(lower)) {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
    return {
      message: `Spawning ${count} ${sizeLabel}${shape}${count > 1 ? 'es' : ''}${fromSky ? ' from the sky' : ''}.`,
      commands: [
        {
          action: 'spawn',
          shape,
          position: { x: 0, y: fromSky ? 12 : 3, z: 0 },
          size,
          radius: isBig ? 1.2 : 0.5,
          color: colors[Math.floor(Math.random() * colors.length)],
          fromSky,
          count,
        },
      ],
    };
  }

  if (/^spawn$/.test(lower)) {
    return {
      message: 'Spawning 1 box.',
      commands: [
        {
          action: 'spawn',
          shape: 'box',
          position: { x: 0, y: 3, z: 0 },
          size: { x: 1, y: 1, z: 1 },
          fromSky: false,
          count: 1,
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
