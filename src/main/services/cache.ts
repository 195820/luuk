/**
 * LRU 缓存条目
 */
interface CacheEntry {
  value: string;
  entrySize: number;
  lastAccess: number;
}

/**
 * LRU 缓存服务
 * 用于缓存已解码的缩略图数据
 */
export class LRUCache {
  private cache: Map<string, CacheEntry>;
  private maxSizeBytes: number;
  private currentSizeBytes: number = 0;

  /**
   * 创建 LRU 缓存
   * @param maxSizeMB 最大缓存大小 (MB)
   */
  constructor(maxSizeMB: number = 200) {
    this.maxSizeBytes = maxSizeMB * 1024 * 1024;
    this.cache = new Map();
  }

  /**
   * 生成缓存键
   */
  private makeKey(imageId: string | number, size: string): string {
    return `${imageId}:${size}`;
  }

  /**
   * 设置缓存
   */
  set(imageId: string | number, size: string, value: string): void {
    const key = this.makeKey(imageId, size);

    // 估算大小 (base64 字符串约等于原始大小的 1.33 倍)
    const entrySize = Math.ceil(value.length * 0.75);

    // 如果缓存已存在，先删除旧条目
    if (this.cache.has(key)) {
      const oldEntry = this.cache.get(key)!;
      this.currentSizeBytes -= oldEntry.entrySize;
      this.cache.delete(key);
    }

    // 淘汰旧数据直到有足够空间
    while (this.currentSizeBytes + entrySize > this.maxSizeBytes && this.cache.size > 0) {
      // 找到最久未使用的条目
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        const oldEntry = this.cache.get(oldestKey)!;
        this.currentSizeBytes -= oldEntry.entrySize;
        this.cache.delete(oldestKey);
        
        // ========== 测试 1.3 LRU 缓存淘汰记录 ==========
        console.log(`[TEST-1.3] LRU 淘汰：${oldestKey}, 释放 ${Math.round(oldEntry.entrySize / 1024)}KB`);
        // ==================================================
      }
    }

    // 添加新条目
    this.cache.set(key, {
      value,
      entrySize,
      lastAccess: Date.now()
    });
    this.currentSizeBytes += entrySize;
    
    // ========== 测试 1.2 缓存命中记录 ==========
    console.log(`[TEST-1.2] 缓存写入：${key}, 当前缓存大小：${(this.currentSizeBytes / 1024 / 1024).toFixed(2)}MB`);
    // ============================================
  }

  /**
   * 获取缓存
   */
  get(imageId: string | number, size: string): string | undefined {
    const key = this.makeKey(imageId, size);
    const entry = this.cache.get(key);

    if (entry) {
      // 更新访问时间并移到末尾
      entry.lastAccess = Date.now();
      this.cache.delete(key);
      this.cache.set(key, entry);
      
      // ========== 测试 1.2 缓存命中记录 ==========
      console.log(`[TEST-1.2] 缓存命中：${key}`);
      // ============================================
      
      return entry.value;
    }

    // ========== 测试 1.2 缓存未命中记录 ==========
    console.log(`[TEST-1.2] 缓存未命中：${key}`);
    // ============================================

    return undefined;
  }

  /**
   * 检查缓存是否存在
   */
  has(imageId: string | number, size: string): boolean {
    return this.cache.has(this.makeKey(imageId, size));
  }

  /**
   * 删除缓存
   */
  delete(imageId: string | number, size: string): boolean {
    const key = this.makeKey(imageId, size);
    const entry = this.cache.get(key);

    if (entry) {
      this.currentSizeBytes -= entry.entrySize;
      
      // ========== 测试 2.1 删除库缓存清理记录 ==========
      console.log(`[TEST-2.1] 缓存清理：${key}`);
      // ================================================
      
      return this.cache.delete(key);
    }

    return false;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    const clearedCount = this.cache.size;
    const clearedSize = this.currentSizeBytes;
    this.cache.clear();
    this.currentSizeBytes = 0;
    
    // ========== 测试 2.1 删除库缓存清理记录 ==========
    console.log(`[TEST-2.1] 缓存清空：清理 ${clearedCount} 条记录，释放 ${Math.round(clearedSize / 1024 / 1024)}MB`);
    // ================================================
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    count: number;
    sizeBytes: number;
    sizeMB: number;
    maxSizeMB: number;
    utilization: number;
  } {
    return {
      count: this.cache.size,
      sizeBytes: this.currentSizeBytes,
      sizeMB: this.currentSizeBytes / 1024 / 1024,
      maxSizeMB: this.maxSizeBytes / 1024 / 1024,
      utilization: (this.currentSizeBytes / this.maxSizeBytes) * 100
    };
  }

  /**
   * 获取所有缓存键
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 修剪缓存到指定大小
   */
  trim(targetSizeMB?: number): number {
    const targetBytes = (targetSizeMB || this.maxSizeBytes / 1024 / 1024 / 2) * 1024 * 1024;
    let removed = 0;

    while (this.currentSizeBytes > targetBytes && this.cache.size > 0) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        const entry = this.cache.get(oldestKey)!;
        this.currentSizeBytes -= entry.entrySize;
        this.cache.delete(oldestKey);
        removed++;
      }
    }

    return removed;
  }

  /**
   * 更新最大缓存大小
   */
  setMaxSize(maxSizeMB: number): void {
    this.maxSizeBytes = maxSizeMB * 1024 * 1024;

    // 如果当前大小超过新限制，修剪缓存
    if (this.currentSizeBytes > this.maxSizeBytes) {
      this.trim(maxSizeMB * 0.8);
    }
  }
}

// 单例实例
let lruCacheInstance: LRUCache | null = null;

/**
 * 获取 LRU 缓存实例
 */
export function getLRUCache(maxSizeMB?: number): LRUCache {
  if (!lruCacheInstance) {
    lruCacheInstance = new LRUCache(maxSizeMB);
  }
  return lruCacheInstance;
}

/**
 * 创建新的 LRU 缓存实例
 */
export function createLRUCache(maxSizeMB: number = 200): LRUCache {
  return new LRUCache(maxSizeMB);
}
