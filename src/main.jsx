import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Widget from './Widget';

const isWidget = new URLSearchParams(window.location.search).get('embed') === '1';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isWidget ? <Widget /> : <App />}
  </React.StrictMode>,
);
