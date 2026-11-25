import { Router } from 'express';
import {
  scheduleEmail,
  scheduleBulkEmails,
  searchEmails,
  reindexEmails,
  listEmails,
  getEmailById,
  deleteEmailById,
  downloadAttachment,
  previewEmailHtml,
} from '../controllers/email.controller.js';
import { optionalAuth } from '../middleware/auth.middleware.js';
import { attachmentUpload } from '../middleware/upload.middleware.js';

const router = Router();

// Search emails (full-text search)
router.get('/search', optionalAuth, searchEmails);

// Bulk schedule
router.post('/bulk', optionalAuth, scheduleBulkEmails);

// Reindex in Elasticsearch
router.post('/reindex', optionalAuth, reindexEmails);

// Schedule a new email (supports multipart/form-data with file attachments up to 5 files, 10MB each)
router.post('/schedule', optionalAuth, attachmentUpload.array('attachments', 5), scheduleEmail);

// Download attachment
router.get('/:id/attachments/:attachmentId', optionalAuth, downloadAttachment);

// Standalone webmail preview
router.get('/:id/preview', optionalAuth, previewEmailHtml);

// List emails with pagination and status/sender filtering
router.get('/', optionalAuth, listEmails);

// Get a single email by UUID
router.get('/:id', optionalAuth, getEmailById);

// Delete an email by UUID
router.delete('/:id', optionalAuth, deleteEmailById);

export default router;
