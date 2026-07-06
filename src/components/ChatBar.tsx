import { useRef, useState } from 'react';
import { MODELS, type ModelId } from '../lib/openrouter';
import './ChatBar.css';

type Props = {
  loading: boolean;
  disabled: boolean;
  model: ModelId;
  onModelChange: (model: ModelId) => void;
  onOpenSettings: () => void;
  onSubmit: (text: string) => void;
};

export function ChatBar({ loading, disabled, model, onModelChange, onOpenSettings, onSubmit }: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const value = text.trim();
    if (!value || loading || disabled) return;
    onSubmit(value);
    setText('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="chat-bar-wrap">
      <div className="chat-bar">
        <button
          type="button"
          className="icon-btn"
          onClick={onOpenSettings}
          title="Settings & API key"
          aria-label="Settings"
        >
          +
        </button>

        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="Send follow-up"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || loading}
          rows={1}
        />

        <select
          className="model-select"
          value={model}
          onChange={(e) => onModelChange(e.target.value as ModelId)}
          title="AI model"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="send-btn"
          onClick={submit}
          disabled={disabled || loading || !text.trim()}
          title={loading ? 'Generating…' : 'Send'}
          aria-label="Send"
        >
          {loading ? (
            <span className="spinner" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 14 0h-2z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
