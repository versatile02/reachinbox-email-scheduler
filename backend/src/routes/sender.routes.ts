import { Router } from 'express';
import { listSenders, createSender } from '../controllers/sender.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/', requireAuth, listSenders);
router.post('/', requireAuth, createSender);

export default router;
