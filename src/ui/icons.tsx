import type { ComponentChildren } from 'preact'

function Icon({ size = 16, children }: { size?: number; children: ComponentChildren }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

type IconProps = { size?: number }

export const MenuIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </Icon>
)

export const MicIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M12 19v3" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <rect x="9" y="2" width="6" height="13" rx="3" />
  </Icon>
)

export const PenIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M13 21h8" />
    <path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7.4 18.6a2 2 0 0 1-.9.5l-2.9.9a.5.5 0 0 1-.6-.6l.9-2.9a2 2 0 0 1 .5-.9z" />
  </Icon>
)

export const AgentIcon = ({ size }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 180 180" fill="none" stroke="currentColor" stroke-width="15" stroke-linecap="round" aria-hidden="true">
    <path d="M18 84.85 85.88 16.97c9.37-9.37 24.57-9.37 33.94 0 9.37 9.37 9.37 24.57 0 33.94L68.56 102.18" />
    <path d="M69.27 101.47l50.55-50.56c9.37-9.37 24.57-9.37 33.94 0l.36.36c9.37 9.37 9.37 24.57 0 33.94L92.72 146.6a8 8 0 0 0 0 11.31l12.61 12.61" />
    <path d="M102.85 33.94 52.65 84.15c-9.37 9.37-9.37 24.56 0 33.94 9.37 9.37 24.57 9.37 33.94 0l50.2-50.21" />
  </svg>
)
export const CheckIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
)

export const CloseIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
)

export const ChevronLeftIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="m15 18-6-6 6-6" />
  </Icon>
)

export const ChevronRightIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
)

export const ChevronDownIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

export const MoreIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="2.5" />
  </Icon>
)

export const AlertIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4.5M12 16h.01" />
  </Icon>
)

export const ReloadIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" />
    <path d="M21 3v5h-5" />
  </Icon>
)

export const ArrowUpRightIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Icon>
)

export const GripIcon = ({ size = 16 }: IconProps) => (
  <Icon size={size}>
    <path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" stroke-width="2.25" />
  </Icon>
)
