import { Router, Request, Response } from 'express';
import path from 'path';
import { prisma } from '../database/prismaClient';

const router = Router();

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.js': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.jsx': 'jsx',
  '.json': 'json',
  '.md': 'markdown',
  '.html': 'html',
  '.css': 'css',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.txt': 'text',
  '.svg': 'xml',
  '.xml': 'xml',
  '.csv': 'text',
  '.mdx': 'markdown',
};

const getLanguage = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] ?? 'text';
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
  } catch (err) {
    throw new Error('Invalid GitHub repository URL');
  }

  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('Only GitHub repository URLs are supported');
  }

  const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (segments.length < 2) {
    throw new Error('GitHub repository URL must include owner and repository name');
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');

  if (!owner || !repo) {
    throw new Error('Invalid GitHub repository URL');
  }

  return { owner, repo };
};

const encodeGithubPath = (filePath: string): string => {
  return filePath.split('/').map(encodeURIComponent).join('/');
};

router.post('/upload-repo', async (req: Request, res: Response): Promise<void> => {
  let url: string | undefined;
  const body = req.body as unknown;

  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      url = typeof parsed === 'object' && parsed !== null ? (parsed as { url?: string }).url : undefined;
    } catch {
      // Leave url undefined and fail below.
    }
  } else if (typeof body === 'object' && body !== null) {
    url = (body as { url?: string }).url;
  }

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing repository URL in request body.' });
    return;
  }

  let owner: string;
  let repo: string;

  try {
    ({ owner, repo } = parseGithubRepoUrl(url));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid repository URL';
    res.status(400).json({ error: message });
    return;
  }

  try {
    const headers = getGithubHeaders();
    const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (!repoResponse.ok) {
      res.status(400).json({ error: 'GitHub repository not found or inaccessible.' });
      return;
    }

    const repoData = await repoResponse.json();
    const defaultBranch = typeof repoData.default_branch === 'string' ? repoData.default_branch : 'main';

    const treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
      { headers },
    );

    if (!treeResponse.ok) {
      res.status(400).json({ error: 'Could not fetch repository file tree from GitHub.' });
      return;
    }

    const treeData = await treeResponse.json();
    if (!Array.isArray(treeData.tree)) {
      res.status(400).json({ error: 'GitHub repository tree response was malformed.' });
      return;
    }

    const treeItems = treeData.tree as Array<{ path: string; type: string }>;
    const blobFiles = treeItems.filter((item) => item.type === 'blob');

    const files: Array<{ path: string; name: string; content: string; language: string }> = [];
    const workQueue = [...blobFiles];
    const concurrency = 8;

    const worker = async (): Promise<void> => {
      while (workQueue.length > 0) {
        const item = workQueue.shift();
        if (!item) {
          return;
        }

        try {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(
            defaultBranch,
          )}/${encodeGithubPath(item.path)}`;
          const rawResponse = await fetch(rawUrl, { headers });

          if (!rawResponse.ok) {
            continue;
          }

          const contentType = rawResponse.headers?.get('content-type') ?? '';
          const wantsText = /^(text\/|application\/(json|javascript|xml|html|x-www-form-urlencoded|yaml|csv|.*\+xml|.*\+json))/i.test(
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
          console.warn('[upload-repo] Skipping file because content could not be fetched:', item.path, err);
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    files.sort((a, b) => a.path.localeCompare(b.path));

    const saved = await prisma.analysis.create({
      data: {
        repositoryUrl: url,
        explanation: `Imported ${files.length} file(s) from ${owner}/${repo}`,
        userId: req.user?.id || null,
      },
    });

    res.json({ analysisId: saved.id, files });
  } catch (err: unknown) {
    console.error('[upload-repo] Error', err);
    const message = err instanceof Error ? err.message : 'Repository import failed.';
    res.status(500).json({ error: `Repository import failed: ${message}` });
  }
});

export default router;
