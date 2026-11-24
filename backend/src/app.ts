import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createBullBoard } from '@bull-board/api';
// @ts-ignore
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import routes from './routes/index.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requireQueueAdmin } from './middleware/auth.middleware.js';
import { config } from './config/index.js';
import { emailQueue } from './queues/email.queue.js';

const app = express();

// Global Middlewares
app.use(cors({
  origin: config.clientUrl,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Bull Board Live Queue Dashboard (/admin/queues)
const bullBoardAdapter = new ExpressAdapter();
bullBoardAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue) as any],
  serverAdapter: bullBoardAdapter,
});

app.use('/admin/queues', requireQueueAdmin, bullBoardAdapter.getRouter());

// Root route
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'ReachInbox Email Scheduler API',
    status: 'active',
    documentation: '/api/health',
    queueDashboard: '/admin/queues',
  });
});

// API Routes
app.use('/api', routes);

// 404 & Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
