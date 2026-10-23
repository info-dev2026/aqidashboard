/*
 * Saaphzone AQI Monitoring Portal — Frontend Configuration
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */

window.APP_CONFIG = (function() {
  const PRIMARY_URL = 'https://aqidashboard-welx.onrender.com';
  const PRIMARY_API_BASE = 'https://aqidashboard-welx.onrender.com/api';
  const SITES_ENDPOINT = 'https://aqidashboard-welx.onrender.com/api/sites';

  // Check if an override is stored in localStorage
  const savedBase = localStorage.getItem('SAAPHZONE_API_BASE');
  if (savedBase) {
    return {
      PRIMARY_URL: PRIMARY_URL,
      API_BASE_URL: savedBase,
      SITES_ENDPOINT: savedBase + '/sites',
      APP_NAME: 'Saaphzone AQI Monitoring Portal',
      VERSION: '1.0.0',
      REFRESH_INTERVAL_MS: 20000
    };
  }

  // If frontend is hosted directly on the Render service on the same origin
  const isRenderHost = window.location.origin === PRIMARY_URL;
  // If running locally with local backend on port 5000
  const isLocalBackend = window.location.hostname === 'localhost' && window.location.port === '5000';

  let defaultApiBase = PRIMARY_API_BASE;
  if (isRenderHost) {
    defaultApiBase = '/api';
  } else if (isLocalBackend) {
    defaultApiBase = 'http://localhost:5000/api';
  }

  return {
    PRIMARY_URL: PRIMARY_URL,
    API_BASE_URL: defaultApiBase,
    SITES_ENDPOINT: defaultApiBase === '/api' ? '/api/sites' : (defaultApiBase + '/sites'),
    APP_NAME: 'Saaphzone AQI Monitoring Portal',
    VERSION: '1.0.0',
    REFRESH_INTERVAL_MS: 20000
  };
})();
