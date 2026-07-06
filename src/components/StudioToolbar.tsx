import type { SandboxWorld } from '../physics/SandboxWorld';
import { VideoRecorder } from '../physics/VideoRecorder';
import './StudioToolbar.css';

type Props = {
  world: SandboxWorld | null;
  ready: boolean;
  recordingReplay: boolean;
  recordingVideo: boolean;
  onReplayRecordingChange: (on: boolean) => void;
  onVideoRecordingChange: (on: boolean) => void;
  onStatus: (msg: string) => void;
};

export function StudioToolbar({
  world,
  ready,
  recordingReplay,
  recordingVideo,
  onReplayRecordingChange,
  onVideoRecordingChange,
  onStatus,
}: Props) {
  if (!ready || !world) return null;

  const toggleReplay = () => {
    if (recordingReplay) {
      const json = world.stopReplayRecording();
      onReplayRecordingChange(false);
      const blob = new Blob([json], { type: 'application/json' });
      VideoRecorder.download(blob, `replay-${Date.now()}.json`);
      onStatus(`Replay saved (${world.replay.getFrameCount()} frames, ${world.replay.getDuration().toFixed(1)}s)`);
    } else {
      world.startReplayRecording();
      onReplayRecordingChange(true);
      onStatus('Recording replay…');
    }
  };

  const toggleVideo = async () => {
    if (recordingVideo) {
      const blob = await world.stopVideoRecording();
      onVideoRecordingChange(false);
      if (blob) {
        VideoRecorder.download(blob);
        onStatus(`Video saved (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
      } else {
        onStatus('Video recording failed');
      }
    } else {
      world.startVideoRecording();
      onVideoRecordingChange(true);
      onStatus('Recording video…');
    }
  };

  const playReplay = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        world.loadReplay(text);
        world.playReplay();
        onStatus(`Playing replay (${world.replay.getDuration().toFixed(1)}s)`);
      } catch {
        onStatus('Invalid replay file');
      }
    };
    input.click();
  };

  const stopReplay = () => {
    world.stopReplay();
    onStatus('Replay stopped');
  };

  const camFree = () => {
    world.cinematic.free();
    onStatus('Camera: free fly');
  };

  const camOrbit = () => {
    const ids = [...world.getSceneSummary().match(/ids: \[(.*?)\]/)?.[1]?.split(', ') ?? []];
    const target = ids.find((id) => id && id !== 'ground') ?? ids[0];
    if (target) {
      world.cinematic.orbit(target);
      onStatus(`Camera: orbit ${target}`);
    } else {
      onStatus('No body to orbit');
    }
  };

  return (
    <div className="studio-toolbar">
      <button type="button" className={recordingReplay ? 'active' : ''} onClick={toggleReplay} title="Record replay JSON">
        {recordingReplay ? '⏹ Replay' : '⏺ Replay'}
      </button>
      <button type="button" className={recordingVideo ? 'active' : ''} onClick={() => void toggleVideo()} title="Record WebM video">
        {recordingVideo ? '⏹ Video' : '🎬 Video'}
      </button>
      <button type="button" onClick={playReplay} title="Load and play replay">
        ▶ Play
      </button>
      <button type="button" onClick={stopReplay} title="Stop replay playback">
        ⏸ Stop
      </button>
      <span className="studio-divider" />
      <button type="button" onClick={camFree} title="Free camera">
        Fly
      </button>
      <button type="button" onClick={camOrbit} title="Orbit first body">
        Orbit
      </button>
    </div>
  );
}
