// 主进程与渲染进程共用的类型

/** none=未连接，system=开机(adb)，recovery=Recovery(adb)，fastboot=Fastboot，unauthorized=adb 未授权 */
export type DeviceMode = 'none' | 'system' | 'recovery' | 'fastboot' | 'unauthorized'

export interface DeviceInfo {
  mode: DeviceMode
  serial?: string
  /** 同时连接了多台设备 */
  multiple?: boolean
  model?: string
  brand?: string
  manufacturer?: string
  device?: string
  androidVersion?: string
  buildId?: string
  romVersion?: string
  slot?: string
  /** 仅 fastboot 下可读 */
  unlocked?: boolean
}

export type RebootTarget = 'system' | 'recovery' | 'bootloader' | 'edl'

export type PatchTarget = 'auto' | 'boot' | 'init_boot'

// ───────────── Root 方案目录 ─────────────

/** 修补方式：Magisk 系（含 Kitsune / Alpha）、APatch、KernelSU 系（含 Next / SukiSU） */
export type RootFamily = 'magisk' | 'apatch' | 'ksu'

export interface RootScheme {
  id: string
  name: string
  family: RootFamily
  version: string
  /** 管理器 App 的包名 */
  package: string
  apk: {
    /** 内置于工具箱中（离线可用） */
    bundled?: boolean
    url?: string
    sha256?: string
    /** 字节数，仅用于显示 */
    size?: number
  }
  homepage?: string
  note?: string
}

export interface Catalog {
  schemaVersion: 1
  updated?: string
  schemes: RootScheme[]
}

export interface CatalogState {
  schemes: RootScheme[]
  /** builtin=内置目录，remote=远程目录（已合并内置），cache=远程目录的本地缓存 */
  source: 'builtin' | 'remote' | 'cache'
  error?: string
}

export interface RootOptions {
  /** 本地 ROM 路径，或 http(s) URL（payload-dumper-rust 支持按需读取） */
  rom: string
  /** 目录中的方案 id；为 'custom' 时使用 customApk + customFamily */
  schemeId: string
  customApk?: string
  customFamily?: RootFamily
  target: PatchTarget
  /** APatch 必填的超级密钥 */
  superkey?: string
  /** 只生成修补后的镜像，不刷入 */
  patchOnly: boolean
  /** 同时刷入 ROM 中原厂的另一个分区，清除之前装过的其它 Root */
  flashOther: boolean
  /** 卸载其它 Root 管理器 App */
  uninstallOthers: boolean
}

export interface AppEntry {
  package: string
  label: string
  /** 已在双开空间（用户 999）中 */
  cloned: boolean
}

export type OperationRequest =
  | { kind: 'reboot'; target: RebootTarget }
  | { kind: 'unlock' }
  | { kind: 'relock' }
  | { kind: 'switchSlot' }
  | { kind: 'root'; options: RootOptions }
  | { kind: 'listApps' }
  | { kind: 'cloneApp'; package: string; enable: boolean }
  | { kind: 'installPlay'; apk: string }
  | { kind: 'otaUpdates'; disable: boolean }

export type LogLevel = 'info' | 'cmd' | 'ok' | 'warn' | 'error' | 'step'

export interface LogEntry {
  time: number
  level: LogLevel
  text: string
}

export interface OperationResult {
  ok: boolean
  message: string
  /** 修补后镜像的保存位置等附加产物 */
  outputPath?: string
  /** listApps 的结果 */
  apps?: AppEntry[]
}

export interface Settings {
  /** 远程方案目录（只含数据：URL + sha256），留空则只用内置目录 */
  catalogUrl: string
  /** 检查新版本用的 GitHub 仓库，形如 owner/repo */
  updateRepo: string
}

export interface UpdateInfo {
  current: string
  latest?: string
  url?: string
  hasUpdate: boolean
  error?: string
}

export interface ToolboxApi {
  getDevice(): Promise<DeviceInfo>
  onDevice(cb: (d: DeviceInfo) => void): () => void
  onLog(cb: (e: LogEntry) => void): () => void
  onStep(cb: (step: string) => void): () => void
  /** 应用图标分批到达：包名 → data URL */
  onAppIcons(cb: (icons: Record<string, string>) => void): () => void
  run(req: OperationRequest): Promise<OperationResult>
  cancel(): Promise<void>
  pickRom(): Promise<string | null>
  pickApk(title: string): Promise<string | null>
  getCatalog(refresh?: boolean): Promise<CatalogState>
  getSettings(): Promise<Settings>
  setSettings(s: Settings): Promise<Settings>
  checkUpdate(): Promise<UpdateInfo>
  openPath(p: string): Promise<void>
  openExternal(url: string): Promise<void>
}
