import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const root = path.resolve('vendor/lingtu-runtime')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'source-files.json'), 'utf8'))
for (const file of manifest.files) {
  const target = path.resolve(root, file.path)
  if (!target.startsWith(root + path.sep)) throw new Error('上游清单包含非法路径')
  const bytes = fs.readFileSync(target)
  const hash = crypto.createHash('sha256').update(bytes).digest('hex')
  if (hash !== file.sha256) throw new Error(`上游文件已改动，请按升级流程核对：${file.path}`)
}
console.log(
  `上游源码完整性通过：${manifest.files.length} 个文件，固定提交 ${manifest.commit.slice(0, 7)}`,
)
