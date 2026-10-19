// 从各项目的官方发布地址下载运行所需的第三方工具，校验 sha256 后放到 resources/bin。
// 仓库里不提交任何二进制文件；本地开发和 GitHub Actions 都用这个脚本准备工具。
//
// 用法：npm run fetch-tools
// 升级某个工具时，修改下面的 url 和 sha256 即可（sha256 可在 GitHub Release 页面文件旁看到）。

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import sevenZip from '7zip-bin'

const ROOT = join(import.meta.dirname, '..')
const CACHE = join(ROOT, '.tools-cache')
const BIN = join(ROOT, 'resources', 'bin')

const TOOLS = [
  {
    name: 'Android SDK Platform-Tools r37.0.1（adb / fastboot）',
    url: 'https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip',
    sha256: '45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99',
    unzip: { 'platform-tools/adb.exe': 'platform-tools/adb.exe', 'platform-tools/fastboot.exe': 'platform-tools/fastboot.exe', 'platform-tools/AdbWinApi.dll': 'platform-tools/AdbWinApi.dll', 'platform-tools/AdbWinUsbApi.dll': 'platform-tools/AdbWinUsbApi.dll', 'platform-tools/NOTICE.txt': 'platform-tools/NOTICE.txt' }
  },
  {
    name: 'payload-dumper-rust v0.8.4（ROM 解包，支持 URL）',
    url: 'https://github.com/rhythmcache/payload-dumper-rust/releases/download/payload-dumper-rust-v0.8.4/payload_dumper-windows-x86_64.zip',
    sha256: 'e2bbee5476a594951d9d2e70c72e0fcf3414ed8d50a48344165bd3b106f778a1',
    unzip: { 'payload_dumper.exe': 'payload_dumper.exe' }
  },
  {
    name: 'aapt2 arm64-v8a（ReVanced/aapt2 v1.1.0，推到手机上读取应用名）',
    url: 'https://github.com/ReVanced/aapt2/releases/download/v1.1.0/aapt2-arm64-v8a',
    sha256: '7e5ae2e1f62fc24cab14072555ffd0a1a7e1ce27e82cc1008967b835b6d8df5b',
    file: 'aapt2'
  },
  {
    name: 'Magisk v30.7（离线 Root 方案）',
    url: 'https://github.com/topjohnwu/Magisk/releases/download/v30.7/Magisk-v30.7.apk',
    sha256: 'e0d32d2123532860f97123d927b1bb86c4e08e6fd8a48bfc6b5bee0afae9ebd5',
    file: 'magisk.apk'
  },
  {
    name: 'qdl v2.8（高通 9008 / EDL 刷写）',
    url: 'https://github.com/linux-msm/qdl/releases/download/v2.8/qdl-binary-windows-x64-v2.8.zip',
    sha256: 'f013b0a38660957feb5959ee5c625013089e9a1f9a9f5e7f21eb0cbd1cdee159',
    unzip: {
      'qdl-binary-windows-x64/qdl.exe': 'qdl/qdl.exe',
      'qdl-binary-windows-x64/libusb-1.0.dll': 'qdl/libusb-1.0.dll',
      'qdl-binary-windows-x64/libxml2-16.dll': 'qdl/libxml2-16.dll',
      'qdl-binary-windows-x64/libzip.dll': 'qdl/libzip.dll',
      'qdl-binary-windows-x64/libbz2-1.dll': 'qdl/libbz2-1.dll',
      'qdl-binary-windows-x64/libiconv-2.dll': 'qdl/libiconv-2.dll',
      'qdl-binary-windows-x64/liblzma-5.dll': 'qdl/liblzma-5.dll',
      'qdl-binary-windows-x64/libzstd.dll': 'qdl/libzstd.dll',
      'qdl-binary-windows-x64/zlib1.dll': 'qdl/zlib1.dll'
    }
  },
  {
    // AAB 不能直接安装，需要用 bundletool 按手机配置转换成分包 APK；Java 运行时由下面的 jlink 一并生成
    name: 'bundletool v1.18.3（AAB 转 APK）',
    url: 'https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar',
    sha256: 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29',
    file: 'bundletool/bundletool.jar'
  },
  {
    // 不带 scrcpy 自己的 adb.exe：启动时用 ADB 环境变量指向工具箱的 adb，避免两个版本的 adb server 互相踢
    name: 'scrcpy v5.0.1（投屏）',
    url: 'https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/scrcpy-win64-v5.0.1.zip',
    sha256: 'b12a2c4ee8be317422451fc7dcf8ee20a71b5ea7ef9ad73ddd825a25316227a5',
    unzip: Object.fromEntries(
      [
        'scrcpy.exe',
        'scrcpy-server',
        'SDL3.dll',
        'avcodec-63.dll',
        'avformat-63.dll',
        'avutil-61.dll',
        'swresample-7.dll',
        'libusb-1.0.dll',
        'scrcpy.png',
        'disconnected.png',
        'LICENSE.txt'
      ].map((f) => [`scrcpy-win64-v5.0.1/${f}`, `scrcpy/${f}`])
    )
  },
  {
    // qdl 的发布包里没有许可证文件，按 BSD-3-Clause 的要求单独随附
    name: 'qdl LICENSE（BSD-3-Clause）',
    url: 'https://raw.githubusercontent.com/linux-msm/qdl/v2.8/LICENSE',
    sha256: '85814c88fc75be2523c03551ee2abefc0c30b423edda343197796e0c0e168058',
    file: 'qdl/LICENSE'
  }
]

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

async function download(tool) {
  const cached = join(CACHE, tool.sha256)
  if (existsSync(cached) && sha256(readFileSync(cached)) === tool.sha256) return cached
  process.stdout.write(`  下载 ${tool.url}\n`)
  const res = await fetch(tool.url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${tool.name} 下载失败：HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const actual = sha256(buf)
  if (actual !== tool.sha256) throw new Error(`${tool.name} 校验失败\n  期望 ${tool.sha256}\n  实际 ${actual}`)
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(cached, buf)
  return cached
}

function extract(archive, entries) {
  const tmp = join(CACHE, 'extract')
  rmSync(tmp, { recursive: true, force: true })
  execFileSync(sevenZip.path7za, ['x', archive, `-o${tmp}`, '-y', '-tzip', ...Object.keys(entries)], { stdio: 'ignore' })
  for (const [from, to] of Object.entries(entries)) {
    const src = join(tmp, from)
    if (!existsSync(src)) throw new Error(`压缩包中缺少 ${from}`)
    mkdirSync(join(BIN, to, '..'), { recursive: true })
    copyFileSync(src, join(BIN, to))
  }
  rmSync(tmp, { recursive: true, force: true })
}

rmSync(BIN, { recursive: true, force: true })
mkdirSync(BIN, { recursive: true })

for (const tool of TOOLS) {
  console.log(`✓ ${tool.name}`)
  const file = await download(tool)
  if (tool.unzip) extract(file, tool.unzip)
  else {
    mkdirSync(join(BIN, tool.file, '..'), { recursive: true })
    copyFileSync(file, join(BIN, tool.file))
  }
}

// 7-Zip 来自 npm 包 7zip-bin，无需下载
cpSync(sevenZip.path7za, join(BIN, '7za.exe'))
console.log('✓ 7-Zip 21.07（7zip-bin）')

// ───────────── 内置精简 Java 运行时（bundletool 需要 Java，用户不必自己装） ─────────────

function findJlink() {
  const exe = process.platform === 'win32' ? 'jlink.exe' : 'jlink'
  const candidates = [
    process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', exe) : '',
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, exe))
  ]
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  for (const parent of ['Java', 'Eclipse Adoptium', 'Microsoft']) {
    try {
      for (const name of readdirSync(join(programFiles, parent))) candidates.push(join(programFiles, parent, name, 'bin', exe))
    } catch {
      /* 目录不存在 */
    }
  }
  return candidates.find((p) => p && existsSync(p))
}

const jlink = findJlink()
if (!jlink) throw new Error('生成内置 Java 运行时需要 JDK 11 或更高版本（找不到 jlink）。请安装 JDK，或设置 JAVA_HOME 后重试')
const jlinkMajor = Number(execFileSync(jlink, ['--version'], { encoding: 'utf8' }).trim().match(/^\d+/)?.[0] ?? 0)
console.log(`✓ 精简 Java 运行时（jlink，JDK ${jlinkMajor}）`)
execFileSync(
  jlink,
  [
    // bundletool 需要 java.xml（DOM）和 jdk.zipfs（读取 jar 文件系统）
    '--add-modules',
    'java.base,java.logging,java.xml,jdk.zipfs',
    '--strip-debug',
    '--no-header-files',
    '--no-man-pages',
    // JDK 21 起改用 zip-N 写法，旧的 0/1/2 已弃用
    `--compress=${jlinkMajor >= 21 ? 'zip-6' : '2'}`,
    '--output',
    join(BIN, 'jre')
  ],
  { stdio: 'inherit' }
)

console.log(`工具已就绪：${BIN}`)
