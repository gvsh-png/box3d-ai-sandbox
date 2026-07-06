import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type RAPIER_NS from '@dimforge/rapier3d-compat';

type Pickable = {
  mesh: THREE.Mesh;
  body: RAPIER_NS.RigidBody;
  id: string;
};

type DragState = {
  entry: Pickable;
  plane: THREE.Plane;
  offset: THREE.Vector3;
  lastPos: THREE.Vector3;
  lastTime: number;
  velocity: THREE.Vector3;
  savedType: RAPIER_NS.RigidBodyType;
  minCenterY: number;
};

const GROUND_Y = 0.02;
const LOOK_SENS = 0.0022;
const MOVE_SPEED = 14;
const MOVE_ACCEL = 6;
const SCROLL_SPEED = 2.5;

/**
 * WASD always flies where you look · RMB look · LMB cursor-drag objects
 */
export class ObjectInteraction {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private drag: DragState | null = null;
  private hovered: Pickable | null = null;
  private lmbDown = false;
  private rmbDown = false;
  private pointerPrev = { x: 0, y: 0 };
  private captureId: number | null = null;

  private camPos = new THREE.Vector3(8, 6, 12);
  private yaw = -0.6;
  private pitch = -0.35;
  private moveVel = new THREE.Vector3();

  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private keys = new Set<string>();
  private cinematicOverride = false;

  private disposed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.PerspectiveCamera,
    private getPickables: () => Pickable[],
  ) {
    canvas.tabIndex = 0;
    canvas.style.outline = 'none';
    canvas.style.touchAction = 'none';

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    this.applyCamera();
  }

  update(dt: number): void {
    if (this.disposed || this.isTyping() || this.cinematicOverride) return;
    this.updateMovement(dt);
  }

  setCinematicOverride(on: boolean): void {
    this.cinematicOverride = on;
  }

  dispose(): void {
    this.disposed = true;
    this.releaseDrag();
    this.hovered = null;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  private isTyping(): boolean {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

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

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.disposed || this.isTyping()) return;
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  /** WASD always — W flies in the direction you are looking */
  private updateMovement(dt: number): void {
    this.updateBasis();

    const wish = new THREE.Vector3();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) wish.add(this.forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) wish.sub(this.forward);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) wish.add(this.right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) wish.sub(this.right);
    if (this.keys.has('Space')) wish.add(this.up);
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) wish.sub(this.up);

    const targetVel = new THREE.Vector3();
    if (wish.lengthSq() > 0) {
      targetVel.copy(wish.normalize().multiplyScalar(MOVE_SPEED));
    }

    const t = 1 - Math.exp(-MOVE_ACCEL * dt);
    this.moveVel.lerp(targetVel, t);

    if (this.moveVel.lengthSq() > 1e-6) {
      const delta = this.moveVel.clone().multiplyScalar(dt);
      this.camPos.add(delta);

      // Move dragged object with camera when flying
      if (this.drag && this.lmbDown) {
        const pos = this.drag.lastPos.clone().add(delta);
        this.setDragPosition(pos);
      }

      this.applyCamera();
    }
  }

  private getMinCenterY(mesh: THREE.Mesh): number {
    const box = new THREE.Box3().setFromObject(mesh);
    return GROUND_Y + Math.max(0.15, (box.max.y - box.min.y) * 0.5);
  }

  private setDragPosition(pos: THREE.Vector3): void {
    if (!this.drag) return;

    pos.y = Math.max(this.drag.minCenterY, pos.y);

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

  private setPointer(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  private pickAt(ndc: THREE.Vector2): Pickable | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = this.getPickables().map((p) => p.mesh);
    if (!meshes.length) return null;
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const mesh = hits[0].object as THREE.Mesh;
    return this.getPickables().find((p) => p.mesh === mesh) ?? null;
  }

  private planeHit(ndc: THREE.Vector2, plane: THREE.Plane, out: THREE.Vector3): boolean {
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(plane, out) !== null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.disposed) return;
    this.canvas.focus({ preventScroll: true });
    this.pointerPrev = { x: e.clientX, y: e.clientY };

    if (e.button === 2) {
      this.rmbDown = true;
      this.capture(e);
      return;
    }

    if (e.button !== 0) return;

    this.lmbDown = true;
    this.setPointer(e);

    const hit = this.pickAt(this.pointer);
    if (!hit?.body.isDynamic()) {
      this.capture(e);
      return;
    }

    const hitPoint = new THREE.Vector3();
    const bodyPos = hit.body.translation();
    const grabPoint = new THREE.Vector3(bodyPos.x, bodyPos.y, bodyPos.z);

    const normal = new THREE.Vector3();
    this.camera.getWorldDirection(normal);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, grabPoint);

    if (!this.planeHit(this.pointer, plane, hitPoint)) return;

    this.capture(e);
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

    if (this.rmbDown) {
      this.yaw -= dx * LOOK_SENS;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * LOOK_SENS, -1.55, 1.55);
      this.applyCamera();
    }

    // Cursor drag — LMB held, pause while RMB look is active
    if (this.drag && this.lmbDown && !this.rmbDown) {
      this.setPointer(e);
      const hitPoint = new THREE.Vector3();
      if (this.planeHit(this.pointer, this.drag.plane, hitPoint)) {
        this.setDragPosition(hitPoint.add(this.drag.offset));
      }
      return;
    }

    if (!this.lmbDown && !this.rmbDown) {
      this.setPointer(e);
      const hit = this.pickAt(this.pointer);
      if (hit?.body.isDynamic()) {
        this.setHover(hit);
        this.canvas.style.cursor = 'grab';
      } else {
        this.setHover(null);
        this.canvas.style.cursor = 'default';
      }
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button === 2) {
      this.rmbDown = false;
    } else if (e.button === 0) {
      this.lmbDown = false;
      this.releaseDrag();
    }

    if (!this.lmbDown && !this.rmbDown) {
      this.releaseCapture(e);
      this.canvas.style.cursor = this.hovered ? 'grab' : 'default';
    }
  };

  private capture(e: PointerEvent): void {
    if (this.captureId === null) {
      this.canvas.setPointerCapture(e.pointerId);
      this.captureId = e.pointerId;
    }
  }

  private releaseCapture(e: PointerEvent): void {
    if (this.captureId === e.pointerId) {
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ok */
      }
      this.captureId = null;
    }
  }

  private releaseDrag(): void {
    if (!this.drag) return;

    const { entry, velocity, savedType } = this.drag;
    const t = entry.body.translation();

    entry.body.setBodyType(savedType, true);
    entry.body.setTranslation({ x: t.x, y: t.y, z: t.z }, true);
    entry.body.setLinvel(
      { x: velocity.x * 0.4, y: velocity.y * 0.4, z: velocity.z * 0.4 },
      true,
    );

    this.drag = null;
    if (!this.lmbDown) this.canvas.style.cursor = this.hovered ? 'grab' : 'default';
  }

  private setHover(entry: Pickable | null): void {
    this.hovered = entry;
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.updateBasis();
    this.camPos.addScaledVector(this.forward, -e.deltaY * 0.01 * SCROLL_SPEED);

    if (this.drag && this.lmbDown) {
      const pos = this.drag.lastPos.clone().addScaledVector(this.forward, -e.deltaY * 0.01 * SCROLL_SPEED);
      this.setDragPosition(pos);
    }

    this.applyCamera();
  };
}
