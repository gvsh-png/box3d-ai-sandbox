const AUTO_RECORD_KEY = 'box3d-auto-record-video';

export function getAutoRecordVideo(): boolean {
  const stored = localStorage.getItem(AUTO_RECORD_KEY);
  if (stored === null) return true;
  return stored === 'true';
}

export function setAutoRecordVideo(on: boolean): void {
  localStorage.setItem(AUTO_RECORD_KEY, on ? 'true' : 'false');
}
