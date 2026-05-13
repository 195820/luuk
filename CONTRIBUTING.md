# 贡献指南

感谢您对 Luuk 图片查看器项目的关注！

## 🛠️ 开发环境设置

### 环境要求

- Node.js 22.22.0+
- npm 10.9.4+
- Windows 10/11 (64 位)

### 安装步骤

```bash
# 1. 克隆仓库
git clone <repository-url>
cd luuk

# 2. 安装依赖
npm install

# 3. 启动开发服务器
npm run dev
```

开发服务器会自动监听文件变化并热重载。

## 📝 代码规范

### TypeScript

- 启用严格模式
- 禁止隐式 `any`
- 使用接口定义数据结构
- 导出类型使用命名导出

```typescript
// ✅ 好的做法
interface ImageProps {
  src: string;
  alt: string;
}

export function Image({ src, alt }: ImageProps) {
  // ...
}

// ❌ 避免
function Image({ src, alt }: any) {
  // ...
}
```

### React

- 使用函数组件和 Hooks
- 组件文件使用 PascalCase 命名
- 样式文件使用 kebab-case 命名

```typescript
// 组件文件：ImageViewer.tsx
// 样式文件：image-viewer.css
```

### CSS

- 使用设计令牌（CSS 变量）
- 避免硬编码值
- 遵循现有设计系统

```css
/* ✅ 使用设计令牌 */
.button {
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: var(--space-2) var(--space-4);
}

/* ❌ 避免硬编码 */
.button {
  background: #1a1a1a;
  color: #ffffff;
  padding: 8px 16px;
}
```

### 命名约定

| 类型 | 风格 | 示例 |
|------|------|------|
| 组件 | PascalCase | `ImageViewer` |
| 文件 | PascalCase/kebab-case | `ImageViewer.tsx` |
| 函数/变量 | camelCase | `getImagePath` |
| 常量 | UPPER_SNAKE_CASE | `FAVORITE_LIBRARY_ID` |
| 类型/接口 | PascalCase | `ImageProps` |
| CSS 类 | kebab-case | `.image-grid` |

## 🔄 Git 工作流

### 分支管理

```bash
# 创建功能分支
git checkout -b feature/your-feature

# 创建修复分支
git checkout -b fix/issue-description

# 推送分支
git push origin feature/your-feature
```

### 提交信息

使用语义化提交信息：

```
<type>: <subject>
```

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档更新 |
| `style` | 代码格式调整 |
| `refactor` | 重构 |
| `test` | 测试相关 |
| `chore` | 构建/工具配置 |

**示例：**
```bash
feat: 添加图片评分功能
fix: 修复缩略图缓存冲突问题
docs: 更新架构文档
```

### 提交前检查

```bash
# 检查类型
npx tsc --noEmit
```

## 🏗️ 构建和发布

### 构建

```bash
# 构建前端 + Electron 打包
npm run build

# 仅构建前端（不打包）
npm run build:dir

# 预览构建结果
npm run preview
```

### 构建输出

| 目录 | 说明 |
|------|------|
| `dist/` | 前端构建输出 |
| `dist-electron/` | Electron 主进程构建输出 |
| `release/` | 最终安装包（NSIS） |

## 🐛 问题报告

报告问题时请包含：

1. **问题描述** - 清晰描述遇到的问题
2. **重现步骤** - 详细的重现步骤
3. **预期行为** - 期望的正确行为
4. **环境信息** - OS、Node.js 版本、应用版本
5. **截图/录屏** - 如可能，提供视觉材料

## 💡 功能请求

提出新功能时请说明：

1. **功能描述** - 清晰描述功能需求
2. **使用场景** - 为什么需要这个功能
3. **参考示例** - 类似功能的参考实现

## 📚 相关资源

- [React 文档](https://react.dev/)
- [TypeScript 文档](https://www.typescriptlang.org/)
- [Electron 文档](https://www.electronjs.org/)
- [Zustand 文档](https://zustand-demo.pmnd.rs/)

## 📞 联系方式

- GitHub Issues: [项目 Issue 页面](<repository-url>/issues)

感谢您的贡献！
