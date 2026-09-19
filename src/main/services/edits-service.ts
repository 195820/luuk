import * as fs from 'fs'
import * as path from 'path'
import type { Edit } from '../../types/plugin'
import type { MasterDB } from './database'

/**
 * 编辑版本链服务
 * 负责非破坏性编辑的输出管理：写入编辑产物、记录版本链
 */
export class EditsService {
  constructor(private db: MasterDB) {}

  /**
   * 创建一次编辑
   * 1. 计算输出路径
   * 2. 确保目录存在
   * 3. 写入 outputBuffer
   * 4. 记录到 edits 表
   */
  async createEdit(
    libraryId: number,
    imageId: number,
    sourcePath: string,
    pluginId: string,
    op: string,
    outputBuffer: Buffer,
    options?: {
      params?: Record<string, unknown>
      modelId?: string
      parentEditId?: number
      format?: 'png' | 'jpeg' | 'webp'
    }
  ): Promise<number> {
    const format = options?.format ?? 'png'
    const outputPath = this.getOutputPath(sourcePath, op, format)

    // 二次校验（P1-4）：输出路径必须落在该库根目录内。
    // 即使 sourcePath 已被上游守卫，仍以 libraryId 反查的权威 rootPath 为准，
    // 忽略插件传入目录，防 sourcePath/libraryId 被构造成越权写入。
    const lib = this.db.getLibrary(libraryId)
    if (!lib) {
      throw new Error(`库不存在，无法写入编辑: ${libraryId}`)
    }
    const root = path.resolve(lib.rootPath).toLowerCase()
    const outResolved = path.resolve(outputPath).toLowerCase()
    if (outResolved !== root && !outResolved.startsWith(root + path.sep.toLowerCase())) {
      throw new Error(`编辑输出越权：${outputPath} 不在库根 ${lib.rootPath} 内`)
    }

    // 确保输出目录存在
    const outputDir = path.dirname(outputPath)
    fs.mkdirSync(outputDir, { recursive: true })

    // 写入编辑产物
    await fs.promises.writeFile(outputPath, outputBuffer)

    // 序列化 params 为 JSON 字符串
    const paramsJson = options?.params
      ? JSON.stringify(options.params)
      : null

    // 记录到 edits 表
    const editId = this.db.createEdit({
      libraryId,
      imageId,
      pluginId,
      op,
      params: paramsJson,
      modelId: options?.modelId ?? null,
      outputPath,
      parentEditId: options?.parentEditId ?? null,
    })

    return editId
  }

  /**
   * 获取某张图片的编辑历史（按时间升序）
   */
  getEditHistory(libraryId: number, imageId: number): Edit[] {
    return this.db.getEditsForImage(libraryId, imageId)
  }

  /**
   * 计算编辑产物输出路径
   * 规则: {原图目录}/_edits/{原文件名}/{op}_{timestamp}.{format}
   */
  getOutputPath(sourcePath: string, op: string, format?: string): string {
    const ext = format ?? 'png'
    const dir = path.dirname(sourcePath)
    const baseName = path.basename(sourcePath, path.extname(sourcePath))
    const timestamp = Date.now()
    return path.join(dir, '_edits', baseName, `${op}_${timestamp}.${ext}`)
  }
}
