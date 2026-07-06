import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4BufferTarget } from 'mp4-muxer-local';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmBufferTarget } from 'webm-muxer-local';
import type { ReplayData } from '../physics/ReplayRecorder';
import type { SandboxWorld } from '../physics/SandboxWorld';
import { interpolateReplayAt } from '../lib/replayUtils';
import { computeExportBitrate, getVideoQualityProfile, type VideoQuality } from '../lib/recordingPrefs';

export type ExportProgress = { phase: string; progress: number };

export type VideoExportResult = {
  blob: Blob;
  filename: string;
  format: 'mp4' | 'webm';
};

type BodySnapshot = {
  id: string;
  p: [number, number, number];
  q: [number, number, number, number];
};

type ExportSize = {
  width: number;
  height: number;
  savedRatio: number;
  exportRatio: number;
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

  const profile = getVideoQualityProfile(quality);
  const duration = Math.max(1 / profile.exportFps, data.duration);
  const totalFrames = Math.max(2, Math.ceil(duration * profile.exportFps));
  const size = prepareExportSize(world, profile.exportPixelRatio);
  const bitrate = computeExportBitrate(quality, size.width, size.height, profile.exportFps);
  const bodyRestore = snapshotBodies(world);

  try {
    if (typeof VideoEncoder !== 'undefined') {
      try {
        return await exportWithWebCodecs(
          world,
          data,
          size.width,
          size.height,
          profile.exportFps,
          bitrate,
          totalFrames,
          duration,
          'h264',
          onProgress,
        );
      } catch (err) {
        console.warn('H.264 MP4 export failed, trying VP9 WebM:', err);
      }

      try {
        return await exportWithWebCodecs(
          world,
          data,
          size.width,
          size.height,
          profile.exportFps,
          bitrate,
          totalFrames,
          duration,
          'vp9',
          onProgress,
        );
      } catch (err) {
        console.warn('VP9 WebM export failed, falling back to recorder:', err);
      }
    }

    return await exportWithPacedRecorder(
      world,
      data,
      profile.exportFps,
      bitrate,
      totalFrames,
      duration,
      onProgress,
    );
  } finally {
    restoreBodies(world, bodyRestore);
    world.renderer.setPixelRatio(size.savedRatio);
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
  duration: number,
  codecFamily: 'h264' | 'vp9',
  onProgress?: (p: ExportProgress) => void,
): Promise<VideoExportResult> {
  const isMp4 = codecFamily === 'h264';
  const codec = isMp4
    ? await pickH264Codec(width, height, bitrate, fps)
    : await pickVp9Codec(width, height, bitrate, fps);

  const muxer = isMp4
    ? new Mp4Muxer({
        target: new Mp4BufferTarget(),
        video: { codec: 'avc', width, height, frameRate: fps },
        fastStart: 'in-memory',
      })
    : new WebmMuxer({
        target: new WebmBufferTarget(),
        video: {
          codec: codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8',
          width,
          height,
          frameRate: fps,
        },
      });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e;
    },
  });

  encoder.configure({ codec, width, height, bitrate, framerate: fps, latencyMode: 'quality' });

  const canvas = world.renderer.domElement;
  const frameDurUs = Math.round(1_000_000 / fps);
  const keyInterval = Math.max(1, Math.round(fps));

  await renderExportFrames(world, data, fps, totalFrames, duration, async (i) => {
    if (encoderError) throw encoderError;

    const videoFrame = new VideoFrame(canvas, {
      timestamp: i * frameDurUs,
      duration: frameDurUs,
    });
    encoder.encode(videoFrame, { keyFrame: i % keyInterval === 0 });
    videoFrame.close();

    if (i % 4 === 0) {
      onProgress?.({
        phase: isMp4 ? 'Rendering MP4' : 'Rendering WebM',
        progress: i / totalFrames,
      });
      await yieldToBrowser();
    }
  });

  if (encoderError) throw encoderError;

  onProgress?.({ phase: 'Finalizing', progress: 0.98 });
  await encoder.flush();
  muxer.finalize();

  const buffer = muxer.target.buffer;
  if (buffer.byteLength < 1024) {
    throw new Error('Encoded video was empty — try recording a few more seconds.');
  }

  if (isMp4) {
    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      filename: `sandbox-${Date.now()}.mp4`,
      format: 'mp4',
    };
  }

  return {
    blob: new Blob([buffer], { type: 'video/webm' }),
    filename: `sandbox-${Date.now()}.webm`,
    format: 'webm',
  };
}

async function exportWithPacedRecorder(
  world: SandboxWorld,
  data: ReplayData,
  fps: number,
  bitrate: number,
  totalFrames: number,
  duration: number,
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

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('MediaRecorder failed during export'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
  });

  const frameDelayMs = 1000 / fps;
  recorder.start(250);

  await renderExportFrames(world, data, fps, totalFrames, duration, async (i) => {
    track.requestFrame?.();
    onProgress?.({ phase: 'Rendering video (real-time)', progress: i / totalFrames });
    if (i < totalFrames - 1) {
      await sleep(frameDelayMs);
    }
  });

  recorder.requestData();
  await sleep(200);
  recorder.stop();
  onProgress?.({ phase: 'Finalizing', progress: 0.98 });

  const blob = await done;
  stream.getTracks().forEach((t) => t.stop());

  if (blob.size < 1024) {
    throw new Error('Video export produced an empty file — record at least 2–3 seconds.');
  }

  return {
    blob,
    filename: `sandbox-${Date.now()}.webm`,
    format: 'webm',
  };
}

async function renderExportFrames(
  world: SandboxWorld,
  data: ReplayData,
  fps: number,
  totalFrames: number,
  duration: number,
  onFrame: (index: number) => void | Promise<void>,
): Promise<void> {
  for (let i = 0; i < totalFrames; i++) {
    const t = Math.min(duration, i / fps);
    world.applyReplayFrame(interpolateReplayAt(data, t));
    world.renderer.render(world.scene, world.camera);
    await onFrame(i);
  }
}

function prepareExportSize(world: SandboxWorld, exportPixelRatio: number): ExportSize {
  const savedRatio = world.renderer.getPixelRatio();
  const cssW = world.containerSize.width;
  const cssH = world.containerSize.height;
  // Offline export can supersample above display DPR for sharper output.
  let ratio = Math.min(exportPixelRatio, 4);

  world.renderer.setPixelRatio(ratio);
  world.renderer.setSize(cssW, cssH);

  for (let attempt = 0; attempt < 20; attempt++) {
    const { width, height } = evenDimensions(
      world.renderer.domElement.width,
      world.renderer.domElement.height,
    );
    if (width === world.renderer.domElement.width && height === world.renderer.domElement.height) {
      return { width, height, savedRatio, exportRatio: ratio };
    }
    ratio = Math.max(0.5, ratio * (width / world.renderer.domElement.width));
    world.renderer.setPixelRatio(ratio);
    world.renderer.setSize(cssW, cssH);
  }

  return {
    width: evenDimensions(world.renderer.domElement.width, world.renderer.domElement.height).width,
    height: evenDimensions(world.renderer.domElement.width, world.renderer.domElement.height).height,
    savedRatio,
    exportRatio: ratio,
  };
}

function evenDimensions(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(2, width - (width % 2)),
    height: Math.max(2, height - (height % 2)),
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

async function pickVp9Codec(width: number, height: number, bitrate: number, framerate: number): Promise<string> {
  const candidates = ['vp09.00.10.08', 'vp8'];
  for (const codec of candidates) {
    const { supported } = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate });
    if (supported) return codec;
  }
  throw new Error('VP9 encoding not supported in this browser');
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
