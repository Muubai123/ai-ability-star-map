import { escapeHtml } from "../utils/jsonUtils.js";

export function renderExplorationPlanCard(plan, options = {}) {
  if (!plan?.goal && !plan?.tasks?.length) return "";

  const editable = Boolean(options.editable);

  return `
    <section class="exploration-card exploration-plan-card">
      <div class="exploration-card-heading">
        <strong>本次探索计划</strong>
        <span>${Number(plan.estimatedMinutes || 30)} 分钟</span>
      </div>
      <p>${escapeHtml(plan.goal || "等待明确本次目标")}</p>
      <div class="exploration-task-list">
        ${(plan.tasks || [])
          .map(
            (task) => `
              <div class="exploration-task ${task.status || "pending"}">
                <span class="exploration-task-dot"></span>
                <div>
                  <strong>${escapeHtml(task.title)}</strong>
                  <small>${getEvidenceLabel(task.evidenceType)}</small>
                </div>
                ${
                  editable
                    ? `
                      <select data-exploration-task-status="${escapeHtml(task.id)}">
                        <option value="pending" ${task.status === "pending" ? "selected" : ""}>待完成</option>
                        <option value="partial" ${task.status === "partial" ? "selected" : ""}>部分完成</option>
                        <option value="completed" ${task.status === "completed" ? "selected" : ""}>已完成</option>
                      </select>
                    `
                    : ""
                }
              </div>
            `
          )
          .join("")}
      </div>
      ${
        plan.completionCriteria?.length
          ? `
            <div class="exploration-criteria">
              <span>完成标准</span>
              <ul>${plan.completionCriteria
                .map((item) => `<li>${escapeHtml(item)}</li>`)
                .join("")}</ul>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function getEvidenceLabel(type) {
  const labels = {
    self_report: "自我报告",
    exercise: "练习证据",
    explanation: "讲解证据",
    practice: "实践证据",
  };

  return labels[type] || labels.self_report;
}

