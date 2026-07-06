import { useState } from 'react';
import { MODELS, type ModelId } from '../lib/openrouter';
import type { VideoQuality } from '../lib/recordingPrefs';
import './SettingsPanel.css';

type Props = {
  apiKey: string;
  model: ModelId;
  autoRecordVideo: boolean;
  videoQuality: VideoQuality;
  onSave: (apiKey: string, model: ModelId, autoRecordVideo: boolean, videoQuality: VideoQuality) => void;
  onClose: () => void;
};

export function SettingsPanel({ apiKey, model, autoRecordVideo, videoQuality, onSave, onClose }: Props) {
  const [key, setKey] = useState(apiKey);
  const [selectedModel, setSelectedModel] = useState(model);
  const [autoRecord, setAutoRecord] = useState(autoRecordVideo);
  const [quality, setQuality] = useState<VideoQuality>(videoQuality);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Sandbox Settings</h2>
        <p className="settings-hint">
          Paste your <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">OpenRouter API key</a>.
          The AI generates JavaScript that runs in the sandbox — loops, logic, any scene you describe.
        </p>

        <label className="field">
          <span>OpenRouter API Key</span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-or-v1-..."
            autoComplete="off"
          />
        </label>

        <label className="field">
          <span>Default model</span>
          <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as ModelId)}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Video quality</span>
          <select value={quality} onChange={(e) => setQuality(e.target.value as VideoQuality)}>
            <option value="high">High (60fps MP4, full res)</option>
            <option value="balanced">Balanced (60fps, lighter export)</option>
          </select>
        </label>

        <label className="field checkbox-field">
          <input
            type="checkbox"
            checked={autoRecord}
            onChange={(e) => setAutoRecord(e.target.checked)}
          />
          <span>Auto-record video after each prompt (click Finish Video when done)</span>
        </label>

        <div className="settings-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => onSave(key.trim(), selectedModel, autoRecord, quality)}>
            Save
          </button>
        </div>

        <section className="quick-examples">
          <h3>Try saying</h3>
          <ul>
            <li>Spawn a purple circle</li>
            <li>Generate 4 boxes from the sky</li>
            <li>50 block jenga tower (wood)</li>
            <li>Container with 100 bouncy spheres</li>
            <li>Ramp with 20 dominoes</li>
            <li>Clear everything</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
