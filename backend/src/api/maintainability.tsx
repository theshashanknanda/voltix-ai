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

type Finding = {
  severity: Severity;
  message: string;
};

/**
 * POST /api/maintainability
 *
 * Request (same shapes as /api/explain):
 *   JSON { code: string, filename: string, language?: string }
 *   OR multipart field "file" (.js, max 1 MB)
 * Auth: Bearer JWT. Missing or invalid token → 401.
 *
 * Success 200 (US-S3 can persist these fields as-is):
 *   score: integer 0–100. The model chooses the number from readability,
 *     structure, duplication, complexity, naming, and code smells.
 *     This API only rounds and clamps it.
 *   summary: non-empty string
 *   review: { severity: "low" | "medium" | "high", message: string }[]
 *     Empty array is valid. Unknown severities and blank messages are dropped.
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

function clampScore(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function normalizeReview(value: unknown): Finding[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const findings: Finding[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as { severity?: unknown; message?: unknown };
    const severity = SEVERITY_ALIASES[String(raw.severity ?? '').toLowerCase()];
    const message = typeof raw.message === 'string' ? raw.message.trim() : '';
    if (!severity || !message) continue;
    findings.push({ severity, message });
  }
  return findings;
}

function parseModelOutput(raw: string): { score: number; summary: string; review: Finding[] } | null {
  let parsed: unknown;
  try {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    parsed = JSON.parse(fenced ? fenced[1] : trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const body = parsed as { score?: unknown; summary?: unknown; review?: unknown };
  const score = clampScore(body.score);
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  const review = normalizeReview(body.review);
  if (score === null || !summary || review === null) return null;
  return { score, summary, review };
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

  const prompt = `You are a senior engineer scoring maintainability. Judge the code yourself and choose an integer score. Weigh readability, structure, duplication, complexity, naming, and obvious code smells. Return only one JSON object, no markdown, with this shape:
{"score": <integer 0-100>, "summary": "<one or two sentences>", "review": [{"severity": "low"|"medium"|"high", "message": "<finding>"}]}
Use an empty review array when the file is clean. Every finding needs a non-empty message.

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
