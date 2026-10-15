import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import type { BackupOptions, OperationResult, StockPartition } from '@shared/types'
import { getProps } from '../device'
import { sha256File } from '../download'
import { backupDir, backupImage } from '../history'
import { adb, OpError, REMOTE_DIR, requireSystem, type OpContext } from './common'
import { extractImages, findFile, workDir } from './root'

/**
 * 基带、校准数据所在的分区：坏了刷什么 ROM 都恢复不了（IMEI 丢失、没信号、传感器失灵），只能靠自己的备份。
 * 这些分区不随 ROM 提供，每台手机都不一样。
 */
const UNIQUE_PARTITIONS = ['persist', 'modemst1', 'modemst2', 'fsg', 'fsc', 'ocdt']
/** 当前槽位的启动相关分区（这些 ROM 里有，备份是为了以后刷回「当时的样子」） */
const SLOT_PARTITIONS = ['boot', 'init_boot', 'vendor_boot', 'dtbo']
/** 从 ROM 里提取并保存的原厂镜像 */
const ROM_PARTITIONS: StockPartition[] = ['init_boot', 'boot', 'vendor_boot', 'dtbo', 'vbmeta', 'vbmeta_system', 'vbmeta_vendor']

const stamp = (): string => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

export async function backupPartitions(opts: BackupOptions, ctx: OpContext): Promise<OperationResult> {
  return opts.source === 'device' ? backupFromDevice(ctx) : backupFromRom(opts.rom ?? '', ctx)
}

/** 已 Root：在手机上用 dd 读出分区，拉回电脑，逐个记下 sha256。只读，不写手机上的任何分区 */
async function backupFromDevice(ctx: OpContext): Promise<OperationResult> {
  const serial = await requireSystem(ctx)
  const props = await getProps(serial, ctx.signal)
  // 要拼进 shell 命令，只接受 _a / _b
  const slot = /^_[ab]$/.test(props['ro.boot.slot_suffix'] ?? '') ? props['ro.boot.slot_suffix'] : ''

  ctx.step('正在获取 Root 权限，手机上弹出授权时请点允许')
  const id = await adb(serial, ['shell', "timeout 30 su -c 'id -u' 2>&1"], ctx, 45_000)
  if (id.stdout.trim().split(/\r?\n/).pop() !== '0')
    throw new OpError('没有拿到 Root 权限。没 Root 的手机可以改用「从 ROM 提取原厂镜像」；已 Root 的请在管理器里允许 Shell 的超级用户权限')

  // 先列出手机上实际存在的分区，不同机型不全有
  const wanted = [...UNIQUE_PARTITIONS, ...SLOT_PARTITIONS.map((p) => `${p}${slot}`)]
  const ls = await adb(serial, ['shell', `su -c 'for p in ${wanted.join(' ')}; do [ -e /dev/block/by-name/$p ] && echo "HAS|$p"; done'`], ctx, 30_000, false)
  const present = [...ls.stdout.matchAll(/^HAS\|(\S+)/gm)].map((m) => m[1])
  if (present.length === 0) throw new OpError('在 /dev/block/by-name 下没找到要备份的分区')
  const skipped = wanted.filter((p) => !present.includes(p))
  if (skipped.length) ctx.log('info', `这台手机没有：${skipped.join('、')}`)

  const dir = join(backupDir(app.getPath('documents'), serial, props['ro.build.date.utc']), `partitions_${stamp()}`)
  mkdirSync(dir, { recursive: true })
  const remote = `${REMOTE_DIR}/backup`
  await adb(serial, ['shell', `rm -rf ${remote} && mkdir -p ${remote}`], ctx)
  const manifest: string[] = []
  try {
    for (const p of present) {
      ctx.step(`正在备份 ${p}`)
      // dd 由 root 写出，改成所有人可读，adb pull（shell 身份）才拉得下来
      const r = await adb(serial, ['shell', `su -c 'dd if=/dev/block/by-name/${p} of=${remote}/${p}.img bs=1048576 2>&1 && chmod 644 ${remote}/${p}.img'`], ctx, 600_000)
      if (r.code !== 0) throw new OpError(`读取 ${p} 失败，详见日志`)
      const local = join(dir, `${p}.img`)
      const pull = await adb(serial, ['pull', `${remote}/${p}.img`, local], ctx, 600_000)
      if (pull.code !== 0 || !existsSync(local)) throw new OpError(`从手机取回 ${p} 失败`)
      await adb(serial, ['shell', `rm -f ${remote}/${p}.img`], ctx)
      manifest.push(`${await sha256File(local)}  ${p}.img  ${statSync(local).size}`)
    }
  } finally {
    await adb(serial, ['shell', `rm -rf ${remote}`], ctx).catch(() => {})
  }
  writeFileSync(
    join(dir, 'SHA256SUMS.txt'),
    [`# ${props['ro.product.model'] ?? ''} ${props['ro.build.display.id'] ?? ''}  ${new Date().toLocaleString('zh-CN', { hour12: false })}`, ...manifest, ''].join('\n')
  )
  return {
    ok: true,
    message: `已备份 ${present.length} 个分区。persist、modemst 等是这台手机独有的数据，请另外复制一份到网盘或其它电脑`,
    outputPath: join(dir, 'SHA256SUMS.txt')
  }
}

/** 没 Root：从和手机版本一致的 ROM 里提取原厂启动镜像，存进备份目录，卡开机时可以直接用 */
async function backupFromRom(rom: string, ctx: OpContext): Promise<OperationResult> {
  if (!rom.trim()) throw new OpError('请先选择 ROM')
  const serial = await requireSystem(ctx)
  const props = await getProps(serial, ctx.signal)
  const dir = workDir()
  await extractImages(rom.trim(), props['ro.build.date.utc'], dir, ctx, false, ROM_PARTITIONS)
  const saved: string[] = []
  let last = ''
  for (const p of ROM_PARTITIONS) {
    const img = findFile(dir, `${p}.img`)
    if (!img) continue
    last = (await backupImage(serial, props['ro.build.date.utc'], p, img)).path
    saved.push(p)
  }
  if (saved.length === 0) throw new OpError('没能从 ROM 中提取出任何镜像')
  return { ok: true, message: `已保存原厂 ${saved.join('、')}（${basename(join(last, '..'))}）`, outputPath: last }
}
