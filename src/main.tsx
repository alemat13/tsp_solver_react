import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installErrorLogger, installFetchLogger, logInfo } from './services/diagnostics';

installFetchLogger();
installErrorLogger();
logInfo('app', 'App started (build ' + __APP_COMMIT__ + ')');

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
