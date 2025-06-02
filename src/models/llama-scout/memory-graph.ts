// Persistent Memory Graph for Project Understanding
import * as fs from 'fs/promises';
import * as path from 'path';
import { NodeMetadata } from '../../types';

interface MemoryGraphConfig {
  persistPath: string;
  maxNodeDepth?: number;
  includeComments?: boolean;
}

interface GraphNode {
  id: string; // e.g., file path, function name, class name
  type: 'file' | 'function' | 'class' | 'module' | 'variable' | 'interface' | 'type';
  content?: string; // Snippet or summary
  metadata?: NodeMetadata;
  dependencies?: string[]; // IDs of nodes this node depends on
  children?: string[]; // IDs of nodes contained within this node
}

interface GraphEdge {
  source: string; // ID of source node
  target: string; // ID of target node
  type: 'calls' | 'imports' | 'inherits' | 'contains' | 'references' | 'exports';
  metadata?: {
    lineNumber?: number;
    strength?: number; // For weighting relationships
  };
}

interface ProjectGraph {
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
  metadata: {
    projectPath: string;
    lastUpdated: Date;
    version: string;
    fileCount: number;
    nodeCount: number;
  };
}

export class MemoryGraph {
  private persistPath: string;
  private graph: ProjectGraph;
  private maxNodeDepth: number;
  private includeComments: boolean;

  constructor(config: MemoryGraphConfig) {
    this.persistPath = config.persistPath;
    this.maxNodeDepth = config.maxNodeDepth || 3;
    this.includeComments = config.includeComments || false;
    
    this.graph = {
      nodes: {},
      edges: [],
      metadata: {
        projectPath: '',
        lastUpdated: new Date(),
        version: '1.0.0',
        fileCount: 0,
        nodeCount: 0
      }
    };
    
    this.loadGraph();
  }

  private async loadGraph(): Promise<void> {
    try {
      await fs.access(this.persistPath);
      const fileContent = await fs.readFile(this.persistPath, 'utf-8');
      this.graph = JSON.parse(fileContent) as ProjectGraph;
      console.log(`[MemoryGraph] Graph loaded from ${this.persistPath} (${this.graph.metadata.nodeCount} nodes)`);
    } catch (error) {
      console.log(`[MemoryGraph] No existing graph found at ${this.persistPath}, starting fresh`);
      // Keep the initialized empty graph
    }
  }

  private async saveGraph(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
      this.graph.metadata.lastUpdated = new Date();
      this.graph.metadata.nodeCount = Object.keys(this.graph.nodes).length;
      
      await fs.writeFile(this.persistPath, JSON.stringify(this.graph, null, 2));
      console.log(`[MemoryGraph] Graph saved to ${this.persistPath} (${this.graph.metadata.nodeCount} nodes)`);
    } catch (error) {
      console.error(`[MemoryGraph] Error saving graph:`, error);
    }
  }

  private async parseCodeForEntities(filePath: string, codeContent: string): Promise<{nodes: GraphNode[], edges: GraphEdge[]}> {
    const language = this.detectLanguage(filePath);
    const fileNodeId = filePath;
    
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Add file node
    nodes.push({
      id: fileNodeId,
      type: 'file',
      content: `File: ${path.basename(filePath)}`,
      metadata: {
        language,
        lineNumber: 1
      },
      children: []
    });

    try {
      if (language === 'typescript' || language === 'javascript') {
        const tsNodes = await this.parseTypeScript(filePath, codeContent);
        nodes.push(...tsNodes.nodes);
        edges.push(...tsNodes.edges);
      } else if (language === 'python') {
        const pyNodes = await this.parsePython(filePath, codeContent);
        nodes.push(...pyNodes.nodes);
        edges.push(...pyNodes.edges);
      } else {
        // Generic parsing for other languages
        const genericNodes = await this.parseGeneric(filePath, codeContent, language);
        nodes.push(...genericNodes.nodes);
        edges.push(...genericNodes.edges);
      }
    } catch (error) {
      console.warn(`[MemoryGraph] Error parsing ${filePath}:`, error);
    }

    // Link child nodes to file
    const fileNode = nodes.find(n => n.id === fileNodeId);
    if (fileNode) {
      const childIds = nodes.filter(n => n.id !== fileNodeId).map(n => n.id);
      fileNode.children = childIds;
      
      // Add contains edges
      childIds.forEach(childId => {
        edges.push({
          source: fileNodeId,
          target: childId,
          type: 'contains'
        });
      });
    }

    console.log(`[MemoryGraph] Parsed ${filePath}: ${nodes.length} nodes, ${edges.length} edges`);
    return { nodes, edges };
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.h': 'c',
      '.rs': 'rust',
      '.go': 'go',
      '.rb': 'ruby'
    };
    return languageMap[ext] || 'text';
  }

  private async parseTypeScript(filePath: string, content: string): Promise<{nodes: GraphNode[], edges: GraphEdge[]}> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const lines = content.split('\n');

    // Patterns for TypeScript/JavaScript constructs
    const patterns = {
      function: /^(export\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*:?\s*([^{]*)?/,
      arrowFunction: /^(export\s+)?(const|let|var)\s+(\w+)\s*[=:]\s*(async\s+)?\(([^)]*)\)\s*=>/,
      class: /^(export\s+)?(abstract\s+)?class\s+(\w+)(\s+extends\s+(\w+))?/,
      interface: /^(export\s+)?interface\s+(\w+)(\s+extends\s+([^{]+))?/,
      type: /^(export\s+)?type\s+(\w+)\s*=/,
      import: /^import\s+(.+?)\s+from\s+['"]([^'"]+)['"]/,
      exportFrom: /^export\s+(.+?)\s+from\s+['"]([^'"]+)['"]/
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('//') || line.startsWith('*')) continue;

      // Parse functions
      let match = patterns.function.exec(line);
      if (match) {
        const [, isExported, isAsync, funcName, params, returnType] = match;
        nodes.push({
          id: `${filePath}::${funcName}`,
          type: 'function',
          content: `${isAsync ? 'async ' : ''}function ${funcName}(${params})${returnType ? `: ${returnType.trim()}` : ''}`,
          metadata: {
            language: 'typescript',
            lineNumber: i + 1,
            isExported: !!isExported,
            parameters: params.split(',').map(p => p.trim()).filter(p => p),
            returnType: returnType?.trim()
          }
        });
        continue;
      }

      // Parse arrow functions
      match = patterns.arrowFunction.exec(line);
      if (match) {
        const [, isExported, declaration, funcName, isAsync, params] = match;
        nodes.push({
          id: `${filePath}::${funcName}`,
          type: 'function',
          content: `${declaration} ${funcName} = ${isAsync ? 'async ' : ''}(${params}) =>`,
          metadata: {
            language: 'typescript',
            lineNumber: i + 1,
            isExported: !!isExported,
            parameters: params.split(',').map(p => p.trim()).filter(p => p)
          }
        });
        continue;
      }

      // Parse classes
      match = patterns.class.exec(line);
      if (match) {
        const [, isExported, isAbstract, className, , extendsClass] = match;
        nodes.push({
          id: `${filePath}::${className}`,
          type: 'class',
          content: `${isAbstract ? 'abstract ' : ''}class ${className}${extendsClass ? ` extends ${extendsClass}` : ''}`,
          metadata: {
            language: 'typescript',
            lineNumber: i + 1,
            isExported: !!isExported
          }
        });

        // Add inheritance edge if extends
        if (extendsClass) {
          edges.push({
            source: `${filePath}::${className}`,
            target: extendsClass, // This might need to be resolved to full path later
            type: 'inherits',
            metadata: { lineNumber: i + 1 }
          });
        }
        continue;
      }

      // Parse interfaces
      match = patterns.interface.exec(line);
      if (match) {
        const [, isExported, interfaceName, , extendsInterfaces] = match;
        nodes.push({
          id: `${filePath}::${interfaceName}`,
          type: 'interface',
          content: `interface ${interfaceName}${extendsInterfaces ? ` extends ${extendsInterfaces.trim()}` : ''}`,
          metadata: {
            language: 'typescript',
            lineNumber: i + 1,
            isExported: !!isExported
          }
        });

        // Add inheritance edges for extended interfaces
        if (extendsInterfaces) {
          const parentInterfaces = extendsInterfaces.split(',').map(s => s.trim());
          parentInterfaces.forEach(parent => {
            edges.push({
              source: `${filePath}::${interfaceName}`,
              target: parent,
              type: 'inherits',
              metadata: { lineNumber: i + 1 }
            });
          });
        }
        continue;
      }

      // Parse type aliases
      match = patterns.type.exec(line);
      if (match) {
        const [, isExported, typeName] = match;
        nodes.push({
          id: `${filePath}::${typeName}`,
          type: 'type',
          content: line,
          metadata: {
            language: 'typescript',
            lineNumber: i + 1,
            isExported: !!isExported
          }
        });
        continue;
      }

      // Parse imports
      match = patterns.import.exec(line);
      if (match) {
        const [, imports, modulePath] = match;
        edges.push({
          source: filePath,
          target: this.resolveModulePath(modulePath, filePath),
          type: 'imports',
          metadata: { lineNumber: i + 1 }
        });
        continue;
      }

      // Parse re-exports
      match = patterns.exportFrom.exec(line);
      if (match) {
        const [, exports, modulePath] = match;
        edges.push({
          source: filePath,
          target: this.resolveModulePath(modulePath, filePath),
          type: 'exports',
          metadata: { lineNumber: i + 1 }
        });
        continue;
      }
    }

    return { nodes, edges };
  }

  private async parsePython(filePath: string, content: string): Promise<{nodes: GraphNode[], edges: GraphEdge[]}> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const lines = content.split('\n');

    const patterns = {
      function: /^(async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(->\s*([^:]+))?:/,
      class: /^class\s+(\w+)(\(([^)]+)\))?:/,
      import: /^import\s+(.+)/,
      fromImport: /^from\s+(.+?)\s+import\s+(.+)/
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      // Parse functions
      let match = patterns.function.exec(line);
      if (match) {
        const [, isAsync, funcName, params, , returnType] = match;
        nodes.push({
          id: `${filePath}::${funcName}`,
          type: 'function',
          content: `${isAsync ? 'async ' : ''}def ${funcName}(${params})${returnType ? ` -> ${returnType.trim()}` : ''}:`,
          metadata: {
            language: 'python',
            lineNumber: i + 1,
            parameters: params.split(',').map(p => p.trim()).filter(p => p),
            returnType: returnType?.trim()
          }
        });
        continue;
      }

      // Parse classes
      match = patterns.class.exec(line);
      if (match) {
        const [, className, , parentClasses] = match;
        nodes.push({
          id: `${filePath}::${className}`,
          type: 'class',
          content: `class ${className}${parentClasses ? `(${parentClasses})` : ''}:`,
          metadata: {
            language: 'python',
            lineNumber: i + 1
          }
        });

        // Add inheritance edges
        if (parentClasses) {
          const parents = parentClasses.split(',').map(s => s.trim());
          parents.forEach(parent => {
            edges.push({
              source: `${filePath}::${className}`,
              target: parent,
              type: 'inherits',
              metadata: { lineNumber: i + 1 }
            });
          });
        }
        continue;
      }

      // Parse imports
      match = patterns.import.exec(line);
      if (match) {
        const [, modules] = match;
        modules.split(',').forEach(module => {
          edges.push({
            source: filePath,
            target: module.trim(),
            type: 'imports',
            metadata: { lineNumber: i + 1 }
          });
        });
        continue;
      }

      // Parse from imports
      match = patterns.fromImport.exec(line);
      if (match) {
        const [, module, imports] = match;
        edges.push({
          source: filePath,
          target: module.trim(),
          type: 'imports',
          metadata: { lineNumber: i + 1 }
        });
        continue;
      }
    }

    return { nodes, edges };
  }

  private async parseGeneric(filePath: string, content: string, language: string): Promise<{nodes: GraphNode[], edges: GraphEdge[]}> {
    // Basic parsing for unsupported languages - just extract basic structure
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const lines = content.split('\n');

    // Look for common patterns across languages
    const functionPattern = /^\s*(public|private|protected)?\s*(static)?\s*\w+\s+(\w+)\s*\(/;
    const classPattern = /^\s*(public|private|protected)?\s*class\s+(\w+)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      let match = functionPattern.exec(line);
      if (match) {
        const [, visibility, isStatic, funcName] = match;
        nodes.push({
          id: `${filePath}::${funcName}`,
          type: 'function',
          content: line.trim(),
          metadata: {
            language,
            lineNumber: i + 1,
            visibility: visibility as any
          }
        });
        continue;
      }

      match = classPattern.exec(line);
      if (match) {
        const [, visibility, className] = match;
        nodes.push({
          id: `${filePath}::${className}`,
          type: 'class',
          content: line.trim(),
          metadata: {
            language,
            lineNumber: i + 1,
            visibility: visibility as any
          }
        });
        continue;
      }
    }

    return { nodes, edges };
  }

  private resolveModulePath(modulePath: string, currentFile: string): string {
    if (modulePath.startsWith('.')) {
      // Relative import
      const currentDir = path.dirname(currentFile);
      return path.resolve(currentDir, modulePath);
    }
    // Absolute or node_modules import
    return modulePath;
  }

  public async buildFromRepository(repoPath: string): Promise<void> {
    console.log(`[MemoryGraph] Building memory graph from repository: ${repoPath}`);
    
    // Reset graph for new build
    this.graph = {
      nodes: {},
      edges: [],
      metadata: {
        projectPath: repoPath,
        lastUpdated: new Date(),
        version: '1.0.0',
        fileCount: 0,
        nodeCount: 0
      }
    };

    const allowedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.h'];
    const files: string[] = [];

    // Scan for files
    async function walkDirectory(dir: string): Promise<void> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await walkDirectory(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (allowedExtensions.includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        console.error(`[MemoryGraph] Error scanning directory ${dir}:`, error);
      }
    }

    await walkDirectory(repoPath);
    this.graph.metadata.fileCount = files.length;

    // Parse each file
    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const { nodes, edges } = await this.parseCodeForEntities(file, content);
        
        // Add nodes to graph
        nodes.forEach(node => {
          this.graph.nodes[node.id] = node;
        });
        
        // Add edges to graph
        this.graph.edges.push(...edges);
        
      } catch (error) {
        console.error(`[MemoryGraph] Error processing file ${file}:`, error);
      }
    }

    // Post-processing: resolve references, build call graph, etc.
    await this.postProcessGraph();
    
    await this.saveGraph();
    console.log(`[MemoryGraph] Memory graph built successfully: ${Object.keys(this.graph.nodes).length} nodes, ${this.graph.edges.length} edges`);
  }

  private async postProcessGraph(): Promise<void> {
    console.log('[MemoryGraph] Post-processing graph...');
    
    // Resolve module references
    this.resolveModuleReferences();
    
    // Build function call graph (simplified)
    this.buildCallGraph();
    
    // Calculate node importance/centrality
    this.calculateNodeImportance();
  }

  private resolveModuleReferences(): void {
    // Resolve relative imports and cross-references
    this.graph.edges.forEach(edge => {
      if (edge.type === 'imports' && edge.target.startsWith('.')) {
        // Try to resolve relative imports to actual file paths
        const sourceDir = path.dirname(edge.source);
        const resolvedPath = path.resolve(sourceDir, edge.target);
        
        // Check if the resolved path exists in our nodes
        const possiblePaths = [
          resolvedPath + '.ts',
          resolvedPath + '.js',
          resolvedPath + '/index.ts',
          resolvedPath + '/index.js'
        ];
        
        for (const possiblePath of possiblePaths) {
          if (this.graph.nodes[possiblePath]) {
            edge.target = possiblePath;
            break;
          }
        }
      }
    });
  }

  private buildCallGraph(): void {
    // Simplified call graph building - this would be more sophisticated in production
    const allNodes = Object.values(this.graph.nodes);
    
    allNodes.forEach(node => {
      if (node.type === 'function' && node.content) {
        // Look for function calls in the content (very basic)
        allNodes.forEach(otherNode => {
          if (otherNode.type === 'function' && otherNode.id !== node.id) {
            const functionName = otherNode.id.split('::').pop();
            if (functionName && node.content!.includes(functionName + '(')) {
              this.graph.edges.push({
                source: node.id,
                target: otherNode.id,
                type: 'calls',
                metadata: { strength: 1 }
              });
            }
          }
        });
      }
    });
  }

  private calculateNodeImportance(): void {
    // Calculate importance based on incoming and outgoing edges
    const nodeDegrees: Record<string, { in: number, out: number }> = {};
    
    Object.keys(this.graph.nodes).forEach(nodeId => {
      nodeDegrees[nodeId] = { in: 0, out: 0 };
    });
    
    this.graph.edges.forEach(edge => {
      if (nodeDegrees[edge.source]) nodeDegrees[edge.source].out++;
      if (nodeDegrees[edge.target]) nodeDegrees[edge.target].in++;
    });
    
    // Store importance in metadata
    Object.entries(nodeDegrees).forEach(([nodeId, degree]) => {
      if (this.graph.nodes[nodeId]) {
        this.graph.nodes[nodeId].metadata = {
          ...this.graph.nodes[nodeId].metadata,
          importance: degree.in + degree.out,
          inDegree: degree.in,
          outDegree: degree.out
        };
      }
    });
  }

  public async expandContext(initialContextContent: string, relevantFilePaths: string[]): Promise<string> {
    console.log(`[MemoryGraph] Expanding context using ${relevantFilePaths.length} relevant files...`);
    
    let expandedContext = initialContextContent;
    const relatedEntities = new Set<string>();
    const processedFiles = new Set<string>();

    // Find entities directly related to the relevant files
    for (const filePath of relevantFilePaths) {
      if (processedFiles.has(filePath)) continue;
      processedFiles.add(filePath);

      const fileNode = this.graph.nodes[filePath];
      if (fileNode && fileNode.children) {
        // Add all entities within the file
        fileNode.children.forEach(childId => relatedEntities.add(childId));
      }

      // Find edges involving this file
      this.graph.edges.forEach(edge => {
        if (edge.source === filePath || edge.target === filePath) {
          relatedEntities.add(edge.source);
          relatedEntities.add(edge.target);
        }
        
        // Find entities within the file that have relationships
        if (edge.source.startsWith(filePath + '::')) {
          relatedEntities.add(edge.source);
          relatedEntities.add(edge.target);
        }
        if (edge.target.startsWith(filePath + '::')) {
          relatedEntities.add(edge.source);
          relatedEntities.add(edge.target);
        }
      });
    }

    // Add content from related entities
    const addedContent: string[] = [];
    for (const entityId of relatedEntities) {
      const node = this.graph.nodes[entityId];
      if (node && node.content && !initialContextContent.includes(node.content)) {
        addedContent.push(`\n\n// Related entity: ${node.type} ${entityId}\n${node.content}`);
      }
    }

    if (addedContent.length > 0) {
      expandedContext += '\n\n' + '='.repeat(50) + '\n// RELATED CODE ENTITIES\n' + '='.repeat(50);
      expandedContext += addedContent.join('');
    }

    console.log(`[MemoryGraph] Context expanded with ${addedContent.length} related entities`);
    return expandedContext;
  }

  public async getHotPaths(): Promise<Array<{keyParts: string[], queryPayload?: any}>> {
    console.log('[MemoryGraph] Identifying hot paths...');
    
    const hotPaths: Array<{keyParts: string[], queryPayload?: any}> = [];
    
    // Find most important nodes (high degree centrality)
    const nodesByImportance = Object.values(this.graph.nodes)
      .filter(node => node.metadata?.importance)
      .sort((a, b) => (b.metadata!.importance! - a.metadata!.importance!))
      .slice(0, 10); // Top 10 most important nodes

    nodesByImportance.forEach(node => {
      const pathParts = node.id.split('/');
      if (pathParts.length >= 2) {
        // Create cache keys at different levels
        hotPaths.push({
          keyParts: [pathParts[0], node.type + '_analysis'],
          queryPayload: { nodeId: node.id, type: node.type }
        });
        
        if (pathParts.length >= 3) {
          hotPaths.push({
            keyParts: [pathParts[0], pathParts[1], node.type + '_summary'],
            queryPayload: { nodeId: node.id, type: node.type }
          });
        }
      }
    });

    // Add commonly imported modules
    const importCounts: Record<string, number> = {};
    this.graph.edges
      .filter(edge => edge.type === 'imports')
      .forEach(edge => {
        importCounts[edge.target] = (importCounts[edge.target] || 0) + 1;
      });

    Object.entries(importCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .forEach(([module, count]) => {
        hotPaths.push({
          keyParts: ['common_imports', module.replace(/[^a-zA-Z0-9]/g, '_')],
          queryPayload: { module, importCount: count }
        });
      });

    console.log(`[MemoryGraph] Identified ${hotPaths.length} hot paths`);
    return hotPaths;
  }

  // Utility methods
  getGraphStats(): any {
    return {
      nodes: Object.keys(this.graph.nodes).length,
      edges: this.graph.edges.length,
      files: this.graph.metadata.fileCount,
      lastUpdated: this.graph.metadata.lastUpdated,
      nodeTypes: this.getNodeTypeDistribution(),
      edgeTypes: this.getEdgeTypeDistribution()
    };
  }

  private getNodeTypeDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {};
    Object.values(this.graph.nodes).forEach(node => {
      distribution[node.type] = (distribution[node.type] || 0) + 1;
    });
    return distribution;
  }

  private getEdgeTypeDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {};
    this.graph.edges.forEach(edge => {
      distribution[edge.type] = (distribution[edge.type] || 0) + 1;
    });
    return distribution;
  }

  async findRelatedNodes(nodeId: string, maxDepth: number = 2): Promise<GraphNode[]> {
    const visited = new Set<string>();
    const related: GraphNode[] = [];
    const queue: Array<{id: string, depth: number}> = [{id: nodeId, depth: 0}];

    while (queue.length > 0) {
      const {id, depth} = queue.shift()!;
      
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);

      const node = this.graph.nodes[id];
      if (node && depth > 0) {
        related.push(node);
      }

      if (depth < maxDepth) {
        // Find connected nodes
        this.graph.edges.forEach(edge => {
          if (edge.source === id && !visited.has(edge.target)) {
            queue.push({id: edge.target, depth: depth + 1});
          }
          if (edge.target === id && !visited.has(edge.source)) {
            queue.push({id: edge.source, depth: depth + 1});
          }
        });
      }
    }

    return related;
  }
} 