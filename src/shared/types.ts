// 主进程与渲染进程共用的类型

/** none=未连接，system=开机(adb)，recovery=Recovery(adb)，fastboot=Fastboot，unauthorized=adb 未授权，edl=高通 9008 深刷 */
export type DeviceMode = 'none' | 'system' | 'recovery' | 'fastboot' | 'unauthorized' | 'edl'

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
  /** 仅 edl 下可读：QDLoader 9008 占用的 COM 端口，如 COM5 */
  edlPort?: string
}

export type RebootTarget = 'system' | 'recovery' | 'bootloader' | 'edl'

export type PatchTarget = 'auto' | 'boot' | 'init_boot'

// ───────────── Root 方案目录 ─────────────

/** 修补方式：Magisk 系（含 Kitsune / Alpha）、APatch、KernelSU 系（含 Next / SukiSU） */
export type RootFamily = 'magisk' | 'apatch' | 'ksu'

// ───────────── 9008 救砖 ─────────────

/** qdl 的目标存储类型 */
export type EdlStorage = 'ufs' | 'emmc' | 'nand' | 'nvme' | 'spinor'

/** 检测到的一台 9008 设备 */
export interface EdlDevice {
  /** 设备管理器里的 COM 端口，如 COM5 */
  port: string
  /** 设备名称，如「Qualcomm HS-USB QDLoader 9008」 */
  name: string
}

/**
 * 9008 刷写需要的一整套文件，全部由用户自备：
 * 工具箱只做校验、排序、日志和风险提示，不打包也不下载这些文件。
 */
export interface EdlProfile {
  /** 设备编程器（devprg*.mbn / prog_firehose_ddr.elf） */
  programmer: string
  /** 预签名 VIP 摘要表所在目录，留空表示设备不需要（未启用安全启动） */
  vipDir?: string
  /** rawprogram*.xml / patch*.xml */
  xmls: string[]
  /** 散包镜像所在目录（qdl --include） */
  imagesDir: string
  storage: EdlStorage
  /** 保护 LUN5：跳过 rawprogram5 / patch5 */
  protectLun5: boolean
  /** 散包里缺少某些镜像时跳过而不中止（qdl --allow-missing） */
  allowMissing: boolean
  /** 刷完不重启，把设备留在 9008 */
  skipReset: boolean
  /** 只做预检（qdl --dry-run），不连设备、不刷写 */
  dryRunOnly: boolean
}

/** 检测 / 自检的结果，回填到界面上 */
export interface EdlState {
  ports: EdlDevice[]
  /** qdl list 的原始输出 */
  qdlList?: string
  /** qdl chipinfo 的原始输出（Sahara 只读） */
  chipInfo?: string
  /** Sahara 能否读到芯片信息 */
  saharaOk: boolean
  /** 传给 qdl 的最终参数，便于用户核对 */
  command?: string
}

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
  | { kind: 'edlDetect' }
  | { kind: 'edlProbe'; profile: EdlProfile }
  | { kind: 'edlFlash'; profile: EdlProfile }
  | { kind: 'edlReset' }

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
  /** 9008 检测 / 自检的结果 */
  edl?: EdlState
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
  /** 选单个文件；extensions 为空表示不过滤 */
  pickFile(title: string, extensions: string[]): Promise<string | null>
  /** 选多个文件 */
  pickFiles(title: string, extensions: string[]): Promise<string[]>
  /** 选目录，取消返回 null */
  pickDir(title: string): Promise<string | null>
  getCatalog(refresh?: boolean): Promise<CatalogState>
  getSettings(): Promise<Settings>
  setSettings(s: Settings): Promise<Settings>
  checkUpdate(): Promise<UpdateInfo>
  openPath(p: string): Promise<void>
  openExternal(url: string): Promise<void>
}
