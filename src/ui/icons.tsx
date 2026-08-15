// Inline 16px icons on a 24 grid. Inline rather than a font or a sprite so a
// reader of the bundle can see every asset the page loads (nothing external —
// see docs/webapp-threat-model.md), and so they inherit currentColor.
import React from "react";

const Svg: React.FC<{ children: React.ReactNode; size?: number }> = ({
  children,
  size = 16,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconWallet: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M3 8a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <path d="M3 8V7a2 2 0 0 1 2-2h11" />
    <circle cx="16.5" cy="12.5" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconCards: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <rect x="3" y="5" width="11" height="15" rx="2" />
    <path d="M17 7.2 20.4 8a2 2 0 0 1 1.4 2.5l-2.4 8.2" />
    <path d="M8.5 12.5 6.7 10.6a1.6 1.6 0 1 1 2.3-2.2l.4.4.4-.4a1.6 1.6 0 1 1 2.3 2.2Z" />
  </Svg>
);

export const IconActivity: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M3 12h4l2.5 6 5-14 2.5 8H21" />
  </Svg>
);

export const IconSettings: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.56-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.04Z" />
  </Svg>
);

export const IconSend: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M7 17 17 7" />
    <path d="M8 7h9v9" />
  </Svg>
);

export const IconReceive: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M17 7 7 17" />
    <path d="M16 17H7V8" />
  </Svg>
);

export const IconCopy: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </Svg>
);

export const IconCheck: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="m4 12.5 5 5L20 6.5" />
  </Svg>
);

export const IconPlus: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconAlert: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M12 3.6 1.8 20.4h20.4Z" />
    <path d="M12 9.5v4.2" />
    <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconRefresh: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M20 11.5A8 8 0 0 0 6.3 6.3L4 8.5" />
    <path d="M4 4v4.5h4.5" />
    <path d="M4 12.5A8 8 0 0 0 17.7 17.7L20 15.5" />
    <path d="M20 20v-4.5h-4.5" />
  </Svg>
);
