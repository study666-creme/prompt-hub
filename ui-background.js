import { initRippleGrid } from './ripple-grid.js';

const bg = document.getElementById('rippleGridBg');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (bg && !reduceMotion) {
  initRippleGrid(bg, {
    enableRainbow: false,
    gridColor: '#6ee7d6',
    rippleIntensity: 0.06,
    gridSize: 10,
    gridThickness: 15,
    fadeDistance: 1.5,
    vignetteStrength: 2.0,
    glowIntensity: 0.24,
    opacity: 0.62,
    gridRotation: 6,
    mouseInteraction: true,
    mouseInteractionRadius: 1.25
  });
}
