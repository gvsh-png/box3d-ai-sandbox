import type { AgentAction, AgentContext, AgentDef } from '../physics/AgentSystem';
import { parseJsonLenient } from './parseModelJson';

const ACTION_SCHEMA = `Return ONLY JSON: {"force":{"x":0,"y":0,"z":0},"impulse":{"x":0,"y":0,"z":0},"steer":0}
Use force/impulse to move. steer is yaw torque (-1 to 1). Keep actions small.`;

export async function thinkWithLLM(
  apiKey: string,
  model: string,
  agent: AgentDef,
  ctx: AgentContext,
): Promise<AgentAction | void> {
  const nearest = ctx.nearest
    .slice(0, 4)
    .map((n) => `${n.id}@${n.dist.toFixed(1)}m`)
    .join(', ');
  const ray = ctx.raycast();
  const prompt = `Agent "${agent.id}" controlling body "${agent.bodyId}".
Instruction: ${agent.instruction ?? 'Explore and avoid obstacles.'}
Position: (${ctx.position.x.toFixed(1)}, ${ctx.position.y.toFixed(1)}, ${ctx.position.z.toFixed(1)})
Velocity: (${ctx.velocity.x.toFixed(1)}, ${ctx.velocity.y.toFixed(1)}, ${ctx.velocity.z.toFixed(1)})
Forward ray: ${ray.hit ? `hit ${ray.bodyId} at ${ray.dist?.toFixed(1)}m` : 'clear'}
Nearby: ${nearest || 'none'}
${ACTION_SCHEMA}`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://box3d-ai-sandbox',
      'X-Title': 'Box3D AI Sandbox Agent',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 256,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) return;
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) return;

  try {
    return parseJsonLenient<AgentAction>(raw);
  } catch {
    return;
  }
}
