// Hierarchical Cache Manager for Llama 4 Scout
import { createClient, RedisClientOptions } from 'redis';

interface HierarchicalCacheConfig {
  levels: string[]; // e.g., ['project', 'module', 'file', 'function']
  ttl: number; // Default TTL in seconds
  maxSize?: string; // Informational, Redis manages memory via its own policies
  redisUrl?: string;
  keyPrefix?: string;
}

interface CacheEntry {
  data: any;
  timestamp: number;
  accessCount: number;
  level: string;
}

export class HierarchicalCache {
  private client: any; // Using any to avoid Redis type issues
  private levels: string[];
  private defaultTTL: number;
  private keyPrefix: string;
  private isConnected: boolean = false;

  constructor(config: HierarchicalCacheConfig) {
    this.levels = config.levels;
    this.defaultTTL = config.ttl;
    this.keyPrefix = config.keyPrefix || 'unified_dgm_cache';
    
    const redisOptions: RedisClientOptions = {};
    if (config.redisUrl) {
      redisOptions.url = config.redisUrl;
    }

    this.client = createClient(redisOptions);

    this.client.on('error', (err: any) => {
      console.error('[HierarchicalCache] Redis Client Error:', err);
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      console.log('[HierarchicalCache] Connected to Redis');
      this.isConnected = true;
    });

    this.client.on('ready', () => {
      console.log('[HierarchicalCache] Redis client ready');
      this.isConnected = true;
    });

    this.client.on('end', () => {
      console.log('[HierarchicalCache] Redis connection ended');
      this.isConnected = false;
    });

    this.connectClient();
  }

  private async connectClient(): Promise<void> {
    if (!this.client.isOpen) {
      try {
        await this.client.connect();
        console.log('[HierarchicalCache] Successfully connected to Redis');
      } catch (err) {
        console.error('[HierarchicalCache] Could not connect to Redis:', err);
        console.log('[HierarchicalCache] Operating in no-cache mode');
      }
    }
  }
  
  private buildCacheKey(keyParts: string[]): string {
    // Build hierarchical key like "unified_dgm_cache:project_A:module_B:file_C.ts:function_D"
    // The number of parts should ideally align with the defined levels
    const cleanedParts = keyParts.map(part => part.replace(/[^a-zA-Z0-9_.-]/g, '_'));
    return `${this.keyPrefix}:${cleanedParts.join(':')}`;
  }

  private getEntryLevel(keyParts: string[]): string {
    // Determine cache level based on key depth
    const levelIndex = Math.min(keyParts.length - 1, this.levels.length - 1);
    return this.levels[levelIndex] || 'unknown';
  }

  async get(keyParts: string[]): Promise<any | null> {
    if (!this.isConnected) {
      console.warn('[HierarchicalCache] Redis not connected, cache miss');
      return null;
    }

    const key = this.buildCacheKey(keyParts);
    
    try {
      const value = await this.client.get(key);
      
      if (value) {
        const entry: CacheEntry = JSON.parse(value);
        
        // Update access count
        entry.accessCount = (entry.accessCount || 0) + 1;
        
        // Update the entry with new access count (fire and forget)
        this.client.set(key, JSON.stringify(entry), {
          EX: this.defaultTTL,
          NX: false // Update existing
        }).catch((err: any) => console.warn('[HierarchicalCache] Failed to update access count:', err));

        console.log(`[HierarchicalCache] Cache HIT for key: ${key} (level: ${entry.level}, access: ${entry.accessCount})`);
        return entry.data;
      }
      
      console.log(`[HierarchicalCache] Cache MISS for key: ${key}`);
      return null;
    } catch (error) {
      console.error(`[HierarchicalCache] Error getting cache for key ${key}:`, error);
      return null;
    }
  }

  async set(keyParts: string[], value: any, ttl?: number): Promise<void> {
    if (!this.isConnected) {
      console.warn('[HierarchicalCache] Redis not connected, cannot cache');
      return;
    }

    const key = this.buildCacheKey(keyParts);
    const effectiveTTL = ttl || this.defaultTTL;
    const level = this.getEntryLevel(keyParts);
    
    const entry: CacheEntry = {
      data: value,
      timestamp: Date.now(),
      accessCount: 1,
      level
    };

    try {
      await this.client.set(key, JSON.stringify(entry), {
        EX: effectiveTTL,
      });
      
      console.log(`[HierarchicalCache] Cached value for key: ${key} (level: ${level}, TTL: ${effectiveTTL}s)`);
      
      // Update level statistics (fire and forget)
      this.updateLevelStats(level).catch((err: any) => 
        console.warn('[HierarchicalCache] Failed to update level stats:', err)
      );
      
    } catch (error) {
      console.error(`[HierarchicalCache] Error setting cache for key ${key}:`, error);
    }
  }

  async invalidate(keyPartsPattern: string[]): Promise<void> {
    if (!this.isConnected) {
      console.warn('[HierarchicalCache] Redis not connected, cannot invalidate');
      return;
    }

    // Build pattern for cache invalidation
    const pattern = this.buildCacheKey(keyPartsPattern) + '*';
    
    console.log(`[HierarchicalCache] Invalidating keys matching pattern: ${pattern}`);
    
    try {
      let cursor = '0'; // Start with string cursor
      let totalDeleted = 0;

      do {
        const reply = await this.client.scan(cursor, { 
          MATCH: pattern, 
          COUNT: 100 
        });
        
        cursor = reply.cursor;
        const keys = reply.keys;
        
        if (keys.length > 0) {
          await this.client.del(keys);
          totalDeleted += keys.length;
          console.log(`[HierarchicalCache] Deleted ${keys.length} keys in batch`);
        }
      } while (cursor !== '0');
      
      console.log(`[HierarchicalCache] Total invalidated: ${totalDeleted} keys`);
    } catch (error) {
      console.error(`[HierarchicalCache] Error during invalidation:`, error);
    }
  }

  async warmup(hotPathsQueries: Array<{keyParts: string[], queryPayload?: any}>): Promise<void> {
    if (!this.isConnected) {
      console.warn('[HierarchicalCache] Redis not connected, cannot warmup');
      return;
    }

    console.log(`[HierarchicalCache] Starting cache warmup for ${hotPathsQueries.length} hot paths...`);
    
    let warmedUp = 0;
    let alreadyCached = 0;

    for (const item of hotPathsQueries) {
      try {
        const existingValue = await this.get(item.keyParts);
        
        if (existingValue) {
          alreadyCached++;
          continue;
        }

        // For actual warmup, we would need the query function or pre-computed data
        // This is a placeholder that demonstrates the structure
        const warmupData = {
          type: 'warmup_placeholder',
          keyParts: item.keyParts,
          payload: item.queryPayload,
          warmedAt: new Date().toISOString()
        };

        await this.set(item.keyParts, warmupData, this.defaultTTL * 2); // Longer TTL for warmup data
        warmedUp++;
        
        console.log(`[HierarchicalCache] Warmed up: ${this.buildCacheKey(item.keyParts)}`);
      } catch (error) {
        console.error(`[HierarchicalCache] Error warming up key ${item.keyParts.join(':')}:`, error);
      }
    }
    
    console.log(`[HierarchicalCache] Cache warmup complete. Warmed: ${warmedUp}, Already cached: ${alreadyCached}`);
  }

  private async updateLevelStats(level: string): Promise<void> {
    const statsKey = `${this.keyPrefix}:stats:${level}`;
    
    try {
      await this.client.hIncrBy(statsKey, 'count', 1);
      await this.client.hSet(statsKey, 'lastAccess', Date.now().toString());
      await this.client.expire(statsKey, this.defaultTTL * 24); // Stats TTL is 24x normal TTL
    } catch (error) {
      // Ignore stats errors
    }
  }

  async getStats(): Promise<any> {
    if (!this.isConnected) {
      return { error: 'Redis not connected' };
    }

    try {
      const stats: any = {
        levels: {},
        total: {
          keys: 0,
          memory: '0MB'
        }
      };

      // Get stats for each level
      for (const level of this.levels) {
        const statsKey = `${this.keyPrefix}:stats:${level}`;
        const levelStats = await this.client.hGetAll(statsKey);
        stats.levels[level] = {
          count: parseInt(levelStats.count || '0'),
          lastAccess: levelStats.lastAccess ? new Date(parseInt(levelStats.lastAccess)) : null
        };
      }

      // Get total cache keys
      const allKeys = await this.client.keys(`${this.keyPrefix}:*`);
      stats.total.keys = allKeys.filter((key: string) => !key.includes(':stats:')).length;

      // Get Redis memory info
      const info = await this.client.info('memory');
      const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
      if (memoryMatch) {
        stats.total.memory = memoryMatch[1];
      }

      return stats;
    } catch (error: any) {
      console.error('[HierarchicalCache] Error getting stats:', error);
      return { error: error.message };
    }
  }

  async clearLevel(level: string): Promise<void> {
    if (!this.isConnected) return;

    const levelIndex = this.levels.indexOf(level);
    if (levelIndex === -1) {
      console.warn(`[HierarchicalCache] Unknown level: ${level}`);
      return;
    }

    // Clear all entries at this level and below
    const pattern = `${this.keyPrefix}:*`;
    await this.invalidate([]);
    
    console.log(`[HierarchicalCache] Cleared level: ${level}`);
  }

  async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      try {
        await this.client.quit();
        console.log('[HierarchicalCache] Disconnected from Redis');
      } catch (error) {
        console.error('[HierarchicalCache] Error disconnecting from Redis:', error);
      }
    }
    this.isConnected = false;
  }

  // Health check
  async isHealthy(): Promise<boolean> {
    if (!this.isConnected) return false;

    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }
} 