import * as THREE from 'three';

export type CameraMode = 'free' | 'follow' | 'orbit' | 'path';

export type CameraKeyframe = {
  t: number;
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
};

export class CinematicCamera {
  mode: CameraMode = 'free';
  targetId: string | null = null;
  offset = new THREE.Vector3(0, 3, 8);
  orbitRadius = 10;
  orbitHeight = 4;
  orbitSpeed = 0.35;
  orbitAngle = 0;
  path: CameraKeyframe[] = [];
  pathTime = 0;
  pathLoop = false;
  active = false;

  private lookTarget = new THREE.Vector3(0, 2, 0);
  private temp = new THREE.Vector3();

  getLookTarget(): THREE.Vector3 {
    return this.lookTarget;
  }

  free(): void {
    this.mode = 'free';
    this.active = false;
    this.targetId = null;
  }

  follow(bodyId: string, offset?: { x: number; y: number; z: number }): void {
    this.mode = 'follow';
    this.active = true;
    this.targetId = bodyId;
    if (offset) this.offset.set(offset.x, offset.y, offset.z);
  }

  orbit(bodyId: string, radius = 10, height = 4, speed = 0.35): void {
    this.mode = 'orbit';
    this.active = true;
    this.targetId = bodyId;
    this.orbitRadius = radius;
    this.orbitHeight = height;
    this.orbitSpeed = speed;
  }

  setPath(keyframes: CameraKeyframe[], loop = false): void {
    this.mode = 'path';
    this.active = keyframes.length > 0;
    this.path = keyframes.sort((a, b) => a.t - b.t);
    this.pathTime = 0;
    this.pathLoop = loop;
  }

  lookAt(x: number, y: number, z: number): void {
    this.lookTarget.set(x, y, z);
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    getBodyPosition: (id: string) => THREE.Vector3 | null,
  ): void {
    if (!this.active) return;

    if (this.mode === 'follow' && this.targetId) {
      const target = getBodyPosition(this.targetId);
      if (!target) return;
      this.lookTarget.copy(target);
      this.temp.copy(this.offset);
      camera.position.lerp(target.clone().add(this.temp), 1 - Math.pow(0.001, dt));
      camera.lookAt(this.lookTarget);
      return;
    }

    if (this.mode === 'orbit' && this.targetId) {
      const target = getBodyPosition(this.targetId);
      if (!target) return;
      this.orbitAngle += dt * this.orbitSpeed;
      this.lookTarget.copy(target);
      camera.position.set(
        target.x + Math.cos(this.orbitAngle) * this.orbitRadius,
        target.y + this.orbitHeight,
        target.z + Math.sin(this.orbitAngle) * this.orbitRadius,
      );
      camera.lookAt(this.lookTarget);
      return;
    }

    if (this.mode === 'path' && this.path.length > 0) {
      this.pathTime += dt;
      const duration = this.path[this.path.length - 1].t;
      if (this.pathTime > duration) {
        if (this.pathLoop) this.pathTime = 0;
        else {
          this.pathTime = duration;
          this.active = false;
        }
      }

      let i = 0;
      while (i < this.path.length - 2 && this.path[i + 1].t < this.pathTime) i++;
      const a = this.path[i];
      const b = this.path[Math.min(i + 1, this.path.length - 1)];
      const span = Math.max(0.0001, b.t - a.t);
      const alpha = Math.min(1, (this.pathTime - a.t) / span);

      camera.position.lerpVectors(
        new THREE.Vector3(a.position.x, a.position.y, a.position.z),
        new THREE.Vector3(b.position.x, b.position.y, b.position.z),
        alpha,
      );
      this.lookTarget.lerpVectors(
        new THREE.Vector3(a.lookAt.x, a.lookAt.y, a.lookAt.z),
        new THREE.Vector3(b.lookAt.x, b.lookAt.y, b.lookAt.z),
        alpha,
      );
      camera.lookAt(this.lookTarget);
    }
  }
}
