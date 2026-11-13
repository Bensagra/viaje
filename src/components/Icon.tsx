import type { SVGProps } from 'react';

/** Íconos propios: un solo trazo (1.75 px, puntas redondas) sobre una grilla de 24, siempre del color del texto. */
const PATHS = {
  luggage:
    'M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M5 7h14a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a1 1 0 0 1 1-1zM9 11v6M15 11v6',
  plane: 'M21 15.5v-1.8l-8-5V3.6a1.3 1.3 0 0 0-2.6 0v5.1l-8 5v1.8l8-2.4v5.2l-2.2 1.6V21l3.5-1 3.5 1v-1.1L13 18.3v-5.2z',
  bed: 'M3 20v-8h18v8M3 16h18M5 12V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6M7 12V9h4v3M13 12V9h4v3',
  train:
    'M8 3h8a4 4 0 0 1 4 4v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a4 4 0 0 1 4-4zM4 11h16M8.5 15h.01M15.5 15h.01M7 21l2-3M17 21l-2-3',
  bus: 'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12H4zM4 11h16M7.5 15h.01M16.5 15h.01M6 17v3M18 17v3',
  car: 'M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11M3 11h18v6H3zM6 17v2M18 17v2M7 14h.01M17 14h.01',
  ticket:
    'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM14 6v2M14 11v2M14 16v2',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  camera:
    'M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  refresh: 'M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4',
  close: 'M6 6l12 12M18 6 6 18',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-down': 'M5 9l7 7 7-7',
  check: 'M5 12.5l4.5 4.5L19 7',
  alert: 'M12 3 2 20h20zM12 9v5M12 17h.01',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01',
  paperclip: 'M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L10.3 17.7a1.7 1.7 0 0 1-2.4-2.4L16 7.5',
  'arrow-right': 'M4 12h16M13 5l7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  upload: 'M12 21V9M7 14l5-5 5 5M4 4h16',
  external: 'M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3zM20 14v3M17 20h3M14 20h.01',
  wallet:
    'M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v2M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2M16 14.5h.01',
  receipt: 'M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21zM8.5 8h7M8.5 12h7M8.5 16h4',
  swap: 'M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  calendar: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 3v3M16 3v3',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9zM7.5 7.5h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
  pencil: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3',
  hourglass: 'M6 3h12M6 21h12M8 3v4l4 5 4-5V3M8 21v-4l4-5 4 5v4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users:
    'M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 21a7 7 0 0 1 14 0M16 5.3a3.5 3.5 0 0 1 0 6.4M17 14.5a7 7 0 0 1 5 6.5',
  coins: 'M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10h.01M18 14h.01',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  logout: 'M10 17l5-5-5-5M15 12H3M13 3h6a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-6',
  pin: 'M12 21s6-6.5 6-11a6 6 0 1 0-12 0c0 4.5 6 11 6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  filter: 'M4 6h16M7 12h10M10 18h4',
  image: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 16l5-5 4 4 3-3 4 4M16 9h.01',
  zoom: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M11 8v6M8 11h6',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  'arrow-left': 'M20 12H4M11 5l-7 7 7 7',
  'check-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.5 2.5L16 9.5',
  minus: 'M5 12h14',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  className,
  ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `icon ${className}` : 'icon'}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
