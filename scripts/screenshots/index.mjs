// 生成 README 用的截图：用模拟数据驱动构建好的界面，再用 Edge / Chrome 无头模式截图。
// 用法：npm run build && npm run screenshots
// 浏览器路径可用环境变量 BROWSER 指定。

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const ROOT = join(import.meta.dirname, '..', '..')
const RENDERER = join(ROOT, 'out', 'renderer')
const OUT = join(ROOT, 'docs', 'screenshots')
const PORT = 5179

const SCENES = [
  { file: 'overview', query: 'dev=system' },
  { file: 'overview-dark', query: 'dev=system', dark: true },
  { file: 'root', query: 'page=一键 Root&scene=root' },
  { file: 'root-running', query: 'page=一键 Root&scene=root-running&logs=1' },
  { file: 'root-apatch', query: 'page=一键 Root&scene=apatch' },
  { file: 'bootloader', query: 'dev=fastboot&page=Bootloader&scene=unlock' },
  { file: 'edl', query: 'dev=edl&page=9008 救砖&scene=edl' },
  { file: 'apps', query: 'page=应用双开&scene=apps' },
  { file: 'tools', query: 'page=系统工具' }
]

const BROWSERS = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean)

const browser = BROWSERS.find((b) => existsSync(b))
if (!browser) throw new Error('找不到 Edge 或 Chrome，请用环境变量 BROWSER 指定浏览器路径')
if (!existsSync(join(RENDERER, 'index.html'))) throw new Error('请先运行 npm run build')

// 方案目录直接取源码里的内置目录，保证截图和实际一致
const { BUILTIN_CATALOG } = await import(pathToFileURL(join(ROOT, 'out', 'screenshots-catalog.mjs')).href).catch(async () => {
  execFileSync(process.execPath, [
    join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild'),
    join(ROOT, 'src', 'shared', 'catalog.ts'),
    '--bundle',
    '--format=esm',
    `--outfile=${join(ROOT, 'out', 'screenshots-catalog.mjs')}`,
    '--log-level=warning'
  ])
  return import(pathToFileURL(join(ROOT, 'out', 'screenshots-catalog.mjs')).href)
})
const catalogJs = `export default ${JSON.stringify({ schemes: BUILTIN_CATALOG.schemes, source: 'builtin' })}`

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' }
const mock = readFileSync(join(import.meta.dirname, 'mock.js'))

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/mock.js') return res.writeHead(200, { 'content-type': TYPES['.js'] }).end(mock)
  if (url.pathname === '/catalog.js') return res.writeHead(200, { 'content-type': TYPES['.js'] }).end(catalogJs)
  const file = join(RENDERER, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname))
  if (!file.startsWith(RENDERER) || !existsSync(file)) return res.writeHead(404).end()
  let body = readFileSync(file)
  if (file.endsWith('index.html'))
    body = body
      .toString()
      .replace('<head>', '<head><script src="/mock.js"></script>')
      .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  res.writeHead(200, { 'content-type': `${TYPES[extname(file)] ?? 'application/octet-stream'}; charset=utf-8` }).end(body)
})
await new Promise((r) => server.listen(PORT, r))

mkdirSync(OUT, { recursive: true })
// 独立的浏览器配置目录，避免和正在使用的浏览器冲突
const profile = mkdtempSync(join(tmpdir(), 'toolbox-shots-'))
// 必须异步调用浏览器：同步调用会阻塞本进程，内置的页面服务器就无法响应
const run = promisify(execFile)
for (const s of SCENES) {
  const target = join(OUT, `${s.file}.png`)
  await run(browser, [
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1280,800',
    '--virtual-time-budget=3000',
    ...(s.dark ? ['--blink-settings=preferredColorScheme=0'] : ['--blink-settings=preferredColorScheme=1']),
    `--screenshot=${target}`,
    `http://localhost:${PORT}/?${encodeURI(s.query)}`
  ], { timeout: 60_000 })
  console.log(`✓ docs/screenshots/${s.file}.png`)
}
server.close()
rmSync(profile, { recursive: true, force: true })
