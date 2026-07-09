import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api, MediaType, Series, SeriesHardcoverDiff, SeriesHardcoverDiffBook, SeriesHardcoverLink, SeriesHardcoverSearchResult, SystemStatus } from '../api/client'
import AddSeriesBookModal from '../components/AddSeriesBookModal'
import HardcoverSeriesLinkModal from '../components/HardcoverSeriesLinkModal'
import SeriesDetailModal from '../components/SeriesDetailModal'
import { seriesGapStats } from '../components/seriesGaps'
import SeriesNameModal from '../components/SeriesNameModal'
import { ChevronRightIcon } from '../components/icons'

export default function SeriesPage() {
  const location = useLocation()
  const [seriesList, setSeriesList] = useState<Series[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [linking, setLinking] = useState<number | null>(null)
  const [linkResult, setLinkResult] = useState<Record<number, string>>({})
  const [linkModalSeries, setLinkModalSeries] = useState<Series | null>(null)
  const [linkModalResults, setLinkModalResults] = useState<SeriesHardcoverSearchResult[]>([])
  const [diffs, setDiffs] = useState<Record<number, SeriesHardcoverDiff>>({})
  const [diffLoading, setDiffLoading] = useState<Record<number, boolean>>({})
  const [diffErrors, setDiffErrors] = useState<Record<number, string>>({})
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [showAddSeries, setShowAddSeries] = useState(false)
  const [editingSeries, setEditingSeries] = useState<Series | null>(null)
  const [bookModalSeries, setBookModalSeries] = useState<Series | null>(null)
  const enhancedHardcoverApi = systemStatus?.enhancedHardcoverApi ?? false
  const activeSeries = activeId != null ? seriesList.find(series => series.id === activeId) ?? null : null

  useEffect(() => {
    const state = location.state as { seriesId?: number } | null
    Promise.all([api.listSeries(), api.status()])
      .then(([list, status]) => {
        setSeriesList(list)
        setSystemStatus(status)
        if (state?.seriesId) {
          setActiveId(state.seriesId)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [location.state])

  useEffect(() => {
    if (activeSeries) {
      void loadHardcoverDiff(activeSeries)
    }
  })

  useEffect(() => {
    document.title = 'Series · Bindery'
    return () => { document.title = 'Bindery' }
  }, [])

  const refreshSeriesList = async () => {
    const list = await api.listSeries()
    setSeriesList(list)
    return list
  }

  const handleCreateSeries = async (title: string) => {
    const series = await api.createSeries({ title })
    await refreshSeriesList()
    setActiveId(series.id)
    setShowAddSeries(false)
  }

  const handleRenameSeries = async (title: string) => {
    if (!editingSeries) return
    const updated = await api.updateSeries(editingSeries.id, { title })
    setSeriesList(prev => prev.map(series => series.id === updated.id ? { ...series, ...updated } : series))
    setEditingSeries(null)
  }

  const deleteSeries = async (series: Series) => {
    if (!confirm(`Delete "${series.title}" from Series? Linked books will stay in your library.`)) return
    await api.deleteSeries(series.id)
    setSeriesList(prev => prev.filter(item => item.id !== series.id))
    setDiffs(prev => {
      const next = { ...prev }
      delete next[series.id]
      return next
    })
    if (activeId === series.id) {
      setActiveId(null)
    }
  }

  const handleBookLinked = (updated: Series) => {
    setSeriesList(prev => prev.map(series => series.id === updated.id ? updated : series))
    setActiveId(updated.id)
    if (enhancedHardcoverApi && updated.hardcoverLink) {
      void loadHardcoverDiff(updated, true)
    }
  }

  const loadHardcoverDiff = async (series: Series, force = false) => {
    if (!enhancedHardcoverApi) return
    if (!series.hardcoverLink) return
    if (!force && (diffs[series.id] || diffLoading[series.id])) return
    setDiffLoading(prev => ({ ...prev, [series.id]: true }))
    setDiffErrors(prev => {
      const next = { ...prev }
      delete next[series.id]
      return next
    })
    try {
      const diff = await api.getSeriesHardcoverDiff(series.id)
      setDiffs(prev => ({ ...prev, [series.id]: diff }))
    } catch (err) {
      setDiffErrors(prev => ({ ...prev, [series.id]: err instanceof Error ? err.message : 'Failed to load Hardcover diff' }))
    } finally {
      setDiffLoading(prev => ({ ...prev, [series.id]: false }))
    }
  }

  const toggleMonitor = async (series: Series) => {
    const next = !series.monitored
    await api.monitorSeries(series.id, next)
    setSeriesList(prev => prev.map(s => s.id === series.id ? { ...s, monitored: next } : s))
  }

  const fillGaps = async (series: Series, book?: SeriesHardcoverDiffBook, mediaType?: MediaType): Promise<number> => {
    const r = book
      ? await api.fillSeries(series.id, {
          foreignBookId: book.foreignBookId,
          providerId: book.providerId,
          position: book.position,
          ...(mediaType ? { mediaType } : {}),
        })
      : await api.fillSeriesAll(series.id, mediaType)
    const list = await refreshSeriesList()
    const updated = list.find(s => s.id === series.id)
    if (enhancedHardcoverApi && updated?.hardcoverLink) {
      await loadHardcoverDiff(updated, true)
    }
    return r.queued
  }

  const openHardcoverLink = async (series: Series) => {
    if (!enhancedHardcoverApi) return
    setLinkResult(prev => {
      const next = { ...prev }
      delete next[series.id]
      return next
    })
    if (series.hardcoverLink) {
      setLinkModalResults([])
      setLinkModalSeries(series)
      return
    }

    setLinking(series.id)
    try {
      const response = await api.autoLinkSeriesHardcover(series.id)
      const modalSeries = response.link ? { ...series, hardcoverLink: response.link } : series
      setLinkModalResults(response.candidates ?? [])
      setLinkModalSeries(modalSeries)
      if (response.link) {
        const link = response.link
        setSeriesList(prev => prev.map(s => s.id === series.id ? { ...s, hardcoverLink: link } : s))
        await loadHardcoverDiff(modalSeries, true)
      } else if (response.reason) {
        const reason = response.reason
        setLinkResult(prev => ({ ...prev, [series.id]: reason }))
      }
    } catch (err) {
      setLinkResult(prev => ({ ...prev, [series.id]: err instanceof Error ? err.message : 'Failed to search Hardcover' }))
    } finally {
      setLinking(null)
    }
  }

  const handleHardcoverLinked = (seriesId: number, link?: SeriesHardcoverLink) => {
    setSeriesList(prev => prev.map(series => series.id === seriesId ? { ...series, hardcoverLink: link } : series))
    if (!link) {
      setDiffs(prev => {
        const next = { ...prev }
        delete next[seriesId]
        return next
      })
      return
    }
    const series = seriesList.find(item => item.id === seriesId)
    if (enhancedHardcoverApi && series) {
      void loadHardcoverDiff({ ...series, hardcoverLink: link }, true)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
        <h2 className="text-2xl font-bold">Series</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600 dark:text-zinc-500">{seriesList.length} series</span>
          <button
            onClick={() => setShowAddSeries(true)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-md text-sm font-medium transition-colors"
          >
            Add Series
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-600 dark:text-zinc-500">Loading...</div>
      ) : seriesList.length === 0 ? (
        <div className="text-center py-16 text-slate-600 dark:text-zinc-500">
          <p className="text-lg mb-2">No series found</p>
          <p className="text-sm">Series are populated automatically from your monitored authors' books</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {seriesList.map(series => {
            const bookCount = (series.books ?? []).length
            const { gapCount, hardcoverMissingCount } = seriesGapStats(series, diffs[series.id], enhancedHardcoverApi)
            const displayMissingCount = Math.max(gapCount, hardcoverMissingCount)

            return (
              <div
                key={series.id}
                className="border border-slate-200 dark:border-zinc-800 rounded-lg bg-slate-100 dark:bg-zinc-900 p-4 cursor-pointer hover:bg-slate-200/50 dark:hover:bg-zinc-800/50 transition-colors"
                onClick={() => setActiveId(series.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{series.title}</h3>
                    {series.description && (
                      <p className="text-xs text-slate-600 dark:text-zinc-500 mt-1 line-clamp-2">{series.description}</p>
                    )}
                  </div>
                  <ChevronRightIcon className="w-4 h-4 flex-shrink-0 mt-1 text-slate-500 dark:text-zinc-600" />
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-3">
                  <span className="text-xs text-slate-600 dark:text-zinc-500 bg-slate-200 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                    {bookCount} {bookCount === 1 ? 'book' : 'books'}
                  </span>
                  {displayMissingCount > 0 && (
                    <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                      {displayMissingCount} missing
                    </span>
                  )}
                  {series.monitored && (
                    <span className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                      Monitored
                    </span>
                  )}
                  {enhancedHardcoverApi && series.hardcoverLink && (
                    <span className="text-xs text-sky-700 dark:text-sky-300 bg-sky-500/10 px-2 py-0.5 rounded-full">
                      Hardcover
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {activeSeries && (
        <SeriesDetailModal
          series={activeSeries}
          enhancedHardcoverApi={enhancedHardcoverApi}
          diff={diffs[activeSeries.id]}
          diffLoading={diffLoading[activeSeries.id] ?? false}
          diffError={diffErrors[activeSeries.id]}
          linkResult={linkResult[activeSeries.id]}
          linking={linking === activeSeries.id}
          onClose={() => setActiveId(null)}
          onToggleMonitor={() => toggleMonitor(activeSeries)}
          onRename={() => setEditingSeries(activeSeries)}
          onDelete={() => deleteSeries(activeSeries)}
          onAddBook={() => setBookModalSeries(activeSeries)}
          onHardcoverSearch={() => openHardcoverLink(activeSeries)}
          onFillGaps={(book, mediaType) => fillGaps(activeSeries, book, mediaType)}
        />
      )}
      {showAddSeries && (
        <SeriesNameModal
          title="Add Series"
          submitLabel="Add Series"
          onClose={() => setShowAddSeries(false)}
          onSubmit={handleCreateSeries}
        />
      )}
      {editingSeries && (
        <SeriesNameModal
          title="Rename Series"
          initialName={editingSeries.title}
          submitLabel="Save"
          onClose={() => setEditingSeries(null)}
          onSubmit={handleRenameSeries}
        />
      )}
      {bookModalSeries && (
        <AddSeriesBookModal
          series={bookModalSeries}
          onClose={() => setBookModalSeries(null)}
          onLinked={handleBookLinked}
        />
      )}
      {enhancedHardcoverApi && linkModalSeries && (
        <HardcoverSeriesLinkModal
          series={linkModalSeries}
          initialResults={linkModalResults}
          onClose={() => setLinkModalSeries(null)}
          onLinked={handleHardcoverLinked}
        />
      )}
    </div>
  )
}
