import * as THREE from 'three';
import type { Vec3 } from '../types/commands';
import { resolveBodyId, type BodyRef } from './scriptArgs';

export type AgentAction = {
  force?: Vec3;
  impulse?: Vec3;
  torque?: Vec3;
  setVelocity?: Vec3;
  steer?: number;
};

export type AgentSenseHit = {
  hit: boolean;
  dist?: number;
  point?: Vec3;
  bodyId?: string;
};

export type AgentContext = {
  id: string;
  bodyId: string;
  dt: number;
  time: number;
  position: Vec3;
  velocity: Vec3;
  forward: Vec3;
  nearest: Array<{ id: string; dist: number; position: Vec3 }>;
  raycast: (dir?: Vec3, maxDist?: number) => AgentSenseHit;
};

export type AgentThinkFn = (ctx: AgentContext) => AgentAction | void;

export type AgentDef = {
  id: string;
  bodyId: string;
  think?: AgentThinkFn;
  brain?: 'script' | 'llm';
  instruction?: string;
  llmInterval?: number;
};

export type AgentWorldBridge = {
  getBodyPosition: (id: string) => THREE.Vector3 | null;
  getBodyVelocity: (id: string) => Vec3 | null;
  getBodyForward: (id: string) => Vec3 | null;
  queryNearest: (origin: Vec3, count: number, excludeId?: string) => Array<{ id: string; dist: number; position: Vec3 }>;
  raycast: (origin: Vec3, dir: Vec3, maxDist: number, excludeId?: string) => AgentSenseHit;
  applyAction: (bodyId: string, action: AgentAction) => void;
};

export type LLMAgentHandler = (
  agent: AgentDef,
  ctx: AgentContext,
) => Promise<AgentAction | void>;

export class AgentSystem {
  private agents = new Map<string, AgentDef>();
  private llmCooldown = new Map<string, number>();
  private simTime = 0;
  llmHandler: LLMAgentHandler | null = null;

  register(def: AgentDef): void {
    const id = def.id;
    const bodyId = resolveBodyId(def.bodyId as BodyRef);
    this.agents.set(id, { ...def, id, bodyId, brain: def.brain ?? 'script' });
  }

  remove(id: string): void {
    this.agents.delete(id);
    this.llmCooldown.delete(id);
  }

  clear(): void {
    this.agents.clear();
    this.llmCooldown.clear();
    this.simTime = 0;
  }

  count(): number {
    return this.agents.size;
  }

  async tick(dt: number, bridge: AgentWorldBridge): Promise<void> {
    this.simTime += dt;

    for (const agent of this.agents.values()) {
      const pos = bridge.getBodyPosition(agent.bodyId);
      const vel = bridge.getBodyVelocity(agent.bodyId);
      const fwd = bridge.getBodyForward(agent.bodyId);
      if (!pos || !vel || !fwd) continue;

      const origin = { x: pos.x, y: pos.y, z: pos.z };
      const ctx: AgentContext = {
        id: agent.id,
        bodyId: agent.bodyId,
        dt,
        time: this.simTime,
        position: origin,
        velocity: vel,
        forward: fwd,
        nearest: bridge.queryNearest(origin, 6, agent.bodyId),
        raycast: (dir, maxDist = 20) =>
          bridge.raycast(origin, dir ?? fwd, maxDist, agent.bodyId),
      };

      if (agent.brain === 'llm' && agent.instruction && this.llmHandler) {
        const interval = agent.llmInterval ?? 1.5;
        const next = this.llmCooldown.get(agent.id) ?? 0;
        if (this.simTime >= next) {
          this.llmCooldown.set(agent.id, this.simTime + interval);
          try {
            const action = await this.llmHandler(agent, ctx);
            if (action) bridge.applyAction(agent.bodyId, action);
          } catch (err) {
            console.error(`LLM agent ${agent.id} error:`, err);
          }
        }
        continue;
      }

      if (agent.think) {
        try {
          const action = agent.think(ctx);
          if (action) bridge.applyAction(agent.bodyId, action);
        } catch (err) {
          console.error(`Agent ${agent.id} think error:`, err);
        }
      }
    }
  }
}
