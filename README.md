# Image Viewer - 图片查看器

一个专为**大量高清写真图片和多媒体文件**（视频/音频）设计的本地查看器。

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
# 完整构建（tsc → vite → 内置插件编译 → electron-builder 安装包）
npm run build

# 构建但不打包安装包（win-unpacked，调试用）
npm run build:dir

# 仅编译内置插件（dev/build 会自动执行）
npm run build:builtins
```

### 测试

```bash
npm run test         # Vitest watch
npm run test:run     # 单次全量（基线 43 文件 / 393 用例）
npm run test:coverage
```

## 📋 技术栈

### 前端
- **React 19** - UI 框架
- **TypeScript 5.9** - 类型安全
- **Vite 7** - 构建工具
- **Zustand 5** - 状态管理
- **@tanstack/react-virtual** - 虚拟滚动
- **yet-another-react-lightbox (YARL)** - 图片查看（缩放/旋转/幻灯片）
- **wavesurfer.js** - 音频波形可视化

### 后端 (Electron)
- **Electron 40** - 跨平台框架（含 utilityProcess 插件宿主）
- **better-sqlite3** - 高性能数据库
- **sharp** - 图片处理
- **onnxruntime-node** - 本地 AI 推理（超分/抠图）
- **chokidar** - 文件监听
- **electron-store** - 配置存储
- **media:// 协议** - 流式加载媒体文件（HMAC 确定性令牌 + Range + HTTP 缓存）
- **electron-rebuild** - 原生模块重建

## 📁 项目结构

```
D:\luuk\
├── electron/           # Electron 进程（主/预加载/插件 Worker）
│   ├── main.ts
│   ├── preload.ts
│   └── plugin-worker.ts
├── src/
│   ├── main/           # 主进程后端：ipc/ services/ plugins/(AI 子系统) utils/
│   ├── components/    # UI 组件（含 file-ops/ui/layout 子目录）
│   ├── stores/        # Zustand 状态（11 个 store + index 导出）
│   ├── hooks/ types/ utils/
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── scripts/            # 构建/基准/CDP 验证脚本
├── tests/              # Playwright E2E
├── dist/ dist-electron/ release/
└── docs/               # 文档中心（索引见 docs/README.md）
```

## 🎯 核心功能

网格/瀑布流浏览、图片对比、全屏沉浸、视频/音频流式播放、收藏/评分/标签/历史、高级搜索、pHash 相似图、EXIF/直方图/统计、回收站/批量重命名/壁纸、ZIP 导出、幻灯片增强、主题皮肤、缓存管理、**AI 插件系统**（超分/抠图/自动色调 + 后台批处理作业）。

## 📝 项目状态与规划

Phase 1-8 已交付；现状、遗留项与待办见 [docs/roadmap.md](docs/roadmap.md)，开发指引见 [CLAUDE.md](CLAUDE.md)。

## 🔧 环境要求

- Node.js 22.22.0+
- Python 3.14+（部分原生模块编译）
- npm 10.9.4+
- Windows 10/11 (64 位)

## 📄 许可证

ISC
