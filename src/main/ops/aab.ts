import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { exec, tools } from '../exec'
import { DEBUG_KEYSTORE_BASE64 } from './aab-key'
import { OpError, type OpContext } from './common'

/** 优先用随安装包的精简 JRE；开发环境没有它时，再按 JAVA_HOME → PATH → 常见安装位置查找 */
export function findJava(): string | null {
  if (existsSync(tools.java)) return tools.java
  const exe = process.platform === 'win32' ? 'java.exe' : 'java'
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const candidates = [
    process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', exe) : '',
    ...(process.env.PATH ?? '').split(delimiter).map((d) => (d ? join(d, exe) : ''))
  ]
  // Android Studio 自带 JBR，没单独装 Java 的电脑也能用
  for (const sub of ['jbr', 'jre']) candidates.push(join(programFiles, 'Android', 'Android Studio', sub, 'bin', exe))
  // 常见的 JDK 安装目录（下面还有一层带版本号的子目录）
  for (const parent of ['Java', 'Eclipse Adoptium', 'Microsoft']) {
    try {
      for (const name of readdirSync(join(programFiles, parent))) candidates.push(join(programFiles, parent, name, 'bin', exe))
    } catch {
      /* 目录不存在 */
    }
  }
  return candidates.find((p) => p && existsSync(p)) ?? null
}

/** bundletool 会优先用这两个位置里的调试密钥自动签名 */
function hasDebugKeystore(): boolean {
  return [process.env.ANDROID_SDK_HOME, homedir()]
    .filter(Boolean)
    .some((home) => existsSync(join(home!, '.android', 'debug.keystore')))
}

async function javaMajor(java: string, ctx: OpContext): Promise<number | null> {
  const r = await exec(java, ['-version'], { signal: ctx.signal, timeoutMs: 30_000, echoOutput: false })
  const m = r.all.match(/version "(\d+)(?:\.(\d+))?/i)
  if (!m) return null
  return Number(m[1]) === 1 ? Number(m[2]) : Number(m[1])
}

/**
 * 用 bundletool 把 AAB 按当前手机的配置转换成分包 APK 目录。
 * --connected-device + --device-id 只生成这台手机需要的那几个分包。
 * 电脑上没有调试密钥时用内置的一份签名，否则 bundletool 会输出未签名的 APK，装不上
 */
export async function convertAab(bundle: string, out: string, serial: string, ctx: OpContext): Promise<void> {
  if (!existsSync(tools.bundletool)) throw new OpError('缺少 bundletool，开发环境请先运行 npm run fetch-tools')
  const java = findJava()
  if (!java) throw new OpError('没有找到 Java 运行时（工具箱内置的运行时缺失）。请重新安装工具箱；开发环境请先运行 npm run fetch-tools')
  const major = await javaMajor(java, ctx)
  if (major !== null && major < 11) throw new OpError(`安装 AAB 需要 Java 11 或更高版本，当前是 Java ${major}。请升级 Java 后重试`)

  rmSync(out, { recursive: true, force: true })
  ctx.step('正在把 AAB 转换成分包 APK（文件较大时需要几分钟）')
  const args = [
    '-jar',
    tools.bundletool,
    'build-apks',
    `--bundle=${bundle}`,
    `--output=${out}`,
    '--output-format=directory',
    '--connected-device',
    `--device-id=${serial}`,
    `--adb=${tools.adb}`
  ]
  if (!hasDebugKeystore()) {
    const keystore = join(dirname(out), 'debug.keystore')
    writeFileSync(keystore, Buffer.from(DEBUG_KEYSTORE_BASE64, 'base64'))
    args.push(`--ks=${keystore}`, '--ks-key-alias=androiddebugkey', '--ks-pass=pass:android', '--key-pass=pass:android')
  }
  const r = await exec(java, args, { signal: ctx.signal, log: ctx.log, timeoutMs: 900_000 })
  if (r.code !== 0) {
    const last = r.all.trim().split(/\r?\n/).filter(Boolean).pop() ?? '未知错误'
    throw new OpError(`AAB 转换失败：${last}`)
  }
}
