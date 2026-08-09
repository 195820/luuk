import { useEffect } from 'react'

// 调试日志 Hook - 将日志写入到临时文件
export function useDebugLog(message: string, deps?: any[]) {
  useEffect(() => {
    // @ts-ignore
    if (window.electronAPI?.logToFile) {
      // @ts-ignore
      window.electronAPI.logToFile(message)
    } else if (import.meta.env.DEV) {
      // 仅开发模式输出到 console，避免生产环境泄漏调试信息
      console.debug('[DEBUG]', message)
    }
  }, deps)
}
