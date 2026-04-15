import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

/* ---------- language map ---------- */
const EXT_MAP: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  json: 'json', md: 'markdown', html: 'html', css: 'css',
  scss: 'scss', py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', sh: 'bash', yml: 'yaml', yaml: 'yaml',
  xml: 'xml', sql: 'sql', graphql: 'graphql', c: 'c', cpp: 'cpp',
  cs: 'csharp', php: 'php', swift: 'swift', dart: 'dart',
  dockerfile: 'docker', makefile: 'makefile', toml: 'toml',
  env: 'bash', gitignore: 'bash', prisma: 'graphql',
};

export function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MAP[ext] || 'text';
}

/* ---------- props ---------- */
interface Props {
  filename: string;
  content: string;
  language?: string;
  onAnalyze?: () => void;
  analyzing?: boolean;
}

export default function CodeViewer({ filename, content, language, onAnalyze, analyzing }: Props) {
  const lang = language || detectLanguage(filename);
  const isEmpty = !content.trim();

  return (
    <div className="code-viewer">
      {/* header bar */}
      <div className="code-viewer-header">
        <div className="code-viewer-file-info">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="code-viewer-filename">{filename}</span>
          <span className="code-viewer-lang-badge">{lang}</span>
        </div>

        {onAnalyze && (
          <button
            id="analyze-ai-btn"
            className="btn btn-analyze"
            type="button"
            disabled={isEmpty || analyzing}
            onClick={onAnalyze}
          >
            {analyzing ? (
              <>
                <span className="spinner-sm" />
                Analyzing…
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
                Analyze with AI
              </>
            )}
          </button>
        )}
      </div>

      {/* code body */}
      <div className="code-viewer-body">
        {isEmpty ? (
          <div className="code-viewer-empty">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            <p>This file is empty</p>
          </div>
        ) : (
          <SyntaxHighlighter
            language={lang}
            style={oneDark}
            showLineNumbers
            wrapLongLines
            customStyle={{
              margin: 0,
              borderRadius: 0,
              background: 'transparent',
              fontSize: '0.82rem',
              lineHeight: '1.65',
            }}
          >
            {content}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
