const STOP_WORDS = new Set(["学习", "能力", "星图", "目标", "当前", "基础", "用途", "希望", "详细", "程度", "用户", "进行", "一个", "可以"]);

export function findRelevantKnowledge(summary, messages, options = {}) {
  const entries = Array.isArray(options.knowledgeBases) ? options.knowledgeBases : [];
  const limit = options.limit || 6;
  const query = buildQueryText(summary, messages);
  const tokens = extractTokens(query);
  if (!entries.length) return [];
  if (!tokens.length) return entries.slice(0, limit);

  const scored = entries.map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.entry.name).localeCompare(String(b.entry.name), "zh-CN"));
  return (scored.length ? scored.map((item) => item.entry) : entries).slice(0, limit);
}

export function buildKnowledgeContext(entries, options = {}) {
  const maxChars = options.maxChars || 8000;
  const maxDocumentChars = options.maxDocumentChars || 2600;
  if (!entries.length) return "当前没有已保存的本地知识库。请仅依据已确认需求组织星图。";

  const content = entries.map((entry, index) => {
    const tags = (entry.tags || []).join("、") || "无";
    const summary = entry.summary ? `资料摘要：${entry.summary}` : "资料摘要：未生成";
    return `【资料 ${index + 1}】${entry.name}\n文件：${entry.filename || "本地 Markdown"}\n标签：${tags}\n${summary}\n原文摘录：\n${String(entry.content || "").slice(0, maxDocumentChars)}`;
  }).join("\n\n");
  return content.length > maxChars ? `${content.slice(0, maxChars)}\n\n（知识库上下文已截断，请优先使用以上资料。）` : content;
}

function buildQueryText(summary, messages) {
  const summaryText = summary ? [summary.title, summary.goal, summary.currentLevel, summary.purpose, summary.detailLevel, summary.preferences].join(" ") : "";
  const messageText = (messages || []).filter((message) => message.role === "user").map((message) => message.content).join(" ");
  return `${summaryText} ${messageText}`;
}

function extractTokens(text) {
  const normalized = String(text || "").toLowerCase();
  const latin = normalized.match(/[a-z0-9]{2,}/g) || [];
  const chinese = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const parts = [];
  chinese.forEach((token) => {
    if (!STOP_WORDS.has(token)) parts.push(token);
    for (let size = 2; size <= Math.min(5, token.length); size += 1) {
      for (let index = 0; index <= token.length - size; index += 1) parts.push(token.slice(index, index + size));
    }
  });
  return [...new Set([...latin, ...parts])].filter((token) => token && !STOP_WORDS.has(token));
}

function scoreEntry(entry, tokens) {
  const haystack = [entry.name, entry.filename, entry.summary, ...(entry.tags || []), entry.content].join(" ").toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? (String(entry.name || "").includes(token) ? 5 : 1) : 0), 0);
}
