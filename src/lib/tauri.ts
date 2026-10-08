import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** True only inside the packaged/dev Tauri shell — the same build still runs as a plain web app. */
export const isDesktop = () => typeof window !== 'undefined' && isTauri()

export async function saveBackup(jsonText: string, suggestedName: string): Promise<{ ok: boolean; filePath?: string }> {
  return invoke('save_backup', { jsonText, suggestedName })
}

export async function openBackup(): Promise<{ ok: boolean; text?: string }> {
  return invoke('open_backup')
}

export function onNavigate(handler: (path: string) => void): () => void {
  if (!isDesktop()) return () => undefined
  let unlisten: (() => void) | null = null
  let cancelled = false
  void listen<string>('menu:navigate', (e) => handler(e.payload)).then((u) => { if (cancelled) u(); else unlisten = u })
  return () => { cancelled = true; unlisten?.() }
}

export function onBackupRequest(handler: () => void): () => void {
  if (!isDesktop()) return () => undefined
  let unlisten: (() => void) | null = null
  let cancelled = false
  void listen('menu:backup', () => handler()).then((u) => { if (cancelled) u(); else unlisten = u })
  return () => { cancelled = true; unlisten?.() }
}

/** Reveals the main window — it starts hidden (tauri.conf.json) to avoid a flash of unstyled content before the store data has loaded. */
export function showWindow() {
  if (!isDesktop()) return
  const win = getCurrentWindow()
  void win.show()
  void win.setFocus()
}

export interface SerialPortInfo { path: string; label: string }

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  return invoke('list_serial_ports')
}

export type PrinterTarget =
  | { kind: 'usbSerial'; path: string; baud: number }
  | { kind: 'network'; host: string; port: number }

export async function printRaw(target: PrinterTarget, data: Uint8Array): Promise<void> {
  await invoke('print_raw', { target, data: Array.from(data) })
}
