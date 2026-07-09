import { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from 'react'

type ToastType = 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
}

// A no-op fallback so components can call useToast() outside a ToastProvider
// (e.g. in isolated unit tests that render a page directly) without crashing —
// toasts simply don't appear there.
const noopToast: ToastApi = { success: () => {}, error: () => {} }

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? noopToast
}

const typeStyles: Record<ToastType, string> = {
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const push = useCallback((message: string, type: ToastType) => {
    const id = nextId.current++
    setToasts(prev => [...prev, { id, message, type }])
    // Errors linger longer since they usually need reading/acting on.
    window.setTimeout(() => remove(id), type === 'error' ? 6000 : 3500)
  }, [remove])

  const api = useMemo<ToastApi>(() => ({
    success: message => push(message, 'success'),
    error: message => push(message, 'error'),
  }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2 items-end pointer-events-none"
        aria-live="polite"
      >
        {toasts.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => remove(t.id)}
            role={t.type === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto max-w-sm text-left px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium animate-fade-in ${typeStyles[t.type]}`}
            title="Dismiss"
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
