import { Series, SeriesHardcoverDiff } from '../api/client'

// seriesGapStats derives how many books a series is short: gapCount is books
// already tracked but not yet imported, hardcoverMissingCount is books present
// in the linked Hardcover series but absent locally (from the live diff when
// loaded, otherwise estimated from the Hardcover book count). Shared so the
// card badge and the detail modal's "Fill gaps" affordance never disagree.
export function seriesGapStats(series: Series, diff: SeriesHardcoverDiff | undefined, enhanced: boolean) {
  const books = series.books ?? []
  const gapCount = books.filter(b => b.book && b.book.status !== 'imported').length
  const hardcoverMissingEstimate = enhanced ? Math.max(0, (series.hardcoverLink?.hardcoverBookCount ?? 0) - books.length) : 0
  const hardcoverMissingCount = enhanced ? (diff?.missingCount ?? hardcoverMissingEstimate) : 0
  return { gapCount, hardcoverMissingCount }
}
