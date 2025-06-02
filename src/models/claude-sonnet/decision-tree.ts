import * as fs from 'fs/promises';
import * as path from 'path';
import { ExecutionPlan } from '../../types';

// Using the same embedding function as ReasoningCache for consistency
async function getEmbeddingForText(text: string): Promise<number[]> {
  // Placeholder for actual embedding generation
  const dimension = 768; // Example dimension
  return Array(dimension).fill(0).map(() => Math.random());
}

// Simple cosine similarity (can be moved to a util if used in multiple places)
function cosineSimilarityDt(vecA: number[], vecB: number[]): number {
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

interface DecisionTreeConfig {
  maxDepth?: number; // Conceptual, not a traditional DT
  minSamplesLeaf?: number; // Conceptual
  persistPath: string;
  similarityThreshold?: number; // For matching request to stored patterns
  maxPatterns?: number;
}

// Represents a learned pattern: a request embedding mapped to a plan structure or identifier
interface LearnedPattern {
  id: string; // Unique ID for the pattern, e.g., hash of representative request
  representativeRequest: string; // The request that established this pattern
  embedding: number[]; // Embedding of the representative request
  associatedPlanStructure: Partial<ExecutionPlan>; // Or an ID to a full plan template
  usageCount: number;
  lastUsed: number;
  category?: string; // Pattern category (e.g., 'refactoring', 'feature_addition', 'debugging')
  complexity?: 'simple' | 'medium' | 'complex';
  toolTypes?: string[]; // Types of tools commonly used with this pattern
  avgSuccessRate?: number; // Success rate of this pattern
}

export interface DecisionNode {
  id: string;
  pattern: LearnedPattern;
  children?: DecisionNode[];
  parent?: string;
}

export class DecisionTree {
  private patterns: LearnedPattern[];
  private persistPath: string;
  private similarityThreshold: number;
  private maxPatterns: number;

  constructor(config: DecisionTreeConfig) {
    this.patterns = [];
    this.persistPath = config.persistPath;
    this.similarityThreshold = config.similarityThreshold || 0.9; // Higher threshold for direct pattern match
    this.maxPatterns = config.maxPatterns || 1000;
    this.loadPatterns();
  }

  private async loadPatterns(): Promise<void> {
    try {
      await fs.access(this.persistPath);
      const fileContent = await fs.readFile(this.persistPath, 'utf-8');
      this.patterns = JSON.parse(fileContent) as LearnedPattern[];
      console.log(`[DecisionTree] Patterns loaded from ${this.persistPath}. Count: ${this.patterns.length}`);
    } catch (error) {
      console.log(`[DecisionTree] No existing patterns found at ${this.persistPath} or error loading. Starting fresh.`);
      this.patterns = [];
    }
  }

  private async savePatterns(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
      await fs.writeFile(this.persistPath, JSON.stringify(this.patterns, null, 2));
      console.log(`[DecisionTree] Patterns saved to ${this.persistPath}`);
    } catch (error) {
      console.error(`[DecisionTree] Error saving patterns: ${error}`);
    }
  }

  private categorizeRequest(request: string): string {
    const lowerRequest = request.toLowerCase();
    
    if (lowerRequest.includes('refactor') || lowerRequest.includes('restructure')) {
      return 'refactoring';
    } else if (lowerRequest.includes('test') || lowerRequest.includes('spec')) {
      return 'testing';
    } else if (lowerRequest.includes('debug') || lowerRequest.includes('fix') || lowerRequest.includes('error')) {
      return 'debugging';
    } else if (lowerRequest.includes('add') || lowerRequest.includes('implement') || lowerRequest.includes('create')) {
      return 'feature_addition';
    } else if (lowerRequest.includes('optimize') || lowerRequest.includes('performance')) {
      return 'optimization';
    } else if (lowerRequest.includes('document') || lowerRequest.includes('comment')) {
      return 'documentation';
    } else {
      return 'general';
    }
  }

  private assessComplexity(request: string, plan?: ExecutionPlan): 'simple' | 'medium' | 'complex' {
    const words = request.split(' ').length;
    const stepCount = plan?.steps?.length || 0;
    
    if (words < 10 && stepCount <= 2) {
      return 'simple';
    } else if (words < 25 && stepCount <= 5) {
      return 'medium';
    } else {
      return 'complex';
    }
  }

  private extractToolTypes(plan: ExecutionPlan): string[] {
    const toolTypes = new Set<string>();
    
    for (const step of plan.steps) {
      if (step.type === 'tool_use' && step.spec?.toolName) {
        toolTypes.add(step.spec.toolName);
      } else {
        toolTypes.add(step.type);
      }
    }
    
    return Array.from(toolTypes);
  }

  async classify(request: string, requestEmbedding?: number[]): Promise<Partial<ExecutionPlan> | string | null> {
    const embeddingToCompare = requestEmbedding || await getEmbeddingForText(request);
    let bestMatch: LearnedPattern | null = null;
    let highestSimilarity = -1;

    for (const pattern of this.patterns) {
      const similarity = cosineSimilarityDt(embeddingToCompare, pattern.embedding);
      if (similarity >= this.similarityThreshold && similarity > highestSimilarity) {
        highestSimilarity = similarity;
        bestMatch = pattern;
      }
    }

    if (bestMatch) {
      console.log(`[DecisionTree] Classified request to pattern ID: ${bestMatch.id} (Similarity: ${highestSimilarity.toFixed(2)})`);
      bestMatch.usageCount += 1;
      bestMatch.lastUsed = Date.now();
      await this.savePatterns(); // Save updated usage stats
      return {
        ...bestMatch.associatedPlanStructure,
        patternId: bestMatch.id,
        category: bestMatch.category,
        complexity: bestMatch.complexity
      };
    }
    
    console.log(`[DecisionTree] No matching pattern found for request: "${request.substring(0, 30)}..."`);
    
    // Return basic classification based on keywords
    const category = this.categorizeRequest(request);
    const complexity = this.assessComplexity(request);
    
    return {
      category,
      complexity,
      isNewPattern: true
    };
  }

  async learn(request: string, requestEmbedding: number[], plan: ExecutionPlan): Promise<void> {
    // This 'learn' method adds a new pattern or updates an existing one.
    // For simplicity, we add a new pattern if no highly similar one exists.
    
    const crypto = await import('crypto');
    const patternId = crypto.createHash('sha256').update(request).digest('hex');

    // Check if a very similar pattern already exists to avoid too many granular patterns
    let existingPattern = this.patterns.find(p => 
      cosineSimilarityDt(requestEmbedding, p.embedding) > 0.98 // Very high threshold for "same"
    );

    if (existingPattern) {
      console.log(`[DecisionTree] Updating existing similar pattern ID: ${existingPattern.id}`);
      // Update the pattern with new information
      existingPattern.usageCount = (existingPattern.usageCount || 0) + 1;
      existingPattern.lastUsed = Date.now();
      
      // Update tool types if new ones are found
      const currentToolTypes = this.extractToolTypes(plan);
      const mergedToolTypes = Array.from(new Set([...(existingPattern.toolTypes || []), ...currentToolTypes]));
      existingPattern.toolTypes = mergedToolTypes;
      
      // Update complexity if it has changed
      existingPattern.complexity = this.assessComplexity(request, plan);
    } else {
      console.log(`[DecisionTree] Learning new pattern ID: ${patternId}`);
      
      const newPattern: LearnedPattern = {
        id: patternId,
        representativeRequest: request,
        embedding: requestEmbedding,
        // Store a simplified structure or key aspects of the plan
        associatedPlanStructure: { 
          steps: plan.steps.map(s => ({ 
            type: s.type, 
            spec: { toolName: (s.spec as any)?.toolName },
            description: this.categorizeRequest(s.description || '')
          }))
        },
        usageCount: 1,
        lastUsed: Date.now(),
        category: this.categorizeRequest(request),
        complexity: this.assessComplexity(request, plan),
        toolTypes: this.extractToolTypes(plan),
        avgSuccessRate: undefined // Will be updated based on execution results
      };
      
      this.patterns.push(newPattern);
    }
    
    // Prune old or rarely used patterns if the array grows too large
    if (this.patterns.length > this.maxPatterns) {
      // Sort by usage and recency, then keep top patterns
      this.patterns.sort((a, b) => {
        const scoreA = (a.usageCount || 0) * 0.7 + (Date.now() - (a.lastUsed || 0)) * -0.3;
        const scoreB = (b.usageCount || 0) * 0.7 + (Date.now() - (b.lastUsed || 0)) * -0.3;
        return scoreB - scoreA;
      });
      this.patterns = this.patterns.slice(0, this.maxPatterns);
      console.log(`[DecisionTree] Pruned patterns to ${this.maxPatterns} entries`);
    }

    await this.savePatterns();
  }

  async updateSuccessRate(patternId: string, successRate: number): Promise<void> {
    const pattern = this.patterns.find(p => p.id === patternId);
    if (pattern) {
      // Update running average
      if (pattern.avgSuccessRate === undefined) {
        pattern.avgSuccessRate = successRate;
      } else {
        // Weighted average with more weight on recent results
        pattern.avgSuccessRate = pattern.avgSuccessRate * 0.8 + successRate * 0.2;
      }
      
      console.log(`[DecisionTree] Updated success rate for pattern ${patternId}: ${pattern.avgSuccessRate.toFixed(2)}`);
      await this.savePatterns();
    }
  }

  getPatternsByCategory(category: string): LearnedPattern[] {
    return this.patterns.filter(p => p.category === category);
  }

  getPatternsByComplexity(complexity: 'simple' | 'medium' | 'complex'): LearnedPattern[] {
    return this.patterns.filter(p => p.complexity === complexity);
  }

  getMostUsedPatterns(limit: number = 10): LearnedPattern[] {
    return this.patterns
      .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
      .slice(0, limit);
  }

  getHighestSuccessPatterns(limit: number = 10): LearnedPattern[] {
    return this.patterns
      .filter(p => p.avgSuccessRate !== undefined)
      .sort((a, b) => (b.avgSuccessRate || 0) - (a.avgSuccessRate || 0))
      .slice(0, limit);
  }

  async getStats(): Promise<any> {
    const categoryDistribution: Record<string, number> = {};
    const complexityDistribution: Record<string, number> = {};
    const toolTypeDistribution: Record<string, number> = {};
    let totalUsage = 0;
    let patternsWithSuccessRate = 0;
    let totalSuccessRate = 0;

    for (const pattern of this.patterns) {
      // Category distribution
      categoryDistribution[pattern.category || 'unknown'] = 
        (categoryDistribution[pattern.category || 'unknown'] || 0) + 1;
      
      // Complexity distribution
      complexityDistribution[pattern.complexity || 'unknown'] = 
        (complexityDistribution[pattern.complexity || 'unknown'] || 0) + 1;
      
      // Tool type distribution
      for (const toolType of pattern.toolTypes || []) {
        toolTypeDistribution[toolType] = (toolTypeDistribution[toolType] || 0) + 1;
      }
      
      totalUsage += pattern.usageCount || 0;
      
      if (pattern.avgSuccessRate !== undefined) {
        patternsWithSuccessRate++;
        totalSuccessRate += pattern.avgSuccessRate;
      }
    }

    return {
      totalPatterns: this.patterns.length,
      totalUsage,
      avgUsagePerPattern: this.patterns.length > 0 ? totalUsage / this.patterns.length : 0,
      avgSuccessRate: patternsWithSuccessRate > 0 ? totalSuccessRate / patternsWithSuccessRate : 0,
      categoryDistribution,
      complexityDistribution,
      toolTypeDistribution,
      oldestPattern: this.patterns.length > 0 ? Math.min(...this.patterns.map(p => p.lastUsed || Date.now())) : null,
      newestPattern: this.patterns.length > 0 ? Math.max(...this.patterns.map(p => p.lastUsed || 0)) : null
    };
  }

  async exportPatterns(outputPath?: string): Promise<void> {
    const exportPath = outputPath || `${this.persistPath}.export.json`;
    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        totalPatterns: this.patterns.length,
        version: '1.0'
      },
      patterns: this.patterns,
      stats: await this.getStats()
    };
    
    try {
      await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2));
      console.log(`[DecisionTree] Patterns exported to ${exportPath}`);
    } catch (error) {
      console.error(`[DecisionTree] Error exporting patterns: ${error}`);
    }
  }

  async clearOldPatterns(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<void> {
    // Clear patterns older than maxAge (default 30 days)
    const cutoffTime = Date.now() - maxAge;
    const beforeCount = this.patterns.length;
    
    this.patterns = this.patterns.filter(pattern => 
      (pattern.lastUsed || 0) >= cutoffTime || (pattern.usageCount || 0) > 5
    );
    
    const removedCount = beforeCount - this.patterns.length;
    if (removedCount > 0) {
      console.log(`[DecisionTree] Cleared ${removedCount} old patterns`);
      await this.savePatterns();
    }
  }

  // Method to find similar patterns for analysis
  async findSimilarPatterns(request: string, topK: number = 5): Promise<Array<{pattern: LearnedPattern, similarity: number}>> {
    const requestEmbedding = await getEmbeddingForText(request);
    const similarities: Array<{pattern: LearnedPattern, similarity: number}> = [];
    
    for (const pattern of this.patterns) {
      const similarity = cosineSimilarityDt(requestEmbedding, pattern.embedding);
      similarities.push({ pattern, similarity });
    }
    
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }
} 