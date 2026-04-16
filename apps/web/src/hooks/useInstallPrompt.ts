import { useEffect, useRef, useState, useCallback } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type InstallState =
  | { status: 'unsupported' }
  | { status: 'installed' }
  | { status: 'ready'; prompt: () => void }
  | { status: 'ios' }

export function useInstallPrompt(): InstallState {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)
  const [state, setState] = useState<InstallState>(() => {
    if (typeof window === 'undefined') return { status: 'unsupported' }
    if (window.matchMedia('(display-mode: standalone)').matches) return { status: 'installed' }
    // @ts-expect-error — navigator.standalone is iOS-only
    if (navigator.standalone === true) return { status: 'installed' }
    return { status: 'unsupported' }
  })

  const prompt = useCallback(() => {
    deferredPrompt.current?.prompt()
  }, [])

  useEffect(() => {
    // Already installed
    if (state.status === 'installed') return

    // iOS detection — no beforeinstallprompt support
    const ua = navigator.userAgent
    if (/iPhone|iPad|iPod/.test(ua) && !('beforeinstallprompt' in window)) {
      setState({ status: 'ios' })
      return
    }

    const onPrompt = (e: Event) => {
      e.preventDefault()
      deferredPrompt.current = e as BeforeInstallPromptEvent
      setState({ status: 'ready', prompt })
    }

    const onInstalled = () => {
      deferredPrompt.current = null
      setState({ status: 'installed' })
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [state.status, prompt])

  return state
}
