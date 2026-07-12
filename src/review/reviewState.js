export function createReviewState() {
  return {
    status: "input",
    rawInput: "",
    analysis: null,
    assessment: null,
    followUpAnswers: [],
    growthProposals: [],
    acceptedGrowthProposalIds: [],
    rejectedGrowthProposalIds: [],
    isRequesting: false,
    error: "",
    rawOutput: "",
  };
}
