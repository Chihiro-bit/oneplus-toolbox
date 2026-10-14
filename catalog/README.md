# Root 方案目录（catalog.json）

工具箱内置了一份方案目录（`src/shared/catalog.ts`）。如果想在不发新版的情况下更新各方案的 APK 版本，可以自己托管一份 `catalog.json`，然后在「设置 → Root 方案目录」里填上它的地址。

**目录里只有数据，没有脚本。** 修补逻辑全部写在客户端里，目录只能决定「下载哪个 APK、它的 sha256 是多少」。

## 托管

任意 https 静态地址都可以，最简单的是把这个目录提交到 GitHub，然后使用 raw 链接：

```
https://raw.githubusercontent.com/<owner>/<repo>/main/catalog/catalog.json
```

## 格式

```jsonc
{
  "schemaVersion": 1,          // 固定为 1
  "updated": "2026-10-14",     // 可选，仅用于显示
  "schemes": [
    {
      "id": "magisk",          // 小写字母、数字、连字符；与内置方案同 id 时会覆盖内置方案
      "name": "Magisk",
      "family": "magisk",      // magisk | apatch | ksu，决定用哪种方式修补
      "version": "30.7",
      "package": "com.topjohnwu.magisk",   // 管理器包名，切换方案时不会卸载它
      "apk": {
        "url": "https://...",  // 必须是 https
        "sha256": "64 位十六进制", // 必填，下载后强制校验，不一致直接丢弃
        "size": 11613864       // 可选，仅用于显示
      },
      "homepage": "https://...", // 可选
      "note": "适用范围说明"       // 可选
    }
  ]
}
```

`family` 怎么选：

| family | 适用 | 修补方式 |
|---|---|---|
| `magisk` | Magisk、Magisk Alpha、Kitsune Mask 及其分支 | APK 自带的 `boot_patch.sh` |
| `apatch` | APatch | `boot_patch.sh <超级密钥> boot.img` |
| `ksu` | KernelSU、KernelSU Next、SukiSU Ultra、ReSukiSU 等 | `ksud boot-patch`（LKM 模式） |

## 更新流程

1. 在项目的 GitHub Releases 页面找到新版 APK
2. 复制下载地址；sha256 可以在 Release 页面上该文件旁边的 `sha256:` 处看到，也可以下载后自己计算：
   ```powershell
   (Get-FileHash .\xxx.apk -Algorithm SHA256).Hash.ToLower()
   ```
3. 修改 `catalog.json` 并提交，用户那边点击 Root 页面右上角的刷新按钮即可生效

另外，`node scripts/export-catalog.mjs` 会把内置目录导出到这里，可以作为起点。

## 容错

- 远程目录读取失败或格式不对时，会使用上次成功读取的本地缓存；如果没有缓存，就使用内置目录
- 内置的离线 Magisk（`magisk-bundled`）始终保留，不会被远程目录覆盖
