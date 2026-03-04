"""Embeddings module for semantic search using sentence transformers."""
import numpy as np
import logging
from typing import List, Optional, Dict, Any
import config

logger = logging.getLogger(__name__)

# Global model instance
_model = None


def get_embedding_model():
    """Get or load the sentence transformer model."""
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
            # Using a lightweight model for efficiency
            _model = SentenceTransformer('all-MiniLM-L6-v2')
            logger.info("Embedding model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load embedding model: {e}")
            return None
    return _model


def get_embedding(text: str) -> Optional[np.ndarray]:
    """Get embedding vector for text."""
    model = get_embedding_model()
    if model is None:
        return None
    
    try:
        embedding = model.encode(text, convert_to_numpy=True)
        return embedding
    except Exception as e:
        logger.error(f"Failed to get embedding: {e}")
        return None


def get_embeddings_batch(texts: List[str]) -> List[Optional[np.ndarray]]:
    """Get embeddings for multiple texts."""
    model = get_embedding_model()
    if model is None:
        return [None] * len(texts)
    
    try:
        embeddings = model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
        return list(embeddings)
    except Exception as e:
        logger.error(f"Failed to get batch embeddings: {e}")
        return [None] * len(texts)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Calculate cosine similarity between two vectors."""
    try:
        dot_product = np.dot(a, b)
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        
        if norm_a == 0 or norm_b == 0:
            return 0.0
            
        return float(dot_product / (norm_a * norm_b))
    except Exception as e:
        logger.error(f"Failed to calculate cosine similarity: {e}")
        return 0.0


def find_similar_messages(
    query_embedding: np.ndarray,
    messages_with_embeddings: List[Dict[str, Any]],
    threshold: float = None,
    top_k: int = 10
) -> List[Dict[str, Any]]:
    """Find similar messages based on embedding similarity."""
    if threshold is None:
        threshold = config.CONTEXT_SIMILARITY_THRESHOLD
    
    similarities = []
    
    for msg in messages_with_embeddings:
        if msg.get('embedding') is None:
            continue
            
        try:
            # Convert bytes back to numpy array
            embedding = np.frombuffer(msg['embedding'], dtype=np.float32)
            similarity = cosine_similarity(query_embedding, embedding)
            
            if similarity >= threshold:
                similarities.append({
                    **msg,
                    'similarity': similarity
                })
        except Exception as e:
            logger.error(f"Failed to compare embeddings: {e}")
            continue
    
    # Sort by similarity and return top k
    similarities.sort(key=lambda x: x['similarity'], reverse=True)
    return similarities[:top_k]


def embedding_to_bytes(embedding: np.ndarray) -> bytes:
    """Convert numpy array to bytes for storage."""
    return embedding.astype(np.float32).tobytes()


def bytes_to_embedding(data: bytes) -> np.ndarray:
    """Convert bytes back to numpy array."""
    return np.frombuffer(data, dtype=np.float32)


async def test_embedding_service() -> bool:
    """Test if embedding service is working."""
    try:
        test_text = "Hello world"
        result = get_embedding(test_text)
        return result is not None
    except Exception as e:
        logger.error(f"Embedding service test failed: {e}")
        return False
