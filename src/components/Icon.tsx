interface IconProps {
  name: 'search' | 'users' | 'menu' | 'back' | 'plus' | 'send' | 'gear' | 'brain' | 'close' | 'pin' | 'copy';
  size?: number;
}

/** 단색 라인 아이콘(외부 이미지·아이콘 폰트 의존 없음). */
export function Icon({ name, size = 20 }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16 L20.5 20.5" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="9.5" r="3.4" />
          <path d="M2.8 19c.7-3.2 3.2-4.8 6.2-4.8s5.5 1.6 6.2 4.8" />
          <path d="M16 6.6a3.1 3.1 0 0 1 0 6" />
          <path d="M17.6 14.6c2.1.5 3.4 1.9 3.9 4.4" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...common}>
          <circle cx="12" cy="5.5" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="12" cy="18.5" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'back':
      return (
        <svg {...common} strokeWidth={2.2}>
          <path d="M15 4.5 L7.5 12 L15 19.5" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <path d="M6 6 L18 18 M18 6 L6 18" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5 L12 19 M5 12 L19 12" />
        </svg>
      );
    case 'send':
      return (
        <svg {...common} strokeWidth={2.4}>
          <path d="M12 19 L12 5 M6 11 L12 5 L18 11" />
        </svg>
      );
    case 'gear':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.1" />
          <path d="M12 3.2v2.1M12 18.7v2.1M3.2 12h2.1M18.7 12h2.1M5.8 5.8l1.5 1.5M16.7 16.7l1.5 1.5M18.2 5.8l-1.5 1.5M7.3 16.7l-1.5 1.5" />
        </svg>
      );
    case 'brain':
      return (
        <svg {...common}>
          <path d="M9.5 4.5a2.8 2.8 0 0 0-2.8 2.8c-1.4.3-2.4 1.6-2.4 3.1 0 1 .4 1.8 1.1 2.4-.3.5-.5 1.1-.5 1.7a3 3 0 0 0 3 3c.4 1.2 1.5 2 2.9 2V4.5z" />
          <path d="M14.5 4.5a2.8 2.8 0 0 1 2.8 2.8c1.4.3 2.4 1.6 2.4 3.1 0 1-.4 1.8-1.1 2.4.3.5.5 1.1.5 1.7a3 3 0 0 1-3 3c-.4 1.2-1.5 2-2.9 2V4.5z" />
        </svg>
      );
    case 'pin':
      return (
        <svg {...common}>
          <path d="M9 4h6l-1 6 3 3v2h-5v5l-1 1-1-1v-5H5v-2l3-3z" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...common}>
          <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
          <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
        </svg>
      );
    default:
      return null;
  }
}
