import { Router } from 'express';
import healthRoutes from './health.routes.js';
import emailRoutes from './email.routes.js';

const router = Router();

// Mount routes
router.use('/health', healthRoutes);
router.use('/emails', emailRoutes);

export default router;
