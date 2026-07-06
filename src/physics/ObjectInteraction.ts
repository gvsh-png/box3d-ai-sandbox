import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

type Pickable = {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  id: string;
};

type GrabState = {
  entry: Pickable;
  holdDistance: number;
  minCenterY: number;
};

const GROUND_Y = 0.02;

// ── Tuning ──────────────────────────────────────────────────────────
const LOOK_SENS = 0.0022;
const MOVE_SPEED = 14;
const MOVE_ACCEL = 6; // how fast we reach target speed (higher = snappier)
const SCROLL_SPEED = 2.5;

const GRAB_FOLLOW = 18; // velocity pull toward target
const GRAB_MAX_SPEED = 22;
const GRAB_DIST_MIN = 2;
const GRAB_DIST_MAX = 24;
const GRAB_SPIN_DAMP = 0.82;

/**
 * FPS sandbox controls:
 *   Hold RMB → look + WASD flies where you aim (W = into the screen)
 *   LMB on object → grab & drag (follows crosshair / view center)
 *   Scroll → move forward (RMB held) or adjust grab distance (LMB held)
 */
export class ObjectInteraction {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private grab: GrabState | null = null;
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
    if (this.disposed) return;
    if (this.isEngaged()) this.updateMovement(dt);
    if (this.grab && this.lmbDown) this.updateGrab(dt);
  }

  dispose(): void {
    this.disposed = true;
    this.releaseGrab();
    this.setHover(null);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  /** RMB held = mouselook + WASD active */
  private isEngaged(): boolean {
    return this.rmbDown;
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

  /** WASD relative to where camera looks — only while RMB held */
  private updateMovement(dt: number): void {
    if (this.isTyping()) return;
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

    // Smooth toward target velocity
    const t = 1 - Math.exp(-MOVE_ACCEL * dt);
    this.moveVel.lerp(targetVel, t);

    if (this.moveVel.lengthSq() > 1e-6) {
      this.camPos.addScaledVector(this.moveVel, dt);
      this.applyCamera();
    }
  }

  /** Aim point at center of screen (crosshair) */
  private getAimPoint(distance: number, out: THREE.Vector3): THREE.Vector3 {
    this.updateBasis();
    return out.copy(this.camPos).addScaledVector(this.forward, distance);
  }

  private updateGrab(dt: number): void {
    if (!this.grab) return;

    const target = this.getAimPoint(this.grab.holdDistance, new THREE.Vector3());
    target.y = Math.max(this.grab.minCenterY, target.y);

    const body = this.grab.entry.body;
    body.wakeUp();

    const pos = body.translation();
    const vel = body.linvel();

    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const dz = target.z - pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > 0.01) {
      const speed = Math.min(dist * GRAB_FOLLOW, GRAB_MAX_SPEED);
      const inv = 1 / dist;
      const desiredVx = dx * inv * speed;
      const desiredVy = dy * inv * speed;
      const desiredVz = dz * inv * speed;

      const blend = 1 - Math.exp(-12 * dt);
      body.setLinvel(
        {
          x: vel.x + (desiredVx - vel.x) * blend,
          y: vel.y + (desiredVy - vel.y) * blend,
          z: vel.z + (desiredVz - vel.z) * blend,
        },
        true,
      );
    }

    const av = body.angvel();
    body.setAngvel(
      { x: av.x * GRAB_SPIN_DAMP, y: av.y * GRAB_SPIN_DAMP, z: av.z * GRAB_SPIN_DAMP },
      true,
    );
  }

  private getMinCenterY(mesh: THREE.Mesh): number {
    const box = new THREE.Box3().setFromObject(mesh);
    return GROUND_Y + Math.max(0.15, (box.max.y - box.min.y) * 0.5);
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
    if (hit?.body.isDynamic()) {
      this.capture(e);
      this.canvas.style.cursor = 'grabbing';

      const bp = hit.body.translation();
      const dist = this.camPos.distanceTo(new THREE.Vector3(bp.x, bp.y, bp.z));

      this.grab = {
        entry: hit,
        holdDistance: THREE.MathUtils.clamp(dist, GRAB_DIST_MIN, GRAB_DIST_MAX),
        minCenterY: this.getMinCenterY(hit.mesh),
      };

      hit.body.wakeUp();
      hit.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.setHover(hit);
    } else {
      this.capture(e);
    }
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
      this.moveVel.set(0, 0, 0);
    } else if (e.button === 0) {
      this.lmbDown = false;
      this.releaseGrab();
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

  private releaseGrab(): void {
    if (!this.grab) return;
    this.grab.entry.body.wakeUp();
    this.grab = null;
    if (!this.lmbDown) this.canvas.style.cursor = this.hovered ? 'grab' : 'default';
  }

  private setHover(entry: Pickable | null): void {
    if (this.hovered && this.hovered !== entry) {
      this.setHighlight(this.hovered.mesh, false);
    }
    this.hovered = entry;
    if (entry && entry !== this.grab?.entry) {
      this.setHighlight(entry.mesh, true);
    }
  }

  private setHighlight(mesh: THREE.Mesh, on: boolean): void {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m instanceof THREE.MeshStandardMaterial) {
        m.emissive.setHex(on ? 0x224466 : 0x000000);
        m.emissiveIntensity = on ? 0.3 : 0;
      }
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.updateBasis();

    if (this.grab && this.lmbDown) {
      this.grab.holdDistance = THREE.MathUtils.clamp(
        this.grab.holdDistance - e.deltaY * 0.012,
        GRAB_DIST_MIN,
        GRAB_DIST_MAX,
      );
      return;
    }

    if (this.rmbDown) {
      this.camPos.addScaledVector(this.forward, -e.deltaY * 0.01 * SCROLL_SPEED);
      this.applyCamera();
    }
  };
}
