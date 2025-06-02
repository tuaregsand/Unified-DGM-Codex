import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import simpleGit, { SimpleGit, CheckRepoActions } from 'simple-git';
import { 
  GitBranch, 
  Checkpoint, 
  SystemState, 
  RollbackPlan, 
  VerificationStep,
  BenchmarkResults,
  Mutation
} from '../types';
import * as winston from 'winston';

export interface RollbackConfig {
  workingDir: string;
  backupPath: string;
  maxCheckpoints: number;
  autoCleanup: boolean;
  verificationTimeout: number;
}

export class RollbackManager {
  private git: SimpleGit;
  private logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ filename: './data/evolution-history/rollback.log' })
    ]
  });

  private config: RollbackConfig;
  private checkpoints: Map<string, Checkpoint> = new Map();
  private branches: Map<string, GitBranch> = new Map();

  constructor(config: RollbackConfig) {
    this.config = config;
    this.git = simpleGit(config.workingDir);
    this.initializeManager();
  }

  private async initializeManager(): Promise<void> {
    try {
      // Ensure working directory is a git repository
      const isRepo = await this.git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
      if (!isRepo) {
        await this.git.init();
        this.logger.info('Initialized git repository');
      }

      // Ensure backup directory exists
      await fs.mkdir(this.config.backupPath, { recursive: true });

      // Load existing checkpoints
      await this.loadCheckpoints();

      this.logger.info('RollbackManager initialized', { 
        workingDir: this.config.workingDir,
        checkpointsLoaded: this.checkpoints.size 
      });
    } catch (error) {
      this.logger.error('Failed to initialize RollbackManager', { error });
      throw error;
    }
  }

  /**
   * Create a new experiment branch
   */
  async createBranch(hypothesisId: string): Promise<GitBranch> {
    try {
      const branchName = `evolution-${hypothesisId}-${Date.now()}`;
      
      // Ensure we're on main branch
      await this.git.checkout('main');
      
      // Create and checkout new branch
      await this.git.checkoutLocalBranch(branchName);
      
      const commit = await this.git.revparse(['HEAD']);
      
      const branch: GitBranch = {
        name: branchName,
        commit,
        created: new Date(),
        type: 'experiment',
        metadata: { hypothesisId }
      };

      this.branches.set(branchName, branch);
      
      this.logger.info('Created experiment branch', { branch });
      return branch;
    } catch (error) {
      this.logger.error('Failed to create experiment branch', { error, hypothesisId });
      throw error;
    }
  }

  /**
   * Create a checkpoint of the current system state
   */
  async createCheckpoint(description: string, benchmarkResults?: BenchmarkResults): Promise<Checkpoint> {
    try {
      const checkpointId = uuidv4();
      const currentBranch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
      const currentCommit = await this.git.revparse(['HEAD']);
      
      // Capture system state
      const systemState = await this.captureSystemState();
      
      const checkpoint: Checkpoint = {
        id: checkpointId,
        timestamp: new Date(),
        branch: currentBranch.trim(),
        commit: currentCommit,
        systemState,
        benchmarkResults,
        description
      };

      // Save checkpoint to disk
      await this.saveCheckpoint(checkpoint);
      
      // Store in memory
      this.checkpoints.set(checkpointId, checkpoint);
      
      // Cleanup old checkpoints if needed
      await this.cleanupOldCheckpoints();
      
      this.logger.info('Created checkpoint', { checkpointId, description });
      return checkpoint;
    } catch (error) {
      this.logger.error('Failed to create checkpoint', { error, description });
      throw error;
    }
  }

  /**
   * Apply mutations to the current branch
   */
  async applyMutations(mutations: Mutation[], branch?: string): Promise<void> {
    try {
      if (branch) {
        await this.git.checkout(branch);
      }

      for (const mutation of mutations) {
        await this.applyMutation(mutation);
      }

      // Commit all changes
      await this.git.add('.');
      await this.git.commit(`Apply mutations: ${mutations.map(m => m.description).join(', ')}`);
      
      this.logger.info('Applied mutations', { 
        count: mutations.length, 
        branch: branch || 'current' 
      });
    } catch (error) {
      this.logger.error('Failed to apply mutations', { error, mutations: mutations.length });
      throw error;
    }
  }

  /**
   * Apply a single mutation
   */
  private async applyMutation(mutation: Mutation): Promise<void> {
    try {
      switch (mutation.type) {
        case 'file-modification':
          if (mutation.targetFile) {
            await this.modifyFile(mutation.targetFile, mutation.newValue);
          }
          break;
          
        case 'config-change':
          await this.modifyConfig(mutation.targetFile!, mutation.originalValue, mutation.newValue);
          break;
          
        case 'parameter-update':
          await this.updateParameter(mutation.targetFile!, mutation.originalValue, mutation.newValue);
          break;
          
        case 'prompt-template-change':
          await this.updatePromptTemplate(mutation.targetFile!, mutation.newValue);
          break;
          
        default:
          throw new Error(`Unknown mutation type: ${mutation.type}`);
      }
      
      this.logger.debug('Applied mutation', { id: mutation.id, type: mutation.type });
    } catch (error) {
      this.logger.error('Failed to apply mutation', { error, mutation: mutation.id });
      throw error;
    }
  }

  /**
   * Rollback to a specific checkpoint
   */
  async rollbackToCheckpoint(checkpointId: string): Promise<void> {
    try {
      const checkpoint = this.checkpoints.get(checkpointId);
      if (!checkpoint) {
        throw new Error(`Checkpoint ${checkpointId} not found`);
      }

      // Switch to the checkpoint's branch and commit
      await this.git.checkout(checkpoint.branch);
      await this.git.reset(['--hard', checkpoint.commit]);
      
      // Restore system state
      await this.restoreSystemState(checkpoint.systemState);
      
      this.logger.info('Rolled back to checkpoint', { checkpointId, checkpoint });
    } catch (error) {
      this.logger.error('Failed to rollback to checkpoint', { error, checkpointId });
      throw error;
    }
  }

  /**
   * Rollback mutations
   */
  async rollbackMutations(mutations: Mutation[]): Promise<void> {
    try {
      // Apply mutations in reverse order
      for (let i = mutations.length - 1; i >= 0; i--) {
        const mutation = mutations[i];
        await this.revertMutation(mutation);
      }

      // Commit rollback
      await this.git.add('.');
      await this.git.commit(`Rollback mutations: ${mutations.map(m => m.description).join(', ')}`);
      
      this.logger.info('Rolled back mutations', { count: mutations.length });
    } catch (error) {
      this.logger.error('Failed to rollback mutations', { error, mutations: mutations.length });
      throw error;
    }
  }

  /**
   * Revert a single mutation
   */
  private async revertMutation(mutation: Mutation): Promise<void> {
    try {
      switch (mutation.type) {
        case 'file-modification':
          if (mutation.targetFile && mutation.rollbackData) {
            await this.modifyFile(mutation.targetFile, mutation.rollbackData);
          }
          break;
          
        case 'config-change':
          await this.modifyConfig(mutation.targetFile!, mutation.newValue, mutation.originalValue);
          break;
          
        case 'parameter-update':
          await this.updateParameter(mutation.targetFile!, mutation.newValue, mutation.originalValue);
          break;
          
        case 'prompt-template-change':
          await this.updatePromptTemplate(mutation.targetFile!, mutation.rollbackData);
          break;
      }
      
      this.logger.debug('Reverted mutation', { id: mutation.id, type: mutation.type });
    } catch (error) {
      this.logger.error('Failed to revert mutation', { error, mutation: mutation.id });
      throw error;
    }
  }

  /**
   * Delete an experiment branch
   */
  async deleteBranch(branch: GitBranch): Promise<void> {
    try {
      // Switch to main before deleting
      await this.git.checkout('main');
      
      // Delete the branch
      await this.git.deleteLocalBranch(branch.name, true);
      
      // Remove from tracking
      this.branches.delete(branch.name);
      
      this.logger.info('Deleted experiment branch', { branch: branch.name });
    } catch (error) {
      this.logger.error('Failed to delete branch', { error, branch: branch.name });
      throw error;
    }
  }

  /**
   * Merge successful experiment back to main
   */
  async mergeToMain(branch: GitBranch): Promise<void> {
    try {
      // Switch to main
      await this.git.checkout('main');
      
      // Merge the experiment branch
      await this.git.merge([branch.name]);
      
      // Delete the experiment branch
      await this.deleteBranch(branch);
      
      this.logger.info('Merged experiment to main', { branch: branch.name });
    } catch (error) {
      this.logger.error('Failed to merge to main', { error, branch: branch.name });
      throw error;
    }
  }

  /**
   * Create a rollback plan
   */
  async createRollbackPlan(mutations: Mutation[]): Promise<RollbackPlan> {
    const checkpointId = await this.getLatestCheckpointId();
    
    const verificationSteps: VerificationStep[] = [
      {
        type: 'compile',
        description: 'Verify code compiles',
        command: 'npm run build',
        timeout: 120000
      },
      {
        type: 'test',
        description: 'Run unit tests',
        command: 'npm test',
        timeout: 300000
      }
    ];

    return {
      checkpointId,
      mutations,
      verification: verificationSteps,
      estimatedDuration: mutations.length * 30 + 180, // 30s per mutation + 3min verification
      riskAssessment: this.assessRollbackRisk(mutations)
    };
  }

  /**
   * Execute verification steps
   */
  async executeVerification(steps: VerificationStep[]): Promise<boolean> {
    for (const step of steps) {
      try {
        const success = await this.executeVerificationStep(step);
        if (!success) {
          this.logger.warn('Verification step failed', { step });
          return false;
        }
      } catch (error) {
        this.logger.error('Verification step error', { error, step });
        return false;
      }
    }
    return true;
  }

  /**
   * Get all checkpoints
   */
  getCheckpoints(): Checkpoint[] {
    return Array.from(this.checkpoints.values()).sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * Get all experiment branches
   */
  getBranches(): GitBranch[] {
    return Array.from(this.branches.values());
  }

  // Private helper methods

  private async loadCheckpoints(): Promise<void> {
    try {
      const checkpointsDir = path.join(this.config.backupPath, 'checkpoints');
      await fs.mkdir(checkpointsDir, { recursive: true });
      
      const files = await fs.readdir(checkpointsDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(checkpointsDir, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const checkpoint: Checkpoint = JSON.parse(content);
            this.checkpoints.set(checkpoint.id, checkpoint);
          } catch (error) {
            this.logger.warn(`Failed to load checkpoint file ${file}`, { error });
          }
        }
      }
    } catch (error) {
      this.logger.warn('Failed to load checkpoints', { error });
    }
  }

  private async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    const checkpointsDir = path.join(this.config.backupPath, 'checkpoints');
    const filePath = path.join(checkpointsDir, `${checkpoint.id}.json`);
    
    await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2));
  }

  private async captureSystemState(): Promise<SystemState> {
    const currentCommit = await this.git.revparse(['HEAD']);
    
    return {
      codeVersion: currentCommit,
      configuration: await this.loadCurrentConfiguration(),
      modelStates: {}, // Would be populated with actual model states
      performanceMetrics: {
        accuracy: 0,
        speed: 0,
        contextUtilization: 0,
        tokenEfficiency: 0,
        userSatisfaction: 0
      }
    };
  }

  private async restoreSystemState(systemState: SystemState): Promise<void> {
    // Restore configuration files
    await this.restoreConfiguration(systemState.configuration);
    // Additional restoration logic would go here
  }

  private async loadCurrentConfiguration(): Promise<Record<string, any>> {
    try {
      const configPaths = ['config/default.yaml', 'config/models.yaml', '.env'];
      const config: Record<string, any> = {};
      
      for (const configPath of configPaths) {
        try {
          const content = await fs.readFile(configPath, 'utf-8');
          config[configPath] = content;
        } catch (error) {
          // File doesn't exist, skip
        }
      }
      
      return config;
    } catch (error) {
      this.logger.warn('Failed to load configuration', { error });
      return {};
    }
  }

  private async restoreConfiguration(config: Record<string, any>): Promise<void> {
    for (const [filePath, content] of Object.entries(config)) {
      try {
        await fs.writeFile(filePath, content as string);
      } catch (error) {
        this.logger.warn(`Failed to restore config file ${filePath}`, { error });
      }
    }
  }

  private async modifyFile(filePath: string, newContent: string): Promise<void> {
    await fs.writeFile(filePath, newContent);
  }

  private async modifyConfig(filePath: string, oldValue: any, newValue: any): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const modified = content.replace(JSON.stringify(oldValue), JSON.stringify(newValue));
      await fs.writeFile(filePath, modified);
    } catch (error) {
      this.logger.error(`Failed to modify config in ${filePath}`, { error });
      throw error;
    }
  }

  private async updateParameter(filePath: string, oldValue: any, newValue: any): Promise<void> {
    // Similar to modifyConfig but with more sophisticated parameter replacement
    await this.modifyConfig(filePath, oldValue, newValue);
  }

  private async updatePromptTemplate(filePath: string, newTemplate: string): Promise<void> {
    await fs.writeFile(filePath, newTemplate);
  }

  private async cleanupOldCheckpoints(): Promise<void> {
    if (!this.config.autoCleanup) return;
    
    const checkpoints = this.getCheckpoints();
    if (checkpoints.length > this.config.maxCheckpoints) {
      const toDelete = checkpoints.slice(this.config.maxCheckpoints);
      
      for (const checkpoint of toDelete) {
        try {
          const filePath = path.join(this.config.backupPath, 'checkpoints', `${checkpoint.id}.json`);
          await fs.unlink(filePath);
          this.checkpoints.delete(checkpoint.id);
        } catch (error) {
          this.logger.warn(`Failed to delete old checkpoint ${checkpoint.id}`, { error });
        }
      }
    }
  }

  private async getLatestCheckpointId(): Promise<string> {
    const checkpoints = this.getCheckpoints();
    return checkpoints.length > 0 ? checkpoints[0].id : '';
  }

  private assessRollbackRisk(mutations: Mutation[]): string {
    const highRiskTypes = ['architecture-change', 'file-modification'];
    const hasHighRisk = mutations.some(m => highRiskTypes.includes(m.type));
    
    if (hasHighRisk) return 'high';
    if (mutations.length > 10) return 'medium';
    return 'low';
  }

  private async executeVerificationStep(step: VerificationStep): Promise<boolean> {
    return new Promise((resolve) => {
      if (!step.command) {
        resolve(true);
        return;
      }

      const timeout = step.timeout || this.config.verificationTimeout;
      const process = spawn('bash', ['-c', step.command], {
        cwd: this.config.workingDir,
        stdio: 'pipe'
      });

      const timer = setTimeout(() => {
        process.kill();
        resolve(false);
      }, timeout);

      process.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });

      process.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }
} 