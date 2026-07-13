import { callOpenAICompatibleChat } from "../aiApi.js";
import { parseJsonFromText } from "../utils/jsonUtils.js";
import { buildNodeIndex } from "./reviewApi.js";

const prompt = `你是能力星图全局复盘分流助手。用户的总结可能同时包含多个学科。你的任务是先准确按学科整理，再匹配真实星图。
要求：
1. subjectGroups 必须覆盖用户明确提到的每个学科，每组只保留该学科的知识点或学习内容。
2. 有对应星图时，mapId 必须引用输入索引中的真实值；没有对应星图时 mapId 必须为 null，不能猜造。
3. candidateMaps 每个已匹配学科一项。extractedSummary 只能包含该学科内容，不能混入其他学科。
4. matchedTopics 要给出知识点标题、可能的真实节点 ID 和用户原话证据。
5. unmatchedTopics 罗列缺少星图或无法归属的学科。
6. 此轮只分流，不修改星图、熟练度或学习记录。
只输出严格 JSON，不要 Markdown：{"summary":"","subjectGroups":[{"subject":"","topics":[""],"mapId":null,"mapTitle":"","reason":""}],"candidateMaps":[{"mapId":"","mapTitle":"","subject":"","confidence":0.5,"reason":"","suggestedPriority":1,"matchedTopics":[{"title":"","possibleNodeIds":[],"evidence":[]}],"extractedSummary":"","extractedEvidence":[]}],"unmatchedTopics":[{"title":"","reason":""}]}`;

const REVIEW_STOP_TERMS = new Set(["学习", "复习", "能力", "星图", "计划", "基础", "知识", "内容", "目标", "练习"]);

export function buildGlobalMapIndex(maps, learningRecords = []) {
  return maps.map((map) => {
    const nodes = buildNodeIndex(map.rootNode);
    const prioritized = [...nodes.filter((node) => node.isLeaf), ...nodes.filter((node) => node.nodePath.length <= 2)].filter((node, index, list) => list.findIndex((item) => item.nodeId === node.nodeId) === index).slice(0, 48);
    const recent = learningRecords.filter((record) => record.mapId === map.id).slice(0, 2).map((record) => record.summary || record.rawInput?.slice(0, 120)).filter(Boolean).join("；");
    return { mapId: map.id, title: map.title, description: map.description || "", topLevelNodes: (map.rootNode.children || []).slice(0, 8).map((node) => ({ id: node.id, title: node.title })), searchableNodes: prioritized.map((node) => ({ id: node.nodeId, title: node.nodeTitle, path: node.nodePath, mastery: node.mastery })), recentActivitySummary: recent };
  });
}

export async function analyzeGlobalReview(rawInput, maps, learningRecords, options) {
  const indexes = buildGlobalMapIndex(maps, learningRecords);
  const rawOutput = await callOpenAICompatibleChat([{ role: "system", content: prompt }, { role: "user", content: `日期：${new Date().toLocaleDateString("zh-CN")}\n总体总结：${rawInput}\n星图索引：${JSON.stringify(indexes)}\n最近学习记录摘要：${JSON.stringify(learningRecords.slice(0, 6).map((record) => ({ mapId: record.mapId, summary: record.summary || record.rawInput?.slice(0, 160) })) )}` }], options);
  let parsed = {};
  let parseError = "";
  try { parsed = parseJsonFromText(rawOutput); } catch (error) { parseError = error.message; }
  const result = normalizeGlobalReviewResult(parsed, rawInput, indexes);

  if (parseError && !result.candidateMaps.length) {
    throw new Error(`模型返回无法解析，且未能从本地星图识别学科：${parseError}`);
  }

  return {
    ...result,
    rawOutput,
  };
}

export function normalizeGlobalReviewResult(parsed = {}, rawInput = "", indexes = []) {
  const mapIds = new Set(indexes.map((map) => map.mapId));
  const parsedGroups = (Array.isArray(parsed.subjectGroups) ? parsed.subjectGroups : [])
    .map((group) => normalizeSubjectGroup(group, mapIds))
    .filter((group) => group.subject);
  const aiCandidates = (Array.isArray(parsed.candidateMaps) ? parsed.candidateMaps : [])
    .filter((item) => mapIds.has(item?.mapId))
    .map((item) => normalizeCandidate(
      item,
      rawInput,
      parsedGroups.find((group) => group.mapId === item.mapId)
    ));

  parsedGroups.filter((group) => group.mapId && !aiCandidates.some((item) => item.mapId === group.mapId)).forEach((group) => {
    const map = indexes.find((item) => item.mapId === group.mapId);
    aiCandidates.push(normalizeCandidate({
      mapId: group.mapId,
      mapTitle: group.mapTitle || map?.title,
      subject: group.subject,
      reason: group.reason,
      matchedTopics: group.topics.map((title) => ({
        title,
        possibleNodeIds: map ? findNodeIdsForTerm(map, title) : [],
        evidence: [String(rawInput).slice(0, 180)],
      })),
    }, rawInput, group));
  });

  const localCandidates = buildLocalReviewCandidates(rawInput, indexes);
  const candidateMaps = mergeReviewCandidates(aiCandidates, localCandidates).slice(0, 8);
  const subjectGroups = [...parsedGroups];
  candidateMaps.forEach((candidate) => {
    if (subjectGroups.some((group) => group.mapId === candidate.mapId)) return;
    subjectGroups.push({
      subject: candidate.subject || candidate.mapTitle,
      topics: candidate.matchedTopics.map((topic) => topic.title).filter(Boolean),
      mapId: candidate.mapId,
      mapTitle: candidate.mapTitle,
      reason: candidate.reason,
    });
  });

  subjectGroups.forEach((group) => {
    if (group.mapId) return;
    const candidate = candidateMaps.find((item) => {
      const subject = normalizeText(item.subject || item.mapTitle);
      const groupSubject = normalizeText(group.subject);
      return subject && groupSubject && (subject.includes(groupSubject) || groupSubject.includes(subject));
    });
    if (!candidate) return;
    group.mapId = candidate.mapId;
    group.mapTitle = candidate.mapTitle;
  });

  const unmatchedTopics = dedupeUnmatchedTopics([
    ...(Array.isArray(parsed.unmatchedTopics) ? parsed.unmatchedTopics : []),
    ...subjectGroups
      .filter((group) => !group.mapId)
      .map((group) => ({
        title: formatSubjectSummary(group.subject, group.topics),
        reason: group.reason || "当前没有匹配的星图。",
      })),
  ]);

  return {
    summary: String(parsed.summary || (candidateMaps.length ? `已整理 ${subjectGroups.length} 个学科，其中 ${candidateMaps.length} 个有对应星图。` : "")).trim(),
    subjectGroups,
    candidateMaps,
    unmatchedTopics,
  };
}

export function buildLocalReviewCandidates(rawInput, indexes = []) {
  const input = normalizeText(rawInput);
  if (!input) return [];

  return indexes
    .map((map) => {
      const matchedTerms = collectMapTerms(map)
        .filter((term) => !REVIEW_STOP_TERMS.has(term) && input.includes(normalizeText(term)))
        .slice(0, 5);
      if (!matchedTerms.length) return null;

      const score = matchedTerms.reduce((total, term) => total + Math.min(5, Math.max(2, term.length)), 0);
      const topicTerms = matchedTerms.filter((term) => normalizeText(term) !== normalizeText(map.title));
      const summaryTerms = topicTerms.length ? topicTerms : matchedTerms;
      return {
        mapId: map.mapId,
        mapTitle: map.title,
        subject: map.title,
        confidence: Math.min(0.94, 0.48 + score / 30),
        reason: `在总结中识别到：${matchedTerms.join("、")}`,
        suggestedPriority: score,
        matchedTopics: summaryTerms.map((title) => ({
          title,
          possibleNodeIds: findNodeIdsForTerm(map, title),
          evidence: [String(rawInput).slice(0, 180)],
        })),
        extractedSummary: formatSubjectSummary(map.title, summaryTerms),
        extractedEvidence: [String(rawInput).slice(0, 240)],
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.suggestedPriority - a.suggestedPriority || b.confidence - a.confidence);
}

function normalizeCandidate(candidate, rawInput, subjectGroup = null) {
  const matchedTopics = (Array.isArray(candidate.matchedTopics) ? candidate.matchedTopics : [])
    .map((topic) => ({
      ...topic,
      title: String(topic?.title || "").trim(),
      possibleNodeIds: Array.isArray(topic?.possibleNodeIds) ? topic.possibleNodeIds.map(String).filter(Boolean) : [],
      evidence: Array.isArray(topic?.evidence) ? topic.evidence : [],
    }))
    .filter((topic) => topic.title);
  const subject = String(subjectGroup?.subject || candidate.subject || candidate.mapTitle || "").trim();
  const groupTopics = subjectGroup?.topics?.length
    ? subjectGroup.topics
    : matchedTopics.map((topic) => topic.title);
  return {
    ...candidate,
    subject,
    confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || 0.5)),
    suggestedPriority: Number(candidate.suggestedPriority) || 1,
    reason: String(candidate.reason || "模型识别为相关星图。").trim(),
    matchedTopics,
    extractedSummary: String(
      subjectGroup
        ? formatSubjectSummary(subject, groupTopics)
        : candidate.extractedSummary || formatSubjectSummary(subject, groupTopics) || rawInput
    ).slice(0, 240),
    extractedEvidence: Array.isArray(candidate.extractedEvidence) ? candidate.extractedEvidence : [],
  };
}

function mergeReviewCandidates(aiCandidates, localCandidates) {
  const merged = new Map(aiCandidates.map((item) => [item.mapId, item]));
  localCandidates.forEach((localCandidate) => {
    const existing = merged.get(localCandidate.mapId);
    if (!existing) {
      merged.set(localCandidate.mapId, localCandidate);
      return;
    }
    merged.set(localCandidate.mapId, {
      ...existing,
      confidence: Math.max(existing.confidence, localCandidate.confidence),
      suggestedPriority: Math.max(existing.suggestedPriority, localCandidate.suggestedPriority),
      matchedTopics: dedupeMatchedTopics([...existing.matchedTopics, ...localCandidate.matchedTopics]),
      reason: existing.reason || localCandidate.reason,
      extractedSummary: existing.extractedSummary || localCandidate.extractedSummary,
    });
  });
  return [...merged.values()].sort((a, b) => b.suggestedPriority - a.suggestedPriority || b.confidence - a.confidence);
}

function normalizeSubjectGroup(group, mapIds) {
  const mapId = mapIds.has(group?.mapId) ? group.mapId : null;
  return {
    subject: String(group?.subject || group?.mapTitle || "").trim(),
    topics: (Array.isArray(group?.topics) ? group.topics : []).map(String).map((item) => item.trim()).filter(Boolean).slice(0, 12),
    mapId,
    mapTitle: mapId ? String(group?.mapTitle || "").trim() : "",
    reason: String(group?.reason || "").trim(),
  };
}

function dedupeMatchedTopics(topics) {
  const seen = new Set();
  return topics.filter((topic) => {
    const key = normalizeText(topic?.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeUnmatchedTopics(topics) {
  const seen = new Set();
  return topics.map((topic) => ({
    title: String(topic?.title || "未归档内容").trim(),
    reason: String(topic?.reason || "当前没有匹配的星图。").trim(),
  })).filter((topic) => {
    const key = normalizeText(topic.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatSubjectSummary(subject, topics = []) {
  const normalizedSubject = String(subject || "").trim();
  const normalizedTopics = [...new Set(topics.map(String).map((item) => item.trim()).filter(Boolean))];
  if (!normalizedSubject) return normalizedTopics.join("、");
  return normalizedTopics.length ? `${normalizedSubject}：${normalizedTopics.join("、")}` : normalizedSubject;
}

function collectMapTerms(map) {
  return [...new Set([
    map.title,
    ...(map.topLevelNodes || []).map((node) => node.title),
    ...(map.searchableNodes || []).map((node) => node.title),
    ...String(map.recentActivitySummary || "").match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z][a-zA-Z0-9-]{1,}/g) || [],
  ].map((term) => String(term || "").trim()).filter((term) => term.length >= 2))];
}

function findNodeIdsForTerm(map, term) {
  return (map.searchableNodes || [])
    .filter((node) => String(node.title || "").includes(term) || term.includes(String(node.title || "")))
    .slice(0, 3)
    .map((node) => node.id);
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}
