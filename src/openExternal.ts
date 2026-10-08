/**
 * Open a URL with the platform's default handler.
 *
 * Its own module because exactly two callers want it — the account service when
 * a device authorization starts, and the authorization flow when one is driven
 * from the harness — and neither of them owns the other. Living inside
 * `account.ts` made the flow module import the credential module for a side
 * effect on the operator's desktop, which is not a relationship either of them
 * should have.
 *
 * Every failure is non-fatal by design. A headless host has no browser, and a
 * machine whose handler cannot be spawned is still perfectly able to finish a
 * device grant by typing the logged URL — which is why both callers log it.
 */
import { spawn } from 'node:child_process'

/** @param url - the page to open. */
export function openExternal(url: string): void {
  let command: string
  let args: string[]
  if (process.platform === 'win32') {
    // The empty-string title keeps `start` from reading the URL as a window
    // title; `windowsHide` and a detached child keep a console from flashing.
    command = 'cmd'
    args = ['/c', 'start', '', url]
  }
  else if (process.platform === 'darwin') {
    command = 'open'
    args = [url]
  }
  else {
    command = 'xdg-open'
    args = [url]
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
  }
  catch {
    // A headless host has no browser; the logged URL and code are enough.
  }
}
