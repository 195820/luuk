import { BrowserWindow } from 'electron';

/**
 * 向渲染进程发送事件
 * 安全获取主窗口并发送 IPC 事件，无窗口时静默忽略
 */
export function sendToRenderer(channel: string, data?: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    windows[0].webContents.send(channel, data);
  }
}
