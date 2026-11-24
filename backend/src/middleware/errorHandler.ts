import type { Request, Response, NextFunction } from 'express';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
  console.error('Unhandled Server Error:', err?.message || err);

  const statusCode = err?.status || err?.statusCode || 500;
  res.status(statusCode).json({
    error: err?.name || 'InternalServerError',
    message: err?.message || 'An unexpected error occurred.',
    ...(process.env.NODE_ENV === 'development' && { stack: err?.stack }),
  });
};

export default errorHandler;
