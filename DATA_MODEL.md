# Data Model & Schema

## PostgreSQL Schema

### Core Tables

#### `users`
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    gmail_access_token TEXT, -- Encrypted at application level
    gmail_refresh_token TEXT, -- Encrypted at application level
    gmail_history_id VARCHAR(255), -- For incremental sync
    gmail_token_expires_at TIMESTAMP,
    preferences JSONB DEFAULT '{}', -- Learning goals, notification settings
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_history_id ON users(gmail_history_id) WHERE gmail_history_id IS NOT NULL;
```

#### `emails`
```sql
CREATE TABLE emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gmail_message_id VARCHAR(255) NOT NULL,
    thread_id VARCHAR(255) NOT NULL,
    sender_email VARCHAR(255) NOT NULL,
    sender_name VARCHAR(255),
    subject VARCHAR(500),
    received_at TIMESTAMP NOT NULL,
    snippet TEXT, -- First 200 chars only (privacy-first)
    labels TEXT[], -- Gmail labels
    is_thread_reply BOOLEAN DEFAULT FALSE,
    thread_reply_count INTEGER DEFAULT 0,
    processed_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id, gmail_message_id)
);

CREATE INDEX idx_emails_user_id ON emails(user_id);
CREATE INDEX idx_emails_received_at ON emails(received_at DESC);
CREATE INDEX idx_emails_thread_id ON emails(thread_id);
CREATE INDEX idx_emails_sender ON emails(sender_email);
CREATE INDEX idx_emails_user_received ON emails(user_id, received_at DESC);
```

#### `youtube_links`
```sql
CREATE TABLE youtube_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    canonical_url TEXT NOT NULL, -- Normalized youtube.com/watch?v=...
    video_id VARCHAR(20) NOT NULL, -- YouTube video ID
    playlist_id VARCHAR(50), -- If part of playlist
    extracted_at TIMESTAMP DEFAULT NOW(),
    is_duplicate BOOLEAN DEFAULT FALSE, -- True if same videoId seen before for user
    
    UNIQUE(user_id, email_id, video_id) -- Prevent duplicate links per email
);

CREATE INDEX idx_youtube_links_user_id ON youtube_links(user_id);
CREATE INDEX idx_youtube_links_video_id ON youtube_links(video_id);
CREATE INDEX idx_youtube_links_email_id ON youtube_links(email_id);
CREATE INDEX idx_youtube_links_extracted_at ON youtube_links(extracted_at DESC);
CREATE INDEX idx_youtube_links_user_video ON youtube_links(user_id, video_id);
```

#### `video_metadata`
```sql
CREATE TABLE video_metadata (
    video_id VARCHAR(20) PRIMARY KEY,
    title TEXT NOT NULL,
    channel_id VARCHAR(50) NOT NULL,
    channel_title VARCHAR(255) NOT NULL,
    published_at TIMESTAMP NOT NULL,
    duration_seconds INTEGER,
    category_id INTEGER,
    category_name VARCHAR(100),
    description_keywords TEXT[], -- Extracted keywords from description
    thumbnail_url TEXT,
    view_count BIGINT,
    like_count BIGINT,
    fetched_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_video_metadata_channel ON video_metadata(channel_id);
CREATE INDEX idx_video_metadata_published ON video_metadata(published_at DESC);
CREATE INDEX idx_video_metadata_fetched ON video_metadata(fetched_at);
```

#### `rankings`
```sql
CREATE TABLE rankings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    link_id UUID NOT NULL REFERENCES youtube_links(id) ON DELETE CASCADE,
    video_id VARCHAR(20) NOT NULL REFERENCES video_metadata(video_id),
    
    -- Feature scores (0-1 normalized)
    sender_score DECIMAL(5,4) NOT NULL,
    thread_score DECIMAL(5,4) NOT NULL,
    freshness_score DECIMAL(5,4) NOT NULL,
    topic_match_score DECIMAL(5,4) NOT NULL,
    noise_penalty DECIMAL(5,4) NOT NULL DEFAULT 1.0,
    
    -- Final score
    final_score DECIMAL(5,4) NOT NULL,
    
    -- Classification
    classification VARCHAR(20) NOT NULL CHECK (classification IN ('watch_now', 'save', 'skip')),
    
    -- Explanation
    explanation TEXT, -- Why ranked high/low
    
    -- Topic tags
    topic_tags TEXT[],
    
    -- Ranking metadata
    ranked_at TIMESTAMP DEFAULT NOW(),
    ranking_version INTEGER DEFAULT 1, -- For A/B testing future ML models
    
    UNIQUE(user_id, link_id, ranked_at) -- One ranking per link per day
);

CREATE INDEX idx_rankings_user_id ON rankings(user_id);
CREATE INDEX idx_rankings_classification ON rankings(classification);
CREATE INDEX idx_rankings_score ON rankings(final_score DESC);
CREATE INDEX idx_rankings_user_classification ON rankings(user_id, classification, ranked_at DESC);
CREATE INDEX idx_rankings_user_score ON rankings(user_id, final_score DESC, ranked_at DESC);
```

#### `feedback`
```sql
CREATE TABLE feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    link_id UUID NOT NULL REFERENCES youtube_links(id) ON DELETE CASCADE,
    ranking_id UUID REFERENCES rankings(id),
    
    -- User action
    action VARCHAR(20) NOT NULL CHECK (action IN ('watched', 'saved', 'skipped', 'dismissed')),
    
    -- Optional: user-provided label (for evaluation)
    label VARCHAR(20) CHECK (label IN ('watch_now', 'save', 'skip')),
    
    -- Feedback metadata
    provided_at TIMESTAMP DEFAULT NOW(),
    user_agent TEXT,
    ip_address INET -- For abuse detection (hashed in production)
);

CREATE INDEX idx_feedback_user_id ON feedback(user_id);
CREATE INDEX idx_feedback_link_id ON feedback(link_id);
CREATE INDEX idx_feedback_action ON feedback(action);
CREATE INDEX idx_feedback_provided_at ON feedback(provided_at DESC);
CREATE INDEX idx_feedback_user_action ON feedback(user_id, action, provided_at DESC);
```

#### `job_tracking`
```sql
CREATE TABLE job_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type VARCHAR(50) NOT NULL, -- 'email.sync', 'video.enrich', 'ranking.compute'
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    job_id VARCHAR(255), -- BullMQ job ID
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    metadata JSONB DEFAULT '{}', -- Job-specific data (message count, etc.)
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_job_tracking_type ON job_tracking(job_type);
CREATE INDEX idx_job_tracking_status ON job_tracking(status);
CREATE INDEX idx_job_tracking_user ON job_tracking(user_id);
CREATE INDEX idx_job_tracking_created ON job_tracking(created_at DESC);
```

#### `sender_stats` (Materialized/Computed)
```sql
-- Denormalized table for fast sender score computation
CREATE TABLE sender_stats (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_email VARCHAR(255) NOT NULL,
    email_count INTEGER DEFAULT 0,
    last_email_at TIMESTAMP,
    is_in_contacts BOOLEAN DEFAULT FALSE,
    avg_thread_reply_count DECIMAL(5,2) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW(),
    
    PRIMARY KEY (user_id, sender_email)
);

CREATE INDEX idx_sender_stats_user ON sender_stats(user_id);
CREATE INDEX idx_sender_stats_email_count ON sender_stats(user_id, email_count DESC);
```

### Migration Scripts

```sql
-- migrations/001_initial_schema.sql
-- (Contains all CREATE TABLE statements above)

-- migrations/002_add_user_preferences.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS learning_goals TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{"daily_digest": true, "weekly_digest": false}';

-- migrations/003_add_ranking_explanation.sql
-- (Already included in rankings table)

-- migrations/004_add_feedback_labels.sql
-- (Already included in feedback table)
```

## Redis Schema

### Key Patterns

#### Video Metadata Cache
```
video:metadata:{videoId} -> JSON string
TTL: 7 days (604800 seconds)
```

#### Rate Limiting
```
rate_limit:gmail:{userId} -> counter (INCR with EXPIRE)
rate_limit:youtube:{userId} -> counter (INCR with EXPIRE)
```

#### Circuit Breaker State
```
circuit_breaker:youtube -> "open" | "half_open" | "closed"
circuit_breaker:youtube:failures -> counter
circuit_breaker:youtube:last_failure -> timestamp
```

#### BullMQ Queues (managed by BullMQ)
```
bull:email.process:{jobId}
bull:video.enrich:{jobId}
bull:ranking.compute:{jobId}
bull:digest.generate:{jobId}
```

#### User Session (optional)
```
session:{sessionId} -> JSON string (user_id, expires_at)
TTL: 24 hours
```

## Data Privacy Considerations

### Minimal Data Storage
- **Email bodies**: NOT stored (privacy-first)
- **Snippets**: Limited to first 200 characters
- **Full URLs**: Stored but tracking params removed during canonicalization
- **IP addresses**: Hashed or anonymized in production

### Data Retention
- **Emails**: Retained for 90 days (configurable)
- **Rankings**: Retained for 1 year (for evaluation)
- **Feedback**: Retained indefinitely (for ML training)
- **Video metadata**: Retained indefinitely (public data)

### GDPR Compliance
- **Right to deletion**: Cascade deletes on user deletion
- **Right to export**: Export user data endpoint
- **Right to access**: User dashboard shows all stored data

## Query Patterns & Performance

### High-Frequency Queries

1. **Get user rankings (dashboard)**
```sql
SELECT r.*, vm.title, vm.channel_title, vm.thumbnail_url, yl.canonical_url
FROM rankings r
JOIN youtube_links yl ON r.link_id = yl.id
JOIN video_metadata vm ON r.video_id = vm.video_id
WHERE r.user_id = $1
  AND r.ranked_at >= NOW() - INTERVAL '7 days'
ORDER BY r.final_score DESC
LIMIT 50;
```
**Index**: `idx_rankings_user_score` covers this query

2. **Check if email already processed (idempotency)**
```sql
SELECT id FROM emails
WHERE user_id = $1 AND gmail_message_id = $2;
```
**Index**: Unique constraint on `(user_id, gmail_message_id)` ensures fast lookup

3. **Get sender stats for ranking**
```sql
SELECT * FROM sender_stats
WHERE user_id = $1 AND sender_email = $2;
```
**Index**: Primary key covers this query

4. **Fetch video metadata (with cache fallback)**
```sql
SELECT * FROM video_metadata
WHERE video_id = $1;
```
**Cache**: Redis lookup first, DB fallback

### Batch Operations

1. **Bulk insert YouTube links**
```sql
INSERT INTO youtube_links (user_id, email_id, canonical_url, video_id, ...)
VALUES (...), (...), (...)
ON CONFLICT (user_id, email_id, video_id) DO NOTHING;
```

2. **Update sender stats**
```sql
INSERT INTO sender_stats (user_id, sender_email, email_count, last_email_at)
VALUES ($1, $2, 1, NOW())
ON CONFLICT (user_id, sender_email)
DO UPDATE SET
  email_count = sender_stats.email_count + 1,
  last_email_at = GREATEST(sender_stats.last_email_at, EXCLUDED.last_email_at),
  updated_at = NOW();
```

## Data Model Tradeoffs

### Denormalization
- **sender_stats**: Denormalized for performance; updated via triggers or application logic
- **Tradeoff**: Slight inconsistency risk vs faster ranking queries

### Indexing Strategy
- **Covering indexes**: `idx_rankings_user_score` includes all needed columns
- **Tradeoff**: Write performance vs read performance; acceptable for read-heavy workload

### JSONB Usage
- **user.preferences**: Flexible schema for user settings
- **job_tracking.metadata**: Extensible job-specific data
- **Tradeoff**: Less type safety vs flexibility; acceptable for metadata

