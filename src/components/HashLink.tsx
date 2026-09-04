import type { ReactNode } from 'react'

export function HashLink({
  to,
  className,
  children,
}: {
  to: string
  className?: string
  children: ReactNode
}) {
  return (
    <a href={`#${to}`} className={className}>
      {children}
    </a>
  )
}
