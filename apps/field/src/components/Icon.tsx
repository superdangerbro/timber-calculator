const PATHS: Record<string, string> = {
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3m-4 0h8',
  tree: 'M12 2 5 11h4l-4 6h14l-4-6h4L12 2Zm0 15v5',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-6a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-14v4m0 12v4M2 12h4m12 0h4',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.3 7.3 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.3 7.3 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  ruler: 'M3 17 17 3l4 4L7 21l-4-4Zm4-4 2 2m1-5 2 2m1-5 2 2',
  check: 'm4 12 5 5L20 6',
  x: 'M6 6l12 12M18 6 6 18',
  speaker: 'M4 9v6h4l5 4V5L8 9H4Zm12.5-1.5a6 6 0 0 1 0 9m2.5-12a10 10 0 0 1 0 15',
  ear: 'M6 9a6 6 0 1 1 12 0c0 3-2 4-3 5.5S14 18 12 20a3 3 0 0 1-4-1',
  keyboard: 'M3 6h18v12H3V6Zm4 4h.01M11 10h.01M15 10h.01M7 14h10',
  sync: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4m-4 5a8 8 0 0 0 14.9 3M20 20v-4h-4',
  cloudOff: 'M3 3l18 18M8 8a5 5 0 0 0-1 9.9h10m3-2.4A4 4 0 0 0 17 9a6 6 0 0 0-6.6-4',
  gps: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  crosshair: 'M12 2v6m0 8v6M2 12h6m8 0h6',
  arrow: 'M12 3v18M12 3l-6 6M12 3l6 6',
  download: 'M12 3v12m0 0-5-5m5 5 5-5M4 19h16',
  upload: 'M12 21V9m0 0-5 5m5-5 5 5M4 5h16',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  locate: 'M12 2v3m0 14v3M2 12h3m14 0h3M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Z',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  share: 'M12 3v13m0-13-4 4m4-4 4 4M5 12v8h14v-8',
  send: 'M4 12 20 4l-6 16-3-7-7-1Z',
  chevronUp: 'm6 15 6-6 6 6',
  chevronDown: 'm6 9 6 6 6-6',
  alert: 'M12 3 2 20h20L12 3Zm0 6v5m0 3h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0',
};

export function Icon({ name, size = 24, stroke = 2.2 }: { name: keyof typeof PATHS | string; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
