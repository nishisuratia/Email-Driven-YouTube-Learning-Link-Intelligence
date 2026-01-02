# Cross-Signal YouTube Content Intelligence System - Architecture

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           External Services                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Gmail API (OAuth2)          YouTube Data API v3                            │
└────────────┬──────────────────────────┬──────────────────────────────────────┘
             │                          │
             │                          │
┌────────────▼──────────────────────────▼──────────────────────────────────────┐
│                         API Gateway / Load Balancer                          │
└────────────┬─────────────────────────────────────────────────────────────────┘
             │
             │
┌────────────▼─────────────────────────────────────────────────────────────────┐
│                          Application Layer                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│  │  OAuth Service   │  │  Dashboard API   │  │  Feedback API    │         │
│  │  (Gmail Auth)    │  │  (Express)       │  │  (Express)       │         │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘         │
│           │                     │                      │                    │
│           └─────────────────────┼──────────────────────┘                    │
│                                 │                                            │
│  ┌──────────────────────────────▼──────────────────────────────────────┐   │
│  │                    Gmail Ingestion Service                           │   │
│  │  - OAuth flow                                                        │   │
│  │  - Incremental sync (historyId)                                     │   │
│  │  - Message metadata extraction                                       │   │
│  │  - URL extraction & canonicalization                                 │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                            │
│                                 │ (enqueue)                                  │
│                                 ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Job Queue (BullMQ + Redis)                       │   │
│  │  - email.process (priority queue)                                    │   │
│  │  - video.enrich (rate-limited)                                      │   │
│  │  - ranking.compute (scheduled)                                       │   │
│  │  - digest.generate (scheduled daily)                                │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                            │
│  ┌──────────────────────────────▼──────────────────────────────────────┐   │
│  │                    Worker Pool                                       │   │
│  │  - EmailProcessorWorker                                             │   │
│  │  - VideoEnrichmentWorker                                            │   │
│  │  - RankingWorker                                                    │   │
│  │  - DigestGeneratorWorker                                            │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                            │
└─────────────────────────────────┼────────────────────────────────────────────┘
                                  │
                                  │
┌─────────────────────────────────▼────────────────────────────────────────────┐
│                         Data & Processing Layer                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Feature Extraction Service                        │   │
│  │  - SenderScore (frequency, recency, contacts)                      │   │
│  │  - ThreadSignal (thread activity)                                  │   │
│  │  - Freshness (time decay)                                          │   │
│  │  - TopicMatch (keyword matching, future: embeddings)               │   │
│  │  - NoisePenalty (bulk sender detection)                            │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                            │
│  ┌──────────────────────────────▼──────────────────────────────────────┐   │
│  │                    Ranking Service                                  │   │
│  │  - Score computation (weighted features)                            │   │
│  │  - Classification (Watch Now / Save / Skip)                         │   │
│  │  - Explanation generation                                           │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                            │
│  ┌──────────────────────────────▼──────────────────────────────────────┐   │
│  │                    YouTube Metadata Service                          │   │
│  │  - API client with rate limiting                                    │   │
│  │  - Circuit breaker                                                  │   │
│  │  - Exponential backoff                                              │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                            │
└─────────────────────────────────┼────────────────────────────────────────────┘
                                  │
                                  │
┌─────────────────────────────────▼────────────────────────────────────────────┐
│                            Storage Layer                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌──────────────────────────────────┐  ┌─────────────────────────────────┐│
│  │      PostgreSQL (Primary DB)      │  │      Redis (Cache + Queue)       ││
│  ├──────────────────────────────────┤  ├─────────────────────────────────┤│
│  │  - users                         │  │  - BullMQ queues                ││
│  │  - emails                        │  │  - Video metadata cache (TTL)   ││
│  │  - youtube_links                 │  │  - Rate limit counters          ││
│  │  - video_metadata                │  │  - Circuit breaker state        ││
│  │  - rankings                      │  │                                 ││
│  │  - feedback                      │  │                                 ││
│  │  - job_tracking                  │  │                                 ││
│  │  - user_preferences              │  │                                 ││
│  └──────────────────────────────────┘  └─────────────────────────────────┘│
│                                                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │
┌─────────────────────────────────▼────────────────────────────────────────────┐
│                         Observability Layer                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  - Structured logging (winston/pino) with requestId/jobId                    │
│  - Metrics (Prometheus-compatible counters/gauges)                           │
│  - Distributed tracing (optional: OpenTelemetry)                             │
│  - Health checks (/health, /ready)                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │
┌─────────────────────────────────▼────────────────────────────────────────────┐
│                         Evaluation & Feedback                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  - Offline replay evaluation harness                                         │
│  - Precision@k metrics                                                       │
│  - Coverage, novelty, stability metrics                                       │
│  - User feedback collection (watch/save/skip)                                │
│  - Label generation for ML training                                          │
└─────────────────────────────────────────────────────────────────────────────┘

```

## Component Interactions

### 1. Gmail Ingestion Flow
```
User → OAuth → Gmail API → Ingestion Service → Extract URLs → Enqueue (email.process)
```

### 2. Video Enrichment Flow
```
email.process → Extract videoIds → Enqueue (video.enrich) → YouTube API → Cache → Store
```

### 3. Ranking Flow
```
Scheduled/Cron → Fetch recent links → Feature Extraction → Ranking → Classification → Store
```

### 4. Digest Generation Flow
```
Daily Cron → Fetch rankings → Generate HTML/Email → Deliver
```

## Key Design Decisions & Tradeoffs

### Privacy vs Personalization
- **Tradeoff**: Storing full email bodies enables better context understanding but violates privacy constraints
- **Decision**: Store only metadata (sender, date, subject, labels, threadId) + minimal snippet (first 200 chars)
- **Future**: Allow opt-in full body storage for power users

### Freshness vs Relevance
- **Tradeoff**: Recent videos may be less relevant than older high-quality content
- **Decision**: Use time decay function that balances recency with other signals (sender importance, topic match)
- **Tunable**: Decay half-life parameter (default: 30 days)

### Heuristic vs ML
- **Phase 1**: Weighted linear combination of features (heuristics)
- **Phase 2**: Gradient boosting (XGBoost/LightGBM) with feature store
- **Phase 3**: Deep learning (neural ranking) if data volume justifies
- **Tradeoff**: Heuristics are interpretable and fast; ML improves accuracy but requires labels and infrastructure

### Cost vs Quality
- **YouTube API**: 10,000 units/day free tier; video.list = 1 unit
- **Strategy**: Aggressive caching (Redis TTL: 7 days), batch requests, circuit breaker
- **Tradeoff**: Stale metadata vs API costs; acceptable for portfolio project

### Idempotency Strategy
- **Gmail messages**: Track by `messageId` + `userId`; skip if already processed
- **YouTube videos**: Track by canonical `videoId`; deduplicate across emails
- **Jobs**: Use BullMQ job IDs; idempotent handlers

### Rate Limiting & Circuit Breaker
- **Gmail API**: 250 quota units/user/sec; exponential backoff on 429
- **YouTube API**: 10k units/day; batch requests; circuit breaker opens after 3 consecutive failures
- **Redis**: Connection pooling; retry with backoff

## Scalability Considerations

- **Horizontal scaling**: Stateless workers; scale worker pool independently
- **Database**: Read replicas for dashboard queries; connection pooling
- **Caching**: Redis cluster for high availability (future)
- **Queue**: BullMQ supports Redis cluster; priority queues for urgent processing

## Security & Privacy

- **OAuth tokens**: Encrypted at rest; refresh token rotation
- **Email data**: Minimal storage; GDPR-compliant deletion
- **API keys**: Environment variables; never commit
- **Rate limiting**: Per-user limits to prevent abuse
- **Audit logs**: Track all data access for compliance

