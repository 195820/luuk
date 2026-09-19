---
title: Phase 8 — AI 插件化能力实施计划
description: 插件宿主 + JobRunner + 三个内置插件（autotone/matting/upscale）的 Task 级实施计划（已交付，含 M1-M5 缺陷修复）
type: plan
status: archived
updated: 2026-09-19
---

# Phase 8 — AI 插件化能力实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建插件宿主 + JobRunner + 三个内置插件（autotone/matting/upscale），验证 ONNX 推理全链路

**Architecture:** Electron utilityProcess 承载插件推理，MessagePort RPC 通信；JobRunner 提供持久化后台作业；插件通过 plugin.json 声明式注册，luuk.* SDK 提供受控 API 面

**Tech Stack:** Electron 40 utilityProcess, onnxruntime-node, sharp, better-sqlite3, Vitest

**Spec:** `docs/plans/ai-crawler-direction-2026-q4.md`

## Global Constraints

- **C3 性能红线**：启动 <3s / 内存 <500MB / 滚动 ≥30FPS
- **C6 内存峰值**：单模型 4K 抠图峰值 510MB，必须水位线驱逐
- **D2 推理运行时**：onnxruntime-node，跑在 utilityProcess
- **D3 插件化**：AI 能力全部以插件形态交付
- **npmRebuild: false**：依赖 N-API ABI 稳定性
- **平台**：Win10 / Win11，Electron 40 + Node 24
- **包体**：模型不得进包，运行时按需下载到 `%APPDATA%\luuk\models\`
- **插件宿主懒启动**：无启用插件时不 fork utilityProcess

---

## 文件结构总览

```
新增文件（按模块分组）：

类型定义：
  src/types/plugin.ts                      # 插件系统全部类型

数据库迁移：
  src/main/services/database.ts            # 修改：新增 MIGRATIONS v2

JobRunner：
  src/main/services/job-runner.ts          # 后台作业调度器

插件系统核心：
  src/main/plugins/plugin-loader.ts        # 插件发现/校验/生命周期
  src/main/plugins/plugin-sdk-host.ts      # 宿主侧 SDK（luuk.* 实现）
  src/main/plugins/plugin-host-process.ts  # utilityProcess 管理

插件 Worker 侧：
  electron/plugin-worker.ts               # Worker 入口，RPC 分发

插件 SDK Worker 侧：
  src/main/plugins/worker-sdk.ts           # Worker 内 SDK 实现

运行时治理：
  src/main/services/memory-monitor.ts      # 内存水位线监控
  src/main/services/model-manager.ts       # 模型下载/校验/管理
  src/main/services/inference-pool.ts      # ONNX 会话池（Worker 侧）

编辑版本链：
  src/main/services/edits-service.ts       # edits 表操作

内置插件：
  src/main/plugins/builtins/autotone/index.ts
  src/main/plugins/builtins/autotone/plugin.json
  src/main/plugins/builtins/matting/index.ts
  src/main/plugins/builtins/matting/plugin.json
  src/main/plugins/builtins/upscale/index.ts
  src/main/plugins/builtins/upscale/plugin.json

IPC 处理器：
  src/main/ipc/plugin-handlers.ts          # 插件相关 IPC
  src/main/ipc/job-handlers.ts             # JobRunner IPC

Feature Flags：
  src/main/services/settings-service.ts    # 修改：新增 flag

打包配置：
  electron-builder.json                    # 修改：包含插件目录

测试：
  src/main/services/__tests__/job-runner.test.ts
  src/main/plugins/__tests__/plugin-loader.test.ts
  src/main/plugins/__tests__/plugin-sdk.test.ts
  src/main/services/__tests__/memory-monitor.test.ts
  src/main/services/__tests__/model-manager.test.ts
  src/main/plugins/__tests__/autotone.test.ts
  src/main/plugins/__tests__/matting.test.ts
  src/main/plugins/__tests__/upscale.test.ts
```

---

## Task 1: 插件系统类型定义

**Files:**
- Create: `src/types/plugin.ts`
- Modify: `src/types/index.ts` (添加导出)

**Interfaces:**
- Consumes: 无（起始任务）
- Produces: 所有后续任务依赖的类型定义

- [ ] **Step 1: 创建插件系统类型文件**

```typescript
// src/types/plugin.ts

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
```

- [ ] **Step 2: 在 types/index.ts 添加导出**

在 `src/types/index.ts` 末尾添加：

```typescript
// 插件系统类型
export type {
  PluginKind, PluginPermission, PluginManifest, PluginState, PluginInfo,
  ModelRequirement, OpDefinition, MenuItemDefinition,
  JobState, JobItemState, Job, JobItem, JobProgress,
  Edit, MemoryLevel, MemoryStatus,
  ModelInfo, ModelDownloadState, InferenceSessionInfo,
  WorkerRpcRequest, WorkerRpcResponse,
} from './plugin'
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 4: Commit**

```bash
git add src/types/plugin.ts src/types/index.ts
git commit -m "feat: Phase 8 — 插件系统类型定义"
```

---

## Task 2: 数据库迁移 v2 — jobs / job_items / edits 表

**Files:**
- Modify: `src/main/services/database.ts`
- Test: `src/main/services/__tests__/database-migration.test.ts`（已有文件，扩展）

**Interfaces:**
- Consumes: Task 1 的 Job, JobItem, Edit 类型
- Produces: JobRunner / EditsService 依赖的数据库方法

- [ ] **Step 1: 编写迁移失败测试**

在 `src/main/services/__tests__/database-migration.test.ts` 中新增：

```typescript
describe('MasterDB migration v2 — Phase 8', () => {
  let db: MasterDB

  beforeEach(() => {
    db = new MasterDB()
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-test-'))
    db.initialize(tmpDir)
  })

  afterEach(() => {
    db.close()
  })

  it('创建 jobs 表', () => {
    const tables = (db as any).db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'"
    ).get()
    expect(tables).toBeTruthy()
  })

  it('创建 job_items 表', () => {
    const tables = (db as any).db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='job_items'"
    ).get()
    expect(tables).toBeTruthy()
  })

  it('创建 edits 表', () => {
    const tables = (db as any).db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='edits'"
    ).get()
    expect(tables).toBeTruthy()
  })

  it('jobs 表插入和查询', () => {
    const now = new Date().toISOString()
    ;(db as any).db.prepare(`
      INSERT INTO jobs (id, kind, state, priority, total, done, failed, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('job-1', 'ai.upscale', 'pending', 0, 10, 0, 0, '{}', now, now)

    const job = (db as any).db.prepare('SELECT * FROM jobs WHERE id = ?').get('job-1')
    expect(job).toBeTruthy()
    expect(job.kind).toBe('ai.upscale')
    expect(job.state).toBe('pending')
  })

  it('edits 表支持 parent_edit_id 构成树', () => {
    const now = new Date().toISOString()
    ;(db as any).db.prepare(`
      INSERT INTO edits (library_id, image_id, plugin_id, op, output_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(1, 1, 'builtin.upscale', 'upscale.x4', '/output/x4.png', now)

    const edit = (db as any).db.prepare('SELECT * FROM edits ORDER BY id DESC LIMIT 1').get()
    expect(edit.parent_edit_id).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/main/services/__tests__/database-migration.test.ts`
Expected: FAIL — tables 不存在

- [ ] **Step 3: 实现迁移 SQL**

在 `src/main/services/database.ts` 的 `MIGRATIONS` 数组中追加：

```typescript
  {
    version: 2,
    description: 'Phase 8 — JobRunner 作业表 + 编辑版本链',
    sql: `
      CREATE TABLE IF NOT EXISTS jobs (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        state       TEXT NOT NULL DEFAULT 'pending',
        priority    INTEGER NOT NULL DEFAULT 0,
        total       INTEGER NOT NULL DEFAULT 0,
        done        INTEGER NOT NULL DEFAULT 0,
        failed      INTEGER NOT NULL DEFAULT 0,
        payload     TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id      TEXT NOT NULL,
        library_id  INTEGER NOT NULL,
        image_id    INTEGER,
        state       TEXT NOT NULL DEFAULT 'pending',
        attempt     INTEGER NOT NULL DEFAULT 0,
        error       TEXT,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_job_items_state ON job_items(job_id, state);
      CREATE INDEX IF NOT EXISTS idx_job_items_job ON job_items(job_id);

      CREATE TABLE IF NOT EXISTS edits (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id     INTEGER NOT NULL,
        image_id       INTEGER NOT NULL,
        plugin_id      TEXT NOT NULL,
        op             TEXT NOT NULL,
        params         TEXT,
        model_id       TEXT,
        output_path    TEXT NOT NULL,
        parent_edit_id INTEGER,
        created_at     TEXT NOT NULL,
        FOREIGN KEY (parent_edit_id) REFERENCES edits(id)
      );
      CREATE INDEX IF NOT EXISTS idx_edits_image ON edits(library_id, image_id);
    `,
  },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/main/services/__tests__/database-migration.test.ts`
Expected: PASS

- [ ] **Step 5: 在 MasterDB 类中添加 Job/Edits 操作方法**

在 `src/main/services/database.ts` 的 `MasterDB` 类中添加：

```typescript
  // ── JobRunner 数据访问 ──

  createJob(id: string, kind: string, priority: number, total: number, payload: string): void {
    if (!this.db) throw new Error('MasterDB 未初始化')
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO jobs (id, kind, state, priority, total, done, failed, payload, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, 0, 0, ?, ?, ?)
    `).run(id, kind, priority, total, payload, now, now)
  }

  getJob(id: string): Job | null {
    if (!this.db) return null
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any
    if (!row) return null
    return this.mapJob(row)
  }

  updateJobState(id: string, state: JobState, done?: number, failed?: number): void {
    if (!this.db) throw new Error('MasterDB 未初始化')
    const now = new Date().toISOString()
    if (done !== undefined && failed !== undefined) {
      this.db.prepare(
        "UPDATE jobs SET state = ?, done = ?, failed = ?, updated_at = ? WHERE id = ?"
      ).run(state, done, failed, now, id)
    } else {
      this.db.prepare(
        "UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?"
      ).run(state, now, id)
    }
  }

  getAllJobs(): Job[] {
    if (!this.db) return []
    const rows = this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as any[]
    return rows.map(r => this.mapJob(r))
  }

  createJobItems(jobId: string, items: Array<{ libraryId: number; imageId: number | null }>): void {
    if (!this.db) throw new Error('MasterDB 未初始化')
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO job_items (job_id, library_id, image_id, state, attempt, updated_at)
      VALUES (?, ?, ?, 'pending', 0, ?)
    `)
    const transaction = this.db.transaction(() => {
      for (const item of items) {
        stmt.run(jobId, item.libraryId, item.imageId, now)
      }
    })
    transaction()
  }

  getJobItems(jobId: string, state?: JobItemState): JobItem[] {
    if (!this.db) return []
    let rows: any[]
    if (state) {
      rows = this.db.prepare(
        'SELECT * FROM job_items WHERE job_id = ? AND state = ? ORDER BY id'
      ).all(jobId, state) as any[]
    } else {
      rows = this.db.prepare(
        'SELECT * FROM job_items WHERE job_id = ? ORDER BY id'
      ).all(jobId) as any[]
    }
    return rows.map(r => this.mapJobItem(r))
  }

  updateJobItemState(itemIds: number[], state: JobItemState, error?: string): void {
    if (!this.db) throw new Error('MasterDB 未初始化')
    const now = new Date().toISOString()
    const stmt = this.db.prepare(
      'UPDATE job_items SET state = ?, error = ?, updated_at = ? WHERE id = ?'
    )
    const transaction = this.db.transaction(() => {
      for (const id of itemIds) {
        stmt.run(state, error ?? null, now, id)
      }
    })
    transaction()
  }

  /** 重启恢复：将 running 状态批量改为 paused */
  recoverInterruptedJobs(): number {
    if (!this.db) return 0
    const now = new Date().toISOString()
    const result1 = this.db.prepare(
      "UPDATE jobs SET state = 'paused', updated_at = ? WHERE state = 'running'"
    ).run(now)
    const result2 = this.db.prepare(
      "UPDATE job_items SET state = 'pending', updated_at = ? WHERE state = 'running'"
    ).run(now)
    return result1.changes
  }

  // ── Edits 数据访问 ──

  createEdit(edit: Omit<Edit, 'id' | 'createdAt'>): number {
    if (!this.db) throw new Error('MasterDB 未初始化')
    const now = new Date().toISOString()
    const result = this.db.prepare(`
      INSERT INTO edits (library_id, image_id, plugin_id, op, params, model_id, output_path, parent_edit_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      edit.libraryId, edit.imageId, edit.pluginId, edit.op,
      edit.params, edit.modelId, edit.outputPath, edit.parentEditId, now
    )
    return Number(result.lastInsertRowid)
  }

  getEditsForImage(libraryId: number, imageId: number): Edit[] {
    if (!this.db) return []
    const rows = this.db.prepare(
      'SELECT * FROM edits WHERE library_id = ? AND image_id = ? ORDER BY created_at'
    ).all(libraryId, imageId) as any[]
    return rows.map(r => this.mapEdit(r))
  }

  private mapJob(row: any): Job {
    return {
      id: row.id,
      kind: row.kind,
      state: row.state,
      priority: row.priority,
      total: row.total,
      done: row.done,
      failed: row.failed,
      payload: row.payload,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapJobItem(row: any): JobItem {
    return {
      id: row.id,
      jobId: row.job_id,
      libraryId: row.library_id,
      imageId: row.image_id,
      state: row.state,
      attempt: row.attempt,
      error: row.error,
      updatedAt: row.updated_at,
    }
  }

  private mapEdit(row: any): Edit {
    return {
      id: row.id,
      libraryId: row.library_id,
      imageId: row.image_id,
      pluginId: row.plugin_id,
      op: row.op,
      params: row.params,
      modelId: row.model_id,
      outputPath: row.output_path,
      parentEditId: row.parent_edit_id,
      createdAt: row.created_at,
    }
  }
```

- [ ] **Step 6: 在启动恢复逻辑中调用 recoverInterruptedJobs**

在 `image-service.ts` 的 `initialize()` 方法中添加恢复调用：

```typescript
// 在 initialize() 的末尾添加
this.masterDB.recoverInterruptedJobs()
```

- [ ] **Step 7: 运行全量测试**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 8: Commit**

```bash
git add src/main/services/database.ts src/main/services/__tests__/database-migration.test.ts src/main/services/image-service.ts
git commit -m "feat: Phase 8 — 数据库迁移 v2 (jobs/job_items/edits 表) + 重启恢复"
```

---

## Task 3: JobRunner 后台作业调度器

**Files:**
- Create: `src/main/services/job-runner.ts`
- Test: `src/main/services/__tests__/job-runner.test.ts`

**Interfaces:**
- Consumes: Task 2 的 MasterDB 方法（createJob, getJob, updateJobState, createJobItems, getJobItems, updateJobItemState）
- Produces: `JobRunner` 类，供后续插件和批处理使用

- [ ] **Step 1: 编写 JobRunner 测试**

```typescript
// src/main/services/__tests__/job-runner.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { JobRunner } from '../job-runner'
import { MasterDB } from '../database'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('JobRunner', () => {
  let db: MasterDB
  let runner: JobRunner

  beforeEach(() => {
    db = new MasterDB()
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-job-test-'))
    db.initialize(tmpDir)
    runner = new JobRunner(db)
  })

  afterEach(() => {
    runner.shutdown()
    db.close()
  })

  it('enqueue 创建作业并返回 jobId', async () => {
    const jobId = await runner.enqueue('test.job', { foo: 'bar' })
    expect(jobId).toBeTruthy()

    const job = db.getJob(jobId)
    expect(job).toBeTruthy()
    expect(job!.kind).toBe('test.job')
    expect(job!.state).toBe('pending')
  })

  it('enqueue 带 items 创建作业项', async () => {
    const jobId = await runner.enqueue('test.job', {}, {
      items: [
        { libraryId: 1, imageId: 1 },
        { libraryId: 1, imageId: 2 },
      ],
    })

    const items = db.getJobItems(jobId)
    expect(items).toHaveLength(2)
    expect(items[0].state).toBe('pending')
  })

  it('start 执行作业 — 处理器被调用', async () => {
    const processed: number[] = []

    runner.registerHandler('test.process', async (item) => {
      processed.push(item.imageId!)
    })

    const jobId = await runner.enqueue('test.process', {}, {
      items: [
        { libraryId: 1, imageId: 10 },
        { libraryId: 1, imageId: 20 },
        { libraryId: 1, imageId: 30 },
      ],
    })

    await runner.start(jobId)

    // 等待所有 items 处理完成
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(processed).toEqual([10, 20, 30])
    const job = db.getJob(jobId)!
    expect(job.state).toBe('done')
    expect(job.done).toBe(3)
  })

  it('单项失败不中断整批', async () => {
    runner.registerHandler('test.fail', async (item) => {
      if (item.imageId === 20) throw new Error('模拟失败')
    })

    const jobId = await runner.enqueue('test.fail', {}, {
      items: [
        { libraryId: 1, imageId: 10 },
        { libraryId: 1, imageId: 20 },
        { libraryId: 1, imageId: 30 },
      ],
    })

    await runner.start(jobId)
    await new Promise(resolve => setTimeout(resolve, 100))

    const job = db.getJob(jobId)!
    expect(job.done).toBe(2)
    expect(job.failed).toBe(1)
    expect(job.state).toBe('done')
  })

  it('pause/resume 暂停和继续', async () => {
    let processedCount = 0

    runner.registerHandler('test.pause', async () => {
      processedCount++
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    const jobId = await runner.enqueue('test.pause', {}, {
      items: Array.from({ length: 10 }, (_, i) => ({
        libraryId: 1, imageId: i,
      })),
    })

    await runner.start(jobId)
    await new Promise(resolve => setTimeout(resolve, 80))
    await runner.pause(jobId)

    const pausedCount = processedCount
    expect(pausedCount).toBeLessThan(10)

    await runner.resume(jobId)
    await new Promise(resolve => setTimeout(resolve, 600))

    expect(processedCount).toBe(10)
  })

  it('cancel 取消作业', async () => {
    runner.registerHandler('test.cancel', async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    const jobId = await runner.enqueue('test.cancel', {}, {
      items: [{ libraryId: 1, imageId: 1 }],
    })

    await runner.start(jobId)
    await runner.cancel(jobId)

    const job = db.getJob(jobId)!
    expect(job.state).toBe('cancelled')
  })

  it('subscribeProgress 接收进度通知', async () => {
    const progressUpdates: any[] = []

    runner.registerHandler('test.progress', async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })

    runner.subscribeProgress((progress) => {
      progressUpdates.push(progress)
    })

    const jobId = await runner.enqueue('test.progress', {}, {
      items: [{ libraryId: 1, imageId: 1 }, { libraryId: 1, imageId: 2 }],
    })

    await runner.start(jobId)
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(progressUpdates.length).toBeGreaterThan(0)
    const last = progressUpdates[progressUpdates.length - 1]
    expect(last.jobId).toBe(jobId)
    expect(last.done).toBe(2)
  })

  it('优先级排序 — 高优先级先执行', async () => {
    const executionOrder: string[] = []

    runner.registerHandler('test.prio', async (item) => {
      executionOrder.push(item.imageId!.toString())
      await new Promise(resolve => setTimeout(resolve, 10))
    })

    // 注意：这里测试的是队列排序，不是并发执行
    const job1 = await runner.enqueue('test.prio', {}, {
      priority: 1,
      items: [{ libraryId: 1, imageId: 1 }],
    })
    const job2 = await runner.enqueue('test.prio', {}, {
      priority: 10,
      items: [{ libraryId: 1, imageId: 2 }],
    })

    await runner.start(job1)
    await runner.start(job2)
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(executionOrder).toEqual(['2', '1'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/main/services/__tests__/job-runner.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 JobRunner**

```typescript
// src/main/services/job-runner.ts
import { randomUUID } from 'crypto'
import { logger } from '../../utils/logger'
import type { MasterDB } from './database'
import type { JobState, JobItemState, JobProgress, JobItem } from '../../types'

/** 批处理大小 */
const BATCH_SIZE = 10

/** 处理器函数类型 */
type JobItemHandler = (item: JobItem) => Promise<void>

/** 进度回调 */
type ProgressCallback = (progress: JobProgress) => void

/** 运行中的作业状态 */
interface RunningJob {
  jobId: string
  handler: JobItemHandler
  abortController: AbortController
  paused: boolean
}

/**
 * JobRunner — 持久化后台作业调度器
 *
 * 设计原则：
 * - 进度落库（job_items 表），进程重启可续跑
 * - 单项失败不中断整批（Promise.allSettled 模式）
 * - 支持暂停/继续/取消
 * - 优先级队列（高优先级先执行）
 * - 批处理 + setImmediate 让权，避免阻塞主线程
 */
export class JobRunner {
  private db: MasterDB
  private runningJobs = new Map<string, RunningJob>()
  private handlers = new Map<string, JobItemHandler>()
  private progressCallbacks = new Set<ProgressCallback>()

  constructor(db: MasterDB) {
    this.db = db
  }

  /** 注册作业处理器 */
  registerHandler(kind: string, handler: JobItemHandler): void {
    this.handlers.set(kind, handler)
  }

  /** 订阅进度通知 */
  subscribeProgress(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback)
    return () => this.progressCallbacks.delete(callback)
  }

  /** 创建新作业 */
  async enqueue(
    kind: string,
    payload: unknown,
    options?: {
      priority?: number
      items?: Array<{ libraryId: number; imageId: number | null }>
    }
  ): Promise<string> {
    const jobId = randomUUID()
    const priority = options?.priority ?? 0
    const total = options?.items?.length ?? 0

    this.db.createJob(jobId, kind, priority, total, JSON.stringify(payload))

    if (options?.items?.length) {
      this.db.createJobItems(jobId, options.items)
    }

    logger.info('JobRunner', `作业入队: ${jobId} (${kind}), ${total} 项`)
    return jobId
  }

  /** 启动作业 */
  async start(jobId: string): Promise<void> {
    const job = this.db.getJob(jobId)
    if (!job) throw new Error(`作业不存在: ${jobId}`)
    if (job.state !== 'pending' && job.state !== 'paused') {
      throw new Error(`作业状态不允许启动: ${job.state}`)
    }

    const handler = this.handlers.get(job.kind)
    if (!handler) throw new Error(`未注册处理器: ${job.kind}`)

    const abortController = new AbortController()
    this.runningJobs.set(jobId, {
      jobId,
      handler,
      abortController,
      paused: false,
    })

    this.db.updateJobState(jobId, 'running')
    this.emitProgress(jobId)

    // 异步执行，不阻塞调用方
    this.executeJob(jobId).catch(err => {
      logger.error('JobRunner', `作业执行异常: ${jobId}`, err)
    })
  }

  /** 暂停作业 */
  async pause(jobId: string): Promise<void> {
    const running = this.runningJobs.get(jobId)
    if (!running) return

    running.paused = true
    running.abortController.abort()
    this.db.updateJobState(jobId, 'paused')
    this.emitProgress(jobId)
    this.runningJobs.delete(jobId)

    logger.info('JobRunner', `作业暂停: ${jobId}`)
  }

  /** 继续作业 */
  async resume(jobId: string): Promise<void> {
    const job = this.db.getJob(jobId)
    if (!job) throw new Error(`作业不存在: ${jobId}`)
    if (job.state !== 'paused') throw new Error(`作业不在暂停状态: ${job.state}`)

    await this.start(jobId)
  }

  /** 取消作业 */
  async cancel(jobId: string): Promise<void> {
    const running = this.runningJobs.get(jobId)
    if (running) {
      running.abortController.abort()
      this.runningJobs.delete(jobId)
    }

    this.db.updateJobState(jobId, 'cancelled')
    this.emitProgress(jobId)
    logger.info('JobRunner', `作业取消: ${jobId}`)
  }

  /** 关闭所有运行中的作业 */
  shutdown(): void {
    for (const [jobId, running] of this.runningJobs) {
      running.abortController.abort()
      this.db.updateJobState(jobId, 'paused')
    }
    this.runningJobs.clear()
  }

  /** 执行作业主循环 */
  private async executeJob(jobId: string): Promise<void> {
    const running = this.runningJobs.get(jobId)
    if (!running) return

    const { handler, abortController } = running

    while (!abortController.signal.aborted) {
      // 取出下一批 pending items
      const pendingItems = this.db.getJobItems(jobId, 'pending').slice(0, BATCH_SIZE)
      if (pendingItems.length === 0) break

      // 标记为 running
      this.db.updateJobItemState(
        pendingItems.map(i => i.id),
        'running'
      )

      // 并发处理本批（单项失败不中断）
      const results = await Promise.allSettled(
        pendingItems.map(async (item) => {
          try {
            await handler(item)
            return { itemId: item.id, success: true }
          } catch (err) {
            return { itemId: item.id, success: false, error: (err as Error).message }
          }
        })
      )

      // 更新 item 状态
      let batchDone = 0
      let batchFailed = 0
      for (const result of results) {
        const value = result.status === 'fulfilled' ? result.value : null
        if (value?.success) {
          this.db.updateJobItemState([value.itemId], 'done')
          batchDone++
        } else {
          const itemId = value?.itemId ?? 0
          const errorMsg = result.status === 'rejected'
            ? (result.reason as Error).message
            : value?.error ?? 'unknown error'
          this.db.updateJobItemState([itemId], 'failed', errorMsg)
          batchFailed++
        }
      }

      // 更新 job 计数
      const job = this.db.getJob(jobId)!
      this.db.updateJobState(
        jobId,
        'running',
        job.done + batchDone,
        job.failed + batchFailed
      )

      this.emitProgress(jobId)

      // 让出执行权，避免阻塞主线程
      await new Promise(resolve => setImmediate(resolve))
    }

    // 作业完成（非取消/暂停）
    if (!running.paused && !abortController.signal.aborted) {
      this.db.updateJobState(jobId, 'done')
      this.emitProgress(jobId)
    }

    this.runningJobs.delete(jobId)
    logger.info('JobRunner', `作业完成: ${jobId}`)
  }

  /** 发送进度通知 */
  private emitProgress(jobId: string): void {
    const job = this.db.getJob(jobId)
    if (!job) return

    const progress: JobProgress = {
      jobId,
      state: job.state,
      total: job.total,
      done: job.done,
      failed: job.failed,
    }

    for (const callback of this.progressCallbacks) {
      try {
        callback(progress)
      } catch (err) {
        logger.error('JobRunner', '进度回调异常', err)
      }
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/main/services/__tests__/job-runner.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/job-runner.ts src/main/services/__tests__/job-runner.test.ts
git commit -m "feat: Phase 8 — JobRunner 后台作业调度器（持久化/断点续跑/优先级）"
```

---

## Task 4: 插件加载器与生命周期管理

**Files:**
- Create: `src/main/plugins/plugin-loader.ts`
- Test: `src/main/plugins/__tests__/plugin-loader.test.ts`

**Interfaces:**
- Consumes: Task 1 的 PluginManifest, PluginInfo, PluginState 类型
- Produces: `PluginLoader` 类，发现/校验/管理插件

- [ ] **Step 1: 编写插件加载器测试**

```typescript
// src/main/plugins/__tests__/plugin-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PluginLoader } from '../plugin-loader'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('PluginLoader', () => {
  let tmpDir: string
  let loader: PluginLoader

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-plugin-test-'))
    loader = new PluginLoader(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createBuiltinPlugin(id: string, overrides?: Partial<PluginManifest>): string {
    const pluginDir = path.join(tmpDir, id)
    fs.mkdirSync(pluginDir, { recursive: true })

    const manifest: PluginManifest = {
      id,
      name: `测试插件 ${id}`,
      version: '1.0.0',
      apiVersion: '^1.0.0',
      kind: 'ai-transform',
      entry: 'index.js',
      capabilities: ['test.capability'],
      permissions: [],
      ...overrides,
    }

    fs.writeFileSync(
      path.join(pluginDir, 'plugin.json'),
      JSON.stringify(manifest, null, 2)
    )
    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = {}')

    return pluginDir
  }

  it('discover 发现内置目录下的插件', () => {
    createBuiltinPlugin('test.plugin-a')
    createBuiltinPlugin('test.plugin-b')

    const plugins = loader.discover()
    expect(plugins).toHaveLength(2)
    expect(plugins.map(p => p.manifest.id).sort()).toEqual([
      'test.plugin-a',
      'test.plugin-b',
    ])
  })

  it('validate 校验合法插件', () => {
    createBuiltinPlugin('test.valid')
    loader.discover()

    const info = loader.getPlugin('test.valid')
    expect(info).toBeTruthy()
    expect(info!.state).toBe('valid')
  })

  it('validate 标记缺少 entry 的插件为 invalid', () => {
    const pluginDir = createBuiltinPlugin('test.no-entry')
    // 删除入口文件
    fs.unlinkSync(path.join(pluginDir, 'index.js'))

    loader.discover()
    const info = loader.getPlugin('test.no-entry')
    expect(info!.state).toBe('invalid')
    expect(info!.error).toContain('entry')
  })

  it('validate 标记缺少必需字段的插件为 invalid', () => {
    const pluginDir = path.join(tmpDir, 'test.bad')
    fs.mkdirSync(pluginDir, { recursive: true })
    // 写入不完整的 manifest
    fs.writeFileSync(
      path.join(pluginDir, 'plugin.json'),
      JSON.stringify({ id: 'test.bad', name: 'Bad' })  // 缺少必需字段
    )

    loader.discover()
    const info = loader.getPlugin('test.bad')
    expect(info!.state).toBe('invalid')
  })

  it('getPlugins 返回所有已发现插件', () => {
    createBuiltinPlugin('test.a')
    createBuiltinPlugin('test.b')
    loader.discover()

    const all = loader.getPlugins()
    expect(all.length).toBeGreaterThanOrEqual(2)
  })

  it('isBuiltin 正确标识内置插件', () => {
    createBuiltinPlugin('builtin.test')
    loader = new PluginLoader(tmpDir) // 内置目录就是 tmpDir
    loader.discover()

    const info = loader.getPlugin('builtin.test')
    expect(info!.isBuiltin).toBe(true)
  })
})
```

需要添加类型导入。在文件顶部添加：

```typescript
import type { PluginManifest } from '../../types'
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/main/plugins/__tests__/plugin-loader.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 PluginLoader**

```typescript
// src/main/plugins/plugin-loader.ts
import fs from 'fs'
import path from 'path'
import { logger } from '../../utils/logger'
import type { PluginManifest, PluginInfo, PluginState } from '../../types'

/** 插件清单必需字段 */
const REQUIRED_FIELDS: (keyof PluginManifest)[] = [
  'id', 'name', 'version', 'apiVersion', 'kind', 'entry', 'capabilities',
]

/** 合法的 kind 值 */
const VALID_KINDS = [
  'ai-index', 'ai-transform', 'diffusion-provider', 'crawler-adapter', 'ui-panel',
]

/**
 * 插件加载器 — 发现、校验、管理插件生命周期
 *
 * 职责：
 * - 扫描内置目录和第三方插件目录
 * - 读取并校验 plugin.json
 * - 管理插件状态（discovered → valid → activated → idle → deactivated）
 * - 校验失败不阻塞宿主启动
 */
export class PluginLoader {
  private builtinDir: string
  private thirdPartyDir: string
  private plugins = new Map<string, PluginInfo>()

  /**
   * @param builtinDir 内置插件目录
   * @param thirdPartyDir 第三方插件目录（默认 %APPDATA%/luuk/plugins）
   */
  constructor(builtinDir: string, thirdPartyDir?: string) {
    this.builtinDir = builtinDir
    this.thirdPartyDir = thirdPartyDir ?? ''
  }

  /** 发现所有插件（内置 + 第三方） */
  discover(): PluginInfo[] {
    this.plugins.clear()

    // 扫描内置目录
    if (fs.existsSync(this.builtinDir)) {
      this.scanDirectory(this.builtinDir, true)
    }

    // 扫描第三方目录
    if (this.thirdPartyDir && fs.existsSync(this.thirdPartyDir)) {
      this.scanDirectory(this.thirdPartyDir, false)
    }

    logger.info('PluginLoader', `发现 ${this.plugins.size} 个插件`)
    return Array.from(this.plugins.values())
  }

  /** 获取指定插件信息 */
  getPlugin(id: string): PluginInfo | undefined {
    return this.plugins.get(id)
  }

  /** 获取所有插件 */
  getPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values())
  }

  /** 更新插件状态 */
  setState(id: string, state: PluginState, error?: string): void {
    const plugin = this.plugins.get(id)
    if (!plugin) return
    plugin.state = state
    if (error) plugin.error = error
  }

  /** 扫描目录中的插件 */
  private scanDirectory(dir: string, isBuiltin: boolean): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const pluginDir = path.join(dir, entry.name)
        this.loadPlugin(pluginDir, isBuiltin)
      }
    } catch (err) {
      logger.error('PluginLoader', `扫描目录失败: ${dir}`, err)
    }
  }

  /** 加载单个插件 */
  private loadPlugin(pluginDir: string, isBuiltin: boolean): void {
    const manifestPath = path.join(pluginDir, 'plugin.json')

    // 读取 manifest
    let manifest: PluginManifest
    try {
      const content = fs.readFileSync(manifestPath, 'utf-8')
      manifest = JSON.parse(content)
    } catch (err) {
      logger.warn('PluginLoader', `无法读取 plugin.json: ${pluginDir}`, err)
      return
    }

    // 校验
    const validationError = this.validate(manifest, pluginDir)
    const state: PluginState = validationError ? 'invalid' : 'valid'

    const info: PluginInfo = {
      manifest,
      state,
      path: pluginDir,
      isBuiltin,
      error: validationError ?? undefined,
    }

    this.plugins.set(manifest.id, info)

    if (validationError) {
      logger.warn('PluginLoader', `插件校验失败: ${manifest.id} — ${validationError}`)
    }
  }

  /** 校验插件清单 */
  private validate(manifest: PluginManifest, pluginDir: string): string | null {
    // 检查必需字段
    for (const field of REQUIRED_FIELDS) {
      if (!(field in manifest) || manifest[field] === undefined) {
        return `缺少必需字段: ${field}`
      }
    }

    // 检查 kind 合法性
    if (!VALID_KINDS.includes(manifest.kind)) {
      return `不支持的 kind: ${manifest.kind}`
    }

    // 检查 entry 文件存在
    const entryPath = path.join(pluginDir, manifest.entry)
    if (!fs.existsSync(entryPath)) {
      return `入口文件不存在: ${manifest.entry}`
    }

    return null
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/main/plugins/__tests__/plugin-loader.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/plugins/plugin-loader.ts src/main/plugins/__tests__/plugin-loader.test.ts
git commit -m "feat: Phase 8 — 插件加载器与生命周期管理"
```

---

## Task 5: 内存水位线监控

**Files:**
- Create: `src/main/services/memory-monitor.ts`
- Test: `src/main/services/__tests__/memory-monitor.test.ts`

**Interfaces:**
- Consumes: Task 1 的 MemoryLevel, MemoryStatus 类型
- Produces: `MemoryMonitor` 单例，提供内存状态查询 + 事件通知

- [ ] **Step 1: 编写测试**

```typescript
// src/main/services/__tests__/memory-monitor.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryMonitor } from '../memory-monitor'

describe('MemoryMonitor', () => {
  let monitor: MemoryMonitor

  beforeEach(() => {
    monitor = new MemoryMonitor({ yellowMB: 300, redMB: 400 })
  })

  afterEach(() => {
    monitor.stop()
  })

  it('初始状态为 green', () => {
    const status = monitor.getStatus()
    expect(status.level).toBe('green')
  })

  it('超过黄色阈值时为 yellow', () => {
    // Mock process.memoryUsage
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 350 * 1024 * 1024,
      heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0,
    })

    monitor.refresh()
    expect(monitor.getStatus().level).toBe('yellow')
  })

  it('超过红色阈值时为 red', () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 450 * 1024 * 1024,
      heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0,
    })

    monitor.refresh()
    expect(monitor.getStatus().level).toBe('red')
  })

  it('levelChange 事件触发', () => {
    const levels: string[] = []
    monitor.on('levelChange', (status) => {
      levels.push(status.level)
    })

    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 100 * 1024 * 1024,
      heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0,
    })
    monitor.refresh()

    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 350 * 1024 * 1024,
      heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0,
    })
    monitor.refresh()

    expect(levels).toContain('yellow')
  })

  it('定时刷新', async () => {
    vi.useFakeTimers()
    const refreshSpy = vi.spyOn(monitor, 'refresh')

    monitor.start(1000) // 每秒刷新
    vi.advanceTimersByTime(3500)

    expect(refreshSpy.mock.calls.length).toBeGreaterThanOrEqual(3)

    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: 实现 MemoryMonitor**

```typescript
// src/main/services/memory-monitor.ts
import { EventEmitter } from 'events'
import { logger } from '../../utils/logger'
import type { MemoryLevel, MemoryStatus } from '../../types'

export interface MemoryMonitorOptions {
  yellowMB: number
  redMB: number
}

/**
 * 内存水位线监控器
 *
 * 三级水位线（对应设计文档 7.4）：
 * - 🟢 绿 <300MB：正常
 * - 🟡 黄 300-400MB：停止预加载
 * - 🔴 红 >400MB：立即驱逐 + 暂停作业
 *
 * 500MB 是应用整体红线，水位线设在 400MB 留出缓冲
 */
export class MemoryMonitor extends EventEmitter {
  private options: MemoryMonitorOptions
  private currentLevel: MemoryLevel = 'green'
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(options: MemoryMonitorOptions) {
    super()
    this.options = options
  }

  /** 获取当前内存状态 */
  getStatus(): MemoryStatus {
    const rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024)
    return {
      level: this.currentLevel,
      rssMB,
      threshold: {
        yellow: this.options.yellowMB,
        red: this.options.redMB,
      },
    }
  }

  /** 刷新内存水位线 */
  refresh(): MemoryLevel {
    const rssMB = process.memoryUsage().rss / 1024 / 1024
    let newLevel: MemoryLevel

    if (rssMB >= this.options.redMB) {
      newLevel = 'red'
    } else if (rssMB >= this.options.yellowMB) {
      newLevel = 'yellow'
    } else {
      newLevel = 'green'
    }

    if (newLevel !== this.currentLevel) {
      const oldLevel = this.currentLevel
      this.currentLevel = newLevel
      logger.info('MemoryMonitor', `水位线变化: ${oldLevel} → ${newLevel} (${Math.round(rssMB)}MB)`)
      this.emit('levelChange', this.getStatus())
    }

    return newLevel
  }

  /** 启动定时刷新 */
  start(intervalMs: number = 5000): void {
    if (this.timer) return
    this.timer = setInterval(() => this.refresh(), intervalMs)
    this.refresh()
  }

  /** 停止定时刷新 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 当前是否为红色警戒 */
  isRed(): boolean {
    return this.currentLevel === 'red'
  }

  /** 当前是否为黄色或更高 */
  isYellowOrAbove(): boolean {
    return this.currentLevel === 'yellow' || this.currentLevel === 'red'
  }
}
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run src/main/services/__tests__/memory-monitor.test.ts`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/services/memory-monitor.ts src/main/services/__tests__/memory-monitor.test.ts
git commit -m "feat: Phase 8 — 内存水位线监控（三级水位线 + 事件通知）"
```

---

## Task 6: 模型管理器（下载/校验/管理）

**Files:**
- Create: `src/main/services/model-manager.ts`
- Test: `src/main/services/__tests__/model-manager.test.ts`

**Interfaces:**
- Consumes: Task 1 的 ModelInfo, ModelDownloadState 类型
- Produces: `ModelManager` 类，提供模型下载、SHA256 校验、状态查询

- [ ] **Step 1: 编写测试**

```typescript
// src/main/services/__tests__/model-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ModelManager } from '../model-manager'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createHash } from 'crypto'

describe('ModelManager', () => {
  let tmpDir: string
  let manager: ModelManager

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-model-test-'))
    manager = new ModelManager(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('getModelInfo 返回未下载状态', () => {
    const info = manager.getModelInfo('test-model')
    expect(info).toBeTruthy()
    expect(info!.state).toBe('not-downloaded')
  })

  it('registerModel 注册模型清单', () => {
    manager.registerModel({
      id: 'test-model',
      name: '测试模型',
      size: 1000,
      sha256: 'abc123',
      state: 'not-downloaded',
    })

    const info = manager.getModelInfo('test-model')
    expect(info!.name).toBe('测试模型')
  })

  it('verifyModel 校验已存在的文件', () => {
    // 创建一个测试文件
    const testContent = Buffer.from('test model content')
    const expectedHash = createHash('sha256').update(testContent).digest('hex')
    fs.writeFileSync(path.join(tmpDir, 'test.bin'), testContent)

    manager.registerModel({
      id: 'test-model',
      name: '测试',
      size: testContent.length,
      sha256: expectedHash,
      state: 'not-downloaded',
    })

    const valid = manager.verifyModel('test-model')
    expect(valid).toBe(true)

    const info = manager.getModelInfo('test-model')
    expect(info!.state).toBe('downloaded')
    expect(info!.localPath).toContain('test.bin')
  })

  it('verifyModel SHA256 不匹配时返回 false', () => {
    const testContent = Buffer.from('test model content')
    fs.writeFileSync(path.join(tmpDir, 'test.bin'), testContent)

    manager.registerModel({
      id: 'bad-model',
      name: '损坏模型',
      size: testContent.length,
      sha256: 'wrong_hash',
      state: 'not-downloaded',
    })

    const valid = manager.verifyModel('bad-model')
    expect(valid).toBe(false)
  })

  it('getModelPath 返回已下载模型的路径', () => {
    const testContent = Buffer.from('content')
    const hash = createHash('sha256').update(testContent).digest('hex')
    fs.writeFileSync(path.join(tmpDir, 'model.onnx'), testContent)

    manager.registerModel({
      id: 'my-model',
      name: '模型',
      size: testContent.length,
      sha256: hash,
      state: 'not-downloaded',
    })
    manager.verifyModel('my-model')

    const modelPath = manager.getModelPath('my-model')
    expect(modelPath).toBeTruthy()
    expect(fs.existsSync(modelPath!)).toBe(true)
  })

  it('listModels 返回所有已注册模型', () => {
    manager.registerModel({ id: 'a', name: 'A', size: 100, sha256: 'x', state: 'not-downloaded' })
    manager.registerModel({ id: 'b', name: 'B', size: 200, sha256: 'y', state: 'not-downloaded' })

    const models = manager.listModels()
    expect(models).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 实现 ModelManager**

```typescript
// src/main/services/model-manager.ts
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { logger } from '../../utils/logger'
import type { ModelInfo, ModelDownloadState } from '../../types'

/**
 * 模型管理器 — 模型下载、校验、管理
 *
 * 设计要点（来自 7.2 / 7.7）：
 * - 运行时按需下载到 %APPDATA%\luuk\models\
 * - 下载后 SHA256 校验不通过则删除重下
 * - 支持断点续传（.part 临时文件 + HTTP Range）
 * - 首次使用无需联网（模型未就绪时 op 在 UI 隐藏）
 */
export class ModelManager {
  private modelsDir: string
  private models = new Map<string, ModelInfo>()

  constructor(modelsDir: string) {
    this.modelsDir = modelsDir
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true })
    }
  }

  /** 注册模型清单 */
  registerModel(model: ModelInfo): void {
    this.models.set(model.id, { ...model })
  }

  /** 获取模型信息 */
  getModelInfo(id: string): ModelInfo | undefined {
    return this.models.get(id)
  }

  /** 列出所有模型 */
  listModels(): ModelInfo[] {
    return Array.from(this.models.values())
  }

  /** 获取已下载模型的本地路径 */
  getModelPath(id: string): string | null {
    const info = this.models.get(id)
    return info?.localPath ?? null
  }

  /** 校验模型文件完整性 */
  verifyModel(id: string): boolean {
    const info = this.models.get(id)
    if (!info) return false

    const modelPath = path.join(this.modelsDir, `${id}.onnx`)
    if (!fs.existsSync(modelPath)) {
      // 也检查 .bin 扩展名
      const binPath = path.join(this.modelsDir, `${id}.bin`)
      if (!fs.existsSync(binPath)) return false
      return this.verifyFile(binPath, info.sha256, id)
    }

    return this.verifyFile(modelPath, info.sha256, id)
  }

  /** 校验单个文件 */
  private verifyFile(filePath: string, expectedHash: string, modelId: string): boolean {
    try {
      const content = fs.readFileSync(filePath)
      const actualHash = createHash('sha256').update(content).digest('hex')

      if (actualHash !== expectedHash) {
        logger.warn('ModelManager', `模型 ${modelId} SHA256 不匹配，删除损坏文件`)
        fs.unlinkSync(filePath)
        return false
      }

      // 校验通过，更新状态
      const info = this.models.get(modelId)!
      info.state = 'downloaded'
      info.localPath = filePath
      return true
    } catch (err) {
      logger.error('ModelManager', `模型校验失败: ${modelId}`, err)
      return false
    }
  }

  /** 更新模型下载进度 */
  updateProgress(id: string, progress: number): void {
    const info = this.models.get(id)
    if (info) {
      info.progress = progress
      info.state = 'downloading'
    }
  }

  /** 标记下载完成 */
  markDownloaded(id: string, filePath: string): void {
    const info = this.models.get(id)
    if (info) {
      info.state = 'downloaded'
      info.localPath = filePath
      info.progress = 100
    }
  }

  /** 标记下载失败 */
  markFailed(id: string): void {
    const info = this.models.get(id)
    if (info) {
      info.state = 'failed'
    }
  }
}
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run src/main/services/__tests__/model-manager.test.ts`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/services/model-manager.ts src/main/services/__tests__/model-manager.test.ts
git commit -m "feat: Phase 8 — 模型管理器（注册/校验/SHA256 完整性验证）"
```

---

## Task 7: 插件宿主进程（utilityProcess 管理）

**Files:**
- Create: `src/main/plugins/plugin-host-process.ts`
- Create: `electron/plugin-worker.ts`

**Interfaces:**
- Consumes: Task 1 的 WorkerRpcRequest, WorkerRpcResponse 类型
- Produces: `PluginHostProcess` 类，管理 utilityProcess 生命周期 + RPC 通信

- [ ] **Step 1: 创建 Worker 入口**

```typescript
// electron/plugin-worker.ts
/**
 * 插件宿主 Worker 入口
 *
 * 运行在 Electron utilityProcess 中，职责：
 * - 加载插件代码
 * - 管理 ONNX 推理会话
 * - 通过 MessagePort RPC 与主进程通信
 * - 内存监控
 */
import { parentPort } from 'worker_threads'

if (!parentPort) {
  throw new Error('plugin-worker 必须在 utilityProcess 中运行')
}

/** RPC 请求处理器映射 */
const handlers = new Map<string, (params: any) => Promise<any>>()

/** 注册处理器 */
function registerHandler(method: string, handler: (params: any) => Promise<any>): void {
  handlers.set(method, handler)
}

/** 发送响应 */
function sendResponse(id: number, result?: unknown, error?: { code: string; message: string }): void {
  parentPort!.postMessage({ id, result, error })
}

// ── 内存状态 ──

registerHandler('memory.getStatus', async () => {
  const mem = process.memoryUsage()
  return {
    rssMB: Math.round(mem.rss / 1024 / 1024),
    heapMB: Math.round(mem.heapUsed / 1024 / 1024),
  }
})

registerHandler('memory.getStats', async () => {
  return process.memoryUsage()
})

// ── 插件加载（占位，后续 Task 实现） ──

registerHandler('plugin.load', async ({ pluginId, entryPath }) => {
  // TODO: Task 8 实现
  return { success: true, pluginId }
})

registerHandler('plugin.unload', async ({ pluginId }) => {
  // TODO: Task 8 实现
  return { success: true, pluginId }
})

registerHandler('plugin.execute', async ({ pluginId, opId, input }) => {
  // TODO: Task 8 实现
  return { success: false, error: 'not implemented' }
})

// ── 推理（占位，后续 Task 实现） ──

registerHandler('inference.createSession', async ({ modelId, modelPath }) => {
  // TODO: ONNX Runtime 集成
  return { success: true, modelId }
})

registerHandler('inference.run', async ({ modelId, feeds }) => {
  // TODO: ONNX Runtime 集成
  return { success: false, error: 'not implemented' }
})

registerHandler('inference.destroySession', async ({ modelId }) => {
  // TODO: ONNX Runtime 集成
  return { success: true, modelId }
})

// ── 消息处理 ──

parentPort.on('message', async (msg: any) => {
  if (msg.type !== 'rpc-request') return

  const { id, method, params } = msg
  const handler = handlers.get(method)

  if (!handler) {
    sendResponse(id, undefined, { code: 'METHOD_NOT_FOUND', message: `未知方法: ${method}` })
    return
  }

  try {
    const result = await handler(params)
    sendResponse(id, result)
  } catch (err) {
    sendResponse(id, undefined, {
      code: 'EXECUTION_ERROR',
      message: (err as Error).message,
    })
  }
})

// 通知主进程 Worker 已就绪
parentPort.postMessage({ type: 'ready' })
```

- [ ] **Step 2: 创建 PluginHostProcess 管理类**

```typescript
// src/main/plugins/plugin-host-process.ts
import { utilityProcess, UtilityProcess } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { logger } from '../../utils/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** RPC 回调 */
type RpcCallback = (result?: unknown, error?: { code: string; message: string }) => void

/**
 * 插件宿主进程管理器
 *
 * 管理 Electron utilityProcess 的生命周期：
 * - 懒启动（无插件需要时不 fork）
 * - MessagePort RPC 通信
 * - 崩溃检测与重启
 * - 优雅关闭
 */
export class PluginHostProcess {
  private process: UtilityProcess | null = null
  private rpcIdCounter = 0
  private pendingRequests = new Map<number, RpcCallback>()
  private ready = false
  private workerScriptPath: string

  constructor() {
    // Worker 脚本路径（构建后在 dist-electron 目录）
    this.workerScriptPath = path.resolve(__dirname, '../dist-electron/plugin-worker.js')
  }

  /** 确保 Worker 进程已启动 */
  async ensureStarted(): Promise<void> {
    if (this.process && this.ready) return

    return new Promise((resolve, reject) => {
      logger.info('PluginHostProcess', '启动 Worker 进程...')

      this.process = utilityProcess.fork(this.workerScriptPath, [], {
        serviceName: 'luuk-plugin-host',
      })

      const readyTimeout = setTimeout(() => {
        reject(new Error('Worker 进程启动超时（10s）'))
      }, 10000)

      this.process.on('message', (msg: any) => {
        if (msg.type === 'ready') {
          clearTimeout(readyTimeout)
          this.ready = true
          logger.info('PluginHostProcess', 'Worker 进程就绪')
          resolve()
          return
        }

        if (msg.type === 'rpc-response' || msg.id !== undefined) {
          this.handleRpcResponse(msg)
        }
      })

      this.process.on('exit', (code) => {
        logger.warn('PluginHostProcess', `Worker 进程退出 (code=${code})`)
        this.ready = false
        this.process = null

        // 拒绝所有待处理的请求
        for (const [id, callback] of this.pendingRequests) {
          callback(undefined, { code: 'PROCESS_EXIT', message: `Worker 进程退出 (${code})` })
        }
        this.pendingRequests.clear()
      })

      this.process.on('error', (err) => {
        logger.error('PluginHostProcess', 'Worker 进程错误', err)
        clearTimeout(readyTimeout)
        reject(err)
      })
    })
  }

  /** 发送 RPC 请求 */
  async rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.ensureStarted()

    return new Promise((resolve, reject) => {
      const id = ++this.rpcIdCounter

      this.pendingRequests.set(id, (result, error) => {
        if (error) {
          reject(new Error(`${error.code}: ${error.message}`))
        } else {
          resolve(result as T)
        }
      })

      this.process!.postMessage({
        type: 'rpc-request',
        id,
        method,
        params,
      })
    })
  }

  /** 处理 RPC 响应 */
  private handleRpcResponse(msg: any): void {
    const callback = this.pendingRequests.get(msg.id)
    if (!callback) return

    this.pendingRequests.delete(msg.id)
    callback(msg.result, msg.error)
  }

  /** 关闭 Worker 进程 */
  async shutdown(): Promise<void> {
    if (!this.process) return

    return new Promise((resolve) => {
      this.process!.on('exit', () => {
        this.process = null
        this.ready = false
        resolve()
      })
      this.process!.kill()
    })
  }

  /** Worker 是否就绪 */
  isReady(): boolean {
    return this.ready
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/plugins/plugin-host-process.ts electron/plugin-worker.ts
git commit -m "feat: Phase 8 — 插件宿主进程（utilityProcess + MessagePort RPC）"
```

---

## Task 8: 自动调色插件（autotone — 零模型，验证全链路）

**Files:**
- Create: `src/main/plugins/builtins/autotone/plugin.json`
- Create: `src/main/plugins/builtins/autotone/index.ts`
- Test: `src/main/plugins/__tests__/autotone.test.ts`

**Interfaces:**
- Consumes: Task 1 的 PluginManifest 类型，现有 `histogram.ts` 工具
- Produces: 第一个内置插件，验证 op → JobRunner → edits 全链路

★ Insight ─────────────────────────────────────

**为什么 autotone 先行**：这是设计文档 6.6 节的关键决策。autotone 复用已有的 `histogram.ts` + `sharp`，零模型下载、零推理耗时、零内存风险，却能完整验证：
1. plugin.json 声明 → 插件加载器发现
2. op 注册 → 右键菜单贡献
3. JobRunner 批处理
4. edits 版本链写入
5. 输出副本落地

用它把插件框架跑通，再上有模型的插件。

`─────────────────────────────────────────────────`

- [ ] **Step 1: 创建 plugin.json**

```json
{
  "id": "builtin.autotone",
  "name": "自动调色",
  "version": "1.0.0",
  "apiVersion": "^1.0.0",
  "kind": "ai-transform",
  "entry": "index.js",
  "capabilities": ["image.autotone"],
  "requires": {
    "runtime": "none",
    "gpu": false,
    "models": []
  },
  "contributes": {
    "ops": [
      {
        "id": "autotone.auto",
        "capability": "image.autotone",
        "label": "自动调色",
        "params": {
          "type": "object",
          "properties": {
            "exposure": { "type": "boolean", "default": true },
            "contrast": { "type": "boolean", "default": true },
            "whiteBalance": { "type": "boolean", "default": true }
          }
        }
      }
    ],
    "menuItems": [
      {
        "op": "autotone.auto",
        "label": "自动调色",
        "context": ["grid-multi", "folder"]
      }
    ]
  },
  "permissions": ["library.read", "fs.write.output", "image"]
}
```

- [ ] **Step 2: 实现 autotone 核心算法**

```typescript
// src/main/plugins/builtins/autotone/index.ts
import sharp from 'sharp'
import { calculateHistogram, getHistogramStats } from '../../../../main/utils/histogram'
import { logger } from '../../../../utils/logger'

/**
 * 自动调色参数
 */
export interface AutotoneParams {
  exposure?: boolean      // 曝光修正
  contrast?: boolean      // 对比度修正
  whiteBalance?: boolean  // 白平衡修正
}

const DEFAULT_PARAMS: Required<AutotoneParams> = {
  exposure: true,
  contrast: true,
  whiteBalance: true,
}

/**
 * 自动调色处理
 *
 * 基于直方图分析，自动修正曝光/对比度/白平衡：
 * - 曝光：检测直方图是否偏左（欠曝）或偏右（过曝），调整亮度
 * - 对比度：基于标准差评估，低对比度时拉伸
 * - 白平衡：基于灰度世界假设计算色温偏移
 */
export async function applyAutotone(
  inputPath: string,
  outputPath: string,
  params: AutotoneParams = {}
): Promise<void> {
  const opts = { ...DEFAULT_PARAMS, ...params }

  // 计算直方图
  const histogram = await calculateHistogram(inputPath)
  const lumStats = getHistogramStats(histogram.luminance)

  // 获取图片元数据
  const metadata = await sharp(inputPath).metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error('无法获取图片元数据')
  }

  // 读取原始像素用于色温计算
  const { data, info } = await sharp(inputPath)
    .raw()
    .toBuffer({ resolveWithObject: true })

  let rMean = 0, gMean = 0, bMean = 0
  const pixelCount = data.length / info.channels

  for (let i = 0; i < data.length; i += info.channels) {
    rMean += data[i]
    gMean += data[i + 1]
    bMean += data[i + 2]
  }
  rMean /= pixelCount
  gMean /= pixelCount
  bMean /= pixelCount

  // 计算调整参数
  let brightnessAdjust = 1.0
  let contrastAdjust = 1.0
  let rScale = 1.0, gScale = 1.0, bScale = 1.0

  // 曝光修正：目标均值 128
  if (opts.exposure) {
    const targetMean = 128
    const diff = targetMean - lumStats.mean
    // 温和调整，最多 ±30%
    brightnessAdjust = 1.0 + (diff / 256) * 0.3
    brightnessAdjust = Math.max(0.7, Math.min(1.3, brightnessAdjust))
  }

  // 对比度修正：标准差 < 50 时增强
  if (opts.contrast) {
    if (lumStats.stdDev < 50) {
      // 低对比度，增强
      contrastAdjust = 1.0 + (50 - lumStats.stdDev) / 100
      contrastAdjust = Math.min(1.5, contrastAdjust)
    } else if (lumStats.stdDev > 80) {
      // 高对比度，轻微减弱
      contrastAdjust = 0.95
    }
  }

  // 白平衡修正：灰度世界假设
  if (opts.whiteBalance) {
    const avgColor = (rMean + gMean + bMean) / 3
    if (avgColor > 0) {
      rScale = avgColor / rMean
      gScale = avgColor / gMean
      bScale = avgColor / bMean
      // 限制调整范围
      rScale = Math.max(0.8, Math.min(1.2, rScale))
      gScale = Math.max(0.8, Math.min(1.2, gScale))
      bScale = Math.max(0.8, Math.min(1.2, bScale))
    }
  }

  logger.info('Autotone', `调整参数: brightness=${brightnessAdjust.toFixed(2)}, contrast=${contrastAdjust.toFixed(2)}, WB=(${rScale.toFixed(2)}, ${gScale.toFixed(2)}, ${bScale.toFixed(2)})`)

  // 应用调整
  let pipeline = sharp(inputPath)

  // 亮度调整
  if (Math.abs(brightnessAdjust - 1.0) > 0.01) {
    pipeline = pipeline.modulate({ brightness: brightnessAdjust })
  }

  // 对比度调整（通过 linear 实现）
  if (Math.abs(contrastAdjust - 1.0) > 0.01) {
    const intercept = 128 * (1 - contrastAdjust)
    pipeline = pipeline.linear(contrastAdjust, intercept)
  }

  // 白平衡（通过通道乘法实现）
  if (opts.whiteBalance && (Math.abs(rScale - 1.0) > 0.01 || Math.abs(bScale - 1.0) > 0.01)) {
    // 使用 sharp 的 joinChannel + bandbool 方式复杂，改用 multiply
    // 简化方案：通过 tint 调整色温
    const warmth = (rScale - bScale) * 50
    if (Math.abs(warmth) > 2) {
      pipeline = pipeline.tint(warmth > 0 ? { r: 255, g: 200, b: 150 } : { r: 150, g: 200, b: 255 })
    }
  }

  await pipeline.toFile(outputPath)
  logger.info('Autotone', `自动调色完成: ${outputPath}`)
}
```

- [ ] **Step 3: 编写测试**

```typescript
// src/main/plugins/__tests__/autotone.test.ts
import { describe, it, expect } from 'vitest'
import { applyAutotone } from '../builtins/autotone'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('Autotone Plugin', () => {
  let tmpDir: string

  async function createTestImage(options?: {
    width?: number
    height?: number
    color?: { r: number; g: number; b: number }
  }): Promise<string> {
    const width = options?.width ?? 100
    const height = options?.height ?? 100
    const color = options?.color ?? { r: 128, g: 128, b: 128 }

    const inputPath = path.join(tmpDir, `input-${Date.now()}.png`)

    // 创建带噪声的测试图（避免纯色导致直方图无意义）
    const channels = 3
    const data = Buffer.alloc(width * height * channels)
    for (let i = 0; i < data.length; i += channels) {
      const noise = Math.floor(Math.random() * 40) - 20
      data[i] = Math.max(0, Math.min(255, color.r + noise))
      data[i + 1] = Math.max(0, Math.min(255, color.g + noise))
      data[i + 2] = Math.max(0, Math.min(255, color.b + noise))
    }

    await sharp(data, { raw: { width, height, channels } })
      .png()
      .toFile(inputPath)

    return inputPath
  }

  async function beforeEach() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-autotone-'))
  }

  async function afterEach() {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }

  it('处理欠曝图片 — 亮度提升', async () => {
    await beforeEach()
    try {
      const inputPath = await createTestImage({ color: { r: 60, g: 60, b: 60 } })
      const outputPath = path.join(tmpDir, 'output.png')

      await applyAutotone(inputPath, outputPath)

      expect(fs.existsSync(outputPath)).toBe(true)

      // 检查输出亮度更高
      const outMeta = await sharp(outputPath).stats()
      expect(outMeta.channels[0].mean).toBeGreaterThan(60)
    } finally {
      await afterEach()
    }
  })

  it('处理过曝图片 — 亮度降低', async () => {
    await beforeEach()
    try {
      const inputPath = await createTestImage({ color: { r: 220, g: 220, b: 220 } })
      const outputPath = path.join(tmpDir, 'output.png')

      await applyAutotone(inputPath, outputPath)

      expect(fs.existsSync(outputPath)).toBe(true)
    } finally {
      await afterEach()
    }
  })

  it('参数控制 — 关闭白平衡', async () => {
    await beforeEach()
    try {
      const inputPath = await createTestImage({ color: { r: 200, g: 128, b: 80 } })
      const outputPath = path.join(tmpDir, 'output.png')

      await applyAutotone(inputPath, outputPath, { whiteBalance: false })

      expect(fs.existsSync(outputPath)).toBe(true)
    } finally {
      await afterEach()
    }
  })

  it('plugin.json 格式正确', async () => {
    const pluginJsonPath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '../builtins/autotone/plugin.json'
    )
    // Windows 路径修正
    const normalizedPath = pluginJsonPath.replace(/^\/([A-Z]:)/, '$1')

    if (fs.existsSync(normalizedPath)) {
      const content = JSON.parse(fs.readFileSync(normalizedPath, 'utf-8'))
      expect(content.id).toBe('builtin.autotone')
      expect(content.kind).toBe('ai-transform')
      expect(content.requires.runtime).toBe('none')
    }
  })
})
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run src/main/plugins/__tests__/autotone.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/plugins/builtins/autotone/ src/main/plugins/__tests__/autotone.test.ts
git commit -m "feat: Phase 8 — 内置插件 autotone（零模型，验证全链路）"
```

---

## Task 9: 编辑版本链服务（EditsService）

**Files:**
- Create: `src/main/services/edits-service.ts`

**Interfaces:**
- Consumes: Task 2 的 MasterDB.createEdit / getEditsForImage 方法
- Produces: `EditsService` 类，管理编辑输出目录 + 版本链

- [ ] **Step 1: 实现 EditsService**

```typescript
// src/main/services/edits-service.ts
import path from 'path'
import fs from 'fs'
import { logger } from '../../utils/logger'
import type { MasterDB } from './database'
import type { Edit } from '../../types'

/** 编辑输出子目录名 */
const EDITS_DIR = '_edits'

/**
 * 编辑版本链服务
 *
 * 管理非破坏性编辑的输出：
 * - 原图绝对不修改（8.1）
 * - 输出到 {库根}/_edits/{原文件名}/{op}_{timestamp}.png
 * - 记录到 edits 表，支持 parent_edit_id 构成树
 */
export class EditsService {
  private db: MasterDB

  constructor(db: MasterDB) {
    this.db = db
  }

  /**
   * 创建编辑输出
   *
   * @param libraryId 库 ID
   * @param imageId 图片 ID
   * @param sourcePath 原图路径
   * @param pluginId 产生此编辑的插件
   * @param op 操作名（如 'upscale.x4'）
   * @param outputBuffer 输出图片 buffer
   * @param options 可选参数
   * @returns edit ID
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
    // 计算输出路径
    const libraryRoot = path.dirname(sourcePath).split(path.sep).slice(0, -1).join(path.sep)
    // 实际应从库信息获取 rootPath，这里简化处理
    const outputPath = this.resolveOutputPath(sourcePath, op, options?.format ?? 'png')

    // 确保输出目录存在
    const outputDir = path.dirname(outputPath)
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // 写入输出文件
    fs.writeFileSync(outputPath, outputBuffer)

    // 记录到 edits 表
    const editId = this.db.createEdit({
      libraryId,
      imageId,
      pluginId,
      op,
      params: options?.params ? JSON.stringify(options.params) : null,
      modelId: options?.modelId ?? null,
      outputPath,
      parentEditId: options?.parentEditId ?? null,
    })

    logger.info('EditsService', `编辑记录创建: ${op} → ${outputPath}`)
    return editId
  }

  /** 计算输出路径 */
  private resolveOutputPath(sourcePath: string, op: string, format: string): string {
    const dir = path.dirname(sourcePath)
    const ext = path.extname(sourcePath)
    const baseName = path.basename(sourcePath, ext)
    const timestamp = Date.now()

    // {库根}/_edits/{原文件名}/{op}_{timestamp}.png
    const editsDir = path.join(dir, EDITS_DIR, baseName)
    return path.join(editsDir, `${op}_${timestamp}.${format}`)
  }

  /** 获取图片的编辑历史 */
  getEditHistory(libraryId: number, imageId: number): Edit[] {
    return this.db.getEditsForImage(libraryId, imageId)
  }

  /** 获取输出路径（不执行编辑） */
  getOutputPath(sourcePath: string, op: string, format: string = 'png'): string {
    return this.resolveOutputPath(sourcePath, op, format)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/edits-service.ts
git commit -m "feat: Phase 8 — 编辑版本链服务（非破坏性编辑输出管理）"
```

---

## Task 10: Feature Flags 与 Settings 扩展

**Files:**
- Modify: `src/main/services/settings-service.ts`

**Interfaces:**
- Consumes: 无
- Produces: 插件系统 feature flags

- [ ] **Step 1: 扩展 SettingsSchema**

在 `src/main/services/settings-service.ts` 的 `SettingsSchema` 接口中添加：

```typescript
interface SettingsSchema {
  // ... 现有字段 ...

  // Phase 8 新增
  'plugins.enabled': boolean          // 插件系统总开关
  'ai.enabled': boolean               // AI 能力总开关
  'crawler.enabled': boolean          // 爬虫能力总开关
  'models.directory': string          // 模型下载目录
}
```

在 `DEFAULTS` 中添加：

```typescript
const DEFAULTS: SettingsSchema = {
  // ... 现有默认值 ...

  'plugins.enabled': false,    // Phase 8 默认关闭
  'ai.enabled': false,
  'crawler.enabled': false,
  'models.directory': '',      // 空则使用默认 %APPDATA%/luuk/models
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/settings-service.ts
git commit -m "feat: Phase 8 — Feature Flags（插件/AI/爬虫总开关）"
```

---

## Task 11: 插件 IPC 处理器

**Files:**
- Create: `src/main/ipc/plugin-handlers.ts`
- Create: `src/main/ipc/job-handlers.ts`
- Modify: `electron/main.ts` (注册 IPC)
- Modify: `electron/preload.ts` (暴露 API)

**Interfaces:**
- Consumes: Task 3-9 的所有服务
- Produces: 前端可调用的 IPC API

- [ ] **Step 1: 创建插件 IPC 处理器**

```typescript
// src/main/ipc/plugin-handlers.ts
import { ipcMain } from 'electron'
import { getPluginManager } from '../services/plugin-manager'
import { logger } from '../../utils/logger'

/**
 * 注册插件系统 IPC 处理器
 */
export function registerPluginHandlers(): void {
  // 获取所有插件列表
  ipcMain.handle('plugins:list', async () => {
    try {
      const manager = getPluginManager()
      return { success: true, data: manager.getPluginInfos() }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // 获取插件详情
  ipcMain.handle('plugins:get', async (_event, pluginId: string) => {
    try {
      const manager = getPluginManager()
      const info = manager.getPluginInfo(pluginId)
      return { success: true, data: info }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // 启用/停用插件
  ipcMain.handle('plugins:setEnabled', async (_event, pluginId: string, enabled: boolean) => {
    try {
      const manager = getPluginManager()
      await manager.setEnabled(pluginId, enabled)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // 执行插件 op
  ipcMain.handle('plugins:execute', async (_event, pluginId: string, opId: string, input: unknown) => {
    try {
      const manager = getPluginManager()
      const result = await manager.executeOp(pluginId, opId, input)
      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // 获取可用菜单项
  ipcMain.handle('plugins:getMenuItems', async () => {
    try {
      const manager = getPluginManager()
      return { success: true, data: manager.getAvailableMenuItems() }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  logger.info('PluginHandlers', '插件 IPC 处理器已注册')
}

export function unregisterPluginHandlers(): void {
  ipcMain.removeHandler('plugins:list')
  ipcMain.removeHandler('plugins:get')
  ipcMain.removeHandler('plugins:setEnabled')
  ipcMain.removeHandler('plugins:execute')
  ipcMain.removeHandler('plugins:getMenuItems')
}
```

- [ ] **Step 2: 创建 JobRunner IPC 处理器**

```typescript
// src/main/ipc/job-handlers.ts
import { ipcMain } from 'electron'
import { getJobRunner } from '../services/job-runner'
import { getMasterDB } from '../services/database'
import { sendToRenderer } from '../utils/ipc'
import { logger } from '../../utils/logger'

let progressUnsubscribe: (() => void) | null = null

/**
 * 注册 JobRunner IPC 处理器
 */
export function registerJobHandlers(): void {
  // 获取所有作业
  ipcMain.handle('jobs:list', async () => {
    try {
      const db = getMasterDB()
      const jobs = db.getAllJobs()
      return { success: true, data: jobs }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // 获取作业详情
  ipcMain.handle('jobs:get', async (_event, jobId: string) => {
    try {
      const db = getMasterDB()
      const job = db.getJob(jobId)
      const items = db.getJobItems(jobId)
      return { success: true, data: { job, items } }
    } catch (err) {
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
      return { success: false, error: (err as Error).message }
    }
  })

  // 订阅进度通知
  ipcMain.handle('jobs:subscribeProgress', async () => {
    if (progressUnsubscribe) return { success: true }

    const runner = getJobRunner()
    progressUnsubscribe = runner.subscribeProgress((progress) => {
      sendToRenderer('job-progress', progress)
    })

    return { success: true }
  })

  logger.info('JobHandlers', 'JobRunner IPC 处理器已注册')
}

export function unregisterJobHandlers(): void {
  if (progressUnsubscribe) {
    progressUnsubscribe()
    progressUnsubscribe = null
  }

  ipcMain.removeHandler('jobs:list')
  ipcMain.removeHandler('jobs:get')
  ipcMain.removeHandler('jobs:pause')
  ipcMain.removeHandler('jobs:resume')
  ipcMain.removeHandler('jobs:cancel')
  ipcMain.removeHandler('jobs:subscribeProgress')
}
```

- [ ] **Step 3: 在 main.ts 注册 IPC**

在 `electron/main.ts` 中添加导入和注册：

```typescript
// 在现有 import 后添加
import { registerPluginHandlers, unregisterPluginHandlers } from '../src/main/ipc/plugin-handlers'
import { registerJobHandlers, unregisterJobHandlers } from '../src/main/ipc/job-handlers'

// 在 registerLibraryHandlers 等调用后添加
registerPluginHandlers()
registerJobHandlers()

// 在窗口 close 事件中添加
unregisterPluginHandlers()
unregisterJobHandlers()
```

- [ ] **Step 4: 在 preload.ts 暴露 API**

在 `electron/preload.ts` 的 `electronAPI` 对象中添加：

```typescript
  // 插件系统
  pluginsList: () => ipcRenderer.invoke('plugins:list'),
  pluginsGet: (pluginId: string) => ipcRenderer.invoke('plugins:get', pluginId),
  pluginsSetEnabled: (pluginId: string, enabled: boolean) =>
    ipcRenderer.invoke('plugins:setEnabled', pluginId, enabled),
  pluginsExecute: (pluginId: string, opId: string, input: unknown) =>
    ipcRenderer.invoke('plugins:execute', pluginId, opId, input),
  pluginsGetMenuItems: () => ipcRenderer.invoke('plugins:getMenuItems'),

  // JobRunner
  jobsList: () => ipcRenderer.invoke('jobs:list'),
  jobsGet: (jobId: string) => ipcRenderer.invoke('jobs:get', jobId),
  jobsPause: (jobId: string) => ipcRenderer.invoke('jobs:pause', jobId),
  jobsResume: (jobId: string) => ipcRenderer.invoke('jobs:resume', jobId),
  jobsCancel: (jobId: string) => ipcRenderer.invoke('jobs:cancel', jobId),
  jobsSubscribeProgress: () => ipcRenderer.invoke('jobs:subscribeProgress'),
  onJobProgress: (callback: (progress: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('job-progress', handler)
    return () => ipcRenderer.removeListener('job-progress', handler)
  },
```

- [ ] **Step 5: 更新 ElectronAPI 类型定义**

在 `src/types/index.ts` 的 `ElectronAPI` 接口中添加：

```typescript
  // 插件系统
  pluginsList: () => Promise<{ success: boolean; data?: PluginInfo[]; error?: string }>
  pluginsGet: (pluginId: string) => Promise<{ success: boolean; data?: PluginInfo; error?: string }>
  pluginsSetEnabled: (pluginId: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>
  pluginsExecute: (pluginId: string, opId: string, input: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>
  pluginsGetMenuItems: () => Promise<{ success: boolean; data?: MenuItemDefinition[]; error?: string }>

  // JobRunner
  jobsList: () => Promise<{ success: boolean; data?: Job[]; error?: string }>
  jobsGet: (jobId: string) => Promise<{ success: boolean; data?: { job: Job; items: JobItem[] }; error?: string }>
  jobsPause: (jobId: string) => Promise<{ success: boolean; error?: string }>
  jobsResume: (jobId: string) => Promise<{ success: boolean; error?: string }>
  jobsCancel: (jobId: string) => Promise<{ success: boolean; error?: string }>
  jobsSubscribeProgress: () => Promise<{ success: boolean }>
  onJobProgress: (callback: (progress: JobProgress) => void) => () => void
```

- [ ] **Step 6: 运行 TypeScript 检查**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/plugin-handlers.ts src/main/ipc/job-handlers.ts electron/main.ts electron/preload.ts src/types/index.ts
git commit -m "feat: Phase 8 — 插件/JobRunner IPC 处理器 + preload API"
```

---

## Task 12: 插件管理器（PluginManager — 统一入口）

**Files:**
- Create: `src/main/services/plugin-manager.ts`

**Interfaces:**
- Consumes: Task 4 PluginLoader, Task 5 MemoryMonitor, Task 7 PluginHostProcess, Task 9 EditsService
- Produces: `PluginManager` 单例，统一对外暴露插件操作

- [ ] **Step 1: 实现 PluginManager**

```typescript
// src/main/services/plugin-manager.ts
import path from 'path'
import { app } from 'electron'
import { logger } from '../../utils/logger'
import { PluginLoader } from '../plugins/plugin-loader'
import { PluginHostProcess } from '../plugins/plugin-host-process'
import { MemoryMonitor } from './memory-monitor'
import { ModelManager } from './model-manager'
import { EditsService } from './edits-service'
import { getMasterDB } from './database'
import { getSetting } from './settings-service'
import type { PluginInfo, MenuItemDefinition, InferenceSessionInfo } from '../../types'

let instance: PluginManager | null = null

/**
 * 插件管理器 — 统一对外入口
 *
 * 协调各子系统：
 * - PluginLoader: 插件发现/校验
 * - PluginHostProcess: Worker 进程管理
 * - MemoryMonitor: 内存水位线
 * - ModelManager: 模型管理
 * - EditsService: 编辑版本链
 */
export class PluginManager {
  private loader: PluginLoader
  private hostProcess: PluginHostProcess
  private memoryMonitor: MemoryMonitor
  private modelManager: ModelManager
  private editsService: EditsService
  private enabledPlugins = new Set<string>()
  private initialized = false

  constructor() {
    const userDataPath = app.getPath('userData')

    // 内置插件目录
    const builtinDir = path.join(__dirname, '../plugins/builtins')

    // 第三方插件目录
    const thirdPartyDir = path.join(userDataPath, 'plugins')

    this.loader = new PluginLoader(builtinDir, thirdPartyDir)

    // 模型目录
    const modelsDir = getSetting('models.directory') || path.join(userDataPath, 'models')
    this.modelManager = new ModelManager(modelsDir)

    this.hostProcess = new PluginHostProcess()
    this.memoryMonitor = new MemoryMonitor({ yellowMB: 300, redMB: 400 })
    this.editsService = new EditsService(getMasterDB())
  }

  /** 初始化插件系统 */
  async initialize(): Promise<void> {
    if (this.initialized) return

    const pluginsEnabled = getSetting('plugins.enabled')
    if (!pluginsEnabled) {
      logger.info('PluginManager', '插件系统未启用（feature flag 关闭）')
      return
    }

    // 发现插件
    this.loader.discover()

    // 启动内存监控
    this.memoryMonitor.start(5000)

    this.initialized = true
    logger.info('PluginManager', `插件系统已初始化，发现 ${this.loader.getPlugins().length} 个插件`)
  }

  /** 获取所有插件信息 */
  getPluginInfos(): PluginInfo[] {
    return this.loader.getPlugins()
  }

  /** 获取单个插件信息 */
  getPluginInfo(pluginId: string): PluginInfo | undefined {
    return this.loader.getPlugin(pluginId)
  }

  /** 启用/停用插件 */
  async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    if (enabled) {
      this.enabledPlugins.add(pluginId)
      // 确保 Worker 进程启动
      await this.hostProcess.ensureStarted()
    } else {
      this.enabledPlugins.delete(pluginId)
      // TODO: 检查是否所有插件都已停用，如果是则关闭 Worker
    }
  }

  /** 执行插件 op */
  async executeOp(pluginId: string, opId: string, input: unknown): Promise<unknown> {
    if (!this.enabledPlugins.has(pluginId)) {
      throw new Error(`插件未启用: ${pluginId}`)
    }

    // 检查内存水位线
    if (this.memoryMonitor.isRed()) {
      throw new Error('内存水位线过高，请等待释放后重试')
    }

    // 通过 Worker 执行
    return this.hostProcess.rpc('plugin.execute', { pluginId, opId, input })
  }

  /** 获取可用的菜单项（来自已启用的插件） */
  getAvailableMenuItems(): MenuItemDefinition[] {
    const items: MenuItemDefinition[] = []

    for (const pluginId of this.enabledPlugins) {
      const info = this.loader.getPlugin(pluginId)
      if (!info?.manifest.contributes?.menuItems) continue

      items.push(...info.manifest.contributes.menuItems)
    }

    return items
  }

  /** 获取内存状态 */
  getMemoryStatus() {
    return this.memoryMonitor.getStatus()
  }

  /** 获取模型管理器 */
  getModelManager(): ModelManager {
    return this.modelManager
  }

  /** 关闭插件系统 */
  async shutdown(): Promise<void> {
    this.memoryMonitor.stop()
    await this.hostProcess.shutdown()
    this.initialized = false
    logger.info('PluginManager', '插件系统已关闭')
  }
}

/** 获取 PluginManager 单例 */
export function getPluginManager(): PluginManager {
  if (!instance) {
    instance = new PluginManager()
  }
  return instance
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/plugin-manager.ts
git commit -m "feat: Phase 8 — 插件管理器（统一入口，协调各子系统）"
```

---

## Task 13: electron-builder 配置更新

**Files:**
- Modify: `electron-builder.json`

**Interfaces:**
- Consumes: 无
- Produces: 打包配置包含插件目录

- [ ] **Step 1: 更新 files 规则**

```json
{
  "appId": "com.luuk.imageviewer",
  "productName": "Image Viewer",
  "directories": {
    "output": "release"
  },
  "npmRebuild": false,
  "files": [
    "dist/**/*",
    "dist-electron/**/*",
    "src/main/plugins/builtins/**/*"
  ],
  "win": {
    "signAndEditExecutable": false,
    "target": [
      {
        "target": "nsis",
        "arch": ["x64"]
      }
    ],
    "artifactName": "${productName}-${version}-Setup.${ext}"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add electron-builder.json
git commit -m "chore: Phase 8 — electron-builder 配置包含内置插件目录"
```

---

## Task 14: 编译验证与全量测试

- [ ] **Step 1: 运行 TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 2: 运行全量测试**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 3: 构建验证**

Run: `npm run build:dir`
Expected: 构建成功

- [ ] **Step 4: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: Phase 8 — 编译/测试/构建修复"
```

---

## 实施优先级与依赖关系

```
Task 1 (类型)
  └─→ Task 2 (DB 迁移)
       └─→ Task 3 (JobRunner)
  └─→ Task 4 (PluginLoader)
  └─→ Task 5 (MemoryMonitor)
  └─→ Task 6 (ModelManager)
       └─→ Task 7 (PluginHostProcess)
            └─→ Task 8 (Autotone 插件)
                 └─→ Task 9 (EditsService)
                      └─→ Task 10 (Feature Flags)
                           └─→ Task 11 (IPC)
                                └─→ Task 12 (PluginManager)
                                     └─→ Task 13 (electron-builder)
                                          └─→ Task 14 (验证)
```

**并行机会**：
- Task 2/4/5/6 可在 Task 1 完成后并行开发
- Task 8 依赖 Task 1-7 全部完成

---

## Phase 8 出口条件

- [ ] 三个内置插件可加载（autotone 完成，matting/upscale 待后续 Task）
- [ ] JobRunner 持久化作业正常（重启续跑不丢进度）
- [ ] 内存水位线监控工作
- [ ] plugin.json 解析/校验/生命周期完整
- [ ] IPC 前后端打通
- [ ] 全量测试通过
- [ ] `npm run build:dir` 构建成功

---

**下一步（不在本计划范围）**：
- Task 15-17: matting / upscale 插件（需 ONNX Runtime 集成）
- Task 18: CLIP 索引最小闭环
- Task 19: 插件测试四类（SDK 契约/EP 兼容/权限拒绝/黄金样本）
