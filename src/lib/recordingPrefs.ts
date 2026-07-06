export type VideoQuality = 'ultra' | 'high' | 'balanced';

const AUTO_RECORD_KEY = 'box3d-auto-record-video';
const VIDEO_QUALITY_KEY = 'box3d-video-quality';

export function getAutoRecordVideo(): boolean {
  const stored = localStorage.getItem(AUTO_RECORD_KEY);
  if (stored === null) return true;
  return stored === 'true';
}

export function setAutoRecordVideo(on: boolean): void {
  localStorage.setItem(AUTO_RECORD_KEY, on ? 'true' : 'false');
}

export function getVideoQuality(): VideoQuality {
  const stored = localStorage.getItem(VIDEO_QUALITY_KEY);
  if (stored === 'ultra' || stored === 'balanced') return stored;
  return 'high';
}

export function setVideoQuality(quality: VideoQuality): void {
  localStorage.setItem(VIDEO_QUALITY_KEY, quality);
}

export type VideoQualityProfile = {
  /** Frames captured during live sim (lightweight pose data). */
  captureFps: number;
  /** Frames in exported video (offline render). */
  exportFps: number;
  /** Offline render supersampling vs CSS size (not capped to display DPR). */
  exportPixelRatio: number;
};

export function getVideoQualityProfile(quality: VideoQuality): VideoQualityProfile {
  if (quality === 'ultra') {
    return { captureFps: 60, exportFps: 60, exportPixelRatio: 3 };
  }
  if (quality === 'balanced') {
    return { captureFps: 30, exportFps: 60, exportPixelRatio: 2 };
  }
  return { captureFps: 60, exportFps: 60, exportPixelRatio: 2.5 };
}

/** Bitrate from actual export resolution — scales with pixels and fps. */
export function computeExportBitrate(
  quality: VideoQuality,
  width: number,
  height: number,
  fps: number,
): number {
  const pixels = width * height;
  const bitsPerPixelPerFrame =
    quality === 'ultra' ? 0.22 : quality === 'high' ? 0.14 : 0.07;
  const raw = Math.round(pixels * fps * bitsPerPixelPerFrame);
  const [floor, cap] =
    quality === 'ultra'
      ? [30_000_000, 80_000_000]
      : quality === 'high'
        ? [16_000_000, 50_000_000]
        : [8_000_000, 24_000_000];
  return Math.min(cap, Math.max(floor, raw));
}
