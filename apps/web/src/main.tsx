import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App.jsx'
import { swUpdateStore } from './lib/swUpdate.js'
import './index.css'

// Register once, at boot, outside React: StrictMode double-invokes effects
// and the app shell should be precaching whether or not a room is open.
// With registerType 'prompt' this never activates a new build on its own —
// it only lights up the banner App renders. See src/lib/swUpdate.ts.
swUpdateStore.register(registerSW)

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
