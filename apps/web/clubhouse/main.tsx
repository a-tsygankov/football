import { createRoot } from 'react-dom/client'
import { setGamerAvatarFallback } from '../src/lib/avatars'
import { ProShell } from '../src/pro/ProShell'
import '../src/index.css'

// The preview has no uploaded photos, so each gamer gets a stable sample one.
setGamerAvatarFallback(name => '/card-photos/sample-' + Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6 + '.jpg')

createRoot(document.getElementById('root')!).render(
  <ProShell preview edition="Football · Design preview" tagline="Game night dashboard" title="Clubhouse Pro" />,
)
