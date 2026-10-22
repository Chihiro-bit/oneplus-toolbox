// 主进程与渲染进程共用的类型

import type { NetworkRequest, NetworkState } from './network'

/**
 * none=未连接，system=开机(adb)，recovery=Recovery(adb)，fastboot=Bootloader 里的 Fastboot，
 * fastbootd=用户空间 Fastboot（刷逻辑分区、取消未合并的更新时用），unauthorized=adb 未授权，edl=高通 9008 深刷
 */
export type DeviceMode = 'none' | 'system' | 'recovery' | 'fastboot' | 'fastbootd' | 'unauthorized' | 'edl'

export interface DeviceInfo {
  mode: DeviceMode
  serial?: string
  /** 同时连接了多台设备 */
  multiple?: boolean
  /** 连着多台时的全部设备，供界面选择 */
  devices?: { serial: string; mode: DeviceMode; label?: string }[]
  /** 连着多台时选中的序列号（可能不在线，例如正卡在开机） */
  selected?: string
  /** 连着多台、但当前显示的这台不是选中的：操作会被拒绝 */
  needsPick?: boolean
  model?: string
  brand?: string
  manufacturer?: string
  device?: string
  androidVersion?: string
  buildId?: string
  romVersion?: string
  slot?: string
  /** 仅 fastboot / fastbootd 下可读 */
  unlocked?: boolean
  /** 仅 edl 下可读：QDLoader 9008 占用的 COM 端口，如 COM5 */
  edlPort?: string
  /** 仅开机下可读：Root 状态，如「Magisk 30.7」「未 Root」 */
  root?: string
}

export type RebootTarget = 'system' | 'recovery' | 'bootloader' | 'fastbootd' | 'edl'

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

export interface UnrootOptions {
  /** 与手机系统版本一致的全量包：本地路径或 http(s) URL */
  rom: string
  /** 刷完开机后卸载 Root 管理器 App */
  uninstallManagers: boolean
  /** Fastboot 下读不到手机的系统版本时，仍然继续（只给警告） */
  allowUnverified: boolean
}

/** 可以从 ROM 刷回的原厂分区 */
export type StockPartition = 'init_boot' | 'boot' | 'vendor_boot' | 'dtbo' | 'vbmeta' | 'vbmeta_system' | 'vbmeta_vendor'

export interface RestoreOptions {
  rom: string
  partitions: StockPartition[]
  allowUnverified: boolean
}

/** device=已 Root 时用 dd 从手机读出分区，rom=从 ROM 提取原厂镜像 */
export interface BackupOptions {
  source: 'device' | 'rom'
  rom?: string
}

/** 设备管理器里和手机有关的一项 */
export interface DriverEntry {
  name: string
  instanceId: string
  ok: boolean
  className?: string
  /** 异常说明，如「没有安装驱动（代码 28）」 */
  problem?: string
  /** 该装哪个驱动 */
  hint?: string
}

/** 手机内置存储里的一项 */
export interface RemoteEntry {
  name: string
  dir: boolean
  size: number
  /** 修改时间（毫秒） */
  mtime: number
}

/** 独立屏幕（虚拟显示器）的分辨率：auto=跟随手机屏幕 */
export type DisplaySize = 'auto' | '1920x1080' | '1280x720'

export const DISPLAY_SIZES: Record<DisplaySize, { label: string; arg?: string }> = {
  auto: { label: '跟随手机屏幕' },
  '1920x1080': { label: '1080p 横屏', arg: '1920x1080/240' },
  '1280x720': { label: '720p 横屏（更流畅）', arg: '1280x720/160' }
}

export interface MirrorOptions {
  turnScreenOff: boolean
  stayAwake: boolean
  /** 投屏窗口始终显示在其它窗口上面 */
  alwaysOnTop: boolean
  /**
   * 投到手机上新建的虚拟屏幕，而不是镜像手机屏幕：电脑上和手机上各用各的应用。
   * app 为空时显示系统的副屏桌面
   */
  display?: {
    app?: string
    size: DisplaySize
    /** 关掉窗口后把应用移回手机屏幕（会跳到手机前台）；否则关掉 */
    keepApp: boolean
    /** 声音留在手机上；否则转到电脑 */
    audioOnPhone: boolean
  }
}

export type WirelessRequest =
  | { action: 'pair'; host: string; port: string; code: string }
  | { action: 'connect'; host: string; port: string }
  | { action: 'disconnect' }
  | { action: 'fromUsb' }

// ───────────── 刷写记录 ─────────────

/** root=刷入修补镜像，unroot=刷回原厂 boot / init_boot，restore=从 ROM 刷回指定的原厂分区，undo=撤销上一次刷写 */
export type FlashKind = 'root' | 'unroot' | 'restore' | 'undo'

export interface FlashRecord {
  id: string
  time: number
  serial: string
  kind: FlashKind
  /** Root 方案名 */
  scheme?: string
  /** 刷写的槽位（a / b） */
  slot?: string
  /** 刷写时手机的系统版本；ro.build.date.utc 用来判断手机后来有没有升级过 */
  build: { buildId?: string; romVersion?: string; buildDateUtc?: string }
  partitions: { name: string; source: 'patched' | 'stock'; sha256: string }[]
  /** 被覆盖分区的原厂镜像备份，撤销时刷回 */
  backups: Record<string, { path: string; sha256: string }>
  status: 'started' | 'ok' | 'failed'
  /** 已经被撤销 */
  undone?: boolean
}

// ───────────── 开机诊断 ─────────────

export interface SlotState {
  successful?: boolean
  unbootable?: boolean
  retryCount?: number
}

/** 开机诊断采集到的设备状态。读不到的字段留空，规则按「未知」处理 */
export interface BootState {
  /** 采集时手机所处的模式 */
  mode: DeviceMode
  serial?: string
  currentSlot?: 'a' | 'b'
  slots: Partial<Record<'a' | 'b', SlotState>>
  unlocked?: boolean
  /** oem device-info 的 Device critical unlocked（只有 bootloader 下能读） */
  criticalUnlocked?: boolean
  /** snapshot-update-status：none / snapshotted / merging 等 */
  snapshotStatus?: string
  /** 卡开机时，开机过程中 adb 连上过 */
  adbDuringBoot?: boolean
  /** sys.boot_completed = 1 */
  bootCompleted?: boolean
  /** logcat -b crash 的最后几十行 */
  crashLog?: string
  root?: string
  /** 采集过程中的说明，例如哪些字段读不到 */
  notes: string[]
}

/** 用户看到的现象 */
export type BootSymptom = 'logo' | 'bootloop' | 'crashdump' | 'destroyed' | 'recovery'

/** 出问题前最后做的操作（用户选择；有刷写记录时预先选好） */
export type LastAction = 'root' | 'module' | 'ota' | 'flash' | 'unknown'

/** disable=给每个模块写 disable 文件（可恢复），enable=删掉 disable 文件，remove=magisk --remove-modules（删除） */
export type ModuleAction = 'disable' | 'enable' | 'remove'

export interface AppEntry {
  package: string
  label: string
  /** 已在双开空间（用户 999）中 */
  cloned: boolean
  /** 以下仅系统应用列表有：预装应用 */
  system?: boolean
  /** 已对当前用户卸载（pm uninstall --user 0） */
  removed?: boolean
  /** 已停用 */
  disabled?: boolean
  /** 系统必需组件，不允许卸载 */
  protected?: boolean
}

/** status=只读状态，start=启动（没装时先下载安装），autostart=为免 Root 开机自启做好电脑这边能做的准备 */
export type ShizukuAction = 'status' | 'start' | 'autostart'

export interface ShizukuState {
  installed: boolean
  version?: string
  /** shizuku_server 进程在运行 */
  running: boolean
  /** ro.build.version.sdk；免 Root 开机自启需要 33（Android 13）及以上 */
  sdk?: number
  /** Shizuku 已获得 WRITE_SECURE_SETTINGS（开机自启时用它打开无线调试） */
  secureSettings?: boolean
  /** Shizuku 的开机广播接收器没有被关掉 */
  bootReceiver?: boolean
}

/** 应用申请了、可以用 adb 授予的权限 */
export interface AppPermission {
  name: string
  label: string
  desc: string
  granted: boolean
}

/** 应用备份目录里的 backup.json */
export interface AppBackupManifest {
  package: string
  label: string
  versionName?: string
  versionCode?: string
  /** 安装包文件名：单个 APK 是 app.apk，有分包时打成 app.apks */
  apk: string
  /** 应用数据的压缩包（需要 Root）：data.tgz 是 /data/data，data_de.tgz 是 /data/user_de/0 */
  data: string[]
  time: number
  model?: string
}

export type OperationRequest =
  | { kind: 'reboot'; target: RebootTarget }
  | { kind: 'unlock' }
  | { kind: 'relock' }
  | { kind: 'switchSlot' }
  | { kind: 'root'; options: RootOptions }
  | { kind: 'unroot'; options: UnrootOptions }
  | { kind: 'restoreStock'; options: RestoreOptions }
  | { kind: 'undoFlash' }
  | { kind: 'backup'; options: BackupOptions }
  | { kind: 'driverCheck' }
  | { kind: 'screenshot' }
  | { kind: 'wireless'; request: WirelessRequest }
  | { kind: 'listRemote'; path: string }
  | { kind: 'pushFiles'; files: string[]; to: string }
  | { kind: 'pullFile'; path: string }
  | { kind: 'bootCollect'; waitAdb: boolean }
  | { kind: 'snapshotUpdate'; action: 'cancel' | 'merge' }
  | { kind: 'modules'; action: ModuleAction }
  | { kind: 'installApps'; files: string[] }
  | { kind: 'exportDiagnostics' }
  | { kind: 'listApps' }
  | { kind: 'cloneApp'; package: string; enable: boolean }
  | { kind: 'listSystemApps' }
  | { kind: 'debloat'; package: string; remove: boolean; root?: boolean }
  | { kind: 'installPlay'; apk: string }
  | { kind: 'otaUpdates'; disable: boolean }
  | { kind: 'shizuku'; action: ShizukuAction }
  | { kind: 'listUserApps' }
  | { kind: 'freezeApp'; package: string; freeze: boolean }
  | { kind: 'appPermissions'; package: string }
  | { kind: 'grantPermission'; package: string; permission: string; grant: boolean }
  | { kind: 'network'; request: NetworkRequest }
  | { kind: 'backupApp'; package: string; label: string; withData: boolean }
  | { kind: 'restoreApp'; dir: string }
  | { kind: 'installModules'; files: string[] }
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
  /** listRemote 的结果 */
  remote?: { path: string; entries: RemoteEntry[] }
  /** driverCheck 的结果 */
  drivers?: DriverEntry[]
  /** bootCollect 的结果 */
  bootState?: BootState
  /** shizuku 的结果 */
  shizuku?: ShizukuState
  /** appPermissions / grantPermission 的结果 */
  permissions?: AppPermission[]
  /** network 的结果 */
  network?: NetworkState
}

export interface Settings {
  /** 点击关闭按钮时的行为，旧配置默认询问 */
  closeBehavior?: 'ask' | 'tray' | 'quit'
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
  /** 安装版可以自动下载替换；便携版只能去发布页下载 */
  canAuto: boolean
  error?: string
}

/** 关闭窗口时选择：收起到系统托盘 / 直接退出 / 取消 */
export type CloseAction = 'tray' | 'quit' | 'cancel'

export interface ToolboxApi {
  getDevice(): Promise<DeviceInfo>
  /** 主进程请求关闭窗口时触发，界面应弹出自己的确认框 */
  onCloseRequest(cb: () => void): () => void
  /** 回应关闭请求 */
  resolveClose(action: CloseAction, remember?: boolean): Promise<void>
  /** 连着多台设备时，选择要操作的那一台 */
  selectDevice(serial: string): Promise<void>
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
  /** 下载新版本（只用于安装版） */
  downloadUpdate(): Promise<{ ok: boolean; message: string }>
  onUpdateProgress(cb: (percent: number) => void): () => void
  /** 退出并安装已下载的新版本 */
  installUpdate(): Promise<void>
  openPath(p: string): Promise<void>
  openExternal(url: string): Promise<void>
  /** 打开 scrcpy 投屏窗口（不占用操作队列） */
  startMirror(opts: MirrorOptions): Promise<OperationResult>
  /** 这台设备的刷写记录（旧的在前） */
  getHistory(serial: string): Promise<FlashRecord[]>
  /** 打开日志文件夹 */
  openLogDir(): Promise<void>
  /** 拖拽进来的文件在磁盘上的路径 */
  pathForFile(file: File): string
}
