import { useEffect, useRef, useState } from 'react';
import { SandboxWorld } from './physics/SandboxWorld';
import {
  getStoredApiKey,
  getStoredModel,
  localParse,
  MODELS,
  parsePromptWithAI,
  setStoredApiKey,
  setStoredModel,
  type ModelId,
} from './lib/openrouter';
import { ChatBar } from './components/ChatBar';
import { SettingsPanel } from './components/SettingsPanel';
import './App.css';

type LogEntry = { role: 'user' | 'assistant' | 'error'; text: string };

export default function App() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const logPanelRef = useRef<HTMLElement>(null);
  const worldRef = useRef<SandboxWorld | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState(getStoredApiKey);
  const [model, setModel] = useState<ModelId>(getStoredModel);
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      role: 'assistant',
      text: 'Box3D AI Sandbox ready. Try: "Generate 4 boxes from the sky" or open settings to add your OpenRouter API key.',
    },
  ]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const world = new SandboxWorld(el);
    worldRef.current = world;
    world.init().then(() => setReady(true));

    return () => {
      world.dispose();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    const panel = logPanelRef.current;
    if (!panel) return;
    panel.scrollTo({ top: panel.scrollHeight, behavior: 'smooth' });
  }, [logs, loading]);

  const handleSubmit = async (prompt: string) => {
    if (!prompt.trim() || !worldRef.current?.isReady()) return;

    setLogs((prev) => [...prev, { role: 'user', text: prompt }]);
    setLoading(true);

    try {
      const local = localParse(prompt);
      let batch;

      if (local) {
        batch = local;
      } else if (apiKey.trim()) {
        const sceneSummary = worldRef.current.getSceneSummary();
        batch = await parsePromptWithAI(apiKey.trim(), model, prompt, sceneSummary);
      } else {
        throw new Error('No API key set. Open settings (+) and add your OpenRouter key, or try a simple phrase like "4 boxes from the sky".');
      }

      const msg = worldRef.current.executeBatch(batch);
      setLogs((prev) => [...prev, { role: 'assistant', text: msg }]);
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Something went wrong';
      setLogs((prev) => [...prev, { role: 'error', text }]);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = (key: string, selectedModel: ModelId) => {
    setApiKey(key);
    setModel(selectedModel);
    setStoredApiKey(key);
    setStoredModel(selectedModel);
    setShowSettings(false);
    setLogs((prev) => [
      ...prev,
      {
        role: 'assistant',
        text: key ? `OpenRouter connected. Using ${MODELS.find((m) => m.id === selectedModel)?.label ?? selectedModel}.` : 'API key cleared. Local parser only.',
      },
    ]);
  };

  return (
    <div className="app">
      <header className="top-bar">
        <div className="brand">
          <span className="brand-dot" />
          <span>Box3D AI Sandbox</span>
        </div>
        <div className="status">
          {!ready && <span className="badge">Loading physics…</span>}
          {ready && <span className="badge ok">Sim running</span>}
          {apiKey ? <span className="badge ok">OpenRouter</span> : <span className="badge">Local mode</span>}
        </div>
      </header>

      <div className="viewport" ref={viewportRef} />

      <aside className="log-panel" ref={logPanelRef}>
        {logs.map((entry, i) => (
          <div key={i} className={`log-entry ${entry.role}`}>
            {entry.text}
          </div>
        ))}
      </aside>

      {showSettings && (
        <SettingsPanel
          apiKey={apiKey}
          model={model}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      <ChatBar
        loading={loading}
        disabled={!ready}
        model={model}
        onModelChange={(m) => {
          setModel(m);
          setStoredModel(m);
        }}
        onOpenSettings={() => setShowSettings(true)}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
