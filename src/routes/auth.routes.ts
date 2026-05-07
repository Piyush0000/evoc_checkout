import { Router } from 'express';
import { sendOtp, verifyOtp } from '../controllers/auth.controller.js';

const router: Router = Router();

router.post('/otp/send', sendOtp);
router.post('/otp/verify', verifyOtp);

export default router;
