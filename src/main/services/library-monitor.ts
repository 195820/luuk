import fs from 'fs';
import { logger } from '../../utils/logger';

/**
 * 库状态变更回调
 */
export type LibraryStatusCallback = (libraryId: number, status: 'online' | 'offline') => void;

/**
 * 离线库自动检测服务
 * 定时探测库根路径可达性，自动更新在线/离线状态
 */
export class LibraryMonitor {
  private timer: NodeJS.Timeout | null = null;
  private libraries: Array<{ id: number; rootPath: string }> = [];
  private statusCache = new Map<number, 'online' | 'offline'>();
  private onStatusChange?: LibraryStatusCallback;
  private intervalMs: number;

  constructor(intervalMs = 5000) {
    this.intervalMs = intervalMs;
  }

  /**
   * 启动监控
   */
  start() {
    if (this.timer) return;
    logger.info('LibraryMonitor', `启动库监控，探测间隔: ${this.intervalMs}ms`);
    this.timer = setInterval(() => this.probeAll(), this.intervalMs);
    this.probeAll(); // 立即执行一次
  }

  /**
   * 停止监控
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('LibraryMonitor', '库监控已停止');
    }
  }

  /**
   * 设置要监控的库列表
   */
  setLibraries(libs: Array<{ id: number; rootPath: string }>) {
    this.libraries = libs;
    // 初始化状态缓存
    for (const lib of libs) {
      if (!this.statusCache.has(lib.id)) {
        this.statusCache.set(lib.id, 'online');
      }
    }
  }

  /**
   * 注册状态变更回调
   */
  onStatusChanged(callback: LibraryStatusCallback) {
    this.onStatusChange = callback;
  }

  /**
   * 获取库当前状态
   */
  getStatus(libraryId: number): 'online' | 'offline' {
    return this.statusCache.get(libraryId) || 'offline';
  }

  /**
   * 探测所有库
   */
  private async probeAll() {
    const promises = this.libraries.map(async (lib) => {
      const next = await this.probe(lib.rootPath);
      const prev = this.statusCache.get(lib.id);

      if (prev !== next) {
        this.statusCache.set(lib.id, next);
        logger.info('LibraryMonitor', `库 ${lib.id} (${lib.rootPath}) 状态变更: ${prev ?? 'unknown'} → ${next}`);

        if (this.onStatusChange) {
          this.onStatusChange(lib.id, next);
        }
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * 探测单个路径可达性
   */
  private async probe(p: string): Promise<'online' | 'offline'> {
    try {
      await fs.promises.access(p, fs.constants.R_OK);
      return 'online';
    } catch {
      return 'offline';
    }
  }
}

// 单例导出
export const libraryMonitor = new LibraryMonitor();
