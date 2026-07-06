import * as THREE from 'three';
import {
  BodyType,
  type Body,
  type Joint,
  type Quat,
  type ShapeDef,
  type Transform,
  type Vec3,
  type World,
  defaultShapeDef,
  defaultSurfaceMaterial,
} from 'tumble.js';
import type { Vec3 as CmdVec3 } from '../types/commands';

export { BodyType };

export const BOX3D_FIXED_DT = 1 / 60;
export const BOX3D_SUBSTEPS = 4;

export function identityQuat(): Quat {
  return { v: { x: 0, y: 0, z: 0 }, s: 1 };
}

export function threeQuatToB3(q: THREE.Quaternion): Quat {
  return { v: { x: q.x, y: q.y, z: q.z }, s: q.w };
}

export function b3QuatToThree(q: Quat, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.set(q.v.x, q.v.y, q.v.z, q.s);
}

export function eulerDegToB3Quat(rot?: CmdVec3): Quat {
  if (!rot) return identityQuat();
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rot.x * (Math.PI / 180), rot.y * (Math.PI / 180), rot.z * (Math.PI / 180)),
  );
  return threeQuatToB3(q);
}

export function shapeDefFromOpts(opts: {
  density?: number;
  friction?: number;
  restitution?: number;
  sensor?: boolean;
}): Partial<ShapeDef> {
  const baseMaterial = defaultSurfaceMaterial();
  baseMaterial.friction = opts.friction ?? 0.4;
  baseMaterial.restitution = opts.restitution ?? 0.2;
  return {
    ...defaultShapeDef(),
    density: opts.density ?? 1,
    baseMaterial,
    isSensor: opts.sensor ?? false,
  };
}

export function isDynamicBody(body: Body): boolean {
  return body.getType() === BodyType.Dynamic;
}

export function bodyPosition(body: Body): Vec3 {
  return body.getPosition();
}

export function bodyLinearVelocity(body: Body): Vec3 {
  return body.getLinearVelocity();
}

export function setBodyPose(body: Body, x: number, y: number, z: number, rotation?: Quat): void {
  body.setTransform({ x, y, z }, rotation ?? body.getRotation());
}

export function applyCenterImpulse(body: Body, impulse: Vec3): void {
  body.applyLinearImpulseToCenter(impulse, true);
}

export function applyCenterTorqueImpulse(body: Body, torque: Vec3): void {
  body.applyAngularImpulse(torque, true);
}

/** Orient joint local +Z to the given world axis (for revolute hinges). */
export function jointFrameForAxis(axis: CmdVec3): Transform {
  const len = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z) || 1;
  const target = new THREE.Vector3(axis.x / len, axis.y / len, axis.z / len);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), target);
  return { p: { x: 0, y: 0, z: 0 }, q: threeQuatToB3(q) };
}

export function createHingeJoint(world: World, bodyA: Body, bodyB: Body, axis: CmdVec3): Joint {
  const frame = jointFrameForAxis(axis);
  return world.createRevoluteJoint(bodyA, bodyB, {
    localFrameA: frame,
    localFrameB: frame,
  });
}

export function createFixedJoint(world: World, bodyA: Body, bodyB: Body): Joint {
  const frame: Transform = { p: { x: 0, y: 0, z: 0 }, q: identityQuat() };
  return world.createWeldJoint(bodyA, bodyB, { localFrameA: frame, localFrameB: frame });
}

export function destroyJoints(joints: Joint[]): void {
  for (const joint of joints) {
    if (joint.isValid()) joint.destroy();
  }
}
