import { useState } from 'react'
import { BellOff, BellRing, FileUp, ShoppingBag } from 'lucide-react'
import { PageHeader, useGate, type PageProps } from './pages'
import { Card } from './ui'

export function ToolsPage({ tb, confirm }: PageProps) {
  const [playApk, setPlayApk] = useState('')
  const gate = useGate(tb, ['system'])

  return (
    <>
      <PageHeader title="系统工具" desc="免 Root 的常用调整，需要手机开机并开启 USB 调试" />
      <div className="action-grid two">
        <Card className="action-card">
          <div className="action-icon accent">
            <ShoppingBag size={20} />
          </div>
          <h3>安装 Play 商店</h3>
          <p className="muted">
            先卸载系统内置 Play 商店的更新，再安装你提供的 APK，最后通过应用商店的详情页触发 Play 商店自身更新。
          </p>
          <div className="rom-input">
            <FileUp size={16} />
            <input value={playApk} readOnly placeholder="选择 Play 商店 APK（com.android.vending）" />
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const p = await window.toolbox.pickApk('选择 Play 商店 APK')
                if (p) setPlayApk(p)
              }}
            >
              浏览…
            </button>
          </div>
          <button
            className="btn btn-primary"
            disabled={gate.disabled || !playApk}
            title={gate.reason ?? (!playApk ? '请先选择 APK' : undefined)}
            onClick={() => tb.start('安装 Play 商店', { kind: 'installPlay', apk: playApk })}
          >
            安装
          </button>
        </Card>

        <Card className="action-card">
          <div className="action-icon danger">
            <BellOff size={20} />
          </div>
          <h3>禁用 / 恢复系统更新</h3>
          <p className="muted">
            停用并卸载（仅对当前用户）系统更新组件，关闭更新提示。适用于 ColorOS、氧 OS、氢 OS。之后需要升级时，在这里恢复即可。
          </p>
          <div className="btn-row">
            <button
              className="btn btn-danger"
              disabled={gate.disabled}
              title={gate.reason}
              onClick={() =>
                confirm({
                  title: '禁用系统更新',
                  intro: '禁用后手机不会再收到系统更新推送，只能回到这里恢复。',
                  checks: ['我知道禁用后需要用本工具恢复，才能再次接收系统更新'],
                  confirmText: '禁用',
                  onConfirm: () => tb.start('禁用系统更新', { kind: 'otaUpdates', disable: true })
                })
              }
            >
              <BellOff size={15} /> 禁用系统更新
            </button>
            <button
              className="btn btn-secondary"
              disabled={gate.disabled}
              title={gate.reason}
              onClick={() => tb.start('恢复系统更新', { kind: 'otaUpdates', disable: false })}
            >
              <BellRing size={15} /> 恢复系统更新
            </button>
          </div>
        </Card>
      </div>
      {gate.reason && !tb.run.running && <p className="gate-hint">{gate.reason}</p>}
    </>
  )
}
