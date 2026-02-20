const MLB = {
  teams: "https://statsapi.mlb.com/api/v1/teams",
  roster: (teamId) => `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster`,
  peopleStats: (personId) =>
    `https://statsapi.mlb.com/api/v1/people/${personId}/stats`,
};

const API_BASE = window.__API_BASE__ || "http://localhost:8000";

const LEAGUE_IDS = {
  AL: 103,
  NL: 104,
};

const POSITION_LABELS = {
  C: "捕手",
  "1B": "一壘",
  "2B": "二壘",
  "3B": "三壘",
  SS: "游擊",
  OF: "外野",
  LF: "左外野",
  CF: "中外野",
  RF: "右外野",
  DH: "指定打擊",
  P: "投手",
};

const state = {
  players: new Map(),
  removed: new Map(),
  excelNames: [],
  excelUnmatched: [],
  rosterSeason: "2026",
  league: "all",
  positionsCalculated: false,
};

const elements = {
  rosterSource: document.querySelector("#roster-source"),
  availableCount: document.querySelector("#available-count"),
  removedCount: document.querySelector("#removed-count"),
  leagueSelect: document.querySelector("#league-select"),
  seasonSelect: document.querySelector("#season-select"),
  loadRoster: document.querySelector("#load-roster"),
  excelInput: document.querySelector("#excel-input"),
  applyExcel: document.querySelector("#apply-excel"),
  positionFilter: document.querySelector("#position-filter"),
  searchInput: document.querySelector("#search-input"),
  rosterGrid: document.querySelector("#roster-grid"),
  rosterSubtitle: document.querySelector("#roster-subtitle"),
  calcEligibility: document.querySelector("#calc-eligibility"),
  exportRemaining: document.querySelector("#export-remaining"),
  removedList: document.querySelector("#removed-list"),
  playerDialog: document.querySelector("#player-dialog"),
  playerTeam: document.querySelector("#player-team"),
  playerName: document.querySelector("#player-name"),
  playerPositions: document.querySelector("#player-positions"),
  playerMetrics: document.querySelector("#player-metrics"),
  closeDialog: document.querySelector("#close-dialog"),
  markClosed: document.querySelector("#mark-closed"),
  markPicked: document.querySelector("#mark-picked"),
};

const normalizeName = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[\u3000]/g, " ")
    .trim()
    .toLowerCase();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureXlsxLoaded = () =>
  new Promise((resolve, reject) => {
    if (window.XLSX) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/xlsx@0.19.3/dist/xlsx.full.min.js";
    script.async = true;
    script.onload = () => {
      if (window.XLSX) resolve();
      else reject(new Error("XLSX 載入失敗"));
    };
    script.onerror = () => reject(new Error("無法載入 XLSX CDN"));
    document.head.appendChild(script);
  });

const pool = async (items, limit, task) => {
  const results = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => task(item));
    results.push(p);
    if (limit <= items.length) {
      let e;
      e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
};

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API 失敗: ${response.status}`);
  }
  return response.json();
};

const getLeagueIds = () => {
  if (state.league === "AL") return [LEAGUE_IDS.AL];
  if (state.league === "NL") return [LEAGUE_IDS.NL];
  return [LEAGUE_IDS.AL, LEAGUE_IDS.NL];
};

const mergePlayer = (player) => {
  const existing = state.players.get(player.id);
  if (existing) {
    existing.team = player.team;
    existing.teamId = player.teamId;
    existing.primaryPosition = player.primaryPosition;
    existing.positionName = player.positionName;
    existing.bats = player.bats ?? existing.bats;
    existing.throws = player.throws ?? existing.throws;
    return;
  }
  state.players.set(player.id, {
    ...player,
    eligiblePositions: [],
    eligibilityNote: "",
  });
};

const loadTeams = async () => {
  const leagueIds = getLeagueIds();
  const teamResponses = await Promise.all(
    leagueIds.map((id) =>
      fetchJson(`${MLB.teams}?sportId=1&leagueId=${id}`)
    )
  );
  return teamResponses.flatMap((data) => data.teams || []);
};

const loadRosterForTeam = async (team, season) => {
  const rosterTypes = ["active", "nonRosterInvitees"];
  const entries = [];
  for (const rosterType of rosterTypes) {
    const url = `${MLB.roster(team.id)}?rosterType=${rosterType}&season=${season}`;
    try {
      const data = await fetchJson(url);
      entries.push({ rosterType, entries: data.roster || [] });
    } catch (error) {
      console.warn("Roster error", rosterType, team.name, error);
    }
    await sleep(120);
  }
  return entries.flatMap((entry) =>
    entry.entries.map((item) => ({
      id: item.person?.id,
      name: item.person?.fullName,
      team: team.name,
      teamId: team.id,
      primaryPosition: item.position?.abbreviation || "",
      positionName: item.position?.name || "",
      bats: item.person?.batSide?.code || "",
      throws: item.person?.pitchHand?.code || "",
      rosterType: entry.rosterType,
    }))
  );
};

const loadRosters = async () => {
  state.players.clear();
  state.removed.clear();
  state.positionsCalculated = false;

  elements.loadRoster.disabled = true;
  elements.loadRoster.textContent = "載入中…";
  elements.rosterSubtitle.textContent = "正在抓取 MLB 名單…";
  elements.calcEligibility.disabled = true;
  elements.exportRemaining.disabled = true;

  try {
    const teams = await loadTeams();
    const leagueLabel = state.league === "all" ? "AL+NL" : state.league;
    elements.rosterSource.textContent = `${leagueLabel} · ${state.rosterSeason}`;

    await pool(teams, 4, async (team) => {
      const players = await loadRosterForTeam(team, state.rosterSeason);
      players.filter((p) => p.id).forEach(mergePlayer);
    });

    elements.rosterSubtitle.textContent =
      "名單載入完成，可開始計算守位資格或上傳 Excel。";
    elements.calcEligibility.disabled = false;
    elements.exportRemaining.disabled = false;
  } catch (error) {
    elements.rosterSubtitle.textContent = `名單載入失敗：${error.message}`;
  } finally {
    elements.loadRoster.disabled = false;
    elements.loadRoster.textContent = "載入 MLB 名單";
  }

  render();
};

const parseFieldingSplits = (splits) => {
  const counts = new Map();
  splits.forEach((split) => {
    const position = split.position?.abbreviation || split.position?.code;
    if (!position) return;
    const games =
      split.stat?.games || split.stat?.gamesPlayed || split.stat?.gamesStarted;
    const add = Number.isFinite(Number(games)) ? Number(games) : 1;
    counts.set(position, (counts.get(position) || 0) + add);
  });
  return counts;
};

const fetchEligibility = async (playerId, season) => {
  const url = `${MLB.peopleStats(playerId)}?stats=season&group=fielding&season=${season}`;
  const data = await fetchJson(url);
  const splits = data.stats?.[0]?.splits || [];
  if (splits.length) {
    return parseFieldingSplits(splits);
  }
  const fallbackUrl = `${MLB.peopleStats(playerId)}?stats=gameLog&group=fielding&season=${season}`;
  const fallback = await fetchJson(fallbackUrl);
  return parseFieldingSplits(fallback.stats?.[0]?.splits || []);
};

const calcEligibility = async () => {
  elements.calcEligibility.disabled = true;
  elements.calcEligibility.textContent = "計算中…";
  elements.rosterSubtitle.textContent = "正在計算 2025 守位資格…";

  const season = "2025";
  const players = Array.from(state.players.values());

  await pool(players, 5, async (player) => {
    if (player.primaryPosition === "P") {
      player.eligiblePositions = ["P"];
      return;
    }
    try {
      const counts = await fetchEligibility(player.id, season);
      const eligible = [];
      counts.forEach((games, position) => {
        if (games >= 15) {
          eligible.push(position);
        }
      });
      const outfieldEligible = ["LF", "CF", "RF"].some((pos) =>
        eligible.includes(pos)
      );
      if (outfieldEligible && !eligible.includes("OF")) {
        eligible.push("OF");
      }
      player.eligiblePositions = eligible.length ? eligible : [];
      if (!eligible.length && player.primaryPosition) {
        player.eligibilityNote = "2025 未達 15 場";
      }
    } catch (error) {
        player.eligiblePositions = player.primaryPosition ? [player.primaryPosition] : [];
        player.eligibilityNote = "守位資料暫缺";
    }
    await sleep(120);
  });

  state.positionsCalculated = true;
  elements.calcEligibility.textContent = "計算 2025 守位資格";
  elements.rosterSubtitle.textContent = "守位資格已更新。";
  render();
};

const parseExcel = async (file) => {
  await ensureXlsxLoaded();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName =
          workbook.SheetNames.find((name) => name.includes("總表")) ||
          workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
        resolve(rows);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
};

const extractNamesFromRows = (rows) => {
  let headerIndex = -1;
  let nameCol = -1;
  const candidates = ["球員", "姓名", "player", "name"];

  rows.forEach((row, index) => {
    if (headerIndex !== -1) return;
    row.forEach((cell, cellIndex) => {
      const value = normalizeName(cell);
      if (candidates.some((key) => value.includes(key))) {
        headerIndex = index;
        nameCol = cellIndex;
      }
    });
  });

  if (headerIndex === -1) {
    headerIndex = 0;
    nameCol = 0;
  }

  const names = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || !row.length) continue;
    const value = row[nameCol];
    if (!value) continue;
    names.push(String(value).trim());
  }
  return names;
};

const applyExcelRemoval = () => {
  if (!state.excelNames.length) return;
  const rosterNames = new Map();
  state.players.forEach((player) => {
    rosterNames.set(normalizeName(player.name), player.id);
  });

  const unmatched = [];
  state.excelNames.forEach((name) => {
    const key = normalizeName(name);
    const id = rosterNames.get(key);
    if (!id) {
      unmatched.push(name);
      return;
    }
    const player = state.players.get(id);
    if (player) {
      state.removed.set(id, { player, reason: "Excel" });
    }
  });

  state.excelUnmatched = unmatched;
  render();
};

const getAvailablePlayers = () => {
  const removedIds = new Set(state.removed.keys());
  return Array.from(state.players.values()).filter(
    (player) => !removedIds.has(player.id)
  );
};

const filterPlayers = (players) => {
  const keyword = normalizeName(elements.searchInput.value);
  const position = elements.positionFilter.value;

  return players.filter((player) => {
    const text = normalizeName(`${player.name} ${player.team}`);
    if (keyword && !text.includes(keyword)) return false;
    if (position === "all") return true;

    const eligible = player.eligiblePositions.length
      ? player.eligiblePositions
      : [player.primaryPosition];
    if (position === "OF") {
      return eligible.includes("OF") || eligible.some((p) => ["LF", "CF", "RF"].includes(p));
    }
    return eligible.includes(position);
  });
};

const renderRoster = () => {
  const available = getAvailablePlayers();
  const filtered = filterPlayers(available);

  elements.rosterGrid.innerHTML = "";
  if (!available.length) {
    elements.rosterGrid.innerHTML =
      '<div class="muted">請先載入 MLB 名單。</div>';
    return;
  }
  if (!filtered.length) {
    elements.rosterGrid.innerHTML =
      '<div class="muted">沒有符合條件的球員。</div>';
    return;
  }

  filtered
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((player) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "player-card";
      card.innerHTML = `
        <h3 class="player-name">${player.name}</h3>
        <p class="player-meta">${player.team} · ${player.primaryPosition || "-"}</p>
        <div class="tag-list">
          ${(player.eligiblePositions.length
            ? player.eligiblePositions
            : player.primaryPosition
            ? [player.primaryPosition]
            : ["?"]
          )
            .map((pos) => `<span class="tag">${pos}</span>`)
            .join("")}
          ${
            player.eligibilityNote
              ? `<span class="tag">${player.eligibilityNote}</span>`
              : ""
          }
        </div>
      `;
      card.addEventListener("click", () => openPlayerDialog(player));
      elements.rosterGrid.appendChild(card);
    });
};

const renderRemoved = () => {
  elements.removedList.innerHTML = "";
  if (!state.removed.size) {
    elements.removedList.innerHTML =
      '<div class="muted">尚無已選或關閉球員。</div>';
    return;
  }
  state.removed.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "removed-item";
    item.textContent = `${entry.player.name} · ${entry.reason}`;
    elements.removedList.appendChild(item);
  });
};

const renderCounts = () => {
  const available = getAvailablePlayers();
  elements.availableCount.textContent = available.length.toString();
  elements.removedCount.textContent = state.removed.size.toString();
};

const render = () => {
  renderCounts();
  renderRoster();
  renderRemoved();
  elements.exportRemaining.disabled = !getAvailablePlayers().length;
};

const formatPercentile = (value) => {
  if (value == null || Number.isNaN(value)) return "--";
  return `${Math.round(value)}%`;
};

const openPlayerDialog = async (player) => {
  elements.playerTeam.textContent = player.team || "--";
  elements.playerName.textContent = player.name;
  const positions = player.eligiblePositions.length
    ? player.eligiblePositions
    : player.primaryPosition
    ? [player.primaryPosition]
    : [];
  elements.playerPositions.textContent = positions.length
    ? positions.map((pos) => POSITION_LABELS[pos] || pos).join(" / ")
    : "守位資料不足";
  elements.playerMetrics.innerHTML = '<div class="metric-card">載入中…</div>';
  elements.playerDialog.showModal();

  elements.markClosed.onclick = () => markRemoved(player, "關閉");
  elements.markPicked.onclick = () => markRemoved(player, "已選");

  try {
    const role = player.primaryPosition === "P" ? "pitcher" : "batter";
    const url = `${API_BASE}/player?mlb_id=${player.id}&season=2025&role=${role}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("pybaseball 服務未啟動");
    const data = await response.json();
    renderMetrics(data.metrics || []);
  } catch (error) {
    elements.playerMetrics.innerHTML = `
      <div class="metric-card">
        <h4>資料讀取失敗</h4>
        <strong class="muted">${error.message}</strong>
      </div>
    `;
  }
};

const renderMetrics = (metrics) => {
  if (!metrics.length) {
    elements.playerMetrics.innerHTML =
      '<div class="metric-card">此球員無足夠 Statcast 資料。</div>';
    return;
  }
  elements.playerMetrics.innerHTML = "";
  metrics.forEach((metric) => {
    const card = document.createElement("div");
    card.className = "metric-card";
    card.innerHTML = `
      <h4>${metric.label}</h4>
      <strong>${metric.value ?? "--"}</strong>
      <p class="muted">百分位 ${formatPercentile(metric.percentile)}</p>
    `;
    elements.playerMetrics.appendChild(card);
  });
};

const markRemoved = (player, reason) => {
  state.removed.set(player.id, { player, reason });
  elements.playerDialog.close();
  render();
};

const exportRemaining = () => {
  const players = getAvailablePlayers();
  const rows = [
    ["Name", "Team", "Primary Position", "Eligible Positions"],
    ...players.map((player) => [
      player.name,
      player.team,
      player.primaryPosition,
      player.eligiblePositions.join("/") || player.primaryPosition,
    ]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${cell || ""}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "remaining_players.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const handleExcelUpload = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const rows = await parseExcel(file);
    state.excelNames = extractNamesFromRows(rows);
    elements.applyExcel.disabled = !state.excelNames.length;
    elements.rosterSubtitle.textContent = `Excel 讀取完成，找到 ${state.excelNames.length} 筆球員。`;
  } catch (error) {
    elements.rosterSubtitle.textContent = `Excel 讀取失敗：${error.message}`;
  }
};

const init = () => {
  elements.leagueSelect.addEventListener("change", (event) => {
    state.league = event.target.value;
  });
  elements.seasonSelect.addEventListener("change", (event) => {
    state.rosterSeason = event.target.value;
  });
  elements.loadRoster.addEventListener("click", loadRosters);
  elements.excelInput.addEventListener("change", handleExcelUpload);
  elements.applyExcel.addEventListener("click", applyExcelRemoval);
  elements.positionFilter.addEventListener("change", render);
  elements.searchInput.addEventListener("input", render);
  elements.calcEligibility.addEventListener("click", calcEligibility);
  elements.exportRemaining.addEventListener("click", exportRemaining);
  elements.closeDialog.addEventListener("click", () => elements.playerDialog.close());
};

init();
