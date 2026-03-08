import {
    storeMessage,
    findSimilarMessages,
    getRecentMessages,
    getChannelMessages,
    cleanupOldMessages,
    storeMemory,
    getMemories,
    searchMemories,
    removeMemory
} from './database.js';

/*══════════════════════════════════════════════════════════════════════════*
 * CONTEXT MANAGER - Semantic Memory for the AI Bot
 * Stores and retrieves conversation context for smarter AI responses
 * ───────────────────────────────────────────────────────────────────────────────*/

// SECTION 1: Configuration & Constants
const ENABLE_SEMANTIC_SEARCH = process.env.ENABLE_SEMANTIC_SEARCH === 'true';
const MAX_CONTEXT_MESSAGES = parseInt(process.env.MAX_CONTEXT_MESSAGES) || 20;
const CONTEXT_SIMILARITY_THRESHOLD = parseFloat(process.env.CONTEXT_SIMILARITY_THRESHOLD) || 0.7;
const DEBUG = process.env.DEBUG === 'true';

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 2: SEMANTIC CONTEXT MANAGER CLASS
 * Core class that manages message storage and context retrieval
 * ───────────────────────────────────────────────────────────────────────────────*/

class SemanticContextManager {
    constructor() {
        this.isInitialized = false;
        this.messageCache = new Map(); // Temporary cache for quick access
    }

    /**
     * SECTION 2a: INITIALIZATION
     * Initialize the semantic context manager on bot startup
     * Performs cleanup of old messages and sets ready state
     */
    async initialize() {
        try {
            console.log('Init Semantic Context Manager...');
            
            // Cleanup old messages on startup
            await this.performCleanup();
            
            this.isInitialized = true;
            console.log('Semantic Context Manager init successfully');
            
            return true;
        } catch (error) {
            console.error('Failed to init Semantic Context Manager:', error.message);
            return false;
        }
    }

    /**
     * SECTION 2b: STORE USER MESSAGE
     * Stores a user message in the database for future AI context retrieval
     * Also caches the message for quick access
     */
    async storeUserMessage(messageData) {
        const {
            discordMessageId,
            content,
            authorId,
            authorName,
            channelId,
            guildId
        } = messageData;

        try {
            // Store in database (no embeddings needed)
            const result = await storeMessage({
                discordMessageId,
                content,
                authorId,
                authorName,
                channelId,
                guildId,
                messageType: 'user'
            });

            if (result) {
                // Cache for quick access
                this.messageCache.set(discordMessageId, {
                    content,
                    authorName,
                    messageType: 'user',
                    created_at: result.created_at
                });
            }

            return result;
        } catch (error) {
            console.error('Failed to store user message:', error.message);
            return null;
        }
    }

    /**
     * SECTION 2c: STORE ASSISTANT MESSAGE
     * Stores an AI assistant response in the database
     * Helps maintain conversation history for context
     */
    async storeAssistantMessage(messageData) {
        const {
            discordMessageId,
            content,
            channelId,
            guildId
        } = messageData;

        try {
            // Store in database (no embeddings needed)
            const result = await storeMessage({
                discordMessageId,
                content,
                authorId: 'assistant',
                authorName: 'AM',
                channelId,
                guildId,
                messageType: 'assistant'
            });

            if (result) {
                // Cache for quick access
                this.messageCache.set(discordMessageId, {
                    content,
                    authorName: 'AM',
                    messageType: 'assistant',
                    created_at: result.created_at
                });
            }

            return result;
        } catch (error) {
            console.error('Failed to store assistant message:', error.message);
            return null;
        }
    }

    /**
     * SECTION 2d: CONTEXT RETRIEVAL (MAIN FUNCTION)
     * Gets relevant conversation context for the current message
     * Uses text similarity search + recent messages to build context
     * This is the core function that makes the AI "remember" past conversations
     */
     async getRelevantContext(userInput, guildId = null, userId = null) {
        try {
            // Check cache first (include userId in cache key)
            const cacheKey = `${guildId || 'all_guilds'}_${userId || 'all'}_${Buffer.from(userInput).toString('base64')}`;
            
            if (this.messageCache.has(cacheKey)) {
                return this.messageCache.get(cacheKey);
            }

            let context = [];

            if (ENABLE_SEMANTIC_SEARCH) {
                // Search for similar messages using text search
                const similarMessages = await findSimilarMessages(
                    userInput,
                    guildId,
                    userId,
                    Math.floor(MAX_CONTEXT_MESSAGES / 2)
                );

                if (similarMessages.length > 0) {
                    context = similarMessages.map(msg => ({
                        content: msg.content,
                        author: msg.author_name,
                        type: msg.message_type,
                        similarity: parseFloat(msg.similarity_score) || 0,
                        timestamp: msg.created_at
                    }));

                    if (DEBUG) {
                        console.log(`Found ${context.length} textually relevant messages`);
                        console.log(`   Average similarity: ${(context.reduce((sum, msg) => sum + msg.similarity, 0) / context.length).toFixed(3)}`);
                    }
                }

                // Search for relevant memories
                const relevantMemories = await searchMemories(userInput, userId, guildId, Math.floor(MAX_CONTEXT_MESSAGES / 4));
                if (relevantMemories.length > 0) {
                    const memoryContext = relevantMemories.map(memory => ({
                        content: `[Memory] ${memory.memory}`,
                        author: memory.username,
                        type: 'memory',
                        similarity: parseFloat(memory.similarity_score) || 0,
                        timestamp: memory.created_at
                    }));
                    
                    context = [...context, ...memoryContext];
                    
                    if (DEBUG) {
                        console.log(`Found ${relevantMemories.length} relevant memories`);
                    }
                }
            }

            if (context.length < MAX_CONTEXT_MESSAGES / 2) {
                const recentMessages = await getRecentMessages(
                    guildId,
                    userId,
                    MAX_CONTEXT_MESSAGES - context.length
                );

                // Add recent messages that aren't already in context
                for (const msg of recentMessages) {
                    if (!context.some(existing => existing.content === msg.content)) {
                        context.push({
                            content: msg.content,
                            author: msg.author_name,
                            type: msg.message_type,
                            timestamp: msg.created_at,
                            isRecent: true
                        });
                    }
                }
            }

            // Sort by relevance (text similarity first, then recency)
            context.sort((a, b) => {
                if (a.similarity && b.similarity) {
                    return b.similarity - a.similarity;
                } else if (a.similarity && !b.similarity) {
                    return -1;
                } else if (!a.similarity && b.similarity) {
                    return 1;
                } else {
                    return new Date(b.timestamp) - new Date(a.timestamp);
                }
            });

            // Cache the result
            this.messageCache.set(cacheKey, context);

            // Limit context size
            const finalContext = context.slice(0, MAX_CONTEXT_MESSAGES);
            
            if (DEBUG) {
                console.log(`Context retrieved: ${finalContext.length} messages`);
            }

            return finalContext;

        } catch (error) {
            console.error('Failed to get relevant context:', error.message);
            
            // Fallback to simple recent messages
            try {
                const recentMessages = await getRecentMessages(guildId, userId, MAX_CONTEXT_MESSAGES);
                return recentMessages.map(msg => ({
                    content: msg.content,
                    author: msg.author_name,
                    type: msg.message_type,
                    timestamp: msg.created_at
                }));
            } catch (fallbackError) {
                console.error('Fallback context retrieval also failed:', fallbackError.message);
                return [];
            }
        }
    }

    /**
     * SECTION 2e: MAINTENANCE
     * Deletes messages older than 30 days to prevent database bloat
     * Should be called periodically (e.g., on bot startup)
     */
    async performCleanup() {
        try {
            const cleanedCount = await cleanupOldMessages(30);
            
            if (cleanedCount > 0) {
                console.log(`Cleaned up ${cleanedCount} old messages`);
            }
        } catch (error) {
            console.error('Cleanup failed:', error.message);
        }
    }

    /**
     * SECTION 2f: STATISTICS
     * Get database statistics for the /info command
     * Returns counts of messages, channels, and embeddings
     */
     async getStatistics() {
        try {
            const { DB_TYPE, pgPool, sqliteDb } = require('./database.js');
            
            if (DB_TYPE === 'postgres') {
                const result = await pgPool.query(`
                    SELECT 
                        COUNT(*) as total_messages,
                        COUNT(CASE WHEN message_type = 'user' THEN 1 END) as user_messages,
                        COUNT(CASE WHEN message_type = 'assistant' THEN 1 END) as assistant_messages,
                        COUNT(DISTINCT channel_id) as unique_channels
                    FROM messages
                `);
                
                return result.rows[0];
            } else {
                const result = sqliteDb.prepare(`
                    SELECT 
                        COUNT(*) as total_messages,
                        COUNT(CASE WHEN message_type = 'user' THEN 1 END) as user_messages,
                        COUNT(CASE WHEN message_type = 'assistant' THEN 1 END) as assistant_messages,
                        COUNT(DISTINCT channel_id) as unique_channels
                    FROM messages
                `).get();
                
                return result;
            }
        } catch (error) {
            console.error('Failed to get statistics:', error.message);
            return null;
        }
    }

     /**
     * SECTION 2g: STORE MEMORY
     * Stores an explicit memory for a user
     */
    async storeMemory(userId, username, memory, guildId = null) {
        try {
            const result = await storeMemory(userId, username, memory, guildId);
            return result;
        } catch (error) {
            console.error('Failed to store memory:', error.message);
            return null;
        }
    }

    /**
     * SECTION 2h: GET MEMORIES
     * Retrieves all memories for a user
     */
    async getMemories(userId, guildId = null, limit = 20) {
        try {
            const memories = await getMemories(userId, guildId, limit);
            return memories;
        } catch (error) {
            console.error('Failed to get memories:', error.message);
            return [];
        }
    }

    /**
     * SECTION 2i: SEARCH MEMORIES
     * Searches memories containing keywords
     */
    async searchMemories(queryText, userId = null, guildId = null, limit = 10) {
        try {
            const memories = await searchMemories(queryText, userId, guildId, limit);
            return memories;
        } catch (error) {
            console.error('Failed to search memories:', error.message);
            return [];
        }
    }

    /**
     * SECTION 2j: REMOVE MEMORY
     * Deletes a specific memory by ID
     */
    async removeMemory(memoryId, userId) {
        try {
            const success = await removeMemory(memoryId, userId);
            return success;
        } catch (error) {
            console.error('Failed to remove memory:', error.message);
            return false;
        }
    }

    /**
     * SECTION 2k: GET CHANNEL CONVERSATION CONTEXT
     * Gets conversation history from a channel for multi-person chats
     * This helps the AI understand the flow of conversation between multiple users
     */
    async getChannelContext(channelId, limit = 15) {
        try {
            const messages = await getChannelMessages(channelId, limit);
            
            // Reverse to get chronological order (oldest first)
            const chronologicalMessages = messages.reverse();
            
            return chronologicalMessages.map(msg => ({
                content: msg.content,
                author: msg.author_name,
                authorId: msg.author_id,
                type: msg.message_type,
                timestamp: msg.created_at
            }));
        } catch (error) {
            console.error('Failed to get channel context:', error.message);
            return [];
        }
    }

    /**
     * SECTION 2l: READY CHECK
     * Check if the context manager is initialized and ready to use
     */
    isReady() {
        return this.isInitialized;
    }
}

// Create and export a singleton instance
const semanticContextManager = new SemanticContextManager();

export default semanticContextManager;