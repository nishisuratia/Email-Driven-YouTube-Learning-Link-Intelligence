import express from 'express';
import authRoutes from './routes/auth';
import feedRoutes from './routes/feed';
import feedbackRoutes from './routes/feedback';
import { logger } from '../utils/logger';
import { config } from '../config';

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  res.locals.requestId = requestId;
  
  logger.child({ requestId }).info('Request received', {
    method: req.method,
    path: req.path,
  });
  
  next();
});

// Routes
app.use('/auth', authRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/feedback', feedbackRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
  });
  
  res.status(500).json({
    error: 'Internal server error',
    requestId: res.locals.requestId,
  });
});

// Start server
if (require.main === module) {
  const port = config.server.port;
  app.listen(port, () => {
    logger.info('API server started', { port });
  });
}

export default app;

