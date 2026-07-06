import { SandboxAPI } from '../physics/SandboxAPI';
import type { SandboxWorld } from '../physics/SandboxWorld';

const BLOCKED =
  /\b(import|export|require|fetch|XMLHttpRequest|window|document|localStorage|sessionStorage|eval|Function|globalThis|process|__proto__|constructor\s*\[)\b/i;

export type ScriptResult = {
  ok: boolean;
  message: string;
  error?: string;
};

export function executeSandboxScript(world: SandboxWorld, script: string): ScriptResult {
  const cleaned = script
    .replace(/^```(?:javascript|js)?\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();

  if (!cleaned) {
    return { ok: false, message: 'Empty script', error: 'No code to run' };
  }

  if (BLOCKED.test(cleaned)) {
    return { ok: false, message: 'Blocked unsafe code', error: 'Script uses forbidden APIs' };
  }

  const sandbox = new SandboxAPI(world);

  try {
    const run = new Function(
      'sandbox',
      'Math',
      `"use strict";\n${cleaned}`,
    ) as (sandbox: SandboxAPI, math: typeof Math) => void;

    run(sandbox, Math);
    return { ok: true, message: 'Script executed.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: 'Script error', error: msg };
  }
}
