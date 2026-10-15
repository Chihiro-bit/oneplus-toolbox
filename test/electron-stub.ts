// 测试用的 electron 桩：只提供被顶层引用到的名字，真正调用会直接报错
const fail = (): never => {
  throw new Error('测试中不应调用 electron')
}
export const app = { getPath: fail, getVersion: () => '0.0.0', getAppPath: fail, isPackaged: false }
export const net = { fetch: fail }
