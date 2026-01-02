-- Initial schema migration
-- Run with: psql -U postgres -d youtube_intelligence -f migrations/001_initial_schema.sql

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    gmail_access_token TEXT,
    gmail_refresh_token TEXT,
    gmail_history_id VARCHAR(255),
    gmail_token_expires_at TIMESTAMP,
    preferences JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_history_id ON users(gmail_history_id) WHERE gmail_history_id IS NOT NULL;

-- Emails table
CREATE TABLE IF NOT EXISTS emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gmail_message_id VARCHAR(255) NOT NULL,
    thread_id VARCHAR(255) NOT NULL,
    sender_email VARCHAR(255) NOT NULL,
    sender_name VARCHAR(255),
    subject VARCHAR(500),
    received_at TIMESTAMP NOT NULL,
    snippet TEXT,
    labels TEXT[],
    is_thread_reply BOOLEAN DEFAULT FALSE,
    thread_reply_count INTEGER DEFAULT 0,
    processed_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_sender ON emails(sender_email);
CREATE INDEX IF NOT EXISTS idx_emails_user_received ON emails(user_id, received_at DESC);

-- YouTube links table
CREATE TABLE IF NOT EXISTS youtube_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    canonical_url TEXT NOT NULL,
    video_id VARCHAR(20) NOT NULL,
    playlist_id VARCHAR(50),
    extracted_at TIMESTAMP DEFAULT NOW(),
    is_duplicate BOOLEAN DEFAULT FALSE,
    
    UNIQUE(user_id, email_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_youtube_links_user_id ON youtube_links(user_id);
CREATE INDEX IF NOT EXISTS idx_youtube_links_video_id ON youtube_links(video_id);
CREATE INDEX IF NOT EXISTS idx_youtube_links_email_id ON youtube_links(email_id);
CREATE INDEX IF NOT EXISTS idx_youtube_links_extracted_at ON youtube_links(extracted_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_links_user_video ON youtube_links(user_id, video_id);

-- Video metadata table
CREATE TABLE IF NOT EXISTS video_metadata (
    video_id VARCHAR(20) PRIMARY KEY,
    title TEXT NOT NULL,
    channel_id VARCHAR(50) NOT NULL,
    channel_title VARCHAR(255) NOT NULL,
    published_at TIMESTAMP NOT NULL,
    duration_seconds INTEGER,
    category_id INTEGER,
    category_name VARCHAR(100),
    description_keywords TEXT[],
    thumbnail_url TEXT,
    view_count BIGINT,
    like_count BIGINT,
    fetched_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_metadata_channel ON video_metadata(channel_id);
CREATE INDEX IF NOT EXISTS idx_video_metadata_published ON video_metadata(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_metadata_fetched ON video_metadata(fetched_at);

-- Rankings table
CREATE TABLE IF NOT EXISTS rankings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    link_id UUID NOT NULL REFERENCES youtube_links(id) ON DELETE CASCADE,
    video_id VARCHAR(20) NOT NULL REFERENCES video_metadata(video_id),
    
    sender_score DECIMAL(5,4) NOT NULL,
    thread_score DECIMAL(5,4) NOT NULL,
    freshness_score DECIMAL(5,4) NOT NULL,
    topic_match_score DECIMAL(5,4) NOT NULL,
    noise_penalty DECIMAL(5,4) NOT NULL DEFAULT 1.0,
    
    final_score DECIMAL(5,4) NOT NULL,
    classification VARCHAR(20) NOT NULL CHECK (classification IN ('watch_now', 'save', 'skip')),
    explanation TEXT,
    topic_tags TEXT[],
    
    ranked_at TIMESTAMP DEFAULT NOW(),
    ranking_version INTEGER DEFAULT 1,
    
    UNIQUE(user_id, link_id, ranked_at)
);

CREATE INDEX IF NOT EXISTS idx_rankings_user_id ON rankings(user_id);
CREATE INDEX IF NOT EXISTS idx_rankings_classification ON rankings(classification);
CREATE INDEX IF NOT EXISTS idx_rankings_score ON rankings(final_score DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_user_classification ON rankings(user_id, classification, ranked_at DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_user_score ON rankings(user_id, final_score DESC, ranked_at DESC);

-- Feedback table
CREATE TABLE IF NOT EXISTS feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    link_id UUID NOT NULL REFERENCES youtube_links(id) ON DELETE CASCADE,
    ranking_id UUID REFERENCES rankings(id),
    
    action VARCHAR(20) NOT NULL CHECK (action IN ('watched', 'saved', 'skipped', 'dismissed')),
    label VARCHAR(20) CHECK (label IN ('watch_now', 'save', 'skip')),
    
    provided_at TIMESTAMP DEFAULT NOW(),
    user_agent TEXT,
    ip_address INET
);

CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_link_id ON feedback(link_id);
CREATE INDEX IF NOT EXISTS idx_feedback_action ON feedback(action);
CREATE INDEX IF NOT EXISTS idx_feedback_provided_at ON feedback(provided_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user_action ON feedback(user_id, action, provided_at DESC);

-- Job tracking table
CREATE TABLE IF NOT EXISTS job_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type VARCHAR(50) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    job_id VARCHAR(255),
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_tracking_type ON job_tracking(job_type);
CREATE INDEX IF NOT EXISTS idx_job_tracking_status ON job_tracking(status);
CREATE INDEX IF NOT EXISTS idx_job_tracking_user ON job_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_job_tracking_created ON job_tracking(created_at DESC);

-- Sender stats table
CREATE TABLE IF NOT EXISTS sender_stats (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_email VARCHAR(255) NOT NULL,
    email_count INTEGER DEFAULT 0,
    last_email_at TIMESTAMP,
    is_in_contacts BOOLEAN DEFAULT FALSE,
    avg_thread_reply_count DECIMAL(5,2) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW(),
    
    PRIMARY KEY (user_id, sender_email)
);

CREATE INDEX IF NOT EXISTS idx_sender_stats_user ON sender_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_sender_stats_email_count ON sender_stats(user_id, email_count DESC);

