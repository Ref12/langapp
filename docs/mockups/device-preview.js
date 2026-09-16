(() => {
  const frame = document.querySelector('#prototype-frame')
  const stage = document.querySelector('#preview-stage')
  document.querySelectorAll('button[data-device]').forEach((button) => {
    button.addEventListener('click', () => {
      stage.dataset.device = button.dataset.device
      document.querySelectorAll('button[data-device]').forEach((item) => {
        item.setAttribute('aria-pressed', String(item === button))
      })
    })
  })
  new ResizeObserver(() => {
    document.querySelector('#viewport-size').textContent = `${frame.clientWidth} \u00d7 ${frame.clientHeight}`
  }).observe(frame)
})()
