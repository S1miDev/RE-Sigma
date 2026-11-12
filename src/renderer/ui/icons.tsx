// A small set of inline 16×16 stroke icons. No icon library.
const PATHS = {
  move: 'M3 2l9 5-4 1.5L6.5 13z',
  hand: 'M5 8V4.5a1 1 0 012 0V7m0-3.5a1 1 0 012 0V7m0-2.5a1 1 0 012 0V9.5c0 2.5-1.5 4.5-4 4.5S4 12.5 3.5 11L2.6 8.8a.9.9 0 011.6-.8L5 9.5',
  frame: 'M5 2v12M11 2v12M2 5h12M2 11h12',
  rectangle: 'M3 3h10v10H3z',
  ellipse: 'M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z',
  line: 'M3 13L13 3',
  vector: 'M3 13C3 7 7 3 13 3M2 12h2v2H2zM12 2h2v2h-2z',
  text: 'M3.5 4V3h9v1M8 3v10M6.5 13h3',
  group: 'M2 4V2h2M12 2h2v2M14 12v2h-2M4 14H2v-2M5 5h4v4H5zM8 8h3v3H8z',
  page: 'M4 2h5l3 3v9H4zM9 2v3h3',
  image: 'M2.5 3h11v10h-11zM2.5 11l3.5-3.5 2.5 2.5 2-2 3 3M10.5 6a.8.8 0 100-1.6.8.8 0 000 1.6z',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 100-4 2 2 0 000 4z',
  eyeOff: 'M2 2l12 12M6.5 4a6 6 0 011.5-.2c4 0 6.5 4.2 6.5 4.2a11 11 0 01-2 2.4M4.2 5.5A11 11 0 001.5 8S4 12.5 8 12.5a6 6 0 002.2-.4',
  lock: 'M4 7h8v6.5H4zM5.5 7V5a2.5 2.5 0 015 0v2',
  unlock: 'M4 7h8v6.5H4zM5.5 7V5a2.5 2.5 0 014.8-1',
  plus: 'M8 3v10M3 8h10',
  minus: 'M3 8h10',
  x: 'M4 4l8 8M12 4l-8 8',
  menu: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
  more: 'M4 8h.01M8 8h.01M12 8h.01',
  back: 'M9.5 3.5L5 8l4.5 4.5',
  down: 'M4.5 6.5L8 10l3.5-3.5',
  right: 'M6.5 4.5L10 8l-3.5 3.5',
  alignLeft: 'M2.5 4h11M2.5 8h7M2.5 12h9',
  alignCenter: 'M2.5 4h11M4.5 8h7M3.5 12h9',
  alignRight: 'M2.5 4h11M6.5 8h7M4.5 12h9',
} as const
export type IconName = keyof typeof PATHS

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      <path d={PATHS[name]} />
    </svg>
  )
}
