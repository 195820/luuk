import { useEffect } from 'react'

// 调试日志 Hook - 将日志写入到临时文件
export function useDebugLog(message: string, deps?: any[]) {
  useEffect(() => {
    // @ts-ignore
    if (window.electronAPI?.logToFile) {
      // @ts-ignore
      window.electronAPI.logToFile(message)
    } else {
      console.log('[DEBUG]', message)
    }
  }, deps)
}
