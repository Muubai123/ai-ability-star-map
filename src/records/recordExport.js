export function exportLearningRecords(records, filename = "learning-records.json") {
  const safeRecords = records.map((record) => ({
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    mapTitleSnapshot: record.mapTitle,
    ...record,
    rawRecord: undefined,
  }));
  const blob = new Blob([JSON.stringify(safeRecords, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
