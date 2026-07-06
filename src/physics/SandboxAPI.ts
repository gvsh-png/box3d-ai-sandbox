import type { SimulationCommand, ShapeKind, Vec3 } from '../types/commands';
import type { SandboxWorld } from './SandboxWorld';

export type SpawnOpts = {
  shape?: ShapeKind;
  position?: Vec3;
  size?: Vec3;
  radius?: number;
  height?: number;
  color?: string;
  material?: 'wood' | 'iron' | 'rubber' | 'default';
  density?: number;
  friction?: number;
  restitution?: number;
  static?: boolean;
  rotation?: Vec3;
  velocity?: Vec3;
  fromSky?: boolean;
  id?: string;
  count?: number;
};

const NAMED_COLORS: Record<string, string> = {
  red: '#e74c3c',
  blue: '#3498db',
  green: '#2ecc71',
  yellow: '#f39c12',
  purple: '#9b59b6',
  orange: '#e67e22',
  pink: '#fd79a8',
  white: '#ecf0f1',
  black: '#2d3436',
  gray: '#95a5a6',
  grey: '#95a5a6',
  brown: '#8B4513',
  teal: '#1abc9c',
  wood: '#8B4513',
  iron: '#5a5a6a',
};

/**
 * Script-facing API — AI-generated JS calls these methods.
 */
export class SandboxAPI {
  readonly COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22'];

  constructor(private world: SandboxWorld) {}

  /** Low-level escape hatch — runs any simulation command. */
  executeCommand(cmd: SimulationCommand): void {
    this.world.execute(cmd);
  }

  clear(): void {
    this.world.execute({ action: 'clear' });
  }

  pause(on = true): void {
    this.world.execute({ action: 'pause', paused: on });
  }

  gravity(x: number, y: number, z: number): void {
    this.world.execute({ action: 'setGravity', gravity: { x, y, z } });
  }

  color(name: string): string {
    return NAMED_COLORS[name.toLowerCase()] ?? name;
  }

  rand(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  spawn(opts: SpawnOpts): string {
    const shape = opts.shape ?? 'box';
    const id = opts.id ?? `body-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
    this.world.execute({
      action: 'spawn',
      shape,
      position: opts.position ?? { x: 0, y: 2, z: 0 },
      size: opts.size,
      radius: opts.radius,
      height: opts.height,
      color: opts.color,
      material: opts.material,
      density: opts.density,
      friction: opts.friction,
      restitution: opts.restitution,
      static: opts.static,
      rotation: opts.rotation,
      velocity: opts.velocity,
      fromSky: opts.fromSky,
      count: opts.count,
      id,
    });
    return id;
  }

  box(opts: Omit<SpawnOpts, 'shape'> = {}): string {
    return this.spawn({ ...opts, shape: 'box' });
  }

  sphere(opts: Omit<SpawnOpts, 'shape'> = {}): string {
    return this.spawn({ ...opts, shape: 'sphere' });
  }

  cylinder(opts: Omit<SpawnOpts, 'shape'> = {}): string {
    return this.spawn({ ...opts, shape: 'cylinder' });
  }

  capsule(opts: Omit<SpawnOpts, 'shape'> = {}): string {
    return this.spawn({ ...opts, shape: 'capsule' });
  }

  pattern(
    pattern: 'stack' | 'jenga' | 'line' | 'dominoes' | 'circle' | 'grid' | 'scatter',
    count: number,
    opts: Partial<SpawnOpts> & { spacing?: number; ringRadius?: number } = {},
  ): void {
    this.world.execute({
      action: 'spawnPattern',
      pattern,
      count,
      shape: opts.shape,
      position: opts.position,
      spacing: opts.spacing,
      size: opts.size,
      radius: opts.radius,
      color: opts.color,
      material: opts.material,
      density: opts.density,
      restitution: opts.restitution,
      ringRadius: opts.ringRadius,
    });
  }

  container(
    width: number,
    depth: number,
    height: number,
    opts: { position?: Vec3; wallThickness?: number; color?: string } = {},
  ): void {
    this.world.execute({
      action: 'spawnContainer',
      width,
      depth,
      height,
      position: opts.position,
      wallThickness: opts.wallThickness,
      color: opts.color,
    });
  }

  ramp(
    length: number,
    width: number,
    angleDeg: number,
    opts: { position?: Vec3; color?: string } = {},
  ): void {
    this.world.execute({
      action: 'spawnRamp',
      position: opts.position ?? { x: 0, y: 0.5, z: 0 },
      length,
      width,
      angle: angleDeg,
      color: opts.color,
    });
  }

  joint(
    bodyA: string,
    bodyB: string,
    type: 'hinge' | 'fixed' = 'hinge',
    opts: { axis?: Vec3 } = {},
  ): void {
    this.world.execute({ action: 'addJoint', type, bodyA, bodyB, axis: opts.axis });
  }

  motor(bodyId: string, torque: number, opts: { axis?: Vec3 } = {}): void {
    this.world.execute({ action: 'setMotor', bodyId, torque, axis: opts.axis });
  }

  force(fx: number, fy: number, fz: number, opts: { position?: Vec3; radius?: number } = {}): void {
    this.world.execute({
      action: 'applyForce',
      force: { x: fx, y: fy, z: fz },
      position: opts.position,
      radius: opts.radius,
    });
  }

  explode(x: number, y: number, z: number, radius = 6, strength = 25): void {
    this.world.execute({ action: 'explode', position: { x, y, z }, radius, strength });
  }
}
