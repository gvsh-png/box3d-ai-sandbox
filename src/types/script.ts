/**
 * API reference injected into the AI system prompt.
 * The model writes JavaScript that calls these `sandbox` methods.
 */
export const SANDBOX_API_DOCS = `
You write JavaScript that controls a 3D physics sandbox. Y is up. Ground at y=0.
Return ONLY JSON: {"message":"short confirmation","script":"..."}
The script runs with \`sandbox\` and \`Math\` in scope. Use loops, variables, any logic you need.

SANDBOX API (all methods on \`sandbox\`):

sandbox.clear() — remove all spawned objects
sandbox.pause(true|false)
sandbox.gravity(x, y, z) — e.g. sandbox.gravity(0, -10, 0) or (0,0,0) for space

sandbox.spawn({ ... }) → returns body id string
  shape: "box"|"sphere"|"capsule"|"cylinder"
  position: {x,y,z}
  size: {x,y,z}           // boxes
  radius, height           // spheres/cylinders/capsules
  color: "#hex"
  material: "wood"|"iron"|"rubber"|"default"
  density, friction, restitution
  static: true|false
  rotation: {x,y,z}        // degrees
  velocity: {x,y,z}
  fromSky: true            // drop from above
  id: "myId"               // optional name for joints

Shortcuts: sandbox.box(opts), sandbox.sphere(opts), sandbox.cylinder(opts), sandbox.capsule(opts)

sandbox.pattern(pattern, count, opts) — pattern: "stack"|"jenga"|"line"|"dominoes"|"circle"|"grid"|"scatter"
sandbox.container(width, depth, height, { position?, wallThickness?, color? })
sandbox.ramp(length, width, angleDeg, { position?, color? })
sandbox.joint(bodyA, bodyB, "hinge"|"fixed", { axis? })
sandbox.motor(bodyId, torque, { axis? })
sandbox.force(fx, fy, fz, { position?, radius? })
sandbox.explode(x, y, z, radius, strength)

Helpers:
sandbox.color(name) → hex  // red,blue,green,purple,wood,iron...
sandbox.rand(min, max)
sandbox.COLORS — array of hex colors

RULES:
- Use sandbox.clear() when user says delete/clear/reset
- circle/ball/orb → shape:"sphere"
- rectangle/domino → box with non-uniform size
- For 50+ objects use for-loops calling sandbox.spawn or sandbox.pattern
- Assign ids when using joints/motors later
- No imports, fetch, window, document, eval. Only sandbox + Math + loops.
- Script must be plain statements (no markdown fences inside JSON)

EXAMPLE script for "50 block tower then wrecking ball":
sandbox.clear();
for (let i = 0; i < 50; i++) {
  sandbox.box({ position: { x: (i%2)*0.25, y: i*0.38+0.2, z: (i%4<2?-0.2:0.2) }, size: { x: 3, y: 0.35, z: 1 }, material: "wood", id: "b"+i });
}
sandbox.sphere({ position: { x: 0, y: 22, z: 0 }, radius: 1.5, material: "iron", density: 8, fromSky: true, id: "wreck" });
`.trim();

export type ScriptResponse = {
  message: string;
  script: string;
};
