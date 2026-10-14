import type { RootFamily } from '@shared/types'

/** 手机上本工具专用的临时目录（与 common.ts 保持一致；此文件不依赖 electron，便于单独测试） */
export const REMOTE_DIR = '/data/local/tmp/oneplus-toolbox'

/** 单引号转义，用于拼接手机端 shell 脚本 */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// ───────────── 手机端修补脚本（三种修补方式） ─────────────

/**
 * 生成在手机上执行的修补脚本。三种方式都只使用 APK 自带的官方工具：
 * - magisk：解出 lib*.so 改名后运行 Magisk 的 boot_patch.sh（兼容 26.x 与 30.x 的库布局）
 * - apatch：运行 APatch 的 boot_patch.sh <superkey> <boot>
 * - ksu：运行 ksud boot-patch，失败后按 first_api_level + 内核版本推出 KMI 重试
 * 成功时把结果放到 $D/out.img 并输出 PATCH_OK。
 */
export function patchScript(family: RootFamily, img: string, superkey?: string): string {
  const head = [
    `D=${REMOTE_DIR}`,
    `IMG=$D/${img}`,
    'cd $D || exit 1',
    'rm -rf root ksu-out out.img && mkdir root',
    'unzip -o root.apk -d root >/dev/null 2>&1 || { echo "解压 APK 失败"; exit 2; }'
  ]
  const unpackLibs = [
    'for f in ../lib/arm64-v8a/lib*.so; do n=${f##*/lib}; cp "$f" "./${n%.so}"; done',
    'chmod 755 *'
  ]
  let body: string[]
  if (family === 'magisk') {
    body = [
      'cd root/assets || exit 2',
      ...unpackLibs,
      '[ -f ../lib/armeabi-v7a/libmagisk32.so ] && cp ../lib/armeabi-v7a/libmagisk32.so ./magisk32 && chmod 755 magisk32',
      // 与 Magisk App 的判断一致：system-as-root 时保留 verity，数据加密时保留强制加密
      'SAR=false; grep -q " /system_root " /proc/mounts && SAR=true; grep " / " /proc/mounts | grep -qv rootfs && SAR=true',
      'ENC=false; [ "$(getprop ro.crypto.state)" = "encrypted" ] && ENC=true',
      'VB=false; ls /dev/block/by-name/vbmeta* >/dev/null 2>&1 || VB=true',
      'export KEEPVERITY=$SAR KEEPFORCEENCRYPT=$ENC PATCHVBMETAFLAG=$VB RECOVERYMODE=false',
      'echo "KEEPVERITY=$SAR KEEPFORCEENCRYPT=$ENC PATCHVBMETAFLAG=$VB"',
      'sh ./boot_patch.sh "$IMG" || exit 3',
      'mv new-boot.img $D/out.img || exit 4'
    ]
  } else if (family === 'apatch') {
    body = [
      'cd root/assets || exit 2',
      ...unpackLibs,
      `sh ./boot_patch.sh ${shq(superkey ?? '')} "$IMG" || exit 3`,
      // boot_patch.sh 在镜像无效或内核未开启 CONFIG_KALLSYMS 时也会以 0 退出，所以要看有没有产物
      '[ -s new-boot.img ] || { echo "APatch 未生成修补后的镜像，原因见上方输出"; exit 4; }',
      'mv new-boot.img $D/out.img || exit 4'
    ]
  } else {
    body = [
      'cd root || exit 2',
      'cp lib/arm64-v8a/libksud.so ./ksud && chmod 755 ksud || { echo "APK 中没有 ksud"; exit 2; }',
      'mkdir -p $D/ksu-out',
      './ksud boot-patch -b "$IMG" -o $D/ksu-out',
      'if ! ls $D/ksu-out/*.img >/dev/null 2>&1; then',
      '  case "$(getprop ro.product.first_api_level)" in 32) AV=android12;; 33) AV=android13;; 34) AV=android14;; 35|202404) AV=android15;; 36) AV=android16;; esac',
      '  KV=$(uname -r | cut -d. -f1,2)',
      '  [ -n "$AV" ] && { echo "使用 KMI $AV-$KV 重试"; ./ksud boot-patch -b "$IMG" -o $D/ksu-out --kmi "$AV-$KV"; }',
      'fi',
      'P=$(ls $D/ksu-out/*.img 2>/dev/null | head -n 1)',
      '[ -n "$P" ] || { echo "修补失败：设备可能不是 GKI 2.0，或 KMI 不受支持"; exit 3; }',
      'mv "$P" $D/out.img || exit 4'
    ]
  }
  return [...head, ...body, '[ -s $D/out.img ] || exit 5', 'echo PATCH_OK'].join('\n') + '\n'
}
