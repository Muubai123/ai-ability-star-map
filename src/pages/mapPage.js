import { masteryColors } from "../mapData.js";
import {
  bindExplorationPanelEvents,
  renderExplorationPanel,
} from "../components/explorationPanel.js";
import {
  bindMapSettingsPanelEvents,
  ensureMapSettings,
  renderMapSettingsPanel,
} from "../components/mapSettingsPanel.js";
import { saveActiveSession, setActiveMap, setPage } from "../state.js";
import { escapeHtml } from "../utils/jsonUtils.js";
import { addLearningRecord, getLearningRecordsByNodeId } from "../records/learningRecordStore.js";
import { ensureNodeReviewMetadata } from "../review/reviewMetadata.js";
import { getMasteryHistoryByNodeId } from "../records/masteryHistory.js";
import {
  getDisplayMastery,
  getNodeRadius,
} from "../utils/mapUtils.js";

const FOCUS_TRANSITION_DURATION = 340;
const EXIT_TRANSITION_DURATION = 460;
const BACK_TRANSITION_DURATION = 320;
const SETTLE_TRANSITION_DURATION = 620;
const SINGLE_CLICK_DELAY = 220;
const VISIBLE_DESCENDANT_LEVELS = 3;
const WORLD_WIDTH = 2600;
const WORLD_HEIGHT = 2200;
const VIEWPORT_WIDTH = 980;
const VIEWPORT_HEIGHT = 640;
const MIN_VIEW_WIDTH = 420;
const MAX_VIEW_WIDTH = WORLD_WIDTH;
const ZOOM_ENTER_VIEW_WIDTH = 600;
const ZOOM_ENTER_DELTA_REQUIRED = 180;
const ZOOM_BACK_VIEW_WIDTH = 1450;
const ZOOM_BACK_DELTA_REQUIRED = 260;
const WHEEL_GESTURE_IDLE_MS = 420;
const ZOOM_NAVIGATION_COOLDOWN_MS = 720;

export function renderMapPage(state) {
  const showExplorationPanel = state.currentMode !== "review";
  const settings = showExplorationPanel ? ensureMapSettings(state) : null;
  const sidePanelOpen = showExplorationPanel && (state.exploration.panelOpen || settings.open);
  if (!state.starMap) {
    return `
      <main class="main-layout empty-map-layout">
        <section class="map-workspace ${sidePanelOpen ? "with-side-panel" : ""}">
          <section class="star-map-card empty-star-map-card">
            ${renderEmptyMapState(state)}
          </section>
          ${showExplorationPanel ? renderExplorationPanel(state) : ""}
        </section>
      </main>
    `;
  }

  return `
    <main class="main-layout">
      <section class="map-workspace ${sidePanelOpen ? "with-side-panel" : ""}">
        <section class="star-map-card">
          ${renderStarMap(state)}
        </section>
        ${showExplorationPanel && !settings.open ? renderExplorationPanel(state) : ""}
        ${showExplorationPanel ? renderMapSettingsPanel(state) : ""}
      </section>

      ${state.pendingMapFeedback?.mapId === state.activeMapId ? `<div class="map-feedback-toast">${escapeHtml(state.pendingMapFeedback.message)}</div>` : ""}
      ${renderBottomEditor(state)}
    </main>
  `;
}

export function bindMapPageEvents(state, renderApp) {
  if (state.pendingMapFeedback?.mapId === state.activeMapId && !state.pendingFeedbackTimer) {
    state.pendingFeedbackTimer = window.setTimeout(() => {
      state.pendingMapFeedback = null;
      state.pendingFeedbackTimer = null;
      renderApp();
    }, 2200);
  }
  if (state.currentMode !== "review") {
    bindExplorationPanelEvents(state, renderApp);
    bindMapSettingsPanelEvents(state, renderApp);
  }

  document.querySelector("#backButton")?.addEventListener("click", () => {
    goBack(state, renderApp);
  });

  document.querySelector("#mapSessionSelect")?.addEventListener("change", (event) => {
    setActiveMap(event.target.value);
    resetMapView(state);
    renderApp();
  });

  document.querySelector("#goAiGenerateButton")?.addEventListener("click", () => {
    state.returnContext = { sourceView: "map", mode: state.currentMode };
    setPage("ai");
    renderApp();
  });

  document.querySelector("#openMapSettingsBarButton")?.addEventListener("click", () => {
    ensureMapSettings(state).open = true;
    state.exploration.panelOpen = false;
    renderApp();
  });

  if (!state.starMap) return;

  bindMapPanEvents(state, renderApp);
  bindMapHoverEvents();

  document.querySelectorAll("[data-node-id]").forEach((element) => {
    element.addEventListener("click", () => {
      if (state.mapDrag?.moved) return;

      const node = findVisibleNode(state, element.dataset.nodeId);

      if (!node) return;

      window.clearTimeout(state.clickSelectTimer);
      state.clickSelectTimer = window.setTimeout(() => {
        state.selectedNode = node;
        state.exploration.selectedNodeId = node.id;
        renderApp();
      }, SINGLE_CLICK_DELAY);
    });

    element.addEventListener("dblclick", () => {
      if (state.mapDrag?.moved) return;

      window.clearTimeout(state.clickSelectTimer);
      const node = findVisibleNode(state, element.dataset.nodeId);

      if (!node) return;

      enterNode(state, node, renderApp);
    });
  });

  document.querySelectorAll("[data-mastery]").forEach((button) => {
    button.addEventListener("click", () => {
      const newMastery = Number(button.dataset.mastery);
      const node = state.selectedNode || state.currentNode;

      if (node.children?.length) return;

      const before = Number(node.mastery) || 0;
      if (before === newMastery) return;

      if (state.selectedNode) {
        state.selectedNode.mastery = newMastery;
      } else {
        state.currentNode.mastery = newMastery;
      }

      addLearningRecord(state.appData, {
        id: `manual-mastery-${Date.now().toString(36)}`,
        type: "manual_mastery_adjustment",
        mapId: state.activeMapId,
        nodeIds: [node.id],
        createdAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        summary: "用户手动调整熟练度",
        masteryChanges: [{ nodeId: node.id, before, suggested: null, accepted: newMastery, reason: "用户手动校正" }],
      });

      saveActiveSession();
      renderApp();
    });
  });

  document.querySelector("#addNodeButton")?.addEventListener("click", () => {
    addChildNode(state, renderApp);
  });

  document.querySelector("#deleteNodeButton")?.addEventListener("click", () => {
    deleteSelectedNode(state, renderApp);
  });

  document.querySelectorAll("[data-weight-slider]").forEach((slider) => {
    slider.addEventListener("input", () => {
      const newWeight = Number(slider.value);

      if (state.selectedNode) {
        state.selectedNode.weight = newWeight;
        state.selectedNode.updatedAt = new Date().toISOString();
      } else {
        state.currentNode.weight = newWeight;
        state.currentNode.updatedAt = new Date().toISOString();
      }

      saveActiveSession();
      renderApp();
    });
  });

  document.querySelectorAll("[data-node-history]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.nodeHistory;
      if (action === "all") {
        const node = state.selectedNode || state.currentNode;
        state.learningRecordFilters = { mapId: state.activeMapId, nodeId: node.id, type: "all", dateRange: "all", startDate: "", endDate: "", query: "", onlyMasteryChanges: false, onlyUnresolved: false, page: 1 };
        state.currentPage = "learning_records";
      } else if (action === "detail") {
        state.selectedLearningRecordId = button.dataset.recordId;
        state.currentPage = "learning_record_detail";
      }
      renderApp();
    });
  });
}

function findVisibleNode(state, nodeId) {
  const visibleNode = getVisibleDescendants(state.currentNode).find(
    (item) => item.id === nodeId
  );

  return visibleNode || null;
}

function renderStarLink(link) {
  const commonAttributes = `
    class="star-link depth-${link.level} ${link.isRouted ? "is-routed" : ""} ${
      link.isExplorationPath ? "is-exploration-path" : ""
    }"
    data-link-from="${link.fromId}"
    data-link-to="${link.toId}"
    data-branch-id="${link.branchId || ""}"
    data-cluster-id="${link.clusterId || ""}"
  `;

  if (link.path) {
    return `
      <path
        ${commonAttributes}
        d="${link.path}"
      ></path>
    `;
  }

  return `
    <line
      ${commonAttributes}
      x1="${link.fromAnchorX}"
      y1="${link.fromAnchorY}"
      x2="${link.toAnchorX}"
      y2="${link.toAnchorY}"
    ></line>
  `;
}

function renderMapTerrain(centerX, centerY) {
  const dots = Array.from({ length: 56 }, (_, index) => {
    const random = seededRandom(`terrain-dot-${index}`);
    const x = random() * WORLD_WIDTH;
    const y = random() * WORLD_HEIGHT;
    const radius = 0.8 + random() * 1.8;
    const opacity = 0.06 + random() * 0.08;

    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="#bfdbfe" opacity="${opacity}"></circle>`;
  }).join("");

  return `
    <g class="map-terrain" aria-hidden="true">
      <circle
        cx="${centerX}"
        cy="${centerY}"
        r="520"
        fill="rgba(59, 130, 246, 0.035)"
      ></circle>
      <circle
        cx="${centerX - 180}"
        cy="${centerY + 80}"
        r="760"
        fill="none"
        stroke="rgba(148, 163, 184, 0.05)"
        stroke-width="1"
      ></circle>
      <circle
        cx="${centerX + 220}"
        cy="${centerY - 120}"
        r="980"
        fill="none"
        stroke="rgba(96, 165, 250, 0.035)"
        stroke-width="1"
      ></circle>
      ${dots}
    </g>
  `;
}

function renderBranchAura(aura) {
  return `
    <g
      class="branch-aura ${aura.isExplorationBranch ? "is-exploration-branch" : ""} ${
        aura.isExplorationFeedback ? "is-exploration-feedback" : ""
      }"
      data-branch-id="${aura.branchId}"
      style="--aura-color: ${aura.color}; --aura-opacity: ${aura.opacity};"
    >
      <ellipse
        class="branch-aura-fill"
        cx="${aura.cx}"
        cy="${aura.cy}"
        rx="${aura.rx}"
        ry="${aura.ry}"
        transform="rotate(${aura.rotation} ${aura.cx} ${aura.cy})"
      ></ellipse>
      <ellipse
        class="branch-aura-ring"
        cx="${aura.cx}"
        cy="${aura.cy}"
        rx="${aura.rx * 0.94}"
        ry="${aura.ry * 0.9}"
        transform="rotate(${aura.rotation} ${aura.cx} ${aura.cy})"
      ></ellipse>
    </g>
  `;
}

function renderEmptyMapState(state) {
  const mapSessions = getMapSessions(state);

  return `
    <div class="empty-map-state">
      <div>
        <h1>目前还没有星图</h1>
        <p>可以从 AI 生成页创建一份新的能力星图，生成完成后会保存在当前浏览器。</p>
      </div>

      ${
        mapSessions.length
          ? `
            <label class="empty-map-picker">
              <span>切换到已有星图</span>
              <select id="mapSessionSelect">
                ${renderMapSessionOptions(state, mapSessions)}
              </select>
            </label>
          `
          : ""
      }

      <button id="goAiGenerateButton" type="button">试试生成一个</button>
    </div>
  `;
}

function renderStarMap(state) {
  const width = VIEWPORT_WIDTH;
  const height = VIEWPORT_HEIGHT;
  const centerX = WORLD_WIDTH / 2;
  const centerY = WORLD_HEIGHT / 2;
  const view = getMapView(state);
  const layout = buildVisibleLayout(state.currentNode, centerX, centerY);
  const explorationSession = state.exploration.currentSession;
  const hasActiveExploration =
    explorationSession?.status === "active" &&
    explorationSession.mapId === state.activeMapId;
  const explorationPath = hasActiveExploration
    ? buildPathToNode(state.starMap, explorationSession.nodeId)
    : [];
  const explorationPathIds = new Set(explorationPath.map((node) => node.id));
  const explorationBranchId = explorationPath[1]?.id || "";
  const explorationFeedback = state.exploration.feedback;
  const pendingMapFeedback = state.pendingMapFeedback?.mapId === state.activeMapId
    ? state.pendingMapFeedback
    : null;

  if (hasActiveExploration) {
    layout.links.forEach((link) => {
      link.isExplorationPath =
        explorationPathIds.has(link.fromId) && explorationPathIds.has(link.toId);
    });
    layout.auras.forEach((aura) => {
      aura.isExplorationBranch = aura.branchId === explorationBranchId;
    });
  }

  if (explorationFeedback?.branchId) {
    layout.auras.forEach((aura) => {
      aura.isExplorationFeedback = aura.branchId === explorationFeedback.branchId;
    });
  }
  const isEntering = state.transitionState?.type === "enter";
  const isBackingOut = state.transitionState?.type === "back";
  const isSettling = state.transitionState?.type === "settle";
  const enteringNode = state.transitionState?.node;

  const renderNodeMark = (
    node,
    x,
    y,
    radius,
    className,
    attributes = "",
    fontSize = 13,
    level = 1,
    options = {}
  ) => {
    const displayMastery = getDisplayMastery(node);
    const fill = masteryColors[displayMastery];
    const textColor =
      displayMastery === 1 || displayMastery === 4 ? "#111827" : "#F9FAFB";
    const title = options.isAggregatePreview
      ? `+${options.aggregateCount || 0}`
      : level >= 3
        ? shortenPreviewTitle(node.title)
        : shortenTitle(node.title, level === 1 ? 9 : 6);
    const showText = true;
    const titleClass = level >= 3 ? "preview-node-title" : "";

    return `
      <g class="${className} node-mark-level-${level}" ${attributes}>
        <title>${escapeHtml(node.title)}</title>
        ${
          level === 1
            ? `
              <circle
                class="primary-node-halo"
                cx="${x}"
                cy="${y}"
                r="${radius + 8}"
              ></circle>
            `
            : ""
        }
        <circle
          cx="${x}"
          cy="${y}"
          r="${radius}"
          fill="${fill}"
          stroke="${getNodeStroke(level)}"
          stroke-width="${getNodeStrokeWidth(level)}"
          fill-opacity="${getNodeFillOpacity(level)}"
        ></circle>

        ${
          showText
            ? `
              <text
                class="${titleClass}"
                x="${x}"
                y="${y}"
                text-anchor="middle"
                dominant-baseline="middle"
                fill="${level >= 3 ? "#cbd5e1" : textColor}"
                font-size="${fontSize}"
                font-weight="${level === 1 ? 800 : level === 2 ? 700 : 650}"
                pointer-events="none"
              >
                ${escapeHtml(title)}
              </text>
            `
            : ""
        }
      </g>
    `;
  };

  if (isEntering && enteringNode) {
    const selectedItem = layout.nodes.find((item) => item.node.id === enteringNode.id);
    const selectedPosition = selectedItem || { x: centerX, y: centerY };
    const selectedRadius = selectedItem?.radius || getVisibleNodeRadius(enteringNode, 1);
    const targetScale = 86 / selectedRadius;
    const terrain = renderMapTerrain(centerX, centerY);
    const branchAuras = layout.auras
      .map((aura) => renderBranchAura(aura))
      .join("");

    const fadingLinks = layout.links
      .filter((link) => link.toId !== enteringNode.id)
      .map((link) => renderStarLink(link))
      .join("");

    const fadingNodes = layout.nodes
      .filter((item) => item.node.id !== enteringNode.id)
      .map((child, index) => {
        return `
          <g class="star-node-exit" style="animation-delay: ${Math.min(index * 5, 90)}ms;">
            ${renderNodeMark(
              child.node,
              child.x,
              child.y,
              child.radius,
              "star-node-mark",
              "",
              child.fontSize,
              child.level,
              {
                isAggregatePreview: child.isAggregatePreview,
                aggregateCount: child.aggregateCount,
              }
            )}
          </g>
        `;
      })
      .join("");

    return `
      <svg
        id="starMapSvg"
        class="star-map-svg is-transitioning"
        width="${width}"
        height="${height}"
        viewBox="${view.x} ${view.y} ${view.width} ${view.height}"
      >
        <g class="map-context-exit">
          ${terrain}
          ${branchAuras}
          ${fadingLinks}
        </g>

        <g class="center-node-exit" style="--scene-center-x: ${centerX}px; --scene-center-y: ${centerY}px;">
          ${renderCenterNode(state.currentNode, centerX, centerY)}
        </g>

        <g class="orbit-nodes-exit">
          ${fadingNodes}
        </g>

        <g
          class="star-node-to-center"
          style="
            --from-x: ${selectedPosition.x}px;
            --from-y: ${selectedPosition.y}px;
            --target-scale: ${targetScale};
          "
        >
          ${renderNodeMark(enteringNode, 0, 0, selectedRadius, "star-node-mark")}
        </g>
      </svg>
    `;
  }

  const links = layout.links
    .map((link) => renderStarLink(link))
    .join("");
  const terrain = renderMapTerrain(centerX, centerY);
  const branchAuras = layout.auras
    .map((aura) => renderBranchAura(aura))
    .join("");

  const childNodes = layout.nodes
    .map((item) => {
      const isExplorationTarget =
        hasActiveExploration && item.node.id === explorationSession.nodeId;
      const isExplorationPath =
        hasActiveExploration && explorationPathIds.has(item.node.id);
      const isExplorationDim =
        hasActiveExploration &&
        explorationBranchId &&
        item.branchId !== explorationBranchId &&
        !isExplorationPath;
      const isExplorationUpdated =
        explorationFeedback?.nodeId === item.node.id;
      const isPendingFeedbackNode = pendingMapFeedback?.highlightNodeIds?.includes(item.node.id);

      return `
        <g
          class="star-node depth-${item.level} ${
            isExplorationTarget ? "is-exploration-target" : ""
          } ${isExplorationPath ? "is-exploration-path" : ""} ${
            isExplorationDim ? "is-exploration-dim" : ""
          } ${isExplorationUpdated || isPendingFeedbackNode ? "is-exploration-updated" : ""}"
          data-node-id="${item.node.id}"
          data-branch-id="${item.branchId || item.node.id}"
          data-cluster-id="${item.clusterId || ""}"
          data-path-ids="${item.pathIds.join(",")}"
        >
          ${renderNodeMark(
            item.node,
            item.x,
            item.y,
            item.radius,
            "star-node-mark",
            "",
            item.fontSize,
            item.level,
            {
              isAggregatePreview: item.isAggregatePreview,
              aggregateCount: item.aggregateCount,
            }
          )}
        </g>
      `;
    })
    .join("");

  return `
    <svg
      id="starMapSvg"
      class="star-map-svg ${isBackingOut || isSettling ? "is-transitioning" : ""}"
      width="${width}"
      height="${height}"
      viewBox="${view.x} ${view.y} ${view.width} ${view.height}"
    >
      <g
        class="map-scene ${isBackingOut ? "map-scene-back-exit" : ""} ${isSettling ? "map-scene-settle" : ""}"
        style="--scene-center-x: ${centerX}px; --scene-center-y: ${centerY}px;"
      >
        ${terrain}
        ${branchAuras}
        ${links}
        <g class="${
          hasActiveExploration && explorationPathIds.has(state.currentNode.id)
            ? "is-exploration-center-path"
            : ""
        }">
          ${renderCenterNode(state.currentNode, centerX, centerY)}
        </g>
        ${childNodes}
      </g>
    </svg>
  `;
}

function getMapView(state) {
  if (!state.mapView) {
    resetMapView(state);
  } else if (!state.mapView.width || !state.mapView.height) {
    state.mapView.width = VIEWPORT_WIDTH;
    state.mapView.height = VIEWPORT_HEIGHT;
    clampMapView(state.mapView);
  }

  return state.mapView;
}

function resetMapView(state) {
  state.mapView = {
    x: WORLD_WIDTH / 2 - VIEWPORT_WIDTH / 2,
    y: WORLD_HEIGHT / 2 - VIEWPORT_HEIGHT / 2,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
  };
}

function bindMapPanEvents(state, renderApp) {
  const svg = document.querySelector("#starMapSvg");

  if (!svg) return;

  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();

      const direction = event.deltaY < 0 ? -1 : 1;
      const wheelGesture = updateWheelGesture(state, direction);

      if (state.isTransitioning || wheelGesture.navigationCommitted) return;

      const view = getMapView(state);
      const rect = svg.getBoundingClientRect();
      const pointerRatioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const pointerRatioY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      const anchorX = view.x + pointerRatioX * view.width;
      const anchorY = view.y + pointerRatioY * view.height;
      const normalizedDelta = clamp(event.deltaY, -120, 120);
      const zoomFactor = Math.exp(normalizedDelta * 0.00135);
      const nextWidth = clamp(view.width * zoomFactor, MIN_VIEW_WIDTH, MAX_VIEW_WIDTH);
      const nextHeight = nextWidth * (VIEWPORT_HEIGHT / VIEWPORT_WIDTH);

      view.width = nextWidth;
      view.height = nextHeight;
      view.x = anchorX - pointerRatioX * nextWidth;
      view.y = anchorY - pointerRatioY * nextHeight;
      clampMapView(view);
      setSvgViewBox(svg, view);

      if (event.deltaY < 0) {
        state.zoomBackCandidate = null;
        maybeEnterNodeFromZoom(
          state,
          svg,
          anchorX,
          anchorY,
          Math.min(Math.abs(event.deltaY), 120),
          renderApp
        );
      } else {
        state.zoomEnterCandidate = null;
        maybeGoBackFromZoom(
          state,
          Math.min(Math.abs(event.deltaY), 120),
          renderApp
        );
      }
    },
    { passive: false }
  );

  svg.addEventListener("pointerdown", (event) => {
    state.mapDrag = {
      isDragging: true,
      moved: false,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    svg.setPointerCapture(event.pointerId);
  });

  svg.addEventListener("pointermove", (event) => {
    if (!state.mapDrag?.isDragging) return;

    const view = getMapView(state);
    const scaleX = view.width / svg.clientWidth;
    const scaleY = view.height / svg.clientHeight;
    const dx = (event.clientX - state.mapDrag.lastX) * scaleX;
    const dy = (event.clientY - state.mapDrag.lastY) * scaleY;

    if (Math.abs(dx) + Math.abs(dy) > 0.8) {
      state.mapDrag.moved = true;
    }

    view.x -= dx;
    view.y -= dy;
    clampMapView(view);
    state.mapDrag.lastX = event.clientX;
    state.mapDrag.lastY = event.clientY;
    setSvgViewBox(svg, view);
  });

  svg.addEventListener("pointerup", (event) => {
    if (!state.mapDrag) return;

    state.mapDrag.isDragging = false;
    svg.releasePointerCapture(event.pointerId);
    window.setTimeout(() => {
      if (state.mapDrag) {
        state.mapDrag.moved = false;
      }
    }, 80);
  });
}

function updateWheelGesture(state, direction) {
  const now = Date.now();
  const previous = state.wheelGesture;
  const isNewGesture =
    !previous ||
    previous.direction !== direction ||
    now - previous.lastEventAt > WHEEL_GESTURE_IDLE_MS;

  if (isNewGesture) {
    state.wheelGesture = {
      direction,
      lastEventAt: now,
      navigationCommitted: false,
    };
    state.zoomEnterCandidate = null;
    state.zoomBackCandidate = null;
  } else {
    previous.lastEventAt = now;
  }

  window.clearTimeout(state.wheelGestureTimer);
  state.wheelGestureTimer = window.setTimeout(() => {
    state.wheelGesture = null;
    state.zoomEnterCandidate = null;
    state.zoomBackCandidate = null;
  }, WHEEL_GESTURE_IDLE_MS);

  return state.wheelGesture;
}

function canCommitWheelNavigation(state) {
  const gesture = state.wheelGesture;

  if (!gesture || gesture.navigationCommitted) return false;

  return Date.now() - Number(state.lastZoomNavigationAt || 0) >= ZOOM_NAVIGATION_COOLDOWN_MS;
}

function commitWheelNavigation(state) {
  if (state.wheelGesture) {
    state.wheelGesture.navigationCommitted = true;
  }

  state.lastZoomNavigationAt = Date.now();
}

function maybeEnterNodeFromZoom(state, svg, worldX, worldY, delta, renderApp) {
  const view = getMapView(state);

  if (state.isTransitioning || view.width > ZOOM_ENTER_VIEW_WIDTH) {
    state.zoomEnterCandidate = null;
    return;
  }

  const targetNode = findZoomEnterTarget(state, svg, worldX, worldY);

  if (!targetNode?.children?.length) {
    state.zoomEnterCandidate = null;
    return;
  }

  if (state.zoomEnterCandidate?.id === targetNode.id) {
    state.zoomEnterCandidate.progress += delta;
  } else {
    state.zoomEnterCandidate = {
      id: targetNode.id,
      progress: delta,
    };
  }

  if (
    state.zoomEnterCandidate.progress < ZOOM_ENTER_DELTA_REQUIRED ||
    !canCommitWheelNavigation(state)
  ) {
    return;
  }

  state.zoomEnterCandidate = null;
  commitWheelNavigation(state);
  enterNode(state, targetNode, renderApp);
}

function maybeGoBackFromZoom(state, delta, renderApp) {
  const view = getMapView(state);

  if (state.isTransitioning || state.path.length <= 1 || view.width < ZOOM_BACK_VIEW_WIDTH) {
    state.zoomBackCandidate = null;
    return;
  }

  const parent = state.path[state.path.length - 2];

  if (state.zoomBackCandidate?.id === parent.id) {
    state.zoomBackCandidate.progress += delta;
  } else {
    state.zoomBackCandidate = {
      id: parent.id,
      progress: delta,
    };
  }

  if (
    state.zoomBackCandidate.progress < ZOOM_BACK_DELTA_REQUIRED ||
    !canCommitWheelNavigation(state)
  ) {
    return;
  }

  state.zoomBackCandidate = null;
  commitWheelNavigation(state);
  goBack(state, renderApp);
}

function findZoomEnterTarget(state, svg, worldX, worldY) {
  const candidates = Array.from(svg.querySelectorAll(".star-node"))
    .map((element) => {
      const node = findVisibleNode(state, element.dataset.nodeId);
      const circle = element.querySelector("circle:not(.primary-node-halo)");

      if (!node?.children?.length || !circle) return null;

      const cx = Number(circle.getAttribute("cx"));
      const cy = Number(circle.getAttribute("cy"));
      const radius = Number(circle.getAttribute("r"));
      const distance = Math.hypot(worldX - cx, worldY - cy);
      const hitRadius = Math.max(radius * 3.2, 96);

      return {
        node,
        distance,
        hitRadius,
        level: Number((element.className.baseVal.match(/depth-(\d+)/) || [])[1] || 1),
      };
    })
    .filter(Boolean)
    .filter((candidate) => candidate.distance <= candidate.hitRadius)
    .sort((a, b) => a.distance - b.distance || b.level - a.level);

  if (candidates.length) return candidates[0].node;

  const aura = Array.from(svg.querySelectorAll(".branch-aura")).find((element) =>
    isPointInsideAura(element, worldX, worldY)
  );

  if (!aura?.dataset.branchId) return null;

  return findVisibleNode(state, aura.dataset.branchId);
}

function isPointInsideAura(element, worldX, worldY) {
  const ellipse = element.querySelector(".branch-aura-fill");

  if (!ellipse) return false;

  const cx = Number(ellipse.getAttribute("cx"));
  const cy = Number(ellipse.getAttribute("cy"));
  const rx = Number(ellipse.getAttribute("rx"));
  const ry = Number(ellipse.getAttribute("ry"));
  const normalized =
    ((worldX - cx) * (worldX - cx)) / (rx * rx) +
    ((worldY - cy) * (worldY - cy)) / (ry * ry);

  return normalized <= 1.05;
}

function bindMapHoverEvents() {
  const svg = document.querySelector("#starMapSvg");

  if (!svg) return;

  document.querySelectorAll(".star-node").forEach((element) => {
    element.addEventListener("mouseenter", () => {
      const branchId = element.dataset.branchId;
      const clusterId = element.dataset.clusterId;
      const pathIds = new Set((element.dataset.pathIds || "").split(",").filter(Boolean));

      if (!branchId) return;

      svg.classList.add("is-hovering-branch");

      document.querySelectorAll(".star-node").forEach((nodeElement) => {
      const isSameBranch = nodeElement.dataset.branchId === branchId;
        const isSameCluster = clusterId && nodeElement.dataset.clusterId === clusterId;
        const isPathNode = pathIds.has(nodeElement.dataset.nodeId);

        nodeElement.classList.toggle("is-branch-active", isSameBranch);
        nodeElement.classList.toggle("is-branch-dim", !isSameBranch);
        nodeElement.classList.toggle("is-cluster-active", Boolean(isSameCluster));
        nodeElement.classList.toggle(
          "is-cluster-dim",
          Boolean(clusterId && isSameBranch && !isSameCluster && !isPathNode)
        );
        nodeElement.classList.toggle("is-path-active", isPathNode);
      });

      document.querySelectorAll(".star-link").forEach((linkElement) => {
        const isSameBranch = linkElement.dataset.branchId === branchId;
        const isSameCluster = clusterId && linkElement.dataset.clusterId === clusterId;
        const isPathLink =
          pathIds.has(linkElement.dataset.linkFrom) && pathIds.has(linkElement.dataset.linkTo);

        linkElement.classList.toggle("is-branch-active", isSameBranch);
        linkElement.classList.toggle("is-branch-dim", !isSameBranch);
        linkElement.classList.toggle("is-cluster-active", Boolean(isSameCluster));
        linkElement.classList.toggle(
          "is-cluster-dim",
          Boolean(clusterId && isSameBranch && !isSameCluster && !isPathLink)
        );
        linkElement.classList.toggle("is-path-active", isPathLink);
      });

      document.querySelectorAll(".branch-aura").forEach((auraElement) => {
        const isSameBranch = auraElement.dataset.branchId === branchId;

        auraElement.classList.toggle("is-branch-active", isSameBranch);
        auraElement.classList.toggle("is-branch-dim", !isSameBranch);
      });
    });

    element.addEventListener("mouseleave", () => {
      svg.classList.remove("is-hovering-branch");
      document
        .querySelectorAll(
          ".is-branch-active, .is-branch-dim, .is-cluster-active, .is-cluster-dim, .is-path-active"
        )
        .forEach((target) => {
          target.classList.remove(
            "is-branch-active",
            "is-branch-dim",
            "is-cluster-active",
            "is-cluster-dim",
            "is-path-active"
          );
        });
    });
  });
}

function setSvgViewBox(svg, view) {
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
}

function clampMapView(view) {
  view.width = clamp(view.width, MIN_VIEW_WIDTH, MAX_VIEW_WIDTH);
  view.height = view.width * (VIEWPORT_HEIGHT / VIEWPORT_WIDTH);
  view.x = clamp(view.x, 0, Math.max(0, WORLD_WIDTH - view.width));
  view.y = clamp(view.y, 0, Math.max(0, WORLD_HEIGHT - view.height));
}

function renderCenterNode(node, centerX, centerY) {
  const displayMastery = getDisplayMastery(node);
  const fill = masteryColors[displayMastery];
  const textColor =
    displayMastery === 1 || displayMastery === 4 ? "#111827" : "#F9FAFB";

  return `
    <circle
      class="center-node-circle"
      cx="${centerX}"
      cy="${centerY}"
      r="86"
      fill="${fill}"
      stroke="#93C5FD"
      stroke-width="3"
    ></circle>

    <text
      class="center-node-title"
      x="${centerX}"
      y="${centerY}"
      text-anchor="middle"
      dominant-baseline="middle"
      fill="${textColor}"
      font-size="18"
      font-weight="800"
    >
      ${escapeHtml(node.title)}
    </text>
  `;
}

function getVisibleDescendants(root) {
  const visible = [];

  function walk(node, level) {
    if (level > VISIBLE_DESCENDANT_LEVELS) return;

    for (const child of node.children || []) {
      visible.push(child);
      walk(child, level + 1);
    }
  }

  walk(root, 1);
  return visible;
}

function buildVisibleLayout(root, centerX, centerY) {
  const nodes = [];
  const links = [];
  const bounds = {
    minX: 90,
    minY: 90,
    maxX: WORLD_WIDTH - 90,
    maxY: WORLD_HEIGHT - 90,
  };

  function addChildren(parent, parentPosition, level, parentAngle, branchId = "", pathIds = []) {
    if (level > VISIBLE_DESCENDANT_LEVELS) return;

    const allChildren = parent.children || [];
    const visibleChildren = level >= 3 ? allChildren.slice(0, 6) : allChildren;
    const overflowCount = level >= 3 ? Math.max(0, allChildren.length - visibleChildren.length) : 0;
    const children = overflowCount
      ? [
          ...visibleChildren,
          createAggregatePreviewNode(parent, level, overflowCount),
        ]
      : visibleChildren;
    if (!children.length) return;

    const angles = getBranchAngles(parent.id, children.length, level, parentAngle);
    const baseDistance = getBranchDistance(level);

    children.forEach((child, index) => {
      const random = seededRandom(`${parent.id}-${child.id}-${level}`);
      const position =
        level === 1
          ? getPrimaryNodePosition(index, children.length, child.id, centerX, centerY, bounds)
          : getChildNodePosition(
              parentPosition,
              index,
              children.length,
              level,
              parentAngle,
              child.id,
              centerX,
              centerY,
              bounds
            );
      const x = position.x;
      const y = position.y;
      const angle = Math.atan2(y - parentPosition.y, x - parentPosition.x);
      const radius = getVisibleNodeRadius(child, level);
      const fromAnchor = getNodeAnchor(
        parentPosition,
        { x, y },
        parentPosition.radius || 86,
        seededRandom(`${parent.id}-${child.id}-from`)
      );
      const toAnchor = getNodeAnchor(
        { x, y },
        parentPosition,
        radius,
        seededRandom(`${parent.id}-${child.id}-to`)
      );
      const item = {
        node: child,
        x,
        y,
        level,
        parentId: parent.id,
        branchId: level === 1 ? child.id : branchId,
        clusterId:
          level === 1
            ? ""
            : level === 2
              ? child.id
              : parentPosition.clusterId || "",
        pathIds: [...pathIds, child.id],
        branchAngle: level === 1 ? angle : parentPosition.branchAngle,
        clusterAngle: position.clusterAngle || parentPosition.clusterAngle || angle,
        radius,
        collisionRadius: getNodeCollisionRadius(radius, level),
        fontSize: getVisibleNodeFontSize(level),
        isAggregatePreview: Boolean(child.isAggregatePreview),
        aggregateCount: child.aggregateCount || 0,
      };

      nodes.push(item);
      links.push({
        fromX: parentPosition.x,
        fromY: parentPosition.y,
        toX: x,
        toY: y,
        fromAnchorX: fromAnchor.x,
        fromAnchorY: fromAnchor.y,
        toAnchorX: toAnchor.x,
        toAnchorY: toAnchor.y,
        fromId: parent.id,
        toId: child.id,
        branchId: level === 1 ? child.id : branchId,
        clusterId:
          level === 1
            ? ""
            : level === 2
              ? child.id
              : parentPosition.clusterId || "",
        level,
        angle,
      });

      if (!child.isAggregatePreview) {
        addChildren(
          child,
          {
            x,
            y,
            radius,
            branchAngle: level === 1 ? angle : parentPosition.branchAngle,
            clusterAngle:
              level === 2
                ? position.clusterAngle || angle
                : parentPosition.clusterAngle || position.clusterAngle || angle,
            clusterId:
              level === 2
                ? child.id
                : parentPosition.clusterId || "",
          },
          level + 1,
          level === 1 ? angle : parentAngle,
          level === 1 ? child.id : branchId,
          [...pathIds, child.id]
        );
      }
    });
  }

  addChildren(
    root,
    { x: centerX, y: centerY, radius: 86, branchAngle: -Math.PI / 2 },
    1,
    -Math.PI / 2,
    "",
    [root.id]
  );

  separateNearbyNodes(nodes, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
  resolveNodeCollisions(nodes, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
  refreshLinkAnchors(links, nodes, { node: root, x: centerX, y: centerY, radius: 86 });
  routeLinksAroundNodes(links, nodes, {
    node: root,
    x: centerX,
    y: centerY,
    radius: 86,
    collisionRadius: 110,
  });
  const auras = buildBranchAuras(nodes);

  return { nodes, links, auras };
}

function buildBranchAuras(nodes) {
  const groups = new Map();

  for (const item of nodes) {
    if (!item.branchId || item.isAggregatePreview) continue;

    const group = groups.get(item.branchId) || [];
    group.push(item);
    groups.set(item.branchId, group);
  }

  return Array.from(groups.entries()).map(([branchId, items]) => {
    const primary = items.find((item) => item.level === 1) || items[0];
    const padding = 92;
    const minX = Math.min(...items.map((item) => item.x - item.radius)) - padding;
    const maxX = Math.max(...items.map((item) => item.x + item.radius)) + padding;
    const minY = Math.min(...items.map((item) => item.y - item.radius)) - padding;
    const maxY = Math.max(...items.map((item) => item.y + item.radius)) + padding;
    const random = seededRandom(`${branchId}-aura`);
    const jitter = getStableOffset(`${branchId}-aura-center`, 18, 14);
    const mastery = getDisplayMastery(primary.node);
    const width = maxX - minX;
    const height = maxY - minY;

    return {
      branchId,
      cx: (minX + maxX) / 2 + jitter.x,
      cy: (minY + maxY) / 2 + jitter.y,
      rx: clamp(width / 2, 145, 430),
      ry: clamp(height / 2, 110, 340),
      rotation: (primary.branchAngle || 0) * (180 / Math.PI) + (random() - 0.5) * 16,
      color: getMasteryAuraColor(mastery),
      opacity: getMasteryAuraOpacity(mastery),
    };
  });
}

function createAggregatePreviewNode(parent, level, aggregateCount) {
  return {
    id: `${parent.id}-aggregate-${level}`,
    title: `还有 ${aggregateCount} 个节点未显示`,
    mastery: 0,
    weight: 0.5,
    children: [],
    isAggregatePreview: true,
    aggregateCount,
  };
}

function getPrimaryNodePosition(index, total, nodeId, centerX, centerY, bounds) {
  if (total === 4) {
    const goldenRatio = 1.618;
    const rectWidth = Math.min(WORLD_WIDTH * 0.34, 760);
    const rectHeight = rectWidth / goldenRatio;
    const basePositions = [
      { x: centerX - rectWidth * 0.38, y: centerY - rectHeight * 0.32 },
      { x: centerX + rectWidth * 0.38, y: centerY - rectHeight * 0.24 },
      { x: centerX - rectWidth * 0.3, y: centerY + rectHeight * 0.36 },
      { x: centerX + rectWidth * 0.28, y: centerY + rectHeight * 0.34 },
    ];
    const offset = getStableOffset(nodeId, 35, 25);
    const base = basePositions[index];

    return {
      x: clamp(base.x + offset.x, bounds.minX, bounds.maxX),
      y: clamp(base.y + offset.y, bounds.minY, bounds.maxY),
    };
  }

  const random = seededRandom(`${nodeId}-primary-layout`);
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / total + (random() - 0.5) * 0.28;
  const distance = 320 * (0.92 + random() * 0.16);

  return {
    x: clamp(centerX + Math.cos(angle) * distance, bounds.minX, bounds.maxX),
    y: clamp(centerY + Math.sin(angle) * distance, bounds.minY, bounds.maxY),
  };
}

function getChildNodePosition(
  parentPosition,
  index,
  total,
  level,
  parentAngle,
  nodeId,
  centerX,
  centerY,
  bounds
) {
  const random = seededRandom(`${nodeId}-local-cloud-${level}`);
  const angleFromCenter = Math.atan2(parentPosition.y - centerY, parentPosition.x - centerX);
  const baseOutwardAngle = Number.isFinite(parentPosition.clusterAngle)
    ? parentPosition.clusterAngle
    : Number.isFinite(parentPosition.branchAngle)
      ? parentPosition.branchAngle
      : Number.isFinite(angleFromCenter)
        ? angleFromCenter
        : parentAngle;

  if (level >= 3) {
    const dir = {
      x: Math.cos(baseOutwardAngle),
      y: Math.sin(baseOutwardAngle),
    };
    const tangent = {
      x: -dir.y,
      y: dir.x,
    };
    const maxPerRow = 3;
    const row = Math.floor(index / maxPerRow);
    const rowStart = row * maxPerRow;
    const itemsInRow = Math.min(maxPerRow, total - rowStart);
    const col = index - rowStart;
    const spreadOffset = (col - (itemsInRow - 1) / 2) * (38 + row * 10);
    const distance = 82 + row * 54 + random() * 18;
    const jitter = getStableOffset(`${nodeId}-sector-dot`, 9, 9);

    return {
      x: clamp(
        parentPosition.x + dir.x * (distance + jitter.y) + tangent.x * (spreadOffset + jitter.x),
        bounds.minX,
        bounds.maxX
      ),
      y: clamp(
        parentPosition.y + dir.y * (distance + jitter.y) + tangent.y * (spreadOffset + jitter.x),
        bounds.minY,
        bounds.maxY
      ),
      clusterAngle: baseOutwardAngle,
    };
  }

  const outwardAngle = Number.isFinite(parentPosition.branchAngle)
    ? parentPosition.branchAngle
    : Number.isFinite(angleFromCenter)
      ? angleFromCenter
      : parentAngle;
  const sectorAngle = getClusterSectorAngle(outwardAngle, index, total);
  const dir = {
    x: Math.cos(sectorAngle),
    y: Math.sin(sectorAngle),
  };
  const tangent = {
    x: -dir.y,
    y: dir.x,
  };
  const ratio = total === 1 ? 0 : index - (total - 1) / 2;
  const normalizedIndex = total === 1 ? 0 : index / (total - 1);
  const spread = 36 * ratio;
  const distanceBase = 165 + normalizedIndex * 88;
  const distance = distanceBase * (0.9 + random() * 0.24);
  const drift = getStableOffset(`${nodeId}-${level}`, 18, 14);
  const basePosition = {
    x:
      parentPosition.x +
      dir.x * distance +
      tangent.x * spread +
      drift.x,
    y:
      parentPosition.y +
      dir.y * distance +
      tangent.y * spread +
      drift.y,
  };

  if (level === 2) {
    const attractors = getBranchAttractors(parentPosition, centerX, centerY);
    const attractor = attractors[index % attractors.length];
    const attractStrength = Math.min(0.48, 0.22 + normalizedIndex * 0.22 + Math.max(0, total - 4) * 0.025);

    return {
      x: clamp(
        mix(basePosition.x, attractor.x, attractStrength),
        bounds.minX,
        bounds.maxX
      ),
      y: clamp(
        mix(basePosition.y, attractor.y, attractStrength),
        bounds.minY,
        bounds.maxY
      ),
      clusterAngle: sectorAngle,
    };
  }

  return {
    x: clamp(basePosition.x, bounds.minX, bounds.maxX),
    y: clamp(basePosition.y, bounds.minY, bounds.maxY),
    clusterAngle: sectorAngle,
  };
}

function getClusterSectorAngle(centerAngle, index, total) {
  if (total <= 1) return centerAngle;

  const gap = 0.18;
  const maxFan = Math.min(2.2, 0.86 + total * 0.22);
  const usableFan = Math.max(0.4, maxFan - gap);
  const ratio = index / (total - 1) - 0.5;

  return centerAngle + ratio * usableFan;
}

function getBranchAttractors(parentPosition, centerX, centerY) {
  const rectWidth = Math.min(WORLD_WIDTH * 0.42, 980);
  const rectHeight = rectWidth / 1.618;
  const left = centerX - rectWidth * 0.5;
  const right = centerX + rectWidth * 0.5;
  const top = centerY - rectHeight * 0.5;
  const bottom = centerY + rectHeight * 0.5;
  const signX = parentPosition.x < centerX ? -1 : 1;
  const signY = parentPosition.y < centerY ? -1 : 1;
  const corner = {
    x: signX < 0 ? left : right,
    y: signY < 0 ? top : bottom,
  };
  const horizontalMid = {
    x: centerX + signX * rectWidth * 0.18,
    y: signY < 0 ? top : bottom,
  };
  const verticalMid = {
    x: signX < 0 ? left : right,
    y: centerY + signY * rectHeight * 0.14,
  };
  const outerPocket = {
    x: centerX + signX * rectWidth * 0.42,
    y: centerY + signY * rectHeight * 0.08,
  };

  return [corner, horizontalMid, verticalMid, outerPocket];
}

function getBranchAngles(seed, count, level, parentAngle) {
  const random = seededRandom(`${seed}-branch-${level}`);

  if (level === 1) {
    const start = -Math.PI + random() * 0.32;
    const fullCircle = Math.PI * 2;

    return Array.from({ length: count }, (_, index) => {
      const base = start + (fullCircle * index) / count;
      return base + (random() - 0.5) * 0.34;
    });
  }

  const fanWidth = level === 2 ? 1.35 : 1.05;
  const usableWidth = Math.min(fanWidth + count * 0.08, 1.75);
  const start = parentAngle - usableWidth / 2;

  return Array.from({ length: count }, (_, index) => {
    const ratio = count === 1 ? 0.5 : index / (count - 1);
    const base = start + usableWidth * ratio;
    return base + (random() - 0.5) * 0.26;
  });
}

function getBranchDistance(level) {
  if (level === 1) return 315;
  if (level === 2) return 235;
  return 170;
}

function getSidePush(level) {
  if (level === 1) return 32;
  if (level === 2) return 28;
  return 18;
}

function separateNearbyNodes(nodes, minX, minY, maxX, maxY) {
  separateSecondaryClusters(nodes, minX, minY, maxX, maxY);

  const groups = new Map();

  for (const node of nodes) {
    if (node.level < 3) continue;

    const siblings = groups.get(node.parentId) || [];
    siblings.push(node);
    groups.set(node.parentId, siblings);
  }

  for (const siblings of groups.values()) {
    for (let pass = 0; pass < 10; pass += 1) {
      for (let a = 0; a < siblings.length; a += 1) {
        for (let b = a + 1; b < siblings.length; b += 1) {
          const first = siblings[a];
          const second = siblings[b];
          const minDistance = first.radius + second.radius + 18;
          const dx = second.x - first.x;
          const dy = second.y - first.y;
          const distance = Math.hypot(dx, dy) || 1;

          if (distance >= minDistance) continue;

          const push = (minDistance - distance) / 2;
          const tangentAngle = (first.clusterAngle || first.branchAngle || 0) + Math.PI / 2;
          const tx = Math.cos(tangentAngle);
          const ty = Math.sin(tangentAngle);

          first.x = clamp(first.x - tx * push, minX, maxX);
          first.y = clamp(first.y - ty * push, minY, maxY);
          second.x = clamp(second.x + tx * push, minX, maxX);
          second.y = clamp(second.y + ty * push, minY, maxY);
        }
      }
    }
  }
}

function separateSecondaryClusters(nodes, minX, minY, maxX, maxY) {
  const primaryGroups = new Map();

  for (const node of nodes) {
    if (node.level !== 2) continue;

    const siblings = primaryGroups.get(node.branchId) || [];
    siblings.push(node);
    primaryGroups.set(node.branchId, siblings);
  }

  for (const siblings of primaryGroups.values()) {
    separateClusterList(siblings, nodes, 34, 18, {
      minX,
      minY,
      maxX,
      maxY,
    });
  }

  separateClusterList(
    nodes.filter((node) => node.level === 2),
    nodes,
    16,
    12,
    { minX, minY, maxX, maxY }
  );
}

function separateClusterList(clusters, nodes, gap, maxPasses, bounds) {
  clusters.sort((first, second) => first.clusterAngle - second.clusterAngle);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let moved = false;

    for (let a = 0; a < clusters.length; a += 1) {
      for (let b = a + 1; b < clusters.length; b += 1) {
        const first = clusters[a];
        const second = clusters[b];
        const firstFootprint = getClusterFootprint(first, nodes);
        const secondFootprint = getClusterFootprint(second, nodes);
        const dx = secondFootprint.x - firstFootprint.x;
        const dy = secondFootprint.y - firstFootprint.y;
        const distance = Math.hypot(dx, dy) || 1;
        const minDistance = firstFootprint.radius + secondFootprint.radius + gap;

        if (distance >= minDistance) continue;

        const stableDirection = seededRandom(
          `${first.node.id}-${second.node.id}-cluster-separation`
        );
        const fallbackAngle =
          (first.clusterAngle + second.clusterAngle) / 2 +
          (stableDirection() > 0.5 ? Math.PI / 2 : -Math.PI / 2);
        const nx = distance > 1 ? dx / distance : Math.cos(fallbackAngle);
        const ny = distance > 1 ? dy / distance : Math.sin(fallbackAngle);
        const push = Math.min(42, (minDistance - distance) / 2 + 4);

        translateCluster(nodes, first.node.id, -nx * push, -ny * push, bounds);
        translateCluster(nodes, second.node.id, nx * push, ny * push, bounds);
        moved = true;
      }
    }

    if (!moved) break;
  }
}

function getClusterFootprint(secondary, nodes) {
  const members = nodes.filter((item) => item.clusterId === secondary.node.id);
  const radius = members.reduce((largest, item) => {
    const distance = Math.hypot(item.x - secondary.x, item.y - secondary.y);

    return Math.max(largest, distance + item.collisionRadius);
  }, secondary.collisionRadius);

  return {
    x: secondary.x,
    y: secondary.y,
    radius: Math.min(230, radius),
  };
}

function translateCluster(nodes, clusterId, dx, dy, bounds) {
  const members = nodes.filter((item) => item.clusterId === clusterId);

  if (!members.length) return;

  const minMemberX = Math.min(...members.map((item) => item.x - item.collisionRadius));
  const maxMemberX = Math.max(...members.map((item) => item.x + item.collisionRadius));
  const minMemberY = Math.min(...members.map((item) => item.y - item.collisionRadius));
  const maxMemberY = Math.max(...members.map((item) => item.y + item.collisionRadius));
  const safeDx = clamp(dx, bounds.minX - minMemberX, bounds.maxX - maxMemberX);
  const safeDy = clamp(dy, bounds.minY - minMemberY, bounds.maxY - maxMemberY);

  for (const member of members) {
    member.x += safeDx;
    member.y += safeDy;
  }
}

function getNodeAnchor(from, to, radius, random) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const jitter = (random() - 0.5) * 0.9;
  const anchorAngle = angle + jitter;
  const anchorDistance = radius * (0.55 + random() * 0.35);

  return {
    x: from.x + Math.cos(anchorAngle) * anchorDistance,
    y: from.y + Math.sin(anchorAngle) * anchorDistance,
  };
}

function resolveNodeCollisions(nodes, minX, minY, maxX, maxY) {
  for (let pass = 0; pass < 18; pass += 1) {
    for (let a = 0; a < nodes.length; a += 1) {
      for (let b = a + 1; b < nodes.length; b += 1) {
        const first = nodes[a];
        const second = nodes[b];

        if (
          first.clusterId &&
          second.clusterId &&
          first.clusterId !== second.clusterId
        ) {
          continue;
        }

        const minDistance = first.radius + second.radius + 26;
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const distance = Math.hypot(dx, dy) || 1;

        if (distance >= minDistance) continue;

        const push = Math.min(24, (minDistance - distance) / 2);
        const nx = dx / distance;
        const ny = dy / distance;

        if (first.level === 1 && second.level === 2) {
          translateCluster(nodes, second.node.id, nx * push * 2, ny * push * 2, {
            minX,
            minY,
            maxX,
            maxY,
          });
        } else if (second.level === 1 && first.level === 2) {
          translateCluster(nodes, first.node.id, -nx * push * 2, -ny * push * 2, {
            minX,
            minY,
            maxX,
            maxY,
          });
        } else if (first.level === 2 && second.level >= 3) {
          second.x = clamp(second.x + nx * push * 2, minX, maxX);
          second.y = clamp(second.y + ny * push * 2, minY, maxY);
        } else if (second.level === 2 && first.level >= 3) {
          first.x = clamp(first.x - nx * push * 2, minX, maxX);
          first.y = clamp(first.y - ny * push * 2, minY, maxY);
        } else {
          first.x = clamp(first.x - nx * push, minX, maxX);
          first.y = clamp(first.y - ny * push, minY, maxY);
          second.x = clamp(second.x + nx * push, minX, maxX);
          second.y = clamp(second.y + ny * push, minY, maxY);
        }
      }
    }
  }
}

function refreshLinkAnchors(links, nodes, rootItem) {
  const nodeById = new Map(nodes.map((item) => [item.node.id, item]));

  for (const link of links) {
    const toItem = nodeById.get(link.toId);
    const fromItem = nodeById.get(link.fromId) || rootItem;

    if (!toItem || !fromItem) continue;

    const fromAnchor = getNodeAnchor(
      fromItem,
      toItem,
      fromItem.radius || 86,
      seededRandom(`${fromItem.node.id}-${toItem.node.id}-from-final`)
    );
    const toAnchor = getNodeAnchor(
      toItem,
      fromItem,
      toItem.radius,
      seededRandom(`${fromItem.node.id}-${toItem.node.id}-to-final`)
    );

    link.fromX = fromItem.x;
    link.fromY = fromItem.y;
    link.toX = toItem.x;
    link.toY = toItem.y;
    link.angle = Math.atan2(toItem.y - fromItem.y, toItem.x - fromItem.x);
    link.fromAnchorX = fromAnchor.x;
    link.fromAnchorY = fromAnchor.y;
    link.toAnchorX = toAnchor.x;
    link.toAnchorY = toAnchor.y;
  }
}

function routeLinksAroundNodes(links, nodes, rootItem) {
  const nodeById = new Map(nodes.map((item) => [item.node.id, item]));
  nodeById.set(rootItem.node.id, rootItem);
  const routeNodes = [rootItem, ...nodes];

  for (const link of links) {
    const source = nodeById.get(link.fromId);
    const target = nodeById.get(link.toId);

    if (!source || !target) continue;

    const start = { x: link.fromAnchorX, y: link.fromAnchorY };
    const end = { x: link.toAnchorX, y: link.toAnchorY };
    const obstacles = findEdgeObstacles(link, routeNodes, start, end);

    link.isRouted = obstacles.length > 0;

    if (obstacles.length || link.level >= 3) {
      const control = routeEdgeAroundObstacles(link, start, end, obstacles);
      link.path = getCurvedEdgePath(start, end, control);
    } else {
      link.path = "";
    }
  }
}

function findEdgeObstacles(edge, nodes, start, end) {
  return nodes.filter((node) => {
    if (!node?.node?.id) return false;
    if (node.node.id === edge.fromId || node.node.id === edge.toId) return false;
    if (edge.branchId && node.branchId && node.branchId !== edge.branchId) {
      return doesEdgeIntersectNode(start, end, node);
    }

    return doesEdgeIntersectNode(start, end, node);
  });
}

function doesEdgeIntersectNode(start, end, node) {
  const distance = distancePointToSegment(node, start, end);

  return distance < (node.collisionRadius || node.radius || 0);
}

function distancePointToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;

  if (!lengthSq) return Math.hypot(point.x - start.x, point.y - start.y);

  const projection = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq,
    0,
    1
  );
  const closestX = start.x + projection * dx;
  const closestY = start.y + projection * dy;

  return Math.hypot(point.x - closestX, point.y - closestY);
}

function routeEdgeAroundObstacles(edge, start, end, obstacles) {
  const mid = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = {
    x: -dy / length,
    y: dx / length,
  };
  const defaultCurve = edge.level >= 3 ? 22 : edge.level === 2 ? 18 : 8;

  if (!obstacles.length) {
    const side = getStableRouteSide(edge);

    return {
      x: mid.x + normal.x * defaultCurve * side,
      y: mid.y + normal.y * defaultCurve * side,
    };
  }

  const positiveCost = getRouteSideCost(start, end, obstacles, normal, 1);
  const negativeCost = getRouteSideCost(start, end, obstacles, normal, -1);
  const side = positiveCost <= negativeCost ? 1 : -1;
  const largestObstacle = Math.max(
    ...obstacles.map((node) => node.collisionRadius || node.radius || 0)
  );
  const offset = Math.min(
    180,
    largestObstacle + 34 + obstacles.length * 18 + edge.level * 8
  );

  return {
    x: mid.x + normal.x * offset * side,
    y: mid.y + normal.y * offset * side,
  };
}

function getRouteSideCost(start, end, obstacles, normal, side) {
  const mid = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
  const probe = {
    x: mid.x + normal.x * 120 * side,
    y: mid.y + normal.y * 120 * side,
  };

  return obstacles.reduce((cost, obstacle) => {
    const distance = Math.hypot(obstacle.x - probe.x, obstacle.y - probe.y);
    return cost + 1 / Math.max(1, distance - (obstacle.collisionRadius || 0));
  }, 0);
}

function getStableRouteSide(edge) {
  const random = seededRandom(`${edge.fromId}-${edge.toId}-route-side`);

  return random() > 0.5 ? 1 : -1;
}

function getCurvedEdgePath(start, end, control) {
  return `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mix(start, end, amount) {
  return start * (1 - amount) + end * amount;
}

function getStableOffset(seed, maxX, maxY) {
  const random = seededRandom(seed);

  return {
    x: (random() - 0.5) * 2 * maxX,
    y: (random() - 0.5) * 2 * maxY,
  };
}

function seededRandom(seed) {
  let hash = 2166136261;
  const text = String(seed);

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return () => {
    hash += 0x6d2b79f5;
    let value = hash;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function getVisibleNodeRadius(node, level) {
  const baseRadius = getNodeRadius(node.weight);
  const scaleByLevel = {
    1: 0.92,
    2: 0.5,
    3: 0.34,
  };

  const minByLevel = {
    1: 34,
    2: 20,
    3: 13,
  };

  return Math.max(minByLevel[level] || 7, baseRadius * scaleByLevel[level]);
}

function getNodeCollisionRadius(radius, level) {
  const paddingByLevel = {
    1: 18,
    2: 14,
    3: 8,
  };

  return radius + (paddingByLevel[level] || 8);
}

function getVisibleNodeFontSize(level) {
  if (level === 1) return 13;
  if (level === 2) return 10;
  return 9.5;
}

function getNodeStroke(level) {
  if (level === 1) return "rgba(226, 232, 240, 0.9)";
  if (level === 2) return "rgba(203, 213, 225, 0.54)";
  return "rgba(191, 219, 254, 0.38)";
}

function getNodeStrokeWidth(level) {
  if (level === 1) return 2.1;
  if (level === 2) return 1.4;
  return 1;
}

function getNodeFillOpacity(level) {
  if (level === 1) return 0.92;
  if (level === 2) return 0.72;
  return 0.62;
}

function getMasteryAuraColor(mastery) {
  const colors = {
    0: "rgba(71, 85, 105, 1)",
    1: "rgba(203, 213, 225, 1)",
    2: "rgba(34, 197, 94, 1)",
    3: "rgba(96, 165, 250, 1)",
    4: "rgba(250, 204, 21, 1)",
  };

  return colors[mastery] || colors[0];
}

function getMasteryAuraOpacity(mastery) {
  const opacities = {
    0: 0.055,
    1: 0.075,
    2: 0.105,
    3: 0.115,
    4: 0.13,
  };

  return opacities[mastery] || opacities[0];
}

function shortenTitle(title, maxLength) {
  const text = String(title || "").trim();
  const chars = Array.from(text);

  if (chars.length <= maxLength) return text;

  return `${chars.slice(0, maxLength).join("")}...`;
}

function shortenPreviewTitle(title) {
  const text = String(title || "").trim();
  const chars = Array.from(text);

  if (chars.length <= 2) return text;

  const hasCjk = /[\u3400-\u9fff]/.test(text);
  const maxLength = hasCjk ? 2 : 5;

  if (chars.length <= maxLength) return text;

  return `${chars.slice(0, maxLength).join("")}...`;
}

function renderBottomEditor(state) {
  const node = state.selectedNode || state.currentNode;
  const explorationSession = state.exploration.currentSession;
  const hasOngoingExploration = Boolean(
    explorationSession && explorationSession.status !== "completed"
  );
  const recentRecords = getLearningRecordsByNodeId(state.appData, state.activeMapId, node.id).slice(0, 5);
  const masteryHistory = getMasteryHistoryByNodeId(state.appData, state.activeMapId, node.id).slice(0, 5);

  return `
    <section class="map-editor-bar">
      <label class="editor-control map-session-picker">
        <span>显示星图</span>
        <select id="mapSessionSelect">
          ${renderMapSessionOptions(state, getMapSessions(state))}
        </select>
      </label>

      <div class="editor-node-summary">
        <span
          class="editor-node-dot"
          style="background: ${masteryColors[getDisplayMastery(node)]};"
        ></span>
        <div>
          <span>当前节点</span>
          <strong>${escapeHtml(node.title)}</strong>
        </div>
      </div>

      <div class="editor-exploration-action">
        ${
          hasOngoingExploration
            ? `
              <div class="editor-exploration-status" aria-label="探索进行中">
                <i aria-hidden="true"></i>
                <span>探索中 · ${escapeHtml(explorationSession.nodeTitle)}</span>
              </div>
            `
            : `<button class="start-exploration-button" data-start-exploration type="button">开始探索</button>`
        }
      </div>

      <div class="editor-settings-action">
        <button id="openMapSettingsBarButton" class="map-settings-trigger" type="button">设置星图</button>
      </div>
      ${renderNodeLearningHistory(recentRecords, masteryHistory)}
    </section>
  `;
}

function renderNodeLearningHistory(records, masteryHistory) {
  if (!records.length && !masteryHistory.length) return "";
  return `<details class="editor-node-history"><summary>学习轨迹</summary><div class="node-history-content">${masteryHistory.length ? `<section><strong>熟练度变化</strong>${masteryHistory.map((item) => `<p>${new Date(item.date).toLocaleDateString("zh-CN")} · ${item.before ?? "-"} → ${item.accepted ?? "未应用"} <small>${escapeHtml(item.typeLabel)}</small></p>`).join("")}</section>` : ""}<section><strong>最近记录</strong>${records.map((record) => `<button class="node-history-record" data-node-history="detail" data-record-id="${record.id}" type="button"><span>${escapeHtml(record.typeLabel)}</span>${escapeHtml(record.summary || record.title)}</button>`).join("")}</section><button class="quiet-button" data-node-history="all" type="button">查看全部历史</button></div></details>`;
}

function getMapSessions(state) {
  return state.appData.maps;
}

function renderMapSessionOptions(state, sessions) {
  return sessions
    .map(
      (map) => `
        <option value="${map.id}" ${
          map.id === state.activeMapId ? "selected" : ""
        }>
          ${escapeHtml(map.title)}
        </option>
      `
    )
    .join("");
}

function addChildNode(state, renderApp) {
  const parent = state.selectedNode || state.currentNode;
  const title = window.prompt("新节点名称");

  if (!title?.trim()) return;

  const newNode = {
    id: createNodeId(title),
    title: title.trim(),
    mastery: 0,
    weight: 1,
    children: [],
    updatedAt: new Date().toISOString(),
  };
  ensureNodeReviewMetadata(newNode);

  parent.children = Array.isArray(parent.children) ? parent.children : [];
  parent.children.push(newNode);
  parent.updatedAt = new Date().toISOString();

  if (state.currentNode.id !== parent.id) {
    state.currentNode = parent;
    state.path = buildPathToNode(state.starMap, parent.id);
  }

  state.selectedNode = newNode;
  saveActiveSession();
  renderApp();
}

function deleteSelectedNode(state, renderApp) {
  const node = state.selectedNode || state.currentNode;

  if (!node || node.id === state.starMap.id) return;

  const parent = findParentNode(state.starMap, node.id);

  if (!parent) return;

  const confirmed = window.confirm(`删除“${node.title}”及其所有子节点？`);

  if (!confirmed) return;

  parent.children = parent.children.filter((child) => child.id !== node.id);
  parent.updatedAt = new Date().toISOString();

  if (state.currentNode.id === node.id) {
    state.path = buildPathToNode(state.starMap, parent.id);
    state.currentNode = parent;
  } else {
    state.path = buildPathToNode(state.starMap, state.currentNode.id);
  }

  state.selectedNode = parent;
  saveActiveSession();
  renderApp();
}

function findParentNode(root, nodeId) {
  const children = root.children || [];

  if (children.some((child) => child.id === nodeId)) {
    return root;
  }

  for (const child of children) {
    const parent = findParentNode(child, nodeId);

    if (parent) return parent;
  }

  return null;
}

function buildPathToNode(root, nodeId) {
  const path = [];

  function walk(node) {
    path.push(node);

    if (node.id === nodeId) return true;

    for (const child of node.children || []) {
      if (walk(child)) return true;
    }

    path.pop();
    return false;
  }

  return walk(root) ? path : [root];
}

function createNodeId(title) {
  const base = String(title || "node")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${base || "node"}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function getRenderedNodePosition(nodeId) {
  const element = Array.from(document.querySelectorAll(".star-node")).find(
    (item) => item.dataset.nodeId === nodeId
  );
  const circle = element?.querySelector("circle:not(.primary-node-halo)");

  if (!circle) return null;

  return {
    x: Number(circle.getAttribute("cx")),
    y: Number(circle.getAttribute("cy")),
  };
}

function animateMapViewToNode(state, nodeId) {
  const svg = document.querySelector("#starMapSvg");
  const position = getRenderedNodePosition(nodeId);

  if (!svg || !position || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return Promise.resolve();
  }

  const view = getMapView(state);
  const start = { ...view };
  const targetWidth = clamp(Math.max(view.width, 720), 720, VIEWPORT_WIDTH);
  const targetHeight = targetWidth * (VIEWPORT_HEIGHT / VIEWPORT_WIDTH);
  const target = {
    x: position.x - targetWidth / 2,
    y: position.y - targetHeight / 2,
    width: targetWidth,
    height: targetHeight,
  };
  clampMapView(target);

  return new Promise((resolve) => {
    const startedAt = performance.now();

    function frame(now) {
      const progress = clamp((now - startedAt) / FOCUS_TRANSITION_DURATION, 0, 1);
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      view.x = mix(start.x, target.x, eased);
      view.y = mix(start.y, target.y, eased);
      view.width = mix(start.width, target.width, eased);
      view.height = mix(start.height, target.height, eased);
      setSvgViewBox(svg, view);

      if (progress < 1) {
        window.requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }

    window.requestAnimationFrame(frame);
  });
}

function beginSettleTransition(state, token, renderApp) {
  state.transitionState = { type: "settle", token };
  renderApp();

  window.setTimeout(() => {
    if (state.transitionState?.token !== token) return;

    state.transitionState = null;
    state.isTransitioning = false;
    renderApp();
  }, SETTLE_TRANSITION_DURATION);
}

function enterNode(state, node, renderApp) {
  state.selectedNode = node;

  if (
    state.isTransitioning ||
    !node.children ||
    node.children.length === 0
  ) {
    renderApp();
    return;
  }

  state.isTransitioning = true;
  const token = `enter-${Date.now()}-${node.id}`;
  const mapId = state.activeMapId;
  state.transitionState = { type: "focus", token, node };

  animateMapViewToNode(state, node.id).then(() => {
    if (
      state.activeMapId !== mapId ||
      state.transitionState?.token !== token ||
      state.currentPage !== "map"
    ) {
      if (state.transitionState?.token === token) {
        state.transitionState = null;
        state.isTransitioning = false;
      }
      return;
    }

    state.transitionState = {
      type: "enter",
      token,
      fromNode: state.currentNode,
      node,
    };
    renderApp();

    window.setTimeout(() => {
      if (state.transitionState?.token !== token) return;

      state.currentNode = node;
      state.path = buildPathToNode(state.starMap, node.id);
      state.selectedNode = node;
      resetMapView(state);
      beginSettleTransition(state, token, renderApp);
    }, EXIT_TRANSITION_DURATION);
  });
}

function goBack(state, renderApp) {
  if (state.isTransitioning || state.path.length <= 1) return;

  const parent = state.path[state.path.length - 2];
  const token = `back-${Date.now()}-${parent.id}`;
  const mapId = state.activeMapId;
  state.isTransitioning = true;
  state.transitionState = { type: "back", token, node: parent };
  renderApp();

  window.setTimeout(() => {
    if (
      state.activeMapId !== mapId ||
      state.transitionState?.token !== token ||
      state.currentPage !== "map"
    ) {
      if (state.transitionState?.token === token) {
        state.transitionState = null;
        state.isTransitioning = false;
      }
      return;
    }

    state.path.pop();
    state.currentNode = parent;
    state.selectedNode = parent;
    resetMapView(state);
    beginSettleTransition(state, token, renderApp);
  }, BACK_TRANSITION_DURATION);
}
