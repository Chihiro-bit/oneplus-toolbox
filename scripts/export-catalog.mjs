// 把内置目录导出为 catalog/catalog.json，作为自建远程目录的起点
// 用法：node scripts/export-catalog.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dirname, '..', 'src', 'shared', 'catalog.ts'), 'utf8')
const body = src.slice(src.indexOf('export const BUILTIN_CATALOG: Catalog = ') + 'export const BUILTIN_CATALOG: Catalog = '.length)
const literal = body.slice(0, body.indexOf('\n}\n') + 2)
const catalog = new Function(`return (${literal})`)()
catalog.schemes = catalog.schemes.filter((s) => !s.apk.bundled)
const out = join(import.meta.dirname, '..', 'catalog', 'catalog.json')
writeFileSync(out, JSON.stringify(catalog, null, 2) + '\n')
console.log(`已导出 ${catalog.schemes.length} 个方案 → catalog/catalog.json`)
