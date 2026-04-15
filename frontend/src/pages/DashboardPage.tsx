import { useState, useRef, useCallback } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../auth/AuthContext';
import { API_BASE_URL } from '../config';
import CodeViewer from '../components/CodeViewer';
import FileTree from '../components/FileTree';

const API_URL = `${API_BASE_URL}/api/explain`;
const IMPORT_URL = `${API_BASE_URL}/api/upload-repo`;

type Status = 'idle' | 'loading' | 'success' | 'error';
type ImportStatus = 'idle' | 'loading' | 'success' | 'error';

interface ImportedFile {
  path: string;
  name: string;
  content: string;
  language: string;
}

interface ImportMeta {
  owner: string;
  repo: string;
  branch: string;
  totalFiles: number;
  returnedFiles: number;
  truncated: boolean;
  warning?: string;
}

export default function DashboardPage() {
  const { email, logout, token } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [explanation, setExp] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // GitHub import state
  const [githubUrl, setGithubUrl] = useState('');
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importError, setImportError] = useState('');
  const [importWarning, setImportWarning] = useState('');
  const [importedFiles, setImportedFiles] = useState<ImportedFile[]>([]);
  const [importMeta, setImportMeta] = useState<ImportMeta | null>(null);

  // Code viewer state
  const [selectedFile, setSelectedFile] = useState<ImportedFile | null>(null);

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

  const importGithub = async () => {
    const trimmed = githubUrl.trim();
    if (!trimmed) {
      setImportError('Please enter a GitHub repository URL.');
      return;
    }

    setImportStatus('loading');
    setImportError('');
    setImportWarning('');
    setImportedFiles([]);
    setImportMeta(null);
    setSelectedFile(null);

    try {
      const res = await fetch(IMPORT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Import failed');
      }

      setImportedFiles(data.files || []);
      setImportMeta(data.meta || null);
      setImportStatus('success');

      if (data.meta?.warning) {
        setImportWarning(data.meta.warning);
      }
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'GitHub import failed.');
      setImportStatus('error');
    }
  };

  const clearImport = () => {
    setGithubUrl('');
    setImportStatus('idle');
    setImportError('');
    setImportWarning('');
    setImportedFiles([]);
    setImportMeta(null);
    setSelectedFile(null);
    setExp('');
    setStatus('idle');
  };

  /* ---- Analyze selected file with AI ---- */
  const analyzeSelectedFile = async () => {
    if (!selectedFile || !token) return;
    setStatus('loading');
    setExp('');
    setError('');

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: selectedFile.content,
          filename: selectedFile.name,
          language: selectedFile.language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      setExp(data.explanation);
      setStatus('success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
      setStatus('error');
    }
  };

  const handleFileSelect = useCallback((f: ImportedFile) => {
    setSelectedFile(f);
    setExp('');
    setStatus('idle');
    setError('');
  }, []);

  /* ===== CODE VIEWER LAYOUT (file selected) ===== */
  const showCodeViewerLayout = selectedFile !== null;

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

        {/* ---- Upload / Import Section ---- */}
        {!showCodeViewerLayout && (
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

              {/* ---- GitHub Import Section ---- */}
              <div className="github-import-section">
                <div className="github-import-divider">
                  <span className="divider-line" />
                  <span className="divider-text">or import from GitHub</span>
                  <span className="divider-line" />
                </div>

                <div className="github-import-row">
                  <div className="github-input-wrapper">
                    <svg className="github-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                    </svg>
                    <input
                      id="github-url-input"
                      type="url"
                      className="input github-url-input"
                      placeholder="https://github.com/owner/repo"
                      value={githubUrl}
                      onChange={e => setGithubUrl(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && githubUrl.trim()) importGithub(); }}
                      disabled={importStatus === 'loading'}
                    />
                  </div>
                  <button
                    id="github-import-btn"
                    className="btn btn-github"
                    type="button"
                    disabled={!githubUrl.trim() || importStatus === 'loading'}
                    onClick={importGithub}
                  >
                    {importStatus === 'loading' ? (
                      <>
                        <span className="spinner-sm" />
                        Importing…
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Import
                      </>
                    )}
                  </button>
                </div>

                {importStatus === 'loading' && (
                  <div className="github-loading-bar">
                    <div className="github-loading-track">
                      <div className="github-loading-fill" />
                    </div>
                    <span className="muted">Fetching repository tree and downloading files…</span>
                  </div>
                )}

                {importError && (
                  <div className="error-banner github-error">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    {importError}
                  </div>
                )}

                {importWarning && (
                  <div className="warning-banner">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    {importWarning}
                  </div>
                )}

                {importStatus === 'success' && importedFiles.length > 0 && (
                  <div className="github-import-result">
                    <div className="github-result-header">
                      <div className="github-result-meta">
                        <span className="accent">{importMeta?.owner}/{importMeta?.repo}</span>
                        <span className="pill">{importMeta?.branch}</span>
                        <span className="pill">{importedFiles.length} files</span>
                      </div>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={clearImport}>Clear</button>
                    </div>
                    <div className="github-file-list">
                      {importedFiles.map((f) => (
                        <div
                          key={f.path}
                          className="github-file-item clickable"
                          onClick={() => {
                            setSelectedFile(f);
                            setExp('');
                            setStatus('idle');
                            setError('');
                          }}
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span className="github-file-path">{f.path}</span>
                          <span className="github-file-lang">{f.language}</span>
                        </div>
                      ))}
                    </div>
                    <div className="github-file-hint">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      Click a file to open the code viewer
                    </div>
                  </div>
                )}
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
        )}

        {/* ---- Code Viewer Layout (file selected) ---- */}
        {showCodeViewerLayout && (
          <>
            {/* Back button + repo meta */}
            <div className="code-layout-header">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => {
                  setSelectedFile(null);
                  setExp('');
                  setStatus('idle');
                }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Back to files
              </button>
              {importMeta && (
                <div className="code-layout-meta">
                  <span className="accent">{importMeta.owner}/{importMeta.repo}</span>
                  <span className="pill">{importMeta.branch}</span>
                </div>
              )}
            </div>

            <section className="code-layout">
              {/* LEFT — file tree + code viewer */}
              <div className="code-layout-left">
                {/* Sidebar file tree */}
                <div className="file-tree-sidebar">
                  <div className="file-tree-title">Files</div>
                  <div className="file-tree-list">
                    <FileTree
                      files={importedFiles}
                      selectedFilePath={selectedFile?.path}
                      onFileSelect={handleFileSelect}
                    />
                  </div>
                </div>

                {/* Code viewer */}
                <div className="card code-viewer-card">
                  <CodeViewer
                    filename={selectedFile!.name}
                    content={selectedFile!.content}
                    language={selectedFile!.language}
                    onAnalyze={analyzeSelectedFile}
                    analyzing={status === 'loading'}
                  />
                </div>
              </div>

              {/* RIGHT — analysis output */}
              <div className="card output-card code-layout-right">
                <h2>{status === 'success' ? 'AI Analysis' : 'Analysis'}</h2>

                {status === 'loading' && (
                  <div className="loading-state">
                    <div className="spinner" />
                    <div>
                      <p>Analysis underway…</p>
                      <span className="muted">Sending <strong>{selectedFile!.name}</strong> to the model.</span>
                    </div>
                  </div>
                )}

                {status === 'error' && errorMsg && (
                  <div className="error-banner">{errorMsg}</div>
                )}

                {status === 'success' && (
                  <div className="markdown">
                    <ReactMarkdown>{explanation}</ReactMarkdown>
                  </div>
                )}

                {status === 'idle' && (
                  <div className="analysis-placeholder">
                    <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                    </svg>
                    <p>Click <strong>"Analyze with AI"</strong> to get a detailed explanation of this file.</p>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
