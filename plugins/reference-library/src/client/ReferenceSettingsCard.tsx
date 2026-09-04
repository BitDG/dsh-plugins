import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PinterestBridgeStatus } from '../online/pinterest-bridge.ts'
import type { ReferenceLibrarySettings } from '../settings-contract.ts'
import type { ReferenceLibraryKey } from './locales.ts'
import { settingsCss as css } from './settings-styles.ts'

type SettingKey =
  | 'libraryRoot' | 'pinterestDefaultQuery' | 'pinterestResultLimit'
  | 'zlibraryDefaultQuery' | 'zlibraryDomain' | 'zlibraryResultLimit'

const FIELDS: readonly SettingKey[] = [
  'libraryRoot', 'pinterestDefaultQuery', 'pinterestResultLimit',
  'zlibraryDefaultQuery', 'zlibraryDomain', 'zlibraryResultLimit',
]

const NUMBER_FIELDS = new Set<SettingKey>(['pinterestResultLimit', 'zlibraryResultLimit'])

export interface ReferenceSettingsCardInjected {
  readonly settingsScope: SettingsScope<ReferenceLibrarySettings>
  readonly pinterestOpenUrl: string
  readonly loadPinterestBridgeStatus: () => Promise<PinterestBridgeStatus>
}

type Props = PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'dship.reference-library'>
  & ReferenceSettingsCardInjected

interface FieldProps {
  readonly field: SettingKey
  readonly label: ReferenceLibraryKey
  readonly hint?: ReferenceLibraryKey
  readonly draft: Record<SettingKey, string>
  readonly invalid: ReadonlySet<SettingKey>
  readonly overridden: boolean
  readonly disabled: boolean
  readonly t: Props['t']
  readonly edit: (field: SettingKey, value: string) => void
  readonly reset: (field: SettingKey) => void
}

function valueRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function fieldText(value: unknown): string { return typeof value === 'string' || typeof value === 'number' ? String(value) : '' }

function seed(value: ReferenceLibrarySettings | undefined): Record<SettingKey, string> {
  const record = valueRecord(value)
  return Object.fromEntries(FIELDS.map(field => [field, fieldText(record[field])])) as Record<SettingKey, string>
}

function validDomain(value: string): boolean {
  if (value === '') return true
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`)
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''
      && parsed.port === '' && parsed.pathname === '/' && parsed.search === '' && parsed.hash === ''
  } catch { return false }
}

function invalidFields(draft: Record<SettingKey, string>): ReadonlySet<SettingKey> {
  const invalid = new Set<SettingKey>()
  const pinterestLimit = Number(draft.pinterestResultLimit)
  const bookLimit = Number(draft.zlibraryResultLimit)
  if (draft.pinterestDefaultQuery.trim() !== '' && draft.pinterestDefaultQuery.trim().length < 2) invalid.add('pinterestDefaultQuery')
  if (draft.pinterestResultLimit.trim() !== '' && (!Number.isInteger(pinterestLimit) || pinterestLimit < 30 || pinterestLimit > 50)) invalid.add('pinterestResultLimit')
  if (draft.zlibraryDefaultQuery.trim() !== '' && draft.zlibraryDefaultQuery.trim().length < 2) invalid.add('zlibraryDefaultQuery')
  if (!validDomain(draft.zlibraryDomain.trim())) invalid.add('zlibraryDomain')
  if (draft.zlibraryResultLimit.trim() !== '' && (!Number.isInteger(bookLimit) || bookLimit < 1 || bookLimit > 20)) invalid.add('zlibraryResultLimit')
  return invalid
}

function SettingField(props: FieldProps) {
  const bad = props.invalid.has(props.field)
  return (
    <div className={css.field}>
      <div className={css.fieldHead}>
        <label className={css.label} htmlFor={`reference-settings-${props.field}`}>{props.t(props.label)}</label>
        {props.overridden && (
          <span className={css.badges}>
            <span className={css.badge}>{props.t('settings.overridden')}</span>
            <button type="button" className={css.reset} disabled={props.disabled} onClick={() => { props.reset(props.field) }}>{props.t('settings.reset')}</button>
          </span>
        )}
      </div>
      <input
        id={`reference-settings-${props.field}`}
        className={clsx(css.input, bad && css.invalidInput)}
        type="text"
        inputMode={NUMBER_FIELDS.has(props.field) ? 'numeric' : undefined}
        aria-invalid={bad || undefined}
        value={props.draft[props.field]}
        disabled={props.disabled}
        onChange={(event) => { props.edit(props.field, event.target.value) }}
      />
      {props.hint !== undefined && <p className={css.hint}>{props.t(props.hint)}</p>}
    </div>
  )
}

export function ReferenceSettingsCard(props: Props) {
  const snapshot = useSyncExternalStore(
    listener => props.settingsScope.subscribe(listener),
    () => props.settingsScope.getSnapshot(),
  )
  const initial = useMemo(() => seed(snapshot.value), [snapshot.value])
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Record<SettingKey, string>>(initial)
  const [cleared, setCleared] = useState<ReadonlySet<SettingKey>>(new Set())
  const [bridge, setBridge] = useState<PinterestBridgeStatus>({ state: 'waiting', extensionPath: '' })
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const dirty = cleared.size > 0 || FIELDS.some(field => draft[field] !== initial[field])
  const invalid = invalidFields(draft)
  const user = valueRecord(snapshot.user)
  const base = valueRecord(snapshot.base)

  useEffect(() => {
    if (dirty || saving) return
    setDraft(initial)
    setCleared(new Set())
  }, [dirty, initial, saving])

  useEffect(() => {
    let active = true
    const refresh = (): void => { void props.loadPinterestBridgeStatus().then(value => { if (active) setBridge(value) }, () => undefined) }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { active = false; window.removeEventListener('focus', refresh) }
  }, [props.loadPinterestBridgeStatus])

  if (snapshot.status === 'unavailable') return null

  const edit = (field: SettingKey, value: string): void => {
    setFailed(false)
    setCleared(previous => new Set([...previous].filter(item => item !== field)))
    setDraft(previous => ({ ...previous, [field]: value }))
  }
  const reset = (field: SettingKey): void => {
    const fallback = fieldText(base[field] ?? snapshot.value?.[field])
    setDraft(previous => ({ ...previous, [field]: fallback }))
    setCleared(previous => new Set([...previous, field]))
    setFailed(false)
  }
  const discard = (): void => { setDraft(initial); setCleared(new Set()); setFailed(false) }
  const save = (): void => {
    if (!dirty || invalid.size > 0 || saving) return
    setSaving(true)
    setFailed(false)
    const operations: SettingsPathOpView[] = []
    for (const field of FIELDS) {
      if (!cleared.has(field) && draft[field] === initial[field]) continue
      const text = draft[field].trim()
      if (cleared.has(field) || text === '') operations.push({ op: 'unset', path: [field] })
      else operations.push({ op: 'set', path: [field], value: NUMBER_FIELDS.has(field) ? Number(text) : text })
    }
    void props.settingsScope.mutate(operations, snapshot.revision)
      .then(() => { setCleared(new Set()) })
      .catch(() => { setFailed(true) })
      .finally(() => { setSaving(false) })
  }

  const fieldProps = (field: SettingKey, label: ReferenceLibraryKey, hint?: ReferenceLibraryKey): FieldProps => ({
    field, label, hint, draft, invalid, overridden: Object.hasOwn(user, field) && !cleared.has(field),
    disabled: !snapshot.writable || saving, t: props.t, edit, reset,
  })

  return (
    <li className={clsx(css.card, open && css.open)} data-reference-library-settings="">
      <button type="button" className={css.header} aria-expanded={open} aria-label={props.t(open ? 'settings.collapse' : 'settings.expand')} onClick={() => { setOpen(value => !value) }}>
        <span className={css.headCopy}>
          <span className={css.title}>{props.t('settings.title')}</span>
          <span className={css.description}>{props.t('settings.description')}</span>
        </span>
        {dirty && <span className={css.pending}>{props.t('settings.unsaved')}</span>}
        <span className={css.chevron} aria-hidden>⌄</span>
      </button>
      {open && (
        <div className={css.body}>
          {!snapshot.writable && <p className={css.hint} role="status">{props.t('settings.readOnly')}</p>}
          <section className={css.group} aria-labelledby="reference-settings-pinterest">
            <h3 id="reference-settings-pinterest" className={css.groupTitle}>{props.t('settings.group.pinterest')}</h3>
            <div className={css.chrome}>
              <div className={css.chromeCopy}>
                <div className={css.chromeHead}>
                  <span className={css.label}>{props.t('settings.chrome.title')}</span>
                  <span className={clsx(css.status, bridge.state !== 'synced' && css.statusOff)}>{props.t(`settings.chrome.${bridge.state}`)}</span>
                </div>
                <p className={css.hint}>{props.t('settings.chrome.hint')}</p>
              </div>
              <div className={css.field}>
                <label className={css.label} htmlFor="reference-settings-extension-path">{props.t('settings.chrome.extensionPath')}</label>
                <input id="reference-settings-extension-path" className={css.input} type="text" readOnly value={bridge.extensionPath} />
                <p className={css.hint}>{props.t('settings.chrome.extensionHint')}</p>
              </div>
              <a className={css.login} href={props.pinterestOpenUrl} target="_blank" rel="noreferrer noopener">{props.t('settings.chrome.open')}</a>
              {bridge.syncedAt !== undefined && <span className={css.hint}>{props.t('settings.chrome.lastSync')} {new Date(bridge.syncedAt).toLocaleString()} · {bridge.resultCount ?? 0}</span>}
            </div>
            <SettingField {...fieldProps('pinterestDefaultQuery', 'settings.pinterestDefaultQuery', 'settings.pinterestDefaultQuery.hint')} />
            <SettingField {...fieldProps('pinterestResultLimit', 'settings.pinterestResultLimit')} />
          </section>
          <section className={css.group} aria-labelledby="reference-settings-folders">
            <h3 id="reference-settings-folders" className={css.groupTitle}>{props.t('settings.group.folders')}</h3>
            <SettingField {...fieldProps('libraryRoot', 'settings.libraryRoot', 'settings.libraryRoot.hint')} />
          </section>
          <section className={css.group} aria-labelledby="reference-settings-zlibrary">
            <h3 id="reference-settings-zlibrary" className={css.groupTitle}>{props.t('settings.group.zlibrary')}</h3>
            <SettingField {...fieldProps('zlibraryDefaultQuery', 'settings.zlibraryDefaultQuery', 'settings.zlibraryDefaultQuery.hint')} />
            <SettingField {...fieldProps('zlibraryDomain', 'settings.zlibraryDomain', 'settings.zlibraryDomain.hint')} />
            <SettingField {...fieldProps('zlibraryResultLimit', 'settings.zlibraryResultLimit')} />
          </section>
          <div className={css.footer}>
            {invalid.size > 0 && <p className={css.message} role="alert">{props.t('settings.invalid')}</p>}
            {failed && <p className={css.message} role="alert">{props.t('settings.failed')}</p>}
            <button type="button" className={css.discard} disabled={!dirty || saving} onClick={discard}>{props.t('settings.discard')}</button>
            <button type="button" className={css.save} disabled={!dirty || invalid.size > 0 || saving || !snapshot.writable} onClick={save}>{props.t(saving ? 'settings.saving' : 'settings.save')}</button>
          </div>
        </div>
      )}
    </li>
  )
}
