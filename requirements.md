# 图片查看器 - 需求分析文档

**版本**: 1.0  
**创建日期**: 2026 年 2 月 25 日  
**目标平台**: Windows

---

## 📌 项目概述

一个专为**大量高清写真图片**设计的本地图片查看器，核心目标是**快速加载**，支持多硬盘统一库管理，后续可扩展 AI 修图和图片爬取功能。

---

## 🎯 核心需求

### 1. 用户场景

| 特点 | 描述 |
|------|------|
| 图片类型 | 高清写真、壁纸 |
| 图片大小 | 单张 5-20MB（高分辨率） |
| 图片数量 | 预计 100 万 -200 万张 |
| 存储规模 | 10TB+，分布在 2-3 个硬盘 |
| 使用习惯 | 快速浏览、查找特定图片 |

### 2. 核心痛点

- ❌ 系统自带查看器加载大图慢
- ❌ 文件夹分散，管理混乱
- ❌ 缩略图每次重新生成
- ❌ 无法跨文件夹搜索
- ❌ 大量图片时浏览卡顿

---

## 📋 功能需求

### 第一阶段（MVP - 核心功能）

#### 1. 图片查看模块

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 快速加载大图 | 支持 100MB+ 图片秒开 | P0 |
| 缩放/平移 | 鼠标滚轮缩放、拖拽平移 | P0 |
| 旋转/翻转 | 90°旋转、水平/垂直翻转 | P1 |
| 适应模式 | 适应窗口/实际大小/填充 | P1 |
| 幻灯片播放 | 自动播放、可设置间隔 | P2 |

#### 2. 缩略图浏览模块

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 网格视图 | 可调整缩略图大小 | P0 |
| 懒加载 | 只加载可见区域缩略图 | P0 |
| 预加载 | 提前加载相邻缩略图 | P1 |
| 滚动定位 | 记忆上次浏览位置 | P2 |

#### 3. 多库管理模块

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 多硬盘支持 | 支持 2-3 个硬盘独立库 | P0 |
| 库状态管理 | 在线/离线状态识别 | P0 |
| 增量扫描 | 只扫描变动的文件 | P1 |
| 库切换 | 快速切换不同库 | P1 |
| 跨库搜索 | 统一入口搜索所有库 | P2 |

#### 4. 图片管理模块

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 收藏功能 | 标记喜欢的图片 | P1 |
| 评分系统 | 1-5 星评分 | P2 |
| 标签系统 | 自定义标签分类 | P2 |
| 重复检测 | 识别相似/重复图片 | P3 |

---

### 第二阶段（扩展功能）

#### 5. AI 修图模块（后续）

| 功能 | 描述 |
|------|------|
| 超分辨率 | 低清图放大不失真 |
| 智能去水印 | AI 去除图片水印 |
| 自动调色 | 智能调整亮度/对比度 |
| 背景移除 | 一键抠图 |
| 人脸美化 | 智能磨皮/瘦脸 |

#### 6. 爬虫下载模块（后续）

| 功能 | 描述 |
|------|------|
| 网站解析 | 支持指定图片网站 |
| 批量下载 | 自动下载图集 |
| 去重过滤 | 避免下载重复图片 |
| 断点续传 | 支持大图集下载 |

---

### 第三阶段（高级功能）

| 功能 | 描述 |
|------|------|
| 批量处理 | 批量调整大小/格式转换/重命名 |
| 时间线视图 | 按拍摄时间轴浏览 |
| 地图模式 | 根据 EXIF GPS 在地图显示 |
| 云同步 | 收藏/标签同步到云端 |
| 插件系统 | 支持第三方插件扩展 |

---

## 🏗️ 技术架构

### 技术选型

```
框架：Electron + React + TypeScript
理由：
  ✅ Windows 原生体验好
  ✅ 生态成熟，开发效率高
  ✅ 便于后续集成 AI（Node.js 调用 Python）
  ✅ 爬虫功能直接用 Node.js 实现
  ✅ 跨平台能力（如需扩展 Mac/Linux）
```

### 备选方案

```
框架：Tauri (Rust + 前端)
理由：
  ✅ 内存占用比 Electron 低 5-10 倍
  ✅ Rust 处理大图性能极强
  ✅ 打包体积小（<10MB）
  ⚠️ 生态相对较新
```

### 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      UI 层 (React)                           │
│  ┌───────────┬───────────┬───────────┬───────────┐          │
│  │ 查看器视图 │ 缩略图视图 │ 库管理视图 │ 设置视图   │          │
│  └───────────┴───────────┴───────────┴───────────┘          │
├─────────────────────────────────────────────────────────────┤
│                    业务逻辑层 (IPC)                          │
│  ┌───────────┬───────────┬───────────┬───────────┐          │
│  │ 图片服务  │ 库管理服务 │ 缓存服务  │ 搜索服务  │          │
│  └───────────┴───────────┴───────────┴───────────┘          │
├─────────────────────────────────────────────────────────────┤
│                      数据层                                  │
│  ┌───────────┬───────────┬───────────┬───────────┐          │
│  │ 主数据库  │ D 盘库     │ F 盘库     │ 文件缓存  │          │
│  │ master.db │ thumbs.db │ thumbs.db │ (SSD)     │          │
│  └───────────┴───────────┴───────────┴───────────┘          │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 数据存储设计

### 目录结构

```
E:\luuk\ImageViewer\
├── app\                   ← 程序主目录
│   ├── main.js            ← Electron 主进程
│   ├── preload.js         ← 预加载脚本
│   └── renderer/          ← React 前端代码
├── data\
│   └── master.db          ← 主数据库
├── cache\                 ← 全局缓存（建议放 SSD）
│   └── temp/              ← 临时文件
└── config.json            ← 配置文件

D:\PhotoLibrary\
├── .ivlib\                ← 库标识文件
├── images\                ← 原图存储
│   ├── 2024\
│   │   ├── 01_图集名称\
│   │   └── 02_图集名称\
│   └── 2025\
├── cache\
│   ├── thumbs.db          ← 缩略图数据库
│   └── previews.db        ← 预览图数据库
└── library.json           ← 库元信息

F:\WallpaperCollection\
└── ... (同上)
```

### 数据库设计

#### 主数据库 (master.db)

```sql
-- 库列表
CREATE TABLE libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,             -- 库名称
    root_path TEXT UNIQUE NOT NULL, -- 根路径
    status TEXT DEFAULT 'offline',  -- online/offline
    last_scan TEXT,                 -- 最后扫描时间
    image_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 跨库收藏/标签
CREATE TABLE favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL,
    image_path TEXT NOT NULL,
    tags TEXT,                      -- JSON 数组
    rating INTEGER DEFAULT 0,       -- 0-5
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(library_id, image_path),
    FOREIGN KEY (library_id) REFERENCES libraries(id)
);

-- 浏览历史
CREATE TABLE history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER,
    image_path TEXT,
    viewed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_history_time ON history(viewed_at DESC);
```

#### 分库数据库 (thumbs.db)

```sql
-- 图片元数据
CREATE TABLE images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    relative_path TEXT UNIQUE NOT NULL,
    file_hash TEXT,                     -- SHA256 去重
    width INTEGER,
    height INTEGER,
    file_size INTEGER,
    format TEXT,                        -- JPG/PNG/WEBP/GIF
    orientation INTEGER DEFAULT 1,      -- EXIF 旋转方向
    created_time TEXT,
    modified_time TEXT,
    indexed_time TEXT,
    is_deleted INTEGER DEFAULT 0        -- 软删除标记
);

CREATE INDEX idx_images_path ON images(relative_path);
CREATE INDEX idx_images_time ON images(created_time DESC);

-- 文件夹索引
CREATE TABLE folders (
    path TEXT PRIMARY KEY,
    parent_path TEXT,
    image_count INTEGER DEFAULT 0,
    cover_image_path TEXT,              -- 封面图路径
    last_modified TEXT
);

-- 缩略图缓存（核心优化）
CREATE TABLE thumbnails (
    image_id INTEGER NOT NULL,
    size TEXT NOT NULL,                 -- small(120x120) / medium(300x300) / large(600x600)
    data BLOB NOT NULL,                 -- JPEG 压缩数据
    width INTEGER,
    height INTEGER,
    generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (image_id, size),
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);

-- 预览图缓存（中等尺寸，用于快速预览）
CREATE TABLE previews (
    image_id INTEGER PRIMARY KEY,
    data BLOB NOT NULL,
    width INTEGER,
    height INTEGER,
    generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);

-- 扫描任务队列
CREATE TABLE scan_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_path TEXT NOT NULL,
    status TEXT DEFAULT 'pending',      -- pending/processing/done/failed
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### 配置文件 (config.json)

```json
{
  "version": "1.0",
  "libraries": [
    {
      "id": 1,
      "name": "主写真库",
      "rootPath": "D:\\PhotoLibrary",
      "autoScan": true,
      "cacheOnSSD": true
    },
    {
      "id": 2,
      "name": "壁纸收藏",
      "rootPath": "F:\\WallpaperCollection",
      "autoScan": false,
      "cacheOnSSD": true
    }
  ],
  "settings": {
    "thumbnailSize": {
      "small": 120,
      "medium": 300,
      "large": 600
    },
    "cacheMaxSize": 10737418240,
    "preloadCount": 20,
    "lazyLoadThreshold": 500,
    "supportedFormats": ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff"]
  }
}
```

---

## ⚡ 性能优化策略

### 1. 加载优化

| 技术 | 描述 | 预期提升 |
|------|------|----------|
| 缩略图预生成 | 首次扫描时生成并缓存 | 二次打开 50-100 倍 |
| 多级缓存 | 内存→SSD→HDD | 热图秒开 |
| 懒加载 | 只加载可见区域 | 内存减少 90% |
| 预加载 | 提前加载相邻图片 | 浏览无等待 |
| Web Worker | 后台解码不阻塞 UI | UI 流畅度提升 |

### 2. 内存管理

```
目标：稳定在 500MB 以内

策略：
- 缩略图：可见区域 + 缓冲区（约 100 张）
- 原图：单张加载，切换时释放
- 缓存池：LRU 淘汰策略，上限 200MB
```

### 3. 并发处理

```
缩略图生成：4-8 线程并行
文件扫描：异步 I/O
数据库操作：连接池 + 事务批量
```

### 4. 存储优化

```
缩略图格式：WebP（比 JPEG 小 30%）
压缩质量：85%（视觉无损）
缓存清理：定期清理未使用的缓存
```

---

## 📐 非功能性需求

### 性能指标

| 指标 | 目标值 |
|------|--------|
| 缩略图加载（缓存命中） | <50ms |
| 原图打开（10MB） | <500ms |
| 文件夹扫描（1000 张） | <5s（增量） |
| 内存占用（浏览状态） | <500MB |
| 启动时间 | <2s |

### 兼容性

- Windows 10/11 (64 位)
- 支持 HiDPI 显示器
- 支持触摸屏操作

### 可靠性

- 数据库自动备份
- 异常崩溃恢复
- 离线库自动检测

---

## 📅 开发计划

### Phase 1 - MVP (4-6 周)

| 周次 | 任务 |
|------|------|
| 第 1 周 | 项目搭建、Electron+React 脚手架 |
| 第 2 周 | 核心图片查看组件（缩放/平移） |
| 第 3 周 | 缩略图网格视图 + 懒加载 |
| 第 4 周 | 多库管理 + 数据库设计 |
| 第 5 周 | 缩略图缓存系统 |
| 第 6 周 | 测试优化、打包发布 |

### Phase 2 - 增强 (4 周)

- 收藏/标签/评分系统
- 跨库搜索
- 批量操作
- 设置界面

### Phase 3 - AI/爬虫 (后续)

- AI 修图功能集成
- 图片爬虫模块
- 云同步

---

## 🔧 技术栈详情

### 前端

```json
{
  "react": "^19.2",
  "typescript": "^5.9",
  "electron": "^40.6.1",
  "vite": "^7.3",
  "zustand": "^5.0",
  "@tanstack/react-virtual": "^3.13",
  "react-zoom-pan-pinch": "^3.7"
}
```

### 后端（Node.js）

```json
{
  "better-sqlite3": "^12.6",
  "sharp": "^0.34",
  "chokidar": "^5.0",
  "electron-store": "^11.0"
}
```

### 核心依赖说明

| 库 | 用途 |
|------|------|
| `sharp` | 图片处理（缩略图生成、格式转换） |
| `better-sqlite3` | 高性能 SQLite 操作 |
| `chokidar` | 文件变化监听 |
| `react-virtual` | 虚拟滚动（大量缩略图） |

---

## 📝 待确认事项

1. [ ] AI 修图具体功能优先级
2. [ ] 爬虫目标网站列表
3. [ ] 是否需要云同步功能
4. [ ] 是否支持插件系统

---

## 📎 附录

### 支持的图片格式

- **基础格式**: JPG, PNG, GIF, BMP
- **现代格式**: WebP, AVIF
- **专业格式**: TIFF, PSD, RAW (可选)

### 命名规范

- 代码：驼峰命名 (camelCase)
- 文件：短横线命名 (kebab-case)
- 组件：大驼峰 (PascalCase)

### 参考项目

- [ImageGlass](https://github.com/d2phap/ImageGlass) - 开源图片查看器
- [XnView MP](https://www.xnview.com/) - 跨平台图片浏览器
- [Eagle](https://eagle.cool/) - 素材管理工具
