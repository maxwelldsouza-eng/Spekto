// Shared guided tour engine — used by client/dashboard.html and scout/dashboard.html

const PREFIX = 'spekto_tour_v1_'

const CSS = `
.tour-overlay {
  position: fixed;
  inset: 0;
  background: rgba(26,5,51,0.6);
  z-index: 9998;
  pointer-events: all;
}
.tour-ring {
  position: fixed;
  border-radius: 8px;
  border: 2.5px solid #560591;
  box-shadow: 0 0 0 4px rgba(86,5,145,0.18), 0 0 24px rgba(86,5,145,0.35);
  z-index: 9999;
  pointer-events: none;
  transition: all 0.25s ease;
}
.tour-tooltip {
  position: fixed;
  z-index: 10000;
  background: #fff;
  border-radius: 14px;
  padding: 22px;
  width: 288px;
  box-shadow: 0 8px 32px rgba(86,5,145,0.18), 0 2px 8px rgba(0,0,0,0.08);
  font-family: Inter, sans-serif;
  pointer-events: all;
  animation: tourFadeIn 0.2s ease;
}
@keyframes tourFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.tour-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #F5EEFF;
  color: #560591;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 20px;
  margin-bottom: 10px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}
.tour-title {
  font-size: 16px;
  font-weight: 700;
  color: #1A0533;
  margin-bottom: 8px;
  line-height: 1.3;
}
.tour-text {
  font-size: 13.5px;
  color: #6B7280;
  line-height: 1.55;
  margin-bottom: 20px;
}
.tour-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tour-skip {
  background: none;
  border: none;
  color: #9CA3AF;
  font-size: 12.5px;
  cursor: pointer;
  padding: 0;
  font-family: Inter, sans-serif;
  white-space: nowrap;
  transition: color 0.15s;
}
.tour-skip:hover { color: #6B7280; }
.tour-nav { display: flex; gap: 8px; }
.tour-back {
  background: #F5EEFF;
  border: none;
  color: #560591;
  font-size: 13px;
  font-weight: 600;
  padding: 9px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-family: Inter, sans-serif;
  transition: background 0.15s;
}
.tour-back:hover { background: #ede0ff; }
.tour-next {
  background: #560591;
  border: none;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  padding: 9px 18px;
  border-radius: 8px;
  cursor: pointer;
  font-family: Inter, sans-serif;
  transition: background 0.15s;
}
.tour-next:hover { background: #6b0ab5; }
.tour-progress {
  display: flex;
  gap: 4px;
  margin-bottom: 14px;
}
.tour-dot {
  height: 3px;
  border-radius: 2px;
  background: #E5E7EB;
  flex: 1;
  transition: background 0.2s;
}
.tour-dot.active { background: #560591; }
`

function injectStyles() {
  if (document.getElementById('_tour_styles')) return
  const s = document.createElement('style')
  s.id = '_tour_styles'
  s.textContent = CSS
  document.head.appendChild(s)
}

function getRect(selector) {
  const el = document.querySelector(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return r
}

function positionTooltip(tooltip, targetRect) {
  const W = 288
  const margin = 18
  const vw = window.innerWidth
  const vh = window.innerHeight
  const th = tooltip.offsetHeight || 200

  // Prefer right of target (sidebar items)
  let left = targetRect.right + margin
  let top = targetRect.top + targetRect.height / 2 - th / 2

  if (left + W > vw - 16) {
    // Try left of target
    left = targetRect.left - W - margin
  }

  if (left < 16) {
    // Fall back to below
    left = targetRect.left + targetRect.width / 2 - W / 2
    top = targetRect.bottom + margin
  }

  // Clamp to viewport
  left = Math.max(16, Math.min(left, vw - W - 16))
  top = Math.max(16, Math.min(top, vh - th - 16))

  tooltip.style.left = left + 'px'
  tooltip.style.top = top + 'px'
}

export function hasSeen(tourKey) {
  return !!localStorage.getItem(PREFIX + tourKey)
}

export function resetTour(tourKey) {
  localStorage.removeItem(PREFIX + tourKey)
}

export function startTour(steps, tourKey) {
  injectStyles()

  let step = 0

  const overlay = document.createElement('div')
  overlay.className = 'tour-overlay'

  const ring = document.createElement('div')
  ring.className = 'tour-ring'
  ring.style.display = 'none'

  const tooltip = document.createElement('div')
  tooltip.className = 'tour-tooltip'

  document.body.appendChild(overlay)
  document.body.appendChild(ring)
  document.body.appendChild(tooltip)

  function renderStep(i) {
    step = i
    const s = steps[i]

    // Position spotlight ring
    const rect = getRect(s.element)
    if (rect) {
      ring.style.display = 'block'
      ring.style.left = (rect.left - 5) + 'px'
      ring.style.top = (rect.top - 5) + 'px'
      ring.style.width = (rect.width + 10) + 'px'
      ring.style.height = (rect.height + 10) + 'px'

      // Scroll element into view if needed
      const el = document.querySelector(s.element)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } else {
      ring.style.display = 'none'
    }

    // Progress dots
    const dots = steps.map((_, di) =>
      `<div class="tour-dot ${di <= i ? 'active' : ''}"></div>`
    ).join('')

    tooltip.innerHTML = `
      <div class="tour-progress">${dots}</div>
      <div class="tour-badge">Step ${i + 1} of ${steps.length}</div>
      <div class="tour-title">${s.title}</div>
      <div class="tour-text">${s.text}</div>
      <div class="tour-actions">
        <button class="tour-skip">Skip tour</button>
        <div class="tour-nav">
          ${i > 0 ? '<button class="tour-back">← Back</button>' : ''}
          <button class="tour-next">${i === steps.length - 1 ? 'Done ✓' : 'Next →'}</button>
        </div>
      </div>
    `

    // Position tooltip after content is rendered
    requestAnimationFrame(() => {
      if (rect) positionTooltip(tooltip, rect)
      else {
        tooltip.style.left = '50%'
        tooltip.style.top = '50%'
        tooltip.style.transform = 'translate(-50%, -50%)'
      }
    })

    tooltip.querySelector('.tour-skip').onclick = endTour
    tooltip.querySelector('.tour-next').onclick = () => {
      if (step < steps.length - 1) renderStep(step + 1)
      else endTour()
    }
    tooltip.querySelector('.tour-back')?.addEventListener('click', () => renderStep(step - 1))
  }

  function endTour() {
    overlay.remove()
    ring.remove()
    tooltip.remove()
    if (tourKey) localStorage.setItem(PREFIX + tourKey, '1')
    // Remove ?tour=1 from URL without reload
    const url = new URL(window.location.href)
    url.searchParams.delete('tour')
    history.replaceState({}, '', url)
  }

  // Handle window resize — reposition ring
  const onResize = () => {
    const s = steps[step]
    const rect = getRect(s.element)
    if (rect) {
      ring.style.left = (rect.left - 5) + 'px'
      ring.style.top = (rect.top - 5) + 'px'
      ring.style.width = (rect.width + 10) + 'px'
      ring.style.height = (rect.height + 10) + 'px'
      positionTooltip(tooltip, rect)
    }
  }
  window.addEventListener('resize', onResize)
  overlay.addEventListener('remove', () => window.removeEventListener('resize', onResize))

  renderStep(0)
}
