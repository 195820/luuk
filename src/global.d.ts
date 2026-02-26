// 全局类型声明
import type { ElectronAPI } from './types'

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
