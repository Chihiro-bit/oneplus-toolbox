import { describe, expect, it } from 'vitest'
import { patchScript, REMOTE_DIR, shq } from '../src/main/ops/patch-script'

describe('shq', () => {
  it('单引号转义', () => expect(shq("a'b")).toBe(String.raw`'a'\''b'`))
})

describe('patchScript', () => {
  it.each(['magisk', 'apatch', 'ksu'] as const)('%s：以 PATCH_OK 结尾，并检查产物', (family) => {
    const s = patchScript(family, 'init_boot.img', 'abc12345')
    expect(s.startsWith(`D=${REMOTE_DIR}\nIMG=$D/init_boot.img\n`)).toBe(true)
    expect(s.trimEnd().endsWith('[ -s $D/out.img ] || exit 5\necho PATCH_OK')).toBe(true)
  })
  it('APatch 的超级密钥被转义后传入', () => {
    expect(patchScript('apatch', 'boot.img', "k'ey1234")).toContain(String.raw`sh ./boot_patch.sh 'k'\''ey1234' "$IMG"`)
  })
  it('Magisk 不带超级密钥', () => {
    expect(patchScript('magisk', 'boot.img', 'secret99')).not.toContain('secret99')
  })
})
