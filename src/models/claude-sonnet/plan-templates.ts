import * as fs from 'fs/promises';
import * as path from 'path';
import { ExecutionPlan, ExecutionStep } from '../../types';

export interface PlanStep extends ExecutionStep {
  estimatedDuration?: number; // Estimated time in seconds
  priority?: 'low' | 'medium' | 'high';
  validation?: {
    required?: boolean;
    criteria?: string[];
  };
}

interface PlanTemplatesConfig {
  templateDirPath: string;
  autoReload?: boolean;
  customPatterns?: Record<string, any>;
}

interface PlanTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  keywords: string[];
  complexity: 'simple' | 'medium' | 'complex';
  prerequisites?: string[];
  plan: {
    steps: PlanStep[];
    estimatedDuration?: number;
    rollbackSteps?: PlanStep[];
  };
  variables?: Record<string, {
    type: string;
    description: string;
    default?: any;
    required?: boolean;
  }>;
  examples?: Array<{
    input: string;
    context: any;
    expectedOutput: string;
  }>;
  metadata?: {
    author?: string;
    version?: string;
    created?: string;
    lastModified?: string;
    usageCount?: number;
    successRate?: number;
  };
}

export class PlanTemplates {
  private templates: Map<string, PlanTemplate>;
  private templateDirPath: string;
  private autoReload: boolean;
  private lastLoadTime: number = 0;

  constructor(config: PlanTemplatesConfig) {
    this.templates = new Map();
    this.templateDirPath = config.templateDirPath;
    this.autoReload = config.autoReload || false;
    this.loadTemplates();
  }

  private async loadTemplates(): Promise<void> {
    try {
      await fs.access(this.templateDirPath);
      const files = await fs.readdir(this.templateDirPath);
      
      let loadedCount = 0;
      for (const file of files) {
        if (file.endsWith('.json') || file.endsWith('.yaml') || file.endsWith('.yml')) {
          const filePath = path.join(this.templateDirPath, file);
          try {
            await this.loadTemplateFile(filePath);
            loadedCount++;
          } catch (parseError) {
            console.error(`[PlanTemplates] Error parsing template file ${filePath}:`, parseError);
          }
        }
      }
      
      console.log(`[PlanTemplates] Loaded ${loadedCount} templates from ${this.templateDirPath}`);
      this.lastLoadTime = Date.now();
      
      // If no templates found, create some default ones
      if (loadedCount === 0) {
        await this.createDefaultTemplates();
      }
    } catch (error) {
      console.log(`[PlanTemplates] Template directory ${this.templateDirPath} not found or error reading. Creating default templates.`);
      this.templates = new Map();
      await this.createDefaultTemplates();
    }
  }

  private async loadTemplateFile(filePath: string): Promise<void> {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    let templateData: PlanTemplate;

    if (filePath.endsWith('.json')) {
      templateData = JSON.parse(fileContent);
    } else {
      // For YAML files, we'd need a YAML parser
      // For now, assume JSON format
      templateData = JSON.parse(fileContent);
    }

    if (this.validateTemplate(templateData)) {
      this.templates.set(templateData.id, templateData);
      console.log(`[PlanTemplates] Loaded template: ${templateData.id} (${templateData.name})`);
    } else {
      console.warn(`[PlanTemplates] Invalid template format in file: ${filePath}`);
    }
  }

  private validateTemplate(template: any): template is PlanTemplate {
    return template &&
           typeof template.id === 'string' &&
           typeof template.name === 'string' &&
           template.plan &&
           Array.isArray(template.plan.steps) &&
           template.plan.steps.length > 0;
  }

  private async createDefaultTemplates(): Promise<void> {
    console.log('[PlanTemplates] Creating default templates...');
    
    const defaultTemplates: PlanTemplate[] = [
      {
        id: 'refactor_component',
        name: 'Refactor Component',
        description: 'Template for refactoring a software component',
        category: 'refactoring',
        keywords: ['refactor', 'component', 'restructure', 'improve'],
        complexity: 'medium',
        plan: {
          steps: [
            {
              type: 'analysis',
              spec: { target: '{{component_path}}', depth: 'detailed' },
              description: 'Analyze current component structure and dependencies'
            },
            {
              type: 'reasoning',
              spec: { task: 'identify_improvements', criteria: ['maintainability', 'performance', 'readability'] },
              description: 'Identify areas for improvement'
            },
            {
              type: 'code_generation',
              spec: { type: 'refactored_component', preserveInterface: true },
              description: 'Generate refactored component code'
            },
            {
              type: 'tool_use',
              spec: { toolName: 'test_generator', input: { component: '{{component_path}}' } },
              description: 'Generate tests for refactored component'
            }
          ],
          estimatedDuration: 1800 // 30 minutes
        },
        variables: {
          component_path: {
            type: 'string',
            description: 'Path to the component to refactor',
            required: true
          }
        }
      },
      {
        id: 'add_feature',
        name: 'Add New Feature',
        description: 'Template for adding a new feature to existing codebase',
        category: 'feature_addition',
        keywords: ['add', 'feature', 'implement', 'new', 'create'],
        complexity: 'complex',
        plan: {
          steps: [
            {
              type: 'analysis',
              spec: { target: '{{project_path}}', scope: 'architecture' },
              description: 'Analyze existing project architecture'
            },
            {
              type: 'reasoning',
              spec: { 
                task: 'feature_design', 
                requirements: '{{feature_requirements}}',
                constraints: ['existing_architecture', 'performance', 'security']
              },
              description: 'Design feature implementation approach'
            },
            {
              type: 'code_generation',
              spec: { 
                type: 'feature_implementation',
                integration_points: '{{integration_points}}',
                language: '{{language}}'
              },
              description: 'Generate feature implementation code'
            },
            {
              type: 'tool_use',
              spec: { toolName: 'test_generator', input: { feature: '{{feature_name}}' } },
              description: 'Generate comprehensive tests for new feature'
            },
            {
              type: 'code_modification',
              spec: { 
                task: 'integrate_feature',
                target_files: '{{integration_files}}'
              },
              description: 'Integrate feature with existing codebase'
            }
          ],
          estimatedDuration: 3600 // 60 minutes
        },
        variables: {
          project_path: { type: 'string', description: 'Project root path', required: true },
          feature_requirements: { type: 'string', description: 'Feature requirements description', required: true },
          feature_name: { type: 'string', description: 'Name of the new feature', required: true },
          language: { type: 'string', description: 'Programming language', default: 'typescript' },
          integration_points: { type: 'array', description: 'Points where feature integrates with existing code' },
          integration_files: { type: 'array', description: 'Files that need modification for integration' }
        }
      },
      {
        id: 'debug_issue',
        name: 'Debug Issue',
        description: 'Template for systematic debugging approach',
        category: 'debugging',
        keywords: ['debug', 'fix', 'error', 'issue', 'bug'],
        complexity: 'medium',
        plan: {
          steps: [
            {
              type: 'analysis',
              spec: { 
                target: '{{error_context}}',
                type: 'error_analysis',
                include_logs: true
              },
              description: 'Analyze error context and symptoms'
            },
            {
              type: 'reasoning',
              spec: {
                task: 'root_cause_analysis',
                error_description: '{{error_description}}',
                reproduction_steps: '{{reproduction_steps}}'
              },
              description: 'Identify potential root causes'
            },
            {
              type: 'tool_use',
              spec: { toolName: 'code_analyzer', input: { scope: 'affected_area' } },
              description: 'Analyze code in affected area'
            },
            {
              type: 'code_modification',
              spec: {
                type: 'bug_fix',
                target: '{{fix_location}}',
                approach: '{{fix_approach}}'
              },
              description: 'Implement fix for identified issue'
            },
            {
              type: 'tool_use',
              spec: { toolName: 'test_generator', input: { type: 'regression_test' } },
              description: 'Generate regression tests to prevent issue recurrence'
            }
          ],
          estimatedDuration: 2400 // 40 minutes
        },
        variables: {
          error_description: { type: 'string', description: 'Description of the error', required: true },
          error_context: { type: 'string', description: 'Context where error occurs', required: true },
          reproduction_steps: { type: 'array', description: 'Steps to reproduce the error' },
          fix_location: { type: 'string', description: 'Location where fix should be applied' },
          fix_approach: { type: 'string', description: 'Approach for implementing the fix' }
        }
      },
      {
        id: 'optimize_performance',
        name: 'Performance Optimization',
        description: 'Template for systematic performance optimization',
        category: 'optimization',
        keywords: ['optimize', 'performance', 'speed', 'efficiency', 'bottleneck'],
        complexity: 'complex',
        plan: {
          steps: [
            {
              type: 'analysis',
              spec: {
                type: 'performance_analysis',
                target: '{{target_code}}',
                metrics: ['execution_time', 'memory_usage', 'cpu_usage']
              },
              description: 'Analyze current performance characteristics'
            },
            {
              type: 'tool_use',
              spec: { toolName: 'profiler', input: { target: '{{target_code}}' } },
              description: 'Profile code to identify bottlenecks'
            },
            {
              type: 'reasoning',
              spec: {
                task: 'optimization_strategy',
                bottlenecks: '{{identified_bottlenecks}}',
                constraints: ['maintainability', 'compatibility']
              },
              description: 'Develop optimization strategy'
            },
            {
              type: 'code_modification',
              spec: {
                type: 'performance_optimization',
                optimizations: '{{optimization_techniques}}',
                preserve_functionality: true
              },
              description: 'Apply performance optimizations'
            },
            {
              type: 'tool_use',
              spec: { toolName: 'benchmark', input: { before_after: true } },
              description: 'Benchmark optimized code against original'
            }
          ],
          estimatedDuration: 3000 // 50 minutes
        },
        variables: {
          target_code: { type: 'string', description: 'Code to optimize', required: true },
          optimization_techniques: { type: 'array', description: 'Specific optimization techniques to apply' },
          identified_bottlenecks: { type: 'array', description: 'Identified performance bottlenecks' }
        }
      }
    ];

    // Save default templates to disk
    try {
      await fs.mkdir(this.templateDirPath, { recursive: true });
      
      for (const template of defaultTemplates) {
        this.templates.set(template.id, template);
        const templatePath = path.join(this.templateDirPath, `${template.id}.json`);
        await fs.writeFile(templatePath, JSON.stringify(template, null, 2));
        console.log(`[PlanTemplates] Created default template: ${template.id}`);
      }
    } catch (error) {
      console.error('[PlanTemplates] Error creating default templates:', error);
    }
  }

  public findMatch(pattern: string | any): PlanTemplate | null {
    // Reload templates if auto-reload is enabled and enough time has passed
    if (this.autoReload && Date.now() - this.lastLoadTime > 60000) { // 1 minute
      this.loadTemplates();
    }

    // Extract pattern information
    let patternString: string;
    let category: string | undefined;
    let complexity: string | undefined;

    if (typeof pattern === 'string') {
      patternString = pattern.toLowerCase();
    } else if (pattern && typeof pattern === 'object') {
      patternString = JSON.stringify(pattern).toLowerCase();
      category = pattern.category;
      complexity = pattern.complexity;
    } else {
      patternString = '';
    }

    console.log(`[PlanTemplates] Finding match for pattern: "${patternString}", category: ${category}, complexity: ${complexity}`);

    let bestMatch: PlanTemplate | null = null;
    let bestScore = 0;

    for (const [id, template] of this.templates) {
      let score = 0;

      // Category match (highest weight)
      if (category && template.category === category) {
        score += 50;
      }

      // Complexity match
      if (complexity && template.complexity === complexity) {
        score += 20;
      }

      // Keyword matching
      const templateKeywords = template.keywords.map(kw => kw.toLowerCase());
      const patternWords = patternString.split(/\s+/);

      for (const word of patternWords) {
        if (templateKeywords.some(kw => kw.includes(word) || word.includes(kw))) {
          score += 10;
        }
      }

      // Template name and description matching
      if (template.name.toLowerCase().includes(patternString) ||
          template.description.toLowerCase().includes(patternString)) {
        score += 15;
      }

      // Pattern in template ID
      if (template.id.toLowerCase().includes(patternString)) {
        score += 25;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = template;
      }
    }

    if (bestMatch && bestScore >= 10) { // Minimum threshold
      console.log(`[PlanTemplates] Found matching template: ${bestMatch.id} (score: ${bestScore})`);
      
      // Update usage count
      if (bestMatch.metadata) {
        bestMatch.metadata.usageCount = (bestMatch.metadata.usageCount || 0) + 1;
      } else {
        bestMatch.metadata = { usageCount: 1 };
      }
      
      return bestMatch;
    }

    console.log(`[PlanTemplates] No matching template found for pattern: "${patternString}"`);
    return null;
  }

  public getTemplate(id: string): PlanTemplate | null {
    return this.templates.get(id) || null;
  }

  public getAllTemplates(): PlanTemplate[] {
    return Array.from(this.templates.values());
  }

  public getTemplatesByCategory(category: string): PlanTemplate[] {
    return Array.from(this.templates.values()).filter(t => t.category === category);
  }

  public getTemplatesByComplexity(complexity: 'simple' | 'medium' | 'complex'): PlanTemplate[] {
    return Array.from(this.templates.values()).filter(t => t.complexity === complexity);
  }

  public async addTemplate(template: PlanTemplate): Promise<void> {
    if (!this.validateTemplate(template)) {
      throw new Error('Invalid template format');
    }

    this.templates.set(template.id, template);
    
    // Save to disk
    try {
      const templatePath = path.join(this.templateDirPath, `${template.id}.json`);
      await fs.writeFile(templatePath, JSON.stringify(template, null, 2));
      console.log(`[PlanTemplates] Added new template: ${template.id}`);
    } catch (error) {
      console.error(`[PlanTemplates] Error saving template ${template.id}:`, error);
    }
  }

  public async updateTemplateMetadata(id: string, metadata: Partial<PlanTemplate['metadata']>): Promise<void> {
    const template = this.templates.get(id);
    if (!template) {
      console.warn(`[PlanTemplates] Template ${id} not found for metadata update`);
      return;
    }

    template.metadata = { ...template.metadata, ...metadata };
    
    // Save updated template
    try {
      const templatePath = path.join(this.templateDirPath, `${id}.json`);
      await fs.writeFile(templatePath, JSON.stringify(template, null, 2));
    } catch (error) {
      console.error(`[PlanTemplates] Error updating template metadata for ${id}:`, error);
    }
  }

  public getStats(): any {
    const templates = Array.from(this.templates.values());
    const categoryDistribution: Record<string, number> = {};
    const complexityDistribution: Record<string, number> = {};
    let totalUsage = 0;
    let templatesWithUsage = 0;

    for (const template of templates) {
      categoryDistribution[template.category] = (categoryDistribution[template.category] || 0) + 1;
      complexityDistribution[template.complexity] = (complexityDistribution[template.complexity] || 0) + 1;
      
      if (template.metadata?.usageCount) {
        totalUsage += template.metadata.usageCount;
        templatesWithUsage++;
      }
    }

    const mostUsedTemplates = templates
      .filter(t => t.metadata?.usageCount)
      .sort((a, b) => (b.metadata?.usageCount || 0) - (a.metadata?.usageCount || 0))
      .slice(0, 5)
      .map(t => ({ id: t.id, name: t.name, usage: t.metadata?.usageCount }));

    return {
      totalTemplates: templates.length,
      categoryDistribution,
      complexityDistribution,
      totalUsage,
      avgUsagePerTemplate: templatesWithUsage > 0 ? totalUsage / templatesWithUsage : 0,
      mostUsedTemplates,
      lastReloadTime: new Date(this.lastLoadTime).toISOString()
    };
  }

  public async exportTemplates(outputPath?: string): Promise<void> {
    const exportPath = outputPath || path.join(this.templateDirPath, 'templates_export.json');
    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        totalTemplates: this.templates.size,
        version: '1.0'
      },
      templates: Array.from(this.templates.values()),
      stats: this.getStats()
    };
    
    try {
      await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2));
      console.log(`[PlanTemplates] Templates exported to ${exportPath}`);
    } catch (error) {
      console.error(`[PlanTemplates] Error exporting templates: ${error}`);
    }
  }

  public searchTemplates(query: string): PlanTemplate[] {
    const queryLower = query.toLowerCase();
    const results: Array<{template: PlanTemplate, score: number}> = [];

    for (const template of this.templates.values()) {
      let score = 0;

      // Check name
      if (template.name.toLowerCase().includes(queryLower)) score += 30;
      
      // Check description
      if (template.description.toLowerCase().includes(queryLower)) score += 20;
      
      // Check keywords
      for (const keyword of template.keywords) {
        if (keyword.toLowerCase().includes(queryLower)) score += 15;
      }
      
      // Check category
      if (template.category.toLowerCase().includes(queryLower)) score += 25;

      if (score > 0) {
        results.push({ template, score });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .map(r => r.template);
  }
} 