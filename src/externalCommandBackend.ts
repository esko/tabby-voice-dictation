import { VoiceDictationConfig } from './types'

declare const window: Window & { require?: NodeRequire }

function expandHome (command: string): string {
  if (!command.startsWith('~/')) {
    return command
  }
  const os = window.require?.('os')
  return `${os.homedir()}${command.slice(1)}`
}

export class ExternalCommandBackend {
  private child: any = null

  dictate (config: VoiceDictationConfig): Promise<string> {
    const childProcess = window.require?.('child_process')
    if (!childProcess) {
      return Promise.reject(new Error('Node child_process is unavailable; cannot run external ASR command'))
    }

    const command = expandHome(config.externalCommand)

    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let settled = false

      const timeout = setTimeout(() => {
        if (settled) {
          return
        }
        settled = true
        this.child?.kill?.('SIGTERM')
        reject(new Error(`External dictation command timed out after ${config.externalCommandTimeoutMs} ms`))
      }, config.externalCommandTimeoutMs)

      this.child = childProcess.exec(command, { shell: true }, (error: Error | null) => {
        clearTimeout(timeout)
        if (settled) {
          return
        }
        settled = true
        this.child = null

        if (error) {
          reject(new Error(stderr || error.message))
          return
        }

        resolve(stdout.trim())
      })

      this.child.stdout?.on?.('data', (chunk: Buffer | string) => {
        stdout += chunk.toString()
      })
      this.child.stderr?.on?.('data', (chunk: Buffer | string) => {
        stderr += chunk.toString()
      })
    })
  }

  cancel (): void {
    this.child?.kill?.('SIGTERM')
    this.child = null
  }
}
