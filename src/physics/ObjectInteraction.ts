import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

type Pickable = {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  id: string;
};

type DragState = {
  entry: Pickable;
  plane: THREE.Plane;
  offset: THREE.Vector3;
  lastPos: THREE.Vector3;
  lastTime: number;
  velocity: THREE.Vector3;
  savedType: RAPIER.RigidBodyType;
};

/**
 * Mouse interaction: left-drag objects, right-drag orbit camera, scroll zoom.
 */
export class ObjectInteraction {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private drag: DragState | null = null;
  private hovered: Pickable | null = null;
  private orbitDragging = false;
  private orbitPrev = { x: 0, y: 0 };
  private theta = 0.8;
  private phi = 0.6;
  private radius = 16;
  private target = new THREE.Vector3(0, 2, 0);
  private disposed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.PerspectiveCamera,
    private getPickables: () => Pickable[],
  ) {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('contextmenu', this.preventContext);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    this.updateCamera();
  }

  dispose(): void {
    this.disposed = true;
    this.releaseDrag();
    this.setHover(null);
    this.canvas.removeEventListener('contextmenu', this.preventContext);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  private preventContext = (e: Event) => e.preventDefault();

  private updatePointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pick(e: PointerEvent): Pickable | null {
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = this.getPickables().map((p) => p.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;

    const mesh = hits[0].object as THREE.Mesh;
    return this.getPickables().find((p) => p.mesh === mesh) ?? null;
  }

  private planeHit(e: PointerEvent, plane: THREE.Plane, out: THREE.Vector3): boolean {
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray.intersectPlane(plane, out) !== null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.disposed) return;

    // Right or middle mouse → orbit camera
    if (e.button === 1 || e.button === 2) {
      this.orbitDragging = true;
      this.orbitPrev = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0) return;

    const hit = this.pick(e);
    if (!hit || !hit.body.isDynamic()) {
      // Left drag on empty space also orbits
      this.orbitDragging = true;
      this.orbitPrev = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    const hitPoint = new THREE.Vector3();
    const bodyPos = hit.body.translation();
    const grabPoint = new THREE.Vector3(bodyPos.x, bodyPos.y, bodyPos.z);

    const normal = new THREE.Vector3();
    this.camera.getWorldDirection(normal);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, grabPoint);

    if (!this.planeHit(e, plane, hitPoint)) return;

    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = 'grabbing';

    const savedType = hit.body.bodyType();
    hit.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    hit.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    hit.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

    this.drag = {
      entry: hit,
      plane,
      offset: grabPoint.clone().sub(hitPoint),
      lastPos: grabPoint.clone(),
      lastTime: performance.now(),
      velocity: new THREE.Vector3(),
      savedType,
    };

    this.setHover(hit);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.disposed) return;

    if (this.orbitDragging) {
      const dx = e.clientX - this.orbitPrev.x;
      const dy = e.clientY - this.orbitPrev.y;
      this.theta -= dx * 0.005;
      this.phi = Math.max(0.15, Math.min(1.4, this.phi - dy * 0.005));
      this.orbitPrev = { x: e.clientX, y: e.clientY };
      this.updateCamera();
      return;
    }

    if (this.drag) {
      const hitPoint = new THREE.Vector3();
      if (!this.planeHit(e, this.drag.plane, hitPoint)) return;

      const pos = hitPoint.add(this.drag.offset);
      const now = performance.now();
      const dt = Math.max(0.001, (now - this.drag.lastTime) / 1000);

      this.drag.velocity.set(
        (pos.x - this.drag.lastPos.x) / dt,
        (pos.y - this.drag.lastPos.y) / dt,
        (pos.z - this.drag.lastPos.z) / dt,
      );

      this.drag.entry.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
      this.drag.entry.mesh.position.copy(pos);

      this.drag.lastPos.copy(pos);
      this.drag.lastTime = now;
      return;
    }

    const hit = this.pick(e);
    if (hit?.body.isDynamic()) {
      this.setHover(hit);
      this.canvas.style.cursor = 'grab';
    } else {
      this.setHover(null);
      this.canvas.style.cursor = 'default';
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.orbitDragging) {
      this.orbitDragging = false;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    }
    this.releaseDrag();
  };

  private releaseDrag(): void {
    if (!this.drag) return;

    const { entry, velocity, savedType } = this.drag;
    const t = entry.body.translation();

    entry.body.setBodyType(savedType, true);
    entry.body.setTranslation({ x: t.x, y: t.y, z: t.z }, true);
    entry.body.setLinvel(
      { x: velocity.x * 0.35, y: velocity.y * 0.35, z: velocity.z * 0.35 },
      true,
    );

    this.drag = null;
    this.canvas.style.cursor = this.hovered ? 'grab' : 'default';
  }

  private setHover(entry: Pickable | null): void {
    if (this.hovered && this.hovered !== entry) {
      this.setMeshHighlight(this.hovered.mesh, false);
    }
    this.hovered = entry;
    if (entry && entry !== this.drag?.entry) {
      this.setMeshHighlight(entry.mesh, true);
    }
  }

  private setMeshHighlight(mesh: THREE.Mesh, on: boolean): void {
    const mat = mesh.material;
    const materials = Array.isArray(mat) ? mat : [mat];
    for (const m of materials) {
      if (m instanceof THREE.MeshStandardMaterial) {
        m.emissive.setHex(on ? 0x334466 : 0x000000);
        m.emissiveIntensity = on ? 0.35 : 0;
      }
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.radius = Math.max(5, Math.min(40, this.radius + e.deltaY * 0.02));
    this.updateCamera();
  };

  private updateCamera(): void {
    this.camera.position.x = this.target.x + this.radius * Math.sin(this.phi) * Math.cos(this.theta);
    this.camera.position.y = this.target.y + this.radius * Math.cos(this.phi);
    this.camera.position.z = this.target.z + this.radius * Math.sin(this.phi) * Math.sin(this.theta);
    this.camera.lookAt(this.target);
  }
}
