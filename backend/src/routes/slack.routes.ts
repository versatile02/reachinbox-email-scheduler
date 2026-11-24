import { Router } from 'express';
import {
  getSlackStatus,
  configureSlackWebhook,
  initiateSlackOAuth,
  handleSlackCallback,
  disconnectSlack,
} from '../controllers/slack.controller.js';
import { optionalAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/status', optionalAuth, getSlackStatus);
router.post('/webhook', optionalAuth, configureSlackWebhook);
router.get('/oauth', optionalAuth, initiateSlackOAuth);
router.get('/callback', handleSlackCallback);
router.delete('/', optionalAuth, disconnectSlack);

export default router;
