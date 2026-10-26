/*
 * Saaphzone AQI Monitoring Portal — Hardware Visualisation Helpers
 * © 2026 Saaphzone Technologies LLP. All rights reserved.
 */

// Rotating fan SVG
function fanSVG() {
  return `<svg viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="48" fill="#eef4f8" stroke="#d6e2ea"/>
    <g class="blades" fill="#073859">
      ${[0, 72, 144, 216, 288]
        .map(
          (deg) =>
            `<path d="M50 50 C 58 30, 74 26, 78 40 C 66 46, 56 48, 50 50 Z" transform="rotate(${deg} 50 50)"/>`
        )
        .join('')}
    </g>
    <circle cx="50" cy="50" r="8" fill="#14adcd" stroke="#fff" stroke-width="2"/>
  </svg>`;
}

// Pressure gauge SVG: pct 0..1 -> needle across 180°
function gaugeSVG(pct, color) {
  const safePct = Math.max(0, Math.min(1, pct || 0));
  const ang = -90 + safePct * 180;
  const circumference = Math.PI * 53;
  const strokeOffset = circumference * (1 - safePct);

  return `<svg viewBox="0 0 130 78">
    <path d="M12 66 A53 53 0 0 1 118 66" fill="none" stroke="#e5edf2" stroke-width="11" stroke-linecap="round"/>
    <path d="M12 66 A53 53 0 0 1 118 66" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"
      stroke-dasharray="${circumference}" stroke-dashoffset="${strokeOffset}"/>
    <g class="needle" transform="rotate(${ang} 65 66)">
      <line x1="65" y1="66" x2="65" y2="24" stroke="#073859" stroke-width="3" stroke-linecap="round"/>
    </g>
    <circle cx="65" cy="66" r="6" fill="#073859"/>
  </svg>`;
}

// Rain sensor status widget
function rainBox(raining) {
  if (raining) {
    return `<div class="rainbox">
      <div class="cloud">☁️</div>
      ${[16, 28, 40, 52, 64]
        .map(
          (x, i) =>
            `<div class="drop" style="left:${x}%;animation-delay:${i * 0.13}s"></div>`
        )
        .join('')}
    </div>`;
  }
  return `<div class="rainbox dry"><div class="sun">☀️</div></div>`;
}
