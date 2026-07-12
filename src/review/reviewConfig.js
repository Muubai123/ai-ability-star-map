export const REVIEW_CONFIG = {
  metadataVersion: 1,
  priorityScale: 1,
  defaultKnowledgeType: "understanding",
  baseIntervalDays: {
    memory: 2,
    understanding: 7,
    problem_solving: 5,
    operation: 10,
    output: 10,
    mixed: 7,
  },
  statusThresholds: { watch: 0.35, due: 0.64, priority: 0.86 },
};

export const KNOWLEDGE_TYPES = new Set(["memory", "understanding", "problem_solving", "operation", "output", "mixed"]);
export const EVIDENCE_TYPES = new Set(["exposure", "understanding", "exercise", "independent_practice", "assisted_practice", "explanation", "transfer", "difficulty", "unresolved", "review_success", "review_partial", "review_failure"]);
