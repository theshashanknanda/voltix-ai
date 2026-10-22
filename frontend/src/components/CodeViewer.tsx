import { memo, useEffect, useMemo, useDeferredValue, useRef, useState } from 'react';
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

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MAP[ext] || 'text';
}

// ponytail: regex line scan, not a parser. It misses e.g. TS class methods without a
// modifier and multi-line signatures; users can type any name the scan misses.
const FUNCTION_PATTERNS = [
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/g,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/gm,
  /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)+(?:[\w<>[\],.?]+\s+)?([A-Za-z_]\w*)\s*\(/gm,
];

function findFunctionNames(content: string): string[] {
  const names = new Set<string>();
  for (const pattern of FUNCTION_PATTERNS) {
    for (const match of content.matchAll(pattern)) names.add(match[1]);
  }
  return [...names];
}

/* ---------- props ---------- */
interface Props {
  filename: string;
  content: string;
  language?: string;
  onAnalyze?: () => void;
  analyzing?: boolean;
  onReview?: () => void;
  reviewing?: boolean;
  onDocument?: () => void;
  documenting?: boolean;
  onExplainFunction?: (name: string) => void;
  onExplainContext?: () => void;
  busy?: boolean;
  highlight?: { start: number; end: number } | null;
}

const CodeViewer = memo(function CodeViewer({
  filename, content, language, onAnalyze, analyzing, onReview, reviewing,
  onDocument, documenting, onExplainFunction, onExplainContext, busy, highlight,
}: Props) {
  const lang = useMemo(() => language || detectLanguage(filename), [filename, language]);
  const functionNames = useMemo(() => (onExplainFunction ? findFunctionNames(content) : []), [content, onExplainFunction]);
  const [functionName, setFunctionName] = useState('');
  const deferredContent = useDeferredValue(content);
  const isStale = deferredContent !== content;
  
  const isEmpty = !content.trim();
  const isLargeFile = content.length > 30000;
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlight && !isStale) bodyRef.current?.querySelector('.code-line-highlight')?.scrollIntoView({ block: 'center' });
  }, [highlight, isStale]);

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

        {(onAnalyze || onReview || onDocument || onExplainContext) && (
          <div className="code-viewer-actions">
            {onExplainContext && (
              <button
                id="explain-context-btn"
                className="btn btn-analyze"
                type="button"
                disabled={isEmpty || busy}
                onClick={onExplainContext}
              >
                Explain with context
              </button>
            )}
            {onDocument && (
              <button
                id="document-btn"
                className="btn btn-analyze"
                type="button"
                disabled={isEmpty || busy}
                onClick={onDocument}
              >
                {documenting ? (
                  <>
                    <span className="spinner-sm" />
                    Documenting…
                  </>
                ) : (
                  'Document'
                )}
              </button>
            )}
            {onReview && (
              <button
                id="maintainability-btn"
                className="btn btn-analyze"
                type="button"
                disabled={isEmpty || reviewing || busy}
                onClick={onReview}
              >
                {reviewing ? (
                  <>
                    <span className="spinner-sm" />
                    Reviewing…
                  </>
                ) : (
                  'Code review'
                )}
              </button>
            )}
            {onAnalyze && (
              <button
                id="analyze-ai-btn"
                className="btn btn-analyze"
                type="button"
                disabled={isEmpty || analyzing || busy}
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
        )}
      </div>

      {onExplainFunction && !isEmpty && (
        <form
          className="code-viewer-function-bar"
          onSubmit={e => {
            e.preventDefault();
            if (functionName.trim()) onExplainFunction(functionName.trim());
          }}
        >
          <label htmlFor="function-name-input" className="muted">Function</label>
          <input
            id="function-name-input"
            className="input"
            list="function-name-options"
            placeholder={functionNames.length ? 'Pick or type a function name' : 'Type a function name'}
            value={functionName}
            onChange={e => setFunctionName(e.target.value)}
          />
          <datalist id="function-name-options">
            {functionNames.map(name => <option key={name} value={name} />)}
          </datalist>
          <button
            id="explain-function-btn"
            className="btn btn-analyze"
            type="submit"
            disabled={!functionName.trim() || busy}
          >
            Explain function
          </button>
        </form>
      )}

      {/* code body */}
      <div ref={bodyRef} className={`code-viewer-body ${isStale ? 'stale' : ''}`}>
        {isEmpty ? (
          <div className="code-viewer-empty">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            <p>This file is empty</p>
          </div>
        ) : isStale ? (
          <pre className="code-viewer-stale-preview">
            <code>{content}</code>
          </pre>
        ) : (
          <SyntaxHighlighter
            language={lang}
            style={oneDark}
            showLineNumbers={!isLargeFile}
            wrapLongLines={!isLargeFile}
            wrapLines={!isLargeFile || !!highlight}
            lineProps={n => ({
              className: highlight && n >= highlight.start && n <= highlight.end ? 'code-line-highlight' : undefined,
            })}
            customStyle={{
              margin: 0,
              borderRadius: 0,
              background: 'transparent',
              fontSize: '0.82rem',
              lineHeight: '1.65',
              overflow: 'visible',
            }}
          >
            {deferredContent}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
});

export default CodeViewer;
