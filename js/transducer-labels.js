/**
 * transducer-labels.js
 *
 * Technical label system for the 3D transducer visualization.
 *
 * Renders each component as an engineering-drawing-style callout:
 * a title/sublabel block sitting in a fixed left/right column outside
 * the model, connected back to its actual 3D anchor point by an
 * elbowed leader line. Column placement is deterministic (assigned
 * once, at construction) and vertical stacking within a column is
 * resolved every frame with a minimum-gap declutter pass, so labels
 * never overlap regardless of how many components are active at once
 * during the explosion.
 *
 * A small formula panel is pinned to a reserved strip at the bottom of
 * the viewport (outside the label columns and off the 3D model) rather
 * than floating over the center of the assembly.
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// =========================================================================
// Layout constants (tune here, not per-callsite)
// =========================================================================

const LABEL_MIN_GAP = 38;        // minimum vertical px between stacked labels in a column
const LABEL_SIDE_MARGIN = 22;    // px from left/right edge of container to label text
const LABEL_TOP_MARGIN = 36;     // px safe top boundary for label stacking
const LABEL_BOTTOM_MARGIN = 100; // px safe bottom boundary — keeps labels clear of the formula panel strip; caption sits below this band
const LEADER_MIN_LENGTH = 26;    // minimum horizontal stub length of the leader line at the label end
const FORMULA_PANEL_HEIGHT = 84; // reserved formula-panel band height

export class TransducerLabels {
    constructor(scene, camera, containerElement, parts) {
        this.scene = scene;
        this.camera = camera;
        this.container = containerElement;
        this.parts = parts;

        this.labels = [];
        this.createDOM();
    }

    createDOM() {
        // Layer that hosts everything (labels, leader lines, formula panel)
        this.labelContainer = document.createElement('div');
        this.labelContainer.className = 'transducer-labels-layer';
        this.labelContainer.style.position = 'absolute';
        this.labelContainer.style.top = '0';
        this.labelContainer.style.left = '0';
        this.labelContainer.style.width = '100%';
        this.labelContainer.style.height = '100%';
        this.labelContainer.style.pointerEvents = 'none';
        this.labelContainer.style.overflow = 'hidden';
        this.container.appendChild(this.labelContainer);

        // SVG layer for leader lines — sits under the label text, above the canvas
        const svgNS = 'http://www.w3.org/2000/svg';
        this.leaderSvg = document.createElementNS(svgNS, 'svg');
        this.leaderSvg.setAttribute('class', 'tech-leader-svg');
        this.leaderSvg.style.position = 'absolute';
        this.leaderSvg.style.top = '0';
        this.leaderSvg.style.left = '0';
        this.leaderSvg.style.width = '100%';
        this.leaderSvg.style.height = '100%';
        this.leaderSvg.style.overflow = 'visible';
        this.labelContainer.appendChild(this.leaderSvg);

        // Add CSS rules dynamically
        const style = document.createElement('style');
        style.textContent = `
            .tech-label {
                position: absolute;
                transform: translateY(-50%);
                color: #ffffff;
                font-family: 'IBM Plex Mono', monospace;
                font-size: 11px;
                white-space: nowrap;
                opacity: 0;
                transition: opacity 0.3s ease, top 0.25s ease;
                pointer-events: none;
                z-index: 20;
                max-width: 44%;
                background: rgba(11, 14, 18, 0.90);
                border: 1px solid rgba(0, 210, 255, 0.22);
                border-radius: 4px;
                padding: 6px 12px;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55);
                backdrop-filter: blur(4px);
            }
            .tech-label.active {
                opacity: 1;
            }
            .tech-label.left-side {
                text-align: left;
                border-left: 2px solid #00d2ff;
            }
            .tech-label.right-side {
                text-align: right;
                border-right: 2px solid #00d2ff;
            }
            .tech-label-anchor-dot {
                position: absolute;
                width: 5px;
                height: 5px;
                margin: -2.5px 0 0 -2.5px;
                border-radius: 50%;
                background: #00d2ff;
                box-shadow: 0 0 6px rgba(0, 210, 255, 0.7);
                opacity: 0;
                transition: opacity 0.3s ease;
                pointer-events: none;
                z-index: 21;
            }
            .tech-label-anchor-dot.active {
                opacity: 1;
            }
            .tech-label-title {
                font-weight: 600;
                color: #00d2ff;
                letter-spacing: 0.05em;
                text-shadow: 0 0 8px rgba(0, 210, 255, 0.4);
                white-space: nowrap;
            }
            .tech-label-sub {
                font-size: 10px;
                color: #8a9baa;
                margin-top: 2px;
                white-space: nowrap;
            }
            .tech-label-detail {
                font-size: 9px;
                color: #6b7d8a;
                margin-top: 1px;
                white-space: nowrap;
            }
            .tech-leader-line {
                stroke: #00d2ff;
                stroke-width: 1;
                fill: none;
                opacity: 0;
                transition: opacity 0.3s ease;
            }
            .tech-leader-line.active {
                opacity: 0.55;
            }

            /* Formula panel — pinned strip above the caption box, never
               over the model and never sharing space with the caption. */
            .transducer-formula-panel {
                position: absolute;
                left: 24px;
                bottom: 175px;
                transform: none;
                display: flex;
                gap: 32px;
                align-items: flex-start;
                justify-content: flex-start;
                max-width: 560px;
                padding: 10px 20px;
                background: rgba(11, 12, 15, 0.82);
                border: 1px solid rgba(0, 210, 255, 0.25);
                border-radius: 6px;
                box-shadow: 0 0 16px rgba(0, 210, 255, 0.08);
                pointer-events: none;
                z-index: 30;
                opacity: 0;
                transition: opacity 0.3s ease;
            }
            .formula-block {
                font-family: 'IBM Plex Mono', monospace;
                text-align: left;
                display: none;
            }
            .formula-block.active {
                display: block;
            }
            .formula-block .formula-line {
                font-size: 10px;
                color: #8a9baa;
                letter-spacing: 0.03em;
                white-space: nowrap;
            }
            .formula-block .formula-eq {
                font-size: 15px;
                color: #00d2ff;
                font-weight: 500;
                white-space: nowrap;
            }
        `;
        document.head.appendChild(style);

        // ---- Create HTML elements for each part's label ----
        this.parts.forEach((part, index) => {
            // fillPort label suppressed — too visually cluttered at this scale
            if (part.name === 'fillPort') return;

            const el = document.createElement('div');
            // Side assignment is computed once here and never changes for
            // the lifetime of the label — stable left/right assignment.
            const isRightSide = index % 2 === 0;
            el.className = `tech-label ${isRightSide ? 'right-side' : 'left-side'}`;

            const content = document.createElement('div');
            content.className = 'tech-label-content';

            const title = document.createElement('div');
            title.className = 'tech-label-title';
            title.textContent = part.label;
            content.appendChild(title);

            if (part.sublabel) {
                const sub = document.createElement('div');
                sub.className = 'tech-label-sub';
                sub.textContent = part.sublabel;
                content.appendChild(sub);
            }

            if (Array.isArray(part.detail)) {
                for (const line of part.detail) {
                    const d = document.createElement('div');
                    d.className = 'tech-label-detail';
                    d.textContent = line;
                    content.appendChild(d);
                }
            }

            el.appendChild(content);
            this.labelContainer.appendChild(el);

            // Small glowing dot marking the actual anchor point on the model
            const dot = document.createElement('div');
            dot.className = 'tech-label-anchor-dot';
            this.labelContainer.appendChild(dot);

            // Leader line (SVG polyline: anchor -> elbow -> label edge)
            const svgNS2 = 'http://www.w3.org/2000/svg';
            const line = document.createElementNS(svgNS2, 'polyline');
            line.setAttribute('class', 'tech-leader-line');
            this.leaderSvg.appendChild(line);

            const anchor = part.labelAnchor || new THREE.Vector3(1.5, 0, 0);

            this.labels.push({
                element: el,
                dot,
                line,
                part,
                anchor,
                isRightSide,
                // last resolved Y, kept across frames so the declutter
                // pass has a stable starting point rather than jumping.
                resolvedY: null,
            });
        });

        // ---- Formula panel (fixed bottom strip, off the model) ----
        this.formulaPanel = document.createElement('div');
        this.formulaPanel.className = 'transducer-formula-panel';
        // Append to transducer-pinned (full-viewport div) so left: 24px
        // matches the caption box coordinate space, not the canvas container.
        const pinnedEl = this.container.closest('.transducer-pinned') || this.container.parentElement;
        pinnedEl.appendChild(this.formulaPanel);

        // ΔP block
        this.formulaDP = document.createElement('div');
        this.formulaDP.className = 'formula-block';
        this.formulaDP.innerHTML = `
            <div class="formula-line">DIFFERENTIAL PRESSURE (CUSTOM TRANSDUCER)</div>
            <div class="formula-eq">&Delta;P = P<sub>A</sub> &minus; P<sub>B</sub></div>
        `;
        this.formulaPanel.appendChild(this.formulaDP);

        // R/C/fc block
        this.formulaRC = document.createElement('div');
        this.formulaRC.className = 'formula-block';
        this.formulaRC.innerHTML = `
            <div class="formula-line">CAPILLARY &middot; PNEUMATIC RESISTANCE R</div>
            <div class="formula-line">BACKING VOLUME &middot; PNEUMATIC COMPLIANCE C</div>
            <div class="formula-eq">f<sub>c</sub> = 1 / (2&pi;RC)</div>
        `;
        this.formulaPanel.appendChild(this.formulaRC);
    }

    /**
     * Lays out a column of labels with dynamic, bounding-box-aware collision
     * avoidance. Measures or estimates the real rendered height of each label
     * (accounting for multi-line detail panels like the custom transducer core)
     * and shifts labels apart so:
     *   1. No two label cards overlap vertically
     *   2. A clean minimum clearance gap is maintained between bounding boxes
     *   3. All labels remain inside safe vertical bounds [topBound, bottomBound]
     */
    _resolveColumn(items, topBound, bottomBound) {
        if (items.length === 0) return;

        // 1. Measure or fallback-estimate heights for each active label
        for (const item of items) {
            const el = item.element;
            const h = el ? (el.offsetHeight || 0) : 0;
            if (h > 0) {
                item.height = h;
            } else if (!item.height) {
                // Approximate height if DOM isn't rendered yet
                const lineCount = 1 + (item.part.sublabel ? 1 : 0) + (Array.isArray(item.part.detail) ? item.part.detail.length : 0);
                item.height = 24 + lineCount * 15 + 14;
            }
            item.halfHeight = item.height / 2;
        }

        // 2. Sort by natural 3D anchor targetY
        items.sort((a, b) => a.targetY - b.targetY);

        const n = items.length;
        if (n === 1) {
            items[0].resolvedY = Math.max(
                topBound + items[0].halfHeight,
                Math.min(bottomBound - items[0].halfHeight, items[0].targetY)
            );
            return;
        }

        // 3. Determine clearance gap between adjacent label bounding boxes
        let gap = 16;
        let totalRequiredHeight = 0;
        for (let i = 0; i < n; i++) {
            totalRequiredHeight += items[i].height;
            if (i > 0) totalRequiredHeight += gap;
        }
        const availableSpan = bottomBound - topBound;
        if (totalRequiredHeight > availableSpan && n > 1) {
            // Compress gap smoothly if vertical space is constrained, min 4px
            gap = Math.max(4, (availableSpan - (totalRequiredHeight - (n - 1) * gap)) / (n - 1));
        }

        // 4. Forward pass: place each label with required clearance
        items[0].resolvedY = Math.max(topBound + items[0].halfHeight, items[0].targetY);
        for (let i = 1; i < n; i++) {
            const minCenterDist = items[i - 1].halfHeight + items[i].halfHeight + gap;
            items[i].resolvedY = Math.max(items[i].targetY, items[i - 1].resolvedY + minCenterDist);
        }

        // 5. Backward pass: if bottom-most label overflows bottomBound, push up
        if (items[n - 1].resolvedY + items[n - 1].halfHeight > bottomBound) {
            items[n - 1].resolvedY = bottomBound - items[n - 1].halfHeight;
            for (let i = n - 2; i >= 0; i--) {
                const minCenterDist = items[i].halfHeight + items[i + 1].halfHeight + gap;
                items[i].resolvedY = Math.min(items[i].resolvedY, items[i + 1].resolvedY - minCenterDist);
            }
        }

        // 6. Secondary forward pass: ensure nothing was pushed above topBound
        if (items[0].resolvedY - items[0].halfHeight < topBound) {
            items[0].resolvedY = topBound + items[0].halfHeight;
            for (let i = 1; i < n; i++) {
                const minCenterDist = items[i - 1].halfHeight + items[i].halfHeight + gap;
                if (items[i].resolvedY < items[i - 1].resolvedY + minCenterDist) {
                    items[i].resolvedY = items[i - 1].resolvedY + minCenterDist;
                }
            }
        }
    }

    /**
     * Builds an elbowed leader line connecting the projected 3D anchor to the
     * INNER edge of the label card facing the model.
     *
     * Stops before penetrating the label card text so connector lines never
     * slice through or strike through any callout text.
     */
    _buildLeaderPath(anchorX, anchorY, labelY, isRightSide, width, labelWidth) {
        const padding = 5;
        const stubLength = LEADER_MIN_LENGTH;

        if (isRightSide) {
            // Label sits against the right side.
            // Inner edge facing the model is at: width - LABEL_SIDE_MARGIN - labelWidth
            const cardInnerX = width - LABEL_SIDE_MARGIN - labelWidth;
            const endX = cardInnerX - padding;
            // Elbow sits toward the model, between anchorX and endX
            const elbowX = Math.min(endX - stubLength, Math.max(anchorX + 15, endX - stubLength * 1.5));
            return `${anchorX.toFixed(1)},${anchorY.toFixed(1)} ${elbowX.toFixed(1)},${labelY.toFixed(1)} ${endX.toFixed(1)},${labelY.toFixed(1)}`;
        } else {
            // Label sits against the left side.
            // Inner edge facing the model is at: LABEL_SIDE_MARGIN + labelWidth
            const cardInnerX = LABEL_SIDE_MARGIN + labelWidth;
            const endX = cardInnerX + padding;
            // Elbow sits toward the model, between anchorX and endX
            const elbowX = Math.max(endX + stubLength, Math.min(anchorX - 15, endX + stubLength * 1.5));
            return `${anchorX.toFixed(1)},${anchorY.toFixed(1)} ${elbowX.toFixed(1)},${labelY.toFixed(1)} ${endX.toFixed(1)},${labelY.toFixed(1)}`;
        }
    }

    update(progress) {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (!width || !height) return;

        const halfWidth = width / 2;
        const halfHeight = height / 2;

        const topBound = LABEL_TOP_MARGIN;

        // Right side has no formula panel or caption, so can use generous bottom bound.
        const rightBottomBound = Math.max(topBound + 60, height - 60);

        // Left side accommodates the bottom caption panel and pinned formula panel.
        const showDP = (progress > 0.35 && progress < 0.48) || (progress > 0.84 && progress < 0.94);
        const showRC = (progress > 0.55 && progress < 0.65) || (progress > 0.84 && progress < 0.94);
        const leftBottomMargin = (showDP || showRC) ? 275 : 150;
        const leftBottomBound = Math.max(topBound + 60, height - leftBottomMargin);

        const leftColumn = [];
        const rightColumn = [];

        // 1. Determine visibility + project anchors for every label
        for (const label of this.labels) {
            let isVisible = false;
            if (progress >= label.part.animStart && progress <= 0.84) {
                isVisible = true;
            }
            if (progress > 0.84) {
                isVisible = false;
            }

            if (!isVisible) {
                label.element.classList.remove('active');
                label.dot.classList.remove('active');
                label.line.classList.remove('active');
                continue;
            }

            const pos = label.anchor.clone();
            pos.applyMatrix4(label.part.group.matrixWorld);
            pos.project(this.camera);

            if (pos.z > 1) {
                // Behind the camera — treat as not visible this frame
                label.element.classList.remove('active');
                label.dot.classList.remove('active');
                label.line.classList.remove('active');
                continue;
            }

            const anchorX = (pos.x * halfWidth) + halfWidth;
            const anchorY = -(pos.y * halfHeight) + halfHeight;

            label._anchorX = anchorX;
            label._anchorY = anchorY;
            label.targetY = anchorY;

            if (label.isRightSide) {
                rightColumn.push(label);
            } else {
                leftColumn.push(label);
            }
        }

        // 2. Resolve vertical collisions independently per column
        this._resolveColumn(leftColumn, topBound, leftBottomBound);
        this._resolveColumn(rightColumn, topBound, rightBottomBound);

        // 3. Apply positions + leader lines for all visible labels
        for (const label of [...leftColumn, ...rightColumn]) {
            if (label.isRightSide) {
                label.element.style.right = `${LABEL_SIDE_MARGIN}px`;
                label.element.style.left = 'auto';
            } else {
                label.element.style.left = `${LABEL_SIDE_MARGIN}px`;
                label.element.style.right = 'auto';
            }
            label.element.style.top = `${label.resolvedY}px`;
            label.element.classList.add('active');

            // Anchor dot at the actual 3D projected point
            label.dot.style.left = `${label._anchorX}px`;
            label.dot.style.top = `${label._anchorY}px`;
            label.dot.classList.add('active');

            // Determine card width for leader line connection
            const labelWidth = label.element.offsetWidth || (label.part.label.length * 8 + 36);

            // Leader line from anchor -> elbow -> inner card edge
            const pathPoints = this._buildLeaderPath(
                label._anchorX, label._anchorY,
                label.resolvedY, label.isRightSide, width, labelWidth
            );
            label.line.setAttribute('points', pathPoints);
            label.line.classList.add('active');
        }

        // 4. Formula panel — same animation-phase windows as before,
        //    rendered in the reserved bottom strip.
        this.formulaDP.classList.toggle('active', showDP);
        this.formulaRC.classList.toggle('active', showRC);
        this.formulaPanel.style.opacity = (showDP || showRC) ? '1' : '0';
    }

    dispose() {
        if (this.labelContainer && this.labelContainer.parentNode) {
            this.labelContainer.parentNode.removeChild(this.labelContainer);
        }
    }
}

// Exported for reuse/testing of layout constants elsewhere if ever needed.
export const TRANSDUCER_LABEL_LAYOUT = {
    LABEL_MIN_GAP,
    LABEL_SIDE_MARGIN,
    LABEL_TOP_MARGIN,
    LABEL_BOTTOM_MARGIN,
    LEADER_MIN_LENGTH,
    FORMULA_PANEL_HEIGHT,
};