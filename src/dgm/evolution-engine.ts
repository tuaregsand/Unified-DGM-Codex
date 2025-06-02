import * as fs from 'fs/promises';
import * as path from 'path';
import * as cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import * as winston from 'winston';

import { BenchmarkRunner } from './benchmark-runner';
import { HypothesisGenerator } from './hypothesis-generator';
import { CodeMutator } from './code-mutator';
import { RollbackManager } from './rollback-manager';

import { 
  EvolutionConfig,
  EvolutionCycle,
  EvolutionMetrics,
  BenchmarkResults,
  Hypothesis,
  TestResult,
  Mutation,
  GitBranch,
  Checkpoint,
  HypothesisGenerationContext,
  SystemEvent,
  ModelEvent,
  DGMError,
  PerformanceMetrics
} from '../types';

export interface EvolutionEngineConfig {
  evolution: EvolutionConfig;
  benchmarking: {
    maxConcurrentBenchmarks: number;
    timeoutPerBenchmark: number;
    baselineRetryAttempts: number;
  };
  hypothesisGeneration: {
    maxHypothesesPerCycle: number;
    priorityWeights: {
      impact: number;
      feasibility: number;
      risk: number;
    };
    analysisTimeout: number;
    historyWindow: number;
  };
  mutation: {
    maxMutationsPerHypothesis: number;
    enableSafetyChecks: boolean;
    backupOriginalFiles: boolean;
    validationTimeout: number;
    allowedFileExtensions: string[];
    excludePaths: string[];
  };
  rollback: {
    workingDir: string;
    backupPath: string;
    maxCheckpoints: number;
    autoCleanup: boolean;
    verificationTimeout: number;
  };
}

export interface EvolutionEventListener {
  onCycleStart?: (cycle: EvolutionCycle) => void;
  onCycleComplete?: (cycle: EvolutionCycle) => void;
  onCycleError?: (cycle: EvolutionCycle, error: DGMError) => void;
  onHypothesisGenerated?: (hypotheses: Hypothesis[]) => void;
  onTestComplete?: (result: TestResult) => void;
  onImprovementApplied?: (improvement: TestResult) => void;
  onRollbackRequired?: (reason: string, cycle: EvolutionCycle) => void;
}

export const DEFAULT_EVOLUTION_CONFIG: EvolutionEngineConfig = {
  evolution: {
    enabled: true,
    schedule: '0 2 * * *', // Daily at 2 AM
    maxCyclesPerDay: 3,
    minImprovementThreshold: 1.0, // 1% minimum improvement
    maxRiskLevel: 'medium',
    autoApprovalThreshold: 5.0, // Auto-apply if >5% improvement
    benchmarkConfig: {
      sweBench: {
        enabled: true,
        sampleSize: 100,
        timeout: 300000, // 5 minutes
        categories: ['bug-fix', 'feature-implementation']
      },
      humanEval: {
        enabled: true,
        languages: ['python', 'javascript', 'typescript'],
        timeout: 120000 // 2 minutes
      },
      polyglot: {
        enabled: true,
        languages: ['python', 'javascript', 'typescript', 'java'],
        difficulty: 'all'
      },
      custom: {
        enabled: false,
        testSuites: []
      }
    },
    parallelHypotheses: 3,
    backupRetention: 7 // days
  },
  benchmarking: {
    maxConcurrentBenchmarks: 2,
    timeoutPerBenchmark: 600000, // 10 minutes
    baselineRetryAttempts: 3
  },
  hypothesisGeneration: {
    maxHypothesesPerCycle: 10,
    priorityWeights: {
      impact: 0.4,
      feasibility: 0.4,
      risk: 0.2
    },
    analysisTimeout: 300000, // 5 minutes
    historyWindow: 10 // last 10 cycles
  },
  mutation: {
    maxMutationsPerHypothesis: 5,
    enableSafetyChecks: true,
    backupOriginalFiles: true,
    validationTimeout: 60000, // 1 minute
    allowedFileExtensions: ['.ts', '.js', '.json', '.yaml', '.yml'],
    excludePaths: ['node_modules/', '.git/', 'dist/', 'build/']
  },
  rollback: {
    workingDir: process.cwd(),
    backupPath: './data/evolution-history/backups',
    maxCheckpoints: 20,
    autoCleanup: true,
    verificationTimeout: 120000 // 2 minutes
  }
};

export class EvolutionEngine {
  private logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ filename: './data/evolution-history/evolution.log' })
    ]
  });

  private config: EvolutionEngineConfig;
  private benchmarkRunner!: BenchmarkRunner;
  private hypothesisGenerator!: HypothesisGenerator;
  private codeMutator!: CodeMutator;
  private rollbackManager!: RollbackManager;

  private isRunning: boolean = false;
  private currentCycle?: EvolutionCycle;
  private cronJob?: cron.ScheduledTask;
  private eventListeners: EvolutionEventListener[] = [];

  // Evolution state
  private evolutionHistory: EvolutionCycle[] = [];
  private currentMetrics: EvolutionMetrics = {
    cyclesCompleted: 0,
    totalImprovements: 0,
    averageImprovement: 0,
    successRate: 0,
    rollbackRate: 0,
    avgCycleDuration: 0,
    bestPerformance: {
      sweBench: { score: 0, total: 0, passed: 0, failed: 0, duration: 0 },
      humanEval: { score: 0, total: 0, passed: 0, failed: 0, duration: 0 },
      polyglot: { score: 0, total: 0, passed: 0, failed: 0, duration: 0 }
    },
    currentPerformance: {
      sweBench: { score: 0, total: 0, passed: 0, failed: 0, duration: 0 },
      humanEval: { score: 0, total: 0, passed: 0, failed: 0, duration: 0 },
      polyglot: { score: 0, total: 0, passed: 0, failed: 0, duration: 0 }
    },
    history: []
  };

  constructor(config: EvolutionEngineConfig) {
    this.config = config;
    this.initializeComponents();
    this.setupEventHandlers();
    this.loadEvolutionHistory();
  }

  /**
   * Initialize all DGM components
   */
  private initializeComponents(): void {
    this.benchmarkRunner = new BenchmarkRunner(this.config.evolution.benchmarkConfig);
    
    this.hypothesisGenerator = new HypothesisGenerator({
      maxHypothesesPerCycle: this.config.hypothesisGeneration.maxHypothesesPerCycle,
      priorityWeights: this.config.hypothesisGeneration.priorityWeights,
      analysisTimeout: this.config.hypothesisGeneration.analysisTimeout,
      historyWindow: this.config.hypothesisGeneration.historyWindow
    });

    this.codeMutator = new CodeMutator({
      maxMutationsPerHypothesis: this.config.mutation.maxMutationsPerHypothesis,
      enableSafetyChecks: this.config.mutation.enableSafetyChecks,
      backupOriginalFiles: this.config.mutation.backupOriginalFiles,
      validationTimeout: this.config.mutation.validationTimeout,
      allowedFileExtensions: this.config.mutation.allowedFileExtensions,
      excludePaths: this.config.mutation.excludePaths
    });

    this.rollbackManager = new RollbackManager(this.config.rollback);
  }

  /**
   * Setup event handlers and logging
   */
  private setupEventHandlers(): void {
    process.on('SIGINT', () => this.gracefulShutdown());
    process.on('SIGTERM', () => this.gracefulShutdown());
  }

  /**
   * Start the evolution engine
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('EvolutionEngine is already running');
    }

    try {
      this.logger.info('Starting Evolution Engine', { config: this.config.evolution });

      if (!this.config.evolution.enabled) {
        this.logger.warn('Evolution is disabled in configuration');
        return;
      }

      this.isRunning = true;

      // Establish baseline performance
      await this.establishBaseline();

      // Schedule automatic evolution cycles
      if (this.config.evolution.schedule) {
        this.cronJob = cron.schedule(this.config.evolution.schedule, async () => {
          await this.runEvolutionCycle();
        });
        this.cronJob.start();
        this.logger.info('Scheduled automatic evolution cycles', { 
          schedule: this.config.evolution.schedule 
        });
      }

      this.logger.info('Evolution Engine started successfully');
    } catch (error) {
      this.isRunning = false;
      this.logger.error('Failed to start Evolution Engine', { error });
      throw error;
    }
  }

  /**
   * Stop the evolution engine
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping Evolution Engine');
    this.isRunning = false;

    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = undefined;
    }

    // Wait for current cycle to complete if running
    if (this.currentCycle && this.currentCycle.phase !== 'complete' && this.currentCycle.phase !== 'failed') {
      this.logger.info('Waiting for current evolution cycle to complete...');
      // We'll let the current cycle finish naturally
    }

    this.logger.info('Evolution Engine stopped');
  }

  /**
   * Run a single evolution cycle manually
   */
  async runEvolutionCycle(): Promise<EvolutionCycle> {
    if (!this.isRunning) {
      throw new Error('EvolutionEngine is not running');
    }

    if (this.currentCycle && this.currentCycle.phase !== 'complete' && this.currentCycle.phase !== 'failed') {
      throw new Error('Another evolution cycle is already in progress');
    }

    const cycleId = uuidv4();
    this.currentCycle = {
      id: cycleId,
      startTime: new Date(),
      phase: 'benchmark',
      baseline: this.currentMetrics.currentPerformance,
      hypotheses: [],
      testResults: [],
      appliedImprovements: [],
      totalImprovement: 0
    };

    try {
      this.logger.info('Starting evolution cycle', { cycleId });
      this.emitEvent('onCycleStart', this.currentCycle);

      // Phase 1: Benchmark current performance
      await this.runBenchmarkPhase();

      // Phase 2: Generate improvement hypotheses
      await this.runHypothesisGenerationPhase();

      // Phase 3: Test hypotheses
      await this.runTestingPhase();

      // Phase 4: Apply successful improvements
      await this.runApplicationPhase();

      // Complete the cycle
      this.currentCycle.phase = 'complete';
      this.currentCycle.endTime = new Date();
      this.currentCycle.duration = this.currentCycle.endTime.getTime() - this.currentCycle.startTime.getTime();

      // Update metrics
      await this.updateMetrics(this.currentCycle);

      // Save cycle to history
      this.evolutionHistory.push(this.currentCycle);
      await this.saveEvolutionHistory();

      this.logger.info('Evolution cycle completed successfully', { 
        cycleId,
        totalImprovement: this.currentCycle.totalImprovement,
        duration: this.currentCycle.duration 
      });

      this.emitEvent('onCycleComplete', this.currentCycle);
      return this.currentCycle;

    } catch (error) {
      this.currentCycle.phase = 'failed';
      this.currentCycle.endTime = new Date();
      this.currentCycle.metadata = { 
        error: error instanceof Error ? error.message : String(error) 
      };

      this.logger.error('Evolution cycle failed', { error, cycleId });
      this.emitEvent('onCycleError', this.currentCycle, error as DGMError);

      throw error;
    }
  }

  /**
   * Phase 1: Benchmark current performance
   */
  private async runBenchmarkPhase(): Promise<void> {
    this.logger.info('Running benchmark phase');
    this.currentCycle!.phase = 'benchmark';

    try {
      // Create checkpoint before benchmarking
      const checkpoint = await this.rollbackManager.createCheckpoint(
        `Pre-benchmark checkpoint for cycle ${this.currentCycle!.id}`
      );

      // Run benchmarks
      const benchmarkResults = await this.benchmarkRunner.run();
      
      // Update current performance
      this.currentMetrics.currentPerformance = benchmarkResults;
      this.currentCycle!.baseline = benchmarkResults;

      this.logger.info('Benchmark phase completed', { results: benchmarkResults });
    } catch (error) {
      this.logger.error('Benchmark phase failed', { error });
      throw error;
    }
  }

  /**
   * Phase 2: Generate improvement hypotheses
   */
  private async runHypothesisGenerationPhase(): Promise<void> {
    this.logger.info('Running hypothesis generation phase');
    this.currentCycle!.phase = 'hypothesis-generation';

    try {
      const context: HypothesisGenerationContext = {
        currentMetrics: this.currentCycle!.baseline,
        historicalMetrics: this.evolutionHistory.map(h => h.baseline),
        systemAnalysis: await this.generateSystemAnalysis(),
        recentFailures: this.getRecentFailures(),
        performanceBottlenecks: this.identifyPerformanceBottlenecks(),
        userFeedback: [] // Could be populated from user feedback system
      };

      const hypotheses = await this.hypothesisGenerator.generate(context);
      this.currentCycle!.hypotheses = hypotheses;

      this.logger.info('Hypothesis generation phase completed', { 
        hypothesesCount: hypotheses.length 
      });

      this.emitEvent('onHypothesisGenerated', hypotheses);
    } catch (error) {
      this.logger.error('Hypothesis generation phase failed', { error });
      throw error;
    }
  }

  /**
   * Phase 3: Test hypotheses
   */
  private async runTestingPhase(): Promise<void> {
    this.logger.info('Running testing phase');
    this.currentCycle!.phase = 'testing';

    const testPromises: Promise<TestResult>[] = [];

    try {
      // Test hypotheses in parallel (limited by config)
      const hypotheses = this.currentCycle!.hypotheses;
      const parallelLimit = this.config.evolution.parallelHypotheses || 3;

      for (let i = 0; i < hypotheses.length; i += parallelLimit) {
        const batch = hypotheses.slice(i, i + parallelLimit);
        const batchPromises = batch.map(hypothesis => this.testHypothesis(hypothesis));
        const batchResults = await Promise.allSettled(batchPromises);

        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            this.currentCycle!.testResults.push(result.value);
            this.emitEvent('onTestComplete', result.value);
          } else {
            this.logger.error('Hypothesis test failed', { error: result.reason });
          }
        }
      }

      this.logger.info('Testing phase completed', { 
        testsRun: this.currentCycle!.testResults.length,
        successful: this.currentCycle!.testResults.filter(r => r.success).length 
      });
    } catch (error) {
      this.logger.error('Testing phase failed', { error });
      throw error;
    }
  }

  /**
   * Phase 4: Apply successful improvements
   */
  private async runApplicationPhase(): Promise<void> {
    this.logger.info('Running application phase');
    this.currentCycle!.phase = 'application';

    try {
      // Filter successful results that meet improvement threshold
      const successfulResults = this.currentCycle!.testResults
        .filter(result => 
          result.success && 
          result.improvement >= this.config.evolution.minImprovementThreshold
        )
        .sort((a, b) => b.improvement - a.improvement); // Sort by improvement descending

      for (const result of successfulResults) {
        try {
          // Check if improvement meets auto-approval threshold
          if (result.improvement >= this.config.evolution.autoApprovalThreshold) {
            await this.applyImprovement(result);
            this.currentCycle!.appliedImprovements.push(result.hypothesisId);
            this.currentCycle!.totalImprovement += result.improvement;
            
            this.emitEvent('onImprovementApplied', result);
            
            this.logger.info('Applied improvement automatically', { 
              hypothesisId: result.hypothesisId,
              improvement: result.improvement 
            });
          } else {
            // Log for manual review
            this.logger.info('Improvement below auto-approval threshold, logging for review', {
              hypothesisId: result.hypothesisId,
              improvement: result.improvement,
              threshold: this.config.evolution.autoApprovalThreshold
            });
          }
        } catch (error) {
          this.logger.error('Failed to apply improvement', { 
            error, 
            hypothesisId: result.hypothesisId 
          });
        }
      }

      this.logger.info('Application phase completed', { 
        improvementsApplied: this.currentCycle!.appliedImprovements.length,
        totalImprovement: this.currentCycle!.totalImprovement 
      });
    } catch (error) {
      this.logger.error('Application phase failed', { error });
      throw error;
    }
  }

  /**
   * Test a single hypothesis
   */
  private async testHypothesis(hypothesis: Hypothesis): Promise<TestResult> {
    const testId = uuidv4();
    this.logger.info('Testing hypothesis', { hypothesisId: hypothesis.id, testId });

    let experimentBranch: GitBranch | undefined;
    const startTime = Date.now();

    try {
      // Create experiment branch
      experimentBranch = await this.rollbackManager.createBranch(hypothesis.id);

      // Generate mutations for the hypothesis
      const mutations = await this.codeMutator.generateMutations(hypothesis);

      // Apply mutations
      await this.rollbackManager.applyMutations(mutations, experimentBranch.name);

      // Run benchmarks on the modified code
      const benchmarkResults = await this.benchmarkRunner.runInBranch(experimentBranch);

      // Calculate improvement
      const improvement = this.benchmarkRunner.calculateImprovement(
        this.currentCycle!.baseline,
        benchmarkResults
      );

      const duration = Date.now() - startTime;
      const success = improvement > 0 && improvement >= this.config.evolution.minImprovementThreshold;

      const testResult: TestResult = {
        hypothesisId: hypothesis.id,
        success,
        improvement,
        mutations,
        benchmarkResults,
        duration,
        rollbackRequired: !success
      };

      if (!success) {
        // Clean up failed experiment
        await this.rollbackManager.deleteBranch(experimentBranch);
      }

      this.logger.info('Hypothesis test completed', { 
        hypothesisId: hypothesis.id,
        success,
        improvement,
        duration 
      });

      return testResult;

    } catch (error) {
      // Clean up on error
      if (experimentBranch) {
        try {
          await this.rollbackManager.deleteBranch(experimentBranch);
        } catch (cleanupError) {
          this.logger.error('Failed to cleanup experiment branch', { cleanupError });
        }
      }

      const duration = Date.now() - startTime;
      this.logger.error('Hypothesis test failed', { error, hypothesisId: hypothesis.id });

      return {
        hypothesisId: hypothesis.id,
        success: false,
        improvement: 0,
        mutations: [],
        benchmarkResults: this.currentCycle!.baseline,
        duration,
        errors: [error instanceof Error ? error.message : String(error)],
        rollbackRequired: true
      };
    }
  }

  /**
   * Apply an improvement to the main branch
   */
  private async applyImprovement(testResult: TestResult): Promise<void> {
    try {
      // Find the experiment branch
      const experimentBranch = this.rollbackManager.getBranches()
        .find(b => b.metadata?.hypothesisId === testResult.hypothesisId);

      if (!experimentBranch) {
        throw new Error(`Experiment branch not found for hypothesis ${testResult.hypothesisId}`);
      }

      // Create checkpoint before applying changes
      await this.rollbackManager.createCheckpoint(
        `Pre-improvement checkpoint for hypothesis ${testResult.hypothesisId}`,
        testResult.benchmarkResults
      );

      // Merge the experiment branch to main
      await this.rollbackManager.mergeToMain(experimentBranch);

      // Update current metrics
      this.currentMetrics.currentPerformance = testResult.benchmarkResults;

      // Clean up experiment branch
      await this.rollbackManager.deleteBranch(experimentBranch);

      this.logger.info('Improvement applied successfully', { 
        hypothesisId: testResult.hypothesisId,
        improvement: testResult.improvement 
      });

    } catch (error) {
      this.logger.error('Failed to apply improvement', { 
        error, 
        hypothesisId: testResult.hypothesisId 
      });
      throw error;
    }
  }

  /**
   * Establish baseline performance
   */
  private async establishBaseline(): Promise<void> {
    this.logger.info('Establishing baseline performance');

    try {
      const baselineResults = await this.benchmarkRunner.run();
      this.currentMetrics.currentPerformance = baselineResults;
      this.currentMetrics.bestPerformance = baselineResults;

      this.logger.info('Baseline established', { baseline: baselineResults });
    } catch (error) {
      this.logger.error('Failed to establish baseline', { error });
      throw error;
    }
  }

  /**
   * Update evolution metrics
   */
  private async updateMetrics(cycle: EvolutionCycle): Promise<void> {
    this.currentMetrics.cyclesCompleted++;
    this.currentMetrics.history.push(cycle);

    if (cycle.totalImprovement > 0) {
      this.currentMetrics.totalImprovements++;
    }

    // Calculate average improvement
    const improvementSum = this.evolutionHistory
      .reduce((sum, c) => sum + c.totalImprovement, 0);
    this.currentMetrics.averageImprovement = 
      this.currentMetrics.cyclesCompleted > 0 ? improvementSum / this.currentMetrics.cyclesCompleted : 0;

    // Calculate success rate
    const successfulCycles = this.evolutionHistory
      .filter(c => c.phase === 'complete' && c.totalImprovement > 0).length;
    this.currentMetrics.successRate = 
      this.currentMetrics.cyclesCompleted > 0 ? successfulCycles / this.currentMetrics.cyclesCompleted : 0;

    // Calculate rollback rate
    const rollbackCycles = this.evolutionHistory
      .filter(c => c.testResults.some(r => r.rollbackRequired)).length;
    this.currentMetrics.rollbackRate = 
      this.currentMetrics.cyclesCompleted > 0 ? rollbackCycles / this.currentMetrics.cyclesCompleted : 0;

    // Calculate average cycle duration
    const totalDuration = this.evolutionHistory
      .filter(c => c.duration)
      .reduce((sum, c) => sum + c.duration!, 0);
    this.currentMetrics.avgCycleDuration = 
      this.evolutionHistory.length > 0 ? totalDuration / this.evolutionHistory.length : 0;

    // Update best performance
    const currentScore = this.calculateOverallScore(this.currentMetrics.currentPerformance);
    const bestScore = this.calculateOverallScore(this.currentMetrics.bestPerformance);
    
    if (currentScore > bestScore) {
      this.currentMetrics.bestPerformance = this.currentMetrics.currentPerformance;
    }
  }

  /**
   * Calculate overall score from benchmark results
   */
  private calculateOverallScore(results: BenchmarkResults): number {
    return (results.sweBench.score + results.humanEval.score + results.polyglot.score) / 3;
  }

  /**
   * Generate system analysis for hypothesis generation
   */
  private async generateSystemAnalysis(): Promise<any> {
    // This would typically involve more sophisticated analysis
    // For now, return a simplified analysis structure
    return {
      performanceProfile: {
        tokenEfficiency: 0.7,
        responseTime: 1500,
        accuracy: 0.8,
        contextUtilization: 0.65,
        cacheHitRate: 0.3,
        modelUtilization: {
          'llama-scout': 0.6,
          'claude-sonnet': 0.8,
          'gpt': 0.7
        }
      },
      bottlenecks: [],
      resourceUtilization: {
        cpu: 0.4,
        memory: 0.6,
        network: 0.3,
        modelApiCalls: 150,
        cacheUsage: 0.3,
        diskIo: 0.2
      },
      errorPatterns: [],
      codeQualityMetrics: {
        complexity: 0.7,
        maintainability: 0.8,
        testCoverage: 0.6,
        codeSmells: 5,
        duplicateCode: 0.1,
        technicalDebt: 0.3
      }
    };
  }

  /**
   * Get recent failures from evolution history
   */
  private getRecentFailures(): string[] {
    return this.evolutionHistory
      .slice(-5) // Last 5 cycles
      .flatMap(cycle => cycle.testResults.filter(r => !r.success).map(r => r.hypothesisId));
  }

  /**
   * Identify performance bottlenecks
   */
  private identifyPerformanceBottlenecks(): string[] {
    const bottlenecks: string[] = [];
    const current = this.currentMetrics.currentPerformance;

    if (current.sweBench.score < 50) bottlenecks.push('SWE-bench performance');
    if (current.humanEval.score < 70) bottlenecks.push('HumanEval accuracy');
    if (current.polyglot.score < 60) bottlenecks.push('Polyglot language support');

    return bottlenecks;
  }

  /**
   * Add event listener
   */
  addEventListener(listener: EvolutionEventListener): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: EvolutionEventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Emit event to all listeners
   */
  private emitEvent(eventName: keyof EvolutionEventListener, ...args: any[]): void {
    this.eventListeners.forEach(listener => {
      const handler = listener[eventName];
      if (handler) {
        try {
          (handler as Function)(...args);
        } catch (error) {
          this.logger.error('Event listener error', { error, eventName });
        }
      }
    });
  }

  /**
   * Get current evolution metrics
   */
  getMetrics(): EvolutionMetrics {
    return { ...this.currentMetrics };
  }

  /**
   * Get evolution history
   */
  getHistory(): EvolutionCycle[] {
    return [...this.evolutionHistory];
  }

  /**
   * Get current cycle
   */
  getCurrentCycle(): EvolutionCycle | undefined {
    return this.currentCycle;
  }

  /**
   * Load evolution history from disk
   */
  private async loadEvolutionHistory(): Promise<void> {
    try {
      const historyPath = './data/evolution-history/cycles.json';
      const historyData = await fs.readFile(historyPath, 'utf-8');
      this.evolutionHistory = JSON.parse(historyData);
      
      // Update metrics from loaded history
      if (this.evolutionHistory.length > 0) {
        const lastCycle = this.evolutionHistory[this.evolutionHistory.length - 1];
        await this.updateMetrics(lastCycle);
      }
      
      this.logger.info('Evolution history loaded', { cycles: this.evolutionHistory.length });
    } catch (error) {
      // File might not exist yet, which is fine
      this.logger.info('No existing evolution history found, starting fresh');
    }
  }

  /**
   * Save evolution history to disk
   */
  private async saveEvolutionHistory(): Promise<void> {
    try {
      const historyPath = './data/evolution-history/cycles.json';
      await fs.mkdir(path.dirname(historyPath), { recursive: true });
      await fs.writeFile(historyPath, JSON.stringify(this.evolutionHistory, null, 2));
    } catch (error) {
      this.logger.error('Failed to save evolution history', { error });
    }
  }

  /**
   * Graceful shutdown
   */
  private async gracefulShutdown(): Promise<void> {
    this.logger.info('Graceful shutdown initiated');
    await this.stop();
    await this.saveEvolutionHistory();
    this.logger.info('Graceful shutdown completed');
    process.exit(0);
  }
}

 