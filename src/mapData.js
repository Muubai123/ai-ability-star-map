export const masteryColors = {
  0: "#3A3F4B",
  1: "#D8DEE9",
  2: "#4ADE80",
  3: "#60A5FA",
  4: "#FACC15",
};

export const masteryLabels = {
  0: "完全不懂",
  1: "大概知道",
  2: "知道怎么用",
  3: "运用熟练",
  4: "理解并能讲出",
};

export const defaultStarMap = {
  id: "math-map",
  title: "数学能力星图",
  mastery: 0,
  weight: 1,
  children: [
    {
      id: "advanced-math",
      title: "高等数学",
      mastery: 1,
      weight: 3,
      children: [
        {
          id: "limit",
          title: "函数、极限、连续",
          mastery: 0,
          weight: 2,
          children: [],
        },
        {
          id: "derivative",
          title: "导数与微分",
          mastery: 2,
          weight: 3,
          children: [
            {
              id: "derivative-definition",
              title: "导数定义",
              mastery: 1,
              weight: 1,
              children: [],
            },
            {
              id: "derivative-rules",
              title: "求导法则",
              mastery: 2,
              weight: 2,
              children: [],
            },
            {
              id: "derivative-application",
              title: "导数应用",
              mastery: 0,
              weight: 3,
              children: [],
            },
          ],
        },
        {
          id: "integral",
          title: "积分",
          mastery: 0,
          weight: 3,
          children: [],
        },
      ],
    },
    {
      id: "linear-algebra",
      title: "线性代数",
      mastery: 0,
      weight: 2,
      children: [],
    },
    {
      id: "probability",
      title: "概率论",
      mastery: 0,
      weight: 2,
      children: [],
    },
  ],
};
