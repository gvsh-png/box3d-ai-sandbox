import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

type Pickable = {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  id: string;
};

type GrabState = {
  entry: Pickable;
  holdDistance: number;
  target: THREE.Vector3;
  minCenterY: number;
};

const GROUND_SURFACE_Y = 0.02;

// Camera feel
const LOOK_SENS = 0.002;
const MOVE_ACCEL = 55;
const MOVE_MAX_SPEED = 16;
const MOVE_DAMPING = 10;
const SCROLL_IMPULSE = 1.8;

// Grab feel (spring physics — object stays dynamic)
const GRAB_SPRING = 140;
const GRAB_DAMPING = 22;
const GRAB_DIST_MIN = 2.5;
const GRAB_DIST_MAX = 22;
const GRAB_SPIN_DAMP = 0.88;

/**
 * Smooth fly camera + spring-based object grab (GMod-style).
 *
 * RMB / MMB — look around
 * WASD + Space/Shift — smooth fly
 * Scroll — dolly forward/back (adjust grab distance while holding)
 * LMB on object — spring grab (release to throw)
 */
export class ObjectInteraction {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private grab: GrabState | null = null;
  private hovered: Pickable | null = null;
  private lmbDown = false;
  private rmbDown = false;
  private mmbDown = false;
  private capturePointerId: number | null = null;
  private pointerPrev = { x: 0, y: 0 };

  private camPos = new THREE.Vector3(8, 6, 12);
  private yaw = -0.6;
  private pitch = -0.35;
  private moveVel = new THREE.Vector3();

  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private keys = new Set<string>();

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
    this.applyCamera();
  }

  /** Called each physics frame from SandboxWorld. */
  update(dt: number): void {
    if (this.disposed) return;
    this.updateCameraMovement(dt);
    this.updateGrabSpring(dt);
  }

  dispose(): void {
    this.disposed = true;
    this.releaseGrab();
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

  private updateCameraMovement(dt: number): void {
    if (this.isTypingTarget(document.activeElement)) return;

    this.updateBasis();

    const wish = new THREE.Vector3();
    const forwardFlat = new THREE.Vector3(this.forward.x, 0, this.forward.z);
    if (forwardFlat.lengthSq() < 1e-6) forwardFlat.set(0, 0, -1);
    forwardFlat.normalize();
    const rightFlat = new THREE.Vector3().crossVectors(forwardFlat, this.up).normalize();

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) wish.add(forwardFlat);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) wish.sub(forwardFlat);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) wish.add(rightFlat);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) wish.sub(rightFlat);
    if (this.keys.has('Space')) wish.add(this.up);
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) wish.sub(this.up);

    if (wish.lengthSq() > 0) {
      wish.normalize().multiplyScalar(MOVE_ACCEL * dt);
      this.moveVel.add(wish);
    }

    const speed = this.moveVel.length();
    if (speed > MOVE_MAX_SPEED) {
      this.moveVel.multiplyScalar(MOVE_MAX_SPEED / speed);
    }

    this.moveVel.multiplyScalar(Math.exp(-MOVE_DAMPING * dt));

    if (this.moveVel.lengthSq() > 1e-8) {
      this.camPos.addScaledVector(this.moveVel, dt);
      this.applyCamera();
    }
  }

  private updateGrabTarget(): void {
    if (!this.grab) return;
    this.updateBasis();
    this.grab.target
      .copy(this.camPos)
      .addScaledVector(this.forward, this.grab.holdDistance);
    this.grab.target.y = Math.max(this.grab.minCenterY, this.grab.target.y);
  }

  private updateGrabSpring(dt: number): void {
    if (!this.grab) return;

    this.updateGrabTarget();

    const body = this.grab.entry.body;
    const pos = body.translation();
    const vel = body.linvel();

    const dx = this.grab.target.x - pos.x;
    const dy = this.grab.target.y - pos.y;
    const dz = this.grab.target.z - pos.z;

    body.applyImpulse(
      {
        x: (dx * GRAB_SPRING - vel.x * GRAB_DAMPING) * dt,
        y: (dy * GRAB_SPRING - vel.y * GRAB_DAMPING) * dt,
        z: (dz * GRAB_SPRING - vel.z * GRAB_DAMPING) * dt,
      },
      true,
    );

    const av = body.angvel();
    body.setAngvel(
      { x: av.x * GRAB_SPIN_DAMP, y: av.y * GRAB_SPIN_DAMP, z: av.z * GRAB_SPIN_DAMP },
      true,
    );
  }

  private getMinCenterY(mesh: THREE.Mesh): number {
    const box = new THREE.Box3().setFromObject(mesh);
    const halfHeight = Math.max(0.15, (box.max.y - box.min.y) * 0.5);
    return GROUND_SURFACE_Y + halfHeight;
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pick(): Pickable | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = this.getPickables().map((p) => p.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const mesh = hits[0].object as THREE.Mesh;
    return this.getPickables().find((p) => p.mesh === mesh) ?? null;
  }

  private capturePointer(e: PointerEvent): void {
    if (this.capturePointerId === null) {
      this.canvas.setPointerCapture(e.pointerId);
      this.capturePointerId = e.pointerId;
    }
  }

  private releaseCapture(e: PointerEvent): void {
    if (this.capturePointerId === e.pointerId) {
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ok */
      }
      this.capturePointerId = null;
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.disposed) return;
    this.pointerPrev = { x: e.clientX, y: e.clientY };

    if (e.button === 2) {
      this.rmbDown = true;
      this.capturePointer(e);
      e.preventDefault();
      return;
    }

    if (e.button === 1) {
      this.mmbDown = true;
      this.capturePointer(e);
      e.preventDefault();
      return;
    }

    if (e.button !== 0) return;

    this.lmbDown = true;
    this.updatePointer(e);
    const hit = this.pick();

    if (!hit || !hit.body.isDynamic()) {
      this.capturePointer(e);
      return;
    }

    this.capturePointer(e);
    this.canvas.style.cursor = 'grabbing';

    const bodyPos = hit.body.translation();
    const dist = this.camPos.distanceTo(new THREE.Vector3(bodyPos.x, bodyPos.y, bodyPos.z));
    const holdDistance = THREE.MathUtils.clamp(dist, GRAB_DIST_MIN, GRAB_DIST_MAX);

    this.grab = {
      entry: hit,
      holdDistance,
      target: new THREE.Vector3(bodyPos.x, bodyPos.y, bodyPos.z),
      minCenterY: this.getMinCenterY(hit.mesh),
    };

    hit.body.wakeUp();
    this.setHover(hit);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.disposed) return;

    const dx = e.clientX - this.pointerPrev.x;
    const dy = e.clientY - this.pointerPrev.y;
    this.pointerPrev = { x: e.clientX, y: e.clientY };

    if (this.rmbDown || this.mmbDown) {
      this.yaw -= dx * LOOK_SENS;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * LOOK_SENS, -1.52, 1.52);
      this.applyCamera();
    }

    if (!this.lmbDown && !this.rmbDown && !this.mmbDown) {
      this.updatePointer(e);
      const hit = this.pick();
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
    if (e.button === 2) this.rmbDown = false;
    else if (e.button === 1) this.mmbDown = false;
    else if (e.button === 0) {
      this.lmbDown = false;
      this.releaseGrab();
    }

    if (!this.lmbDown && !this.rmbDown && !this.mmbDown) {
      this.releaseCapture(e);
      this.canvas.style.cursor = this.hovered ? 'grab' : 'default';
    }
  };

  private releaseGrab(): void {
    if (!this.grab) return;
    this.grab.entry.body.wakeUp();
    this.grab = null;
    this.canvas.style.cursor = this.hovered ? 'grab' : 'default';
  }

  private setHover(entry: Pickable | null): void {
    if (this.hovered && this.hovered !== entry) {
      this.setMeshHighlight(this.hovered.mesh, false);
    }
    this.hovered = entry;
    if (entry && entry !== this.grab?.entry) {
      this.setMeshHighlight(entry.mesh, true);
    }
  }

  private setMeshHighlight(mesh: THREE.Mesh, on: boolean): void {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      if (m instanceof THREE.MeshStandardMaterial) {
        m.emissive.setHex(on ? 0x223355 : 0x000000);
        m.emissiveIntensity = on ? 0.25 : 0;
      }
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.updateBasis();

    const scrollDelta = -e.deltaY * 0.003 * SCROLL_IMPULSE;

    if (this.grab && this.lmbDown) {
      this.grab.holdDistance = THREE.MathUtils.clamp(
        this.grab.holdDistance + e.deltaY * 0.015,
        GRAB_DIST_MIN,
        GRAB_DIST_MAX,
      );
      return;
    }

    const impulse = this.forward.clone().multiplyScalar(scrollDelta * 60);
    this.moveVel.add(impulse);
    this.applyCamera();
  };
}
