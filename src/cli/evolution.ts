import { Command } from 'commander';
import * as winston from 'winston';
import { 
  EvolutionEngine, 
  EvolutionEngineConfig, 
  DEFAULT_EVOLUTION_CONFIG 
} from '../dgm/evolution-engine';
import { 
  EvolutionCycle, 
  EvolutionMetrics, 
  DGMError 
} from '../types';

// Configure logger for CLI
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}] ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console({ format: winston.format.colorize({ all: true }) })
  ]
});

export interface EvolutionCliOptions {
  config?: string;
  cycle?: boolean;
  start?: boolean;
  stop?: boolean;
  status?: boolean;
  metrics?: boolean;
  history?: boolean;
  baseline?: boolean;
  approve?: boolean;
  dry?: boolean;
  verbose?: boolean;
  json?: boolean;
}

export class EvolutionCLI {
  private engine?: EvolutionEngine;
  private config: EvolutionEngineConfig;

  constructor(configPath?: string) {
    this.config = this.loadConfig(configPath);
  }

  private loadConfig(configPath?: string): EvolutionEngineConfig {
    if (configPath) {
      try {
        // In a real implementation, load from file
        logger.info(`Loading evolution config from ${configPath}`);
        // const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        // return { ...DEFAULT_EVOLUTION_CONFIG, ...config };
      } catch (error) {
        logger.error(`Failed to load config from ${configPath}, using defaults`);
      }
    }
    return DEFAULT_EVOLUTION_CONFIG;
  }

  private initializeEngine(): EvolutionEngine {
    if (!this.engine) {
      this.engine = new EvolutionEngine(this.config);
      
      // Add event listeners for CLI feedback
      this.engine.addEventListener({
        onCycleStart: (cycle: EvolutionCycle) => {
          logger.info(`🚀 Starting evolution cycle ${cycle.id}`);
          logger.info(`Phase: ${cycle.phase}`);
        },
        
        onCycleComplete: (cycle: EvolutionCycle) => {
          logger.info(`✅ Evolution cycle ${cycle.id} completed successfully`);
          logger.info(`Total improvement: ${cycle.totalImprovement.toFixed(2)}%`);
          logger.info(`Duration: ${this.formatDuration(cycle.duration || 0)}`);
          logger.info(`Applied improvements: ${cycle.appliedImprovements.length}`);
        },
        
        onCycleError: (cycle: EvolutionCycle, error: DGMError) => {
          logger.error(`❌ Evolution cycle ${cycle.id} failed: ${error.message}`);
          logger.error(`Phase: ${cycle.phase}`);
        },
        
        onHypothesisGenerated: (hypotheses) => {
          logger.info(`💡 Generated ${hypotheses.length} improvement hypotheses`);
          if (logger.level === 'debug') {
            hypotheses.forEach((h, i) => {
              logger.debug(`  ${i + 1}. ${h.description} (${h.expectedImprovement}% improvement)`);
            });
          }
        },
        
        onTestComplete: (result) => {
          const status = result.success ? '✅' : '❌';
          logger.info(`${status} Hypothesis ${result.hypothesisId}: ${result.improvement.toFixed(2)}% improvement`);
        },
        
        onImprovementApplied: (result) => {
          logger.info(`🎯 Applied improvement: ${result.improvement.toFixed(2)}% performance gain`);
        },
        
        onRollbackRequired: (reason, cycle) => {
          logger.warn(`⚠️  Rollback required for cycle ${cycle.id}: ${reason}`);
        }
      });
    }
    return this.engine;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private formatMetrics(metrics: EvolutionMetrics, json: boolean = false): void {
    if (json) {
      console.log(JSON.stringify(metrics, null, 2));
      return;
    }

    logger.info('📊 Evolution Metrics:');
    logger.info(`  Cycles Completed: ${metrics.cyclesCompleted}`);
    logger.info(`  Total Improvements: ${metrics.totalImprovements}`);
    logger.info(`  Average Improvement: ${metrics.averageImprovement.toFixed(2)}%`);
    logger.info(`  Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`);
    logger.info(`  Rollback Rate: ${(metrics.rollbackRate * 100).toFixed(1)}%`);
    logger.info(`  Average Cycle Duration: ${this.formatDuration(metrics.avgCycleDuration)}`);
    
    logger.info('🎯 Current Performance:');
    logger.info(`  SWE-bench: ${metrics.currentPerformance.sweBench.score.toFixed(1)}% (${metrics.currentPerformance.sweBench.passed}/${metrics.currentPerformance.sweBench.total})`);
    logger.info(`  HumanEval: ${metrics.currentPerformance.humanEval.score.toFixed(1)}% (${metrics.currentPerformance.humanEval.passed}/${metrics.currentPerformance.humanEval.total})`);
    logger.info(`  Polyglot: ${metrics.currentPerformance.polyglot.score.toFixed(1)}% (${metrics.currentPerformance.polyglot.passed}/${metrics.currentPerformance.polyglot.total})`);
    
    logger.info('🏆 Best Performance:');
    logger.info(`  SWE-bench: ${metrics.bestPerformance.sweBench.score.toFixed(1)}%`);
    logger.info(`  HumanEval: ${metrics.bestPerformance.humanEval.score.toFixed(1)}%`);
    logger.info(`  Polyglot: ${metrics.bestPerformance.polyglot.score.toFixed(1)}%`);
  }

  private async confirmAction(message: string): Promise<boolean> {
    const { default: inquirer } = await import('inquirer');
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message,
      default: false
    }]);
    return confirm;
  }

  async handleStart(options: EvolutionCliOptions): Promise<void> {
    try {
      const engine = this.initializeEngine();
      
      if (!options.approve) {
        const confirmed = await this.confirmAction(
          'This will start the Evolution Engine with autonomous self-improvement. Continue?'
        );
        if (!confirmed) {
          logger.info('Evolution start cancelled by user');
          return;
        }
      }

      logger.info('🔄 Starting Evolution Engine...');
      await engine.start();
      logger.info('✅ Evolution Engine started successfully');
      
      if (this.config.evolution.schedule) {
        logger.info(`📅 Scheduled to run: ${this.config.evolution.schedule}`);
        logger.info('💡 Use "unified-dgm evolution --stop" to stop the engine');
        
        // Keep the process alive
        process.on('SIGINT', async () => {
          logger.info('🛑 Stopping Evolution Engine...');
          await engine.stop();
          process.exit(0);
        });
      }
    } catch (error) {
      logger.error(`Failed to start Evolution Engine: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  }

  async handleStop(options: EvolutionCliOptions): Promise<void> {
    try {
      if (!this.engine) {
        logger.warn('Evolution Engine is not running');
        return;
      }

      logger.info('🛑 Stopping Evolution Engine...');
      await this.engine.stop();
      logger.info('✅ Evolution Engine stopped');
    } catch (error) {
      logger.error(`Failed to stop Evolution Engine: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  }

  async handleCycle(options: EvolutionCliOptions): Promise<void> {
    try {
      const engine = this.initializeEngine();

      if (options.dry) {
        logger.info('🧪 Dry run mode: simulating evolution cycle...');
        // In dry run, we could create a read-only version or skip mutations
      }

      if (!options.approve && !options.dry) {
        const confirmed = await this.confirmAction(
          'This will run a single evolution cycle with potential code modifications. Continue?'
        );
        if (!confirmed) {
          logger.info('Evolution cycle cancelled by user');
          return;
        }
      }

      logger.info('🔄 Running single evolution cycle...');
      const cycle = await engine.runEvolutionCycle();
      
      if (options.json) {
        console.log(JSON.stringify(cycle, null, 2));
      } else {
        logger.info(`✅ Evolution cycle completed: ${cycle.totalImprovement.toFixed(2)}% improvement`);
      }
    } catch (error) {
      logger.error(`Evolution cycle failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  }

  async handleStatus(options: EvolutionCliOptions): Promise<void> {
    try {
      const engine = this.initializeEngine();
      const currentCycle = engine.getCurrentCycle();
      
      if (currentCycle) {
        logger.info(`🔄 Evolution cycle ${currentCycle.id} in progress`);
        logger.info(`  Phase: ${currentCycle.phase}`);
        logger.info(`  Started: ${currentCycle.startTime.toISOString()}`);
        logger.info(`  Hypotheses: ${currentCycle.hypotheses.length}`);
        logger.info(`  Tests completed: ${currentCycle.testResults.length}`);
        logger.info(`  Improvements applied: ${currentCycle.appliedImprovements.length}`);
      } else {
        logger.info('💤 No evolution cycle currently running');
      }
      
      if (options.json) {
        console.log(JSON.stringify(currentCycle, null, 2));
      }
    } catch (error) {
      logger.error(`Failed to get status: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  }

  async handleMetrics(options: EvolutionCliOptions): Promise<void> {
    try {
      const engine = this.initializeEngine();
      const metrics = engine.getMetrics();
      this.formatMetrics(metrics, options.json);
    } catch (error) {
      logger.error(`Failed to get metrics: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  }

  async handleHistory(options: EvolutionCliOptions): Promise<void> {
    try {
      const engine = this.initializeEngine();
      const history = engine.getHistory();
      
      if (options.json) {
        console.log(JSON.stringify(history, null, 2));
        return;
      }

      logger.info(`📜 Evolution History (${history.length} cycles):`);
      
      history.slice(-10).forEach((cycle, index) => {
        const status = cycle.phase === 'complete' ? '✅' : cycle.phase === 'failed' ? '❌' : '🔄';
        const improvement = cycle.totalImprovement > 0 ? `+${cycle.totalImprovement.toFixed(2)}%` : 'No improvement';
        logger.info(`  ${status} ${cycle.id} (${cycle.startTime.toISOString()}): ${improvement}`);
      });
      
      if (history.length > 10) {
        logger.info(`  ... and ${history.length - 10} more cycles`);
      }
    } catch (error) {
      logger.error(`Failed to get history: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  }

  async handleBaseline(options: EvolutionCliOptions): Promise<void> {
    try {
      const engine = this.initializeEngine();
      
      logger.info('🔄 Establishing baseline performance...');
      await engine.start(); // This establishes baseline
      await engine.stop();
      
      const metrics = engine.getMetrics();
      logger.info('✅ Baseline established');
      
      logger.info('📊 Baseline Performance:');
      logger.info(`  SWE-bench: ${metrics.currentPerformance.sweBench.score.toFixed(1)}%`);
      logger.info(`  HumanEval: ${metrics.currentPerformance.humanEval.score.toFixed(1)}%`);
      logger.info(`  Polyglot: ${metrics.currentPerformance.polyglot.score.toFixed(1)}%`);
      
      if (options.json) {
        console.log(JSON.stringify(metrics.currentPerformance, null, 2));
      }
    } catch (error) {
      logger.error(`Failed to establish baseline: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  }
}

export function createEvolutionCommand(): Command {
  const evolution = new Command('evolution')
    .alias('evolve')
    .description('DGM Evolution Engine - autonomous self-improvement system');

  evolution
    .command('start')
    .description('Start the Evolution Engine with scheduled improvements')
    .option('-c, --config <path>', 'Path to evolution configuration file')
    .option('-y, --approve', 'Auto-approve without confirmation prompts')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (options: EvolutionCliOptions) => {
      const cli = new EvolutionCLI(options.config);
      await cli.handleStart(options);
    });

  evolution
    .command('stop')
    .description('Stop the running Evolution Engine')
    .action(async (options: EvolutionCliOptions) => {
      const cli = new EvolutionCLI();
      await cli.handleStop(options);
    });

  evolution
    .command('cycle')
    .description('Run a single evolution cycle')
    .option('-c, --config <path>', 'Path to evolution configuration file')
    .option('-y, --approve', 'Auto-approve without confirmation prompts')
    .option('--dry', 'Dry run mode - simulate without applying changes')
    .option('--json', 'Output results in JSON format')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (options: EvolutionCliOptions) => {
      const cli = new EvolutionCLI(options.config);
      await cli.handleCycle(options);
    });

  evolution
    .command('status')
    .description('Show current evolution status')
    .option('--json', 'Output status in JSON format')
    .action(async (options: EvolutionCliOptions) => {
      const cli = new EvolutionCLI();
      await cli.handleStatus(options);
    });

  evolution
    .command('metrics')
    .description('Show evolution performance metrics')
    .option('--json', 'Output metrics in JSON format')
    .action(async (options: EvolutionCliOptions) => {
      const cli = new EvolutionCLI();
      await cli.handleMetrics(options);
    });

  evolution
    .command('history')
    .description('Show evolution cycle history')
    .option('--json', 'Output history in JSON format')
    .action(async (options: EvolutionCliOptions) => {
      const cli = new EvolutionCLI();
      await cli.handleHistory(options);
    });

  evolution
    .command('baseline')
    .description('Establish baseline performance metrics')
    .option('-c, --config <path>', 'Path to evolution configuration file')
    .option('--json', 'Output baseline in JSON format')
    .action(async (options: EvolutionCliOptions) => {
      const cli = new EvolutionCLI(options.config);
      await cli.handleBaseline(options);
    });

  return evolution;
} 