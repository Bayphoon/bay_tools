import { spawn } from 'node:child_process'
import { AppError } from './errors.js'

export interface SecretProtector {
  protect(value: string): Promise<string>
  unprotect(value: string): Promise<string>
}

// Only this static program appears in the process command line. Secret values travel over stdin.
const program = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $bytes = [Convert]::FromBase64String($request.value)
  $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($request.operation -eq 'protect') {
    $result = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
  } else {
    $result = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
  }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { exit 1 }
`

async function crypt(operation: 'protect' | 'unprotect', value: string): Promise<string> {
  if (process.platform !== 'win32') throw new AppError(501, 'WINDOWS_ONLY', '密钥加密保存仅支持 Windows；其他系统请配置 DEEPSEEK_API_KEY 环境变量')
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(program, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    let output = ''
    const failure = () => reject(new AppError(500, 'SECRET_UNAVAILABLE', '无法读取或保存本机加密密钥，请在设置中重新配置'))
    const timer = setTimeout(() => { child.kill(); failure() }, 15_000)
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk
      if (output.length > 32_768) { child.kill(); failure() }
    })
    child.once('error', () => { clearTimeout(timer); failure() })
    child.stdin.on('error', failure)
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 || !output.trim()) { failure(); return }
      resolve(operation === 'protect' ? output.trim() : Buffer.from(output.trim(), 'base64').toString('utf8'))
    })
    child.stdin.end(JSON.stringify({ operation, value: operation === 'protect' ? Buffer.from(value, 'utf8').toString('base64') : value }))
  })
}

export const windowsSecretProtector: SecretProtector = {
  protect: (value) => crypt('protect', value),
  unprotect: (value) => crypt('unprotect', value),
}
