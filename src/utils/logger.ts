/**
 * 统一日志工具
 *
 * - 开发模式：info/warn/error 均输出到 console
 * - 生产模式：仅输出 warn/error，info 静默
 * - 所有输出自动添加模块前缀，便于定位来源
 */

const PREFIX = '[ImageViewer]'

function isDev(): boolean {
  return import.meta.env.DEV === true
}

export const logger = {
  info(module: string, message: string, ...data: unknown[]): void {
    if (!isDev()) return
    console.info(`${PREFIX}[${module}]`, message, ...data)
  },

  warn(module: string, message: string, ...data: unknown[]): void {
    console.warn(`${PREFIX}[${module}]`, message, ...data)
  },

  error(module: string, message: string, ...data: unknown[]): void {
    console.error(`${PREFIX}[${module}]`, message, ...data)
  },
}
