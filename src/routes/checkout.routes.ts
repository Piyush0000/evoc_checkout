import { Router } from 'express';
import {
  finalizeSession,
  getSessionSummary,
  initSession,
} from '../controllers/checkout.controller.js';

const router: Router = Router();

router.post('/init', initSession);
router.get('/summary/:sessionId', getSessionSummary);
router.post('/finalize', finalizeSession);

export default router;
