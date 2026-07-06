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

export const COMMAND_SCHEMA = `
You translate natural language into Box3D physics simulation commands.
Respond ONLY with valid JSON matching this schema:
{
  "message": "short friendly confirmation",
  "commands": [
    { "action": "spawn", "shape": "box"|"sphere"|"capsule", "position": {"x":0,"y":0,"z":0},
      "size": {"x":1,"y":1,"z":1}, "radius": 0.5, "color": "#hex",
      "velocity": {"x":0,"y":0,"z":0}, "fromSky": true, "count": 4, "density": 1 },
    { "action": "spawnGround", "size": {"x":20,"y":1,"z":20}, "position": {"x":0,"y":-0.5,"z":0} },
    { "action": "setGravity", "gravity": {"x":0,"y":-10,"z":0} },
    { "action": "clear" },
    { "action": "pause", "paused": true },
    { "action": "explode", "position": {"x":0,"y":2,"z":0}, "radius": 5, "strength": 20 }
  ]
}
Rules:
- Y is up. Ground is around y=0. Sky spawns use high y (8-15) with fromSky:true.
- "boxes from the sky" => spawn multiple boxes with fromSky:true, count as requested.
- Default ground exists; spawnGround only if user asks for floor/ground changes.
- Use meters. Typical box half-size 0.5-1. Colors as hex strings.
- Keep commands minimal. No markdown, no code fences, only JSON.
`.trim();
