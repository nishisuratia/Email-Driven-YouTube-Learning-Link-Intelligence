import { createWorker } from '../queue';
import {
  EmailProcessJobData,
  VideoEnrichJobData,
  RankingComputeJobData,
  QUEUE_NAMES,
} from '../queue';
import { processEmailJob } from './email-processor.worker';
import { enrichVideoJob } from './video-enrichment.worker';
import { computeRankingJob } from './ranking.worker';
import { logger } from '../utils/logger';

// Create workers
const emailProcessorWorker = createWorker<EmailProcessJobData>(
  QUEUE_NAMES.EMAIL_PROCESS,
  async (job) => {
    await processEmailJob(job.data);
  },
  { concurrency: 5 }
);

const videoEnrichmentWorker = createWorker<VideoEnrichJobData>(
  QUEUE_NAMES.VIDEO_ENRICH,
  async (job) => {
    await enrichVideoJob(job.data);
  },
  { concurrency: 3 } // Lower concurrency due to rate limits
);

const rankingWorker = createWorker<RankingComputeJobData>(
  QUEUE_NAMES.RANKING_COMPUTE,
  async (job) => {
    await computeRankingJob(job.data);
  },
  { concurrency: 1 } // Sequential ranking to avoid conflicts
);

logger.info('Workers started', {
  emailProcessor: QUEUE_NAMES.EMAIL_PROCESS,
  videoEnrichment: QUEUE_NAMES.VIDEO_ENRICH,
  ranking: QUEUE_NAMES.RANKING_COMPUTE,
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down workers...');
  await emailProcessorWorker.close();
  await videoEnrichmentWorker.close();
  await rankingWorker.close();
  process.exit(0);
});

