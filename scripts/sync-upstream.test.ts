import { describe, expect, test } from 'bun:test'
import {
  createSyncBranchNames,
  formatSyncTimestamp,
  parseRevListCounts,
  resolveSyncCommand,
} from './sync-upstream'

describe('上游同步助手', () => {
  test('Given rev-list 输出 When 解析 Then 得到上游和 Fork 提交数', () => {
    expect(parseRevListCounts('73\t5\n')).toEqual({ left: 73, right: 5 })
  })

  test('Given 非法 rev-list 输出 When 解析 Then 拒绝继续同步', () => {
    expect(() => parseRevListCounts('ahead unknown')).toThrow('无法解析 Git 提交计数')
  })

  test('Given 固定时间 When 生成分支名 Then 名称稳定且不含路径危险字符', () => {
    const stamp = formatSyncTimestamp(new Date(2026, 7, 30, 12, 34, 56))
    expect(stamp).toBe('20260830-123456')
    expect(createSyncBranchNames(stamp)).toEqual({
      backup: 'backup/main-before-upstream-20260830-123456',
      sync: 'sync/upstream-20260830-123456',
    })
  })

  test('Given 上游无更新且未申请 apply When 决策 Then 不创建分支', () => {
    expect(resolveSyncCommand(false, 0)).toBe('noop')
  })

  test('Given 上游有更新且未申请 apply When 决策 Then 只报告待同步提交', () => {
    expect(resolveSyncCommand(false, 3)).toBe('report')
  })

  test('Given 用户申请 apply When 决策 Then 进入同步流程', () => {
    expect(resolveSyncCommand(true, 3)).toBe('apply')
  })
})
