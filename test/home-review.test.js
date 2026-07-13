import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLearningActivityToNode,
  calculateReviewState,
  getReviewCandidateDebugInfo,
  getReviewCandidatesForMap,
} from "../src/review/reviewActivity.js";
import { buildReviewGroups, GLOBAL_LIMIT } from "../src/home/reviewCandidates.js";
import { addLearningRecord, deleteLearningRecord } from "../src/records/learningRecordStore.js";
import { APP_DATA_KEY, loadAppData } from "../src/appData.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-01T08:00:00.000Z");

function metadata(overrides = {}) {
  return {
    metadataVersion: 1,
    knowledgeType: "understanding",
    knowledgeTypeConfidence: 0.7,
    knowledgeTypeSource: "test",
    lastLearnedAt: null,
    lastPracticedAt: null,
    lastReviewedAt: null,
    lastMasteryChangedAt: null,
    stability: null,
    stabilityUpdatedAt: null,
    reviewStatus: "uninitialized",
    reviewPriority: 0,
    baseIntervalDays: 7,
    nextSuggestedReviewAt: null,
    practiceCount: 0,
    reviewCount: 0,
    difficultyCount: 0,
    independentSuccessCount: 0,
    assistedSuccessCount: 0,
    lastPerformance: null,
    lastReviewMethod: null,
    appliedActivityIds: [],
    ...overrides,
  };
}

function leaf(id, overrides = {}) {
  return {
    id,
    title: id,
    mastery: 2,
    weight: 1,
    children: [],
    reviewMetadata: metadata(),
    ...overrides,
  };
}

function map(id, children) {
  return {
    id,
    title: "同名星图",
    rootNode: {
      id: `${id}-root`,
      title: "根节点",
      mastery: 0,
      weight: 1,
      children,
      reviewMetadata: metadata(),
    },
  };
}

test("home candidates exclude unlearned, mastery-zero, parent, stable, and future-dated nodes", () => {
  const old = new Date(NOW - 30 * DAY).toISOString();
  const fresh = new Date(NOW - DAY).toISOString();
  const future = new Date(NOW + DAY).toISOString();
  const appData = {
    maps: [map("map-a", [
      leaf("unlearned"),
      leaf("zero", { mastery: 0, reviewMetadata: metadata({ lastLearnedAt: old }) }),
      leaf("stable", { reviewMetadata: metadata({ lastLearnedAt: fresh, stability: 0.8, stabilityUpdatedAt: fresh }) }),
      leaf("future", { reviewMetadata: metadata({ lastLearnedAt: future, stability: 0.5, stabilityUpdatedAt: future }) }),
      {
        id: "parent",
        title: "父节点",
        mastery: 3,
        weight: 2,
        reviewMetadata: metadata({ lastLearnedAt: old }),
        children: [leaf("due", { reviewMetadata: metadata({ lastLearnedAt: old, stability: 0.35, stabilityUpdatedAt: old }) })],
      },
    ])],
  };

  const candidates = getReviewCandidatesForMap(appData, "map-a", NOW);

  assert.deepEqual(candidates.map((item) => item.nodeId), ["due"]);
  assert.equal(getReviewCandidateDebugInfo(appData, "map-a", "future", NOW).exclusionReason, "invalid_or_future_activity_date");
});

test("review time takes precedence over practice and learning time", () => {
  const learned = new Date(NOW - 40 * DAY).toISOString();
  const practiced = new Date(NOW - 20 * DAY).toISOString();
  const reviewed = new Date(NOW - 2 * DAY).toISOString();
  const node = leaf("reviewed-recently", {
    reviewMetadata: metadata({
      lastLearnedAt: learned,
      lastPracticedAt: practiced,
      lastReviewedAt: reviewed,
      stability: 0.65,
      stabilityUpdatedAt: reviewed,
      practiceCount: 2,
      reviewCount: 1,
    }),
  });

  const state = calculateReviewState(node, NOW);

  assert.equal(state.baseActivityDate, reviewed);
  assert.equal(state.daysSinceBaseActivity, 2);
  assert.equal(state.reviewStatus, "stable");
});

test("manual mastery adjustment records only mastery time and never creates learning history", () => {
  const node = leaf("manual", { mastery: 3 });
  const appData = { maps: [map("map-a", [node])] };

  const result = applyLearningActivityToNode(appData, {
    mapId: "map-a",
    nodeId: "manual",
    activityType: "manual_adjustment",
    occurredAt: NOW,
    masteryBefore: 1,
    masteryAfter: 3,
    sourceRecordId: "manual-record:manual",
  });

  assert.equal(result.ok, true);
  assert.equal(node.reviewMetadata.lastMasteryChangedAt, new Date(NOW).toISOString());
  assert.equal(node.reviewMetadata.lastLearnedAt, null);
  assert.equal(node.reviewMetadata.lastPracticedAt, null);
  assert.equal(node.reviewMetadata.lastReviewedAt, null);
  assert.equal(node.reviewMetadata.practiceCount, 0);
  assert.equal(node.reviewMetadata.reviewCount, 0);
  assert.deepEqual(getReviewCandidatesForMap(appData, "map-a", NOW + 30 * DAY), []);
});

test("learning activity application is idempotent per record and node", () => {
  const node = leaf("practice");
  const appData = { maps: [map("map-a", [node])] };
  const payload = {
    mapId: "map-a",
    nodeId: "practice",
    activityType: "exploration",
    occurredAt: NOW - DAY,
    evidence: [{ type: "independent_practice", content: "独立完成一道题" }],
    sourceRecordId: "record-1:practice",
  };

  applyLearningActivityToNode(appData, payload);
  const duplicate = applyLearningActivityToNode(appData, payload);

  assert.equal(duplicate.skipped, true);
  assert.equal(node.reviewMetadata.practiceCount, 1);
  assert.equal(node.reviewMetadata.independentSuccessCount, 1);
  assert.equal(node.reviewMetadata.appliedActivityIds.length, 1);
});

test("exposure updates learning time without pretending that practice happened", () => {
  const node = leaf("exposure");
  const appData = { maps: [map("map-a", [node])] };

  applyLearningActivityToNode(appData, {
    mapId: "map-a",
    nodeId: "exposure",
    activityType: "exploration",
    occurredAt: NOW - DAY,
    evidence: [{ type: "exposure", content: "听完课程" }],
    sourceRecordId: "exposure-record:exposure",
  });

  assert.equal(node.reviewMetadata.lastLearnedAt, new Date(NOW - DAY).toISOString());
  assert.equal(node.reviewMetadata.lastPracticedAt, null);
  assert.equal(node.reviewMetadata.practiceCount, 0);
  assert.equal(calculateReviewState(node, NOW).reviewStatus, "stable");
});

test("fresh independent practice improves evidence but does not immediately trigger review", () => {
  const node = leaf("independent", {
    reviewMetadata: metadata({ knowledgeType: "problem_solving", baseIntervalDays: 5 }),
  });
  const appData = { maps: [map("map-a", [node])] };

  applyLearningActivityToNode(appData, {
    mapId: "map-a",
    nodeId: "independent",
    activityType: "exploration",
    occurredAt: NOW - DAY,
    evidence: [{ type: "independent_practice", content: "独立解题" }],
    sourceRecordId: "practice-record:independent",
  });

  assert.equal(node.reviewMetadata.lastPracticedAt, new Date(NOW - DAY).toISOString());
  assert.equal(node.reviewMetadata.independentSuccessCount, 1);
  assert.ok(node.reviewMetadata.stability > 0.3);
  assert.equal(calculateReviewState(node, NOW).reviewStatus, "stable");
});

test("memory content becomes explainable due work without becoming priority from time alone", () => {
  const old = new Date(NOW - 7 * DAY).toISOString();
  const node = leaf("memory", {
    reviewMetadata: metadata({
      knowledgeType: "memory",
      baseIntervalDays: 2,
      lastLearnedAt: old,
      lastPracticedAt: old,
      stability: 0.5,
      stabilityUpdatedAt: old,
      practiceCount: 1,
    }),
  });
  const appData = { maps: [map("map-a", [node])] };

  const [candidate] = getReviewCandidatesForMap(appData, "map-a", NOW);

  assert.ok(["watch", "due"].includes(candidate.reviewStatus));
  assert.notEqual(candidate.reviewStatus, "priority");
  assert.ok(candidate.reasonCodes.includes("past_suggested_interval"));
  assert.ok(candidate.reasonCodes.includes("memory_type"));
});

test("an unresolved problem raises priority and yields a truthful reason", () => {
  const old = new Date(NOW - 14 * DAY).toISOString();
  const node = leaf("unresolved", {
    weight: 3,
    reviewMetadata: metadata({
      lastLearnedAt: old,
      lastPracticedAt: old,
      stability: 0.28,
      stabilityUpdatedAt: old,
      practiceCount: 1,
      difficultyCount: 2,
      lastPerformance: "unresolved",
    }),
  });

  const state = calculateReviewState(node, NOW);

  assert.ok(["due", "priority"].includes(state.reviewStatus));
  assert.ok(state.reasonCodes.includes("recent_unresolved_problem"));
  assert.ok(state.reasonCodes.includes("multiple_difficulties"));
});

test("global review parent and invalid activity dates do not update nodes", () => {
  const node = leaf("global");
  const appData = { maps: [map("map-a", [node])] };

  const parent = applyLearningActivityToNode(appData, {
    mapId: "map-a",
    nodeId: "global",
    activityType: "global_review",
    occurredAt: NOW,
    sourceRecordId: "global-parent:global",
  });
  const invalid = applyLearningActivityToNode(appData, {
    mapId: "map-a",
    nodeId: "global",
    activityType: "exploration",
    occurredAt: "not-a-date",
    sourceRecordId: "invalid:global",
  });

  assert.equal(parent.skipped, true);
  assert.equal(parent.reason, "summary_record");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, "invalid_activity_date");
  assert.equal(node.reviewMetadata.lastLearnedAt, null);
});

test("deleting the only learning record removes its review activity instead of leaving a ghost candidate", () => {
  const node = leaf("deletable");
  const appData = { maps: [map("map-a", [node])], learningRecords: [] };
  const occurredAt = new Date(NOW - 30 * DAY).toISOString();
  addLearningRecord(appData, {
    id: "delete-me",
    type: "exploration",
    mapId: "map-a",
    nodeIds: ["deletable"],
    affectedNodeIds: ["deletable"],
    activityOccurredAt: occurredAt,
    createdAt: occurredAt,
    endedAt: occurredAt,
    evidence: [{ type: "exercise", content: "完成练习" }],
  });
  assert.equal(getReviewCandidatesForMap(appData, "map-a", NOW).length, 1);

  deleteLearningRecord(appData, "delete-me");

  assert.equal(node.reviewMetadata.lastLearnedAt, null);
  assert.equal(node.reviewMetadata.practiceCount, 0);
  assert.deepEqual(getReviewCandidatesForMap(appData, "map-a", NOW), []);
});

test("legacy history hydration is idempotent and never reapplies a global summary record", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  };
  const occurredAt = new Date(NOW - 10 * DAY).toISOString();
  storage.set(APP_DATA_KEY, JSON.stringify({
    schemaVersion: 3,
    activeMapId: "map-a",
    maps: [map("map-a", [leaf("hydrated", {
      reviewMetadata: metadata({
        lastLearnedAt: new Date(NOW - 100 * DAY).toISOString(),
        practiceCount: 9,
        reviewCount: 4,
        appliedActivityIds: ["stale-record:hydrated"],
      }),
    })])],
    learningRecords: [
      {
        id: "real-item",
        type: "global_review_item",
        mapId: "map-a",
        nodeIds: ["hydrated"],
        activityOccurredAt: occurredAt,
        evidence: [{ type: "review_success", content: "复盘完成" }],
      },
      {
        id: "summary-parent",
        type: "global_review",
        mapId: "map-a",
        nodeIds: ["hydrated"],
        activityOccurredAt: occurredAt,
      },
    ],
  }));

  const first = loadAppData();
  const second = loadAppData();
  const firstNode = first.maps[0].rootNode.children[0];
  const secondNode = second.maps[0].rootNode.children[0];

  assert.equal(firstNode.reviewMetadata.practiceCount, 1);
  assert.equal(firstNode.reviewMetadata.reviewCount, 1);
  assert.equal(secondNode.reviewMetadata.practiceCount, 1);
  assert.equal(secondNode.reviewMetadata.reviewCount, 1);
  assert.deepEqual(secondNode.reviewMetadata.appliedActivityIds, ["real-item:hydrated"]);
});

test("review groups stay isolated by map id and globally prefer due work over watch", () => {
  const maps = [map("map-a", []), map("map-b", []), map("map-c", []), map("map-d", [])];
  const raw = new Map([
    ["map-a", Array.from({ length: 6 }, (_, index) => ({ mapId: "map-a", nodeId: `a-${index}`, title: `A${index}`, reviewStatus: "watch", reviewPriority: 0.4 - index * 0.01 }))],
    ["map-b", Array.from({ length: 5 }, (_, index) => ({ mapId: "map-b", nodeId: `b-${index}`, title: `B${index}`, reviewStatus: "due", reviewPriority: 0.75 - index * 0.01 }))],
    ["map-c", Array.from({ length: 3 }, (_, index) => ({ mapId: "map-c", nodeId: `c-${index}`, title: `C${index}`, reviewStatus: "priority", reviewPriority: 0.95 - index * 0.01 }))],
    ["map-d", Array.from({ length: 3 }, (_, index) => ({ mapId: "map-d", nodeId: `d-${index}`, title: `D${index}`, reviewStatus: "due", reviewPriority: 0.7 - index * 0.01 }))],
  ]);
  maps.forEach((item) => {
    const records = raw.get(item.id);
    item.rootNode.children = records.map((record) => leaf(record.nodeId, {
      title: record.title,
      reviewMetadata: metadata({
        lastLearnedAt: new Date(NOW - 30 * DAY).toISOString(),
        stability: 0.3,
        stabilityUpdatedAt: new Date(NOW - 30 * DAY).toISOString(),
      }),
    }));
  });

  const result = buildReviewGroups(maps, (mapId) => raw.get(mapId), NOW);
  const displayed = result.reviewGroups.flatMap((group) => group.candidates);

  assert.ok(displayed.length <= GLOBAL_LIMIT);
  assert.equal(result.reviewGroups.filter((group) => group.mapTitle === "同名星图").length, 3);
  assert.equal(displayed.filter((item) => item.reviewStatus === "priority").length, 3);
  assert.equal(displayed.filter((item) => item.reviewStatus === "watch").length, 0);
  assert.equal(new Set(displayed.map((item) => `${item.mapId}:${item.nodeId}`)).size, displayed.length);
});
