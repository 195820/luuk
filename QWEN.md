# Luuk 图片查看器 - 项目上下文文档

**文档版本**: 1.0
**最后更新**: 2026 年 3 月 16 日

---

## 📋 项目概述

**Luuk** 是一个专为**大量高清写真图片**设计的本地图片查看器，核心目标是**快速加载**，支持多硬盘统一库管理。

### 核心特性
- 🖼️ **快速加载大图** - 支持 100MB+ 图片秒开
- 🔍 **缩略图缓存系统** - WebP 格式 + LRU 淘汰机制
- 📁 **多库管理** - 支持 2-3 个硬盘独立库，增量扫描
- 🌲 **文件夹树浏览** - 递归展示文件夹层级结构
- ⭐ **收藏系统** - 图片/文件夹收藏、评分、标签
- 🎨 **双视图模式** - 网格视图 + 查看器视图（缩放/旋转/翻转）

### 技术栈

| 层级 | 技术 |
|------|------|
| **框架** | Electron 40 + React 19 + TypeScript 5.9 |
| **构建** | Vite 7 + electron-builder 26 |
| **状态管理** | Zustand 5 |
| **数据库** | better-sqlite3 12 |
| **图片处理** | sharp 0.34 |
| **虚拟滚动** | @tanstack/react-virtual 3 |
| **图片缩放** | react-zoom-pan-pinch 3 |

---

## 🚀 快速开始

### 环境要求
- Node.js 22.22.0+
- npm 10.9.4+
- Windows 10/11 (64 位)

### 开发命令

```bash
# 安装依赖
npm install

# 启动开发服务器（自动打开 DevTools）
npm run dev

# 构建前端 + Electron 打包
npm run build

# 仅构建前端（不打包）
npm run build:dir

# 预览构建结果
npm run preview
```

### 构建输出
- `dist/` - 前端构建输出
- `dist-electron/` - Electron 主进程构建输出
- `release/` - 最终安装包（NSIS）

---

## 📁 项目结构

```
E:\luuk\
├── electron/                    # Electron 主进程
│   ├── main.ts                 # 主进程入口（窗口管理 + IPC 注册）
│   └── preload.ts              # 预加载脚本（contextBridge 暴露 API）
├── src/
│   ├── main/                   # 后端服务层
│   │   ├── services/           # 核心服务
│   │   │   ├── database.ts     # SQLite 数据库管理
│   │   │   ├── image-service.ts # 图片服务（缓存管理）
│   │   │   ├── scanner.ts      # 库扫描服务
│   │   │   ├── thumbnailer.ts  # 缩略图生成服务
│   │   │   └── cache.ts        # LRU 缓存服务
│   │   └── ipc/                # IPC 通信层
│   │       └── library-handlers.ts  # 库管理 IPC 处理器
│   ├── components/             # React 组件
│   │   ├── ImageViewer.tsx     # 图片查看器（缩放/旋转/翻转）
│   │   ├── ImageGrid.tsx       # 网格视图（虚拟滚动）
│   │   ├── ImageGridItem.tsx   # 网格项组件
│   │   ├── MasonryGrid.tsx     # 瀑布流视图
│   │   ├── FolderTree.tsx      # 文件夹树组件
│   │   ├── ScanProgress.tsx    # 扫描进度组件
│   │   ├── SortControl.tsx     # 排序控制组件
│   │   └── RatingStars.tsx     # 评分组件
│   ├── stores/                 # Zustand 状态管理
│   │   └── imageStore.ts       # 图片状态（库/图片/收藏/文件夹）
│   ├── types/                  # TypeScript 类型定义
│   │   └── index.ts            # 完整类型系统
│   ├── utils/                  # 工具函数
│   ├── App.tsx                 # 主应用组件
│   ├── App.css                 # 主样式
│   ├── main.tsx                # React 入口
│   └── index.css               # 全局样式
├── scripts/                    # 辅助脚本
│   └── generate-test-images.ts # 测试图片生成脚本
├── test-data/                  # 测试数据
├── test-library/               # 测试库（100 张图片）
├── data/                       # 主数据库目录
├── cache/                      # 缓存目录
├── package.json                # 项目配置
├── tsconfig.json               # TypeScript 配置
├── vite.config.ts              # Vite 配置
├── electron-builder.json       # Electron 打包配置
└── .npmrc                      # npm 镜像配置
```

---

## 🏗️ 架构设计

### 分层架构

```
┌─────────────────────────────────────────────────┐
│           UI 层 (React 19)                       │
│  ┌─────────────┬─────────────────────────────┐  │
│  │ FolderTree  │  ImageGrid / MasonryGrid    │  │
│  │ (文件夹树)  │  (虚拟滚动 + 懒加载)         │  │
│  ├─────────────┴─────────────────────────────┤  │
│  │              ImageViewer                  │  │
│  │              (缩放/旋转/翻转/幻灯片)       │  │
│  └───────────────────────────────────────────┘  │
├─────────────────────────────────────────────────┤
│         状态管理 (Zustand)                       │
│  ┌─────────────────────────────────────────┐    │
│  │ libraries | images | folderTree | cache │    │
│  └─────────────────────────────────────────┘    │
├─────────────────────────────────────────────────┤
│         IPC 通信 (Electron)                      │
│  ┌─────────────────────────────────────────┐    │
│  │ getLibraries | getFolderTree | getImages│    │
│  │ addLibrary | scanLibrary | getThumbnail │    │
│  └─────────────────────────────────────────┘    │
├─────────────────────────────────────────────────┤
│           数据层 (已实现)                        │
│  ┌─────────────────────────────────────────┐    │
│  │ better-sqlite3 | sharp | 文件系统 | LRU │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### 数据库设计

#### 主数据库 (master.db)
位置：`%APPDATA%\luuk\master.db`

```sql
-- 库列表
CREATE TABLE libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    root_path TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'offline',
    last_scan TEXT,
    image_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 跨库收藏
CREATE TABLE favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL,
    image_path TEXT NOT NULL,
    tags TEXT,
    rating INTEGER DEFAULT 0,
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(library_id, image_path)
);

-- 收藏文件夹
CREATE TABLE favorite_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL,
    folder_path TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(library_id, folder_path)
);
```

#### 分库数据库 (thumbs.db)
位置：`{库目录}\.ivlib\thumbs.db`

```sql
-- 图片元数据
CREATE TABLE images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    relative_path TEXT UNIQUE NOT NULL,
    file_hash TEXT,
    width INTEGER,
    height INTEGER,
    file_size INTEGER,
    format TEXT,
    orientation INTEGER DEFAULT 1,
    created_time TEXT,
    modified_time TEXT,
    indexed_time TEXT,
    is_deleted INTEGER DEFAULT 0
);

-- 缩略图缓存
CREATE TABLE thumbnails (
    image_id INTEGER NOT NULL,
    size TEXT NOT NULL,  -- small/medium/large
    data BLOB NOT NULL,
    width INTEGER,
    height INTEGER,
    generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (image_id, size)
);
```

---

## 🔧 核心服务

### 1. DatabaseService (`src/main/services/database.ts`)
- 单例模式管理数据库连接
- 自动创建数据库表结构
- 支持多库并发访问

```typescript
// 获取库数据库实例
const db = DatabaseService.getInstance().getLibraryDb(libraryId);
```

### 2. ImageService (`src/main/services/image-service.ts`)
- 图片元数据管理
- 缩略图缓存（LRU 200MB）
- 缓存 Key 格式：`${libraryId}-${imageId}`

```typescript
// 获取缩略图（带缓存）
const thumbnail = await ImageService.getInstance().getThumbnail(libraryId, imageId, size);
```

### 3. ThumbnailerService (`src/main/services/thumbnailer.ts`)
- 使用 sharp 生成 WebP 缩略图
- 支持多尺寸：small(120px) / medium(300px) / large(600px)
- 并发生成：50 张/批

### 4. ScannerService (`src/main/services/scanner.ts`)
- 增量扫描（文件 Hash 去重）
- 扫描进度事件通知
- 性能：~4.5ms/张

### 5. CacheService (`src/main/services/cache.ts`)
- LRU 缓存淘汰机制
- 内存缓存上限 200MB

---

## 📡 IPC 通信

### 预加载脚本暴露的 API (`electron/preload.ts`)

```typescript
window.electronAPI = {
  // 库管理
  getLibraries, addLibrary, removeLibrary, scanLibrary, selectFolder,
  
  // 文件夹
  getFolderTree,
  
  // 图片查询
  getImages, getImagesByFolder, getImageCount, getImagePath,
  
  // 收藏库
  getFavoriteImages, getFavoriteImagesCount,
  getSingleFavoriteImages, getSingleFavoriteCount,
  addFavoriteFolder, removeFavoriteFolder, getFavoriteFolders,
  getFavoriteFolderTree, isFavoriteFolder,
  getFavoriteFolderImages, getFavoriteFolderImageCount,
  
  // 缩略图
  getThumbnail, getThumbnails,
  
  // 收藏
  toggleFavorite, getFavorites,
  
  // 缓存
  getCacheStats, clearCache,
  
  // 事件
  onScanProgress, onLibraryScanStarted,
}
```

### IPC 处理器 (`src/main/ipc/library-handlers.ts`)
所有 IPC 处理器在此注册，通过 `registerLibraryHandlers()` 暴露。

---

## 🎨 状态管理

### Zustand Store (`src/stores/imageStore.ts`)

```typescript
interface ImageState {
  // 库相关
  libraries: Library[]
  currentLibraryId: number | null
  
  // 图片相关
  images: Image[]
  totalImages: number
  currentImage: Image | null
  
  // 收藏相关
  favorites: Favorite[]
  favoriteImages: FavoriteImage[]
  favoriteCount: number
  favoriteFolders: FavoriteFolder[]
  favoriteFolderTree: FolderTreeNode[]
  singleFavoriteImages: FavoriteImage[]
  
  // 文件夹相关
  folderTree: FolderTreeNode[]
  selectedFolder: string | null
  
  // 视图设置
  favoriteViewMode: 'all' | 'folder' | 'single'
  gridLayoutMode: 'grid' | 'masonry'
  imageSortBy: 'relative_path' | 'file_size' | 'width' | 'height'
  imageSortOrder: 'ASC' | 'DESC'
  
  // UI 状态
  folderSidebarOpen: boolean
  viewMode: 'grid' | 'viewer'
  isLoading: boolean
  error: string | null
  
  // 操作方法
  initialize, loadLibraries, addLibrary, removeLibrary,
  setCurrentLibrary, scanLibrary, loadImages,
  loadFolderTree, setSelectedFolder,
  toggleFavorite, toggleFavoriteFolder,
  setSortBy, setSortOrder, setGridLayoutMode,
}
```

### 特殊常量
```typescript
// 虚拟收藏库 ID
const FAVORITE_LIBRARY_ID = -1
```

---

## 🎯 核心功能模块

### 1. 图片查看器 (`src/components/ImageViewer.tsx`)
- 缩放：0.1x - 10x
- 旋转：90° 步进
- 翻转：水平/垂直
- 适应模式：适应窗口/实际大小
- 幻灯片播放：3/5/10/30 秒间隔
- 快捷键系统

### 2. 网格视图 (`src/components/ImageGrid.tsx`)
- 虚拟滚动（@tanstack/react-virtual）
- 懒加载（只渲染可见区域）
- 缩略图尺寸调节（80-400px）
- 滚动位置记忆

### 3. 瀑布流视图 (`src/components/MasonryGrid.tsx`)
- 根据图片高度自适应布局
- 更紧凑的排列效果

### 4. 文件夹树 (`src/components/FolderTree.tsx`)
- 递归展示文件夹层级
- 展开/折叠
- 图片计数（包含子文件夹）
- 点击筛选图片

### 5. 收藏系统
- **单图收藏**：单独收藏的图片
- **文件夹收藏**：整个文件夹收藏
- **视图模式**：
  - `single` - 只显示单图收藏
  - `folder` - 按文件夹展示收藏
  - `all` - 显示所有收藏

---

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `←/→` | 上一张/下一张 |
| `Home/End` | 第一张/最后一张 |
| `0` | 适应窗口 |
| `1` | 实际大小 |
| `R` | 重置缩放/旋转/翻转 |
| `H/V` | 水平/垂直翻转 |
| `I` | 显示图片信息 |
| `F` | 收藏/取消收藏 |
| `Esc` | 关闭查看器 |
| `Space` | 幻灯片播放/暂停 |
| `F5` | 切换网格/查看器视图 |
| `F6` | 切换文件夹侧边栏 |

---

## 📊 性能基准

**测试环境**: Windows 11, Node.js 24.14.0, Electron 40.6.1
**测试数据**: 7,780 张高清写真图片

| 指标 | 实测值 | 目标值 | 状态 |
|------|--------|--------|------|
| 扫描速度 | 4.56ms/张 | <20ms/张 | ✅ 优秀 |
| 百张扫描 | 456ms | <2000ms | ✅ 优秀 |
| 千张扫描 | ~4.6s | <30s | ✅ 优秀 |
| 内存占用 | <400MB | <500MB | ✅ 达标 |

**预估性能**:
- 10,000 张：~46 秒
- 50,000 张：~3.8 分钟
- 100,000 张：~7.6 分钟

---

## 🐛 已知问题与修复记录

### 2026-02-27 - 缩略图缓存冲突
**问题**: 切换库后缩略图显示错误
**根因**: 缓存 key 只用了 `imageId`，没有包含 `libraryId`
**修复**: 缓存 key 改为 `${libraryId}-${imageId}`

### 2026-03-02 - 数据库实例清理
**问题**: 删除库后数据库实例未释放
**修复**: 在 `app.on('window-all-closed')` 和 `app.on('before-quit')` 中调用 `closeAllDatabases()`

---

## 🧪 测试

### 测试数据生成
```bash
# 生成所有测试数据
npx tsx scripts/generate-test-images.ts all

# 单独生成
npx tsx scripts/generate-test-images.ts default   # 100 张基础库
npx tsx scripts/generate-test-images.ts large     # 1000 张性能测试
npx tsx scripts/generate-test-images.ts multi     # 多库测试
npx tsx scripts/generate-test-images.ts tree      # 文件夹树测试
```

### 测试用例
详见 `测试方案.md`，包含：
- 缩略图缓存系统测试
- 多库管理模块测试
- 文件夹树浏览功能测试
- 库路径冲突检测测试
- 性能测试

---

## 📝 开发约定

### 代码风格
- **TypeScript**: 严格模式，禁止隐式 any
- **命名**:
  - 组件：PascalCase（如 `ImageViewer`）
  - 文件：PascalCase（组件）/ kebab-case（样式）
  - 函数/变量：camelCase
  - 常量：UPPER_SNAKE_CASE
- **路径别名**: `@/` 指向 `src/`

### Git 提交
- 使用语义化提交信息
- 修复 Bug 标注 `[Fix]`
- 新功能标注 `[Feature]`
- 优化标注 `[Optimize]`

### 数据库操作
- 所有数据库操作在事务中进行
- 批量插入使用事务包装
- 及时关闭数据库连接

---

## 🔮 开发计划

### Phase 1 - MVP ✅ (已完成)
- [x] 图片查看器（缩放/旋转/翻转）
- [x] 网格视图（虚拟滚动/懒加载）
- [x] 缩略图缓存系统
- [x] 多库管理
- [x] 文件夹树浏览
- [x] 收藏功能

### Phase 2 - 增强 🟡 (进行中)
- [ ] 评分系统（1-5 星）
- [ ] 标签系统
- [ ] 跨库搜索
- [ ] 批量操作

### Phase 3 - AI/爬虫 ⚪ (未开始)
- [ ] AI 修图（超分辨率、去水印）
- [ ] 图片爬虫模块
- [ ] 云同步

---

## 📎 相关文档

| 文档 | 说明 |
|------|------|
| `README.md` | 项目简介和快速开始 |
| `requirements.md` | 详细需求分析文档 |
| `TASKS.md` | 任务状态跟踪 |
| `测试方案.md` | 测试用例和验收标准 |
| `优化.md` | 性能优化建议 |

---

## 🛠️ 常见问题

### Q: 如何添加新库？
A: 点击"管理"按钮 → 选择图片文件夹 → 自动扫描并添加

### Q: 缩略图缓存在哪？
A: 每个库的 `.ivlib/thumbs.db` 文件中

### Q: 如何清理缓存？
A: 删除对应库的 `.ivlib` 目录，重新扫描即可

### Q: 支持哪些图片格式？
A: JPG, PNG, GIF, WebP, BMP, TIFF

---

**文档结束**
