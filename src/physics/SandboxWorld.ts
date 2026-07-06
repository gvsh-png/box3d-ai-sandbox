import * as THREE from 'three';
import {
  BodyType,
  World as B3World,
  makeBoxHull,
  type Body,
  type Joint,
} from 'tumble.js';
import { ObjectInteraction } from './ObjectInteraction';
import { AgentSystem, type AgentAction, type AgentDef, type AgentWorldBridge } from './AgentSystem';
import { CinematicCamera } from './CinematicCamera';
import { ReplayRecorder, type ReplayFrame } from './ReplayRecorder';
import { exportReplayToVideo } from './OfflineVideoExporter';
import { interpolateFrames } from '../lib/replayUtils';
import { getVideoQuality, getVideoQualityProfile } from '../lib/recordingPrefs';
import { attachShapeFromGeometry } from './colliderUtils';
import {
  BOX3D_FIXED_DT,
  BOX3D_SUBSTEPS,
  applyCenterImpulse,
  applyCenterTorqueImpulse,
  b3QuatToThree,
  bodyLinearVelocity,
  bodyPosition,
  createFixedJoint,
  createHingeJoint,
  destroyJoints,
  isDynamicBody,
  setBodyPose,
  shapeDefFromOpts,
  threeQuatToB3,
} from './box3dUtils';
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
  body: Body;
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

  private world: B3World | null = null;
  private bodies: BodyEntry[] = [];
  private bodyById = new Map<string, BodyEntry>();
  private motors = new Map<string, MotorState>();
  private joints: Joint[] = [];
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
  private simAccumulator = 0;

  readonly replay = new ReplayRecorder();
  readonly videoCapture = new ReplayRecorder();
  readonly cinematic = new CinematicCamera();
  private videoSessionActive = false;
  private exportingVideo = false;
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

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
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
    this.world = new B3World({ gravity: { x: 0, y: -10, z: 0 } });
    this.spawnGround({ action: 'spawnGround' });
    this.interaction = new ObjectInteraction(
      this.renderer.domElement,
      this.camera,
      () => this.bodies,
      () => this.lockFlyCamera(),
    );
    this.ready = true;
    this.setupReplayApply();
    this.tick();
  }

  isReady(): boolean {
    return this.ready;
  }

  getSceneSummary(): string {
    const dynamic = this.bodies.filter((b) => isDynamicBody(b.body)).length;
    const gravity = this.world?.getGravity() ?? { x: 0, y: -10, z: 0 };
    const ids = [...this.bodyById.keys()].slice(0, 12).join(', ');
    return `${this.bodies.length} bodies (${dynamic} dynamic), gravity (${gravity.x}, ${gravity.y}, ${gravity.z}), ids: [${ids}], agents: ${this.agents.count()}, scriptTick: ${!!this.scriptTick}, camera: ${this.cinematic.mode}, engine: Box3D`;
  }

  isVideoRecording(): boolean {
    return this.videoSessionActive;
  }

  isExportingVideo(): boolean {
    return this.exportingVideo;
  }

  get containerSize(): { width: number; height: number } {
    return { width: this.container.clientWidth, height: this.container.clientHeight };
  }

  getAgentCount(): number {
    return this.agents.count();
  }

  lockFlyCamera(): void {
    this.cinematic.lockUserFly();
    this.interaction?.syncFromCamera();
  }

  enableCinematicOrbit(bodyId: string, radius = 10, height = 4, speed = 0.35): void {
    this.cinematic.releaseForCinematic();
    this.cinematic.orbit(bodyId, radius, height, speed);
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

  startVideoRecording(quality = getVideoQuality()): void {
    if (this.videoSessionActive) return;
    const profile = getVideoQualityProfile(quality);
    this.videoCapture.setCaptureFps(profile.captureFps);
    this.videoCapture.start();
    this.videoSessionActive = true;
  }

  async stopVideoRecording(quality = getVideoQuality(), onProgress?: (p: { phase: string; progress: number }) => void) {
    if (!this.videoSessionActive) return null;
    this.videoSessionActive = false;
    const data = this.videoCapture.stop();
    this.exportingVideo = true;
    try {
      return await exportReplayToVideo(this, data, quality, onProgress);
    } finally {
      this.exportingVideo = false;
    }
  }

  applyReplayFrame(frame: ReplayFrame): void {
    for (const [id, state] of Object.entries(frame.bodies)) {
      const entry = this.bodyById.get(id);
      if (!entry) continue;
      entry.mesh.position.set(state.p[0], state.p[1], state.p[2]);
      entry.mesh.quaternion.set(state.q[0], state.q[1], state.q[2], state.q[3]);
    }
    this.camera.position.set(frame.camera.p[0], frame.camera.p[1], frame.camera.p[2]);
    this.cinematic.lookAt(frame.camera.target[0], frame.camera.target[1], frame.camera.target[2]);
    this.camera.lookAt(this.cinematic.getLookTarget());
  }

  getBodySnapshots(): Array<{ id: string; p: [number, number, number]; q: [number, number, number, number] }> {
    return this.bodies.map((entry) => ({
      id: entry.id,
      p: [entry.mesh.position.x, entry.mesh.position.y, entry.mesh.position.z],
      q: [
        entry.mesh.quaternion.x,
        entry.mesh.quaternion.y,
        entry.mesh.quaternion.z,
        entry.mesh.quaternion.w,
      ],
    }));
  }

  restoreBodySnapshots(
    snaps: Array<{ id: string; p: [number, number, number]; q: [number, number, number, number] }>,
  ): void {
    for (const snap of snaps) {
      const entry = this.bodyById.get(snap.id);
      if (!entry) continue;
      entry.mesh.position.set(snap.p[0], snap.p[1], snap.p[2]);
      entry.mesh.quaternion.set(snap.q[0], snap.q[1], snap.q[2], snap.q[3]);
      setBodyPose(entry.body, snap.p[0], snap.p[1], snap.p[2], {
        v: { x: snap.q[0], y: snap.q[1], z: snap.q[2] },
        s: snap.q[3],
      });
    }
  }

  getBodyPosition(id: string): THREE.Vector3 | null {
    const entry = this.bodyById.get(id);
    if (!entry) return null;
    const t = bodyPosition(entry.body);
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  clearSpawned(): void {
    this.clearScriptState();
    this.agents.clear();
    this.cinematic.lockUserFly();
    this.replayPhysicsPaused = false;
    this.replay.stopPlayback();
    destroyJoints(this.joints);
    this.joints = [];
    for (const entry of [...this.bodies]) {
      this.removeEntry(entry);
    }
    this.bodies = [];
    this.bodyById.clear();
    this.motors.clear();
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
    const quat = threeQuatToB3(mesh.quaternion);

    const body = this.world.createBody({
      type: opts.static ? BodyType.Static : BodyType.Dynamic,
      position: { x, y, z },
      rotation: quat,
      linearVelocity: opts.velocity ?? { x: 0, y: 0, z: 0 },
    });

    attachShapeFromGeometry(body, mesh.geometry, {
      density: opts.static ? 0 : (opts.density ?? 1),
      friction: opts.friction ?? 0.4,
      restitution: opts.restitution ?? 0.2,
      sensor: opts.sensor,
    });

    this.registerEntry({ mesh, body, id });
    return id;
  }

  setBodyPosition(id: string, x: number, y: number, z: number): void {
    const entry = this.bodyById.get(id);
    if (!entry) return;
    setBodyPose(entry.body, x, y, z);
    entry.mesh.position.set(x, y, z);
  }

  setBodyVelocity(id: string, x: number, y: number, z: number): void {
    const entry = this.bodyById.get(id);
    if (!entry) return;
    entry.body.setLinearVelocity({ x, y, z });
  }

  applyBodyImpulse(id: string, x: number, y: number, z: number): void {
    const entry = this.bodyById.get(id);
    if (!entry) return;
    applyCenterImpulse(entry.body, { x, y, z });
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
    if (this.videoSessionActive) this.videoCapture.stop();
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
        applyCenterTorqueImpulse(entry.body, {
          x: motor.axis.x * motor.torque,
          y: motor.axis.y * motor.torque,
          z: motor.axis.z * motor.torque,
        });
      }
    }

    this.simAccumulator += dt;
    while (this.simAccumulator >= BOX3D_FIXED_DT) {
      this.world.step(BOX3D_FIXED_DT, BOX3D_SUBSTEPS);
      this.simAccumulator -= BOX3D_FIXED_DT;
    }

    for (const entry of this.bodies) {
      const t = bodyPosition(entry.body);
      const r = entry.body.getRotation();
      entry.mesh.position.set(t.x, t.y, t.z);
      b3QuatToThree(r, entry.mesh.quaternion);
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

    if (this.videoSessionActive) {
      const snapshot = new Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();
      for (const entry of this.bodies) {
        snapshot.set(entry.id, {
          position: entry.mesh.position.clone(),
          quaternion: entry.mesh.quaternion.clone(),
        });
      }
      this.videoCapture.capture(now, snapshot, this.camera, this.cinematic.getLookTarget());
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
    return interpolateFrames(a, b, alpha);
  }

  private makeAgentBridge(): AgentWorldBridge {
    return {
      getBodyPosition: (id) => this.getBodyPosition(id),
      getBodyVelocity: (id) => {
        const entry = this.bodyById.get(id);
        if (!entry) return null;
        const v = bodyLinearVelocity(entry.body);
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
          const t = bodyPosition(entry.body);
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
        const result = this.world.castRayClosest(origin, {
          x: nd.x * maxDist,
          y: nd.y * maxDist,
          z: nd.z * maxDist,
        });
        if (!result.hit || !result.shape) return { hit: false };
        const hitBody = result.shape.getBody();
        const entry = this.bodies.find((e) => e.body === hitBody);
        if (!entry || entry.id === excludeId) return { hit: false };
        return {
          hit: true,
          dist: result.fraction * maxDist,
          point: { x: result.point.x, y: result.point.y, z: result.point.z },
          bodyId: entry.id,
        };
      },
      applyAction: (bodyId, action) => this.applyAgentAction(bodyId, action),
    };
  }

  private applyAgentAction(bodyId: string, action: AgentAction): void {
    const entry = this.bodyById.get(bodyId);
    if (!entry || !isDynamicBody(entry.body)) return;

    if (action.force) {
      applyCenterImpulse(entry.body, {
        x: action.force.x * 0.016,
        y: action.force.y * 0.016,
        z: action.force.z * 0.016,
      });
    }
    if (action.impulse) {
      applyCenterImpulse(entry.body, action.impulse);
    }
    if (action.torque) {
      applyCenterTorqueImpulse(entry.body, action.torque);
    }
    if (action.setVelocity) {
      entry.body.setLinearVelocity(action.setVelocity);
    }
    if (action.steer) {
      applyCenterTorqueImpulse(entry.body, { x: 0, y: action.steer * 2, z: 0 });
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

    if (cmd.shape === 'sphere') {
      const r = cmd.radius ?? 0.5;
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(r, 20, 20),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: props.metalness }),
      );
    } else if (cmd.shape === 'capsule') {
      const r = cmd.radius ?? 0.35;
      const h = cmd.height ?? 1;
      mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(r, h, 8, 16),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: props.metalness }),
      );
    } else if (cmd.shape === 'cylinder') {
      const r = cmd.radius ?? 0.4;
      const h = cmd.height ?? 0.3;
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, h, 20),
        new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: props.metalness }),
      );
    } else {
      const size = cmd.size ?? { x: 1, y: 1, z: 1 };
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: props.metalness }),
      );
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const quat = this.eulerQuat(cmd.rotation);
    mesh.position.set(x, y, z);
    mesh.quaternion.copy(quat);

    const id = cmd.id ?? `body-${this.nextId++}`;
    mesh.userData.sandboxId = id;
    this.scene.add(mesh);

    const body = this.world.createBody({
      type: cmd.static ? BodyType.Static : BodyType.Dynamic,
      position: { x, y, z },
      rotation: threeQuatToB3(quat),
    });

    const shapeOpts = {
      density: cmd.static ? 0 : (cmd.density ?? props.density),
      friction: cmd.friction ?? props.friction,
      restitution: cmd.restitution ?? props.restitution,
    };

    if (cmd.shape === 'sphere') {
      const r = cmd.radius ?? 0.5;
      body.createSphere(shapeDefFromOpts(shapeOpts), { center: { x: 0, y: 0, z: 0 }, radius: r });
    } else if (cmd.shape === 'capsule') {
      const r = cmd.radius ?? 0.35;
      const half = (cmd.height ?? 1) / 2;
      body.createCapsule(shapeDefFromOpts(shapeOpts), {
        center1: { x: 0, y: -half, z: 0 },
        center2: { x: 0, y: half, z: 0 },
        radius: r,
      });
    } else if (cmd.shape === 'cylinder') {
      attachShapeFromGeometry(body, mesh.geometry, shapeOpts);
    } else {
      const size = cmd.size ?? { x: 1, y: 1, z: 1 };
      body.createHull(
        shapeDefFromOpts(shapeOpts),
        makeBoxHull(size.x / 2, size.y / 2, size.z / 2),
      );
    }

    if (cmd.velocity) {
      body.setLinearVelocity(cmd.velocity);
    } else if (cmd.fromSky) {
      body.setLinearVelocity({
        x: (Math.random() - 0.5) * 2,
        y: -1,
        z: (Math.random() - 0.5) * 2,
      });
    }

    this.registerEntry({ mesh, body, id });
  }

  private addJoint(cmd: AddJointCommand): void {
    if (!this.world) return;
    const a = this.bodyById.get(cmd.bodyA);
    const b = this.bodyById.get(cmd.bodyB);
    if (!a) throw new Error(`Joint failed: body "${cmd.bodyA}" not found — use string ids from world.create({ id: "..." })`);
    if (!b) throw new Error(`Joint failed: body "${cmd.bodyB}" not found — use string ids from world.create({ id: "..." })`);

    const axis = resolveAxis(cmd.axis);
    const joint =
      cmd.type === 'fixed'
        ? createFixedJoint(this.world, a.body, b.body)
        : createHingeJoint(this.world, a.body, b.body, axis);
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
      if (!isDynamicBody(entry.body)) continue;
      const t = bodyPosition(entry.body);
      if (radius) {
        const dx = t.x - origin.x;
        const dy = t.y - origin.y;
        const dz = t.z - origin.z;
        if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
      }
      applyCenterImpulse(entry.body, cmd.force);
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

    const body = this.world.createBody({
      type: BodyType.Static,
      position: { x: pos.x, y: pos.y, z: pos.z },
    });
    body.createHull(shapeDefFromOpts({ density: 0, friction: 0.6, restitution: 0.1 }), makeBoxHull(size.x / 2, size.y / 2, size.z / 2));

    this.groundEntry = { mesh, body, id: 'ground' };
  }

  private setGravity(cmd: SetGravityCommand): void {
    if (!this.world) return;
    this.world.setGravity({ ...cmd.gravity });
  }

  private setPaused(cmd: PauseCommand): void {
    this.paused = cmd.paused;
  }

  private explode(cmd: ExplodeCommand): void {
    if (!this.world) return;
    const { x, y, z } = cmd.position;
    for (const entry of this.bodies) {
      if (!isDynamicBody(entry.body)) continue;
      const t = bodyPosition(entry.body);
      const dx = t.x - x;
      const dy = t.y - y;
      const dz = t.z - z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < cmd.radius && dist > 0.01) {
        const force = (cmd.strength / dist) * 0.5;
        applyCenterImpulse(entry.body, { x: dx * force, y: dy * force + 2, z: dz * force });
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
      this.world.destroy();
      this.world = null;
    }
  }

  private removeEntry(entry: BodyEntry): void {
    this.scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    (entry.mesh.material as THREE.Material).dispose();
    this.bodyById.delete(entry.id);
    this.motors.delete(entry.id);
    if (entry.body.isValid()) {
      entry.body.destroy();
    }
  }
}
