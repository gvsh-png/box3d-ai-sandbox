import type * as THREE from 'three';

export type ReplayBodyState = {
  p: [number, number, number];
  q: [number, number, number, number];
};

export type ReplayFrame = {
  t: number;
  bodies: Record<string, ReplayBodyState>;
  camera: {
    p: [number, number, number];
    target: [number, number, number];
  };
};

export type ReplayData = {
  version: 1;
  duration: number;
  frames: ReplayFrame[];
};

export class ReplayRecorder {
  private frames: ReplayFrame[] = [];
  private startTime = 0;
  private interval = 1 / 30;
  private lastCapture = 0;

  recording = false;
  playing = false;
  playTime = 0;
  playIndex = 0;
  maxFrames = 1800;

  start(): void {
    this.frames = [];
    this.startTime = performance.now();
    this.lastCapture = 0;
    this.recording = true;
    this.playing = false;
  }

  stop(): ReplayData {
    this.recording = false;
    const duration = this.frames.length > 0 ? this.frames[this.frames.length - 1].t : 0;
    return { version: 1, duration, frames: [...this.frames] };
  }

  capture(
    t: number,
    bodies: Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>,
    camera: THREE.PerspectiveCamera,
    lookTarget: THREE.Vector3,
  ): void {
    if (!this.recording || t - this.lastCapture < this.interval) return;
    if (this.frames.length >= this.maxFrames) {
      this.recording = false;
      return;
    }

    this.lastCapture = t;
    const bodyStates: Record<string, ReplayBodyState> = {};
    for (const [id, state] of bodies) {
      bodyStates[id] = {
        p: [state.position.x, state.position.y, state.position.z],
        q: [state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w],
      };
    }

    this.frames.push({
      t: (t - this.startTime) / 1000,
      bodies: bodyStates,
      camera: {
        p: [camera.position.x, camera.position.y, camera.position.z],
        target: [lookTarget.x, lookTarget.y, lookTarget.z],
      },
    });
  }

  load(data: ReplayData): void {
    this.frames = data.frames;
    this.playing = false;
    this.playTime = 0;
    this.playIndex = 0;
    this.recording = false;
  }

  startPlayback(): void {
    if (this.frames.length === 0) return;
    this.playing = true;
    this.playTime = 0;
    this.playIndex = 0;
  }

  stopPlayback(): void {
    this.playing = false;
  }

  getFrameCount(): number {
    return this.frames.length;
  }

  getDuration(): number {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1].t : 0;
  }

  /** Apply replay pose for current playTime; returns false when finished. */
  stepPlayback(dt: number): boolean {
    if (!this.playing || this.frames.length === 0) return false;

    this.playTime += dt;
    const duration = this.getDuration();
    if (this.playTime >= duration) {
      this.playing = false;
      this.applyFrame(this.frames[this.frames.length - 1]);
      return false;
    }

    while (this.playIndex < this.frames.length - 2 && this.frames[this.playIndex + 1].t <= this.playTime) {
      this.playIndex++;
    }

    const a = this.frames[this.playIndex];
    const b = this.frames[Math.min(this.playIndex + 1, this.frames.length - 1)];
    const span = Math.max(0.0001, b.t - a.t);
    const alpha = Math.min(1, (this.playTime - a.t) / span);
    this.applyInterpolated(a, b, alpha);
    return true;
  }

  private applyFrame(frame: ReplayFrame): void {
    this.onApply?.(frame, 1);
  }

  private applyInterpolated(a: ReplayFrame, b: ReplayFrame, alpha: number): void {
    this.onApply?.(a, alpha, b);
  }

  onApply?: (frameA: ReplayFrame, alpha: number, frameB?: ReplayFrame) => void;

  exportJson(): string {
    return JSON.stringify(this.stop());
  }

  static importJson(json: string): ReplayData {
    const data = JSON.parse(json) as ReplayData;
    if (data.version !== 1 || !Array.isArray(data.frames)) {
      throw new Error('Invalid replay file');
    }
    return data;
  }
}
