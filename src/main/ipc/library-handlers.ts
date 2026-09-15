import { ipcMain, dialog, BrowserWindow } from 'electron';
import path from 'path';
import { getImageService } from '../services/image-service';
import { getMimeTypeFromPath } from '../utils/media';
import { registerMediaUrl } from '../services/media-registry';
import { readExif } from '../utils/exif';
import type { ThumbnailSize, ImageQueryOptions, ScanResult, Library, Favorite } from '../../types';
import { logger } from '../../utils/logger';
import { sendToRenderer } from '../utils/ipc';
import { isPathWithin } from '../utils/path-safe';
import { getMasterDB } from '../services/database';
import { libraryMonitor } from '../services/library-monitor';

/**
 * 验证文件路径是否在已注册库目录内
 * 使用大小写不敏感比较（Windows 兼容性）
 * @param filePath 要验证的文件路径
 * @returns 解析后的绝对路径
 * @throws Error 如果路径不在允许的库目录内
 */
function validateLibraryAccess(filePath: string): string {
  const service = getImageService();
  const resolvedPath = path.resolve(filePath);
  const libraries = service.getLibraries();
  const allowedPaths = libraries.map(lib => path.resolve(lib.rootPath));
  // 使用大小写不敏感的比较（Windows 兼容性）
  const resolvedLower = resolvedPath.toLowerCase();
  const isAllowed = allowedPaths.some(root => {
    const rootLower = path.resolve(root).toLowerCase();
    return resolvedLower.startsWith(rootLower + path.sep) || resolvedLower === rootLower;
  });
  if (!isAllowed) {
    throw new Error('Access denied: path outside allowed library directory');
  }
  return resolvedPath;
}

/**
 * 注册库管理相关的 IPC 处理器
 */
export function registerLibraryHandlers(): void {
  const service = getImageService();

  // 初始化库监控
  const masterDB = getMasterDB();
  const libraries = masterDB.getLibraries();
  libraryMonitor.setLibraries(libraries.map(lib => ({ id: lib.id, rootPath: lib.rootPath })));
  libraryMonitor.onStatusChanged((libraryId, status) => {
    masterDB.updateLibraryStatus(libraryId, status);
    sendToRenderer('library-status-changed', { id: libraryId, status });
  });
  libraryMonitor.start();

  // 初始化服务
  ipcMain.handle('initImageService', async () => {
    await service.initialize();
    return { success: true };
  });

  // 获取所有库
  ipcMain.handle('getLibraries', async (): Promise<Library[]> => {
    return service.getLibraries();
  });

  // 添加库（返回 Promise，等待扫描完成）
  ipcMain.handle('addLibrary', async (
    _event: Electron.IpcMainInvokeEvent,
    name: string,
    rootPath: string,
    autoScan?: boolean
  ): Promise<Library> => {
    const library = await service.addLibrary({ name, rootPath, autoScan });

    // 更新库监控列表
    const libs = masterDB.getLibraries();
    libraryMonitor.setLibraries(libs.map(lib => ({ id: lib.id, rootPath: lib.rootPath })));

    // 如果需要等待扫描完成，在这里等待
    if (autoScan !== false) {
      // 返回库信息，前端可以轮询或通过事件监听扫描完成
      // 通知前端扫描开始
      sendToRenderer('library-scan-started', { libraryId: library.id });
    }

    return library;
  });

  // 选择文件夹对话框
  ipcMain.handle('selectFolder', async (): Promise<string | null> => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
      return null;
    }
    const result = await dialog.showOpenDialog(windows[0], {
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // 删除库
  ipcMain.handle('removeLibrary', async (
    _event: Electron.IpcMainInvokeEvent,
    id: number
  ): Promise<void> => {
    await service.removeLibrary(id);
    // 更新库监控列表
    const libs = masterDB.getLibraries();
    libraryMonitor.setLibraries(libs.map(lib => ({ id: lib.id, rootPath: lib.rootPath })));
  });

  // 扫描库
  ipcMain.handle('scanLibrary', async (
    _event: Electron.IpcMainInvokeEvent,
    id: number
  ): Promise<ScanResult> => {
    return service.scanLibrary(id);
  });

  // 获取文件夹树
  ipcMain.handle('getFolderTree', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number
  ): Promise<any[]> => {
    return service.getFolderTree(libraryId);
  });

  // 获取图片列表
  ipcMain.handle('getImages', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    options: ImageQueryOptions
  ): Promise<any[]> => {
    return service.getImages(libraryId, options);
  });

  // 获取指定文件夹下的图片列表
  ipcMain.handle('getImagesByFolder', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    folderPath: string | null,
    options: ImageQueryOptions
  ): Promise<any[]> => {
    return service.getImagesByFolder(libraryId, folderPath, options);
  });

  // 获取图片总数
  ipcMain.handle('getImageCount', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number
  ): Promise<number> => {
    return service.getImageCount(libraryId);
  });

  // 获取指定文件夹下的图片总数
  ipcMain.handle('getImageCountByFolder', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    folderPath: string | null
  ): Promise<number> => {
    return service.getImageCountByFolder(libraryId, folderPath);
  });

  // 获取图片路径
  ipcMain.handle('getImagePath', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    imageId: number
  ): Promise<string> => {
    return service.getImagePath(libraryId, imageId);
  });

  // 根据相对路径获取图片路径
  ipcMain.handle('getImagePathByRelativePath', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    relativePath: string
  ): Promise<string> => {
    return service.getImagePathByRelativePath(libraryId, relativePath);
  });

  // 根据相对路径获取图片信息
  ipcMain.handle('getImageByRelativePath', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    relativePath: string
  ): Promise<any> => {
    return service.getImageByRelativePath(libraryId, relativePath);
  });

  // 获取收藏库中的图片列表
  ipcMain.handle('getFavoriteImages', async (
    _event: Electron.IpcMainInvokeEvent,
    options: ImageQueryOptions
  ): Promise<any[]> => {
    return service.getFavoriteImages(options);
  });

  // 获取收藏库中的图片数量
  ipcMain.handle('getFavoriteImagesCount', async (): Promise<number> => {
    return service.getFavoriteImagesCount();
  });

  // ==================== 收藏文件夹相关 IPC ====================

  // 添加收藏文件夹
  ipcMain.handle('addFavoriteFolder', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    folderPath: string
  ): Promise<void> => {
    return service.addFavoriteFolder(libraryId, folderPath);
  });

  // 移除收藏文件夹
  ipcMain.handle('removeFavoriteFolder', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    folderPath: string
  ): Promise<void> => {
    return service.removeFavoriteFolder(libraryId, folderPath);
  });

  // 获取所有收藏的文件夹
  ipcMain.handle('getFavoriteFolders', async (): Promise<any[]> => {
    return service.getFavoriteFolders();
  });

  // 获取收藏的文件夹树
  ipcMain.handle('getFavoriteFolderTree', async (): Promise<any[]> => {
    return service.getFavoriteFolderTree();
  });

  // 检查文件夹是否已收藏
  ipcMain.handle('isFavoriteFolder', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    folderPath: string
  ): Promise<boolean> => {
    return service.isFavoriteFolder(libraryId, folderPath);
  });

  // 获取收藏文件夹下的图片列表
  ipcMain.handle('getFavoriteFolderImages', async (
    _event: Electron.IpcMainInvokeEvent,
    folderPath: string,
    options: { limit: number; offset: number }
  ): Promise<any[]> => {
    return service.getFavoriteFolderImages(folderPath, options);
  });

  // 获取收藏文件夹下的图片总数
  ipcMain.handle('getFavoriteFolderImageCount', async (
    _event: Electron.IpcMainInvokeEvent,
    folderPath: string
  ): Promise<number> => {
    return service.getFavoriteFolderImageCount(folderPath);
  });

  // 获取单图收藏（不属于任何收藏文件夹的图片）
  ipcMain.handle('getSingleFavoriteImages', async (
    _event: Electron.IpcMainInvokeEvent,
    options: { limit: number; offset: number }
  ): Promise<any[]> => {
    return service.getSingleFavoriteImages(options);
  });

  // 获取单图收藏数量
  ipcMain.handle('getSingleFavoriteCount', async (): Promise<number> => {
    return service.getSingleFavoriteCount();
  });

  // 获取缩略图
  ipcMain.handle('getThumbnail', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    imageId: number,
    size: ThumbnailSize = 'medium'
  ): Promise<string> => {
    try {
      const result = await service.getThumbnail(libraryId, imageId, size);
      return result;
    } catch (err) {
      logger.error('IPC', 'getThumbnail FAILED', `lib=${libraryId} id=${imageId}`, err);
      throw err;
    }
  });

  // 批量获取缩略图（返回普通对象，因为 Electron IPC 不保留 Map 类型）
  ipcMain.handle('getThumbnails', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    imageIds: number[],
    size: ThumbnailSize = 'medium'
  ): Promise<Record<number, string>> => {
    const map = await service.getThumbnails(libraryId, imageIds, size);
    const result: Record<number, string> = {};
    for (const [key, value] of map.entries()) {
      result[key] = value;
    }
    return result;
  });

  // 切换收藏状态
  ipcMain.handle('toggleFavorite', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    imagePath: string,
    tags?: string[]
  ): Promise<boolean> => {
    return service.toggleFavorite(libraryId, imagePath, tags);
  });

  // 获取收藏列表
  ipcMain.handle('getFavorites', async (): Promise<Favorite[]> => {
    const favorites = service.getFavorites();
    return favorites.map(f => ({
      id: 0,
      libraryId: f.library_id,
      imagePath: f.image_path,
      tags: f.tags,
      rating: f.rating,
      createdAt: new Date().toISOString(),
    }));
  });

  // 设置图片评分
  ipcMain.handle('setFavoriteRating', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    imagePath: string,
    rating: number
  ): Promise<void> => {
    service.setFavoriteRating(libraryId, imagePath, rating);
  });

  // ==================== 浏览历史 IPC ====================

  // 添加浏览历史
  ipcMain.handle('addHistory', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    imagePath: string
  ): Promise<void> => {
    service.addHistory(libraryId, imagePath);
  });

  // 获取最近浏览历史
  ipcMain.handle('getHistory', async (
    _event: Electron.IpcMainInvokeEvent,
    limit?: number
  ): Promise<any[]> => {
    return service.getHistory(limit);
  });

  // 清空浏览历史
  ipcMain.handle('clearHistory', async (): Promise<void> => {
    service.clearHistory();
  });

  // 获取缓存统计（内存 + 磁盘）
  ipcMain.handle('getCacheStats', async (): Promise<{
    memory: { count: number; sizeMB: number; maxSizeMB: number; utilization: number };
    disk: { thumbsDbSizeMB: number };
  }> => {
    return service.getCacheStats();
  });

  // 获取缓存配置
  ipcMain.handle('getCacheConfig', async (): Promise<{ maxMemoryMB: number }> => {
    return service.getCacheConfig();
  });

  // 设置缓存上限
  ipcMain.handle('setCacheLimit', async (_event, maxMemoryMB: number): Promise<void> => {
    service.setCacheLimit(maxMemoryMB);
  });

  // 清空缓存
  ipcMain.handle('clearCache', async (): Promise<void> => {
    service.clearCache();
  });

  // 读取本地文件（限制在库目录内）
  ipcMain.handle('readFile', async (
    _event: Electron.IpcMainInvokeEvent,
    filePath: string
  ): Promise<Buffer> => {
    const resolvedPath = validateLibraryAccess(filePath);
    const fs = await import('fs');
    return fs.promises.readFile(resolvedPath);
  });

  // 检查文件是否存在（限制在库目录内）
  ipcMain.handle('fileExists', async (
    _event: Electron.IpcMainInvokeEvent,
    filePath: string
  ): Promise<boolean> => {
    try {
      const resolvedPath = validateLibraryAccess(filePath);
      const fs = await import('fs');
      return fs.promises.access(resolvedPath).then(() => true).catch(() => false);
    } catch {
      return false;
    }
  });

  // 加载完整图片文件为 data URL（限制在库目录内）
  ipcMain.handle('loadFullImage', async (
    _event: Electron.IpcMainInvokeEvent,
    filePath: string
  ): Promise<string> => {
    const resolvedPath = validateLibraryAccess(filePath);
    const fs = await import('fs');
    const buffer = await fs.promises.readFile(resolvedPath);
    const mimeType = getMimeTypeFromPath(resolvedPath);
    const base64 = buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  });

  // 获取媒体文件 URL（用于视频/音频流式播放）
  // 返回 media:// 自定义协议 URL，避免全量读取大文件导致 OOM
  ipcMain.handle('getMediaUrl', async (
    _event: Electron.IpcMainInvokeEvent,
    filePath: string
  ): Promise<string> => {
    const resolvedPath = validateLibraryAccess(filePath);
    const fs = await import('fs');
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('File not found');
    }
    // 使用令牌注册表：生成随机 token 并缓存 {token → filePath}，
    // 返回 media://TOKEN URL。浏览器对 authority 小写化不影响 token（纯小写 hex）。
    return registerMediaUrl(resolvedPath);
  });

  // 音频专用 URL 通道：不走 validateLibraryAccess，允许任意路径的音频文件
  // 仅用于幻灯片背景音乐（用户通过文件选择器指定）
  ipcMain.handle('getAudioUrl', async (
    _event: Electron.IpcMainInvokeEvent,
    filePath: string
  ): Promise<string> => {
    const resolvedPath = path.resolve(filePath);
    const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma']);
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) {
      throw new Error(`Access denied: not a supported audio format (${ext})`);
    }
    const fs = await import('fs');
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('File not found');
    }
    return registerMediaUrl(resolvedPath);
  });

  // 更新扫描进度
  ipcMain.handle('updateScanProgress', async (
    _event: Electron.IpcMainInvokeEvent,
    progress: { processedCount: number; totalCount: number; currentFile: string }
  ): Promise<void> => {
    sendToRenderer('scan-progress', progress);
  });

  // 清除扫描进度
  ipcMain.handle('clearScanProgress', async (): Promise<void> => {
    sendToRenderer('scan-progress', {
      isScanning: false,
      processedCount: 0,
      totalCount: 0,
      currentFile: '',
      status: 'complete'
    });
  });

  // ==================== 媒体相关 IPC ====================

  // 获取媒体文件路径
  ipcMain.handle('getMediaPath', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    imageId: number
  ): Promise<string> => {
    return service.getMediaPath(libraryId, imageId);
  });

  // 延迟提取视频元数据
  ipcMain.handle('extractVideoMetadata', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    imageId: number,
    relativePath: string
  ): Promise<{ duration: number; codec: string; width: number; height: number }> => {
    return service.extractVideoMetadata(libraryId, imageId, relativePath);
  });

  // 生成视频缩略图
  ipcMain.handle('generateVideoThumbnail', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    imageId: number,
    relativePath: string
  ): Promise<string> => {
    return service.generateVideoThumbnail(libraryId, imageId, relativePath);
  });

  // 库统计
  ipcMain.handle('getLibraryStats', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number
  ) => {
    try {
      const stats = service.getLibraryStats(libraryId);
      return { success: true, data: stats };
    } catch (err) {
      logger.error('LibraryHandlers', 'getLibraryStats 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // EXIF 信息
  ipcMain.handle('getImageExif', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    relativePath: string
  ) => {
    try {
      const masterDB = getMasterDB();
      const library = masterDB.getLibrary(libraryId);
      if (!library) {
        return { success: false, error: '库不存在' };
      }
      const absPath = path.join(library.rootPath, relativePath);
      // 安全检查：确保路径在库目录内
      const resolved = path.resolve(absPath);
      const libRoot = path.resolve(library.rootPath);
      if (!isPathWithin(libRoot, resolved)) {
        return { success: false, error: 'Access denied' };
      }
      const exif = await readExif(absPath);
      return { success: true, data: exif };
    } catch (err) {
      logger.error('LibraryHandlers', 'getImageExif 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // ==================== 搜索历史与预设 ====================

  // 获取搜索历史
  ipcMain.handle('getSearchHistory', async (): Promise<string[]> => {
    const { getSetting } = await import('../services/settings-service');
    const history = getSetting('search.history');
    return Array.isArray(history) ? history : [];
  });

  // 添加搜索历史
  ipcMain.handle('addSearchHistory', async (
    _event: Electron.IpcMainInvokeEvent,
    query: string
  ): Promise<void> => {
    const { getSetting, setSetting } = await import('../services/settings-service');
    const history = getSetting('search.history');
    const historyList = Array.isArray(history) ? history : [];
    // 去重并保留最近 10 条
    const newHistory = [query, ...historyList.filter(h => h !== query)].slice(0, 10);
    setSetting('search.history', newHistory);
  });

  // 清空搜索历史
  ipcMain.handle('clearSearchHistory', async (): Promise<void> => {
    const { setSetting } = await import('../services/settings-service');
    setSetting('search.history', []);
  });

  // 获取搜索预设
  ipcMain.handle('getSearchPresets', async () => {
    const { getSetting } = await import('../services/settings-service');
    const presets = getSetting('search.presets');
    return Array.isArray(presets) ? presets : [];
  });

  // 保存搜索预设
  ipcMain.handle('saveSearchPreset', async (
    _event: Electron.IpcMainInvokeEvent,
    name: string,
    criteria: any
  ): Promise<{ id: string }> => {
    const { getSetting, setSetting } = await import('../services/settings-service');
    const presets = getSetting('search.presets');
    const presetList = Array.isArray(presets) ? presets : [];
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const newPreset = { id, name, criteria, createdAt: new Date().toISOString() };
    setSetting('search.presets', [...presetList, newPreset]);
    return { id };
  });

  // 删除搜索预设
  ipcMain.handle('deleteSearchPreset', async (
    _event: Electron.IpcMainInvokeEvent,
    id: string
  ): Promise<void> => {
    const { getSetting, setSetting } = await import('../services/settings-service');
    const presets = getSetting('search.presets');
    const presetList = Array.isArray(presets) ? presets : [];
    setSetting('search.presets', presetList.filter(p => p.id !== id));
  });

  // ==================== 文件夹封面 ====================

  // 设置文件夹封面
  ipcMain.handle('setFolderCover', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    folderPath: string,
    coverPath: string
  ) => {
    try {
      service.setFolderCover(libraryId, folderPath, coverPath);
      return { success: true };
    } catch (err) {
      logger.error('LibraryHandlers', 'setFolderCover 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // 移除文件夹封面
  ipcMain.handle('removeFolderCover', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    folderPath: string
  ) => {
    try {
      service.removeFolderCover(libraryId, folderPath);
      return { success: true };
    } catch (err) {
      logger.error('LibraryHandlers', 'removeFolderCover 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // 获取库的所有文件夹封面
  ipcMain.handle('getFolderCovers', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number
  ) => {
    return service.getFolderCovers(libraryId);
  });

  // ==================== 直方图 ====================

  // 计算图片直方图
  ipcMain.handle('getImageHistogram', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    relativePath: string
  ) => {
    try {
      const masterDB = getMasterDB();
      const library = masterDB.getLibrary(libraryId);
      if (!library) {
        return { success: false, error: '库不存在' };
      }
      const absPath = path.join(library.rootPath, relativePath);
      // 安全检查：确保路径在库目录内
      const resolved = path.resolve(absPath);
      const libRoot = path.resolve(library.rootPath);
      if (!isPathWithin(libRoot, resolved)) {
        return { success: false, error: 'Access denied' };
      }
      const { calculateHistogram } = await import('../utils/histogram');
      const histogram = await calculateHistogram(absPath);
      return { success: true, data: histogram };
    } catch (err) {
      logger.error('LibraryHandlers', 'getImageHistogram 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // ==================== 幻灯片 ====================

  // 选择音频文件（用于幻灯片背景音乐）
  ipcMain.handle('selectAudioFile', async (event: Electron.IpcMainInvokeEvent) => {
    try {
      const parent = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0];
      if (!parent || parent.isDestroyed()) {
        return { success: false, error: 'No window available' };
      }
      const result = await dialog.showOpenDialog(parent, {
        title: '选择背景音乐',
        filters: [
          { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'] }
        ],
        properties: ['openFile']
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'User cancelled' };
      }
      return { success: true, data: { path: result.filePaths[0] } };
    } catch (err) {
      logger.error('LibraryHandlers', 'selectAudioFile 失败', err);
      return { success: false, error: (err as Error).message };
    }
  });
}

/**
 * 已注册的 IPC 处理器名称（用于批量注销）
 */
const IPC_HANDLER_NAMES = [
  'initImageService', 'getLibraries', 'addLibrary', 'selectFolder',
  'removeLibrary', 'scanLibrary', 'getFolderTree',
  'getImages', 'getImagesByFolder', 'getImageCount', 'getImageCountByFolder',
  'getImagePath', 'getImagePathByRelativePath', 'getImageByRelativePath',
  'getFavoriteImages', 'getFavoriteImagesCount',
  'addFavoriteFolder', 'removeFavoriteFolder', 'getFavoriteFolders',
  'getFavoriteFolderTree', 'isFavoriteFolder',
  'getFavoriteFolderImages', 'getFavoriteFolderImageCount',
  'getSingleFavoriteImages', 'getSingleFavoriteCount',
  'getThumbnail', 'getThumbnails', 'toggleFavorite', 'getFavorites',
  'setFavoriteRating', 'addHistory', 'getHistory', 'clearHistory',
  'getCacheStats', 'getCacheConfig', 'setCacheLimit', 'clearCache', 'readFile', 'fileExists',
  'loadFullImage', 'getMediaUrl', 'getAudioUrl', 'getMediaPath',
  'extractVideoMetadata', 'generateVideoThumbnail',
  'getLibraryStats', 'getImageExif',
  'updateScanProgress', 'clearScanProgress',
  'getSearchHistory', 'addSearchHistory', 'clearSearchHistory',
  'getSearchPresets', 'saveSearchPreset', 'deleteSearchPreset',
  'setFolderCover', 'removeFolderCover', 'getFolderCovers',
  'getImageHistogram',
  'selectAudioFile',
] as const;

/**
 * 清理 IPC 处理器
 */
export function unregisterLibraryHandlers(): void {
  IPC_HANDLER_NAMES.forEach(name => ipcMain.removeHandler(name));
}
