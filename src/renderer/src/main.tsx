import { createRoot } from 'react-dom/client'
import './styles.css'

const ticket = new URLSearchParams(location.search).get('print')
async function mount() {
  const root = createRoot(document.getElementById('root')!)
  if (ticket) { const { PrintView } = await import('./PrintView'); root.render(<PrintView ticket={ticket} />) }
  else { const { App } = await import('./App'); root.render(<App />) }
}
void mount()
