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
  minCenterY: number;
};

const GROUND_SURFACE_Y = 0.02;
const LOOK_SENS = 0.003;
const PAN_SENS = 0.012;
const SCROLL_SENS = 0.04;
const MOVE_SPEED = 10;

/**
 * Fly camera + object dragging.
 * RMB: look around | LMB on object: drag | LMB on empty: pan | Scroll: move forward (moves object too while dragging)
 */
export class ObjectInteraction {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private drag: DragState | null = null;
  private hovered: Pickable | null = null;
  private lookDragging = false;
  private panDragging = false;
  private pointerPrev = { x: 0, y: 0 };

  private camPos = new THREE.Vector3(8, 6, 12);
  private yaw = -0.6;
  private pitch = -0.35;

  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private keys = new Set<string>();
  private moveLoopId = 0;
  private lastMoveTime = performance.now();

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
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.lastMoveTime = performance.now();
    this.moveLoopId = requestAnimationFrame(this.tickMovement);
    this.applyCamera();
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
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    cancelAnimationFrame(this.moveLoopId);
  }

  private preventContext = (e: Event) => e.preventDefault();

  private updateBasis(): void {
    this.forward.set(
      Math.cos(this.pitch) * Math.sin(this.yaw),
      Math.sin(this.pitch),
      Math.cos(this.pitch) * Math.cos(this.yaw),
    );
    this.right.crossVectors(this.forward, this.up).normalize();
  }

  private applyCamera(): void {
    this.updateBasis();
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camPos.clone().add(this.forward));
  }

  private applyMoveDelta(delta: THREE.Vector3): void {
    if (delta.lengthSq() < 1e-8) return;
    this.camPos.add(delta);

    if (this.drag) {
      const pos = this.drag.lastPos.clone().add(delta);
      this.clampAndSetDragPosition(pos);
    }

    this.applyCamera();
  }

  private moveAlongView(amount: number): void {
    this.updateBasis();
    this.applyMoveDelta(this.forward.clone().multiplyScalar(amount));
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.disposed || this.isTypingTarget(e.target)) return;
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private tickMovement = (now: number): void => {
    if (!this.disposed) {
      const dt = Math.min(0.05, (now - this.lastMoveTime) / 1000);
      this.lastMoveTime = now;

      if (this.keys.size > 0 && !this.isTypingTarget(document.activeElement)) {
        this.updateBasis();

        const forwardFlat = new THREE.Vector3(this.forward.x, 0, this.forward.z);
        if (forwardFlat.lengthSq() < 1e-6) forwardFlat.set(0, 0, -1);
        forwardFlat.normalize();

        const rightFlat = new THREE.Vector3().crossVectors(forwardFlat, this.up).normalize();

        const move = new THREE.Vector3();
        if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move.add(forwardFlat);
        if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.sub(forwardFlat);
        if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move.add(rightFlat);
        if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) move.sub(rightFlat);
        if (this.keys.has('Space')) move.add(this.up);
        if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) move.sub(this.up);

        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(MOVE_SPEED * dt);
          this.applyMoveDelta(move);
        }
      }

      this.moveLoopId = requestAnimationFrame(this.tickMovement);
    }
  };

  private getMinCenterY(mesh: THREE.Mesh): number {
    const box = new THREE.Box3().setFromObject(mesh);
    const halfHeight = Math.max(0.15, (box.max.y - box.min.y) * 0.5);
    return GROUND_SURFACE_Y + halfHeight;
  }

  private clampY(y: number, minCenterY: number): number {
    return Math.max(minCenterY, y);
  }

  private clampAndSetDragPosition(pos: THREE.Vector3): void {
    if (!this.drag) return;

    pos.y = this.clampY(pos.y, this.drag.minCenterY);

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
  }

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

    this.pointerPrev = { x: e.clientX, y: e.clientY };

    // Right mouse → look around
    if (e.button === 2) {
      this.lookDragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // Middle mouse → pan
    if (e.button === 1) {
      this.panDragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (e.button !== 0) return;

    const hit = this.pick(e);

    // Left on empty space → pan (free move, not orbit-locked)
    if (!hit || !hit.body.isDynamic()) {
      this.panDragging = true;
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
      minCenterY: this.getMinCenterY(hit.mesh),
    };

    this.setHover(hit);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.disposed) return;

    const dx = e.clientX - this.pointerPrev.x;
    const dy = e.clientY - this.pointerPrev.y;
    this.pointerPrev = { x: e.clientX, y: e.clientY };

    if (this.lookDragging) {
      this.yaw -= dx * LOOK_SENS;
      this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch - dy * LOOK_SENS));
      this.applyCamera();
      return;
    }

    if (this.panDragging) {
      this.updateBasis();
      const pan = this.right.clone().multiplyScalar(-dx * PAN_SENS)
        .add(new THREE.Vector3(0, 1, 0).multiplyScalar(dy * PAN_SENS));
      this.applyMoveDelta(pan);
      return;
    }

    if (this.drag) {
      const hitPoint = new THREE.Vector3();
      if (!this.planeHit(e, this.drag.plane, hitPoint)) return;

      const pos = hitPoint.add(this.drag.offset);
      this.clampAndSetDragPosition(pos);
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
    this.lookDragging = false;
    this.panDragging = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
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
    const amount = -e.deltaY * SCROLL_SENS;
    this.moveAlongView(amount);
  };
}
