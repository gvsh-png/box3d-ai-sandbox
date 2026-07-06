import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

/** Infer Rapier collider from THREE geometry type. */
export function colliderFromGeometry(geometry: THREE.BufferGeometry): RAPIER.ColliderDesc {
  const geo = geometry as THREE.BufferGeometry & {
    parameters?: Record<string, number>;
  };

  if (geo.type === 'SphereGeometry' && geo.parameters?.radius) {
    return RAPIER.ColliderDesc.ball(geo.parameters.radius);
  }
  if (geo.type === 'BoxGeometry' && geo.parameters) {
    const p = geo.parameters;
    return RAPIER.ColliderDesc.cuboid(p.width / 2, p.height / 2, p.depth / 2);
  }
  if (geo.type === 'CylinderGeometry' && geo.parameters) {
    const p = geo.parameters;
    const r = p.radiusTop ?? p.radiusBottom ?? 0.5;
    return RAPIER.ColliderDesc.cylinder((p.height ?? 1) / 2, r);
  }
  if (geo.type === 'CapsuleGeometry' && geo.parameters) {
    const p = geo.parameters;
    return RAPIER.ColliderDesc.capsule((p.length ?? 1) / 2, p.radius ?? 0.5);
  }

  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const sx = (box.max.x - box.min.x) / 2;
  const sy = (box.max.y - box.min.y) / 2;
  const sz = (box.max.z - box.min.z) / 2;
  if (sx > 0 && sy > 0 && sz > 0) {
    return RAPIER.ColliderDesc.cuboid(sx, sy, sz);
  }

  const points = geometryVertices(geometry);
  if (points.length >= 9) {
    const hull = RAPIER.ColliderDesc.convexHull(points);
    if (hull) return hull;
  }

  return RAPIER.ColliderDesc.ball(0.5);
}

function geometryVertices(geometry: THREE.BufferGeometry): Float32Array {
  const pos = geometry.attributes.position;
  if (!pos) return new Float32Array(0);
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    arr[i * 3] = pos.getX(i);
    arr[i * 3 + 1] = pos.getY(i);
    arr[i * 3 + 2] = pos.getZ(i);
  }
  return arr;
}
