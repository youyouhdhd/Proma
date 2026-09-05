import { describe, expect, it } from 'bun:test'
import { ManualCodeGate } from './codex-oauth-manual-gate.ts'

describe('ManualCodeGate', () => {
  it('Given 等待中 When 首次 submit Then resolve 且 accepted=true', async () => {
    const gate = new ManualCodeGate()
    const waiting = gate.waitForInput({ message: '粘贴回调 URL' })
    const result = gate.submit('http://localhost:1455/auth/callback?code=ABC&state=XYZ')
    expect(result.accepted).toBe(true)
    expect(await waiting).toBe('http://localhost:1455/auth/callback?code=ABC&state=XYZ')
  })

  it('Given 已 submit When 再次 submit Then 忽略（accepted=false）', async () => {
    const gate = new ManualCodeGate()
    void gate.waitForInput({ message: 'x' })
    expect(gate.submit('first').accepted).toBe(true)
    expect(gate.submit('second').accepted).toBe(false)
  })

  it('Given 竞速（自动回调先到）When cancel Then 后续 submit 不再生效', async () => {
    const gate = new ManualCodeGate()
    const waiting = gate.waitForInput({ message: 'x' })
    gate.cancel(new Error('localhost 回调已完成'))
    await expect(waiting).rejects.toThrow('localhost 回调已完成')
    expect(gate.submit('late').accepted).toBe(false)
  })

  it('Given 无等待者 When cancel Then 静默', () => {
    const gate = new ManualCodeGate()
    expect(() => gate.cancel(new Error('x'))).not.toThrow()
  })

  it('Given 重复 waitForInput While 已有等待 Then 新等待立即拒绝', async () => {
    const gate = new ManualCodeGate()
    void gate.waitForInput({ message: 'first' })
    await expect(gate.waitForInput({ message: 'second' })).rejects.toThrow('已有等待中的手动输入请求')
  })

  it('Given reset When 再等待 Then 可正常使用', async () => {
    const gate = new ManualCodeGate()
    void gate.waitForInput({ message: 'stale' })
    gate.reset()
    const waiting = gate.waitForInput({ message: 'fresh' })
    expect(gate.submit('ok').accepted).toBe(true)
    expect(await waiting).toBe('ok')
  })
})
