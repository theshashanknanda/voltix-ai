import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import path from 'path';

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
 * Returns: { explanation: string }
 */
router.post('/explain', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded. Please upload a .js file.' });
    return;
  }

  const code = req.file.buffer.toString('utf-8');

  if (!code.trim()) {
    res.status(400).json({ error: 'Uploaded file is empty.' });
    return;
  }

  const prompt = `You are a senior JavaScript developer. Explain the following JavaScript code clearly and concisely.
Break your explanation into:
1. **Overview** – what the code does at a high level
2. **Key Functions / Logic** – walk through the important parts
3. **Potential Issues** – any bugs or improvements you notice

Code:
\`\`\`javascript
${code}
\`\`\``;

  try {
    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
    });

    const explanation = response.choices[0]?.message?.content ?? 'No explanation returned.';
    res.json({ explanation });
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
