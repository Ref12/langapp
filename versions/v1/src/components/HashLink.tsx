import type { ReactNode } from 'react'

export function HashLink({
  to,
  className,
  children,
  ariaLabel,
}: {
  to: string
  className?: string
  children: ReactNode
  ariaLabel?: string
}) {
  return (
    <a href={`#${to}`} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  )
}
