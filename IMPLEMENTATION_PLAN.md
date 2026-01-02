# Implementation Plan: Week 1-4 Milestones

## Overview

This plan breaks down the Cross-Signal YouTube Content Intelligence System into 4 weekly milestones with measurable demos and deliverables.

---

## Week 1: Foundation & Gmail Integration

### Goals
- Set up project infrastructure
- Implement OAuth flow for Gmail
- Build email ingestion pipeline with URL extraction
- Achieve end-to-end: Gmail → Extract URLs → Store

### Deliverables

#### 1.1 Project Setup (Days 1-2)
- [x] TypeScript + Node.js project structure
- [x] Docker Compose (Postgres + Redis)
- [x] Database migrations (initial schema)
- [x] Environment configuration (.env.example)
- [x] Basic logging (structured logs with requestId)
- [x] Health check endpoints

**Demo**: `docker-compose up` → services healthy

#### 1.2 Gmail OAuth Integration (Days 2-3)
- [x] OAuth 2.0 flow (authorization code)
- [x] Token storage (encrypted)
- [x] Token refresh logic
- [x] Gmail API client wrapper
- [x] Error handling & retries

**Demo**: User can authenticate → tokens stored → can fetch profile

#### 1.3 Email Ingestion (Days 3-4)
- [x] Incremental sync using `historyId`
- [x] Fetch message metadata (From, Date, Subject, Labels, ThreadId)
- [x] Extract snippet (first 200 chars)
- [x] Store emails with idempotency (messageId dedup)
- [x] Track sync state per user

**Demo**: Sync 100 emails → all stored → duplicate sync skips existing

#### 1.4 URL Extraction & Canonicalization (Days 4-5)
- [x] Parse email body/parts safely
- [x] Extract YouTube URLs (youtube.com, youtu.be)
- [x] Canonicalize URLs:
  - Convert youtu.be → youtube.com/watch?v=...
  - Remove tracking params (utm_*, etc.)
  - Extract videoId, playlistId
- [x] Unit tests for URL parsing (edge cases)
- [x] Store links with deduplication

**Demo**: Extract URLs from test emails → canonicalize → store → dedup works

### Week 1 Success Criteria
✅ **Demo**: Authenticate → Sync 100 emails → Extract 50 YouTube links → All stored correctly
✅ **Metrics**: p95 ingestion time < 5s per 100 emails
✅ **Tests**: URL canonicalization tests pass (20+ test cases)

---

## Week 2: YouTube Enrichment & Feature Extraction

### Goals
- Implement YouTube metadata fetching with caching
- Build feature extraction pipeline
- Create ranking algorithm v1 (heuristics)
- Achieve end-to-end: Links → Enrich → Rank → Classify

### Deliverables

#### 2.1 YouTube Metadata Service (Days 1-2)
- [x] YouTube Data API v3 client
- [x] Rate limiting (10k units/day)
- [x] Exponential backoff on errors
- [x] Circuit breaker (opens after 3 failures)
- [x] Batch requests (50 videos per request)
- [x] Redis caching (TTL: 7 days)
- [x] Postgres persistence
- [x] Job queue integration (video.enrich queue)

**Demo**: Fetch metadata for 100 videos → cached → subsequent fetches hit cache

#### 2.2 Feature Extraction (Days 2-3)
- [x] **SenderScore**: Frequency + recency + contacts boost
  - Compute from `sender_stats` table
  - Formula: `log(email_count + 1) * recency_decay * contacts_boost`
- [x] **ThreadSignal**: Boost if thread has replies
  - Formula: `min(thread_reply_count / 3, 1.0)`
- [x] **Freshness**: Time decay based on publish date
  - Formula: `exp(-days_since_publish / half_life)`
- [x] **TopicMatch**: Keyword matching against user learning goals
  - Formula: `keyword_matches / total_keywords`
- [x] **NoisePenalty**: Penalize bulk senders
  - Formula: `1.0 - min(sender_email_count / 100, 0.5)`

**Demo**: Compute features for 50 links → all scores normalized 0-1

#### 2.3 Ranking Algorithm v1 (Days 3-4)
- [x] Weighted linear combination:
  ```
  score = 0.3 * sender_score
        + 0.2 * thread_score
        + 0.2 * freshness_score
        + 0.2 * topic_match_score
        + 0.1 * (1 - noise_penalty)
  ```
- [x] Classification thresholds:
  - Watch Now: score >= 0.7
  - Save: 0.4 <= score < 0.7
  - Skip: score < 0.4
- [x] Explanation generation (why ranked high/low)
- [x] Topic tag extraction (from video title/description)
- [x] Store rankings

**Demo**: Rank 50 links → Classify → Generate explanations → Store

#### 2.4 Worker Infrastructure (Days 4-5)
- [x] BullMQ setup with Redis
- [x] EmailProcessorWorker (processes email.process jobs)
- [x] VideoEnrichmentWorker (processes video.enrich jobs)
- [x] RankingWorker (scheduled daily)
- [x] Job retry logic (exponential backoff)
- [x] Job tracking in Postgres

**Demo**: Enqueue jobs → Workers process → Jobs complete → Tracking updated

### Week 2 Success Criteria
✅ **Demo**: Enrich 100 videos → Extract features → Rank → Classify → All stored
✅ **Metrics**: Ranking request p95 < 50ms for 1k links
✅ **Tests**: Feature extraction tests pass (unit tests for each feature)

---

## Week 3: Dashboard, Digest & Evaluation

### Goals
- Build dashboard API endpoints
- Generate daily/weekly digests
- Implement feedback collection
- Create offline evaluation harness

### Deliverables

#### 3.1 Dashboard API (Days 1-2)
- [x] `GET /api/feed?range=7d` - Get ranked links
- [x] `GET /api/topics` - Get topic distribution
- [x] `GET /api/senders` - Get sender statistics
- [x] `GET /api/stats` - System metrics
- [x] Pagination & filtering
- [x] Rate limiting per user

**Demo**: Query feed → Get ranked links → Filter by topic → Paginate

#### 3.2 Feedback API (Days 2-3)
- [x] `POST /api/feedback` - Submit user feedback
  - Body: `{ linkId, action: 'watched'|'saved'|'skipped', label?: 'watch_now'|'save'|'skip' }`
- [x] Store feedback in database
- [x] Link feedback to rankings (for evaluation)
- [x] Validation & error handling

**Demo**: Submit feedback → Stored → Linked to ranking → Queryable

#### 3.3 Digest Generator (Days 3-4)
- [x] Daily digest job (scheduled via cron)
- [x] Fetch rankings for date range
- [x] Generate HTML report:
  - Watch Now section (top 10)
  - Save for Later section (next 20)
  - Skip section (collapsed)
  - Explanations & topic tags
- [x] Weekly digest (aggregated)
- [x] Email delivery (optional: SMTP or local file)
- [x] Template engine (Handlebars/EJS)

**Demo**: Generate digest → HTML file created → Contains ranked links with explanations

#### 3.4 Evaluation Harness (Days 4-5)
- [x] Offline replay evaluation:
  - Load historical rankings + feedback
  - Compute precision@k (k=5, 10, 20)
  - Compute coverage (fraction of links ranked)
  - Compute novelty (fraction of new channels)
  - Compute stability (ranking consistency over time)
- [x] Metrics definitions:
  - `precision@k = (# relevant in top k) / k`
  - `coverage = (# ranked links) / (# total links)`
  - `novelty = (# unique channels) / (# total links)`
  - `stability = 1 - (ranking_variance / max_variance)`
- [x] Evaluation script (Node.js or Python notebook)
- [x] Generate evaluation report

**Demo**: Run evaluation → Generate report → Shows precision@10 = 0.65

### Week 3 Success Criteria
✅ **Demo**: Dashboard shows ranked links → User submits feedback → Digest generated → Evaluation report shows metrics
✅ **Metrics**: Dashboard API p95 < 100ms
✅ **Tests**: Evaluation harness runs successfully on test dataset

---

## Week 4: Polish, Testing & Documentation

### Goals
- Add observability (metrics, tracing)
- Comprehensive testing
- Security & privacy audit
- Documentation & deployment guide

### Deliverables

#### 4.1 Observability (Days 1-2)
- [x] Structured logging (winston/pino):
  - Request ID propagation
  - Job ID in worker logs
  - Log levels (DEBUG, INFO, WARN, ERROR)
- [x] Metrics (Prometheus-compatible):
  - Counter: `emails_processed_total`
  - Counter: `videos_enriched_total`
  - Gauge: `queue_size`
  - Histogram: `ranking_latency_seconds`
  - Histogram: `api_request_duration_seconds`
- [x] Health checks:
  - `/health` - Basic health
  - `/ready` - Readiness (DB + Redis connected)
- [x] Distributed tracing (optional: OpenTelemetry)

**Demo**: Check `/metrics` → See counters → Check logs → Structured format

#### 4.2 Testing (Days 2-3)
- [x] Unit tests:
  - URL canonicalization (20+ cases)
  - Feature extraction (each feature)
  - Ranking algorithm
  - Classification logic
- [x] Integration tests:
  - End-to-end pipeline (Gmail → Rank → Store)
  - API endpoints
  - Worker jobs
- [x] Test fixtures:
  - Mock Gmail API responses
  - Mock YouTube API responses
  - Sample email data
- [x] Test coverage: > 70%

**Demo**: Run tests → All pass → Coverage report generated

#### 4.3 Security & Privacy (Days 3-4)
- [x] Security checklist:
  - [x] OAuth tokens encrypted at rest
  - [x] API keys in environment variables
  - [x] Rate limiting per user
  - [x] Input validation (SQL injection prevention)
  - [x] CORS configuration
  - [x] HTTPS enforcement (production)
- [x] Privacy checklist:
  - [x] Minimal email storage (snippet only)
  - [x] Data retention policies
  - [x] GDPR compliance (deletion, export)
  - [x] Audit logging
- [x] Security audit document

**Demo**: Review checklist → All items verified → Document created

#### 4.4 Documentation & Deployment (Days 4-5)
- [x] README.md:
  - Project overview
  - Architecture diagram
  - Setup instructions (Docker Compose)
  - API documentation
  - Configuration guide
- [x] API documentation (OpenAPI/Swagger)
- [x] Deployment guide:
  - Local development
  - Docker Compose setup
  - Environment variables
  - Database migrations
- [x] System design notes:
  - Tradeoffs explained
  - Future improvements (ML, scaling)
  - Known limitations

**Demo**: README complete → Can follow setup → System runs locally

### Week 4 Success Criteria
✅ **Demo**: Full system demo → All features working → Tests pass → Documentation complete
✅ **Metrics**: All SLIs met (ingestion < 5s, ranking < 50ms, API < 100ms)
✅ **Documentation**: README + API docs + Security checklist complete

---

## Overall Success Metrics

### Functional
- ✅ End-to-end pipeline: Gmail → Extract → Enrich → Rank → Digest
- ✅ Dashboard shows ranked links with explanations
- ✅ User feedback collected and stored
- ✅ Evaluation harness produces precision@k metrics

### Non-Functional
- ✅ **Performance**: p95 ingestion < 5s per 100 emails, ranking < 50ms per 1k links
- ✅ **Reliability**: Idempotent jobs, retries, circuit breakers
- ✅ **Observability**: Structured logs, metrics, health checks
- ✅ **Privacy**: Minimal data storage, GDPR-compliant
- ✅ **Testing**: > 70% code coverage

### Google-Style Keywords Demonstrated
- ✅ **Idempotency**: Email processing, job tracking
- ✅ **Replay**: Offline evaluation harness
- ✅ **Backfill**: Support for historical data processing
- ✅ **SLIs/SLOs**: Performance targets defined
- ✅ **Precision@k**: Evaluation metric
- ✅ **Feature store**: Feature extraction pipeline
- ✅ **Batching**: YouTube API batch requests
- ✅ **Rate limits**: Gmail + YouTube API rate limiting
- ✅ **Circuit breaker**: YouTube API resilience

---

## Future Enhancements (Post-MVP)

### Week 5+ (Optional)
- ML ranking model (XGBoost/LightGBM)
- Embedding-based topic matching (sentence-transformers)
- Real-time ranking updates (streaming)
- Multi-user support (tenant isolation)
- Advanced dashboard (React frontend)
- A/B testing framework for ranking models

