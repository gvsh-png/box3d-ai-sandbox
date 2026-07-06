import type { Vec3 } from '../types/commands';

export type BodyRef = string | { id: string };

export type AxisArg = Vec3 | { axis?: Vec3 } | undefined;

/** Accept string ids or body handles returned from world.create(). */
export function resolveBodyId(ref: BodyRef): string {
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref === 'object' && typeof ref.id === 'string') return ref.id;
  throw new Error('Invalid body reference — use a string id or the handle from world.create()');
}

/** Accept { axis: {x,y,z} } (documented form) or a plain {x,y,z} vector. */
export function resolveAxis(arg?: AxisArg, fallback: Vec3 = { x: 1, y: 0, z: 0 }): Vec3 {
  if (!arg) return fallback;
  if ('axis' in arg && arg.axis && typeof arg.axis.x === 'number') return arg.axis;
  if ('x' in arg && typeof arg.x === 'number') return arg as Vec3;
  return fallback;
}
