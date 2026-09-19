import React from 'react';
import { createRoot } from 'react-dom/client';
import './studio.css';
import App from './App.jsx';
import { registerPwa } from './pwa.js';

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
registerPwa();
