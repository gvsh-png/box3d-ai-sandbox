import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type {
  CommandBatch,
  ExplodeCommand,
  PauseCommand,
  SetGravityCommand,
  SimulationCommand,
  SpawnBodyCommand,
  SpawnGroundCommand,
} from '../types/commands';

type BodyEntry = {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
};

const SKY_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22'];

export class SandboxWorld {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  private world: RAPIER.World | null = null;
  private bodies: BodyEntry[] = [];
  private groundEntry: BodyEntry | null = null;
  private animationId = 0;
  private paused = false;
  private container: HTMLElement;
  private nextId = 0;
  private ready = false;

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0d0f);
    this.scene.fog = new THREE.Fog(0x0d0d0f, 30, 80);

    const aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 200);
    this.camera.position.set(8, 6, 12);
    this.camera.lookAt(0, 2, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.addLights();
    this.addGrid();
    this.setupOrbitControls();
    window.addEventListener('resize', this.onResize);
  }

  async init(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -10, z: 0 });
    this.spawnGround({ action: 'spawnGround' });
    this.ready = true;
    this.tick();
  }

  isReady(): boolean {
    return this.ready;
  }

  getSceneSummary(): string {
    const dynamic = this.bodies.length;
    const gravity = this.world?.gravity ?? { x: 0, y: -10, z: 0 };
    return `${dynamic} dynamic bodies, gravity (${gravity.x}, ${gravity.y}, ${gravity.z}), paused=${this.paused}`;
  }

  executeBatch(batch: CommandBatch): string {
    for (const cmd of batch.commands) {
      this.execute(cmd);
    }
    return batch.message ?? `Executed ${batch.commands.length} command(s).`;
  }

  execute(cmd: SimulationCommand): void {
    if (!this.world) return;

    switch (cmd.action) {
      case 'spawn':
        this.spawnBodies(cmd);
        break;
      case 'spawnGround':
        this.spawnGround(cmd);
        break;
      case 'setGravity':
        this.setGravity(cmd);
        break;
      case 'clear':
        this.clearDynamic();
        break;
      case 'pause':
        this.setPaused(cmd);
        break;
      case 'explode':
        this.explode(cmd);
        break;
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    this.clearAll();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  private addLights(): void {
    const ambient = new THREE.AmbientLight(0x404050, 0.6);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(10, 20, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    this.scene.add(sun);
  }

  private addGrid(): void {
    const grid = new THREE.GridHelper(40, 40, 0x333340, 0x222228);
    this.scene.add(grid);
  }

  private setupOrbitControls(): void {
    const canvas = this.renderer.domElement;
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let theta = 0.8;
    let phi = 0.6;
    let radius = 16;
    const target = new THREE.Vector3(0, 2, 0);

    const updateCamera = () => {
      this.camera.position.x = target.x + radius * Math.sin(phi) * Math.cos(theta);
      this.camera.position.y = target.y + radius * Math.cos(phi);
      this.camera.position.z = target.z + radius * Math.sin(phi) * Math.sin(theta);
      this.camera.lookAt(target);
    };

    updateCamera();

    canvas.addEventListener('pointerdown', (e) => {
      isDragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
    });
    window.addEventListener('pointerup', () => {
      isDragging = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      theta -= dx * 0.005;
      phi = Math.max(0.15, Math.min(1.4, phi - dy * 0.005));
      prevX = e.clientX;
      prevY = e.clientY;
      updateCamera();
    });
    canvas.addEventListener('wheel', (e) => {
      radius = Math.max(5, Math.min(40, radius + e.deltaY * 0.02));
      updateCamera();
    });
  }

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private tick = (): void => {
    this.animationId = requestAnimationFrame(this.tick);
    if (!this.world || this.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.world.step();
    for (const entry of this.bodies) {
      const t = entry.body.translation();
      const r = entry.body.rotation();
      entry.mesh.position.set(t.x, t.y, t.z);
      entry.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }

    this.renderer.render(this.scene, this.camera);
  };

  private spawnGround(cmd: SpawnGroundCommand): void {
    if (!this.world) return;

    if (this.groundEntry) {
      this.removeEntry(this.groundEntry);
      this.groundEntry = null;
    }

    const size = cmd.size ?? { x: 20, y: 1, z: 20 };
    const pos = cmd.position ?? { x: 0, y: -0.5, z: 0 };
    const color = cmd.color ?? '#2a2a32';

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.1 }),
    );
    mesh.receiveShadow = true;
    mesh.position.set(pos.x, pos.y, pos.z);
    this.scene.add(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
    const collider = this.world.createCollider(colliderDesc, body);

    this.groundEntry = { mesh, body, collider };
  }

  private spawnBodies(cmd: SpawnBodyCommand): void {
    const count = cmd.count ?? (cmd.fromSky ? 4 : 1);
    for (let i = 0; i < count; i++) {
      const spread = cmd.fromSky ? 6 : 2;
      const offsetX = (Math.random() - 0.5) * spread;
      const offsetZ = (Math.random() - 0.5) * spread;
      const y = cmd.fromSky ? 8 + Math.random() * 6 : cmd.position.y;

      this.spawnSingle({
        ...cmd,
        position: {
          x: cmd.position.x + offsetX,
          y,
          z: cmd.position.z + offsetZ,
        },
        color: cmd.color ?? SKY_COLORS[i % SKY_COLORS.length],
      });
    }
  }

  private spawnSingle(cmd: SpawnBodyCommand): void {
    if (!this.world) return;

    const { x, y, z } = cmd.position;
    const color = cmd.color ?? '#3498db';
    let mesh: THREE.Mesh;
    let colliderDesc: RAPIER.ColliderDesc;

    if (cmd.shape === 'sphere') {
      const r = cmd.radius ?? 0.5;
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(r, 24, 24),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 }),
      );
      colliderDesc = RAPIER.ColliderDesc.ball(r);
    } else if (cmd.shape === 'capsule') {
      const r = cmd.radius ?? 0.35;
      const h = cmd.height ?? 1;
      mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(r, h, 8, 16),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 }),
      );
      colliderDesc = RAPIER.ColliderDesc.capsule(h / 2, r);
    } else {
      const size = cmd.size ?? { x: 1, y: 1, z: 1 };
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 }),
      );
      colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x, y, z);
    mesh.userData.sandboxId = cmd.id ?? `body-${this.nextId++}`;
    this.scene.add(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
    const body = this.world.createRigidBody(bodyDesc);

    colliderDesc.setDensity(cmd.density ?? 1);
    colliderDesc.setFriction(cmd.friction ?? 0.4);
    colliderDesc.setRestitution(cmd.restitution ?? 0.2);
    const collider = this.world.createCollider(colliderDesc, body);

    if (cmd.velocity) {
      body.setLinvel(cmd.velocity, true);
    } else if (cmd.fromSky) {
      body.setLinvel({ x: (Math.random() - 0.5) * 2, y: -1, z: (Math.random() - 0.5) * 2 }, true);
    }

    this.bodies.push({ mesh, body, collider });
  }

  private setGravity(cmd: SetGravityCommand): void {
    if (!this.world) return;
    const g = cmd.gravity;
    this.world.gravity = { x: g.x, y: g.y, z: g.z };
  }

  private setPaused(cmd: PauseCommand): void {
    this.paused = cmd.paused;
  }

  private explode(cmd: ExplodeCommand): void {
    if (!this.world) return;
    const { x, y, z } = cmd.position;
    for (const entry of this.bodies) {
      const t = entry.body.translation();
      const dx = t.x - x;
      const dy = t.y - y;
      const dz = t.z - z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < cmd.radius && dist > 0.01) {
        const force = (cmd.strength / dist) * 0.5;
        entry.body.applyImpulse({ x: dx * force, y: dy * force + 2, z: dz * force }, true);
      }
    }
  }

  private clearDynamic(): void {
    for (const entry of [...this.bodies]) {
      this.removeEntry(entry);
    }
    this.bodies = [];
  }

  private clearAll(): void {
    this.clearDynamic();
    if (this.groundEntry) {
      this.removeEntry(this.groundEntry);
      this.groundEntry = null;
    }
    if (this.world) {
      this.world.free();
      this.world = null;
    }
  }

  private removeEntry(entry: BodyEntry): void {
    this.scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    (entry.mesh.material as THREE.Material).dispose();
    if (this.world) {
      this.world.removeRigidBody(entry.body);
    }
  }
}
