import type { MediaType } from '../api/client'

export default function MediaBadge({ type }: { type?: MediaType }) {
  const audiobook = type === 'audiobook'
  const label = audiobook ? 'Audiobook' : 'Ebook'
  const cls = audiobook
    ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  )
}
