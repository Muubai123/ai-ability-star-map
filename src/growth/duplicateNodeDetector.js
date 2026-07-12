export function normalizeNodeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s\-—_·、，。；：！？!?,.()（）【】\[\]{}]/g, "")
    .replace(/^(基础|入门|初步)/, "")
    .replace(/(基础|入门|初步)$/g, "");
}

export function collectNodes(root, path = [], items = []) {
  if (!root) return items;
  const nodePath = [...path, root];
  items.push({ node: root, path: nodePath });
  (root.children || []).forEach((child) => collectNodes(child, nodePath, items));
  return items;
}

export function findExactDuplicateNodes(root, parentNodeId, title) {
  const parent = collectNodes(root).find((item) => item.node.id === parentNodeId)?.node;
  const normalized = normalizeNodeTitle(title);
  if (!parent || !normalized) return [];
  return (parent.children || []).filter((child) => normalizeNodeTitle(child.title) === normalized);
}

export function findPossibleDuplicateNodes(root, title, limit = 5) {
  const normalized = normalizeNodeTitle(title);
  if (!normalized || normalized.length < 2) return [];
  return collectNodes(root)
    .map(({ node, path }) => ({ node, path, score: similarity(normalized, normalizeNodeTitle(node.title)) }))
    .filter((item) => item.score >= 0.52)
    .sort((first, second) => second.score - first.score)
    .slice(0, limit)
    .map(({ node, path, score }) => ({
      nodeId: node.id,
      title: node.title,
      path: path.map((item) => item.title),
      score: Number(score.toFixed(2)),
    }));
}

function similarity(first, second) {
  if (!first || !second) return 0;
  if (first === second) return 1;
  if (first.includes(second) || second.includes(first)) return 0.76;
  const firstChars = new Set(first);
  const secondChars = new Set(second);
  const common = [...firstChars].filter((char) => secondChars.has(char)).length;
  return common / Math.max(firstChars.size, secondChars.size);
}
