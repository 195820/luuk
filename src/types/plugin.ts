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
  /** 宿主在聚合菜单项时注入的来源插件 id（插件清单中不声明） */
  pluginId?: string
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
  kind?: string                // 作业类型（供 UI 展示标签）
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
  url?: string                 // 下载 URL（来自 plugin.json requires.models[].url）
  mirrorUrls?: string[]        // 镜像下载列表
}

// ── 推理会话 ──

export interface InferenceSessionInfo {
  modelId: string
  refCount: number
  lastUsedAt: string
  residentMB: number
}

/** createSession 返回：模型真实的输入/输出张量名（供插件按名构造 feeds） */
export interface CreateSessionResult {
  modelId: string
  modelPath: string
  created: boolean
  inputNames: string[]
  outputNames: string[]
}

// ── Worker RPC 协议（双向） ──

/** RPC 错误码 */
export type RpcErrorCode =
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_FOUND'
  | 'EXECUTION_ERROR'
  | 'MEMORY_PRESSURE'
  | 'NOT_IMPLEMENTED'

/** RPC 错误负载 */
export interface RpcError {
  code: RpcErrorCode | string
  message: string
}

/** 主进程 → Worker 的请求 */
export interface MainToWorkerRequest {
  type: 'rpc-request'
  channel: 'main-to-worker'
  id: number              // 主进程侧递增
  method: string          // 'plugin.load' | 'plugin.unload' | 'plugin.execute' | 'memory.getStatus' | 'memory.evict' ...(推理在 Worker 内执行，不经此 RPC)
  params?: unknown
}

/** Worker → 主进程的 SDK 调用（反向 RPC） */
export interface WorkerToMainRequest {
  type: 'sdk-request'
  channel: 'worker-to-main'
  id: number              // Worker 侧独立递增
  method: string          // 'sdk.library.query' | 'sdk.fs.read' | 'sdk.jobs.enqueue' ...
  pluginId: string
  params: unknown
}

/** 通用响应（双向共用；channel 标记回包目标命名空间） */
export interface RpcResponse {
  type: 'rpc-response'
  channel: 'main-to-worker' | 'worker-to-main'
  id: number
  result?: unknown
  error?: RpcError
}

/** Worker 收到的消息（主进程请求 / 主进程对 sdk-request 的回包） */
export type WorkerIncoming = MainToWorkerRequest | RpcResponse
/** 主进程收到的消息（Worker 反向 SDK 调用 / Worker 对 rpc-request 的回包） */
export type MainIncoming = WorkerToMainRequest | RpcResponse

/**
 * @deprecated 保留旧单向类型别名以兼容既有引用，新代码使用 MainToWorkerRequest。
 * [P2-16] 移除此前列出的 `inference.createSession` / `inference.run` / `inference.destroySession` 示例：
 * 推理已在 Worker 内经 InferencePool 执行（D2），不再是 main→worker 的 RPC 方法，保留会误导契约。
 */
export type WorkerRpcRequest =
  | { id: number; method: 'plugin.load'; params: { pluginId: string; entryPath: string } }
  | { id: number; method: 'plugin.unload'; params: { pluginId: string } }
  | { id: number; method: 'plugin.execute'; params: { pluginId: string; opId: string; input: unknown } }
  | { id: number; method: 'memory.getStatus' }
  | { id: number; method: 'memory.getStats' }

export type WorkerRpcResponse = RpcResponse

// ── 张量序列化 ──

/** 序列化后的张量描述（经 MessagePort structuredClone 传输，不经 JSON） */
export interface SerializedTensor {
  dataType: 'float32' | 'int64' | 'uint8' | 'int32' | 'float64'
  dims: number[]
  data: ArrayBuffer | Uint8Array
}

/** 序列化后的推理输入/输出映射 */
export type SerializedTensorMap = Record<string, SerializedTensor>

// ── luuk.* 插件 SDK 契约 ──

/**
 * 暴露给插件的 luuk.* API 命名空间。
 * Worker 侧由各方法路由到 callMain（跨进程 SDK 调用）或本地实现（image.*）。
 */
export interface LuukSdk {
  library: {
    query(opts: unknown): Promise<unknown>
    writeEmbedding(opts: unknown): Promise<unknown>
  }
  fs: {
    read(path: string): Promise<Uint8Array>
    write(path: string, data: Uint8Array): Promise<void>
  }
  inference: {
    createSession(modelId: string, modelPath: string, opts?: unknown): Promise<CreateSessionResult>
    run(modelId: string, feeds: SerializedTensorMap, opts?: { priority?: 'interactive' | 'batch' }): Promise<SerializedTensorMap>
    destroySession(modelId: string): Promise<void>
  }
  image: {
    decode(buf: Uint8Array): Promise<{ width: number; height: number; channels: number; data: Uint8Array }>
    encode(data: Uint8Array, opts: { width: number; height: number; channels: number; format?: string; quality?: number }): Promise<Uint8Array>
    normalize(buf: Uint8Array, size: { width: number; height: number }): Promise<SerializedTensor>
  }
  jobs: {
    enqueue(kind: string, payload: unknown, opts?: unknown): Promise<string>
  }
  edit: {
    write(params: {
      sourcePath: string
      op: string
      outputBuffer: Uint8Array
      libraryId?: number
      imageId?: number
      modelId?: string
      params?: Record<string, unknown>
      parentEditId?: number
      format?: 'png' | 'jpeg' | 'webp'
    }): Promise<number>
  }
  progress: {
    report(pct: number, message?: string): Promise<void>
  }
  log: {
    info(msg: string): Promise<void>
    warn(msg: string): Promise<void>
    error(msg: string): Promise<void>
  }
  settings: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
  }
  // Phase 8 占位：调用即抛 NotImplemented
  browser: { navigate(url: string): Promise<unknown> }
  fetch: { request(url: string, opts?: unknown): Promise<unknown> }
  mask: { request(opts: unknown): Promise<unknown> }
}

/** 插件实例（activate 返回值） */
export interface PluginInstance {
  executeOp?(sdk: LuukSdk, opId: string, input: unknown): Promise<unknown>
  isAvailable?(): boolean
  deactivate?(): void | Promise<void>
}
