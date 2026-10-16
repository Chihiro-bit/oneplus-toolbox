import type { Catalog, RootFamily, RootScheme } from './types'

/**
 * 内置方案目录。下载地址全部指向各项目的 GitHub Releases，sha256 取自 GitHub 公布的资产摘要。
 * 需要更新版本时，可以改这里，也可以在设置里填一个远程 catalog.json（格式见 catalog/README.md）。
 */
export const BUILTIN_CATALOG: Catalog = {
  schemaVersion: 1,
  updated: '2026-10-14',
  schemes: [
    {
      id: 'magisk',
      name: 'Magisk',
      family: 'magisk',
      version: '30.7',
      package: 'com.topjohnwu.magisk',
      apk: {
        url: 'https://github.com/topjohnwu/Magisk/releases/download/v30.7/Magisk-v30.7.apk',
        sha256: 'e0d32d2123532860f97123d927b1bb86c4e08e6fd8a48bfc6b5bee0afae9ebd5',
        size: 11_613_864
      },
      homepage: 'https://github.com/topjohnwu/Magisk',
      note: '最通用的方案。部分老机型（一加 7T / 8 / 8T / 9R 等）不适用'
    },
    {
      id: 'magisk-bundled',
      name: 'Magisk（内置）',
      family: 'magisk',
      version: '30.7',
      package: 'com.topjohnwu.magisk',
      apk: { bundled: true },
      homepage: 'https://github.com/topjohnwu/Magisk',
      note: '随工具箱附带，无需联网下载'
    },
    {
      id: 'apatch',
      name: 'APatch',
      family: 'apatch',
      version: '11224',
      package: 'me.bmax.apatch',
      apk: {
        url: 'https://github.com/bmax121/APatch/releases/download/11224/APatch_11224_9a63e0f_HEAD-release-signed.apk',
        sha256: 'f1986f9a9c3b2b2d5ca09aa6b9ef24226fef662f8faf5677ce1447ffcae68590',
        size: 6_569_091
      },
      homepage: 'https://github.com/bmax121/APatch',
      note: '修补内核（boot），需要设置超级密钥。一加 8 / 8 Pro 不支持'
    },
    {
      id: 'kernelsu',
      name: 'KernelSU',
      family: 'ksu',
      version: '3.3.1',
      package: 'me.weishu.kernelsu',
      apk: {
        url: 'https://github.com/tiann/KernelSU/releases/download/v3.3.1/KernelSU_v3.3.1_32680-release.apk',
        sha256: 'b4a059ace71de2fa65cc7f12b1c58d55fc23ab25e057ee4230ce779742abe450',
        size: 13_637_206
      },
      homepage: 'https://github.com/tiann/KernelSU',
      note: '仅支持 GKI 2.0 设备（Android 12 及以后出厂，内核 5.10+）。不支持时修补会失败，不会刷入任何东西'
    },
    {
      id: 'kernelsu-next',
      name: 'KernelSU Next',
      family: 'ksu',
      version: '3.4.2',
      package: 'com.rifsxd.ksunext',
      apk: {
        url: 'https://github.com/KernelSU-Next/KernelSU-Next/releases/download/v3.4.2/KernelSU_Next_v3.4.2_33355-release.apk',
        sha256: '774a5511f7034a4930e881114e202319cbdc34c5aaaa5c7c6b6d2902364e4c58',
        size: 16_682_167
      },
      homepage: 'https://github.com/KernelSU-Next/KernelSU-Next',
      note: '仅支持 GKI 2.0 设备'
    },
    {
      id: 'sukisu-ultra',
      name: 'SukiSU Ultra',
      family: 'ksu',
      version: '4.2.0',
      package: 'com.sukisu.ultra',
      apk: {
        url: 'https://github.com/SukiSU-Ultra/SukiSU-Ultra/releases/download/v4.2.0/SukiSU_v4.2.0_40900-release.apk',
        sha256: '4ca9810e6355fbff0bbe4bf5ce159808e64a40d85987a11894030cd990a6bdf3',
        size: 14_084_162
      },
      homepage: 'https://github.com/SukiSU-Ultra/SukiSU-Ultra',
      note: '仅支持 GKI 2.0 设备'
    }
  ]
}

/** 系统工具里一键安装 / 启动的 Shizuku。GitHub 没有公布资产摘要，sha256 是从 Releases 下载后计算的 */
export const SHIZUKU = {
  package: 'moe.shizuku.privileged.api',
  version: '13.6.0',
  url: 'https://github.com/RikkaApps/Shizuku/releases/download/v13.6.0/shizuku-v13.6.0.r1086.2650830c-release.apk',
  sha256: '6e273ab0e991c4e79bc8b1bbb9b9dd739ccac1a8712a541a214078886b7b790f',
  homepage: 'https://github.com/RikkaApps/Shizuku'
} as const

export const FAMILY_LABEL: Record<RootFamily, string> = {
  magisk: 'Magisk 系',
  apatch: 'APatch',
  ksu: 'KernelSU 系'
}

/** 已知的 Root 管理器包名，切换方案时用于卸载旧管理器 */
export const KNOWN_MANAGERS = [
  'com.topjohnwu.magisk',
  'io.github.huskydg.magisk',
  'io.github.vvb2060.magisk',
  'me.bmax.apatch',
  'me.weishu.kernelsu',
  'com.rifsxd.ksunext',
  'com.sukisu.ultra',
  'com.resukisu.resukisu'
]

const FAMILIES: RootFamily[] = ['magisk', 'apatch', 'ksu']

/** 校验远程目录：只接受数据字段，下载地址必须是 https，哈希必须是 sha256 */
export function validateCatalog(raw: unknown): Catalog {
  const c = raw as Catalog
  if (!c || c.schemaVersion !== 1 || !Array.isArray(c.schemes)) throw new Error('目录格式不正确（需要 schemaVersion: 1 和 schemes 数组）')
  const schemes: RootScheme[] = c.schemes.map((s, i) => {
    const where = `第 ${i + 1} 个方案`
    if (!s || typeof s.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(s.id)) throw new Error(`${where}：id 不合法`)
    if (typeof s.name !== 'string' || !s.name) throw new Error(`${where}：缺少 name`)
    if (!FAMILIES.includes(s.family)) throw new Error(`${where}：family 必须是 ${FAMILIES.join(' / ')}`)
    if (typeof s.version !== 'string') throw new Error(`${where}：缺少 version`)
    if (typeof s.package !== 'string' || !/^[\w.]+$/.test(s.package)) throw new Error(`${where}：package 不合法`)
    if (!s.apk || typeof s.apk.url !== 'string' || !/^https:\/\//.test(s.apk.url)) throw new Error(`${where}：apk.url 必须是 https 地址`)
    if (typeof s.apk.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(s.apk.sha256)) throw new Error(`${where}：apk.sha256 必须是 64 位十六进制`)
    return {
      id: s.id,
      name: s.name,
      family: s.family,
      version: s.version,
      package: s.package,
      apk: { url: s.apk.url, sha256: s.apk.sha256.toLowerCase(), size: typeof s.apk.size === 'number' ? s.apk.size : undefined },
      homepage: typeof s.homepage === 'string' && /^https:\/\//.test(s.homepage) ? s.homepage : undefined,
      note: typeof s.note === 'string' ? s.note : undefined
    }
  })
  return { schemaVersion: 1, updated: typeof c.updated === 'string' ? c.updated : undefined, schemes }
}

/** 远程目录覆盖同 id 的内置方案，新 id 追加在后；内置的离线方案始终保留 */
export function mergeCatalog(remote: Catalog): RootScheme[] {
  const byId = new Map(BUILTIN_CATALOG.schemes.map((s) => [s.id, s]))
  for (const s of remote.schemes) if (!byId.get(s.id)?.apk.bundled) byId.set(s.id, s)
  return [...byId.values()]
}
