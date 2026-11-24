/**
 * Controller to handle server health checks
 */
export const getHealthStatus = (req, res) => {
  const healthData = {
    status: 'ok',
    message: 'ReachInbox Email Scheduler Backend is running',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
  };

  return res.status(200).json(healthData);
};
