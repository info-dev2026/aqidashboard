/*
 * CPCB India AQI sub-index computation
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */
'use strict';
const BP_PM25 = [[0,30,0,50],[31,60,51,100],[61,90,101,200],[91,120,201,300],[121,250,301,400],[251,500,401,500]];
const BP_PM10 = [[0,50,0,50],[51,100,51,100],[101,250,101,200],[251,350,201,300],[351,430,301,400],[431,600,401,500]];

function subIndex(c, bp) {
  for (const [Cl, Ch, Il, Ih] of bp) {
    if (c >= Cl && c <= Ch) return Math.round((Ih - Il) / (Ch - Cl) * (c - Cl) + Il);
  }
  return 500;
}
function computeAQI(pm25, pm10) {
  return Math.max(subIndex(pm25, BP_PM25), subIndex(pm10, BP_PM10));
}
const CATS = [
  { max: 50, name: 'Good', color: '#009966' },
  { max: 100, name: 'Satisfactory', color: '#84cf33' },
  { max: 200, name: 'Moderate', color: '#ffde33' },
  { max: 300, name: 'Poor', color: '#ff9933' },
  { max: 400, name: 'Very Poor', color: '#cc0033' },
  { max: 9999, name: 'Severe', color: '#7e0023' }
];
function category(a) { return CATS.find(c => a <= c.max) || CATS[CATS.length - 1]; }

module.exports = { computeAQI, subIndex, category, BP_PM25, BP_PM10 };
