let allData = [];

document.getElementById("fileInput").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (event) {
        const csvText = event.target.result;
        allData = parseCSV(csvText);

        populateTeamDropdown(allData);
    };
    reader.readAsText(file);
});

document.getElementById("teamSelect").addEventListener("change", function () {
    const team = this.value;
    if (team) {
        plotTeamMMR(team);
    }
});

// ------------------------------
// CSV Parsing
// ------------------------------

function parseCSV(text) {
    const lines = text.split("\n").filter(l => l.trim().length > 0);
    const headers = lines[0].split(",");
    return lines.slice(1).map(line => {
        const cols = line.split(",");
        let obj = {};
        headers.forEach((h, i) => {
            obj[h.trim()] = cols[i] ? cols[i].trim() : "";
        });
        return obj;
    });
}

// ------------------------------
// Dropdown Population
// ------------------------------

function populateTeamDropdown(data) {
    const teamSelect = document.getElementById("teamSelect");

    const teams = new Set();
    data.forEach(row => {
        teams.add(row.HomeTeam);
        teams.add(row.AwayTeam);
    });

    teamSelect.innerHTML = "<option value=''>Select a Team</option>";
    Array.from(teams).sort().forEach(team => {
        const opt = document.createElement("option");
        opt.value = team;
        opt.textContent = team;
        teamSelect.appendChild(opt);
    });
}

// ------------------------------
// Plotting
// ------------------------------

function plotTeamMMR(team) {
    const filtered = allData.filter(row =>
        row.HomeTeam === team || row.AwayTeam === team
    );

    filtered.sort((a, b) => new Date(a.Date) - new Date(b.Date));

    const dates = filtered.map(row => row.Date);

    const mmrValues = filtered.map(row => {
        if (row.HomeTeam === team) return parseFloat(row.HomeTeamMMRBefore);
        return parseFloat(row.AwayTeamMMRBefore);
    });

    const trace = {
        x: dates,
        y: mmrValues,
        mode: "lines+markers",
        type: "scatter",
        name: team
    };

    const layout = {
        title: `${team} MMR Over Time`,
        xaxis: { title: "Date" },
        yaxis: { title: "MMR" }
    };

    Plotly.newPlot("chart", [trace], layout);
}

