/**
 * 本地工具安全守卫
 *
 * 强制项（见设计文档 §20）：所有 filesystem 工具必须
 *   resolve(path) → realpath → 确认 realpath 位于 workspace root 的 realpath 内。
 * 禁止 path.startsWith(root) 这类逻辑判断；symlink 逃逸必须被真实路径检测拦截。
 */

import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve, dirname, relative, sep } from 'node:path'
import type { LocalToolResult } from './types'

/** 工具失败结果（与 LocalToolResult.error 同形的错误负载） */
type ToolError = NonNullable<LocalToolResult['error']>

function err(code: ToolError['code'], message: string): { ok: false; error: ToolError } {
  return { ok: false, error: { code, message } }
}

/** 工作区根目录的 realpath 缓存（root 数量少，进程内缓存安全） */
const rootRealpathCache = new Map<string, string>()

/** 获取 root 的真实路径（不存在时回退 resolve 结果） */
export function getRootRealPath(rootPath: string): string {
  const cached = rootRealpathCache.get(rootPath)
  if (cached) return cached
  const real = existsSync(rootPath) ? realpathSync(rootPath) : resolve(rootPath)
  rootRealpathCache.set(rootPath, real)
  return real
}

export function clearRootRealPathCache(): void {
  rootRealpathCache.clear()
}

/** 目标路径是否位于 root 之内（或等于 root） */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export interface GuardedPath {
  /** realpath 意义下仍位于 workspace 内的绝对路径 */
  realPath: string
  /** 逻辑路径（resolve 后、未 realpath）——写入新文件时使用 */
  logicalPath: string
}

/**
 * 解析 workspace 内的相对路径并执行安全守卫。
 *
 * - 绝对路径 / .. 逃逸：以逻辑 resolve 结果先判一次；
 * - symlink 逃逸：对「最深存在祖先」做 realpath 后再判一次；
 *   不存在的尾部段（如待写入的新文件）按逻辑路径拼接回真实祖先。
 */
export function guardWorkspacePath(
  rootPath: string,
  inputPath: string,
  opts: { mustExist?: boolean } = {},
): { path: string } | { ok: false; error: ToolError } {
  const raw = typeof inputPath === 'string' ? inputPath.trim() : ''
  if (!raw) return err('INVALID_INPUT', 'path 不能为空')
  const root = resolve(rootPath)
  const logical = isAbsolute(raw) ? resolve(raw) : resolve(root, raw)
  // 第一道：逻辑路径包含检查（拒绝 ../ 与绝对路径注入）
  if (!isInside(root, logical)) return err('PATH_OUTSIDE_WORKSPACE', 'Requested path is outside the active workspace.')

  const rootReal = getRootRealPath(rootPath)

  // 第二道：真实路径包含检查（拦截 symlink 逃逸）
  if (existsSync(logical)) {
    const real = realpathSync(logical)
  if (!isInside(rootReal, real)) return err('PATH_OUTSIDE_WORKSPACE', 'Requested path resolves outside the active workspace (symlink).')
    if (opts.mustExist && !existsSync(real)) return err('PATH_NOT_FOUND', '路径不存在')
    return { path: real }
  }

  // 目标不存在：realpath 最深存在祖先，其余段为新建内容
  let ancestor = logical
  const tail: string[] = []
  while (!existsSync(ancestor)) {
    tail.unshift(ancestor)
    const parent = dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  if (!existsSync(ancestor)) return err('PATH_NOT_FOUND', '路径不存在')
  const ancestorReal = realpathSync(ancestor)
  if (!isInside(rootReal, ancestorReal)) return err('PATH_OUTSIDE_WORKSPACE', 'Requested path resolves outside the active workspace (symlink).')
  // 把未存在的尾部段接回真实祖先
  const rebuilt = tail.length > 0 ? resolve(ancestorReal, relative(ancestor, logical)) : ancestorReal
  if (!isInside(rootReal, rebuilt)) return err('PATH_OUTSIDE_WORKSPACE', 'Requested path resolves outside the active workspace.')
  if (opts.mustExist) return err('PATH_NOT_FOUND', '路径不存在')
  return { path: rebuilt }
}

/** 确保目标文件的父目录存在（仅允许在 workspace 内创建目录） */
export function ensureParentDir(filePath: string): void {
  const parent = dirname(filePath)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
}
