import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/index.tsx'
import type { Version } from '../lib/version.ts'
import { useAccount } from './AccountContext.ts'
import { initialOf } from './users.ts'

/** The signed-in person in the top bar: a badge with their initial, and a small menu to switch mode or sign out. */
export function AccountMenu() {
  const { t } = useI18n()
  const { user, setMode, signOut } = useAccount()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  if (!user) return null
  const other: Version = user.mode === 'agricultor' ? 'tecnico' : 'agricultor'

  return (
    <div className="account" ref={root}>
      <button
        ref={button}
        type="button"
        className="account-button"
        aria-expanded={open}
        aria-controls="account-panel"
        aria-label={`${t('account.menu.label')}: ${user.name}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-initial" aria-hidden="true">
          {initialOf(user.name)}
        </span>
        <span className="account-name">{user.name}</span>
      </button>
      {open && (
        <div id="account-panel" className="account-panel" role="group" aria-label={t('account.menu.label')}>
          <p className="account-who">
            <strong>{user.name}</strong>
            <span>{t(`account.modes.${user.mode}.name`)}</span>
          </p>
          <button
            type="button"
            className="account-item"
            onClick={() => {
              setOpen(false)
              setMode(other)
            }}
          >
            {t(`account.menu.switchTo.${other}`)}
          </button>
          <button type="button" className="account-item" onClick={signOut}>
            {t('account.menu.signOut')}
          </button>
          <p className="account-note">{t('account.simulated')}</p>
        </div>
      )}
    </div>
  )
}
