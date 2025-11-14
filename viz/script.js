let allData = [];
let allTeams = [];
let selectedTeams = [];
let teamMatchesMap = new Map();

// DOM ELEMENTS 

const fileInput = document.getElementById("fileInput");
const teamSearch = document.getElementById("teamSearch");
const teamListDiv = document.getElementById("teamList");
const selectedTeamsDiv = document.getElementById("selectedTeams");
const mmrModeSelect = document.getElementById("mmrMode");
const avgToggle = document.getElementById("avgToggle");
const exportBtn = document.getElementById("exportPNG");
const darkModeToggle = document.getElementById("darkModeToggle");
const statsTableBody = document.querySelector("#statsTable tbody");
const statusMessage = document.getElementById("statusMessage");
const fileInfo = document.getElementById("fileInfo");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");

// HELPERS
function setStatus(msg, type = "info") {
  statusMessage.textContent = msg || "";
  statusMessage.style.color =
    type === "error" ? "#dc2626" : type === "success" ? "#16a34a" : "inherit";
}

function debounce(fn, delay = 200) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

//  CSV PARSING 

function parseCSV(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const obj = {};
    headers.forEach((h, i) => {
      const raw = cols[i] ? cols[i].trim() : "";
      obj[h] = raw;
    });
    return obj;
  });
}

function buildTeamIndex(data) {
  const teamSet = new Set();
  teamMatchesMap = new Map();

  data.forEach((row) => {
    const home = row.HomeTeam;
    const away = row.AwayTeam;
    if (!home && !away) return;

    if (home) {
      teamSet.add(home);
      if (!teamMatchesMap.has(home)) teamMatchesMap.set(home, []);
      teamMatchesMap.get(home).push(row);
    }
    if (away) {
      teamSet.add(away);
      if (!teamMatchesMap.has(away)) teamMatchesMap.set(away, []);
      teamMatchesMap.get(away).push(row);
    }
  });

  allTeams = Array.from(teamSet).sort((a, b) => a.localeCompare(b));
}

function getTeamMatches(team) {
  return teamMatchesMap.get(team) || [];
}

//TEAM LIST / SELECTION -

function renderTeamList(filterText = "") {
  const f = filterText.toLowerCase();
  teamListDiv.innerHTML = "";

  allTeams
    .filter((team) => team.toLowerCase().includes(f))
    .forEach((team) => {
      const div = document.createElement("div");
      div.textContent = team;
      if (selectedTeams.includes(team)) {
        div.style.fontWeight = "bold";
      }
      div.addEventListener("click", () => toggleTeamSelection(team));
      teamListDiv.appendChild(div);
    });
}

function renderSelectedTeams() {
  selectedTeamsDiv.innerHTML = "";
  selectedTeams.forEach((team) => {
    const chip = document.createElement("span");
    chip.className = "team-chip";
    chip.textContent = `${team} ×`;
    chip.title = "Click to remove";
    chip.addEventListener("click", () => toggleTeamSelection(team));
    selectedTeamsDiv.appendChild(chip);
  });
}

function toggleTeamSelection(team) {
  if (selectedTeams.includes(team)) {
    selectedTeams = selectedTeams.filter((t) => t !== team);
  } else {
    selectedTeams.push(team);
  }

  renderSelectedTeams();
  renderTeamList(teamSearch.value);

  if (selectedTeams.length > 0) {
    plotMultipleTeams(selectedTeams);
    updateStatsTable(selectedTeams);
  } else {
    clearChart();
    clearStatsTable();
  }
}

// CHART LOGIC 

function clearChart() {
  const chartDiv = document.getElementById("chart");
  chartDiv.innerHTML = "";
}

function plotMultipleTeams(teams) {
  const mode = mmrModeSelect.value; // overall | home | away
  const dark = document.body.classList.contains("dark");
  const traces = [];

  teams.forEach((team) => {
    const matches = getTeamMatches(team);
    if (matches.length === 0) return;

    const sorted = [...matches].sort(
      (a, b) => new Date(a.Date) - new Date(b.Date)
    );

    const x = [];
    const y = [];
    const text = [];

    sorted.forEach((row) => {
      const isHome = row.HomeTeam === team;
      const isAway = row.AwayTeam === team;

      if (mode === "home" && !isHome) return;
      if (mode === "away" && !isAway) return;

      const date = row.Date;
      const opp = isHome ? row.AwayTeam : row.HomeTeam;
      const gf = parseInt(isHome ? row.FTHG : row.FTAG, 10) || 0;
      const ga = parseInt(isHome ? row.FTAG : row.FTHG, 10) || 0;

      const before = parseFloat(
        isHome ? row.HomeTeamMMRBefore : row.AwayTeamMMRBefore
      );
      const after = parseFloat(
        isHome ? row.HomeTeamMMRAfter : row.AwayTeamMMRAfter
      );
      if (Number.isNaN(before) || Number.isNaN(after)) return;

      const delta = after - before;
      x.push(date);
      y.push(before);

      const loc = isHome ? "Home" : "Away";
      const line =
        `${date}<br>` +
        `<b>${team}</b> (${loc}) vs <b>${opp}</b><br>` +
        `Score: <b>${gf}-${ga}</b><br>` +
        `MMR Before: <b>${before.toFixed(2)}</b><br>` +
        `MMR After: <b>${after.toFixed(2)}</b><br>` +
        `Δ MMR: <b>${delta.toFixed(2)}</b><br>` +
        `Division: ${row.Div}`;

      text.push(line);
    });

    if (x.length === 0) return;

    traces.push({
      x,
      y,
      text,
      mode: "lines+markers",
      type: "scatter",
      name: team,
      hovertemplate: "%{text}<extra></extra>",
    });

    // Season averages overlay
    if (avgToggle.checked) {
      const avgData = computeSeasonAverages(sorted, team, mode);
      if (avgData.x.length > 0) {
        traces.push({
          x: avgData.x,
          y: avgData.y,
          mode: "lines+markers",
          type: "scatter",
          name: `${team} (Season Avg)`,
          line: { dash: "dot" },
          hovertemplate: "%{text}<extra></extra>",
          text: avgData.text,
        });
      }
    }
  });

  const layout = {
    title: "MMR Comparison",
    xaxis: { title: "Date" },
    yaxis: { title: "MMR" },
    paper_bgcolor: dark ? "#111827" : "#ffffff",
    plot_bgcolor: dark ? "#111827" : "#ffffff",
    font: { color: dark ? "#f0f0f0" : "#000000" },
    margin: { t: 40, l: 55, r: 10, b: 50 },
  };

  Plotly.newPlot("chart", traces, layout, { responsive: true });
}

function computeSeasonAverages(matches, team, mode) {
  const seasonMap = {}; // seasonKey -> { sum, count }

  matches.forEach((row) => {
    const isHome = row.HomeTeam === team;
    const isAway = row.AwayTeam === team;

    if (mode === "home" && !isHome) return;
    if (mode === "away" && !isAway) return;

    const date = new Date(row.Date);
    if (Number.isNaN(date.getTime())) return;

    const seasonKey = getSeasonKey(date);

    const before = parseFloat(
      isHome ? row.HomeTeamMMRBefore : row.AwayTeamMMRBefore
    );
    if (Number.isNaN(before)) return;

    if (!seasonMap[seasonKey]) {
      seasonMap[seasonKey] = { sum: 0, count: 0 };
    }
    seasonMap[seasonKey].sum += before;
    seasonMap[seasonKey].count += 1;
  });

  const x = [];
  const y = [];
  const text = [];

  Object.keys(seasonMap)
    .map((k) => parseInt(k, 10))
    .sort((a, b) => a - b)
    .forEach((seasonKey) => {
      const avg = seasonMap[seasonKey].sum / seasonMap[seasonKey].count;
      const date = new Date(seasonKey, 6, 1); // July 1
      const dateStr = date.toISOString().slice(0, 10);
      x.push(dateStr);
      y.push(avg);
      text.push(
        `Season ${seasonKey}/${seasonKey + 1}<br>Avg MMR: ${avg.toFixed(2)}`
      );
    });

  return { x, y, text };
}

function getSeasonKey(date) {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0 = Jan
  return month >= 6 ? year : year - 1;
}

// STATS TABLE 

function clearStatsTable() {
  statsTableBody.innerHTML = "";
}

function updateStatsTable(teams) {
  statsTableBody.innerHTML = "";

  teams.forEach((team) => {
    const matches = getTeamMatches(team);
    const played = matches.length;
    let wins = 0,
      draws = 0,
      losses = 0;
    let goalsScored = 0,
      goalsConceded = 0;

    matches.forEach((row) => {
      const isHome = row.HomeTeam === team;
      const gf = parseInt(isHome ? row.FTHG : row.FTAG, 10) || 0;
      const ga = parseInt(isHome ? row.FTAG : row.FTHG, 10) || 0;

      goalsScored += gf;
      goalsConceded += ga;

      if (gf > ga) wins++;
      else if (gf === ga) draws++;
      else losses++;
    });

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${team}</td>
      <td>${played}</td>
      <td>${wins}</td>
      <td>${draws}</td>
      <td>${losses}</td>
      <td>${goalsScored}</td>
      <td>${goalsConceded}</td>
      <td>${goalsScored - goalsConceded}</td>
    `;
    statsTableBody.appendChild(tr);
  });
}

//  EVENT LISTENERS 

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".csv")) {
    setStatus("Please select a CSV file.", "error");
    return;
  }

  const reader = new FileReader();
  setStatus("Loading and parsing CSV...");
  fileInfo.textContent = `Loaded: ${file.name}`;

  reader.onload = (event) => {
    try {
      const csvText = event.target.result;
      allData = parseCSV(csvText);

      if (!allData.length) {
        setStatus("CSV appears to be empty or invalid.", "error");
        allTeams = [];
        selectedTeams = [];
        buildTeamIndex([]);
        renderTeamList("");
        renderSelectedTeams();
        clearChart();
        clearStatsTable();
        return;
      }

      buildTeamIndex(allData);
      selectedTeams = [];
      renderSelectedTeams();
      renderTeamList(teamSearch.value);
      clearChart();
      clearStatsTable();

      setStatus(
        `Loaded ${allData.length} rows for ${allTeams.length} teams.`,
        "success"
      );
    } catch (err) {
      console.error(err);
      setStatus("Failed to parse CSV.", "error");
    }
  };

  reader.readAsText(file);
});

teamSearch.addEventListener(
  "input",
  debounce(() => {
    renderTeamList(teamSearch.value);
  }, 150)
);

mmrModeSelect.addEventListener("change", () => {
  if (selectedTeams.length > 0) {
    plotMultipleTeams(selectedTeams);
    updateStatsTable(selectedTeams);
  }
});

avgToggle.addEventListener("change", () => {
  if (selectedTeams.length > 0) {
    plotMultipleTeams(selectedTeams);
  }
});

exportBtn.addEventListener("click", () => {
  const chartDiv = document.getElementById("chart");
  if (!chartDiv || !chartDiv.children.length) {
    setStatus("No chart to export yet. Select teams first.", "error");
    return;
  }
  Plotly.downloadImage(chartDiv, {
    format: "png",
    filename: "mmr_chart",
    height: 650,
    width: 1000,
  });
});

darkModeToggle.addEventListener("change", () => {
  const body = document.body;
  body.classList.toggle("dark", darkModeToggle.checked);
  body.classList.toggle("light", !darkModeToggle.checked);

  if (selectedTeams.length > 0) {
    plotMultipleTeams(selectedTeams);
  }
});

clearSelectionBtn.addEventListener("click", () => {
  selectedTeams = [];
  renderSelectedTeams();
  renderTeamList(teamSearch.value);
  clearChart();
  clearStatsTable();
});

// Initial state
setStatus("Load a CSV file to begin.");
renderTeamList("");
