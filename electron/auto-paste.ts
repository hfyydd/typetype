import { exec, execSync } from 'child_process';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { clipboard } from 'electron';

export const FOREGROUND_RESTORE_DELAY_MS = 220;

export interface PasteOperationResult {
  ok: boolean;
  targetAppId?: string | null;
  foregroundAppId?: string | null;
  error?: string;
}

interface WindowsForegroundTarget {
  hwnd?: string;
  pid?: string;
  title?: string;
  process?: string;
}

export function createWindowsPasteScript(): string {
  return `
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    public class KeySim {
      [DllImport("user32.dll")]
      public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    }
"@
    $KEYEVENTF_KEYUP = 0x0002
    $VK_CONTROL = 0x11
    $VK_V = 0x56
    [KeySim]::keybd_event($VK_CONTROL, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
    [KeySim]::keybd_event($VK_V, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
    [KeySim]::keybd_event($VK_V, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    [KeySim]::keybd_event($VK_CONTROL, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
  `;
}

export function createWindowsReplaceRecentTextScript(charCount: number): string {
  const safeCharCount = Math.max(0, Math.min(Math.floor(charCount), 20000));
  return `
    $count = ${safeCharCount}
    if ($count -le 0) {
      exit 1
    }
    $wshell = New-Object -ComObject WScript.Shell
    Start-Sleep -Milliseconds 80
    $wshell.SendKeys("^{END}")
    Start-Sleep -Milliseconds 60
    for ($i = 0; $i -lt $count; $i++) {
      $wshell.SendKeys("+{LEFT}")
      if (($i % 32) -eq 0) {
        Start-Sleep -Milliseconds 1
      }
    }
    Start-Sleep -Milliseconds 40
    $wshell.SendKeys("^v")
  `;
}

export function createWindowsCaptureForegroundScript(): string {
  return `
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    using System.Text;
    public class WindowCapture {
      [DllImport("user32.dll")]
      public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll", CharSet = CharSet.Unicode)]
      public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
      [DllImport("user32.dll")]
      public static extern int GetWindowTextLength(IntPtr hWnd);
      [DllImport("user32.dll")]
      public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    }
"@
    $hwnd = [WindowCapture]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) {
      [Console]::Out.WriteLine("")
      exit 0
    }
    $length = [WindowCapture]::GetWindowTextLength($hwnd)
    $builder = [System.Text.StringBuilder]::new($length + 1)
    [WindowCapture]::GetWindowText($hwnd, $builder, $builder.Capacity) | Out-Null
    $processId = 0
    [WindowCapture]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null
    $processName = ""
    try {
      $processName = [System.Diagnostics.Process]::GetProcessById([int]$processId).ProcessName
    } catch {}
    $payload = @{
      hwnd = $hwnd.ToInt64().ToString()
      pid = [string]$processId
      title = $builder.ToString()
      process = $processName
    } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($payload)
  `;
}

export function createWindowsRestoreForegroundScript(windowHandle: string): string {
  const target = JSON.parse(windowHandle);
  const hwnd = Number(target.hwnd || 0);
  const pid = Number(target.pid || 0);
  return `
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    public class WindowRestore {
      [DllImport("user32.dll")]
      public static extern bool SetForegroundWindow(IntPtr hWnd);
      [DllImport("user32.dll")]
      public static extern bool BringWindowToTop(IntPtr hWnd);
      [DllImport("user32.dll")]
      public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
      [DllImport("user32.dll")]
      public static extern bool IsIconic(IntPtr hWnd);
      [DllImport("user32.dll")]
      public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll")]
      public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
      [DllImport("kernel32.dll")]
      public static extern uint GetCurrentThreadId();
      [DllImport("user32.dll")]
      public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    }
"@
    $hwnd = [IntPtr]::new(${hwnd})
    if ($hwnd -eq [IntPtr]::Zero) {
      exit 1
    }
    if ([WindowRestore]::IsIconic($hwnd)) {
      [WindowRestore]::ShowWindowAsync($hwnd, 9) | Out-Null
    } else {
      [WindowRestore]::ShowWindowAsync($hwnd, 5) | Out-Null
    }
    $currentForeground = [WindowRestore]::GetForegroundWindow()
    $targetPid = 0
    $foregroundPid = 0
    $targetThread = [WindowRestore]::GetWindowThreadProcessId($hwnd, [ref]$targetPid)
    $foregroundThread = [WindowRestore]::GetWindowThreadProcessId($currentForeground, [ref]$foregroundPid)
    $currentThread = [WindowRestore]::GetCurrentThreadId()
    if ($targetThread -gt 0) {
      [WindowRestore]::AttachThreadInput($currentThread, $targetThread, $true) | Out-Null
    }
    if ($foregroundThread -gt 0 -and $foregroundThread -ne $targetThread) {
      [WindowRestore]::AttachThreadInput($currentThread, $foregroundThread, $true) | Out-Null
    }
    [WindowRestore]::BringWindowToTop($hwnd) | Out-Null
    [WindowRestore]::SetForegroundWindow($hwnd) | Out-Null
    if ($foregroundThread -gt 0 -and $foregroundThread -ne $targetThread) {
      [WindowRestore]::AttachThreadInput($currentThread, $foregroundThread, $false) | Out-Null
    }
    if ($targetThread -gt 0) {
      [WindowRestore]::AttachThreadInput($currentThread, $targetThread, $false) | Out-Null
    }
    if (${pid} -gt 0) {
      $wshell = New-Object -ComObject WScript.Shell
      $wshell.AppActivate(${pid}) | Out-Null
    }
  `;
}

export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function parseWindowsForegroundTarget(value: string | null | undefined): WindowsForegroundTarget | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as WindowsForegroundTarget;
    return parsed?.hwnd || parsed?.pid ? parsed : null;
  } catch {
    return null;
  }
}

export function isSameWindowsForegroundTarget(
  expected: string | null | undefined,
  actual: string | null | undefined
): boolean {
  const expectedTarget = parseWindowsForegroundTarget(expected);
  const actualTarget = parseWindowsForegroundTarget(actual);
  if (!expectedTarget || !actualTarget) {
    return false;
  }

  if (expectedTarget.hwnd && actualTarget.hwnd) {
    if (expectedTarget.hwnd === actualTarget.hwnd) {
      return true;
    }
  }

  if (expectedTarget.pid && actualTarget.pid && expectedTarget.pid === actualTarget.pid) {
    const expectedProcess = (expectedTarget.process ?? '').toLocaleLowerCase();
    const actualProcess = (actualTarget.process ?? '').toLocaleLowerCase();
    return !expectedProcess || !actualProcess || expectedProcess === actualProcess;
  }

  return false;
}

export async function runAutoPasteSequence(
  bundleId: string | null | undefined,
  restoreForegroundApp: (bundleId?: string) => Promise<void>,
  paste: () => Promise<void>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<void> {
  if (bundleId) {
    await restoreForegroundApp(bundleId);
    await wait(FOREGROUND_RESTORE_DELAY_MS);
  }

  await paste();
}

export class AutoPaste {
  private platform: NodeJS.Platform;

  constructor() {
    this.platform = process.platform;
  }

  async writeClipboard(text: string): Promise<void> {
    clipboard.writeText(text);
  }

  async paste(): Promise<void> {
    if (this.platform === 'darwin') {
      await this.pasteMac();
    } else if (this.platform === 'win32') {
      await this.pasteWindows();
    }
  }

  async pasteToApp(bundleId?: string | null): Promise<PasteOperationResult> {
    try {
      if (this.platform === 'win32') {
        return await this.pasteToWindowsTarget(bundleId);
      }

      await runAutoPasteSequence(
        bundleId,
        (id) => this.restoreForegroundApp(id),
        () => this.paste()
      );
      return { ok: true, targetAppId: bundleId ?? null };
    } catch (error) {
      return {
        ok: false,
        targetAppId: bundleId ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async pasteToAppFast(bundleId?: string | null): Promise<PasteOperationResult> {
    try {
      await this.paste();
      return {
        ok: true,
        targetAppId: bundleId ?? null,
        foregroundAppId: null,
      };
    } catch (error) {
      return {
        ok: false,
        targetAppId: bundleId ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async replaceRecentTextInApp(
    bundleId: string | null | undefined,
    replacementText: string,
    charsToReplace: number
  ): Promise<PasteOperationResult> {
    await this.writeClipboard(replacementText);

    if (this.platform !== 'win32') {
      return {
        ok: false,
        targetAppId: bundleId ?? null,
        error: '一键带入目前仅支持 Windows 自动替换。',
      };
    }

    try {
      const foregroundResult = await this.restoreAndVerifyWindowsTarget(bundleId);
      if (!foregroundResult.ok) {
        return foregroundResult;
      }

      await this.execPowerShell(createWindowsReplaceRecentTextScript(charsToReplace));
      await new Promise((resolve) => setTimeout(resolve, 80));
      const foregroundAppId = await this.captureFrontmostApp();
      return {
        ok: !bundleId || isSameWindowsForegroundTarget(bundleId, foregroundAppId),
        targetAppId: bundleId ?? null,
        foregroundAppId,
        error: bundleId && !isSameWindowsForegroundTarget(bundleId, foregroundAppId)
          ? '目标窗口在替换过程中发生变化。'
          : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        targetAppId: bundleId ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async pasteMac(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use AppleScript to simulate Cmd+V
      const script = `
        tell application "System Events"
          keystroke "v" using command down
        end tell
      `;

      try {
        exec(`osascript -e '${script}'`, (err) => {
          if (err) {
            console.error('AppleScript paste error:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  private execPowerShell(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const encoded = encodePowerShellCommand(script);
      exec(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
        (err, stdout) => {
          if (err) {
            reject(err);
          } else {
            resolve(stdout.trim());
          }
        }
      );
    });
  }

  private async pasteWindows(): Promise<void> {
    try {
      await this.execPowerShell(createWindowsPasteScript());
    } catch (e) {
      console.error('PowerShell paste error:', e);
      throw e;
    }
  }

  private async restoreAndVerifyWindowsTarget(bundleId?: string | null): Promise<PasteOperationResult> {
    if (!bundleId) {
      return { ok: true, targetAppId: null };
    }

    await this.restoreForegroundApp(bundleId);
    await new Promise((resolve) => setTimeout(resolve, FOREGROUND_RESTORE_DELAY_MS));
    const foregroundAppId = await this.captureFrontmostApp();
    const ok = isSameWindowsForegroundTarget(bundleId, foregroundAppId);
    return {
      ok,
      targetAppId: bundleId,
      foregroundAppId,
      error: ok ? undefined : '目标窗口未成为前台窗口，已暂停自动回填。',
    };
  }

  private async pasteToWindowsTarget(bundleId?: string | null): Promise<PasteOperationResult> {
    try {
      const foregroundResult = await this.restoreAndVerifyWindowsTarget(bundleId);
      if (!foregroundResult.ok) {
        return foregroundResult;
      }

      await this.pasteWindows();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const foregroundAppId = await this.captureFrontmostApp();
      const ok = !bundleId || isSameWindowsForegroundTarget(bundleId, foregroundAppId);
      return {
        ok,
        targetAppId: bundleId ?? null,
        foregroundAppId,
        error: ok ? undefined : '粘贴后目标窗口发生变化，已停止自动回填。',
      };
    } catch (error) {
      return {
        ok: false,
        targetAppId: bundleId ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async restoreForegroundApp(bundleId?: string): Promise<void> {
    if (this.platform === 'darwin' && bundleId) {
      return new Promise((resolve, reject) => {
        try {
          exec(`osascript -e 'tell application id "${bundleId}" to activate'`, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        } catch (e) {
          reject(e);
        }
      });
    }

    if (this.platform === 'win32' && bundleId) {
      try {
        await this.execPowerShell(createWindowsRestoreForegroundScript(bundleId));
        console.log('Restored Windows foreground window', JSON.parse(bundleId));
      } catch (e) {
        console.error('Windows foreground restore error:', e);
        throw e;
      }
      return;
    }

    return Promise.resolve();
  }

  async captureFrontmostApp(): Promise<string | null> {
    if (this.platform === 'darwin') {
      return new Promise((resolve) => {
        const script = `
          tell application "System Events"
            set frontApp to first application process whose frontmost is true
            return bundle identifier of frontApp
          end tell
        `;

        exec(`osascript -e '${script}'`, (err, stdout) => {
          if (err) {
            resolve(null);
          } else {
            resolve(stdout.trim());
          }
        });
      });
    } else if (this.platform === 'win32') {
      return new Promise((resolve) => {
        const script = createWindowsCaptureForegroundScript();
        this.execPowerShell(script).then((stdout) => {
          if (!stdout) {
            console.log('Captured Windows foreground window', { hwnd: null, pid: null, title: null, process: null });
            resolve(null);
            return;
          }

          try {
            const target = JSON.parse(stdout);
            console.log('Captured Windows foreground window', target);
            resolve(JSON.stringify(target));
          } catch (error) {
            console.error('Windows foreground capture parse error:', error, stdout);
            resolve(null);
          }
        }).catch((err) => {
          if (err) {
            console.error('Windows foreground capture error:', err);
            resolve(null);
          }
        });
      });
    }
    return null;
  }
}
