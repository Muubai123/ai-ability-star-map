import "./style.css";

const masteryColors = {
  0: "#3A3F4B", // 灰色：完全不懂
  1: "#D8DEE9", // 银白：大概知道
  2: "#4ADE80", // 绿色：知道怎么用
  3: "#60A5FA", // 蓝色：运用熟练
  4: "#FACC15", // 金色：理解并能讲出
};

const masteryLabels = {
  0: "完全不懂",
  1: "大概知道",
  2: "知道怎么用",
  3: "运用熟练",
  4: "理解并能讲出",
};

const starMap = {
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

let currentNode = starMap;
let path = [starMap];
let selectedNode = starMap;

function getNodeRadius(weight) {
  return 36 + weight * 10;
}

function calculateNodeScore(node) {
  if (!node.children || node.children.length === 0) {
    return node.mastery;
  }

  const totalWeight = node.children.reduce((sum, child) => {
    return sum + child.weight;
  }, 0);

  if (totalWeight === 0) {
    return node.mastery;
  }

  const rawScore =
    node.children.reduce((sum, child) => {
      return sum + calculateNodeScore(child) * child.weight;
    }, 0) / totalWeight;

  const touchedCount = node.children.filter((child) => {
    return calculateNodeScore(child) > 0;
  }).length;

  const coverage = touchedCount / node.children.length;

  const finalScore = rawScore * (0.75 + 0.25 * coverage);

  return finalScore;
}

function scoreToMastery(score) {
  if (score < 0.75) return 0;
  if (score < 1.5) return 1;
  if (score < 2.5) return 2;
  if (score < 3.5) return 3;
  return 4;
}

function getDisplayMastery(node) {
  const score = calculateNodeScore(node);
  return scoreToMastery(score);
}

function getDisplayScore(node) {
  return calculateNodeScore(node).toFixed(2);
}

function renderApp() {
  document.querySelector("#app").innerHTML = `
    <div class="app">
      <header class="top-bar">
        <button id="backButton" ${path.length <= 1 ? "disabled" : ""}>
          返回上一级
        </button>
        <div class="breadcrumb">${path.map((node) => node.title).join(" > ")}</div>
      </header>

      <main class="main-layout">
        <section class="star-map-card">
          ${renderStarMap()}
        </section>

        <aside class="detail-panel">
          ${renderDetailPanel()}
        </aside>
      </main>
    </div>
  `;

  document.querySelector("#backButton").addEventListener("click", goBack);

  document.querySelectorAll("[data-node-id]").forEach((element) => {
    element.addEventListener("click", () => {
      const nodeId = element.dataset.nodeId;
      const node = currentNode.children.find((child) => child.id === nodeId);

      if (!node) return;

      enterNode(node);
    });
  });

  document.querySelectorAll("[data-mastery]").forEach((button) => {
    button.addEventListener("click", () => {
      const newMastery = Number(button.dataset.mastery);

      if (selectedNode) {
        selectedNode.mastery = newMastery;
      } else {
        currentNode.mastery = newMastery;
      }

      renderApp();
    });
  });

  document.querySelectorAll("[data-weight-slider]").forEach((slider) => {
    slider.addEventListener("input", () => {
      const newWeight = Number(slider.value);

      if (selectedNode) {
        selectedNode.weight = newWeight;
      } else {
        currentNode.weight = newWeight;
      }

      renderApp();
    });
  });
}

function renderStarMap() {
  const width = 800;
  const height = 600;
  const centerX = width / 2;
  const centerY = height / 2;
  const orbitRadius = 210;
  const children = currentNode.children || [];

  const childNodes = children
    .map((child, index) => {
      const angle = (Math.PI * 2 * index) / children.length - Math.PI / 2;
      const x = centerX + Math.cos(angle) * orbitRadius;
      const y = centerY + Math.sin(angle) * orbitRadius;
      const radius = getNodeRadius(child.weight);

      const displayMastery = getDisplayMastery(child);
      const fill = masteryColors[displayMastery];
      const textColor =
        displayMastery === 1 || displayMastery === 4 ? "#111827" : "#F9FAFB";

      return `
        <g class="star-node" data-node-id="${child.id}">
          <line
            x1="${centerX}"
            y1="${centerY}"
            x2="${x}"
            y2="${y}"
            stroke="#334155"
            stroke-width="1.5"
          ></line>

          <circle
            cx="${x}"
            cy="${y}"
            r="${radius}"
            fill="${fill}"
            stroke="#E5E7EB"
            stroke-width="2"
          ></circle>

          <text
            x="${x}"
            y="${y}"
            text-anchor="middle"
            dominant-baseline="middle"
            fill="${textColor}"
            font-size="13"
            font-weight="700"
            pointer-events="none"
          >
            ${child.title}
          </text>
        </g>
      `;
    })
    .join("");

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <circle
        cx="${centerX}"
        cy="${centerY}"
        r="86"
        fill="#111827"
        stroke="#93C5FD"
        stroke-width="2"
      ></circle>

      <text
        x="${centerX}"
        y="${centerY}"
        text-anchor="middle"
        dominant-baseline="middle"
        fill="#E5E7EB"
        font-size="18"
        font-weight="800"
      >
        ${currentNode.title}
      </text>

      ${childNodes}
    </svg>
  `;
}

function renderDetailPanel() {
  const node = selectedNode || currentNode;

  const masteryButtons = [0, 1, 2, 3, 4]
    .map((level) => {
      const activeClass = node.mastery === level ? "active" : "";

      return `
        <button 
          class="mastery-button ${activeClass}" 
          data-mastery="${level}"
          style="border-color: ${masteryColors[level]};"
        >
          ${level}
        </button>
      `;
    })
    .join("");

  const hasChildren = node.children && node.children.length > 0;

  return `
    <h2>${node.title}</h2>

    <div class="detail-item">
      <span>熟练度</span>
      <strong>
        ${getDisplayMastery(node)} - ${masteryLabels[getDisplayMastery(node)]}
      </strong>
    </div>

    <div class="detail-item">
      <span>综合分数</span>
      <strong>${getDisplayScore(node)} / 4</strong>
    </div>

    ${
      hasChildren
        ? `
          <div class="mastery-control">
            <div class="control-title">熟练度由下级节点自动计算</div>
            <p class="mini-hint">
              该节点包含子节点，因此它的颜色与熟练度来自下级节点的加权汇总。
            </p>
          </div>
        `
        : `
          <div class="mastery-control">
            <div class="control-title">修改熟练度</div>
            <div class="mastery-buttons">
              ${masteryButtons}
            </div>
          </div>
        `
    }

    <div class="detail-item">
      <span>权重</span>
      <strong>${node.weight}</strong>
    </div>

    <div class="weight-control">
      <div class="control-title">调整权重</div>
      <input 
        class="weight-slider"
        type="range"
        min="0.5"
        max="4"
        step="0.5"
        value="${node.weight}"
        data-weight-slider
      />
      <div class="weight-hint">
        权重越高，节点越大，也越影响上级节点的总熟练度。
      </div>
    </div>

    <div class="detail-item">
      <span>子节点数量</span>
      <strong>${node.children?.length || 0}</strong>
    </div>

    <p class="hint">
      熟练度规则：0 灰色=完全不懂，1 银白=大概知道，
      2 绿色=知道怎么用，3 蓝色=运用熟练，4 金色=理解并能讲出。
    </p>
  `;
}

function enterNode(node) {
  selectedNode = node;

  if (!node.children || node.children.length === 0) {
    renderApp();
    return;
  }

  currentNode = node;
  path.push(node);
  selectedNode = node;
  renderApp();
}

function goBack() {
  if (path.length <= 1) return;

  path.pop();
  currentNode = path[path.length - 1];
  selectedNode = currentNode;
  renderApp();
}

renderApp();