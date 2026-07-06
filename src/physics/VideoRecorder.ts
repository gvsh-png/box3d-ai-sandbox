export type VideoRecorderState = 'idle' | 'recording' | 'processing';

export class VideoRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  state: VideoRecorderState = 'idle';
  elapsedMs = 0;
  private startedAt = 0;

  get isRecording(): boolean {
    return this.state === 'recording';
  }

  start(canvas: HTMLCanvasElement, fps = 30): void {
    if (this.state === 'recording') return;

    this.chunks = [];
    this.stream = canvas.captureStream(fps);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    this.recorder = new MediaRecorder(this.stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.recorder.start(200);
    this.startedAt = performance.now();
    this.state = 'recording';
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
        resolve(blob);
      };
      recorder.stop();
    });
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
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
