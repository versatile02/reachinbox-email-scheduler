import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { errorHandler } from './middleware/errorHandler.js';
import { config } from './config/index.js';

const app = express();

// Global Middlewares
app.use(cors({
  origin: config.clientUrl,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root route
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'ReachInbox Email Scheduler API',
    status: 'active',
    documentation: '/api/health',
  });
});

// API Routes
app.use('/api', routes);

// 404 & Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
