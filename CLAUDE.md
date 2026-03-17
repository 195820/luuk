# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📦 项目概述

一个专为**大量高清写真图片**设计的本地图片查看器，基于 Electron + React + TypeScript。

## 🔧 开发命令

```bash
npm install          # 安装依赖
npm run dev          # 开发模式（自动打开 DevTools）
npm run build        # 构建前端 + Electron 打包
npm run build:dir    # 仅构建前端（不打包）
npm run preview      # 预览构建结果
```

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────┐
│           UI 层 (React 19)                       │
│  FolderTree │ ImageGrid (虚拟滚动)              │
│  ImageViewer (缩放/旋转/翻转/幻灯片)            │
├─────────────────────────────────────────────────┤
│         状态管理 (Zustand - imageStore.ts)       │
│  libraries | images | folderTree | cache        │
├─────────────────────────────────────────────────┤
│         IPC 通信 (library-handlers.ts)           │
│  getLibraries | getFolderTree | getThumbnail    │
├─────────────────────────────────────────────────┤
│           数据层                                  │
│  MasterDB (master.db) - 库/收藏/标签/历史        │
│  ThumbnailsDB (thumbs.db) - 图片元数据/缩略图    │
│  位置：%APPDATA%\luuk\master.db + {库}\.ivlib\  │
└─────────────────────────────────────────────────┘
```

## 📁 核心目录结构

```
E:\luuk\
├── electron/           # Electron 主进程
│   ├── main.ts         # 主入口，窗口创建，IPC 注册
│   └── preload.ts      # 预加载脚本，暴露 electronAPI
├── src/
│   ├── main/           # 后端服务
│   │   ├── services/
│   │   │   ├── database.ts      # MasterDB + ThumbnailsDB
│   │   │   ├── image-service.ts # 统一服务接口（单例）
│   │   │   ├── scanner.ts       # 库扫描 + 增量更新
│   │   │   ├── thumbnailer.ts   # 缩略图生成 (Sharp)
│   │   │   └── cache.ts         # LRU 内存缓存 (200MB)
│   │   └── ipc/
│   │       └── library-handlers.ts  # IPC 处理器
│   ├── components/     # React 组件
│   │   ├── ImageViewer.tsx  # 查看器（缩放/平移/旋转）
│   │   ├── ImageGrid.tsx    # 网格视图（虚拟滚动）
│   │   ├── MasonryGrid.tsx  # 瀑布流视图
│   │   ├── FolderTree.tsx   # 文件夹树
│   │   └── SortControl.tsx  # 排序控制
│   ├── stores/
│   │   └── imageStore.ts    # Zustand 状态（核心）
│   └── types/
│       └── index.ts         # TypeScript 类型定义
├── dist/              # Vite 构建输出
├── dist-electron/     # Electron 构建输出
└── release/           # 安装包输出
```

## 🔑 关键设计

### 数据库架构
- **master.db**: 主数据库，存储所有库信息、收藏、标签、浏览历史
- **thumbs.db**: 每个库独立的分库，存储图片元数据、缩略图缓存（WebP 格式）
- 库路径使用 `.ivlib` 隐藏目录存储数据库文件

### 缩略图缓存链路
```
内存 LRU 缓存 (200MB) → thumbs.db 数据库缓存 → 原图实时生成 (Sharp)
```
缓存 Key 格式：`${libraryId}-${imageId}`，确保跨库隔离

### 文件夹树实现
- 使用路径分隔符 `/` 统一存储（兼容 Windows/Unix）
- 递归构建：从图片相对路径提取文件夹层级
- 支持展开/折叠，点击筛选图片

### 收藏系统
- 虚拟收藏库 ID: `FAVORITE_LIBRARY_ID = -1`
- 单图收藏：单独标记的图片
- 文件夹收藏：整个文件夹标记为收藏
- 收藏数据存储在 master.db，图片详情从原库获取

## 📝 开发注意事项

1. **Electron 下载**: 使用镜像源（项目已配置 `.npmrc`）
2. **路径处理**: 使用 `path.normalize()` 处理跨平台路径
3. **IPC 通信**: 前端通过 `window.electronAPI` 调用后端功能
4. **状态管理**: 所有状态集中在 `imageStore.ts`，组件通过 hooks 访问
5. **虚拟滚动**: 使用 `@tanstack/react-virtual`，只渲染可见区域
6. **数据库清理**: 应用退出时调用 `closeAllDatabases()` 释放资源

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
| `Space` | 幻灯片播放 |
| `F5` | 切换视图模式 |
| `F6` | 切换文件夹侧边栏 |
