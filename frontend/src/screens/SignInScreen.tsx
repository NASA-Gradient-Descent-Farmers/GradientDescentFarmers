import { useState, type FormEvent } from 'react'
import { useAccount } from '../account/AccountContext.ts'
import { initialOf, MAX_NAME } from '../account/users.ts'
import { Brand } from '../components/Brand.tsx'
import { ChartIcon, SeedlingIcon } from '../components/icons.tsx'
import { TopBar } from '../components/TopBar.tsx'
import { BigChoice } from '../farmer/ui/BigChoice.tsx'
import { Disclosure } from '../farmer/ui/Disclosure.tsx'
import { useI18n } from '../i18n/index.tsx'
import type { Version } from '../lib/version.ts'

/**
 * The front page: "¡Hola! Bienvenido a YolIA." and a way in. Accounts are simulated (a name, no password): pick one of the
 * accounts on this phone, or create one and choose how it will use YolIA.
 */
export function SignInScreen() {
  const { t } = useI18n()
  const { accounts, signIn, signUp, remove } = useAccount()
  const [name, setName] = useState('')
  const [mode, setMode] = useState<Version>('agricultor')
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const reason = signUp(name, mode)
    setError(reason ? t(`account.create.errors.${reason}`) : null)
  }

  const form = (
    <form className="signin-form" onSubmit={submit} noValidate>
      <label className="field-label" htmlFor="account-name">
        {t('account.create.name')}
      </label>
      <input
        id="account-name"
        type="text"
        value={name}
        maxLength={MAX_NAME}
        autoComplete="off"
        enterKeyHint="go"
        placeholder={t('account.create.namePlaceholder')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'account-error' : undefined}
        onChange={(e) => {
          setName(e.target.value)
          setError(null)
        }}
      />
      {error && (
        <p id="account-error" className="callout is-error" role="alert">
          {error}
        </p>
      )}
      <BigChoice
        label={t('account.create.modeQuestion')}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'agricultor', label: t('account.modes.agricultor.name'), hint: t('account.modes.agricultor.hint'), icon: <SeedlingIcon /> },
          { value: 'tecnico', label: t('account.modes.tecnico.name'), hint: t('account.modes.tecnico.hint'), icon: <ChartIcon /> },
        ]}
      />
      <button type="submit" className="btn primary big block">
        {t('account.create.submit')}
      </button>
    </form>
  )

  return (
    <div className="calm">
      <TopBar />
      <main className="calm-main signin">
        <h1 className="statement">
          <strong>
            {t('welcome.hello')} <Brand />.
          </strong>{' '}
          {t('welcome.tagline')}
        </h1>

        {accounts.length > 0 && (
          <section className="signin-block" aria-labelledby="signin-title">
            <h2 id="signin-title">{t('account.signIn.title')}</h2>
            <p className="page-lede">{t('account.signIn.lede')}</p>
            <ul className="account-list">
              {accounts.map((account) => (
                <li key={account.id}>
                  {removing === account.id ? (
                    <div className="account-remove" role="alert">
                      <p>{t('account.signIn.removeAsk', { name: account.name })}</p>
                      <div className="row">
                        <button type="button" className="btn danger" onClick={() => remove(account.id)}>
                          {t('account.signIn.removeYes')}
                        </button>
                        <button type="button" className="btn secondary" onClick={() => setRemoving(null)}>
                          {t('account.signIn.removeNo')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="account-row">
                      <button type="button" className="account-pick" aria-label={t('account.signIn.as', { name: account.name })} onClick={() => signIn(account.id)}>
                        <span className="account-initial" aria-hidden="true">
                          {initialOf(account.name)}
                        </span>
                        <span className="account-pick-text">
                          <strong>{account.name}</strong>
                          <span>{t(`account.modes.${account.mode}.name`)}</span>
                        </span>
                        <span aria-hidden="true" className="account-go">
                          →
                        </span>
                      </button>
                      <button type="button" className="btn ghost" aria-label={`${t('account.signIn.remove')}: ${account.name}`} onClick={() => setRemoving(account.id)}>
                        {t('account.signIn.remove')}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="signin-block" aria-labelledby="create-title">
          {accounts.length > 0 ? (
            <Disclosure title={t('account.create.another')}>{form}</Disclosure>
          ) : (
            <>
              <h2 id="create-title">{t('account.create.title')}</h2>
              <p className="page-lede">{t('account.intro')}</p>
              {form}
            </>
          )}
        </section>

        <div className="calm-foot">
          <p>{t('account.simulated')}</p>
          <p>{t('welcome.foot')}</p>
        </div>
      </main>
    </div>
  )
}
