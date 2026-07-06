import type { SandboxWorld } from '../physics/SandboxWorld';
import { downloadVideo } from '../physics/OfflineVideoExporter';
import { VideoRecorder } from '../physics/VideoRecorder';
import './StudioToolbar.css';

type Props = {
  world: SandboxWorld | null;
  ready: boolean;
  recordingReplay: boolean;
  recordingVideo: boolean;
  exportingVideo: boolean;
  exportProgress: number;
  autoRecordVideo: boolean;
  videoQuality: import('../lib/recordingPrefs').VideoQuality;
  onReplayRecordingChange: (on: boolean) => void;
  onVideoRecordingChange: (on: boolean) => void;
  onAutoRecordChange: (on: boolean) => void;
  onExportStateChange: (state: { exporting: boolean; progress: number }) => void;
  onStatus: (msg: string) => void;
};

export function StudioToolbar({
  world,
  ready,
  recordingReplay,
  recordingVideo,
  exportingVideo,
  exportProgress,
  autoRecordVideo,
  videoQuality,
  onReplayRecordingChange,
  onVideoRecordingChange,
  onAutoRecordChange,
  onExportStateChange,
  onStatus,
}: Props) {
  if (!ready || !world) return null;

  const finishVideo = async () => {
    if (!recordingVideo || !world) return;
    onExportStateChange({ exporting: true, progress: 0 });
    onStatus('Rendering offline at 60fps — use Chrome/Edge for MP4.');
    try {
      const result = await world.stopVideoRecording(videoQuality, (p) => {
        onExportStateChange({ exporting: true, progress: p.progress });
      });
      onVideoRecordingChange(false);
      if (result) {
        downloadVideo(result.blob, result.filename);
        const mb = (result.blob.size / 1024 / 1024).toFixed(1);
        const formatLabel = result.format === 'mp4' ? 'MP4' : 'WebM (use Chrome for MP4)';
        onStatus(`Video saved: ${result.filename} (${mb} MB, 60fps ${formatLabel})`);
      } else {
        onStatus('Video export failed');
      }
    } catch (err) {
      onVideoRecordingChange(false);
      onStatus(err instanceof Error ? err.message : 'Video export failed');
    } finally {
      onExportStateChange({ exporting: false, progress: 0 });
    }
  };

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

  const startManualVideo = () => {
    if (recordingVideo) return;
    world.startVideoRecording();
    onVideoRecordingChange(true);
    onStatus('Capturing poses (no lag)… click Finish Video for 60fps MP4.');
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
    world.lockFlyCamera();
    onStatus('Camera: free fly');
  };

  const camOrbit = () => {
    const ids = [...world.getSceneSummary().match(/ids: \[(.*?)\]/)?.[1]?.split(', ') ?? []];
    const target = ids.find((id) => id && id !== 'ground') ?? ids[0];
    if (target) {
      world.enableCinematicOrbit(target);
      onStatus(`Camera: orbit ${target}`);
    } else {
      onStatus('No body to orbit');
    }
  };

  return (
    <div className="studio-toolbar">
      {recordingVideo ? (
        <button
          type="button"
          className="finish-video active"
          onClick={() => void finishVideo()}
          disabled={exportingVideo}
          title="Render and download 60fps MP4"
        >
          {exportingVideo ? `Rendering ${Math.round(exportProgress * 100)}%` : '✓ Finish Video'}
        </button>
      ) : (
        <button type="button" onClick={startManualVideo} title="Capture poses while sim runs — export 60fps MP4 when done">
          🎬 Video
        </button>
      )}
      <button
        type="button"
        className={autoRecordVideo ? 'toggle on' : 'toggle'}
        onClick={() => onAutoRecordChange(!autoRecordVideo)}
        title="Auto-start video recording after each prompt"
      >
        Auto {autoRecordVideo ? 'ON' : 'off'}
      </button>
      <button type="button" className={recordingReplay ? 'active' : ''} onClick={toggleReplay} title="Record replay JSON">
        {recordingReplay ? '⏹ Replay' : '⏺ Replay'}
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
