interface IconProps {
  className?: string
}

function ChevronIcon({ paths, className }: { paths: string[]; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? 'w-3.5 h-3.5'}
    >
      {paths.map(d => <path key={d} d={d} />)}
    </svg>
  )
}

export function ChevronUpIcon({ className }: IconProps) {
  return <ChevronIcon paths={['m6 12 4-4 4 4']} className={className} />
}

export function ChevronDownIcon({ className }: IconProps) {
  return <ChevronIcon paths={['m6 8 4 4 4-4']} className={className} />
}

export function ChevronLeftIcon({ className }: IconProps) {
  return <ChevronIcon paths={['m12 6-4 4 4 4']} className={className} />
}

export function ChevronRightIcon({ className }: IconProps) {
  return <ChevronIcon paths={['m8 6 4 4-4 4']} className={className} />
}

export function ChevronsLeftIcon({ className }: IconProps) {
  return <ChevronIcon paths={['m11 6-4 4 4 4', 'm15 6-4 4 4 4']} className={className} />
}

export function ChevronsRightIcon({ className }: IconProps) {
  return <ChevronIcon paths={['m5 6 4 4-4 4', 'm9 6 4 4-4 4']} className={className} />
}
