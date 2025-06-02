// FAISS Vector Index System for Llama 4 Scout
import * as fs from 'fs/promises';
import * as path from 'path';

// Note: faiss-node might have different API, this is a general implementation
// In production, verify exact API with the installed faiss-node version
let faiss: any;
try {
  faiss = require('faiss-node');
} catch (error) {
  console.warn('[FaissIndex] faiss-node not available, using mock implementation');
  faiss = null;
}

interface FaissIndexConfig {
  dimensions: number;
  nlist?: number; // For IVF_FLAT, number of clusters
  nprobe?: number; // For IVF_FLAT, number of probes during search
  filePath?: string; // Path to save/load the index
}

// Define a structure for metadata associated with vectors
interface VectorMetadata {
  id: string; // Unique identifier for the chunk
  source: string; // e.g., file path
  text: string; // The actual chunk content
  startPos?: number; // Start position in original file
  endPos?: number; // End position in original file
}

interface SearchResult {
  id: string;
  score: number;
  metadata?: VectorMetadata;
}

export class FaissIndex {
  private index: any | null = null;
  private dimension: number;
  private nlist: number;
  private nprobe: number;
  private filePath: string | null;
  private metadataStore: Map<number, VectorMetadata>;
  private nextId: number;
  private isInitialized: boolean = false;

  constructor(config: FaissIndexConfig) {
    this.dimension = config.dimensions;
    this.nlist = config.nlist || 100;
    this.nprobe = config.nprobe || 10;
    this.filePath = config.filePath || null;
    this.metadataStore = new Map();
    this.nextId = 0;

    this.initializeIndex();
  }

  private async initializeIndex(): Promise<void> {
    try {
      // Try to load existing index
      if (this.filePath && await this.fileExists(this.filePath)) {
        await this.loadIndex();
      } else {
        this.createNewIndex();
      }
      this.isInitialized = true;
    } catch (error) {
      console.error('[FaissIndex] Error initializing index:', error);
      this.createNewIndex();
      this.isInitialized = true;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async loadIndex(): Promise<void> {
    if (!faiss || !this.filePath) return;

    try {
      // Load FAISS index
      this.index = faiss.IndexFlatL2.read(this.filePath);
      
      // Load metadata
      const metadataPath = this.filePath + '.metadata.json';
      if (await this.fileExists(metadataPath)) {
        const metadataContent = await fs.readFile(metadataPath, 'utf-8');
        const metadataArray = JSON.parse(metadataContent);
        
        this.metadataStore = new Map(metadataArray);
        this.nextId = Math.max(...this.metadataStore.keys(), 0) + 1;
      }
      
      console.log(`[FaissIndex] Index loaded from ${this.filePath}. Total vectors: ${this.index.ntotal()}`);
    } catch (error) {
      console.warn(`[FaissIndex] Failed to load index from ${this.filePath}, creating new one. Error:`, error);
      this.createNewIndex();
    }
  }

  private createNewIndex(): void {
    if (!faiss) {
      console.log('[FaissIndex] Using mock index (faiss-node not available)');
      this.index = new MockFaissIndex(this.dimension);
      return;
    }

    try {
      // Create IndexFlatL2 for exact search (good for smaller datasets)
      // For larger datasets, consider IndexIVFFlat after training
      this.index = new faiss.IndexFlatL2(this.dimension);
      console.log(`[FaissIndex] New IndexFlatL2 created with dimension ${this.dimension}`);
    } catch (error) {
      console.error('[FaissIndex] Error creating FAISS index:', error);
      this.index = new MockFaissIndex(this.dimension);
    }
  }

  public async addVectors(embeddings: number[][], metadatas: VectorMetadata[]): Promise<void> {
    if (!this.isInitialized) {
      await this.waitForInitialization();
    }

    if (!this.index) throw new Error("Index not initialized.");
    if (embeddings.length === 0) return;
    if (embeddings.length !== metadatas.length) {
      throw new Error("Embeddings and metadatas count mismatch.");
    }

    try {
      // Store metadata first
      const idsToAdd: number[] = [];
      for (let i = 0; i < metadatas.length; i++) {
        const internalId = this.nextId++;
        this.metadataStore.set(internalId, metadatas[i]);
        idsToAdd.push(internalId);
      }

      // Add vectors to FAISS index
      if (faiss && this.index.add) {
        // Convert to Float32Array format expected by FAISS
        const vectorsFlat = embeddings.flat();
        const vectorsFloat32 = new Float32Array(vectorsFlat);
        this.index.add(vectorsFloat32);
      } else {
        // Mock implementation
        (this.index as MockFaissIndex).add(embeddings, idsToAdd);
      }

      console.log(`[FaissIndex] Added ${embeddings.length} vectors. Total vectors: ${this.ntotal()}`);
      
      // Auto-save after adding vectors
      if (this.filePath) {
        await this.saveIndex();
      }
    } catch (error) {
      console.error('[FaissIndex] Error adding vectors:', error);
      throw error;
    }
  }

  public async search(queryEmbedding: number[], topK: number): Promise<SearchResult[]> {
    if (!this.isInitialized) {
      await this.waitForInitialization();
    }

    if (!this.index || this.ntotal() === 0) {
      console.warn("[FaissIndex] Search called on empty or uninitialized index.");
      return [];
    }

    try {
      let labels: number[];
      let distances: number[];

      if (faiss && this.index.search) {
        // Real FAISS search
        const queryVectorFloat32 = new Float32Array(queryEmbedding);
        const results = this.index.search(queryVectorFloat32, topK);
        labels = Array.from(results.labels);
        distances = Array.from(results.distances);
      } else {
        // Mock search
        const results = (this.index as MockFaissIndex).search(queryEmbedding, topK);
        labels = results.labels;
        distances = results.distances;
      }

      console.log(`[FaissIndex] Search completed - Found ${labels.length} results`);

      // Map results to SearchResult format
      return labels
        .map((label, i) => ({
          id: this.metadataStore.get(label)?.id || `faiss_id_${label}`,
          score: distances[i],
          metadata: this.metadataStore.get(label)
        }))
        .filter(result => result.metadata !== undefined)
        .sort((a, b) => a.score - b.score); // Sort by similarity (lower distance = higher similarity)
    } catch (error) {
      console.error('[FaissIndex] Error during search:', error);
      return [];
    }
  }

  public async saveIndex(): Promise<void> {
    if (!this.filePath || !this.index) return;

    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });

      // Save FAISS index
      if (faiss && this.index.write) {
        this.index.write(this.filePath);
      }

      // Save metadata
      const metadataPath = this.filePath + '.metadata.json';
      const metadataArray = Array.from(this.metadataStore.entries());
      await fs.writeFile(metadataPath, JSON.stringify(metadataArray, null, 2));

      console.log(`[FaissIndex] Index and metadata saved to ${this.filePath}`);
    } catch (error) {
      console.error(`[FaissIndex] Error saving index to ${this.filePath}:`, error);
    }
  }

  // Utility methods
  getDimension(): number {
    return this.dimension;
  }

  isTrained(): boolean {
    if (!this.index) return false;
    return this.index.isTrained ? this.index.isTrained() : true; // Mock always returns true
  }

  ntotal(): number {
    if (!this.index) return 0;
    return this.index.ntotal ? this.index.ntotal() : (this.index as MockFaissIndex).size();
  }

  private async waitForInitialization(): Promise<void> {
    while (!this.isInitialized) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

// Mock implementation for when faiss-node is not available
class MockFaissIndex {
  private vectors: number[][] = [];
  private ids: number[] = [];
  private dimension: number;

  constructor(dimension: number) {
    this.dimension = dimension;
  }

  add(embeddings: number[][], ids: number[]): void {
    this.vectors.push(...embeddings);
    this.ids.push(...ids);
  }

  search(queryEmbedding: number[], topK: number): { labels: number[], distances: number[] } {
    if (this.vectors.length === 0) {
      return { labels: [], distances: [] };
    }

    // Simple cosine similarity search
    const similarities = this.vectors.map((vector, index) => ({
      index,
      id: this.ids[index],
      similarity: this.cosineSimilarity(queryEmbedding, vector)
    }));

    // Sort by similarity (descending) and take top K
    similarities.sort((a, b) => b.similarity - a.similarity);
    const topResults = similarities.slice(0, topK);

    return {
      labels: topResults.map(r => r.id),
      distances: topResults.map(r => 1 - r.similarity) // Convert similarity to distance
    };
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;
    
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

  size(): number {
    return this.vectors.length;
  }

  ntotal(): number {
    return this.size();
  }

  isTrained(): boolean {
    return true;
  }
} 