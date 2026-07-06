import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ObjectInteraction } from './ObjectInteraction';
import type {
  AddJointCommand,
  ApplyForceCommand,
  CommandBatch,
  ExplodeCommand,
  MaterialPreset,
  PauseCommand,
  SetGravityCommand,
  SetMotorCommand,
  SimulationCommand,
  SpawnBodyCommand,
  SpawnContainerCommand,
  SpawnGroundCommand,
  SpawnPatternCommand,
  SpawnRampCommand,
  Vec3,
} from '../types/commands';

type BodyEntry = {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  id: string;
};

type MotorState = { torque: number; axis: Vec3 };

const SKY_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22'];
const DEG = Math.PI / 180;

const MATERIALS: Record<MaterialPreset, { density: number; friction: number; restitution: number; color: string; metalness: number }> = {
  default: { density: 1, friction: 0.4, restitution: 0.2, color: '#3498db', metalness: 0.15 },
  wood: { density: 0.55, friction: 0.55, restitution: 0.15, color: '#8B4513', metalness: 0.05 },
  iron: { density: 7.5, friction: 0.45, restitution: 0.1, color: '#5a5a6a', metalness: 0.7 },
  rubber: { density: 1.1, friction: 0.8, restitution: 0.92, color: '#2ecc71', metalness: 0.1 },
};

export class SandboxWorld {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  private world: RAPIER.World | null = null;
  private bodies: BodyEntry[] = [];
  private bodyById = new Map<string, BodyEntry>();
  private motors = new Map<string, MotorState>();
  private joints: RAPIER.ImpulseJoint[] = [];
  private groundEntry: BodyEntry | null = null;
  private animationId = 0;
  private paused = false;
  private container: HTMLElement;
  private nextId = 0;
  private ready = false;
  private interaction: ObjectInteraction | null = null;

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
    window.addEventListener('resize', this.onResize);
  }

  async init(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -10, z: 0 });
    this.spawnGround({ action: 'spawnGround' });
    this.interaction = new ObjectInteraction(
      this.renderer.domElement,
      this.camera,
      () => this.bodies,
    );
    this.ready = true;
    this.tick();
  }

  isReady(): boolean {
    return this.ready;
  }

  getSceneSummary(): string {
    const dynamic = this.bodies.filter((b) => b.body.isDynamic()).length;
    const gravity = this.world?.gravity ?? { x: 0, y: -10, z: 0 };
    const ids = [...this.bodyById.keys()].slice(0, 12).join(', ');
    return `${this.bodies.length} bodies (${dynamic} dynamic), gravity (${gravity.x}, ${gravity.y}, ${gravity.z}), ids: [${ids}]`;
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
      case 'spawnPattern':
        this.spawnPattern(cmd);
        break;
      case 'spawnContainer':
        this.spawnContainer(cmd);
        break;
      case 'spawnRamp':
        this.spawnRamp(cmd);
        break;
      case 'addJoint':
        this.addJoint(cmd);
        break;
      case 'setMotor':
        this.setMotor(cmd);
        break;
      case 'applyForce':
        this.applyForce(cmd);
        break;
      case 'spawnGround':
        this.spawnGround(cmd);
        break;
      case 'setGravity':
        this.setGravity(cmd);
        break;
      case 'clear':
        this.clearSpawned();
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
    this.interaction?.dispose();
    this.interaction = null;
    this.clearAll();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  private addLights(): void {
    this.scene.add(new THREE.AmbientLight(0x404050, 0.6));
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
    this.scene.add(new THREE.GridHelper(40, 40, 0x333340, 0x222228));
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

    for (const [id, motor] of this.motors) {
      const entry = this.bodyById.get(id);
      if (entry) {
        entry.body.applyTorqueImpulse(
          { x: motor.axis.x * motor.torque, y: motor.axis.y * motor.torque, z: motor.axis.z * motor.torque },
          true,
        );
      }
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

  private matProps(material?: MaterialPreset, overrides?: Partial<SpawnBodyCommand>) {
    const base = MATERIALS[material ?? 'default'] ?? MATERIALS.default;
    return {
      density: overrides?.density ?? base.density,
      friction: overrides?.friction ?? base.friction,
      restitution: overrides?.restitution ?? base.restitution,
      color: overrides?.color ?? base.color,
      metalness: base.metalness,
    };
  }

  private eulerQuat(rot?: Vec3): THREE.Quaternion {
    if (!rot) return new THREE.Quaternion();
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(rot.x * DEG, rot.y * DEG, rot.z * DEG));
  }

  private registerEntry(entry: BodyEntry): void {
    this.bodies.push(entry);
    this.bodyById.set(entry.id, entry);
  }

  private spawnBodies(cmd: SpawnBodyCommand): void {
    const count = Math.min(cmd.count ?? (cmd.fromSky ? 4 : 1), 120);
    for (let i = 0; i < count; i++) {
      const spread = cmd.fromSky ? 6 : 2;
      const offsetX = count > 1 ? (Math.random() - 0.5) * spread : 0;
      const offsetZ = count > 1 ? (Math.random() - 0.5) * spread : 0;
      const y = cmd.fromSky ? 8 + Math.random() * 6 : cmd.position.y;

      this.spawnSingle({
        ...cmd,
        id: count > 1 ? `${cmd.id ?? 'body'}-${i}` : cmd.id,
        position: { x: cmd.position.x + offsetX, y, z: cmd.position.z + offsetZ },
        color: cmd.color ?? SKY_COLORS[i % SKY_COLORS.length],
      });
    }
  }

  private spawnPattern(cmd: SpawnPatternCommand): void {
    const count = Math.min(cmd.count, 120);
    const shape = cmd.shape ?? 'box';
    const spacing = cmd.spacing ?? 1.05;
    const base = cmd.position ?? { x: 0, y: 0, z: 0 };
    const size = cmd.size ?? (cmd.pattern === 'dominoes' ? { x: 0.25, y: 1.4, z: 0.7 } : { x: 1, y: 0.35, z: 1 });
    const props = this.matProps(cmd.material, {
      density: cmd.density,
      restitution: cmd.restitution,
      color: cmd.color,
    });

    for (let i = 0; i < count; i++) {
      let pos = { ...base };
      let rotation: Vec3 | undefined;

      switch (cmd.pattern) {
        case 'stack':
          pos.y = base.y + i * (size.y + 0.02) + size.y / 2;
          break;
        case 'jenga':
          pos.y = base.y + i * (size.y + 0.02) + size.y / 2;
          pos.x = base.x + (i % 2 === 0 ? -0.15 : 0.15);
          pos.z = base.z + (i % 4 < 2 ? -0.15 : 0.15);
          break;
        case 'line':
        case 'dominoes':
          pos.z = base.z + i * spacing;
          pos.y = base.y + (cmd.pattern === 'dominoes' ? size.y / 2 : size.y / 2);
          break;
        case 'circle': {
          const r = cmd.ringRadius ?? 4;
          const a = (i / count) * Math.PI * 2;
          pos.x = base.x + Math.cos(a) * r;
          pos.z = base.z + Math.sin(a) * r;
          pos.y = base.y + size.y / 2;
          break;
        }
        case 'grid': {
          const cols = Math.ceil(Math.sqrt(count));
          const row = Math.floor(i / cols);
          const col = i % cols;
          pos.x = base.x + (col - cols / 2) * spacing;
          pos.z = base.z + (row - cols / 2) * spacing;
          pos.y = base.y + size.y / 2;
          break;
        }
        case 'scatter': {
          const w = cmd.ringRadius ?? 4;
          pos.x = base.x + (Math.random() - 0.5) * w * 2;
          pos.z = base.z + (Math.random() - 0.5) * w * 2;
          pos.y = base.y + 0.5 + Math.random() * (w * 0.8);
          break;
        }
      }

      this.spawnSingle({
        action: 'spawn',
        shape,
        position: pos,
        size,
        radius: cmd.radius ?? 0.25,
        color: cmd.color ?? SKY_COLORS[i % SKY_COLORS.length],
        density: props.density,
        friction: props.friction,
        restitution: cmd.restitution ?? props.restitution,
        rotation,
        id: `pattern-${cmd.pattern}-${i}`,
      });
    }
  }

  private spawnContainer(cmd: SpawnContainerCommand): void {
    const t = cmd.wallThickness ?? 0.3;
    const pos = cmd.position ?? { x: 0, y: 0, z: 0 };
    const color = cmd.color ?? '#444455';
    const h = cmd.height;
    const w = cmd.width;
    const d = cmd.depth;
    const wallY = pos.y + h / 2;

    const walls = [
      { position: { x: pos.x, y: wallY, z: pos.z - d / 2 }, size: { x: w, y: h, z: t } },
      { position: { x: pos.x, y: wallY, z: pos.z + d / 2 }, size: { x: w, y: h, z: t } },
      { position: { x: pos.x - w / 2, y: wallY, z: pos.z }, size: { x: t, y: h, z: d } },
      { position: { x: pos.x + w / 2, y: wallY, z: pos.z }, size: { x: t, y: h, z: d } },
    ];

    walls.forEach((wall, i) => {
      this.spawnSingle({
        action: 'spawn',
        shape: 'box',
        position: wall.position,
        size: wall.size,
        color,
        static: true,
        id: `wall-${i}`,
      });
    });
  }

  private spawnRamp(cmd: SpawnRampCommand): void {
    const thickness = 0.4;
    this.spawnSingle({
      action: 'spawn',
      shape: 'box',
      position: cmd.position,
      size: { x: cmd.width, y: thickness, z: cmd.length },
      color: cmd.color ?? '#6a6a7a',
      static: true,
      rotation: { x: -cmd.angle, y: 0, z: 0 },
      id: 'ramp',
    });
  }

  private spawnSingle(cmd: SpawnBodyCommand): void {
    if (!this.world) return;

    const { x, y, z } = cmd.position;
    const props = this.matProps(cmd.material, cmd);
    const color = cmd.color ?? props.color;
    let mesh: THREE.Mesh;
    let colliderDesc: RAPIER.ColliderDesc;

    if (cmd.shape === 'sphere') {
      const r = cmd.radius ?? 0.5;
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(r, 20, 20),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: props.metalness }),
      );
      colliderDesc = RAPIER.ColliderDesc.ball(r);
    } else if (cmd.shape === 'capsule') {
      const r = cmd.radius ?? 0.35;
      const h = cmd.height ?? 1;
      mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(r, h, 8, 16),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: props.metalness }),
      );
      colliderDesc = RAPIER.ColliderDesc.capsule(h / 2, r);
    } else if (cmd.shape === 'cylinder') {
      const r = cmd.radius ?? 0.4;
      const h = cmd.height ?? 0.3;
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, h, 20),
        new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: props.metalness }),
      );
      colliderDesc = RAPIER.ColliderDesc.cylinder(h / 2, r);
    } else {
      const size = cmd.size ?? { x: 1, y: 1, z: 1 };
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: props.metalness }),
      );
      colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const quat = this.eulerQuat(cmd.rotation);
    mesh.position.set(x, y, z);
    mesh.quaternion.copy(quat);

    const id = cmd.id ?? `body-${this.nextId++}`;
    mesh.userData.sandboxId = id;
    this.scene.add(mesh);

    const bodyDesc = cmd.static
      ? RAPIER.RigidBodyDesc.fixed()
      : RAPIER.RigidBodyDesc.dynamic();
    bodyDesc.setTranslation(x, y, z);
    bodyDesc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    const body = this.world.createRigidBody(bodyDesc);

    colliderDesc.setDensity(cmd.static ? 0 : (cmd.density ?? props.density));
    colliderDesc.setFriction(cmd.friction ?? props.friction);
    colliderDesc.setRestitution(cmd.restitution ?? props.restitution);
    const collider = this.world.createCollider(colliderDesc, body);

    if (cmd.velocity) {
      body.setLinvel(cmd.velocity, true);
    } else if (cmd.fromSky) {
      body.setLinvel({ x: (Math.random() - 0.5) * 2, y: -1, z: (Math.random() - 0.5) * 2 }, true);
    }

    this.registerEntry({ mesh, body, collider, id });
  }

  private addJoint(cmd: AddJointCommand): void {
    if (!this.world) return;
    const a = this.bodyById.get(cmd.bodyA);
    const b = this.bodyById.get(cmd.bodyB);
    if (!a || !b) return;

    const axis = cmd.axis ?? { x: 1, y: 0, z: 0 };
    const jointData =
      cmd.type === 'fixed'
        ? RAPIER.JointData.fixed({ x: 0, y: 0, z: 0 }, { w: 1, x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { w: 1, x: 0, y: 0, z: 0 })
        : RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, axis);

    const joint = this.world.createImpulseJoint(jointData, a.body, b.body, true);
    this.joints.push(joint);
  }

  private setMotor(cmd: SetMotorCommand): void {
    this.motors.set(cmd.bodyId, {
      torque: cmd.torque,
      axis: cmd.axis ?? { x: 1, y: 0, z: 0 },
    });
  }

  private applyForce(cmd: ApplyForceCommand): void {
    if (!this.world) return;
    const origin = cmd.position ?? { x: 0, y: 0, z: 0 };
    const radius = cmd.radius;

    for (const entry of this.bodies) {
      if (!entry.body.isDynamic()) continue;
      const t = entry.body.translation();
      if (radius) {
        const dx = t.x - origin.x;
        const dy = t.y - origin.y;
        const dz = t.z - origin.z;
        if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
      }
      entry.body.applyImpulse(cmd.force, true);
    }
  }

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
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2),
      body,
    );

    this.groundEntry = { mesh, body, collider, id: 'ground' };
  }

  private setGravity(cmd: SetGravityCommand): void {
    if (!this.world) return;
    this.world.gravity = { ...cmd.gravity };
  }

  private setPaused(cmd: PauseCommand): void {
    this.paused = cmd.paused;
  }

  private explode(cmd: ExplodeCommand): void {
    if (!this.world) return;
    const { x, y, z } = cmd.position;
    for (const entry of this.bodies) {
      if (!entry.body.isDynamic()) continue;
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

  private clearSpawned(): void {
    for (const entry of [...this.bodies]) {
      this.removeEntry(entry);
    }
    this.bodies = [];
    this.bodyById.clear();
    this.motors.clear();
    this.joints = [];
  }

  private clearAll(): void {
    this.clearSpawned();
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
    this.bodyById.delete(entry.id);
    this.motors.delete(entry.id);
    if (this.world) {
      this.world.removeRigidBody(entry.body);
    }
  }
}
