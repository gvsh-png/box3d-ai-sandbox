/** Box3D-inspired simulation commands the AI can emit. */

export type Vec3 = { x: number; y: number; z: number };

export type ShapeKind = 'box' | 'sphere' | 'capsule';

export type SpawnBodyCommand = {
  action: 'spawn';
  id?: string;
  shape: ShapeKind;
  position: Vec3;
  size?: Vec3;
  radius?: number;
  height?: number;
  color?: string;
  density?: number;
  friction?: number;
  restitution?: number;
  /** Initial linear velocity (m/s) */
  velocity?: Vec3;
  /** Spawn from above with random spread */
  fromSky?: boolean;
  count?: number;
};

export type SetGravityCommand = {
  action: 'setGravity';
  gravity: Vec3;
};

export type ClearCommand = {
  action: 'clear';
};

export type PauseCommand = {
  action: 'pause';
  paused: boolean;
};

export type ExplodeCommand = {
  action: 'explode';
  position: Vec3;
  radius: number;
  strength: number;
};

export type SpawnGroundCommand = {
  action: 'spawnGround';
  size?: Vec3;
  position?: Vec3;
  color?: string;
};

export type SimulationCommand =
  | SpawnBodyCommand
  | SetGravityCommand
  | ClearCommand
  | PauseCommand
  | ExplodeCommand
  | SpawnGroundCommand;

export type CommandBatch = {
  commands: SimulationCommand[];
  message?: string;
};

export const COMMAND_SCHEMA = `Translate user requests into Box3D physics JSON only. Y is up. Ground at y=0.
{"message":"short reply","commands":[{"action":"spawn","shape":"box|sphere|capsule","position":{"x":0,"y":0,"z":0},"size":{"x":1,"y":1,"z":1},"fromSky":true,"count":4,"color":"#hex"},{"action":"setGravity","gravity":{"x":0,"y":-10,"z":0}},{"action":"clear"},{"action":"pause","paused":true},{"action":"explode","position":{"x":0,"y":2,"z":0},"radius":5,"strength":20}]}
Sky spawns: fromSky:true, high y, use count. No markdown.`;
