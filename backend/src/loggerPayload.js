/*
 * Saaphzone AQI Monitoring Portal — Logger & Analyzer Remote Payload Dispatcher
 * Manages remote command dispatching, stop/start instructions, and dashboard lockout controls.
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */
'use strict';

/**
 * Builds the remote command payload for the logger / analyzer.
 *
 * Requirements:
 * 1. When switched OFF from the dashboard:
 *    - Sends a payload to the logger commanding it to stop immediately.
 *    - Explicitly sets `restart_allowed: false` and `lockout: true`.
 *    - Transmits clear directive: "Stop analyzer immediately. Do not restart the analyzer until dashboard starts it."
 * 2. When switched ON from the dashboard:
 *    - Sends a payload authorizing the analyzer to start and clears the dashboard lockout.
 * 3. In AUTO mode:
 *    - Governed by environmental conditions (PM setpoints hysteresis & rain sensor).
 *
 * @param {Object} device - Device record from database
 * @param {Object} effectivePower - Output from health.effectivePower
 * @returns {Object} logger payload
 */
function buildLoggerPayload(device, effectivePower = null) {
  const deviceId = device.device_id || 'UNKNOWN';
  const powerManual = device.power_manual; // 'on' | 'off' | null / 'auto'
  const isLockedOff = powerManual === 'off' || (effectivePower && !effectivePower.on && effectivePower.reason === 'manual');
  const isManualOn = powerManual === 'on' || (effectivePower && effectivePower.on && effectivePower.reason === 'manual');
  const nowIso = new Date().toISOString();

  if (isLockedOff) {
    return {
      command: 'STOP_ANALYZER',
      action: 'STOP',
      analyzer_power: 'OFF',
      power_state: 0,
      restart_allowed: false,
      lockout: true,
      lock_source: 'DASHBOARD',
      instruction: 'HOLD_OFF',
      message: 'Stop analyzer immediately. Do not restart the analyzer until dashboard starts it.',
      reason: 'Switched off by administrator from dashboard',
      device_id: deviceId,
      timestamp: nowIso
    };
  }

  if (isManualOn) {
    return {
      command: 'START_ANALYZER',
      action: 'START',
      analyzer_power: 'ON',
      power_state: 1,
      restart_allowed: true,
      lockout: false,
      lock_source: 'DASHBOARD',
      instruction: 'RUN',
      message: 'Dashboard has started the analyzer. Normal operation authorized.',
      reason: 'Switched on by administrator from dashboard',
      device_id: deviceId,
      timestamp: nowIso
    };
  }

  // AUTO mode (governed by PM setpoint hysteresis and rain protection)
  const isRunning = effectivePower ? effectivePower.on : true;
  const reason = effectivePower ? effectivePower.reason : 'auto';

  return {
    command: 'AUTO_ANALYZER',
    action: isRunning ? 'RUN' : 'STANDBY',
    analyzer_power: isRunning ? 'ON' : 'OFF',
    power_state: isRunning ? 1 : 0,
    restart_allowed: true,
    lockout: false,
    lock_source: 'AUTO',
    instruction: isRunning ? 'RUN' : 'STANDBY',
    message: isRunning
      ? 'Analyzer active under automatic control.'
      : `Analyzer standby (${reason}). Auto-restart permitted when setpoints trigger.`,
    reason: `Automatic mode: ${reason}`,
    device_id: deviceId,
    timestamp: nowIso
  };
}

module.exports = {
  buildLoggerPayload
};
