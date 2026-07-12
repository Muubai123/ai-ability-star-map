function text(value) { return String(value ?? "").toLocaleLowerCase(); }

export const defaultLearningRecordFilters = {
  mapId: "",
  nodeId: "",
  type: "all",
  dateRange: "all",
  startDate: "",
  endDate: "",
  query: "",
  onlyMasteryChanges: false,
  onlyUnresolved: false,
  page: 1,
};

function dateFloor(value) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; }

function isInDateRange(record, filters) {
  const date = new Date(record.endedAt || record.createdAt);
  if (Number.isNaN(date.getTime())) return true;
  if (filters.dateRange === "today") return dateFloor(date).getTime() === dateFloor(new Date()).getTime();
  if (filters.dateRange === "7d" || filters.dateRange === "30d") {
    const days = filters.dateRange === "7d" ? 7 : 30;
    return date >= new Date(Date.now() - days * 86400000);
  }
  if (filters.dateRange === "custom") {
    if (filters.startDate && date < dateFloor(filters.startDate)) return false;
    if (filters.endDate) { const end = dateFloor(filters.endDate); end.setDate(end.getDate() + 1); if (date >= end) return false; }
  }
  return true;
}

export function filterLearningRecords(records, supplied = {}) {
  const filters = { ...defaultLearningRecordFilters, ...supplied };
  const query = text(filters.query).trim();
  return records.filter((record) => {
    if (filters.mapId && record.mapId !== filters.mapId) return false;
    if (filters.nodeId && !record.nodeIds.includes(filters.nodeId)) return false;
    if (filters.type !== "all" && record.type !== filters.type) return false;
    if (filters.onlyMasteryChanges && !record.masteryChanges.length) return false;
    if (filters.onlyUnresolved && !record.remainingProblems.length) return false;
    if (!isInDateRange(record, filters)) return false;
    if (!query) return true;
    const searchable = [record.mapTitle, record.title, record.summary, record.rawInput, ...record.nodeSnapshots.flatMap((node) => [node.title, node.path.join(" ")]), ...record.remainingProblems, ...record.nextSuggestions].map(text).join(" ");
    return searchable.includes(query);
  }).sort((a, b) => new Date(b.endedAt || b.createdAt) - new Date(a.endedAt || a.createdAt));
}
