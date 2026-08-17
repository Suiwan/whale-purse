#!/usr/bin/env node
/**
 * 把鲸鱼娘立绘重新内联进 lib/client.js。
 *
 * 默认优先使用 assets/whale-sprite.webp（体积更小）；文件不存在时回退到
 * assets/whale-sprite.png。生成 WebP 可用（本机需安装 cwebp）：
 *
 *   cwebp -q 90 -alpha_q 100 -m 6 assets/whale-sprite.png -o assets/whale-sprite.webp
 *
 * 用法：
 *   node scripts/embed-asset.mjs
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientPath = join(root, 'lib', 'client.js')
const assets = [
  { file: join(root, 'assets', 'whale-sprite.webp'), mime: 'image/webp' },
  { file: join(root, 'assets', 'whale-sprite.png'), mime: 'image/png' },
]
const asset = assets.find((candidate) => existsSync(candidate.file))
if (asset === undefined) {
  console.error('embed-asset: 找不到可内联的立绘（assets/whale-sprite.webp 或 whale-sprite.png）')
  process.exit(1)
}

const source = readFileSync(clientPath, 'utf8')
const marker = /(const WHALE_SPRITE = ')[^']*'/
if (!marker.test(source)) {
  console.error('embed-asset: 在 lib/client.js 中找不到 WHALE_SPRITE 常量')
  process.exit(1)
}
const dataUri = `data:${asset.mime};base64,${readFileSync(asset.file).toString('base64')}`
const next = source.replace(marker, `$1${dataUri}'`)
writeFileSync(clientPath, next)

const check = spawnSync(process.execPath, ['--check', clientPath], { encoding: 'utf8' })
if (check.status !== 0) {
  console.error('embed-asset: 替换后 lib/client.js 语法检查失败：')
  console.error(check.stderr)
  process.exit(check.status ?? 1)
}
const before = Buffer.byteLength(source, 'utf8')
const after = Buffer.byteLength(next, 'utf8')
console.log(`embedded ${basename(asset.file)} (${(Buffer.byteLength(readFileSync(asset.file)) / 1024).toFixed(1)} KiB raw)`)
console.log(`lib/client.js: ${(before / 1024).toFixed(1)} KiB -> ${(after / 1024).toFixed(1)} KiB`)
