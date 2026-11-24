import dotenv from 'dotenv';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    username: process.env.REDIS_USERNAME ? process.env.REDIS_USERNAME.trim() || undefined : undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === 'true',
  },
  database: {
    url: process.env.DATABASE_URL || undefined,
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT, 10) || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || undefined,
    database: process.env.PGDATABASE || 'reachinbox_scheduler',
    ssl: process.env.DATABASE_SSL === 'true' || Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require')),
    max: parseInt(process.env.DATABASE_POOL_MAX, 10) || 20,
  },
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: process.env.EMAIL_FROM || 'ReachInbox Scheduler <scheduler@reachinbox.ai>',
  },
};
