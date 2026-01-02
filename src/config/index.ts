import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Database
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'youtube_intelligence',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },

  // Gmail OAuth
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
    redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/auth/callback',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },

  // YouTube API
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY || '',
    quotaUnitsPerDay: 10000,
    batchSize: 50, // Videos per API request
  },

  // Encryption
  encryption: {
    key: process.env.ENCRYPTION_KEY || '',
    algorithm: 'aes-256-gcm',
  },

  // Server
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // Ranking
  ranking: {
    watchNowThreshold: 0.7,
    saveThreshold: 0.4,
    freshnessHalfLifeDays: 30,
    featureWeights: {
      senderScore: 0.3,
      threadScore: 0.2,
      freshnessScore: 0.2,
      topicMatchScore: 0.2,
      noisePenalty: 0.1,
    },
  },

  // Rate Limiting
  rateLimits: {
    gmail: {
      quotaUnitsPerSecond: 250,
    },
    youtube: {
      quotaUnitsPerDay: 10000,
      requestsPerSecond: 10,
    },
  },

  // Circuit Breaker
  circuitBreaker: {
    failureThreshold: 3,
    resetTimeout: 60000, // 1 minute
  },
};

