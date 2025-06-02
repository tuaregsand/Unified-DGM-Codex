import { ExecutionPlan } from '../../types';

// For embeddings, a lightweight model or an API call would be needed.
// Placeholder for an embedding function.
async function getEmbeddingForRequest(request: string): Promise<number[]> {
  console.log(`[ReasoningCache] Generating embedding for request: "${request.substring(0, 50)}..."`);
  // In a real implementation, use an actual embedding model (e.g., Sentence Transformers via API, or a local model)
  // For now, return a random vector of a fixed dimension.
  const dimension = 768; // Example dimension
  return Array(dimension).fill(0).map(() => Math.random());
}

// Simple cosine similarity function
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface ReasoningCacheConfig {
  maxEntries: number; // Max number of entries (conceptual, Redis manages memory)
  similarityThreshold: number;
  redisUrl?: string;
  cachePrefix?: string;
  embeddingDimension?: number;
}

interface CachedReasoningItem {
  request: string;
  embedding: number[];
  plan: ExecutionPlan;
  timestamp: number;
  accessCount: number;
  successRate?: number; // Track how successful this reasoning pattern has been
}

export class ReasoningCache {
  private client: any; // Using any to avoid Redis type issues
  private similarityThreshold: number;
  private cachePrefix: string;
  private embeddingDimension: number;
  private isConnected: boolean = false;
  // In-memory cache for embeddings to avoid recomputing for recently seen requests
  private localEmbeddingCache: Map<string, number[]>; 

  constructor(config: ReasoningCacheConfig) {
    this.similarityThreshold = config.similarityThreshold;
    this.cachePrefix = config.cachePrefix || 'reasoning_cache';
    this.embeddingDimension = config.embeddingDimension || 768;
    this.localEmbeddingCache = new Map();

    const redisOptions: any = {};
    if (config.redisUrl) {
      redisOptions.url = config.redisUrl;
    }

    // Dynamic import to handle Redis client
    this.initRedisClient(redisOptions);
  }

  private async initRedisClient(redisOptions: any): Promise<void> {
    try {
      const { createClient } = await import('redis');
      this.client = createClient(redisOptions);
      this.client.on('error', (err: any) => console.error('[ReasoningCache] Redis Client Error', err));
      await this.connectClient();
    } catch (error) {
      console.warn('[ReasoningCache] Redis not available, using in-memory fallback');
      this.client = new Map(); // Fallback to in-memory
      this.isConnected = true;
    }
  }

  private async connectClient(): Promise<void> {
    if (this.client.connect) {
      try {
        await this.client.connect();
        this.isConnected = true;
        console.log('[ReasoningCache] Connected to Redis successfully.');
      } catch (err) {
        console.error('[ReasoningCache] Could not connect to Redis:', err);
        // Fallback to in-memory
        this.client = new Map();
        this.isConnected = true;
      }
    }
  }

  public async getEmbedding(request: string): Promise<number[]> {
    // Check local cache first
    if (this.localEmbeddingCache.has(request)) {
      return this.localEmbeddingCache.get(request)!;
    }
    
    const embedding = await getEmbeddingForRequest(request);
    this.localEmbeddingCache.set(request, embedding);
    
    // Optional: Evict older entries from localEmbeddingCache if it grows too large
    if (this.localEmbeddingCache.size > 1000) { // Example limit
      const oldestKey = this.localEmbeddingCache.keys().next().value;
      if (oldestKey) {
        this.localEmbeddingCache.delete(oldestKey);
      }
    }
    
    return embedding;
  }

  async findSimilar(request: string): Promise<ExecutionPlan | null> {
    if (!this.isConnected) return null;

    const requestEmbedding = await this.getEmbedding(request);
    
    // Handle Redis client
    if (this.client.keys) {
      return this.findSimilarRedis(request, requestEmbedding);
    } else {
      return this.findSimilarMemory(request, requestEmbedding);
    }
  }

  private async findSimilarRedis(request: string, requestEmbedding: number[]): Promise<ExecutionPlan | null> {
    let similarPlan: ExecutionPlan | null = null;
    let highestSimilarity = -1;

    try {
      const keys = await this.client.keys(`${this.cachePrefix}:*`);
      for (const key of keys) {
        const storedItemJson = await this.client.get(key);
        if (storedItemJson) {
          const storedItem: CachedReasoningItem = JSON.parse(storedItemJson);
          const similarity = cosineSimilarity(requestEmbedding, storedItem.embedding);
          
          if (similarity >= this.similarityThreshold && similarity > highestSimilarity) {
            highestSimilarity = similarity;
            similarPlan = storedItem.plan;
            
            // Update access count
            storedItem.accessCount += 1;
            await this.client.set(key, JSON.stringify(storedItem));
            
            console.log(`[ReasoningCache] Found similar cached item for "${request.substring(0, 30)}..." with key ${key} (similarity: ${similarity.toFixed(2)})`);
          }
        }
      }
    } catch (error) {
      console.error('[ReasoningCache] Error finding similar plans in Redis:', error);
    }
    
    if (similarPlan) {
      console.log(`[ReasoningCache] Using cached plan with similarity ${highestSimilarity.toFixed(2)}.`);
    } else {
      console.log(`[ReasoningCache] No sufficiently similar plan found in cache for "${request.substring(0, 30)}...".`);
    }
    return similarPlan;
  }

  private async findSimilarMemory(request: string, requestEmbedding: number[]): Promise<ExecutionPlan | null> {
    let similarPlan: ExecutionPlan | null = null;
    let highestSimilarity = -1;

    // Iterate over in-memory Map
    for (const [key, value] of this.client.entries()) {
      if (key.startsWith(this.cachePrefix)) {
        const storedItem: CachedReasoningItem = value;
        const similarity = cosineSimilarity(requestEmbedding, storedItem.embedding);
        
        if (similarity >= this.similarityThreshold && similarity > highestSimilarity) {
          highestSimilarity = similarity;
          similarPlan = storedItem.plan;
          
          // Update access count
          storedItem.accessCount += 1;
          this.client.set(key, storedItem);
          
          console.log(`[ReasoningCache] Found similar cached item in memory for "${request.substring(0, 30)}..." (similarity: ${similarity.toFixed(2)})`);
        }
      }
    }
    
    return similarPlan;
  }

  async store(request: string, requestEmbedding: number[], plan: ExecutionPlan): Promise<void> {
    if (!this.isConnected) return;

    // Using a hash of the request as part of the key for uniqueness
    const crypto = await import('crypto');
    const requestHash = crypto.createHash('sha256').update(request).digest('hex');
    const key = `${this.cachePrefix}:${requestHash}`;
    
    const itemToCache: CachedReasoningItem = {
      request,
      embedding: requestEmbedding,
      plan,
      timestamp: Date.now(),
      accessCount: 1,
      successRate: undefined // Will be updated later based on execution results
    };

    try {
      if (this.client.set && typeof this.client.set === 'function') {
        // Redis client
        await this.client.set(key, JSON.stringify(itemToCache));
      } else {
        // In-memory fallback
        this.client.set(key, itemToCache);
      }
      console.log(`[ReasoningCache] Stored reasoning for request hash: ${requestHash}`);
    } catch (error) {
      console.error(`[ReasoningCache] Error storing reasoning for key ${key}:`, error);
    }
  }

  async updateSuccessRate(request: string, successRate: number): Promise<void> {
    if (!this.isConnected) return;

    const crypto = await import('crypto');
    const requestHash = crypto.createHash('sha256').update(request).digest('hex');
    const key = `${this.cachePrefix}:${requestHash}`;

    try {
      let storedItem: CachedReasoningItem | null = null;
      
      if (this.client.get && typeof this.client.get === 'function') {
        const storedItemJson = await this.client.get(key);
        if (storedItemJson) {
          storedItem = JSON.parse(storedItemJson);
        }
      } else {
        storedItem = this.client.get(key);
      }

      if (storedItem) {
        storedItem.successRate = successRate;
        
        if (this.client.set && typeof this.client.set === 'function') {
          await this.client.set(key, JSON.stringify(storedItem));
        } else {
          this.client.set(key, storedItem);
        }
        console.log(`[ReasoningCache] Updated success rate for ${requestHash}: ${successRate}`);
      }
    } catch (error) {
      console.error(`[ReasoningCache] Error updating success rate for key ${key}:`, error);
    }
  }

  async getStats(): Promise<any> {
    if (!this.isConnected) return { connected: false };

    try {
      let totalEntries = 0;
      let totalAccessCount = 0;
      let avgSuccessRate = 0;
      let successfulEntries = 0;

      if (this.client.keys) {
        // Redis
        const keys = await this.client.keys(`${this.cachePrefix}:*`);
        totalEntries = keys.length;

        for (const key of keys) {
          const storedItemJson = await this.client.get(key);
          if (storedItemJson) {
            const item: CachedReasoningItem = JSON.parse(storedItemJson);
            totalAccessCount += item.accessCount;
            if (item.successRate !== undefined) {
              avgSuccessRate += item.successRate;
              successfulEntries++;
            }
          }
        }
      } else {
        // In-memory
        for (const [key, value] of this.client.entries()) {
          if (key.startsWith(this.cachePrefix)) {
            totalEntries++;
            const item: CachedReasoningItem = value;
            totalAccessCount += item.accessCount;
            if (item.successRate !== undefined) {
              avgSuccessRate += item.successRate;
              successfulEntries++;
            }
          }
        }
      }

      return {
        connected: true,
        totalEntries,
        totalAccessCount,
        avgAccessPerEntry: totalEntries > 0 ? totalAccessCount / totalEntries : 0,
        avgSuccessRate: successfulEntries > 0 ? avgSuccessRate / successfulEntries : 0,
        embeddingCacheSize: this.localEmbeddingCache.size
      };
    } catch (error) {
      console.error('[ReasoningCache] Error getting stats:', error);
      return { connected: true, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async clearOldEntries(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    // Clear entries older than maxAge (default 7 days)
    if (!this.isConnected) return;

    const cutoffTime = Date.now() - maxAge;
    let deletedCount = 0;

    try {
      if (this.client.keys) {
        // Redis
        const keys = await this.client.keys(`${this.cachePrefix}:*`);
        for (const key of keys) {
          const storedItemJson = await this.client.get(key);
          if (storedItemJson) {
            const item: CachedReasoningItem = JSON.parse(storedItemJson);
            if (item.timestamp < cutoffTime) {
              await this.client.del(key);
              deletedCount++;
            }
          }
        }
      } else {
        // In-memory
        for (const [key, value] of this.client.entries()) {
          if (key.startsWith(this.cachePrefix)) {
            const item: CachedReasoningItem = value;
            if (item.timestamp < cutoffTime) {
              this.client.delete(key);
              deletedCount++;
            }
          }
        }
      }

      console.log(`[ReasoningCache] Cleared ${deletedCount} old entries`);
    } catch (error) {
      console.error('[ReasoningCache] Error clearing old entries:', error);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.client.quit && typeof this.client.quit === 'function') {
      try {
        await this.client.quit();
        console.log('[ReasoningCache] Disconnected from Redis.');
      } catch (error) {
        console.error('[ReasoningCache] Error disconnecting from Redis:', error);
      }
    }
    this.isConnected = false;
  }

  async isHealthy(): Promise<boolean> {
    if (!this.isConnected) return false;
    
    try {
      if (this.client.ping && typeof this.client.ping === 'function') {
        await this.client.ping();
        return true;
      }
      return true; // In-memory is always "healthy"
    } catch (error) {
      console.error('[ReasoningCache] Health check failed:', error);
      return false;
    }
  }
} 