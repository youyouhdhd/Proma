import { describe, expect, it } from 'bun:test'
import { detectLanguage, isPathOnlyContent } from './language-detector.ts'

describe('isPathOnlyContent', () => {
  it('多行正斜杠路径清单被识别为纯路径内容', () => {
    const code = [
      'apps/electron/src/main/ipc.ts',
      'apps/electron/src/main/lib/agent-service.ts',
      'packages/shared/src/types/agent.ts',
    ].join('\n')
    expect(isPathOnlyContent(code)).toBe(true)
  })

  it('Windows 绝对路径（盘符 + 反斜杠）被识别为纯路径内容', () => {
    expect(isPathOnlyContent('C:\\Users\\MOVE\\.proma\\config.json')).toBe(true)
  })

  it('Unix 绝对路径与带行列号后缀的路径被识别为纯路径内容', () => {
    expect(isPathOnlyContent('/usr/local/bin/proma')).toBe(true)
    expect(isPathOnlyContent('src/lib/utils.ts:42:10')).toBe(true)
  })

  it('含空行时仍以非空行为准，全为路径则通过', () => {
    expect(isPathOnlyContent('a/b/c.ts\n\nd/e/f.ts\n')).toBe(true)
  })

  it('带空格的命令行不是纯路径内容（应继续走语言自动检测）', () => {
    expect(isPathOnlyContent('bun run --filter=@proma/electron dist:win')).toBe(false)
  })

  it('带注释或引号的 shell 片段不是纯路径内容', () => {
    expect(isPathOnlyContent('# install\n/usr/local/bin/proma')).toBe(false)
    expect(isPathOnlyContent('echo \"a/b\"')).toBe(false)
  })

  it('普通代码片段不是纯路径内容', () => {
    expect(isPathOnlyContent('const foo = require(\'./bar\')')).toBe(false)
    expect(isPathOnlyContent('import x from \'y\'')).toBe(false)
  })

  it('空内容与纯空白不是纯路径内容', () => {
    expect(isPathOnlyContent('')).toBe(false)
    expect(isPathOnlyContent('   \n  ')).toBe(false)
  })
})

describe('detectLanguage', () => {
  it('Given 未标注语言的路径清单 When 自动检测 Then 回退 text 而不是误判为 swift', () => {
    // 回归场景：该清单曾被 highlight.js 以 relevance 11 判为 swift。
    const code = [
      'apps/electron/src/main/ipc.ts',
      'apps/electron/src/main/lib/agent-service.ts',
      'packages/shared/src/types/agent.ts',
      'packages/core/src/providers/openai-adapter.ts',
      'apps/electron/src/renderer/components/agent/AgentView.tsx',
    ].join('\n')
    expect(detectLanguage(code)).toBe('text')
  })

  it('Given 通用相对路径列表 When 自动检测 Then 回退 text 而不是误判为 css', () => {
    // 回归场景：a/b/c.ts 形式的 6 行清单曾被误判为 css。
    const code = ['a/b/c.ts', 'd/e/f.ts', 'g/h/i.ts', 'j/k/l.ts', 'm/n/o.ts', 'p/q/r.ts'].join('\n')
    expect(detectLanguage(code)).toBe('text')
  })

  it('Given 真实代码 When 自动检测 Then 仍能识别出语言', () => {
    const code = [
      'const greet = (name) => {',
      '  const message = `hello ${name}`',
      '  console.log(message)',
      '  return message',
      '}',
    ].join('\n')
    expect(detectLanguage(code)).toBe('javascript')
  })

  it('Given 空内容 When 自动检测 Then 返回 text', () => {
    expect(detectLanguage('')).toBe('text')
    expect(detectLanguage('   ')).toBe('text')
  })
})
