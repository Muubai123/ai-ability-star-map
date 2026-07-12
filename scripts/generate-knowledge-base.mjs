import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// 新版知识库源：学科知识库/<学科>.md（每科一个大文件，整本教材 OCR）
// 结构：### 第X章 名称 为章，#### 第X节 名称 为节。
// 生成粒度：一章 = 一个知识条目。
const repoRoot = path.resolve(process.cwd(), "..");
const sourceRoot = path.join(repoRoot, "学科知识库");
const outputPath = path.join(process.cwd(), "src", "knowledgeBase.js");

// 每章 content 摘要上限（字符）。只用于检索打分，不追求全文，避免 OCR 噪声与 bundle 膨胀。
const CONTENT_EXCERPT_LIMIT = 1500;

function parseFrontmatter(text) {
  if (!text.startsWith("---")) {
    return { meta: {}, body: text };
  }

  const end = text.indexOf("\n---", 3);

  if (end === -1) {
    return { meta: {}, body: text };
  }

  const rawMeta = text.slice(3, end).trim();
  const body = text.slice(end + 4).trim();
  const meta = {};

  for (const line of rawMeta.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (!Number.isNaN(Number(value)) && value !== "") {
      meta[key] = Number(value);
    } else {
      meta[key] = value;
    }
  }

  return { meta, body };
}

// 去掉 HTML 注释标记（<!-- p.18 -->）、引用符/emoji 噪声与多余空白。
function cleanText(text) {
  return String(text || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\r/g, "")
    .replace(/^[>\s]*[📖📌📝]+\s*/gm, "")
    .replace(/[>]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// 去掉章/节标题里的“第X章 / 第X节 / 第 1 节”前缀，只留名称。
function stripHeadingPrefix(title) {
  return String(title || "")
    .replace(/^第\s*[一二三四五六七八九十百零〇\d]+\s*[章节]\s*/, "")
    .trim();
}

// 习题、总复习、答案类小节不算知识点，过滤掉。
function isNoiseSection(name) {
  return /^(总?习题|复习题|部分习题答案|习题答案|本章小结|小结)/.test(name);
}

function isChapterHeading(line) {
  return /^###\s+.*第[一二三四五六七八九十百零〇\d]+章/.test(line);
}

function isSectionHeading(line) {
  return /^####\s+/.test(line);
}

// 把一个学科文件的 body 拆成若干章，每章带 title、sections、正文。
function splitChapters(body, options = {}) {
  const lines = body.split(/\r?\n/);
  const chapters = [];
  let current = null;
  const seenSectionNames = new Set();

  for (const line of lines) {
    if (isChapterHeading(line)) {
      current = {
        heading: line.replace(/^###\s+/, "").trim(),
        title: stripHeadingPrefix(line.replace(/^###\s+/, "").trim()),
        sections: [],
        bodyLines: [],
        outlineOnly: Boolean(options.stopAtRepeatedSection),
      };
      chapters.push(current);
      continue;
    }

    if (!current) continue; // 章之前的卷首内容（如“## 高等数学 上册”）忽略

    if (isSectionHeading(line)) {
      const sectionName = stripHeadingPrefix(line.replace(/^####\s+/, "").trim());

      // The probability source starts with a clean table of contents, then repeats
      // OCR body headings without chapter headings. Stop at that second pass so it
      // cannot be appended to the last table-of-contents chapter.
      if (options.stopAtRepeatedSection && seenSectionNames.has(sectionName)) {
        break;
      }

      if (sectionName && !isNoiseSection(sectionName)) current.sections.push(sectionName);
      if (sectionName) seenSectionNames.add(sectionName);
    }

    current.bodyLines.push(line);
  }

  return chapters;
}

function createId(subject, chapterIndex, title) {
  return `${subject}-${String(chapterIndex).padStart(2, "0")}-${title}`
    .replace(/\s+/g, "-")
    .replace(/[\\/]/g, "-");
}

const dirEntries = await readdir(sourceRoot, { withFileTypes: true });
const files = dirEntries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

const entries = [];

for (const file of files) {
  const subject = file.name.replace(/\.md$/i, "");
  const text = await readFile(path.join(sourceRoot, file.name), "utf8");
  const { body } = parseFrontmatter(text);
  const chapters = splitChapters(body, {
    stopAtRepeatedSection: subject === "概率论与数理统计",
  });

  chapters.forEach((chapter, index) => {
    const chapterIndex = index + 1;
    const sectionList = chapter.sections;
    const excerpt = chapter.outlineOnly
      ? ""
      : cleanText(chapter.bodyLines.join("\n")).slice(0, CONTENT_EXCERPT_LIMIT);
    // outline：每节作为一个大纲项（无更细子项）。
    const outline = sectionList.map((name) => ({ title: name, items: [] }));
    // content：检索打分用。章标题 + 各节标题 + 一小段正文摘要，干净且够用。
    const content = cleanText(
      `${chapter.title}。本章小节：${sectionList.join("、")}。${excerpt}`
    );

    entries.push({
      id: createId(subject, chapterIndex, chapter.title),
      subject,
      filename: file.name,
      chapter: String(chapterIndex),
      title: chapter.title,
      weight: Number((sectionList.length / Math.max(1, chapters.length)).toFixed(3)),
      tags: sectionList.slice(0, 8),
      examShare: "",
      pointCount: String(sectionList.length),
      outline,
      content,
    });
  });
}

const output = `export const knowledgeBase = ${JSON.stringify(entries, null, 2)};\n`;

await writeFile(outputPath, output, "utf8");
console.log(
  `Generated ${entries.length} knowledge entries from ${files.length} subject file(s) at ${outputPath}`
);
