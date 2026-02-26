import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    // 获取应用版本
    window.electronAPI?.getAppVersion().then(setVersion).catch(console.error)
  }, [])

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>图片查看器</h1>
        {version && <span className="version">v{version}</span>}
      </header>
      
      <main className="app-main">
        <div className="welcome-content">
          <h2>欢迎使用图片查看器</h2>
          <p>专为大量高清写真图片设计的本地图片查看器</p>
          
          <div className="features">
            <div className="feature-card">
              <h3>🚀 快速加载</h3>
              <p>支持 100MB+ 大图秒开，缩略图智能缓存</p>
            </div>
            <div className="feature-card">
              <h3>📁 多库管理</h3>
              <p>支持多个硬盘独立库，统一入口管理</p>
            </div>
            <div className="feature-card">
              <h3>🔍 智能搜索</h3>
              <p>跨库搜索、标签分类、收藏评分</p>
            </div>
            <div className="feature-card">
              <h3>✨ AI 修图</h3>
              <p>超分辨率、智能去水印、自动调色（即将推出）</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
