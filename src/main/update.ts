import { app, net } from 'electron'
import type { UpdateInfo } from '@shared/types'
import { loadSettings } from './settings'

function parse(v: string): number[] {
  return v.replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
}

function newer(a: string, b: string): boolean {
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

/** 通过 releases/latest 的跳转地址取最新 tag，不走 GitHub API，避免限流 */
export async function checkUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  const { updateRepo } = loadSettings()
  if (!updateRepo) return { current, hasUpdate: false, error: '未配置更新仓库' }
  try {
    const res = await net.fetch(`https://github.com/${updateRepo}/releases/latest`, { redirect: 'manual' } as RequestInit)
    const loc = res.headers.get('location') ?? ''
    const tag = loc.match(/\/releases\/tag\/([^/?#]+)/)?.[1]
    if (!tag) return { current, hasUpdate: false, error: '该仓库还没有发布版本' }
    const latest = decodeURIComponent(tag)
    return { current, latest, url: `https://github.com/${updateRepo}/releases/tag/${tag}`, hasUpdate: newer(latest, current) }
  } catch (e) {
    return { current, hasUpdate: false, error: (e as Error).message }
  }
}
