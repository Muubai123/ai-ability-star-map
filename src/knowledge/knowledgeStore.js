import { callOpenAICompatibleChat } from "../aiApi.js";
import { extractJsonFromText } from "../utils/jsonUtils.js";

const MAX_STORED_CHARS = 180000;
const MAX_SCAN_CHARS = 30000;

const scanPrompt = `你是学习资料知识库整理助手。阅读用户提供的 Markdown 学习资料，先识别它的主要学科，再生成简洁名称、摘要和 3 到 8 个检索标签。subject 只写一个最主要的学科或学习领域，尽量简短，例如“线性代数”“考研英语”“概率论与数理统计”。不要杜撰未出现的内容。只输出严格 JSON，不要 Markdown：{"subject":"","name":"","summary":"","tags":[""]}`;

function makeId() {
  return `knowledge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function fallbackKnowledgeName(filename = "") {
  const base = String(filename || "未命名资料").replace(/\.md$/i, "").trim();
  return base || "未命名资料";
}

export function createKnowledgeBaseRecord({ filename, content, scan = {} }) {
  const safeContent = String(content || "").trim().slice(0, MAX_STORED_CHARS);
  const tags = Array.isArray(scan.tags)
    ? scan.tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 8)
    : [];
  const now = new Date().toISOString();
  return {
    id: makeId(),
    subject: String(scan.subject || scan.name || "").trim() || fallbackKnowledgeName(filename),
    name: String(scan.name || "").trim() || fallbackKnowledgeName(filename),
    filename: String(filename || "资料.md"),
    content: safeContent,
    summary: String(scan.summary || "").trim(),
    tags,
    createdAt: now,
    updatedAt: now,
  };
}

export async function scanMarkdownKnowledgeBase(filename, content, options) {
  const source = String(content || "").trim();
  const rawOutput = await callOpenAICompatibleChat([
    { role: "system", content: scanPrompt },
    { role: "user", content: `文件名：${filename}\n\nMarkdown 内容：\n${source.slice(0, MAX_SCAN_CHARS)}` },
  ], options);
  try {
    const parsed = JSON.parse(extractJsonFromText(rawOutput));
    return { record: createKnowledgeBaseRecord({ filename, content: source, scan: parsed }), rawOutput, parseError: "" };
  } catch (error) {
    return { record: createKnowledgeBaseRecord({ filename, content: source }), rawOutput, parseError: `资料扫描结果无法解析：${error.message}` };
  }
}
