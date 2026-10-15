import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      // 主进程模块会在顶层 import electron；测试只覆盖纯函数，用桩代替
      electron: resolve('test/electron-stub.ts')
    }
  },
  define: { __DEFAULT_UPDATE_REPO__: '""' },
  test: { include: ['test/**/*.test.ts'] }
})
