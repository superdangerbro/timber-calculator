export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#1b4332" stroke="#2b5c45" />
      <path d="M16 4l7 10h-4l6 8h-6.5v6h-5v-6H7l6-8H9z" fill="#ff6b1a" />
    </svg>
  );
}

export function Brand({ sub = 'Cruise office' }: { sub?: string }) {
  return (
    <a href="/" className="brand">
      <LogoMark />
      <span>Timber Calculator<small>{sub}</small></span>
    </a>
  );
}
