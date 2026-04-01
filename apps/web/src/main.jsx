import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

import posthog from 'posthog-js'

posthog.init('phc_zz4Q6VJETesgBUkeKe8a9asUwbra9qGXgw4ff6zPTxLM', {
    api_host: 'https://eu.posthog.com',
})

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <App />
    </StrictMode>,
)