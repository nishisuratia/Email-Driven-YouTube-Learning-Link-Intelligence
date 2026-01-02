import { Queue, Worker, QueueOptions } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

// Redis connection for BullMQ
export const redisConnection = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null, // Required for BullMQ
});

// Queue names
export const QUEUE_NAMES = {
  EMAIL_PROCESS: 'email.process',
  VIDEO_ENRICH: 'video.enrich',
  RANKING_COMPUTE: 'ranking.compute',
  DIGEST_GENERATE: 'digest.generate',
} as const;

// Queue options
const defaultQueueOptions: QueueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24 hours
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  },
};

// Create queues
export const emailProcessQueue = new Queue(QUEUE_NAMES.EMAIL_PROCESS, defaultQueueOptions);
export const videoEnrichQueue = new Queue(QUEUE_NAMES.VIDEO_ENRICH, {
  ...defaultQueueOptions,
  defaultJobOptions: {
    ...defaultQueueOptions.defaultJobOptions,
    // Rate limit: 10 requests per second for YouTube API
    rateLimiter: {
      max: 10,
      duration: 1000,
    },
  },
});
export const rankingComputeQueue = new Queue(QUEUE_NAMES.RANKING_COMPUTE, defaultQueueOptions);
export const digestGenerateQueue = new Queue(QUEUE_NAMES.DIGEST_GENERATE, defaultQueueOptions);

// Job data types
export interface EmailProcessJobData {
  userId: string;
  messageId: string;
  threadId: string;
  metadata: {
    senderEmail: string;
    senderName?: string;
    subject?: string;
    receivedAt: string;
    snippet: string;
    labels: string[];
  };
}

export interface VideoEnrichJobData {
  userId: string;
  linkId: string;
  videoId: string;
}

export interface RankingComputeJobData {
  userId: string;
  dateRange?: {
    start: string;
    end: string;
  };
}

export interface DigestGenerateJobData {
  userId: string;
  type: 'daily' | 'weekly';
  date: string;
}

// Helper to create workers
export function createWorker<T>(
  queueName: string,
  processor: (job: { data: T }) => Promise<void>,
  options?: { concurrency?: number }
): Worker<T> {
  const worker = new Worker<T>(
    queueName,
    async (job) => {
      const jobLogger = logger.child({ jobId: job.id });
      jobLogger.info('Processing job', { queueName, data: job.data });
      
      try {
        await processor(job);
        jobLogger.info('Job completed', { queueName, jobId: job.id });
      } catch (error) {
        jobLogger.error('Job failed', {
          queueName,
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: options?.concurrency || 1,
    }
  );

  worker.on('completed', (job) => {
    logger.info('Worker job completed', { queueName, jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    logger.error('Worker job failed', {
      queueName,
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}

