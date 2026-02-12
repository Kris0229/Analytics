const DATA_ENDPOINTS = {
  twseStocks: "./data/twse_stock_day_all.json",
  otcStocks: "./data/otc_stocks.csv",
  emergingStocks: "./data/emerging_stocks.csv",
  marketDaily: "./data/market_daily.csv",
  listedCompanies: "./data/companies_listed.csv",
  otcCompanies: "./data/companies_otc.csv",
  emergingCompanies: "./data/companies_emerging.csv",
};

const state = {
  stocks: [],
  industries: new Map(),
  markets: new Map(),
  groups: [],
  metrics: null,
  industryAgg: [],
  dataDate: "--",
  lastUpdated: "--",
  marketFilter: "all",
  groupSort: "custom",
  editingGroupId: null,
  charts: {
    industry: null,
    groups: null,
    trend: null,
  },
  autoRefresh: {
    enabled: false,
    time: "15:30",
    lastRunDate: null,
  },
};

const elements = {
  dataDate: document.querySelector("#data-date"),
  dataUpdated: document.querySelector("#data-updated"),
  totalVolume: document.querySelector("#total-volume"),
  totalVolumeNote: document.querySelector("#total-volume-note"),
  totalValue: document.querySelector("#total-value"),
  totalValueNote: document.querySelector("#total-value-note"),
  marketChange: document.querySelector("#market-change"),
  marketChangeNote: document.querySelector("#market-change-note"),
  industryTable: document.querySelector("#industry-table"),
  industrySort: document.querySelector("#industry-sort"),
  groupList: document.querySelector("#group-list"),
  groupCompare: document.querySelector("#group-compare"),
  status: document.querySelector("#status"),
  addGroup: document.querySelector("#add-group"),
  dialog: document.querySelector("#group-dialog"),
  groupForm: document.querySelector("#group-form"),
  groupName: document.querySelector("#group-name"),
  groupDialogTitle: document.querySelector("#group-dialog-title"),
  groupIndustries: document.querySelector("#group-industries"),
  groupStocks: document.querySelector("#group-stocks"),
  cancelGroup: document.querySelector("#cancel-group"),
  groupSort: document.querySelector("#group-sort"),
  marketFilter: document.querySelector("#market-filter"),
  manualRefresh: document.querySelector("#manual-refresh"),
  autoRefresh: document.querySelector("#auto-refresh"),
  autoRefreshTime: document.querySelector("#auto-refresh-time"),
  industryChart: document.querySelector("#industry-chart"),
  groupChart: document.querySelector("#group-chart"),
  download7Days: document.querySelector("#download-7days"),
  trendChart: document.querySelector("#trend-chart"),
  industryHeatmap: document.querySelector("#industry-heatmap"),
};

const formatter = new Intl.NumberFormat("zh-Hant", { maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat("zh-Hant", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  signDisplay: "exceptZero",
});

const normalizeNumber = (value) => {
  if (value == null) return 0;
  const clean = String(value).replace(/[,:\s]/g, "").trim();
  if (!clean || clean === "--") return 0;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeChange = (value) => {
  if (value == null) return 0;
  const text = String(value).trim();
  if (!text || text === "--") return 0;
  const match = text.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeDate = (value) => {
  if (!value) return "--";
  const text = String(value).trim();
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  if (/^\d{7}$/.test(text)) {
    const rocYear = Number(text.slice(0, 3));
    const year = rocYear + 1911;
    return `${year}-${text.slice(3, 5)}-${text.slice(5, 7)}`;
  }
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(text)) {
    return text.replaceAll("/", "-");
  }
  return text;
};

const INDUSTRY_CODE_MAP = {
  "01": "水泥",
  "02": "食品",
  "03": "塑膠",
  "04": "紡織纖維",
  "05": "電機機械",
  "06": "電器電纜",
  "07": "化學",
  "08": "生技醫療",
  "09": "玻璃陶瓷",
  "10": "造紙",
  "11": "鋼鐵",
  "12": "橡膠",
  "13": "汽車",
  "14": "建材營造",
  "15": "航運",
  "16": "觀光餐旅",
  "17": "金融保險",
  "18": "貿易百貨",
  "19": "綜合",
  "20": "其他",
  "21": "半導體",
  "22": "電腦及週邊",
  "23": "光電",
  "24": "通信網路",
  "25": "電子零組件",
  "26": "電子通路",
  "27": "資訊服務",
  "28": "其他電子",
};

const normalizeIndustry = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "其他";
  if (INDUSTRY_CODE_MAP[text]) return INDUSTRY_CODE_MAP[text];
  if (/^\d{2}$/.test(text)) return `代碼${text}`;
  return text;
};

const pickField = (row, keys) => {
  for (const key of keys) {
    if (row[key] != null) return row[key];
  }
  return undefined;
};

const formatVolume = (value) => `${formatter.format(value)} 股`;
const formatValue = (value) => `${formatter.format(value)} 元`;

const formatPercent = (value) => {
  if (!Number.isFinite(value)) return "--";
  return `${percentFormatter.format(value)}%`;
};

const fetchJson = async (url) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`資料請求失敗: ${response.status}`);
  }
  return response.json();
};

const fetchCsv = async (url) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`CSV 下載失敗: ${response.status}`);
  }
  return response.text();
};

const parseCsv = (text) => {
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) return [];

  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    const next = clean[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (char === "," || char === "\n")) {
      row.push(current);
      current = "";
      if (char === "\n") {
        rows.push(row);
        row = [];
      }
      continue;
    }

    if (char !== "\r") {
      current += char;
    }
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((item) => item.trim());
  return rows.slice(1).map((values) => {
    const rowData = {};
    headers.forEach((header, index) => {
      rowData[header] = values[index]?.trim();
    });
    return rowData;
  });
};

const toCsvLine = (values) =>
  values
    .map((value) => {
      const text = value == null ? "" : String(value);
      if (/[",\n]/.test(text)) {
        return `"${text.replaceAll("\"", "\"\"")}"`;
      }
      return text;
    })
    .join(",");

const downloadCsv = (rows, filename) => {
  const csv = rows.map(toCsvLine).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const HISTORY_KEY = "twse-history";
const HISTORY_LIMIT = 40;

const loadHistory = () => {
  const stored = localStorage.getItem(HISTORY_KEY);
  if (!stored) return {};
  try {
    return JSON.parse(stored);
  } catch {
    return {};
  }
};

const saveHistory = (history) => {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
};

const updateHistory = (snapshot, marketKey) => {
  const history = loadHistory();
  const list = history[marketKey] ?? [];
  const existingIndex = list.findIndex((item) => item.date === snapshot.date);
  if (existingIndex >= 0) {
    list[existingIndex] = snapshot;
  } else {
    list.push(snapshot);
  }
  list.sort((a, b) => a.date.localeCompare(b.date));
  history[marketKey] = list.slice(-HISTORY_LIMIT);
  saveHistory(history);
  return history[marketKey];
};

const buildIndustryMap = (rows, marketLabel) => {
  rows.forEach((row) => {
    const code = row["公司代號"]?.trim();
    const industry = normalizeIndustry(row["產業別"]);
    if (code && industry) {
      state.industries.set(code, industry);
      if (marketLabel) {
        state.markets.set(code, marketLabel);
      }
    }
  });
};

const extractStock = (row, market) => {
  const code = pickField(row, ["證券代號", "股票代號", "代號", "Code"]);
  const name = pickField(row, ["證券名稱", "股票名稱", "名稱", "Name"]);
  const date = pickField(row, ["日期", "Date", "資料日期"]);
  const volume = normalizeNumber(
    pickField(row, ["成交股數", "成交量", "成交股數(千股)", "TradeVolume"])
  );
  const value = normalizeNumber(
    pickField(row, ["成交金額", "成交金額(仟元)", "TradeValue"])
  );
  const close = normalizeNumber(
    pickField(row, ["收盤價", "收盤", "ClosingPrice"])
  );
  const change = normalizeChange(pickField(row, ["漲跌價差", "漲跌", "Change"]));

  const prevClose = close - change;
  const pctChange = prevClose > 0 ? (change / prevClose) * 100 : 0;

  return {
    code,
    name,
    date,
    volume,
    value,
    close,
    change,
    pctChange,
    market,
  };
};

const extractEmergingStock = (row) => {
  const code = pickField(row, ["代號", "股票代號"]);
  const name = pickField(row, ["名稱", "股票名稱"]);
  const date = pickField(row, ["資料日期"]);
  const avgPrice = normalizeNumber(pickField(row, ["日均價"]));
  const prevAvgPrice = normalizeNumber(pickField(row, ["前日均價"]));
  const volume = normalizeNumber(pickField(row, ["成交量"]));
  const change = avgPrice - prevAvgPrice;
  const pctChange = prevAvgPrice > 0 ? (change / prevAvgPrice) * 100 : 0;

  return {
    code,
    name,
    date,
    volume,
    value: avgPrice * volume,
    close: avgPrice,
    change,
    pctChange,
    market: "emerging",
  };
};

const filterStocksByMarket = (stocks) => {
  if (state.marketFilter === "listed") {
    return stocks.filter((stock) => stock.market === "listed");
  }
  if (state.marketFilter === "otc") {
    return stocks.filter((stock) => stock.market === "otc");
  }
  if (state.marketFilter === "emerging") {
    return stocks.filter((stock) => stock.market === "emerging");
  }
  return stocks;
};

const aggregateByIndustry = (stocks) => {
  const agg = new Map();

  stocks.forEach((stock) => {
    if (!stock.code) return;
    const industry = state.industries.get(stock.code) || "其他";
    if (!agg.has(industry)) {
      agg.set(industry, {
        industry,
        volume: 0,
        value: 0,
        weightedChangeSum: 0,
      });
    }
    const row = agg.get(industry);
    row.volume += stock.volume;
    row.value += stock.value;
    row.weightedChangeSum += stock.pctChange * stock.value;
  });

  return Array.from(agg.values()).map((row) => ({
    ...row,
    weightedChange: row.value > 0 ? row.weightedChangeSum / row.value : 0,
  }));
};

const summarizeMarket = (stocks) => {
  let totalVolume = 0;
  let totalValue = 0;
  let weightedChangeSum = 0;

  stocks.forEach((stock) => {
    totalVolume += stock.volume;
    totalValue += stock.value;
    weightedChangeSum += stock.pctChange * stock.value;
  });

  return {
    totalVolume,
    totalValue,
    weightedChange: totalValue > 0 ? weightedChangeSum / totalValue : 0,
  };
};

const renderIndustryTable = () => {
  const sortBy = elements.industrySort.value;
  const sorted = [...state.industryAgg].sort((a, b) => {
    if (sortBy === "change") return b.weightedChange - a.weightedChange;
    if (sortBy === "value") return b.value - a.value;
    return b.volume - a.volume;
  });

  const maxVolume = Math.max(...sorted.map((row) => row.volume), 1);

  const rows = [
    `<div class="row header">
      <div>類股</div>
      <div>成交量</div>
      <div>成交金額</div>
      <div>加權漲跌</div>
    </div>`,
  ];

  sorted.forEach((row) => {
    const barWidth = Math.round((row.volume / maxVolume) * 100);
    const badgeClass = row.weightedChange >= 0 ? "positive" : "negative";
    rows.push(`
      <div class="row">
        <div>
          <strong>${row.industry}</strong>
          <div class="bar"><span style="width: ${barWidth}%"></span></div>
        </div>
        <div>
          ${formatVolume(row.volume)}
        </div>
        <div>
          ${formatValue(row.value)}
        </div>
        <div>
          <span class="badge ${badgeClass}">${formatPercent(row.weightedChange)}</span>
        </div>
      </div>
    `);
  });

  elements.industryTable.innerHTML = rows.join("");
};

const loadGroups = () => {
  const stored = localStorage.getItem("twse-groups");
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
};

const saveGroups = (groups) => {
  localStorage.setItem("twse-groups", JSON.stringify(groups));
};

const buildGroupStats = (group, stocks) => {
  const stockMap = new Map();
  const industrySet = new Set(group.industries || []);
  const manualCodes = new Set(group.stocks || []);

  stocks.forEach((stock) => {
    const industry = state.industries.get(stock.code) || "其他";
    if (industrySet.has(industry) || manualCodes.has(stock.code)) {
      stockMap.set(stock.code, stock);
    }
  });

  let totalVolume = 0;
  let totalValue = 0;
  let weightedChangeSum = 0;

  stockMap.forEach((stock) => {
    totalVolume += stock.volume;
    totalValue += stock.value;
    weightedChangeSum += stock.pctChange * stock.value;
  });

  return {
    id: group.id,
    name: group.name,
    count: stockMap.size,
    totalVolume,
    totalValue,
    weightedChange: totalValue > 0 ? weightedChangeSum / totalValue : 0,
  };
};

const renderGroups = () => {
  if (!state.groups.length) {
    elements.groupList.innerHTML = `<div class="status">尚未建立族群。</div>`;
    elements.groupCompare.innerHTML = "";
    if (state.charts.groups) {
      state.charts.groups.destroy();
      state.charts.groups = null;
    }
    return;
  }

  elements.groupList.innerHTML = state.groups
    .map(
      (group, index) => `
      <div class="group-card" data-id="${group.id}">
        <h3>${group.name}</h3>
        <p>產業：${group.industries?.join("、") || "無"}</p>
        <p>股票：${group.stocks?.join(", ") || "無"}</p>
        <div class="group-actions">
          <button data-action="edit" data-id="${group.id}">編輯</button>
          <button data-action="delete" data-id="${group.id}">刪除</button>
          <button data-action="up" data-id="${group.id}" ${index === 0 ? "disabled" : ""}>上移</button>
          <button data-action="down" data-id="${group.id}" ${index === state.groups.length - 1 ? "disabled" : ""}>下移</button>
        </div>
      </div>
    `
    )
    .join("");

  const scopedStocks = filterStocksByMarket(state.stocks);
  const stats = state.groups.map((group) => buildGroupStats(group, scopedStocks));
  const sortedStats = sortGroupStats(stats);
  const maxVolume = Math.max(...sortedStats.map((row) => row.totalVolume), 1);

  elements.groupCompare.innerHTML = sortedStats
    .map((row) => {
      const barWidth = Math.round((row.totalVolume / maxVolume) * 100);
      const badgeClass = row.weightedChange >= 0 ? "positive" : "negative";
      return `
        <div class="compare-item">
          <strong>${row.name}</strong>
          <div class="bar"><span style="width: ${barWidth}%"></span></div>
          <div>${formatVolume(row.totalVolume)} · ${formatValue(row.totalValue)}</div>
          <div class="badge ${badgeClass}">${formatPercent(row.weightedChange)}</div>
        </div>
      `;
    })
    .join("");

  renderGroupChart(sortedStats);
};

const sortGroupStats = (stats) => {
  if (state.groupSort === "volume") {
    return [...stats].sort((a, b) => b.totalVolume - a.totalVolume);
  }
  if (state.groupSort === "value") {
    return [...stats].sort((a, b) => b.totalValue - a.totalValue);
  }
  if (state.groupSort === "change") {
    return [...stats].sort((a, b) => b.weightedChange - a.weightedChange);
  }
  return stats;
};

const fillIndustryOptions = () => {
  const industries = Array.from(new Set(state.industryAgg.map((row) => row.industry)))
    .sort();

  elements.groupIndustries.innerHTML = industries
    .map((industry) => `<option value="${industry}">${industry}</option>`)
    .join("");
};

const updateStatus = (lines) => {
  elements.status.textContent = lines.join("\n");
};

const appendStatus = (line) => {
  const current = elements.status.textContent.trim();
  elements.status.textContent = current ? `${current}\n${line}` : line;
};

const renderIndustryChart = () => {
  if (!window.Chart) return;
  const topIndustries = [...state.industryAgg]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10);

  const labels = topIndustries.map((row) => row.industry);
  const data = topIndustries.map((row) => row.volume);

  if (state.charts.industry) {
    state.charts.industry.destroy();
  }

  state.charts.industry = new Chart(elements.industryChart, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "成交量",
          data,
          backgroundColor: "rgba(69, 194, 178, 0.7)",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => `成交量 ${formatVolume(context.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#b8c0d4" },
          grid: { display: false },
        },
        y: {
          ticks: {
            color: "#b8c0d4",
            callback: (value) => formatter.format(value),
          },
          grid: { color: "rgba(255,255,255,0.08)" },
        },
      },
    },
  });
};

const renderGroupChart = (stats) => {
  if (!window.Chart) return;
  const labels = stats.map((row) => row.name);
  const data = stats.map((row) => row.totalVolume);

  if (state.charts.groups) {
    state.charts.groups.destroy();
  }

  state.charts.groups = new Chart(elements.groupChart, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "成交量",
          data,
          backgroundColor: "rgba(247, 181, 0, 0.7)",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => `成交量 ${formatVolume(context.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#b8c0d4" },
          grid: { display: false },
        },
        y: {
          ticks: {
            color: "#b8c0d4",
            callback: (value) => formatter.format(value),
          },
          grid: { color: "rgba(255,255,255,0.08)" },
        },
      },
    },
  });
};

const renderTrendChart = (history) => {
  if (!window.Chart) return;
  if (!history.length) {
    if (state.charts.trend) {
      state.charts.trend.destroy();
      state.charts.trend = null;
    }
    return;
  }
  const labels = history.map((item) => item.date);
  const data = history.map((item) => item.totalValue);

  if (state.charts.trend) {
    state.charts.trend.destroy();
  }

  state.charts.trend = new Chart(elements.trendChart, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "成交金額",
          data,
          borderColor: "rgba(69, 194, 178, 0.9)",
          backgroundColor: "rgba(69, 194, 178, 0.2)",
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => `成交金額 ${formatValue(context.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#b8c0d4" },
          grid: { display: false },
        },
        y: {
          ticks: {
            color: "#b8c0d4",
            callback: (value) => formatter.format(value),
          },
          grid: { color: "rgba(255,255,255,0.08)" },
        },
      },
    },
  });
};

const renderHeatmap = () => {
  const topIndustries = [...state.industryAgg]
    .sort((a, b) => b.value - a.value)
    .slice(0, 24);

  if (!topIndustries.length) {
    elements.industryHeatmap.innerHTML = `<div class="status">暫無類股資料。</div>`;
    return;
  }

  const maxValue = Math.max(...topIndustries.map((row) => row.value), 1);
  const maxChange = Math.max(
    ...topIndustries.map((row) => Math.abs(row.weightedChange)),
    1
  );

  elements.industryHeatmap.innerHTML = topIndustries
    .map((row) => {
      const intensity = row.value / maxValue;
      const changeRatio = Math.min(
        Math.abs(row.weightedChange) / maxChange,
        1
      );
      const hue = row.weightedChange >= 0 ? 152 : 355;
      const lightness = 80 - intensity * 35;
      const color = `hsl(${hue}, ${50 + changeRatio * 30}%, ${lightness}%)`;
      return `\n        <div class="heatmap-tile" style="background:${color}" title="${row.industry}">\n          <strong>${row.industry}</strong>\n          <span>${formatValue(row.value)}</span>\n          <span>${formatPercent(row.weightedChange)}</span>\n        </div>\n      `;
    })
    .join("");
};

const downloadLast7Days = async () => {
  try {
    const csvText = await fetchCsv(DATA_ENDPOINTS.marketDaily);
    const rows = parseCsv(csvText);
    const parsed = rows
      .map((row) => {
        const date = normalizeDate(
          pickField(row, ["日期", "date", "Date", "資料日期"])
        );
        const volume = normalizeNumber(
          pickField(row, ["成交股數", "成交量", "Volume of shares traded"])
        );
        const value = normalizeNumber(
          pickField(row, ["成交金額", "成交金額(千元)", "Transaction Amount"])
        );
        const index = normalizeNumber(
          pickField(row, ["發行量加權股價指數", "Weighted Index"])
        );
        const change = normalizeChange(
          pickField(row, ["漲跌點數", "Change", "漲跌"])
        );
        return { date, volume, value, index, change };
      })
      .filter((row) => row.date && row.date !== "--");

    parsed.sort((a, b) => a.date.localeCompare(b.date));
    const last7 = parsed.slice(-7);

    if (!last7.length) {
      throw new Error("無法取得近7日資料");
    }

    const rowsOut = [
      ["日期", "成交股數", "成交金額", "加權指數", "漲跌點數", "資料來源"],
      ...last7.map((item) => [
        item.date,
        item.volume,
        item.value,
        item.index,
        item.change,
        "TWSE FMTQIK",
      ]),
    ];
    downloadCsv(
      rowsOut,
      `twse_market_last7days_${last7[0].date}_to_${last7[last7.length - 1].date}.csv`
    );
    appendStatus("已下載近7日成交記錄（上市市場）。");
  } catch (error) {
    const history = loadHistory()[state.marketFilter] ?? [];
    const last7 = history.slice(-7);
    if (last7.length) {
      const rowsOut = [
        ["日期", "成交股數", "成交金額", "加權漲跌", "資料來源"],
        ...last7.map((item) => [
          item.date,
          item.totalVolume,
          item.totalValue,
          item.weightedChange,
          "本機累積",
        ]),
      ];
      downloadCsv(
        rowsOut,
        `market_last7days_local_${last7[0].date}_to_${last7[last7.length - 1].date}.csv`
      );
      appendStatus("遠端下載失敗，已改用本機累積資料。");
    } else {
      appendStatus(`下載失敗：${error.message}`);
    }
  }
};

const renderDashboard = (stocks) => {
  state.metrics = summarizeMarket(stocks);
  state.industryAgg = aggregateByIndustry(stocks);

  const dates = stocks.map((stock) => stock.date).filter(Boolean);
  state.dataDate = dates.length ? normalizeDate(dates[0]) : "--";

  elements.dataDate.textContent = state.dataDate;
  elements.dataUpdated.textContent = state.lastUpdated;
  elements.totalVolume.textContent = formatVolume(state.metrics.totalVolume);
  elements.totalValue.textContent = formatValue(state.metrics.totalValue);
  elements.marketChange.textContent = formatPercent(state.metrics.weightedChange);

  const listedCount = stocks.filter((stock) => stock.market === "listed").length;
  const otcCount = stocks.filter((stock) => stock.market === "otc").length;
  const emergingCount = stocks.filter((stock) => stock.market === "emerging").length;
  elements.totalVolumeNote.textContent = `上市 ${formatter.format(
    listedCount
  )} / 上櫃 ${formatter.format(otcCount)} / 興櫃 ${formatter.format(emergingCount)}`;
  elements.totalValueNote.textContent = "成交金額加總（興櫃以均價估算）";

  renderIndustryTable();
  renderIndustryChart();
  renderHeatmap();
  fillIndustryOptions();
  renderGroups();

  if (state.dataDate !== "--") {
    const snapshot = {
      date: state.dataDate,
      totalVolume: state.metrics.totalVolume,
      totalValue: state.metrics.totalValue,
      weightedChange: state.metrics.weightedChange,
    };
    const history = updateHistory(snapshot, state.marketFilter);
    renderTrendChart(history);
  } else {
    renderTrendChart([]);
  }
};

const loadData = async () => {
  updateStatus(["載入公開交易所資料…"]);

  const [twseData, otcData, emergingData, listedCsv, otcCsv, emergingCsv] =
    await Promise.all([
      fetchJson(DATA_ENDPOINTS.twseStocks),
      fetchCsv(DATA_ENDPOINTS.otcStocks),
      fetchCsv(DATA_ENDPOINTS.emergingStocks),
      fetchCsv(DATA_ENDPOINTS.listedCompanies),
      fetchCsv(DATA_ENDPOINTS.otcCompanies),
      fetchCsv(DATA_ENDPOINTS.emergingCompanies),
    ]);

  state.industries = new Map();
  state.markets = new Map();
  buildIndustryMap(parseCsv(listedCsv), "listed");
  buildIndustryMap(parseCsv(otcCsv), "otc");
  buildIndustryMap(parseCsv(emergingCsv), "emerging");

  const twseStocks = twseData.map((row) => extractStock(row, "listed"));
  const otcRows = parseCsv(otcData);
  const emergingRows = parseCsv(emergingData);
  const otcStocks = otcRows.map((row) => extractStock(row, "otc"));
  const emergingStocks = emergingRows.map(extractEmergingStock);

  state.stocks = [...twseStocks, ...otcStocks, ...emergingStocks].filter(
    (stock) => stock.code
  );

  state.lastUpdated = new Date().toLocaleString("zh-Hant");

  updateStatus([
    `上市資料：${formatter.format(twseStocks.length)} 筆`,
    `上櫃資料：${formatter.format(otcStocks.length)} 筆`,
    `興櫃資料：${formatter.format(emergingStocks.length)} 筆`,
    `產業對照：${formatter.format(state.industries.size)} 筆`,
    `更新時間：${state.lastUpdated}`,
  ]);
};

const init = async () => {
  try {
    await loadData();
    const filtered = filterStocksByMarket(state.stocks);
    renderDashboard(filtered);
  } catch (error) {
    updateStatus([
      "載入失敗，請確認網路連線或資料來源是否允許跨網域存取。",
      "若瀏覽器阻擋跨網域，可改用本機代理伺服器。",
      `錯誤訊息：${error.message}`,
    ]);
  }
};

const openDialog = (group) => {
  elements.groupForm.reset();
  if (group) {
    state.editingGroupId = group.id;
    elements.groupDialogTitle.textContent = "編輯族群";
    elements.groupName.value = group.name;
    elements.groupStocks.value = group.stocks?.join(", ") || "";
    Array.from(elements.groupIndustries.options).forEach((option) => {
      option.selected = group.industries?.includes(option.value) || false;
    });
  } else {
    state.editingGroupId = null;
    elements.groupDialogTitle.textContent = "建立自訂族群";
  }
  elements.dialog.showModal();
};

const closeDialog = () => {
  elements.dialog.close();
};

const handleGroupAction = (action, id) => {
  const index = state.groups.findIndex((group) => group.id === id);
  if (index === -1) return;

  if (action === "delete") {
    state.groups.splice(index, 1);
  }

  if (action === "up" && index > 0) {
    const [item] = state.groups.splice(index, 1);
    state.groups.splice(index - 1, 0, item);
  }

  if (action === "down" && index < state.groups.length - 1) {
    const [item] = state.groups.splice(index, 1);
    state.groups.splice(index + 1, 0, item);
  }

  if (action === "edit") {
    openDialog(state.groups[index]);
    return;
  }

  saveGroups(state.groups);
  renderGroups();
};

const loadSettings = () => {
  const stored = localStorage.getItem("twse-settings");
  if (!stored) return;
  try {
    const settings = JSON.parse(stored);
    if (settings.marketFilter) state.marketFilter = settings.marketFilter;
    if (settings.groupSort) state.groupSort = settings.groupSort;
    if (settings.autoRefresh) state.autoRefresh = settings.autoRefresh;
  } catch {
    return;
  }
};

const saveSettings = () => {
  localStorage.setItem(
    "twse-settings",
    JSON.stringify({
      marketFilter: state.marketFilter,
      groupSort: state.groupSort,
      autoRefresh: state.autoRefresh,
    })
  );
};

const scheduleAutoRefresh = () => {
  setInterval(() => {
    if (!state.autoRefresh.enabled) return;
    const [targetHour, targetMinute] = state.autoRefresh.time
      .split(":")
      .map((value) => Number(value));
    if (!Number.isFinite(targetHour) || !Number.isFinite(targetMinute)) return;

    const now = new Date();
    const todayKey = now.toISOString().split("T")[0];
    if (state.autoRefresh.lastRunDate === todayKey) return;

    if (now.getHours() === targetHour && now.getMinutes() >= targetMinute) {
      state.autoRefresh.lastRunDate = todayKey;
      saveSettings();
      init();
    }
  }, 60 * 1000);
};

elements.industrySort.addEventListener("change", () => {
  renderIndustryTable();
});

elements.groupSort.addEventListener("change", (event) => {
  state.groupSort = event.target.value;
  saveSettings();
  renderGroups();
});

elements.marketFilter.addEventListener("change", (event) => {
  state.marketFilter = event.target.value;
  saveSettings();
  const filtered = filterStocksByMarket(state.stocks);
  renderDashboard(filtered);
});

elements.addGroup.addEventListener("click", () => openDialog());

elements.cancelGroup.addEventListener("click", () => {
  closeDialog();
});

elements.groupList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  handleGroupAction(button.dataset.action, button.dataset.id);
});

elements.groupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = elements.groupName.value.trim();
  const industries = Array.from(elements.groupIndustries.selectedOptions).map(
    (option) => option.value
  );
  const stocks = elements.groupStocks.value
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  if (!name) return;

  if (state.editingGroupId) {
    const index = state.groups.findIndex(
      (group) => group.id === state.editingGroupId
    );
    if (index !== -1) {
      state.groups[index] = {
        ...state.groups[index],
        name,
        industries,
        stocks,
      };
    }
  } else {
    state.groups.push({
      id: crypto.randomUUID(),
      name,
      industries,
      stocks,
    });
  }

  saveGroups(state.groups);
  renderGroups();
  closeDialog();
});

elements.manualRefresh.addEventListener("click", () => init());

elements.autoRefresh.addEventListener("change", (event) => {
  state.autoRefresh.enabled = event.target.checked;
  saveSettings();
});

elements.autoRefreshTime.addEventListener("change", (event) => {
  state.autoRefresh.time = event.target.value || "15:30";
  saveSettings();
});

elements.download7Days.addEventListener("click", () => {
  if (state.marketFilter !== "listed" && state.marketFilter !== "all") {
    appendStatus("提醒：近7日下載來源為上市市場資料。");
  }
  downloadLast7Days();
});

const bootstrap = () => {
  loadSettings();
  state.groups = loadGroups();
  elements.marketFilter.value = state.marketFilter;
  elements.groupSort.value = state.groupSort;
  elements.autoRefresh.checked = state.autoRefresh.enabled;
  elements.autoRefreshTime.value = state.autoRefresh.time;
  init();
  scheduleAutoRefresh();
};

bootstrap();
