import OpenAI from 'openai';
import { GPT41Config, CodeSpec, ProjectContext, GeneratedCode } from '../../types';

// Real OpenAI API client
class GPTApiClient {
  private client: OpenAI;
  private modelName: string;

  constructor(apiKey?: string, modelName?: string) {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OpenAI API key is missing.');
    
    this.client = new OpenAI({
      apiKey: key,
    });
    this.modelName = modelName || 'gpt-4-1106-preview'; // GPT-4 Turbo
  }

  async generateCode(params: {
    prompt: string;
    maxTokens?: number;
    temperature?: number;
    system?: string;
  }): Promise<string> {
    try {
      console.log(`[GPTApiClient] Making REAL API call to ${this.modelName}...`);
      
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages: [
          {
            role: 'system',
            content: params.system || 'You are GPT-4.1, a code generation specialist. Generate clean, production-ready code based on specifications.'
          },
          {
            role: 'user',
            content: params.prompt
          }
        ],
        max_tokens: params.maxTokens || 2048,
        temperature: params.temperature || 0.2
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content received from OpenAI API');
      }

      console.log(`[GPTApiClient] Generated ${content.length} characters of code`);
      return content;
    } catch (error) {
      console.error('[GPTApiClient] Error calling OpenAI API:', error);
      throw new Error(`OpenAI API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async modifyCode(params: {
    existingCode: string;
    modification: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string> {
    try {
      console.log(`[GPTApiClient] Making REAL modification call to ${this.modelName}...`);
      
      const prompt = `Here is existing code:
\`\`\`
${params.existingCode}
\`\`\`

Please modify it according to this specification:
${params.modification}

Provide only the modified code:`;

      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages: [
          {
            role: 'system',
            content: 'You are GPT-4.1, a code modification specialist. Modify existing code based on specifications while maintaining code quality and consistency.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: params.maxTokens || 2048,
        temperature: params.temperature || 0.2
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content received from OpenAI API');
      }

      console.log(`[GPTApiClient] Modified code: ${content.length} characters`);
      return content;
    } catch (error) {
      console.error('[GPTApiClient] Error in modification call:', error);
      throw new Error(`OpenAI API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export class GPT41Optimized {
  private apiClient: GPTApiClient;

  constructor(config: GPT41Config) {
    this.apiClient = new GPTApiClient(
      config.apiKey || process.env.OPENAI_API_KEY,
      config.modelName || 'gpt-4-1106-preview'
    );
  }

  async generateCode(spec: CodeSpec, context: ProjectContext): Promise<GeneratedCode> {
    console.log(`[GPT41Optimized] Starting REAL code generation for: ${spec.description.substring(0, 50)}...`);
    
    try {
      // Build a comprehensive prompt
      const systemPrompt = `You are GPT-4.1, a code generation specialist in a unified AI development system.

Generate clean, production-ready ${spec.language || 'TypeScript'} code based on the specification.

Requirements:
- Follow best practices and conventions
- Include proper error handling
- Add meaningful comments
- Ensure type safety (if applicable)
- Make code modular and testable

Respond with ONLY the code, no explanations.`;

      let userPrompt = `Generate code for: ${spec.description}`;
      
      if (spec.existingCode) {
        userPrompt += `\n\nExisting code context:\n\`\`\`\n${spec.existingCode}\n\`\`\``;
      }
      
      if (context.currentFileContent) {
        userPrompt += `\n\nCurrent file context:\n\`\`\`\n${context.currentFileContent.substring(0, 2000)}\n\`\`\``;
      }

      const generatedCode = await this.apiClient.generateCode({
        prompt: userPrompt,
        system: systemPrompt,
        maxTokens: spec.maxTokensPerChunk || 2048,
        temperature: spec.temperature || 0.2
      });

      // Extract code from response (remove markdown if present)
      const codeMatch = generatedCode.match(/```(?:typescript|javascript|ts|js)?\n?([\s\S]*?)```/);
      const cleanCode = codeMatch ? codeMatch[1] : generatedCode;

      // Generate basic tests (simplified for now)
      const tests = await this.generateBasicTests(cleanCode, spec);

      console.log(`[GPT41Optimized] Successfully generated ${cleanCode.length} characters of code`);
      
      return {
        code: cleanCode.trim(),
        tests: tests,
        metadata: {
          language: spec.language || 'typescript',
          generatedAt: new Date().toISOString(),
          model: this.apiClient['modelName'],
          spec: spec.description
        }
      };
    } catch (error) {
      console.error('[GPT41Optimized] Error in code generation:', error);
      throw new Error(`Code generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async modifyCode(spec: CodeSpec, context: ProjectContext): Promise<GeneratedCode> {
    console.log(`[GPT41Optimized] Starting REAL code modification for: ${spec.description.substring(0, 50)}...`);
    
    if (!spec.existingCode) {
      throw new Error('Existing code is required for modification');
    }

    try {
      const modifiedCode = await this.apiClient.modifyCode({
        existingCode: spec.existingCode,
        modification: spec.description,
        maxTokens: spec.maxTokensPerChunk || 2048,
        temperature: spec.temperature || 0.2
      });

      // Extract code from response
      const codeMatch = modifiedCode.match(/```(?:typescript|javascript|ts|js)?\n?([\s\S]*?)```/);
      const cleanCode = codeMatch ? codeMatch[1] : modifiedCode;

      console.log(`[GPT41Optimized] Successfully modified code: ${cleanCode.length} characters`);
      
      return {
        code: cleanCode.trim(),
        tests: '',
        metadata: {
          language: spec.language || 'typescript',
          generatedAt: new Date().toISOString(),
          model: this.apiClient['modelName'],
          spec: spec.description,
          modification: true
        }
      };
    } catch (error) {
      console.error('[GPT41Optimized] Error in code modification:', error);
      throw new Error(`Code modification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async generateBasicTests(code: string, spec: CodeSpec): Promise<string> {
    try {
      const testPrompt = `Generate Jest unit tests for this ${spec.language || 'TypeScript'} code:

\`\`\`
${code}
\`\`\`

Generate comprehensive tests that cover:
- Main functionality
- Edge cases
- Error conditions

Respond with ONLY the test code:`;

      const tests = await this.apiClient.generateCode({
        prompt: testPrompt,
        system: 'Generate Jest unit tests for the provided code. Include imports, describe blocks, and test cases.',
        maxTokens: 1024,
        temperature: 0.1
      });

      // Extract test code
      const testMatch = tests.match(/```(?:typescript|javascript|ts|js)?\n?([\s\S]*?)```/);
      return testMatch ? testMatch[1].trim() : tests.trim();
    } catch (error) {
      console.warn('[GPT41Optimized] Could not generate tests:', error);
      return '// Test generation failed';
    }
  }

  // Added for orchestrator compatibility
  async reason(spec: any, context: any): Promise<any> {
    // This method would use GPT for reasoning about code or specifications
    const prompt = `Analyze and reason about: ${JSON.stringify(spec)}`;
    
    try {
      const reasoning = await this.apiClient.generateCode({
        prompt,
        system: 'You are a code reasoning specialist. Analyze the given specification and provide insights.',
        maxTokens: 1000,
        temperature: 0.3
      });
      
      return { analysis: reasoning, confidence: 0.8 };
    } catch (error) {
      console.error('[GPT41Optimized] Error in reasoning:', error);
      return { analysis: 'Reasoning failed', confidence: 0.0 };
    }
  }
} 