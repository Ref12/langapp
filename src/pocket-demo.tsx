import { createRoot } from 'react-dom/client'
import { PocketOverlay } from './components/pocket/PocketOverlay'
const q = new URLSearchParams(location.search)
createRoot(document.getElementById('root')!).render(<><p style={{color:'#000'}}>App behind</p><PocketOverlay status="Speaking..." onExit={() => {}} /></>)
if (q.get('late')) setTimeout(() => {}, 0)
