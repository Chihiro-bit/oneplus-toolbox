# 待办

按「价值 ÷ 成本」排序。做完一项就勾掉，并在后面注明对应的提交或 PR。

## 开机诊断与软砖救援

目标：卡开机、开不了机但还能进 Fastboot 时，查出可能的原因并给出修复办法，让大多数用户不需要用到 9008（新系统上免授权 9008 已被熔断）。前提是 Fastboot 能用、Bootloader 已解锁。

> 9008 救砖页面已暂时停用（`src/shared/features.ts` 里的 `FEATURES.edl`）：入口隐藏，主进程拒绝执行 `edl*` 操作和重启到 EDL。代码保留，重新评估安全性后再决定是否恢复。

依赖本清单里的这几项：「卸载 Root / 刷回原厂镜像」「模块导致卡开机的救援」「持久化日志」「关键分区备份」「区分 fastbootd」。

### 先在真机上确认（一加 13）

- [x] 在 Fastboot 下运行 `fastboot getvar all`，确认有没有 `slot-successful` / `slot-unbootable` / `slot-retry-count` 这几个字段（2026-10-15，一加 13，安全补丁 2026-08-01）
  - 三个字段都有，格式 `slot-retry-count:b:7`，也可单独 `getvar slot-unbootable:b` 查询
  - `getvar all` 在 bootloader 下不列分区信息；`product` 是 `sun`，`version-bootloader` 为空，`is-userspace:no`，`max-download-size:805306368`（十进制）
- [x] 在 fastbootd 下运行 `fastboot getvar all`（先 `fastboot reboot fastboot` 进入），确认有没有 `snapshot-update-status` 和逻辑分区信息
  - 有 `snapshot-update-status:none`、`super-partition-name:super`，以及完整的 `partition-size` / `is-logical` / `has-slot`；只列了当前槽位（`_a`）的逻辑分区，另有 `system_a-cow` 等 COW 分区（状态却是 none，诊断时不能单凭 COW 存在判定未合并）
  - `getvar all` 里没有 slot-* 字段，但单独查询能拿到 `slot-successful` / `slot-unbootable`；`slot-retry-count` 返回 Unknown variable
  - **和 bootloader 的结果不一致**：同一时刻 fastbootd 报 `slot-successful:a: no`，bootloader 报 `yes` → 槽位状态以 bootloader 为准
  - `product` 是 `ossi`（和 bootloader 的 `sun` 不同），`version-bootloader:unknown`；`is-userspace:yes` 可用来区分 fastbootd
  - 本机 b 槽 `slot-unbootable:yes`（正常 OTA 后另一槽位的常见状态，不能直接当故障）
- [x] 运行 `fastboot oem device-info`，确认有没有输出，以及 critical 那一项是否已解锁
  - 只在 bootloader 下可用，fastbootd 下返回 `EX_UNSUPPORTED_OPERATION`
  - 输出 `Verity mode: true`、`Device unlocked: true`、`Device critical unlocked: false`、`Charger screen enabled: false`（critical 未解锁，刷 abl/xbl 等关键分区会被拒）
- [ ] 进原厂 Recovery，确认电脑能不能识别到 adb、能不能用 adb shell（暂缓；验证前诊断不依赖 Recovery 里的 adb，「第三方 Recovery」那条采集路径也先不做）
- [ ] 确认 `fastboot boot` 能不能临时启动镜像（不写入分区）（暂缓，手上没有同版本 ROM；验证前修复流程只用 `flash`，不设计「先临时启动再写入」的步骤。注意它只能临时启动完整 boot 镜像，修补 init_boot 的方案本来就用不上）

### 采集信息

- [x] **设备状态**（`ops/bootdiag.ts` 的 `bootCollect`，只读）
  - Fastboot：`getvar all` 解析当前槽位、各槽位的 successful / unbootable / retry-count、是否解锁、snapshot 状态；再读 `oem device-info` 的 critical
  - fastbootd：`getvar all` 里没有 slot-*，单独查询 unbootable / retry-count；slot-successful 和 bootloader 不一致，丢弃
  - 卡开机：手机不在线时用 `adb wait-for-device` 抓开机过程中的 adb，读 `getprop`、Root 状态、`logcat -b crash -d -t 80`；开机未完成就连上也算
  - [ ] 第三方 Recovery：通过 adb shell 读 `/data/adb`、pstore 等（等 Recovery 里的 adb 验证过再做）
- [x] **操作记录**（`history.ts`，存在 userData\flash-history.json）：每次刷写前按序列号记下槽位、分区、方案、系统版本、刷入镜像的 sha256，并把被覆盖分区的原厂镜像备份到「文档\一加工具箱\backups\<序列号>\<构建时间>\」。Root、刷回原厂、撤销都会记
- [x] **用户看到的现象**（开机诊断页面的选择题），外加「出问题前最后做了什么」（有未撤销的 Root 记录时预选）

### 诊断规则

纯函数 `src/shared/bootdiag.ts` 的 `diagnose()`，单元测试在 `test/bootdiag.test.ts`（含一加 13 实测的 getvar 输出）。

- [x] **修补后的镜像不兼容**：最后操作是 Root（或有未撤销的 Root 记录）；CrashDump / 当前槽位不可启动时高可信。修法：撤销上一次刷写（有备份时）→ 刷回原厂 boot / init_boot
- [x] **模块导致卡开机**：最后操作是装模块（adb 在开机过程中连上时高可信）；没选操作但已 Root 且开机时 adb 能连上时低可信。修法：禁用 / 删除全部模块、安全模式
- [x] **vbmeta / 镜像校验问题**：image destroyed。修法：从 ROM 刷回原厂 vbmeta / vbmeta_system / vbmeta_vendor（`restoreStock`），关过校验的需要清数据
- [x] **系统更新的数据还没合并完**：snapshotted → `snapshot-update cancel`；merging → `snapshot-update merge`（`ops/bootdiag.ts` 的 `snapshotUpdate`，自动进 fastbootd）
- [x] **两个槽位版本不一致 / 只刷了一半**：最后操作是刷系统或 OTA。另一个槽位 bootloader 报告成功启动过且没被标为不可启动时才建议切换，否则建议完整线刷
- [x] **跨版本刷机后数据分区不兼容**：自动进 Recovery。修法：引导在 Recovery 里清除数据
- [x] **Bootloader 已上锁**：`unlocked: no` 时只给清数据和售后
  - [x] 预防：上锁前检查（`ops/basic.ts`）——开机时 Root 状态不是「未 Root」、或刷写记录里最后一次是没撤销的 Root，就拒绝上锁
- [x] **救不了的情况**：开机诊断页底部直接说明
- [x] 另外：没 Root 相关操作却进了 CrashDump、没有规则命中时，给出切换槽位（另一槽位完好时）/ 售后

### 修复操作

- [x] **撤销上一次刷写**（`ops/rescue.ts` 的 `undoFlash`）：校验备份的 sha256，复制到临时目录后刷回原槽位（`init_boot_a` 这样带槽位名）；之后升级过系统（构建时间变了）就拒绝。入口在「救援与恢复」顶部和开机诊断
- [ ] **Fastboot 完整线刷**（暂不做：要在 bootloader 和 fastbootd 之间切换、刷几十个分区，又要防反回滚，没法在没有备用机的情况下验证，出错就是硬砖。诊断结果里先引导用户用官方工具）
  - 用 payload-dumper 解出全量包里的所有镜像：固件分区在 bootloader 模式下刷，逻辑分区在 fastbootd 下刷，两个槽位都刷
  - 严格校验 ROM 版本不低于当前版本，防止反回滚变硬砖
  - 确认清单比其他操作更严格
- [x] **「开机诊断」页面**（`renderer/src/bootdiag.tsx`）：选现象、读取状态、展示推断结果；修复按钮直接调用撤销刷写、刷回原厂、刷回 vbmeta、切换槽位、禁用 / 删除模块、取消 / 继续合并更新
- [ ] 真机验证：在一加 13 上走一遍 Root → 撤销上一次刷写；fastbootd 下的采集；snapshot-update（需要有待合并的更新时）

## 第一档：投入小，用户最需要

- [x] **卸载 Root / 刷回原厂镜像**（`ops/rescue.ts` 的 `unroot`，界面在「救援与恢复」）
  - 复用 `ops/root.ts` 里「从 ROM 提取镜像 + 版本比对」的逻辑，跳过修补，直接刷入原厂 boot / init_boot
  - 可选：同时卸载 Root 管理器 App（刷完等开机后卸载）
  - Fastboot 下用 `known.ts` 记下的上次开机版本校验；没有记录时需用户勾选才继续
- [x] **模块导致卡开机的救援**（`ops/rescue.ts` 的 `modules`）
  - 手机不在线时 `adb wait-for-device` 等开机过程中的 adb 窗口；禁用 = 用 su 写 `disable` 文件（可恢复），删除 = `magisk --remove-modules`；另有「重新启用全部模块」
  - 检测当前 Root 状态（`magisk -v` / `su -v` / 管理器包名），显示在概览页
  - [ ] 真机验证：卡开机时 Magisk 对 shell 的 su 是否可用、KernelSU / APatch 下 `su -v` 的输出格式
- [ ] ~~**在概览页提示 9008 熔断**~~（9008 已停用，暂缓）
  - 在远程 `catalog.json` 里加一类数据：机型 → 已熔断的系统版本
  - 概览页根据 `DeviceInfo.romVersion` 判断：已熔断就直接提示；没熔断就提醒先「禁用系统更新」
- [x] **持久化日志和导出诊断报告**（`logfile.ts`、`ops/diagnostics.ts`，入口在「设置 → 日志与诊断」）
  - 每次操作的日志写到 `文档\一加工具箱\logs\`，按天分文件，保留 30 天
  - 「导出诊断信息」：设备信息、getprop 白名单（Fastboot 下 `getvar all`）和最近两天的日志写成一个 .txt，序列号打码；问题反馈模板已引导附上
- [x] **安装 APK**（`ops/install.ts`，界面在「系统工具」）
  - 支持拖拽、批量安装
  - 支持 `.apks` / `.xapk` 分包（`adb install-multiple`），ABI 分包只装手机首选架构；XAPK 的 OBB 推到 manifest 指定位置

## 第二档：值得做，工作量中等

- [x] **关键分区备份**（`ops/backup.ts`，界面在「救援与恢复」）
  - 已 Root：`su -c dd` 读出 `persist`、`modemst1/2`、`fsg`、`fsc`、`ocdt`，以及当前槽位的 boot / init_boot / vendor_boot / dtbo，附 SHA256SUMS.txt；机型上没有的分区自动跳过
  - 没 Root：从和手机版本一致的 ROM 里提取 init_boot / boot / vendor_boot / dtbo / vbmeta* 存到备份目录
  - [ ] 真机验证（需要 Root）
- [x] **区分 fastbootd**：`fastboot devices` 之后对每台设备 `getvar is-userspace`，`DeviceMode` 加了 `fastbootd`；重启菜单加了 fastbootd；需要 bootloader 的操作会先 `fastboot reboot bootloader`
- [x] **预装应用精简**（「应用管理 → 预装应用」）
  - `pm list packages -s -u -f` 列出包括已卸载的系统应用，复用应用名和图标加载（改成从 `-f` 直接拿 APK 路径，少一次 `pm path`）
  - `pm uninstall -k --user 0` 卸载、`install-existing` 恢复；开机 / 桌面 / 权限管理等必需组件内置锁定，不允许卸载
  - [ ] 「安全 / 谨慎 / 危险」三级预设清单：需要按 ColorOS / 氧 OS 版本逐个核实，放在远程目录里维护，还没整理
- [x] **投屏、截图和文件传输**（「系统工具」）
  - scrcpy v5.0.1 由 `fetch-tools.mjs` 拉取打包（sha256 已和 GitHub 公布的一致），用 `ADB` 环境变量让它用工具箱自己的 adb；`THIRD_PARTY_NOTICES.md` 已更新
  - 截图：`screencap` 后拉回「文档\一加工具箱\截图」；文件传输：浏览 /sdcard、拖拽发送、点击接收（存到「文档\一加工具箱\传输」），路径限制在 /sdcard 内
- [x] **驱动诊断**（`ops/drivers.ts`，概览页「检查驱动」）：`Get-PnpDevice` 按 VID（2A70 / 22D9 / 18D1 / 05C6）和名称找手机相关设备，按 ConfigManagerErrorCode 给出说明和该装的驱动
- [x] **多设备选择**：连了多台时左下角出现选择框；没选中时所有操作都拒绝；`waitForMode` 只认选中的序列号，等 adb 时用 `-s`

## 第三档：长期方向

- [ ] **系统更新后保留 Root**：修补新版本全量包里的 init_boot，刷到另一个槽位，然后切换槽位（暂不做：要在 OTA 装好、还没重启时操作，虚拟 A/B 有未合并的 snapshot，bootloader 下刷另一个槽位的行为需要真机验证）
- [x] **Shizuku**（`ops/shizuku.ts`，「系统工具」）：没装时从官方 Releases 下载并校验 sha256 后安装；运行原生库目录里的 `libshizuku.so` 启动（找不到时退回 `start.sh`），再用 `pidof shizuku_server` 确认
  - [x] 开机自启（Android 13+）：授予 WRITE_SECURE_SETTINGS、确认开机广播没被关；无线调试配对只能在手机上做，卡片上列出了条件
  - [ ] 真机验证：从未安装开始走一遍安装 + 启动；设置开机自启后重启手机看能否自动启动（一加 13 上只读探测已验证）
- [x] **冻结应用 / adb 授权**（「应用管理 → 冻结与权限」）：`pm disable-user` / `pm enable`，当前桌面和输入法不允许冻结；从 `dumpsys package` 读应用申请了哪些 development 权限（`shared/permissions.ts`），一键 `pm grant` / `revoke`
  - [ ] App Ops 管理（`appops set`）、常用系统设置开关（动画速度、刷新率等）
- [x] **无线调试配对**（「系统工具 → 无线调试」）：`adb pair` / `adb connect` / `adb disconnect`，以及插线时一键 `adb tcpip 5555` 切到无线
- [ ] **国际化**：把界面文字抽出来，加英文界面（暂不做：要改动几乎所有界面和主进程提示文字，等功能稳定后一次做完更划算）
- [ ] **全量包查找**：按机型 + 版本给出对应的 OTA 下载链接，数据放在远程目录里，下载后坚持 sha256 校验（缺数据：需要先整理可信的链接和哈希）

## 工程

- [x] **单元测试**：vitest，`npm test`，已加进 CI。覆盖开机诊断规则和 getvar 解析、`parseEdlDevices`、`parseRootProbe`、方案目录合并与校验、`patch-script`、`newer()`、`pickSplits`、诊断报告打码、驱动解析、手机端路径规范化
- [x] **自动更新**：electron-updater（安装版），设置页「下载并安装 → 重启并安装」；便携版仍跳转发布页。`release.yml` 已上传 `latest.yml` 和 `.blockmap`
  - [ ] 发布下一个版本后实测一次从旧版升级（需要两个已发布的版本）
- [ ] **代码签名**：申请面向开源项目的免费签名（如 SignPath），解决 SmartScreen 拦截（需要项目维护者去申请）
