import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/onest';
import './styles.css';
import App from './App.jsx';
import OpenRouterPanel from './OpenRouterPanel.jsx';
import { registerPwa } from './pwa.js';

const standaloneCapabilities = Object.freeze({ ai: Object.freeze({ Panel: OpenRouterPanel, label: 'OpenRouter AI', requiresDefinition: false }) });

createRoot(document.getElementById('root')).render(<React.StrictMode><App capabilities={standaloneCapabilities} /></React.StrictMode>);
registerPwa();
