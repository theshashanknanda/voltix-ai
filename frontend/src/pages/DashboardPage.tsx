import { useState, useRef } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../auth/AuthContext';
import { API_BASE_URL } from '../config';

const API_URL = `${API_BASE_URL}/api/explain`;

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function DashboardPage() {
  const { email, logout, token } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [explanation, setExp] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File) => {
    if (!f.name.endsWith('.js')) {
      setError('Only .js files are accepted.');
      setFile(null);
      return;
    }
    setError('');
    setFile(f);
    setStatus('idle');
    setExp('');
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) pick(f);
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) pick(f);
  };

  const submit = async () => {
    if (!file) return;
    if (!token) {
      setError('Please login first.');
      return;
    }
    setStatus('loading');
    setExp('');
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: form,
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      setExp(data.explanation);
      setStatus('success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setStatus('error');
    }
  };

  return (
    <div className="page dashboard-page">
      <header className="nav">
        <div className="logo">
          <span className="logo-badge" />
          <span>Voltix AI</span>
        </div>
        <div className="nav-actions">
          <span className="eyebrow">Upload Workspace</span>
          <span className="pill">Signed in as {email || 'user'}</span>
          <button className="btn btn-ghost" type="button" onClick={logout}>Logout</button>
        </div>
      </header>

      <main className="container">
        <div className="breadcrumb">Landing Page <span>&gt;</span> Upload Workspace</div>

        <section className="workspace-grid simple">
          <div className="card upload-card">
            <h2>Upload a file</h2>
            <p className="muted">Drop a single .js file to get an explanation.</p>
            <div
              className={`dropzone ${dragging ? 'active' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <div className="drop-icon" />
              <p>{file ? file.name : 'Drop repository archive here'}</p>
              <span>or browse local files</span>
              <input ref={inputRef} type="file" accept=".js" onChange={onFileChange} />
            </div>
            {errorMsg && <div className="error-banner">{errorMsg}</div>}
            <div className="upload-footer">
              <span className="muted">Encrypted transfer · temporary processing</span>
              <button className="btn btn-primary" type="button" disabled={!file || status === 'loading'} onClick={submit}>
                {status === 'loading' ? 'Analysing...' : 'Start Analysis'}
              </button>
            </div>
          </div>

          <div className="card output-card">
            <h2>{status === 'success' ? 'Results' : 'Analysis'}</h2>
            {status === 'loading' && (
              <div className="loading-state">
                <div className="spinner" />
                <div>
                  <p>Analysis underway…</p>
                  <span className="muted">Parsing your file and sending it to the model.</span>
                </div>
              </div>
            )}
            {status === 'success' && (
              <div className="markdown">
                <ReactMarkdown>{explanation}</ReactMarkdown>
              </div>
            )}
            {status === 'idle' && (
              <div className="status-list">
                <p className="muted">Upload a file to start the analysis.</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
