import { ReasoningCache } from './reasoning-cache';
import { DecisionTree, DecisionNode } from './decision-tree';
import { ToolSelector, Tool } from './tool-selector';
import { PlanTemplates, PlanStep } from './plan-templates';
import { ExecutionPlan } from '../../types';
import { ClaudeSonnetConfig, ProjectContext } from '../../types';

import Anthropic from '@anthropic-ai/sdk';

// Real Anthropic API client
class ClaudeApiClient {
  private client: Anthropic;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('Anthropic API key is missing.');
    
    this.client = new Anthropic({
      apiKey: key,
    });
  }

  async think(params: { 
    prompt: string; 
    mode?: string; 
    maxThinkingTime?: number;
    tools?: any[];
    tool_choice?: any;
    system?: string;
  }): Promise<{ planData: any; reasoningTrace?: string[] }> {
    try {
      console.log(`[ClaudeApiClient] Making REAL API call to Claude Sonnet...`);
      
      const systemPrompt = params.system || `You are Claude Sonnet 4, the reasoning engine in a unified AI development system. 
Your role is to create detailed execution plans for software development tasks.

Given a user request, generate a structured execution plan with these step types:
- "analysis": Analyze requirements or existing code
- "code_generation": Generate new code
- "code_modification": Modify existing code  
- "reasoning": Perform complex reasoning
- "tool_use": Use a specific tool

For each step, provide:
- type: one of the above
- spec: detailed specification for the step
- description: human-readable description

Respond in this JSON format:
{
  "steps": [
    {
      "type": "analysis", 
      "spec": {"query": "specific analysis needed"},
      "description": "Analyze the requirements"
    }
  ],
  "reasoning": "Your step-by-step thinking process"
}`;

      const response = await this.client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4000,
        temperature: 0.1,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: params.prompt
          }
        ]
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      console.log(`[ClaudeApiClient] Claude responded with ${content.text.length} characters`);

      // Try to parse JSON from Claude's response
      let planData;
      let reasoningTrace: string[] = [];
      
      try {
        // Look for JSON in the response
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          planData = parsed;
          if (parsed.reasoning) {
            reasoningTrace = [parsed.reasoning];
          }
        } else {
          // Fallback: create a simple plan from the text response
          planData = {
            steps: [
              {
                type: 'analysis',
                spec: { query: params.prompt },
                description: 'Analyze the user request based on Claude response'
              }
            ]
          };
          reasoningTrace = [content.text];
        }
      } catch (parseError) {
        console.warn('[ClaudeApiClient] Failed to parse JSON from Claude, using text as reasoning');
        planData = {
          steps: [
            {
              type: 'analysis', 
              spec: { query: params.prompt },
              description: 'Analyze the user request'
            }
          ]
        };
        reasoningTrace = [content.text];
      }

      return { planData, reasoningTrace };
    } catch (error) {
      console.error('[ClaudeApiClient] Error calling Claude API:', error);
      // Fallback plan
      return {
        planData: {
          steps: [
            {
              type: 'analysis',
              spec: { query: params.prompt },
              description: 'Fallback: Analyze the user request'
            }
          ]
        },
        reasoningTrace: [`Error occurred: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }

  async complete(params: {
    prompt: string;
    maxTokens?: number;
    temperature?: number;
    system?: string;
  }): Promise<string> {
    try {
      console.log(`[ClaudeApiClient] Making REAL completion call to Claude...`);
      
      const response = await this.client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: params.maxTokens || 1000,
        temperature: params.temperature || 0.7,
        system: params.system,
        messages: [
          {
            role: 'user',
            content: params.prompt
          }
        ]
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      console.log(`[ClaudeApiClient] Claude completion: ${content.text.length} characters`);
      return content.text;
    } catch (error) {
      console.error('[ClaudeApiClient] Error in completion call:', error);
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

export class ClaudeSonnetOptimized {
  private reasoningCache: ReasoningCache;
  private decisionTree: DecisionTree;
  private toolSelector: ToolSelector;
  private templates: PlanTemplates;
  private apiClient: ClaudeApiClient;

  constructor(config: ClaudeSonnetConfig) {
    this.apiClient = new ClaudeApiClient(config.apiKey);

    this.reasoningCache = new ReasoningCache({
      maxEntries: config.reasoningCacheMaxEntries || 10000,
      similarityThreshold: config.reasoningCacheSimilarityThreshold || 0.85,
      redisUrl: process.env.REDIS_URL
    });
    
    this.decisionTree = new DecisionTree({
      maxDepth: config.decisionTreeMaxDepth || 10,
      minSamplesLeaf: config.decisionTreeMinSamplesLeaf || 5,
      persistPath: config.decisionTreePersistPath || './data/decision_trees/claude_patterns.json'
    });
    
    this.toolSelector = new ToolSelector({
      learningRate: config.toolSelectorLearningRate || 0.1,
      explorationRate: config.toolSelectorExplorationRate || 0.05,
      persistPath: config.toolSelectorMatrixPath || './data/tool_selection_matrix.json'
    });
    
    this.templates = new PlanTemplates({
      templateDirPath: config.planTemplatePath || './config/plan_templates'
    });
  }

  private buildPlanningPrompt(request: string, tools: Tool[], contextSummary?: string): string {
    let prompt = `You are Claude Sonnet 4, the reasoning engine in a unified AI development system.

User Request: ${request}

`;
    
    if (contextSummary) {
      prompt += `Context Summary:
${contextSummary}

`;
    }
    
    prompt += `Available Tools:
`;
    tools.forEach(tool => {
      prompt += `- Name: ${tool.name}
  Description: ${tool.description}
  Input Schema: ${JSON.stringify(tool.input_schema)}
  Success Rate: ${(tool.successRate || 0.5) * 100}%
`;
    });
    
    prompt += `
Please create a detailed step-by-step execution plan to fulfill the user request. For each step, specify:
1. 'type' (e.g., 'code_generation', 'analysis', 'reasoning', 'tool_use')
2. 'spec' detailing the specific action
3. 'description' explaining what this step accomplishes

If using a tool, the step type should be 'tool_use', and the spec should include 'toolName' and 'toolInput'.

Think through the problem systematically and provide a comprehensive plan.`;

    return prompt;
  }

  private parsePlan(response: { planData: any; reasoningTrace?: string[] }): ExecutionPlan {
    // This function would parse the structured response from Claude into an ExecutionPlan object
    if (!response.planData || !Array.isArray(response.planData.steps)) {
      console.error("[ClaudeSonnetOptimized] Invalid plan data received from API:", response.planData);
      throw new Error("Failed to parse plan from Claude response.");
    }
    
    return {
      steps: response.planData.steps as PlanStep[],
      reasoningTrace: response.reasoningTrace || [],
      templateId: response.planData.templateId
    };
  }
  
  private adaptCachedPlan(cachedPlan: ExecutionPlan, context: any): ExecutionPlan {
    // Logic to adapt a cached plan based on new context.
    // This could involve re-validating tool availability, updating parameters, etc.
    console.log("[ClaudeSonnetOptimized] Adapting cached plan...");
    
    // Check if tools in cached plan are still available
    const adaptedSteps = cachedPlan.steps.map((step: any) => {
      if (step.type === 'tool_use' && step.spec?.toolName) {
        // Verify tool is still available and update success rates
        return {
          ...step,
          spec: {
            ...step.spec,
            contextAdaptation: new Date().toISOString()
          }
        };
      }
      return step;
    });
    
    return {
      ...cachedPlan,
      steps: adaptedSteps,
      reasoningTrace: [...(cachedPlan.reasoningTrace || []), "Adapted from cached plan."]
    };
  }

  private async instantiateTemplate(
    template: any, 
    request: string, 
    tools: Tool[], 
    context: any
  ): Promise<ExecutionPlan> {
    // Logic to fill in a plan template with request-specific details and selected tools.
    console.log("[ClaudeSonnetOptimized] Instantiating plan from template...");
    
    // Example: a template might have placeholders like {{request_details}} or {{tool_for_analysis}}
    const populatedSteps = template.steps.map((step: any) => {
      let populatedSpec = { ...step.spec };
      
      // Replace placeholders in spec
      for (const key in populatedSpec) {
        if (typeof populatedSpec[key] === 'string') {
          populatedSpec[key] = populatedSpec[key]
            .replace('{{request}}', request)
            .replace('{{timestamp}}', new Date().toISOString())
            .replace('{{projectPath}}', context.projectPath || 'unknown');
            
          // Tool selection placeholders
          if (populatedSpec[key].includes('{{tool_for_analysis}}')) {
            const analysisTool = tools.find(t => t.name.toLowerCase().includes('analyz'));
            populatedSpec[key] = populatedSpec[key].replace('{{tool_for_analysis}}', analysisTool?.name || 'manual_analysis');
          }
        }
      }
      
      return { ...step, spec: populatedSpec };
    });
    
    return { 
      steps: populatedSteps, 
      reasoningTrace: ["Instantiated from template.", `Template: ${template.id || 'unknown'}`],
      templateId: template.id
    };
  }

  async createExecutionPlan(request: string, context: ProjectContext): Promise<ExecutionPlan> {
    console.log(`[ClaudeSonnetOptimized] Creating execution plan for request: "${request.substring(0, 50)}..."`);

    // Step 1: Check reasoning cache for similar plans
    const cachedPlan = await this.reasoningCache.findSimilar(request);
    if (cachedPlan) {
      console.log('[ClaudeSonnetOptimized] Found similar plan in reasoning cache.');
      return this.adaptCachedPlan(cachedPlan, context);
    }
    console.log('[ClaudeSonnetOptimized] No similar plan in cache.');

    // Step 2: Generate embedding and classify pattern
    const requestEmbedding = await this.reasoningCache.getEmbedding(request);
    const patternClassification = await this.decisionTree.classify(request, requestEmbedding);
    console.log(`[ClaudeSonnetOptimized] Classified request pattern: ${JSON.stringify(patternClassification)}`);
    
    // Step 3: Select appropriate tools
    const availableTools: Tool[] = this.getAvailableTools(context);
    const selectedTools = await this.toolSelector.selectTools(patternClassification, context, availableTools);
    console.log(`[ClaudeSonnetOptimized] Selected tools: ${selectedTools.map(t => t.name).join(', ')}`);

    // Step 4: Try to use template or generate new plan
    const template = this.templates.findMatch(patternClassification);
    let plan: ExecutionPlan;

    if (template) {
      console.log('[ClaudeSonnetOptimized] Found matching plan template.');
      plan = await this.instantiateTemplate(template, request, selectedTools, context);
    } else {
      console.log('[ClaudeSonnetOptimized] No matching template, generating new plan.');
      plan = await this.generateNewPlan(request, selectedTools, context);
    }
    
    // Step 5: Store for future use
    await this.reasoningCache.store(request, requestEmbedding, plan);
    console.log('[ClaudeSonnetOptimized] Stored new plan in reasoning cache.');

    await this.decisionTree.learn(request, requestEmbedding, plan);
    console.log('[ClaudeSonnetOptimized] Updated decision tree with new plan pattern.');
    
    return plan;
  }

  private getAvailableTools(context: ProjectContext): Tool[] {
    // Return available tools based on context
    // This would be expanded based on actual system capabilities
    return [
      {
        name: 'file_analyzer',
        description: 'Analyze code files for structure and dependencies',
        input_schema: { type: 'object', properties: { filePaths: { type: 'array' } } },
        successRate: 0.9
      },
      {
        name: 'code_generator',
        description: 'Generate new code based on specifications',
        input_schema: { type: 'object', properties: { spec: { type: 'string' } } },
        successRate: 0.85
      },
      {
        name: 'dependency_resolver',
        description: 'Resolve and manage project dependencies',
        input_schema: { type: 'object', properties: { dependencies: { type: 'array' } } },
        successRate: 0.95
      },
      {
        name: 'test_generator',
        description: 'Generate unit tests for code',
        input_schema: { type: 'object', properties: { codeToTest: { type: 'string' } } },
        successRate: 0.8
      }
    ];
  }

  private async generateNewPlan(request: string, tools: Tool[], context: ProjectContext): Promise<ExecutionPlan> {
    // Use Claude Sonnet 4's extended thinking mode if applicable
    const contextSummary = context.currentFileContent 
      ? context.currentFileContent.substring(0, 500) + "..." 
      : "No specific file context.";
    
    const planningPrompt = this.buildPlanningPrompt(request, tools, contextSummary);
    
    const response = await this.apiClient.think({
      prompt: planningPrompt,
      mode: 'extended', // As per user query
      maxThinkingTime: 60000, // As per user query
      tools: tools.map(t => ({ 
        name: t.name, 
        description: t.description, 
        input_schema: t.input_schema 
      })),
      tool_choice: { type: "auto" }, // Allow Claude to decide if/when to use tools
      system: "You are a reasoning engine that creates detailed execution plans for software development tasks."
    });
    
    return this.parsePlan(response);
  }

  // Method for orchestrator compatibility
  async reason(spec: any, context: any): Promise<any> {
    // This method would use Claude Sonnet for a specific reasoning task based on a spec
    const request = `Reason about the following specification: ${JSON.stringify(spec)}`;
    const plan = await this.createExecutionPlan(request, context);
    
    // For reasoning tasks, we might want to execute the plan or return reasoning
    return {
      reasoning: plan.reasoningTrace?.join('\n') || 'No reasoning trace available',
      plan: plan,
      conclusions: await this.extractConclusions(plan),
      confidence: this.calculateConfidence(plan)
    };
  }

  private async extractConclusions(plan: ExecutionPlan): Promise<string[]> {
    // Extract key conclusions from the execution plan
    const conclusions: string[] = [];
    
    for (const step of plan.steps) {
      if (step.type === 'reasoning' || step.type === 'analysis') {
        conclusions.push(`${step.description || 'Analysis step'}: ${JSON.stringify(step.spec)}`);
      }
    }
    
    return conclusions;
  }

  private calculateConfidence(plan: ExecutionPlan): number {
    // Calculate confidence based on plan complexity, tool success rates, etc.
    let totalConfidence = 0;
    let stepCount = 0;
    
    for (const step of plan.steps) {
      if (step.type === 'tool_use' && step.spec?.toolName) {
        const tool = this.getAvailableTools({} as ProjectContext)
          .find(t => t.name === step.spec.toolName);
        totalConfidence += tool?.successRate || 0.5;
      } else {
        totalConfidence += 0.8; // Default confidence for non-tool steps
      }
      stepCount++;
    }
    
    return stepCount > 0 ? totalConfidence / stepCount : 0.5;
  }

  // Update tool success rates (called by orchestrator after execution)
  async updateToolSuccess(toolName: string, pattern: any, wasSuccessful: boolean): Promise<void> {
    await this.toolSelector.updateSuccessRate(toolName, pattern, wasSuccessful);
  }

  // Get reasoning statistics
  async getReasoningStats(): Promise<any> {
    const cacheStats = await this.reasoningCache.getStats();
    const treeStats = await this.decisionTree.getStats();
    const toolStats = await this.toolSelector.getStats();
    
    return {
      cache: cacheStats,
      decisionTree: treeStats,
      toolSelection: toolStats,
      templates: this.templates.getStats()
    };
  }

  // Cleanup resources
  async cleanup(): Promise<void> {
    await this.reasoningCache.disconnect();
    // Other cleanup as needed
  }
} 