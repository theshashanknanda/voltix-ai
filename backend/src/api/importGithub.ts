import { Router, Request, Response } from 'express';
import path from 'path';

const router = Router();

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MAX_FILES = 100;

const SUPPORTED_EXTENSIONS = new Set([
  '.js', '.ts', '.tsx', '.jsx', '.json', '.md', '.html', '.css',
  '.yml', '.yaml', '.txt', '.svg', '.xml', '.csv', '.mdx',
  '.py', '.java', '.go', '.rb', '.rs', '.sh', '.toml', '.env',
  '.gitignore', '.dockerignore', '.dockerfile',
]);

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.js':   'javascript',
  '.ts':   'typescript',
  '.tsx':  'tsx',
  '.jsx':  'jsx',
  '.json': 'json',
  '.md':   'markdown',
  '.html': 'html',
  '.css':  'css',
  '.yml':  'yaml',
  '.yaml': 'yaml',
  '.txt':  'text',
  '.svg':  'xml',
  '.xml':  'xml',
  '.csv':  'text',
  '.mdx':  'markdown',
  '.py':   'python',
  '.java': 'java',
  '.go':   'go',
  '.rb':   'ruby',
  '.rs':   'rust',
  '.sh':   'shell',
  '.toml': 'toml',
  '.env':  'text',
  '.gitignore':     'text',
  '.dockerignore':  'text',
  '.dockerfile':    'dockerfile',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const getLanguage = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] ?? 'text';
};

const isSupportedFile = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext) || SUPPORTED_EXTENSIONS.has(`.${baseName}`);
};

const getGithubHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
};

const parseGithubRepoUrl = (rawUrl: string): { owner: string; repo: string } => {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid GitHub repository URL.');
  }

  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('Only GitHub repository URLs are supported.');
  }

  const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (segments.length < 2) {
    throw new Error('URL must include owner and repository name (e.g. github.com/owner/repo).');
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');

  if (!owner || !repo) {
    throw new Error('Could not parse owner/repo from the provided URL.');
  }

  return { owner, repo };
};

const encodeGithubPath = (filePath: string): string => {
  return filePath.split('/').map(encodeURIComponent).join('/');
};

/* ------------------------------------------------------------------ */
/*  Route                                                              */
/* ------------------------------------------------------------------ */

router.post('/import-github', async (req: Request, res: Response): Promise<void> => {
  const repoUrl = (req.body as { repoUrl?: string })?.repoUrl;

  if (!repoUrl || typeof repoUrl !== 'string') {
    res.status(400).json({ error: 'Missing "repoUrl" in request body.' });
    return;
  }

  /* ---- Parse URL ---- */
  let owner: string;
  let repo: string;

  try {
    ({ owner, repo } = parseGithubRepoUrl(repoUrl));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid repository URL.';
    res.status(400).json({ error: message });
    return;
  }

  try {
    const headers = getGithubHeaders();

    /* ---- Verify repo exists & is accessible ---- */
    const repoResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers },
    );

    if (repoResponse.status === 404) {
      res.status(404).json({
        error: 'Repository not found. If this is a private repository, it cannot be imported without a valid GitHub token.',
      });
      return;
    }

    if (repoResponse.status === 403) {
      const rateLimitRemaining = repoResponse.headers.get('x-ratelimit-remaining');
      if (rateLimitRemaining === '0') {
        const resetEpoch = repoResponse.headers.get('x-ratelimit-reset');
        const resetTime = resetEpoch
          ? new Date(Number(resetEpoch) * 1000).toLocaleTimeString()
          : 'a few minutes';
        res.status(429).json({
          error: `GitHub API rate limit exceeded. Please try again after ${resetTime}.`,
        });
        return;
      }
      res.status(403).json({
        error: 'Access denied. This repository may be private. Please provide a valid GitHub token to import private repos.',
      });
      return;
    }

    if (!repoResponse.ok) {
      res.status(400).json({ error: 'GitHub repository not found or inaccessible.' });
      return;
    }

    const repoData = await repoResponse.json();
    const defaultBranch =
      typeof repoData.default_branch === 'string' ? repoData.default_branch : 'main';

    /* ---- Fetch recursive tree ---- */
    const treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
      { headers },
    );

    if (treeResponse.status === 403) {
      const rateLimitRemaining = treeResponse.headers.get('x-ratelimit-remaining');
      if (rateLimitRemaining === '0') {
        const resetEpoch = treeResponse.headers.get('x-ratelimit-reset');
        const resetTime = resetEpoch
          ? new Date(Number(resetEpoch) * 1000).toLocaleTimeString()
          : 'a few minutes';
        res.status(429).json({
          error: `GitHub API rate limit exceeded. Please try again after ${resetTime}.`,
        });
        return;
      }
    }

    if (!treeResponse.ok) {
      res.status(400).json({ error: 'Could not fetch repository file tree from GitHub.' });
      return;
    }

    const treeData = await treeResponse.json();
    if (!Array.isArray(treeData.tree)) {
      res.status(400).json({ error: 'GitHub repository tree response was malformed.' });
      return;
    }

    /* ---- Filter to supported files ---- */
    const treeItems = treeData.tree as Array<{ path: string; type: string }>;
    const blobFiles = treeItems.filter(
      (item) => item.type === 'blob' && isSupportedFile(item.path),
    );

    const totalMatchingFiles = blobFiles.length;
    let truncated = false;
    const filesToFetch = blobFiles.slice(0, MAX_FILES);

    if (totalMatchingFiles > MAX_FILES) {
      truncated = true;
    }

    /* ---- Download file contents concurrently ---- */
    const files: Array<{ path: string; name: string; content: string; language: string }> = [];
    const workQueue = [...filesToFetch];
    const concurrency = 8;

    const worker = async (): Promise<void> => {
      while (workQueue.length > 0) {
        const item = workQueue.shift();
        if (!item) return;

        try {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(
            defaultBranch,
          )}/${encodeGithubPath(item.path)}`;
          const rawResponse = await fetch(rawUrl, { headers });

          if (rawResponse.status === 403) {
            const rl = rawResponse.headers.get('x-ratelimit-remaining');
            if (rl === '0') {
              // Stop fetching — we've hit the rate limit mid-download
              workQueue.length = 0;
              continue;
            }
          }

          if (!rawResponse.ok) continue;

          const contentType = rawResponse.headers?.get('content-type') ?? '';
          const wantsText =
            /^(text\/|application\/(json|javascript|xml|html|x-www-form-urlencoded|yaml|csv|.*\+xml|.*\+json))/i.test(
              contentType,
            );

          let content: string;
          let language = getLanguage(item.path);

          if (wantsText) {
            content = await rawResponse.text();
          } else {
            const buffer = Buffer.from(await rawResponse.arrayBuffer());
            content = buffer.toString('base64');
            language = 'binary';
          }

          files.push({
            path: item.path,
            name: path.basename(item.path),
            content,
            language,
          });
        } catch (err: unknown) {
          console.warn('[import-github] Skipping file:', item.path, err);
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    files.sort((a, b) => a.path.localeCompare(b.path));

    /* ---- Respond ---- */
    res.json({
      files,
      meta: {
        owner,
        repo,
        branch: defaultBranch,
        totalFiles: totalMatchingFiles,
        returnedFiles: files.length,
        truncated,
        ...(truncated && {
          warning: `Repository contains ${totalMatchingFiles} supported files. Only the first ${MAX_FILES} files were imported.`,
        }),
      },
    });
  } catch (err: unknown) {
    console.error('[import-github] Error', err);
    const message = err instanceof Error ? err.message : 'Repository import failed.';
    res.status(500).json({ error: `Repository import failed: ${message}` });
  }
});

export default router;
