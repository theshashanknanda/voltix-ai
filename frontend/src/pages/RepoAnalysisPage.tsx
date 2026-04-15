import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../auth/authContext';
import { API_BASE_URL } from '../config';

type Analysis = {
  id: string;
  repositoryUrl: string;
  explanation: string;
  createdAt: string;
};

type FileEntry = {
  path: string;
  type: 'blob' | 'tree' | string;
};

type TreeNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
};

const isGithubUrl = (value: string) => /^https?:\/\/github\.com\//i.test(value);

const buildTree = (paths: string[]): TreeNode[] => {
  const root: TreeNode = { name: '', path: '', type: 'folder', children: [] };

  for (const filePath of paths) {
    const parts = filePath.split('/').filter(Boolean);
    let current = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const existing = current.children?.find((child) => child.name === part);

      if (existing) {
        current = existing;
        return;
      }

      const nextNode: TreeNode = {
        name: part,
        path: current.path ? `${current.path}/${part}` : part,
        type: isFile ? 'file' : 'folder',
        children: isFile ? undefined : [],
      };

      current.children?.push(nextNode);
      current = nextNode;
    });
  }

  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => node.children && sortTree(node.children));
  };

  if (root.children) {
    sortTree(root.children);
  }

  return root.children || [];
};

const TreeView = ({ nodes }: { nodes: TreeNode[] }) => {
  if (nodes.length === 0) {
    return <p className="muted">No files available.</p>;
  }

  return (
    <ul className="tree">
      {nodes.map((node) => (
        <li key={node.path}>
          <span className={`tree-item ${node.type}`}>{node.name}</span>
          {node.children && node.children.length > 0 && <TreeView nodes={node.children} />}
        </li>
      ))}
    </ul>
  );
};

export default function RepoAnalysisPage() {
  const { id } = useParams();
  const { token, logout, email } = useAuth();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filesError, setFilesError] = useState('');

  useEffect(() => {
    const fetchAnalysis = async () => {
      if (!id) return;
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE_URL}/api/analyses/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load analysis');
        setAnalysis(data.analysis as Analysis);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load analysis');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalysis();
  }, [id, token]);

  useEffect(() => {
    const fetchFiles = async () => {
      if (!analysis?.repositoryUrl || !isGithubUrl(analysis.repositoryUrl)) {
        return;
      }

      setFilesError('');
      try {
        const res = await fetch(`${API_BASE_URL}/api/analyses/${analysis.id}/files`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load file tree');
        setFiles(Array.isArray(data.files) ? data.files : []);
      } catch (err: unknown) {
        setFilesError(err instanceof Error ? err.message : 'Failed to load file tree');
      }
    };

    fetchFiles();
  }, [analysis, token]);

  const tree = useMemo(() => buildTree(files.map((file) => file.path)), [files]);

  if (loading) {
    return (
      <div className="page">
        <header className="nav">
          <div className="logo">
            <span className="logo-badge" />
            <Link to="/dashboard">Voltix AI</Link>
          </div>
        </header>
        <main className="container">
          <p className="muted">Loading analysis...</p>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <header className="nav">
          <div className="logo">
            <span className="logo-badge" />
            <Link to="/dashboard">Voltix AI</Link>
          </div>
        </header>
        <main className="container">
          <p className="error-banner">{error}</p>
          <Link className="btn btn-ghost" to="/dashboard">Back to dashboard</Link>
        </main>
      </div>
    );
  }

  if (!analysis) {
    return null;
  }

  return (
    <div className="page dashboard-page">
      <header className="nav">
        <div className="logo">
          <span className="logo-badge" />
          <Link to="/dashboard">Voltix AI</Link>
        </div>
        <div className="nav-actions">
          <Link className="btn btn-ghost" to="/">Landing</Link>
          <Link className="btn btn-ghost" to="/dashboard">Dashboard</Link>
          <span className="pill">Signed in as {email || 'user'}</span>
          <button className="btn btn-ghost" type="button" onClick={logout}>Logout</button>
        </div>
      </header>

      <main className="container">
        <div className="breadcrumb">Dashboard <span>&gt;</span> Repository Analysis</div>

        <section className="workspace-grid">
          <div className="card">
            <h2>Repository</h2>
            <p className="muted">{analysis.repositoryUrl}</p>
            <div className="status-list">
              <p className="muted">Created {new Date(analysis.createdAt).toLocaleString()}</p>
            </div>
            <h3 className="section-title">File Tree</h3>
            {filesError && <div className="error-banner">{filesError}</div>}
            {!filesError && !isGithubUrl(analysis.repositoryUrl) && (
              <p className="muted">File tree is only available for GitHub repository imports.</p>
            )}
            {!filesError && isGithubUrl(analysis.repositoryUrl) && (
              <div className="file-tree">
                <TreeView nodes={tree} />
              </div>
            )}
          </div>

          <div className="card output-card">
            <h2>Saved Analysis</h2>
            <div className="markdown">
              <ReactMarkdown>{analysis.explanation}</ReactMarkdown>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
