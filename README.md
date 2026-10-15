<div align="center">

<img src="build/icon.png" width="96" alt="">

# 一加工具箱

一加手机的桌面刷机助手：解锁 Bootloader、一键 Root、切换 A/B 槽位、应用双开，全部在图形界面里完成。

[下载最新版本](../../releases/latest) · [常见问题](#常见问题) · [从源码构建](#从源码构建)

<img src="docs/screenshots/overview.png" width="820" alt="概览页面：显示已连接的 OnePlus 13 及其系统版本、槽位等信息">

</div>

> [!WARNING]
> **刷机有风险。** 解锁或上锁 Bootloader 会清除手机上的全部数据；Root 和刷写分区操作不当可能导致无法开机。本工具只在一加手机上开发和测试过（主要测试机型：一加 13），用于其它品牌时会弹出警告。请在完全理解每一步的后果后再操作，使用本工具造成的任何损失由使用者自行承担。

## 功能

| | 功能 | 说明 |
|---|---|---|
| 📱 | **设备概览** | 自动识别开机、Recovery、Fastboot 三种状态，显示型号、系统版本、槽位、Bootloader 锁定状态 |
| 🔁 | **重启与模式** | 一键重启到系统、Recovery、Fastboot、EDL（9008），会根据当前模式自动选用 adb 或 fastboot |
| 🔓 | **Bootloader 解锁 / 上锁** | 先检查当前状态，避免重复操作；勾选确认清单并输入确认码后才会执行 |
| ✨ | **一键 Root** | 支持 Magisk、APatch、KernelSU、KernelSU Next、SukiSU Ultra，以及自定义 APK |
| 🔀 | **A/B 槽位切换** | 刷坏一个槽位时，切到另一个槽位往往能重新开机 |
| 🛟 | **9008 救砖** | 高通 EDL 深刷的向导：检测 9008 端口、读芯片信息、校验并调度 qdl 刷写（编程器、签名摘要、散包需自备） |
| 👥 | **应用双开** | 列出所有第三方应用（带图标、可搜索），一键克隆到系统的分身空间 |
| 🛠️ | **系统工具** | 安装 Play 商店；禁用 / 恢复系统更新 |

<table>
  <tr>
    <td><img src="docs/screenshots/root.png" alt="一键 Root：选择方案"></td>
    <td><img src="docs/screenshots/root-running.png" alt="一键 Root：修补过程中的进度与日志"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/apps.png" alt="应用双开：带图标的应用列表"></td>
    <td><img src="docs/screenshots/bootloader.png" alt="解锁 Bootloader 前的确认对话框"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/root-apatch.png" alt="选择 APatch 时需要设置超级密钥"></td>
    <td><img src="docs/screenshots/overview-dark.png" alt="深色模式"></td>
  </tr>
</table>

<sub>截图使用的是模拟数据。界面会跟随系统自动切换浅色 / 深色模式。</sub>

### 一键 Root 的流程

1. 选择与手机**当前系统版本完全一致**的完整 OTA 包，可以是本地文件，也可以直接粘贴下载链接（只会读取需要的部分，不会下载整个包）
2. 读取 ROM 的构建时间，与手机的 `ro.build.date.utc` 比对，**不一致就直接停止**
3. 提取 `init_boot.img`（Android 13 及以后出厂的机型）或 `boot.img`
4. 从项目官方的 GitHub Releases 下载所选方案的 APK，**强制校验 sha256**
5. 推送到手机，用该方案自带的官方工具修补，修补后的镜像另存一份到「文档\一加工具箱」
6. 安装管理器 App，重启到 Fastboot，确认已解锁后刷入

如果只想要修补好的镜像、自己手动刷，可以勾选「只生成修补后的镜像，不刷入」。

| 方案 | 修补方式 |
|---|---|
| Magisk（在线 / 离线内置） | Magisk 自带的 `boot_patch.sh` |
| APatch | APatch 自带的 `boot_patch.sh`，需要设置超级密钥，只修补 boot |
| KernelSU / KernelSU Next / SukiSU Ultra | `ksud boot-patch`（LKM 模式），失败时自动按设备推算 KMI 重试 |
| 自定义 APK | Kitsune、Magisk Alpha、ReSukiSU 等分支，手动选择上面三种修补方式之一 |

各方案的版本和下载地址可以通过远程目录更新，不需要发布新版本，详见 [catalog/README.md](catalog/README.md)。

### 9008 救砖

手机彻底不开机、连 Fastboot 都进不去时，最后的手段是靠高通 9008（EDL）深刷。工具箱在这里只做四件事：

1. **检测设备**：识别设备管理器里的 `Qualcomm HS-USB QDLoader 9008` 端口
2. **预检**：用 `qdl chipinfo` 通过 Sahara 读出芯片信息，再离线跑一遍 `qdl --dry-run` 校验文件集与签名摘要是否一致
3. **调度刷写**：按 `rawprogram*` → `patch*` 的顺序交给 [qdl](https://github.com/linux-msm/qdl) 刷写，默认跳过 `rawprogram5` / `patch5`
4. **风险提示**：每一步都要勾选确认清单，真正刷写前还要输入确认码

<img src="docs/screenshots/edl.png" width="820" alt="9008 救砖：检测到 QDLoader 9008 端口，并填好自备的编程器、摘要表、散包与 XML">

> [!IMPORTANT]
> **熔断警告：一加 13 / 13T 从 ColorOS 16.0.3.501 起（16.0.8.xxx 同样），OPPO 提高了 `xbl_config` 的反回滚值并更换了 EDL 证书签名，9008 免授权被永久不可逆熔断，降级也无法恢复。**
> 如果你的手机是最近才更新的系统，本功能大概率用不了，请改用 A/B 槽位切换、刷回原厂 boot，或者联系售后。给手机**关掉系统更新**是保住 9008 的唯一办法。

工具箱**不提供、也不下载**下面这些文件，需要你自己准备（用错机型的散包会直接写坏分区）：

| 文件 | 说明 |
|---|---|
| 设备编程器 | `devprg*.mbn`，按处理器型号选（例如 8Gen3 用 8Gen3 的） |
| 签名摘要表 | 安全启动设备需要，对应 qdl 的 `--vip-table-path` |
| 深刷散包 | 解压后的 `rawprogram*.xml` / `patch*.xml` 和一堆镜像 |
| 9008 驱动 | 高通 QDLoader 驱动，需自行安装 |

**这个功能不做的事**：不合并 super 分片，不解密 OFP / OPS，不修 OCDT，不刷 persist。需要这些请用能处理欧加真专有格式的外部工具。

## 安全设计

- **不执行任何远程脚本**：所有修补逻辑都写在程序里；远程方案目录只能指定 APK 的下载地址和 sha256
- **所有下载都校验 sha256**：校验不通过的文件会被直接丢弃
- **不打包任何专有刷机文件**：9008 需要的高通工具、设备编程器、签名摘要和散包一律由用户自备，工具箱只做校验和调度
- **ROM 版本校验**：ROM 与手机系统版本不一致时拒绝继续
- **危险操作需要确认**：解锁、上锁、Root、进入 EDL、9008 刷写前，都要勾选确认清单，部分操作还要输入随机确认码
- **非一加设备警告**：检测到其它品牌时弹出警告，15 秒后才能关闭
- **只动自己的文件**：手机上只读写 `/data/local/tmp/oneplus-toolbox`；电脑上不会结束其它程序启动的 adb

## 使用前准备

1. 在手机「设置 → 关于手机」中连续点击版本号，打开开发者选项
2. 在「开发者选项」中打开 **USB 调试**；如果要解锁，还需要打开 **OEM 解锁**
3. 用支持数据传输的线连接电脑，在手机弹窗中勾选「始终允许」并点击允许
4. 如果一直检测不到设备，请安装 [Google USB 驱动](https://developer.android.com/studio/run/win-usb)

## 下载与安装

在 [Releases](../../releases/latest) 页面下载：

- `OnePlusToolbox-x.y.z-setup.exe`：安装版
- `OnePlusToolbox-x.y.z-portable.exe`：便携版，免安装，双击即用

每个版本都附带 `SHA256SUMS.txt`，可以用来核对下载的文件是否完整。

> [!NOTE]
> 安装包没有代码签名，首次运行时 Windows SmartScreen 可能提示「Windows 已保护你的电脑」，点击「更多信息 → 仍要运行」即可。如果不放心，可以从源码自行构建。

系统要求：Windows 10 / 11（64 位）。

## 常见问题

**检测不到手机？**
换一根支持数据传输的线、换一个 USB 口，并确认已安装 USB 驱动。手机上如果出现 USB 调试授权弹窗，要点「允许」。

**解锁时提示失败？**
确认已在开发者选项中打开「OEM 解锁」。部分机型需要先申请并通过「深度测试」才能解锁。

**Root 时提示 ROM 与手机版本不一致？**
ROM 必须和手机当前的系统版本完全相同，换一个对应版本的完整 OTA 包即可。这一步是为了防止刷入不匹配的镜像导致无法开机，不能跳过。

**KernelSU 修补失败？**
KernelSU 系方案只支持 GKI 2.0 设备（Android 12 及以后出厂、内核 5.10 以上）。修补失败时不会刷入任何东西，可以改用 Magisk 或 APatch。

**双开的应用在重启后不见了？**
这是 ColorOS 桌面的限制，分身应用其实还在，可以改用第三方桌面，或者回到工具箱重新双开。

**刷完无法开机？**
先别慌。进入 Fastboot 后，可以在「A/B 槽位」中切换到另一个槽位；或者把 ROM 中原厂的 boot / init_boot 刷回去。连 Fastboot 都进不去时，才需要用到「9008 救砖」。

**9008 里读不到芯片信息？**
说明 Sahara 还没通。按顺序检查：9008 驱动是否装好、设备管理器里是否出现 `Qualcomm HS-USB QDLoader 9008`、数据线是否支持数据传输、手机是否真的进了 EDL。如果都正常还是读不到，这台机器很可能已经被系统更新熔断了免授权 EDL，只能送售后。

**我应该更新系统吗？**
如果在意 9008 救砖，**不要更新**。一加 13 / 13T 的 16.0.3.501 和 16.0.8.xxx 会永久熔断免授权 EDL，且降级无效。可以先用「系统工具 → 禁用系统更新」把更新关掉。

## 从源码构建

需要 Windows 和 Node.js 22 或更高版本。

```powershell
npm install
npm run fetch-tools   # 从官方地址下载 adb / fastboot 等工具到 resources\bin，并校验 sha256
npm run dev           # 开发模式，界面支持热更新
```

其它命令：

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | 类型检查 |
| `npm run dist` | 打包安装版和便携版到 `release\` |
| `npm run screenshots` | 用模拟数据重新生成 `docs/screenshots` 下的截图（需要先 `npm run build`，并安装 Edge 或 Chrome） |

### 发布新版本

推送一个 `v` 开头的标签即可，GitHub Actions 会自动打包并创建 Release 草稿：

```bash
git tag v1.0.0
git push origin v1.0.0
```

版本号取自标签，不需要手动修改 `package.json`。草稿创建好后，在 GitHub 上检查附件和更新说明，再点击「Publish release」公开。

### 项目结构

```
src/main/                 Electron 主进程
  device.ts               设备识别（adb / fastboot / 9008 三路）、getprop / getvar、等待模式切换
  ops/basic.ts            重启、解锁 / 上锁、切换槽位
  ops/root.ts             一键 Root 主流程（提取镜像、修补、刷入）
  ops/edl.ts              9008 救砖（检测、预检、校验文件集、调度 qdl）
  ops/patch-script.ts     在手机上执行的修补脚本（三种修补方式）
  ops/apps.ts             应用双开、Play 商店、系统更新开关
  download.ts             带 sha256 校验的下载与缓存
  catalog.ts              远程方案目录（失败时使用缓存或内置目录）
src/renderer/src/         React 界面
  edl.tsx                 9008 救砖页面
src/shared/               主进程与界面共用的类型、内置方案目录
scripts/fetch-tools.mjs   下载并校验第三方工具（含 qdl）
scripts/screenshots/      截图脚本与模拟数据
catalog/                  远程方案目录示例与格式说明
```

## 许可证

本项目以 [Apache License 2.0](LICENSE) 发布。随附和运行时下载的第三方组件（adb、Magisk、KernelSU 等）遵循各自的许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目与 OnePlus、Google 以及各 Root 方案的作者均无关联。
