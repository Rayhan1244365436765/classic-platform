/** Tiny inline SVG icon set (no icon library dependency). */

type IconProps = {
  className?: string;
};

function base(className?: string) {
  return {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

export function HistoryIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3 4v4h4" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.6V21h13V9.6" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

export function GiftIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M4 11h16v9H4z" />
      <path d="M2 7h20v4H2z" />
      <path d="M12 7v13" />
      <path d="M12 7S10.5 3 8 3a2.5 2.5 0 0 0 0 4h4Z" />
      <path d="M12 7s1.5-4 4-4a2.5 2.5 0 0 1 0 4h-4Z" />
    </svg>
  );
}

export function UserIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function LogoutIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h10" />
    </svg>
  );
}

export function WalletIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H18a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M16 12.5h3" />
    </svg>
  );
}

export function ArrowDownIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 4v13" />
      <path d="M6.5 11.5 12 17l5.5-5.5" />
      <path d="M4 21h16" />
    </svg>
  );
}

export function ArrowUpIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 20V7" />
      <path d="M6.5 12.5 12 7l5.5 5.5" />
      <path d="M4 3h16" />
    </svg>
  );
}

export function ArrowLeftIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M20 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

export function SlotIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M9 5v14" />
      <path d="M15 5v14" />
      <path d="M5.6 12h1.4" />
      <path d="M10.8 12h1.4" />
      <path d="M16 12h1.4" />
    </svg>
  );
}

export function LiveIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 8.8V7" />
      <path d="M12 17v-1.8" />
      <path d="M8.8 12H7" />
      <path d="M17 12h-1.8" />
    </svg>
  );
}

export function SportsIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.4l3.6 2.6-1.4 4.2h-4.4L8.4 10z" />
      <path d="M12 3.5v3.9" />
      <path d="M20.3 10.4l-4.7-.4" />
      <path d="M18 19l-3.4-4.8" />
      <path d="M6 19l3.4-4.8" />
      <path d="M3.7 10.4l4.7-.4" />
    </svg>
  );
}

export function HeadsetIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <rect x="2.5" y="13" width="4.5" height="6.5" rx="2" />
      <rect x="17" y="13" width="4.5" height="6.5" rx="2" />
      <path d="M19 19.5v.5a2 2 0 0 1-2 2h-3" />
    </svg>
  );
}

