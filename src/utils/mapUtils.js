export function getNodeRadius(weight) {
  return 36 + weight * 10;
}

export function calculateNodeScore(node) {
  return getNodeScoreBreakdown(node).score;
}

export function scoreToMastery(score) {
  if (score < 0.75) return 0;
  if (score < 1.5) return 1;
  if (score < 2.5) return 2;
  if (score < 3.5) return 3;
  return 4;
}

export function getDisplayMastery(node) {
  const score = calculateNodeScore(node);
  return scoreToMastery(score);
}

export function getDisplayScore(node) {
  return calculateNodeScore(node).toFixed(2);
}

export function getNodeScoreBreakdown(node) {
  const children = node.children || [];

  if (!children.length) {
    const score = clampScore(node.mastery);

    return {
      score,
      rawScore: score,
      weightedAverage: score,
      coverage: 1,
      coverageFactor: 1,
      childCount: 0,
      touchedChildCount: 0,
      totalWeight: 0,
      source: "manual",
    };
  }

  const childBreakdowns = children.map((child) => ({
    node: child,
    score: getNodeScoreBreakdown(child).score,
    weight: clampWeight(child.weight),
  }));
  const totalWeight = childBreakdowns.reduce((sum, child) => {
    return sum + child.weight;
  }, 0);

  if (totalWeight === 0) {
    const score = clampScore(node.mastery);

    return {
      score,
      rawScore: score,
      weightedAverage: score,
      coverage: 0,
      coverageFactor: 0,
      childCount: children.length,
      touchedChildCount: 0,
      totalWeight,
      source: "fallback",
    };
  }

  const weightedAverage =
    childBreakdowns.reduce((sum, child) => {
      return sum + child.score * child.weight;
    }, 0) / totalWeight;
  const touchedChildCount = childBreakdowns.filter((child) => child.score > 0).length;
  const coverage = touchedChildCount / children.length;
  const coverageFactor = 0.75 + 0.25 * coverage;
  const score = weightedAverage * coverageFactor;

  return {
    score,
    rawScore: score,
    weightedAverage,
    coverage,
    coverageFactor,
    childCount: children.length,
    touchedChildCount,
    totalWeight,
    source: "children",
  };
}

function clampScore(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return 0;
  return Math.min(4, Math.max(0, number));
}

function clampWeight(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return 1;
  return Math.max(0, number);
}
