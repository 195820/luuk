---
title: Tier 1 后续深度审计（2026-10）：并发正确性 / 推理宿主 / 量化误差 / media:// 安全
description: 六路并行深度审计汇总——JobRunner 作业管线、采集数据路径、EditsService、inference 宿主架构裁决、int8 量化误差数值分析、media:// token 与 IPC 安全审查；含四个分析任务包与 P0–P3 建议动作汇总
type: review
status: current
updated: 2026-10-16
---

# Tier 1 后续深度审计（2026-10）

> 本文件是零代码修改的纯分析轮交付物。tier1 A 系列（A-1…A-9，见 `tier1-ai-wiring-hnsw-phase10-plan.md` §A.0）只覆盖了 ai-wiring/agent/crawler 调度侧；本轮补齐六个未审计面的深度审计。所有发现以 recommended-action 形式记录，修复须另行批准后开修复轮执行。
>
> 方法：六路并行深度审计子代理（A1–A6），每个自含目标文件 + 已验证种子发现 + 核心问题清单。协调员对每条 CONFIRMED 发现**亲自重读 file:line 锚点核对**，裁决子代理间矛盾（本文件收录的行号与结论均为协调员重读后的版本，子代理原始报告中的行号若有出入以本文件为准）。

## §0 审计范围与方法

| 单元 | 目标 | 发现落点 |
|---|---|---|
| A1 JobRunner | `job-runner.ts` + `database.ts` 作业管线 + `image-service.ts`/`file-handlers.ts`/`crawler-service.ts`/`ai-wiring.ts` 注册点 | 本文件 §A |
| A2 Crawler 数据路径 | `downloader.ts`/`intake.ts`/`crawl-item-store.ts` + `proposal-import.ts` | 本文件 §B |
| A3 EditsService+缓存 | `edits-service.ts`(82 行)/`cache.ts`/`file-service.ts` 缓存失效链 | 本文件 §C |
| A4 InferenceHost | `plugin-worker.ts` stubs/`plugin-host-process.ts`/`memory-monitor.ts` + Phase 8 规划 | 本文件 §D |
| A5 Quant | `onnx-clip-engine.ts`/`text-encoder.ts`/`tag-suggester.ts`/`ann-index.ts` + poc-t22 实测 | 本文件 §E |
| A6 Security | `media-registry.ts`/`electron/main.ts` 协议/`preload.ts`/全部 IPC handlers/`path-safe.ts` | 本文件 §F |

> 六份子代理原始报告为会话期工件，不入库；§A–§F 为其经协调员逐锚点核对后的收录版本，本文件是仓库内唯一权威记录。

**严重度口径**（同 tier1 §A.0）：P0=用户可见数据损坏/静默错果；P1=常规操作下竞态/泄漏；P2=边界正确性缺口；P3=卫生。

**协调员终裁覆盖子代理结论的点**（细节见各节内「裁决」标注）：
- A6 S-12（token 1 小时陈旧窗口）**REFUTED**：协议处理器对每次请求动态校验当前库根白名单，库移除后 token 立即 403，无陈旧访问窗口（内存占用问题成立，P3）。
- A6 S-14（scanner 跟随 symlink 遍历库外）**REFUTED**：`readdirSync(dir,{withFileTypes:true})` 的 Dirent 为 lstat 语义，symlink 条目 `isDirectory()`/`isFile()` 均为 false，scanner 天然不跟随。
- A6 S-3（getAudioUrl 安全绕过）重裁为**功能缺陷 P2**：协议处理器对每次请求动态校验库根白名单（非 token 注册时快照）→ 静默 403 挫败 getAudioUrl 的设计意图。
- A1 JR-6 改写：abort 经 `Promise.race` 的 abortPromise 拒绝（与 handler 是否响应无关），中断项必被重置 pending；真发现是反向的 resume 重复执行风险。
- A3 EC-4 的 FK 半点修正：`database.ts:238` 已 `pragma('foreign_keys = ON')`，FK 约束已启用。
- A2 C-6 半点修正：sidecar 自身是 tmp+rename 原子写，报告原文准确；「非原子」仅指 sidecar 与 crawl_items 行不在同一事务（设计已文档化）。

**本轮严重度全景：无 P0。** P1 两条：C-1（file_hash 无唯一索引并发双摄入）、IH-2（MemoryMonitor 只看主进程 RSS）。S-3/S-8 的子代理 P1 定级经裁决均降级（见 §F）。

**测试基线**：808 passed / 2 skipped（73 files，Node v25.9.0 imageviewer conda 环境，2026-10-10 实测）。本轮零代码修改，不动基线。

---

## §A A1 —— JobRunner 持久化作业管线

### 发现表

| ID | 位置(file:line) | 严重度 | 状态 | 一句话结论 |
|---|---|---|---|---|
| JR-1 | `database.ts:1269-1274` | P3 | CONFIRMED | `recoverInterruptedJobs` 两条 UPDATE 未包事务；崩溃分叉下次启动自愈，残余为惯例不一致 |
| JR-2 | `job-runner.ts:30` + `database.ts:1235` | P3 | CONFIRMED | `priority` 字段存在但出队排序从未使用，注释声称「优先级队列」未实现 |
| JR-3 | `database.ts:104,1220` + `job-runner.ts:217` | P2 | CONFIRMED | `attempt` 列存在但从未递增，失败项永驻 attempt=0，无 max attempts 保护 |
| JR-4 | `job-runner.ts:47-49` | P2 | CONFIRMED | `registerHandler` 静默覆盖同名 kind，无冲突检测或日志 |
| JR-5 | `job-runner.ts:70-74` | P2 | CONFIRMED | `enqueue` 的 createJob 与 createJobItems 非原子，崩溃窗口可致 job 存在但 items 缺失 |
| JR-6 | `job-runner.ts:171-206` | P2 | CONFIRMED（改写） | cancel 后 resume 同项重跑：race 放弃等待但底层 handler 仍在执行，非幂等 handler 产生重复副作用 |
| JR-7 | `file-handlers.ts:29-64,211-213` | P3 | CONFIRMED | export.batch 单复合项台账：进度覆写 jobs 行而非 job_items，设计权衡已注释但语义未入 job-runner 文档 |

### JR-1 recoverInterruptedJobs 非事务（P3，自愈口径）

**证据**（database.ts:1269-1274，协调员亲读）：

```typescript
const result = this.db.prepare(
  "UPDATE jobs SET state = 'paused', updated_at = ? WHERE state = 'running'"
).run(now)
this.db.prepare(
  "UPDATE job_items SET state = 'pending', updated_at = ? WHERE state = 'running'"
).run(now)
```

两条独立 UPDATE，无 `this.db.transaction()` 包裹——对比同文件 `createJobItems:1222`、`updateJobItemState:1251` 均用事务。

**风险裁决（自愈口径）**：进程在两条 UPDATE 之间崩溃留下的 jobs=paused / job_items=running 分叉**会在下次启动自愈**——recoverInterruptedJobs 每次启动都重跑（image-service.ts:116），第二条 UPDATE 无条件把 running items 转回 pending，不依赖 jobs 行状态。不存在「作业卡死 paused」的永久态；分叉仅存在于崩溃后至下次启动前的停机窗口，而该窗口内进程已死、无读者。

**已有防线**：调用时机在启动初始化（image-service.ts:116），此时无并发写入；better-sqlite3 WAL 模式下单条 UPDATE 原子。

**建议动作**：两条 UPDATE 包入 `this.db.transaction(() => {...})()`——纯惯例一致性收益（对齐 createJobItems/updateJobItemState 的事务惯例），非缺陷修复。

### JR-2 priority 死字段（P3）

**证据**：表结构声明 priority 列（database.ts:89）；enqueue 接收并写入（job-runner.ts:62-67, database.ts:1183）；注释声称「优先级队列（高优先级先执行）」（job-runner.ts:30）。但 `getJobItems` 排序仅 `ORDER BY id`（database.ts:1235），executeJob 主循环（job-runner.ts:167）无 priority 参与。

**已有防线**：所有调用方 enqueue 时 priority 默认 0，无实际优先级场景。

**建议动作**：删除注释中的「优先级队列」声明，或实现 `ORDER BY priority DESC, id`。当前状态误导读者。

### JR-3 attempt 列永不递增（P2）

**证据**：job_items 定义 attempt 列（database.ts:104）初始化 0（database.ts:1220）；失败路径 `updateJobItemState` 仅更新 state/error/updated_at（database.ts:1249）；job-runner.ts 全文 `attempt` 零匹配，L217 标 failed 不递增。

**已有防线**：失败项转 failed 终态不自动重试；用户手动 resume 仅处理 pending 项（job-runner.ts:167），failed 不参与 → 无限重试实际不可达。

**建议动作**：(a) 删除 attempt 列，或 (b) 失败时 attempt++ 并实现 max attempts 转终态。当前状态是死列。

### JR-4 registerHandler 静默覆盖（P2）

**证据**（job-runner.ts:47-49）：

```typescript
registerHandler(kind: string, handler: JobItemHandler): void {
  this.handlers.set(kind, handler)
}
```

Map.set 静默覆盖。注册点亲验：image-service.ts:416（image.phash-backfill）、file-handlers.ts:31（export.batch）、crawler-service.ts:118（agent.crawler-discovery）、ai-wiring.ts:280/372/412（ai.index/label/quality）。

**已有防线**：image-service.ts:415 有 `if (this.phashHandlerRegistered) return` 幂等守卫；当前所有 kind 字符串唯一。

**建议动作**：`registerHandler` 加冲突 warn 日志（覆盖时记录），一处三行改动。

### JR-5 enqueue 崩溃窗口（P2）

**证据**（job-runner.ts:70-74）：`createJob` 与 `createJobItems` 两次独立 DB 调用。createJob 单条 INSERT（database.ts:1182-1185），createJobItems 自带事务（database.ts:1222-1227），但两者不在同一事务。

**风险场景**：createJob 成功后、createJobItems 前崩溃 → jobs 有行（total=N）但 job_items 零行；recoverInterruptedJobs 转 paused 后 getJobItems 返回空，作业卡死（用户可手动 cancel）。

**已有防线**：崩溃窗口极窄（两行代码间无 await）；用户可手动 cancel 卡死作业。

**建议动作**：合并入同一事务，或 enqueue 后校验 items 数量与 total 匹配。

### JR-6 cancel→resume 同项重跑（P2，协调员改写版）

**证据**（job-runner.ts:165-206，协调员亲读）：

```typescript
await Promise.race([handler(item), abortPromise])   // L187
...
if (value?.interrupted) {
  this.db.updateJobItemState([value.itemId], 'pending' as JobItemState)  // L205-206
  continue
}
```

**裁决（推翻子代理「items 永驻 running」表述）**：`Promise.race` 在 abort 时经 abortPromise 立即拒绝——**与 handler 是否响应 abort 无关**，L190-191 捕获后标 interrupted，L205-206 必然重置回 pending。中断项不会永驻 running。

**真发现（反向）**：race 放弃等待后，底层 `handler(item)` 的 Promise 仍在执行（Node 不取消）。若用户随后 resume，同 item 重入 handler → **两个 handler 实例并发跑同一项**。对幂等 handler（phash 回填）无害；对 `export.batch` 这类有外部副作用（写 ZIP 文件）且取消观察点依赖轮询台账的 handler，可能产生重复导出/文件竞争。tier1 A-9「JobRunner 无取消语义」已知限制的补充面。

**建议动作**：文档化 handler 契约（「interrupted 项将在 resume 后重跑，handler 必须幂等或可安全重入」）；或在 resume 时等待上轮 in-flight handler 完结（`pendingExecutions` 已有集合可用，job-runner.ts:155）。

### JR-7 export.batch 复合项台账（P3，设计权衡）

**证据**（file-handlers.ts:29-64，协调员亲读）：入队单复合项 `{libraryId, imageId:null}`（file-handlers.ts:211-213）；进度经 `updateJobState(jobId,'running',done,0)` 覆写 jobs 行（L46），非 job_items 逐项更新；取消观察点轮询台账 state==='cancelled'（L39-44）；成功收口复查终态防 cancelled 覆写（L53-58）；finally 清理内存参数表防映射泄漏（L59-63）。

**已有防线**：设计意图已注释（L29, L210）；export-progress 事件桥接旧 UI，ExportDialog 零改动。

**建议动作**：非缺陷。在 job-runner.ts 文档化「复合项」模式，或提供 `enqueueComposite` API 明确语义。

---

## §B A2 —— 采集数据路径（downloader / intake / crawl-item-store）

### 发现表

| ID | 位置(file:line) | 严重度 | 状态 | 一句话结论 |
|---|---|---|---|---|
| C-1 | `database.ts:183-196` + `crawl-item-store.ts:83-86,105-123` | **P1** | CONFIRMED | `crawl_items.file_hash` 列无唯一索引且无普通索引，并发 intake 会静默双摄入同文件（双行 + 双磁盘副本） |
| C-2 | `downloader.ts:63-65,149-157` | P2 | CONFIRMED | `shortUrlHash` 仅 48bit（12 hex），碰撞时 `fs.existsSync(finalPath)` 误判已存在，alreadyPresent 短路返回错误文件路径 |
| C-3 | `intake.ts:138-173` | P2 | CONFIRMED | intake insert 失败路径：文件已落盘但 DB 插入失败 → 孤儿文件无人清理，sidecar 也不写 |
| C-4 | `downloader.ts:180-231` | P2 | CONFIRMED | 缺 ETag/强校验器时 `.part` 续传：两次尝试间服务器内容变化 → 脏拼接文件仍通过 SHA256（finalize 重算整文件但无期望值可对照） |
| C-5 | `intake.ts:138-154` | P2 | CONFIRMED（部分） | pHash 级去重在文件已写入磁盘后才短路，skippedPhash 路径留孤儿文件；skippedFile 半边经裁决无 bug（见下） |
| C-6 | `intake.ts:165-208` | P3 | CONFIRMED | sidecar 与 crawl_items 行非同事务；sidecar 自身是 tmp+rename 原子写，DB 权威 sidecar 兵底是有意设计 |
| C-7 | `intake.ts:36-45,102-109` | P2 | CONFIRMED | `file://` pc-app 路径仅 existsSync 无范围校验，恶意/错配第三方插件可把库外文件登记为已采媒体（与 A6 S-8 合并收录，框架以本节为准） |
| C-8 | `downloader.ts:155-157,234-243` + `intake.ts:140` | P3 | UNCERTAIN | alreadyPresent 路径不返 sha256，由 intake `hashFile` 兜底重算——功能成立但契约未声明，与 C-2 联动时有静默错果面 |

### C-1 file_hash 无唯一索引 → 并发双摄入（P1，本轮最重发现）

**证据**（database.ts:183-196，协调员亲读）：

```sql
CREATE TABLE IF NOT EXISTS crawl_items (
  ...
  url_hash      TEXT NOT NULL,   -- 唯一索引
  file_hash     TEXT,            -- SHA256（第二级），下载后填
  phash         TEXT, ...
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crawl_items_url_hash ON crawl_items(url_hash);
```

仅 `url_hash` 有唯一索引（database.ts:196）；`file_hash` 既无 UNIQUE 也无普通 INDEX。`crawl-item-store.ts:83-86` 的 `fileSeen` 用 `SELECT 1 FROM crawl_items WHERE file_hash = ?` 全表扫描。

**风险场景**：两个并发 `intake.process`（如 JobRunner 批内执行 + 用户手动 triggerCrawlDiscovery 同时触发；或两个不同 sourceId 都爬到同一张图）在双方都未写入前同时通过 fileSeen 检查 → 双行 + 双磁盘副本，静默发生。url_hash 唯一索引只挡同 URL 双写，挡不住不同 URL 同内容。

**已有防线**：`CrawlerService.runSourceRound` 单来源串行（crawler-service.ts:138 起），同 sourceId 不并发；url_hash UNIQUE 阻止同 URL 双写。

**建议动作**：补 partial unique index `CREATE UNIQUE INDEX IF NOT EXISTS idx_crawl_items_file_hash ON crawl_items(file_hash) WHERE file_hash IS NOT NULL`（failed 行无 file_hash 不冲突），走 tolerant 迁移；或 intake 层 `INSERT ... ON CONFLICT(file_hash) DO NOTHING` 据 returned rowid 判胜者，败方删磁盘文件。

### C-2 shortUrlHash 48bit 碰撞 → alreadyPresent 错文件（P2）

**证据**（downloader.ts:63-65）：

```typescript
export function shortUrlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 12)
}
```

12 hex = 48bit ≈ 2.8×10¹⁴ 空间，生日边界 ≈ 1.7×10⁷ 条 URL 达 50% 碰撞概率。downloader.ts:149-157 拼出 `finalPath = join(baseDir, target.dir, baseName_hash.ext)` 后 `fs.existsSync(finalPath)` 命中即返回 `alreadyPresent: true`（不带 sha256）。

**风险场景**：URL A 与 URL B 满足 nameHint 相同 + 扩展名相同 + 48bit hash 相同 → 同 finalPath。A 先落地，B 到达时 existsSync 命中，返回 A 的磁盘路径作为 B 的「已存在」；intake.ts:140 `a.sha256 ?? hashFile(filePath)` 按 A 的字节算 file_hash 写入 B 的行——B 的真实内容从未落盘也从未校验。

**已有防线**：baseName 含 nameHint（album 标题），跨 album 不撞；千级 URL 规模下生日概率 <10⁻⁶；恶意构造（攻击者控制 CDN URL）可触发。

**建议动作**：shortUrlHash 扩到 16-24 hex；alreadyPresent 路径补 sha256 回传（finalize 已有能力），与 C-8 一并修。

### C-3 intake insert 失败 → 孤儿文件（P2）

**证据**（intake.ts:138-173，协调员亲读）：

```typescript
try {
  const id = this.deps.items.insert(input)
  this.writeSidecar(filePath, source, id, url, draft.sourceUrl)
  result.ingested++
} catch (err) {
  result.failed++
  logger.warn(LOG_KEY, `crawl_items 写入失败: ${url}: ${err}`)
}
```

文件已在 acquired 阶段落盘；insert 失败（磁盘满/DB 锁/UNIQUE 并发冲突）时文件留磁盘、无行指向、sidecar 未写（writeSidecar 在 insert 之后）、无清理路径。后续 scanner 排除 `_downloads`、proposal-import 只按行迁移，孤儿永不可达。

**已有防线**：downloader.ts:194 仅在 HTTP 错误时 rm .part（限下载阶段，不管 intake）；failed 计数 + warn 日志运维可见。

**建议动作**：catch 块内 best-effort `fs.rm(filePath)`（失败只 log）；或引入 `.pending` 两段式（先落暂存名，insert 成功后 rename，失败由定期清理扫掉）。

### C-4 .part 续传无 ETag/If-Range 校验 → 脏拼接（P2）

**证据**（downloader.ts:180-231，协调员亲读）：

```typescript
const existing = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0
const headers = { ..., ...(existing > 0 ? { Range: `bytes=${existing}-` } : {}) }
...
const resumed = res.status === 206
const out = fs.createWriteStream(partPath, resumed ? { flags: 'a' } : { flags: 'w' })
```

发 Range 前不比对 ETag/Last-Modified/If-Range。服务端已替换资源时返回 206 + 新内容后半段 → 与 .part 旧前段拼接 → 字节流是新旧混合体。finalize（downloader.ts:234-243）对拼接结果全量 SHA256 后 rename——该 SHA256 是「落盘字节流的指纹」，**无期望值可对照**（CandidateDraft 不携带文件 hash），脏拼接被当合法入库；pHash 基于损坏字节，后续相似重查也错。

**已有防线**：416 状态码按已完成处理（downloader.ts:189-192）安全；服务端严格合规时资源变更应回 200 走 `flags:'w'` 截断重来——但实际 CDN 常不合规；sharp 解码损坏文件会抛错（缩略图失败可见），但行已写入。200 路径正确，仅 206 路径有此缺陷。

**建议动作**：首次请求时记录响应 ETag/Last-Modified 到 `.part.meta`，续传前比对不一致则删 .part 从 0 重下；或 CandidateDraft 协议增加可选 `expectedSha256`，finalize 对照校验。

### C-5 skippedPhash 留孤儿 / skippedFile 裁决（P2，部分收录）

**证据**（intake.ts:138-154，协调员亲读）：

```typescript
if (this.deps.items.fileSeen(fileHash)) { result.skippedFile++; continue }
...
if (phash && this.deps.items.findPhashDuplicate(phash, threshold)) {
  result.skippedPhash++
  continue   // ← 新文件已在磁盘，无清理
}
```

**skippedPhash 半边成立**：近重命中时新文件与既有文件内容不同（只是感知相近），新下载文件纯孤儿——`continue` 无 `fs.rm`。

**skippedFile 半边裁决为无 bug**：同内容不同 URL 命中既有行，既有行仍指向原文件路径，新文件仅多一个磁盘副本（alreadyPresent 复用机制下同 finalPath 不重复下载；「不同 URL 同内容」场景才多副本）。既有行的 file_hash 指向的字节与新文件一致，数据无错果。

**已有防线**：日志 warn 记录 skipped 数量；alreadyPresent 机制限制重复下载面。

**建议动作**：skippedPhash 路径 best-effort `fs.rm(filePath)`；skippedFile 场景的「既有行文件被外部移走」可另作收养逻辑（比对新文件与既有行指向，缺失则 update image_path），优先级低。

### C-6 sidecar 与 DB 行非同事务（P3，按报告原文收录）

**证据**（intake.ts:165-208，协调员亲读）：insert 成功后立即 writeSidecar，sidecar 失败只 log 不回滚 insert；sidecar 自身是 tmp+rename 原子写（intake.ts:197-203，注释「原子写：先写 .tmp 再同卷 rename（硬约束 #5）」）。sidecar 与 crawl_items 行不在同一事务。

**裁决**：非 bug——DB 是权威，sidecar 是溯源兵底副本（intake.ts:23 注释），accept 迁移容忍 sidecar 缺失（proposal-import.ts:176 `if (fs.existsSync(scFrom))`）。

**建议动作**：维持现状；sidecar 失败时记结构化告警（当前只 log warn），便于运维统计。

### C-7 file:// pc-app 路径无范围校验（P2，与 A6 S-8 合并收录）

**证据**（intake.ts:36-45,102-109，协调员亲读）：

```typescript
export function localPathFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
  } catch {
    return url.replace(/^file:\/\//, '')
  }
}
...
if (isLocalMediaUrl(url)) {
  const p = localPathFromUrl(url)
  if (!fs.existsSync(p)) { result.failed++; continue }
  acquired.push({ url, draft, filePath: p })
}
```

仅 existsSync，不校验路径是否落在已知库根或 `_downloads` 暂存区。风险链：恶意/错配第三方 pc-app 插件构造 `file:///C:/Windows/...` → intake 登记系统文件为已采媒体 + sidecar 写副作用（`{path}.luuk-provenance.json`）+ accept 时 `insideStaging` 判定不在 `_downloads` 内则 `copyInto` 把系统文件复制进用户库（proposal-import.ts:171-173）。

**裁决（与 A6 S-8 合并，采纳 A2 框架）**：A6 原定 P1 高估——前提是恶意插件，而内置 pc-app 适配器（tg-mtproto/tg-export-import）是受信代码；plugin-loader kind 白名单限制第三方类型。定级 P2：边界正确性缺口（信任边界缺失），非当前可利用漏洞。

**已有防线**：内置适配器受信；kind 白名单；C1 人在回路护栏（仅 _downloads 内允许搬移，库外原件只复制）。

**建议动作**：intake 接收 file:// URL 时校验 `path.resolve(p)` 必须落在 `getDownloadRoot(source)` 的 `_downloads` 子树下，否则 failed + warn；或在 `CrawlerIntakeDeps` 注入 `allowedLocalPrefixes: string[]` 便于单测替身。

### C-8 alreadyPresent 不返 sha256（P3/UNCERTAIN）

**证据**：downloader.ts:155-157 alreadyPresent 分支不返回 sha256；intake.ts:140 `a.sha256 ?? hashFile(filePath)` 兜底重算。功能成立（fileHash 始终有值），但：(a) 大文件重复全量读的性能损耗；(b) 契约未声明；(c) 与 C-2 联动时 hashFile 算的是错文件的 sha256，静默错果。

**建议动作**：downloader alreadyPresent 路径回传 sha256（或维护 `{finalPath→sha256}` 进程内缓存）；在 DownloadResult 类型注释声明兜底契约。

---

## §C A3 —— EditsService 与缓存失效链

### 发现表

| ID | 位置(file:line) | 严重度 | 状态 | 一句话结论 |
|---|---|---|---|---|
| EC-1 | `edits-service.ts:75-81` | P2 | CONFIRMED | getOutputPath 的 op 参数未消毒，path.join 可携 `/`/`..` 逃逸 _edits；当前零调用方（亲验），Phase 10 接入前必修 |
| EC-2 | `file-service.ts:135-194` | P2 | CONFIRMED | deleteFiles 后零 LRU 缓存失效：陈旧缩略图续供 + 内存浪费；rename/move 场景 imageId 键不变无实际 bug |
| EC-3 | `edits-service.ts:79-80` | P3 | CONFIRMED | Date.now() 毫秒粒度，同毫秒同图同 op 碰撞覆盖（当前零调用方，概率极低） |
| EC-4 | `edits-service.ts` 全文 | P3 | CONFIRMED（修正版） | 原图删除无级联清理 edits 记录 → 孤儿编辑记录 + _edits 文件残留；FK 约束**已开启**（database.ts:238 `pragma('foreign_keys = ON')`，子代理「未确认开启」被推翻） |
| EC-5 | `edits-service.ts:38-39` | P3 | CONFIRMED | `fs.mkdirSync` 同步阻塞主进程事件循环（首次建目录数百毫秒，后续 no-op） |
| EC-6 | `scanner.ts:391-393` | -- | 防线确认 | scanner 正确排除 `_edits`，编辑产物不会自我递归入库 |

### EC-1 op 参数未消毒 → _edits 路径逃逸（P2，Phase 10 前置必修）

**证据**（edits-service.ts:75-81，协调员亲读）：

```typescript
getOutputPath(sourcePath: string, op: string, format?: string): string {
  const ext = format ?? 'png'
  const dir = path.dirname(sourcePath)
  const baseName = path.basename(sourcePath, path.extname(sourcePath))
  const timestamp = Date.now()
  return path.join(dir, '_edits', baseName, `${op}_${timestamp}.${ext}`)
}
```

可逃逸字符串（协调员亲验 join 语义）：Windows op=`..\..\escape` → 输出含 `..\..\escape_...png`，resolve 后逃出 _edits 到上级目录；Unix op=`../../escape` 同理；跨平台 op=`auto/tone` 在 Unix 下 posixpath.join 拆分创建子目录。

**调用方亲验（零）**：grep 全仓 `getEditsService|executeOp` —— `EditsService.createEdit` 唯一调用方是自身（edits-service.ts:35），经 `PluginManager.getEditsService()`（plugin-manager.ts:229-232）暴露但无外部消费方；`plugins:execute` IPC 走 Worker RPC 到插件 activate() 返回的 handler，autotone 的 handler（autotone/index.ts:123-131）接收宿主传入的 outputPath，不经过 EditsService。**当前无渲染进程可达路径**。

**已有防线**：零调用方即零暴露；scanner 排除 _edits 防产物递归。

**建议动作**：`getOutputPath` 内对 op 白名单消毒（`op.replace(/[\/\\]/g,'_')`），写入前验证 `path.resolve(outputPath)` 以 `path.resolve(dir,'_edits')` 开头。**Phase 10（LaMa/inpaint 接入 createEdit）前必须落地。**

### EC-2 deleteFiles 后零缓存失效（P2）

**证据**（file-service.ts:135-194，协调员亲读）：deleteFiles 走 trash 后操作 master.db（addDeletedFile/removeFavorite/removeHistoryByPath）与 thumbs.db（markAsDeleted），**零 cache 失效调用**；file-service.ts:1-9 import 列表无任何 cache 引用。缓存键 = `${libraryId}-${imageId}`（image-service.ts:638）。

**裁决（半边成立）**：rename/move 场景 imageId 不变（thumbs.db 行只更新 relative_path），键仍有效、缩略图内容不变 → **无实际 bug**。delete 场景：LRU 陈旧条目续供至自然淘汰（200MB 上限），若前端竞态下仍请求已删图片缩略图会命中陈旧条目；主害是内存浪费。

**已有防线**：`clearCache()` 存在但仅 shutdown 调用（image-service.ts:1262-1274）；LRU 200MB 自然淘汰；前端查询应过滤 deleted 行。

**建议动作**：deleteFiles 成功后调 `invalidateByImageId(libraryId, imageId)`（LRU 需新增按前缀/精确键删除接口），file-service import getLRUCache。

### EC-3 同毫秒碰撞覆盖（P3）

**证据**（edits-service.ts:79-80）：`Date.now()` 毫秒粒度 + `${op}_${timestamp}.${ext}`。同 sourcePath+同 op 同毫秒两次调用 → 同输出路径，writeFile 覆盖；edits 表两行（不同自增 id）指向同一物理文件，版本链错乱。

**建议动作**：追加 `crypto.randomBytes(2).toString('hex')` 后缀，或 createEdit 入口 per-image 互斥。当前零调用方，优先级低。

### EC-4 原图删除无级联清理 edits（P3，修正版收录）

**证据与裁决**：A3 原报「FK 未确认开启」被协调员推翻——`database.ts:238` 明确 `pragma('foreign_keys = ON')`，FK 约束已启用，`parent_edit_id REFERENCES edits(id)` 有效。剩余实质问题：file-service deleteFiles 只 trash 原图，无级联清理——edits 表残留孤儿记录，`_edits/{baseName}/` 下输出文件残留。无 deleteEdit 方法（链不因删除断裂），getEditsForImage 按 created_at 排序不依赖 parent 链（database.ts:1293-1298）。

**建议动作**：deleteFiles 时级联删除该图 edits 记录 + 清理 _edits 子目录（或标记 orphaned 留待用户处理）。

### EC-5 mkdirSync 同步阻塞（P3）

**证据**（edits-service.ts:38-39）：`fs.mkdirSync(outputDir, {recursive:true})` 在主进程同步执行，首次建目录涉磁盘 I/O 可数百毫秒；后续 recursive no-op。写入本身已是 `fs.promises.writeFile`（L42）。

**建议动作**：改 `await fs.promises.mkdir(outputDir, {recursive:true})`，一行改动。

### EC-6 防线确认：scanner 排除 _edits

**证据**（scanner.ts:391-393，协调员亲读）：目录遍历跳过 `.` 前缀、`node_modules`、`_downloads`、`_edits`。编辑产物不会自我递归入库。附带排查：LRU 的 currentSizeBytes 在 set/delete/clear/trim 中记账正确（cache.ts:38-118），base64 估算 `length*0.75` 合理。

---

## §D A4 —— InferenceHost 宿主架构裁决

### 发现表

| ID | 位置(file:line) | 严重度 | 状态 | 一句话结论 |
|---|---|---|---|---|
| IH-1 | `electron/plugin-worker.ts:146-166` + `src/types/plugin.ts:209-211` | P3 | CONFIRMED | inference.createSession/run/destroySession 三 stub 纯 TODO 占位，全仓零调用方——死协议面 |
| IH-2 | `src/main/services/memory-monitor.ts:44` | **P1** | CONFIRMED | MemoryMonitor 只采主进程 RSS，utilityProcess 内模型/张量内存不可见——水位线可长期绿而 worker 已 OOM |
| IH-3 | `src/main/plugins/plugin-host-process.ts:192-197` | P2 | CONFIRMED | RPC 层 postMessage 未用 transferList，TypedArray 走 structured clone 全量拷贝（512 维 f32 单次 2KB；当前无真实张量传输未暴露） |
| IH-4 | `src/types/plugin.ts:16` + `plugin-loader.ts:21` | P3 | CONFIRMED | `'inference'` 权限在白名单但零插件声明——与 IH-1 配套的死权限 |

### IH-1 inference.* 三 stub 死协议面（P3）

**证据**：plugin-worker.ts:147-151/153-160/162-166 三个 registerHandler 各为 TODO 注释 + 假成功返回（createSession 返 sessionId 字符串、run 返空 results、destroySession 返 `destroyed:true`）；plugin.ts:209-211 定义 WorkerRpcRequest 联合类型中三 method 的 params 签名。协调员 grep `inference\.(createSession|run|destroySession)` 亲验：除定义方（plugin-worker.ts）、类型声明方（plugin.ts）、Phase 8 规划文档外**零调用方**。

**建议动作**：随裁决 (b) 删除三 stub + 三行类型声明（见下方裁决），保留 plugin-loader.ts:21 权限白名单项。

### IH-2 MemoryMonitor 的 worker RSS 盲区（P1）

**证据**（协调员亲读）：memory-monitor.ts:44 `const rssBytes = process.memoryUsage().rss` 只读主进程 RSS。plugin-worker.ts:78-96 有独立 getMemoryStatus/getMemoryStats 读 worker 自身 RSS，但仅经 `memory.getStatus` RPC **被动应答**——plugin-host-process.ts 无任何代码周期性拉取，主进程 MemoryMonitor 从不聚合。

**量化后果**：Phase 10 插件侧模型（SAM2 encoder 128MB + LaMa fp32 198MB）在 worker 加载时主进程 RSS 不变，水位线持续 green，直到 worker 触 Electron utilityProcess 内存上限被强杀。

**已有防线**：worker 侧采集能力已具备（被动上报的硬件基础在），缺的只是主进程拉取/聚合。

**建议动作**：MemoryMonitor.refresh() 聚合 `rss = mainRss + workerRss`——PluginHostProcess 新增 `getWorkerRss()`（经 `memory.getStats` RPC 取 worker rss 字段），或 worker 每 5s 主动 postMessage 上报（push 模型，避免 RPC 往返）。**Phase 10 引入插件侧模型前为前提修复。**

### IH-3 postMessage 无 transferList（P2）

**证据**（plugin-host-process.ts:192-197，协调员亲读）：`this.worker!.postMessage({type:'rpc-request', id, method, params})` 只传一参，未传第二参 transferList。Node/Electron postMessage 第二参为 ArrayBuffer[] 时启用 zero-copy transfer（发送方 detach，接收方零拷贝）；当前实现下 params 内任何 TypedArray 走 structured clone 深拷贝。

**已有防线**：inference.run 返回空 results，无真实张量传输，问题未暴露。

**建议动作**：Phase 10 若走插件侧推理，rpc() 须支持 `transferables` 参数（rpc\<T\>(method, params, transferables?)），worker 侧 handleMessage 返回时也标记 ArrayBuffer 为 transferable；或改 SharedArrayBuffer + Atomics 握手。选型写入 Phase 10 计划，本轮不实现。

### IH-4 'inference' 死权限（P3）

**证据**：plugin.ts:16 定义 `'inference'` 为 PluginPermission 成员；plugin-loader.ts:21 列入 VALID_PERMISSIONS；全仓零 plugin.json 清单声明此权限。

**建议动作**：保留。Phase 10 插件若需在 worker 内加载 ONNX 须重新定义语义为「允许插件自身在 worker 内加载模型」（配合 plugin.ts:40 已有的 `requires.runtime:'onnx'` 字段）。

### A4 裁决：三拓扑选项矩阵 → 选 (b) 全主进程，删三 stub

| 选项 | 内容 | 裁决 |
|---|---|---|
| (a) 双轨 | 主进程 CLIP 保持 + worker 侧建第二推理协议面（inference.*）服务插件变换 | 否决：inference.* 从未被调用，双轨 = 双倍状态机/内存监控/卸载语义，收益为零 |
| (b) 全主进程 | **采纳**。CLIP 主进程路径完整稳定（ai-wiring 会话管理/引用计数/idle TTL）；删三 stub + 三行类型；Phase 10 插件侧模型变换走 plugin.execute 内聚会话，不引入 inference.* 第二协议面 | ✓ |
| (c) 全 worker | ONNX 迁入 plugin-worker | 否决：**破坏 C1 零原生门禁**——worker 由插件系统启动独立于 ai.enabled（插件宿主 ≠ AI 宿主），ONNX 原生模块在 worker 启动时即加载，`ai.enabled=false` 时零原生加载被破；门禁语义混乱 |

**裁决依据（rationale）**：Phase 9 全部 AI 功能（语义搜索/标签/IQA/视觉相似度）均走主进程路径且生产稳定；inference.* 的设计（worker 侧 ONNX 会话）与 C1 零原生门禁、ai-wiring 会话所有权规则、MemoryMonitor 架构三重冲突；无调用方即无迁移成本。

**Stub 处置**：删除 plugin-worker.ts:147-151（createSession）/153-160（run）/162-166（destroySession）+ plugin.ts:209-211 三行类型；保留 plugin-loader.ts:21 `'inference'` 权限白名单项。

**Phase 10 计划必须写明的四条（phase10MustSpecify）**：
1. **内存所有权**：插件侧模型（SAM2/LaMa）的 ort.InferenceSession 在 worker 内创建/销毁，主进程不持引用；MemoryMonitor 须聚合 worker RSS（IH-2 修复为前提）。
2. **传输模式**：rpc() 须支持 transferList（IH-3）或改 SharedArrayBuffer；须写明 SAM2 encoder 输出（1×256×64×64 f32 = 4MB）的传输选型。
3. **门禁 flag**：插件侧 ONNX 加载须受 ai.enabled 门禁（与主进程 CLIP 同开关）——建议复用 ai.enabled。
4. **卸载语义**：插件 activate() 须支持可选 unload() 钩子（tier1 plan C.2 已提及），EditViewer 关闭时调 unload 释放 ort 会话；worker 退出时 plugin-host-process 须遍历已加载插件调 unload（当前 shutdown() 只发退出信号，未调插件 unload）。

---

## §E A5 —— int8 量化误差数值分析

> 量化叙述口径（全文档统一）：两塔 ort 输出均为 fp32；存储 int8 量化是同一后处理路径（`onnx-clip-engine.ts:24-42` `quantizeEmbedToInt8`，`text-encoder.ts:126` 复用）。「非对称精度」指**模型权重**（图像塔 int8 ONNX vs 文本塔 fp32 ONNX 检查点），非存储精度。

### 发现表

| ID | 位置(file:line) | 严重度 | 状态 | 一句话结论 |
|---|---|---|---|---|
| Q-1 | `tag-suggester.ts:17` | P2 | CONFIRMED | `MIN_CONFIDENCE=0.15` 零校准依据：全仓无校准实验记录，仅合理性推断（logit≈1.8 单位 ↔ 余弦差 0.018） |
| Q-2 | `text-encoder.ts:57` vs `phase9-t22-text-encoder-poc.md:98` | P2 | CONFIRMED | 生产默认文本塔 int8 权重（`clip-text-b32-int8`），PoC 建议查询文本走 fp32；`ai.textPrecision` 开关存在但未接线（协调员 grep 亲验零匹配） |
| Q-3 | `onnx-clip-engine.ts:21` | P3 | CONFIRMED | 注释「仅引入 ≤1/127 的分度误差」措辞误导——分度误差正确，但合成到余弦的 RMS ~3%（512 维累积）未注明 |
| Q-4 | `tag-suggester.ts:5` | P3 | CONFIRMED | 注释「方向保真 → 非对称精度不影响排序」——排序不变无证明，softmax 阈值边界抖动未声明 |

### 数值误差界推导

**假设**：归一化 embedding `v ∈ R^512`，`‖v‖=1`；量化 `q_i = round(v_i×127)`，反量化 `v̂_i = q_i/127`。

| 量 | 推导 | 值 |
|---|---|---|
| 逐分量最大误差 | `|δ_i| ≤ 0.5/127` | ≈0.00394 |
| 最坏向量扰动 | `‖δ‖₂ ≤ √512 × 0.5/127` | ≈0.0889 → 余弦最坏 ~0.178 |
| 分量方差（均匀舍入） | `Var(δ_i) = (1/127)²/12` | ≈5.47×10⁻⁷ |
| RMS 向量扰动 | `√(512×Var)` | ≈0.0167 |
| **双侧余弦 RMS**（两侧独立量化） | `√2 × 0.0167` | **≈0.024（~2.4%）** |

**实测印证**（poc-t22 cross-modal）：图像 fp32↔int8 **权重**余弦 0.968–0.982（误差 1.8%–3.2%，与 RMS 估计一致）；文本 fp32↔int8 **权重**余弦低至 0.716（误差 28%）——这是**模型权重 int8** 造成的（噪声源 A），非存储量化（噪声源 B）。

**两噪声源复合**（独立）：图像侧总余弦误差 RMS ≈ √(0.025²+0.024²) ≈ 3.5%；文本侧（fp32 权重）仅存储噪声 ≈2.4%；文本侧（int8 权重，**生产默认**）权重噪声 28% 主导。

### 下游消费者敏感度表

| 消费者 | 输入 | 敏感度 | 评级 |
|---|---|---|---|
| 语义检索 top-k 翻转（semantic-search.ts:35-46 + ann-index.ts:52-62） | int8 查询 × int8 库存 | CLIP 正负样本余弦 gap 实测 0.202（0.322 vs 0.120，poc:93）远大于 2.4% RMS → top-1 翻转 <1%；top-10 尾部可能 1-2 位翻转 | 🟢 低风险 |
| tag-suggester softmax / MIN_CONFIDENCE=0.15（tag-suggester.ts:95-117） | int8 图像 × int8 文本 prompt，logits=cos×100 | 余弦 ±0.024 RMS → logit ±2.4；阈值 0.15 边界处候选可能误入/误出 | 🟡 中风险（阈值边界） |
| 视觉相似度 top-k 均值（T24，VISUAL_WEIGHT=0.25） | int8 × int8，top-8 均值 | 3.5% 余弦噪声 → 均值 ~1.2%（top-8 平均降噪）；0.25×1.2% = 0.3% 总分扰动 | 🟢 可忽略 |
| HNSW int8 召回（ann-index.ts:30-36） | int8 向量入图 | efSearch 足够时可补偿近邻扰动 | 🟢 tier1 r11 bench 已覆盖 |

### Q-1 MIN_CONFIDENCE=0.15 零校准（P2）

**证据**：tag-suggester.ts:16-17 定义 `MIN_CONFIDENCE: 0.15`；全仓 grep 校准实验零记录；`phase9-t23-t24-t25-quality-match-jobs.md:76,219` 仅描述无来源；测试仅验证阈值行为不验证合理性。**合理性推断（非校准）**：候选 ~40-60 个，softmax 均分 ~1/50=0.02，0.15 要求 logit 高出均值 ln(0.15×50/0.85)≈1.8 单位，对应余弦差 ≈0.018——看似合理但无实测支撑。

**建议动作**：跑 bench-poc-r12（规格见下）后基于数据校准或标注 heuristic。

### Q-2 生产默认文本塔 int8 权重 vs PoC 建议 fp32（P2）

**证据**：`text-encoder.ts:57` 默认 `clip-text-b32-int8`（int8 权重，实测余弦漂移至 0.716）；PoC（phase9-t22-text-encoder-poc.md:98）明确建议查询文本用 fp32 文本塔规避漂移；`ai.textPrecision` 开关在 settings 类型中存在但**未接线**（协调员 grep `textPrecision|clip-text-b32` 亲验：零消费方读此配置）。另：int8×int8 top-1 100% 的 PoC 依据样本仅 n=4（二项 95% CI 下限 ~40%），以此为生产默认偏激进。

**建议动作**：r12 数据出来后裁决——(a) 接线 textPrecision 开关默认 fp32 文本塔，或 (b) 保持 int8 但在文档补注漂移数据。

### Q-3/Q-4 注释措辞夸大（P3）

**证据**：onnx-clip-engine.ts:21「仅引入 ≤1/127 的分度误差」——分度正确但读者易误解为余弦误差 ≤0.8%，实际 RMS ~3%；tag-suggester.ts:5「非对称精度只影响绝对尺度不影响排序」——排序不变无证明。同类问题：onnx-clip-engine.ts:6、text-encoder.ts:7「方向保真」措辞模糊；onnx-clip-engine.test.ts:16「保真下限」无数字；phase9-t22-semantic-search.md D-1 以 n=4 样本定生产默认。

**建议动作**：六处注释/文档修正（补具体数字或引用 r12 路径），完整清单见 A5 报告 §6。

### bench-poc-r12 规格（本轮只交付规格，不写脚本）

- **位置**：`scripts/bench-poc-r12.mjs`，输出 `scripts/poc-r12/result-r12.json`
- **CLI**：`--dir`（默认 test-data/large-library）/`--limit`(1000)/`--model`(fp32|int8，默认 int8 生产配置)/`--text-model`(fp32|int8，默认 int8)/`--queries`(50)/`--k`(10)/`--output`/`--skip-inference`（跳过推理仅测存储量化，用预存 fp32 向量）
- **流水线**：递归扫描收集（确定性排序）→ fp32 基线嵌入 → int8 权重嵌入 → quantizeEmbedToInt8 存储量化 → ~50 条英文查询（文件名启发式或内置通用描述）→ 三档文本塔配置编码 → 指标计算 → JSON 输出
- **指标**：(1) 量化余弦差分布（imageFp32VsStoredInt8 / imageFp32VsInt8Weight / textFp32VsInt8Weight，各 min/P25/P50/P75/max/mean/std）；(2) top-k Jaccard 重叠率（fp32 基线 vs 生产配置，mean/P50/min across queries）；(3) 标签翻转率（top-1 翻转占比 + top-3 集合翻转）；(4) 正负样本分离度收缩率（fp32Gap vs productionGap + shrinkagePercent）；(5) timing + rssPeakMB
- **JSON schema**：`{schema:'poc-r12', timestamp, config{dir,limit,imageModel,textModel,queries,k}, imageCounts, quantizationError{...三组分布}, topKOverlap{meanJaccard,p50Jaccard,minJaccard,perQuery}, labelFlipRate{top1FlipRate,top3FlipRate}, separationDegradation{fp32Gap,productionGap,shrinkagePercent}, timing, rssPeakMB}`
- **房屋风格**：顶部注释块（协议/Prereq/用法，同 r2:1-9/r7:1-13）；`createRequire(import.meta.url)` 加载原生模块；`===JSON===` 标记 + `JSON.stringify(results,null,2)`（同 r5:132/r7:186）；`argv.indexOf('--'+name)` 参数解析（同 r2:20-23）；**不 import 项目 TS 源码**——`quantizeEmbedToInt8` 脚本内复刻（同 verify-clip-int8.mjs:27-41）
- **运行约束**：conda imageviewer（Node25/ABI141）；模型在 `cache/poc-r2/clip-vit-b32-{fp32,int8}.onnx` + `clip-text-b32-{fp32,int8}.onnx`；预计 ~5 分钟（1000 图 × 2 塔精度按 r2 实测 13.56 张/秒）

### A5 既有防线（防夸大）

quantizeEmbedToInt8 实现正确（L2 归一 ×127 取整夹限 + 零向量安全处理）；text-encoder.ts:122-125 强制 fp32 输出 dtype 校验；vector-index-service.ts:43-46 getModelId() 供跨模型拒绝；poc-t22 已做 4×4 三档精度全链实测（非零但样本小）。

---

## §F A6 —— media:// token 与 IPC 安全审查

### 发现表（协调员终裁版）

| ID | 位置(file:line) | 严重度 | 状态 | 一句话结论 |
|---|---|---|---|---|
| S-1 | `electron/main.ts:71-74` | P3 | CONFIRMED | media:// 协议处理器 startsWith+path.sep 后缀校验，resolve 后基本安全；8.3 短路径向量理论性 |
| S-2 | `library-handlers.ts:28-30` | P3 | CONFIRMED | validateLibraryAccess 同 startsWith 惯例；真实问题是与 isPathWithin 双惯例并存（见 S-4） |
| S-3 | `library-handlers.ts:441-456` | **P2（重裁为功能缺陷）** | CONFIRMED | getAudioUrl 有意跳过 validateLibraryAccess（注释「允许任意路径」），但协议处理器对每次请求动态校验库根白名单 → 库外音频 token 403 → 幻灯片背景音乐静默失效 |
| S-4 | `file-service.ts:71` | P3 | CONFIRMED | validatePath startsWith 与 isPathWithin（path-safe.ts:8-10）双惯例并存，建议统一 |
| S-5 | `library-handlers.ts` addLibrary | P3 | CONFIRMED（良性） | 用户可选任意目录为库，非安全漏洞（用户主动行为） |
| S-6 | `image-service.ts:1158-1164`（IPC 入口 library-handlers.ts:176-182） | P3（降级） | CONFIRMED | getImagePathByRelativePath 直接 join 返回字符串，无校验——输入由渲染进程自控，实害有限 |
| S-7 | `image-service.ts:767-788` | P3（降级） | CONFIRMED | getImagePath/getMediaPath 的 relative_path 来自 DB 行非渲染输入，不可直接注入；保留为纵深防御建议 |
| S-8 | 与 C-7 合并（见 §B） | P2 | CONFIRMED | intake file:// 无范围校验——A6 原定 P1 高估（需恶意插件前提），采纳 A2 框架定级 |
| S-9 | `file-service.ts:68-74` | P2（纵深防御） | CONFIRMED（亲验成立） | validatePath 用 path.resolve 前缀比较，resolve 不解析 symlink → 库内恶意 symlink 可绕过；前提强（需用户在库内植入 symlink） |
| S-10 | `electron/main.ts:86-87` | P2 | CONFIRMED | media:// MIME 仅按扩展名，无魔数校验 |
| S-11 | `library-handlers.ts:418` | P3 | CONFIRMED | loadFullImage MIME 同仅扩展名（data URL 路径，良性） |
| S-12 | `media-registry.ts:50-55` | **REFUTED（安全面）**→P3 卫生 | REFUTED | 库移除后 token 即时 403（协议处理器请求时动态校验 getLibraries()），无陈旧访问窗口；残留仅内存占用至 TTL 1h |
| S-13 | `electron/main.ts:44` | P3 | CONFIRMED | corsEnabled:true 可能不必要但风险低（协议处理器已校验路径） |
| S-14 | `scanner.ts:385` | **REFUTED** | REFUTED | `readdirSync(dir,{withFileTypes:true})` 的 Dirent 为 lstat 语义，symlink 条目 isDirectory()/isFile() 均 false，scanner 天然不跟随 |

### IPC 入口通道矩阵（16 通道，修正后）

| # | 通道 | 输入来源 | 校验惯例 | 裁决 |
|---|---|---|---|---|
| 1 | media:// 协议处理器 | token→注册表路径 | startsWith+sep | P3（S-1） |
| 2 | getMediaUrl | 渲染传路径 | validateLibraryAccess | P3（同 S-2 惯例） |
| 3 | getAudioUrl | 渲染传路径 | **仅扩展名白名单**（.mp3/.wav/.flac/.m4a/.aac/.ogg/.wma） | **P2 功能缺陷（S-3）** |
| 4 | readFile | 渲染传相对路径 | validateLibraryAccess | P3 |
| 5 | fileExists | 同上 | validateLibraryAccess | P3 |
| 6 | loadFullImage | 同上 | validateLibraryAccess | P3（S-11 MIME 良性） |
| 7 | file ops（rename/move/delete/copy） | 渲染传相对路径 | validatePath（resolve 前缀） | **P2（S-9 symlink）** |
| 8 | getImagePathByRelativePath | 渲染传相对路径 | 直接 join 无校验 | P3（S-6，返回字符串实害有限） |
| 9 | getMediaPath/getImagePath | DB 行 | 直接 join | P3（S-7，纵深防御） |
| 10 | getImageExif | DB 行路径 | isPathWithin | 安全 |
| 11 | getImageHistogram | 同上 | isPathWithin | 安全 |
| 12 | export 文件集 | DB 行路径 | isPathWithin | 安全 |
| 13 | intake file:// | pc-app 插件 | **仅 existsSync** | **P2（C-7/S-8）** |
| 14 | scanner 目录遍历 | 库根 | Dirent lstat 语义 | REFUTED（S-14） |
| 15 | addLibrary | 用户选择 | 无校验 | P3 良性（S-5） |
| 16 | selectDestinationFolder | 用户选择 | isPathWithin | 安全 |

### S-3 getAudioUrl 设计矛盾（P2，功能缺陷）

**证据**（协调员亲读）：library-handlers.ts:439-456 `getAudioUrl` 注释明确「允许任意路径」（跳过 validateLibraryAccess，仅 `AUDIO_EXT` 扩展名白名单），意图支持库外背景音乐（如幻灯片配乐）；但 electron/main.ts:66-83 协议处理器对**每次请求**动态校验 `getLibraries()` 白名单（非 token 注册时快照）→ 库外音频路径的 token 请求 403 → 唯一前端消费方 SlideshowAudio.tsx:34 拿到 media URL 后静默加载失败，幻灯片背景音乐无声。**设计意图被协议层防线挫败**：不是安全漏洞，是安全防线与功能设计未对齐。

**建议动作**：(a) 协议层增加「用户显式选择的音频目录」白名单（与 getAudioUrl 意图对齐，如经 selectDestinationFolder 选取的目录），或 (b) getAudioUrl 收窄范围并要求音频在库内（功能降级）。

### S-9 validatePath symlink 绕过（P2 纵深防御）

**证据**（file-service.ts:68-74，协调员亲读）：`path.resolve` 前缀比较，resolve 不解析 symlink → 库内 symlink（指向库外）通过校验，后续 rename/copy/delete 作用于库外真实目标。前提强：需用户在库内手动植入 symlink（或恶意归档导入制造），非常规操作可达。

**建议动作**：validatePath 增加 lstat 检查，拒绝 symlink 条目（或 realpath 后重新校验前缀）。

### S-12/S-14 REFUTED 裁决依据

- **S-12**：协议处理器每次请求动态调 `getLibraries()` 校验（协调员亲读 electron/main.ts:66-83），库移除后 token 立即 403，无陈旧访问窗口。残留 token 仅内存占用（TTL 1h 后清理，media-registry.ts:18）。降为 P3 卫生：`removeLibrary` 时顺带清理该库 token 可立即释放内存（可选优化）。
- **S-14**：`fs.readdirSync(dir,{withFileTypes:true})` 返回 Dirent——其 isDirectory()/isFile() 基于 lstat 语义，symlink 条目两者均 false，scanner 循环（scanner.ts:390-396）自然跳过 symlink，不遍历库外。子代理「scanner 可跟随 symlink 遍历库外目录」不成立。

### A6 通道矩阵外补充

- **S-10**（P2）：electron/main.ts:86-87 MIME 仅查扩展名表，`.jpg` 实为 `.exe` 时返回错误 Content-Type；浏览器可能错误解析。建议魔数嗅探或扩展名↔内容一致性校验。前提：渲染进程沦陷或恶意文件导入。
- **S-13**（P3）：registerSchemesAsPrivileged 的 `corsEnabled:true`（main.ts:44）可能不必要；协议处理器已 403 兜底，风险低。
- **Token 熵**（裁决 6.6）：`crypto.randomBytes(16)` = 128-bit 熵，碰撞不可行（生日攻击 ~2^64）。
- **未注册 token**（裁决 6.9）：返回 404 JSON（main.ts:60-64），未 crash。
- **退出清理**（裁决 6.8）：shutdownApp 调 stopMediaRegistryCleanup()（main.ts:339）停定时器；registry Map 随进程退出释放。

### A6 既有防线总结（防夸大）

1. 协议处理器是独立最终防线：token 解析后动态校验路径在当前库集内（纵深防御正确）。
2. Token 128-bit 密码学随机，不可猜测。
3. 部分通道已用 isPathWithin（file-handlers.ts:144/172/199、library-handlers.ts:538/669）。
4. path.resolve 兜底 `..` 穿越。
5. preload 暴露面收窄（无原始 fs/ipc 直接暴露给页面）。

---

## §G 四个分析任务包

> 每包自含：file 锚点 + 核心问题 + 审计落点。可直接作为修复轮/后续分析的输入。

### 包 1 —— 并发/正确性修复轮（A1+A2+A3 落点）

**文件锚点**：`job-runner.ts`、`database.ts`（jobs/job_items/crawl_items DDL 与迁移）、`crawl-item-store.ts`、`downloader.ts`、`intake.ts`、`edits-service.ts`、`file-service.ts`、`file-handlers.ts`

**核心问题**：
1. C-1（P1）：补 `crawl_items(file_hash)` partial unique index（tolerant 迁移）或 INSERT ON CONFLICT 判胜者删败方文件。
2. JR-1/JR-5：recoverInterruptedJobs 与 enqueue 的两条写包事务。
3. JR-6：handler 契约文档化（interrupted 项 resume 重跑须幂等）或 resume 等待 in-flight handler。
4. C-3/C-5：intake 失败/跳过路径 best-effort `fs.rm` 清理孤儿。
5. C-4：.part.meta 记录 ETag/Last-Modified，续传前比对。
6. C-2/C-8：shortUrlHash 扩位 + alreadyPresent 回传 sha256。
7. EC-1：getOutputPath op 消毒 + resolve 后 `_edits` 前缀验证（**Phase 10 前置**）。
8. EC-2：deleteFiles 后 `invalidateByImageId`。
9. C-7：intake file:// 路径 `_downloads` 子树校验（`allowedLocalPrefixes` 注入便于单测）。
10. S-3：协议层音频白名单或 getAudioUrl 收窄（功能对齐，非安全修复）。
11. JR-2/JR-3/JR-7/EC-3/EC-4/EC-5：P3 卫生批（priority/attempt 死列、复合项文档化、随机后缀、级联清理、mkdirSync 异步化）。

**审计落点**：修复轮 PR 须逐条引用本文件发现 ID；每修一条附最小回归测试（并发双摄入用两条 async intake 复现）。

### 包 2 —— InferenceHost 裁决执行（A4 落点）

**文件锚点**：`electron/plugin-worker.ts:146-166`、`src/types/plugin.ts:209-211`、`src/main/plugins/plugin-loader.ts:21`、`src/main/services/memory-monitor.ts`、`src/main/plugins/plugin-host-process.ts`

**核心问题**：
1. 执行裁决 (b)：删三 stub（plugin-worker.ts:147-151/153-160/162-166）+ 删 plugin.ts:209-211 类型行 + 保留 plugin-loader.ts:21 权限项。**待批准后执行。**
2. IH-2（P1）：MemoryMonitor.refresh() 聚合 worker RSS（getWorkerRss RPC 或 5s push）；Phase 10 前提修复。
3. IH-3：rpc() transferList 支持选型（与 SAM2 4MB encoder 输出传输一并设计）。
4. Phase 10 计划须写明四条：内存所有权 / 传输模式 / ai.enabled 门禁复用 / activate() 可选 unload() 钩子（worker shutdown 遍历调 unload）。

**审计落点**：删除后全仓 grep `inference\.(createSession|run|destroySession)` 应零命中（除 docs 历史规划）；tsc 0 错误。

### 包 3 —— 量化误差实证（A5 落点）

**文件锚点**：`scripts/bench-poc-r12.mjs`（新建，规格见 §E）、`tag-suggester.ts:17`、`text-encoder.ts:57`、`onnx-clip-engine.ts:21`、`ai-wiring.ts`

**核心问题**：
1. 按 §E 规格**写并跑** bench-poc-r12：真实图库 1000 图 × 三档精度，产出量化余弦差分布 / top-k Jaccard / 标签翻转率 / 分离度收缩四组指标。**本轮只交付规格，执行待批准。**
2. 基于 r12 数据校准 MIN_CONFIDENCE=0.15（或明确标 heuristic）。
3. 裁决 textPrecision 开关接线：r12 的 textFp32VsInt8Weight 分布决定 (a) 默认 fp32 文本塔（若 28% 漂移实质影响标签质量）或 (b) 保持 int8 + 文档补注。
4. 六处注释/文档夸大措辞修正（A5 报告 §6 清单）。

**审计落点**：r12 JSON 落 scripts/poc-r12/；指标数字回填 tag-suggester/text-encoder 注释与 PoC 文档。

### 包 4 —— media:// 安全加固（A6 落点）

**文件锚点**：`electron/main.ts:37-90`、`library-handlers.ts`、`file-service.ts:68-74`、`intake.ts:36-45`、`path-safe.ts`

**核心问题**：
1. 统一校验惯例：startsWith（main.ts:71、library-handlers.ts:28、file-service.ts:71）迁移到 isPathWithin（path-safe.ts:8-10）——S-1/S-2/S-4。
2. S-9：validatePath 增加 symlink 检查（lstat 或 realpath 后重校验）。
3. S-10：media:// MIME 魔数嗅探（或扩展名↔内容一致性校验）。
4. S-12 卫生：removeLibrary 顺带清理该库 token（可选）。
5. S-6/S-7：image-service 内部 join 点补 isPathWithin（纵深防御，非急）。
6. S-13：评估移除 corsEnabled:true。
7. S-3 功能对齐：音频白名单设计（与包 1 第 10 条同一工作项）。

**审计落点**：修复后 16 通道矩阵复查（§F 表）应全绿或标注有意豁免；不引入新惯例分裂。

---

## §H 建议动作汇总（P0–P3 排序）

| 优先级 | ID | 动作 | 位置 |
|---|---|---|---|
| **P1** | C-1 | crawl_items 补 file_hash partial unique index（tolerant 迁移）或 INSERT ON CONFLICT；并发双摄入根因修复 | database.ts:183-196 + crawl-item-store.ts |
| **P1** | IH-2 | MemoryMonitor.refresh() 聚合 worker RSS；Phase 10 插件侧模型加载前提 | memory-monitor.ts:44 + plugin-host-process.ts |
| P2 | S-3 | 协议层音频目录白名单或 getAudioUrl 收窄——修复幻灯片背景音乐静默失效 | library-handlers.ts:441-456 + electron/main.ts:66-83 |
| P2 | C-2+C-8 | shortUrlHash 扩 16-24 hex；alreadyPresent 回传 sha256 | downloader.ts:63-65,149-157 |
| P2 | C-3 | intake insert 失败 catch 内 best-effort fs.rm 清孤儿 | intake.ts:169-172 |
| P2 | C-4 | .part.meta 记录 ETag/Last-Modified，续传前比对，不一致删 .part 重下 | downloader.ts:180-231 |
| P2 | C-5 | skippedPhash 路径删新文件（best-effort） | intake.ts:151-153 |
| P2 | C-7/S-8 | intake file:// 校验 `_downloads` 子树（allowedLocalPrefixes 注入） | intake.ts:36-45,102-109 |
| P2 | JR-3 | attempt 列：删除或实现递增+max attempts | database.ts:104,1220 |
| P2 | JR-4 | registerHandler 冲突 warn 日志 | job-runner.ts:47-49 |
| P2 | JR-5 | enqueue createJob+createJobItems 同事务 | job-runner.ts:70-74 |
| P2 | JR-6 | handler 幂等契约文档化或 resume 等待 in-flight | job-runner.ts:187,205-206 |
| P2 | EC-1 | getOutputPath op 消毒 + `_edits` 前缀验证（Phase 10 前置） | edits-service.ts:75-81 |
| P2 | EC-2 | deleteFiles 后 invalidateByImageId | file-service.ts:135-194 |
| P2 | S-9 | validatePath symlink 检查（lstat/realpath） | file-service.ts:68-74 |
| P2 | S-10 | media:// MIME 魔数校验 | electron/main.ts:86-87 |
| P2 | Q-1 | r12 数据校准 MIN_CONFIDENCE 或标 heuristic | tag-suggester.ts:17 |
| P2 | Q-2 | 裁决 textPrecision 接线（fp32 vs int8 文本塔） | text-encoder.ts:57 + ai-wiring.ts |
| P2 | IH-3 | rpc() transferList 支持选型（Phase 10 设计项） | plugin-host-process.ts:192-197 |
| P2 | 包3 | 写+跑 bench-poc-r12（规格已交付 §E） | scripts/bench-poc-r12.mjs |
| P3 | JR-1 | recoverInterruptedJobs 两条 UPDATE 包事务（自愈口径：惯例一致性收益） | database.ts:1269-1274 |
| P3 | JR-2 | priority 死列：删注释声明或实现排序 | job-runner.ts:30 |
| P3 | JR-7 | 复合项模式文档化 | job-runner.ts / file-handlers.ts |
| P3 | EC-3 | 输出文件名随机后缀防同毫秒碰撞 | edits-service.ts:79-80 |
| P3 | EC-4 | deleteFiles 级联清理 edits 记录 + _edits 文件 | file-service.ts / edits-service.ts |
| P3 | EC-5 | mkdirSync → fs.promises.mkdir | edits-service.ts:38-39 |
| P3 | C-6 | sidecar 失败结构化告警 | intake.ts:197-203 |
| P3 | IH-1 | 删三 stub + 类型行（待批准） | plugin-worker.ts:146-166 + plugin.ts:209-211 |
| P3 | IH-4 | 'inference' 权限保留待 Phase 10 重新定义 | plugin-loader.ts:21 |
| P3 | Q-3/Q-4 | 六处注释措辞修正（补数字/引用 r12） | onnx-clip-engine.ts:21 等 |
| P3 | S-1/S-2/S-4 | startsWith 惯例迁移到 isPathWithin（统一） | main.ts / library-handlers / file-service |
| P3 | S-5 | addLibrary 无校验：维持（用户主动行为） | library-handlers.ts |
| P3 | S-6/S-7 | image-service join 点补 isPathWithin（纵深防御） | image-service.ts:767-788,1158-1164 |
| P3 | S-11 | loadFullImage MIME 魔数（良性，随 S-10 一并） | library-handlers.ts:418 |
| P3 | S-12 | removeLibrary 顺带清理该库 token（内存卫生） | library-handlers.ts:104-112 |
| P3 | S-13 | 评估移除 corsEnabled:true | electron/main.ts:44 |
| REFUTED | S-14 | scanner 不跟随 symlink（Dirent lstat 语义），无需修复 | scanner.ts:385 |

**修复轮准入**：本文件为纯分析轮交付物，所有动作待用户批准后按 §G 任务包开修复轮；修复轮 PR 须逐条引用发现 ID 并附回归测试。

**基线**：本轮零代码修改；测试基线维持 tier1 实测 808 passed / 2 skipped（2026-10-10，imageviewer conda Node25）。
