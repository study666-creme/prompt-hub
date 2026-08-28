import { initRippleGrid } from './ripple-grid.js';

const bg = document.getElementById('rippleGridBg');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (bg && !reduceMotion) {
  initRippleGrid(bg, {
    enableRainbow: false,
    gridColor: '#ffffff',
    rippleIntensity: 0.16,
    gridSize: 11,
    gridThickness: 13,
    fadeDistance: 1.4,
    vignetteStrength: 1.8,
    glowIntensity: 0.42,
    opacity: 0.42,
    gridRotation: 8,
    mouseInteraction: true,
    mouseInteractionRadius: 1.35
  });
}
