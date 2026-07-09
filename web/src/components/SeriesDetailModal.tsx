import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MediaType, Series, SeriesHardcoverDiff, SeriesHardcoverDiffBook } from '../api/client'
import { bookStatusBadge } from './bookStatus'
import { btn, btnSize } from './buttons'
import Switch from './Switch'

export function seriesGapStats(series: Series, diff: SeriesHardcoverDiff | undefined, enhanced: boolean) {
  const books = series.books ?? []
  const gapCount = books.filter(b => b.book && b.book.status !== 'imported').length
  const hardcoverMissingEstimate = enhanced ? Math.max(0, (series.hardcoverLink?.hardcoverBookCount ?? 0) - books.length) : 0
  const hardcoverMissingCount = enhanced ? (diff?.missingCount ?? hardcoverMissingEstimate) : 0
  return { gapCount, hardcoverMissingCount }
}

interface Props {
  series: Series
  enhancedHardcoverApi: boolean
  diff?: SeriesHardcoverDiff
  diffLoading: boolean
  diffError?: string
  linkResult?: string
  linking: boolean
  onClose: () => void
  onToggleMonitor: () => void
  onRename: () => void
  onDelete: () => void
  onAddBook: () => void
  onHardcoverSearch: () => void
  onFillGaps: (book?: SeriesHardcoverDiffBook, mediaType?: MediaType) => Promise<number>
}

export default function SeriesDetailModal({
  series, enhancedHardcoverApi, diff, diffLoading, diffError, linkResult, linking,
  onClose, onToggleMonitor, onRename, onDelete, onAddBook, onHardcoverSearch, onFillGaps,
}: Props) {
  const { t } = useTranslation()
  const [fillMediaType, setFillMediaType] = useState<MediaType>('ebook')
  const [filling, setFilling] = useState(false)
  const [fillResult, setFillResult] = useState<string | null>(null)

  const { gapCount, hardcoverMissingCount } = seriesGapStats(series, diff, enhancedHardcoverApi)
  const fillNeeded = gapCount > 0 || hardcoverMissingCount > 0
  const books = series.books ?? []
  const sortedBooks = [...books].sort((a, b) => {
    const posA = parseFloat(a.positionInSeries) || 0
    const posB = parseFloat(b.positionInSeries) || 0
    return posA - posB
  })

  const runFill = async (book?: SeriesHardcoverDiffBook, mediaType?: MediaType) => {
    setFilling(true)
    try {
      const queued = await onFillGaps(book, mediaType)
      setFillResult(queued === 0 ? 'Nothing to fill' : `${queued} book${queued === 1 ? '' : 's'} queued`)
    } catch {
      setFillResult('Failed')
    } finally {
      setFilling(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={series.title}
        className="bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-200 dark:border-zinc-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold truncate">{series.title}</h3>
            {series.description && (
              <p className="text-xs text-slate-600 dark:text-zinc-500 mt-1 line-clamp-2">{series.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 px-2 py-1 rounded text-slate-500 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 flex items-center gap-3 flex-wrap border-b border-slate-200 dark:border-zinc-800">
          <Switch
            checked={series.monitored}
            onChange={onToggleMonitor}
            label={series.monitored ? 'Stop monitoring' : 'Monitor series'}
          >
            {series.monitored ? 'Monitored' : 'Not monitored'}
          </Switch>
          {enhancedHardcoverApi && (
            <button
              onClick={onHardcoverSearch}
              disabled={linking}
              className={`text-xs px-2.5 py-1 rounded font-medium border disabled:opacity-50 ${
                series.hardcoverLink
                  ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              }`}
              title={series.hardcoverLink ? `Linked to ${series.hardcoverLink.hardcoverTitle}` : 'Search Hardcover series'}
            >
              {linking ? 'Searching...' : series.hardcoverLink ? `${series.hardcoverLink.linkedBy === 'auto' ? 'Auto' : 'Manual'} link` : 'Search'}
            </button>
          )}
          <button onClick={onRename} className={`${btn.secondary} ${btnSize.sm}`}>
            Rename
          </button>
          <button onClick={onAddBook} className={`${btn.secondary} ${btnSize.sm}`}>
            Add Book
          </button>
          <button onClick={onDelete} className={`${btn.danger} ${btnSize.sm}`}>
            Delete
          </button>
          {fillNeeded && (
            <button
              onClick={() => runFill()}
              disabled={filling}
              className={`ml-auto ${btn.primary} ${btnSize.sm}`}
            >
              {filling ? 'Queuing…' : 'Fill gaps'}
            </button>
          )}
          {fillResult && (
            <span className="ml-auto text-xs text-emerald-600 dark:text-emerald-400">{fillResult}</span>
          )}
          {!fillResult && linkResult && (
            <span className="ml-auto text-xs text-slate-600 dark:text-zinc-400">{linkResult}</span>
          )}
        </div>

        <div className="overflow-y-auto">
          {books.length > 0 ? (
            <div className="divide-y divide-slate-200/50 dark:divide-zinc-800/50">
              {sortedBooks.map(entry => {
                const badge = entry.book ? bookStatusBadge(entry.book.status, entry.book.monitored, t) : null
                return (
                  <Link
                    key={entry.bookId}
                    to={`/book/${entry.bookId}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-slate-200/50 dark:hover:bg-zinc-800/50 transition-colors"
                  >
                    <span className="text-xs text-slate-600 dark:text-zinc-500 w-10 flex-shrink-0 font-mono">
                      #{entry.positionInSeries || '?'}
                    </span>
                    {entry.book?.imageUrl ? (
                      <img
                        src={entry.book.imageUrl}
                        alt={entry.book.title}
                        className="w-8 h-10 object-cover rounded flex-shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-10 bg-slate-200 dark:bg-zinc-800 rounded flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {entry.book?.title ?? `Book ${entry.bookId}`}
                      </p>
                      {entry.book?.releaseDate && (
                        <p className="text-xs text-slate-600 dark:text-zinc-500">
                          {new Date(entry.book.releaseDate).getFullYear()}
                        </p>
                      )}
                    </div>
                    {badge && (
                      <span className={`ml-auto text-xs px-2 py-0.5 rounded flex-shrink-0 ${badge.colorClass}`}>
                        {badge.label}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="px-4 py-3 text-sm text-slate-600 dark:text-zinc-500">
              No books in this series yet
            </div>
          )}

          {enhancedHardcoverApi && series.hardcoverLink && (
            <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-100/80 dark:bg-zinc-900/80">
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">Hardcover: {series.hardcoverLink.hardcoverTitle}</p>
                  <p className="text-xs text-slate-600 dark:text-zinc-500">
                    {diff ? `${diff.presentCount} matched · ${diff.missingCount} missing` : 'Checking Hardcover catalog...'}
                  </p>
                </div>
                {(diff?.missingCount ?? 0) > 0 && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <select
                      aria-label="Format to add"
                      value={fillMediaType}
                      onChange={e => setFillMediaType(e.target.value as MediaType)}
                      disabled={filling}
                      className="text-xs bg-slate-200 dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded px-2 py-1 focus:outline-none focus:border-slate-400 dark:focus:border-zinc-600 disabled:opacity-50"
                      title="Choose which format to add"
                    >
                      <option value="ebook">Ebook</option>
                      <option value="audiobook">Audiobook</option>
                      <option value="both">Both</option>
                    </select>
                    <button
                      onClick={() => runFill(undefined, fillMediaType)}
                      disabled={filling}
                      className={`${btn.primary} ${btnSize.sm}`}
                    >
                      {filling ? 'Queuing...' : 'Add all'}
                    </button>
                  </div>
                )}
              </div>
              {diffLoading && (
                <div className="px-4 pb-3 text-sm text-slate-600 dark:text-zinc-500">Loading Hardcover books...</div>
              )}
              {diffError && (
                <div className="px-4 pb-3 text-sm text-rose-600 dark:text-rose-400">{diffError}</div>
              )}
              {diff && diff.missing.length > 0 && (
                <div className="px-4 pb-4 space-y-2">
                  {diff.missing.slice(0, 8).map(book => {
                    const rowClass = 'flex items-center gap-3 p-3 rounded-md bg-slate-200/50 dark:bg-zinc-800/50'
                    const rowInner = (
                      <>
                        <span className="text-xs text-slate-600 dark:text-zinc-500 w-10 flex-shrink-0 font-mono">
                          #{book.position || '?'}
                        </span>
                        {book.imageUrl ? (
                          <img src={book.imageUrl} alt={book.title} className="w-8 h-10 object-cover rounded flex-shrink-0" />
                        ) : (
                          <div className="w-8 h-10 bg-slate-200 dark:bg-zinc-800 rounded flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{book.title}</p>
                          {book.authorName && <p className="text-xs text-slate-600 dark:text-zinc-500 truncate">{book.authorName}</p>}
                        </div>
                      </>
                    )
                    if (book.localBookId != null) {
                      return (
                        <Link
                          key={`${book.foreignBookId}-${book.position}`}
                          to={`/book/${book.localBookId}`}
                          className={`${rowClass} hover:bg-slate-300/50 dark:hover:bg-zinc-700/50 transition-colors`}
                        >
                          {rowInner}
                        </Link>
                      )
                    }
                    return (
                      <div key={`${book.foreignBookId}-${book.position}`} className={rowClass}>
                        {rowInner}
                        <button
                          onClick={() => runFill(book, fillMediaType)}
                          disabled={filling}
                          className={`ml-auto flex-shrink-0 ${btn.primary} ${btnSize.sm}`}
                          title="Add this missing Hardcover book and search indexers"
                        >
                          {filling ? '...' : 'Add'}
                        </button>
                      </div>
                    )
                  })}
                  {diff.missing.length > 8 && (
                    <p className="text-xs text-slate-600 dark:text-zinc-500 px-1">{diff.missing.length - 8} more missing books</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
