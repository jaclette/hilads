import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App'

import posthog from 'posthog-js'

posthog.init('phc_zz4Q6VJETesgBUkeKe8a9asUwbra9qGXgw4ff6zPTxLM', {
    api_host: 'https://eu.posthog.com',
    disable_toolbar: true,
    autocapture: false,        // all events tracked manually via track()
    capture_pageleave: false,  // not useful for a SPA chat context
    // Session recording generates a continuous stream of `s/?ip=0` requests
    // (DOM snapshots sent throughout the session) — stop it so it doesn't
    // compete for bandwidth with critical API calls during channel load.
    loaded: (ph) => {
        if (typeof ph.stopSessionRecording === 'function') {
            ph.stopSessionRecording()
        }
    },
})

if (import.meta.env.VITE_SENTRY_DSN) {
    Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: import.meta.env.MODE,
    })
}

createRoot(document.getElementById('root')).render(
    <App />,
)