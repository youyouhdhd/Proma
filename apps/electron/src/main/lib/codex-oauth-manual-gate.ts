/**
 * Codex OAuth 手动回调输入闸门
 *
 * Pi 的 Codex OAuth 同时等待 localhost 回调与 manual_code 手动输入（内部竞速）。
 * Main Process 用本闸门把渲染进程「完成登录」提交的回调 URL 递交给 Pi 的
 * manual_code prompt Promise：
 * - 只有第一次 submit 生效（自动回调与手动提交竞速时不会 double resolve）；
 * - cancel 会 reject 等待中的 Promise；
 * - 每次 reset 后可复用于下一次登录。
 *
 * 注意：提交的 URL 含 authorization code，本类绝不记录其内容。
 */

export interface ManualCodeSubmitResult {
  accepted: boolean
}

export interface PendingManualCode {
  request: { message: string; placeholder?: string }
  resolve(value: string): void
  reject(error: Error): void
}

export class ManualCodeGate {
  private pending: {
    resolve(value: string): void
    reject(error: Error): void
  } | null = null

  /** 是否正在等待手动输入 */
  get waiting(): boolean {
    return this.pending !== null
  }

  /**
   * 等待用户提交回调输入。同一时刻只允许一个等待者；
   * 重复调用会立即拒绝（前一个等待保持不变）。
   */
  waitForInput(request: { message: string; placeholder?: string }): Promise<string> {
    if (this.pending) {
      return Promise.reject(new Error('已有等待中的手动输入请求'))
    }
    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject }
      void request
    })
  }

  /**
   * 提交回调输入。首次提交 resolve 等待 Promise，之后忽略。
   */
  submit(value: string): ManualCodeSubmitResult {
    const pending = this.pending
    if (!pending) return { accepted: false }
    this.pending = null
    pending.resolve(value)
    return { accepted: true }
  }

  /** 取消等待（拒绝挂起 Promise；无等待时静默）。 */
  cancel(error: Error): void {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    pending.reject(error)
  }

  /** 重置（丢弃等待者，不 reject——用于进程级清理后的重新开始）。 */
  reset(): void {
    this.pending = null
  }
}
