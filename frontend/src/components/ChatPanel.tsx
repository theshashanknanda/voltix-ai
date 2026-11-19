import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { API_BASE_URL } from '../config';
import { findLocalImports } from '../localImports';
import Markdown from './Markdown';

export const OPEN_PROJECT_KEY = 'voltix.openProject';

export function rememberOpenProject(id: string | null) {
  try {
    if (id) sessionStorage.setItem(OPEN_PROJECT_KEY, id);
    else sessionStorage.removeItem(OPEN_PROJECT_KEY);
  } catch { /* storage unavailable */ }
}

type SourceFile = { path: string; content: string; language: string };
type Suggestion = { path: string; content: string; status: 'pending' | 'applied' | 'dismissed' };
type ChatMessage = { role: 'user' | 'assistant'; content: string; suggestion?: Suggestion };

function readSuggestion(value: unknown): Suggestion | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const suggestion = value as { path?: unknown; content?: unknown; status?: unknown };
  if (typeof suggestion.path !== 'string' || typeof suggestion.content !== 'string') return undefined;
  if (suggestion.status !== 'pending' && suggestion.status !== 'applied' && suggestion.status !== 'dismissed') return undefined;
  return { path: suggestion.path, content: suggestion.content, status: suggestion.status };
}

function readMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const message = item as { role?: unknown; content?: unknown; suggestion?: unknown };
    if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') return [];
    const suggestion = readSuggestion(message.suggestion);
    return [{ role: message.role, content: message.content, ...(suggestion ? { suggestion } : {}) }];
  });
}

export default function ChatPanel({
  projectId, files, selectedFile, apiFetch, onFileApplied,
}: {
  projectId: string;
  files: SourceFile[];
  selectedFile: SourceFile | null;
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  onFileApplied?: (path: string, content: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState(false);
  const [ready, setReady] = useState(false);
  const requestId = useRef(0);
  const alive = useRef(true);
  const projectRef = useRef(projectId);
  const logRef = useRef<HTMLDivElement>(null);
  projectRef.current = projectId;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await apiFetch(`${API_BASE_URL}/api/projects/${projectId}`, { signal: controller.signal });
        const data = await response.json();
        if (!alive.current || id !== requestId.current || projectRef.current !== projectId) return;
        if (!response.ok) throw new Error(data.error || 'Unable to load chat.');
        setMessages(readMessages(data.project?.chat));
        setError('');
      } catch (err) {
        if (controller.signal.aborted || !alive.current || id !== requestId.current) return;
        setError(err instanceof Error ? err.message : 'Unable to load chat.');
      } finally {
        if (alive.current && id === requestId.current) setReady(true);
      }
    })();
    return () => controller.abort();
  }, [projectId, apiFetch]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const forProject = projectId;
    const id = ++requestId.current;
    const previous = messages;
    const related = selectedFile ? findLocalImports(selectedFile, files) : [];
    setDraft('');
    setError('');
    setSending(true);
    setMessages([...previous, { role: 'user', content: text }]);
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          message: text,
          openPath: selectedFile?.path,
          neighborPaths: related.slice(0, 3).map(file => file.path),
          omittedPaths: related.slice(3).map(file => file.path).slice(0, 50),
        }),
      });
      const data = await response.json();
      if (!alive.current || id !== requestId.current || projectRef.current !== forProject) return;
      if (!response.ok) throw new Error(data.error || 'Chat failed.');
      setMessages(readMessages(data.messages));
    } catch (err) {
      if (!alive.current || id !== requestId.current || projectRef.current !== forProject) return;
      setMessages(previous);
      setDraft(text);
      setError(err instanceof Error ? err.message : 'Chat failed.');
    } finally {
      if (alive.current && id === requestId.current) setSending(false);
    }
  };

  const settleSuggestion = async (suggestion: Suggestion, action: 'apply' | 'dismiss') => {
    if (applying) return;
    const forProject = projectId;
    setApplying(true);
    setError('');
    try {
      const response = await apiFetch(
        `${API_BASE_URL}/api/projects/${projectId}/files${action === 'dismiss' ? '/dismiss' : ''}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action === 'apply'
            ? { path: suggestion.path, content: suggestion.content }
            : { path: suggestion.path }),
        },
      );
      const data = await response.json();
      if (!alive.current || projectRef.current !== forProject) return;
      if (!response.ok) throw new Error(data.error || 'Unable to update the suggestion.');
      if (action === 'apply') onFileApplied?.(suggestion.path, data.content ?? suggestion.content);
      const status = action === 'apply' ? 'applied' : 'dismissed';
      setMessages(current => current.map(message => (
        message.suggestion?.path === suggestion.path && message.suggestion.status === 'pending'
          ? { ...message, suggestion: { ...message.suggestion, status } }
          : message
      )));
    } catch (err) {
      if (!alive.current || projectRef.current !== forProject) return;
      setError(err instanceof Error ? err.message : 'Unable to update the suggestion.');
    } finally {
      if (alive.current) setApplying(false);
    }
  };

  return (
    <div className="card chat-panel">
      <h2>Chat</h2>
      <p className="muted">{selectedFile ? `Asking about ${selectedFile.path}` : 'Ask about this project.'}</p>
      <div className="chat-log" ref={logRef} role="log" aria-live="polite">
        {!ready && <p className="muted">Loading chat…</p>}
        {ready && messages.length === 0 && !sending && (
          <p className="muted">No messages yet. Ask a question about the files in this project.</p>
        )}
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`chat-bubble ${message.role}`}>
            {message.role === 'assistant'
              ? <div className="markdown"><Markdown>{message.content}</Markdown></div>
              : <p>{message.content}</p>}
            {message.suggestion?.status === 'pending' && (
              <div className="chat-suggestion">
                <p>Suggested replacement for <code>{message.suggestion.path}</code></p>
                <pre>{message.suggestion.content}</pre>
                <div className="chat-suggestion-actions">
                  <button className="btn btn-primary btn-sm" type="button" disabled={applying} onClick={() => void settleSuggestion(message.suggestion!, 'apply')}>Apply</button>
                  <button className="btn btn-ghost btn-sm" type="button" disabled={applying} onClick={() => void settleSuggestion(message.suggestion!, 'dismiss')}>Dismiss</button>
                </div>
              </div>
            )}
            {message.suggestion?.status === 'applied' && <p>Edit applied to {message.suggestion.path}.</p>}
            {message.suggestion?.status === 'dismissed' && <p>Suggestion dismissed. {message.suggestion.path} was not changed.</p>}
          </div>
        ))}
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form className="chat-form" onSubmit={event => { event.preventDefault(); void send(); }}>
        <textarea
          id="project-chat-input"
          className="input"
          rows={3}
          placeholder="Ask about this project"
          aria-label="Ask about this project"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          disabled={sending}
        />
        <button className="btn btn-primary" type="submit" disabled={sending || !draft.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
