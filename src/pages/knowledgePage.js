import { deleteKnowledgeBase } from "../appData.js";
import { escapeHtml } from "../utils/jsonUtils.js";

export function renderKnowledgePage(state) {
  const query = state.knowledge.query.trim().toLowerCase();
  const entries = (state.appData.knowledgeBases || []).filter((item) => [item.name, item.filename, item.summary, ...(item.tags || []), item.content].join(" ").toLowerCase().includes(query));
  const selected = entries.find((item) => item.id === state.knowledge.selectedId) || entries[0] || null;
  if (selected) state.knowledge.selectedId = selected.id;
  return `<main class="knowledge-page"><section class="knowledge-layout"><aside class="knowledge-sidebar"><div class="panel-heading"><h2>知识库</h2></div><label class="knowledge-search"><span>搜索</span><input id="knowledgeSearch" type="search" value="${escapeHtml(state.knowledge.query)}" placeholder="搜索资料名称、标签或正文"></label><div class="knowledge-count">${entries.length} / ${(state.appData.knowledgeBases || []).length} 份本地资料</div><div class="chapter-list">${entries.map((item) => `<button class="chapter-button ${selected?.id === item.id ? "active" : ""}" data-knowledge-id="${escapeHtml(item.id)}" type="button"><span>${escapeHtml(item.filename || "Markdown")}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml((item.tags || []).join(" · ") || "未标注")}</small></button>`).join("") || "<p class=\"knowledge-library-empty\">暂无本地知识库。</p>"}</div></aside><article class="knowledge-reader">${selected ? `<header class="knowledge-header"><div><span>${escapeHtml(selected.filename || "本地 Markdown")}</span><h1>${escapeHtml(selected.name)}</h1></div><button data-delete-knowledge-page="${escapeHtml(selected.id)}" type="button">删除资料</button></header>${selected.summary ? `<p class="knowledge-document-summary">${escapeHtml(selected.summary)}</p>` : ""}<div class="knowledge-tags">${(selected.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div><section class="markdown-body"><pre>${escapeHtml(selected.content)}</pre></section>` : `<div class="knowledge-empty">上传 Markdown 资料后，它们会显示在这里并参与 AI 星图生成。</div>`}</article></section></main>`;
}

export function bindKnowledgePageEvents(state, renderApp) {
  document.querySelector("#knowledgeSearch")?.addEventListener("input", (event) => { state.knowledge.query = event.target.value; state.knowledge.selectedId = ""; renderApp(); });
  document.querySelectorAll("[data-knowledge-id]").forEach((button) => button.addEventListener("click", () => { state.knowledge.selectedId = button.dataset.knowledgeId; renderApp(); }));
  document.querySelector("[data-delete-knowledge-page]")?.addEventListener("click", (event) => { deleteKnowledgeBase(state.appData, event.currentTarget.dataset.deleteKnowledgePage); state.knowledge.selectedId = ""; renderApp(); });
}
