/*
 * MAAPS device health logic
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */
'use strict';

// Pressure differential status across the filter.
// green  = healthy band
// amber  = watch (approaching clogged, or slightly low)
// red    = service required (clogged filter: ΔP too high, OR leak/failure: ΔP ~ 0 while running)
function pressureStatus(pIn, pOut, dpWarn = 1200, dpCrit = 1500, running = true) {
  const dp = Math.round((Number(pIn) || 0) - (Number(pOut) || 0));
  if (!running) return { dp, level: 'idle', label: 'Device off', color: '#8a8a8a' };
  if (dp >= dpCrit) return { dp, level: 'red', label: 'Service required — filter clogged', color: '#cc0033' };
  if (dp <= 50) return { dp, level: 'red', label: 'Service required — low ΔP (leak/blockage)', color: '#cc0033' };
  if (dp >= dpWarn) return { dp, level: 'amber', label: 'Monitor — pressure rising', color: '#ff9933' };
  return { dp, level: 'green', label: 'Healthy', color: '#009966' };
}

// Effective power. Priority (highest wins):
//   1. manual override (staff ON/OFF)
//   2. rain -> OFF (protect hardware)
//   3. PM setpoint auto start/stop (with hysteresis)
//   4. default ON
//
// Hysteresis: device STARTS when BOTH pm2.5 & pm10 are above their setpoints.
// It STOPS only when BOTH fall below (setpoint - band). The gap prevents flapping.
// `currently_on` is the device's last effective state, used to pick which edge applies.
function effectivePower({ power_manual, raining, pm25, pm10, sp25, sp10, sp_band, sp_enabled, currently_on }) {
  if (power_manual === 'off') return { on: false, reason: 'manual' };
  if (power_manual === 'on') return { on: true, reason: 'manual' };
  if (raining) return { on: false, reason: 'rain' };

  if (sp_enabled) {
    const band = Number(sp_band) || 0;
    const p25 = Number(pm25) || 0, p10 = Number(pm10) || 0;
    const s25 = Number(sp25) || 0, s10 = Number(sp10) || 0;
    const aboveStart = p25 > s25 && p10 > s10;                    // both above -> start
    const belowStop = p25 < (s25 - band) && p10 < (s10 - band);  // both below band -> stop
    if (currently_on) {
      // stay on until both drop below the lower band
      return belowStop ? { on: false, reason: 'setpoint' } : { on: true, reason: 'setpoint' };
    } else {
      // stay off until both rise above the setpoint
      return aboveStart ? { on: true, reason: 'setpoint' } : { on: false, reason: 'setpoint' };
    }
  }

  return { on: true, reason: 'auto' };
}

module.exports = { pressureStatus, effectivePower };
