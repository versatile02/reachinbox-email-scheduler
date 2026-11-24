import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

// Public auth endpoints
router.post('/login', authController.login);
router.post('/signup', authController.signup);
router.post('/demo', authController.demoLogin);

// Google OAuth
router.get('/google', authController.googleAuth);
router.get('/google/callback', authController.googleCallback);

// Protected endpoints
router.get('/me', requireAuth, authController.getCurrentUser);
router.post('/logout', requireAuth, authController.logout);

export default router;
