import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// 文件拖到拖放区以外时，浏览器默认会直接打开它并替换整个界面
for (const type of ['dragover', 'drop']) window.addEventListener(type, (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
