# Image Viewer - 图片查看器

一个专为**大量高清写真图片**设计的本地图片查看器。

## 🚀 快速开始

### 开发模式

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 构建

```bash
# 构建前端和 Electron
npm run build

# 仅构建前端
npm run build:dir
```

## 📋 技术栈

### 前端
- **React 19** - UI 框架
- **TypeScript 5.9** - 类型安全
- **Vite 7** - 构建工具
- **Zustand 5** - 状态管理
- **@tanstack/react-virtual** - 虚拟滚动
- **react-zoom-pan-pinch** - 图片缩放

### 后端 (Electron)
- **Electron 39** - 跨平台框架
- **better-sqlite3** - 高性能数据库
- **sharp** - 图片处理
- **chokidar** - 文件监听
- **electron-store** - 配置存储

## 📁 项目结构

```
E:\luuk\
├── electron/           # Electron 主进程和预加载脚本
│   ├── main.ts
│   └── preload.ts
├── src/               # React 前端代码
│   ├── components/    # UI 组件
│   ├── stores/        # Zustand 状态
│   ├── types/         # TypeScript 类型
│   ├── utils/         # 工具函数
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── dist/              # 构建输出
├── dist-electron/     # Electron 构建输出
├── release/           # 打包输出
├── package.json
├── tsconfig.json
├── vite.config.ts
└── electron-builder.json
```

## 🎯 核心功能

### 第一阶段 (MVP)
- ✅ 快速加载大图
- ✅ 缩放/平移
- ✅ 缩略图网格视图
- ✅ 懒加载
- ✅ 多库管理

### 后续功能
- AI 修图（超分辨率、去水印）
- 图片爬虫
- 跨库搜索
- 收藏/标签/评分

## 📝 开发计划

| 周次 | 任务 |
|------|------|
| 第 1 周 | 项目搭建、Electron+React 脚手架 |
| 第 2 周 | 核心图片查看组件（缩放/平移） |
| 第 3 周 | 缩略图网格视图 + 懒加载 |
| 第 4 周 | 多库管理 + 数据库设计 |
| 第 5 周 | 缩略图缓存系统 |
| 第 6 周 | 测试优化、打包发布 |

## 🔧 环境要求

- Node.js 22.22.0+
- npm 10.9.4+
- Windows 10/11 (64 位)

## 📄 许可证

ISC
