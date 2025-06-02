import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
// Temporarily disabled AST parsing to avoid module resolution issues
// import * as parser from '@typescript-eslint/parser';
// import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/types';
import { 
  Hypothesis, 
  Mutation, 
  VerificationStep 
} from '../types';
import * as winston from 'winston';

export interface CodeMutatorConfig {
  maxMutationsPerHypothesis: number;
  enableSafetyChecks: boolean;
  backupOriginalFiles: boolean;
  validationTimeout: number;
  allowedFileExtensions: string[];
  excludePaths: string[];
}

export interface MutationContext {
  hypothesis: Hypothesis;
  targetFiles: string[];
  safetyLevel: 'conservative' | 'normal' | 'aggressive';
  rollbackData: Map<string, any>;
}

export interface ValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  affectedFiles: string[];
}

export class CodeMutator {
  private logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ filename: './data/evolution-history/mutation.log' })
    ]
  });

  private config: CodeMutatorConfig;
  private backupPath: string;

  constructor(config: CodeMutatorConfig) {
    this.config = config;
    this.backupPath = './data/evolution-history/backups';
    this.ensureDirectories();
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.backupPath, { recursive: true });
  }

  /**
   * Generate mutations based on a hypothesis
   */
  async generateMutations(hypothesis: Hypothesis): Promise<Mutation[]> {
    try {
      this.logger.info('Generating mutations for hypothesis', { 
        hypothesisId: hypothesis.id,
        type: hypothesis.type 
      });

      const mutations: Mutation[] = [];
      const context: MutationContext = {
        hypothesis,
        targetFiles: await this.identifyTargetFiles(hypothesis),
        safetyLevel: this.determineSafetyLevel(hypothesis),
        rollbackData: new Map()
      };

      // Generate mutations based on hypothesis type
      switch (hypothesis.type) {
        case 'parameter-tuning':
          mutations.push(...await this.generateParameterMutations(context));
          break;
          
        case 'architecture-change':
          mutations.push(...await this.generateArchitectureMutations(context));
          break;
          
        case 'prompt-optimization':
          mutations.push(...await this.generatePromptMutations(context));
          break;
          
        case 'model-optimization':
          mutations.push(...await this.generateModelMutations(context));
          break;
          
        default:
          throw new Error(`Unknown hypothesis type: ${hypothesis.type}`);
      }

      // Limit mutations per hypothesis
      const limitedMutations = mutations.slice(0, this.config.maxMutationsPerHypothesis);

      this.logger.info('Generated mutations', { 
        hypothesisId: hypothesis.id,
        mutationCount: limitedMutations.length 
      });

      return limitedMutations;
    } catch (error) {
      this.logger.error('Failed to generate mutations', { error, hypothesis: hypothesis.id });
      throw error;
    }
  }

  /**
   * Apply mutations with safety checks
   */
  async applyMutations(mutations: Mutation[]): Promise<void> {
    for (const mutation of mutations) {
      try {
        // Backup original file if needed
        if (this.config.backupOriginalFiles && mutation.targetFile) {
          await this.backupFile(mutation.targetFile, mutation.id);
        }

        // Apply the mutation
        await this.applyMutation(mutation);

        // Validate the change
        if (this.config.enableSafetyChecks) {
          const validation = await this.validateMutation(mutation);
          if (!validation.success) {
            await this.revertMutation(mutation);
            throw new Error(`Mutation validation failed: ${validation.errors.join(', ')}`);
          }
        }

        this.logger.info('Applied mutation successfully', { 
          mutationId: mutation.id,
          type: mutation.type 
        });
      } catch (error) {
        this.logger.error('Failed to apply mutation', { 
          error, 
          mutationId: mutation.id 
        });
        
        // Attempt to revert the mutation
        try {
          await this.revertMutation(mutation);
        } catch (revertError) {
          this.logger.error('Failed to revert mutation', { 
            revertError, 
            mutationId: mutation.id 
          });
        }
        
        throw error;
      }
    }
  }

  /**
   * Apply a single mutation
   */
  private async applyMutation(mutation: Mutation): Promise<void> {
    switch (mutation.type) {
      case 'file-modification':
        await this.applyFileModification(mutation);
        break;
        
      case 'config-change':
        await this.applyConfigChange(mutation);
        break;
        
      case 'parameter-update':
        await this.applyParameterUpdate(mutation);
        break;
        
      case 'prompt-template-change':
        await this.applyPromptTemplateChange(mutation);
        break;
        
      default:
        throw new Error(`Unknown mutation type: ${mutation.type}`);
    }
  }

  /**
   * Revert a mutation
   */
  private async revertMutation(mutation: Mutation): Promise<void> {
    if (!mutation.rollbackData) {
      throw new Error(`No rollback data available for mutation ${mutation.id}`);
    }

    switch (mutation.type) {
      case 'file-modification':
        if (mutation.targetFile) {
          await fs.writeFile(mutation.targetFile, mutation.rollbackData);
        }
        break;
        
      case 'config-change':
      case 'parameter-update':
      case 'prompt-template-change':
        if (mutation.targetFile) {
          await fs.writeFile(mutation.targetFile, mutation.rollbackData);
        }
        break;
    }

    this.logger.info('Reverted mutation', { mutationId: mutation.id });
  }

  /**
   * Generate parameter tuning mutations
   */
  private async generateParameterMutations(context: MutationContext): Promise<Mutation[]> {
    const mutations: Mutation[] = [];
    const { hypothesis } = context;

    // Find configuration files
    const configFiles = await this.findConfigurationFiles(hypothesis.targetComponent);
    
    for (const configFile of configFiles) {
      try {
        const originalContent = await fs.readFile(configFile, 'utf-8');
        const updatedContent = await this.applyParameterChanges(
          originalContent, 
          hypothesis.proposedChanges,
          configFile
        );

        if (originalContent !== updatedContent) {
          mutations.push({
            id: uuidv4(),
            type: 'parameter-update',
            targetFile: configFile,
            originalValue: originalContent,
            newValue: updatedContent,
            description: `Update parameters in ${path.basename(configFile)}`,
            safetyChecks: ['syntax-validation', 'type-check'],
            rollbackData: originalContent
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to process config file ${configFile}`, { error });
      }
    }

    return mutations;
  }

  /**
   * Generate architecture change mutations
   */
  private async generateArchitectureMutations(context: MutationContext): Promise<Mutation[]> {
    const mutations: Mutation[] = [];
    const { hypothesis } = context;

    // Find TypeScript files in the target component
    const sourceFiles = await this.findSourceFiles(hypothesis.targetComponent);
    
    for (const sourceFile of sourceFiles.slice(0, 3)) { // Limit to 3 files for safety
      try {
        const originalContent = await fs.readFile(sourceFile, 'utf-8');
        const ast = this.parseTypeScript(originalContent);
        const modifiedAst = await this.applyArchitectureChanges(ast, hypothesis.proposedChanges);
        const modifiedContent = this.generateCodeFromAst(modifiedAst);

        if (originalContent !== modifiedContent) {
          mutations.push({
            id: uuidv4(),
            type: 'file-modification',
            targetFile: sourceFile,
            originalValue: originalContent,
            newValue: modifiedContent,
            description: `Architecture change in ${path.basename(sourceFile)}`,
            safetyChecks: ['syntax-validation', 'type-check', 'compile-check'],
            rollbackData: originalContent
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to process source file ${sourceFile}`, { error });
      }
    }

    return mutations;
  }

  /**
   * Generate prompt optimization mutations
   */
  private async generatePromptMutations(context: MutationContext): Promise<Mutation[]> {
    const mutations: Mutation[] = [];
    const { hypothesis } = context;

    // Find prompt template files
    const promptFiles = await this.findPromptTemplateFiles(hypothesis.targetComponent);
    
    for (const promptFile of promptFiles) {
      try {
        const originalContent = await fs.readFile(promptFile, 'utf-8');
        const optimizedContent = await this.optimizePromptTemplate(
          originalContent, 
          hypothesis.proposedChanges
        );

        if (originalContent !== optimizedContent) {
          mutations.push({
            id: uuidv4(),
            type: 'prompt-template-change',
            targetFile: promptFile,
            originalValue: originalContent,
            newValue: optimizedContent,
            description: `Optimize prompt template in ${path.basename(promptFile)}`,
            safetyChecks: ['format-validation'],
            rollbackData: originalContent
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to process prompt file ${promptFile}`, { error });
      }
    }

    return mutations;
  }

  /**
   * Generate model optimization mutations
   */
  private async generateModelMutations(context: MutationContext): Promise<Mutation[]> {
    const mutations: Mutation[] = [];
    const { hypothesis } = context;

    // Find model configuration files
    const modelFiles = await this.findModelConfigFiles(hypothesis.targetComponent);
    
    for (const modelFile of modelFiles) {
      try {
        const originalContent = await fs.readFile(modelFile, 'utf-8');
        const optimizedContent = await this.optimizeModelConfig(
          originalContent, 
          hypothesis.proposedChanges
        );

        mutations.push({
          id: uuidv4(),
          type: 'config-change',
          targetFile: modelFile,
          originalValue: originalContent,
          newValue: optimizedContent,
          description: `Optimize model configuration in ${path.basename(modelFile)}`,
          safetyChecks: ['syntax-validation', 'schema-validation'],
          rollbackData: originalContent
        });
      } catch (error) {
        this.logger.warn(`Failed to process model file ${modelFile}`, { error });
      }
    }

    return mutations;
  }

  // File operation methods

  private async applyFileModification(mutation: Mutation): Promise<void> {
    if (!mutation.targetFile) {
      throw new Error('Target file not specified for file modification');
    }
    
    await fs.writeFile(mutation.targetFile, mutation.newValue);
  }

  private async applyConfigChange(mutation: Mutation): Promise<void> {
    await this.applyFileModification(mutation);
  }

  private async applyParameterUpdate(mutation: Mutation): Promise<void> {
    await this.applyFileModification(mutation);
  }

  private async applyPromptTemplateChange(mutation: Mutation): Promise<void> {
    await this.applyFileModification(mutation);
  }

  // Validation methods

  private async validateMutation(mutation: Mutation): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const affectedFiles: string[] = mutation.targetFile ? [mutation.targetFile] : [];

    try {
      // Run safety checks
      for (const check of mutation.safetyChecks) {
        const checkResult = await this.runSafetyCheck(check, mutation);
        if (!checkResult.success) {
          errors.push(...checkResult.errors);
          warnings.push(...checkResult.warnings);
        }
      }

      return {
        success: errors.length === 0,
        errors,
        warnings,
        affectedFiles
      };
    } catch (error) {
      return {
        success: false,
        errors: [`Validation error: ${error instanceof Error ? error.message : String(error)}`],
        warnings,
        affectedFiles
      };
    }
  }

  private async runSafetyCheck(checkType: string, mutation: Mutation): Promise<ValidationResult> {
    switch (checkType) {
      case 'syntax-validation':
        return this.validateSyntax(mutation);
        
      case 'type-check':
        return this.validateTypes(mutation);
        
      case 'compile-check':
        return this.validateCompilation(mutation);
        
      case 'format-validation':
        return this.validateFormat(mutation);
        
      case 'schema-validation':
        return this.validateSchema(mutation);
        
      default:
        return { success: true, errors: [], warnings: [], affectedFiles: [] };
    }
  }

  private async validateSyntax(mutation: Mutation): Promise<ValidationResult> {
    if (!mutation.targetFile) {
      return { success: true, errors: [], warnings: [], affectedFiles: [] };
    }

    try {
      const ext = path.extname(mutation.targetFile);
      
      if (ext === '.ts' || ext === '.tsx') {
        this.parseTypeScript(mutation.newValue);
      } else if (ext === '.json') {
        JSON.parse(mutation.newValue);
      }
      // Add more syntax validations as needed

      return { success: true, errors: [], warnings: [], affectedFiles: [] };
    } catch (error) {
      return { 
        success: false, 
        errors: [`Syntax error: ${error instanceof Error ? error.message : String(error)}`], 
        warnings: [],
        affectedFiles: [mutation.targetFile] 
      };
    }
  }

  private async validateTypes(mutation: Mutation): Promise<ValidationResult> {
    // Mock type checking - would integrate with TypeScript compiler API
    return { success: true, errors: [], warnings: [], affectedFiles: [] };
  }

  private async validateCompilation(mutation: Mutation): Promise<ValidationResult> {
    // Mock compilation check - would run tsc or similar
    return { success: true, errors: [], warnings: [], affectedFiles: [] };
  }

  private async validateFormat(mutation: Mutation): Promise<ValidationResult> {
    // Mock format validation
    return { success: true, errors: [], warnings: [], affectedFiles: [] };
  }

  private async validateSchema(mutation: Mutation): Promise<ValidationResult> {
    // Mock schema validation
    return { success: true, errors: [], warnings: [], affectedFiles: [] };
  }

  // Helper methods

  private async identifyTargetFiles(hypothesis: Hypothesis): Promise<string[]> {
    const targetDir = path.join('.', 'src', hypothesis.targetComponent);
    
    try {
      return await this.findFilesRecursively(targetDir);
    } catch (error) {
      this.logger.warn(`Failed to identify target files for ${hypothesis.targetComponent}`, { error });
      return [];
    }
  }

  private async findFilesRecursively(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          files.push(...await this.findFilesRecursively(fullPath));
        } else if (this.isAllowedFile(fullPath)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read
    }
    
    return files;
  }

  private isAllowedFile(filePath: string): boolean {
    const ext = path.extname(filePath);
    return this.config.allowedFileExtensions.includes(ext) &&
           !this.config.excludePaths.some(excludePath => filePath.includes(excludePath));
  }

  private determineSafetyLevel(hypothesis: Hypothesis): 'conservative' | 'normal' | 'aggressive' {
    if (hypothesis.riskLevel === 'high') return 'conservative';
    if (hypothesis.riskLevel === 'low') return 'aggressive';
    return 'normal';
  }

  private async findConfigurationFiles(targetComponent: string): Promise<string[]> {
    const configExtensions = ['.json', '.yaml', '.yml', '.env'];
    const targetDir = path.join('.', 'src', targetComponent);
    const configDir = './config';
    
    const files: string[] = [];
    
    // Check target component directory
    for (const ext of configExtensions) {
      const configFile = path.join(targetDir, `config${ext}`);
      try {
        await fs.access(configFile);
        files.push(configFile);
      } catch {
        // File doesn't exist
      }
    }
    
    // Check global config directory
    try {
      const configFiles = await fs.readdir(configDir);
      files.push(...configFiles
        .filter(f => configExtensions.includes(path.extname(f)))
        .map(f => path.join(configDir, f))
      );
    } catch {
      // Config directory doesn't exist
    }
    
    return files;
  }

  private async findSourceFiles(targetComponent: string): Promise<string[]> {
    const targetDir = path.join('.', 'src', targetComponent);
    return this.findFilesRecursively(targetDir);
  }

  private async findPromptTemplateFiles(targetComponent: string): Promise<string[]> {
    const templateExtensions = ['.txt', '.md', '.template'];
    const targetDir = path.join('.', 'src', targetComponent);
    
    const allFiles = await this.findFilesRecursively(targetDir);
    return allFiles.filter(f => 
      templateExtensions.includes(path.extname(f)) ||
      f.includes('prompt') ||
      f.includes('template')
    );
  }

  private async findModelConfigFiles(targetComponent: string): Promise<string[]> {
    const configFiles = await this.findConfigurationFiles(targetComponent);
    return configFiles.filter(f => 
      f.includes('model') || 
      f.includes('config') ||
      path.basename(f).startsWith('models.')
    );
  }

  private parseTypeScript(code: string): any {
    // Simplified placeholder - would use proper AST parsing when module resolution is fixed
    console.log('[CodeMutator] AST parsing temporarily disabled');
    return { type: 'Program', body: [] };
  }

  private async applyArchitectureChanges(ast: any, changes: Record<string, any>): Promise<any> {
    // Mock AST transformation - would implement actual transformations
    return ast;
  }

  private generateCodeFromAst(ast: any): string {
    // Mock code generation - would use a proper code generator
    return '// Modified code would be generated here';
  }

  private async applyParameterChanges(content: string, changes: Record<string, any>, filePath: string): Promise<string> {
    let modifiedContent = content;
    
    for (const [key, value] of Object.entries(changes)) {
      // Simple string replacement - would be more sophisticated in practice
      const regex = new RegExp(`["']${key}["']\\s*:\\s*[^,}]+`, 'g');
      modifiedContent = modifiedContent.replace(regex, `"${key}": ${JSON.stringify(value)}`);
    }
    
    return modifiedContent;
  }

  private async optimizePromptTemplate(content: string, changes: Record<string, any>): Promise<string> {
    let optimizedContent = content;
    
    // Apply prompt optimizations based on changes
    if (changes.improvePrompts) {
      optimizedContent = optimizedContent.replace(
        /\{(\w+)\}/g, 
        '{{$1}}' // Convert to better template format
      );
    }
    
    return optimizedContent;
  }

  private async optimizeModelConfig(content: string, changes: Record<string, any>): Promise<string> {
    return this.applyParameterChanges(content, changes, '');
  }

  private async backupFile(filePath: string, mutationId: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const backupFilePath = path.join(this.backupPath, `${mutationId}-${path.basename(filePath)}`);
      await fs.writeFile(backupFilePath, content);
    } catch (error) {
      this.logger.warn(`Failed to backup file ${filePath}`, { error });
    }
  }
} 