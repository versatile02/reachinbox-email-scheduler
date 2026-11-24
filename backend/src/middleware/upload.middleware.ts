import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Store attachments deterministically inside backend/uploads/attachments
export const ATTACHMENTS_DIR = fileURLToPath(new URL('../../uploads/attachments', import.meta.url));

if (!fs.existsSync(ATTACHMENTS_DIR)) {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
}

// Strictly forbidden executable or script extensions
const FORBIDDEN_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.bash', '.vbs', '.js', '.mjs', '.cjs',
  '.scr', '.msi', '.com', '.pif', '.jar', '.ps1', '.hta'
]);

// Permitted MIME types
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, ATTACHMENTS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Unique UUID prevents collisions and path traversal
    const safeFilename = `${crypto.randomUUID()}${ext}`;
    cb(null, safeFilename);
  },
});

export const attachmentUpload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit per file
    files: 5,                   // Maximum 5 files per email
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    if (FORBIDDEN_EXTENSIONS.has(ext)) {
      return cb(new Error(`Files with extension '${ext}' are not permitted for security reasons.`));
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      const allowedExts = ['.png', '.jpg', '.jpeg', '.pdf', '.txt', '.csv', '.docx', '.xlsx', '.zip'];
      if (!allowedExts.includes(ext)) {
        return cb(new Error(`Unsupported file type '${file.mimetype}'. Allowed: images, PDF, documents, text.`));
      }
    }

    cb(null, true);
  },
});
