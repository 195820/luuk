/** 插件种类（封闭集合） */
export type PluginKind =
  | 'ai-index'           // 只读分析 → 写元数据
  | 'ai-transform'       // 读图 → 生成新文件
  | 'diffusion-provider' // 扩散生成后端
  | 'crawler-adapter'    // 站点解析适配
  | 'ui-panel'           // 声明式 UI 贡献

/** 插件权限 */
export type PluginPermission =
  | 'library.read'
  | 'library.write'
  | 'fs.read.library'
  | 'fs.write.output'
  | 'inference'
  | 'image'
  | 'jobs'
  | 'edit.write'
  | 'browser'
  | 'fetch'
  | 'mask'

/** 插件清单 plugin.json */
export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: string           // semver，与宿主协商
  kind: PluginKind
  entry: string                // 入口 JS 文件名
  capabilities: string[]       // 声明的能力列表
  requires?: {
    runtime?: 'onnx' | 'none'
    gpu?: boolean              // true 则无独显时 isAvailable() = false
    models?: ModelRequirement[]
  }
  contributes?: {
    ops?: OpDefinition[]
    menuItems?: MenuItemDefinition[]
    settings?: SettingDefinition[]
    panels?: PanelDefinition[]
  }
  permissions?: PluginPermission[]
}

/** 模型需求 */
export interface ModelRequirement {
  id: string
  url?: string
  mirrorUrls?: string[]
  size: number                 // 字节
  sha256: string
}

/** Op 定义 */
export interface OpDefinition {
  id: string
  capability: string
  label?: string
  params?: Record<string, unknown>  // JSON Schema
}

/** 右键菜单项定义 */
export interface MenuItemDefinition {
  op: string
  label: string
  context: ('grid-multi' | 'grid-single' | 'folder' | 'viewer')[]
}

/** 设置项定义 */
export interface SettingDefinition {
  key: string
  label: string
  type: 'boolean' | 'number' | 'string' | 'select'
  default?: unknown
  options?: { label: string; value: string }[]  // select 类型专用
}

/** 面板定义 */
export interface PanelDefinition {
  id: string
  title: string
  position: 'sidebar' | 'detail'
}

/** 插件状态 */
export type PluginState = 'discovered' | 'valid' | 'invalid' | 'activated' | 'idle' | 'deactivated' | 'crashed'

/** 插件实例信息 */
export interface PluginInfo {
  manifest: PluginManifest
  state: PluginState
  path: string                  // 插件目录绝对路径
  isBuiltin: boolean
  error?: string               // invalid 时的错误信息
}

// ── JobRunner 类型 ──

/** 作业状态 */
export type JobState = 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

/** 作业项状态 */
export type JobItemState = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

/** 作业记录 */
export interface Job {
  id: string
  kind: string                 // 'ai.clip-index' | 'ai.upscale' | 'crawler.download' ...
  state: JobState
  priority: number
  total: number
  done: number
  failed: number
  payload: string              // JSON
  createdAt: string
  updatedAt: string
}

/** 作业项记录 */
export interface JobItem {
  id: number
  jobId: string
  libraryId: number
  imageId: number | null
  state: JobItemState
  attempt: number
  error: string | null
  updatedAt: string
}

/** 作业进度 */
export interface JobProgress {
  jobId: string
  state: JobState
  total: number
  done: number
  failed: number
  currentFile?: string
  eta?: number                 // 秒
  rate?: number                // 项/秒
}

// ── 编辑版本链 ──

/** 编辑记录 */
export interface Edit {
  id: number
  libraryId: number
  imageId: number
  pluginId: string
  op: string
  params: string | null        // JSON
  modelId: string | null
  outputPath: string
  parentEditId: number | null
  createdAt: string
}

// ── 内存水位线 ──

export type MemoryLevel = 'green' | 'yellow' | 'red'

export interface MemoryStatus {
  level: MemoryLevel
  rssMB: number
  threshold: {
    yellow: number
    red: number
  }
}

// ── 模型管理 ──

export type ModelDownloadState = 'not-downloaded' | 'downloading' | 'downloaded' | 'failed'

export interface ModelInfo {
  id: string
  name: string
  size: number
  sha256: string
  state: ModelDownloadState
  progress?: number            // 0-100
  localPath?: string
}

// ── 推理会话 ──

export interface InferenceSessionInfo {
  modelId: string
  refCount: number
  lastUsedAt: string
  residentMB: number
}

// ── Worker RPC 协议 ──

export type WorkerRpcRequest =
  | { id: number; method: 'plugin.load'; params: { pluginId: string; entryPath: string } }
  | { id: number; method: 'plugin.unload'; params: { pluginId: string } }
  | { id: number; method: 'plugin.execute'; params: { pluginId: string; opId: string; input: unknown } }
  | { id: number; method: 'inference.createSession'; params: { modelId: string; modelPath: string } }
  | { id: number; method: 'inference.run'; params: { modelId: string; feeds: Record<string, unknown> } }
  | { id: number; method: 'inference.destroySession'; params: { modelId: string } }
  | { id: number; method: 'memory.getStatus' }
  | { id: number; method: 'memory.getStats' }

export type WorkerRpcResponse = {
  id: number
  result?: unknown
  error?: { code: string; message: string }
}
