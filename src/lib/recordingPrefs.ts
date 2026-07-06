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
  fps: number;
  bitrate: number;
  maxPixelRatio: number;
  codecPreference: ('vp9' | 'vp8')[];
};

export function getVideoQualityProfile(quality: VideoQuality, canvas: HTMLCanvasElement): VideoQualityProfile {
  const pixels = canvas.width * canvas.height;
  if (quality === 'balanced') {
    return {
      fps: 24,
      bitrate: Math.min(8_000_000, Math.max(4_000_000, Math.round(pixels * 4))),
      maxPixelRatio: 1.25,
      codecPreference: ['vp9', 'vp8'],
    };
  }
  // High — ~0.12 bits per pixel per frame at 30fps target
  return {
    fps: 30,
    bitrate: Math.min(20_000_000, Math.max(10_000_000, Math.round(pixels * 8))),
    maxPixelRatio: 2,
    codecPreference: ['vp9', 'vp8'],
  };
}
