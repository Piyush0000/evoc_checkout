import { Router } from 'express';
import { updateProfile } from '../controllers/user.controller.js';

const router: Router = Router();

router.post('/profile', updateProfile);

export default router;
