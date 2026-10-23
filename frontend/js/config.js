/*
 * Saaphzone AQI Monitoring Portal — Frontend Configuration
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */

window.APP_CONFIG = (function() {
  // Check if an override is stored in localStorage
  const savedBase = localStorage.getItem('SAAPHZONE_API_BASE');
  if (savedBase) {
    return { API_BASE_URL: savedBase };
  }

  // If frontend is served directly by the backend on the same origin (e.g. port 5000)
  const isSameOriginBackend = window.location.port === '5000' || window.location.port === '';
  
  // Default to backend API at port 5000 when frontend runs on port 3000 / 5173 / file
  const defaultApiBase = isSameOriginBackend ? '/api' : 'http://localhost:5000/api';

  return {
    API_BASE_URL: defaultApiBase,
    APP_NAME: 'Saaphzone AQI Monitoring Portal',
    VERSION: '1.0.0',
    REFRESH_INTERVAL_MS: 30000
  };
})();
