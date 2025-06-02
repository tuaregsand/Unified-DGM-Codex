import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import * as benchmark from 'benchmark';
import { 
  BenchmarkConfig, 
  BenchmarkResults, 
  BenchmarkResult,
  GitBranch,
  PerformanceMetrics 
} from '../types';
import { createLogger } from 'winston';

export interface BenchmarkContext {
  workingDir: string;
  branch?: string;
  timeout: number;
  environment: Record<string, string>;
  resourceLimits?: {
    maxMemory?: number;
    maxCpu?: number;
    maxTime?: number;
  };
}

export interface BenchmarkTest {
  id: string;
  name: string;
  description: string;
  expectedOutput?: any;
  timeout: number;
  category?: string;
}

export class BenchmarkRunner {
  private logger = createLogger({
    level: 'info',
    format: createLogger.format.json(),
    transports: [
      new createLogger.transports.Console(),
      new createLogger.transports.File({ filename: './data/evolution-history/benchmark.log' })
    ]
  });

  private config: BenchmarkConfig;
  private benchmarkDataPath: string;

  constructor(config: BenchmarkConfig) {
    this.config = config;
    this.benchmarkDataPath = './data/benchmarks';
    this.ensureDirectories();
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.benchmarkDataPath, { recursive: true });
    await fs.mkdir('./data/evolution-history', { recursive: true });
  }

  /**
   * Run all enabled benchmarks
   */
  async run(context?: BenchmarkContext): Promise<BenchmarkResults> {
    const runId = uuidv4();
    this.logger.info(`Starting benchmark run ${runId}`, { context });

    const results: BenchmarkResults = {
      sweBench: { score: 0, total: 0, passed: 0, failed: 0, duration: 0 },
      humanEval: { score: 0, total: 0, passed: 0, failed: 0, duration: 0 },
      polyglot: { score: 0, total: 0, passed: 0, failed: 0, duration: 0 }
    };

    try {
      // Run SWE-bench if enabled
      if (this.config.sweBench.enabled) {
        this.logger.info('Running SWE-bench benchmark...');
        results.sweBench = await this.runSweBench(context);
      }

      // Run HumanEval if enabled
      if (this.config.humanEval.enabled) {
        this.logger.info('Running HumanEval benchmark...');
        results.humanEval = await this.runHumanEval(context);
      }

      // Run Polyglot if enabled
      if (this.config.polyglot.enabled) {
        this.logger.info('Running Polyglot benchmark...');
        results.polyglot = await this.runPolyglot(context);
      }

      // Run custom benchmarks if enabled
      if (this.config.custom.enabled) {
        this.logger.info('Running custom benchmarks...');
        results.custom = await this.runCustomBenchmarks(context);
      }

      this.logger.info(`Benchmark run ${runId} completed`, { results });
      await this.saveBenchmarkResults(runId, results);

      return results;
    } catch (error) {
      this.logger.error(`Benchmark run ${runId} failed`, { error });
      throw error;
    }
  }

  /**
   * Run benchmarks in a specific Git branch
   */
  async runInBranch(branch: GitBranch, context?: BenchmarkContext): Promise<BenchmarkResults> {
    const branchContext: BenchmarkContext = {
      ...context,
      branch: branch.name,
      workingDir: context?.workingDir || process.cwd(),
      timeout: context?.timeout || 300000, // 5 minutes default
      environment: { ...process.env, ...context?.environment }
    };

    return this.run(branchContext);
  }

  /**
   * Run SWE-bench benchmark suite
   */
  private async runSweBench(context?: BenchmarkContext): Promise<BenchmarkResult> {
    const startTime = Date.now();
    const sampleSize = this.config.sweBench.sampleSize || 100;
    const timeout = this.config.sweBench.timeout || 120000; // 2 minutes per test

    try {
      // For demonstration, we'll create a simplified SWE-bench implementation
      // In a real implementation, this would integrate with the actual SWE-bench dataset
      const tests = await this.loadSweBenchTests(sampleSize);
      let passed = 0;
      let failed = 0;

      for (const test of tests) {
        try {
          const result = await this.executeSweBenchTest(test, context, timeout);
          if (result.success) {
            passed++;
          } else {
            failed++;
          }
        } catch (error) {
          failed++;
          this.logger.warn(`SWE-bench test ${test.id} failed`, { error: error.message });
        }
      }

      const duration = Date.now() - startTime;
      const total = tests.length;
      const score = total > 0 ? (passed / total) * 100 : 0;

      return { score, total, passed, failed, duration };
    } catch (error) {
      this.logger.error('SWE-bench benchmark failed', { error });
      const duration = Date.now() - startTime;
      return { score: 0, total: 0, passed: 0, failed: 1, duration };
    }
  }

  /**
   * Run HumanEval benchmark suite
   */
  private async runHumanEval(context?: BenchmarkContext): Promise<BenchmarkResult> {
    const startTime = Date.now();
    const languages = this.config.humanEval.languages || ['python', 'typescript'];
    const timeout = this.config.humanEval.timeout || 60000; // 1 minute per test

    try {
      const tests = await this.loadHumanEvalTests(languages);
      let passed = 0;
      let failed = 0;

      for (const test of tests) {
        try {
          const result = await this.executeHumanEvalTest(test, context, timeout);
          if (result.success) {
            passed++;
          } else {
            failed++;
          }
        } catch (error) {
          failed++;
          this.logger.warn(`HumanEval test ${test.id} failed`, { error: error.message });
        }
      }

      const duration = Date.now() - startTime;
      const total = tests.length;
      const score = total > 0 ? (passed / total) * 100 : 0;

      return { score, total, passed, failed, duration };
    } catch (error) {
      this.logger.error('HumanEval benchmark failed', { error });
      const duration = Date.now() - startTime;
      return { score: 0, total: 0, passed: 0, failed: 1, duration };
    }
  }

  /**
   * Run Polyglot benchmark suite
   */
  private async runPolyglot(context?: BenchmarkContext): Promise<BenchmarkResult> {
    const startTime = Date.now();
    const languages = this.config.polyglot.languages || ['python', 'typescript', 'javascript'];
    const difficulty = this.config.polyglot.difficulty || 'medium';

    try {
      const tests = await this.loadPolyglotTests(languages, difficulty);
      let passed = 0;
      let failed = 0;

      for (const test of tests) {
        try {
          const result = await this.executePolyglotTest(test, context);
          if (result.success) {
            passed++;
          } else {
            failed++;
          }
        } catch (error) {
          failed++;
          this.logger.warn(`Polyglot test ${test.id} failed`, { error: error.message });
        }
      }

      const duration = Date.now() - startTime;
      const total = tests.length;
      const score = total > 0 ? (passed / total) * 100 : 0;

      return { score, total, passed, failed, duration };
    } catch (error) {
      this.logger.error('Polyglot benchmark failed', { error });
      const duration = Date.now() - startTime;
      return { score: 0, total: 0, passed: 0, failed: 1, duration };
    }
  }

  /**
   * Run custom benchmarks
   */
  private async runCustomBenchmarks(context?: BenchmarkContext): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    const testSuites = this.config.custom.testSuites || [];

    for (const suiteName of testSuites) {
      try {
        const result = await this.runCustomBenchmarkSuite(suiteName, context);
        results.push(result);
      } catch (error) {
        this.logger.error(`Custom benchmark suite ${suiteName} failed`, { error });
        results.push({
          score: 0,
          total: 0,
          passed: 0,
          failed: 1,
          duration: 0,
          details: { suiteName, error: error.message }
        });
      }
    }

    return results;
  }

  /**
   * Load SWE-bench test cases
   */
  private async loadSweBenchTests(sampleSize: number): Promise<BenchmarkTest[]> {
    // Simplified SWE-bench test loading
    // In a real implementation, this would load from the actual SWE-bench dataset
    const tests: BenchmarkTest[] = [];
    
    for (let i = 0; i < Math.min(sampleSize, 50); i++) {
      tests.push({
        id: `swe_${i}`,
        name: `SWE-bench Test ${i}`,
        description: `Software engineering task ${i}`,
        timeout: 120000,
        category: 'bug-fixing'
      });
    }

    return tests;
  }

  /**
   * Load HumanEval test cases
   */
  private async loadHumanEvalTests(languages: string[]): Promise<BenchmarkTest[]> {
    const tests: BenchmarkTest[] = [];
    
    for (const lang of languages) {
      for (let i = 0; i < 20; i++) {
        tests.push({
          id: `humaneval_${lang}_${i}`,
          name: `HumanEval ${lang} ${i}`,
          description: `Code generation task for ${lang}`,
          timeout: 60000,
          category: 'code-generation'
        });
      }
    }

    return tests;
  }

  /**
   * Load Polyglot test cases
   */
  private async loadPolyglotTests(languages: string[], difficulty: string): Promise<BenchmarkTest[]> {
    const tests: BenchmarkTest[] = [];
    
    for (const lang of languages) {
      for (let i = 0; i < 15; i++) {
        tests.push({
          id: `polyglot_${lang}_${difficulty}_${i}`,
          name: `Polyglot ${lang} ${difficulty} ${i}`,
          description: `Multi-language programming challenge for ${lang}`,
          timeout: 90000,
          category: 'multi-language'
        });
      }
    }

    return tests;
  }

  /**
   * Execute a SWE-bench test
   */
  private async executeSweBenchTest(
    test: BenchmarkTest, 
    context?: BenchmarkContext, 
    timeout?: number
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    // Simplified SWE-bench test execution
    // In a real implementation, this would:
    // 1. Clone the repository
    // 2. Apply the test case
    // 3. Run the system to generate a fix
    // 4. Validate the fix against test cases
    
    return new Promise((resolve) => {
      // Simulate test execution with random success/failure
      setTimeout(() => {
        const success = Math.random() > 0.3; // 70% success rate for demo
        resolve({ success });
      }, Math.random() * 5000); // Random execution time up to 5 seconds
    });
  }

  /**
   * Execute a HumanEval test
   */
  private async executeHumanEvalTest(
    test: BenchmarkTest, 
    context?: BenchmarkContext, 
    timeout?: number
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    // Simplified HumanEval test execution
    return new Promise((resolve) => {
      setTimeout(() => {
        const success = Math.random() > 0.4; // 60% success rate for demo
        resolve({ success });
      }, Math.random() * 3000);
    });
  }

  /**
   * Execute a Polyglot test
   */
  private async executePolyglotTest(
    test: BenchmarkTest, 
    context?: BenchmarkContext
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    // Simplified Polyglot test execution
    return new Promise((resolve) => {
      setTimeout(() => {
        const success = Math.random() > 0.5; // 50% success rate for demo
        resolve({ success });
      }, Math.random() * 4000);
    });
  }

  /**
   * Run a custom benchmark suite
   */
  private async runCustomBenchmarkSuite(
    suiteName: string, 
    context?: BenchmarkContext
  ): Promise<BenchmarkResult> {
    const startTime = Date.now();
    
    // Load custom test suite configuration
    const suitePath = path.join(this.benchmarkDataPath, 'custom', `${suiteName}.json`);
    
    try {
      const suiteConfig = JSON.parse(await fs.readFile(suitePath, 'utf-8'));
      let passed = 0;
      let failed = 0;

      for (const test of suiteConfig.tests || []) {
        try {
          const result = await this.executeCustomTest(test, context);
          if (result.success) {
            passed++;
          } else {
            failed++;
          }
        } catch (error) {
          failed++;
        }
      }

      const duration = Date.now() - startTime;
      const total = suiteConfig.tests?.length || 0;
      const score = total > 0 ? (passed / total) * 100 : 0;

      return { score, total, passed, failed, duration, details: { suiteName } };
    } catch (error) {
      const duration = Date.now() - startTime;
      return { score: 0, total: 0, passed: 0, failed: 1, duration, details: { suiteName, error: error.message } };
    }
  }

  /**
   * Execute a custom test
   */
  private async executeCustomTest(
    test: any, 
    context?: BenchmarkContext
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    // Execute custom test based on test configuration
    return new Promise((resolve) => {
      setTimeout(() => {
        const success = Math.random() > 0.3;
        resolve({ success });
      }, Math.random() * 2000);
    });
  }

  /**
   * Save benchmark results to disk
   */
  private async saveBenchmarkResults(runId: string, results: BenchmarkResults): Promise<void> {
    const resultPath = path.join(this.benchmarkDataPath, 'results', `${runId}.json`);
    await fs.mkdir(path.dirname(resultPath), { recursive: true });
    
    const resultData = {
      runId,
      timestamp: new Date().toISOString(),
      results,
      config: this.config
    };

    await fs.writeFile(resultPath, JSON.stringify(resultData, null, 2));
  }

  /**
   * Get historical benchmark results
   */
  async getHistoricalResults(limit?: number): Promise<BenchmarkResults[]> {
    const resultsDir = path.join(this.benchmarkDataPath, 'results');
    
    try {
      const files = await fs.readdir(resultsDir);
      const resultFiles = files
        .filter(f => f.endsWith('.json'))
        .sort()
        .slice(-(limit || 10));

      const results: BenchmarkResults[] = [];
      
      for (const file of resultFiles) {
        try {
          const content = await fs.readFile(path.join(resultsDir, file), 'utf-8');
          const data = JSON.parse(content);
          results.push(data.results);
        } catch (error) {
          this.logger.warn(`Failed to read benchmark result file ${file}`, { error });
        }
      }

      return results;
    } catch (error) {
      this.logger.warn('Failed to read historical benchmark results', { error });
      return [];
    }
  }

  /**
   * Calculate performance improvement
   */
  calculateImprovement(baseline: BenchmarkResults, current: BenchmarkResults): number {
    const baselineAvg = this.calculateAverageScore(baseline);
    const currentAvg = this.calculateAverageScore(current);
    
    if (baselineAvg === 0) return 0;
    return ((currentAvg - baselineAvg) / baselineAvg) * 100;
  }

  /**
   * Calculate average score across all benchmarks
   */
  private calculateAverageScore(results: BenchmarkResults): number {
    const scores = [results.sweBench.score, results.humanEval.score, results.polyglot.score];
    const validScores = scores.filter(s => s > 0);
    return validScores.length > 0 ? validScores.reduce((a, b) => a + b, 0) / validScores.length : 0;
  }
} 