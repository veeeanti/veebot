"""Database module for message storage, birthdays, and semantic search."""
import sqlite3
import aiosqlite
import json
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any
import config

logger = logging.getLogger(__name__)

DATABASE_PATH = config.SQLITE_PATH

# In-memory cache for connection
_db = None


async def get_db() -> aiosqlite.Connection:
    """Get or create database connection."""
    global _db
    if _db is None:
        _db = await aiosqlite.connect(DATABASE_PATH)
        _db.row_factory = aiosqlite.Row
    return _db


async def initialize_database() -> bool:
    """Initialize database tables."""
    try:
        db = await get_db()
        
        # Messages table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                discord_message_id TEXT UNIQUE,
                content TEXT NOT NULL,
                author_id TEXT NOT NULL,
                author_name TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                guild_id TEXT,
                message_type TEXT DEFAULT 'user',
                embedding BLOB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create index for faster queries
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_guild 
            ON messages(guild_id, channel_id)
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_author 
            ON messages(author_id)
        """)
        
        # Birthdays table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS birthdays (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT UNIQUE NOT NULL,
                username TEXT NOT NULL,
                month INTEGER NOT NULL,
                day INTEGER NOT NULL,
                year INTEGER,
                pinged_year INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Memories table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                memory TEXT NOT NULL,
                guild_id TEXT,
                embedding BLOB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        await db.commit()
        logger.info("Database initialized successfully")
        return True
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        return False


async def close_database():
    """Close database connection."""
    global _db
    if _db:
        await _db.close()
        _db = None


async def store_message(
    discord_message_id: str,
    content: str,
    author_id: str,
    author_name: str,
    channel_id: str,
    guild_id: Optional[str] = None,
    message_type: str = "user",
    embedding: Optional[bytes] = None
) -> bool:
    """Store a message in the database."""
    try:
        db = await get_db()
        await db.execute(
            """INSERT OR REPLACE INTO messages 
               (discord_message_id, content, author_id, author_name, channel_id, guild_id, message_type, embedding)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (discord_message_id, content, author_id, author_name, channel_id, guild_id, message_type, embedding)
        )
        await db.commit()
        return True
    except Exception as e:
        logger.error(f"Failed to store message: {e}")
        return False


async def get_messages_by_channel(channel_id: str, limit: int = 100) -> List[Dict]:
    """Get recent messages from a channel."""
    try:
        db = await get_db()
        cursor = await db.execute(
            """SELECT * FROM messages 
               WHERE channel_id = ? 
               ORDER BY created_at DESC LIMIT ?""",
            (channel_id, limit)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    except Exception as e:
        logger.error(f"Failed to get messages: {e}")
        return []


async def get_messages_by_author(author_id: str, limit: int = 100) -> List[Dict]:
    """Get recent messages from a user."""
    try:
        db = await get_db()
        cursor = await db.execute(
            """SELECT * FROM messages 
               WHERE author_id = ? 
               ORDER BY created_at DESC LIMIT ?""",
            (author_id, limit)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    except Exception as e:
        logger.error(f"Failed to get messages by author: {e}")
        return []


async def get_all_messages(guild_id: Optional[str] = None, limit: int = 1000) -> List[Dict]:
    """Get all messages, optionally filtered by guild."""
    try:
        db = await get_db()
        if guild_id:
            cursor = await db.execute(
                """SELECT * FROM messages 
                   WHERE guild_id = ? 
                   ORDER BY created_at DESC LIMIT ?""",
                (guild_id, limit)
            )
        else:
            cursor = await db.execute(
                """SELECT * FROM messages 
                   ORDER BY created_at DESC LIMIT ?""",
                (limit,)
            )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    except Exception as e:
        logger.error(f"Failed to get all messages: {e}")
        return []


# Birthday functions
async def set_birthday(
    user_id: str,
    username: str,
    day: int,
    month: int,
    year: Optional[int] = None
) -> bool:
    """Set a user's birthday."""
    try:
        db = await get_db()
        await db.execute(
            """INSERT OR REPLACE INTO birthdays (user_id, username, month, day, year)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, username, month, day, year)
        )
        await db.commit()
        return True
    except Exception as e:
        logger.error(f"Failed to set birthday: {e}")
        return False


async def get_birthday(user_id: str) -> Optional[Dict]:
    """Get a user's birthday."""
    try:
        db = await get_db()
        cursor = await db.execute(
            "SELECT * FROM birthdays WHERE user_id = ?",
            (user_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    except Exception as e:
        logger.error(f"Failed to get birthday: {e}")
        return None


async def remove_birthday(user_id: str) -> bool:
    """Remove a user's birthday."""
    try:
        db = await get_db()
        await db.execute("DELETE FROM birthdays WHERE user_id = ?", (user_id,))
        await db.commit()
        return True
    except Exception as e:
        logger.error(f"Failed to remove birthday: {e}")
        return False


async def get_todays_birthdays(day: int, month: int, year: int) -> List[Dict]:
    """Get birthdays for today."""
    try:
        db = await get_db()
        cursor = await db.execute(
            """SELECT * FROM birthdays 
               WHERE day = ? AND month = ? AND (pinged_year IS NULL OR pinged_year != ?)""",
            (day, month, year)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    except Exception as e:
        logger.error(f"Failed to get today's birthdays: {e}")
        return []


async def mark_birthday_as_pinged(user_id: str, year: int) -> bool:
    """Mark birthday as pinged for the year."""
    try:
        db = await get_db()
        await db.execute(
            "UPDATE birthdays SET pinged_year = ? WHERE user_id = ?",
            (year, user_id)
        )
        await db.commit()
        return True
    except Exception as e:
        logger.error(f"Failed to mark birthday as pinged: {e}")
        return False


# Memory functions
async def store_memory(
    user_id: str,
    username: str,
    memory: str,
    guild_id: Optional[str] = None,
    embedding: Optional[bytes] = None
) -> bool:
    """Store a memory."""
    try:
        db = await get_db()
        await db.execute(
            """INSERT INTO memories (user_id, username, memory, guild_id, embedding)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, username, memory, guild_id, embedding)
        )
        await db.commit()
        return True
    except Exception as e:
        logger.error(f"Failed to store memory: {e}")
        return False


async def get_memories(user_id: str, guild_id: Optional[str] = None) -> List[Dict]:
    """Get a user's memories."""
    try:
        db = await get_db()
        if guild_id:
            cursor = await db.execute(
                """SELECT * FROM memories 
                   WHERE user_id = ? AND guild_id = ?
                   ORDER BY created_at DESC""",
                (user_id, guild_id)
            )
        else:
            cursor = await db.execute(
                """SELECT * FROM memories 
                   WHERE user_id = ?
                   ORDER BY created_at DESC""",
                (user_id,)
            )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    except Exception as e:
        logger.error(f"Failed to get memories: {e}")
        return []


async def remove_memory(memory_id: int, user_id: str) -> bool:
    """Remove a memory."""
    try:
        db = await get_db()
        await db.execute(
            "DELETE FROM memories WHERE id = ? AND user_id = ?",
            (memory_id, user_id)
        )
        await db.commit()
        return True
    except Exception as e:
        logger.error(f"Failed to remove memory: {e}")
        return False


# Statistics
async def get_database_statistics() -> Dict[str, Any]:
    """Get database statistics."""
    try:
        db = await get_db()
        
        # Total messages
        cursor = await db.execute("SELECT COUNT(*) as count FROM messages")
        row = await cursor.fetchone()
        total_messages = row[0] if row else 0
        
        # Messages with embeddings
        cursor = await db.execute("SELECT COUNT(*) as count FROM messages WHERE embedding IS NOT NULL")
        row = await cursor.fetchone()
        messages_with_embeddings = row[0] if row else 0
        
        # Unique channels
        cursor = await db.execute("SELECT COUNT(DISTINCT channel_id) as count FROM messages")
        row = await cursor.fetchone()
        unique_channels = row[0] if row else 0
        
        return {
            "total_messages": total_messages,
            "messages_with_embeddings": messages_with_embeddings,
            "unique_channels": unique_channels,
        }
    except Exception as e:
        logger.error(f"Failed to get database statistics: {e}")
        return {
            "total_messages": 0,
            "messages_with_embeddings": 0,
            "unique_channels": 0,
        }


async def test_connection() -> bool:
    """Test database connection."""
    try:
        db = await get_db()
        cursor = await db.execute("SELECT 1")
        await cursor.fetchone()
        return True
    except Exception as e:
        logger.error(f"Database connection test failed: {e}")
        return False
