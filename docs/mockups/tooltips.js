// One top-layer tooltip avoids clipping inside the reader, composer, and dialogs.
;(() => {
  const tooltip = document.createElement('div')
  tooltip.id = 'mockup-tooltip'
  tooltip.className = 'icon-tooltip'
  tooltip.popover = 'manual'
  tooltip.setAttribute('role', 'tooltip')
  document.body.append(tooltip)
  let anchor = null
  let hovered = null
  let focused = null
  let nativeTitle = null
  let dismissed = null
  let showTimer
  let hideTimer
  let pointerType = ''

  function controlFor(target) {
    if (!(target instanceof Element)) return null
    const control = target.closest('button, a[href], [data-tooltip]')
    if (!control) return null
    const collapsedLink = document.body.dataset.sidebarCollapsed === 'true'
      && control.matches('.primary-nav a, .sidebar-icon-link')
    return control.hasAttribute('data-tooltip') || (control.querySelector('svg')
      && (control.hasAttribute('aria-label') || !control.innerText.trim() || collapsedLink)) ? control : null
  }
  function hide() {
    clearTimeout(showTimer)
    clearTimeout(hideTimer)
    if (tooltip.matches(':popover-open')) tooltip.hidePopover()
    if (anchor) {
      const descriptions = (anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== tooltip.id)
      if (descriptions.length) anchor.setAttribute('aria-describedby', descriptions.join(' '))
      else anchor.removeAttribute('aria-describedby')
      if (nativeTitle !== null && !anchor.hasAttribute('title')) anchor.setAttribute('title', nativeTitle)
    }
    anchor = null
    nativeTitle = null
  }
  function label() {
    if (anchor.hasAttribute('title')) {
      nativeTitle = anchor.getAttribute('title')
      anchor.removeAttribute('title')
    }
    const text = (anchor.getAttribute('aria-label') || anchor.dataset.tooltip || nativeTitle
      || anchor.querySelector(':scope > span')?.textContent || anchor.innerText).trim().replace(/\s+/g, ' ')
    return text.length > 120 ? `${text.slice(0, 117)}...` : text
  }
  function update() {
    if (!anchor?.isConnected || !anchor.getClientRects().length) {
      hide()
      return
    }
    const text = label()
    if (!text) {
      hide()
      return
    }
    if (tooltip.textContent !== text) tooltip.textContent = text
    const host = anchor.closest('dialog[open], [popover]:popover-open') || document.body
    if (tooltip.parentElement !== host) {
      if (tooltip.matches(':popover-open')) tooltip.hidePopover()
      host.append(tooltip)
    }
    if (!tooltip.matches(':popover-open')) tooltip.showPopover()
    const descriptions = new Set((anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean))
    descriptions.add(tooltip.id)
    anchor.setAttribute('aria-describedby', [...descriptions].join(' '))
    const rect = anchor.getBoundingClientRect()
    const viewport = window.visualViewport
    const left = viewport?.offsetLeft || 0
    const top = viewport?.offsetTop || 0
    const width = viewport?.width || innerWidth
    const height = viewport?.height || innerHeight
    tooltip.style.maxWidth = `${Math.max(0, Math.min(280, width - 16))}px`
    const size = tooltip.getBoundingClientRect()
    const rail = document.body.dataset.sidebarCollapsed === 'true' && anchor.closest('.sidebar')
    const x = rail ? rect.right + 8 : rect.left + (rect.width - size.width) / 2
    const y = rail ? rect.top + (rect.height - size.height) / 2
      : rect.top - size.height - 8 >= top + 8 ? rect.top - size.height - 8 : rect.bottom + 8
    tooltip.style.left = `${Math.max(left + 8, Math.min(x, left + width - size.width - 8))}px`
    tooltip.style.top = `${Math.max(top + 8, Math.min(y, top + height - size.height - 8))}px`
  }
  function show(control, delay = 260) {
    if (control === dismissed) return
    clearTimeout(hideTimer)
    if (anchor === control) return
    hide()
    anchor = control
    label() // Suppress the native title while our tooltip is pending or visible.
    showTimer = setTimeout(update, delay)
  }
  function leave() {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (tooltip.matches(':hover')) return
      if (focused?.isConnected && focused.matches(':focus-visible')) show(focused, 0)
      else hide()
    }, 120)
  }
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return
    if (tooltip.contains(event.target)) {
      clearTimeout(hideTimer)
      return
    }
    const control = controlFor(event.target)
    if (control) {
      hovered = control
      show(control)
    }
  })
  document.addEventListener('pointerout', (event) => {
    if (tooltip.contains(event.target)) {
      if (!tooltip.contains(event.relatedTarget)) leave()
    } else if (hovered?.contains(event.target) && !hovered.contains(event.relatedTarget)) {
      if (hovered === dismissed) dismissed = null
      hovered = null
      leave()
    }
  })
  document.addEventListener('focusin', (event) => {
    focused = controlFor(event.target)
    dismissed = null
    if (focused && pointerType !== 'touch' && focused.matches(':focus-visible')) show(focused, 0)
  })
  document.addEventListener('focusout', () => {
    focused = null
    if (!hovered) leave()
  })
  document.addEventListener('pointerdown', (event) => {
    pointerType = event.pointerType
    if (!tooltip.contains(event.target)) {
      dismissed = controlFor(event.target)
      hide()
    }
  }, true)
  document.addEventListener('click', (event) => {
    if (!tooltip.contains(event.target)) {
      dismissed = controlFor(event.target)
      hide()
    }
  }, true)
  document.addEventListener('keydown', (event) => {
    pointerType = 'keyboard'
    if (event.key === 'Escape' && anchor) {
      dismissed = anchor
      hide()
      event.preventDefault()
      event.stopPropagation()
    }
  }, true)
  function dismiss() {
    dismissed = null
    hovered = null
    focused = null
    hide()
  }
  document.addEventListener('scroll', dismiss, true)
  document.addEventListener('mockup-route-changed', dismiss)
  document.addEventListener('toggle', (event) => {
    if (event.target !== tooltip && event.newState === 'closed' && event.target.contains(anchor)) dismiss()
  }, true)
  window.addEventListener('resize', dismiss)
  window.addEventListener('blur', dismiss)
  window.visualViewport?.addEventListener('resize', dismiss)
  window.visualViewport?.addEventListener('scroll', dismiss)
  new MutationObserver(() => {
    if (!anchor) return
    if (!anchor.isConnected || !anchor.getClientRects().length) dismiss()
    else if (tooltip.matches(':popover-open')) update()
  }).observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['aria-label', 'title', 'data-tooltip', 'hidden', 'open', 'data-sidebar-collapsed'],
  })
})()
