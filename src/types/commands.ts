/** Box3D-inspired simulation commands the AI can emit. */

export type Vec3 = { x: number; y: number; z: number };

export type ShapeKind = 'box' | 'sphere' | 'capsule' | 'cylinder';

export type MaterialPreset = 'wood' | 'iron' | 'rubber' | 'default';

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
  velocity?: Vec3;
  fromSky?: boolean;
  count?: number;
  static?: boolean;
  /** Euler rotation in degrees */
  rotation?: Vec3;
  material?: MaterialPreset;
};

export type SpawnPatternCommand = {
  action: 'spawnPattern';
  pattern: 'stack' | 'line' | 'grid' | 'jenga' | 'circle' | 'dominoes' | 'scatter';
  shape?: ShapeKind;
  count: number;
  position?: Vec3;
  spacing?: number;
  size?: Vec3;
  radius?: number;
  color?: string;
  material?: MaterialPreset;
  density?: number;
  restitution?: number;
  /** Ring radius for circle pattern */
  ringRadius?: number;
};

export type SpawnContainerCommand = {
  action: 'spawnContainer';
  width: number;
  depth: number;
  height: number;
  position?: Vec3;
  wallThickness?: number;
  color?: string;
};

export type SpawnRampCommand = {
  action: 'spawnRamp';
  position: Vec3;
  length: number;
  width: number;
  /** Ramp angle in degrees */
  angle: number;
  color?: string;
};

export type AddJointCommand = {
  action: 'addJoint';
  type: 'hinge' | 'fixed';
  bodyA: string;
  bodyB: string;
  axis?: Vec3;
};

export type SetMotorCommand = {
  action: 'setMotor';
  bodyId: string;
  torque: number;
  axis?: Vec3;
};

export type ApplyForceCommand = {
  action: 'applyForce';
  force: Vec3;
  position?: Vec3;
  radius?: number;
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
  | SpawnPatternCommand
  | SpawnContainerCommand
  | SpawnRampCommand
  | AddJointCommand
  | SetMotorCommand
  | ApplyForceCommand
  | SetGravityCommand
  | ClearCommand
  | PauseCommand
  | ExplodeCommand
  | SpawnGroundCommand;

export type CommandBatch = {
  commands: SimulationCommand[];
  message?: string;
};

export const COMMAND_SCHEMA = `You are a Box3D physics command generator. Y is up. Ground at y=0.
Return ONLY valid JSON: {"message":"...","commands":[...]}

ACTIONS:
1. spawn — single or count copies
   {action:"spawn", id?, shape:"box|sphere|capsule|cylinder", position:{x,y,z}, size:{x,y,z}, radius?, height?,
    color:"#hex", material:"wood|iron|rubber", density?, friction?, restitution?, static?:bool,
    rotation?:{x,y,z} degrees, velocity?:{x,y,z}, fromSky?:bool, count?:number}
   circle→sphere, rectangle→box with non-uniform size, purple→#9b59b6

2. spawnPattern — many objects arranged
   {action:"spawnPattern", pattern:"stack|line|grid|jenga|circle|dominoes|scatter", count, shape?, position?, spacing?, size?, color?, material?, restitution?, ringRadius?}
   stack/jenga=tower, dominoes=upright line, scatter=random in area

3. spawnContainer — open-top box walls (static)
   {action:"spawnContainer", width, depth, height, position?, wallThickness?:0.3}

4. spawnRamp — static angled ramp
   {action:"spawnRamp", position:{x,y,z}, length, width, angle:degrees}

5. addJoint — connect bodies by id
   {action:"addJoint", type:"hinge|fixed", bodyA:"id", bodyB:"id", axis?:{x,y,z}}

6. setMotor — continuous spin torque on body
   {action:"setMotor", bodyId:"id", torque:number, axis?:{x,y,z}}

7. applyForce — impulse on bodies (all or in radius)
   {action:"applyForce", force:{x,y,z}, position?, radius?}

8. setGravity {action:"setGravity", gravity:{x,y,z}}
9. clear {action:"clear"}
10. pause {action:"pause", paused:bool}
11. explode {action:"explode", position, radius, strength}
12. spawnGround {action:"spawnGround", size?, position?}

EXAMPLES:
- "spawn a circle" → spawn sphere purple etc.
- "50 block tower" → spawnPattern jenga count:50 material:wood
- "heavy iron sphere from sky" → spawn sphere density:8 material:iron fromSky:true position high
- "container with bouncy balls" → spawnContainer + spawnPattern scatter count:100 restitution:0.95 + applyForce up
- "car with wheels" → spawn chassis box id:chassis + 4 cylinders id:wheel-* + addJoint hinge + setMotor on rear wheels
- "ramp and dominoes" → spawnRamp + spawnPattern dominoes count:20

Use multiple commands in order. Assign ids when joints/motors reference bodies. No markdown.`;
