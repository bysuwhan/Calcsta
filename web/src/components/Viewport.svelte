<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './ribbon/Icon.svelte';
  import { blockUI } from '../lib/store/blocks.svelte';
  import { sketchUI } from '../lib/store/sketch.svelte';
  import { closedElementLoops, resolveNodeRef, localToWorld, worldToLocal } from '../lib/model/blocks';
  import { t } from '../lib/i18n';
  import { modelStore, uiStore, resultsStore, historyStore, dsmStepsStore } from '../lib/store';
  import { TWO_D_HORIZONTAL_AXIS_LABEL, TWO_D_VERTICAL_AXIS_LABEL, TWO_D_DISPLACEMENT_LABELS, get2DDisplayDisplacementVertical, get2DDisplayedVertical } from '../lib/geometry/coordinate-system';
  import { projectNode, to3D } from '../lib/geometry/plane-projection';
  import { drawDiagrams, drawEnvelopeDiagrams, computeDiagramGlobalMax, displayedDiagramScale, setDiagramUnitSystem, type DiagramKind } from '../lib/canvas/draw-diagrams';
  import { computeDiagramValueAt, computeDisplacementAt } from '../lib/engine/diagrams';
  import { effectiveBendingInertia } from '../lib/engine/solver-service';
  import { computeLocalAxes3D } from '../lib/engine/local-axes-3d';
  import { drawDeformed, drawDeformedCylinder } from '../lib/canvas/draw-deformed';
  import { drawDespiece, despieceElementSpan, remapLoadSpanToShrunk, distributedResultantVector, DESPIECE_LOAD_COLOR } from '../lib/canvas/draw-despiece';
  import { drawDistributedLoads, drawPointLoadsOnElements, drawMovingLoadAxles, drawMomentSymbol } from '../lib/canvas/draw-loads';
  import { createLabelCollector, type LabelCollector } from '../lib/canvas/label-layout';
  import { computeAxleWorldPositions } from '../lib/engine/moving-loads';
  import { drawInfluenceLine } from '../lib/canvas/draw-influence';
  import { drawModeShape, drawPlasticHinges } from '../lib/canvas/draw-modes';
  import { computeElementStress } from '../lib/store/results.svelte';
  import { colourScaleSource } from '../lib/store/result-view';
  import { colourRampCss, colourMapUnit } from '../lib/canvas/colour-ramp';
  import { elementLoadDirection, nodalLoadComponents, requiresElementAxis } from '../lib/viewport/load-direction';
  import {
    drawGrid as _drawGrid,
    drawAxes as _drawAxes,
    AXES_GIZMO_HEIGHT,
    drawNode as _drawNode,
    drawElement as _drawElement,
    drawCylinderLoad as _drawCylinderLoad,
    drawSupport as _drawSupport,
    drawNodalLoad as _drawNodalLoad,
    drawReactions as _drawReactions,
    drawConstraintForces as _drawConstraintForces,
    drawTooltip as _drawTooltip,
    type DrawElementOpts,
    type ReactionData,
    type ConstraintForceData,
  } from '../lib/viewport/draw-entities';
  import {
    findNearestNode as _findNearestNode,
    findNearestNodeScreen as _findNearestNodeScreen,
    NODE_PICK_RADIUS_PX,
    ELEMENT_PICK_RADIUS_PX,
    ATTACHMENT_PICK_RADIUS_PX,
    findNearestElement as _findNearestElement,
    findNearestSupport as _findNearestSupport,
    findNearestMidpoint as _findNearestMidpoint,
    findAllLoadsNear as _findAllLoadsNear,
    snapWithMidpoint as _snapWithMidpoint,
  } from '../lib/viewport/spatial-queries';
  import { boxSelect as boxSelectTargets, normaliseDrag, type BoxSelectMode } from '../lib/viewport/box-select';
  import { shouldShowNodeHoverHighlight } from '../lib/viewport/node-hover';
  import { exceedsNodeDragThreshold } from '../lib/viewport/node-drag';
  import { canvasTheme } from '../lib/canvas/theme';
  import { toDisplay, fromDisplay, unitLabel } from '../lib/utils/units';
  import { angleDimensionSector, type SmartDimension } from '../lib/model/sketch-constraints';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let width = 800;
  let height = 600;
  let initialCameraPositioned = false;

  $effect(() => { modelStore.blocks; modelStore.editingBlockId; modelStore.blockPreview; blockUI.selected; blockUI.command; invalidate(); });

  // Pan state
  let isPanning = false;
  let pointerInside = false;
  let panStartX = 0;
  let panStartY = 0;

  // Element creation chain mode
  let pendingNode: { x: number; y: number; id?: number } | null = null;
  let pendingCreatedNodeId: number | null = null;
  let pendingCylinderNodeId: number | null = null;

  function cancelElementCreation() {
    if (pendingCreatedNodeId !== null && modelStore.isNodeOrphaned(pendingCreatedNodeId)) {
      modelStore.removeNode(pendingCreatedNodeId);
    }
    pendingCreatedNodeId = null;
    pendingNode = null;
  }

  // Node drag state
  let draggedNodeId: number | null = null;
  let dragMoved = false;
  let dragStartWorld: { x: number; y: number } | null = null;
  let dragStartScreen: { x: number; y: number } | null = null;
  let draggedBlockId: number | null = null;
  let blockDragMoved = false;
  let blockDragStartScreen: { x: number; y: number } | null = null;
  let blockDragStart: { pointer: { x: number; y: number }; pose: { x: number; y: number; angle: number } } | null = null;
  let blockDragPose: { x: number; y: number; angle: number } | null = null;
  let blockDragGripTarget: { x: number; y: number } | null = null;
  let blockDragSourceNodeId: number | null = null;
  let blockDragTargetNodeId: number | null = null;

  // Box selection state
  let boxSelect: { startX: number; startY: number; endX: number; endY: number } | null = null;

  // A dimension is selected and dragged only by its text, just like a CAD
  // sketch annotation. Witness and dimension lines deliberately have no hits.
  let draggedDimensionId: number | null = null;
  let dimensionDragMoved = false;
  let dimensionDragOffset = { x: 0, y: 0 };
  let dimensionDragPosition: { x: number; y: number } | null = null;
  let dimensionEditor = $state<{ id: number; x: number; y: number; value: number; angular: boolean; readOnly: boolean } | null>(null);
  let nodeConnectionEditor = $state<{ id: number; x: number; y: number; nodeX: number; nodeY: number; mode: 'hinge' | 'rigid' } | null>(null);
  let cylinderEditor = $state<{ id: number; x: number; y: number; force: number } | null>(null);
  let dimensionInput = $state<HTMLInputElement>();
  const dimensionLabelHits = new Map<number, { x1: number; y1: number; x2: number; y2: number }>();
  const dimensionDisplayedValues = new Map<number, number>();

  $effect(() => {
    if (dimensionEditor) void tick().then(() => { dimensionInput?.focus(); dimensionInput?.select(); });
  });

  function dimensionAtScreen(x: number, y: number): number | null {
    for (const [id, box] of [...dimensionLabelHits].reverse()) {
      if (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2) return id;
    }
    return null;
  }

  function commitDimensionEdit() {
    if (!dimensionEditor) return;
    const raw = dimensionEditor.value;
    const value = dimensionEditor.angular
      ? raw * Math.PI / 180
      : fromDisplay(raw, 'length', uiStore.unitSystem);
    if (modelStore.editDimension(dimensionEditor.id, value, dimensionEditor.readOnly)) dimensionEditor = null;
    else uiStore.toast(t('sketch.conflict'), 'error');
    invalidate();
  }

  function commitNodeConnectionEdit() {
    if (!nodeConnectionEditor) return;
    const node = modelStore.getNode(nodeConnectionEditor.id);
    const x = fromDisplay(nodeConnectionEditor.nodeX, 'length', uiStore.unitSystem);
    const y = fromDisplay(nodeConnectionEditor.nodeY, 'length', uiStore.unitSystem);
    if (!node || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!blockUI.moveNodeTo(nodeConnectionEditor.id, { x, y })) {
      if (Math.abs(node.x - x) > 1e-10 || Math.abs(node.y - y) > 1e-10) {
        historyStore.pushState();
        modelStore.updateNode(nodeConnectionEditor.id, x, y);
      }
      modelStore.setNodeHinge(nodeConnectionEditor.id, nodeConnectionEditor.mode === 'hinge');
    }
    resultsStore.clear();
    nodeConnectionEditor = null;
    invalidate();
  }

  function commitCylinderEdit() {
    if (!cylinderEditor || !Number.isFinite(cylinderEditor.force)) return;
    modelStore.updateLoad(cylinderEditor.id, { force: fromDisplay(cylinderEditor.force, 'force', uiStore.unitSystem) });
    resultsStore.clear();
    cylinderEditor = null;
    invalidate();
  }

  // Diagram query state (click on diagram to see value)
  let diagramQuery: { elementId: number; t: number; value: number; worldX: number; worldY: number } | null = null;

  // Diagram hover state (real-time value as mouse moves)
  let diagramHover: { elementId: number; t: number; value: number; worldX: number; worldY: number; label?: string; unit?: string; lines?: string[] } | null = null;

  // Clear pending node when tool changes away from element
  $effect(() => {
    if (uiStore.currentTool !== 'element') {
      cancelElementCreation();
    }
    if (uiStore.currentTool !== 'cylinder') pendingCylinderNodeId = null;
    if (uiStore.elementMode !== 'create') uiStore.elementMode = 'create';
    // Joint placement no longer lives in the point tool. Point connection
    // properties are edited by double-clicking the point in Select mode.
    if (uiStore.nodeMode !== 'create') uiStore.nodeMode = 'create';
    if (uiStore.currentTool !== 'dimension') sketchUI.cancel();
    if (uiStore.currentTool !== 'select') {
      uiStore.clearSelectedDimension();
      dimensionEditor = null;
      nodeConnectionEditor = null;
      cylinderEditor = null;
    }
  });
  // Clear selected supports/loads when switching away from select tool
  $effect(() => {
    if (uiStore.currentTool !== 'select') {
      uiStore.clearSelectedSupports();
      uiStore.clearSelectedLoads();
    }
  });

  // Clear diagram query/hover when results or diagram type changes
  $effect(() => {
    resultsStore.diagramType;
    resultsStore.results;
    diagramQuery = null;
    diagramHover = null;
  });

  // Clear stressQuery when leaving stress mode; auto-switch to elements if results cleared
  $effect(() => {
    if (uiStore.selectMode !== 'stress') {
      resultsStore.stressQuery = null;
    }
  });
  $effect(() => {
    if (!resultsStore.results && uiStore.selectMode === 'stress' && !uiStore.liveCalc) {
      uiStore.selectMode = 'elements';
    }
  });

  /** Project a 3D node to the selected 2D drawing plane using central helpers. */
  function project2DNode(node: { id: number; x: number; y: number; z?: number }): { id: number; x: number; y: number; z?: number } {
    return projectNode(uiStore.drawPlane2D, node);
  }

  /** Get a node projected to the current 2D drawing plane. */
  function getProjectedNode(id: number) {
    const n = modelStore.getNode(id);
    return n ? project2DNode(n) : undefined;
  }

  // ── Invalidation-based rendering ──────────────────────────────
  // Instead of running requestAnimationFrame every frame, we only redraw
  // when state changes (invalidate()) or when an animation is active.
  let needsRedraw = true;
  let animating = false;
  let rafId: number | null = null;
  const DESPIECE_ANIM_MS = 700;   // one-shot pull-apart duration for the despiece view
  let despieceStart = 0;

  function invalidate() {
    if (!needsRedraw) {
      needsRedraw = true;
      if (rafId === null) {
        rafId = requestAnimationFrame(drawOnce);
      }
    }
  }

  function drawOnce() {
    rafId = null;
    if (!needsRedraw && !animating && !uiStore.continuousRendering) return;
    needsRedraw = false;
    draw();
    // Re-evaluate so time-based one-shot animations (e.g. despiece pull-apart) settle and stop.
    updateAnimating();

    if (animating || uiStore.continuousRendering) {
      rafId = requestAnimationFrame(drawOnce);
    }
  }

  /** Recalculate whether continuous animation is needed and start/stop the loop. */
  function updateAnimating() {
    const wasAnimating = animating;
    animating =
      (resultsStore.ilAnimating && !!resultsStore.influenceLine) ||
      (resultsStore.animateDeformed && resultsStore.diagramType === 'deformed' && !!resultsStore.results) ||
      (resultsStore.diagramType === 'modeShape' && !!resultsStore.modalResult) ||
      (resultsStore.diagramType === 'bucklingMode' && !!resultsStore.bucklingResult) ||
      (resultsStore.diagramType === 'despiece' && !!resultsStore.results && (performance.now() - despieceStart) < DESPIECE_ANIM_MS);
    // If we just became animating, kick the loop
    if ((animating || uiStore.continuousRendering) && !wasAnimating && rafId === null) {
      rafId = requestAnimationFrame(drawOnce);
    }
  }

  // ── Reactive effects that trigger invalidation ──────────────────

  // Model data changes
  $effect(() => { modelStore.nodes; modelStore.elements; invalidate(); });
  $effect(() => { modelStore.supports; invalidate(); });
  $effect(() => { modelStore.loads; invalidate(); });
  $effect(() => { modelStore.materials; modelStore.sections; invalidate(); });

  // Results changes
  $effect(() => { resultsStore.results; resultsStore.diagramType; invalidate(); });
  // Despiece: restart the pull-apart animation whenever the view (re)activates.
  $effect(() => {
    if (resultsStore.diagramType === 'despiece') {
      despieceStart = performance.now();
      updateAnimating();
      invalidate();
    } else if (uiStore.despieceInspect) {
      uiStore.despieceInspect = null; // clear stale inspection when leaving despiece
    }
  });
  $effect(() => { resultsStore.deformedScale; resultsStore.diagramScale; invalidate(); });
  $effect(() => { resultsStore.showDiagramValues; resultsStore.drawPositiveTowardLocalAxes; invalidate(); });
  $effect(() => { resultsStore.colorMapKind; invalidate(); });
  $effect(() => { resultsStore.showReactions; resultsStore.showConstraintForces; invalidate(); });
  // Despiece controls must redraw the canvas immediately (no mouse-move needed).
  $effect(() => {
    uiStore.despieceVectorMode; uiStore.despieceBasis;
    uiStore.despieceVectorSize; uiStore.despieceLabelSize;
    uiStore.despieceCombineVectors; uiStore.despieceLoadMode;
    uiStore.despieceInspect;
    invalidate();
  });
  $effect(() => { resultsStore.influenceLine; invalidate(); });
  $effect(() => { resultsStore.overlayResults; resultsStore.overlayLabel; invalidate(); });
  $effect(() => { resultsStore.movingLoadEnvelope; resultsStore.activeMovingLoadPosition; resultsStore.movingLoadShowEnvelope; invalidate(); });
  $effect(() => { resultsStore.modalResult; resultsStore.activeModeIndex; invalidate(); });
  $effect(() => { resultsStore.bucklingResult; resultsStore.activeBucklingMode; invalidate(); });
  $effect(() => { resultsStore.plasticResult; resultsStore.plasticStep; invalidate(); });
  $effect(() => { resultsStore.stressQuery; invalidate(); });
  $effect(() => { resultsStore.envelope; invalidate(); });

  // Animation state changes need both invalidate and loop management
  $effect(() => {
    resultsStore.ilAnimating;
    resultsStore.animateDeformed;
    resultsStore.animSpeed;
    resultsStore.diagramType;
    resultsStore.modalResult;
    resultsStore.bucklingResult;
    updateAnimating();
    invalidate();
  });

  // UI state changes
  $effect(() => { uiStore.selectedNodes; uiStore.selectedElements; invalidate(); });
  $effect(() => { uiStore.selectedLoads; uiStore.selectedSupports; invalidate(); });
  $effect(() => { uiStore.zoom; uiStore.panX; uiStore.panY; invalidate(); });
  $effect(() => { uiStore.showGrid; uiStore.showAxes; uiStore.showLoads; invalidate(); });
  $effect(() => { uiStore.showNodeLabels; uiStore.showElementLabels; uiStore.showLengths; invalidate(); });
  $effect(() => { uiStore.elementColorMode; invalidate(); });
  $effect(() => { uiStore.localAxesMode3D; uiStore.elementSelectionManual; invalidate(); });
  $effect(() => { uiStore.hideLoadsWithDiagram; invalidate(); });
  $effect(() => { uiStore.currentTool; invalidate(); });
  $effect(() => { uiStore.gridSize; uiStore.snapToGrid; invalidate(); });
  $effect(() => { uiStore.selectMode; invalidate(); });
  $effect(() => { uiStore.drawPlane2D; invalidate(); });
  $effect(() => { uiStore.unitSystem; uiStore.stressUnit; invalidate(); });

  // Continuous rendering toggle
  $effect(() => {
    uiStore.continuousRendering;
    updateAnimating();
    invalidate();
  });

  // Draw context helper for canvas renderers
  function makeDrawContext() {
    return {
      ctx: ctx!,
      worldToScreen: (wx: number, wy: number) => uiStore.worldToScreen(wx, wy),
      getNode: (id: number) => { const n = modelStore.getNode(id); return n ? project2DNode(n) : undefined; },
      getElement: (id: number) => {
        const elem = modelStore.elements.get(id);
        return elem ? { nodeI: elem.nodeI, nodeJ: elem.nodeJ, materialId: elem.materialId, sectionId: elem.sectionId } : undefined;
      },
      getMaterial: (id: number) => {
        const mat = modelStore.materials.get(id);
        return mat ? { e: mat.e } : undefined;
      },
      getSection: (id: number) => {
        const sec = modelStore.sections.get(id);
        // 2D bending uses effective inertia (accounts for section rotation via Mohr)
        return sec ? { iz: effectiveBendingInertia(sec) } : undefined;
      },
      /*
       * Every member on screen, so load labels can be laid out around the
       * structure instead of across it. A lazy callback rather than an array:
       * only the renderers that place labels need it, and building it on every
       * frame for the ones that do not would cost a pass over the whole model
       * each time.
       */
      memberSegments: memberScreenSegments,
      labels: currentFrameLabels,
      unitSystem: uiStore.unitSystem,
    };
  }

  /**
   * The collector the current frame is filling, or undefined outside a draw.
   *
   * Module-level rather than threaded through `makeDrawContext`'s callers
   * because every one of them wants the same answer — the frame's collector —
   * and passing it explicitly through a dozen call sites would only create
   * opportunities to forget.
   */
  let currentFrameLabels: LabelCollector | undefined;

  /**
   * The structure in screen coordinates, as the things a label must not cover.
   *
   * Node markers are included as degenerate segments: the node number is drawn
   * there, and a load value written across it makes both unreadable — which is
   * exactly what a horizontal nodal force did, its label starting at the arrow
   * tail and running straight through the node it was applied to.
   */
  function memberScreenSegments(): { x1: number; y1: number; x2: number; y2: number }[] {
    const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const el of modelStore.elements.values()) {
      const a = modelStore.getNode(el.nodeI);
      const b = modelStore.getNode(el.nodeJ);
      if (!a || !b) continue;
      const pa = project2DNode(a);
      const pb = project2DNode(b);
      const sa = uiStore.worldToScreen(pa.x, pa.y);
      const sb = uiStore.worldToScreen(pb.x, pb.y);
      segs.push({ x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y });
    }
    if (uiStore.showNodeLabels) {
      for (const n of modelStore.nodes.values()) {
        const pn = project2DNode(n);
        const s = uiStore.worldToScreen(pn.x, pn.y);
        segs.push({ x1: s.x, y1: s.y - 12, x2: s.x + 14, y2: s.y + 2 });
      }
    }
    return segs;
  }

  onMount(() => {
    ctx = canvas.getContext('2d')!;
    resizeCanvas();

    // Use ResizeObserver to detect any container size changes
    // (sidebar open/close, window resize, etc.)
    // Also schedule a delayed re-check in case CSS transitions cause intermediate sizes
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      resizeCanvas();
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => resizeCanvas(), 300);
    });
    ro.observe(canvas.parentElement!);

    // Listen for zoom-to-fit events (same mechanism as Viewport3D)
    const handleZoomToFitEvent = () => {
      if (modelStore.nodes.size === 0) return;
      const projected = [...modelStore.nodes.values()].map(n => project2DNode(n));
      uiStore.zoomToFit(projected, canvas.width, canvas.height);
      invalidate();
    };
    window.addEventListener('stabileo-zoom-to-fit', handleZoomToFitEvent);

    // Initial draw — needsRedraw is already true, so schedule the first frame directly
    rafId = requestAnimationFrame(drawOnce);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      ro.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('stabileo-zoom-to-fit', handleZoomToFitEvent);
    };
  });

  function resizeCanvas() {
    const rect = canvas.parentElement!.getBoundingClientRect();
    // Guard: skip if container has zero/tiny dimensions (layout reflow in progress)
    if (rect.width < 1 || rect.height < 1) return;
    width = rect.width;
    height = rect.height;
    canvas.width = width;
    canvas.height = height;
    // Start a fresh page with the model origin at the centre of the viewport.
    // Restored project/session/hash camera state is applied afterwards and
    // therefore keeps its saved position.
    if (!initialCameraPositioned) {
      uiStore.panX = width / 2;
      uiStore.panY = height / 2;
      initialCameraPositioned = true;
    }
    invalidate();
  }

  let lastFrameTime = 0;

  function draw() {
    if (!ctx) return;

    /*
     * ONE label layout pass for the whole frame.
     *
     * Loads and diagrams are drawn by half a dozen functions — nodal, point,
     * distributed and thermal loads, plus the diagram values — and each used to
     * place its own text. Each was therefore correct in isolation and blind to
     * the other five: two values on one beam simply overlapped, and whichever
     * drew last won. Everything is queued here and resolved together at the end
     * of the frame, which is the only level at which the guarantee can hold.
     */
    currentFrameLabels = createLabelCollector();

    // Advance IL animation
    const now = performance.now();
    if (resultsStore.ilAnimating && resultsStore.influenceLine && lastFrameTime > 0) {
      const dt = (now - lastFrameTime) / 1000; // seconds
      const speed = resultsStore.ilAnimSpeed * 0.3; // base: ~3.3s to traverse
      resultsStore.ilAnimProgress += dt * speed;
      if (resultsStore.ilAnimProgress >= 1) {
        resultsStore.ilAnimProgress = 0; // loop
      }
    }
    lastFrameTime = now;

    ctx.clearRect(0, 0, width, height);

    // Background
    // Same ground as the shell: the model sits on the page, not in a box on it.
    ctx.fillStyle = canvasTheme().surface;
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    if (uiStore.showGrid) {
      drawGrid();
    }

    // Draw axes
    if (uiStore.showAxes) {
      drawAxes();
    }

    // Compute color map for elements if active
    const colorMapOverrides = new Map<number, string>();
    if (resultsStore.results && resultsStore.diagramType === 'axialColor') {
      // Axial color: blue = compression, red = tension, intensity by magnitude
      let globalMaxN = 0;
      for (const ef of resultsStore.results.elementForces) {
        const absN = Math.max(Math.abs(ef.nStart), Math.abs(ef.nEnd));
        if (absN > globalMaxN) globalMaxN = absN;
      }
      if (globalMaxN > 1e-10) {
        const axTheme = canvasTheme();
        /*
         * Tension and compression are the palette's, not screen primaries.
         *
         * These ramped toward `rgb(255,0,0)` and `rgb(0,0,255)` — colours
         * that appear nowhere else in the application and read as a
         * different program's output beside the vermillion and steel blue
         * the landing's truss figure, the 3D axial map and the diagrams all
         * use. Magnitude still drives intensity; it now fades the palette
         * hue toward the neutral member instead of toward black.
         *
         * Hoisted out of the loop: the closure and the hex parsing are
         * per-redraw work, not per-element.
         */
        const parse = (hex: string) => [0, 1, 2].map((i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16));
        const tensionRgb = parse(axTheme.tension);
        const compressionRgb = parse(axTheme.compression);
        const mix = (rgb: number[], k: number) => {
          const n = 0.35 + 0.65 * k;
          const g = (i: number, base: number) => Math.round(rgb[i] * n + base * (1 - n));
          return `rgb(${g(0, 143)},${g(1, 163)},${g(2, 179)})`;
        };
        for (const ef of resultsStore.results.elementForces) {
          const avgN = (ef.nStart + ef.nEnd) / 2;
          const intensity = Math.min(Math.abs(avgN) / globalMaxN, 1.0);
          if (avgN > 0.001) {
            colorMapOverrides.set(ef.elementId, mix(tensionRgb, intensity));
          } else if (avgN < -0.001) {
            colorMapOverrides.set(ef.elementId, mix(compressionRgb, intensity));
          } else {
            colorMapOverrides.set(ef.elementId, axTheme.neutralMember);
          }
        }
      }
    } else if (resultsStore.results && resultsStore.diagramType === 'colorMap') {
      const kind = resultsStore.colorMapKind;
      let globalMax = 0;
      const elemMaxes = new Map<number, number>();

      if (kind === 'stressRatio' || kind === 'vonMises' || kind === 'sigmaMax' || kind === 'tauMax') {
        for (const ef of resultsStore.results.elementForces) {
          const elem = modelStore.elements.get(ef.elementId);
          if (!elem) continue;
          const sec = modelStore.sections.get(elem.sectionId);
          const mat = modelStore.materials.get(elem.materialId);
          /*
           * `fy` is required by the RATIO alone — it is the denominator. Von
           * Mises, the normal stress and the shear stress are absolute
           * quantities that do not know the material's strength exists, and
           * demanding it for them left every concrete member unpainted while
           * the number was perfectly computable.
           */
          if (!sec || !mat) continue;
          if (kind === 'stressRatio' && !mat.fy) continue;
          const stress = computeElementStress(ef, sec, mat);
          const val = kind === 'stressRatio' ? (stress.ratio ?? 0)
            : kind === 'vonMises' ? Math.max(stress.vonMisesStart ?? 0, stress.vonMisesEnd ?? 0)
            : kind === 'sigmaMax' ? Math.max(Math.abs(stress.sigmaStart ?? 0), Math.abs(stress.sigmaEnd ?? 0))
            : Math.max(Math.abs(stress.tauStart ?? 0), Math.abs(stress.tauEnd ?? 0));
          elemMaxes.set(ef.elementId, val);
          if (kind !== 'stressRatio' && val > globalMax) globalMax = val;
        }
        if (kind === 'stressRatio') globalMax = 1.0; // fixed scale: 0% → 100%+ of fy
      } else {
        for (const ef of resultsStore.results.elementForces) {
          /*
           * A 2D frame has one bending axis and one shear, so the 3D names for
           * them land on the same two quantities. Accepting both spellings
           * matters because the quantity is chosen in a control shared with 3D:
           * without this, switching a 2D moment diagram to a colour map fell
           * through to the axial branch and painted N.
           */
          let val: number;
          if (kind === 'moment' || kind === 'momentY' || kind === 'momentZ') {
            val = Math.max(Math.abs(ef.mStart), Math.abs(ef.mEnd));
          } else if (kind === 'shear' || kind === 'shearY' || kind === 'shearZ') {
            val = Math.max(Math.abs(ef.vStart), Math.abs(ef.vEnd));
          } else {
            val = Math.max(Math.abs(ef.nStart), Math.abs(ef.nEnd));
          }
          elemMaxes.set(ef.elementId, val);
          if (val > globalMax) globalMax = val;
        }
      }

      /*
       * Publish what the legend has to show. Done here, where the maximum is
       * actually decided, rather than recomputed beside the legend: the same
       * number derived twice is two numbers waiting to disagree.
       */
      resultsStore.setColourScale(globalMax > 1e-10
        ? {
            max: kind === 'vonMises' || kind === 'sigmaMax' || kind === 'tauMax'
              ? toDisplay(globalMax, 'stress', uiStore.unitSystem)
              : globalMax,
            unit: colourMapUnit(kind),
            source: colourScaleSource(),
          }
        : null);

      if (globalMax > 1e-10) {
        for (const [eid, val] of elemMaxes) {
          /*
           * One ramp for both viewports and the legend (lib/three/colour-ramp).
           * Unclamped on purpose: a utilisation past 1.00 comes back magenta —
           * "past the limit", not "red, but more so".
           */
          colorMapOverrides.set(eid, colourRampCss(val / globalMax));
        }
      }
    }

    // Pre-compute bar count per node (for hinge offset logic)
    const nodeBarCount = new Map<number, number>();
    for (const elem of modelStore.elements.values()) {
      nodeBarCount.set(elem.nodeI, (nodeBarCount.get(elem.nodeI) ?? 0) + 1);
      nodeBarCount.set(elem.nodeJ, (nodeBarCount.get(elem.nodeJ) ?? 0) + 1);
    }

    // Draw elements — suppressed in despiece (the free-body overlay draws its
    // own separated solid members + ghost remnants; the full member would
    // otherwise show through under the dashed remnant).
    if (resultsStore.diagramType !== 'despiece') {
      // Closed block outlines read as parts: place their translucent body
      // behind the member strokes so the outline and node handles stay crisp.
      for (const block of modelStore.blocks.instances) {
        if (!block.visible) continue;
        const elements = Object.values(block.elementIds)
          .map(id => modelStore.elements.get(id))
          .filter((element): element is NonNullable<typeof element> => !!element);
        for (const loop of closedElementLoops(elements)) {
          const points = loop.map(getProjectedNode);
          if (points.some(point => !point)) continue;
          ctx.save();
          ctx.globalAlpha = modelStore.editingBlockId !== null && block.id !== modelStore.editingBlockId ? 0.25 : 0.5;
          ctx.fillStyle = block.color;
          ctx.beginPath();
          const fillContext = ctx;
          points.forEach((point, index) => {
            const screen = uiStore.worldToScreen(point!.x, point!.y);
            if (index === 0) fillContext.moveTo(screen.x, screen.y);
            else fillContext.lineTo(screen.x, screen.y);
          });
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
      for (const elem of modelStore.elements.values()) {
        drawElement(elem, colorMapOverrides.get(elem.id), nodeBarCount);
      }
    }

    // Member local axes (Basic 2D): one unified "Local axes" setting (localAxesMode3D).
    drawLocalAxes2D();
    drawSketchConstraints();

    // Draw axial value labels when axialColor mode is active
    if (resultsStore.results && resultsStore.diagramType === 'axialColor') {
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      for (const ef of resultsStore.results.elementForces) {
        const elem = modelStore.elements.get(ef.elementId);
        if (!elem) continue;
        const ni = getProjectedNode(elem.nodeI);
        const nj = getProjectedNode(elem.nodeJ);
        if (!ni || !nj) continue;
        const si = uiStore.worldToScreen(ni.x, ni.y);
        const sj = uiStore.worldToScreen(nj.x, nj.y);
        const mx = (si.x + sj.x) / 2;
        const my = (si.y + sj.y) / 2;
        const dx = sj.x - si.x;
        const dy = sj.y - si.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) continue;
        // Offset perpendicular to the element
        const nx = -dy / len * 16;
        const ny = dx / len * 16;
        const avgN = (ef.nStart + ef.nEnd) / 2;
        if (Math.abs(avgN) < 0.001) continue;
        const sign = avgN > 0 ? '+' : '';
        const label = `${sign}${avgN.toFixed(1)}`;
        // Background for readability
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(10, 10, 30, 0.85)';
        ctx.fillRect(mx + nx - tw / 2 - 3, my + ny - 8, tw + 6, 14);
        // High-contrast text: bright red for tension, bright cyan for compression
        if (avgN > 0) {
          ctx.fillStyle = '#ff6b6b'; // bright red for tension
        } else {
          ctx.fillStyle = '#6bc5ff'; // bright cyan-blue for compression
        }
        ctx.fillText(label, mx + nx, my + ny + 3);
      }
      ctx.textAlign = 'left';
    }

    // Draw supports
    for (const sup of modelStore.supports.values()) {
      drawSupport(sup);
    }

    // Compute effective load visibility
    const diagramActive = !!(resultsStore.results && resultsStore.diagramType !== 'none');
    const loadsVisible = uiStore.showLoads && !(uiStore.hideLoadsWithDiagram && diagramActive);

    // Draw all loads (nodal, distributed, point) if visible
    if (loadsVisible) {
    ctx.save(); if (modelStore.editingBlockId !== null) ctx.globalAlpha = 0.5;

    // Draw nodal loads (grouped by node for stacked labels)
    {
      const nodalByNode = new Map<number, Array<{ type: string; data: any }>>();
      for (const load of modelStore.loads) {
        if (load.type !== 'nodal') continue;
        const nid = (load.data as any).nodeId;
        if (!nodalByNode.has(nid)) nodalByNode.set(nid, []);
        nodalByNode.get(nid)!.push(load);
      }
      for (const [_, loadsAtNode] of nodalByNode) {
        for (let i = 0; i < loadsAtNode.length; i++) {
          const ld = loadsAtNode[i];
          const caseId = (ld.data as any).caseId ?? 1;
          drawNodalLoad(
            ld,
            modelStore.getLoadCaseColor(caseId),
            modelStore.getLoadCaseName(caseId),
            currentFrameLabels!,
          );
        }
      }
    }

    // Draw distributed loads (with case colors and stacked labels)
    {
      const distLoads = modelStore.loads
        .filter(l => l.type === 'distributed')
        .map(l => {
          const d = l.data as any;
          const caseId = d.caseId ?? 1;
          return {
            elementId: d.elementId, qI: d.qI, qJ: d.qJ,
            angle: d.angle, isGlobal: d.isGlobal,
            a: d.a, b: d.b,
            caseColor: modelStore.getLoadCaseColor(caseId),
            caseName: modelStore.getLoadCaseName(caseId),
          };
        });
      /*
       * No stacking offsets are computed here any more.
       *
       * This used to nudge every label after the first on an element down by a
       * fixed 16 px. That separated them from each other and from nothing else:
       * it moved labels that were not colliding, left colliding ones colliding
       * whenever they sat on different elements, and ordered them by whatever
       * order the loads happened to be stored in rather than by size. The
       * renderer now lays them out against what is actually on screen.
       */
      if (distLoads.length > 0) {
        drawDistributedLoads(distLoads, makeDrawContext());
      }
    }

    // Draw point loads on elements (with case colors and stacked labels)
    {
      const ptLoads = modelStore.loads
        .filter(l => l.type === 'pointOnElement')
        .map(l => {
          const d = l.data as any;
          const caseId = d.caseId ?? 1;
          return {
            elementId: d.elementId, a: d.a, p: d.p,
            px: d.px, my: d.my ?? d.mz,
            angle: d.angle, isGlobal: d.isGlobal,
            caseColor: modelStore.getLoadCaseColor(caseId),
            caseName: modelStore.getLoadCaseName(caseId),
          };
        });
      if (ptLoads.length > 0) {
        drawPointLoadsOnElements(ptLoads, makeDrawContext());
      }
    }

    ctx.restore();
    } // end loadsVisible

    // Draw moving load train axles for the current position
    if (resultsStore.movingLoadEnvelope && !resultsStore.movingLoadShowEnvelope) {
      const env = resultsStore.movingLoadEnvelope;
      const pos = env.positions[resultsStore.activeMovingLoadPosition];
      if (pos && env.path && env.train) {
        const axlePositions = computeAxleWorldPositions(
          pos.refPosition,
          env.train,
          env.path,
          (id: number) => modelStore.getNode(id),
        );
        if (axlePositions.length > 0) {
          drawMovingLoadAxles(axlePositions, makeDrawContext());
        }
      }
    }

    // Draw selected load highlights
    if (uiStore.selectedLoads.size > 0) {
      for (const loadId of uiStore.selectedLoads) {
        const load = modelStore.model.loads.find(l => l.data.id === loadId);
        if (!load) continue;
        let hx = 0, hy = 0;
        if (load.type === 'nodal') {
          const d = load.data as { nodeId: number };
          const node = modelStore.getNode(d.nodeId);
          if (!node) continue;
          const pn = project2DNode(node);
          hx = pn.x; hy = pn.y;
        } else if (load.type === 'cylinder') {
          const ni = getProjectedNode(load.data.nodeI), nj = getProjectedNode(load.data.nodeJ);
          if (!ni || !nj) continue;
          hx = (ni.x + nj.x) / 2;
          hy = (ni.y + nj.y) / 2;
        } else {
          const d = load.data as { elementId: number; a?: number };
          const elem = modelStore.elements.get(d.elementId);
          if (!elem) continue;
          const ni = getProjectedNode(elem.nodeI);
          const nj = getProjectedNode(elem.nodeJ);
          if (!ni || !nj) continue;
          if (load.type === 'pointOnElement' && d.a != null) {
            const L = Math.sqrt((nj.x - ni.x) ** 2 + (nj.y - ni.y) ** 2);
            const t = L > 0 ? d.a / L : 0.5;
            hx = ni.x + t * (nj.x - ni.x);
            hy = ni.y + t * (nj.y - ni.y);
          } else {
            hx = (ni.x + nj.x) / 2;
            hy = (ni.y + nj.y) / 2;
          }
        }
        const sp = uiStore.worldToScreen(hx, hy);
        ctx!.save();
        ctx!.strokeStyle = '#4ecdc4';
        ctx!.lineWidth = 2;
        ctx!.setLineDash([4, 3]);
        ctx!.beginPath();
        ctx!.arc(sp.x, sp.y, 14, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.setLineDash([]);
        ctx!.fillStyle = 'rgba(78, 205, 196, 0.5)';
        ctx!.fill();
        ctx!.restore();
      }
    }

    // Preselection uses the same raw-pointer tolerance and priority as clicking.
    if (pointerInside && uiStore.currentTool === 'select' && !isPanning && !boxSelect && draggedNodeId === null) {
      const sm = uiStore.selectMode;
      const despiece = resultsStore.diagramType === 'despiece';
      const canPickElement = despiece || (sm === 'stress' ? !!resultsStore.results
        : uiStore.multiKindSelect ? uiStore.selectsKind('elements') : sm === 'elements');
      const nodeHasPriority = despiece || (sm !== 'stress' && (!uiStore.multiKindSelect || uiStore.selectsKind('nodes')));
      if (canPickElement && !(nodeHasPriority && findNearestNodeAtScreen(uiStore.mouseX, uiStore.mouseY))) {
        const pointer = uiStore.screenToWorld(uiStore.mouseX, uiStore.mouseY);
        const element = findPickableElement(pointer.x, pointer.y);
        if (element) drawElementTargetHighlight(element);
      }
    }

    // Creation tools preview the exact member their next click will target.
    // A node click wins first, matching the click handler's priority.
    if (pointerInside && !isPanning && draggedNodeId === null
      && ((uiStore.currentTool === 'node' && uiStore.nodeMode === 'create') || uiStore.currentTool === 'load')
      && !findNearestNodeAtScreen(uiStore.mouseX, uiStore.mouseY)) {
      const pointer = uiStore.screenToWorld(uiStore.mouseX, uiStore.mouseY);
      let element = findPickableElement(pointer.x, pointer.y);
      if (uiStore.currentTool === 'node' && !element) {
        const midpoint = findNearestMidpoint(pointer.x, pointer.y);
        element = midpoint ? pickableElements().get(midpoint.elementId) ?? null : null;
      }
      if (element) drawElementTargetHighlight(element);
    }

    if (pointerInside && uiStore.currentTool === 'cylinder' && pendingCylinderNodeId !== null) {
      const start = getProjectedNode(pendingCylinderNodeId);
      const hovered = findNearestNodeAtScreen(uiStore.mouseX, uiStore.mouseY);
      const end = hovered ? project2DNode(hovered) : uiStore.screenToWorld(uiStore.mouseX, uiStore.mouseY);
      if (start) _drawCylinderLoad(ctx!, { nodeI: pendingCylinderNodeId, nodeJ: -1, force: uiStore.cylinderForce }, start, end,
        (x, y) => uiStore.worldToScreen(x, y), '#4ecdc4', uiStore.unitSystem);
    }

    for (const joint of modelStore.blocks.joints) {
      const ai = resolveNodeRef(modelStore.blocks, joint.a), bi = resolveNodeRef(modelStore.blocks, joint.b);
      const n = ai === undefined ? undefined : modelStore.getNode(ai);
      if (!n || bi === undefined || !modelStore.nodes.has(bi)) continue;
      const p = uiStore.worldToScreen(n.x, n.y);
      ctx.save(); ctx.strokeStyle = joint.locked ? '#54d66a' : '#f8bd63'; ctx.lineWidth = joint.locked ? 3 : 2;
      ctx.globalAlpha = modelStore.editingBlockId === null ? 1 : 0.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    const editingBlock = modelStore.blocks.instances.find(b => b.id === modelStore.editingBlockId);
    if (editingBlock) {
      const origin = uiStore.worldToScreen(editingBlock.x, editingBlock.y);
      ctx.save(); ctx.lineWidth = 2; ctx.font = '12px sans-serif';
      for (const [axis, color, local] of [['x', '#fa7777', {x: 55 / uiStore.zoom, y: 0}], ['y', '#7fdfaa', {x: 0, y: 55 / uiStore.zoom}]] as const) {
        const w = localToWorld(local, editingBlock), end = uiStore.worldToScreen(w.x, w.y);
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(end.x, end.y); ctx.stroke(); ctx.fillText(axis, end.x + 5, end.y - 5);
      }
      ctx.restore();
    }
    // Draw nodes (projected to current 2D drawing plane)
    for (const node of modelStore.nodes.values()) {
      drawNode(project2DNode(node));
    }

    // Draw a node-target ring only where a click can actually act on a node.
    // The same screen-space lookup is used by click handling, so the visual
    // affordance and the 10 CSS px hit radius cannot drift apart.
    const tool = uiStore.currentTool;
    const isBlockCommandActive = blockUI.command !== null && !isPanning && (
      blockUI.command.step === 'base' ||
      blockUI.command.step === 'reference' ||
      blockUI.command.step === 'destination' ||
      blockUI.command.step === 'select'
    );
    const blockGripTarget = blockDragSourceNodeId !== null && draggedBlockId !== null
      ? findNearestNodeAtScreenExcludingBlock(uiStore.mouseX, uiStore.mouseY, draggedBlockId)
      : null;
    const showNodeHoverHighlight = blockGripTarget !== null || isBlockCommandActive || shouldShowNodeHoverHighlight({
      tool,
      elementMode: uiStore.elementMode,
      nodeMode: uiStore.nodeMode,
      selectMode: uiStore.selectMode,
      multiKindSelect: uiStore.multiKindSelect,
      selectsNodes: uiStore.selectsKind('nodes'),
      interactionActive: isPanning || boxSelect !== null || draggedNodeId !== null || draggedBlockId !== null,
    });
    if (showNodeHoverHighlight) {
      const nearNode = blockGripTarget ?? findNearestNodeAtScreen(uiStore.mouseX, uiStore.mouseY);
      if (nearNode) {
        drawNodeTargetHighlight(nearNode.x, nearNode.y, uiStore.selectedNodes.has(nearNode.id));
      } else if (tool === 'element' && uiStore.elementMode === 'create') {
        // Check midpoint snap
        const midSnap = findNearestMidpoint(uiStore.worldX, uiStore.worldY);
        if (midSnap) {
          const s = uiStore.worldToScreen(midSnap.x, midSnap.y);
          const d = 8;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y - d);
          ctx.lineTo(s.x + d, s.y);
          ctx.lineTo(s.x, s.y + d);
          ctx.lineTo(s.x - d, s.y);
          ctx.closePath();
          ctx.strokeStyle = 'rgba(233, 196, 106, 0.8)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    // Draw node tool sliding-joint hover highlight: teal ring at the nearest
    // bar end where a click would place the slider.
    if (uiStore.currentTool === 'node' && uiStore.nodeMode === 'hinge' && uiStore.jointType !== 'hinge') {
      const nearElem = findPickableElement(uiStore.worldX, uiStore.worldY);
      if (nearElem) {
        const ni = getProjectedNode(nearElem.nodeI);
        const nj = getProjectedNode(nearElem.nodeJ);
        if (ni && nj) {
          const di = (uiStore.worldX - ni.x) ** 2 + (uiStore.worldY - ni.y) ** 2;
          const dj = (uiStore.worldX - nj.x) ** 2 + (uiStore.worldY - nj.y) ** 2;
          const endNode = di <= dj ? ni : nj;
          const sp = uiStore.worldToScreen(endNode.x, endNode.y);
          ctx!.save();
          ctx!.beginPath();
          ctx!.arc(sp.x, sp.y, 12, 0, Math.PI * 2);
          ctx!.strokeStyle = '#4ecdc4';
          ctx!.fillStyle = 'rgba(78, 205, 196, 0.5)';
          ctx!.lineWidth = 2.5;
          ctx!.fill();
          ctx!.stroke();
          // direction hint: double bar (perpendicular to slide motion)
          const horiz = uiStore.jointType === 'slideX';
          ctx!.beginPath();
          if (horiz) { ctx!.moveTo(sp.x - 7, sp.y - 9); ctx!.lineTo(sp.x - 7, sp.y + 9); ctx!.moveTo(sp.x + 7, sp.y - 9); ctx!.lineTo(sp.x + 7, sp.y + 9); }
          else { ctx!.moveTo(sp.x - 9, sp.y - 7); ctx!.lineTo(sp.x + 9, sp.y - 7); ctx!.moveTo(sp.x - 9, sp.y + 7); ctx!.lineTo(sp.x + 9, sp.y + 7); }
          ctx!.strokeStyle = '#4ecdc4';
          ctx!.lineWidth = 2;
          ctx!.stroke();
          ctx!.restore();
        }
      }
    }

    // Draw node tool hinge mode hover highlight
    if (uiStore.currentTool === 'node' && uiStore.nodeMode === 'hinge' && uiStore.jointType === 'hinge') {
      const nearNode = findNearestNodeAtScreen(uiStore.mouseX, uiStore.mouseY);
      if (nearNode) {
        // Hovering over a node: teal circle
        const sp = uiStore.worldToScreen(nearNode.x, nearNode.y);
        ctx!.save();
        ctx!.beginPath();
        ctx!.arc(sp.x, sp.y, 12, 0, Math.PI * 2);
        ctx!.strokeStyle = '#4ecdc4';
        ctx!.fillStyle = 'rgba(78, 205, 196, 0.5)';
        ctx!.lineWidth = 2.5;
        ctx!.fill();
        ctx!.stroke();
        ctx!.restore();
      } else {
        // Hovering over a bar: golden indicator at cut point
        const nearElem = findPickableElement(uiStore.worldX, uiStore.worldY);
        if (nearElem) {
          const ni = getProjectedNode(nearElem.nodeI);
          const nj = getProjectedNode(nearElem.nodeJ);
          if (ni && nj) {
            const edx = nj.x - ni.x;
            const edy = nj.y - ni.y;
            const lenSq = edx * edx + edy * edy;
            let t = ((uiStore.worldX - ni.x) * edx + (uiStore.worldY - ni.y) * edy) / lenSq;
            t = Math.max(0.05, Math.min(0.95, t));
            const cutX = ni.x + t * edx;
            const cutY = ni.y + t * edy;
            const sp = uiStore.worldToScreen(cutX, cutY);
            ctx!.save();
            // Golden circle at cut point
            ctx!.beginPath();
            ctx!.arc(sp.x, sp.y, 10, 0, Math.PI * 2);
            ctx!.strokeStyle = '#e9c46a';
            ctx!.fillStyle = 'rgba(233, 196, 106, 0.5)';
            ctx!.lineWidth = 2.5;
            ctx!.fill();
            ctx!.stroke();
            // Cross (+) inside
            ctx!.beginPath();
            ctx!.moveTo(sp.x - 5, sp.y);
            ctx!.lineTo(sp.x + 5, sp.y);
            ctx!.moveTo(sp.x, sp.y - 5);
            ctx!.lineTo(sp.x, sp.y + 5);
            ctx!.strokeStyle = '#e9c46a';
            ctx!.lineWidth = 1.5;
            ctx!.stroke();
            ctx!.restore();
          }
        }
      }
    }

    // Draw pending node + rubber band line
    if (pendingNode) {
      const screen = uiStore.worldToScreen(pendingNode.x, pendingNode.y);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(233, 69, 96, 0.5)';
      ctx.fill();

      // Rubber band line to current mouse position
      if (uiStore.currentTool === 'element') {
        const mouseScreen = uiStore.worldToScreen(uiStore.worldX, uiStore.worldY);
        ctx.beginPath();
        ctx.moveTo(screen.x, screen.y);
        ctx.lineTo(mouseScreen.x, mouseScreen.y);
        ctx.strokeStyle = 'rgba(233, 69, 96, 0.5)';
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Draw results
    if (resultsStore.results) {
      const dt = resultsStore.diagramType;
      setDiagramUnitSystem(uiStore.unitSystem);

      if (dt === 'deformed') {
        const scale = resultsStore.deformedScale;
        const animScale = resultsStore.animateDeformed
          ? scale * Math.sin(performance.now() / (500 / resultsStore.animSpeed))
          : scale;
        drawDeformed(resultsStore.results, makeDrawContext(), uiStore.zoom, animScale);
      } else if (dt === 'despiece') {
        // Member free-body / "despiece": pull members off their joints (animated)
        // and draw the transmitted end forces + support reactions. Solver-free overlay.
        const tNorm = Math.max(0, Math.min(1, (performance.now() - despieceStart) / DESPIECE_ANIM_MS));
        const sep = 1 - Math.pow(1 - tNorm, 3); // easeOutCubic 0→1
        const reactions = new Map<number, { rx: number; rz: number; my: number }>();
        for (const sup of modelStore.supports.values()) {
          const r = resultsStore.getReaction(sup.nodeId);
          if (r) reactions.set(sup.nodeId, { rx: r.rx, rz: r.rz, my: r.my });
        }
        drawDespiece({
          ctx: ctx!,
          worldToScreen: (wx, wy) => uiStore.worldToScreen(wx, wy),
          elements: [...modelStore.elements.values()].map(e => ({ id: e.id, nodeI: e.nodeI, nodeJ: e.nodeJ })),
          getNode: (id) => { const n = modelStore.getNode(id); return n ? project2DNode(n) : undefined; },
          getElementForces: (id) => {
            const f = resultsStore.getElementForces(id);
            return f ? { elementId: f.elementId, nStart: f.nStart, nEnd: f.nEnd, vStart: f.vStart, vEnd: f.vEnd, mStart: f.mStart, mEnd: f.mEnd } : undefined;
          },
          reactions,
          sep,
          fmt: (v) => v.toFixed(1),
          vectorMode: uiStore.despieceVectorMode,
          basis: uiStore.despieceBasis,
          showReactions: resultsStore.showReactions,
          resultant: uiStore.despieceCombineVectors,
          vectorSize: uiStore.despieceVectorSize,
          labelSize: uiStore.despieceLabelSize,
        });
        // Applied loads as EXTERNAL actions in free-body mode (drawn once, never
        // mirrored). 'all' = full glyphs; 'resultant' = one equivalent force per
        // load (distributed → arrow at its centroid). Element loads ride the
        // SHRUNKEN member segment; nodal loads stay at their node. Amber color.
        const loadMode = uiStore.despieceLoadMode;
        if (loadMode !== 'off') {
          const LOAD = DESPIECE_LOAD_COLOR;
          const vSize = Math.max(0.3, uiStore.despieceVectorSize);
          const lSize = Math.max(0.3, uiStore.despieceLabelSize);
          /*
           * The free-body view has its own pass: the members here are drawn
           * shrunk and pulled apart, so the segments the main pass uses as
           * obstacles do not describe what is on screen.
           */
          const overlayLabels = createLabelCollector();
          const baseCtx = { ...makeDrawContext(), labels: overlayLabels };
          // Fixed-size amber arrow (screen space) so big load values don't dominate.
          const loadArrow = (sx: number, sy: number, ux: number, uy: number, label: string) => {
            const len = 38 * vSize, tx = sx + ux * len, ty = sy + uy * len;
            ctx!.strokeStyle = LOAD; ctx!.fillStyle = LOAD; ctx!.lineWidth = 2;
            ctx!.beginPath(); ctx!.moveTo(sx, sy); ctx!.lineTo(tx, ty); ctx!.stroke();
            const a = Math.atan2(uy, ux), h = 8;
            ctx!.beginPath(); ctx!.moveTo(tx, ty);
            ctx!.lineTo(tx - h * Math.cos(a - 0.4), ty - h * Math.sin(a - 0.4));
            ctx!.lineTo(tx - h * Math.cos(a + 0.4), ty - h * Math.sin(a + 0.4));
            ctx!.closePath(); ctx!.fill();
            if (label) { ctx!.font = `${10 * lSize}px sans-serif`; ctx!.fillText(label, tx + 4, ty - 4); }
          };
          // Screen-space unit direction for a world force vector from a world anchor.
          const screenDir = (wx: number, wy: number, fwx: number, fwy: number) => {
            const a = uiStore.worldToScreen(wx, wy), b = uiStore.worldToScreen(wx + fwx, wy + fwy);
            const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
            return { ux: dx / d, uy: dy / d };
          };
          for (const load of modelStore.loads) {
            if (load.type === 'nodal') {
              const d = load.data as { nodeId: number; fx?: number; fz?: number; fy?: number; my?: number; mz?: number };
              const node = baseCtx.getNode(d.nodeId); if (!node) continue;
              if (loadMode === 'all') { drawNodalLoad(load, LOAD, undefined, overlayLabels); continue; }
              // resultant: one combined force arrow (fx, fz-up) + one moment glyph
              const s = uiStore.worldToScreen(node.x, node.y);
              const fx = d.fx ?? 0, fz = d.fz ?? d.fy ?? 0, fmag = Math.hypot(fx, fz);
              if (fmag > 1e-9) { const dir = screenDir(node.x, node.y, fx, fz); loadArrow(s.x, s.y, dir.ux, dir.uy, `${toDisplay(fmag, 'force', uiStore.unitSystem).toFixed(2)} ${unitLabel('force', uiStore.unitSystem)}`); }
              const m = d.my ?? d.mz ?? 0;
              if (Math.abs(m) > 1e-9) drawMomentSymbol(ctx!, s.x, s.y, m, LOAD, 16 * vSize);
            } else if (load.type === 'distributed' || load.type === 'pointOnElement') {
              const d = load.data as { elementId: number; qI?: number; qJ?: number; a?: number; b?: number; p?: number; px?: number; my?: number; mz?: number; angle?: number; isGlobal?: boolean };
              const el = modelStore.elements.get(d.elementId); if (!el) continue;
              const ni = baseCtx.getNode(el.nodeI), nj = baseCtx.getNode(el.nodeJ); if (!ni || !nj) continue;
              const span = despieceElementSpan(ni, nj, sep);
              const elemCtx = { ...baseCtx, getNode: (id: number) => id === el.nodeI ? span.aI : id === el.nodeJ ? span.aJ : baseCtx.getNode(id) };
              if (load.type === 'distributed' && loadMode === 'resultant') {
                // ONE equivalent resultant arrow at the (remapped) load centroid,
                // pointing in the APPLIED load direction (e.g. downward load → down).
                const a0 = d.a ?? 0, b0 = d.b ?? span.lenOrig;
                const L = Math.hypot(nj.x - ni.x, nj.y - ni.y) || 1;
                const r = distributedResultantVector(d.qI ?? 0, d.qJ ?? 0, a0, b0, d.angle ?? 0, d.isGlobal ?? false, (nj.x - ni.x) / L, (nj.y - ni.y) / L);
                if (Math.abs(r.magnitude) > 1e-9 && span.lenOrig > 1e-9) {
                  const f = r.centroid / span.lenOrig;
                  const cx = span.aI.x + f * (span.aJ.x - span.aI.x), cy = span.aI.y + f * (span.aJ.y - span.aI.y);
                  const dir = screenDir(cx, cy, r.wx, r.wy);
                  const s = uiStore.worldToScreen(cx, cy);
                  loadArrow(s.x, s.y, dir.ux, dir.uy, `${Math.abs(toDisplay(r.magnitude, 'force', uiStore.unitSystem)).toFixed(2)} ${unitLabel('force', uiStore.unitSystem)}`);
                }
              } else if (load.type === 'distributed') {
                const rem = remapLoadSpanToShrunk(d.a ?? 0, d.b ?? span.lenOrig, span.lenOrig, span.lenShrunk);
                drawDistributedLoads([{ elementId: d.elementId, qI: d.qI ?? 0, qJ: d.qJ ?? 0, angle: d.angle, isGlobal: d.isGlobal, a: rem.a, b: rem.b, caseColor: LOAD, caseName: '' }], elemCtx);
              } else {
                // point load — already concentrated; draw at mapped point in both modes
                const aRem = span.lenOrig > 1e-9 ? ((d.a ?? 0) / span.lenOrig) * span.lenShrunk : 0;
                drawPointLoadsOnElements([{ elementId: d.elementId, a: aRem, p: d.p ?? 0, px: d.px, my: d.my ?? d.mz, angle: d.angle, isGlobal: d.isGlobal, caseColor: LOAD, caseName: '' }], elemCtx);
              }
            }
          }
          overlayLabels.flush(ctx!);
        }
      } else if (dt === 'moment' || dt === 'shear' || dt === 'axial') {
        const dkind = dt as DiagramKind;
        const diagramScale = displayedDiagramScale(dkind, uiStore.unitSystem, resultsStore.diagramScale);
        // Check if we should render envelope dual curves
        const showEnvelopeDual = (resultsStore.isEnvelopeActive || resultsStore.movingLoadShowEnvelope) && (
          resultsStore.isEnvelopeActive ? resultsStore.fullEnvelope : resultsStore.movingLoadEnvelope?.fullEnvelope
        );
        if (showEnvelopeDual) {
          const envSrc = resultsStore.isEnvelopeActive ? resultsStore.fullEnvelope! : resultsStore.movingLoadEnvelope!.fullEnvelope!;
          const envData = dkind === 'moment' ? envSrc.moment
                        : dkind === 'shear'  ? envSrc.shear
                        :                       envSrc.axial;
          drawEnvelopeDiagrams(envData, makeDrawContext(), diagramScale, resultsStore.showDiagramValues, resultsStore.drawPositiveTowardLocalAxes);
          // Draw envelope legend
          ctx.save();
          ctx.font = '11px sans-serif';
          const legendX = 10;
          const legendY = canvas.height - 40;
          // Positive line
          ctx.strokeStyle = dkind === 'moment' ? '#4169E1' : dkind === 'shear' ? '#32CD32' : '#BA55D3';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(legendX, legendY); ctx.lineTo(legendX + 20, legendY); ctx.stroke();
          ctx.fillStyle = '#ccc';
          ctx.fillText(t('viewport.envPlus'), legendX + 24, legendY + 4);
          // Negative line
          ctx.strokeStyle = dkind === 'moment' ? '#E15041' : dkind === 'shear' ? '#CD3232' : '#D35565';
          ctx.beginPath(); ctx.moveTo(legendX, legendY + 16); ctx.lineTo(legendX + 20, legendY + 16); ctx.stroke();
          ctx.fillText(t('viewport.envMinus'), legendX + 24, legendY + 20);
          ctx.restore();
        } else {
          // Normal mode: overlay + main diagram
          if (resultsStore.overlayResults) {
            // Compute shared globalMax so both diagrams use the same scale
            const sharedMax = Math.max(
              computeDiagramGlobalMax(resultsStore.results, dkind),
              computeDiagramGlobalMax(resultsStore.overlayResults, dkind),
            );
            const overlayColors = { fill: 'rgba(255, 165, 0, 0.5)', stroke: 'rgba(255, 165, 0, 0.5)', text: 'rgba(255, 165, 0, 0.6)' };
            drawDiagrams(resultsStore.overlayResults, dkind, makeDrawContext(), diagramScale, false, overlayColors, sharedMax, resultsStore.drawPositiveTowardLocalAxes);
            drawDiagrams(resultsStore.results, dkind, makeDrawContext(), diagramScale, resultsStore.showDiagramValues, undefined, sharedMax, resultsStore.drawPositiveTowardLocalAxes);
          } else {
            drawDiagrams(resultsStore.results, dkind, makeDrawContext(), diagramScale, resultsStore.showDiagramValues, undefined, undefined, resultsStore.drawPositiveTowardLocalAxes);
          }
        }
      } else if (dt === 'influenceLine' && resultsStore.influenceLine) {
        drawInfluenceLine(resultsStore.influenceLine, makeDrawContext(), uiStore.zoom, resultsStore.ilAnimating ? resultsStore.ilAnimProgress : undefined);
      } else if (dt === 'modeShape' && resultsStore.modalResult) {
        const mode = resultsStore.modalResult.modes[resultsStore.activeModeIndex];
        if (mode) {
          const animScale = 50 / uiStore.zoom * Math.sin(performance.now() / 500);
          const mdc = {
            ctx,
            worldToScreen: (wx: number, wy: number) => uiStore.worldToScreen(wx, wy),
            nodes: modelStore.nodes as Map<number, { x: number; y: number }>,
            elements: modelStore.elements as Map<number, { nodeI: number; nodeJ: number }>,
          };
          drawModeShape(mode.displacements.map(d => ({ nodeId: d.nodeId, ux: d.ux, uz: d.uy, ry: d.rz })), mdc, uiStore.zoom, animScale, '#4ecdc4');
        }
      } else if (dt === 'bucklingMode' && resultsStore.bucklingResult) {
        const mode = resultsStore.bucklingResult.modes[resultsStore.activeBucklingMode];
        if (mode) {
          const animScale = 50 / uiStore.zoom * Math.sin(performance.now() / 500);
          const mdc = {
            ctx,
            worldToScreen: (wx: number, wy: number) => uiStore.worldToScreen(wx, wy),
            nodes: modelStore.nodes as Map<number, { x: number; y: number }>,
            elements: modelStore.elements as Map<number, { nodeI: number; nodeJ: number }>,
          };
          drawModeShape(mode.displacements.map(d => ({ nodeId: d.nodeId, ux: d.ux, uz: d.uy, ry: d.rz })), mdc, uiStore.zoom, animScale, '#e96941');
        }
      } else if (dt === 'plasticHinges' && resultsStore.plasticResult) {
        const mdc = {
          ctx,
          worldToScreen: (wx: number, wy: number) => uiStore.worldToScreen(wx, wy),
          nodes: modelStore.nodes as Map<number, { x: number; y: number }>,
          elements: modelStore.elements as Map<number, { nodeI: number; nodeJ: number }>,
        };
        drawPlasticHinges(resultsStore.plasticResult, resultsStore.plasticStep, mdc, uiStore.zoom);
      }

      // Draw reactions when results exist and toggle is on. In despiece the
      // free-body overlay already draws each reaction ONCE — don't double them.
      if (resultsStore.showReactions && resultsStore.diagramType !== 'despiece') drawReactions(currentFrameLabels);
      if (resultsStore.showConstraintForces) drawConstraintForces();

      // Overlay label
      if (resultsStore.overlayResults && resultsStore.overlayLabel) {
        const dt = resultsStore.diagramType;
        if (dt === 'moment' || dt === 'shear' || dt === 'axial') {
          ctx.fillStyle = 'rgba(255, 165, 0, 0.7)';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(t('viewport.overlay').replace('{label}', resultsStore.overlayLabel), 10, height - 15);
          ctx.textAlign = 'left';
        }
      }

      /*
       * The gradient key is drawn by `ColourScaleLegend`, an HTML overlay
       * shared with the 3D viewport, and not here.
       *
       * It used to be painted onto the canvas for the utilisation map alone,
       * with hardcoded 0/50/100% labels — correct for a fixed 0–1 scale and
       * wrong for the other three measures, whose maximum is whatever the
       * model happens to reach. Two legends also appeared at once the moment
       * the shared one arrived, drawn over each other in the same corner.
       *
       * The two-colour axial key below stays: it is a key, not a scale, and
       * has no gradient to explain.
       */
      if (resultsStore.diagramType === 'axialColor') {
        // Same rule as the gradient key above: clear the axis indicator by
        // construction. The block is 32 px tall plus its title.
        const lx = 12, ly = height - AXES_GIZMO_HEIGHT - 40;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#aaa';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(t('viewport.axial'), lx, ly);
        ctx.font = '10px sans-serif';
        ctx.fillStyle = canvasTheme().tension;
        ctx.fillRect(lx, ly + 6, 12, 12);
        ctx.fillStyle = '#ccc';
        ctx.fillText(t('viewport.tension'), lx + 16, ly + 16);
        ctx.fillStyle = canvasTheme().compression;
        ctx.fillRect(lx, ly + 22, 12, 12);
        ctx.fillStyle = '#ccc';
        ctx.fillText(t('viewport.compression'), lx + 16, ly + 32);
      }
    }

    // Draw diagram query marker
    if (diagramQuery && resultsStore.results) {
      const dt = resultsStore.diagramType;
      if (dt === 'moment' || dt === 'shear' || dt === 'axial') {
        const s = uiStore.worldToScreen(diagramQuery.worldX, diagramQuery.worldY);
        // Cross marker
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x - 6, s.y - 6); ctx.lineTo(s.x + 6, s.y + 6);
        ctx.moveTo(s.x + 6, s.y - 6); ctx.lineTo(s.x - 6, s.y + 6);
        ctx.stroke();

        const quantity = dt === 'moment' ? 'moment' : 'force';
        const unit = unitLabel(quantity, uiStore.unitSystem);
        const label = dt === 'moment' ? 'M' : dt === 'shear' ? 'V' : 'N';
        // Negate moment for display (internal: hogging=+, display: sagging=+)
        const displayVal = toDisplay(dt === 'moment' ? -diagramQuery.value : diagramQuery.value, quantity, uiStore.unitSystem);
        const abs = Math.abs(displayVal);
        const formatted = abs >= 100 ? abs.toFixed(1) : abs >= 1 ? abs.toFixed(2) : abs.toFixed(3);
        const sign = displayVal < 0 ? '-' : '';
        const xPos = (diagramQuery.t * 100).toFixed(1);
        drawTooltip(s.x + 12, s.y - 25, [
          `${label} = ${sign}${formatted} ${unit}`,
          `x/L = ${xPos}%`,
        ]);
      }
    }

    // Draw stress query marker (section analysis point)
    if (resultsStore.stressQuery && resultsStore.results) {
      const sq = resultsStore.stressQuery;
      const s = uiStore.worldToScreen(sq.worldX, sq.worldY);

      // Find element direction for perpendicular line
      const elem = modelStore.elements.get(sq.elementId);
      if (elem) {
        const ni = modelStore.getNode(elem.nodeI);
        const nj = modelStore.getNode(elem.nodeJ);
        if (ni && nj) {
          const edx = nj.x - ni.x;
          const edy = nj.y - ni.y;
          const len = Math.sqrt(edx * edx + edy * edy);
          // Perpendicular direction (in screen space, Y inverted)
          const px = -edy / len;
          const py = edx / len;
          const markLen = 18;

          // Perpendicular line
          ctx.strokeStyle = '#4ecdc4';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(s.x - px * markLen, s.y + py * markLen);
          ctx.lineTo(s.x + px * markLen, s.y - py * markLen);
          ctx.stroke();

          // Circle at point
          ctx.beginPath();
          ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#4ecdc4';
          ctx.fill();
          ctx.strokeStyle = '#16213e';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // Draw diagram hover crosshair + tooltip (only if no click query active)
    if (diagramHover && resultsStore.results && !diagramQuery) {
      const dt = resultsStore.diagramType;
      if (dt === 'moment' || dt === 'shear' || dt === 'axial' || dt === 'deformed' || dt === 'colorMap') {
        const s = uiStore.worldToScreen(diagramHover.worldX, diagramHover.worldY);

        // Dashed crosshair line perpendicular to element
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - 30);
        ctx.lineTo(s.x, s.y + 30);
        ctx.stroke();
        ctx.setLineDash([]);

        // Small dot at projected position
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fill();

        const xPos = (diagramHover.t * 100).toFixed(1);
        if (diagramHover.lines) {
          // Multi-line tooltip (e.g. deformed mode: ux, uz, θy)
          drawTooltip(s.x + 12, s.y - 25, [
            ...diagramHover.lines,
            `x/L = ${xPos}%`,
          ]);
        } else {
          // Determine label/unit from type or from hover data
          const label = diagramHover.label ?? (dt === 'moment' ? 'M' : dt === 'shear' ? 'V' : 'N');
          const quantity = label === 'M' ? 'moment' : 'force';
          const unit = diagramHover.unit && !['kN', 'kN·m'].includes(diagramHover.unit)
            ? diagramHover.unit : unitLabel(quantity, uiStore.unitSystem);
          // Negate moment for display (internal: hogging=+, display: sagging=+)
          const isMomentHover = (diagramHover.label === 'M' || diagramHover.label == null) && (dt === 'moment' || (dt === 'colorMap' && label === 'M'));
          const canonicalValue = isMomentHover ? -diagramHover.value : diagramHover.value;
          const displayVal = diagramHover.unit && !['kN', 'kN·m'].includes(diagramHover.unit)
            ? canonicalValue : toDisplay(canonicalValue, quantity, uiStore.unitSystem);
          const abs = Math.abs(displayVal);
          const formatted = abs >= 100 ? abs.toFixed(1) : abs >= 1 ? abs.toFixed(2) : abs.toFixed(3);
          const sign = displayVal < 0 ? '-' : '';
          drawTooltip(s.x + 12, s.y - 25, [
            `${label} = ${sign}${formatted} ${unit}`,
            `x/L = ${xPos}%`,
          ]);
        }
      }
    }

    // Draw hover tooltip (suppress when diagram hover or diagram query is active to avoid overlap)
    if (uiStore.currentTool === 'select' && !boxSelect && draggedNodeId === null && !diagramHover && !diagramQuery) {
      const hoverNode = findNearestNodeAtScreen(uiStore.mouseX, uiStore.mouseY);
      if (hoverNode) {
        const lines: string[] = [t('viewport.nodeTooltip').replace('{id}', String(hoverNode.id))];
        lines.push(`(${toDisplay(hoverNode.x, 'length', uiStore.unitSystem).toFixed(3)}, ${toDisplay(get2DDisplayedVertical(hoverNode), 'length', uiStore.unitSystem).toFixed(3)}) ${unitLabel('length', uiStore.unitSystem)} [X, ${TWO_D_VERTICAL_AXIS_LABEL}]`);
        // Show displacement if results exist
        if (resultsStore.results) {
          const d = resultsStore.getDisplacement(hoverNode.id);
          if (d) {
            lines.push(`δ: ${toDisplay(Math.sqrt(d.ux**2 + get2DDisplayDisplacementVertical(d)**2), 'displacement', uiStore.unitSystem).toFixed(3)} ${unitLabel('displacement', uiStore.unitSystem)}`);
          }
        }
        drawTooltip(uiStore.mouseX + 15, uiStore.mouseY - 10, lines);
      } else {
        const pointer = uiStore.screenToWorld(uiStore.mouseX, uiStore.mouseY);
        const hoverElem = findPickableElement(pointer.x, pointer.y);
        if (hoverElem) {
          const lines: string[] = [t('viewport.elemTooltip').replace('{id}', String(hoverElem.id)).replace('{type}', hoverElem.type)];
          const L = modelStore.getElementLength(hoverElem.id);
          lines.push(`L: ${toDisplay(L, 'length', uiStore.unitSystem).toFixed(3)} ${unitLabel('length', uiStore.unitSystem)}`);
          if (resultsStore.results) {
            const f = resultsStore.getElementForces(hoverElem.id);
            if (f) {
              lines.push(`M: ${toDisplay(f.mStart, 'moment', uiStore.unitSystem).toFixed(2)}/${toDisplay(f.mEnd, 'moment', uiStore.unitSystem).toFixed(2)} ${unitLabel('moment', uiStore.unitSystem)}`);
              lines.push(`V: ${toDisplay(f.vStart, 'force', uiStore.unitSystem).toFixed(2)}/${toDisplay(f.vEnd, 'force', uiStore.unitSystem).toFixed(2)} ${unitLabel('force', uiStore.unitSystem)}`);
              lines.push(`N: ${toDisplay(f.nStart, 'force', uiStore.unitSystem).toFixed(2)}/${toDisplay(f.nEnd, 'force', uiStore.unitSystem).toFixed(2)} ${unitLabel('force', uiStore.unitSystem)}`);
            }
          }
          drawTooltip(uiStore.mouseX + 15, uiStore.mouseY - 10, lines);
        }
      }
    }

    // A cylinder is a persistent model condition/glyph. Draw it after result
    // diagrams so the actuator that produced the calculation stays visible
    // even when ordinary load arrows are hidden or covered by result overlays.
    ctx.save();
    if (modelStore.editingBlockId !== null) ctx.globalAlpha = 0.5;
    for (const load of modelStore.loads) {
      if (load.type !== 'cylinder') continue;
      const ni = getProjectedNode(load.data.nodeI), nj = getProjectedNode(load.data.nodeJ);
      if (!ni || !nj) continue;
      _drawCylinderLoad(
        ctx!, load.data, ni, nj,
        (x, y) => uiStore.worldToScreen(x, y),
        modelStore.getLoadCaseColor(load.data.caseId ?? 1),
        uiStore.unitSystem,
      );
    }
    ctx.restore();
    if (resultsStore.results && resultsStore.diagramType === 'deformed') {
      const scale = resultsStore.animateDeformed
        ? resultsStore.deformedScale * Math.sin(performance.now() / (500 / resultsStore.animSpeed))
        : resultsStore.deformedScale;
      for (const load of modelStore.loads) {
        if (load.type !== 'cylinder') continue;
        drawDeformedCylinder(resultsStore.results, load.data, {
          ctx: ctx!,
          worldToScreen: (x, y) => uiStore.worldToScreen(x, y),
          getNode: (id) => getProjectedNode(id),
        }, scale);
      }
    }

    // Draw box selection rectangle (AutoCAD-style: Window vs Crossing)
    if (boxSelect) {
      const x = Math.min(boxSelect.startX, boxSelect.endX);
      const y = Math.min(boxSelect.startY, boxSelect.endY);
      const w = Math.abs(boxSelect.endX - boxSelect.startX);
      const h = Math.abs(boxSelect.endY - boxSelect.startY);
      const isWindow = boxSelect.endX >= boxSelect.startX;

      if (isWindow) {
        // Window (left→right): solid border, teal — only fully contained
        ctx.strokeStyle = '#4ecdc4';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = 'rgba(78, 205, 196, 0.5)';
        ctx.fillRect(x, y, w, h);
      } else {
        // Crossing (right→left): dashed border, green — touching counts
        ctx.strokeStyle = '#77dd77';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = 'rgba(119, 221, 119, 0.5)';
        ctx.fillRect(x, y, w, h);
        ctx.setLineDash([]);
      }
    }

    // Everything queued above is laid out now, against the structure itself.
    currentFrameLabels.flush(ctx, memberScreenSegments());
    currentFrameLabels = undefined;
  }


  function drawGrid() {
    _drawGrid(ctx!, width, height, uiStore.gridSize, (wx, wy) => uiStore.worldToScreen(wx, wy), (sx, sy) => uiStore.screenToWorld(sx, sy));
  }

  function drawAxes() {
    _drawAxes(ctx!, width, height, (wx, wy) => uiStore.worldToScreen(wx, wy));
  }

  function drawNode(node: { id: number; x: number; y: number }) {
    ctx!.save();
    if (modelStore.editingBlockId !== null && !modelStore.canEditNode(node.id)) ctx!.globalAlpha = 0.5;
    _drawNode(ctx!, node, (wx, wy) => uiStore.worldToScreen(wx, wy), uiStore.selectedNodes.has(node.id), uiStore.showNodeLabels);
    ctx!.restore();
  }

  function drawElement(elem: { id: number; type: string; nodeI: number; nodeJ: number; materialId: number; sectionId: number; releaseI?: { my: boolean; mz: boolean; t: boolean }; releaseJ?: { my: boolean; mz: boolean; t: boolean } }, colorOverride?: string, nodeBarCount?: Map<number, number>) {
    const niRaw = modelStore.getNode(elem.nodeI);
    const njRaw = modelStore.getNode(elem.nodeJ);
    if (!niRaw || !njRaw) return;
    const ni = project2DNode(niRaw);
    const nj = project2DNode(njRaw);

    const opts: DrawElementOpts = {
      worldToScreen: (wx, wy) => uiStore.worldToScreen(wx, wy),
      isSelected: uiStore.selectedElements.has(elem.id) || (modelStore.editingBlockId === null && modelStore.blockForElement(elem.id)?.id === blockUI.selected),
      elementColorMode: uiStore.elementColorMode,
      showElementLabels: uiStore.showElementLabels,
      showLengths: uiStore.showLengths,
      zoom: uiStore.zoom,
      diagramType: resultsStore.diagramType,
      worldLength: modelStore.getElementLength(elem.id),
      unitSystem: uiStore.unitSystem,
    };
    ctx!.save();
    if (modelStore.editingBlockId !== null && !modelStore.canEditElement(elem.id)) ctx!.globalAlpha = 0.5;
    _drawElement(ctx!, elem, ni, nj, opts, colorOverride ?? modelStore.blockForElement(elem.id)?.color, nodeBarCount);
    ctx!.restore();
  }

  /** Persistent CAD-style annotations. These are deliberately unrelated to supports. */
  function drawSketchConstraints() {
    const color = '#54d66a';
    dimensionLabelHits.clear();
    dimensionDisplayedValues.clear();
    ctx!.save(); ctx!.strokeStyle = color; ctx!.fillStyle = color; ctx!.lineWidth = 1.5;
    ctx!.font = '11px var(--st-mono, monospace)'; ctx!.textAlign = 'center'; ctx!.textBaseline = 'middle';
    const midpoint = (elementId: number) => {
      const e = modelStore.elements.get(elementId); if (!e) return null;
      const a = getProjectedNode(e.nodeI), b = getProjectedNode(e.nodeJ); if (!a || !b) return null;
      return { a: uiStore.worldToScreen(a.x, a.y), b: uiStore.worldToScreen(b.x, b.y) };
    };
    const dimensionText = (value: number) => `${Math.abs(toDisplay(value, 'length', uiStore.unitSystem)).toFixed(3)} ${unitLabel('length', uiStore.unitSystem)}`;
    const referencePoint = (ref: { kind: 'node' | 'element'; id: number }) => {
      if (ref.kind === 'node') {
        const n = getProjectedNode(ref.id);
        return n ? { x: n.x, y: n.y } : null;
      }
      const e = modelStore.elements.get(ref.id); if (!e) return null;
      const a = getProjectedNode(e.nodeI), b = getProjectedNode(e.nodeJ); if (!a || !b) return null;
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const drawDimension = (c: SmartDimension, preview = false) => {
      const [ra, rb] = c.references;
      const live = c.readOnly ? modelStore.inferDimension(ra, rb) : null;
      const shown = live && live.measure === c.measure ? { ...c, value: live.value } : c;
      const fallbackA = referencePoint(ra), fallbackB = referencePoint(rb);
      const fallbackPosition = fallbackA && fallbackB
        ? { x: (fallbackA.x + fallbackB.x) / 2, y: (fallbackA.y + fallbackB.y) / 2 + 24 / uiStore.zoom }
        : { x: 0, y: 0 };
      const placement = (!preview && c.id === draggedDimensionId && dimensionDragPosition)
        ? dimensionDragPosition
        : c.position ?? (preview ? { x: uiStore.worldX, y: uiStore.worldY } : fallbackPosition);
      const selected = !preview && c.id === uiStore.selectedDimensionId;
      ctx!.save();
      // CanvasRenderingContext2D does not reliably resolve CSS custom
      // properties inside its `font` string; an invalid value silently keeps
      // the previous font. Use a concrete family so 16 px is applied.
      ctx!.font = '16px monospace';
      ctx!.globalAlpha = preview ? 0.72 : c.readOnly ? 0.5 : 1;
      ctx!.strokeStyle = ctx!.fillStyle = selected ? '#a4ffad' : color;
      ctx!.lineWidth = selected ? 2.2 : 1.5;

      let displayedValue = shown.value;
      let text = c.measure === 'angle'
        ? `${Math.abs(displayedValue * 180 / Math.PI).toFixed(1)}°`
        : dimensionText(displayedValue);
      let label = { x: 0, y: 0 };

      if (c.measure === 'angle' && ra.kind === 'element' && rb.kind === 'element') {
        const ea = modelStore.elements.get(ra.id), eb = modelStore.elements.get(rb.id);
        const a1 = ea && getProjectedNode(ea.nodeI), a2 = ea && getProjectedNode(ea.nodeJ);
        const b1 = eb && getProjectedNode(eb.nodeI), b2 = eb && getProjectedNode(eb.nodeJ);
        if (!a1 || !a2 || !b1 || !b2) { ctx!.restore(); return; }
        const angleA = Math.atan2(a2.y - a1.y, a2.x - a1.x);
        const angleB = Math.atan2(b2.y - b1.y, b2.x - b1.x);
        const sector = angleDimensionSector(a1, angleA, b1, angleB, placement);
        if (!sector) { ctx!.restore(); return; }
        const { centre, start, sweep } = sector;
        displayedValue = sweep;
        text = `${Math.abs(displayedValue * 180 / Math.PI).toFixed(1)}°`;
        const radiusWorld = Math.max(18 / uiStore.zoom, Math.hypot(placement.x - centre.x, placement.y - centre.y));
        const cs = uiStore.worldToScreen(centre.x, centre.y);
        const radius = radiusWorld * uiStore.zoom;
        ctx!.beginPath(); ctx!.arc(cs.x, cs.y, radius, -start, -(start + sweep), sweep > 0); ctx!.stroke();
        for (const angle of [start, start + sweep]) {
          ctx!.beginPath(); ctx!.moveTo(cs.x, cs.y);
          ctx!.lineTo(cs.x + Math.cos(angle) * (radius + 8), cs.y - Math.sin(angle) * (radius + 8)); ctx!.stroke();
        }
        const mid = start + sweep / 2;
        label = { x: cs.x + Math.cos(mid) * (radius + 13), y: cs.y - Math.sin(mid) * (radius + 13) };
      } else {
        let a = referencePoint(ra), b = referencePoint(rb);
        if (c.measure === 'pointLineDistance') {
          const pointRef = ra.kind === 'node' ? ra : rb;
          const lineRef = ra.kind === 'element' ? ra : rb;
          const p = referencePoint(pointRef);
          const e = modelStore.elements.get(lineRef.id);
          const n1 = e && getProjectedNode(e.nodeI), n2 = e && getProjectedNode(e.nodeJ);
          if (!p || !n1 || !n2) { ctx!.restore(); return; }
          const dx = n2.x - n1.x, dy = n2.y - n1.y, ll = dx * dx + dy * dy;
          if (ll < 1e-18) { ctx!.restore(); return; }
          const u = ((p.x - n1.x) * dx + (p.y - n1.y) * dy) / ll;
          a = p; b = { x: n1.x + u * dx, y: n1.y + u * dy };
        } else if (c.measure === 'lineDistance' && ra.kind === 'element' && rb.kind === 'element') {
          const ea = modelStore.elements.get(ra.id), eb = modelStore.elements.get(rb.id);
          const a1 = ea && getProjectedNode(ea.nodeI), a2 = ea && getProjectedNode(ea.nodeJ);
          const b1 = eb && getProjectedNode(eb.nodeI), b2 = eb && getProjectedNode(eb.nodeJ);
          if (!a1 || !a2 || !b1 || !b2) { ctx!.restore(); return; }
          const ca = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
          const dx = b2.x - b1.x, dy = b2.y - b1.y, ll = dx * dx + dy * dy;
          if (ll < 1e-18) { ctx!.restore(); return; }
          const u = ((ca.x - b1.x) * dx + (ca.y - b1.y) * dy) / ll;
          a = ca; b = { x: b1.x + u * dx, y: b1.y + u * dy };
        }
        if (!a || !b) { ctx!.restore(); return; }
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        if (length < 1e-12) { ctx!.restore(); return; }
        const nx = -dy / length, ny = dx / length;
        const offset = (placement.x - a.x) * nx + (placement.y - a.y) * ny;
        const q1 = { x: a.x + nx * offset, y: a.y + ny * offset };
        const q2 = { x: b.x + nx * offset, y: b.y + ny * offset };
        const sa = uiStore.worldToScreen(a.x, a.y), sb = uiStore.worldToScreen(b.x, b.y);
        const s1 = uiStore.worldToScreen(q1.x, q1.y), s2 = uiStore.worldToScreen(q2.x, q2.y);
        ctx!.setLineDash([3, 3]);
        ctx!.beginPath(); ctx!.moveTo(sa.x, sa.y); ctx!.lineTo(s1.x, s1.y); ctx!.moveTo(sb.x, sb.y); ctx!.lineTo(s2.x, s2.y); ctx!.stroke();
        ctx!.setLineDash([]);
        ctx!.beginPath(); ctx!.moveTo(s1.x, s1.y); ctx!.lineTo(s2.x, s2.y); ctx!.stroke();
        const ux = (s2.x - s1.x) / Math.max(1, Math.hypot(s2.x - s1.x, s2.y - s1.y));
        const uy = (s2.y - s1.y) / Math.max(1, Math.hypot(s2.x - s1.x, s2.y - s1.y));
        for (const p of [s1, s2]) {
          ctx!.beginPath(); ctx!.moveTo(p.x + ux * 5 - uy * 4, p.y + uy * 5 + ux * 4);
          ctx!.lineTo(p.x - ux * 5 + uy * 4, p.y - uy * 5 - ux * 4); ctx!.stroke();
        }
        label = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 - 12 };
      }

      const metrics = ctx!.measureText(text);
      const pad = 5, h = 21;
      ctx!.fillStyle = canvasTheme().surface;
      ctx!.fillRect(label.x - metrics.width / 2 - pad, label.y - h / 2, metrics.width + pad * 2, h);
      ctx!.fillStyle = selected ? '#a4ffad' : color;
      ctx!.fillText(text, label.x, label.y);
      if (!preview) dimensionLabelHits.set(c.id, {
        x1: label.x - metrics.width / 2 - pad, y1: label.y - h / 2,
        x2: label.x + metrics.width / 2 + pad, y2: label.y + h / 2,
      });
      if (!preview) dimensionDisplayedValues.set(c.id, Math.abs(displayedValue));
      ctx!.restore();
    };

    for (const c of modelStore.sketchConstraints) {
      if (c.kind === 'dimension') {
        drawDimension(c);
        continue;
      }
      if (c.kind === 'fixedNode') {
        const n = getProjectedNode(c.nodeId); if (!n) continue;
        const s = uiStore.worldToScreen(n.x, n.y);
        ctx!.strokeRect(s.x - 6, s.y - 6, 12, 12);
        ctx!.beginPath(); ctx!.moveTo(s.x - 4, s.y - 4); ctx!.lineTo(s.x + 4, s.y + 4);
        ctx!.moveTo(s.x + 4, s.y - 4); ctx!.lineTo(s.x - 4, s.y + 4); ctx!.stroke();
        continue;
      }
      if (c.kind === 'fixedElement') {
        const g = midpoint(c.elementId); if (!g) continue;
        const x = (g.a.x + g.b.x) / 2, y = (g.a.y + g.b.y) / 2;
        ctx!.strokeRect(x - 6, y - 6, 12, 12); ctx!.fillText('F', x, y);
        continue;
      }
      if (c.kind === 'length') {
        const g = midpoint(c.elementId); if (!g) continue;
        const dx = g.b.x - g.a.x, dy = g.b.y - g.a.y, length = Math.hypot(dx, dy) || 1;
        const x = (g.a.x + g.b.x) / 2 - dy / length * 16, y = (g.a.y + g.b.y) / 2 + dx / length * 16;
        ctx!.fillText(`${c.value.toFixed(3)} m`, x, y);
        continue;
      }
      const ga = midpoint(c.elementA), gb = midpoint(c.elementB); if (!ga || !gb) continue;
      const ax = (ga.a.x + ga.b.x) / 2, ay = (ga.a.y + ga.b.y) / 2;
      const bx = (gb.a.x + gb.b.x) / 2, by = (gb.a.y + gb.b.y) / 2;
      if (c.kind === 'angle') {
        ctx!.fillText(`${Math.abs(c.value * 180 / Math.PI).toFixed(1)}°`, (ax + bx) / 2, (ay + by) / 2 - 14);
      } else {
        ctx!.setLineDash([3, 3]); ctx!.beginPath(); ctx!.moveTo(ax, ay); ctx!.lineTo(bx, by); ctx!.stroke(); ctx!.setLineDash([]);
        ctx!.fillText(`${Math.abs(c.value).toFixed(3)} m`, (ax + bx) / 2, (ay + by) / 2 - 12);
      }
    }
    if (sketchUI.draft) drawDimension({ ...sketchUI.draft, position: { x: uiStore.worldX, y: uiStore.worldY } }, true);
    ctx!.restore();
  }

  // Local-axis colors match the 3D triad (x = red, z = blue). In Basic 2D the
  // model lives in the canonical X-Z plane, so the two in-plane axes are local x
  // (along the member) and local z (vertical/perpendicular). Local y is out of
  // the plane (global Y) and is not drawn.
  const AXIS2D_X_COLOR = '#ff7070';
  const AXIS2D_Z_COLOR = '#7ab8ff';

  /** Draw member local axes for the Basic "Local axes" setting. Mirrors the 3D
   *  triad gating ('never'/'always'/'selected'-manual) and uses the SAME
   *  computeLocalAxes3D basis as the 3D viewport, projected onto the X-Z plane —
   *  so the upward axis reads as z (not y) and agrees with Basic 3D. */
  function drawLocalAxes2D() {
    const mode = uiStore.localAxesMode3D; // unified Basic "Local axes" setting
    if (mode === 'never') return;
    const showAll = mode === 'always' && modelStore.elements.size <= 1500;
    // "When selected" = manual selection only (result-query highlights excluded),
    // consistent with the 3D triads.
    const selected = showAll || !uiStore.elementSelectionManual ? null : uiStore.selectedElements;
    if (!showAll && (!selected || selected.size === 0)) return;
    const labelSet = !!selected && selected.size > 0 && selected.size <= 8;
    const leftHand = uiStore.axisConvention3D === 'leftHand';
    const AX = 34; // arrow length in px (legible at normal zoom; zoom-independent)

    for (const elem of modelStore.elements.values()) {
      const isSel = selected ? selected.has(elem.id) : false;
      if (!showAll && !isSel) continue;
      const niRaw = modelStore.getNode(elem.nodeI);
      const njRaw = modelStore.getNode(elem.nodeJ);
      if (!niRaw || !njRaw) continue;
      const ni = project2DNode(niRaw);
      const nj = project2DNode(njRaw);
      const mx = (ni.x + nj.x) / 2, my = (ni.y + nj.y) / 2;
      if (Math.hypot(nj.x - ni.x, nj.y - ni.y) < 1e-9) continue;

      // Embed the 2D member into the canonical X-Z plane (2D-y -> 3D-z) and use the
      // same local-axis solver as the 3D triad. In-plane components are (vx, vz);
      // canvas-x = world x, canvas-up = world y (= 3D z). Local y is out of plane.
      let axes;
      try {
        axes = computeLocalAxes3D(
          { id: 0, x: ni.x, y: 0, z: ni.y },
          { id: 0, x: nj.x, y: 0, z: nj.y },
          undefined, undefined, leftHand,
        );
      } catch { continue; }

      const origin = uiStore.worldToScreen(mx, my);
      const exTip = uiStore.worldToScreen(mx + axes.ex[0], my + axes.ex[2]);
      const ezTip = uiStore.worldToScreen(mx + axes.ez[0], my + axes.ez[2]);
      const showLabel = labelSet && isSel;
      ctx!.save();
      if (modelStore.editingBlockId !== null && !modelStore.canEditElement(elem.id)) ctx!.globalAlpha = 0.5;
      drawAxisArrow2D(origin, exTip, AXIS2D_X_COLOR, AX, showLabel ? 'x' : '');
      drawAxisArrow2D(origin, ezTip, AXIS2D_Z_COLOR, AX, showLabel ? 'z' : '');
      ctx!.restore();
    }
  }

  function drawAxisArrow2D(
    origin: { x: number; y: number }, towards: { x: number; y: number },
    color: string, lenPx: number, label: string,
  ) {
    const dx = towards.x - origin.x, dy = towards.y - origin.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;
    const ux = dx / d, uy = dy / d;
    const tipX = origin.x + ux * lenPx, tipY = origin.y + uy * lenPx;
    ctx!.save();
    ctx!.strokeStyle = color; ctx!.fillStyle = color; ctx!.lineWidth = 2;
    ctx!.beginPath(); ctx!.moveTo(origin.x, origin.y); ctx!.lineTo(tipX, tipY); ctx!.stroke();
    const a = Math.atan2(uy, ux), ah = 7;
    ctx!.beginPath();
    ctx!.moveTo(tipX, tipY);
    ctx!.lineTo(tipX - ah * Math.cos(a - 0.4), tipY - ah * Math.sin(a - 0.4));
    ctx!.lineTo(tipX - ah * Math.cos(a + 0.4), tipY - ah * Math.sin(a + 0.4));
    ctx!.closePath(); ctx!.fill();
    if (label) {
      // Readable label just past the arrow tip, with a dark halo for contrast.
      ctx!.font = 'bold 13px sans-serif'; ctx!.textAlign = 'center'; ctx!.textBaseline = 'middle';
      const lx = tipX + ux * 9, ly = tipY + uy * 9;
      ctx!.lineWidth = 3; ctx!.strokeStyle = 'rgba(10,14,24,0.85)';
      ctx!.strokeText(label, lx, ly);
      ctx!.fillStyle = color;
      ctx!.fillText(label, lx, ly);
    }
    ctx!.restore();
  }

  function drawSupport(sup: { id: number; nodeId: number; type: string; dx?: number; dz?: number; dry?: number; dy?: number; drz?: number; angle?: number; isGlobal?: boolean }) {
    const node = modelStore.getNode(sup.nodeId);
    if (!node) return;
    const pn = project2DNode(node);
    const screen = uiStore.worldToScreen(pn.x, pn.y);
    ctx!.save(); if (modelStore.editingBlockId !== null) ctx!.globalAlpha = 0.5;
    _drawSupport(ctx!, sup, screen, uiStore.selectedSupports.has(sup.id), (nid) => modelStore.getElementAngleAtNode(nid));
    ctx!.restore();
  }

  function drawNodalLoad(load: { type: string; data: any }, caseColor: string | undefined, caseName: string | undefined, labels: LabelCollector) {
    const node = modelStore.getNode(load.data.nodeId);
    if (!node) return;
    const pn = project2DNode(node);
    const screen = uiStore.worldToScreen(pn.x, pn.y);
    _drawNodalLoad(ctx!, screen, load.data, caseColor, caseName, labels, uiStore.unitSystem);
  }

  function drawReactions(labels: LabelCollector) {
    if (!resultsStore.results) return;
    _drawReactions(ctx!, resultsStore.results.reactions as ReactionData[], (nodeId) => {
      const node = modelStore.getNode(nodeId);
      if (!node) return null;
      const pn = project2DNode(node);
      return uiStore.worldToScreen(pn.x, pn.y);
    }, uiStore.unitSystem, labels);
  }

  function drawConstraintForces() {
    const forces = resultsStore.constraintForces;
    if (!forces || forces.length === 0) return;
    _drawConstraintForces(ctx!, forces as ConstraintForceData[], (nodeId) => {
      const node = modelStore.getNode(nodeId);
      if (!node) return null;
      const pn = project2DNode(node);
      return uiStore.worldToScreen(pn.x, pn.y);
    }, uiStore.unitSystem);
  }

  function beginNodeDrag(
    nodeId: number,
    additive: boolean,
    startWorld: { x: number; y: number },
    startScreen: { x: number; y: number },
  ) {
    // Keep node-tool and selection-tool movement on the exact same path,
    // including multi-node movement, constraint solving and undo grouping.
    if (!uiStore.selectedNodes.has(nodeId)) uiStore.selectNode(nodeId, additive);
    historyStore.pushState();
    draggedNodeId = nodeId;
    dragMoved = false;
    dragStartWorld = { ...startWorld };
    dragStartScreen = { ...startScreen };
  }

  function handleMouseDown(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const world = uiStore.screenToWorld(mx, my);
    const snapped = snapWorkspace(world.x, world.y);

    // Close context menu on any click
    uiStore.contextMenu = null;

    // Pan is a viewport gesture only: hold the middle mouse button and drag.
    if (e.button === 1) {
      e.preventDefault();
      isPanning = true;
      panStartX = mx;
      panStartY = my;
      return;
    }

    blockUI.closeContext();

    // Only left-clicks (button 0) interact with tools / create entities / select.
    // Right-clicks (button 2) are handled exclusively by handleContextMenu.
    if (e.button !== 0) {
      return;
    }

    if (blockUI.click(world)) { invalidate(); return; }
    if (modelStore.editingBlockId === null && uiStore.currentTool === 'select' && uiStore.selectMode !== 'stress') {
      const nearNode = findNearestNodeAtScreen(mx, my);
      const nodeBlock = nearNode ? modelStore.blockForNode(nearNode.id) : undefined;
      if (nearNode && nodeBlock && !e.ctrlKey && !e.shiftKey
        && (!uiStore.selectsKind('dimensions') || dimensionAtScreen(mx, my) === null)) {
        const projected = nearNode;
        blockUI.select(nodeBlock.id);
        draggedBlockId = nodeBlock.id;
        blockDragMoved = false;
        blockDragStartScreen = { x: mx, y: my };
        blockDragStart = {
          pointer: { x: projected.x, y: projected.y },
          pose: { x: nodeBlock.x, y: nodeBlock.y, angle: nodeBlock.angle },
        };
        blockDragPose = { x: nodeBlock.x, y: nodeBlock.y, angle: nodeBlock.angle };
        blockDragSourceNodeId = nearNode.id;
        blockDragTargetNodeId = null;
        blockDragGripTarget = null;
        return;
      }
      const id = blockUI.instanceAt(world);
      if (id !== null && !e.ctrlKey && !e.shiftKey
        && (!uiStore.selectsKind('dimensions') || dimensionAtScreen(mx, my) === null)) {
        const block = modelStore.blocks.instances.find(candidate => candidate.id === id);
        blockUI.select(id);
        if (block) {
          draggedBlockId = id;
          blockDragMoved = false;
          blockDragStartScreen = { x: mx, y: my };
          blockDragStart = { pointer: { ...snapped }, pose: { x: block.x, y: block.y, angle: block.angle } };
          blockDragPose = { x: block.x, y: block.y, angle: block.angle };
          blockDragSourceNodeId = null;
          blockDragTargetNodeId = null;
          blockDragGripTarget = null;
        }
        return;
      }
      if (blockUI.selected !== null) blockUI.select(null);
    }
    if (modelStore.editingBlockId !== null && (uiStore.currentTool === 'support' || uiStore.currentTool === 'load' || uiStore.currentTool === 'cylinder')) {
      uiStore.toast('하중·지점은 블록 편집을 완료한 뒤 바탕에서 지정하세요.', 'info'); return;
    }
    // Block creation/mutation tools in simplified 2D mode
    if (uiStore.simplified2DMode && uiStore.currentTool !== 'select') {
      uiStore.toast(t('viewport.simplifiedReadOnly'), 'info');
      return;
    }

    if (uiStore.currentTool === 'node') {
      if (uiStore.nodeMode === 'hinge' && uiStore.jointType !== 'hinge') {
        // Sliding-joint mode: click on a bar → set/clear the slider on its
        // nearest end (a slider is a per-member-end translational release, the
        // dual of the hinge). Node clicks are ignored (a slider is relative
        // between one member and its joint, not a whole-node property).
        const slideKind = uiStore.jointType === 'slideX' ? 'x' : 'z';
        const axis = uiStore.jointAxis;
        const nearElem = findPickableElement(world.x, world.y);
        if (nearElem) {
          const ni = modelStore.getNode(nearElem.nodeI);
          const nj = modelStore.getNode(nearElem.nodeJ);
          if (ni && nj) {
            const di = (world.x - ni.x) ** 2 + (world.y - ni.y) ** 2;
            const dj = (world.x - nj.x) ** 2 + (world.y - nj.y) ** 2;
            const end: 'i' | 'j' = di <= dj ? 'i' : 'j';
            const cur = end === 'i' ? nearElem.releaseI : nearElem.releaseJ;
            const already = cur?.slide === slideKind && (cur?.slideAxis ?? 'global') === axis;
            modelStore.setSlide(nearElem.id, end, already ? undefined : slideKind, axis);
            resultsStore.clear();
            uiStore.selectElement(nearElem.id);
            uiStore.toast(already ? t('viewport.sliderRemoved') : t('viewport.sliderAdded'), 'info');
          }
        }
      } else if (uiStore.nodeMode === 'hinge') {
        // Hinge mode: click on node → select + show hinges; click on bar → split + hinge
        const nearNode = findNearestNodeAtScreen(mx, my);
        if (nearNode) {
          // Click on existing node → toggle all hinges at that node
          const hinges = modelStore.getHingesAtNode(nearNode.id);
          if (hinges.length > 0) {
            const anyRigid = hinges.some(h => !h.hasHinge);
            modelStore.batch(() => {
              for (const h of hinges) {
                if (anyRigid && !h.hasHinge) modelStore.toggleHinge(h.elementId, h.end);
                else if (!anyRigid && h.hasHinge) modelStore.toggleHinge(h.elementId, h.end);
              }
            });
            resultsStore.clear();
            uiStore.selectNode(nearNode.id);
            uiStore.toast(anyRigid ? t('viewport.nodeHinged') : t('viewport.hingesRemoved'), 'info');
          }
          // Stay in hinge mode to continue articulating other nodes
        } else {
          // Click on bar → split and add hinges at the split point
          const nearElem = findPickableElement(world.x, world.y);
          if (nearElem) {
            const ni = modelStore.getNode(nearElem.nodeI);
            const nj = modelStore.getNode(nearElem.nodeJ);
            if (ni && nj && ((nj.x - ni.x) ** 2 + (nj.y - ni.y) ** 2) > 1e-10) {
              // (zero-length guard: a degenerate element would make t NaN)
              const edx = nj.x - ni.x;
              const edy = nj.y - ni.y;
              const lenSq = edx * edx + edy * edy;
              let tParam = ((world.x - ni.x) * edx + (world.y - ni.y) * edy) / lenSq;
              tParam = Math.max(0.05, Math.min(0.95, tParam));
              const result = modelStore.splitElementAtPoint(nearElem.id, tParam);
              if (result) {
                modelStore.toggleHinge(result.elemA, 'end');
                modelStore.toggleHinge(result.elemB, 'start');
                resultsStore.clear();
                uiStore.selectNode(result.nodeId);
                uiStore.toast(t('viewport.barSubdividedWithHinge'), 'info');
              }
            }
          }
        }
      } else {
        // Create node mode (default).
        //
        // Auto-split-on-node-place (opt-in via uiStore.autoSplitOnNodePlace):
        // when ON and the click lands on the interior of an existing element
        // (and not on/near an existing node), subdivide that element instead
        // of creating a free-floating node. We delegate to the existing
        // splitElementAtPoint so distributed/point loads are
        // redistributed by the same logic the hinge-mode subdivide already
        // uses in production.
        const ms = snapWithMidpoint(world.x, world.y);
        let didSplit = false;
        // Attempt to subdivide the element nearest to (searchX, searchY),
        // splitting at the projection of (projX, projY) onto it. Interior
        // guard: endpoints + thin slivers would either duplicate an existing
        // node or produce near-zero-length sub-elements.
        const attemptSplit = (searchX: number, searchY: number, maxDist: number, projX: number, projY: number): boolean => {
          const nearElem = findNearestElement(searchX, searchY, maxDist);
          if (!nearElem) return false;
          const ni = modelStore.getNode(nearElem.nodeI);
          const nj = modelStore.getNode(nearElem.nodeJ);
          if (!ni || !nj) return false;
          const edx = nj.x - ni.x;
          const edy = nj.y - ni.y;
          const lenSq = edx * edx + edy * edy;
          if (lenSq <= 1e-10) return false;
          const tParam = ((projX - ni.x) * edx + (projY - ni.y) * edy) / lenSq;
          if (tParam < 0.05 || tParam > 0.95) return false;
          const result = modelStore.splitElementAtPoint(nearElem.id, tParam);
          if (!result) return false;
          uiStore.selectNode(result.nodeId);
          uiStore.toast(t('viewport.barSubdivided'), 'info');
          resultsStore.clear();
          return true;
        };
        // One shared scan: both the auto-split guard and the
        // duplicate-coincident-node guard below answer the same question
        // ('is the cursor on an existing node?') with the same threshold —
        // two separate calls would silently diverge if one threshold is tuned.
        const nodeAtCursor = findNearestNodeAtScreen(mx, my);
        if (uiStore.autoSplitOnNodePlace) {
          // Only auto-split when the cursor isn't already targeting an
          // existing node. snapWithMidpoint returns node coords if a node is
          // within nodeThreshold of the raw cursor; we re-check explicitly
          // to keep the guard tight (also handles the same threshold).
          if (!nodeAtCursor) {
            // Use the RAW cursor to find which
            // element the user is pointing at (grid-snap can warp the cursor
            // off the element line), but project the GRID-SNAPPED cursor so
            // the new node lands at a grid-aligned position on the bar when
            // snap-to-grid is on. When it's off, `snapped` equals `world`.
            const projInputX = uiStore.snapToGrid ? snapped.x : world.x;
            const projInputY = uiStore.snapToGrid ? snapped.y : world.y;
            didSplit = attemptSplit(world.x, world.y, ELEMENT_PICK_RADIUS_PX / uiStore.zoom, projInputX, projInputY);
          }
        }
        if (!didSplit) {
          // Duplicate-coincident-node guard: if the click effectively lands
          // on an existing node (within nodeThreshold of the raw cursor),
          // treat it as "select that node" + start a drag so the user can
          // reposition. Node-tool create-mode is the only place where
          // node repositioning lives — the select tool no longer drags
          // (would silently move nodes whenever the user just wanted to
          // click around). Checked at the raw cursor AND at the resolved
          // placement point `ms`: with grid snap on, `ms` can land exactly
          // on an existing grid-aligned node outside the 10 px pick radius —
          // creating an exact coincident duplicate.
          const onExisting = nodeAtCursor
            ?? findNearestNodeWorld(ms.x, ms.y, 0.01);
          if (onExisting) {
            beginNodeDrag(onExisting.id, e.shiftKey, snapped, { x: mx, y: my });
          } else {
            const p3d = to3D(uiStore.drawPlane2D, ms.x, ms.y, { x: 0, y: 0, z: 0 });
            modelStore.addNode(p3d.x, p3d.y, p3d.z || undefined);
          }
        }
      }
    } else if (uiStore.currentTool === 'element') {
      // For element tool: snap to existing node, or midpoint (create node there), or grid/free point.
      // Node search uses the raw screen pointer so grid snap cannot warp the
      // hit centre away from an off-grid node.
      const ms = snapWithMidpoint(world.x, world.y);
      const nearNode = findNearestNodeAtScreen(mx, my);
      let isNewlyCreated = false;
      const targetNode = nearNode ?? (() => {
        const mid = findNearestMidpoint(world.x, world.y);
        if (mid) {
          // Check if a node already exists at midpoint
          const existing = findNearestNodeWorld(mid.x, mid.y, 0.01);
          if (existing) return existing;
          // Create a new node at midpoint
          const mid3d = to3D(uiStore.drawPlane2D, mid.x, mid.y, { x: 0, y: 0, z: 0 });
          const id = modelStore.addNode(mid3d.x, mid3d.y, mid3d.z || undefined, { autoCreated: true });
          isNewlyCreated = true;
          return modelStore.getNode(id) ?? null;
        }
        // Check if an existing node sits right at the snapped point (e.g. on grid)
        const onGrid = findNearestNodeWorld(ms.x, ms.y, 0.01);
        if (onGrid) return onGrid;
        // AutoCAD-like behaviour: create a new node at the clicked/snapped location
        const p3d = to3D(uiStore.drawPlane2D, ms.x, ms.y, { x: 0, y: 0, z: 0 });
        const id = modelStore.addNode(p3d.x, p3d.y, p3d.z || undefined, { autoCreated: true });
        isNewlyCreated = true;
        return modelStore.getNode(id) ?? null;
      })();
      if (targetNode) {
        if (!pendingNode) {
          pendingNode = { id: targetNode.id, x: targetNode.x, y: targetNode.y };
          pendingCreatedNodeId = isNewlyCreated ? targetNode.id : null;
          uiStore.selectNode(targetNode.id);
        } else {
          const startNode = (pendingNode.id ? modelStore.getNode(pendingNode.id) : null)
            ?? findNearestNodeWorld(pendingNode.x, pendingNode.y, 0.1);
          if (startNode && startNode.id !== targetNode.id) {
            // Lines drawn interactively are frame members with pinned ends.
            // Connection kind is edited later on the point itself.
            modelStore.addElement(startNode.id, targetNode.id, 'frame', { hingedEnds: true });
          }
          pendingCreatedNodeId = null;
          pendingNode = { id: targetNode.id, x: targetNode.x, y: targetNode.y };
          uiStore.selectNode(targetNode.id);
        }
      }
    } else if (uiStore.currentTool === 'fixed') {
      const nearNode = findNearestNodeAtScreen(mx, my);
      if (nearNode) {
        if (!modelStore.canEditNode(nearNode.id)) { uiStore.toast(t('sketch.editBlockFirst'), 'info'); invalidate(); return; }
        const added = modelStore.toggleSketchFixedNode(nearNode.id);
        uiStore.selectNode(nearNode.id);
        uiStore.toast(t(added ? 'sketch.fixedNodeAdded' : 'sketch.fixedRemoved'), 'info');
      } else {
        const nearElem = findPickableElement(world.x, world.y);
        if (nearElem) {
          if (!modelStore.canEditElement(nearElem.id)) { uiStore.toast(t('sketch.editBlockFirst'), 'info'); invalidate(); return; }
          const added = modelStore.toggleSketchFixedElement(nearElem.id);
          uiStore.selectElement(nearElem.id);
          uiStore.toast(t(added ? 'sketch.fixedElementAdded' : 'sketch.fixedRemoved'), 'info');
        }
      }
    } else if (uiStore.currentTool === 'dimension') {
      if (sketchUI.draft) {
        sketchUI.place(world);
        invalidate();
        return;
      }
      const n = findNearestNodeAtScreen(mx, my);
      const e = n ? null : findPickableElement(world.x, world.y);
      const ref = n ? { kind: 'node' as const, id: n.id } : e ? { kind: 'element' as const, id: e.id } : null;
      if (ref && !(ref.kind === 'node' ? modelStore.canEditNode(ref.id) : modelStore.canEditElement(ref.id))) {
        uiStore.toast(t('sketch.editBlockFirst'), 'info');
      } else if (ref) sketchUI.pick(ref);
    } else if (uiStore.currentTool === 'support') {
      // Support: find nearest existing node using raw world coords (not snapped,
      // to avoid grid-snapping moving the search point away from the actual node)
      const nearNode = findNearestNodeAtScreen(mx, my);
      if (nearNode) {
        if (uiStore.supportType === 'spring') {
          const springAngle = uiStore.supportAngle;
          const springIsGlobal = uiStore.supportIsGlobal;
          const springOpts: { angle?: number; isGlobal?: boolean } = {};
          if (springAngle !== 0) springOpts.angle = springAngle;
          if (!springIsGlobal) springOpts.isGlobal = false;
          modelStore.addSupport(nearNode.id, 'spring', {
            kx: uiStore.springKx,
            ky: uiStore.springKy,
            kz: uiStore.springKz || undefined,
          }, (springOpts.angle !== undefined || springOpts.isGlobal !== undefined) ? springOpts : undefined);
          // Reset angle to 0 after placing
          uiStore.supportAngle = 0;
        } else if (uiStore.supportType === 'roller') {
          // Deduce actual roller type based on direction setting
          const rollerType = uiStore.supportDirection === 'x' ? 'rollerX' : 'rollerZ';
          const angle = uiStore.supportAngle;
          const isGlobal = uiStore.supportIsGlobal;
          const opts: { angle?: number; isGlobal?: boolean } = {};
          if (angle !== 0) opts.angle = angle;
          if (!isGlobal) opts.isGlobal = false;
          const rollerId = modelStore.addSupport(nearNode.id, rollerType, undefined, (opts.angle !== undefined || opts.isGlobal !== undefined) ? opts : undefined);
          // Apply prescribed displacement di (always in restrained direction, stored as dx)
          if (uiStore.supportDx !== 0) {
            modelStore.updateSupport(rollerId, { dx: uiStore.supportDx });
          }
          // Reset angle to 0 after placing
          uiStore.supportAngle = 0;
        } else {
          // fixed or pinned
          const angle = uiStore.supportAngle;
          const opts: { angle?: number } = {};
          if (angle !== 0) opts.angle = angle;
          const supId = modelStore.addSupport(nearNode.id, uiStore.supportType as any, undefined, opts.angle !== undefined ? opts : undefined);
          // Apply prescribed displacements if any are non-zero
          const presc: Record<string, number> = {};
          if (uiStore.supportDx !== 0) presc.dx = uiStore.supportDx;
          if (uiStore.supportDy !== 0) presc.dz = uiStore.supportDy;
          if (uiStore.supportDrz !== 0) presc.dry = uiStore.supportDrz;
          if (Object.keys(presc).length > 0) {
            modelStore.updateSupport(supId, presc);
          }
          // Reset angle to 0 after placing
          uiStore.supportAngle = 0;
        }
      }
    } else if (uiStore.currentTool === 'cylinder') {
      const nearNode = findNearestNodeAtScreen(mx, my);
      if (nearNode) {
        if (pendingCylinderNodeId === null) {
          pendingCylinderNodeId = nearNode.id;
          uiStore.selectNode(nearNode.id);
          uiStore.toast('실린더의 반대쪽 점을 선택하세요.', 'info');
        } else if (pendingCylinderNodeId !== nearNode.id) {
          const id = modelStore.addCylinderLoad(pendingCylinderNodeId, nearNode.id, uiStore.cylinderForce, uiStore.activeLoadCaseId);
          pendingCylinderNodeId = null;
          if (id >= 0) {
            resultsStore.clear();
            uiStore.selectedLoads = new Set([id]);
          }
        }
      }
    } else if (uiStore.currentTool === 'load') {
      // Use raw world coords for hit-testing (not grid-snapped) so loads
      // can be placed on nodes/elements that are off-grid.
      // Always create new loads — selection only from select tool in 'loads' mode.

      const activeCaseId = uiStore.activeLoadCaseId;
      const direction = uiStore.loadDirection;

      if (uiStore.loadType === 'nodal') {
        // Nodal: click node → NodalLoad; click bar → PointLoadOnElement
        // Local directions need a member axis, so they deliberately skip nodes.
        const nearNode = requiresElementAxis(direction) ? null : findNearestNodeAtScreen(mx, my);
        if (nearNode) {
          const v = uiStore.loadValue;
          const { fx, fz, my } = nodalLoadComponents(direction, v, uiStore.loadAngle);
          modelStore.addNodalLoad(nearNode.id, fx, fz, my, activeCaseId, direction === 'angle');
        } else {
          // No node nearby — try element for PointLoadOnElement
          const nearElem = findPickableElement(world.x, world.y);
          if (nearElem) {
            const ni = modelStore.getNode(nearElem.nodeI);
            const nj = modelStore.getNode(nearElem.nodeJ);
            if (ni && nj) {
              const dx = nj.x - ni.x;
              const dy = nj.y - ni.y;
              const lenSq = dx * dx + dy * dy;
              let t = ((world.x - ni.x) * dx + (world.y - ni.y) * dy) / lenSq;
              t = Math.max(0.01, Math.min(0.99, t));
              const a = t * Math.sqrt(lenSq);

              const v = uiStore.loadValue;
              if (direction === 'moment') {
                modelStore.addPointLoadOnElement(nearElem.id, a, 0, { mz: v, caseId: activeCaseId });
              } else {
                const { angle, isGlobal } = elementLoadDirection(direction, uiStore.loadAngle);
                modelStore.addPointLoadOnElement(nearElem.id, a, v, { angle, isGlobal, caseId: activeCaseId });
              }
            }
          }
        }
      } else if (uiStore.loadType === 'distributed') {
        const nearElem = findPickableElement(world.x, world.y);
        if (nearElem) {
          const { angle, isGlobal } = elementLoadDirection(direction, uiStore.loadAngle);
          modelStore.addDistributedLoad(nearElem.id, uiStore.loadValue, uiStore.loadValueJ, angle, isGlobal, activeCaseId);
        }
      }
    } else if (uiStore.currentTool === 'influenceLine') {
      // Influence line: click node for Rz/Rx/My, click element for V/M
      const q = uiStore.ilQuantity;
      const nearNode = findNearestNodeAtScreen(mx, my);
      const nearElem = findPickableElement(world.x, world.y);

      let result: any;
      if ((q === 'Rz' || q === 'Rx' || q === 'My') && nearNode) {
        result = modelStore.computeInfluenceLine(q, nearNode.id);
      } else if ((q === 'V' || q === 'M') && nearElem) {
        result = modelStore.computeInfluenceLine(q, undefined, nearElem.id, 0.5);
      } else if (nearNode) {
        // Clicked node but quantity is V/M → switch to Rz
        result = modelStore.computeInfluenceLine('Rz', nearNode.id);
        uiStore.ilQuantity = 'Rz';
      } else if (nearElem) {
        // Clicked element but quantity is Rz/Rx/My → switch to M
        result = modelStore.computeInfluenceLine('M', undefined, nearElem.id, 0.5);
        uiStore.ilQuantity = 'M';
      } else {
        uiStore.toast(t('viewport.ilClickHint'), 'info');
      }

      if (result) {
        if (typeof result === 'string') {
          uiStore.toast(result, 'error');
        } else {
          resultsStore.setInfluenceLine(result);
          uiStore.toast(t('viewport.ilCalculated'), 'success');
        }
      }
    } else if (uiStore.currentTool === 'select') {
      const dimensionId = uiStore.selectsKind('dimensions') ? dimensionAtScreen(mx, my) : null;
      if (dimensionId !== null) {
        const dimension = modelStore.sketchConstraints.find(c => c.kind === 'dimension' && c.id === dimensionId);
        if (dimension?.kind === 'dimension') {
          uiStore.selectDimension(dimensionId);
          draggedDimensionId = dimensionId;
          dimensionDragMoved = false;
          const base = dimension.position ?? world;
          dimensionDragOffset = { x: base.x - world.x, y: base.y - world.y };
          dimensionDragPosition = { ...base };
          invalidate();
          return;
        }
      }
      uiStore.clearSelectedDimension();
      // Despiece inspection: while the free-body view is active, a click inspects
      // the converging actions (node) or both member ends (member) — without
      // disturbing the normal selection used when Despiece is off.
      if (resultsStore.diagramType === 'despiece') {
        const insN = findNearestNodeAtScreen(mx, my);
        if (insN) { uiStore.despieceInspect = { type: 'node', id: insN.id }; invalidate(); return; }
        const insE = findPickableElement(world.x, world.y);
        uiStore.despieceInspect = insE ? { type: 'member', id: insE.id } : null;
        invalidate();
        return;
      }
      const sm = uiStore.selectMode;

      if (sm === 'stress') {
        // ── Stress mode: click on element → stress query + diagram query ──
        const dt = resultsStore.diagramType;
        if (resultsStore.results) {
          const nearElem = findPickableElement(world.x, world.y);
          if (nearElem) {
            const ni = modelStore.getNode(nearElem.nodeI);
            const nj = modelStore.getNode(nearElem.nodeJ);
            if (ni && nj) {
              const edx = nj.x - ni.x;
              const edy = nj.y - ni.y;
              const lenSq = edx * edx + edy * edy;
              let t = ((world.x - ni.x) * edx + (world.y - ni.y) * edy) / lenSq;
              t = Math.max(0, Math.min(1, t));
              const wx = ni.x + t * edx;
              const wy = ni.y + t * edy;
              resultsStore.stressQuery = { elementId: nearElem.id, t, worldX: wx, worldY: wy };
              if (dt === 'moment' || dt === 'shear' || dt === 'axial') {
                const ef = resultsStore.getElementForces(nearElem.id);
                if (ef) {
                  const value = computeDiagramValueAt(dt as 'moment' | 'shear' | 'axial', t, ef);
                  diagramQuery = { elementId: nearElem.id, t, value, worldX: wx, worldY: wy };
                }
              }
            }
          } else {
            resultsStore.stressQuery = null;
            diagramQuery = null;
          }
        }
      } else if (uiStore.multiKindSelect && sm !== 'shells') {
        /*
         * Multi-kind: try each active kind and take the first that hits.
         *
         * Ordered by how precisely a click identifies the thing — a node is a
         * point, a member is a line, a support and a load are glyphs with a
         * wider tolerance — so the most specific answer wins when several sit
         * on the same spot, which at a joint they always do. A drag is where
         * multi-kind earns its keep; this ordering just keeps a single click
         * predictable rather than arbitrary.
         */
        if (!e.shiftKey) {
          uiStore.clearSelection();
          uiStore.clearSelectedSupports();
          uiStore.clearSelectedLoads();
        }
        let hit = false;
        if (uiStore.selectsKind('nodes')) {
          const n = findNearestNodeAtScreen(mx, my);
          if (n) { beginNodeDrag(n.id, true, snapped, { x: mx, y: my }); hit = true; }
        }
        if (!hit && uiStore.selectsKind('elements')) {
          const el = findPickableElement(world.x, world.y);
          if (el) { uiStore.selectElement(el.id, true); hit = true; }
        }
        if (!hit && uiStore.selectsKind('supports')) {
          const sup = findPickableSupport(world.x, world.y);
          if (sup) { uiStore.selectSupport(sup.id, true); hit = true; }
        }
        if (!hit && uiStore.selectsKind('loads')) {
          const ld = findAllPickableLoads(world.x, world.y);
          if (ld.length > 0) { uiStore.selectLoad(ld[0], true); hit = true; }
        }
        if (!hit) boxSelect = { startX: mx, startY: my, endX: mx, endY: my };
      } else if (sm === 'supports') {
        // ── Supports mode: click to select a support, drag to box select ──
        const nearSup = findPickableSupport(world.x, world.y);
        if (nearSup) {
          uiStore.selectSupport(nearSup.id, e.shiftKey);
        } else {
          if (!e.shiftKey) uiStore.clearSelectedSupports();
          boxSelect = { startX: mx, startY: my, endX: mx, endY: my };
        }
      } else if (sm === 'loads') {
        // ── Loads mode: click to select a load with cycling for overlapping loads ──
        const allNear = findAllPickableLoads(world.x, world.y);
        if (allNear.length > 0) {
          if (e.shiftKey) {
            // Shift: add next unselected to selection, or toggle first
            const first = allNear.find(id => !uiStore.selectedLoads.has(id)) ?? allNear[0];
            uiStore.selectLoad(first, true);
          } else if (allNear.length > 1 && uiStore.selectedLoads.size === 1 && uiStore.selectedLoads.has(allNear[0])) {
            // Click same spot with one already selected → cycle to next
            uiStore.selectLoad(allNear[1], false);
          } else {
            uiStore.selectLoad(allNear[0], false);
          }
        } else {
          if (!e.shiftKey) uiStore.clearSelectedLoads();
          boxSelect = { startX: mx, startY: my, endX: mx, endY: my };
        }
      } else if (sm === 'nodes') {
        // ── Nodes mode: select nodes, drag to box select ──
        const nearNode = findNearestNodeAtScreen(mx, my);
        if (nearNode) {
          beginNodeDrag(nearNode.id, e.shiftKey, snapped, { x: mx, y: my });
        } else {
          if (!e.shiftKey) uiStore.clearSelection();
          boxSelect = { startX: mx, startY: my, endX: mx, endY: my };
        }
      } else {
        // ── Elements mode (default): select nodes/bars, drag, box select ──
        diagramQuery = null;

        // Diagram query still works for reading values (but no stress query)
        const dt = resultsStore.diagramType;
        if (resultsStore.results && (dt === 'moment' || dt === 'shear' || dt === 'axial')) {
          const nearElem = findPickableElement(world.x, world.y);
          if (nearElem) {
            const ni = modelStore.getNode(nearElem.nodeI);
            const nj = modelStore.getNode(nearElem.nodeJ);
            if (ni && nj) {
              const edx = nj.x - ni.x;
              const edy = nj.y - ni.y;
              const lenSq = edx * edx + edy * edy;
              let t = ((world.x - ni.x) * edx + (world.y - ni.y) * edy) / lenSq;
              t = Math.max(0, Math.min(1, t));
              const ef = resultsStore.getElementForces(nearElem.id);
              if (ef) {
                const value = computeDiagramValueAt(dt as 'moment' | 'shear' | 'axial', t, ef);
                const wx = ni.x + t * edx;
                const wy = ni.y + t * edy;
                diagramQuery = { elementId: nearElem.id, t, value, worldX: wx, worldY: wy };
              }
            }
          }
        }

        // A node press begins the same constrained drag used by the node
        // tool. A press/release without movement remains a normal selection.
        const nearNode = findNearestNodeAtScreen(mx, my);
        if (nearNode) {
          beginNodeDrag(nearNode.id, e.shiftKey, snapped, { x: mx, y: my });
        } else {
          const nearElem = findPickableElement(world.x, world.y);
          if (nearElem) {
            uiStore.selectElement(nearElem.id, e.shiftKey);
            // Sync with DSM Matrix Explorer if wizard is open
            if (dsmStepsStore.isOpen) dsmStepsStore.selectElement(nearElem.id);
          } else {
            if (!e.shiftKey) uiStore.clearSelection();
            boxSelect = { startX: mx, startY: my, endX: mx, endY: my };
          }
        }
      }
    }
    invalidate();
  }

  function handleMouseMove(e: MouseEvent) {
    pointerInside = true;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const world = uiStore.screenToWorld(mx, my);
    const snapped = snapWorkspace(world.x, world.y);
    blockUI.preview(world);
    uiStore.setMouse(mx, my, snapped.x, snapped.y);
    if (blockUI.command && !isPanning) { invalidate(); return; }

    // For tools that benefit from midpoint snap, update world coords accordingly
    const toolNow = uiStore.currentTool;
    if (toolNow === 'element' || toolNow === 'node' || toolNow === 'load') {
      const ms = snapWithMidpoint(world.x, world.y);
      uiStore.setMouse(mx, my, ms.x, ms.y);
    } else {
      uiStore.setMouse(mx, my, snapped.x, snapped.y);
    }

    if (isPanning) {
      uiStore.panX += mx - panStartX;
      uiStore.panY += my - panStartY;
      panStartX = mx;
      panStartY = my;
      return;
    }

    if (draggedDimensionId !== null) {
      dimensionDragPosition = {
        x: world.x + dimensionDragOffset.x,
        y: world.y + dimensionDragOffset.y,
      };
      dimensionDragMoved = true;
      invalidate();
      return;
    }

    if (draggedBlockId !== null && blockDragStart) {
      if (!blockDragMoved) {
        if (!blockDragStartScreen || !exceedsNodeDragThreshold(blockDragStartScreen, { x: mx, y: my })) {
          invalidate();
          return;
        }
        blockDragMoved = true;
      }
      const targetNode = blockDragSourceNodeId === null
        ? null
        : findNearestNodeAtScreenExcludingBlock(mx, my, draggedBlockId);
      const target = targetNode ?? snapped;
      blockDragTargetNodeId = targetNode?.id ?? null;
      blockDragGripTarget = { x: target.x, y: target.y };
      const dx = target.x - blockDragStart.pointer.x;
      const dy = target.y - blockDragStart.pointer.y;
      blockDragPose = {
        x: blockDragStart.pose.x + dx,
        y: blockDragStart.pose.y + dy,
        angle: blockDragStart.pose.angle,
      };
      modelStore.previewBlock(draggedBlockId, blockDragPose,
        { source: blockDragStart.pointer, target: blockDragGripTarget });
      invalidate();
      return;
    }

    // Block dragging in simplified 2D mode
    if (uiStore.simplified2DMode && draggedNodeId !== null) {
      draggedNodeId = null;
      dragStartWorld = null;
      dragStartScreen = null;
      return;
    }

    // Node dragging (multi-node support)
    if (draggedNodeId !== null && dragStartWorld) {
      if (!dragMoved) {
        if (!dragStartScreen || !exceedsNodeDragThreshold(dragStartScreen, { x: mx, y: my })) {
          invalidate();
          return;
        }
        dragMoved = true;
      }

      const dx = snapped.x - dragStartWorld.x;
      const dy = snapped.y - dragStartWorld.y;

      if (uiStore.selectedNodes.size > 1 && uiStore.selectedNodes.has(draggedNodeId)) {
        // Move all selected nodes by delta (back-projected to 3D)
        const desired = new Map<number, { id: number; x: number; y: number; z?: number }>();
        for (const nodeId of uiStore.selectedNodes) {
          const node = modelStore.getNode(nodeId);
          if (node) {
            const projected = project2DNode(node);
            const moved = to3D(uiStore.drawPlane2D, projected.x + dx, projected.y + dy, node);
            desired.set(nodeId, { ...node, ...moved });
          }
        }
        modelStore.updateNodesConstrained(desired);
      } else {
        const orig = modelStore.getNode(draggedNodeId);
        const moved = to3D(uiStore.drawPlane2D, snapped.x, snapped.y, orig ?? { x: 0, y: 0, z: 0 });
        if (orig) modelStore.updateNodesConstrained(new Map([[draggedNodeId, { ...orig, ...moved }]]));
      }

      dragStartWorld = { x: snapped.x, y: snapped.y };
      resultsStore.clear();
    }

    // Box selection tracking
    if (boxSelect) {
      boxSelect.endX = mx;
      boxSelect.endY = my;
    }

    // Diagram hover: compute value at mouse projection on nearest element
    if (resultsStore.results && !isPanning && draggedNodeId === null) {
      const dt = resultsStore.diagramType;
      if (dt === 'moment' || dt === 'shear' || dt === 'axial' || dt === 'deformed' || dt === 'colorMap') {
        const nearElem = findPickableElement(world.x, world.y);
        if (nearElem) {
          const ni = getProjectedNode(nearElem.nodeI);
          const nj = getProjectedNode(nearElem.nodeJ);
          if (ni && nj) {
            const edx = nj.x - ni.x;
            const edy = nj.y - ni.y;
            const lenSq = edx * edx + edy * edy;
            let t = ((world.x - ni.x) * edx + (world.y - ni.y) * edy) / lenSq;
            t = Math.max(0, Math.min(1, t));
            const wx = ni.x + t * edx;
            const wy = ni.y + t * edy;

            if (dt === 'moment' || dt === 'shear' || dt === 'axial') {
              const ef = resultsStore.getElementForces(nearElem.id);
              if (ef) {
                const value = computeDiagramValueAt(dt as 'moment' | 'shear' | 'axial', t, ef);
                diagramHover = { elementId: nearElem.id, t, value, worldX: wx, worldY: wy };
              } else {
                diagramHover = null;
              }
            } else if (dt === 'deformed') {
              // Compute displacement using Hermite cubic interpolation (same as drawDeformed)
              // Linear interpolation gives wrong values when both end nodes have zero displacement
              // (e.g. simply supported beam: uy=0 at both ends, but deflects at midspan)
              const di = resultsStore.getDisplacement(nearElem.nodeI);
              const dj = resultsStore.getDisplacement(nearElem.nodeJ);
              const ef = resultsStore.getElementForces(nearElem.id);
              if (di && dj && ef && ni && nj) {
                // Get EI for particular solution
                const elem = modelStore.elements.get(nearElem.id);
                let EI: number | undefined;
                if (elem) {
                  const mat = modelStore.materials.get(elem.materialId);
                  const sec = modelStore.sections.get(elem.sectionId);
                  if (mat && sec) EI = mat.e * 1000 * effectiveBendingInertia(sec); // kN·m²
                }
                const disp = computeDisplacementAt(
                  t,
                  ni.x, ni.y, nj.x, nj.y,
                  di.ux, di.uz ?? di.uy, di.ry ?? di.rz,
                  dj.ux, dj.uz ?? dj.uy, dj.ry ?? dj.rz,
                  ef.length,
                  ef.hingeStart, ef.hingeEnd,
                  EI, ef.qI, ef.qJ, ef.pointLoads, ef.distributedLoads,
                );
                const ux = toDisplay(disp.ux, 'displacement', uiStore.unitSystem);
                const uz = toDisplay(get2DDisplayDisplacementVertical(disp), 'displacement', uiStore.unitSystem);
                const displacementUnit = unitLabel('displacement', uiStore.unitSystem);
                // Rotation: interpolate linearly between end rotations (good enough for display)
                const ry = (di.ry ?? di.rz) + t * ((dj.ry ?? dj.rz) - (di.ry ?? di.rz));
                const totalDisp = Math.sqrt(ux * ux + uz * uz);
                diagramHover = {
                  elementId: nearElem.id, t, value: totalDisp, worldX: wx, worldY: wy,
                  lines: [
                    `ux: ${ux.toFixed(3)} ${displacementUnit}`,
                    `${TWO_D_DISPLACEMENT_LABELS.vertical}: ${uz.toFixed(3)} ${displacementUnit}`,
                    `${TWO_D_DISPLACEMENT_LABELS.rotation}: ${ry.toFixed(4)} rad`,
                  ],
                };
              } else {
                diagramHover = null;
              }
            } else if (dt === 'colorMap') {
              // Show the colorMap kind's value
              const ef = resultsStore.getElementForces(nearElem.id);
              if (ef) {
                const cmKind = resultsStore.colorMapKind;
                let value: number;
                let label: string;
                let unit: string;
                if (cmKind === 'moment') {
                  value = computeDiagramValueAt('moment', t, ef);
                  label = 'M'; unit = 'kN·m';
                } else if (cmKind === 'shear') {
                  value = computeDiagramValueAt('shear', t, ef);
                  label = 'V'; unit = 'kN';
                } else if (cmKind === 'axial') {
                  value = computeDiagramValueAt('axial', t, ef);
                  label = 'N'; unit = 'kN';
                } else {
                  // stressRatio — approximate with max of endpoint ratios interpolated
                  const nAvg = (ef.nStart + ef.nEnd) / 2;
                  const mMax = Math.max(Math.abs(ef.mStart), Math.abs(ef.mEnd));
                  const vMax = Math.max(Math.abs(ef.vStart), Math.abs(ef.vEnd));
                  value = Math.abs(nAvg) + mMax + vMax; // rough combined
                  label = 'ratio'; unit = '';
                }
                diagramHover = { elementId: nearElem.id, t, value, worldX: wx, worldY: wy, label, unit };
              } else {
                diagramHover = null;
              }
            }
          } else {
            diagramHover = null;
          }
        } else {
          diagramHover = null;
        }
      } else {
        diagramHover = null;
      }
    } else {
      diagramHover = null;
    }
    // Trigger redraw for cursor tracking, snap visualization, hover tooltips
    invalidate();
  }

  function handleMouseUp() {
    isPanning = false;

    if (draggedBlockId !== null) {
      if (blockDragMoved && blockDragPose) {
        const pin = blockDragSourceNodeId !== null && blockDragTargetNodeId !== null
          ? { source: blockDragSourceNodeId, target: blockDragTargetNodeId }
          : undefined;
        modelStore.placeBlock(draggedBlockId, blockDragPose, pin,
          blockDragStart && blockDragGripTarget
            ? { source: blockDragStart.pointer, target: blockDragGripTarget } : undefined);
        resultsStore.clear();
      } else {
        modelStore.previewBlock(draggedBlockId, null);
      }
      draggedBlockId = null;
      blockDragMoved = false;
      blockDragStartScreen = null;
      blockDragStart = null;
      blockDragPose = null;
      blockDragSourceNodeId = null;
      blockDragTargetNodeId = null;
      blockDragGripTarget = null;
    }

    if (draggedDimensionId !== null) {
      if (dimensionDragMoved && dimensionDragPosition) {
        modelStore.moveDimension(draggedDimensionId, dimensionDragPosition);
      }
      draggedDimensionId = null;
      dimensionDragMoved = false;
      dimensionDragPosition = null;
    }

    if (draggedNodeId !== null) {
      if (!dragMoved) {
        historyStore.undo();
      }
      draggedNodeId = null;
      dragMoved = false;
      dragStartWorld = null;
      dragStartScreen = null;
    }

    // Finalize box selection (AutoCAD-style: Window vs Crossing)
    if (boxSelect) {
      const { rect, isWindow } = normaliseDrag(
        boxSelect.startX, boxSelect.startY, boxSelect.endX, boxSelect.endY,
      );

      // Only count as box select if dragged at least a few pixels
      if (rect.x2 - rect.x1 > 3 || rect.y2 - rect.y1 > 3) {
        /*
         * What the rectangle takes is decided in `box-select.ts`, per entity
         * and per gesture, and filtered by the active mode.
         *
         * Supports, Loads and Nodes never reached this point at all: only the
         * Elements branch started the drag, so in the other three modes a
         * marquee did not even appear. The gathering is filtered by mode for
         * the same reason 3D filters it — what is highlighted has to be what
         * a Delete would remove.
         */
        const picked = boxSelectTargets({
          rect,
          isWindow,
          /*
           * Every kind the user asked for. `stress` is not a kind of thing to
           * select — it is a query about one point — so a marquee armed in
           * that mode falls back to elements rather than selecting nothing.
           */
          kinds: uiStore.selectMode === 'stress'
            ? (['elements'] as BoxSelectMode[])
            : uiStore.selectKinds.size === 0
            ? (['nodes', 'elements', 'supports', 'loads'] as BoxSelectMode[])
            // `SelectMode` is wider than `BoxSelectMode` (it adds 'shells' and
            // 'stress'), so narrow with a type predicate rather than a cast.
            : [...uiStore.selectKinds].filter(
                (k): k is BoxSelectMode => k !== 'shells' && k !== 'stress',
              ),
          toScreen: (p) => uiStore.worldToScreen(p.x, p.y),
          model: {
            nodes: [...modelStore.nodes.values()].filter(n => modelStore.editingBlockId === null || modelStore.canEditNode(n.id)).map((n) => {
              const p = project2DNode(n);
              return { id: n.id, x: p.x, y: p.y };
            }),
            elements: pickableElements().values(),
            supports: modelStore.supports.values(),
            loads: modelStore.model.loads as never,
            getNode: (id) => {
              const n = modelStore.getNode(id);
              return n ? project2DNode(n) : undefined;
            },
            getElement: (id) => modelStore.elements.get(id),
          },
        });

        if (picked.nodes.size > 0 || picked.elements.size > 0) {
          uiStore.setSelection(
            new Set([...uiStore.selectedNodes, ...picked.nodes]),
            new Set([...uiStore.selectedElements, ...picked.elements]),
            true,
          );
        }
        if (picked.supports.size > 0) {
          uiStore.selectedSupports = new Set([...uiStore.selectedSupports, ...picked.supports]);
        }
        if (picked.loads.size > 0) {
          uiStore.selectedLoads = new Set([...uiStore.selectedLoads, ...picked.loads]);
        }
      }
      boxSelect = null;
    }
    invalidate();
  }

  function handleDblClick(e: MouseEvent) {
    if (uiStore.currentTool !== 'select') return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const world = uiStore.screenToWorld(mx, my);
    if (blockUI.command) return;
    const dimensionId = uiStore.selectsKind('dimensions') ? dimensionAtScreen(mx, my) : null;
    if (dimensionId !== null) {
      const dimension = modelStore.sketchConstraints.find(c => c.kind === 'dimension' && c.id === dimensionId);
      if (dimension?.kind === 'dimension') {
        const displayed = dimensionDisplayedValues.get(dimensionId) ?? Math.abs(dimension.value);
        uiStore.selectDimension(dimensionId);
        dimensionEditor = {
          id: dimensionId,
          x: mx,
          y: my,
          angular: dimension.measure === 'angle',
          value: dimension.measure === 'angle'
            ? Number((displayed * 180 / Math.PI).toFixed(6))
            : Math.abs(toDisplay(displayed, 'length', uiStore.unitSystem)),
          readOnly: !!dimension.readOnly,
        };
        nodeConnectionEditor = null;
        invalidate();
        return;
      }
    }
    const nearNode = findNearestNodeAtScreen(mx, my);
    const nodeBlock = nearNode ? modelStore.blockForNode(nearNode.id) : undefined;
    if (nodeBlock && modelStore.editingBlockId === null) {
      dimensionEditor = null;
      nodeConnectionEditor = null;
      cylinderEditor = null;
      blockUI.edit(nodeBlock.id);
      invalidate();
      return;
    }
    const cylinderHit = nearNode ? undefined : findAllPickableLoads(world.x, world.y)
      .map(id => modelStore.loads.find(l => l.data.id === id))
      .find(load => load?.type === 'cylinder');
    if (cylinderHit?.type === 'cylinder') {
      uiStore.selectedLoads = new Set([cylinderHit.data.id]);
      dimensionEditor = null;
      nodeConnectionEditor = null;
      cylinderEditor = {
        id: cylinderHit.data.id,
        x: mx,
        y: my,
        force: toDisplay(cylinderHit.data.force, 'force', uiStore.unitSystem),
      };
      invalidate();
      return;
    }
    if (nearNode) {
      const frameEnds = modelStore.getReleasesAtNode(nearNode.id)
        .filter(end => modelStore.elements.get(end.elementId)?.type === 'frame');
      uiStore.selectNode(nearNode.id);
      dimensionEditor = null;
      nodeConnectionEditor = {
        id: nearNode.id,
        x: mx,
        y: my,
        nodeX: toDisplay(nearNode.x, 'length', uiStore.unitSystem),
        nodeY: toDisplay(nearNode.y, 'length', uiStore.unitSystem),
        mode: frameEnds.length > 0 && frameEnds.every(end => end.hasHinge) ? 'hinge' : 'rigid',
      };
      invalidate();
      return;
    }
    const blockId = blockUI.instanceAt(world);
    if (blockId !== null && modelStore.editingBlockId === null) { blockUI.edit(blockId); return; }

    const nearElem = findPickableElement(world.x, world.y);
    if (nearElem) {
      uiStore.editingElementId = nearElem.id;
      uiStore.editScreenPos = { x: e.clientX, y: e.clientY };
    }
  }

  function getCursor(): string {
    if (isPanning) return 'grabbing';
    switch (uiStore.currentTool) {
      case 'select':
        if (draggedBlockId !== null) return 'grabbing';
        if (draggedDimensionId !== null) return 'grabbing';
        if (uiStore.selectsKind('dimensions') && dimensionAtScreen(uiStore.mouseX, uiStore.mouseY) !== null) return 'move';
        if (draggedNodeId !== null) return 'grabbing';
        if (uiStore.selectMode === 'stress') return 'crosshair';
        if (modelStore.editingBlockId === null
          && blockUI.instanceAt(uiStore.screenToWorld(uiStore.mouseX, uiStore.mouseY)) !== null) return 'move';
        return 'default';
      case 'node': return uiStore.nodeMode === 'hinge' ? 'pointer' : 'cell';
      case 'element': return 'crosshair';
      case 'support': return 'crosshair';
      case 'load': return 'crosshair';
      case 'cylinder': return 'crosshair';
      case 'influenceLine': return 'crosshair';
      default: return 'default';
    }
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    if (uiStore.currentTool === 'element' && pendingNode !== null) {
      cancelElementCreation();
      invalidate();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const world = uiStore.screenToWorld(mx, my);

    if (modelStore.editingBlockId === null) {
      for (const joint of modelStore.blocks.joints) {
        const id = resolveNodeRef(modelStore.blocks, joint.a);
        const n = id === undefined ? undefined : modelStore.getNode(id);
        if (n && Math.hypot(n.x - world.x, n.y - world.y) < 10 / uiStore.zoom) {
          modelStore.removeBlockJoint(joint.id); return;
        }
      }
      const blockId = blockUI.instanceAt(world);
      if (blockId !== null) { uiStore.contextMenu = null; blockUI.openContext(blockId, e.clientX, e.clientY); return; }
    }
    const nearNode = findNearestNodeAtScreen(mx, my);
    const nearElem = nearNode ? null : findPickableElement(world.x, world.y);

    uiStore.contextMenu = {
      x: e.clientX,
      y: e.clientY,
      nodeId: nearNode?.id,
      elementId: nearElem?.id,
    };
  }

  // ===== Touch event handlers (mobile) =====
  let touchState: {
    startTouches: Array<{ x: number; y: number }>;
    lastDist: number;
    lastCenter: { x: number; y: number };
    isPinch: boolean;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    moved: boolean;
  } | null = null;

  function handleTouchStart(e: TouchEvent) {
    e.preventDefault();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const touches = Array.from(e.touches).map(t => ({
      x: t.clientX - rect.left,
      y: t.clientY - rect.top,
    }));

    if (touches.length === 1) {
      // Single touch — treat as mousedown + setup long-press
      touchState = {
        startTouches: touches,
        lastDist: 0,
        lastCenter: touches[0],
        isPinch: false,
        longPressTimer: null,
        moved: false,
      };
      touchState.longPressTimer = setTimeout(() => {
        // Long press → context menu
        if (touchState && !touchState.moved) {
          const world = uiStore.screenToWorld(touches[0].x, touches[0].y);
          const nearNode = findNearestNodeAtScreen(touches[0].x, touches[0].y);
          const nearElem = nearNode ? null : findPickableElement(world.x, world.y);
          uiStore.contextMenu = {
            x: touches[0].x + rect.left,
            y: touches[0].y + rect.top,
            nodeId: nearNode?.id,
            elementId: nearElem?.id,
          };
        }
      }, 500);

      // Dispatch as mousedown
      const synth = {
        clientX: touches[0].x + rect.left,
        clientY: touches[0].y + rect.top,
        button: 0,
        shiftKey: false,
        preventDefault: () => {},
      } as MouseEvent;
      handleMouseDown(synth);
    } else if (touches.length === 2) {
      // Two fingers — pinch/pan
      cancelLongPress();
      const dist = Math.hypot(touches[1].x - touches[0].x, touches[1].y - touches[0].y);
      const center = {
        x: (touches[0].x + touches[1].x) / 2,
        y: (touches[0].y + touches[1].y) / 2,
      };
      touchState = {
        startTouches: touches,
        lastDist: dist,
        lastCenter: center,
        isPinch: true,
        longPressTimer: null,
        moved: false,
      };
      // Cancel any ongoing single-touch interaction
      isPanning = false;
      draggedNodeId = null;
      if (draggedBlockId !== null) modelStore.previewBlock(draggedBlockId, null);
      draggedBlockId = null;
      blockDragMoved = false;
      blockDragStartScreen = null;
      blockDragStart = null;
      blockDragPose = null;
      blockDragSourceNodeId = null;
      blockDragTargetNodeId = null;
      blockDragGripTarget = null;
      boxSelect = null;
    }
  }

  function handleTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (!touchState || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const touches = Array.from(e.touches).map(t => ({
      x: t.clientX - rect.left,
      y: t.clientY - rect.top,
    }));

    touchState.moved = true;
    cancelLongPress();

    if (touches.length === 1 && !touchState.isPinch) {
      // Single finger drag → mousemove
      const synth = {
        clientX: touches[0].x + rect.left,
        clientY: touches[0].y + rect.top,
        button: 0,
        shiftKey: false,
        buttons: 1,
        preventDefault: () => {},
      } as MouseEvent;
      handleMouseMove(synth);
    } else if (touches.length === 2 && touchState.isPinch) {
      // Pinch-to-zoom + two-finger pan
      const dist = Math.hypot(touches[1].x - touches[0].x, touches[1].y - touches[0].y);
      const center = {
        x: (touches[0].x + touches[1].x) / 2,
        y: (touches[0].y + touches[1].y) / 2,
      };

      // Zoom
      if (touchState.lastDist > 0) {
        const scale = dist / touchState.lastDist;
        const worldBefore = uiStore.screenToWorld(center.x, center.y);
        uiStore.zoom *= scale;
        const worldAfter = uiStore.screenToWorld(center.x, center.y);
        uiStore.panX += (worldAfter.x - worldBefore.x) * uiStore.zoom;
        uiStore.panY -= (worldAfter.y - worldBefore.y) * uiStore.zoom;
      }

      // Pan
      uiStore.panX += center.x - touchState.lastCenter.x;
      uiStore.panY += center.y - touchState.lastCenter.y;

      touchState.lastDist = dist;
      touchState.lastCenter = center;
      invalidate();
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    e.preventDefault();
    cancelLongPress();
    if (touchState && !touchState.isPinch && e.touches.length === 0) {
      handleMouseUp();
    }
    if (e.touches.length === 0) {
      touchState = null;
    }
  }

  function cancelLongPress() {
    if (touchState?.longPressTimer) {
      clearTimeout(touchState.longPressTimer);
      touchState.longPressTimer = null;
    }
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const worldBefore = uiStore.screenToWorld(mx, my);
    uiStore.zoom *= e.deltaY < 0 ? 1.1 : 0.9;
    const worldAfter = uiStore.screenToWorld(mx, my);

    uiStore.panX += (worldAfter.x - worldBefore.x) * uiStore.zoom;
    uiStore.panY -= (worldAfter.y - worldBefore.y) * uiStore.zoom;
    invalidate();
  }

  function drawTooltip(sx: number, sy: number, lines: string[]) {
    if (!ctx) return;
    _drawTooltip(ctx, sx, sy, lines, width, height);
  }

  // ── Thin wrappers that delegate to spatial-queries.ts, passing store data ──

  function findNearestNodeWorld(x: number, y: number, maxDist: number) {
    return _findNearestNode(x, y, maxDist, getProjectedNodes());
  }

  /** Build a projected node map for hit testing / picking in the current 2D plane. */
  function getProjectedNodes(): Map<number, { id: number; x: number; y: number }> {
    const map = new Map<number, { id: number; x: number; y: number }>();
    for (const node of modelStore.nodes.values()) {
      if (modelStore.editingBlockId === null || modelStore.canEditNode(node.id)) map.set(node.id, project2DNode(node));
    }
    return map;
  }

  function findNearestNodeAtScreen(screenX: number, screenY: number, maxDistPx = NODE_PICK_RADIUS_PX) {
    return _findNearestNodeScreen(
      screenX,
      screenY,
      maxDistPx,
      getProjectedNodes(),
      (x, y) => uiStore.worldToScreen(x, y),
    );
  }

  function findNearestNodeAtScreenExcludingBlock(screenX: number, screenY: number, blockId: number) {
    const nodes = new Map([...getProjectedNodes()].filter(([id]) => modelStore.blockForNode(id)?.id !== blockId));
    return _findNearestNodeScreen(
      screenX,
      screenY,
      NODE_PICK_RADIUS_PX,
      nodes,
      (x, y) => uiStore.worldToScreen(x, y),
    );
  }

  function drawNodeTargetHighlight(x: number, y: number, isSelected: boolean) {
    if (!ctx) return;
    const screen = uiStore.worldToScreen(x, y);
    ctx.save();
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 12, 0, Math.PI * 2);
    ctx.strokeStyle = '#1e78ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, isSelected ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = '#1e78ff';
    ctx.fill();
    ctx.restore();
  }

  function drawElementTargetHighlight(element: { nodeI: number; nodeJ: number }) {
    if (!ctx) return;
    const nodes = getProjectedNodes();
    const ni = nodes.get(element.nodeI), nj = nodes.get(element.nodeJ);
    if (!ni || !nj) return;
    const a = uiStore.worldToScreen(ni.x, ni.y), b = uiStore.worldToScreen(nj.x, nj.y);
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(30, 120, 255, 0.5)';
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = '#1e78ff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  function findNearestElement(x: number, y: number, maxDist: number) {
    return _findNearestElement(x, y, maxDist, pickableElements(), getProjectedNodes());
  }

  function findPickableElement(x: number, y: number) {
    return findNearestElement(x, y, ELEMENT_PICK_RADIUS_PX / uiStore.zoom);
  }

  function findNearestSupport(x: number, y: number, maxDist: number) {
    return _findNearestSupport(x, y, maxDist, modelStore.supports, getProjectedNodes());
  }

  function findPickableSupport(x: number, y: number) {
    return findNearestSupport(x, y, ATTACHMENT_PICK_RADIUS_PX / uiStore.zoom);
  }

  function pickableElements() {
    return modelStore.editingBlockId === null ? modelStore.elements : new Map([...modelStore.elements].filter(([id]) => modelStore.canEditElement(id)));
  }

  function findNearestMidpoint(x: number, y: number) {
    return _findNearestMidpoint(x, y, ELEMENT_PICK_RADIUS_PX / uiStore.zoom, pickableElements(), getProjectedNodes());
  }

  function snapWorkspace(x: number, y: number) {
    const block = modelStore.blocks.instances.find(b => b.id === modelStore.editingBlockId);
    if (!block) return uiStore.snapWorld(x, y);
    const local = worldToLocal({ x, y }, block);
    return localToWorld(uiStore.snapWorld(local.x, local.y), block);
  }

  function snapWithMidpoint(worldX: number, worldY: number): { x: number; y: number } {
    return _snapWithMidpoint(
      worldX,
      worldY,
      (x, y) => snapWorkspace(x, y),
      getProjectedNodes(),
      modelStore.elements,
      NODE_PICK_RADIUS_PX / uiStore.zoom,
      ELEMENT_PICK_RADIUS_PX / uiStore.zoom,
    );
  }

  function findAllLoadsNear(wx: number, wy: number, maxDist: number): number[] {
    return _findAllLoadsNear(wx, wy, maxDist, modelStore.model.loads, modelStore.elements, getProjectedNodes());
  }

  function findAllPickableLoads(wx: number, wy: number): number[] {
    return findAllLoadsNear(wx, wy, ATTACHMENT_PICK_RADIUS_PX / uiStore.zoom);
  }


</script>

<div class="viewport2d-wrapper">
  <canvas
    bind:this={canvas}
    onmousedown={handleMouseDown}
    onmousemove={handleMouseMove}
    onmouseup={handleMouseUp}
    onmouseleave={() => { pointerInside = false; handleMouseUp(); invalidate(); }}
    ondblclick={handleDblClick}
    onwheel={handleWheel}
    oncontextmenu={handleContextMenu}
    ontouchstart={handleTouchStart}
    ontouchmove={handleTouchMove}
    ontouchend={handleTouchEnd}
    ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
    ondrop={(e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file && file.name.toLowerCase().endsWith('.dxf')) {
        window.dispatchEvent(new CustomEvent('stabileo-dxf-drop', { detail: file }));
      }
    }}
    style="cursor: {getCursor()}"
  ></canvas>

  {#if dimensionEditor}
    <form
      class="dimension-inline-editor"
      style="left:{dimensionEditor.x}px; top:{dimensionEditor.y}px"
      data-testid="dimension-inline-editor"
      onsubmit={(e) => { e.preventDefault(); commitDimensionEdit(); }}
    >
      <div class="dimension-editor-row">
        <input
          bind:this={dimensionInput}
          bind:value={dimensionEditor.value}
          type="number"
          min="0"
          step={dimensionEditor.angular ? '0.000001' : 'any'}
          disabled={dimensionEditor.readOnly}
          aria-label={t('sketch.value')}
          onkeydown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault(); e.stopPropagation(); dimensionEditor = null; invalidate();
            }
          }}
        />
        <span>{dimensionEditor.angular ? '°' : unitLabel('length', uiStore.unitSystem)}</span>
        <button type="button" class="cancel" aria-label={t('sketch.cancel')} onclick={() => { dimensionEditor = null; invalidate(); }}>×</button>
        <button type="submit" class="confirm" aria-label={t('sketch.apply')}>✓</button>
      </div>
      <label class="dimension-readonly">
        <input type="checkbox" bind:checked={dimensionEditor.readOnly} />
        <span>{t('sketch.readOnly')}</span>
      </label>
    </form>
  {/if}

  {#if nodeConnectionEditor}
    <form
      class="node-connection-editor"
      role="dialog"
      aria-label="점 속성"
      tabindex="-1"
      style="left:{nodeConnectionEditor.x}px; top:{nodeConnectionEditor.y}px"
      data-testid="node-connection-editor"
      onsubmit={(e) => { e.preventDefault(); commitNodeConnectionEdit(); }}
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation(); nodeConnectionEditor = null; invalidate();
        }
      }}
    >
      <strong>점 속성</strong>
      <div class="node-coordinate-fields">
        <label>
          <span>{TWO_D_HORIZONTAL_AXIS_LABEL} ({unitLabel('length', uiStore.unitSystem)})</span>
          <input type="number" step="any" bind:value={nodeConnectionEditor.nodeX} aria-label={`${TWO_D_HORIZONTAL_AXIS_LABEL} 좌표`} />
        </label>
        <label>
          <span>{TWO_D_VERTICAL_AXIS_LABEL} ({unitLabel('length', uiStore.unitSystem)})</span>
          <input type="number" step="any" bind:value={nodeConnectionEditor.nodeY} aria-label={`${TWO_D_VERTICAL_AXIS_LABEL} 좌표`} />
        </label>
      </div>
      <div class="node-connection-options" role="radiogroup" aria-label="접합 방식">
        <label>
          <input type="radio" name="node-connection" value="hinge" bind:group={nodeConnectionEditor.mode} />
          <span>핀</span>
        </label>
        <label>
          <input type="radio" name="node-connection" value="rigid" bind:group={nodeConnectionEditor.mode} />
          <span>강접합</span>
        </label>
      </div>
      <div class="node-connection-actions">
        <button type="button" class="cancel" aria-label="취소" onclick={() => { nodeConnectionEditor = null; invalidate(); }}>×</button>
        <button type="submit" class="confirm" aria-label="확인">✓</button>
      </div>
    </form>
  {/if}

  {#if cylinderEditor}
    <form
      class="dimension-inline-editor cylinder-inline-editor"
      style="left:{cylinderEditor.x}px; top:{cylinderEditor.y}px"
      data-testid="cylinder-inline-editor"
      onsubmit={(e) => { e.preventDefault(); commitCylinderEdit(); }}
    >
      <strong>실린더 하중</strong>
      <div class="dimension-editor-row">
        <input type="number" step="any" bind:value={cylinderEditor.force} aria-label="실린더 하중"
          onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cylinderEditor = null; invalidate(); } }} />
        <span>{unitLabel('force', uiStore.unitSystem)}</span>
        <button type="button" class="cancel" aria-label="취소" onclick={() => { cylinderEditor = null; invalidate(); }}>×</button>
        <button type="submit" class="confirm" aria-label="확인">✓</button>
      </div>
      <small>+ 밀어냄 · − 당김</small>
    </form>
  {/if}

  <div class="viewport-controls" style="top: 12px">
    {#if modelStore.editingBlockId !== null}
      <div class="block-edit-controls" data-testid="block-edit-controls" aria-label="블록 편집">
        <button type="button" class="cancel" aria-label="블록 편집 취소" title="편집 취소" onclick={() => blockUI.finish(false)}>×</button>
        <button type="button" class="confirm" aria-label="블록 편집 완료" title="편집 완료" onclick={() => blockUI.finish(true)}>✓</button>
      </div>
    {/if}
    <button onclick={() => {
      if (modelStore.nodes.size === 0) return;
      uiStore.zoomToFit(modelStore.nodes.values(), canvas.width, canvas.height);
    }} title={t('viewport.zoomToFit')} aria-label={t('viewport.zoomToFit')}>
      <Icon name="fit" size={17} />
    </button>
  </div>
</div>

<style>
  .viewport2d-wrapper {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
    /* The drawing surface is the same ground as the shell, so the model sits
       on the page rather than in a differently-coloured box inside it. */
    background: var(--st-bg);
  }

  .dimension-inline-editor, .node-connection-editor {
    position:absolute;
    z-index:8;
    transform:translate(-50%, -50%);
    display:flex;
    flex-direction:column;
    align-items:stretch;
    min-width:12rem;
    gap:.38rem;
    padding:.42rem;
    border:1px solid #54d66a;
    border-radius:var(--st-radius);
    background-color:var(--st-surface-2);
    opacity:1;
    box-shadow:0 4px 16px rgba(0,0,0,.28);
  }
  .dimension-editor-row {
    display:flex;
    align-items:center;
    gap:.25rem;
  }
  .dimension-editor-row input {
    width:7.25rem;
    padding:.2rem .32rem;
    color:var(--st-text);
    background:var(--st-surface-2);
    border:1px solid var(--st-hair);
    border-radius:var(--st-radius);
  }
  .dimension-editor-row input:disabled { opacity:.55; }
  .dimension-inline-editor span { color:#54d66a; font:11px var(--st-mono, monospace); }
  .dimension-inline-editor button {
    width:1.65rem;
    height:1.65rem;
    padding:0;
    border:1px solid var(--st-hair);
    border-radius:var(--st-radius);
    color:var(--st-text);
    background:var(--st-surface-2);
    cursor:pointer;
  }
  .dimension-inline-editor .confirm { color:#54d66a; border-color:#54d66a; }
  .dimension-readonly {
    display:flex;
    align-items:center;
    gap:.4rem;
    color:var(--st-text-2);
    font-size:.75rem;
    cursor:pointer;
  }
  .dimension-readonly input { width:auto; accent-color:#54d66a; }
  .dimension-readonly span { color:var(--st-text-2); font:inherit; }

  .node-connection-editor strong { color:var(--st-text); font-size:.78rem; }
  .node-coordinate-fields { display:grid; grid-template-columns:1fr 1fr; gap:.35rem; }
  .node-coordinate-fields label { display:flex; flex-direction:column; gap:.2rem; color:var(--st-text-2); font-size:.7rem; }
  .node-coordinate-fields input { width:5.5rem; padding:.2rem .32rem; color:var(--st-text); background:var(--st-surface-2); border:1px solid var(--st-hair); border-radius:var(--st-radius); }
  .node-connection-options { display:flex; gap:.8rem; }
  .node-connection-options label { display:flex; align-items:center; gap:.3rem; color:var(--st-text-2); font-size:.75rem; cursor:pointer; }
  .node-connection-options input { accent-color:#54d66a; }
  .node-connection-actions { display:flex; justify-content:flex-end; gap:.3rem; }
  .node-connection-editor button { width:1.65rem; height:1.65rem; padding:0; border:1px solid var(--st-hair); border-radius:var(--st-radius); color:var(--st-text); background:var(--st-surface-2); cursor:pointer; }
  .node-connection-editor .confirm { color:#54d66a; border-color:#54d66a; }

  canvas {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
  }

  .block-edit-controls {
    display: flex;
    gap: 6px;
  }
  .block-edit-controls button {
    font: 700 20px/1 var(--st-sans);
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.28);
  }
  .block-edit-controls .cancel { color: #ff626f; border-color: #ff626f; }
  .block-edit-controls .confirm { color: #54d66a; border-color: #54d66a; }
  .block-edit-controls button:hover { background: var(--st-surface-3); }

  .viewport-controls {
    position: absolute;
    right: 12px;
    display: flex;
    flex-direction: row;
    gap: 4px;
    z-index: 10;
    transition: top 0.15s ease;
    /* Right-aligned so every button in the stack shares an edge. */
    align-items: flex-end;
}

  .viewport-controls button {
    width: 32px;
    height: 32px;
    /* The one control that floats over the canvas in every mode, so it wears
       the shell's surface rather than a navy of its own. */
    border: 1px solid var(--st-hair-strong);
    border-radius: var(--st-radius);
    background: color-mix(in srgb, var(--st-surface) 90%, transparent);
    color: var(--st-text-2);
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }

  .viewport-controls button:hover {
    background: var(--st-surface-3);
    color: var(--st-text);
  }
</style>
