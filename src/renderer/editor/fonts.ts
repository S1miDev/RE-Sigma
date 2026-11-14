import { useEffect, useState } from 'react'

let cache: Promise<string[]> | undefined

/** Installed font families, from the Local Font Access API. Empty when it is unavailable or the user/Electron denies it. */
function systemFonts(): Promise<string[]> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
  cache ??= q ? q.call(window).then((fs) => [...new Set(fs.map((f) => f.family))].sort(), () => []) : Promise.resolve([])
  return cache
}

/** The installed font families; [] until loaded, or when they can't be listed (callers then use their own list). */
export function useSystemFonts(): string[] {
  const [fonts, setFonts] = useState<string[]>([])
  useEffect(() => { void systemFonts().then(setFonts) }, [])
  return fonts
}
