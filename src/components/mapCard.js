import { escapeHtml } from "../utils/jsonUtils.js";
import { renderMapThumbnail } from "./mapThumbnail.js";

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) : "刚刚";
}

export function renderMapCard(map, options = {}) {
  const metadata = map.metadata || {};
  const action = options.action || "open";
  const actionLabel = options.actionLabel || "打开";
  const activity = options.activity;
  return `<article class="map-library-card">
    <div class="map-card-thumbnail">${renderMapThumbnail(map)}</div>
    <div class="map-card-content">
      <p class="map-card-updated">最近更新 ${formatDate(map.updatedAt)}</p>
      <h3>${escapeHtml(map.title)}</h3>
      <p>${escapeHtml(map.description || "尚未添加描述")}</p>
      <dl class="map-metadata"><div><dt>节点</dt><dd>${metadata.totalNodes || 0}</dd></div><div><dt>熟练度</dt><dd>${metadata.masteryAverage ?? 0}/4</dd></div><div><dt>覆盖</dt><dd>${Math.round((metadata.coverage || 0) * 100)}%</dd></div></dl>
      ${activity?.count ? `<p class="map-card-learning-state">最近活动：${formatDate(activity.latest?.endedAt || activity.latest?.createdAt)}${activity.latest?.nodeSnapshots?.[0]?.title ? ` · ${escapeHtml(activity.latest.nodeSnapshots[0].title)}` : ""}<br>累计记录：${activity.count}${activity.latestChange ? ` · 最近熟练度 ${activity.latestChange.before ?? "-"} → ${activity.latestChange.accepted ?? "-"}` : ""}</p>` : ""}
      <div class="map-card-actions"><button data-map-action="${action}" data-map-id="${map.id}" type="button">${actionLabel}</button>${options.secondaryAction ? `<button class="quiet-button" data-map-action="${options.secondaryAction}" data-map-id="${map.id}" type="button">${options.secondaryActionLabel || "查看"}</button>` : ""}${options.showDelete ? `<button class="quiet-button danger-action map-card-delete" data-map-action="delete" data-map-id="${map.id}" type="button">删除</button>` : ""}${options.showMore ? `<button class="quiet-button" data-map-action="more" data-map-id="${map.id}" type="button" aria-label="更多操作">•••</button>` : ""}</div>
    </div>
  </article>`;
}
