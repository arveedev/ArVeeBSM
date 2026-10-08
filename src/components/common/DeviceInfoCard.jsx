// "This device" - what the browser reports about the PC the app is running on, plus how much
// the app is using. Shown at the bottom of Settings so that when someone says the app is slow
// or crashes on their PC, the numbers needed to understand why can be read off in seconds
// instead of guessed. Read-only; nothing here is sent anywhere.

import { useEffect, useState } from 'react'
import { APP_VERSION } from '../../version.js'
import { isLowSpecDevice } from '../../services/syncWorker.js'

const mb = (bytes) => (bytes == null ? '—' : `${(bytes / 1048576).toFixed(0)} MB`)

function DeviceInfoCard() {
  const [storage, setStorage] = useState(null)
  const [heap, setHeap] = useState(null)

  useEffect(() => {
    let off = false
    const read = async () => {
      try {
        const est = await navigator.storage?.estimate?.()
        if (!off && est) setStorage(est)
      } catch { /* not available in this browser */ }
      if (!off) setHeap(performance?.memory?.usedJSHeapSize ?? null)
    }
    read()
    const id = setInterval(read, 5000)
    return () => { off = true; clearInterval(id) }
  }, [])

  const rows = [
    ['App version', APP_VERSION],
    ['Memory reported by this PC', navigator.deviceMemory ? `${navigator.deviceMemory} GB (the browser rounds this down)` : 'not reported'],
    ['Processor cores', navigator.hardwareConcurrency ?? 'not reported'],
    ['Slower background sync (low-spec mode)', isLowSpecDevice() ? 'ON' : 'off'],
    ['Memory the app is using now', mb(heap)],
    ['Data stored on this device', storage ? mb(storage.usage) : '—'],
    ['Browser', navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 90)],
  ]

  return (
    <section className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">This device</h2>
      <p className="mt-1 text-xs text-neutral-500">Useful to send along when the app feels slow on a PC.</p>
      <dl className="mt-3 space-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-3">
            <dt className="text-neutral-400">{k}</dt>
            <dd className="min-w-0 break-words text-right text-app-text">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default DeviceInfoCard
