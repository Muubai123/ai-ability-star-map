import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.get(key) || null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};

const { getGenerationRequestOptions } = await import("../src/pages/aiPage.js");
const { buildLocalReviewCandidates, normalizeGlobalReviewResult } = await import("../src/review/globalReviewApi.js");
const { buildQueueItemReviewInput } = await import("../src/pages/globalReviewWorkspacePage.js");
const { findRelevantKnowledge } = await import("../src/utils/knowledgeUtils.js");
const { parseJsonFromText } = await import("../src/utils/jsonUtils.js");
const { resolveSessionMapId } = await import("../src/state.js");

test("map expansion JSON repairs a missing comma between array objects", () => {
  const parsed = parseJsonFromText(`{
    "title": "语言学习",
    "children": [
      { "title": "词汇", "children": [] }
      { "title": "语法", "children": [] }
    ]
  }`);

  assert.deepEqual(parsed.children.map((node) => node.title), ["词汇", "语法"]);
});

test("session map binding prefers mapId and supports legacy root-node matching", () => {
  const maps = [
    { id: "map-1", rootNode: { id: "root-1" } },
    { id: "map-2", rootNode: { id: "root-2" } },
  ];

  assert.equal(resolveSessionMapId({ mapId: "map-2", map: { id: "stale-root" } }, maps), "map-2");
  assert.equal(resolveSessionMapId({ map: { id: "root-1" } }, maps), "map-1");
});

test("knowledge-free map generation uses a bounded single-pass request", () => {
  assert.deepEqual(getGenerationRequestOptions([]), {
    timeoutMs: 70000,
    disableThinking: true,
    shouldAutoExpand: false,
  });
});

test("unrelated knowledge bases are treated as insufficient instead of being sent to generation", () => {
  const matches = findRelevantKnowledge(
    { title: "线性代数", goal: "掌握矩阵" },
    [],
    {
      knowledgeBases: [{
        id: "chemistry",
        name: "有机化学",
        filename: "organic.md",
        summary: "烷烃和官能团",
        tags: ["化学"],
        content: "有机化学反应与官能团。",
      }],
    }
  );

  assert.deepEqual(matches, []);
});

test("global review keeps candidates from multiple subjects when their map terms are present", () => {
  const indexes = [
    {
      mapId: "math-map",
      title: "考研数学",
      topLevelNodes: [{ id: "calculus", title: "高等数学" }],
      searchableNodes: [{ id: "limit", title: "极限", path: ["考研数学", "高等数学", "极限"] }],
      recentActivitySummary: "",
    },
    {
      mapId: "english-map",
      title: "考研英语",
      topLevelNodes: [{ id: "reading", title: "阅读理解" }],
      searchableNodes: [{ id: "vocabulary", title: "词汇", path: ["考研英语", "阅读理解", "词汇"] }],
      recentActivitySummary: "",
    },
  ];

  const candidates = buildLocalReviewCandidates(
    "今天复习了高等数学的极限，也背了英语词汇。",
    indexes
  );

  assert.deepEqual(candidates.map((item) => item.mapId), ["math-map", "english-map"]);
  assert.match(candidates[0].extractedSummary, /考研数学/);
  assert.doesNotMatch(candidates[0].extractedSummary, /英语词汇/);
});

test("global review keeps unmatched subjects while normalizing matched subject cards", () => {
  const indexes = [{
    mapId: "math-map",
    title: "数学",
    topLevelNodes: [{ id: "calculus", title: "高等数学" }],
    searchableNodes: [{ id: "limit", title: "极限", path: ["数学", "高等数学", "极限"] }],
    recentActivitySummary: "",
  }];
  const parsed = {
    summary: "今天学习了数学和化学。",
    subjectGroups: [
      { subject: "数学", topics: ["极限"], mapId: "math-map", mapTitle: "数学" },
      { subject: "化学", topics: ["官能团"], mapId: null, reason: "没有对应星图" },
    ],
    candidateMaps: [{
      mapId: "math-map",
      mapTitle: "数学",
      matchedTopics: [{ title: "极限", possibleNodeIds: ["limit"], evidence: [] }],
    }],
    unmatchedTopics: [],
  };

  const result = normalizeGlobalReviewResult(parsed, "数学复习了极限，化学学习了官能团。", indexes);

  assert.equal(result.candidateMaps[0].extractedSummary, "数学：极限");
  assert.deepEqual(result.unmatchedTopics.map((item) => item.title), ["化学：官能团"]);
});

test("queue item review input contains only that subject summary", () => {
  const input = buildQueueItemReviewInput({
    mapTitle: "数学",
    extractedSummary: "数学：极限、导数",
    matchedTopics: [{ title: "极限" }, { title: "导数" }],
  });

  assert.equal(input, "数学：极限、导数");
});
