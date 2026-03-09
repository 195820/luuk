import { ipcMain, dialog, BrowserWindow } from 'electron';
import { getImageService } from '../services/image-service';
import type { ThumbnailSize, ImageQueryOptions, ScanResult, Library, Favorite } from '../../types';

/**
 * 注册库管理相关的 IPC 处理器
 */
export function registerLibraryHandlers(): void {
  const service = getImageService();

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
    
    // 如果需要等待扫描完成，在这里等待
    if (autoScan !== false) {
      // 返回库信息，前端可以轮询或通过事件监听扫描完成
      // 这里我们通过发送事件通知前端扫描开始
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.send('library-scan-started', { libraryId: library.id });
      }
    }
    
    return library;
  });

  // 选择文件夹对话框
  ipcMain.handle('selectFolder', async (): Promise<string | null> => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
      return null;
    }
    try {
      const result = await dialog.showOpenDialog(windows[0], {
        properties: ['openDirectory']
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    } catch (error) {
      throw error
    }
  });

  // 删除库
  ipcMain.handle('removeLibrary', async (
    _event: Electron.IpcMainInvokeEvent,
    id: number
  ): Promise<void> => {
    return service.removeLibrary(id);
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

  // 获取缩略图
  ipcMain.handle('getThumbnail', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    imageId: number,
    size: ThumbnailSize = 'medium'
  ): Promise<string> => {
    return service.getThumbnail(libraryId, imageId, size);
  });

  // 批量获取缩略图
  ipcMain.handle('getThumbnails', async (
    _event: Electron.IpcMainInvokeEvent,
    libraryId: number,
    imageIds: number[],
    size: ThumbnailSize = 'medium'
  ): Promise<Map<number, string>> => {
    return service.getThumbnails(libraryId, imageIds, size);
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

  // 获取缓存统计
  ipcMain.handle('getCacheStats', async (): Promise<{ count: number; sizeMB: number; utilization: number }> => {
    return service.getCacheStats();
  });

  // 清空缓存
  ipcMain.handle('clearCache', async (): Promise<void> => {
    service.clearCache();
  });

  // 读取本地文件
  ipcMain.handle('readFile', async (
    _event: Electron.IpcMainInvokeEvent,
    filePath: string
  ): Promise<Buffer> => {
    const fs = await import('fs');
    return fs.promises.readFile(filePath);
  });

  // 检查文件是否存在
  ipcMain.handle('fileExists', async (
    _event: Electron.IpcMainInvokeEvent,
    filePath: string
  ): Promise<boolean> => {
    const fs = await import('fs');
    return fs.promises.access(filePath).then(() => true).catch(() => false);
  });

  // 更新扫描进度
  ipcMain.handle('updateScanProgress', async (
    _event: Electron.IpcMainInvokeEvent,
    progress: { processedCount: number; totalCount: number; currentFile: string }
  ): Promise<void> => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].webContents.send('scan-progress', progress);
    }
  });

  // 清除扫描进度
  ipcMain.handle('clearScanProgress', async (): Promise<void> => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].webContents.send('scan-progress', {
        isScanning: false,
        processedCount: 0,
        totalCount: 0,
        currentFile: '',
        status: 'complete'
      });
    }
  });
}

/**
 * 清理 IPC 处理器
 */
export function unregisterLibraryHandlers(): void {
  ipcMain.removeHandler('initImageService');
  ipcMain.removeHandler('getLibraries');
  ipcMain.removeHandler('addLibrary');
  ipcMain.removeHandler('selectFolder');
  ipcMain.removeHandler('removeLibrary');
  ipcMain.removeHandler('scanLibrary');
  ipcMain.removeHandler('getFolderTree');
  ipcMain.removeHandler('getImages');
  ipcMain.removeHandler('getImagesByFolder');
  ipcMain.removeHandler('getImageCount');
  ipcMain.removeHandler('getImageCountByFolder');
  ipcMain.removeHandler('getImagePath');
  ipcMain.removeHandler('getThumbnail');
  ipcMain.removeHandler('getThumbnails');
  ipcMain.removeHandler('toggleFavorite');
  ipcMain.removeHandler('getFavorites');
  ipcMain.removeHandler('getCacheStats');
  ipcMain.removeHandler('clearCache');
  ipcMain.removeHandler('readFile');
  ipcMain.removeHandler('fileExists');
  ipcMain.removeHandler('updateScanProgress');
  ipcMain.removeHandler('clearScanProgress');
  ipcMain.removeHandler('getFavoriteImages');
  ipcMain.removeHandler('getFavoriteImagesCount');
  ipcMain.removeHandler('getImagePathByRelativePath');
  ipcMain.removeHandler('getImageByRelativePath');
}
