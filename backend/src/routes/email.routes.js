import { Router } from 'express';
import { scheduleEmail, listEmails, getEmailById } from '../controllers/email.controller.js';

const router = Router();

// Schedule a new email
router.post('/schedule', scheduleEmail);

// List emails with pagination and status filtering
router.get('/', listEmails);

// Get a single email by UUID
router.get('/:id', getEmailById);

export default router;
