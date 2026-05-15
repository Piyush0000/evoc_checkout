import { Router } from 'express';
import {
  finalizeSession,
  getSessionSummary,
  handlePayUCallback,
  initSession,
} from '../controllers/checkout.controller.js';

const router: Router = Router();

router.post('/init', initSession);
router.get('/summary/:sessionId', getSessionSummary);
router.post('/finalize', finalizeSession);

// PayU Redirect Callbacks (POST for standard, GET for mobile/3DS fallbacks)
router.post('/payu/callback', handlePayUCallback);
router.get('/payu/callback', handlePayUCallback);

export default router;
