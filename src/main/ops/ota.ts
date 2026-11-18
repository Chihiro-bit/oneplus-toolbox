import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { fullOtaTimestamp, isOtaId } from '@shared/ota'
import type { OperationResult } from '@shared/types'
import { getOtaCatalog } from '../ota-catalog'
import { CancelledError, exec, tools } from '../exec'
import { OpError, type OpContext } from './common'

export async function verifyOta(id: string, path: string, ctx: OpContext): Promise<OperationResult> {
  if (!isOtaId(id) || typeof path !== 'string'
    || !isAbsolute(path) || !/\.zip$/i.test(path)) throw new OpError('请选择目录中的全量 OTA 条目和本地 ZIP')
  const entry = (await getOtaCatalog()).entries.find(item => item.id === id)
  if (!entry || (!entry.md5 && !entry.sha256)) throw new OpError('此版本没有可供核对的目录摘要')

  const file = await stat(path)
  if (!file.isFile() || (entry.size && file.size !== entry.size)) throw new OpError('ZIP 文件大小与目录记录不一致')
  const sha = createHash('sha256')
  const md5 = entry.md5 ? createHash('md5') : undefined
  let bytes = 0, last = -10
  try {
    for await (const chunk of createReadStream(path, { signal: ctx.signal })) {
      sha.update(chunk)
      md5?.update(chunk)
      bytes += chunk.length
      const percent = Math.floor(bytes / file.size * 100)
      if (percent >= last + 10) {
        last = percent
        ctx.step(`正在校验 OTA ZIP（${percent}%）`)
      }
    }
  } catch (error) {
    if (ctx.signal.aborted) throw new CancelledError()
    throw error
  }
  const sha256 = sha.digest('hex')
  if ((entry.md5 && md5?.digest('hex') !== entry.md5) || (entry.sha256 && sha256 !== entry.sha256)) {
    throw new OpError('ZIP 的摘要与目录不一致，请核对版本和地区，或重新下载')
  }

  ctx.step('正在检查全量 OTA 元数据')
  const inspect = (args: string[]) => exec(tools.sevenZip, args, { signal: ctx.signal, timeoutMs: 25_000, echoOutput: false })
  const metadata = await inspect(['e', '-so', '-tzip', path, 'META-INF/com/android/metadata'])
  const timestamp = metadata.code === 0 ? fullOtaTimestamp(metadata.stdout) : undefined
  const payload = await inspect(['l', '-slt', '-ba', '-tzip', path, 'payload.bin'])
  if (!timestamp || payload.code !== 0 || !/^Path = payload\.bin\r?$/m.test(payload.stdout)) {
    throw new OpError('未确认这是带 payload.bin 的标准全量 A/B OTA。增量包和线刷包不能从此处传入')
  }

  return { ok: true, message: `已校验 ${entry.version}（${entry.region}）全量 OTA`, ota: { path, sha256, entryId: id, timestamp } }
}
