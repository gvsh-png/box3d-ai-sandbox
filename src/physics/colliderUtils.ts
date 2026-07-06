import * as THREE from 'three';
import type { Body, Shape } from 'tumble.js';
import { createCylinder, createHull, makeBoxHull } from 'tumble.js';
import { shapeDefFromOpts } from './box3dUtils';

export type ShapeAttachOptions = {
  density?: number;
  friction?: number;
  restitution?: number;
  sensor?: boolean;
};

/** Attach a Box3D collision shape inferred from THREE geometry. */
export function attachShapeFromGeometry(
  body: Body,
  geometry: THREE.BufferGeometry,
  opts: ShapeAttachOptions = {},
): Shape {
  const def = shapeDefFromOpts(opts);
  const geo = geometry as THREE.BufferGeometry & {
    parameters?: Record<string, number>;
  };

  if (geo.type === 'SphereGeometry' && geo.parameters?.radius) {
    const r = geo.parameters.radius;
    return body.createSphere(def, { center: { x: 0, y: 0, z: 0 }, radius: r });
  }

  if (geo.type === 'BoxGeometry' && geo.parameters) {
    const p = geo.parameters;
    return body.createHull(def, makeBoxHull(p.width / 2, p.height / 2, p.depth / 2));
  }

  if (geo.type === 'CylinderGeometry' && geo.parameters) {
    const p = geo.parameters;
    const r = p.radiusTop ?? p.radiusBottom ?? 0.5;
    const h = p.height ?? 1;
    const hull = createCylinder(h, r, 0, 16);
    return body.createHull(def, hull);
  }

  if (geo.type === 'CapsuleGeometry' && geo.parameters) {
    const p = geo.parameters;
    const r = p.radius ?? 0.5;
    const half = (p.length ?? 1) / 2;
    return body.createCapsule(def, {
      center1: { x: 0, y: -half, z: 0 },
      center2: { x: 0, y: half, z: 0 },
      radius: r,
    });
  }

  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const sx = (box.max.x - box.min.x) / 2;
  const sy = (box.max.y - box.min.y) / 2;
  const sz = (box.max.z - box.min.z) / 2;
  if (sx > 0 && sy > 0 && sz > 0) {
    return body.createHull(def, makeBoxHull(sx, sy, sz));
  }

  const points = geometryVertices(geometry);
  if (points.length >= 4) {
    const hull = createHull(points, 64);
    if (hull) return body.createHull(def, hull);
  }

  return body.createSphere(def, { center: { x: 0, y: 0, z: 0 }, radius: 0.5 });
}

function geometryVertices(geometry: THREE.BufferGeometry): Array<{ x: number; y: number; z: number }> {
  const pos = geometry.attributes.position;
  if (!pos) return [];
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < pos.count; i++) {
    points.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });
  }
  return points;
}
