import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import explainRouter from './api/explainCode';
import maintainabilityRouter from './api/maintainability';
import authRouter from './api/auth';
import uploadRepoRouter from './api/uploadRepo';
import uploadZipRouter from './api/uploadZip';
import analysesRouter from './api/analyses';

const app = express();
const port = process.env.PORT || 5001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Routes
app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Voltix-ai Backend is running!' });
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api', explainRouter);
app.use('/api', maintainabilityRouter);
app.use('/api', uploadRepoRouter);
app.use('/api', uploadZipRouter);
app.use('/api', analysesRouter);

// For local development and testing
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
}

export default app;
