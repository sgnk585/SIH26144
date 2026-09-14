/**
 * transducer-geometry.js
 *
 * SIH26144 Custom Infrasound Transducer — 3D Geometry Module
 *
 * Creates all physical components of the transducer using Three.js
 * primitives as placeholders. Geometry is modular — real GLB/glTF
 * files can replace individual components without changing animation.
 *
 * Based on engineering drawings (Ø50 mm variant):
 *   - Atmospheric inlet cap (Ø40 mm, 12 mm thick)
 *   - Diaphragm clamp ring (Ø35 mm OD, Ø28 mm ID, 5 mm)
 *   - Diaphragm disc (Ø35 mm, 100 μm Mylar)
 *   - Diaphragm chamber body (Ø45 mm, 25 mm)
 *   - Capillary tube (40 mm, 100 μm bore) — pneumatic resistance R
 *   - Sealed backing volume (Ø45 mm, 20 mm, 1 cm³) — pneumatic compliance C
 *   - Custom Differential Transducer (sensing core with two
 *     pneumatic ports: Port A → atmospheric side, Port B → backing-volume
 *     side; ΔP = PA − PB is read directly by the sensing core, not computed
 *     by subtracting two absolute sensors)
 *   - Outer enclosure / base (Ø50 mm)
 *   - Sealed wire lead-through ×1 (sensor power/signal), fill port
 *
 * Scale: 1 Three.js unit ≈ 20 mm
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// =========================================================================
// Configurable Dimensions (all display strings)
// =========================================================================

export const TRANSDUCER_DIMENSIONS = {
    overallDiameter:    'Ø50 mm',
    overallHeight:      '~75 mm',
    capDiameter:        'Ø40 mm',
    capHeight:          '12 mm',
    inletHoleDiameter:  'Ø4–6 mm',
    clampRingOD:        'Ø35 mm',
    clampRingID:        'Ø28 mm',
    clampRingHeight:    '5 mm',
    diaphragmDiameter:  '35 mm',
    diaphragmThickness: '100 μm',
    chamberDiameter:    'Ø45 mm',
    chamberHeight:      '25 mm',
    capillaryLength:    '40 mm',
    capillaryBore:      '100 μm',
    capillaryOD:        '~1.2 mm',
    backingVolumeDiam:  'Ø45 mm',
    backingVolumeHeight:'20 mm',
    backingVolumeVol:   '1000 mm³ (1 cm³)',
    baseDiameter:       'Ø50 mm',
};

// =========================================================================
// Material Palette — engineering / technical aesthetic
// =========================================================================

const MAT = {
    aluminum: () => new THREE.MeshStandardMaterial({
        color: 0xa8b8c4,
        metalness: 0.75,
        roughness: 0.28,
    }),
    aluminumDark: () => new THREE.MeshStandardMaterial({
        color: 0x6b7d8a,
        metalness: 0.70,
        roughness: 0.32,
    }),
    aluminumRim: () => new THREE.MeshStandardMaterial({
        color: 0x8a9baa,
        metalness: 0.80,
        roughness: 0.25,
    }),
    diaphragm: () => new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        metalness: 0.85,
        roughness: 0.22,
        emissive: 0x1a1204,
        side: THREE.DoubleSide,
    }),
    sensorPCB: () => new THREE.MeshStandardMaterial({
        color: 0x1a5c2a,
        metalness: 0.15,
        roughness: 0.70,
    }),
    sensorChip: () => new THREE.MeshStandardMaterial({
        color: 0x2a2e33,
        metalness: 0.50,
        roughness: 0.40,
    }),
    sensorPin: () => new THREE.MeshStandardMaterial({
        color: 0xc4a84a,
        metalness: 0.90,
        roughness: 0.15,
    }),
    rubber: () => new THREE.MeshStandardMaterial({
        color: 0x1a1d21,
        metalness: 0.05,
        roughness: 0.90,
    }),
    capillary: () => new THREE.MeshStandardMaterial({
        color: 0xd8e2ea,
        metalness: 0.90,
        roughness: 0.12,
        emissive: 0x0a1418,
    }),
    wireRed: () => new THREE.MeshStandardMaterial({
        color: 0xcc3333,
        metalness: 0.20,
        roughness: 0.60,
    }),
    wireBlack: () => new THREE.MeshStandardMaterial({
        color: 0x222222,
        metalness: 0.20,
        roughness: 0.60,
    }),
    housingTranslucent: () => new THREE.MeshPhysicalMaterial({
        color: 0x7b9aad,
        metalness: 0.12,
        roughness: 0.20,
        transmission: 0.55,
        transparent: true,
        opacity: 0.30,
        depthWrite: false,
        side: THREE.DoubleSide,
    }),
    backingTranslucent: () => new THREE.MeshPhysicalMaterial({
        color: 0x5c7a8a,
        metalness: 0.15,
        roughness: 0.25,
        transmission: 0.50,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
    }),
    epoxy: () => new THREE.MeshStandardMaterial({
        color: 0x3a3428,
        metalness: 0.10,
        roughness: 0.80,
    }),
};

// =========================================================================
// Geometry Helpers
// =========================================================================

/**
 * Creates an annular ring (flat washer shape) oriented along Y axis.
 */
function createRingGeometry(outerR, innerR, height, segments = 32) {
    const points = [
        new THREE.Vector2(innerR, -height / 2),
        new THREE.Vector2(outerR, -height / 2),
        new THREE.Vector2(outerR,  height / 2),
        new THREE.Vector2(innerR,  height / 2),
    ];
    return new THREE.LatheGeometry(points, segments);
}

// =========================================================================
// Component Factory Functions
// =========================================================================

/**
 * Atmospheric Inlet Cap — Ø40 mm, 12 mm thick
 * Central Ø4-6 mm through-hole (atmospheric inlet)
 */
function createAtmosphericCap() {
    const group = new THREE.Group();
    const meshes = [];

    // Main cap body — ring shape with central hole
    const bodyGeo = createRingGeometry(1.0, 0.12, 0.60, 36);
    const bodyMat = MAT.aluminum();
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);
    meshes.push(body);

    // Top beveled rim
    const topRimGeo = new THREE.TorusGeometry(1.0, 0.028, 12, 36);
    const rimMat = MAT.aluminumRim();
    const topRim = new THREE.Mesh(topRimGeo, rimMat);
    topRim.rotation.x = Math.PI / 2;
    topRim.position.y = 0.30;
    group.add(topRim);
    meshes.push(topRim);

    // Bottom rim
    const botRimGeo = new THREE.TorusGeometry(1.0, 0.028, 12, 36);
    const botRim = new THREE.Mesh(botRimGeo, rimMat);
    botRim.rotation.x = Math.PI / 2;
    botRim.position.y = -0.30;
    group.add(botRim);
    meshes.push(botRim);

    // Inlet hole raised collar at top
    const collarGeo = new THREE.TorusGeometry(0.14, 0.025, 12, 24);
    const collarMat = MAT.aluminumDark();
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.30;
    group.add(collar);
    meshes.push(collar);

    return { group, meshes };
}

/**
 * Custom Differential Transducer Module
 *
 * A single compact schematic placeholder package representing the
 * custom differential sensing core: body with two opposing pneumatic
 * ports (Port A → atmospheric/PA side, Port B → backing-volume/PB
 * side) and a row of electrical signal leads. This is a stand-in silhouette,
 * not a manufacturer CAD model — swap in a real GLB/STEP import later
 * without changing the animation/label wiring.
 */
function createCustomTransducerCore() {
    const group = new THREE.Group();
    const meshes = [];

    // Main plastic package body
    const bodyGeo = new THREE.BoxGeometry(0.55, 0.30, 0.40);
    const bodyMat = MAT.sensorChip();
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);
    meshes.push(body);

    // Small identifying top plate (lighter, reads as a label/marking area)
    const plateGeo = new THREE.BoxGeometry(0.40, 0.03, 0.28);
    const plateMat = MAT.sensorPCB();
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.y = 0.165;
    group.add(plate);
    meshes.push(plate);

    // Pressure Port 1 (atmospheric / PA) — nozzle on +X face
    const port1Geo = new THREE.CylinderGeometry(0.06, 0.06, 0.16, 16);
    const portMat = MAT.aluminumDark();
    const port1 = new THREE.Mesh(port1Geo, portMat);
    port1.rotation.z = Math.PI / 2;
    port1.position.set(0.35, 0.06, 0);
    group.add(port1);
    meshes.push(port1);

    // Pressure Port 2 (backing volume / PB) — nozzle on -X face
    const port2 = new THREE.Mesh(port1Geo.clone(), portMat);
    port2.rotation.z = Math.PI / 2;
    port2.position.set(-0.35, 0.06, 0);
    group.add(port2);
    meshes.push(port2);

    // Electrical leads (4 pins underneath, standard SIP-style row)
    const pinGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.18, 6);
    const pinMat = MAT.sensorPin();
    const pinXs = [-0.18, -0.06, 0.06, 0.18];
    for (const x of pinXs) {
        const pin = new THREE.Mesh(pinGeo, pinMat);
        pin.position.set(x, -0.24, 0);
        group.add(pin);
        meshes.push(pin);
    }

    return { group, meshes };
}

/**
 * Diaphragm Clamp Ring — Ø35 mm OD, Ø28 mm ID, 5 mm thick
 * With 4 alignment pin holes
 */
function createClampRing() {
    const group = new THREE.Group();
    const meshes = [];

    // Main ring body
    const ringGeo = createRingGeometry(0.875, 0.70, 0.25, 36);
    const ringMat = MAT.aluminum();
    const ring = new THREE.Mesh(ringGeo, ringMat);
    group.add(ring);
    meshes.push(ring);

    // Rim accents
    const rimMat = MAT.aluminumRim();
    const topRimGeo = new THREE.TorusGeometry(0.875, 0.018, 10, 36);
    const topRim = new THREE.Mesh(topRimGeo, rimMat);
    topRim.rotation.x = Math.PI / 2;
    topRim.position.y = 0.125;
    group.add(topRim);
    meshes.push(topRim);

    const botRimGeo = new THREE.TorusGeometry(0.875, 0.018, 10, 36);
    const botRim = new THREE.Mesh(botRimGeo, rimMat);
    botRim.rotation.x = Math.PI / 2;
    botRim.position.y = -0.125;
    group.add(botRim);
    meshes.push(botRim);

    // 4 alignment pin holes (visual only)
    const pinHoleGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.26, 8);
    const pinHoleMat = MAT.aluminumDark();
    for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI / 2) + Math.PI / 4;
        const r = 0.79;
        const hole = new THREE.Mesh(pinHoleGeo, pinHoleMat);
        hole.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
        group.add(hole);
        meshes.push(hole);
    }

    return { group, meshes };
}

/**
 * Diaphragm — Ø35 mm Mylar film, 100 μm thick
 * The most important visual element — gold/amber metallic disc
 */
function createDiaphragm() {
    const group = new THREE.Group();
    const meshes = [];

    // Main diaphragm disc — exaggerated to 0.015 units for visibility
    const discGeo = new THREE.CylinderGeometry(0.875, 0.875, 0.015, 48);
    const discMat = MAT.diaphragm();
    const disc = new THREE.Mesh(discGeo, discMat);
    group.add(disc);
    meshes.push(disc);

    // Subtle inner ring pattern (film tension zone)
    const innerRingGeo = new THREE.TorusGeometry(0.50, 0.008, 8, 36);
    const ringMat = new THREE.MeshStandardMaterial({
        color: 0xb8962e,
        metalness: 0.80,
        roughness: 0.30,
    });
    const innerRing = new THREE.Mesh(innerRingGeo, ringMat);
    innerRing.rotation.x = Math.PI / 2;
    innerRing.position.y = 0.009;
    group.add(innerRing);
    meshes.push(innerRing);

    return { group, meshes, disc }; // expose disc for deformation
}

/**
 * Diaphragm Chamber Body — Ø45 mm, 25 mm thick
 * Semi-transparent to show internal cavity
 */
function createChamberBody() {
    const group = new THREE.Group();
    const meshes = [];

    // Semi-transparent main shell
    const shellGeo = new THREE.CylinderGeometry(1.125, 1.125, 1.25, 40);
    const shellMat = MAT.housingTranslucent();
    const shell = new THREE.Mesh(shellGeo, shellMat);
    group.add(shell);
    meshes.push(shell);

    // Top flange (where clamp ring mates)
    const topFlangeGeo = new THREE.CylinderGeometry(1.18, 1.18, 0.06, 40);
    const flangeMat = MAT.aluminumRim();
    const topFlange = new THREE.Mesh(topFlangeGeo, flangeMat);
    topFlange.position.y = 0.625;
    group.add(topFlange);
    meshes.push(topFlange);

    // Bottom flange
    const botFlangeGeo = new THREE.CylinderGeometry(1.18, 1.18, 0.06, 40);
    const botFlange = new THREE.Mesh(botFlangeGeo, flangeMat);
    botFlange.position.y = -0.625;
    group.add(botFlange);
    meshes.push(botFlange);

    // Internal diaphragm cavity ring (darker inner wall visible through transparency)
    const cavityGeo = new THREE.CylinderGeometry(0.70, 0.70, 0.80, 32);
    const cavityMat = new THREE.MeshStandardMaterial({
        color: 0x3a4550,
        metalness: 0.40,
        roughness: 0.50,
        transparent: true,
        opacity: 0.25,
        side: THREE.BackSide,
    });
    const cavity = new THREE.Mesh(cavityGeo, cavityMat);
    cavity.position.y = 0.15;
    group.add(cavity);
    meshes.push(cavity);

    // Side port boss for capillary connection
    const bossGeo = new THREE.CylinderGeometry(0.10, 0.10, 0.14, 16);
    const bossMat = MAT.aluminumDark();
    const boss = new THREE.Mesh(bossGeo, bossMat);
    boss.rotation.z = Math.PI / 2;
    boss.position.set(1.20, -0.35, 0);
    group.add(boss);
    meshes.push(boss);

    return { group, meshes };
}

/**
 * Capillary Tube — 40 mm long, 100 μm bore, ~1.2 mm OD
 * Exaggerated radius for visibility. Routes along the side.
 */
function createCapillary() {
    const group = new THREE.Group();
    const meshes = [];

    const TUBE_X = 1.50;
    const TUBE_R = 0.035;
    const TUBE_LEN = 1.80;

    const tubeMat = MAT.capillary();

    // Main vertical capillary tube
    const tubeGeo = new THREE.CylinderGeometry(TUBE_R, TUBE_R, TUBE_LEN, 16);
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    tube.position.set(TUBE_X, 0, 0);
    group.add(tube);
    meshes.push(tube);

    // Top fitting (connects to chamber body port)
    const topFitGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.08, 16);
    const topFit = new THREE.Mesh(topFitGeo, tubeMat);
    topFit.position.set(TUBE_X, TUBE_LEN / 2 + 0.04, 0);
    group.add(topFit);
    meshes.push(topFit);

    // Horizontal elbow from chamber port to vertical tube
    const elbowLen = TUBE_X - 1.20;
    const elbowTopGeo = new THREE.CylinderGeometry(TUBE_R, TUBE_R, elbowLen, 12);
    const elbowTop = new THREE.Mesh(elbowTopGeo, tubeMat);
    elbowTop.rotation.z = Math.PI / 2;
    elbowTop.position.set(1.20 + elbowLen / 2, TUBE_LEN / 2 + 0.04, 0);
    group.add(elbowTop);
    meshes.push(elbowTop);

    // Bottom fitting (connects to backing volume)
    const botFitGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.08, 16);
    const botFit = new THREE.Mesh(botFitGeo, tubeMat);
    botFit.position.set(TUBE_X, -TUBE_LEN / 2 - 0.04, 0);
    group.add(botFit);
    meshes.push(botFit);

    // Horizontal elbow from vertical tube to backing volume port
    const elbowBotGeo = new THREE.CylinderGeometry(TUBE_R, TUBE_R, elbowLen, 12);
    const elbowBot = new THREE.Mesh(elbowBotGeo, tubeMat);
    elbowBot.rotation.z = Math.PI / 2;
    elbowBot.position.set(1.20 + elbowLen / 2, -TUBE_LEN / 2 - 0.04, 0);
    group.add(elbowBot);
    meshes.push(elbowBot);

    return { group, meshes };
}

/**
 * Sealed Backing Volume — Ø45 mm, 20 mm tall, 1000 mm³ cavity
 */
function createBackingVolume() {
    const group = new THREE.Group();
    const meshes = [];

    // Semi-transparent shell (tinted differently from chamber)
    const shellGeo = new THREE.CylinderGeometry(1.125, 1.125, 1.0, 40);
    const shellMat = MAT.backingTranslucent();
    const shell = new THREE.Mesh(shellGeo, shellMat);
    group.add(shell);
    meshes.push(shell);

    // Top endplate
    const topPlateGeo = new THREE.CylinderGeometry(1.18, 1.18, 0.06, 40);
    const plateMat = MAT.aluminumRim();
    const topPlate = new THREE.Mesh(topPlateGeo, plateMat);
    topPlate.position.y = 0.50;
    group.add(topPlate);
    meshes.push(topPlate);

    // Bottom endplate
    const botPlateGeo = new THREE.CylinderGeometry(1.18, 1.18, 0.06, 40);
    const botPlate = new THREE.Mesh(botPlateGeo, plateMat);
    botPlate.position.y = -0.50;
    group.add(botPlate);
    meshes.push(botPlate);

    // Port boss for capillary connection (top side)
    const bossGeo = new THREE.CylinderGeometry(0.10, 0.10, 0.14, 16);
    const bossMat = MAT.aluminumDark();
    const boss = new THREE.Mesh(bossGeo, bossMat);
    boss.rotation.z = Math.PI / 2;
    boss.position.set(1.20, 0.30, 0);
    group.add(boss);
    meshes.push(boss);

    return { group, meshes };
}

/**
 * Outer Enclosure / Base — Ø50 mm, with mounting feet
 */
function createOuterBase() {
    const group = new THREE.Group();
    const meshes = [];

    // Main base ring
    const baseGeo = createRingGeometry(1.25, 1.10, 0.50, 40);
    const baseMat = MAT.aluminumDark();
    const base = new THREE.Mesh(baseGeo, baseMat);
    group.add(base);
    meshes.push(base);

    // Bottom plate
    const platGeo = new THREE.CylinderGeometry(1.25, 1.25, 0.05, 40);
    const platMat = MAT.aluminum();
    const plat = new THREE.Mesh(platGeo, platMat);
    plat.position.y = -0.25;
    group.add(plat);
    meshes.push(plat);

    // 3 mounting feet (rubber)
    const footGeo = new THREE.CylinderGeometry(0.08, 0.10, 0.12, 12);
    const footMat = MAT.rubber();
    for (let i = 0; i < 3; i++) {
        const angle = (i * 2 * Math.PI / 3) + Math.PI / 6;
        const r = 1.05;
        const foot = new THREE.Mesh(footGeo, footMat);
        foot.position.set(
            Math.cos(angle) * r,
            -0.36,
            Math.sin(angle) * r
        );
        group.add(foot);
        meshes.push(foot);
    }

    return { group, meshes };
}

/**
 * Wire Lead-through (sealed gland)
 * @param {number} side — +1 or -1 for which side (left/right)
 */
function createWireFeedthrough(side) {
    const group = new THREE.Group();
    const meshes = [];

    // Gland body (rubber)
    const glandGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.22, 12);
    const glandMat = MAT.rubber();
    const gland = new THREE.Mesh(glandGeo, glandMat);
    gland.rotation.z = Math.PI / 2;
    group.add(gland);
    meshes.push(gland);

    // Gland collar
    const collarGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12);
    const collarMat = MAT.aluminumDark();
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.rotation.z = Math.PI / 2;
    collar.position.x = side * 0.08;
    group.add(collar);
    meshes.push(collar);

    // Wire segments (red + black)
    const wireGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.30, 6);
    const wireRed = new THREE.Mesh(wireGeo, MAT.wireRed());
    wireRed.rotation.z = Math.PI / 2;
    wireRed.position.set(side * 0.28, 0.025, 0);
    group.add(wireRed);
    meshes.push(wireRed);

    const wireBlack = new THREE.Mesh(wireGeo.clone(), MAT.wireBlack());
    wireBlack.rotation.z = Math.PI / 2;
    wireBlack.position.set(side * 0.28, -0.025, 0);
    group.add(wireBlack);
    meshes.push(wireBlack);

    return { group, meshes };
}

/**
 * Fill / Access Port — small epoxy-sealed cylindrical port
 */
function createFillPort() {
    const group = new THREE.Group();
    const meshes = [];

    // Port body
    const portGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10);
    const portMat = MAT.aluminumDark();
    const port = new THREE.Mesh(portGeo, portMat);
    port.rotation.z = Math.PI / 2;
    group.add(port);
    meshes.push(port);

    // Epoxy seal cap
    const sealGeo = new THREE.SphereGeometry(0.055, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const sealMat = MAT.epoxy();
    const seal = new THREE.Mesh(sealGeo, sealMat);
    seal.rotation.z = -Math.PI / 2;
    seal.position.x = 0.06;
    group.add(seal);
    meshes.push(seal);

    return { group, meshes };
}

// =========================================================================
// Component Registration — metadata for animation + labels
// =========================================================================

/**
 * @typedef {Object} TransducerComponent
 * @property {THREE.Group} group        — 3D group for positioning
 * @property {THREE.Mesh[]} meshes      — all meshes (for material manipulation)
 * @property {string} name              — identifier
 * @property {string} label             — display name
 * @property {string} sublabel          — secondary display text
 * @property {string} description       — long description
 * @property {string} assembly          — group: 'top','diaphragm','pneumatic','external'
 * @property {number} assembledY        — Y position when assembled
 * @property {number} explosionOffset   — Y offset when fully exploded
 * @property {number} animStart         — progress value when explosion begins [0..1]
 * @property {number} animEnd           — progress value when explosion ends [0..1]
 * @property {THREE.Vector3} labelAnchor— 3D label attachment point (local coords)
 */

/**
 * Creates all transducer geometry and returns the root group + component registry.
 *
 * @returns {{ root: THREE.Group, components: TransducerComponent[] }}
 */
export function createPlaceholderTransducerGeometry() {
    const root = new THREE.Group();
    root.name = 'TransducerRoot';

    // ---- create all components ----
    const cap = createAtmosphericCap();
    const clamp = createClampRing();
    const dia = createDiaphragm();
    const chamber = createChamberBody();
    const capillary = createCapillary();
    const backing = createBackingVolume();
    const sensor = createCustomTransducerCore();
    const base = createOuterBase();
    const wireA = createWireFeedthrough(+1);
    const fill = createFillPort();

    // ---- register with metadata ----
    const components = [
        {
            ...cap,
            name: 'atmosphericCap',
            label: 'ATMOSPHERIC INLET CAP',
            sublabel: 'PORT A',
            description: 'Machined aluminum cap with central Ø4–6 mm through-hole. Open to atmosphere — feeds the atmospheric pressure line to Custom Differential Transducer Port A.',
            assembly: 'top',
            assembledY: 1.65,
            explosionOffset: 2.4,
            animStart: 0.15,
            animEnd: 0.30,
            labelAnchor: new THREE.Vector3(1.1, 0.15, 0),
        },
        {
            ...clamp,
            name: 'clampRing',
            label: 'DIAPHRAGM CLAMP RING',
            sublabel: '',
            description: 'Annular ring (Ø35 mm OD, Ø28 mm ID) that secures the Mylar diaphragm between chambers. 4 alignment pins ensure concentricity.',
            assembly: 'diaphragm',
            assembledY: 1.07,
            explosionOffset: 1.5,
            animStart: 0.30,
            animEnd: 0.43,
            labelAnchor: new THREE.Vector3(-0.95, 0, 0),
        },
        {
            ...dia,
            name: 'diaphragm',
            label: 'DIAPHRAGM',
            sublabel: 'MYLAR FILM · 100 μm',
            description: 'Thin Mylar membrane (Ø35 mm, 100 μm). Deflects under differential pressure ΔP = PA − PB. The primary sensing element.',
            assembly: 'diaphragm',
            assembledY: 0.93,
            explosionOffset: 0.9,
            animStart: 0.33,
            animEnd: 0.46,
            labelAnchor: new THREE.Vector3(0.95, 0, 0),
        },
        {
            ...chamber,
            name: 'chamberBody',
            label: 'DIAPHRAGM CHAMBER',
            sublabel: '',
            description: 'Machined aluminum chamber body (Ø45 mm, 25 mm). Contains the diaphragm cavity (Ø28 mm) and side port for capillary tube.',
            assembly: 'diaphragm',
            assembledY: 0.20,
            explosionOffset: 0.25,
            animStart: 0.48,
            animEnd: 0.60,
            labelAnchor: new THREE.Vector3(-1.25, 0, 0),
        },
        {
            ...capillary,
            name: 'capillary',
            label: 'CAPILLARY',
            sublabel: 'PNEUMATIC RESISTANCE · R',
            description: 'Glass/metal tube (40 mm, 100 μm bore). Provides pneumatic resistance R in the RC high-pass filter. fc = 1/(2πRC).',
            assembly: 'pneumatic',
            assembledY: -0.25,
            explosionOffset: -1.2,
            animStart: 0.50,
            animEnd: 0.63,
            labelAnchor: new THREE.Vector3(1.65, 0, 0),
        },
        {
            ...backing,
            name: 'backingVolume',
            label: 'SEALED BACKING VOLUME',
            sublabel: 'PNEUMATIC COMPLIANCE · C',
            description: 'Sealed cavity (Ø45 mm, 1 cm³). Provides pneumatic compliance C. Larger volume → lower corner frequency fc.',
            assembly: 'pneumatic',
            assembledY: -1.00,
            explosionOffset: -2.2,
            animStart: 0.53,
            animEnd: 0.65,
            labelAnchor: new THREE.Vector3(-1.25, 0, 0),
        },
        {
            ...sensor,
            name: 'sensorCore',
            label: 'CUSTOM DIFFERENTIAL TRANSDUCER',
            sublabel: 'CUSTOM SENSING CORE',
            detail: [
                'PORT A · ATMOSPHERIC PRESSURE',
                'PORT B · REFERENCE PRESSURE',
                'ΔP = PA − PB',
            ],
            description: 'Custom differential pressure transducer core. Port A connects to the atmospheric (PA) line; Port B connects to the sealed backing volume (PB) line through the capillary network. Outputs ΔP = PA − PB directly — not two absolute sensors subtracted digitally.',
            assembly: 'pneumatic',
            assembledY: -0.55,
            explosionOffset: -2.6,
            animStart: 0.56,
            animEnd: 0.67,
            labelAnchor: new THREE.Vector3(0.6, 0.05, 0),
        },
        {
            ...base,
            name: 'outerBase',
            label: 'OUTER ENCLOSURE',
            sublabel: 'BASE',
            description: 'Weatherproof outer shell (Ø50 mm) with 3 mounting feet. Provides structural support and environmental protection.',
            assembly: 'external',
            assembledY: -1.75,
            explosionOffset: -3.0,
            animStart: 0.58,
            animEnd: 0.68,
            labelAnchor: new THREE.Vector3(-1.35, 0, 0),
        },
        {
            ...wireA,
            name: 'wireFeedthroughA',
            label: 'SEALED WIRE LEAD-THROUGH',
            sublabel: 'TO SENSING CORE',
            description: 'Rubber/epoxy gland providing sealed wire passage for the custom differential transducer signal leads. Maintains pressure seal on the backing-volume side.',
            assembly: 'external',
            assembledY: -0.65,
            explosionOffset: -2.2,
            animStart: 0.56,
            animEnd: 0.67,
            labelAnchor: new THREE.Vector3(0.4, 0, 0),
        },
        {
            ...fill,
            name: 'fillPort',
            label: 'FILL / ACCESS PORT',
            sublabel: 'EPOXY SEALED',
            description: 'Small access port on backing volume used for initial gas fill. Permanently epoxy-sealed after assembly.',
            assembly: 'external',
            assembledY: -0.80,
            explosionOffset: -1.8,
            animStart: 0.53,
            animEnd: 0.65,
            labelAnchor: new THREE.Vector3(0, 0, 1.25),
        },
    ];

    // ---- position wire feedthrough and fill port at sides ----
    wireA.group.position.set(1.15, 0, 0.40);
    fill.group.position.set(0, 0, 1.15);

    // ---- add all to root ----
    for (const comp of components) {
        comp.group.position.y = comp.assembledY;
        root.add(comp.group);
    }

    return { root, components };
}

/**
 * Future: load GLB/glTF CAD models.
 * Currently falls back to placeholder geometry.
 *
 * @returns {Promise<{ root: THREE.Group, components: TransducerComponent[] }>}
 */
export async function loadTransducerGeometry() {
    // TODO: When GLB files are available in assets/models/,
    // load them here and replace the corresponding component groups.
    // For now, use placeholder geometry.
    return createPlaceholderTransducerGeometry();
}

/**
 * Returns a flat array of component descriptors for external use.
 * Call after createPlaceholderTransducerGeometry().
 *
 * @param {TransducerComponent[]} components
 * @returns {TransducerComponent[]}
 */
export function registerTransducerComponents(components) {
    return components;
}
