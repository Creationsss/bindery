import { useTranslation } from 'react-i18next'

// Shared <option> set for the ebook / audiobook / both media-type dropdowns.
// Render as the children of a <select> so each call site keeps its own value,
// onChange, and styling but the option values and labels stay consistent. Use
// only for selects that offer all three formats — the manual-import format
// picker deliberately omits "both".
export default function MediaTypeOptions() {
  const { t } = useTranslation()
  return (
    <>
      <option value="ebook">{t('common.ebook')}</option>
      <option value="audiobook">{t('common.audiobook')}</option>
      <option value="both">{t('common.both')}</option>
    </>
  )
}
