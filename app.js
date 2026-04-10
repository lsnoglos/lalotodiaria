const SOURCE_URL = "https://www.yelu.com.ni/lottery/results/history";
const SOURCE_PROXY_URLS = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://proxy.cors.sh/${url}`,
  (url) => `https://cors.isomorphic-git.org/${url}`,
];
const CACHE_KEY = "lotoData";
const CACHE_TIME_KEY = "lotoDataUpdatedAt";
const CACHE_TTL_MS = 30 * 60 * 1000;
const HOURS = ["12PM", "3PM", "6PM", "9PM"];
const HOUR_LABELS = { "12PM": "12:00pm", "3PM": "3:00pm", "6PM": "6:00pm", "9PM": "9:00pm" };

let appState = {
  data: [],
  analysis: null,
  activeMonth: "",
  currentTopFive: [],
  gridColumns: 10,
  gridSortDirection: "asc",
  gridStartWith: "00",
};

const els = {
  status: document.getElementById("status"),
  refreshBtn: document.getElementById("refreshBtn"),
  generatePlayBtn: document.getElementById("generatePlayBtn"),
  numberGrid: document.getElementById("numberGrid"),
  topRecommendations: document.getElementById("topRecommendations"),
  generatedPlay: document.getElementById("generatedPlay"),
  gridColumnsSelect: document.getElementById("gridColumnsSelect"),
  gridStartSelect: document.getElementById("gridStartSelect"),
  gridSortBtn: document.getElementById("gridSortBtn"),
  algorithmPanels: document.getElementById("algorithmPanels"),
  hourAccordion: document.getElementById("hourAccordion"),
  hourPanelTitle: document.getElementById("hourPanelTitle"),
  historyBody: document.getElementById("historyBody"),
  historyTitle: document.getElementById("historyTitle"),
  accordionTemplate: document.getElementById("accordionTemplate"),
};

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthNameEs(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, 1);
  return date.toLocaleString("es-NI", { month: "long" });
}

function loadFromCache(monthKey) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const timestamp = Number(localStorage.getItem(CACHE_TIME_KEY) || 0);
    if (!raw || Date.now() - timestamp > CACHE_TTL_MS) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.month !== monthKey || !Array.isArray(parsed.data)) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function saveToCache(monthKey, data) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ month: monthKey, data }));
  localStorage.setItem(CACHE_TIME_KEY, String(Date.now()));
}

async function fetchHistoryHtml(monthKey) {
  const body = new URLSearchParams({
    _method: "POST",
    "data[Lottery][name]": "Loto Diaria",
    "data[Lottery][date]": monthKey,
  });

  const attempts = [SOURCE_URL, ...SOURCE_PROXY_URLS.map((buildUrl) => buildUrl(SOURCE_URL))];
  const errors = [];

  for (const requestUrl of attempts) {
    try {
      const response = await fetch(requestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        cache: "no-store",
      });

      if (!response.ok) {
        errors.push(`${requestUrl} → HTTP ${response.status}`);
        continue;
      }

      const html = await response.text();
      if (!html.includes("Loto Nicaragua Números Ganadores Anteriores")) {
        errors.push(`${requestUrl} → respuesta inesperada`);
        continue;
      }

      return html;
    } catch (error) {
      errors.push(`${requestUrl} → ${error.message}`);
    }
  }

  throw new Error(
    `No se pudo consultar yelu.com.ni (bloqueo de red/CORS). Intentos: ${errors.join(" | ")}`
  );
}

function normalizeHour(value) {
  const hour = (value || "").replace(/\s+/g, "").toUpperCase();
  return HOURS.includes(hour) ? hour : "";
}

function parseSpanishDate(value) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+(\d{4})/i);
  if (!match) return "";

  const months = {
    enero: "01",
    febrero: "02",
    marzo: "03",
    abril: "04",
    mayo: "05",
    junio: "06",
    julio: "07",
    agosto: "08",
    septiembre: "09",
    setiembre: "09",
    octubre: "10",
    noviembre: "11",
    diciembre: "12",
  };

  const day = String(Number(match[1])).padStart(2, "0");
  const month = months[match[2].toLowerCase()];
  const year = match[3];

  return month ? `${year}-${month}-${day}` : "";
}

function parseLotteryHtml(html, monthKey) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const rows = [];

  doc.querySelectorAll("table tr").forEach((tr) => {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 3) return;

    const fecha = parseSpanishDate(tds[0].textContent || "");
    if (!fecha || !fecha.startsWith(monthKey)) return;

    const hora = normalizeHour(tds[1].querySelector("sup")?.textContent || "");
    if (!hora) return;

    const digits = [...tds[2].querySelectorAll(".lotto_no_r")]
      .map((node) => (node.textContent || "").trim())
      .filter((v) => /^\d$/.test(v));

    if (digits.length >= 2) {
      rows.push({
        fecha,
        hora,
        numero: `${digits[0]}${digits[1]}`,
      });
    }
  });

  return rows.sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
}

/** Crea lista ["00", ... "99"]. */
function getAllNumbers() {
  return Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));
}

function analyzeData(data) {
  const allNumbers = getAllNumbers();
  const frequency = Object.fromEntries(allNumbers.map((n) => [n, 0]));
  const lastSeen = Object.fromEntries(allNumbers.map((n) => [n, -1]));

  data.forEach((draw, idx) => {
    frequency[draw.numero] += 1;
    lastSeen[draw.numero] = idx;
  });

  const used = data.map((d) => d.numero);
  const uniqueUsed = [...new Set(used)];
  const noSalidos = allNumbers.filter((n) => !uniqueUsed.includes(n));
  const repetidos = allNumbers.filter((n) => frequency[n] > 1);
  const muyRepetidos = allNumbers.filter((n) => frequency[n] > 2);

  const invertidos = allNumbers.filter((n) => {
    const inv = n[1] + n[0];
    return inv !== n && frequency[n] > 0 && frequency[inv] > 0;
  });

  const totalDraws = data.length;
  const distances = Object.fromEntries(
    allNumbers.map((n) => [n, lastSeen[n] === -1 ? totalDraws : totalDraws - 1 - lastSeen[n]])
  );

  const maxFreq = Math.max(...Object.values(frequency), 1);
  const scores = Object.fromEntries(
    allNumbers.map((n) => {
      const noSalido = noSalidos.includes(n) ? 1 : 0;
      const distancia = distances[n];
      const bajaFrecuencia = maxFreq - frequency[n];
      const invertidoDetectado = frequency[n[1] + n[0]] > 0 ? 1 : 0;
      const score = noSalido * 3 + distancia * 2 + bajaFrecuencia * 2 + invertidoDetectado;
      return [n, score];
    })
  );

  const expansionModel = allNumbers
    .map((n) => ({ n, score: scores[n], distance: distances[n], freq: frequency[n] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return { allNumbers, frequency, noSalidos, repetidos, muyRepetidos, invertidos, distances, scores, expansionModel, dataPoints: totalDraws };
}

function cellClass(number, analysis) {
  const freq = analysis.frequency[number];
  const isDouble = number[0] === number[1];
  const isEven = Number(number) % 2 === 0;

  if (analysis.noSalidos.includes(number)) return isEven ? "no-salido-par" : "no-salido-impar";
  if (isDouble) return "salio-doble";
  if (analysis.invertidos.includes(number)) return "invertido";
  if (freq > 2) return "muy-repetido";
  if (freq > 1) return "repetido";
  return "salio";
}

function formatDrawEntry(draw) {
  if (!draw) return "Aún no ha salido";
  const [year, month, day] = draw.fecha.split("-");
  const shortYear = year.slice(-2);
  const label = HOUR_LABELS[draw.hora] || draw.hora;
  return `Jugó el ${day} - ${month} - ${shortYear} a las ${label}`;
}

function buildNumberDetail(number, analysis) {
  const drawList = appState.data.filter((d) => d.numero === number);
  const inverse = `${number[1]}${number[0]}`;
  const inverseSeen = analysis.frequency[inverse] > 0;

  return [
    `<strong>${number}</strong>`,
    drawList.length === 0 ? "Aún no ha salido." : drawList.length === 1 ? "Salió 1 vez en el mes." : `Ha salido ${drawList.length} veces en el mes.`,
    formatDrawEntry(drawList[drawList.length - 1]),
    drawList.length > 1 ? formatDrawEntry(drawList[drawList.length - 2]) : "",
    inverseSeen ? `Es el invertido del ${inverse}.` : `Su invertido (${inverse}) todavía no sale.`,
  ]
    .filter(Boolean)
    .join("<br>");
}

function showGridTooltip(content, x, y) {
  let tooltip = document.querySelector(".grid-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "grid-tooltip";
    document.body.appendChild(tooltip);
  }
  tooltip.innerHTML = content;
  const pad = 12;
  const maxX = window.innerWidth - 300;
  const maxY = window.innerHeight - 150;
  tooltip.style.left = `${Math.max(8, Math.min(x + pad, maxX))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(y + pad, maxY))}px`;
}

function renderGrid(analysis) {
  els.numberGrid.innerHTML = "";
  els.numberGrid.style.gridTemplateColumns = `repeat(${appState.gridColumns}, minmax(0, 1fr))`;

  const numbersByStart =
    appState.gridStartWith === "01"
      ? [...analysis.allNumbers.slice(1), analysis.allNumbers[0]]
      : analysis.allNumbers.slice();
  const orderedNumbers = appState.gridSortDirection === "desc" ? numbersByStart.slice().reverse() : numbersByStart;

  orderedNumbers.forEach((number) => {
    const div = document.createElement("div");
    div.className = `cell ${cellClass(number, analysis)}`.trim();
    div.textContent = number;
    div.addEventListener("click", (event) => {
      showGridTooltip(buildNumberDetail(number, analysis), event.clientX, event.clientY);
    });
    els.numberGrid.appendChild(div);
  });
}

function renderAccordion(data) {
  els.hourAccordion.innerHTML = "";
  HOURS.forEach((hour) => {
    const filtered = data.filter((d) => d.hora === hour).slice(-30).reverse();
    const fragment = els.accordionTemplate.content.cloneNode(true);
    const details = fragment.querySelector("details");
    const summary = fragment.querySelector("summary");
    const content = fragment.querySelector(".accordion-content");

    summary.textContent = `${HOUR_LABELS[hour]} · ${filtered.length} sorteos`;
    details.open = false;

    filtered.forEach((draw) => {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = `${draw.fecha} → ${draw.numero}`;
      content.appendChild(pill);
    });

    if (!filtered.length) content.textContent = "Sin datos para esta hora.";

    els.hourAccordion.appendChild(fragment);
  });
}

function renderHistory(data) {
  els.historyBody.innerHTML = "";
  data.slice().reverse().slice(0, 200).forEach((draw) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${draw.fecha}</td><td>${draw.hora}</td><td><strong>${draw.numero}</strong></td>`;
    els.historyBody.appendChild(tr);
  });
}

function renderTop(analysis) {
  const top = analysis.expansionModel.slice(0, 5);
  appState.currentTopFive = top.map((x) => x.n);
  els.topRecommendations.innerHTML = "";
  top.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.n} · ${item.freq === 0 ? "No ha salido este mes" : `Salió ${item.freq} ${item.freq === 1 ? "vez" : "veces"}`} · ${item.distance} sorteos sin aparecer`;
    els.topRecommendations.appendChild(li);
  });
}

function drawPyramid(numbers) {
  const rows = [1, 2, 3, 4];
  let idx = 0;
  return rows
    .map((size) => {
      const rowNumbers = numbers.slice(idx, idx + size).join(" ");
      idx += size;
      return rowNumbers.padStart(Math.floor((20 + rowNumbers.length) / 2), " ");
    })
    .join("\n");
}

function drawCross(numbers) {
  const n = numbers.slice(0, 9);
  return [
    `   ${n[0]}   `,
    ` ${n[1]} ${n[2]} `,
    `${n[3]} ${n[4]} ${n[5]}`,
    ` ${n[6]} ${n[7]} `,
    `   ${n[8]}   `,
  ].join("\n");
}

function renderAlgorithmPanels(analysis) {
  const top10 = analysis.expansionModel.slice(0, 10).map((x) => x.n);
  const kolmogorovSignal = analysis.expansionModel
    .slice(0, 5)
    .map((x) => `${x.n}:${Math.max(0.1, 1 - x.freq / Math.max(1, analysis.dataPoints)).toFixed(2)}`)
    .join(" · ");

  const gambler = analysis.noSalidos.slice(0, 5).join(", ") || "Ninguno";
  const pareto = analysis.expansionModel
    .filter((x) => x.distance > 6 || x.freq === 0)
    .slice(0, 5)
    .map((x) => x.n)
    .join(", ");

  const cards = [
    {
      title: "Pirámide",
      note: "Jerarquiza por oportunidad del algoritmo.",
      shape: drawPyramid(top10),
    },
    {
      title: "Cruce",
      note: "Cruza tendencia reciente y números fríos.",
      shape: drawCross(top10),
    },
    {
      title: "Andrey Kolmogorov (complejidad)",
      note: "Señal estimada por irregularidad histórica (más alto = menos patrón repetido).",
      shape: kolmogorovSignal,
    },
    {
      title: "Falacia del apostador",
      note: "Estos parecen 'deber salir', pero recuerda: cada sorteo sigue siendo independiente.",
      shape: gambler,
    },
    {
      title: "Teoría de juego (Pareto)",
      note: "Grupo eficiente: balance entre números atrasados y baja repetición.",
      shape: pareto || "Sin conjunto eficiente claro",
    },
  ];

  els.algorithmPanels.innerHTML = "";
  cards.forEach((card) => {
    const el = document.createElement("article");
    el.className = "algo-card";
    el.innerHTML = `<div class="algo-title">${card.title}</div><div class="algo-note">${card.note}</div><div class="shape">${card.shape}</div>`;
    els.algorithmPanels.appendChild(el);
  });
}

function renderAll(data, analysis) {
  renderGrid(analysis);
  renderTop(analysis);
  renderAlgorithmPanels(analysis);
  renderAccordion(data);
  renderHistory(data);
}

function setGridSortButtonLabel() {
  const label = appState.gridSortDirection === "asc" ? "Ascendente" : "Descendente";
  els.gridSortBtn.textContent = `Orden: ${label}`;
}

function showNoMonthlyData(monthKey) {
  const month = monthNameEs(monthKey);
  const monthCap = month.charAt(0).toUpperCase() + month.slice(1);
  els.hourPanelTitle.textContent = `Panel por hora del mes de ${monthCap}`;
  els.historyTitle.textContent = `Historial del mes de ${monthCap}`;
  els.numberGrid.innerHTML = "";
  els.topRecommendations.innerHTML = "";
  els.algorithmPanels.innerHTML = "";
  els.hourAccordion.innerHTML = "";
  els.historyBody.innerHTML = `<tr><td colspan=\"3\">Aún no hay sorteos para ${monthCap}. Puedes consultar el mes anterior para estimar el primer número de ${monthCap}.</td></tr>`;
  els.generatedPlay.textContent = "Sin jugada sugerida por falta de sorteos en el mes actual.";
}

function getNextHourLabel() {
  const now = new Date();
  const hour = now.getHours();
  if (hour < 12) return HOUR_LABELS["12PM"];
  if (hour < 15) return HOUR_LABELS["3PM"];
  if (hour < 18) return HOUR_LABELS["6PM"];
  if (hour < 21) return HOUR_LABELS["9PM"];
  return HOUR_LABELS["12PM"];
}

function generatePlay(analysis) {
  const selected = appState.currentTopFive.length ? appState.currentTopFive : analysis.expansionModel.slice(0, 5).map((x) => x.n);
  const nextHour = getNextHourLabel();
  els.generatedPlay.textContent = `Recomendado para las ${nextHour}: ${selected.join(", ")}.`;
}

async function refreshData(force = false) {
  const monthKey = getCurrentMonthKey();

  try {
    els.status.textContent = `Cargando datos del mes ${monthKey}…`;

    let data = !force ? loadFromCache(monthKey) : null;
    if (!data) {
      const html = await fetchHistoryHtml(monthKey);
      data = parseLotteryHtml(html, monthKey);
      saveToCache(monthKey, data);
    }

    appState.activeMonth = monthKey;

    if (!data.length) {
      appState = { ...appState, data: [], analysis: null };
      showNoMonthlyData(monthKey);
      els.status.textContent = `Sin sorteos para ${monthKey}.`;
      return;
    }

    const analysis = analyzeData(data);
    appState = { ...appState, data, analysis };
    const monthCap = monthNameEs(monthKey).replace(/^./, (s) => s.toUpperCase());
    els.hourPanelTitle.textContent = `Panel por hora del mes de ${monthCap}`;
    els.historyTitle.textContent = `Historial del mes de ${monthCap}`;
    renderAll(data, analysis);

    const last = data[data.length - 1];
    const updatedAt = new Date().toLocaleString();
    els.status.textContent = `OK · ${data.length} sorteos cargados (${monthKey}) · Último: ${last.fecha} ${last.hora} ${last.numero} · ${updatedAt}`;
  } catch (error) {
    console.error(error);
    els.status.textContent = `Error: ${error.message}`;
  }
}

els.refreshBtn.addEventListener("click", () => refreshData(true));
els.generatePlayBtn.addEventListener("click", () => {
  if (!appState.analysis) return;
  generatePlay(appState.analysis);
});
els.gridColumnsSelect.addEventListener("change", (event) => {
  const selectedColumns = Number(event.target.value);
  if (Number.isNaN(selectedColumns)) return;
  appState.gridColumns = selectedColumns;
  if (appState.analysis) renderGrid(appState.analysis);
});
els.gridStartSelect.addEventListener("change", (event) => {
  const startWith = event.target.value === "01" ? "01" : "00";
  appState.gridStartWith = startWith;
  if (appState.analysis) renderGrid(appState.analysis);
});
els.gridSortBtn.addEventListener("click", () => {
  appState.gridSortDirection = appState.gridSortDirection === "asc" ? "desc" : "asc";
  setGridSortButtonLabel();
  if (appState.analysis) renderGrid(appState.analysis);
});

document.addEventListener("click", (event) => {
  if (event.target.closest(".cell")) return;
  const tooltip = document.querySelector(".grid-tooltip");
  if (tooltip) tooltip.remove();
});

refreshData();
setGridSortButtonLabel();
