import { Router } from 'express';
import { listSenders, createSender } from '../controllers/sender.controller.js';

const router = Router();

router.get('/', listSenders);
router.post('/', createSender);

export default router;
