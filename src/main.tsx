import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/geist-sans'   // 注册 Geist Sans 字体
import '@fontsource/geist-mono'   // 注册 Geist Mono 字体
import App from './App'
import './index.css'              // Tailwind 入口

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
