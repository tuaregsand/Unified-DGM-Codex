// Core system types for Unified DGM-Codex

// ====== Context and Data Types ======

export interface FileData {
  path: string;
  content: string;
  type?: string;
  size?: number;
  lastModified?: Date;
}

export interface ContextResult {
  content: string;
  sources?: string[];
  relevanceScore?: number;
  metadata?: Record<string, any>;
}

export interface ProjectContext {
  projectPath: string;
  currentFileContent?: string;
  files?: string[];
  dependencies?: Record<string, string>;
  history?: ConversationEntry[];
}

export interface ConversationEntry {
  timestamp: Date;
  request: string;
  response?: string;
  actions?: string[];
}

// ====== Model Configuration Types ======

export interface LlamaScoutConfig {
  apiKey?: string;
  apiEndpoint?: string;
  vectorIndexPath?: string;
  cacheLevels?: string[];
  cacheTTL?: number;
  cacheUrl?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  chunkingStrategy?: 'fixed-size' | 'semantic-aware' | 'function-aware' | 'paragraph-aware';
  memoryGraphPath?: string;
  maxTokens?: number;
}

export interface NodeMetadata {
  language?: string;
  lineNumber?: number;
  startPos?: number;
  endPos?: number;
  visibility?: 'public' | 'private' | 'protected';
  isExported?: boolean;
  parameters?: string[];
  returnType?: string;
  importance?: number; // Added for importance scoring
  inDegree?: number;   // Added for graph analysis
  outDegree?: number;  // Added for graph analysis
}

export interface ClaudeSonnetConfig {
  apiKey?: string;
  apiEndpoint?: string;
  reasoningCachePath?: string;
  maxReasoningDepth?: number;
  thoughtTemplate?: string;
  planningMode?: 'sequential' | 'hierarchical' | 'adaptive';
  reasoningCacheMaxEntries?: number;
  reasoningCacheSimilarityThreshold?: number;
  decisionTreeMaxDepth?: number;
  decisionTreeMinSamplesLeaf?: number;
  decisionTreePersistPath?: string;
  toolSelectorLearningRate?: number;
  toolSelectorExplorationRate?: number;
  toolSelectorMatrixPath?: string;
  planTemplatePath?: string;
}

export interface GPTConfig {
  apiKey?: string;
  apiEndpoint?: string;
  model?: string;
  astTemplatePath?: string;
  styleConfigPath?: string;
  checkpointInterval?: number;
  testGeneration?: boolean;
}

// ====== Orchestration Types ======

export interface QueryRequest {
  message: string;
  files?: FileData[];
  context?: ProjectContext;
  includeTests?: boolean;
  outputFormat?: 'code' | 'explanation' | 'both';
  priority?: 'fast' | 'thorough' | 'creative';
}

export interface QueryResponse {
  response: string;
  code?: string;
  files?: FileData[];
  reasoning?: string;
  confidence?: number;
  suggestions?: string[];
  metadata?: {
    modelUsed?: string;
    processingTimeMs?: number;
    tokensUsed?: number;
    contextSizeUsed?: number;
  };
}

export interface TaskDistribution {
  contextManager: {
    model: 'llama-scout';
    query: string;
    config?: Partial<LlamaScoutConfig>;
  };
  reasoningEngine?: {
    model: 'claude-sonnet';
    query: string;
    config?: Partial<ClaudeSonnetConfig>;
  };
  codeGenerator?: {
    model: 'gpt';
    query: string;
    config?: Partial<GPTConfig>;
  };
}

// ====== DGM Enhancement Types ======

export interface PerformanceMetrics {
  accuracy?: number;
  speed?: number;
  contextUtilization?: number;
  tokenEfficiency?: number;
  userSatisfaction?: number;
}

export interface SelfImprovementData {
  currentMetrics: PerformanceMetrics;
  historicalTrends: PerformanceMetrics[];
  identifiedBottlenecks?: string[];
  proposedEnhancements?: string[];
  testResults?: Record<string, any>;
}

export interface EvolutionInstruction {
  componentToModify: string;
  modificationType: 'parameter-tuning' | 'architecture-change' | 'prompt-optimization';
  changes: Record<string, any>;
  expectedImprovement: PerformanceMetrics;
  rollbackConditions?: string[];
}

// ====== Vector Search and Indexing ======

export interface VectorSearchResult {
  content: string;
  similarity: number;
  metadata?: Record<string, any>;
  source?: string;
}

export interface IndexedDocument {
  id: string;
  content: string;
  vector?: number[];
  metadata?: Record<string, any>;
}

// ====== Cache and Memory Types ======

export interface CacheLevel {
  name: string;
  ttl: number;
  maxSize?: number;
  evictionPolicy?: 'lru' | 'fifo' | 'random';
}

export interface MemoryNode {
  id: string;
  type: 'file' | 'function' | 'class' | 'concept';
  content: string;
  relationships?: string[];
  importance?: number;
  lastAccessed?: Date;
}

// ====== Tool and Plugin Types ======

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler: (params: any) => Promise<any>;
}

export interface PluginConfig {
  name: string;
  version: string;
  enabled: boolean;
  config?: Record<string, any>;
}

// ====== CLI and Interface Types ======

export interface CLICommand {
  name: string;
  description: string;
  options?: Record<string, any>;
  handler: (args: any) => Promise<void>;
}

export interface InteractiveSession {
  id: string;
  startTime: Date;
  context: ProjectContext;
  history: ConversationEntry[];
  activeModels?: string[];
}

// ====== Configuration and Settings ======

export interface SystemConfig {
  llama: LlamaScoutConfig;
  claude: ClaudeSonnetConfig;
  gpt: GPTConfig;
  
  // Global settings
  maxConcurrentRequests?: number;
  loggingLevel?: 'debug' | 'info' | 'warn' | 'error';
  persistencePath?: string;
  
  // DGM settings
  enableSelfImprovement?: boolean;
  improvementInterval?: number;
  metricsCollectionEnabled?: boolean;
}

export interface EnvironmentConfig {
  development: SystemConfig;
  production: SystemConfig;
  testing: SystemConfig;
}

// ====== Execution and Planning Types ======

export interface ExecutionStep {
  type: 'code_generation' | 'code_modification' | 'analysis' | 'reasoning' | 'tool_use';
  spec: any;
  description?: string;
  dependencies?: string[];
}

export interface ExecutionPlan {
  steps: ExecutionStep[];
  reasoningTrace?: string[];
  templateId?: string;
  estimatedDuration?: number;
  complexity?: 'simple' | 'medium' | 'complex';
  category?: string;
  prerequisites?: string[];
  rollbackSteps?: ExecutionStep[];
  patternId?: string;
  isNewPattern?: boolean;
}

export interface ExecutionResult {
  prompt: string;
  plan: ExecutionPlan;
  results: StepResult[];
  success: boolean;
  duration?: number;
}

export interface StepResult {
  stepType: string;
  success: boolean;
  output?: any;
  errors?: string[];
  duration?: number;
}

// ====== Code Generation Types ======

export interface CodeSpec {
  description: string;
  language?: string;
  existingCode?: string;
  requirements?: string[];
  constraints?: string[];
  styleGuide?: StyleGuide;
  maxTokensPerChunk?: number;
  temperature?: number;
}

export interface GeneratedCode {
  code: string;
  tests?: string;
  documentation?: string;
  metadata?: CodeMetadata;
}

export interface CodeMetadata {
  language: string;
  framework?: string;
  dependencies?: string[];
  complexity?: number;
  coverage?: number;
}

export interface StyleGuide {
  indentation?: 'spaces' | 'tabs';
  indentSize?: number;
  maxLineLength?: number;
  quotes?: 'single' | 'double';
  semicolons?: boolean;
  trailingCommas?: boolean;
  naming?: NamingConvention;
}

export interface NamingConvention {
  variables?: 'camelCase' | 'snake_case' | 'kebab-case';
  functions?: 'camelCase' | 'snake_case' | 'kebab-case';
  classes?: 'PascalCase' | 'camelCase';
  constants?: 'UPPER_CASE' | 'camelCase';
}

// ====== DGM Evolution Types ======

export interface EvolutionResult {
  improvements: Improvement[];
  metrics: PerformanceMetrics;
  success: boolean;
  timestamp: Date;
}

export interface Improvement {
  id: string;
  type: string;
  description: string;
  codeChanges: CodeChange[];
  performanceGain: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface CodeChange {
  file: string;
  oldCode: string;
  newCode: string;
  lineNumbers: number[];
}

// ====== CLI Types ======

export interface CLIOptions {
  approvalMode?: 'suggest' | 'auto-edit' | 'full-auto';
  json?: boolean;
  verbose?: boolean;
  timeout?: number;
}

export interface ExecutionOptions extends CLIOptions {
  maxRetries?: number;
  rollbackOnFailure?: boolean;
}

export interface EvolutionOptions {
  auto?: boolean;
  benchmarkOnly?: boolean;
  targetImprovement?: number;
}

// ====== Tool and Utility Types ======

export interface Tool {
  name: string;
  description: string;
  input_schema: any;
  capabilities?: string[];
  successRate?: number;
}

export interface BenchmarkResults {
  sweBench: BenchmarkResult;
  humanEval: BenchmarkResult;
  polyglot: BenchmarkResult;
  custom?: BenchmarkResult[];
}

export interface BenchmarkResult {
  score: number;
  total: number;
  passed: number;
  failed: number;
  duration: number;
  details?: any;
}

// ====== Error Types ======

export interface DGMError extends Error {
  code: string;
  component: string;
  context?: any;
}

export interface ValidationError extends DGMError {
  field: string;
  value: any;
}

// ====== Event Types ======

export interface SystemEvent {
  type: string;
  timestamp: Date;
  source: string;
  data: any;
}

export interface ModelEvent extends SystemEvent {
  modelName: string;
  operation: string;
  duration?: number;
  tokens?: number;
}

// ====== DGM Evolution Engine Types ======

export interface Hypothesis {
  id: string;
  description: string;
  type: 'parameter-tuning' | 'architecture-change' | 'prompt-optimization' | 'model-optimization';
  targetComponent: string;
  proposedChanges: Record<string, any>;
  expectedImprovement: number; // Percentage improvement expected
  priority: 'low' | 'medium' | 'high';
  riskLevel: 'low' | 'medium' | 'high';
  estimatedDuration: number; // Minutes
  generatedBy: 'analysis' | 'pattern' | 'llm' | 'manual';
  metadata?: Record<string, any>;
}

export interface TestResult {
  hypothesisId: string;
  success: boolean;
  improvement: number; // Actual improvement achieved
  mutations: Mutation[];
  benchmarkResults: BenchmarkResults;
  duration: number;
  errors?: string[];
  rollbackRequired: boolean;
  metadata?: Record<string, any>;
}

export interface Mutation {
  id: string;
  type: 'file-modification' | 'config-change' | 'parameter-update' | 'prompt-template-change';
  targetFile?: string;
  originalValue: any;
  newValue: any;
  description: string;
  safetyChecks: string[];
  rollbackData: any;
}

export interface EvolutionCycle {
  id: string;
  startTime: Date;
  endTime?: Date;
  phase: 'benchmark' | 'hypothesis-generation' | 'testing' | 'application' | 'complete' | 'failed';
  baseline: BenchmarkResults;
  hypotheses: Hypothesis[];
  testResults: TestResult[];
  appliedImprovements: string[]; // hypothesis IDs
  totalImprovement: number;
  duration?: number;
  metadata?: Record<string, any>;
}

export interface BenchmarkConfig {
  sweBench: {
    enabled: boolean;
    sampleSize?: number;
    timeout?: number;
    categories?: string[];
  };
  humanEval: {
    enabled: boolean;
    languages?: string[];
    timeout?: number;
  };
  polyglot: {
    enabled: boolean;
    languages?: string[];
    difficulty?: 'easy' | 'medium' | 'hard' | 'all';
  };
  custom: {
    enabled: boolean;
    testSuites?: string[];
  };
}

export interface EvolutionMetrics {
  cyclesCompleted: number;
  totalImprovements: number;
  averageImprovement: number;
  successRate: number;
  rollbackRate: number;
  avgCycleDuration: number;
  bestPerformance: BenchmarkResults;
  currentPerformance: BenchmarkResults;
  history: EvolutionCycle[];
}

export interface HypothesisGenerationContext {
  currentMetrics: BenchmarkResults;
  historicalMetrics: BenchmarkResults[];
  systemAnalysis: SystemAnalysis;
  recentFailures?: string[];
  performanceBottlenecks?: string[];
  userFeedback?: string[];
}

export interface SystemAnalysis {
  performanceProfile: PerformanceProfile;
  bottlenecks: Bottleneck[];
  resourceUtilization: ResourceUtilization;
  errorPatterns: ErrorPattern[];
  codeQualityMetrics: CodeQualityMetrics;
}

export interface PerformanceProfile {
  tokenEfficiency: number;
  responseTime: number;
  accuracy: number;
  contextUtilization: number;
  cacheHitRate: number;
  modelUtilization: Record<string, number>;
}

export interface Bottleneck {
  component: string;
  type: 'performance' | 'accuracy' | 'resource' | 'logic';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  impact: number; // Estimated performance impact percentage
  possibleSolutions: string[];
}

export interface ResourceUtilization {
  cpu: number;
  memory: number;
  network: number;
  modelApiCalls: number;
  cacheUsage: number;
  diskIo: number;
}

export interface ErrorPattern {
  type: string;
  frequency: number;
  component: string;
  description: string;
  examples: string[];
  suggestedFixes: string[];
}

export interface CodeQualityMetrics {
  complexity: number;
  maintainability: number;
  testCoverage: number;
  codeSmells: number;
  duplicateCode: number;
  technicalDebt: number;
}

export interface GitBranch {
  name: string;
  commit: string;
  created: Date;
  type: 'experiment' | 'rollback' | 'main';
  metadata?: Record<string, any>;
}

export interface Checkpoint {
  id: string;
  timestamp: Date;
  branch: string;
  commit: string;
  systemState: SystemState;
  benchmarkResults?: BenchmarkResults;
  description: string;
}

export interface SystemState {
  codeVersion: string;
  configuration: Record<string, any>;
  modelStates: Record<string, any>;
  cacheState?: any;
  performanceMetrics: PerformanceMetrics;
}

export interface RollbackPlan {
  checkpointId: string;
  mutations: Mutation[];
  verification: VerificationStep[];
  estimatedDuration: number;
  riskAssessment: string;
}

export interface VerificationStep {
  type: 'compile' | 'test' | 'benchmark' | 'manual';
  description: string;
  command?: string;
  expectedResult?: any;
  timeout?: number;
}

export interface EvolutionConfig {
  enabled: boolean;
  schedule: string; // Cron format
  maxCyclesPerDay: number;
  minImprovementThreshold: number; // Minimum improvement % to apply
  maxRiskLevel: 'low' | 'medium' | 'high';
  autoApprovalThreshold: number; // Auto-apply if improvement > threshold
  benchmarkConfig: BenchmarkConfig;
  parallelHypotheses: number;
  backupRetention: number; // Days to keep backups
}

// Additional exports for backward compatibility
export type { Tool, BenchmarkResults, BenchmarkResult }; 