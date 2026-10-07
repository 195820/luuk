/**
 * Phase 9 M5 · T21 — AI 层装配（纯 DI，仿 crawler-bootstrap.ts）。
 *
 * 默认全关：ai.enabled=false 时零引擎、零 onnxruntime、零模型、零网络。
 * 幂等：改 flag 后重调 ensureAiLayer 即可开/关；生产接线（真 ort 引擎 + JobRunner + scanner→markDirty
 * + 真实图片路径解析器）在紧随切片接入本层。engineFactory 可注入 FakeEngine 供零模型单测。
 */
import { getSetting } from '../settings-service'
import { logger } from '../../../utils/logger'
import type { VectorsDB } from '../database'
import type { VectorIndexService } from '../vectors/vector-index-service'
import type { EmbeddingEngine } from './embedding-engine'
import type { IndexDeps } from './index-session'

const LOG_KEY = 'AiBootstrap'

/** 默认模型（CLIP ViT-B/32 int8；512 维） */
const DEFAULT_MODEL_ID = 'clip-vit-b32-int8'
const DEFAULT_DIM = 512

export interface AiLayerDeps {
  /** flag 读取注入（单测脱离 electron-store）；缺省读 getSetting('ai.enabled') */
  isEnabled?: () => boolean
  /** 引擎工厂：单测注入 FakeEngine；生产注入真 ort 引擎。缺省无引擎（装配但不可索引） */
  engineFactory?: () => EmbeddingEngine
  /** 库 → VectorsDB / VectorIndexService 解析器（生产用 getVectorsDB/getVectorIndexService） */
  getVectorsDB?: (libraryPath: string) => VectorsDB
  getAnn?: (libraryPath: string, dim: number) => VectorIndexService
  /** (库路径, imageId) → 绝对路径（生产沿 images.relative_path + libraries.root_path） */
  resolvePath?: (libraryPath: string, imageId: number) => string | null
  modelId?: string
  dim?: number
}

export interface AiLayer {
  enabled: boolean
  modelId: string
  dim: number
  engine: EmbeddingEngine | null
  /** 绑定某库构造一次索引会话依赖；引擎或解析器未就绪返回 null（拒绝空跑） */
  buildSessionDeps: (libraryPath: string) => IndexDeps | null
  /** 关闭层：尽力释放引擎会话（flag 翻 false / 退出清理时调用） */
  disable: () => void
}

let layer: AiLayer | null = null

/** flag 关闭 → 拆除既有层并返回 null；开启 → 幂等装配 */
export function ensureAiLayer(deps: AiLayerDeps): AiLayer | null {
  const enabled = deps.isEnabled?.() ?? getSetting('ai.enabled')
  if (!enabled) {
    layer?.disable()
    layer = null
    return null
  }

  const engine = deps.engineFactory?.() ?? null
  const modelId = deps.modelId ?? engine?.modelId ?? DEFAULT_MODEL_ID
  const dim = deps.dim ?? engine?.dim ?? DEFAULT_DIM

  layer = {
    enabled: true,
    modelId,
    dim,
    engine,
    buildSessionDeps: (libraryPath: string): IndexDeps | null => {
      if (!engine || !deps.getVectorsDB || !deps.getAnn || !deps.resolvePath) return null
      return {
        vectorsDB: deps.getVectorsDB(libraryPath),
        engine,
        ann: deps.getAnn(libraryPath, dim),
        resolvePath: (imageId: number) => deps.resolvePath!(libraryPath, imageId),
      }
    },
    disable: () => {
      try {
        if (engine?.isLoaded()) void engine.unload()
      } catch (err) {
        logger.warn(LOG_KEY, '引擎卸载异常（忽略）', err)
      }
    },
  }
  logger.info(LOG_KEY, `AI 层已装配（flag=ai.enabled, model=${modelId}, dim=${dim}, engine=${engine ? '注入' : '无'}）`)
  return layer
}

/** 供 IPC/作业装配取当前层；未装配为 null */
export function getAiLayer(): AiLayer | null {
  return layer
}

/** 测试复位（不触发 disable） */
export function resetAiLayer(): void {
  layer = null
}
