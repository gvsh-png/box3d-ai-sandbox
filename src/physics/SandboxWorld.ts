import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ObjectInteraction } from './ObjectInteraction';
import { AgentSystem, type AgentAction, type AgentDef, type AgentWorldBridge } from './AgentSystem';
import { CinematicCamera } from './CinematicCamera';
import { ReplayRecorder, type ReplayFrame } from './ReplayRecorder';
import { VideoRecorder } from './VideoRecorder';
import { colliderFromGeometry } from './colliderUtils';
import { resolveAxis } from './scriptArgs';
import type { PhysicsOpts } from './WorldRuntime';
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
  private scriptExtras: THREE.Object3D[] = [];
  private scriptTick: ((dt: number) => void) | null = null;
  private lastTickTime = performance.now();

  readonly replay = new ReplayRecorder();
  readonly video = new VideoRecorder();
  readonly cinematic = new CinematicCamera();
  private agents = new AgentSystem();
  private replayPhysicsPaused = false;

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
    this.setupReplayApply();
    this.tick();
  }

  isReady(): boolean {
    return this.ready;
  }

  getSceneSummary(): string {
    const dynamic = this.bodies.filter((b) => b.body.isDynamic()).length;
    const gravity = this.world?.gravity ?? { x: 0, y: -10, z: 0 };
    const ids = [...this.bodyById.keys()].slice(0, 12).join(', ');
    return `${this.bodies.length} bodies (${dynamic} dynamic), gravity (${gravity.x}, ${gravity.y}, ${gravity.z}), ids: [${ids}], agents: ${this.agents.count()}, scriptTick: ${!!this.scriptTick}, camera: ${this.cinematic.mode}`;
  }

  getAgentCount(): number {
    return this.agents.count();
  }

  setLLMAgentHandler(handler: AgentSystem['llmHandler']): void {
    this.agents.llmHandler = handler;
  }

  registerAgent(def: AgentDef): void {
    this.agents.register(def);
  }

  startReplayRecording(): void {
    this.replay.start();
  }

  stopReplayRecording(): string {
    return this.replay.exportJson();
  }

  loadReplay(json: string): void {
    const data = ReplayRecorder.importJson(json);
    this.replay.load(data);
    this.setupReplayApply();
  }

  playReplay(): void {
    this.replayPhysicsPaused = true;
    this.replay.startPlayback();
  }

  stopReplay(): void {
    this.replay.stopPlayback();
    this.replayPhysicsPaused = false;
  }

  startVideoRecording(): void {
    if (this.video.isRecording) return;
    const savedRatio = this.renderer.getPixelRatio();
    this.video.start(this.renderer.domElement, {
      fps: 24,
      bitrate: 4_000_000,
      onRecordingStart: () => {
        this.renderer.setPixelRatio(Math.min(savedRatio, 1));
      },
      onRecordingStop: () => {
        this.renderer.setPixelRatio(savedRatio);
      },
    });
  }

  async stopVideoRecording(): Promise<Blob | null> {
    return this.video.stop();
  }

  getBodyPosition(id: string): THREE.Vector3 | null {
    const entry = this.bodyById.get(id);
    if (!entry) return null;
    const t = entry.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /** Called by WorldRuntime — clears spawned bodies, keeps ground. */
  clearSpawned(): void {
    this.clearScriptState();
    this.agents.clear();
    this.cinematic.free();
    this.replayPhysicsPaused = false;
    this.replay.stopPlayback();
    for (const entry of [...this.bodies]) {
      this.removeEntry(entry);
    }
    this.bodies = [];
    this.bodyById.clear();
    this.motors.clear();
    this.joints = [];
  }

  clearScriptState(): void {
    this.scriptTick = null;
    for (const obj of this.scriptExtras) {
      this.scene.remove(obj);
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const m = child.material;
          if (Array.isArray(m)) m.forEach((mat) => mat.dispose());
          else m.dispose();
        }
      });
    }
    this.scriptExtras = [];
  }

  addScriptExtra(obj: THREE.Object3D): void {
    this.scriptExtras.push(obj);
  }

  setScriptTick(fn: ((dt: number) => void) | null): void {
    this.scriptTick = fn;
  }

  registerPhysicsMesh(mesh: THREE.Mesh, opts: PhysicsOpts = {}): string {
    if (!this.world) return '';

    if (!mesh.parent) this.scene.add(mesh);

    const id = opts.id ?? `body-${this.nextId++}`;
    mesh.userData.sandboxId = id;

    const { x, y, z } = mesh.position;
    const q = mesh.quaternion;

    const colliderDesc = colliderFromGeometry(mesh.geometry);
    colliderDesc.setDensity(opts.static ? 0 : (opts.density ?? 1));
    colliderDesc.setFriction(opts.friction ?? 0.4);
    colliderDesc.setRestitution(opts.restitution ?? 0.2);
    if (opts.sensor) colliderDesc.setSensor(true);

    const bodyDesc = opts.static
      ? RAPIER.RigidBodyDesc.fixed()
      : RAPIER.RigidBodyDesc.dynamic();
    bodyDesc.setTranslation(x, y, z);
    bodyDesc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });

    const body = this.world.createRigidBody(bodyDesc);
    const collider = this.world.createCollider(colliderDesc, body);

    if (opts.velocity) {
      body.setLinvel(opts.velocity, true);
    }

    this.registerEntry({ mesh, body, collider, id });
    return id;
  }

  setBodyPosition(id: string, x: number, y: number, z: number): void {
    const entry = this.bodyById.get(id);
    if (!entry) return;
    entry.body.setTranslation({ x, y, z }, true);
    entry.mesh.position.set(x, y, z);
  }

  setBodyVelocity(id: string, x: number, y: number, z: number): void {
    const entry = this.bodyById.get(id);
    if (!entry) return;
    entry.body.setLinvel({ x, y, z }, true);
  }

  applyBodyImpulse(id: string, x: number, y: number, z: number): void {
    const entry = this.bodyById.get(id);
    if (!entry) return;
    entry.body.applyImpulse({ x, y, z }, true);
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
    if (this.replay.recording) this.replay.stop();
    if (this.video.isRecording) void this.video.stop();
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
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTickTime) / 1000);
    this.lastTickTime = now;

    this.interaction?.setCinematicOverride(this.cinematic.active);

    if (this.replay.playing) {
      this.replay.stepPlayback(dt);
      this.cinematic.update(dt, this.camera, (id) => this.getBodyPosition(id));
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.interaction?.update(dt);

    void this.agents.tick(dt, this.makeAgentBridge());

    this.cinematic.update(dt, this.camera, (id) => this.getBodyPosition(id));

    if (!this.world || this.paused || this.replayPhysicsPaused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.scriptTick) {
      try {
        this.scriptTick(dt);
      } catch (err) {
        console.error('Script tick error:', err);
        this.scriptTick = null;
      }
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

    if (this.replay.recording) {
      const snapshot = new Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();
      for (const entry of this.bodies) {
        snapshot.set(entry.id, {
          position: entry.mesh.position.clone(),
          quaternion: entry.mesh.quaternion.clone(),
        });
      }
      this.replay.capture(now, snapshot, this.camera, this.cinematic.getLookTarget());
    }

    this.renderer.render(this.scene, this.camera);
  };

  private setupReplayApply(): void {
    this.replay.onApply = (a, alpha, b) => {
      const frame = b ? this.interpolateFrames(a, b, alpha) : a;
      for (const [id, state] of Object.entries(frame.bodies)) {
        const entry = this.bodyById.get(id);
        if (!entry) continue;
        entry.mesh.position.set(state.p[0], state.p[1], state.p[2]);
        entry.mesh.quaternion.set(state.q[0], state.q[1], state.q[2], state.q[3]);
      }
      this.camera.position.set(frame.camera.p[0], frame.camera.p[1], frame.camera.p[2]);
      this.cinematic.lookAt(frame.camera.target[0], frame.camera.target[1], frame.camera.target[2]);
      this.camera.lookAt(this.cinematic.getLookTarget());
    };
  }

  private interpolateFrames(a: ReplayFrame, b: ReplayFrame, alpha: number): ReplayFrame {
    const bodies: ReplayFrame['bodies'] = {};
    for (const id of new Set([...Object.keys(a.bodies), ...Object.keys(b.bodies)])) {
      const sa = a.bodies[id];
      const sb = b.bodies[id];
      if (!sa || !sb) {
        bodies[id] = sa ?? sb!;
        continue;
      }
      bodies[id] = {
        p: sa.p.map((v, i) => v + (sb.p[i] - v) * alpha) as [number, number, number],
        q: sa.q.map((v, i) => v + (sb.q[i] - v) * alpha) as [number, number, number, number],
      };
    }
    return {
      t: a.t + (b.t - a.t) * alpha,
      bodies,
      camera: {
        p: a.camera.p.map((v, i) => v + (b.camera.p[i] - v) * alpha) as [number, number, number],
        target: a.camera.target.map((v, i) => v + (b.camera.target[i] - v) * alpha) as [
          number,
          number,
          number,
        ],
      },
    };
  }

  private makeAgentBridge(): AgentWorldBridge {
    return {
      getBodyPosition: (id) => this.getBodyPosition(id),
      getBodyVelocity: (id) => {
        const entry = this.bodyById.get(id);
        if (!entry) return null;
        const v = entry.body.linvel();
        return { x: v.x, y: v.y, z: v.z };
      },
      getBodyForward: (id) => {
        const entry = this.bodyById.get(id);
        if (!entry) return null;
        const f = new THREE.Vector3(0, 0, 1).applyQuaternion(entry.mesh.quaternion);
        return { x: f.x, y: f.y, z: f.z };
      },
      queryNearest: (origin, count, excludeId) => {
        const hits: Array<{ id: string; dist: number; position: Vec3 }> = [];
        for (const entry of this.bodies) {
          if (entry.id === excludeId) continue;
          const t = entry.body.translation();
          const dx = t.x - origin.x;
          const dy = t.y - origin.y;
          const dz = t.z - origin.z;
          hits.push({
            id: entry.id,
            dist: Math.sqrt(dx * dx + dy * dy + dz * dz),
            position: { x: t.x, y: t.y, z: t.z },
          });
        }
        hits.sort((a, b) => a.dist - b.dist);
        return hits.slice(0, count);
      },
      raycast: (origin, dir, maxDist, excludeId) => {
        if (!this.world) return { hit: false };
        const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
        const nd = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
        const ray = new RAPIER.Ray(origin, nd);
        const hit = this.world.castRay(ray, maxDist, true);
        if (!hit) return { hit: false };
        const collider = hit.collider;
        const body = collider.parent();
        const entry = this.bodies.find((e) => e.body.handle === body?.handle);
        if (!entry || entry.id === excludeId) return { hit: false };
        const point = ray.pointAt(hit.timeOfImpact);
        return {
          hit: true,
          dist: hit.timeOfImpact,
          point: { x: point.x, y: point.y, z: point.z },
          bodyId: entry.id,
        };
      },
      applyAction: (bodyId, action) => this.applyAgentAction(bodyId, action),
    };
  }

  private applyAgentAction(bodyId: string, action: AgentAction): void {
    const entry = this.bodyById.get(bodyId);
    if (!entry || !entry.body.isDynamic()) return;

    if (action.force) {
      entry.body.applyImpulse(
        { x: action.force.x * 0.016, y: action.force.y * 0.016, z: action.force.z * 0.016 },
        true,
      );
    }
    if (action.impulse) {
      entry.body.applyImpulse(action.impulse, true);
    }
    if (action.torque) {
      entry.body.applyTorqueImpulse(action.torque, true);
    }
    if (action.setVelocity) {
      entry.body.setLinvel(action.setVelocity, true);
    }
    if (action.steer) {
      entry.body.applyTorqueImpulse({ x: 0, y: action.steer * 2, z: 0 }, true);
    }
  }

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
    if (!a) throw new Error(`Joint failed: body "${cmd.bodyA}" not found — use string ids from world.create({ id: "..." })`);
    if (!b) throw new Error(`Joint failed: body "${cmd.bodyB}" not found — use string ids from world.create({ id: "..." })`);

    const axis = resolveAxis(cmd.axis);
    const jointData =
      cmd.type === 'fixed'
        ? RAPIER.JointData.fixed({ x: 0, y: 0, z: 0 }, { w: 1, x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { w: 1, x: 0, y: 0, z: 0 })
        : RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, axis);

    const joint = this.world.createImpulseJoint(jointData, a.body, b.body, true);
    this.joints.push(joint);
  }

  private setMotor(cmd: SetMotorCommand): void {
    if (!this.bodyById.has(cmd.bodyId)) {
      throw new Error(`Motor failed: body "${cmd.bodyId}" not found`);
    }
    this.motors.set(cmd.bodyId, {
      torque: cmd.torque,
      axis: resolveAxis(cmd.axis),
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
