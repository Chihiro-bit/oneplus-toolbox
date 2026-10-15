import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import type { OperationResult } from '@shared/types'
import { getProps } from '../device'
import { exec, tools } from '../exec'
import { adb, OpError, requireSystem, type OpContext } from './common'
import { workDir } from './root'

export const INSTALL_EXTENSIONS = ['apk', 'apks', 'xapk']

const ABI_SPLIT = /(?:^|[._-])(arm64_v8a|armeabi_v7a|armeabi|x86_64|x86|mips64|mips)\.apk$/i

/**
 * 从分包里挑出要装的 APK：ABI 分包只留手机最优先支持的那一种，其余（base、语言、屏幕密度）全装。
 * bundletool 的 .apks 里 standalones/ 是给不支持分包的老系统用的整包，跳过。
 * names 为相对路径（/ 分隔），abiList 为 ro.product.cpu.abilist（逗号分隔）
 */
export function pickSplits(names: string[], abiList: string): string[] {
  const apks = names.filter((n) => /\.apk$/i.test(n) && !/^(standalones|instant)\//i.test(n))
  const abis = abiList.split(',').map((a) => a.trim().replace(/-/g, '_').toLowerCase()).filter(Boolean)
  const abiOf = (n: string) => n.match(ABI_SPLIT)?.[1].toLowerCase()
  const present = new Set(apks.map(abiOf).filter(Boolean))
  const best = abis.find((a) => present.has(a))
  return apks.filter((n) => {
    const abi = abiOf(n)
    return !abi || abi === best
  })
}

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name), root) : [relative(root, join(dir, e.name)).replace(/\\/g, '/')]
  )
}

/** 失败原因只取 Failure [...] 那一行 */
function failure(out: string): string {
  return out.match(/Failure \[[^\]]*\]/)?.[0] ?? out.trim().split(/\r?\n/).pop() ?? '未知错误'
}

interface XapkExpansion {
  file: string
  install_path: string
}

/**
 * 批量安装：.apk 用 adb install，.apks / .xapk 解开后用 adb install-multiple 装成一个应用；
 * .xapk 里带的 OBB 数据包推到 manifest 指定的位置。所有文件先复制到临时目录再交给 adb，避开中文路径
 */
export async function installApps(files: string[], ctx: OpContext): Promise<OperationResult> {
  if (files.length === 0) throw new OpError('请先选择要安装的文件')
  const serial = await requireSystem(ctx)
  const abiList = (await getProps(serial, ctx.signal))['ro.product.cpu.abilist'] ?? ''
  const dir = workDir()
  const ok: string[] = []
  const failed: string[] = []

  for (const [i, file] of files.entries()) {
    const name = basename(file)
    const ext = extname(file).slice(1).toLowerCase()
    if (!INSTALL_EXTENSIONS.includes(ext) || !existsSync(file)) {
      ctx.log('warn', `跳过 ${name}：不是 APK / APKS / XAPK 文件`)
      failed.push(name)
      continue
    }
    ctx.step(`正在安装 ${name}（${i + 1}/${files.length}）`)

    let r
    if (ext === 'apk') {
      const copy = join(dir, `app_${i}.apk`)
      copyFileSync(file, copy)
      r = await adb(serial, ['install', '-r', copy], ctx, 300_000)
    } else {
      const out = join(dir, `bundle_${i}`)
      mkdirSync(out, { recursive: true })
      const x = await exec(tools.sevenZip, ['x', file, `-o${out}`, '-y'], { signal: ctx.signal, timeoutMs: 600_000 })
      if (x.code !== 0) {
        ctx.log('error', `${name} 解压失败，文件可能已损坏或被加密`)
        failed.push(name)
        continue
      }
      const splits = pickSplits(listFiles(out), abiList)
      if (splits.length === 0) {
        ctx.log('error', `${name} 里没有找到 APK`)
        failed.push(name)
        continue
      }
      ctx.log('info', `${name}：${splits.length} 个分包（${splits.map((s) => basename(s)).join('、')}）`)
      r = await adb(serial, ['install-multiple', '-r', ...splits.map((s) => join(out, s))], ctx, 600_000)
      if (r.code === 0 && r.all.includes('Success') && ext === 'xapk') await pushObb(serial, out, ctx)
    }

    if (r.code === 0 && r.all.includes('Success')) {
      ok.push(name)
      ctx.log('ok', `${name} 安装成功`)
    } else {
      failed.push(name)
      ctx.log('error', `${name} 安装失败：${failure(r.all)}`)
    }
  }

  if (failed.length === 0) return { ok: true, message: ok.length === 1 ? `${ok[0]} 安装成功` : `${ok.length} 个应用全部安装成功` }
  return {
    ok: ok.length > 0,
    message: `成功 ${ok.length} 个，失败 ${failed.length} 个（${failed.join('、')}），失败原因见日志`
  }
}

/** XAPK 的 manifest.json 里 expansions 列出 OBB 及其在手机上的位置（如 Android/obb/<包名>/main.1.xxx.obb） */
async function pushObb(serial: string, dir: string, ctx: OpContext): Promise<void> {
  let expansions: XapkExpansion[] = []
  try {
    expansions = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).expansions ?? []
  } catch {
    return
  }
  for (const e of expansions) {
    // 只接受 Android/obb 下的相对路径，防止 manifest 把文件写到别处
    if (typeof e.file !== 'string' || typeof e.install_path !== 'string') continue
    if (!/^Android\/obb\/[\w.]+\/[^/]+$/.test(e.install_path) || e.file.includes('..')) continue
    const src = join(dir, e.file)
    if (!existsSync(src)) continue
    ctx.step(`正在推送数据包 ${basename(e.install_path)}`)
    const r = await adb(serial, ['push', src, `/sdcard/${e.install_path}`], ctx, 1_800_000)
    if (r.code !== 0) ctx.log('warn', `数据包 ${basename(e.install_path)} 推送失败，应用可能需要自行下载数据`)
  }
}
