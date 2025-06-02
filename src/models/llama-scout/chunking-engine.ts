// Intelligent Chunking Engine for Llama 4 Scout
interface ChunkingConfig {
  chunkSize: number;
  overlap: number;
  strategy?: 'fixed-size' | 'semantic-aware' | 'function-aware' | 'paragraph-aware';
}

interface Chunk {
  content: string;
  metadata?: {
    start?: number;
    end?: number;
    source?: string;
    type?: 'code' | 'text' | 'documentation';
    language?: string;
    chunkIndex?: number;
  };
}

interface SlidingWindowResult {
  content: string;
  sources?: string[];
  totalChunks?: number;
  selectedChunks?: number;
}

export class ChunkingEngine {
  private chunkSize: number;
  private overlap: number;
  private strategy: string;

  constructor(config: ChunkingConfig) {
    this.chunkSize = config.chunkSize;
    this.overlap = config.overlap;
    this.strategy = config.strategy || 'semantic-aware';

    if (this.overlap >= this.chunkSize) {
      throw new Error("Overlap size must be less than chunk size.");
    }

    console.log(`[ChunkingEngine] Initialized with strategy: ${this.strategy}, chunk size: ${this.chunkSize}, overlap: ${this.overlap}`);
  }

  public async chunkFile(fileContent: string, filePath?: string): Promise<Chunk[]> {
    if (!fileContent) return [];

    const fileType = this.detectFileType(filePath);
    const language = this.detectLanguage(filePath);

    console.log(`[ChunkingEngine] Chunking file: ${filePath || 'unknown'} (type: ${fileType}, language: ${language})`);

    switch (this.strategy) {
      case 'semantic-aware':
        return this.semanticAwareChunking(fileContent, filePath, fileType, language);
      case 'function-aware':
        return this.functionAwareChunking(fileContent, filePath, language);
      case 'paragraph-aware':
        return this.paragraphAwareChunking(fileContent, filePath, fileType);
      case 'fixed-size':
      default:
        return this.fixedSizeChunking(fileContent, filePath, fileType);
    }
  }

  private detectFileType(filePath?: string): 'code' | 'text' | 'documentation' {
    if (!filePath) return 'text';

    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    
    if (['.md', '.txt', '.rst', '.adoc'].includes(`.${ext}`)) {
      return 'documentation';
    }
    
    if (['.ts', '.js', '.py', '.java', '.cpp', '.c', '.h', '.rs', '.go', '.rb'].includes(`.${ext}`)) {
      return 'code';
    }
    
    return 'text';
  }

  private detectLanguage(filePath?: string): string {
    if (!filePath) return 'text';

    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const languageMap: Record<string, string> = {
      'ts': 'typescript',
      'js': 'javascript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'h': 'c',
      'rs': 'rust',
      'go': 'go',
      'rb': 'ruby',
      'php': 'php',
      'cs': 'csharp',
      'md': 'markdown',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml'
    };

    return languageMap[ext] || 'text';
  }

  private semanticAwareChunking(
    text: string, 
    sourcePath?: string, 
    fileType?: string, 
    language?: string
  ): Chunk[] {
    console.log('[ChunkingEngine] Using semantic-aware chunking strategy');

    if (fileType === 'code') {
      return this.functionAwareChunking(text, sourcePath, language);
    } else if (fileType === 'documentation') {
      return this.paragraphAwareChunking(text, sourcePath, fileType);
    } else {
      return this.intelligentTextChunking(text, sourcePath);
    }
  }

  private functionAwareChunking(text: string, sourcePath?: string, language?: string): Chunk[] {
    console.log('[ChunkingEngine] Using function-aware chunking for code');
    
    const chunks: Chunk[] = [];
    const lines = text.split('\n');
    let currentChunk = '';
    let currentStart = 0;
    let currentLine = 0;

    // Simple function detection patterns for different languages
    const functionPatterns = this.getFunctionPatterns(language);
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      currentChunk += line + '\n';
      
      // Check if we've hit a function boundary or size limit
      const isFunctionStart = functionPatterns.some(pattern => pattern.test(line.trim()));
      const chunkTooLarge = this.estimateTokens(currentChunk) >= this.chunkSize;
      
      if ((isFunctionStart && currentChunk.trim().length > 0 && i > currentLine) || chunkTooLarge) {
        // Save current chunk
        if (currentChunk.trim().length > 0) {
          chunks.push({
            content: currentChunk.trim(),
            metadata: {
              start: currentStart,
              end: this.getCharPosition(text, i - 1),
              source: sourcePath,
              type: 'code',
              language,
              chunkIndex: chunks.length
            }
          });
        }

        // Start new chunk
        if (isFunctionStart) {
          currentChunk = line + '\n';
          currentStart = this.getCharPosition(text, i);
        } else {
          // If too large, continue with overlap
          const overlapLines = Math.floor(this.overlap / 50); // Rough estimate
          const startOverlapIndex = Math.max(currentLine, i - overlapLines);
          currentChunk = lines.slice(startOverlapIndex, i + 1).join('\n') + '\n';
          currentStart = this.getCharPosition(text, startOverlapIndex);
        }
        
        currentLine = i;
      }
    }

    // Add final chunk
    if (currentChunk.trim().length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        metadata: {
          start: currentStart,
          end: text.length,
          source: sourcePath,
          type: 'code',
          language,
          chunkIndex: chunks.length
        }
      });
    }

    console.log(`[ChunkingEngine] Function-aware chunking produced ${chunks.length} chunks`);
    return chunks;
  }

  private getFunctionPatterns(language?: string): RegExp[] {
    const patterns: Record<string, RegExp[]> = {
      typescript: [
        /^(export\s+)?(async\s+)?function\s+\w+/,
        /^(export\s+)?(async\s+)?\w+\s*[=:]\s*(async\s+)?\([^)]*\)\s*=>/,
        /^(export\s+)?class\s+\w+/,
        /^(export\s+)?interface\s+\w+/,
        /^(export\s+)?type\s+\w+/
      ],
      javascript: [
        /^(export\s+)?(async\s+)?function\s+\w+/,
        /^(export\s+)?(async\s+)?\w+\s*[=:]\s*(async\s+)?\([^)]*\)\s*=>/,
        /^(export\s+)?class\s+\w+/
      ],
      python: [
        /^(async\s+)?def\s+\w+/,
        /^class\s+\w+/,
        /^@\w+/  // Decorators
      ],
      java: [
        /^(public|private|protected|static|\s)*\w+\s+\w+\s*\([^)]*\)\s*\{/,
        /^(public|private|protected|\s)*class\s+\w+/,
        /^(public|private|protected|\s)*interface\s+\w+/
      ]
    };

    return patterns[language || 'typescript'] || patterns.typescript;
  }

  private paragraphAwareChunking(text: string, sourcePath?: string, fileType?: string): Chunk[] {
    console.log('[ChunkingEngine] Using paragraph-aware chunking for documentation');
    
    const chunks: Chunk[] = [];
    const paragraphs = text.split(/\n\s*\n/); // Split on double newlines
    let currentChunk = '';
    let currentStart = 0;
    let charPosition = 0;

    for (const paragraph of paragraphs) {
      const testChunk = currentChunk + (currentChunk ? '\n\n' : '') + paragraph;
      
      if (this.estimateTokens(testChunk) >= this.chunkSize && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          content: currentChunk.trim(),
          metadata: {
            start: currentStart,
            end: charPosition - 1,
            source: sourcePath,
            type: fileType as any,
            chunkIndex: chunks.length
          }
        });

        // Start new chunk with overlap
        const overlapText = this.getOverlapText(currentChunk, this.overlap);
        currentChunk = overlapText + (overlapText ? '\n\n' : '') + paragraph;
        currentStart = charPosition - overlapText.length;
      } else {
        currentChunk = testChunk;
        if (chunks.length === 0) {
          currentStart = charPosition;
        }
      }

      charPosition += paragraph.length + 2; // +2 for \n\n
    }

    // Add final chunk
    if (currentChunk.trim().length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        metadata: {
          start: currentStart,
          end: text.length,
          source: sourcePath,
          type: fileType as any,
          chunkIndex: chunks.length
        }
      });
    }

    console.log(`[ChunkingEngine] Paragraph-aware chunking produced ${chunks.length} chunks`);
    return chunks;
  }

  private intelligentTextChunking(text: string, sourcePath?: string): Chunk[] {
    console.log('[ChunkingEngine] Using intelligent text chunking');
    
    // Try to split on sentence boundaries first
    const sentences = text.split(/[.!?]+\s+/);
    const chunks: Chunk[] = [];
    let currentChunk = '';
    let currentStart = 0;
    let charPosition = 0;

    for (const sentence of sentences) {
      const testChunk = currentChunk + (currentChunk ? ' ' : '') + sentence;
      
      if (this.estimateTokens(testChunk) >= this.chunkSize && currentChunk.length > 0) {
        chunks.push({
          content: currentChunk.trim(),
          metadata: {
            start: currentStart,
            end: charPosition - 1,
            source: sourcePath,
            type: 'text',
            chunkIndex: chunks.length
          }
        });

        const overlapText = this.getOverlapText(currentChunk, this.overlap);
        currentChunk = overlapText + (overlapText ? ' ' : '') + sentence;
        currentStart = charPosition - overlapText.length;
      } else {
        currentChunk = testChunk;
        if (chunks.length === 0) {
          currentStart = charPosition;
        }
      }

      charPosition += sentence.length + 1;
    }

    if (currentChunk.trim().length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        metadata: {
          start: currentStart,
          end: text.length,
          source: sourcePath,
          type: 'text',
          chunkIndex: chunks.length
        }
      });
    }

    console.log(`[ChunkingEngine] Intelligent text chunking produced ${chunks.length} chunks`);
    return chunks;
  }

  private fixedSizeChunking(text: string, sourcePath?: string, fileType?: string): Chunk[] {
    console.log('[ChunkingEngine] Using fixed-size chunking');
    
    const chunks: Chunk[] = [];
    const totalLength = text.length;
    let startIndex = 0;

    while (startIndex < totalLength) {
      const endIndex = Math.min(startIndex + this.chunkSize, totalLength);
      const content = text.substring(startIndex, endIndex);
      
      chunks.push({
        content,
        metadata: {
          start: startIndex,
          end: endIndex,
          source: sourcePath,
          type: fileType as any,
          chunkIndex: chunks.length
        }
      });
      
      if (endIndex === totalLength) break;
      
      startIndex += (this.chunkSize - this.overlap);
      if (startIndex >= totalLength) break;
    }

    console.log(`[ChunkingEngine] Fixed-size chunking produced ${chunks.length} chunks`);
    return chunks;
  }

  public async createSlidingWindow(
    context: string, 
    maxTokens: number
  ): Promise<SlidingWindowResult> {
    console.log(`[ChunkingEngine] Creating sliding window for context (${context.length} chars, max tokens: ${maxTokens})`);

    const currentTokenCount = this.estimateTokens(context);
    
    if (currentTokenCount <= maxTokens) {
      return { 
        content: context,
        totalChunks: 1,
        selectedChunks: 1
      };
    }

    console.log(`[ChunkingEngine] Context too large (${currentTokenCount} tokens), applying sliding window...`);

    // Strategy: Keep the beginning and end, compress the middle
    const maxChars = Math.floor(maxTokens * 3.5); // Rough token-to-char ratio
    const keepFromStart = Math.floor(maxChars * 0.4);
    const keepFromEnd = Math.floor(maxChars * 0.4);
    const summarySize = maxChars - keepFromStart - keepFromEnd;

    let result = context.substring(0, keepFromStart);
    
    if (summarySize > 0) {
      const middleSection = context.substring(keepFromStart, context.length - keepFromEnd);
      const summary = this.createContextSummary(middleSection, summarySize);
      result += '\n\n[... CONTENT SUMMARY ...]\n' + summary + '\n[... END SUMMARY ...]\n\n';
    }
    
    result += context.substring(context.length - keepFromEnd);

    return {
      content: result,
      totalChunks: Math.ceil(currentTokenCount / maxTokens),
      selectedChunks: 1
    };
  }

  private createContextSummary(text: string, maxLength: number): string {
    // Simple extractive summarization - take first and last sentences of paragraphs
    const paragraphs = text.split('\n\n').filter(p => p.trim().length > 0);
    const summary: string[] = [];
    let currentLength = 0;

    for (const paragraph of paragraphs) {
      const sentences = paragraph.split(/[.!?]+/).filter(s => s.trim().length > 0);
      if (sentences.length > 0) {
        const firstSentence = sentences[0].trim() + '.';
        if (currentLength + firstSentence.length < maxLength) {
          summary.push(firstSentence);
          currentLength += firstSentence.length;
        } else {
          break;
        }
      }
    }

    return summary.join(' ');
  }

  private estimateTokens(text: string): number {
    // Rough estimation: 1 token ≈ 3.5 characters for English text
    // This varies by language and model, but provides a reasonable estimate
    return Math.ceil(text.length / 3.5);
  }

  private getCharPosition(text: string, lineIndex: number): number {
    const lines = text.split('\n');
    let position = 0;
    for (let i = 0; i < Math.min(lineIndex, lines.length); i++) {
      position += lines[i].length + 1; // +1 for newline
    }
    return position;
  }

  private getOverlapText(text: string, overlapSize: number): string {
    if (text.length <= overlapSize) return text;
    
    // Try to find a good breaking point (sentence, paragraph, or word boundary)
    const overlapText = text.substring(text.length - overlapSize);
    const sentenceMatch = overlapText.match(/[.!?]\s+(.+)$/);
    if (sentenceMatch) {
      return sentenceMatch[1];
    }
    
    const wordMatch = overlapText.match(/\s+(.+)$/);
    if (wordMatch) {
      return wordMatch[1];
    }
    
    return overlapText;
  }

  // Utility methods
  getStats(): any {
    return {
      strategy: this.strategy,
      chunkSize: this.chunkSize,
      overlap: this.overlap,
      estimatedTokenRatio: 3.5
    };
  }
} 