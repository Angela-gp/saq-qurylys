import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import { divIcon } from 'leaflet'
import { useTranslation } from 'react-i18next'
import { ApiSignal, api, HousingObject, PublicationResult } from './api'
import { previewFactorConfirmation, unchangedAfterRejection } from './utils/assessment'

const zoneName: Record<string, string> = {
  red: 'Красная',
  yellow: 'Жёлтая',
  green: 'Зелёная',
}
const statusName: Record<string, string> = {
  construction: 'Строится',
  under_construction: 'Строится',
  completed: 'Завершён',
  suspended: 'Приостановлен',
  unknown: 'Не проверено',
}
const signalStatusLabel: Record<ApiSignal['status'], string> = {
  draft: 'Черновик',
  in_review: 'На проверке',
  confirmed: 'Утверждена',
  returned: 'Возвращена',
}
function moneyZone(zone: string) {
  return `zone-${zone}`
}
function isDemoName(name: string) {
  return /^ДЕМО\s*[·•]/i.test(name)
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
function dateLabel(value?: string) {
  if (!value) return 'дата не указана'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'дата не указана'
    : new Intl.DateTimeFormat('ru-KZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}
function ScoreGauge({ score, zone, size = 'normal' }: { score: number; zone: string; size?: 'small' | 'normal' }) {
  const style = { '--score-fill': `${Math.max(0, Math.min(score, 100)) * 3.6}deg` } as CSSProperties
  return (
    <div
      className={`score-gauge ${size === 'small' ? 'score-gauge-small' : ''} ${moneyZone(zone)}`}
      style={style}
      role="img"
      aria-label={`Оценка ${score} из 100, ${zoneName[zone]}`}
    >
      <div>
        <strong>{score}</strong>
        <small>/ 100</small>
      </div>
    </div>
  )
}
function ErrorNote({ message }: { message: string }) {
  return <div className="notice error">{message}</div>
}
function EmptyState({ onImport }: { onImport: () => void }) {
  const { t } = useTranslation()
  return (
    <section className="empty-state">
      <div className="empty-icon">⌂</div>
      <h2>{t('empty')}</h2>
      <p>{t('emptyHint')}</p>
      <button className="button primary" onClick={onImport}>
        {t('import')}
      </button>
    </section>
  )
}
function MapViewport({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    const frame = requestAnimationFrame(() => {
      map.invalidateSize({ animate: false, pan: false })
      if (points.length === 1) {
        map.setView(points[0], 13, { animate: false })
        return
      }
      map.fitBounds(points, { padding: [48, 48], maxZoom: 14, animate: false })
    })
    return () => cancelAnimationFrame(frame)
  }, [map, points])
  return null
}
function MapSizeInvalidator() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    let frame = 0
    const invalidate = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => map.invalidateSize({ animate: false, pan: false }))
    }
    const observer = new ResizeObserver(invalidate)
    observer.observe(container)
    window.addEventListener('resize', invalidate)
    invalidate()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', invalidate)
    }
  }, [map])
  return null
}
function ObjectRow({ item, onSelect }: { item: HousingObject; onSelect: () => void }) {
  return (
    <button className="object-row" onClick={onSelect}>
      <span className={`zone-dot ${moneyZone(item.score.zone)}`} />
      <span className="object-main">
        <strong>
          {displayName(item.name)}
          {item.is_demo && <em className="demo-tag">ДЕМО</em>}
        </strong>
        <small>
          {item.developer || 'Застройщик не указан'} · {item.address || 'Адрес не указан'}
        </small>
      </span>
      <span className="score-value">
        {item.score.score}
        <small> / 100</small>
      </span>
      <span className={`pill ${moneyZone(item.score.zone)}`}>{zoneName[item.score.zone]}</span>
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
  const objectsQuery = useQuery({ queryKey: ['objects'], queryFn: api.objects })
  const hasDemoData = objectsQuery.data?.some((object) => object.is_demo) ?? false
  return (
    <div className={`app-shell ${dashboard ? 'dashboard-shell' : ''}`}>
      <aside className="sidebar">
        <Link className="brand" to="/" title="SAQ QURYLYS" aria-label="SAQ QURYLYS · Обзор">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M3 14 16 4l13 10M6 12v16h10v-9h5v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="m23 17 5 1.8v4.1c0 3.1-2.1 4.8-5 6.1-2.9-1.3-5-3-5-6.1v-4.1l5-1.8Z" fill="#fff" stroke="#d6a83f" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="m21 22.5 1.4 1.4 2.8-3" stroke="#176f90" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand-copy">
            SAQ<span className="brand-light"> QURYLYS</span>
            <small>Қауіпсіз құрылыс · безопасное строительство</small>
          </span>
        </Link>
        <nav>
          {[
            ['/', t('overview'), '◫'],
            ['/registry', t('registry'), '▤'],
            ['/ads', t('ads'), '⌕'],
            ['/signals', t('signals'), '⚑'],
            ['/sources', t('sources'), '↗'],
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
          {dashboard ? (
            <>
              <h1 className="dashboard-top-title">{title}</h1>
              {hasDemoData && <span className="top-demo-notice">Демонстрационные данные · не юридическое заключение</span>}
            </>
          ) : (
            <div className="crumb">
              Система мониторинга <span>/</span> {title}
            </div>
          )}
          <div className="top-actions">
            <span className="api-status">
              <i /> API подключено
            </span>
            <button
              className="lang"
              onClick={() => i18n.changeLanguage(i18n.language === 'ru' ? 'kk' : 'ru')}
            >
              {i18n.language === 'ru' ? 'RU' : 'KZ'}⌄
            </button>
            {!dashboard && <div className="avatar">А</div>}
          </div>
        </header>
        <div className={`page ${dashboard ? 'overview-page' : ''}`}>
          {!dashboard && hasDemoData && (
            <div className="demo-banner" role="note">
              <span className="demo-banner-mark">Д</span>
              <span><strong>Демонстрационные данные</strong> · не юридическое заключение</span>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                SAQ QURYLYS <span>•</span> КАЗАХСТАН
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
function UploadControl({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const upload = async (file?: File) => {
    if (!file) return
    setError('')
    setMessage('')
    try {
      const result = await api.importFile(file)
      setMessage(`Добавлено объектов: ${result.imported_objects}. Дубликаты пропущены.`)
      onDone()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <div className="upload-wrap">
      <label className="button secondary">
        ↑ Импорт Ashyq
        <input
          type="file"
          accept=".csv,.xlsx,.xlsm"
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </label>
      {message && <span className="inline-success">{message}</span>}
      {error && <ErrorNote message={error} />}
    </div>
  )
}
function ObjectModal({ item, onClose }: { item: HousingObject; onClose: () => void }) {
  const client = useQueryClient()
  const [evidenceUrls, setEvidenceUrls] = useState<Record<number, string>>({})
  const detail = useQuery({ queryKey: ['object', item.id], queryFn: () => api.object(item.id) })
  const evidenceMutation = useMutation({
    mutationFn: ({ id, status, sourceUrl }: { id: number; status: string; sourceUrl?: string }) =>
      api.reviewEvidence(id, {
        status,
        reviewer: 'Аналитик SAQ',
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
        analyst: 'Аналитик SAQ',
        note: 'Результат ручной проверки источника и документа.',
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['objects'] })
      client.invalidateQueries({ queryKey: ['object', item.id] })
    },
  })
  const current = detail.data
  const displayedObject = current ?? item
  const rejectionScenario = unchangedAfterRejection(displayedObject.score)
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          ×
        </button>
        <div className="eyebrow">КАРТОЧКА ОБЪЕКТА · #{item.id}</div>
        <h2>
          {displayName(item.name)} {item.is_demo && <em className="demo-tag">ДЕМО</em>}
        </h2>
        <p className="muted">
          {displayDeveloper(item.developer) || 'Застройщик не указан'} · {displayAddress(item.address) || 'Адрес не указан'}
        </p>
        <div className="object-meta-line">
          <span>Стадия: {statusName[displayedObject.status] || displayedObject.status || 'Не проверено'}</span>
          <span>Готовность: {displayedObject.readiness == null ? 'не указана' : `${Math.round(displayedObject.readiness)}%`}</span>
        </div>
        <div className={`score-panel object-score-panel ${moneyZone(displayedObject.score.zone)}`}>
          <ScoreGauge score={displayedObject.score.score} zone={displayedObject.score.zone} />
          <div>
            <small>ТЕКУЩАЯ ОЦЕНКА</small>
            <span className={`pill ${moneyZone(displayedObject.score.zone)}`}>
              {zoneName[displayedObject.score.zone]}
            </span>
          </div>
        </div>
        <h3>Факторы и проверка</h3>
        {displayedObject.score.factors.length ? (
          displayedObject.score.factors.map((f, n) => (
            <div className="factor-line" id={f.evidence_id ? `evidence-${f.evidence_id}` : undefined} key={n}>
              <b>{f.factor_code}</b>
              <span className="factor-detail">
                <span className="factor-title-line">
                  {f.title}
                  <span className="fact-tag">ФАКТ</span>
                </span>
                <small>
                  {f.source_url ? (
                    <a href={f.source_url} target="_blank">
                      Источник ↗
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
          <p className="muted">Нет подтверждённых факторов.</p>
        )}
        <section className="risk-explanation" aria-labelledby="risk-explanation-title">
          <h3 id="risk-explanation-title">Почему такая оценка</h3>
          <p className="risk-explanation-lead">
            {zoneName[displayedObject.score.zone]} зона · {displayedObject.score.score} баллов из 100.
            {displayedObject.score.factors.length
              ? ' Оценка основана на подтверждённых факторах:'
              : ' Подтверждённых факторов пока нет; непроверенные данные баллы не увеличивают.'}
          </p>
          {displayedObject.score.factors.length > 0 && (
            <ul className="risk-evidence-links">
              {displayedObject.score.factors.map((factor, index) => (
                <li key={`${factor.factor_code}-${factor.evidence_id ?? index}`}>
                  {factor.evidence_id ? (
                    <a href={`#evidence-${factor.evidence_id}`}>
                      {factor.factor_code}: {factor.title}
                      {factor.quote ? <> · «{factor.quote}»</> : null}
                      <small>Подтверждено {dateLabel(factor.captured_at)} · открыть доказательство</small>
                    </a>
                  ) : (
                    <span>{factor.factor_code}: {factor.title} · {dateLabel(factor.captured_at)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {displayedObject.score.zone === 'red' && (
            <small className="risk-rule-note">Красная зона требует не менее 60 баллов и подтверждённых R1 и R2.</small>
          )}
        </section>
        {displayedObject.score.needs_review.length > 0 && (
          <section className="what-if-panel" aria-labelledby="what-if-title">
            <h3 id="what-if-title">Что проверить дальше</h3>
            <p className="what-if-disclaimer">Сценарии ниже не меняют текущий балл. Оценка пересчитается только после решения аналитика.</p>
            {displayedObject.score.needs_review.map((review, index) => {
              const confirmedScenario = previewFactorConfirmation(displayedObject.score, review.factor_code)
              const isUnverifiedBasis = review.factor_code === 'R1' && review.evidence_id == null
              return (
                <div className="what-if-item" key={`${review.factor_code}-${review.evidence_id ?? index}`}>
                  <b>{review.factor_code} · {review.reason}</b>
                  <p>
                    Если {isUnverifiedBasis ? 'проверка подтвердит отсутствие правового основания' : 'гипотеза подтвердится'}:
                    {' '}{displayedObject.score.score} → {confirmedScenario.score} баллов · {zoneName[confirmedScenario.zone]} зона
                    {confirmedScenario.addedPoints > 0 ? ` · +${confirmedScenario.addedPoints}` : ''}.
                  </p>
                  <small>
                    Если {isUnverifiedBasis ? 'найдётся действующее основание' : 'гипотеза не подтвердится'}:
                    {' '}{rejectionScenario.score} баллов · {zoneName[rejectionScenario.zone]} зона.
                  </small>
                </div>
              )
            })}
          </section>
        )}
        {displayedObject.score.needs_review.length === 0 && (
          <p className="review-clear">Нет факторов, ожидающих решения. Балл рассчитан по подтверждённым данным.</p>
        )}
        <h3>Проверка правового основания</h3>
        <div className="form-grid">
          <select value={basisStatus} onChange={(e) => setBasisStatus(e.target.value)}>
            <option value="not_checked">Не проверено</option>
            <option value="absent">Проверено: отсутствует</option>
            <option value="confirmed">Проверено: подтверждено</option>
          </select>
          {basisStatus === 'confirmed' && (
            <input
              placeholder="Тип разрешения / гарантии"
              value={basisType}
              onChange={(e) => setBasisType(e.target.value)}
            />
          )}
          <input
            placeholder="Ссылка на проверенный источник"
            value={basisUrl}
            onChange={(e) => setBasisUrl(e.target.value)}
          />
          <button className="button secondary" onClick={() => saveBasis.mutate()}>
            Сохранить проверку
          </button>
        </div>
        {saveBasis.isError && <ErrorNote message={(saveBasis.error as Error).message} />}
        <h3>Гипотезы из объявлений</h3>
        {current?.evidence
          .filter((e) => e.status === 'ai_hypothesis')
          .map((e) => (
            <div className="hypothesis" key={e.id}>
              <div>
                <span className="pill hypothesis-pill">ГИПОТЕЗА · {e.factor_code}</span>
                <p>«{e.quote}»</p>
                <small>{e.rationale}</small>
              </div>
              <div className="review-buttons">
                <input
                  aria-label="Ссылка на источник"
                  type="url"
                  placeholder="Ссылка на источник"
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
                  Подтвердить
                </button>
                <button onClick={() => evidenceMutation.mutate({ id: e.id, status: 'rejected' })}>
                  Отклонить
                </button>
              </div>
            </div>
          ))}
        {evidenceMutation.isError && (
          <ErrorNote message={(evidenceMutation.error as Error).message} />
        )}
        {current?.evidence.filter((e) => e.status === 'ai_hypothesis').length === 0 && (
          <p className="muted">Новых гипотез нет.</p>
        )}
        <div className="modal-footer">
          <button className="button secondary" onClick={() => window.print()}>
            Печать / PDF
          </button>
          <button className="button primary" onClick={onClose}>
            Готово
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
  const [showCreate, setShowCreate] = useState(false)
  const rowRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const data = useQuery({ queryKey: ['objects'], queryFn: api.objects })
  const objects = useMemo(() => data.data ?? [], [data.data])
  const mappableObjects = useMemo(
    () => objects.filter((object) => object.latitude != null && object.longitude != null),
    [objects],
  )
  const mapPoints = useMemo(
    () => mappableObjects.map((object) => [object.latitude!, object.longitude!] as [number, number]),
    [mappableObjects],
  )
  const counts = useMemo(
    () => ({
      red: objects.filter((o) => o.score.zone === 'red').length,
      yellow: objects.filter((o) => o.score.zone === 'yellow').length,
      green: objects.filter((o) => o.score.zone === 'green').length,
      review: objects.filter((o) => o.score.needs_review.length > 0).length,
    }),
    [objects],
  )
  const filtered = useMemo(
    () =>
      objects
        .filter((o) => zoneFilter === 'all' || (zoneFilter === 'review'
          ? o.score.needs_review.length > 0
          : o.score.zone === zoneFilter))
        .filter((o) => `${displayName(o.name)} ${o.developer} ${o.address}`.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => b.score.score - a.score.score || a.name.localeCompare(b.name, 'ru')),
    [objects, search, zoneFilter],
  )
  useEffect(() => {
    if (selectedId != null && filtered.some((object) => object.id === selectedId)) {
      rowRefs.current[selectedId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [filtered, selectedId])
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
    <Shell title="Обзор" dashboard>
      <div className="overview-layout">
        <section className="overview-queue" aria-label="Очередь объектов">
          <div className="queue-header">
            <div className="queue-heading-line">
              <div>
                <h2>Объекты</h2>
                <span>{filtered.length} из {objects.length} · по баллу риска</span>
              </div>
              <div className="queue-actions">
                {!objects.some((object) => object.is_demo) && (
                  <button className="icon-action" title="Загрузить демонстрационные данные" aria-label="Загрузить демонстрационные данные" onClick={() => demoSeed.mutate()} disabled={demoSeed.isPending}>⇩</button>
                )}
                <UploadControl onDone={() => client.invalidateQueries({ queryKey: ['objects'] })} />
                <button className="icon-action add-object-action" title={t('addObject')} aria-label={t('addObject')} onClick={() => setShowCreate(true)}>＋</button>
              </div>
            </div>
            <label className="table-search overview-search">
              <span aria-hidden="true">⌕</span>
              <input aria-label="Поиск по объектам" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по ЖК и застройщику" />
            </label>
            <div className="zone-filters" aria-label="Фильтр зон риска">
              {(['red', 'yellow', 'green'] as const).map((zone) => (
                <button
                  key={zone}
                  className={`zone-filter ${moneyZone(zone)} ${zoneFilter === zone ? 'active' : ''}`}
                  onClick={() => setZoneFilter(zoneFilter === zone ? 'all' : zone)}
                  aria-pressed={zoneFilter === zone}
                >
                  <span>{zoneName[zone]}</span><strong>{counts[zone]}</strong>
                </button>
              ))}
              <button
                className={`zone-filter review-filter ${zoneFilter === 'review' ? 'active' : ''}`}
                onClick={() => setZoneFilter(zoneFilter === 'review' ? 'all' : 'review')}
                aria-pressed={zoneFilter === 'review'}
                title="Объекты с неподтверждёнными факторами или основанием"
              >
                <span>Нужна проверка</span><strong>{counts.review}</strong>
              </button>
            </div>
          </div>
          {data.isError && <ErrorNote message={(data.error as Error).message} />}
          {demoSeed.isError && <ErrorNote message={(demoSeed.error as Error).message} />}
          {data.isLoading ? (
            <div className="overview-loading" aria-label="Загрузка объектов">
              {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
            </div>
          ) : objects.length === 0 ? (
            <EmptyState onImport={() => document.querySelector<HTMLInputElement>('.upload-wrap input')?.click()} />
          ) : filtered.length === 0 ? (
            <p className="muted overview-no-results">Объекты по этому фильтру не найдены.</p>
          ) : (
            <div className="overview-object-list" aria-label="Список жилых комплексов">
              {filtered.map((object) => {
                const hypotheses = object.score.needs_review.filter((factor) => factor.reason.startsWith('Гипотеза'))
                return (
                  <button
                    className={`overview-object-row ${selectedId === object.id ? 'selected' : ''}`}
                    key={object.id}
                    ref={(node) => { rowRefs.current[object.id] = node }}
                    onClick={() => setSelectedId(object.id)}
                    onMouseEnter={() => setHoveredId(object.id)}
                    onMouseLeave={() => setHoveredId((current) => current === object.id ? null : current)}
                    aria-pressed={selectedId === object.id}
                  >
                    <span className={`object-zone-rail ${moneyZone(object.score.zone)}`} />
                    <span className="overview-object-identity">
                      <strong>{displayName(object.name)}</strong>
                      <small>{displayDeveloper(object.developer) || 'Застройщик не указан'}</small>
                    </span>
                    <span className="overview-row-factors" aria-label="Подтверждённые факторы">
                      {object.score.factors.map((factor) => (
                        <i className="factor-chip confirmed" key={factor.evidence_id || factor.factor_code} title={`${factor.title} · +${factor.points}`}>{factor.factor_code}</i>
                      ))}
                      {hypotheses.map((factor, index) => (
                        <i className="factor-chip hypothesis" key={`${factor.factor_code}-${index}`} title={factor.reason}>{factor.factor_code}</i>
                      ))}
                    </span>
                    <span className="overview-row-score">
                      <strong>{object.score.score}</strong>
                      <small>{zoneName[object.score.zone]}</small>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>
        <section className="overview-map-panel" aria-label="Карта жилых комплексов">
          <div className="overview-map-heading">
            <h2>Карта объектов</h2>
            <span>{mappableObjects.length} с координатами</span>
          </div>
          {mappableObjects.length ? (
            <MapContainer center={[49.96, 82.61]} zoom={12} scrollWheelZoom className="overview-leaflet-map">
              <MapSizeInvalidator />
              <MapViewport points={mapPoints} />
              <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {mappableObjects.map((object) => (
                <Marker
                  key={object.id}
                  position={[object.latitude!, object.longitude!]}
                  icon={divIcon({
                    className: 'zone-marker-icon',
                    html: `<span class="map-score-marker ${moneyZone(object.score.zone)} ${selectedId === object.id ? 'selected' : ''} ${hoveredId === object.id ? 'hovered' : ''}">${object.score.score}</span>`,
                    iconSize: [38, 38],
                    iconAnchor: [19, 19],
                  })}
                  eventHandlers={{ click: () => selectFromMap(object.id) }}
                >
                  <Popup>
                    <strong>{displayName(object.name)}</strong>
                    <br />{object.score.score} баллов · {zoneName[object.score.zone]}
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          ) : (
            <div className="map-empty overview-map-empty">
              <div className="map-grid"><span>⌖</span></div>
              <b>Нет объектов с координатами</b>
              <small>На карту попадают только проверенные координаты из записи объекта.</small>
            </div>
          )}
        </section>
      </div>
      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form className="modal small-modal" onClick={(e) => e.stopPropagation()} onSubmit={onCreate}>
            <button type="button" className="modal-close" onClick={() => setShowCreate(false)}>×</button>
            <div className="eyebrow">НОВАЯ ЗАПИСЬ</div>
            <h2>Добавить объект</h2>
            <p className="muted">Неизвестные сведения останутся непроверенными.</p>
            <input required name="name" placeholder="Название ЖК" />
            <input name="developer" placeholder="Застройщик" />
            <input name="address" placeholder="Адрес из источника" />
            <input name="region" placeholder="Регион" />
            <div className="modal-footer">
              <button className="button secondary" type="button" onClick={() => setShowCreate(false)}>Отмена</button>
              <button className="button primary">Создать</button>
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
  const client = useQueryClient()
  const data = useQuery({ queryKey: ['objects'], queryFn: api.objects })
  const [selected, setSelected] = useState<HousingObject | null>(null)
  return (
    <Shell
      title="Реестр"
      subtitle="Объекты, загруженные из источников или добавленные аналитиком."
      action={<UploadControl onDone={() => client.invalidateQueries({ queryKey: ['objects'] })} />}
    >
      <section className="panel registry-full">
        <div className="panel-heading">
          <div>
            <h2>Все объекты</h2>
            <p>{data.data?.length || 0} записей в локальной базе</p>
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
function AdsPage() {
  const client = useQueryClient()
  const objects = useQuery({ queryKey: ['objects'], queryFn: api.objects })
  const [result, setResult] = useState<PublicationResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
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
      client.invalidateQueries({ queryKey: ['objects'] })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Shell
      title="Мониторинг рекламы"
      subtitle="Вставьте текст публикации. Извлечение условий оплаты предлагает гипотезу, которую подтверждает аналитик."
    >
      <div className="two-col">
        <section className="panel form-panel">
          <div className="eyebrow">НОВОЕ НАБЛЮДЕНИЕ</div>
          <h2>Добавить объявление</h2>
          <form onSubmit={submit}>
            <label>
              Текст публикации
              <textarea
                name="text"
                required
                minLength={10}
                maxLength={20000}
                rows={9}
                placeholder="Вставьте текст объявления на русском или казахском…"
              />
            </label>
            <div className="form-grid">
              <label>
                Площадка / источник
                <input name="source" defaultValue="ручной ввод" />
              </label>
              <label>
                Ссылка на публикацию
                <input name="url" type="url" placeholder="https://…" />
              </label>
            </div>
            <label>
              Объект{' '}
              <select name="object_id">
                <option value="">Пока не связывать</option>
                {(objects.data || []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              Сопоставление по тексту помогает найти кандидатов, но не выбирает объект
              автоматически.
            </p>
            <button className="button primary" disabled={busy}>
              {busy ? 'Анализ…' : 'Извлечь условия оплаты'}
            </button>
          </form>
          {error && <ErrorNote message={error} />}
        </section>
        <section className="panel result-panel">
          <div className="eyebrow">РЕЗУЛЬТАТ РАЗБОРА</div>
          {!result ? (
            <div className="result-placeholder">
              <span>⌕</span>
              <h3>Пока нет результатов</h3>
              <p>Сформируем цитату из исходного текста и отметим способ анализа.</p>
            </div>
          ) : (
            <>
              <h2>
                {result.extraction.has_payment_offer
                  ? 'Найдены слова об оплате'
                  : 'Условия оплаты не обнаружены'}
              </h2>
              <span className="pill muted-pill">
                {result.extraction.mode === 'llm' ? 'LLM + проверка цитаты' : 'локальные правила'}
              </span>
              {result.extraction.quote && <blockquote>«{result.extraction.quote}»</blockquote>}
              <p>{result.extraction.reasoning}</p>
              <p className="muted">
                Уверенность: {Math.round(result.extraction.confidence * 100)}%. Это гипотеза, а не
                юридическая оценка.
              </p>
              {result.evidence.map((e) => (
                <div className="notice" key={e.id}>
                  Гипотеза {e.factor_code} добавлена в карточку объекта для подтверждения.
                </div>
              ))}
              {result.matches?.length > 0 && (
                <div>
                  <h3>Похожие названия</h3>
                  {result.matches.slice(0, 3).map((m) => (
                    <div className="match-row" key={m.object_id}>
                      <span>
                        {m.name} · {Math.round(m.confidence * 100)}%
                      </span>
                      {result.housing_object_id === m.object_id ? (
                        <b>Объект выбран</b>
                      ) : !result.housing_object_id ? (
                        <button
                          onClick={() =>
                            linkCandidate.mutate({
                              publicationId: result.publication_id,
                              objectId: m.object_id,
                            })
                          }
                        >
                          Связать
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
  const client = useQueryClient()
  const signals = useQuery({ queryKey: ['signals'], queryFn: api.signals })
  const objects = useQuery({ queryKey: ['objects'], queryFn: api.objects })
  const [error, setError] = useState('')
  const [printTarget, setPrintTarget] = useState<number | null>(null)
  const create = useMutation({
    mutationFn: (id: number) => api.addSignal({ housing_object_id: id, author: 'Аналитик SAQ' }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['signals'] })
      client.invalidateQueries({ queryKey: ['objects'] })
    },
  })
  const transition = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.transitionSignal(id, {
        status,
        author: 'Аналитик SAQ',
        comment:
          status === 'returned' ? 'Добавьте подтверждающие документы и уточните источник.' : '',
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['signals'] }),
    onError: (err) => setError((err as Error).message),
  })
  return (
    <Shell
      title="Сигнальные карточки"
      subtitle="Карточки проходят проверку по подтверждённым источникам. Утверждённую карточку можно распечатать."
    >
      <div className="panel signal-create">
        <div>
          <h2>Создать карточку</h2>
          <p>Выберите объект для фиксации текущей оценки и источников.</p>
        </div>
        <select id="signal-object">
          <option value="">Выберите объект</option>
          {(objects.data || []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {o.score.score} баллов
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
          ＋ Создать
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
              <span className={`pill status-${s.status}`}>{signalStatusLabel[s.status]}</span>
              <small>
                Карточка #{s.id} · {s.author}
              </small>
              <button
                className="button secondary print-only-hidden"
                onClick={() => {
                  setPrintTarget(s.id)
                  window.onafterprint = () => setPrintTarget(null)
                  window.setTimeout(() => window.print(), 100)
                }}
              >
                Печать / PDF
              </button>
            </div>
            <h2>{displayName(s.object_name)} {isDemoName(s.object_name) && <em className="demo-tag">ДЕМО</em>}</h2>
            <div className={`score-panel ${moneyZone(s.score_snapshot?.zone || 'green')}`}>
              <strong>
                {s.score_snapshot?.score ?? 0}
                <i> / 100</i>
              </strong>
              <span>{zoneName[s.score_snapshot?.zone] || 'Плановый мониторинг'}</span>
            </div>
            <div className="signal-factors">
              {(s.score_snapshot?.factors || []).map((f, i) => (
                <p key={i}>
                  <b>
                    {f.factor_code} +{f.points}
                  </b>{' '}
                  · {f.title}
                  {f.source_url && (
                    <>
                      {' '}
                      ·{' '}
                      <a href={f.source_url} target="_blank">
                        источник
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
            <div className="signal-actions print-only-hidden">
              {s.status === 'draft' && (
                <button onClick={() => transition.mutate({ id: s.id, status: 'in_review' })}>
                  Передать на проверку →
                </button>
              )}
              {s.status === 'in_review' && (
                <>
                  <button onClick={() => transition.mutate({ id: s.id, status: 'confirmed' })}>
                    Утвердить
                  </button>
                  <button onClick={() => transition.mutate({ id: s.id, status: 'returned' })}>
                    Вернуть с комментарием
                  </button>
                </>
              )}
              {s.status === 'returned' && (
                <button onClick={() => transition.mutate({ id: s.id, status: 'in_review' })}>
                  Повторная проверка →
                </button>
              )}
            </div>
          </article>
        ))}
        {!signals.data?.length && (
          <section className="empty-state">
            <div className="empty-icon">⚑</div>
            <h2>Карточек пока нет</h2>
            <p>Создайте карточку из подтверждённых фактов объекта.</p>
          </section>
        )}
      </div>
    </Shell>
  )
}
function SourcesPage() {
  const sources = useQuery({ queryKey: ['sources'], queryFn: api.sources })
  return (
    <Shell
      title="Открытые источники"
      subtitle="Интеграции обозначены по фактическому уровню доступа. Только Ashyq metadata читается через API; остальные источники проверяются вручную."
    >
      <section className="panel sources-list">
        {sources.isLoading && <p>Проверяем доступность метаданных Ashyq…</p>}
        {(sources.data || []).map((s, i) => (
          <article className="source-row" key={s.id || i}>
            <div className={`source-indicator ${s.status === 'available' ? 'online' : ''}`} />
            <div>
              <b>{s.name}</b>
              <small>
                {s.message ||
                  (s.status === 'available' ? 'Метаданные доступны' : 'Проверка вручную')}
              </small>
            </div>
            <span className="source-state">
              {s.status === 'available'
                ? 'ДОСТУПЕН'
                : s.status === 'api_metadata'
                  ? 'API МЕТАДАННЫХ'
                  : 'РУЧНАЯ ПРОВЕРКА'}
            </span>
            <a className="button secondary" href={s.url} target="_blank" rel="noreferrer">
              Открыть ↗
            </a>
          </article>
        ))}
      </section>
      <div className="source-note">
        <b>Как читать статусы</b>
        <p>
          Неподключённый источник не трактуется как отсутствие разрешения. R1 появляется только
          после ручной проверки аналитиком с сохранением ссылки.
        </p>
      </div>
    </Shell>
  )
}
export default function App() {
  const navigate = useNavigate()
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/registry" element={<RegistryPage />} />
      <Route path="/ads" element={<AdsPage />} />
      <Route path="/signals" element={<SignalsPage />} />
      <Route path="/sources" element={<SourcesPage />} />
      <Route path="*" element={<button onClick={() => navigate('/')}>На главную</button>} />
    </Routes>
  )
}
