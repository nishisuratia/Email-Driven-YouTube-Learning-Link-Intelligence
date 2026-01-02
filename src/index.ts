import app from './api';
import { logger } from './utils/logger';
import { config } from './config';

// Start API server
const port = config.server.port;
app.listen(port, () => {
  logger.info('Server started', { port, env: config.server.env });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

