import { masteryColors } from "../mapData.js";
import { getDisplayMastery } from "../utils/mapUtils.js";

export function renderMapThumbnail(map) {
  try {
    const root = map?.rootNode;
    if (!root) throw new Error("missing root");
    const primary = (root.children || []).slice(0, 5);
    const positions = primary.map((node, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(primary.length, 1);
      return { node, x: 80 + Math.cos(angle) * 48, y: 55 + Math.sin(angle) * 31 };
    });
    const lines = positions.map(({ x, y }) => `<line x1="80" y1="55" x2="${x}" y2="${y}"></line>`).join("");
    const secondary = positions.flatMap(({ node, x, y }, primaryIndex) =>
      (node.children || []).slice(0, 3).map((child, childIndex) => {
        const angle = -1.15 + childIndex * 1.15 + primaryIndex * 0.16;
        const cx = x + Math.cos(angle) * 18;
        const cy = y + Math.sin(angle) * 14;
        return `<line x1="${x}" y1="${y}" x2="${cx}" y2="${cy}"></line><circle class="thumbnail-secondary" cx="${cx}" cy="${cy}" r="3" fill="${masteryColors[getDisplayMastery(child)]}"></circle>`;
      })
    ).join("");
    const nodes = positions.map(({ node, x, y }) => `<circle cx="${x}" cy="${y}" r="7" fill="${masteryColors[getDisplayMastery(node)]}"></circle>`).join("");
    return `<svg class="map-thumbnail" viewBox="0 0 160 110" aria-label="${map.title} 缩略图"><g class="thumbnail-links">${lines}${secondary}</g><circle cx="80" cy="55" r="12" fill="${masteryColors[getDisplayMastery(root)]}"></circle>${nodes}</svg>`;
  } catch (error) {
    return `<div class="map-thumbnail map-thumbnail-fallback">星图缩略图不可用</div>`;
  }
}
