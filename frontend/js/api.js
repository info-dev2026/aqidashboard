/*
 * Saaphzone AQI Monitoring Portal — API Client Module
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */

const API = {
  getToken() {
    return localStorage.getItem('sz_token');
  },

  setToken(token) {
    if (token) {
      localStorage.setItem('sz_token', token);
    } else {
      localStorage.removeItem('sz_token');
    }
  },

  async call(method, path, body) {
    const baseUrl = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || '/api';
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    const url = baseUrl + cleanPath;

    const headers = {};
    const token = API.getToken();
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    const opt = {
      method,
      headers,
      credentials: 'include' // Sends cookies across localhost ports
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(url, opt);
    } catch (networkErr) {
      throw new Error(`Cannot connect to backend server at ${baseUrl}. Ensure backend is running.`);
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // Non-JSON or empty response
    }

    if (!res.ok) {
      const errMsg = (data && data.error) || `HTTP error ${res.status}`;
      if (res.status === 401 && !path.includes('/login')) {
        API.setToken(null);
      }
      throw new Error(errMsg);
    }

    return data;
  },

  get: (path) => API.call('GET', path),
  post: (path, body) => API.call('POST', path, body),
  del: (path) => API.call('DELETE', path)
};
