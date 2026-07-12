// 首页学习时间统计（纯函数层）。
// 输入统一为「已归一化的 learningRecord 视图数组」（getLearningRecords 的返回值），
// 不直接读 localStorage，方便在 Node 下单测。
//
// 计入学习日的记录类型：exploration / single_review / global_review_item / dedicated_review。
// manual_mastery_adjustment（手动校正）与 cancelled 记录不计入。

const LEARNING_TYPES = new Set([
  "exploration",
  "single_review",
  "global_review_item",
  "dedicated_review",
]);

function recordDate(record) {
  const value = record?.endedAt || record?.createdAt;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLearningRecord(record) {
  return record?.status !== "cancelled" && LEARNING_TYPES.has(record?.type);
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// 最近一次有效学习活动（已按时间倒序的第一条有效记录）。
export function getLastLearningActivity(records = []) {
  return records.find(isLearningRecord) || null;
}

// 距离上次学习的自然日天数；无记录返回 null。
export function getDaysSinceLastLearning(records = [], now = new Date()) {
  const last = getLastLearningActivity(records);
  const date = last && recordDate(last);
  if (!date) return null;
  const diff = startOfDay(now) - startOfDay(date);
  return Math.max(0, Math.round(diff / 86400000));
}

// 过去 7 天（含今天）内有学习记录的不同天数。
export function getLearningDaysLast7Days(records = [], now = new Date()) {
  const floor = startOfDay(now);
  const from = new Date(floor.getTime() - 6 * 86400000);
  const days = new Set();
  records.filter(isLearningRecord).forEach((record) => {
    const date = recordDate(record);
    if (date && date >= from) days.add(dayKey(startOfDay(date)));
  });
  return days.size;
}

// 本月（自然月）学习记录条数。
export function getLearningRecordCountThisMonth(records = [], now = new Date()) {
  return records.filter((record) => {
    if (!isLearningRecord(record)) return false;
    const date = recordDate(record);
    return date && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }).length;
}

// 连续学习天数：从今天或昨天向前，连续存在学习记录的天数。
// 今天没学但昨天学了，仍从昨天起算，避免当天尚未学习就显示中断。
export function getCurrentLearningStreak(records = [], now = new Date()) {
  const days = new Set();
  records.filter(isLearningRecord).forEach((record) => {
    const date = recordDate(record);
    if (date) days.add(dayKey(startOfDay(date)));
  });
  if (!days.size) return 0;

  const today = startOfDay(now);
  let cursor = today;
  if (!days.has(dayKey(today))) {
    const yesterday = new Date(today.getTime() - 86400000);
    if (!days.has(dayKey(yesterday))) return 0;
    cursor = yesterday;
  }
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}

// 所有有学习记录的自然日（YYYY-MM-DD，升序去重），供日历/热力等未来扩展使用。
export function getLearningDates(records = []) {
  const set = new Set();
  records.filter(isLearningRecord).forEach((record) => {
    const date = recordDate(record);
    if (date) {
      const day = startOfDay(date);
      set.add(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`);
    }
  });
  return [...set].sort();
}

// 聚合成文档第17节的学习统计对象。
export function buildLearningSummary(records = [], now = new Date()) {
  const last = getLastLearningActivity(records);
  const iso = (date) => (date ? date.toISOString() : null);
  return {
    today: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    lastLearningAt: last ? (last.endedAt || last.createdAt || null) : null,
    daysSinceLastLearning: getDaysSinceLastLearning(records, now),
    currentStreak: getCurrentLearningStreak(records, now),
    learningDaysLast7Days: getLearningDaysLast7Days(records, now),
    recordCountThisMonth: getLearningRecordCountThisMonth(records, now),
    _now: iso(now),
  };
}
