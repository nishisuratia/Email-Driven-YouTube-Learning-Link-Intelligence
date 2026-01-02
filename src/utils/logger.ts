import winston from 'winston';
import { config } from '../config';

const { combine, timestamp, json, errors, colorize, printf } = winston.format;

// Custom format for development (pretty print)
const devFormat = printf(({ level, message, timestamp, requestId, jobId, ...metadata }) => {
  let log = `${timestamp} [${level}]: ${message}`;
  if (requestId) log += ` [req:${requestId}]`;
  if (jobId) log += ` [job:${jobId}]`;
  if (Object.keys(metadata).length > 0) {
    log += ` ${JSON.stringify(metadata)}`;
  }
  return log;
});

export const logger = winston.createLogger({
  level: config.logging.level,
  format: combine(
    errors({ stack: true }),
    timestamp(),
    config.server.env === 'development' 
      ? combine(colorize(), devFormat)
      : json()
  ),
  defaultMeta: {
    service: 'youtube-intelligence',
  },
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
});

// Helper to create child logger with context
export function createLogger(context: { requestId?: string; jobId?: string; userId?: string }) {
  return logger.child(context);
}

