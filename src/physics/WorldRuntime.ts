import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { SandboxWorld } from './SandboxWorld';
import type { AgentDef, AgentThinkFn } from './AgentSystem';
import type { CameraKeyframe } from './CinematicCamera';
import { resolveAxis, resolveBodyId, type AxisArg, type BodyRef } from './scriptArgs';
import type { Vec3 } from '../types/commands';

export type PhysicsOpts = {
  id?: string;
  static?: boolean;
  density?: number;
  friction?: number;
  restitution?: number;
  velocity?: Vec3;
  sensor?: boolean;
};

export type BodyHandle = {
  id: string;
  mesh: THREE.Mesh;
  getPosition: () => THREE.Vector3;
  setPosition: (x: number, y: number, z: number) => void;
  applyForce: (x: number, y: number, z: number) => void;
  applyImpulse: (x: number, y: number, z: number) => void;
  setVelocity: (x: number, y: number, z: number) => void;
};

/**
 * Open runtime for AI-generated scripts — full THREE.js + physics primitives.
 */
export class WorldRuntime {
  readonly THREE = THREE;
  readonly Rapier = RAPIER;

  private bodies = new Map<string, BodyHandle>();

  readonly camera = {
    free: () => this.world.cinematic.free(),
    follow: (body: BodyRef, offset?: Vec3) => {
      this.world.cinematic.follow(resolveBodyId(body), offset);
    },
    orbit: (body: BodyRef, radius = 10, height = 4, speed = 0.35) => {
      this.world.cinematic.orbit(resolveBodyId(body), radius, height, speed);
    },
    path: (keyframes: CameraKeyframe[], loop = false) => {
      this.world.cinematic.setPath(keyframes, loop);
    },
    lookAt: (x: number, y: number, z: number) => {
      this.world.cinematic.lookAt(x, y, z);
    },
  };

  constructor(private world: SandboxWorld) {}

  get scene(): THREE.Scene {
    return this.world.scene;
  }

  clear(): void {
    this.bodies.clear();
    this.world.clearSpawned();
  }

  gravity(x: number, y: number, z: number): void {
    this.world.execute({ action: 'setGravity', gravity: { x, y, z } });
  }

  pause(on = true): void {
    this.world.execute({ action: 'pause', paused: on });
  }

  rand(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  color(name: string | number): THREE.Color {
    return new THREE.Color(name);
  }

  vec3(x = 0, y = 0, z = 0): THREE.Vector3 {
    return new THREE.Vector3(x, y, z);
  }

  add(obj: THREE.Object3D): THREE.Object3D {
    this.scene.add(obj);
    this.world.addScriptExtra(obj);
    return obj;
  }

  onTick(fn: (dt: number, world: WorldRuntime) => void): void {
    this.world.setScriptTick((dt) => fn(dt, this));
  }

  create(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    opts: PhysicsOpts & { position?: Vec3; rotation?: Vec3 } = {},
  ): BodyHandle {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (opts.position) mesh.position.set(opts.position.x, opts.position.y, opts.position.z);
    if (opts.rotation) {
      mesh.rotation.set(
        (opts.rotation.x * Math.PI) / 180,
        (opts.rotation.y * Math.PI) / 180,
        (opts.rotation.z * Math.PI) / 180,
      );
    }
    return this.addPhysics(mesh, opts);
  }

  addPhysics(mesh: THREE.Mesh, opts: PhysicsOpts = {}): BodyHandle {
    const id = this.world.registerPhysicsMesh(mesh, opts);
    const handle = this.makeHandle(id, mesh);
    this.bodies.set(id, handle);
    return handle;
  }

  get(id: string): BodyHandle | undefined {
    return this.bodies.get(id);
  }

  joint(bodyA: BodyRef, bodyB: BodyRef, type: 'hinge' | 'fixed' = 'hinge', axisArg?: AxisArg): void {
    this.world.execute({
      action: 'addJoint',
      type,
      bodyA: resolveBodyId(bodyA),
      bodyB: resolveBodyId(bodyB),
      axis: resolveAxis(axisArg),
    });
  }

  motor(bodyId: BodyRef, torque: number, axisArg?: AxisArg): void {
    this.world.execute({
      action: 'setMotor',
      bodyId: resolveBodyId(bodyId),
      torque,
      axis: resolveAxis(axisArg),
    });
  }

  force(fx: number, fy: number, fz: number, opts?: { position?: Vec3; radius?: number }): void {
    this.world.execute({
      action: 'applyForce',
      force: { x: fx, y: fy, z: fz },
      position: opts?.position,
      radius: opts?.radius,
    });
  }

  explode(x: number, y: number, z: number, radius = 6, strength = 25): void {
    this.world.execute({ action: 'explode', position: { x, y, z }, radius, strength });
  }

  agent(opts: {
    id: string;
    body: BodyRef;
    think?: AgentThinkFn;
    brain?: 'script' | 'llm';
    instruction?: string;
    llmInterval?: number;
  }): void {
    const def: AgentDef = {
      id: opts.id,
      bodyId: resolveBodyId(opts.body),
      think: opts.think,
      brain: opts.brain,
      instruction: opts.instruction,
      llmInterval: opts.llmInterval,
    };
    this.world.registerAgent(def);
  }

  recordReplay(start = true): string | void {
    if (start) {
      this.world.startReplayRecording();
      return;
    }
    return this.world.stopReplayRecording();
  }

  startVideoRecording(): void {
    this.world.startVideoRecording();
  }

  private makeHandle(id: string, mesh: THREE.Mesh): BodyHandle {
    return {
      id,
      mesh,
      getPosition: () => mesh.position.clone(),
      setPosition: (x, y, z) => this.world.setBodyPosition(id, x, y, z),
      applyForce: (x, y, z) => this.world.applyBodyImpulse(id, x, y, z),
      applyImpulse: (x, y, z) => this.world.applyBodyImpulse(id, x, y, z),
      setVelocity: (x, y, z) => this.world.setBodyVelocity(id, x, y, z),
    };
  }
}
