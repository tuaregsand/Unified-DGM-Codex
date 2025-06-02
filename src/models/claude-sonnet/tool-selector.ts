import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectContext } from '../../types';

export interface Tool {
  name: string;
  description: string;
  input_schema: any; // JSON schema for tool inputs
  capabilities?: string[];
  successRate?: number;
  category?: string; // e.g., 'analysis', 'generation', 'testing', 'refactoring'
  complexity?: 'simple' | 'medium' | 'complex';
}

interface ToolSelectorConfig {
  learningRate: number;
  explorationRate: number;
  persistPath?: string;
  defaultSuccessRate?: number;
  maxContextHistory?: number;
}

// State could be a string representation of the 'pattern' or 'context'
type StateRepresentation = string; 

interface ToolSuccessRecord {
  successes: number;
  attempts: number;
  qValue: number; // Q-learning value
  lastUsed: number;
  avgExecutionTime?: number; // Track performance
  errorRate?: number; // Track reliability
}

interface ContextualToolData {
  patternType?: string;
  projectType?: string;
  codeLanguage?: string;
  complexity?: string;
  recentTools?: string[]; // Recently used tools in this session
}

export class ToolSelector {
  private learningRate: number;
  private explorationRate: number;
  // Matrix: Map<StateRepresentation, Map<ToolName, SuccessRecord>>
  private toolSuccessMatrix: Map<StateRepresentation, Map<string, ToolSuccessRecord>>;
  private persistPath: string | null;
  private defaultSuccessRate: number;
  private contextHistory: Array<{state: string, tools: string[], outcome: boolean}>;
  private maxContextHistory: number;

  constructor(config: ToolSelectorConfig) {
    this.learningRate = config.learningRate;
    this.explorationRate = config.explorationRate;
    this.toolSuccessMatrix = new Map();
    this.persistPath = config.persistPath || null;
    this.defaultSuccessRate = config.defaultSuccessRate || 0.5; // Initial assumption
    this.contextHistory = [];
    this.maxContextHistory = config.maxContextHistory || 100;
    
    if (this.persistPath) {
      this.loadMatrix();
    }
  }

  private async loadMatrix(): Promise<void> {
    if (!this.persistPath) return;
    
    try {
      await fs.access(this.persistPath);
      const fileContent = await fs.readFile(this.persistPath, 'utf-8');
      const parsedMatrix = JSON.parse(fileContent);
      
      // Convert plain object back to Map
      this.toolSuccessMatrix = new Map();
      for (const state in parsedMatrix.matrix) {
        const toolMap = new Map();
        for (const [toolName, record] of Object.entries(parsedMatrix.matrix[state])) {
          toolMap.set(toolName, record as ToolSuccessRecord);
        }
        this.toolSuccessMatrix.set(state, toolMap);
      }
      
      // Load context history if available
      this.contextHistory = parsedMatrix.contextHistory || [];
      
      console.log(`[ToolSelector] Tool selection matrix loaded from ${this.persistPath}`);
    } catch (error) {
      console.log(`[ToolSelector] No existing matrix at ${this.persistPath} or error loading. Starting fresh.`);
      this.toolSuccessMatrix = new Map();
    }
  }

  private async saveMatrix(): Promise<void> {
    if (!this.persistPath) return;
    
    try {
      // Convert Map to plain object for JSON serialization
      const plainMatrix: Record<string, Record<string, ToolSuccessRecord>> = {};
      this.toolSuccessMatrix.forEach((toolMap, state) => {
        plainMatrix[state] = Object.fromEntries(toolMap);
      });
      
      const dataToSave = {
        matrix: plainMatrix,
        contextHistory: this.contextHistory.slice(-this.maxContextHistory), // Keep only recent history
        metadata: {
          lastUpdated: new Date().toISOString(),
          learningRate: this.learningRate,
          explorationRate: this.explorationRate
        }
      };
      
      await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
      await fs.writeFile(this.persistPath, JSON.stringify(dataToSave, null, 2));
      console.log(`[ToolSelector] Tool selection matrix saved to ${this.persistPath}`);
    } catch (error) {
      console.error(`[ToolSelector] Error saving tool selection matrix: ${error}`);
    }
  }

  private buildStateKey(pattern: StateRepresentation | any, context: ProjectContext): string {
    // Create a comprehensive state representation
    const contextData = this.extractContextualData(pattern, context);
    
    // Build state key from multiple factors
    const stateComponents = [
      contextData.patternType || 'unknown',
      contextData.projectType || 'general',
      contextData.codeLanguage || 'mixed',
      contextData.complexity || 'medium'
    ];
    
    return stateComponents.join(':');
  }

  private extractContextualData(pattern: any, context: ProjectContext): ContextualToolData {
    const data: ContextualToolData = {};
    
    // Extract pattern information
    if (typeof pattern === 'string') {
      data.patternType = pattern;
    } else if (pattern && typeof pattern === 'object') {
      data.patternType = pattern.category || pattern.type || 'unknown';
      data.complexity = pattern.complexity || 'medium';
    }
    
    // Extract project context
    if (context.projectPath) {
      // Guess project type from dependencies or structure
      if (context.dependencies) {
        if (context.dependencies.react || context.dependencies['@types/react']) {
          data.projectType = 'react';
        } else if (context.dependencies.express) {
          data.projectType = 'nodejs';
        } else if (context.dependencies.next) {
          data.projectType = 'nextjs';
        } else {
          data.projectType = 'general';
        }
      }
      
      // Guess primary language
      if (context.files) {
        const extensions = context.files.map(f => f.split('.').pop()?.toLowerCase());
        if (extensions.includes('ts') || extensions.includes('tsx')) {
          data.codeLanguage = 'typescript';
        } else if (extensions.includes('js') || extensions.includes('jsx')) {
          data.codeLanguage = 'javascript';
        } else if (extensions.includes('py')) {
          data.codeLanguage = 'python';
        } else {
          data.codeLanguage = 'mixed';
        }
      }
    }
    
    // Add recent tool usage context
    const recentContext = this.contextHistory.slice(-5);
    data.recentTools = recentContext.flatMap(ctx => ctx.tools);
    
    return data;
  }

  private calculateQValue(record: ToolSuccessRecord): number {
    // Q-value calculation considering success rate, recency, and performance
    const successRate = record.attempts > 0 ? record.successes / record.attempts : this.defaultSuccessRate;
    const recencyBonus = Math.max(0, 1 - (Date.now() - record.lastUsed) / (30 * 24 * 60 * 60 * 1000)); // 30-day decay
    const reliabilityScore = 1 - (record.errorRate || 0);
    
    return record.qValue * 0.7 + successRate * 0.2 + recencyBonus * 0.05 + reliabilityScore * 0.05;
  }

  private selectByEpsilonGreedy(availableTools: Tool[], stateToolRecords: Map<string, ToolSuccessRecord>): Tool[] {
    const selectedTools: Tool[] = [];
    
    for (const tool of availableTools) {
      // Initialize record if tool not seen for this state
      if (!stateToolRecords.has(tool.name)) {
        stateToolRecords.set(tool.name, { 
          successes: 0, 
          attempts: 0, 
          qValue: this.defaultSuccessRate,
          lastUsed: 0
        });
      }
      
      const record = stateToolRecords.get(tool.name)!;
      const qValue = this.calculateQValue(record);
      
      if (Math.random() < this.explorationRate) {
        // Exploration: select with some probability, favoring less-used tools
        const explorationBonus = record.attempts === 0 ? 0.8 : 1 / (record.attempts + 1);
        if (Math.random() < explorationBonus * 0.3) {
          selectedTools.push(tool);
          console.log(`[ToolSelector] Exploring tool: ${tool.name} (Q: ${qValue.toFixed(2)})`);
        }
      } else {
        // Exploitation: select tool with high Q-value
        if (qValue > 0.6) {
          selectedTools.push(tool);
          console.log(`[ToolSelector] Exploiting tool: ${tool.name} (Q: ${qValue.toFixed(2)})`);
        }
      }
    }
    
    return selectedTools;
  }

  private selectByCategory(availableTools: Tool[], pattern: any): Tool[] {
    // Category-based selection for more intelligent tool choosing
    const selectedTools: Tool[] = [];
    const patternCategory = pattern?.category || 'general';
    
    // Map pattern categories to tool categories
    const categoryMapping: Record<string, string[]> = {
      'refactoring': ['analysis', 'refactoring', 'testing'],
      'debugging': ['analysis', 'testing', 'debugging'],
      'feature_addition': ['generation', 'testing', 'analysis'],
      'testing': ['testing', 'generation'],
      'optimization': ['analysis', 'generation'],
      'documentation': ['analysis', 'generation'],
      'general': ['analysis', 'generation']
    };
    
    const preferredCategories = categoryMapping[patternCategory] || ['analysis', 'generation'];
    
    // Select tools that match preferred categories
    for (const category of preferredCategories) {
      const categoryTools = availableTools.filter(tool => tool.category === category);
      if (categoryTools.length > 0) {
        // Select best tool from category based on success rate
        const bestTool = categoryTools.reduce((best, current) => 
          (current.successRate || 0) > (best.successRate || 0) ? current : best
        );
        selectedTools.push(bestTool);
      }
    }
    
    return selectedTools;
  }

  // Pattern could be a string from DecisionTree classification or other context summary
  // Context provides broader information for more nuanced selection
  async selectTools(pattern: StateRepresentation | any, context: ProjectContext, availableTools: Tool[]): Promise<Tool[]> {
    const stateKey = this.buildStateKey(pattern, context);

    if (!this.toolSuccessMatrix.has(stateKey)) {
      this.toolSuccessMatrix.set(stateKey, new Map());
    }
    const stateToolRecords = this.toolSuccessMatrix.get(stateKey)!;

    console.log(`[ToolSelector] Selecting tools for state: ${stateKey}`);

    // Combine different selection strategies
    const epsilonGreedyTools = this.selectByEpsilonGreedy(availableTools, stateToolRecords);
    const categoryBasedTools = this.selectByCategory(availableTools, pattern);
    
    // Merge and deduplicate
    const allSelectedTools = [...epsilonGreedyTools, ...categoryBasedTools];
    const uniqueSelectedTools = Array.from(
      new Set(allSelectedTools.map(t => t.name))
    ).map(name => allSelectedTools.find(t => t.name === name)!);

    // Fallback: if no tools selected, pick the one with highest historical success rate
    if (uniqueSelectedTools.length === 0 && availableTools.length > 0) {
      let bestTool: Tool | null = null;
      let maxQValue = -1;
      
      for (const tool of availableTools) {
        const record = stateToolRecords.get(tool.name);
        const qValue = record ? this.calculateQValue(record) : this.defaultSuccessRate;
        if (qValue > maxQValue) {
          maxQValue = qValue;
          bestTool = tool;
        }
      }
      
      if (bestTool) {
        uniqueSelectedTools.push(bestTool);
        console.log(`[ToolSelector] Fallback: Selected best tool: ${bestTool.name} (Q: ${maxQValue.toFixed(2)})`);
      }
    }

    // Update context history
    this.contextHistory.push({
      state: stateKey,
      tools: uniqueSelectedTools.map(t => t.name),
      outcome: true // Will be updated later
    });

    console.log(`[ToolSelector] Final selected tools for state "${stateKey}": ${uniqueSelectedTools.map(t => t.name).join(', ')}`);
    return uniqueSelectedTools;
  }

  // This would be called by the orchestrator after a tool execution step
  async updateSuccessRate(toolName: string, pattern: StateRepresentation | any, wasSuccessful: boolean, executionTime?: number): Promise<void> {
    const stateKey = this.buildStateKey(pattern, {} as ProjectContext);
    
    if (!this.toolSuccessMatrix.has(stateKey)) {
      this.toolSuccessMatrix.set(stateKey, new Map());
    }
    const stateToolRecords = this.toolSuccessMatrix.get(stateKey)!;

    if (!stateToolRecords.has(toolName)) {
      stateToolRecords.set(toolName, { 
        successes: 0, 
        attempts: 0, 
        qValue: this.defaultSuccessRate,
        lastUsed: 0
      });
    }
    
    const record = stateToolRecords.get(toolName)!;
    
    record.attempts += 1;
    record.lastUsed = Date.now();
    
    if (wasSuccessful) {
      record.successes += 1;
    } else {
      record.errorRate = (record.errorRate || 0) * 0.9 + 0.1; // Exponential moving average
    }

    // Update execution time tracking
    if (executionTime !== undefined) {
      record.avgExecutionTime = record.avgExecutionTime 
        ? record.avgExecutionTime * 0.8 + executionTime * 0.2
        : executionTime;
    }

    // Q-learning update
    const reward = wasSuccessful ? 1 : 0;
    const oldQValue = record.qValue;
    record.qValue = oldQValue + this.learningRate * (reward - oldQValue);

    // Update context history outcome
    const recentContext = this.contextHistory.slice(-5).find(ctx => 
      ctx.state === stateKey && ctx.tools.includes(toolName)
    );
    if (recentContext) {
      recentContext.outcome = wasSuccessful;
    }

    console.log(`[ToolSelector] Updated ${toolName} in state "${stateKey}": ${record.successes}/${record.attempts} (Q: ${record.qValue.toFixed(2)})`);
    
    if (this.persistPath) {
      await this.saveMatrix();
    }
  }

  async getToolRecommendations(pattern: any, context: ProjectContext, limit: number = 5): Promise<Array<{toolName: string, confidence: number, reason: string}>> {
    const stateKey = this.buildStateKey(pattern, context);
    const stateToolRecords = this.toolSuccessMatrix.get(stateKey) || new Map();
    
    const recommendations: Array<{toolName: string, confidence: number, reason: string}> = [];
    
    for (const [toolName, record] of stateToolRecords.entries()) {
      const qValue = this.calculateQValue(record);
      const successRate = record.attempts > 0 ? record.successes / record.attempts : 0;
      
      let reason = `Success rate: ${(successRate * 100).toFixed(1)}%`;
      if (record.avgExecutionTime) {
        reason += `, Avg time: ${record.avgExecutionTime.toFixed(0)}ms`;
      }
      if (record.attempts > 10) {
        reason += `, Well-tested (${record.attempts} uses)`;
      }
      
      recommendations.push({
        toolName,
        confidence: qValue,
        reason
      });
    }
    
    return recommendations
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  async getStats(): Promise<any> {
    let totalStates = this.toolSuccessMatrix.size;
    let totalTools = 0;
    let totalAttempts = 0;
    let totalSuccesses = 0;
    let avgQValue = 0;
    
    const toolUsageMap: Record<string, number> = {};
    const stateDistribution: Record<string, number> = {};
    
    for (const [state, toolMap] of this.toolSuccessMatrix.entries()) {
      stateDistribution[state] = toolMap.size;
      
      for (const [toolName, record] of toolMap.entries()) {
        totalTools++;
        totalAttempts += record.attempts;
        totalSuccesses += record.successes;
        avgQValue += record.qValue;
        
        toolUsageMap[toolName] = (toolUsageMap[toolName] || 0) + record.attempts;
      }
    }
    
    return {
      totalStates,
      totalTools,
      totalAttempts,
      totalSuccesses,
      overallSuccessRate: totalAttempts > 0 ? totalSuccesses / totalAttempts : 0,
      avgQValue: totalTools > 0 ? avgQValue / totalTools : 0,
      explorationRate: this.explorationRate,
      learningRate: this.learningRate,
      mostUsedTools: Object.entries(toolUsageMap)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10),
      stateDistribution,
      contextHistorySize: this.contextHistory.length
    };
  }

  async adaptExplorationRate(performanceMetrics: {successRate: number, diversityScore: number}): Promise<void> {
    // Adaptive exploration rate based on performance
    if (performanceMetrics.successRate > 0.8 && performanceMetrics.diversityScore < 0.3) {
      // High success but low diversity - reduce exploration
      this.explorationRate = Math.max(0.01, this.explorationRate * 0.9);
      console.log(`[ToolSelector] Reduced exploration rate to ${this.explorationRate.toFixed(3)}`);
    } else if (performanceMetrics.successRate < 0.6) {
      // Low success - increase exploration
      this.explorationRate = Math.min(0.3, this.explorationRate * 1.1);
      console.log(`[ToolSelector] Increased exploration rate to ${this.explorationRate.toFixed(3)}`);
    }
  }

  async exportMatrix(outputPath?: string): Promise<void> {
    const exportPath = outputPath || `${this.persistPath}.export.json`;
    const stats = await this.getStats();
    
    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        version: '1.0',
        stats
      },
      matrix: Object.fromEntries(
        Array.from(this.toolSuccessMatrix.entries()).map(([state, toolMap]) => [
          state,
          Object.fromEntries(toolMap)
        ])
      ),
      contextHistory: this.contextHistory
    };
    
    try {
      await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2));
      console.log(`[ToolSelector] Matrix exported to ${exportPath}`);
    } catch (error) {
      console.error(`[ToolSelector] Error exporting matrix: ${error}`);
    }
  }
} 