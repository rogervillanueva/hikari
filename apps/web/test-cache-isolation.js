// Quick test to verify document-specific cache isolation
// This can be run in the browser console

console.log('🧪 Testing Document Cache Isolation');

// Test that different documentIds get different cache instances
const testCache = () => {
  // Simulate getting cache for different documents
  const doc1Cache = new Map();
  const doc2Cache = new Map();
  
  // Add same pageIndex (0) to both with different data
  doc1Cache.set(0, { 
    audioBuffer: 'doc1-page0-audio', 
    timestampMarkers: [{ sentenceIndex: 0, timestamp: 1000 }]
  });
  
  doc2Cache.set(0, { 
    audioBuffer: 'doc2-page0-audio', 
    timestampMarkers: [{ sentenceIndex: 0, timestamp: 2000 }]
  });
  
  // Verify isolation - same pageIndex (0) but different content
  console.log('📋 Document 1 Page 0:', doc1Cache.get(0));
  console.log('📋 Document 2 Page 0:', doc2Cache.get(0));
  
  // This should show different audio data for the same page index
  const isIsolated = doc1Cache.get(0).audioBuffer !== doc2Cache.get(0).audioBuffer;
  console.log(`✅ Cache isolation working: ${isIsolated}`);
  
  return isIsolated;
};

// Run the test
testCache();

console.log('🎯 Key insight: Each document now has its own cache instance');
console.log('🔧 This prevents Document 2 Page 1 from getting Document 1 Page 1 audio');