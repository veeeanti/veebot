"""Context manager for AI semantic memory and relevant context retrieval."""
import logging
from typing import List, Dict, Any, Optional
import config
import database
import embeddings

logger = logging.getLogger(__name__)

# Global state
_initialized = False


async def initialize() -> bool:
    """Initialize the context manager."""
    global _initialized
    if config.ENABLE_DATABASE:
        await database.initialize_database()
        _initialized = True
        logger.info("Context manager initialized")
        return True
    return False


def is_ready() -> bool:
    """Check if context manager is ready."""
    return _initialized and config.ENABLE_SEMANTIC_SEARCH


async def get_relevant_context(
    user_input: str,
    guild_id: Optional[str],
    author_id: str,
    limit: int = None
) -> List[Dict[str, Any]]:
    """Get relevant context from past messages based on semantic similarity."""
    if not is_ready():
        return []
    
    if limit is None:
        limit = config.MAX_CONTEXT_MESSAGES
    
    try:
        # Get embedding for the input
        query_embedding = embeddings.get_embedding(user_input)
        if query_embedding is None:
            logger.warning("Failed to get query embedding")
            return []
        
        # Get recent messages from the guild
        messages = await database.get_all_messages(guild_id=guild_id, limit=limit)
        
        if not messages:
            return []
        
        # Find similar messages
        similar_messages = embeddings.find_similar_messages(
            query_embedding=query_embedding,
            messages_with_embeddings=messages,
            threshold=config.CONTEXT_SIMILARITY_THRESHOLD,
            top_k=10
        )
        
        return similar_messages
        
    except Exception as e:
        logger.error(f"Failed to get relevant context: {e}")
        return []


async def store_user_message(
    discord_message_id: str,
    content: str,
    author_id: str,
    author_name: str,
    channel_id: str,
    guild_id: Optional[str]
) -> bool:
    """Store a user message with optional embedding."""
    if not config.ENABLE_DATABASE:
        return False
    
    embedding_bytes = None
    
    if config.ENABLE_SEMANTIC_SEARCH:
        embedding = embeddings.get_embedding(content)
        if embedding is not None:
            embedding_bytes = embeddings.embedding_to_bytes(embedding)
    
    return await database.store_message(
        discord_message_id=discord_message_id,
        content=content,
        author_id=author_id,
        author_name=author_name,
        channel_id=channel_id,
        guild_id=guild_id,
        message_type="user",
        embedding=embedding_bytes
    )


async def store_assistant_message(
    discord_message_id: str,
    content: str,
    channel_id: str,
    guild_id: Optional[str]
) -> bool:
    """Store an assistant (bot) message."""
    if not config.ENABLE_DATABASE:
        return False
    
    return await database.store_message(
        discord_message_id=discord_message_id,
        content=content,
        author_id="assistant",
        author_name="veebot",
        channel_id=channel_id,
        guild_id=guild_id,
        message_type="assistant",
        embedding=None
    )


async def store_memory(
    user_id: str,
    author_name: str,
    memory_content: str,
    guild_id: Optional[str]
) -> bool:
    """Store an important memory."""
    if not config.ENABLE_DATABASE:
        return False
    
    embedding_bytes = None
    
    if config.ENABLE_SEMANTIC_SEARCH:
        embedding = embeddings.get_embedding(memory_content)
        if embedding is not None:
            embedding_bytes = embeddings.embedding_to_bytes(embedding)
    
    return await database.store_memory(
        user_id=user_id,
        username=author_name,
        memory=memory_content,
        guild_id=guild_id,
        embedding=embedding_bytes
    )


async def get_memories(user_id: str, guild_id: Optional[str] = None) -> List[Dict]:
    """Get stored memories for a user."""
    if not config.ENABLE_DATABASE:
        return []
    
    return await database.get_memories(user_id, guild_id)


async def remove_memory(memory_id: int, user_id: str) -> bool:
    """Remove a stored memory."""
    if not config.ENABLE_DATABASE:
        return False
    
    return await database.remove_memory(memory_id, user_id)


async def get_statistics() -> Dict[str, Any]:
    """Get context manager statistics."""
    if not config.ENABLE_DATABASE:
        return {
            "total_messages": 0,
            "messages_with_embeddings": 0,
            "unique_channels": 0,
        }
    
    return await database.get_database_statistics()
