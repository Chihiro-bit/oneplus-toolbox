import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // GitHub Actions 构建时写入仓库名（owner/repo），作为「检查更新」的默认仓库
    define: { __DEFAULT_UPDATE_REPO__: JSON.stringify(process.env.TOOLBOX_UPDATE_REPO ?? '') }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()]
  }
})
