// 截图用的模拟 window.toolbox：全部是虚构数据，不连接任何设备。
// 由 scripts/screenshots/index.mjs 注入到构建好的界面中，通过 URL 参数选择场景。
;(() => {
  const q = new URLSearchParams(location.search)
  const now = Date.now()

  const DEVICES = {
    none: { mode: 'none' },
    system: {
      mode: 'system',
      serial: '1a2b3c4d',
      model: 'OnePlus 13',
      brand: 'OnePlus',
      manufacturer: 'OnePlus',
      device: 'OP5D0DL1',
      androidVersion: '16',
      buildId: 'PJZ110_16.0.0.300(CN01)',
      romVersion: 'V16.0.0',
      slot: 'a'
    },
    fastboot: { mode: 'fastboot', serial: '1a2b3c4d', model: 'OnePlus 13', brand: 'OnePlus', device: 'sun', slot: 'b', unlocked: true }
  }

  const APPS = [
    ['com.example.chat', '聊天', true],
    ['com.example.notes', '便签', false],
    ['com.example.music', '音乐', true],
    ['com.example.camera', '相机 Pro', false],
    ['com.example.maps', '地图导航', false],
    ['com.example.reader', '阅读', false],
    ['com.example.shop', '购物', false],
    ['com.example.video', '视频', false],
    ['com.example.bank', '银行', false]
  ].map(([pkg, label, cloned]) => ({ package: pkg, label, cloned }))

  const COLORS = ['#e5173f', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#0891b2', '#db2777', '#ea580c', '#4f46e5']
  const icon = (i, label) =>
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="22" fill="${COLORS[i % COLORS.length]}"/>` +
        `<text x="48" y="62" font-size="44" text-anchor="middle" fill="#fff" font-family="Microsoft YaHei UI, sans-serif">${[...label][0]}</text></svg>`
    )

  const LOGS = [
    ['step', '── 开始：Root（magisk） ──'],
    ['ok', 'Magisk 30.7 下载完成，sha256 校验通过'],
    ['step', '正在读取 ROM 信息'],
    ['cmd', 'payload_dumper D:\\ROM\\PJZ110_16.0.0.300.zip --metadata -o C:\\Temp\\oneplus-toolbox\\work\\metadata'],
    ['info', 'ROM 构建时间 = 1785725462，手机 ro.build.date.utc = 1785725462'],
    ['ok', 'ROM 与手机系统版本一致'],
    ['cmd', 'payload_dumper D:\\ROM\\PJZ110_16.0.0.300.zip -i boot,init_boot -o C:\\Temp\\oneplus-toolbox\\work -q'],
    ['info', '提取结果：boot.img ✓  init_boot.img ✓'],
    ['ok', '将修补 init_boot.img'],
    ['step', '正在手机上修补 init_boot.img'],
    ['info', 'KEEPVERITY=true KEEPFORCEENCRYPT=true PATCHVBMETAFLAG=false'],
    ['info', '- Unpacking boot image'],
    ['info', '- Patching ramdisk'],
    ['info', '- Repacking boot image']
  ]

  const listeners = { log: [], step: [], icons: [] }
  const scene = q.get('scene') || ''

  window.toolbox = {
    getDevice: async () => DEVICES[q.get('dev') || 'system'],
    onDevice: () => () => {},
    onLog: (cb) => {
      listeners.log.push(cb)
      if (q.get('logs')) setTimeout(() => LOGS.forEach(([level, text], i) => cb({ time: now - (LOGS.length - i) * 2000, level, text })), 10)
      return () => {}
    },
    onStep: (cb) => (listeners.step.push(cb), () => {}),
    onAppIcons: (cb) => (listeners.icons.push(cb), () => {}),
    run: (req) =>
      new Promise((resolve) => {
        if (req.kind === 'listApps') {
          setTimeout(() => {
            resolve({ ok: true, message: `共 ${APPS.length} 个应用，其中 2 个已双开`, apps: APPS })
            setTimeout(() => listeners.icons.forEach((cb) => cb(Object.fromEntries(APPS.map((a, i) => [a.package, icon(i, a.label)])))), 20)
          }, 30)
          return
        }
        // 其它操作停在「进行中」，用于展示进度横幅
        setTimeout(() => listeners.step.forEach((cb) => cb('正在手机上修补 init_boot.img')), 20)
      }),
    cancel: async () => {},
    pickRom: async () => 'D:\\ROM\\PJZ110_16.0.0.300.zip',
    pickApk: async () => null,
    getCatalog: async () => (await import('/catalog.js')).default,
    getSettings: async () => ({ catalogUrl: '', updateRepo: 'example/oneplus-toolbox' }),
    setSettings: async (s) => s,
    checkUpdate: async () => ({ current: '1.0.0', hasUpdate: false }),
    openPath: async () => {},
    openExternal: async () => {}
  }

  // ───── 场景脚本：在界面渲染后模拟点击 ─────
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const click = (sel, text) => [...document.querySelectorAll(sel)].find((el) => el.textContent.includes(text))?.click()
  const setInput = (sel, value) => {
    const el = document.querySelector(sel)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  window.addEventListener('load', async () => {
    await wait(300)
    if (q.get('page')) click('.nav-item', q.get('page'))
    await wait(150)
    if (scene === 'root') {
      setInput('.rom-input input:not([readonly])', 'D:\\ROM\\PJZ110_16.0.0.300.zip')
    }
    if (scene === 'root-running') {
      setInput('.rom-input input:not([readonly])', 'D:\\ROM\\PJZ110_16.0.0.300.zip')
      await wait(50)
      click('label', '只生成修补后的镜像')
      await wait(50)
      click('button', '开始修补')
      await wait(100)
      document.querySelector('.logbar')?.click()
      await wait(50)
      document.querySelector('.content').scrollTop = 0
    }
    if (scene === 'apatch') {
      click('.scheme', 'APatch')
      await wait(100)
      setInput('#superkey', 'abc12345')
      document.querySelector('.content').scrollTop = 330
    }
    if (scene === 'apps') click('button', '读取应用列表')
    if (scene === 'unlock') click('button', '开始解锁')
  })
})()
