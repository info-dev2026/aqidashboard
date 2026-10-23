/*
 * Authentication & Authorization Middleware
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */
'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-saaphzone-portal-32-chars-min';
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.warn('WARNING: JWT_SECRET missing or shorter than 32 chars. Set a secure secret in .env');
}
const TOKEN_TTL = process.env.TOKEN_TTL || '2h';

const hash = (pw) => bcrypt.hashSync(pw, 12);
const verify = (pw, h) => bcrypt.compareSync(pw, h);
const newApiKey = () => 'maaps_' + crypto.randomBytes(24).toString('hex');

function sign(user) {
  return jwt.sign(
    {
      uid: user.id || ('site_' + user.code),
      u: user.username || user.code,
      role: user.role || 'client',
      client: user.client || null,
      site_code: user.site_code || user.code || null,
      name: user.name || user.username || user.code
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL, issuer: 'saaphzone-aqi' }
  );
}

// Reads token from httpOnly cookie (preferred) or Authorization header.
function authRequired(req, res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = req.cookies?.szsession || bearer;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET, { issuer: 'saaphzone-aqi' });
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }
}

// Optional authentication: attaches user if token is valid, proceeds without error if absent
function authOptional(req, res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = req.cookies?.szsession || bearer;
  if (!token) return next();
  try {
    req.user = jwt.verify(token, JWT_SECRET, { issuer: 'saaphzone-aqi' });
  } catch {
    // Ignore invalid optional token
  }
  next();
}

// Restrict a route to specific roles.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Server-side scope: clients may only touch their own client rows.
function scopeClient(req) {
  return req.user?.role === 'client' ? req.user.client : null;
}

// Server-side scope: site-authenticated users only touch their own site rows.
function scopeSite(req) {
  return req.user?.role === 'client' ? req.user.site_code : null;
}

module.exports = {
  hash,
  verify,
  sign,
  authRequired,
  authOptional,
  requireRole,
  scopeClient,
  scopeSite,
  newApiKey,
  JWT_SECRET
};
