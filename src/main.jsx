import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Make React globally available (for JSX transform)
window.React = React;

// Mount the app
createRoot(document.getElementById("root")).render(<App />);
