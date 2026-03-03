/*══════════════════════════════════════════════════════════════════════════*
 * EMBEDDINGS - Text Similarity & Embedding Functions
 * Provides local text-based embeddings and similarity calculations
 * Used for semantic search without external AI APIs
 * ───────────────────────────────────────────────────────────────────────────────*/

// SECTION 1: Configuration
const EMBEDDING_DIMENSION = 512;

const EMBEDDING_DIMENSION = 512;

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 2: EMBEDDING GENERATION FUNCTIONS
 * ───────────────────────────────────────────────────────────────────────────────*/

/**
 * generateEmbedding()
 * Creates a simple hash-based embedding vector for text
 * NOTE: This is a fallback - not semantically meaningful!
 * Real embeddings would use OpenAI or similar AI service
 * 
 * @param {string} text - Text to generate embedding for
 * @returns {number[]} Array of 512 floating-point numbers
 */
export function generateEmbedding(text) {
    const embedding = new Array(EMBEDDING_DIMENSION).fill(0);
    
    // Simple hash-based embedding (not semantically meaningful)
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        const index = char % EMBEDDING_DIMENSION;
        embedding[index] += 1;
    }
    
    // Normalize the embedding
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0)) || 1;
    return embedding.map(val => val / norm);
}

/**
 * generateBatchEmbeddings()
 * Generate embeddings for multiple texts at once
 * 
 * @param {string[]} texts - Array of texts to generate embeddings for
 * @returns {number[][]} Array of embedding arrays
 */
export function generateBatchEmbeddings(texts) {
    return texts.map(text => generateEmbedding(text));
}

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 3: SIMILARITY CALCULATION FUNCTIONS
 * ───────────────────────────────────────────────────────────────────────────────*/

/**
 * calculateCosineSimilarity()
 * Measures how similar two embedding vectors are (0-1 scale)
 * Uses dot product formula: (A·B) / (||A|| × ||B||)
 * 
 * @param {number[]} embedding1 - First embedding vector
 * @param {number[]} embedding2 - Second embedding vector
 * @returns {number} Similarity score between 0 and 1
 */
export function calculateCosineSimilarity(embedding1, embedding2) {
    if (embedding1.length !== embedding2.length) {
        return 0;
    }
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < embedding1.length; i++) {
        dotProduct += embedding1[i] * embedding2[i];
        norm1 += embedding1[i] * embedding1[i];
        norm2 += embedding2[i] * embedding2[i];
    }
    
    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * calculateTextSimilarity()
 * Compares two texts using word overlap (Jaccard) + length similarity
 * This is the main similarity function used for context matching
 * 
 * @param {string} text1 - First text to compare
 * @param {string} text2 - Second text to compare
 * @returns {number} Similarity score between 0 and 1
 */
export function calculateTextSimilarity(text1, text2) {
    const words1 = text1.toLowerCase().split(/\s+/);
    const words2 = text2.toLowerCase().split(/\s+/);
    
    // Calculate word overlap
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    const jaccardSimilarity = intersection.size / union.size;
    
    // Length similarity (penalize very different lengths)
    const lengthDiff = Math.abs(words1.length - words2.length);
    const maxLength = Math.max(words1.length, words2.length);
    const lengthSimilarity = maxLength === 0 ? 1 : Math.max(0, 1 - lengthDiff / maxLength);
    
    // Combined similarity
    return (jaccardSimilarity + lengthSimilarity) / 2;
}

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 4: SERVICE TESTING
 * ───────────────────────────────────────────────────────────────────────────────*/

/**
 * testEmbeddingService()
 * Verifies the embedding service is working
 * @returns {Promise<boolean>} True if service is working
 */
export async function testEmbeddingService() {
    try {
        console.log('Testing text-based embedding service...');
        
        const testText = 'This is a test sentence for embedding generation.';
        const embedding = generateEmbedding(testText);
        
        if (!embedding || embedding.length !== EMBEDDING_DIMENSION) {
            console.error('Embedding service test failed');
            return false;
        }
        
        console.log('Text-based embedding service working correctly');
        console.log(`   Generated ${embedding.length}D embedding (local)`);
        
        return true;
    } catch (error) {
        console.error('Embedding service test failed:', error.message);
        return false;
    }
}

export { EMBEDDING_DIMENSION };