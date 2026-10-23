/*
 * Saaphzone AQI Monitoring Portal — CPCB India AQI Calculations
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */

const AQI_CATS = [
  { max: 50, name: 'Good', color: '#009966' },
  { max: 100, name: 'Satisfactory', color: '#84cf33' },
  { max: 200, name: 'Moderate', color: '#ffde33' },
  { max: 300, name: 'Poor', color: '#ff9933' },
  { max: 400, name: 'Very Poor', color: '#cc0033' },
  { max: 9999, name: 'Severe', color: '#7e0023' }
];

const BP_PM25 = [
  [0, 30, 0, 50],
  [31, 60, 51, 100],
  [61, 90, 101, 200],
  [91, 120, 201, 300],
  [121, 250, 301, 400],
  [251, 500, 401, 500]
];

const BP_PM10 = [
  [0, 50, 0, 50],
  [51, 100, 51, 100],
  [101, 250, 101, 200],
  [251, 350, 201, 300],
  [351, 430, 301, 400],
  [431, 600, 401, 500]
];

function subIndex(c, bp) {
  const val = Number(c) || 0;
  for (const [Cl, Ch, Il, Ih] of bp) {
    if (val >= Cl && val <= Ch) {
      return Math.round(((Ih - Il) / (Ch - Cl)) * (val - Cl) + Il);
    }
  }
  return 500;
}

function computeAQI(pm25, pm10) {
  const p25 = Number(pm25) || 0;
  const p10 = Number(pm10) || 0;
  return Math.max(subIndex(p25, BP_PM25), subIndex(p10, BP_PM10));
}

function aqiCat(aqiValue) {
  if (aqiValue == null) return { name: 'Offline', color: '#999999' };
  for (const c of AQI_CATS) {
    if (aqiValue <= c.max) return c;
  }
  return AQI_CATS[AQI_CATS.length - 1];
}

function shade(hex, pct) {
  if (!hex || hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.max(0, Math.min(255, r + Math.round((255 * pct) / 100)));
  g = Math.max(0, Math.min(255, g + Math.round((255 * pct) / 100)));
  b = Math.max(0, Math.min(255, b + Math.round((255 * pct) / 100)));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
