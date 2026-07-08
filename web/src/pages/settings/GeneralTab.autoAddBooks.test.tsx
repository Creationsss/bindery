import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import GeneralTab from './GeneralTab'
import { api } from '../../api/client'

vi.mock('../../components/ThemeToggle', () => ({ default: () => <button type="button">Theme</button> }))
vi.mock('../../components/LanguageSwitcher', () => ({ default: () => <select aria-label="Language" /> }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    status: { authenticated: true, username: 'admin', role: 'admin', mode: 'enabled', setupRequired: false },
    loading: false,
    isAdmin: true,
    refresh: vi.fn(),
    logout: vi.fn(),
  }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { changeLanguage: vi.fn() },
  }),
}))
vi.mock('../../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listSettings: vi.fn(),
      libraryScanStatus: vi.fn(),
      getStorage: vi.fn(),
      authConfig: vi.fn(),
      setSetting: vi.fn(),
    },
  }
})

beforeEach(() => {
  vi.mocked(api.listSettings).mockResolvedValue([])
  vi.mocked(api.libraryScanStatus).mockRejectedValue(new Error('no scan'))
  vi.mocked(api.getStorage).mockRejectedValue(new Error('no storage'))
  vi.mocked(api.authConfig).mockRejectedValue(new Error('no auth cfg'))
  vi.mocked(api.setSetting).mockResolvedValue(undefined)
})

function autoAddCheckbox() {
  return screen.getByRole('checkbox', { name: /auto-add books for unmatched downloads/i })
}

describe('GeneralTab auto-add books toggle', () => {
  it('reflects a stored "false" value as unchecked', async () => {
    vi.mocked(api.listSettings).mockResolvedValue([{ key: 'import.auto_add_books', value: 'false' }])
    render(<GeneralTab />)
    await waitFor(() => expect(autoAddCheckbox()).not.toBeChecked())
  })

  it('defaults to enabled when unset and persists "false" when toggled off', async () => {
    render(<GeneralTab />)
    await waitFor(() => expect(autoAddCheckbox()).toBeChecked())
    fireEvent.click(autoAddCheckbox())
    await waitFor(() =>
      expect(api.setSetting).toHaveBeenCalledWith('import.auto_add_books', 'false'),
    )
    expect(autoAddCheckbox()).not.toBeChecked()
  })
})
