// 全局类型声明
import type { ElectronAPI } from './types'

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }

  // CSS Modules
  declare module '*.module.css' {
    const classes: Record<string, string>
    export default classes
  }
}

export {}
