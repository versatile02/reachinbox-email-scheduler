import { Router } from 'express';
import { getSlackStatus, configureSlackWebhook, disconnectSlack } from '../controllers/slack.controller.js';

const router = Router();

router.get('/status', getSlackStatus);
router.post('/webhook', configureSlackWebhook);
router.delete('/', disconnectSlack);

export default router;
