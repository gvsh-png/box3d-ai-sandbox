import { useEffect, useRef, useState } from 'react';
import { SandboxWorld } from './physics/SandboxWorld';
import { executeSandboxScript } from './lib/executeScript';
import { thinkWithLLM } from './lib/agentBrain';
import { appendTurn, type ConversationTurn } from './lib/conversation';
import {
  getStoredApiKey,
  getStoredModel,
  generateScriptWithAI,
  MODELS,
  setStoredApiKey,
  setStoredModel,
  tryLocalParse,
  type ModelId,
} from './lib/openrouter';
import { normalizeBatch } from './lib/normalize';
import { ChatBar } from './components/ChatBar';
import { SettingsPanel } from './components/SettingsPanel';
import { StudioToolbar } from './components/StudioToolbar';
import './App.css';

type LogEntry = { role: 'user' | 'assistant' | 'error'; text: string };

export default function App() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const logPanelRef = useRef<HTMLElement>(null);
  const worldRef = useRef<SandboxWorld | null>(null);
  const [sandbox, setSandbox] = useState<SandboxWorld | null>(null);
  const apiKeyRef = useRef(getStoredApiKey());
  const modelRef = useRef<ModelId>(getStoredModel());
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState(getStoredApiKey);
  const [model, setModel] = useState<ModelId>(getStoredModel);
  const [history, setHistory] = useState<ConversationTurn[]>([]);
  const [recordingReplay, setRecordingReplay] = useState(false);
  const [recordingVideo, setRecordingVideo] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      role: 'assistant',
      text: 'Studio mode: build scenes with chat · record Replay (JSON) or Video (WebM) · agents & cinematic camera in scripts',
    },
    {
      role: 'assistant',
      text: 'WASD fly · RMB look · LMB drag objects · scroll to move',
    },
  ]);

  const pushStatus = (text: string) => {
    setLogs((prev) => [...prev, { role: 'assistant', text }]);
  };

  const wireAgentBrain = (world: SandboxWorld, key: string, selectedModel: ModelId) => {
    world.setLLMAgentHandler((agent, ctx) => {
      if (!key.trim()) return Promise.resolve();
      return thinkWithLLM(key.trim(), selectedModel, agent, ctx);
    });
  };

  useEffect(() => {
    apiKeyRef.current = apiKey;
    modelRef.current = model;
    if (worldRef.current) wireAgentBrain(worldRef.current, apiKey, model);
  }, [apiKey, model]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const world = new SandboxWorld(el);
    worldRef.current = world;
    wireAgentBrain(world, apiKeyRef.current, modelRef.current);
    world.init().then(() => {
      setReady(true);
      setSandbox(world);
    });

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
      const local = tryLocalParse(prompt);

      if (local) {
        const batch = normalizeBatch(local, prompt);
        const msg = worldRef.current.executeBatch(batch);
        setHistory((h) => {
          let next = appendTurn(h, { role: 'user', content: prompt });
          return appendTurn(next, { role: 'assistant', content: msg });
        });
        setLogs((prev) => [...prev, { role: 'assistant', text: msg }]);
      } else if (apiKey.trim()) {
        const sceneSummary = worldRef.current.getSceneSummary();
        const { message, script } = await generateScriptWithAI(
          apiKey.trim(),
          model,
          prompt,
          sceneSummary,
          history,
        );
        const result = executeSandboxScript(worldRef.current, script);

        if (!result.ok) {
          throw new Error(`${result.error}\n\nGenerated script:\n${script.slice(0, 400)}${script.length > 400 ? '…' : ''}`);
        }

        setHistory((h) => {
          let next = appendTurn(h, { role: 'user', content: prompt });
          return appendTurn(next, { role: 'assistant', content: message, script });
        });
        setLogs((prev) => [...prev, { role: 'assistant', text: message }]);
      } else {
        throw new Error('No API key set. Open settings (+) and add your OpenRouter key, or try "4 boxes from sky" / "clear".');
      }
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
        text: key
          ? `OpenRouter connected. Script + LLM agents use ${MODELS.find((m) => m.id === selectedModel)?.label ?? selectedModel}.`
          : 'API key cleared. Local fast-path only.',
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
          {apiKey ? <span className="badge ok">Script mode</span> : <span className="badge">Local mode</span>}
          {ready && sandbox && sandbox.getAgentCount() > 0 && (
            <span className="badge ok">{sandbox.getAgentCount()} agents</span>
          )}
          {(recordingReplay || recordingVideo) && <span className="badge rec">REC</span>}
        </div>
      </header>

      <div className="viewport" ref={viewportRef} />

      <StudioToolbar
        world={sandbox}
        ready={ready}
        recordingReplay={recordingReplay}
        recordingVideo={recordingVideo}
        onReplayRecordingChange={setRecordingReplay}
        onVideoRecordingChange={setRecordingVideo}
        onStatus={pushStatus}
      />

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
