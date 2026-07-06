import { useState } from 'react';
import { MODELS, type ModelId } from '../lib/openrouter';
import './SettingsPanel.css';

type Props = {
  apiKey: string;
  model: ModelId;
  onSave: (apiKey: string, model: ModelId) => void;
  onClose: () => void;
};

export function SettingsPanel({ apiKey, model, onSave, onClose }: Props) {
  const [key, setKey] = useState(apiKey);
  const [selectedModel, setSelectedModel] = useState(model);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Sandbox Settings</h2>
        <p className="settings-hint">
          Paste your <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">OpenRouter API key</a>.
          Stored locally in your browser only. Use DeepSeek V4 Flash with <code>:floor</code> for lowest cost.
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

        <div className="settings-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => onSave(key.trim(), selectedModel)}>
            Save
          </button>
        </div>

        <section className="quick-examples">
          <h3>Try saying</h3>
          <ul>
            <li>Generate 4 boxes from the sky</li>
            <li>Drop 10 colorful spheres</li>
            <li>Zero gravity space mode</li>
            <li>Explode in the center</li>
            <li>Clear everything</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
