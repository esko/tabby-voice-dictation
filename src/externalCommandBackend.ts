import { VoiceDictationConfig } from './types'

declare const window: Window & { require?: NodeRequire }
declare const process: any

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

      const cleanupTimeout = () => {
        clearTimeout(timeout)
      }

      const timeout = setTimeout(() => {
        if (settled) {
          return
        }
        settled = true
        this.killProcess()
        reject(new Error(`External dictation command timed out after ${config.externalCommandTimeoutMs} ms`))
      }, config.externalCommandTimeoutMs)

      try {
        const child = childProcess.spawn(command, { shell: true, detached: true })
        this.child = child

        child.stdout?.on('data', (chunk: Buffer | string) => {
          stdout += chunk.toString()
        })

        child.stderr?.on('data', (chunk: Buffer | string) => {
          stderr += chunk.toString()
        })

        child.on('error', (err: Error) => {
          cleanupTimeout()
          if (settled) {
            return
          }
          settled = true
          this.child = null
          reject(err)
        })

        child.on('close', (code: number) => {
          cleanupTimeout()
          if (settled) {
            return
          }
          settled = true
          this.child = null

          if (code !== 0) {
            reject(new Error(stderr.trim() || `Command exited with code ${code}`))
            return
          }

          resolve(stdout.trim())
        })
      } catch (err) {
        cleanupTimeout()
        settled = true
        this.child = null
        reject(err)
      }
    })
  }

  cancel (): void {
    this.killProcess()
  }

  private killProcess (): void {
    if (this.child) {
      const pid = this.child.pid
      if (pid) {
        try {
          process.kill(-pid, 'SIGTERM')
        } catch (_e) {
          try {
            this.child.kill('SIGTERM')
          } catch (_) {}
        }
      } else {
        try {
          this.child.kill('SIGTERM')
        } catch (_) {}
      }
      this.child = null
    }
  }
}
