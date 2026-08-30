import { describe, expect, test } from 'bun:test'
import { resolveNodePtyPreparationMode } from './prepare-node-pty'

describe('node-pty 准备策略', () => {
  test('Given Windows 预编译存在且通过 Electron 验证 When 准备 Then 跳过源码重编译', () => {
    expect(resolveNodePtyPreparationMode({
      platform: 'win32',
      forceRebuild: false,
      hasPrebuild: true,
      prebuildValidated: true,
    })).toBe('use-prebuild')
  })

  test('Given 用户显式要求源码构建 When 准备 Then 不使用预编译', () => {
    expect(resolveNodePtyPreparationMode({
      platform: 'win32',
      forceRebuild: true,
      hasPrebuild: true,
      prebuildValidated: true,
    })).toBe('rebuild')
  })

  test.each([
    { hasPrebuild: false, prebuildValidated: false },
    { hasPrebuild: true, prebuildValidated: false },
  ])('Given Windows 预编译不可用 When 准备 Then 回退源码重编译', ({ hasPrebuild, prebuildValidated }) => {
    expect(resolveNodePtyPreparationMode({
      platform: 'win32',
      forceRebuild: false,
      hasPrebuild,
      prebuildValidated,
    })).toBe('rebuild')
  })

  test.each(['darwin', 'linux'] as const)('Given %s 平台 When 准备 Then 保持源码重编译流程', (platform) => {
    expect(resolveNodePtyPreparationMode({
      platform,
      forceRebuild: false,
      hasPrebuild: true,
      prebuildValidated: true,
    })).toBe('rebuild')
  })
})
