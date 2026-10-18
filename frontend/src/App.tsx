import { CSSProperties, createContext, FormEvent, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import i18n, { formatDate, formatNumber } from './i18n'
import { api, HousingObject, ImportResponse, PublicationResult, SessionUser, TelegramImportResponse } from './api'
import { previewFactorConfirmation, unchangedAfterRejection } from './utils/assessment'
import { hasSeenTour, loadThemePreference, saveThemePreference } from './utils/preferences'

const ObjectMap = lazy(() => import('./components/ObjectMap'))
const GuidedTour = lazy(() => import('./components/GuidedTour'))

const zoneName = (zone: string) => i18n.t(`zone.${zone}`)
const factorName = (code: string) => i18n.t(`factor.${code}`)
const SOURCE_URLS: Record<string, string> = {
  homeportal: 'https://homeportal.kz', elicense: 'https://elicense.kz',
  qazreestr: 'https://qazreestr.kz', equrylys: 'https://reestr.equrylys.kz/organizations',
  egov: 'https://egov.kz', kgd: 'https://kgd.gov.kz', rsp: 'https://rsp.gov.kz',
  cadastre: 'https://map.gov4c.kz/egkn/', procurement: 'https://procurement.gov.kz/ru/registry/rnu',
}
const TourStartContext = createContext<() => void>(() => undefined)
const AuthContext = createContext<{ user: SessionUser | null; logout: () => void }>({ user: null, logout: () => undefined })

function initialTheme(): 'light' | 'dark' {
  const prefersDark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
  return loadThemePreference(prefersDark)
}
function moneyZone(zone: string) {
  return `zone-${zone}`
}
function displayName(name: string) {
  return name.replace(/^ДЕМО\s*[·•]\s*/i, '')
}
function displayDeveloper(name: string) {
  return name.replace(/^ДЕМО\s*[·•]\s*/i, '').replace(/\s+Demo(?=[»"]?$)/i, '')
}
function displayAddress(address: string) {
  return address.replace(/ДЕМО[-\s]*/gi, '').replace(/\s{2,}/g, ' ').trim()
}
function ScoreGauge({ score, zone, size = 'normal' }: { score: number; zone: string; size?: 'small' | 'normal' }) {
  const style = { '--score-fill': `${Math.max(0, Math.min(score, 100)) * 3.6}deg` } as CSSProperties
  return (
    <div
      className={`score-gauge ${size === 'small' ? 'score-gauge-small' : ''} ${moneyZone(zone)}`}
      style={style}
      role="img"
      aria-label={`${i18n.t('common.scoreOutOf100', { score: formatNumber(score) })}, ${zoneName(zone)}`}
    >
      <div>
        <strong>{score}</strong>
        <small>/ 100</small>
      </div>
    </div>
  )
}
function ErrorNote({ message }: { message: string }) {
  const code = message.replace(/^\d+\s*/, '')
  const normalizedCode = code === 'network_error' ? 'network' : code.startsWith('api_error:') || code.startsWith('http_') ? 'api' : code
  const translated = i18n.exists(`errors.${normalizedCode}`)
    ? i18n.t(`errors.${normalizedCode}`, { status: code.includes(':') ? code.split(':')[1] : code.startsWith('http_') ? code.slice(5) : undefined })
    : i18n.t('errors.unexpected')
  return <div className="notice error">{translated}</div>
}
function EmptyState({ onImport }: { onImport: () => void }) {
  const { t } = useTranslation()
  return (
    <section className="empty-state">
      <div className="empty-icon">⌂</div>
      <h2>{t('empty.noObjects')}</h2>
      <p>{t('empty.importHint')}</p>
      <button className="button primary" onClick={onImport}>
        {t('empty.import')}
      </button>
    </section>
  )
}
function ObjectRow({ item, onSelect }: { item: HousingObject; onSelect: () => void }) {
  const { t } = useTranslation()
  const assessed = item.is_demo || item.score.factors.length > 0
  return (
    <button className="object-row" onClick={onSelect}>
      <span className={`zone-dot ${assessed ? moneyZone(item.score.zone) : ''}`} />
      <span className="object-main">
        <strong>
          {displayName(item.name)}
          {item.is_demo && <em className="demo-mini" title={t('common.demoTooltip')} aria-label={t('common.demoTooltip')}>●</em>}
        </strong>
        <small>
          {displayDeveloper(item.developer) || t('common.noDeveloper')} · {displayAddress(item.address) || t('common.noAddress')}
        </small>
      </span>
      {assessed ? <span className="score-value">{formatNumber(item.score.score)}<small> / 100</small></span> : <span className="score-value not-evaluated">{t('common.notEvaluated')}</span>}
      <span className={`pill ${assessed ? moneyZone(item.score.zone) : 'not-evaluated'}`}>{assessed ? zoneName(item.score.zone) : t('common.notEvaluated')}</span>
    </button>
  )
}
function Shell({
  children,
  title,
  subtitle,
  action,
  dashboard = false,
}: {
  children: React.ReactNode
  title: string
  subtitle?: string
  action?: React.ReactNode
  dashboard?: boolean
}) {
  const { t, i18n } = useTranslation()
  const startTour = useContext(TourStartContext)
  const auth = useContext(AuthContext)
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme)
  const objectsQuery = useQuery({ queryKey: ['objects'], queryFn: api.objects })
  const hasDemoData = objectsQuery.data?.some((object) => object.is_demo) ?? false
  const [showDataNote, setShowDataNote] = useState(false)
  const apiHealth = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30_000 })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    saveThemePreference(theme)
  }, [theme])
  return (
    <div className={`app-shell ${dashboard ? 'dashboard-shell' : ''}`}>
      <aside className="sidebar">
        <Link className="brand" to="/" title={t('app.name')} aria-label={`${t('app.name')} · ${t('nav.overview')}`}>
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M3 14 16 4l13 10M6 12v16h10v-9h5v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="m23 17 5 1.8v4.1c0 3.1-2.1 4.8-5 6.1-2.9-1.3-5-3-5-6.1v-4.1l5-1.8Z" fill="#fff" stroke="#d6a83f" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="m21 22.5 1.4 1.4 2.8-3" stroke="#176f90" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand-copy">
            {t('app.name')}
            <small>{t('app.tagline')}</small>
          </span>
        </Link>
        <nav>
          {[
            ['/', t('nav.overview'), '◫'],
            ['/registry', t('nav.registry'), '▤'],
            ['/ads', t('nav.ads'), '⌕'],
            ['/signals', t('nav.signals'), '⚑'],
            ['/sources', t('nav.sources'), '↗'],
          ].map(([href, label, icon]) => (
            <NavLink end={href === '/'} to={href} key={href} title={label} aria-label={label} data-tooltip={label}>
              <span className="nav-icon" aria-hidden="true">{icon}</span>
              <span className="visually-hidden">{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className={`main ${dashboard ? 'dashboard-main' : ''}`}>
        <header className={`topbar ${dashboard ? 'dashboard-topbar' : ''}`}>
          <h1 className="dashboard-top-title">{title}</h1>
          <div className="data-pill-wrap">
            <button className={`data-pill ${hasDemoData ? 'is-demo' : ''}`} data-tour="demo-pill" aria-expanded={showDataNote} onClick={() => setShowDataNote((value) => !value)}>
              <i />{hasDemoData ? t('common.demoData') : t('common.openData')}
            </button>
            {showDataNote && <div className="data-popover" role="status">{hasDemoData ? t('common.demoPopover') : t('common.openPopover')}</div>}
          </div>
          <div className="top-actions">
            <span className="api-status">
              <i className={apiHealth.isError ? 'offline' : ''} /> {apiHealth.isError ? t('common.apiOffline') : t('common.apiConnected')}
            </span>
            <button
              className="theme-toggle"
              title={t('theme.toggle')}
              aria-label={t('theme.toggle')}
              onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
            >{theme === 'light' ? '☾' : '☼'}</button>
            <button
              className="lang"
              title={t(i18n.language.startsWith('ru') ? 'language.kk' : 'language.ru')}
              aria-label={t(i18n.language.startsWith('ru') ? 'language.kk' : 'language.ru')}
              onClick={() => i18n.changeLanguage(i18n.language.startsWith('ru') ? 'kk' : 'ru')}
            >
              {i18n.language.startsWith('ru') ? 'RU' : 'KZ'}⌄
            </button>
            <button className="tour-start" onClick={startTour} title={t('tour.start')} aria-label={t('tour.start')}>?</button>
            {auth.user && <div className="auth-user"><span>{auth.user.display_name}<small>{t(`auth.role.${auth.user.role}`)}</small></span><button className="auth-logout" onClick={auth.logout}>{t('auth.logout')}</button></div>}
            {!dashboard && <div className="avatar" aria-hidden="true">●</div>}
          </div>
        </header>
        <div className={`page ${dashboard ? 'overview-page' : ''}`}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {t('app.name')} <span>•</span> {t('app.country')}
              </div>
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
            {action}
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
function UploadControl({ onDone, labelKey = 'import.button' }: { onDone: () => void; labelKey?: string }) {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [report, setReport] = useState<ImportResponse | null>(null)
  const upload = async (file?: File) => {
    if (!file) return
    setError('')
    setMessage('')
    setReport(null)
    try {
      const result = await api.importFile(file)
      setReport(result)
      setMessage(`${t('import.accepted', { count: formatNumber(result.accepted?.length ?? result.imported_objects) as unknown as number })} · ${t('import.updated', { count: formatNumber(result.updated_objects ?? 0) as unknown as number })} · ${t('import.skipped', { count: formatNumber(result.skipped?.length ?? result.duplicates_skipped) as unknown as number })}`)
      onDone()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <div className="upload-wrap">
      <label className="button secondary">
        {t(labelKey)}
        <input
          type="file"
          accept=".csv,.xlsx,.xlsm"
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </label>
      {message && <div className="inline-success"><span>{message}</span><small>{t('import.privacyNote')}</small>
        {!!report?.skipped?.length && <ul className="import-skip-report">{report.skipped.slice(0, 8).map((row) => (
          <li key={row.row_number}>{t('import.rowReason', { row: formatNumber(row.row_number) as unknown as number })}: {i18n.exists(`import.reason.${row.reason_code}`) ? t(`import.reason.${row.reason_code}`) : t('errors.validation')}</li>
        ))}{report.skipped.length > 8 && <li>{t('import.moreSkipped', { count: formatNumber(report.skipped.length - 8) as unknown as number })}</li>}</ul>}
      </div>}
      {error && <ErrorNote message={error} />}
    </div>
  )
}
function ObjectModal({ item, onClose }: { item: HousingObject; onClose: () => void }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [evidenceUrls, setEvidenceUrls] = useState<Record<number, string>>({})
  const detail = useQuery({ queryKey: ['object', item.id], queryFn: () => api.object(item.id) })
  const evidenceMutation = useMutation({
    mutationFn: ({ id, status, sourceUrl }: { id: number; status: string; sourceUrl?: string }) =>
      api.reviewEvidence(id, {
        status,
        reviewer: t('analyst.default'),
        comment: '',
        source_url: sourceUrl,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['object', item.id] })
      client.invalidateQueries({ queryKey: ['objects'] })
    },
  })
  const [basisStatus, setBasisStatus] = useState('not_checked')
  const [basisType, setBasisType] = useState('')
  const [basisUrl, setBasisUrl] = useState('')
  const saveBasis = useMutation({
    mutationFn: () =>
      api.legalBasis(item.id, {
        status: basisStatus,
        basis_type: basisType || null,
        source_url: basisUrl || null,
        analyst: t('analyst.default'),
        note: t('object.manualCheckNote'),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['objects'] })
      client.invalidateQueries({ queryKey: ['object', item.id] })
    },
  })
  const datasetCheck = useMutation({
    mutationFn: () => api.checkLegalBasis(item.id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['objects'] })
      client.invalidateQueries({ queryKey: ['object', item.id] })
    },
  })
  const [checkSource, setCheckSource] = useState('homeportal')
  const [checkStatus, setCheckStatus] = useState('found')
  const [checkComment, setCheckComment] = useState('')
  const [checkUrl, setCheckUrl] = useState('')
  const saveSourceCheck = useMutation({
    mutationFn: () => api.sourceCheck(item.id, { source_id: checkSource, status: checkStatus, actor: t('analyst.default'), comment: checkComment, source_url: checkUrl || null }),
    onSuccess: () => { setCheckComment(''); client.invalidateQueries({ queryKey: ['object', item.id] }) },
  })
  const current = detail.data
  const displayedObject = current ?? item
  const rejectionScenario = unchangedAfterRejection(displayedObject.score)
  return (
    <div className="modal-backdrop" onClick={onClose}>
        <section className="modal" data-tour="object-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          ×
        </button>
        <div className="eyebrow">{t('object.card', { id: formatNumber(item.id) })}</div>
        <h2>
          {displayName(item.name)} {item.is_demo && <em className="demo-tag">{t('common.demo')}</em>}
        </h2>
        <p className="muted">
          {displayDeveloper(item.developer) || t('common.noDeveloper')} · {displayAddress(item.address) || t('common.noAddress')}
        </p>
        <div className="object-meta-line">
          <span>{t('object.stage', { value: i18n.exists(`objectStatus.${displayedObject.status}`) ? t(`objectStatus.${displayedObject.status}`) : t('objectStatus.unknown') })}</span>
          <span>{t('object.readiness', { value: displayedObject.readiness == null ? t('object.readinessUnknown') : `${formatNumber(Math.round(displayedObject.readiness))}%` })}</span>
        </div>
        {displayedObject.is_demo || displayedObject.score.factors.length > 0 ? <div className={`score-panel object-score-panel ${moneyZone(displayedObject.score.zone)}`}>
          <ScoreGauge score={displayedObject.score.score} zone={displayedObject.score.zone} />
          <div><small>{t('object.currentScore')}</small><span className={`pill ${moneyZone(displayedObject.score.zone)}`}>{zoneName(displayedObject.score.zone)}</span></div>
        </div> : <p className="not-evaluated-notice">{t('common.notEvaluated')}</p>}
        <h3>{t('object.factorsAndReview')}</h3>
        {displayedObject.score.factors.length ? (
          displayedObject.score.factors.map((f, n) => (
            <div className="factor-line" id={f.evidence_id ? `evidence-${f.evidence_id}` : undefined} key={n}>
              <b>{f.factor_code}</b>
              <span className="factor-detail">
                <span className="factor-title-line">
                  {factorName(f.factor_code)}
                  <span className="fact-tag">{t('common.fact')}</span>
                </span>
                <small>
                  {f.source_url ? (
                    <a href={f.source_url} target="_blank">
                      {t('object.sourceArrow')}
                    </a>
                  ) : (
                    f.source
                  )}
                </small>
              </span>
              <strong>+{f.points}</strong>
            </div>
          ))
        ) : (
          <p className="muted">{t('object.noConfirmedFactors')}</p>
        )}
        <section className="risk-explanation" aria-labelledby="risk-explanation-title" data-tour="score-breakdown">
          <h3 id="risk-explanation-title">{t('object.whyScore')}</h3>
          <p className="risk-explanation-lead">
            {t('object.zoneScore', { zone: zoneName(displayedObject.score.zone), score: formatNumber(displayedObject.score.score) })}{' '}
            {displayedObject.score.factors.length ? t('object.basedOnConfirmed') : t('object.noConfirmedYet')}
          </p>
          {displayedObject.score.factors.length > 0 && (
            <ul className="risk-evidence-links">
              {displayedObject.score.factors.map((factor, index) => (
                <li key={`${factor.factor_code}-${factor.evidence_id ?? index}`}>
                  {factor.evidence_id ? (
                    <a href={`#evidence-${factor.evidence_id}`}>
                      {factor.factor_code}: {factorName(factor.factor_code)}
                      {factor.quote ? <> · «{factor.quote}»</> : null}
                      <small>{t('object.confirmedOnEvidence', { date: formatDate(factor.captured_at) })}</small>
                    </a>
                  ) : (
                    <span>{factor.factor_code}: {factorName(factor.factor_code)} · {formatDate(factor.captured_at)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {displayedObject.score.zone === 'red' && (
            <small className="risk-rule-note">{t('object.redRule')}</small>
          )}
        </section>
        {displayedObject.score.needs_review.length > 0 && (
          <section className="what-if-panel" aria-labelledby="what-if-title" data-tour="what-if">
            <h3 id="what-if-title">{t('object.whatToCheck')}</h3>
            <p className="what-if-disclaimer">{t('object.whatIfNote')}</p>
            {displayedObject.score.needs_review.map((review, index) => {
              const confirmedScenario = previewFactorConfirmation(displayedObject.score, review.factor_code)
              const isUnverifiedBasis = review.factor_code === 'R1' && review.evidence_id == null
              return (
                <div className="what-if-item" key={`${review.factor_code}-${review.evidence_id ?? index}`}>
                  <b>{review.factor_code} · {review.factor_code === 'R1' ? t('object.readinessSourceNote') : t('object.reviewFactorReason')}</b>
                  <p>
                    {isUnverifiedBasis ? t('object.ifLegalBasisAbsent') : t('object.ifHypothesisConfirmed')}:
                    {' '}{formatNumber(displayedObject.score.score)} → {formatNumber(confirmedScenario.score)} {t('common.points')} · {zoneName(confirmedScenario.zone)}
                    {confirmedScenario.addedPoints > 0 ? ` · +${confirmedScenario.addedPoints}` : ''}.
                  </p>
                  <small>
                    {isUnverifiedBasis ? t('object.ifLegalBasisFound') : t('object.ifHypothesisRejected')}:
                    {' '}{formatNumber(rejectionScenario.score)} {t('common.points')} · {zoneName(rejectionScenario.zone)}.
                  </small>
                </div>
              )
            })}
          </section>
        )}
        {displayedObject.score.needs_review.length === 0 && (
          <p className="review-clear">{t('object.reviewClear')}</p>
        )}
        {displayedObject.legal_check && <section className="legal-check-result">
          <strong>{t(`legalCheck.${displayedObject.legal_check.status}`)}</strong>
          {displayedObject.legal_check.status !== 'no_dataset' && <small>{t('legalCheck.importedAt', { date: formatDate(displayedObject.legal_check.imported_at) })}</small>}
          <a href={displayedObject.legal_check.source_url} target="_blank" rel="noreferrer">{t('legalCheck.source')}</a>
          {displayedObject.legal_check.registry_record_id && <small>{t('legalCheck.sourceRecord', { id: displayedObject.legal_check.registry_record_id })}</small>}
        </section>}
        <section className="source-checks">
          <h3>{t('object.sourceChecks')}</h3>
          <div className="source-check-form">
            <select aria-label={t('object.sourceChecks')} value={checkSource} onChange={(event) => setCheckSource(event.target.value)}>
              {['homeportal','elicense','qazreestr','equrylys','egov','kgd','rsp','cadastre','procurement'].map((source) => <option key={source} value={source}>{t(`sources.name.${source}`)}</option>)}
            </select>
            <a className="button secondary" href={SOURCE_URLS[checkSource]} target="_blank" rel="noreferrer">{t('object.openSource')}</a>
            <select aria-label={t('object.sourceChecks')} value={checkStatus} onChange={(event) => setCheckStatus(event.target.value)}>
              <option value="found">{t('object.checkFound')}</option><option value="not_found">{t('object.checkNotFound')}</option><option value="unavailable">{t('object.checkUnavailable')}</option>
            </select>
            <input aria-label={t('object.checkSourceUrl')} type="url" placeholder="https://…" value={checkUrl} onChange={(event) => setCheckUrl(event.target.value)} />
            <input aria-label={t('object.checkComment')} placeholder={t('object.checkComment')} value={checkComment} onChange={(event) => setCheckComment(event.target.value)} />
            <button className="button secondary" onClick={() => saveSourceCheck.mutate()} disabled={saveSourceCheck.isPending || !checkUrl.startsWith('http')}>{t('object.recordCheck')}</button>
          </div>
          <p className="muted">{t('object.noR1FromCheck')}</p>
          {(current?.source_checks || []).map((check) => <p className="source-check-entry" key={check.id}><b>{t(`sources.name.${check.source_id}`)}</b> · {t(`object.checkStatus.${check.status}`)} · {check.actor} · {formatDate(check.created_at)}{check.comment ? ` · ${check.comment}` : ''}{check.source_url && <> · <a href={check.source_url} target="_blank" rel="noreferrer">{t('object.sourceArrow')}</a></>}</p>)}
        </section>
        <h3>{t('object.legalBasis')}</h3>
        <button className="button secondary analyst-only" onClick={() => datasetCheck.mutate()}>{t('legalCheck.check')}</button>
        {datasetCheck.isError && <ErrorNote message={(datasetCheck.error as Error).message} />}
        {datasetCheck.data && <p className="muted">{t(`errors.${datasetCheck.data.status === 'found' ? 'dataset_record_found' : datasetCheck.data.status === 'not_found' ? 'dataset_record_not_found_review_required' : 'dataset_not_loaded_review_required'}`)}</p>}
        <div className="form-grid">
          <select value={basisStatus} onChange={(e) => setBasisStatus(e.target.value)}>
            <option value="not_checked">{t('legalStatus.not_checked')}</option>
            <option value="absent">{t('legalStatus.absent')}</option>
            <option value="confirmed">{t('legalStatus.confirmed')}</option>
          </select>
          {basisStatus === 'confirmed' && (
            <input
              placeholder={t('object.legalBasisType')}
              value={basisType}
              onChange={(e) => setBasisType(e.target.value)}
            />
          )}
          <input
            placeholder={t('object.verifiedSourceLink')}
            value={basisUrl}
            onChange={(e) => setBasisUrl(e.target.value)}
          />
          <button className="button secondary analyst-only" onClick={() => saveBasis.mutate()}>
            {t('object.saveCheck')}
          </button>
        </div>
        {saveBasis.isError && <ErrorNote message={(saveBasis.error as Error).message} />}
        <h3>{t('object.aiHypotheses')}</h3>
        {current?.evidence
          .filter((e) => e.status === 'ai_hypothesis')
          .map((e) => (
            <div className="hypothesis" key={e.id}>
              <div>
                <span className="pill hypothesis-pill">{t('common.aiHypothesis')} · {e.factor_code}</span>
                <p>«{e.quote}»</p>
                <small>{t('object.hypothesisNeedsReview')}</small>
              </div>
              <div className="review-buttons">
                <input
                  aria-label={t('object.evidenceLink')}
                  type="url"
                  placeholder={t('object.evidenceLink')}
                  value={evidenceUrls[e.id] ?? e.source_url ?? ''}
                  onChange={(event) =>
                    setEvidenceUrls((values) => ({ ...values, [e.id]: event.target.value }))
                  }
                />
                <button
                  onClick={() =>
                    evidenceMutation.mutate({
                      id: e.id,
                      status: 'fact',
                      sourceUrl: evidenceUrls[e.id] ?? e.source_url,
                    })
                  }
                >
                  {t('object.confirm')}
                </button>
                <button onClick={() => evidenceMutation.mutate({ id: e.id, status: 'rejected' })}>
                  {t('object.reject')}
                </button>
              </div>
            </div>
          ))}
        {evidenceMutation.isError && (
          <ErrorNote message={(evidenceMutation.error as Error).message} />
        )}
        {current?.evidence.filter((e) => e.status === 'ai_hypothesis').length === 0 && (
          <p className="muted">{t('object.noNewHypotheses')}</p>
        )}
        <div className="modal-footer">
          <button className="button secondary" onClick={() => window.print()}>
            {t('common.printPdf')}
          </button>
          <button className="button primary" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
      </section>
    </div>
  )
}
function Dashboard() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [selected, setSelected] = useState<HousingObject | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [zoneFilter, setZoneFilter] = useState<'all' | 'red' | 'yellow' | 'green' | 'review'>('all')
  const [search, setSearch] = useState('')
  const [pagination, setPagination] = useState({ key: '', count: 100 })
  const [showCreate, setShowCreate] = useState(false)
  const rowRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const data = useQuery({ queryKey: ['objects'], queryFn: api.objects })
  const objects = useMemo(() => data.data ?? [], [data.data])
  const mappableObjects = useMemo(
    () => objects.filter((object) => object.latitude != null && object.longitude != null),
    [objects],
  )
  const counts = useMemo(
    () => ({
      red: objects.filter((o) => (o.is_demo || o.score.factors.length > 0) && o.score.zone === 'red').length,
      yellow: objects.filter((o) => (o.is_demo || o.score.factors.length > 0) && o.score.zone === 'yellow').length,
      green: objects.filter((o) => (o.is_demo || o.score.factors.length > 0) && o.score.zone === 'green').length,
      review: objects.filter((o) => o.score.needs_review.length > 0).length,
    }),
    [objects],
  )
  const filtered = useMemo(
    () =>
      objects
        .filter((o) => zoneFilter === 'all' || (zoneFilter === 'review'
          ? o.score.needs_review.length > 0
          : (o.is_demo || o.score.factors.length > 0) && o.score.zone === zoneFilter))
        .filter((o) => `${displayName(o.name)} ${o.developer} ${o.address}`.toLocaleLowerCase(i18n.language).includes(search.trim().toLocaleLowerCase(i18n.language)))
        .sort((a, b) => b.score.score - a.score.score || a.name.localeCompare(b.name, i18n.language)),
    [objects, search, zoneFilter],
  )
  useEffect(() => {
    if (selectedId != null && filtered.some((object) => object.id === selectedId)) {
      rowRefs.current[selectedId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [filtered, selectedId])
  const pageKey = `${search}\u0000${zoneFilter}`
  const visibleCount = pagination.key === pageKey ? pagination.count : 100
  const visibleObjects = filtered.slice(0, visibleCount)
  const create = useMutation({
    mutationFn: api.addObject,
    onSuccess: (obj) => {
      client.invalidateQueries({ queryKey: ['objects'] })
      setSelected(obj)
      setShowCreate(false)
    },
  })
  const demoSeed = useMutation({
    mutationFn: api.seed,
    onSuccess: () => client.invalidateQueries({ queryKey: ['objects'] }),
  })
  const onCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    create.mutate({
      name: f.get('name'),
      developer: f.get('developer'),
      address: f.get('address'),
      region: f.get('region'),
    })
  }
  const selectFromMap = (objectId: number) => {
    setZoneFilter('all')
    setSearch('')
    setSelectedId(objectId)
  }
  return (
    <Shell title={t('page.overview')} dashboard>
      <div className="overview-layout">
        <section className="overview-queue" aria-label={t('overview.queue')} data-tour="queue">
          <div className="queue-header">
            <div className="queue-heading-line">
              <div>
                <h2>{t('overview.objects')}</h2>
                <span>{formatNumber(filtered.length)} / {formatNumber(objects.length)} · {t('overview.byRisk')}</span>
              </div>
              <div className="queue-actions">
                {!objects.some((object) => object.is_demo) && (
                  <button className="icon-action" data-tour={objects.length === 0 ? 'demo-load' : undefined} title={t('overview.demoSeed')} aria-label={t('overview.demoSeed')} onClick={() => demoSeed.mutate()} disabled={demoSeed.isPending}>⇩</button>
                )}
                <UploadControl onDone={() => client.invalidateQueries({ queryKey: ['objects'] })} />
                <button className="icon-action add-object-action" title={t('overview.addObject')} aria-label={t('overview.addObject')} onClick={() => setShowCreate(true)}>＋</button>
              </div>
            </div>
            <label className="table-search overview-search" data-tour="search">
              <span aria-hidden="true">⌕</span>
              <input aria-label={t('overview.searchLabel')} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('overview.searchPlaceholder')} />
            </label>
            <div className="zone-filters" aria-label={t('overview.zoneFilters')} data-tour="zone-filters">
              {(['red', 'yellow', 'green'] as const).map((zone) => (
                <button
                  key={zone}
                  className={`zone-filter ${moneyZone(zone)} ${zoneFilter === zone ? 'active' : ''}`}
                  onClick={() => setZoneFilter(zoneFilter === zone ? 'all' : zone)}
                  aria-pressed={zoneFilter === zone}
                >
                  <span>{t(`overview.${zone}Count`, { count: counts[zone] })}</span>
                </button>
              ))}
              <button
                className={`zone-filter review-filter ${zoneFilter === 'review' ? 'active' : ''}`}
                onClick={() => setZoneFilter(zoneFilter === 'review' ? 'all' : 'review')}
                aria-pressed={zoneFilter === 'review'}
                title={t('overview.reviewTooltip')}
              >
                <span>{t('overview.reviewCount', { count: counts.review })}</span>
              </button>
            </div>
          </div>
          {data.isError && <ErrorNote message={(data.error as Error).message} />}
          {demoSeed.isError && <ErrorNote message={(demoSeed.error as Error).message} />}
          {data.isLoading ? (
            <div className="overview-loading" aria-label={t('overview.loadingObjects')}>
              {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
            </div>
          ) : objects.length === 0 ? (
            <EmptyState onImport={() => document.querySelector<HTMLInputElement>('.upload-wrap input')?.click()} />
          ) : filtered.length === 0 ? (
            <p className="muted overview-no-results">{t('overview.noFilterResults')}</p>
          ) : (
            <div className="overview-object-list" aria-label={t('overview.objectList')}>
              {visibleObjects.map((object) => {
                const hypotheses = object.score.needs_review.filter((factor) => factor.factor_code !== 'R1')
                const assessed = object.is_demo || object.score.factors.length > 0
                return (
                  <button
                    className={`overview-object-row ${selectedId === object.id ? 'selected' : ''}`}
                    key={object.id}
                    data-tour={object.score.zone === 'red' ? 'red-object' : undefined}
                    ref={(node) => { rowRefs.current[object.id] = node }}
                    onClick={() => { setSelectedId(object.id); setSelected(object) }}
                    onMouseEnter={() => setHoveredId(object.id)}
                    onMouseLeave={() => setHoveredId((current) => current === object.id ? null : current)}
                    aria-pressed={selectedId === object.id}
                  >
                    <span className={`object-zone-rail ${assessed ? moneyZone(object.score.zone) : 'zone-neutral'}`} />
                    <span className="overview-object-identity">
                      <strong>{displayName(object.name)}{object.is_demo && <em className="demo-mini" title={t('common.demoTooltip')} aria-label={t('common.demoTooltip')}>●</em>}</strong>
                      <small>{displayDeveloper(object.developer) || t('common.noDeveloper')}</small>
                    </span>
                    <span className="overview-row-factors" aria-label={t('overview.confirmedFactors')}>
                      {object.score.factors.map((factor) => (
                        <i className="factor-chip confirmed" key={factor.evidence_id || factor.factor_code} title={`${factorName(factor.factor_code)} · +${formatNumber(factor.points)}`}>{factor.factor_code}</i>
                      ))}
                      {hypotheses.map((factor, index) => (
                        <i className="factor-chip hypothesis" key={`${factor.factor_code}-${index}`} title={t('object.hypothesisNeedsReview')}>{factor.factor_code}</i>
                      ))}
                    </span>
                    <span className={`overview-row-score ${assessed ? '' : 'not-evaluated'}`}>
                      <strong>{assessed ? formatNumber(object.score.score) : '—'}</strong>
                      <small>{assessed ? zoneName(object.score.zone) : t('common.notEvaluated')}</small>
                    </span>
                  </button>
                )
              })}
              {visibleCount < filtered.length && <button className="pagination-more" onClick={() => setPagination({ key: pageKey, count: visibleCount + 100 })}>{t('overview.loadMore', { shown: formatNumber(Math.min(visibleCount + 100, filtered.length)), total: formatNumber(filtered.length) })}</button>}
            </div>
          )}
        </section>
        <section className="overview-map-panel" aria-label={t('overview.map')} data-tour="map">
          <div className="overview-map-heading">
            <h2>{t('overview.map')}</h2>
            <span>{formatNumber(mappableObjects.length)} {t('common.coordinates')}</span>
          </div>
          {mappableObjects.length ? (
            <Suspense fallback={<div className="map-empty" role="status">{t('auth.loading')}</div>}>
              <ObjectMap mappableObjects={mappableObjects} selectedId={selectedId} hoveredId={hoveredId} onSelect={selectFromMap} />
            </Suspense>
          ) : (
            <div className="map-empty overview-map-empty">
              <div className="map-grid"><span>⌖</span></div>
              <b>{t('overview.noCoordinates')}</b>
              <small>{t('overview.coordinateHint')}</small>
            </div>
          )}
        </section>
      </div>
      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form className="modal small-modal" onClick={(e) => e.stopPropagation()} onSubmit={onCreate}>
            <button type="button" className="modal-close" onClick={() => setShowCreate(false)}>×</button>
            <div className="eyebrow">{t('overview.newRecord')}</div>
            <h2>{t('overview.addObject')}</h2>
            <p className="muted">{t('overview.unknownStayUnknown')}</p>
            <input required name="name" placeholder={t('overview.objectName')} />
            <input name="developer" placeholder={t('overview.developer')} />
            <input name="address" placeholder={t('overview.addressFromSource')} />
            <input name="region" placeholder={t('overview.region')} />
            <div className="modal-footer">
              <button className="button secondary" type="button" onClick={() => setShowCreate(false)}>{t('common.cancel')}</button>
              <button className="button primary">{t('common.create')}</button>
            </div>
            {create.isError && <ErrorNote message={(create.error as Error).message} />}
          </form>
        </div>
      )}
      {selected && (
        <ObjectModal item={selected} onClose={() => { setSelected(null); client.invalidateQueries({ queryKey: ['objects'] }) }} />
      )}
    </Shell>
  )
}
function RegistryPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const data = useQuery({ queryKey: ['objects'], queryFn: api.objects })
  const [selected, setSelected] = useState<HousingObject | null>(null)
  return (
    <Shell
      title={t('page.registry')}
      subtitle={t('page.registrySubtitle')}
      action={<UploadControl onDone={() => client.invalidateQueries({ queryKey: ['objects'] })} />}
    >
      <section className="panel registry-full">
        <div className="panel-heading">
          <div>
            <h2>{t('registry.allObjects')}</h2>
            <p>{t('registry.localCount', { count: data.data?.length || 0 })}</p>
          </div>
        </div>
        {(data.data || []).map((o) => (
          <ObjectRow key={o.id} item={o} onSelect={() => setSelected(o)} />
        ))}
        {!data.data?.length && (
          <EmptyState
            onImport={() => document.querySelector<HTMLInputElement>('.upload-wrap input')?.click()}
          />
        )}
      </section>
      {selected && <ObjectModal item={selected} onClose={() => setSelected(null)} />}
    </Shell>
  )
}
function HighlightedText({ text }: { text: string }) {
  const { t } = useTranslation()
  const terms = t('ads.highlightTerms').split('|').map((term: string) => term.trim()).filter(Boolean)
  const escaped = terms.map((term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!escaped.length) return <>{text}</>
  const expression = new RegExp(`(${escaped.join('|')})`, 'ig')
  const matchPattern = new RegExp(escaped.join('|'), 'i')
  return <>{text.split(expression).map((part, index) => matchPattern.test(part) ? <mark key={index}>{part}</mark> : part)}</>
}
function AdsPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const objects = useQuery({ queryKey: ['objects'], queryFn: api.objects })
  const [result, setResult] = useState<PublicationResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null)
  const [screenshotSaved, setScreenshotSaved] = useState(false)
  const [telegramStatus, setTelegramStatus] = useState('')
  const [telegramError, setTelegramError] = useState('')
  const [telegramMessages, setTelegramMessages] = useState<TelegramImportResponse['messages']>([])
  const linkCandidate = useMutation({
    mutationFn: ({ publicationId, objectId }: { publicationId: number; objectId: number }) =>
      api.linkPublication(publicationId, objectId),
    onSuccess: (linked) => {
      setResult((previous) =>
        previous
          ? {
              ...previous,
              housing_object_id: linked.housing_object_id,
              evidence: [...previous.evidence, ...linked.evidence],
            }
          : previous,
      )
      client.invalidateQueries({ queryKey: ['objects'] })
    },
    onError: (err) => setError((err as Error).message),
  })
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const f = new FormData(e.currentTarget)
    try {
      const res = await api.addPublication({
        text: f.get('text'),
        source: f.get('source'),
        source_url: f.get('url') || null,
        housing_object_id: f.get('object_id') ? Number(f.get('object_id')) : null,
      })
      setResult(res)
      if (screenshotFile) {
        await api.uploadPublicationScreenshot(res.publication_id, screenshotFile)
        setScreenshotSaved(true)
      }
      client.invalidateQueries({ queryKey: ['objects'] })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Shell
      title={t('page.ads')}
      subtitle={t('page.adsSubtitle')}
    >
      <div className="two-col">
        <section className="panel telegram-import">
          <h2>{t('ads.telegramImport')}</h2>
          <p className="muted">{t('ads.telegramPrivacy')}</p>
          <label>{t('ads.telegramFile')} <input type="file" accept="application/json,.json" onChange={async (event) => {
            const input = event.currentTarget
            const file = input.files?.[0]
            if (!file) return
            setTelegramError(''); setTelegramStatus('')
            try { const response = await api.importTelegram(file); setTelegramMessages(response.messages); setTelegramStatus(t('ads.telegramImported', { count: response.imported, channel: response.channel })); client.invalidateQueries({ queryKey: ['objects'] }) }
            catch (error) { setTelegramError((error as Error).message) }
            input.value = ''
          }} /></label>
          {telegramStatus && <p className="inline-success">{telegramStatus}</p>}{telegramError && <ErrorNote message={telegramError} />}
          {telegramMessages.map((message) => <article className="telegram-message" key={message.publication_id}>
            <p><HighlightedText text={message.text} /></p>
            <small>{message.extraction.has_payment_offer ? `${t('ads.hypothesis')} · ${t(`ads.confidenceLevel.${message.extraction.confidence >= 0.8 ? 'high' : message.extraction.confidence >= 0.55 ? 'medium' : 'low'}`)}` : t('ads.paymentNotFound')} · {t('ads.confidence', { percent: Math.round(message.extraction.confidence * 100) })}{message.extraction.confidence < 0.45 ? ` · ${t('ads.uncertain')}` : ''}</small>
            {message.source_url && <a href={message.source_url} target="_blank" rel="noreferrer">{t('object.sourceArrow')}</a>}
            {message.matches.slice(0, 3).map((candidate) => <button className="candidate-link" key={candidate.object_id} onClick={async () => {
              try { await api.linkPublication(message.publication_id, candidate.object_id); setTelegramMessages((previous) => previous.filter((row) => row.publication_id !== message.publication_id)); client.invalidateQueries({ queryKey: ['objects'] }) }
              catch (error) { setTelegramError((error as Error).message) }
            }}>{t('ads.linkObject')}: {candidate.name} · {Math.round(candidate.confidence * 100)}%</button>)}
          </article>)}
        </section>
        <section className="panel form-panel">
          <div className="eyebrow">{t('ads.newObservation')}</div>
          <h2>{t('ads.addPublication')}</h2>
          <form onSubmit={submit} data-tour="ads-form">
            <label>
              {t('ads.publicationText')}
              <textarea
                name="text"
                required
                minLength={10}
                maxLength={20000}
                rows={9}
                placeholder={t('ads.publicationPlaceholder')}
              />
            </label>
            <div className="form-grid">
              <label>
                {t('ads.platform')}
                <input name="source" defaultValue={t('ads.manualInput')} />
              </label>
              <label>
                {t('ads.publicationLink')}
                <input name="url" type="url" placeholder="https://…" />
              </label>
            </div>
            <label>
              {t('overview.objects')}{' '}
              <select name="object_id">
                <option value="">{t('ads.notLinkYet')}</option>
                {(objects.data || []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">{t('ads.matchingHint')}</p>
            <label className="screenshot-upload">
              {t('ads.screenshot')}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { setScreenshotFile(e.target.files?.[0] ?? null); setScreenshotSaved(false) }} />
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? t('ads.analyzing') : t('ads.extractPayment')}
            </button>
          </form>
          {error && <ErrorNote message={error} />}
        </section>
        <section className="panel result-panel">
          <div className="eyebrow">{t('ads.analysisResult')}</div>
          {!result ? (
            <div className="result-placeholder">
              <span>⌕</span>
              <h3>{t('ads.noResults')}</h3>
              <p>{t('ads.resultHint')}</p>
            </div>
          ) : (
            <>
              <h2>
                {result.extraction.has_payment_offer ? t('ads.paymentFound') : t('ads.paymentNotFound')}
              </h2>
              <span className="pill muted-pill">
                {result.extraction.mode === 'llm' ? t('ads.llmQuoteCheck') : t('ads.localRules')}
              </span>
              {result.extraction.quote && <blockquote><HighlightedText text={result.extraction.quote} />{result.extraction.quote_valid && <small className="highlight-label">{t('ads.highlightedPhrase')}</small>}</blockquote>}
              <p>{t('ads.resultHint')}</p>
              <p className="muted">
                {t('ads.confidence', { percent: formatNumber(Math.round(result.extraction.confidence * 100)) })} {t(`ads.confidenceLevel.${result.extraction.confidence >= 0.8 ? 'high' : result.extraction.confidence >= 0.55 ? 'medium' : 'low'}`)}. {result.extraction.confidence < 0.45 && <b>{t('ads.uncertain')}. </b>}{t('ads.hypothesisDisclaimer')}
              </p>
              {screenshotSaved && <p className="inline-success">{t('ads.screenshotStored')}</p>}
              {screenshotSaved && <img className="publication-screenshot" src={`/api/publications/${result.publication_id}/screenshot`} alt={t('ads.screenshot')} />}
              {result.evidence.map((e) => (
                <div className="notice" key={e.id}>
                  {t('ads.hypothesisAdded', { factor: e.factor_code })}
                </div>
              ))}
              {result.matches?.length > 0 && (
                <div>
                  <h3>{t('ads.similarNames')}</h3>
                  {result.matches.slice(0, 3).map((m) => (
                    <div className="match-row" key={m.object_id}>
                      <span>
                        {m.name} · {Math.round(m.confidence * 100)}%
                      </span>
                      {result.housing_object_id === m.object_id ? (
                          <b>{t('ads.objectSelected')}</b>
                      ) : !result.housing_object_id ? (
                        <button
                          onClick={() =>
                            linkCandidate.mutate({
                              publicationId: result.publication_id,
                              objectId: m.object_id,
                            })
                          }
                        >
                          {t('ads.linkObject')}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              {error && <ErrorNote message={error} />}
            </>
          )}
        </section>
      </div>
    </Shell>
  )
}
function SignalsPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const signals = useQuery({ queryKey: ['signals'], queryFn: api.signals })
  const objects = useQuery({ queryKey: ['objects'], queryFn: api.objects })
  const [error, setError] = useState('')
  const [printTarget, setPrintTarget] = useState<number | null>(null)
  const create = useMutation({
    mutationFn: (id: number) => api.addSignal({ housing_object_id: id, author: t('analyst.default') }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['signals'] })
      client.invalidateQueries({ queryKey: ['objects'] })
    },
  })
  const transition = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.transitionSignal(id, {
        status,
        author: t('analyst.default'),
        comment:
          status === 'returned' ? t('signals.returnComment') : '',
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['signals'] }),
    onError: (err) => setError((err as Error).message),
  })
  return (
    <Shell
      title={t('page.signals')}
      subtitle={t('page.signalsSubtitle')}
    >
      <div className="panel signal-create" data-tour="signal-page">
        <div>
          <h2>{t('signals.create')}</h2>
          <p>{t('signals.createHint')}</p>
        </div>
        <select id="signal-object">
          <option value="">{t('signals.selectObject')}</option>
          {(objects.data || []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {formatNumber(o.score.score)} {t('common.points')}
            </option>
          ))}
        </select>
        <button
          className="button primary"
          onClick={() => {
            const id = Number((document.getElementById('signal-object') as HTMLSelectElement).value)
            if (id) create.mutate(id)
          }}
        >
          ＋ {t('signals.createAction')}
        </button>
      </div>
      {error && <ErrorNote message={error} />}
      <div className="signal-list">
        {(signals.data || []).map((s) => (
          <article
            className={`panel signal-card ${printTarget === s.id ? 'print-target' : ''}`}
            key={s.id}
          >
            <div className="signal-top">
              <span className={`pill status-${s.status}`}>{t(`signalStatus.${s.status}`)}</span>
              <small>{t('signals.cardNumber', { id: formatNumber(s.id), author: s.author })}</small>
              <button
                className="button secondary print-only-hidden"
                onClick={() => {
                  setPrintTarget(s.id)
                  window.onafterprint = () => setPrintTarget(null)
                  window.setTimeout(() => window.print(), 100)
                }}
              >
                {t('common.printPdf')}
              </button>
            </div>
            <h2>{displayName(s.object_name)} {s.is_demo && <em className="demo-mini" title={t('common.demoTooltip')}>●</em>}</h2>
            <div className={`score-panel ${moneyZone(s.score_snapshot?.zone || 'green')}`}>
              <strong>
                {formatNumber(s.score_snapshot?.score ?? 0)}
                <i> / 100</i>
              </strong>
              <span>{s.is_demo || s.score_snapshot?.factors?.length ? zoneName(s.score_snapshot?.zone || 'green') : t('common.notEvaluated')}</span>
            </div>
            <div className="signal-factors">
              {(s.score_snapshot?.factors || []).map((f, i) => (
                <p key={i}>
                  <b>
                    {f.factor_code} +{f.points}
                  </b>{' '}
                  · {factorName(f.factor_code)}
                  {f.source_url && (
                    <>
                      {' '}
                      ·{' '}
                      <a href={f.source_url} target="_blank">
                        {t('common.source')}
                      </a>
                    </>
                  )}
                </p>
              ))}
            </div>
            {(s.comments || []).map((c, i) => (
              <p className="comment" key={i}>
                <b>{c.author}</b> · {c.text}
              </p>
            ))}
            {s.is_demo && <small className="signal-print-disclaimer">{t('common.demoDisclaimer')}</small>}
            <div className="signal-actions print-only-hidden">
              {s.status === 'draft' && (
                <button onClick={() => transition.mutate({ id: s.id, status: 'in_review' })}>
                  {t('signals.sendReview')}
                </button>
              )}
              {s.status === 'in_review' && (
                <>
                  <button onClick={() => transition.mutate({ id: s.id, status: 'confirmed' })}>
                    {t('signals.approve')}
                  </button>
                  <button onClick={() => transition.mutate({ id: s.id, status: 'returned' })}>
                    {t('signals.returnWithComment')}
                  </button>
                </>
              )}
              {s.status === 'returned' && (
                <button onClick={() => transition.mutate({ id: s.id, status: 'in_review' })}>
                  {t('signals.recheck')}
                </button>
              )}
            </div>
          </article>
        ))}
        {!signals.data?.length && (
          <section className="empty-state">
            <div className="empty-icon">⚑</div>
            <h2>{t('signals.empty')}</h2>
            <p>{t('signals.emptyHint')}</p>
          </section>
        )}
      </div>
    </Shell>
  )
}
function SourcesPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const sources = useQuery({ queryKey: ['sources'], queryFn: api.sources })
  return (
    <Shell
      title={t('page.sources')}
      subtitle={t('page.sourcesSubtitle')}
      action={<UploadControl labelKey="sources.updateDataset" onDone={() => { client.invalidateQueries({ queryKey: ['objects'] }); client.invalidateQueries({ queryKey: ['sources'] }) }} />}
    >
      <section className="panel sources-list">
        {sources.isLoading && <p>{t('sources.loadingAshyq')}</p>}
        {(sources.data || []).map((s, i) => {
          // Older deployments omit the Ashyq id; derive it from the stable dataset URL.
          const sourceId = s.id || (s.url.includes('magda-ds-b80110e9-218a-42ba-b8c8-01fa5e4c82c8') ? 'ashyq' : '')
          return (
          <article className="source-row" key={s.id || i}>
            <div className={`source-indicator ${s.status === 'available' ? 'online' : ''}`} />
            <div>
              <b>{sourceId && i18n.exists(`sources.name.${sourceId}`) ? t(`sources.name.${sourceId}`) : s.name}</b>
              <small>
                {s.message_code && i18n.exists(`sources.status.${s.message_code}`) ? t(`sources.status.${s.message_code}`) : s.status === 'available' ? t('sources.metadataAvailable') : t('sources.checkManually')}
              </small>
              {sourceId === 'ashyq' && <small>{t('sources.connectedRecords', { count: s.record_count ?? 0 })} · {s.imported_at ? t('sources.lastImported', { date: formatDate(s.imported_at) }) : t('sources.notImported')}</small>}
              {sourceId && i18n.exists(`sources.whatToCheck.${sourceId}`) && <small>{t(`sources.whatToCheck.${sourceId}`)}</small>}
            </div>
            <span className="source-state">
              {sourceId === 'ashyq'
                ? t(s.connection_mode === 'connected' ? 'sources.connected' : 'sources.notConnected')
                : t('sources.manualReview')}
            </span>
            <a className="button secondary" href={s.url} target="_blank" rel="noreferrer">
              {t('sources.openArrow')}
            </a>
          </article>
          )
        })}
      </section>
      <div className="source-note">
        <b>{t('sources.readStatuses')}</b>
        <p>
          {t('sources.manualIsNotMissing')}
        </p>
      </div>
    </Shell>
  )
}
function LoginPage({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await api.login(username, password)
      onLogin(result.user)
    } catch (reason) {
      const code = (reason as Error).message
      setError(code === 'login_rate_limited' ? t('auth.rateLimited') : t('auth.invalidCredentials'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="login-screen">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-mark login-brand" aria-hidden="true">⌂</div>
        <span className="eyebrow">{t('app.country')}</span>
        <h1>{t('auth.title')}</h1>
        <p>{t('app.name')}</p>
        <label>{t('auth.username')}<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
        <label>{t('auth.password')}<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <div className="notice error" role="alert">{error}</div>}
        <button className="button primary" disabled={busy}>{busy ? t('auth.signingIn') : t('auth.signIn')}</button>
      </form>
    </main>
  )
}

export default function App() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [authUser, setAuthUser] = useState<SessionUser | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [tourOpen, setTourOpen] = useState(() => !hasSeenTour())
  useEffect(() => {
    let active = true
    api.currentUser().then((user) => { if (active) setAuthUser(user) }).catch(() => { if (active) setAuthUser(null) }).finally(() => { if (active) setAuthReady(true) })
    return () => { active = false }
  }, [])
  const logout = useCallback(async () => {
    try { await api.logout() } catch { /* Expired sessions are cleared locally as well. */ }
    queryClient.clear()
    setAuthUser(null)
  }, [queryClient])
  if (!authReady) return <main className="login-screen"><div className="login-panel" role="status">{i18n.t('auth.loading')}</div></main>
  if (!authUser) return <LoginPage onLogin={setAuthUser} />
  return (
    <AuthContext.Provider value={{ user: authUser, logout }}>
      <div className="app-root" data-role={authUser.role}>
        <TourStartContext.Provider value={() => setTourOpen(true)}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/registry" element={<RegistryPage />} />
            <Route path="/ads" element={<AdsPage />} />
            <Route path="/signals" element={<SignalsPage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="*" element={<button onClick={() => navigate('/')}>{i18n.t('nav.home')}</button>} />
          </Routes>
          <Suspense fallback={null}>{tourOpen && <GuidedTour open={tourOpen} onClose={() => setTourOpen(false)} />}</Suspense>
        </TourStartContext.Provider>
      </div>
    </AuthContext.Provider>
  )
}
