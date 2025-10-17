// Smart page cache manager with adjacent caching + LIFO queue
// Optimized for language learning reading patterns

interface CacheItem<T> {
  pageIndex: number;
  data: T;
  timestamp: number;
  size: number; // estimated size in bytes
}

interface CacheConfig {
  maxAdjacentPages: number;  // Always cache adjacent pages (prev + current + next)
  maxRecentPages: number;    // LIFO queue for recently visited non-adjacent pages
  maxTotalSize: number;      // Maximum total cache size in bytes
}

export class SmartPageCache<T> {
  private adjacentCache = new Map<number, CacheItem<T>>(); // Always: prev + current + next
  private recentQueue: CacheItem<T>[] = []; // LIFO for non-adjacent pages
  private currentPage: number = 0;
  private config: CacheConfig;
  private getSizeEstimate: (data: T) => number;

  constructor(
    config: CacheConfig,
    getSizeEstimate: (data: T) => number
  ) {
    this.config = config;
    this.getSizeEstimate = getSizeEstimate;
  }

  // Set current page and manage adjacent caching
  setCurrentPage(pageIndex: number): void {
    const previousPage = this.currentPage;
    this.currentPage = pageIndex;
    
    console.log(`[SmartPageCache] Page transition: ${previousPage} → ${pageIndex}`);
    
    // If we're moving to an adjacent page, we might already have it cached
    if (Math.abs(pageIndex - previousPage) === 1) {
      console.log(`[SmartPageCache] Adjacent page transition - optimizing cache`);
      this.optimizeAdjacentCache(pageIndex, previousPage);
    } else if (pageIndex !== previousPage) {
      console.log(`[SmartPageCache] Non-adjacent jump - reorganizing cache`);
      this.handlePageJump(pageIndex, previousPage);
    }
  }

  // Get cached data for a page
  get(pageIndex: number): T | null {
    // Check adjacent cache first (fastest access)
    const adjacentItem = this.adjacentCache.get(pageIndex);
    if (adjacentItem) {
      console.log(`[SmartPageCache] 🎯 Cache HIT (adjacent): page ${pageIndex}`);
      return adjacentItem.data;
    }

    // Check recent queue
    const recentIndex = this.recentQueue.findIndex(item => item.pageIndex === pageIndex);
    if (recentIndex !== -1) {
      const item = this.recentQueue[recentIndex];
      console.log(`[SmartPageCache] 🎯 Cache HIT (recent): page ${pageIndex}`);
      
      // Move to front of queue (LRU behavior within LIFO)
      this.recentQueue.splice(recentIndex, 1);
      this.recentQueue.unshift(item);
      
      return item.data;
    }

    console.log(`[SmartPageCache] ❌ Cache MISS: page ${pageIndex}`);
    return null;
  }

  // Set cached data for a page
  set(pageIndex: number, data: T): void {
    const size = this.getSizeEstimate(data);
    const item: CacheItem<T> = {
      pageIndex,
      data,
      timestamp: Date.now(),
      size
    };

    // If this is an adjacent page, store in adjacent cache
    if (this.isAdjacentPage(pageIndex)) {
      console.log(`[SmartPageCache] 💾 Caching adjacent page ${pageIndex} (${this.formatSize(size)})`);
      this.adjacentCache.set(pageIndex, item);
    } else {
      console.log(`[SmartPageCache] 💾 Caching recent page ${pageIndex} (${this.formatSize(size)})`);
      this.addToRecentQueue(item);
    }

    this.enforceMemoryLimits();
  }

  // Check if we need to fetch a page (cache miss)
  needsFetch(pageIndex: number): boolean {
    return this.get(pageIndex) === null;
  }

  // Get pages that should be prefetched for current page
  getPrefetchTargets(): number[] {
    const targets: number[] = [];
    
    // Always want prev + current + next
    const prevPage = this.currentPage - 1;
    const nextPage = this.currentPage + 1;
    
    if (prevPage >= 0 && this.needsFetch(prevPage)) {
      targets.push(prevPage);
    }
    
    if (this.needsFetch(this.currentPage)) {
      targets.push(this.currentPage);
    }
    
    // Note: we don't know max pages here, so caller should validate nextPage
    if (this.needsFetch(nextPage)) {
      targets.push(nextPage);
    }

    return targets;
  }

  private isAdjacentPage(pageIndex: number): boolean {
    const diff = Math.abs(pageIndex - this.currentPage);
    return diff <= 1; // prev, current, or next
  }

  private optimizeAdjacentCache(newPage: number, oldPage: number): void {
    // We're moving from oldPage to newPage (adjacent)
    // Smart optimization: keep overlapping adjacent pages
    
    const oldAdjacent = [oldPage - 1, oldPage, oldPage + 1];
    const newAdjacent = [newPage - 1, newPage, newPage + 1];
    
    // Pages that are no longer adjacent - move to recent queue
    const adjacentEntries = Array.from(this.adjacentCache.entries());
    for (const [pageIndex, item] of adjacentEntries) {
      if (!newAdjacent.includes(pageIndex)) {
        console.log(`[SmartPageCache] Moving page ${pageIndex} from adjacent to recent queue`);
        this.addToRecentQueue(item);
        this.adjacentCache.delete(pageIndex);
      }
    }
  }

  private handlePageJump(newPage: number, oldPage: number): void {
    // Non-adjacent jump - move current adjacent cache to recent queue
    const adjacentItems = Array.from(this.adjacentCache.values());
    
    for (const item of adjacentItems) {
      console.log(`[SmartPageCache] Jump: moving page ${item.pageIndex} to recent queue`);
      this.addToRecentQueue(item);
    }
    
    this.adjacentCache.clear();
  }

  private addToRecentQueue(item: CacheItem<T>): void {
    // Remove if already exists
    const existingIndex = this.recentQueue.findIndex(q => q.pageIndex === item.pageIndex);
    if (existingIndex !== -1) {
      this.recentQueue.splice(existingIndex, 1);
    }

    // Add to front (LIFO)
    this.recentQueue.unshift(item);

    // Enforce max size
    while (this.recentQueue.length > this.config.maxRecentPages) {
      const removed = this.recentQueue.pop();
      if (removed) {
        console.log(`[SmartPageCache] LIFO eviction: page ${removed.pageIndex}`);
      }
    }
  }

  private enforceMemoryLimits(): void {
    const totalSize = this.getTotalSize();
    
    if (totalSize > this.config.maxTotalSize) {
      console.log(`[SmartPageCache] ⚠️ Memory limit exceeded: ${this.formatSize(totalSize)} > ${this.formatSize(this.config.maxTotalSize)}`);
      
      // Evict from recent queue first (adjacent cache is protected)
      while (this.recentQueue.length > 0 && this.getTotalSize() > this.config.maxTotalSize) {
        const removed = this.recentQueue.pop();
        if (removed) {
          console.log(`[SmartPageCache] Memory eviction: page ${removed.pageIndex}`);
        }
      }
    }
  }

  private getTotalSize(): number {
    let total = 0;
    
    const adjacentItems = Array.from(this.adjacentCache.values());
    for (const item of adjacentItems) {
      total += item.size;
    }
    
    for (const item of this.recentQueue) {
      total += item.size;
    }
    
    return total;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  // Debug info
  getStats(): {
    currentPage: number;
    adjacentCached: number[];
    recentCached: number[];
    totalSize: string;
    memoryUtilization: number;
  } {
    return {
      currentPage: this.currentPage,
      adjacentCached: Array.from(this.adjacentCache.keys()).sort((a, b) => a - b),
      recentCached: this.recentQueue.map(item => item.pageIndex),
      totalSize: this.formatSize(this.getTotalSize()),
      memoryUtilization: this.getTotalSize() / this.config.maxTotalSize
    };
  }

  // Clear all cache
  clear(): void {
    console.log(`[SmartPageCache] Clearing all cache`);
    this.adjacentCache.clear();
    this.recentQueue.length = 0;
  }
}

// Factory functions for different data types
export function createAudioCache(): SmartPageCache<any> {
  return new SmartPageCache(
    {
      maxAdjacentPages: 3,    // prev + current + next
      maxRecentPages: 4,      // 4 recently visited pages in LIFO
      maxTotalSize: 15 * 1024 * 1024 // 15MB total (audio is larger)
    },
    (data) => {
      // Estimate audio cache size
      if (!data || !data.sentenceTimestamps) return 1024; // fallback
      
      // Sentence-level audio: estimate based on timestamps
      const sentenceCount = data.sentenceTimestamps.length;
      const avgAudioPerSentence = 100 * 1024; // ~100KB per sentence audio (base64 encoded)
      return sentenceCount * avgAudioPerSentence;
    }
  );
}

export function createTranslationCache(): SmartPageCache<any> {
  return new SmartPageCache(
    {
      maxAdjacentPages: 3,    // prev + current + next  
      maxRecentPages: 10,     // 10 recently visited pages (translations are smaller)
      maxTotalSize: 5 * 1024 * 1024 // 5MB total (translations are much smaller)
    },
    (data) => {
      // Estimate translation cache size
      if (!data) return 512; // fallback
      
      // Rough estimate based on JSON string length
      const jsonSize = JSON.stringify(data).length;
      return jsonSize * 2; // Account for overhead
    }
  );
}