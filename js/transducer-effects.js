/**
 * transducer-effects.js
 *
 * Provides particle flow visualization to represent pressure
 * movement in the pneumatic filter (PA -> PB).
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

export class TransducerEffects {
    constructor(scene, parts) {
        this.scene = scene;
        this.parts = parts;
        
        // Find capillary part
        this.capillary = this.parts.find(p => p.name === 'capillary');
        this.backingVolume = this.parts.find(p => p.name === 'backingVolume');
        
        this.particleSystem = null;
        this.isActive = false;
        
        this.createParticles();
    }
    
    createParticles() {
        const particleCount = 100;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];
        
        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 0.2;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 1.5;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
            
            velocities.push({
                y: -(Math.random() * 0.02 + 0.01) // Flowing downwards
            });
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const material = new THREE.PointsMaterial({
            color: 0x00d2ff,
            size: 0.05,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending
        });
        
        this.particleSystem = new THREE.Points(geometry, material);
        this.velocities = velocities;
        
        // Initially attach to capillary if found
        if (this.capillary) {
            this.capillary.group.add(this.particleSystem);
        } else {
            this.scene.scene.add(this.particleSystem);
        }
    }
    
    update(progress) {
        if (!this.particleSystem) return;
        
        // Only show particles during pneumatic network reveal (0.50-0.68) and physics explanation (0.84-0.94)
        const shouldBeActive = (progress > 0.48 && progress < 0.68) || (progress > 0.84 && progress < 0.94);
        
        if (shouldBeActive) {
            this.particleSystem.material.opacity = Math.min(1, this.particleSystem.material.opacity + 0.05);
            
            const positions = this.particleSystem.geometry.attributes.position.array;
            for (let i = 0; i < this.velocities.length; i++) {
                positions[i * 3 + 1] += this.velocities[i].y;
                
                // Reset to top if it falls below
                if (positions[i * 3 + 1] < -1.0) {
                    positions[i * 3 + 1] = 0.5;
                }
            }
            this.particleSystem.geometry.attributes.position.needsUpdate = true;
        } else {
            this.particleSystem.material.opacity = Math.max(0, this.particleSystem.material.opacity - 0.05);
        }
    }
}
