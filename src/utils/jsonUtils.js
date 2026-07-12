import { createReviewMetadata } from "../review/reviewMetadata.js";

function clampNumber(value, min, max, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

function createNodeId(title) {
  const base = String(title || "node")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  return `${base || "node"}-${suffix}`;
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function extractJsonFromText(text) {
  const content = String(text || "").trim();
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return content.slice(firstBrace, lastBrace + 1).trim();
  }

  return content;
}

export function validateAndNormalizeMap(data) {
  const usedIds = new Set();

  function normalizeNode(node) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new Error("星图 JSON 中存在无效节点。");
    }

    const title = String(node.title || "").trim();

    if (!title) {
      throw new Error("每个节点都必须有 title。");
    }

    let id = String(node.id || createNodeId(title)).trim();

    if (usedIds.has(id)) {
      id = createNodeId(title);
    }

    usedIds.add(id);

    const children = Array.isArray(node.children) ? node.children : [];
    const aiGeneratedKnowledgeType = typeof node.knowledgeType === "string";
    const normalized = {
      id,
      title,
      mastery: clampNumber(node.mastery, 0, 4, 0),
      weight: clampNumber(node.weight, 0.5, 4, 1),
      children: children.map((child) => normalizeNode(child)),
      reviewMetadata: createReviewMetadata(node, { aiGenerated: aiGeneratedKnowledgeType }),
    };

    const updatedAt = toIso(node.updatedAt);
    if (updatedAt) normalized.updatedAt = updatedAt;

    const createdAt = toIso(node.createdAt);
    if (createdAt) normalized.createdAt = createdAt;

    if (typeof node.description === "string" && node.description.trim()) {
      normalized.description = node.description.trim();
    }

    if (node.growthMetadata && typeof node.growthMetadata === "object" && !Array.isArray(node.growthMetadata)) {
      normalized.growthMetadata = structuredClone(node.growthMetadata);
    }

    if (Array.isArray(node.growthNotes)) {
      normalized.growthNotes = node.growthNotes
        .filter((item) => item && typeof item === "object" && String(item.content || "").trim())
        .slice(-30)
        .map((item) => ({
          id: String(item.id || createNodeId("note")),
          content: String(item.content).trim().slice(0, 1000),
          createdAt: toIso(item.createdAt) || new Date().toISOString(),
          source: String(item.source || "growth"),
        }));
    }

    return normalized;
  }

  const normalizedMap = normalizeNode(data);

  if (!Array.isArray(normalizedMap.children)) {
    normalizedMap.children = [];
  }

  return normalizedMap;
}
