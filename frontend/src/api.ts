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
  fetched_at?: string
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
  message: string
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.detail || `Ошибка API ${response.status}`)
  }
  return response.json()
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  objects: () => request<HousingObject[]>('/objects'),
  object: (id: number) =>
    request<
      HousingObject & {
        evidence: Evidence[]
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
  addSignal: (body: object) => request<SignalCreateResponse>('/signals', json('POST', body)),
  transitionSignal: (id: number, body: object) =>
    request<SignalTransitionResponse>(`/signals/${id}/status`, json('PATCH', body)),
  importFile: (file: File) => {
    const data = new FormData()
    data.append('file', file)
    return request<ImportResponse>('/import/ashyq', { method: 'POST', body: data })
  },
  seed: () =>
    request<{ message: string; objects: number; publications: number }>('/demo-seed', {
      method: 'POST',
    }),
}
