import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { ReplayData } from '../physics/ReplayRecorder';
import type { SandboxWorld } from '../physics/SandboxWorld';
import { interpolateReplayAt } from '../lib/replayUtils';
import { getVideoQualityProfile, type VideoQuality } from '../lib/recordingPrefs';

export type ExportProgress = { phase: string; progress: number };

export type VideoExportResult = {
  blob: Blob;
  filename: string;
};

type BodySnapshot = {
  id: string;
  p: [number, number, number];
  q: [number, number, number, number];
};

export function downloadVideo(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportReplayToVideo(
  world: SandboxWorld,
  data: ReplayData,
  quality: VideoQuality,
  onProgress?: (p: ExportProgress) => void,
): Promise<VideoExportResult> {
  if (data.frames.length < 2) {
    throw new Error('Not enough frames — record for at least a second before finishing.');
  }

  const profile = getVideoQualityProfile(quality, world.renderer.domElement);
  const duration = data.duration;
  const totalFrames = Math.max(2, Math.ceil(duration * profile.exportFps));
  const savedRatio = world.renderer.getPixelRatio();
  const exportRatio = Math.min(savedRatio, profile.exportPixelRatio, window.devicePixelRatio);

  world.renderer.setPixelRatio(exportRatio);
  world.renderer.setSize(world.containerSize.width, world.containerSize.height);

  const width = world.renderer.domElement.width;
  const height = world.renderer.domElement.height;
  const bodyRestore = snapshotBodies(world);

  try {
    if (typeof VideoEncoder !== 'undefined') {
      try {
        return await exportWithWebCodecs(world, data, width, height, profile.exportFps, profile.bitrate, totalFrames, onProgress);
      } catch (err) {
        console.warn('WebCodecs export failed, falling back:', err);
      }
    }
    return await exportWithOfflineRecorder(world, data, profile.exportFps, profile.bitrate, totalFrames, onProgress);
  } finally {
    restoreBodies(world, bodyRestore);
    world.renderer.setPixelRatio(savedRatio);
    world.renderer.setSize(world.containerSize.width, world.containerSize.height);
    world.renderer.render(world.scene, world.camera);
  }
}

async function exportWithWebCodecs(
  world: SandboxWorld,
  data: ReplayData,
  width: number,
  height: number,
  fps: number,
  bitrate: number,
  totalFrames: number,
  onProgress?: (p: ExportProgress) => void,
): Promise<VideoExportResult> {
  const codec = await pickH264Codec(width, height, bitrate, fps);
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    fastStart: 'in-memory',
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      throw e;
    },
  });

  encoder.configure({ codec, width, height, bitrate, framerate: fps });

  const canvas = world.renderer.domElement;
  const frameDurUs = Math.round(1_000_000 / fps);

  for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    world.applyReplayFrame(interpolateReplayAt(data, t));
    world.renderer.render(world.scene, world.camera);

    const videoFrame = new VideoFrame(canvas, {
      timestamp: i * frameDurUs,
      duration: frameDurUs,
    });
    encoder.encode(videoFrame, { keyFrame: i % fps === 0 });
    videoFrame.close();

    if (i % 4 === 0) {
      onProgress?.({ phase: 'Rendering MP4', progress: i / totalFrames });
      await yieldToBrowser();
    }
  }

  onProgress?.({ phase: 'Finalizing', progress: 0.98 });
  await encoder.flush();
  muxer.finalize();

  const buffer = muxer.target.buffer;
  return {
    blob: new Blob([buffer], { type: 'video/mp4' }),
    filename: `sandbox-${Date.now()}.mp4`,
  };
}

async function exportWithOfflineRecorder(
  world: SandboxWorld,
  data: ReplayData,
  fps: number,
  bitrate: number,
  totalFrames: number,
  onProgress?: (p: ExportProgress) => void,
): Promise<VideoExportResult> {
  const canvas = world.renderer.domElement;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
  });

  recorder.start();

  for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    world.applyReplayFrame(interpolateReplayAt(data, t));
    world.renderer.render(world.scene, world.camera);
    track.requestFrame?.();

    if (i % 4 === 0) {
      onProgress?.({ phase: 'Rendering video', progress: i / totalFrames });
      await yieldToBrowser();
    }
  }

  recorder.stop();
  onProgress?.({ phase: 'Finalizing', progress: 0.98 });
  const blob = await done;
  stream.getTracks().forEach((t) => t.stop());

  return {
    blob,
    filename: `sandbox-${Date.now()}.webm`,
  };
}

async function pickH264Codec(width: number, height: number, bitrate: number, framerate: number): Promise<string> {
  const candidates = ['avc1.640028', 'avc1.42001f', 'avc1.4d0034'];
  for (const codec of candidates) {
    const { supported } = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate });
    if (supported) return codec;
  }
  throw new Error('H.264 encoding not supported in this browser');
}

function snapshotBodies(world: SandboxWorld): BodySnapshot[] {
  return world.getBodySnapshots();
}

function restoreBodies(world: SandboxWorld, snaps: BodySnapshot[]): void {
  world.restoreBodySnapshots(snaps);
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
