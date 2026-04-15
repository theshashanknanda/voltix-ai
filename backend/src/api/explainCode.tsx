import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import path from 'path';
import requireAuth, { AuthenticatedRequest } from '../middleware/requireAuth';
import { prisma } from '../database/prismaClient';

const router = Router();

// Store file in memory — no disk I/O needed
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 }, // 1 MB max
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

// Groq uses an OpenAI-compatible API
const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

/**
 * POST /api/explain
 * Body: multipart/form-data with field "file" containing a .js file
 *   OR  JSON body: { code: string, filename: string, language?: string }
 * Returns: { explanation: string, analysisId: string }
 */
router.post('/explain', requireAuth, (req: AuthenticatedRequest, res: Response, next) => {
  // If the request is JSON (from code viewer), skip multer
  if (req.is('application/json')) {
    return next();
  }
  // Otherwise, handle as file upload
  upload.single('file')(req, res, next);
}, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  let code: string;
  let filename: string;
  let language: string;

  if (req.is('application/json') || req.body?.code) {
    // JSON body path (from code viewer)
    code = req.body.code;
    filename = req.body.filename || 'unknown';
    language = req.body.language || 'text';

    if (!code || !code.trim()) {
      res.status(400).json({ error: 'Code content is empty.' });
      return;
    }
  } else {
    // File upload path (original)
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

  const prompt = `You are a senior software developer. Explain the following ${language} code clearly and concisely.
Break your explanation into:
1. **Overview** – what the code does at a high level
2. **Key Functions / Logic** – walk through the important parts
3. **Potential Issues** – any bugs or improvements you notice

File: ${filename}
Code:
\`\`\`${language}
${code}
\`\`\``;

  try {
    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
    });

    const explanation = response.choices[0]?.message?.content ?? 'No explanation returned.';

    // Persist to database 
    const saved = await prisma.analysis.create({
      data: {
        repositoryUrl: filename,
        explanation,
        userId: req.user?.id || null,
      },
    });

    res.json({ explanation, analysisId: saved.id });
  } catch (err: unknown) {
    console.error('[Grok Error]', err);
    const message = err instanceof Error ? err.message : 'Grok API call failed';
    res.status(500).json({ error: `AI error: ${message}` });
  }
});


// Multer / file-type error handler
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
