import { CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { markTourSeen, skipUnavailableObjectStep, tourScrimRects } from '../utils/preferences'

const TOUR_STEPS = [
  { target: '[data-tour="queue"]', route: '/', key: 1, action: false },
  { target: '[data-tour="demo-pill"]', route: '/', key: 2, action: false },
  { target: '[data-tour="demo-load"]', route: '/', key: 3, action: true },
  { target: '[data-tour="zone-filters"]', route: '/', key: 4, action: true },
  { target: '[data-tour="red-object"]', route: '/', key: 5, action: true },
  { target: '[data-tour="score-breakdown"]', route: '/', key: 6, action: false },
  { target: '[data-tour="what-if"]', route: '/', key: 7, action: false },
  { target: '[data-tour="ads-form"]', route: '/ads', key: 8, action: false },
  { target: '[data-tour="signal-page"]', route: '/signals', key: 9, action: false },
]

export default function GuidedTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const [missing, setMissing] = useState(false)
  const advanceRef = useRef<() => void>(() => undefined)
  const steps = TOUR_STEPS
  const step = steps[stepIndex]
  const finish = useCallback(() => {
    markTourSeen(true)
    setTargetRect(null)
    setStepIndex(0)
    onClose()
  }, [onClose])
  const skip = useCallback(() => {
    markTourSeen()
    setTargetRect(null)
    setStepIndex(0)
    onClose()
  }, [onClose])
  const advance = useCallback(() => {
    setMissing(false)
    setTargetRect(null)
    if (stepIndex >= steps.length - 1) finish()
    else setStepIndex((index) => index + 1)
  }, [finish, stepIndex, steps.length])
  useEffect(() => { advanceRef.current = advance }, [advance])
  const back = useCallback(() => {
    setMissing(false)
    setTargetRect(null)
    setStepIndex((index) => Math.max(0, index - 1))
  }, [])

  useEffect(() => {
    if (!open || !step) return
    if (location.pathname !== step.route) {
      navigate(step.route)
      return
    }
    let target: Element | null = null
    let frame = 0
    let updatePosition: () => void = () => {}
    const targetClick = () => advanceRef.current()
    const timer = window.setTimeout(() => {
      target = document.querySelector(step.target)
      if (!target) {
        const jumpTo = skipUnavailableObjectStep(step.key, steps.length - 1)
        if (jumpTo != null) {
          setStepIndex(jumpTo)
          setTargetRect(null)
          return
        }
        setMissing(true)
        setTargetRect(null)
        return
      }
      target.classList.add('tour-target')
      target.classList.add(step.action ? 'tour-action-target' : 'tour-passive-target')
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      updatePosition = () => setTargetRect(target?.getBoundingClientRect() ?? null)
      frame = requestAnimationFrame(updatePosition)
      window.addEventListener('resize', updatePosition)
      window.addEventListener('scroll', updatePosition, true)
      if (step.action) target.addEventListener('click', targetClick, { once: true })
    }, 100)
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus()
    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      target?.removeEventListener('click', targetClick)
      target?.classList.remove('tour-target')
      target?.classList.remove('tour-action-target', 'tour-passive-target')
    }
  }, [location.pathname, navigate, open, step, steps.length])

  if (!open || !step) return null
  const scrimRects = tourScrimRects(targetRect, window.innerWidth, window.innerHeight)
  const popoverStyle: CSSProperties = targetRect
    ? {
        top: Math.min(targetRect.bottom + 12, window.innerHeight - 210),
        left: Math.min(Math.max(12, targetRect.left), window.innerWidth - 352),
      }
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  return (
    <div className="tour-layer" role="presentation">
      <div className="tour-scrim" aria-hidden="true">
        {scrimRects.map((rect, index) => (
          <span
            className="tour-scrim-block"
            key={index}
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          />
        ))}
      </div>
      {targetRect && !step.action && (
        <span
          className="tour-passive-guard"
          aria-hidden="true"
          style={{ left: targetRect.left, top: targetRect.top, width: targetRect.width, height: targetRect.height }}
        />
      )}
      <section
        className="tour-popover"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        style={popoverStyle}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); skip() }
          else if (event.key === 'ArrowRight') { event.preventDefault(); advance() }
          else if (event.key === 'ArrowLeft') { event.preventDefault(); back() }
          else if (event.key === 'Tab') {
            const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button') ?? [])]
            if (controls.length && event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1]?.focus() }
            else if (controls.length && !event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus() }
          }
        }}
      >
        <div className="tour-count">{t('tour.stepOf', { current: stepIndex + 1, total: steps.length })}</div>
        <h2 id="tour-title">{t(`tour.step${step.key}.title`)}</h2>
        <p>{missing ? t('tour.fallback') : t(`tour.step${step.key}.body`)}</p>
        <strong className="tour-action-hint">{step.action && !missing ? t('tour.clickHere') : t('tour.noAction')}</strong>
        <div className="tour-controls">
          <button className="button secondary" onClick={back} disabled={stepIndex === 0}>{t('tour.back')}</button>
          <button className="button primary" onClick={advance}>{stepIndex === steps.length - 1 ? t('common.done') : t('tour.next')}</button>
          <button className="tour-skip" onClick={skip}>{t('tour.skip')}</button>
        </div>
      </section>
    </div>
  )
}
