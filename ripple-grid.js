/**
 * RippleGrid — vanilla port (React Bits / ogl)
 */
import { Renderer, Program, Triangle, Mesh } from 'https://cdn.jsdelivr.net/npm/ogl@1.0.11/src/index.mjs';

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255]
    : [1, 1, 1];
}

export function initRippleGrid(container, options = {}) {
  if (!container) return { destroy: () => {} };

  const {
    enableRainbow = false,
    gridColor = '#5eead4',
    rippleIntensity = 0.055,
    gridSize = 9,
    gridThickness = 14,
    fadeDistance = 1.45,
    vignetteStrength = 2.1,
    glowIntensity = 0.16,
    opacity = 0.5,
    gridRotation = 0,
    mouseInteraction = true,
    mouseInteractionRadius = 1.15
  } = options;

  const mousePosition = { x: 0.5, y: 0.5 };
  const targetMouse = { x: 0.5, y: 0.5 };
  let mouseInfluence = mouseInteraction ? 1 : 0;
  let uniforms = null;
  let rafId = 0;
  let destroyed = false;
  let paused = false;

  const renderer = new Renderer({
    dpr: Math.min(window.devicePixelRatio, 2),
    alpha: true
  });
  const gl = renderer.gl;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const canvas = gl.canvas;
  canvas.className = 'ripple-grid-canvas';
  container.appendChild(canvas);

  const vert = `
attribute vec2 position;
varying vec2 vUv;
void main() {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
}`;

  const frag = `precision highp float;
uniform float iTime;
uniform vec2 iResolution;
uniform bool enableRainbow;
uniform vec3 gridColor;
uniform float rippleIntensity;
uniform float gridSize;
uniform float gridThickness;
uniform float fadeDistance;
uniform float vignetteStrength;
uniform float glowIntensity;
uniform float opacity;
uniform float gridRotation;
uniform bool mouseInteraction;
uniform vec2 mousePosition;
uniform float mouseInfluence;
uniform float mouseInteractionRadius;
varying vec2 vUv;

float pi = 3.141592;

mat2 rotate(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
}

void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    if (gridRotation != 0.0) {
        uv = rotate(gridRotation * pi / 180.0) * uv;
    }

    float dist = length(uv);
    float func = sin(pi * (iTime - dist));
    vec2 rippleUv = uv + uv * func * rippleIntensity;

    if (mouseInteraction && mouseInfluence > 0.0) {
        vec2 mouseUv = (mousePosition * 2.0 - 1.0);
        mouseUv.x *= iResolution.x / iResolution.y;
        vec2 diff = uv - mouseUv;
        float mouseDist = length(diff);
        float influence = mouseInfluence * exp(-mouseDist * mouseDist / (mouseInteractionRadius * mouseInteractionRadius));
        float mouseWave = sin(pi * (iTime * 2.0 - mouseDist * 3.0)) * influence;
        rippleUv += (mouseDist > 0.001 ? normalize(diff) : vec2(0.0)) * mouseWave * rippleIntensity * 0.38;
    }

    vec2 a = sin(gridSize * 0.5 * pi * rippleUv - pi / 2.0);
    vec2 b = abs(a);

    float aaWidth = 0.5;
    vec2 smoothB = vec2(
        smoothstep(0.0, aaWidth, b.x),
        smoothstep(0.0, aaWidth, b.y)
    );

    vec3 color = vec3(0.0);
    color += exp(-gridThickness * smoothB.x * (0.8 + 0.5 * sin(pi * iTime)));
    color += exp(-gridThickness * smoothB.y);
    color += 0.5 * exp(-(gridThickness / 4.0) * sin(smoothB.x));
    color += 0.5 * exp(-(gridThickness / 3.0) * sin(smoothB.y));

    if (glowIntensity > 0.0) {
        color += glowIntensity * exp(-gridThickness * 0.5 * smoothB.x);
        color += glowIntensity * exp(-gridThickness * 0.5 * smoothB.y);
    }

    float ddd = exp(-2.0 * clamp(pow(dist, fadeDistance), 0.0, 1.0));
    vec2 vignetteCoords = vUv - 0.5;
    float vignetteDistance = length(vignetteCoords);
    float vignette = 1.0 - pow(vignetteDistance * 2.0, vignetteStrength);
    vignette = clamp(vignette, 0.0, 1.0);

    vec3 t;
    if (enableRainbow) {
        t = vec3(
            uv.x * 0.5 + 0.5 * sin(iTime),
            uv.y * 0.5 + 0.5 * cos(iTime),
            pow(cos(iTime), 4.0)
        ) + 0.5;
    } else {
        t = gridColor;
    }

    float finalFade = ddd * vignette;
    gl_FragColor = vec4(color * t * finalFade * opacity, length(color) * finalFade * opacity);
}`;

  uniforms = {
    iTime: { value: 0 },
    iResolution: { value: [1, 1] },
    enableRainbow: { value: enableRainbow },
    gridColor: { value: hexToRgb(gridColor) },
    rippleIntensity: { value: rippleIntensity },
    gridSize: { value: gridSize },
    gridThickness: { value: gridThickness },
    fadeDistance: { value: fadeDistance },
    vignetteStrength: { value: vignetteStrength },
    glowIntensity: { value: glowIntensity },
    opacity: { value: opacity },
    gridRotation: { value: gridRotation },
    mouseInteraction: { value: mouseInteraction },
    mousePosition: { value: [0.5, 0.5] },
    mouseInfluence: { value: mouseInfluence },
    mouseInteractionRadius: { value: mouseInteractionRadius }
  };

  const geometry = new Triangle(gl);
  const program = new Program(gl, { vertex: vert, fragment: frag, uniforms });
  const mesh = new Mesh(gl, { geometry, program });

  const resize = () => {
    if (destroyed || !container) return;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    uniforms.iResolution.value = [w, h];
  };

  const handleMouseMove = (e) => {
    if (!mouseInteraction || destroyed) return;
    const rect = container.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1 - (e.clientY - rect.top) / rect.height;
    targetMouse.x = Math.min(1, Math.max(0, x));
    targetMouse.y = Math.min(1, Math.max(0, y));
  };

  const render = (t) => {
    if (destroyed) return;
    if (paused || document.hidden) {
      rafId = requestAnimationFrame(render);
      return;
    }
    uniforms.iTime.value = t * 0.001;
    mousePosition.x += (targetMouse.x - mousePosition.x) * 0.14;
    mousePosition.y += (targetMouse.y - mousePosition.y) * 0.14;
    uniforms.mouseInfluence.value += (mouseInfluence - uniforms.mouseInfluence.value) * 0.05;
    uniforms.mousePosition.value = [mousePosition.x, mousePosition.y];
    renderer.render({ scene: mesh });
    rafId = requestAnimationFrame(render);
  };

  window.addEventListener('resize', resize);
  if (mouseInteraction) window.addEventListener('mousemove', handleMouseMove, { passive: true });
  resize();
  rafId = requestAnimationFrame(render);

  return {
    setPaused(value) {
      paused = !!value;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      if (mouseInteraction) window.removeEventListener('mousemove', handleMouseMove);
      renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }
  };
}
