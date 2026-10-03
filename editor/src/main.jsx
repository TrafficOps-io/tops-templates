import React from 'react';
import { createRoot } from 'react-dom/client';
import './studio.css';
import StudioEntry from './StudioEntry.jsx';
import { captureInstall } from './install.js';
import { registerPwa } from './pwa.js';
import { applyTheme, readTheme } from './theme.js';

applyTheme(readTheme());
captureInstall();

createRoot(document.getElementById('root')).render(<React.StrictMode><StudioEntry /></React.StrictMode>);
registerPwa();
