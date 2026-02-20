// Database connection and initialization for UC-AIv2
// Supports both PostgreSQL (remote/server) and SQLite (local/file)
import { Pool } from 'pg';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_TYPE = process.env.DATABASE_TYPE || 'sqlite'; // Default to sqlite for local storage
const SQLITE_PATH = process.env.SQLITE_PATH || './database.sqlite';

let pgPool = null;
let sqliteDb = null;

// Initialize connection based on type
if (DB_TYPE === 'postgres') {
    let dbConfig;
    if (process.env.DATABASE_URL) {
        dbConfig = {
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        };
    } else {
        dbConfig = {
            host: process.env.POSTGRES_HOST || 'localhost',
            port: parseInt(process.env.POSTGRES_PORT) || 5432,
            database: process.env.POSTGRES_DB || 'uc_aiv2',
            user: process.env.POSTGRES_USER || 'postgres',
            password: process.env.POSTGRES_PASSWORD || 'password',
            ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        };
    }
    pgPool = new Pool(dbConfig);
} else {
    // SQLite initialization
    try {
        const dbDir = path.dirname(SQLITE_PATH);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        sqliteDb = new Database(SQLITE_PATH);
        sqliteDb.pragma('journal_mode = WAL'); // Better concurrency
    } catch (error) {
        console.error('Failed to initialize SQLite database:', error.message);
    }
}

export async function testConnection() {
    if (DB_TYPE === 'postgres') {
        try {
            const client = await pgPool.connect();
            const result = await client.query('SELECT NOW() as current_time');
            client.release();
            console.log('PostgreSQL connected successfully');
            return true;
        } catch (error) {
            console.error('PostgreSQL connection failed:', error.message);
            return false;
        }
    } else {
        try {
            const result = sqliteDb.prepare("SELECT datetime('now') as current_time").get();
            console.log('SQLite connected successfully (local file:', SQLITE_PATH, ')');
            return true;
        } catch (error) {
            console.error('SQLite connection failed:', error.message);
            return false;
        }
    }
}

export async function initializeDatabase() {
    try {
        const schemaFileName = DB_TYPE === 'postgres' ? 'schema.sql' : 'schema-sqlite.sql';
        const schemaPath = path.join(process.cwd(), schemaFileName);
        
        if (!fs.existsSync(schemaPath)) {
            console.error(`Schema file not found: ${schemaPath}`);
            return false;
        }
        
        const schema = fs.readFileSync(schemaPath, 'utf8');

        if (DB_TYPE === 'postgres') {
            const client = await pgPool.connect();
            try {
                await client.query(schema);
            } finally {
                client.release();
            }
        } else {
            // Execute schema as a single string for SQLite if possible
            // but handle it carefully as better-sqlite3.exec() can handle multiple statements
            try {
                sqliteDb.exec(schema);
            } catch (err) {
                console.error(`Failed to execute full schema at once: ${err.message}`);
                console.info('Attempting to execute statement by statement...');
                
                // Fallback to splitting if needed, but be aware of triggers/blocks
                const statements = schema
                    .split(';')
                    .map(s => s.trim())
                    .filter(s => s.length > 0);
                
                for (const statement of statements) {
                    try {
                        sqliteDb.exec(statement);
                    } catch (innerErr) {
                        // Silent fail for common errors like "table already exists"
                        if (!innerErr.message.includes('already exists')) {
                            console.error(`Failed to execute statement: ${statement.substring(0, 50)}...`);
                            console.error(`Error: ${innerErr.message}`);
                        }
                    }
                }
            }
        }
        console.log(`Database schema (${DB_TYPE}) initialized successfully`);
        return true;
    } catch (error) {
        console.error('Database initialization failed:', error.message);
        return false;
    }
}

export async function closeDatabase() {
    if (pgPool) await pgPool.end();
    if (sqliteDb) sqliteDb.close();
}

// ─── Message functions ────────────────────────────────────────────────────────

export async function storeMessage(messageData) {
    const {
        discordMessageId, content, authorId, authorName,
        channelId, guildId, messageType
    } = messageData;

    try {
        if (DB_TYPE === 'postgres') {
            const query = `
                INSERT INTO messages (
                    discord_message_id, content, author_id, author_name,
                    channel_id, guild_id, message_type
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (discord_message_id) DO NOTHING
                RETURNING id, created_at
            `;
            const values = [discordMessageId, content, authorId, authorName, channelId, guildId || null, messageType || 'user'];
            const result = await pgPool.query(query, values);
            return result.rows[0];
        } else {
            const stmt = sqliteDb.prepare(`
                INSERT OR IGNORE INTO messages (
                    discord_message_id, content, author_id, author_name,
                    channel_id, guild_id, message_type
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            const info = stmt.run(discordMessageId, content, authorId, authorName, channelId, guildId || null, messageType || 'user');
            
            if (info.changes > 0) {
                const row = sqliteDb.prepare('SELECT id, created_at FROM messages WHERE id = ?').get(info.lastInsertRowid);
                return row;
            }
            return null;
        }
    } catch (error) {
        console.error('Failed to store message:', error.message);
        return null;
    }
}

export async function findSimilarMessages(queryText, guildId, authorId = null, limit = 5) {
    try {
        if (DB_TYPE === 'postgres') {
            let query = `
                SELECT id, content, author_name, message_type, created_at,
                       ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) as similarity_score
                FROM messages
                WHERE guild_id = $2
                AND to_tsvector('english', content) @@ plainto_tsquery('english', $1)
            `;
            const values = [queryText, guildId, limit];
            if (authorId) {
                query += ` AND author_id = $4`;
                values.push(authorId);
            }
            query += ` ORDER BY similarity_score DESC, created_at DESC LIMIT $3`;
            const result = await pgPool.query(query, values);
            return result.rows;
        } else {
            // SQLite FTS5 search
            let sql = `
                SELECT m.id, m.content, m.author_name, m.message_type, m.created_at, rank as similarity_score
                FROM messages m
                JOIN messages_fts f ON m.id = f.rowid
                WHERE m.guild_id = ? AND messages_fts MATCH ?
            `;
            const params = [guildId, queryText];
            if (authorId) {
                sql += ` AND m.author_id = ?`;
                params.push(authorId);
            }
            sql += ` ORDER BY rank LIMIT ?`;
            params.push(limit);
            
            const stmt = sqliteDb.prepare(sql);
            return stmt.all(...params);
        }
    } catch (error) {
        console.error('Failed to search similar messages:', error.message);
        return [];
    }
}

export async function getRecentMessages(guildId, authorId = null, limit = 10) {
    try {
        if (DB_TYPE === 'postgres') {
            let query = `SELECT content, author_name, message_type, created_at FROM messages WHERE guild_id = $1`;
            const values = [guildId, limit];
            if (authorId) {
                query += ` AND author_id = $3`;
                values.push(authorId);
            }
            query += ` ORDER BY created_at DESC LIMIT $2`;
            const result = await pgPool.query(query, values);
            return result.rows;
        } else {
            let sql = `SELECT content, author_name, message_type, created_at FROM messages WHERE guild_id = ?`;
            const params = [guildId];
            if (authorId) {
                sql += ` AND author_id = ?`;
                params.push(authorId);
            }
            sql += ` ORDER BY created_at DESC LIMIT ?`;
            params.push(limit);
            return sqliteDb.prepare(sql).all(...params);
        }
    } catch (error) {
        console.error('Failed to get recent messages:', error.message);
        return [];
    }
}

export async function cleanupOldMessages(daysOld = 30) {
    try {
        if (DB_TYPE === 'postgres') {
            const query = `DELETE FROM messages WHERE created_at < NOW() - INTERVAL '${daysOld} days' AND message_type = 'user'`;
            const result = await pgPool.query(query);
            return result.rowCount;
        } else {
            const stmt = sqliteDb.prepare(`DELETE FROM messages WHERE created_at < datetime('now', '-${daysOld} days') AND message_type = 'user'`);
            const info = stmt.run();
            return info.changes;
        }
    } catch (error) {
        console.error('Failed to cleanup old messages:', error.message);
        return 0;
    }
}

// ─── Birthday functions ──────────────────────────────────────────────────────

export async function setBirthday(userId, username, day, month, year = null) {
    try {
        if (DB_TYPE === 'postgres') {
            const query = `
                INSERT INTO birthdays (user_id, username, day, month, year)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (user_id) 
                DO UPDATE SET 
                    username = EXCLUDED.username,
                    day = EXCLUDED.day,
                    month = EXCLUDED.month,
                    year = EXCLUDED.year,
                    updated_at = NOW()
            `;
            await pgPool.query(query, [userId, username, day, month, year]);
        } else {
            const stmt = sqliteDb.prepare(`
                INSERT INTO birthdays (user_id, username, day, month, year)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (user_id) 
                DO UPDATE SET 
                    username = EXCLUDED.username,
                    day = EXCLUDED.day,
                    month = EXCLUDED.month,
                    year = EXCLUDED.year,
                    updated_at = CURRENT_TIMESTAMP
            `);
            stmt.run(userId, username, day, month, year);
        }
        return true;
    } catch (error) {
        console.error('Failed to set birthday:', error.message);
        return false;
    }
}

export async function getBirthday(userId) {
    try {
        if (DB_TYPE === 'postgres') {
            const result = await pgPool.query('SELECT * FROM birthdays WHERE user_id = $1', [userId]);
            return result.rows[0];
        } else {
            return sqliteDb.prepare('SELECT * FROM birthdays WHERE user_id = ?').get(userId);
        }
    } catch (error) {
        console.error('Failed to get birthday:', error.message);
        return null;
    }
}

export async function removeBirthday(userId) {
    try {
        if (DB_TYPE === 'postgres') {
            await pgPool.query('DELETE FROM birthdays WHERE user_id = $1', [userId]);
        } else {
            sqliteDb.prepare('DELETE FROM birthdays WHERE user_id = ?').run(userId);
        }
        return true;
    } catch (error) {
        console.error('Failed to remove birthday:', error.message);
        return false;
    }
}

export async function getTodaysBirthdays(day, month, currentYear) {
    try {
        if (DB_TYPE === 'postgres') {
            const query = `
                SELECT * FROM birthdays 
                WHERE day = $1 AND month = $2 
                AND last_pinged_year < $3
            `;
            const result = await pgPool.query(query, [day, month, currentYear]);
            return result.rows;
        } else {
            const sql = `
                SELECT * FROM birthdays 
                WHERE day = ? AND month = ? 
                AND last_pinged_year < ?
            `;
            return sqliteDb.prepare(sql).all(day, month, currentYear);
        }
    } catch (error) {
        console.error('Failed to get today\'s birthdays:', error.message);
        return [];
    }
}

export async function markBirthdayAsPinged(userId, year) {
    try {
        if (DB_TYPE === 'postgres') {
            await pgPool.query('UPDATE birthdays SET last_pinged_year = $1 WHERE user_id = $2', [year, userId]);
        } else {
            sqliteDb.prepare('UPDATE birthdays SET last_pinged_year = ? WHERE user_id = ?').run(year, userId);
        }
        return true;
    } catch (error) {
        console.error('Failed to mark birthday as pinged:', error.message);
        return false;
    }
}
