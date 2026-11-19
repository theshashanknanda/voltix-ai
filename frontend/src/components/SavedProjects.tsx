import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/authContext';
import { API_BASE_URL } from '../config';

type ProjectSummary = { id: string; label: string; source: string; createdAt: string };
export type ProjectSnapshot = {
  id: string;
  files: { path: string; name: string; content: string; language: string }[];
  metadata: { owner?: string; repo?: string; branch?: string; name?: string; totalFiles: number; returnedFiles: number; truncated: boolean; warning?: string };
};

export default function SavedProjects({ revision, onOpen }: { revision: number; onOpen: (project: ProjectSnapshot) => void }) {
  const { apiFetch } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await apiFetch(`${API_BASE_URL}/api/projects`, { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load projects.');
    setProjects(data.projects);
  }, [apiFetch]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load projects.');
    });
    return () => controller.abort();
  }, [load, revision]);
  const act = async (project: ProjectSummary, action: 'open' | 'delete') => {
    if (action === 'delete' && !window.confirm(`Remove saved project "${project.label}"? This frees a project slot.`)) return;
    setBusy(project.id);
    setError('');
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/projects/${project.id}`, { method: action === 'delete' ? 'DELETE' : 'GET' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to access project.');
      if (action === 'open') onOpen(data.project);
      else await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to access project.'); }
    finally { setBusy(null); }
  };
  return <section className="card">
    <h2>Saved projects</h2><p className="muted">Repository and ZIP imports are saved to your account. Removing a project frees a slot.</p>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {projects.length === 0 && !error && <p className="muted">No saved projects yet.</p>}
    <div className="status-list">{projects.map(project => <div className="status-row" key={project.id}>
      <div className="status-main"><div>{project.label}</div><span className="muted">{new Date(project.createdAt).toLocaleString()}</span></div>
      <div className="status-actions">
        <button className="btn btn-ghost" disabled={busy !== null} onClick={() => void act(project, 'open')}>Open</button>
        <button className="btn btn-ghost" disabled={busy !== null} onClick={() => void act(project, 'delete')}>{busy === project.id ? 'Working...' : 'Remove'}</button>
      </div>
    </div>)}</div>
  </section>;
}
