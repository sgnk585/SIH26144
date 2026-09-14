/**
 * transducer-3d.js
 *
 * Mechanical Transducer 3D Visualization Module (SIH26144).
 *
 * Visualizes Problem Statement Requirement:
 *   "(b) Mechanical transducer design"
 *
 * SCHEMATIC DESIGN OVERVIEW
 * ─────────────────────────
 * This module provides an interactive 3D exploded-view visualization of
 * the team's physical infrasound transducer design. It illustrates the
 * custom diaphragm + capillary + backing-volume mechanical assembly,
 * read out by a custom differential pressure transducer:
 *
 *   1. Atmospheric Port & Sintered Filter (Port A inlet)
 *   2. Top Housing (over the diaphragm's atmospheric side)
 *   3. Sensing Diaphragm (Mylar film)
 *   4. Bottom Housing
 *   5. Capillary Bleed Tube (pneumatic resistance R)
 *   6. Sealed Backing Volume (pneumatic compliance C)
 *   7. Custom Differential Transducer — Port A → atmospheric (PA), Port B → backing volume (PB)
 *
 * ΔP = PA − PB   (read directly by the custom transducer core, not computed from
 *                 two separate absolute sensors)
 * fc = 1 / (2πRC)
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { createPlaceholderTransducerGeometry, registerTransducerComponents } from './transducer-geometry.js';
import { TransducerLabels } from './transducer-labels.js';
import { TransducerEffects } from './transducer-effects.js';

// =========================================================================
// Configuration & Color Palette
// =========================================================================

const PALETTE = {
  // Translucent acrylic/machined housings (allows internal components to read as hollow)
  housing: 0x7b9aad,
  housingRim: 0x546e7a,

  // Active sensing diaphragm (metallic copper/gold tone for visual emphasis)
  diaphragm: 0xd4af37,
  sensorPackage: 0x5d4037,

  // Viton/Nitrile elastomeric sealing gasket
  gasket: 0x1c1e21,

  // Capillary tube (stainless steel acoustic resistance bleed tube)
  capillary: 0xe0e8ec,

  // Atmospheric inlet port & sintered filter cap
  portMetal: 0xa0b4be,
  filterPorous: 0x6b8290,

  // Backing volume (sealed acoustic compliance chamber) — tinted cooler
  // than housings so the two transparent parts read as visually distinct
  backingVolume: 0x5c7a8a,
  backingPlate: 0x37474f,

  // Fog / scene atmosphere
  fogNear: 0x0b0c0f,
  fogFar: 0x0b0c0f,
};

// =========================================================================
// TransducerScene Class
// =========================================================================

export class TransducerScene {
  /**
   * Constructs the 3D Transducer visualization scene inside containerElement.
   *
   * @param {HTMLElement} containerElement - DOM element hosting the WebGL canvas.
   */
  constructor(containerElement) {
    if (!containerElement) {
      throw new Error('[TransducerScene] Valid containerElement required.');
    }
    this.container = containerElement;

    // Ensure container has relative positioning for proper canvas placement
    const computed = window.getComputedStyle ? window.getComputedStyle(containerElement) : containerElement.style;
    if (computed && computed.position === 'static') {
      containerElement.style.position = 'relative';
    }

    this.explosionFactor = 0.0; // 0 = fully assembled, 1 = fully exploded
    this.autoRotate = true;     // Continuous Y-axis rotation enabled by default
    this._disposed = false;
    this._animId = null;

    // 1. Scene & Root Hierarchies
    this.scene = new THREE.Scene();

    // Subtle exponential fog — prevents the model from floating in a pure
    // black void while staying unobtrusive for a technical dashboard.
    this.scene.fog = new THREE.FogExp2(PALETTE.fogNear, 0.018);

    // Assembly pivot group rotates continuously around Y
    this.assemblyGroup = new THREE.Group();
    this.scene.add(this.assemblyGroup);

    // 2. Camera Setup — positions are overridden per-frame by
    //    setExplosionFactor() for dynamic dolly framing.
    //
    //    Assembled (t=0) camera: close-in, centered on compact stack
    //    Exploded  (t=1) camera: pulled back + raised to frame the
    //                           full spread of separated parts.
    //
    //    Values derived from _buildAssembly Y ranges:
    //      Assembled span: ~2.20 (top port) to ~-1.75 (backing vol) ≈ 3.95 units
    //      Exploded  span: ~4.80 to ~-4.20 ≈ 9.0 units
    //    Camera Z chosen so the vertical extent fills ~70% of a 45° FOV.
    this._cameraAssembled = { z: 9.5, y: 0.25, lookY: 0.1 };
    this._cameraExploded = { z: 15.0, y: 0.60, lookY: 0.3 };

    const width = this.container.clientWidth || 600;
    const height = this.container.clientHeight || 450;
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);
    this.camera.position.set(0, this._cameraAssembled.y, this._cameraAssembled.z);
    this.camera.lookAt(0, this._cameraAssembled.lookY, 0);

    // 3. WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.pointerEvents = 'none'; // Avoid trapping scroll events
    this.container.appendChild(this.renderer.domElement);

    // 4. Lighting Rig
    this._setupLighting();

    // 5. Build Assembly Parts (Primitive geometry with CAD replacement hooks)
    this._buildAssembly();

    // 6. Responsive Resize Observer
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(this.container);
    } else {
      this._onResize = () => this.resize();
      window.addEventListener('resize', this._onResize);
    }

    // 7. Start Internal Animation Loop
    this._animate = () => {
      if (this._disposed) return;

      if (this.autoRotate) {
        this.assemblyGroup.rotation.y += 0.006;
      }

      this.renderer.render(this.scene, this.camera);

      // Keep label/leader-line/particle overlays in sync every rendered
      // frame — not only when setExplosionFactor() is driven by scroll.
      // Without this, autoRotate keeps spinning the 3D model after the
      // user stops scrolling, but the DOM label positions (computed
      // from the model's matrixWorld) go stale and stop tracking it.
      if (this.labels) {
        this.labels.update(this.explosionFactor);
      }
      if (this.effects) {
        this.effects.update(this.explosionFactor);
      }

      this._animId = requestAnimationFrame(this._animate);
    };
    this._animId = requestAnimationFrame(this._animate);

    // Initialize positions at fully assembled state (t = 0)
    this.setExplosionFactor(0.0);
  }

  /**
   * Configure a clean multi-point lighting setup:
   *  - Soft ambient light for fill
   *  - Key directional light for shading and specular highlights
   *  - Cool rim directional light to define edges of transparent housings
   */
  _setupLighting() {
    // Soft neutral ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(ambientLight);

    // Key directional light (front-top-right)
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
    keyLight.position.set(6, 9, 8);
    this.scene.add(keyLight);

    // Rim/edge light (back-bottom-left) to catch specular contours on transparent shells
    const rimLight = new THREE.DirectionalLight(0x88c0d0, 0.7);
    rimLight.position.set(-6, -4, -6);
    this.scene.add(rimLight);

    // Soft warm fill light (front-bottom-left)
    const fillLight = new THREE.DirectionalLight(0xffe0b2, 0.35);
    fillLight.position.set(-4, 2, 6);
    this.scene.add(fillLight);
  }

  /**
   * Constructs each sub-assembly as a distinct THREE.Group with predefined
   * assembled and exploded Y positions.
   *
   * Vertical visual sequence (Top to Bottom):
   *   1. Atmospheric Port & Filter (Top)
   *   2. Top Housing
   *   3. Diaphragm
   *   4. Sealing Gasket (O-ring)
   *   5. Bottom Housing
   *   6. Capillary Bleed Tube
   *   7. Backing Volume (Bottom)
   */
  _buildAssembly() {
    // Generate geometry from our geometry module
    const { root, components } = createPlaceholderTransducerGeometry();
    this.assemblyGroup.add(root);

    // Register parts for animation
    this.parts = registerTransducerComponents(components);

    // Initialize labels
    this.labels = new TransducerLabels(this.scene, this.camera, this.container, this.parts);

    // Initialize effects
    this.effects = new TransducerEffects(this, this.parts);
  }
  // =======================================================================
  // Public Control API
  // =======================================================================

  /**
   * Sets the exploded-view progress factor.
   * Smoothly interpolates each component between its assembled and exploded
   * vertical coordinate along the Y-axis.
   *
   * @param {number} t - Progress in [0, 1]: 0 = fully assembled, 1 = fully exploded.
   */
  setExplosionFactor(t) {
    const p = Math.max(0, Math.min(1, Number(t) || 0));
    this.explosionFactor = p;

    // Chapter logic:
    // 0.00-0.15: Assembled
    // 0.15-0.68: Progressive explosion
    // 0.68-0.94: Exploded / Physics explanation
    // 0.94-1.00: Reassembly

    let reassemblyMultiplier = 1.0;
    if (p >= 0.94) {
      reassemblyMultiplier = 1.0 - ((p - 0.94) / 0.06);
    }

    for (let i = 0; i < this.parts.length; i++) {
      const part = this.parts[i];
      let partExplosion = 0.0;

      if (p > part.animStart) {
        if (p < part.animEnd) {
          // In progress
          partExplosion = (p - part.animStart) / (part.animEnd - part.animStart);
          // Ease in out
          partExplosion = partExplosion * partExplosion * (3 - 2 * partExplosion);
        } else {
          // Fully exploded for this part
          partExplosion = 1.0;
        }
      }

      partExplosion *= reassemblyMultiplier;
      part.group.position.y = part.assembledY + (part.explosionOffset * partExplosion);
    }

    // Dynamic camera dolly
    const camA = this._cameraAssembled;
    const camE = this._cameraExploded;

    // Interpolate camera smoothly from 0.15 to 0.68 (the main explosion phase)
    let camFactor = 0;
    if (p > 0.15 && p < 0.68) {
      camFactor = (p - 0.15) / (0.68 - 0.15);
      camFactor = camFactor * camFactor * (3 - 2 * camFactor);
    } else if (p >= 0.68) {
      camFactor = 1.0;
    }
    camFactor *= reassemblyMultiplier;

    this.camera.position.z = THREE.MathUtils.lerp(camA.z, camE.z, camFactor);
    this.camera.position.y = THREE.MathUtils.lerp(camA.y, camE.y, camFactor);
    const lookY = THREE.MathUtils.lerp(camA.lookY, camE.lookY, camFactor);
    this.camera.lookAt(0, lookY, 0);

    if (!this.autoRotate && !this._disposed) {
      this.renderer.render(this.scene, this.camera);
    }
    // Note: label/effects overlays are refreshed every animation frame
    // in _animate() (see constructor), not here, so they stay in sync
    // with autoRotate spin even when the user isn't actively scrolling.
  }
  /**
   * Returns the part entry whose exploded-view transition is most
   * "active" at the given scroll progress t ∈ [0,1].
   *
   * Divides [0,1] into N equal segments (one per part, ordered top to
   * bottom by assembled Y) and returns the part whose segment contains t.
   * At t=0 returns the topmost part; at t=1 returns the bottommost.
   *
   * @param {number} t - Scroll progress in [0, 1].
   * @returns {{ name: string, label: string, description: string, group: THREE.Group, assembledY: number, explodedY: number } | null}
   */
  getActivePart(t) {
    const factor = Math.max(0, Math.min(1, Number(t) || 0));
    const n = this.parts.length;
    if (n === 0) return null;
    // Index from 0 (top) to n-1 (bottom)
    const idx = Math.min(Math.floor(factor * n), n - 1);
    return this.parts[idx];
  }

  /**
   * Enables or disables continuous slow Y-axis auto-rotation.
   *
   * @param {boolean} enabled - True to rotate continuously; false to freeze rotation.
   */
  setAutoRotate(enabled) {
    this.autoRotate = Boolean(enabled);
  }

  /**
   * Resizes the camera projection and WebGL viewport to match the container.
   */
  resize() {
    if (this._disposed || !this.container) return;

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    if (!this.autoRotate) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Cleanly disposes of WebGL resources, animation frames, and DOM elements.
   */
  dispose() {
    this._disposed = true;

    if (this._animId !== null) {
      cancelAnimationFrame(this._animId);
      this._animId = null;
    }

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }

    // Recursively dispose geometry and materials
    this.scene.traverse((obj) => {
      if (obj.geometry) {
        obj.geometry.dispose();
      }
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });

    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
      this.renderer = null;
    }

    this.scene = null;
    this.camera = null;
    this.assemblyGroup = null;
    this.parts = [];
    if (this.labels) {
      this.labels.dispose();
      this.labels = null;
    }
    this.container = null;
  }
}

// =========================================================================
// Scroll Binding Helper Function
// =========================================================================

/**
 * Binds the TransducerScene's explosion factor to the scroll progress of
 * `containerElement` through the viewport.
 *
 * NOTE ON SCROLL RANGE AND PAGE LAYOUT:
 * `containerElement` requires sufficient scrollable distance in the page
 * layout for the explosion interaction to feel smooth. A single viewport-height
 * (100vh) container provides very little scroll travel to drive the explosion.
 *
 * When wiring this component into the page, nest the canvas inside a taller
 * wrapper section (e.g. 200vh to 300vh) with sticky positioning:
 *
 *   .transducer-scroll-wrapper {
 *     height: 250vh;
 *     position: relative;
 *   }
 *   .transducer-canvas-pinned {
 *     position: sticky;
 *     top: 0;
 *     height: 100vh;
 *     width: 100%;
 *   }
 *
 * As the user scrolls through the 250vh wrapper, the 3D model remains pinned
 * in place while this helper smoothly computes progress from 0 to 1.
 *
 * @param {TransducerScene} scene - An active TransducerScene instance.
 * @param {HTMLElement} containerElement - The DOM container or scroll track element.
 * @param {Object} [options={}] - Optional configuration.
 * @param {number} [options.startOffset=0.0] - Clamped progress lower bound [0..1].
 * @param {number} [options.endOffset=1.0] - Clamped progress upper bound [0..1].
 * @param {Function} [options.onActivePartChange=null] - Callback for active part.
 * @returns {Function} cleanup - Cleanup function removing scroll listeners and observers.
 */
export function bindExplosionToScroll(scene, containerElement, options = {}) {
  if (!scene || !containerElement) {
    console.warn('[bindExplosionToScroll] Invalid scene or containerElement provided.');
    return () => { };
  }

  const {
    startOffset = 0.0,
    endOffset = 1.0,
    onActivePartChange = null,
  } = options;

  /** @type {number | null} */
  let rafId = null;
  let isIntersecting = true;
  /** @type {string | null} */
  let lastActivePartName = null;

  function update() {
    const windowHeight = window.innerHeight || document.documentElement.clientHeight || 800;
    const rect = containerElement.getBoundingClientRect();

    let rawProgress = 0;

    if (rect.height > windowHeight) {
      // Tall scroll track section (e.g., sticky container pattern)
      const scrollableDistance = rect.height - windowHeight;
      rawProgress = -rect.top / scrollableDistance;
    } else {
      // Standard element scrolling into and out of the viewport
      const totalTravel = windowHeight + rect.height;
      rawProgress = (windowHeight - rect.top) / totalTravel;
    }

    // Clamp to [0, 1]
    const clampedProgress = Math.max(0, Math.min(1, rawProgress));

    // Remap across [startOffset, endOffset] if configured
    let progress = clampedProgress;
    if (endOffset > startOffset) {
      progress = (clampedProgress - startOffset) / (endOffset - startOffset);
      progress = Math.max(0, Math.min(1, progress));
    }

    scene.setExplosionFactor(progress);

    // Notify onActivePartChange only when the active part actually changes
    if (typeof onActivePartChange === 'function' && typeof scene.getActivePart === 'function') {
      const activePart = scene.getActivePart(progress);
      if (activePart && activePart.name !== lastActivePartName) {
        lastActivePartName = activePart.name;
        onActivePartChange(activePart);
      }
    }
  }

  function onScroll() {
    if (!isIntersecting) return;
    if (rafId !== null) return;

    // Throttle scroll events via requestAnimationFrame to prevent layout thrashing
    rafId = requestAnimationFrame(() => {
      rafId = null;
      update();
    });
  }

  // IntersectionObserver pauses calculation when the container is offscreen
  /** @type {IntersectionObserver | null} */
  let observer = null;
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(
      (entries) => {
        for (let i = 0; i < entries.length; i++) {
          isIntersecting = entries[i].isIntersecting;
          if (isIntersecting) {
            onScroll();
          }
        }
      },
      { rootMargin: '100px 0px 100px 0px' }
    );
    observer.observe(containerElement);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  // Compute initial state
  update();

  // Return teardown function for clean disposal
  return function cleanup() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };
}