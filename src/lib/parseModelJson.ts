import { jsonrepair } from 'jsonrepair';
import type { ScriptResponse } from '../types/script';

/** Extract a JSON string field value, handling escapes. */
function extractJsonStringField(raw: string, field: string): string | null {
  const key = `"${field}"`;
  const idx = raw.indexOf(key);
  if (idx < 0) return null;

  let i = idx + key.length;
  while (i < raw.length && /[\s:]/.test(raw[i])) i++;
  if (raw[i] !== '"') return null;
  i++;

  let out = '';
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'r') out += '\r';
      else if (next === '"') out += '"';
      else if (next === '\\') out += '\\';
      else out += next;
      i += 2;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
    i++;
  }
  return null;
}

function stripMarkdownFences(raw: string): string {
  return raw
    .replace(/^```(?:json|javascript|js)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function sliceJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw;
}

function salvageFromRaw(raw: string): ScriptResponse | null {
  const codeBlock = raw.match(/```(?:javascript|js)\s*\n([\s\S]*?)```/i);
  if (codeBlock?.[1]?.trim()) {
    return { message: 'Recovered script from code block.', script: codeBlock[1].trim() };
  }

  const script = extractJsonStringField(raw, 'script');
  if (script?.trim()) {
    const message = extractJsonStringField(raw, 'message');
    return { message: message ?? 'Script ready.', script };
  }

  if (/world\.|sandbox\.|THREE\./.test(raw) && !raw.trimStart().startsWith('{')) {
    return { message: 'Recovered raw script.', script: raw.trim() };
  }

  return null;
}

export function parseJsonLenient<T>(raw: string): T {
  const cleaned = stripMarkdownFences(raw);
  const jsonStr = sliceJsonObject(cleaned);

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    try {
      return JSON.parse(jsonrepair(jsonStr)) as T;
    } catch {
      const salvaged = salvageFromRaw(raw);
      if (salvaged) return salvaged as T;
      throw new Error(
        `Could not parse AI response as JSON. Try rephrasing or a different model.\n\nPreview:\n${raw.slice(0, 280)}`,
      );
    }
  }
}
