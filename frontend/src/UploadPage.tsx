import { useState, useRef } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { API_BASE_URL } from './config';

const API_URL = `${API_BASE_URL}/api/explain`;

// Color palette — base: #101a30
const C = {
  bg:        '#101a30',
  surface:   '#16213e',
  border:    '#1e2d4a',
  borderHov: '#2a3f6a',
  green:     '#3fb950',
  text:      '#e6edf3',
  muted:     '#8b949e',
  dim:       '#3a4a6a',
  errorBg:   '#1a0d0d',
  errorBdr:  '#4a1010',
  errorText: '#f85149',
};

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function UploadPage() {
  const [file, setFile]            = useState<File | null>(null);
  const [explanation, setExp]      = useState('');
  const [status, setStatus]        = useState<Status>('idle');
  const [errorMsg, setError]       = useState('');
  const [dragging, setDragging]    = useState(false);
  const [email, setEmail]          = useState('');
  const [password, setPassword]    = useState('');
  const [token, setToken]          = useState(() => localStorage.getItem('voltix_token') || '');
  const inputRef                   = useRef<HTMLInputElement>(null);

  const pick = (f: File) => {
    if (!f.name.endsWith('.js')) { setError('Only .js files are accepted.'); setFile(null); return; }
    setError(''); setFile(f); setStatus('idle'); setExp('');
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0]; if (f) pick(f);
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) pick(f);
  };

  const login = async () => {
    if (!email || !password) {
      setError('Email and password are required to login.');
      return;
    }

    setError('');

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      setToken(data.token);
      localStorage.setItem('voltix_token', data.token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const submit = async () => {
    if (!file) return;
    if (!token) {
      setError('Please login first.');
      return;
    }
    setStatus('loading'); setExp(''); setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const res  = await fetch(API_URL, { 
        method: 'POST', 
        body: form,
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      setExp(data.explanation); setStatus('success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setStatus('error');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: "'Segoe UI', system-ui, sans-serif", paddingBottom: 48 }}>

      {/* Header */}
      <header style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'18px 32px', borderBottom:`1px solid ${C.border}` }}>
        <span style={{ fontWeight:700, fontSize:'1.15rem' }}>Voltix AI</span>
        <span style={{ color:C.muted, fontSize:'0.9rem' }}>Upload Workspace</span>
      </header>

      {/* Breadcrumb */}
      <div style={{ padding:'12px 32px 0', fontSize:'0.82rem' }}>
        <span style={{ color:C.muted }}>Landing Page</span>
        <span style={{ color:C.border, margin:'0 4px' }}> &gt; </span>
        <span>Upload Workspace</span>
      </div>

      {/* Hero */}
      <div style={{ margin:'20px 32px 0', background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:'28px 32px' }}>
        <h1 style={{ margin:'0 0 8px', fontSize:'1.45rem', fontWeight:700 }}>Upload your file and get an AI explanation</h1>
        <p style={{ margin:'0 0 18px', color:C.muted, fontSize:'0.9rem', fontFamily:'monospace' }}>
          Drop a single <code style={{ background:C.border, borderRadius:4, padding:'1px 5px', color:'#79c0ff' }}>.js</code> file — Voltix AI will explain what it does.
        </p>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
          {['Max size: 1 MB', 'Format: .js only', 'Powered by Groq · Llama 3.3'].map(t => (
            <span key={t} style={{ background:C.border, border:`1px solid ${C.dim}`, borderRadius:6, padding:'4px 12px', fontSize:'0.78rem', color:C.muted, fontFamily:'monospace' }}>{t}</span>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, margin:'20px 32px 0' }}>

        {/* Left — upload */}
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:24, display:'flex', flexDirection:'column', gap:16 }}>
          <p style={{ margin:0, fontWeight:600 }}>Auth + Codebase Source</p>

          <div style={{ display:'grid', gap:10 }}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{ padding:'10px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ padding:'10px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text }}
            />
            <button
              style={{ background: (email && password) ? C.green : C.dim, color: C.bg, border:'none', borderRadius:8,
                padding:'8px 16px', fontWeight:700, fontSize:'0.85rem', cursor:(email&&password)?'pointer':'not-allowed', opacity:(email&&password)?1:0.6 }}
              onClick={login}
              disabled={!email || !password}
            >
              {token ? 'Logged In' : 'Login'}
            </button>
          </div>

          <div
            style={{ border:`1.5px dashed ${dragging ? C.green : C.border}`, borderRadius:8, padding:'48px 24px', textAlign:'center', cursor:'pointer',
              background: dragging ? '#0a1f15' : C.bg, transition:'border-color .2s, background .2s',
              display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={1.5}>
              <path d="M12 16V4m0 0L8 8m4-4 4 4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round"/>
            </svg>
            <p style={{ margin:0, color:C.muted, fontFamily:'monospace', fontSize:'0.9rem', wordBreak:'break-all' }}>
              {file ? file.name : 'Drop repository archive here'}
            </p>
            <p style={{ margin:0, color:C.dim, fontSize:'0.78rem' }}>or browse local files</p>
            <input ref={inputRef} type="file" accept=".js" style={{ display:'none' }} onChange={onFileChange} />
          </div>

          {errorMsg && (
            <p style={{ margin:0, color:C.errorText, fontSize:'0.82rem', background:C.errorBg, border:`1px solid ${C.errorBdr}`, borderRadius:6, padding:'8px 12px' }}>{errorMsg}</p>
          )}

          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginTop:'auto' }}>
            <span style={{ color:C.dim, fontSize:'0.75rem' }}>🔒 Encrypted transfer · temporary processing</span>
            <button
              style={{ background: (!file || status==='loading') ? C.dim : C.green, color: C.bg, border:'none', borderRadius:8,
                padding:'10px 22px', fontWeight:700, fontSize:'0.9rem', cursor:(!file||status==='loading')?'not-allowed':'pointer',
                transition:'background .2s', whiteSpace:'nowrap', opacity:(!file||status==='loading') ? 0.6 : 1 }}
              onClick={submit}
              disabled={!file || status === 'loading'}
            >
              {status === 'loading' ? 'Analysing…' : 'Start Analysis'}
            </button>
          </div>
        </div>

        {/* Right — readiness / result */}
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:24, display:'flex', flexDirection:'column', gap:16 }}>
          <p style={{ margin:0, fontWeight:600 }}>
            {status === 'success' ? 'AI Explanation' : 'Upload Readiness'}
          </p>

          {status !== 'success' && (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {[
                { ok: !!file, label: file ? `File selected — ${file.name}` : 'No file selected yet' },
                { ok: true,   label: '.js extension validation active' },
                { ok: true,   label: 'Groq · Llama 3.3 analysis ready' },
              ].map(({ ok, label }) => (
                <p key={label} style={{ margin:0, color:C.muted, fontSize:'0.85rem', display:'flex', alignItems:'center', gap:8, fontFamily:'monospace' }}>
                  <span style={{ color: ok ? C.green : C.dim, fontWeight:700 }}>✓</span>{label}
                </p>
              ))}

              {status === 'loading' && (
                <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:8 }}>
                  <div style={{ width:18, height:18, border:`2px solid ${C.border}`, borderTop:`2px solid ${C.green}`, borderRadius:'50%', animation:'spin .8s linear infinite' }} />
                  <span style={{ color:C.muted, fontSize:'0.85rem', fontFamily:'monospace' }}>Sending to Groq…</span>
                </div>
              )}

              {status === 'error' && (
                <div style={{ background:C.errorBg, border:`1px solid ${C.errorBdr}`, borderRadius:6, padding:'10px 14px', color:C.errorText, fontSize:'0.82rem', marginTop:8 }}>{errorMsg}</div>
              )}
            </div>
          )}

          {status === 'success' && (
            <div style={{ flex:1, overflowY:'auto', maxHeight:520, background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:'16px 20px' }}>
              <div style={{ color:C.text, fontSize:'0.85rem', lineHeight:1.7 }}>
                <ReactMarkdown
                  components={{
                    h1: ({children}) => <h1 style={{ fontSize:'1.1rem', fontWeight:700, color:C.text, margin:'0 0 10px' }}>{children}</h1>,
                    h2: ({children}) => <h2 style={{ fontSize:'1rem', fontWeight:700, color:C.text, margin:'14px 0 6px' }}>{children}</h2>,
                    h3: ({children}) => <h3 style={{ fontSize:'0.9rem', fontWeight:600, color:'#79c0ff', margin:'12px 0 4px' }}>{children}</h3>,
                    p:  ({children}) => <p  style={{ margin:'0 0 10px', color:C.muted }}>{children}</p>,
                    strong: ({children}) => <strong style={{ color:C.text, fontWeight:700 }}>{children}</strong>,
                    ul: ({children}) => <ul style={{ margin:'0 0 10px', paddingLeft:20, color:C.muted }}>{children}</ul>,
                    ol: ({children}) => <ol style={{ margin:'0 0 10px', paddingLeft:20, color:C.muted }}>{children}</ol>,
                    li: ({children}) => <li style={{ marginBottom:4 }}>{children}</li>,
                    code: ({children, className}) => {
                      const isBlock = !!className;
                      return isBlock
                        ? <pre  style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:6, padding:'10px 14px', overflowX:'auto', margin:'8px 0' }}>
                            <code style={{ fontFamily:'monospace', fontSize:'0.8rem', color:'#79c0ff' }}>{children}</code>
                          </pre>
                        : <code style={{ background:C.border, borderRadius:4, padding:'1px 5px', fontFamily:'monospace', fontSize:'0.8rem', color:'#79c0ff' }}>{children}</code>;
                    },
                    blockquote: ({children}) => (
                      <blockquote style={{ borderLeft:`3px solid ${C.green}`, paddingLeft:12, margin:'8px 0', color:C.muted, fontStyle:'italic' }}>{children}</blockquote>
                    ),
                  }}
                >
                  {explanation}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
