export type VideoQuality = 'high' | 'balanced';

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
  return stored === 'balanced' ? 'balanced' : 'high';
}

export function setVideoQuality(quality: VideoQuality): void {
  localStorage.setItem(VIDEO_QUALITY_KEY, quality);
}

export type VideoQualityProfile = {
  /** Frames captured during live sim (lightweight pose data). */
  captureFps: number;
  /** Frames in exported video (offline render). */
  exportFps: number;
  bitrate: number;
  exportPixelRatio: number;
};

export function getVideoQualityProfile(quality: VideoQuality, canvas: HTMLCanvasElement): VideoQualityProfile {
  const pixels = canvas.width * canvas.height;
  if (quality === 'balanced') {
    return {
      captureFps: 30,
      exportFps: 60,
      bitrate: Math.min(12_000_000, Math.max(6_000_000, Math.round(pixels * 5))),
      exportPixelRatio: 1.5,
    };
  }
  return {
    captureFps: 60,
    exportFps: 60,
    bitrate: Math.min(24_000_000, Math.max(12_000_000, Math.round(pixels * 10))),
    exportPixelRatio: 2,
  };
}
