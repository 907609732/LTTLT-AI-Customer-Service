import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'

const root = path.resolve('src')
function files(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? files(path.join(directory, entry.name))
        : [path.join(directory, entry.name)],
    )
}

/** 保持为纯函数，便于添加新的依赖方向验收用例。 */
export function dependencyError(from, to) {
  const owner = from.match(/^modules\/([^/]+)/)?.[1]
  const target = to.match(/^modules\/([^/]+)/)?.[1]
  if (from.startsWith('shared/') && /^(app|modules)\//.test(to))
    return 'shared 不得依赖业务或应用装配层'
  if (owner && to.startsWith('app/')) return '业务模块不得依赖应用装配层'
  if (target && target !== owner && !/^modules\/[^/]+(?:\/index(?:\.ts)?)?$/.test(to))
    return '跨模块必须通过 index.ts 公开入口'
  return ''
}

export function checkSource(file, source) {
  const failures = []
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  function checkSpecifier(node) {
    const spec = node.text
    const resolved = spec.startsWith('@/')
      ? spec.slice(2)
      : spec.startsWith('.')
        ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec))
        : spec
    const error = dependencyError(file, resolved)
    if (error) failures.push(`${file}: ${error} (${spec})`)
    if (
      file.endsWith('.vue') &&
      (spec === 'electron' || spec.startsWith('node:') || spec === 'axios')
    )
      failures.push(`${file}: 组件不得直接导入系统/网络 API`)
  }
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      checkSpecifier(node.moduleSpecifier)
    if (ts.isCallExpression(node)) {
      // 动态 import('…') 与静态导入遵循同一依赖方向；字符串变量无法静态判定，保守跳过。
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      )
        checkSpecifier(node.arguments[0])
      if (file.endsWith('.vue')) {
        const expression = node.expression.getText(ast)
        if (
          /^(?:fetch|window\.fetch|globalThis\.fetch|(?:window\.)?(?:localStorage|sessionStorage)\.|window\.yunduoDesktop\.)/.test(
            expression,
          )
        )
          failures.push(`${file}: 组件必须通过服务或平台适配访问环境 API`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return failures
}

/** Vue 普通 script 与 script setup 都参与同一规则；只读模板不执行环境 API。 */
export function checkVueSource(file, text) {
  const { descriptor } = parse(text)
  return [descriptor.script?.content, descriptor.scriptSetup?.content]
    .filter((content) => typeof content === 'string')
    .flatMap((content) => checkSource(file, content))
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/check-boundaries.mjs')) {
  const failures = files(root)
    .filter((file) => /\.(ts|vue)$/.test(file))
    .flatMap((file) => {
      const relative = path.relative(root, file).replaceAll('\\', '/')
      const text = fs.readFileSync(file, 'utf8')
      return file.endsWith('.vue') ? checkVueSource(relative, text) : checkSource(relative, text)
    })
  if (failures.length) {
    console.error(failures.join('\n'))
    process.exitCode = 1
  } else console.log('模块依赖方向与组件环境 API 检查通过')
}
