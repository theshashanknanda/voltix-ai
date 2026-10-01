import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import path from 'path';
import requireAuth, { AuthenticatedRequest } from '../middleware/requireAuth';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.js') {
      cb(null, true);
    } else {
      cb(new Error('Only .js files are allowed'));
    }
  },
});

if (!process.env.GROQ_API_KEY) {
  throw new Error('GROQ_API_KEY is not set');
}

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const SAFE_AI_ERROR = 'AI error: Maintainability analysis failed.';

type Severity = 'low' | 'medium' | 'high';

type SmellCategory = 'long method' | 'deep nesting' | 'duplication' | 'magic values' | 'poor naming';

type Smell = {
  category: SmellCategory;
  severity: Severity;
  title: string;
  detail: string;
};

/**
 * POST /api/maintainability
 *
 * Request (same shapes as /api/explain):
 *   JSON { code: string, filename: string, language?: string }
 *   OR multipart field "file" (.js, max 1 MB)
 * Auth: Bearer JWT. Missing or invalid token → 401.
 *
 * Success 200:
 *   score: integer 0–100. The model chooses the number from readability,
 *     structure, duplication, complexity, naming, and code smells.
 *     This API only rounds and clamps it.
 *   summary: non-empty string. A clean file still gets a short summary.
 *   smells: {
 *     category: "long method" | "deep nesting" | "duplication" | "magic values" | "poor naming",
 *     severity: "low" | "medium" | "high",
 *     title: string,
 *     detail: string
 *   }[]
 *     Empty array is valid. Unknown categories, unknown severities, and blank
 *     title or detail are dropped.
 *
 * 400 when code is missing or blank.
 * 500 with { error: "AI error: Maintainability analysis failed." } when the
 * provider throws or the output cannot be parsed. The raw provider payload
 * is not returned to the client.
 */
const SEVERITY_ALIASES: Record<string, Severity> = {
  low: 'low',
  info: 'low',
  minor: 'low',
  medium: 'medium',
  warning: 'medium',
  moderate: 'medium',
  high: 'high',
  critical: 'high',
  error: 'high',
  severe: 'high',
};

const CATEGORY_ALIASES: Record<string, SmellCategory> = {
  'long method': 'long method',
  'god function': 'long method',
  'god method': 'long method',
  'deep nesting': 'deep nesting',
  nesting: 'deep nesting',
  'nested conditionals': 'deep nesting',
  duplication: 'duplication',
  duplicate: 'duplication',
  'duplicated code': 'duplication',
  'magic values': 'magic values',
  'magic value': 'magic values',
  'magic number': 'magic values',
  'magic numbers': 'magic values',
  'poor naming': 'poor naming',
  naming: 'poor naming',
  'bad naming': 'poor naming',
};

function categoryKey(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function clampScore(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function normalizeSmells(value: unknown): Smell[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const smells: Smell[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as { category?: unknown; severity?: unknown; title?: unknown; detail?: unknown };
    const category = CATEGORY_ALIASES[categoryKey(String(raw.category ?? ''))];
    const severity = SEVERITY_ALIASES[String(raw.severity ?? '').toLowerCase()];
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const detail = typeof raw.detail === 'string' ? raw.detail.trim() : '';
    if (!category || !severity || !title || !detail) continue;
    smells.push({ category, severity, title, detail });
  }
  return smells;
}

function parseModelOutput(raw: string): { score: number; summary: string; smells: Smell[] } | null {
  let parsed: unknown;
  try {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    parsed = JSON.parse(fenced ? fenced[1] : trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const body = parsed as { score?: unknown; summary?: unknown; smells?: unknown };
  const score = clampScore(body.score);
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  const smells = normalizeSmells(body.smells);
  if (score === null || !summary || smells === null) return null;
  return { score, summary, smells };
}

function failAi(res: Response, err?: unknown): void {
  console.error('[Maintainability Error]', err);
  res.status(500).json({ error: SAFE_AI_ERROR });
}

router.post('/maintainability', requireAuth, (req: AuthenticatedRequest, res: Response, next) => {
  if (req.is('application/json')) {
    return next();
  }
  upload.single('file')(req, res, next);
}, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  let code: string;
  let filename: string;
  let language: string;

  if (req.is('application/json') || req.body?.code) {
    code = req.body.code;
    filename = req.body.filename || 'unknown';
    language = req.body.language || 'text';

    if (!code || !code.trim()) {
      res.status(400).json({ error: 'Code content is empty.' });
      return;
    }
  } else {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded. Please upload a .js file.' });
      return;
    }
    code = req.file.buffer.toString('utf-8');
    filename = req.file.originalname;
    language = 'javascript';

    if (!code.trim()) {
      res.status(400).json({ error: 'Uploaded file is empty.' });
      return;
    }
  }

  const prompt = `You are a senior engineer scoring maintainability and naming code smells. Judge the code yourself and choose an integer score. Weigh readability, structure, duplication, complexity, naming, and obvious code smells. Return only one JSON object, no markdown, with this shape:
{"score": <integer 0-100>, "summary": "<one or two sentences>", "smells": [{"category": "long method"|"deep nesting"|"duplication"|"magic values"|"poor naming", "severity": "low"|"medium"|"high", "title": "<short label>", "detail": "<one or two sentences>"}]}
Use only those five categories. Use an empty smells array when the file is clean, and still write a short summary. Every smell needs a non-empty title and detail.

File: ${filename}
Code:
\`\`\`${language}
${code}
\`\`\``;

  try {
    const response = await client.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
      failAi(res, new Error('Empty model output'));
      return;
    }

    const parsed = parseModelOutput(raw);
    if (!parsed) {
      failAi(res, new Error('Unusable model output'));
      return;
    }

    res.json(parsed);
  } catch (err: unknown) {
    failAi(res, err);
  }
});

router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err.message === 'Only .js files are allowed') {
    res.status(400).json({ error: err.message });
  } else if (err instanceof multer.MulterError) {
    res.status(400).json({ error: `Upload error: ${err.message}` });
  } else {
    console.error('[Unhandled Error]', err);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
});

export default router;
