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
      slot: 'a',
      root: 'Magisk 30.7'
    },
    fastboot: { mode: 'fastboot', serial: '1a2b3c4d', model: 'OnePlus 13', brand: 'OnePlus', device: 'sun', slot: 'b', unlocked: true },
    edl: {
      mode: 'edl',
      serial: 'COM5',
      edlPort: 'COM5',
      device: 'Qualcomm HS-USB QDLoader 9008 (COM5)'
    }
  }

  const EDL_PORTS = [{ port: 'COM5', name: 'Qualcomm HS-USB QDLoader 9008 (COM5)' }]
  const EDL_CHIP = [
    'Sahara version   : 3',
    'MSM HWID         : 0x600001 | model_id:0x0000 | oem_id:0x0051 OPPO',
    'HW_ID            : 0060000100510000'
  ].join('\n')
  const EDL_FILES = {
    programmer: 'D:\\EDL\\8Gen3\\devprg_firehose_ddr.mbn',
    vipDir: 'D:\\EDL\\8Gen3\\vip',
    imagesDir: 'D:\\EDL\\PJZ110_images',
    xmls: ['D:\\EDL\\PJZ110_images\\rawprogram0.xml', 'D:\\EDL\\PJZ110_images\\patch0.xml']
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

  const SYSTEM_APPS = [
    ['com.example.browser', '浏览器', true, false],
    ['com.example.market', '应用商店', false, false],
    ['com.example.game', '游戏中心', false, false],
    ['com.example.weather', '天气', false, false],
    ['com.android.systemui', '系统界面', false, true],
    ['com.example.assistant', '智能助手', false, false]
  ].map(([pkg, label, removed, prot]) => ({ package: pkg, label, cloned: false, system: true, removed, protected: prot }))

  const REMOTE = [
    { name: 'DCIM', dir: true, size: 3452, mtime: now },
    { name: 'Download', dir: true, size: 3452, mtime: now },
    { name: 'Music', dir: true, size: 3452, mtime: now },
    { name: 'Pictures', dir: true, size: 3452, mtime: now },
    { name: '会议记录.pdf', dir: false, size: 1_843_200, mtime: now },
    { name: 'notes.txt', dir: false, size: 2_310, mtime: now }
  ]

  // 开机诊断：Root 后卡开机，一加 13 实测的槽位格式
  const BOOT_STATE = {
    mode: 'fastboot',
    serial: '1a2b3c4d',
    currentSlot: 'a',
    slots: { a: { successful: false, unbootable: true, retryCount: 0 }, b: { successful: true, unbootable: false, retryCount: 7 } },
    unlocked: true,
    criticalUnlocked: false,
    snapshotStatus: 'none',
    notes: []
  }
  const HISTORY = [
    {
      id: 'h1',
      time: now - 40 * 60_000,
      serial: '1a2b3c4d',
      kind: 'root',
      scheme: 'Magisk',
      slot: 'a',
      build: { buildId: 'PJZ110_16.0.0.300(CN01)', buildDateUtc: '1785725462' },
      partitions: [{ name: 'init_boot', source: 'patched', sha256: 'x' }],
      backups: { init_boot: { path: 'C:\\Users\\me\\Documents\\一加工具箱\\backups\\init_boot.img', sha256: 'y' } },
      status: 'ok'
    }
  ]

  const listeners = { log: [], step: [], icons: [] }
  const scene = q.get('scene') || ''
  let dirPicks = 0

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
        if (req.kind === 'listSystemApps') {
          setTimeout(() => {
            resolve({ ok: true, message: `共 ${SYSTEM_APPS.length} 个系统应用，其中 1 个已卸载`, apps: SYSTEM_APPS })
            setTimeout(() => listeners.icons.forEach((cb) => cb(Object.fromEntries(SYSTEM_APPS.map((a, i) => [a.package, icon(i + 3, a.label)])))), 20)
          }, 30)
          return
        }
        if (req.kind === 'bootCollect') return setTimeout(() => resolve({ ok: true, message: '已读取 Fastboot 下的设备状态', bootState: BOOT_STATE }), 30)
        if (req.kind === 'listRemote') return setTimeout(() => resolve({ ok: true, message: '/sdcard：6 项', remote: { path: '/sdcard', entries: REMOTE } }), 30)
        if (req.kind === 'edlDetect') {
          setTimeout(
            () => resolve({ ok: true, message: '已找到 1 台 9008 设备', edl: { ports: EDL_PORTS, qdlList: 'COM5', saharaOk: false } }),
            30
          )
          return
        }
        if (req.kind === 'edlProbe') {
          setTimeout(
            () =>
              resolve({
                ok: true,
                message: '预检通过：Sahara 正常，文件集与摘要表一致，可以开始刷写',
                edl: { ports: EDL_PORTS, chipInfo: EDL_CHIP, saharaOk: true, command: `qdl --storage=ufs --vip-table-path=${EDL_FILES.vipDir} --include=${EDL_FILES.imagesDir} ${EDL_FILES.programmer} rawprogram0.xml patch0.xml` }
              }),
            30
          )
          return
        }
        // 其它操作停在「进行中」，用于展示进度横幅
        setTimeout(() => listeners.step.forEach((cb) => cb('正在手机上修补 init_boot.img')), 20)
      }),
    cancel: async () => {},
    pickRom: async () => 'D:\\ROM\\PJZ110_16.0.0.300.zip',
    pickApk: async () => null,
    pickFile: async () => EDL_FILES.programmer,
    pickFiles: async () => EDL_FILES.xmls,
    pickDir: async () => (dirPicks++ === 0 ? EDL_FILES.vipDir : EDL_FILES.imagesDir),
    getCatalog: async () => (await import('/catalog.js')).default,
    getSettings: async () => ({ catalogUrl: '', updateRepo: 'example/oneplus-toolbox' }),
    setSettings: async (s) => s,
    checkUpdate: async () => ({ current: '1.0.0', hasUpdate: false, canAuto: true }),
    openPath: async () => {},
    openExternal: async () => {},
    openLogDir: async () => {},
    selectDevice: async () => {},
    getHistory: async () => HISTORY,
    startMirror: async () => ({ ok: true, message: '投屏窗口正在打开' }),
    downloadUpdate: async () => ({ ok: false, message: '' }),
    onUpdateProgress: () => () => {},
    installUpdate: async () => {},
    pathForFile: () => ''
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
    if (scene === 'diagnose') {
      click('label', 'CrashDump')
      await wait(50)
      click('button', '读取状态并诊断')
      await wait(150)
      document.querySelector('.findings')?.closest('.card')?.scrollIntoView({ block: 'start' })
    }
    if (scene === 'unlock') click('button', '开始解锁')
    if (scene === 'edl') {
      click('button', '检测设备')
      await wait(120)
      for (const b of [...document.querySelectorAll('button')].filter((el) => el.textContent.includes('浏览…'))) {
        b.click()
        await wait(60)
      }
      click('button', '选择 XML')
      await wait(120)
      document.querySelector('.content').scrollTop = 420
    }
  })
})()
