-- SQLite Schema for UC-AIv2
-- This schema is designed for local hosting using a single file.

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_message_id TEXT UNIQUE,
    content TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    guild_id TEXT,
    message_type TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_guild_id ON messages(guild_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_message_type ON messages(message_type);

-- Full-text search table for messages
-- We use a virtual FTS5 table to index the content for fast searching.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='id'
);

-- Triggers to keep the FTS index in sync with the messages table
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

-- Birthdays table
CREATE TABLE IF NOT EXISTS birthdays (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    day INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER,
    last_pinged_year INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Trigger to automatically update updated_at on messages
CREATE TRIGGER IF NOT EXISTS update_messages_updated_at AFTER UPDATE ON messages
BEGIN
    UPDATE messages SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;

-- Trigger to automatically update updated_at on birthdays
CREATE TRIGGER IF NOT EXISTS update_birthdays_updated_at AFTER UPDATE ON birthdays
BEGIN
    UPDATE birthdays SET updated_at = CURRENT_TIMESTAMP WHERE user_id = old.user_id;
END;
