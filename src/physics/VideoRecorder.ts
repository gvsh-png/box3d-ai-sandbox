import type { VideoQualityProfile } from '../lib/recordingPrefs';

export type VideoRecorderState = 'idle' | 'recording' | 'processing';

export type VideoRecorderOptions = {
  profile?: VideoQualityProfile;
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
};

export class VideoRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private opts: VideoRecorderOptions = {};

  state: VideoRecorderState = 'idle';
  elapsedMs = 0;
  private startedAt = 0;

  get isRecording(): boolean {
    return this.state === 'recording';
  }

  start(canvas: HTMLCanvasElement, opts: VideoRecorderOptions = {}): void {
    if (this.state === 'recording') return;

    this.opts = opts;
    const profile = opts.profile ?? {
      fps: 30,
      bitrate: 12_000_000,
      maxPixelRatio: 2,
      codecPreference: ['vp9', 'vp8'] as const,
    };

    this.chunks = [];
    this.stream = canvas.captureStream(profile.fps);

    const mime = pickMimeType(profile.codecPreference);
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: mime,
      videoBitsPerSecond: profile.bitrate,
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    // Smaller timeslices → better seeking and fewer compression artifacts
    this.recorder.start(250);
    this.startedAt = performance.now();
    this.state = 'recording';
    this.opts.onRecordingStart?.();
  }

  async stop(): Promise<Blob | null> {
    if (!this.recorder || this.state !== 'recording') return null;

    this.state = 'processing';
    this.elapsedMs = performance.now() - this.startedAt;

    return new Promise((resolve) => {
      const recorder = this.recorder!;
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType });
        this.cleanup();
        this.state = 'idle';
        this.opts.onRecordingStop?.();
        resolve(blob);
      };
      recorder.stop();
    });
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.opts = {};
  }

  static download(blob: Blob, filename = `sandbox-${Date.now()}.webm`): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

function pickMimeType(preferred: ('vp9' | 'vp8')[]): string {
  for (const codec of preferred) {
    const mime = `video/webm;codecs=${codec}`;
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return 'video/webm';
}
