import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App'

import posthog from 'posthog-js'

posthog.init('phc_zz4Q6VJETesgBUkeKe8a9asUwbra9qGXgw4ff6zPTxLM', {
    api_host: 'https://eu.posthog.com',
})

if (import.meta.env.VITE_SENTRY_DSN) {
    Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: import.meta.env.MODE,
    })
}

// TEMPORARY: run window.__sentryTest() in the browser console to verify.
// Remove after confirming events appear in the hilads-web Sentry project.
if (import.meta.env.DEV) {
    window.__sentryTest = () => Sentry.captureMessage('Hilads web Sentry test — OK')
}

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <App />
    </StrictMode>,
)