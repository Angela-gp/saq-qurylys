export type Factor = {
  factor_code: string
  title: string
  points: number
  evidence_id?: number
  quote?: string
  source?: string
  source_url?: string
  captured_at?: string
}
export type Score = {
  score: number
  zone: 'green' | 'yellow' | 'red'
  zone_label: string
  factors: Factor[]
  needs_review: { factor_code: string; reason: string; evidence_id?: number }[]
}
export type HousingObject = {
  id: number
  name: string
  developer: string
  bin: string | null
  address: string
  region: string
  status: string
  readiness: number | null
  declared_readiness: number | null
  legal_basis_status: string
  legal_basis_type: string | null
  latitude: number | null
  longitude: number | null
  is_demo: boolean
  legal_check?: { status: 'found' | 'not_found' | 'no_dataset'; dataset_name: string; imported_at: string; source_url: string; registry_record_id: number | null } | null
  created_at?: string
  score: Score
}
export type Evidence = {
  id: number
  factor_code: string
  status: string
  quote?: string
  source: string
  source_url?: string
  rationale: string
  captured_at?: string
  reviewed_by?: string | null
  reviewed_at?: string | null
  publication_id?: number
}
export type Source = {
  id?: string
  name: string
  url: string
  status: string
  message?: string
  message_code?: string
  fetched_at?: string
  record_count?: number
  imported_at?: string | null
  dataset_name?: string
  connection_mode?: string
}
export type PaymentExtraction = {
  has_payment_offer: boolean
  payment_type?: string | null
  amount?: string | null
  quote?: string | null
  confidence: number
  reasoning: string
  quote_valid: boolean
  reliable: boolean
  mode: string
}
export type MatchCandidate = {
  object_id: number
  name: string
  developer: string
  confidence: number
  score: Score
}
export type TelegramImportResponse = {
  channel: string
  imported: number
  captured_at: string
  messages: { publication_id: number; published_at: string | null; captured_at: string | null; source_url: string | null; text: string; extraction: PaymentExtraction; matches: MatchCandidate[] }[]
}
export type PublicationResult = {
  publication_id: number
  housing_object_id: number | null
  extraction: PaymentExtraction
  evidence: Evidence[]
  matches: MatchCandidate[]
}
export type SignalComment = { author: string; text: string; created_at: string }
export type ApiSignal = {
  id: number
  housing_object_id: number
  object_name: string
  is_demo: boolean
  status: 'draft' | 'in_review' | 'confirmed' | 'returned'
  author: string
  comments: SignalComment[]
  score_snapshot: Score
  updated_at: string
}
export type ReviewResponse = { evidence: Evidence; score: Score }
export type ImportResponse = {
  uploaded_rows: number
  imported_objects: number
  duplicates_skipped: number
  updated_objects?: number
  accepted?: { row_number: number; status: string; object_id?: number }[]
  skipped?: { row_number: number; reason_code: string }[]
  message_code?: string
}
export type PublicationLinkResult = {
  publication_id: number
  housing_object_id: number
  evidence: Evidence[]
}
export type SignalCreateResponse = {
  id: number
  status: ApiSignal['status']
  score_snapshot: Score
}
export type SignalTransitionResponse = {
  id: number
  status: ApiSignal['status']
  comments: SignalComment[]
}
export type SessionUser = { username: string; display_name: string; role: 'analyst' | 'observer' }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, { ...init, credentials: 'same-origin' })
  } catch {
    throw new Error('network_error')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error_code || body.detail || `api_error:${response.status}`)
  }
  return response.json()
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  currentUser: async (): Promise<SessionUser | null> => {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' })
    if (response.status === 401) return null
    if (!response.ok) throw new Error('api_unavailable')
    const body = await response.json()
    return body.user as SessionUser
  },
  login: (username: string, password: string) =>
    request<{ user: SessionUser }>('/auth/login', json('POST', { username, password })),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  health: () => request<{ status: string }>('/health'),
  objects: () => request<HousingObject[]>('/objects'),
  object: (id: number) =>
    request<
      HousingObject & {
        evidence: Evidence[]
        source_checks: { id: number; source_id: string; status: string; actor: string; comment: string; source_url?: string; created_at: string }[]
        publications: { id: number; text: string; extraction: Record<string, unknown> }[]
      }
    >(`/objects/${id}`),
  sources: () => request<Source[]>('/sources'),
  signals: () => request<ApiSignal[]>('/signals'),
  addObject: (body: object) => request<HousingObject>('/objects', json('POST', body)),
  addPublication: (body: object) => request<PublicationResult>('/publications', json('POST', body)),
  linkPublication: (id: number, housing_object_id: number) =>
    request<PublicationLinkResult>(
      `/publications/${id}/object`,
      json('PATCH', { housing_object_id }),
    ),
  reviewEvidence: (id: number, body: object) =>
    request<ReviewResponse>(`/evidence/${id}/review`, json('PATCH', body)),
  legalBasis: (id: number, body: object) =>
    request<HousingObject>(`/objects/${id}/legal-basis`, json('PATCH', body)),
  checkLegalBasis: (id: number) =>
    request<NonNullable<HousingObject['legal_check']>>(`/objects/${id}/legal-check/ashyq`, { method: 'POST' }),
  uploadPublicationScreenshot: (id: number, file: File) => {
    const data = new FormData()
    data.append('file', file)
    return request<{ path: string }>(`/publications/${id}/screenshot`, { method: 'POST', body: data })
  },
  addSignal: (body: object) => request<SignalCreateResponse>('/signals', json('POST', body)),
  transitionSignal: (id: number, body: object) =>
    request<SignalTransitionResponse>(`/signals/${id}/status`, json('PATCH', body)),
  importFile: (file: File) => {
    const data = new FormData()
    data.append('file', file)
    return request<ImportResponse>('/import/ashyq', { method: 'POST', body: data })
  },
  importTelegram: (file: File) => {
    const data = new FormData()
    data.append('file', file)
    return request<TelegramImportResponse>('/import/telegram', { method: 'POST', body: data })
  },
  sourceCheck: (id: number, body: object) => request(`/objects/${id}/source-checks`, json('POST', body)),
  seed: () =>
    request<{ message: string; objects: number; publications: number }>('/demo-seed', {
      method: 'POST',
    }),
}
