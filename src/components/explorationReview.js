import { escapeHtml } from "../utils/jsonUtils.js";

export function renderExplorationReview(review, session, isBusy) {
  if (!review) return "";

  const suggestion = review.masterySuggestion;

  return `
    <section class="exploration-review-result">
      <div class="exploration-review-summary">
        <span>AI 复盘</span>
        <p>${escapeHtml(review.summary || "本次探索已完成记录。")}</p>
      </div>

      <div class="mastery-suggestion">
        <div>
          <span>熟练度建议</span>
          <strong>${session.masteryBefore} → ${suggestion.after}</strong>
        </div>
        <label>
          <span>最终采用</span>
          <select id="reviewMasterySelect" ${isBusy ? "disabled" : ""}>
            ${[0, 1, 2, 3, 4]
              .map(
                (level) => `
                  <option value="${level}" ${level === suggestion.after ? "selected" : ""}>
                    ${level}
                  </option>
                `
              )
              .join("")}
          </select>
        </label>
        <p>${escapeHtml(suggestion.reason)}</p>
        <small>置信度 ${Math.round(Number(suggestion.confidence || 0) * 100)}%</small>
      </div>

      ${renderEvidence(review.evidence)}
      ${renderMapChanges(review.mapChanges, isBusy)}

      ${
        review.nextSuggestion
          ? `<p class="next-exploration-suggestion"><strong>下一步：</strong>${escapeHtml(
              review.nextSuggestion
            )}</p>`
          : ""
      }

      <div class="exploration-review-actions">
        <button id="acceptAllReviewButton" class="primary-action" ${isBusy ? "disabled" : ""}>接受全部</button>
        <button id="acceptSelectedReviewButton" ${isBusy ? "disabled" : ""}>应用选中项</button>
        <button id="saveReviewOnlyButton" ${isBusy ? "disabled" : ""}>仅保存记录</button>
        <button id="returnToExplorationButton" ${isBusy ? "disabled" : ""}>返回继续探索</button>
      </div>
    </section>
  `;
}

function renderEvidence(evidence) {
  if (!evidence?.length) return "";

  return `
    <div class="exploration-evidence-list">
      <span>本次证据</span>
      <ul>${evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderMapChanges(changes, isBusy) {
  if (!changes?.length) {
    return `<p class="exploration-muted">AI 未建议修改地图结构。</p>`;
  }

  return `
    <div class="review-map-changes">
      <span>地图修改建议</span>
      ${changes
        .map(
          (change) => `
            <label class="review-change-item">
              <input
                type="checkbox"
                data-review-change-id="${escapeHtml(change.id)}"
                ${change.accepted !== false ? "checked" : ""}
                ${isBusy ? "disabled" : ""}
              />
              <span>
                <strong>${getChangeLabel(change.type)}：${escapeHtml(change.title || "未命名")}</strong>
                ${change.description ? `<small>${escapeHtml(change.description)}</small>` : ""}
              </span>
            </label>
          `
        )
        .join("")}
    </div>
  `;
}

function getChangeLabel(type) {
  const labels = {
    add_child: "新增子节点",
    add_prerequisite: "记录前置知识",
    rename_node: "重命名节点",
    add_note: "补充节点说明",
  };

  return labels[type] || "地图建议";
}

