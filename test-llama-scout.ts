#!/usr/bin/env ts-node

import { LlamaScoutOptimized } from './src/models/llama-scout/index';
import { LlamaScoutConfig } from './src/types';

async function testLlamaScout() {
  console.log('🦙 Testing Real Llama 4 Scout Integration via Together AI\n');

  // Check if Together API key is configured
  const togetherApiKey = process.env.TOGETHER_API_KEY;
  if (!togetherApiKey) {
    console.error('❌ TOGETHER_API_KEY not found in environment variables');
    console.log('📝 Please set your Together AI API key:');
    console.log('   export TOGETHER_API_KEY="your_together_api_key_here"');
    console.log('   Sign up at: https://api.together.ai/');
    return;
  }

  console.log('✅ Together API key found');
  console.log(`🔑 API Key: ${togetherApiKey.substring(0, 10)}...${togetherApiKey.slice(-4)}`);

  try {
    // Initialize Llama Scout with real configuration
    const config: LlamaScoutConfig = {
      apiKey: togetherApiKey,
      vectorIndexPath: './data/vector-index/test_llama_scout.faiss',
      cacheTTL: 3600,
      chunkSize: 2048,
      chunkOverlap: 256,
      chunkingStrategy: 'semantic-aware',
      memoryGraphPath: './data/memory-graphs/test_graph.json'
    };

    console.log('\n🔧 Initializing Llama 4 Scout...');
    const llamaScout = new LlamaScoutOptimized(config);

    // Test 1: Simple query test
    console.log('\n📋 Test 1: Simple Context Query');
    console.log('Query: "Explain the architecture of a TypeScript project"');
    
    const simpleQuery = "Explain the architecture of a TypeScript project";
    const startTime = Date.now();
    
    const result = await llamaScout.queryWithContext(simpleQuery, 2000);
    const duration = Date.now() - startTime;
    
    console.log('✅ Query completed successfully!');
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`📝 Response length: ${result.content.length} characters`);
    console.log(`🎯 Relevance score: ${result.relevanceScore}`);
    console.log('\n📄 Response preview:');
    console.log(result.content.substring(0, 300) + '...\n');

    // Test 2: Code analysis
    console.log('📋 Test 2: Code Analysis Test');
    const codeQuery = "How should I structure error handling in a Node.js TypeScript application?";
    console.log(`Query: "${codeQuery}"`);
    
    const codeStartTime = Date.now();
    const codeResult = await llamaScout.queryWithContext(codeQuery, 3000);
    const codeDuration = Date.now() - codeStartTime;
    
    console.log('✅ Code analysis completed!');
    console.log(`⏱️  Duration: ${codeDuration}ms`);
    console.log(`📝 Response length: ${codeResult.content.length} characters`);
    console.log('\n📄 Code analysis preview:');
    console.log(codeResult.content.substring(0, 400) + '...\n');

    // Test 3: Index stats
    console.log('📋 Test 3: Index Statistics');
    const indexStats = await llamaScout.getIndexStats();
    console.log('📊 Index Stats:', indexStats);

    // Test 4: Deep analysis capability
    console.log('\n📋 Test 4: Deep Analysis Capability');
    const deepAnalysisSpec = {
      task: 'architectural_review',
      focus: 'scalability_and_maintainability',
      language: 'typescript'
    };
    
    const deepResult = await llamaScout.deepAnalysis(deepAnalysisSpec, {
      files: ['src/models/llama-scout/index.ts', 'src/types/index.ts']
    });
    
    console.log('✅ Deep analysis completed!');
    console.log(`🎯 Confidence: ${deepResult.confidence}`);
    console.log('\n📄 Deep analysis preview:');
    console.log(deepResult.analysis.substring(0, 400) + '...\n');

    // Cleanup
    await llamaScout.cleanup();
    console.log('🧹 Resources cleaned up');

    console.log('\n🎉 All Llama 4 Scout tests completed successfully!');
    console.log('✅ Llama 4 Scout is working with real Together AI integration');

  } catch (error) {
    console.error('\n❌ Error testing Llama 4 Scout:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        console.log('\n💡 API Key Issue:');
        console.log('   - Verify your Together API key is correct');
        console.log('   - Check if you have sufficient credits');
        console.log('   - Ensure the key has access to Llama models');
      } else if (error.message.includes('model')) {
        console.log('\n💡 Model Issue:');
        console.log('   - Llama 4 Scout model might not be available');
        console.log('   - Try using a different Llama model variant');
        console.log('   - Check Together AI model availability');
      } else if (error.message.includes('network') || error.message.includes('timeout')) {
        console.log('\n💡 Network Issue:');
        console.log('   - Check your internet connection');
        console.log('   - Try again in a few moments');
        console.log('   - Verify Together AI service status');
      }
    }
    
    process.exit(1);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n⚠️  Test interrupted by user');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the test
testLlamaScout().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
}); 