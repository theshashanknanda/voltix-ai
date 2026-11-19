import { Router } from 'express';
import requireAuth, { AuthenticatedRequest } from '../middleware/requireAuth';

const router = Router();
router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});
// Old credentials cannot mint a second kind of accepted token.
router.post(['/login', '/register'], (_req, res) => {
  res.status(410).json({ error: 'Email and password sign-in has been replaced. Continue with Google or GitHub.' });
});
export default router;
