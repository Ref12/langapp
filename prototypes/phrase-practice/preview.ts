import '../../docs/mockups/device-preview.js'

const device = new URLSearchParams(location.search).get('device')
if (device === 'mobile' || device === 'desktop') {
  document.querySelector<HTMLButtonElement>(`button[data-device="${device}"]`)?.click()
}
