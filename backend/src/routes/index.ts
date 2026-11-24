import { Router } from 'express';
import healthRoutes from './health.routes.js';
import emailRoutes from './email.routes.js';
import senderRoutes from './sender.routes.js';
import slackRoutes from './slack.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/emails', emailRoutes);
router.use('/senders', senderRoutes);
router.use('/slack', slackRoutes);

export default router;
