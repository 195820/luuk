import { ipcMain, BrowserWindow } from 'electron'
import { getJobRunner } from '../services/job-runner'
import { getMasterDB } from '../services/database'
import { logger } from '../../utils/logger'
import type { JobProgress } from '../../types'

/** 进度订阅清理函数 */
let progressUnsubscribe: (() => void) | null = null

/** 注册 JobRunner IPC 处理器 */
export function registerJobHandlers(): void {
  // 创建并入队新作业
  ipcMain.handle(
    'jobs:enqueue',
    async (
      _event,
      kind: string,
      payload: unknown,
      options?: { priority?: number; items?: Array<{ libraryId: number; imageId: number | null }> },
    ) => {
      try {
        const runner = getJobRunner()
        const jobId = await runner.enqueue(kind, payload, options)

        // 资源闸门：空闲时自动启动；非空闲时等队列消化（并发上限由 JobRunner 统一持有，P1-9）
        if (runner.getRunningCount() < runner.getMaxConcurrent()) {
          await runner.start(jobId)
        }

        return { success: true, data: jobId }
      } catch (err) {
        logger.error('JobHandlers', 'jobs:enqueue 失败', err)
        return { success: false, error: (err as Error).message }
      }
    },
  )

  // 获取所有作业列表
  ipcMain.handle('jobs:list', async () => {
    try {
      const db = getMasterDB()
      const jobs = db.getAllJobs()
      return { success: true, data: jobs }
    } catch (err) {
      logger.error('JobHandlers', 'jobs:list 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 获取作业详情（含 items）
  ipcMain.handle('jobs:get', async (_event, jobId: string) => {
    try {
      const db = getMasterDB()
      const job = db.getJob(jobId)
      if (!job) {
        return { success: false, error: `作业不存在: ${jobId}` }
      }
      const items = db.getJobItems(jobId)
      return { success: true, data: { ...job, items } }
    } catch (err) {
      logger.error('JobHandlers', 'jobs:get 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 暂停作业
  ipcMain.handle('jobs:pause', async (_event, jobId: string) => {
    try {
      const runner = getJobRunner()
      await runner.pause(jobId)
      return { success: true }
    } catch (err) {
      logger.error('JobHandlers', 'jobs:pause 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 继续作业
  ipcMain.handle('jobs:resume', async (_event, jobId: string) => {
    try {
      const runner = getJobRunner()
      await runner.resume(jobId)
      return { success: true }
    } catch (err) {
      logger.error('JobHandlers', 'jobs:resume 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 取消作业
  ipcMain.handle('jobs:cancel', async (_event, jobId: string) => {
    try {
      const runner = getJobRunner()
      await runner.cancel(jobId)
      return { success: true }
    } catch (err) {
      logger.error('JobHandlers', 'jobs:cancel 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 订阅进度事件（建立转发通道）
  ipcMain.handle('jobs:subscribeProgress', async () => {
    try {
      // 先清理旧的订阅
      if (progressUnsubscribe) {
        progressUnsubscribe()
      }

      const runner = getJobRunner()
      progressUnsubscribe = runner.subscribeProgress((progress: JobProgress) => {
        const windows = BrowserWindow.getAllWindows()
        if (windows.length > 0) {
          windows[0].webContents.send('job-progress', progress)
        }
      })

      return { success: true }
    } catch (err) {
      logger.error('JobHandlers', 'jobs:subscribeProgress 失败', err)
      return { success: false, error: (err as Error).message }
    }
  })

  logger.info('JobHandlers', 'JobRunner IPC 处理器已注册')
}

/** 注销 JobRunner IPC 处理器 */
export function unregisterJobHandlers(): void {
  const channels = ['jobs:enqueue', 'jobs:list', 'jobs:get', 'jobs:pause', 'jobs:resume', 'jobs:cancel', 'jobs:subscribeProgress']
  for (const channel of channels) {
    ipcMain.removeHandler(channel)
  }
  // 清理进度订阅
  if (progressUnsubscribe) {
    progressUnsubscribe()
    progressUnsubscribe = null
  }
}
