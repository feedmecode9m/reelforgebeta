-- Add Smart Production Studio columns to reels table
ALTER TABLE reels 
ADD COLUMN IF NOT EXISTS file_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS file_size BIGINT,
ADD COLUMN IF NOT EXISTS is_auto_detected BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS detection_confidence INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ai_tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS cultural_themes TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS video_metadata JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active',
ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS shares INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS resolution VARCHAR(50),
ADD COLUMN IF NOT EXISTS has_thumbnail BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS upload_source VARCHAR(50) DEFAULT 'studio',
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- Create categories table for Smart Studio
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    item_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default categories
INSERT INTO categories (name, description) VALUES
('Trending', 'Currently popular and viral content'),
('Cyber-Action', 'Tech-driven action and adventure'),
('Romance', 'Love stories and relationships'),
('Suspense', 'Mystery and thriller content'),
('Noir', 'Dark, gritty detective stories')
ON CONFLICT (name) DO NOTHING;

-- Create uploads directory tracking
CREATE TABLE IF NOT EXISTS studio_stats (
    id SERIAL PRIMARY KEY,
    total_uploads INTEGER DEFAULT 0,
    uploads_today INTEGER DEFAULT 0,
    total_views INTEGER DEFAULT 0,
    total_likes INTEGER DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO studio_stats (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
