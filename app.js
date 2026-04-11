const SOURCE_URL = "https://www.yelu.com.ni/lottery/results/history";
const SOURCE_PROXY_URLS = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://proxy.cors.sh/${url}`,
  (url) => `https://cors.isomorphic-git.org/${url}`,
];
const CACHE_KEY = "lotoData";
const CACHE_TIME_KEY = "lotoDataUpdatedAt";
const FORCED_UPDATE_KEY = "lotoForcedUpdateAt";
const PREDICTION_PENDING_KEY = "lotoPredictionPending";
const PREDICTION_RESULTS_KEY = "lotoPredictionResults";
const CACHE_TTL_MS = 30 * 60 * 1000;
const HOURS = ["12PM", "3PM", "6PM", "9PM"];
const HOUR_LABELS = { "12PM": "12:00pm", "3PM": "3:00pm", "6PM": "6:00pm", "9PM": "9:00pm" };
const GAME_SCHEDULE = {
  "12PM": { hour: 12, minute: 0, label: "12:00pm" },
  "3PM": { hour: 15, minute: 0, label: "3:00pm" },
  "6PM": { hour: 18, minute: 0, label: "6:00pm" },
  "9PM": { hour: 21, minute: 0, label: "9:00pm" },
};

let appState = {
  data: [],
  analysis: null,
  activeMonth: "",
  currentTopFive: [],
  gridColumns: 8,
  gridSortDirection: "asc",
  gridStartWith: "01",
};

const els = {
  status: document.getElementById("status"),
  refreshBtn: document.getElementById("refreshBtn"),
  generatePlayBtn: document.getElementById("generatePlayBtn"),
  numberGrid: document.getElementById("numberGrid"),
  topRecommendations: document.getElementById("topRecommendations"),
  generatedPlay: document.getElementById("generatedPlay"),
  lastDrawHighlight: document.getElementById("lastDrawHighlight"),
  gridColumnsSelect: document.getElementById("gridColumnsSelect"),
  gridStartSelect: document.getElementById("gridStartSelect"),
  gridSortBtn: document.getElementById("gridSortBtn"),
  algorithmPanels: document.getElementById("algorithmPanels"),
  hourAccordion: document.getElementById("hourAccordion"),
  hourPanelTitle: document.getElementById("hourPanelTitle"),
  historyBody: document.getElementById("historyBody"),
  historyTitle: document.getElementById("historyTitle"),
  predictionStatsBody: document.getElementById("predictionStatsBody"),
  predictionStatsSummary: document.getElementById("predictionStatsSummary"),
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

function getStoredArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getPendingPrediction() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREDICTION_PENDING_KEY) || "null");
    if (!parsed || !Array.isArray(parsed.numbers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePendingPrediction(prediction) {
  localStorage.setItem(PREDICTION_PENDING_KEY, JSON.stringify(prediction));
}

function clearPendingPrediction() {
  localStorage.removeItem(PREDICTION_PENDING_KEY);
}

function drawHourSortValue(hour) {
  const schedule = GAME_SCHEDULE[hour];
  return schedule ? schedule.hour * 60 + schedule.minute : 0;
}

function drawToDate(draw) {
  const [year, month, day] = draw.fecha.split("-").map(Number);
  const schedule = GAME_SCHEDULE[draw.hora];
  if (!schedule) return new Date(0);
  return new Date(year, month - 1, day, schedule.hour, schedule.minute, 0, 0);
}

function getPassedGameSlots(fromDate, toDate) {
  if (!(fromDate instanceof Date) || !(toDate instanceof Date) || Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || toDate <= fromDate) {
    return [];
  }

  const slots = [];
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(23, 59, 59, 999);
  while (cursor <= end) {
    Object.entries(GAME_SCHEDULE).forEach(([hourKey, schedule]) => {
      const slot = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), schedule.hour, schedule.minute, 0, 0);
      if (slot > fromDate && slot <= toDate) slots.push({ hourKey, at: slot });
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots.sort((a, b) => a.at - b.at);
}

function shouldForceRefreshBySchedule(lastKnownDraw = null) {
  const now = new Date();
  const lastForced = Number(localStorage.getItem(FORCED_UPDATE_KEY) || 0);
  const forcedDate = lastForced ? new Date(lastForced) : null;

  if (!lastForced || !forcedDate || Number.isNaN(forcedDate.getTime())) {
    return { shouldUpdate: true, reason: "Primera actualización manual." };
  }

  if (forcedDate > now) {
    return { shouldUpdate: true, reason: "Se detectó hora guardada en el futuro; se reintenta actualización." };
  }

  const passedSinceForce = getPassedGameSlots(forcedDate, now);
  if (passedSinceForce.length > 0) {
    const lastSlot = passedSinceForce[passedSinceForce.length - 1];
    return { shouldUpdate: true, reason: `Ya pasó el sorteo de ${GAME_SCHEDULE[lastSlot.hourKey].label}.` };
  }

  if (lastKnownDraw) {
    const drawDate = drawToDate(lastKnownDraw);
    if (!Number.isNaN(drawDate.getTime()) && drawDate < now) {
      const passedSinceLastDraw = getPassedGameSlots(drawDate, now);
      if (passedSinceLastDraw.length > 0) {
        const lastSlot = passedSinceLastDraw[passedSinceLastDraw.length - 1];
        return {
          shouldUpdate: true,
          reason: `El último sorteo guardado es anterior al horario de ${GAME_SCHEDULE[lastSlot.hourKey].label}.`,
        };
      }
    }
  }

  return { shouldUpdate: false, reason: "Aún no pasa el próximo horario de sorteo desde la última actualización." };
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

  return rows.sort((a, b) => {
    if (a.fecha === b.fecha) return drawHourSortValue(a.hora) - drawHourSortValue(b.hora);
    return a.fecha.localeCompare(b.fecha);
  });
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

  if (analysis.noSalidos.includes(number)) {
    if (isDouble) return isEven ? "no-salido-doble-par" : "no-salido-doble-impar";
    return isEven ? "no-salido-par" : "no-salido-impar";
  }
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
  savePendingPrediction({
    predictedAt: new Date().toISOString(),
    targetHour: getNextHourKey(),
    numbers: appState.currentTopFive.slice(0, 5),
  });
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

  const predictionDriven = buildPredictionDrivenTop(analysis);
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
    {
      title: "Según predicciones",
      note: "Ajusta por rendimiento histórico de aciertos/desaciertos guardados.",
      shape: predictionDriven.length ? predictionDriven.join(", ") : "Aún no hay datos suficientes.",
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

function resolvePredictionResults(data) {
  const pending = getPendingPrediction();
  if (!pending) return;

  const predictionTime = new Date(pending.predictedAt);
  if (Number.isNaN(predictionTime.getTime())) {
    clearPendingPrediction();
    return;
  }

  const upcomingDraws = data.filter((draw) => drawToDate(draw) > predictionTime);
  if (!upcomingDraws.length) return;

  const draw = upcomingDraws[0];
  const results = getStoredArray(PREDICTION_RESULTS_KEY);
  const drawId = `${draw.fecha}_${draw.hora}`;
  if (results.some((item) => item.drawId === drawId)) {
    clearPendingPrediction();
    return;
  }

  const hit = pending.numbers.includes(draw.numero);
  results.push({
    drawId,
    drawNumber: draw.numero,
    drawDate: draw.fecha,
    drawHour: draw.hora,
    predictedAt: pending.predictedAt,
    predictionHour: pending.targetHour,
    numbers: pending.numbers.slice(0, 5),
    hit,
  });
  localStorage.setItem(PREDICTION_RESULTS_KEY, JSON.stringify(results));
  clearPendingPrediction();
}

function buildPredictionDrivenTop(analysis) {
  const results = getStoredArray(PREDICTION_RESULTS_KEY);
  if (results.length < 3) return [];

  const perNumber = Object.fromEntries(analysis.allNumbers.map((n) => [n, { hits: 0, misses: 0 }]));
  results.forEach((item) => {
    (item.numbers || []).forEach((n) => {
      if (!perNumber[n]) return;
      if (item.drawNumber === n) perNumber[n].hits += 1;
      else perNumber[n].misses += 1;
    });
  });

  return analysis.allNumbers
    .map((n) => {
      const stats = perNumber[n];
      const attempts = stats.hits + stats.misses;
      if (!attempts) return { n, score: -Infinity };
      const precision = stats.hits / attempts;
      const baseScore = analysis.scores[n] || 0;
      const score = precision * 8 + stats.hits * 2 + baseScore * 0.15;
      return { n, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => item.n);
}

function renderPredictionStats() {
  if (!els.predictionStatsBody || !els.predictionStatsSummary) return;
  const results = getStoredArray(PREDICTION_RESULTS_KEY);
  els.predictionStatsBody.innerHTML = "";

  if (!results.length) {
    els.predictionStatsSummary.textContent = "Aún no hay resultados registrados.";
    els.predictionStatsBody.innerHTML = `<tr><td colspan="5">Cuando ocurra un nuevo sorteo tras actualizar, aquí verás aciertos y desaciertos.</td></tr>`;
    return;
  }

  const total = results.length;
  const hits = results.filter((item) => item.hit).length;
  const misses = total - hits;
  const hitRate = ((hits / total) * 100).toFixed(1);
  els.predictionStatsSummary.textContent = `Total: ${total} · Aciertos: ${hits} · Desaciertos: ${misses} · Efectividad: ${hitRate}%`;

  results
    .slice()
    .reverse()
    .slice(0, 120)
    .forEach((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${item.drawDate}</td><td>${HOUR_LABELS[item.drawHour] || item.drawHour}</td><td>${item.numbers.join(", ")}</td><td><strong>${item.drawNumber}</strong></td><td>${item.hit ? "✅ Acierto" : "❌ Desacierto"}</td>`;
      els.predictionStatsBody.appendChild(tr);
    });
}

function renderAll(data, analysis) {
  renderGrid(analysis);
  renderTop(analysis);
  generatePlay(analysis);
  renderAlgorithmPanels(analysis);
  renderAccordion(data);
  renderHistory(data);
  renderPredictionStats();
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
  els.lastDrawHighlight.textContent = "Último sorteo: --";
}

function getNextHourKey() {
  const now = new Date();
  const hour = now.getHours();
  if (hour < 12) return "12PM";
  if (hour < 15) return "3PM";
  if (hour < 18) return "6PM";
  if (hour < 21) return "9PM";
  return "12PM";
}

function generatePlay(analysis) {
  const selected = appState.currentTopFive.length ? appState.currentTopFive : analysis.expansionModel.slice(0, 5).map((x) => x.n);
  const nextHourKey = getNextHourKey();
  els.generatedPlay.textContent = `Recomendado para las ${HOUR_LABELS[nextHourKey]}: ${selected.join(", ")}.`;
}

async function refreshData(force = false) {
  const monthKey = getCurrentMonthKey();

  try {
    els.status.textContent = `Cargando datos del mes ${monthKey}…`;

    let data = !force ? loadFromCache(monthKey) : null;
    let reason = "";

    if (force) {
      const latestKnownDraw = (data && data[data.length - 1]) || (appState.data.length ? appState.data[appState.data.length - 1] : null);
      const decision = shouldForceRefreshBySchedule(latestKnownDraw);
      if (!decision.shouldUpdate) {
        reason = decision.reason;
        data = loadFromCache(monthKey) || appState.data;
      }
    }

    if (!data) {
      const html = await fetchHistoryHtml(monthKey);
      data = parseLotteryHtml(html, monthKey);
      saveToCache(monthKey, data);
      if (force) localStorage.setItem(FORCED_UPDATE_KEY, String(Date.now()));
    }

    appState.activeMonth = monthKey;

    if (!data.length) {
      appState = { ...appState, data: [], analysis: null };
      showNoMonthlyData(monthKey);
      els.status.textContent = `Sin sorteos para ${monthKey}.`;
      return;
    }

    resolvePredictionResults(data);
    const analysis = analyzeData(data);
    appState = { ...appState, data, analysis };
    const monthCap = monthNameEs(monthKey).replace(/^./, (s) => s.toUpperCase());
    els.hourPanelTitle.textContent = `Panel por hora del mes de ${monthCap}`;
    els.historyTitle.textContent = `Historial del mes de ${monthCap}`;
    renderAll(data, analysis);

    const last = data[data.length - 1];
    const updatedAt = new Date().toLocaleString();
    els.lastDrawHighlight.textContent = `Último sorteo: ${last.fecha} · ${HOUR_LABELS[last.hora] || last.hora} · ${last.numero}`;
    if (reason) {
      els.status.textContent = `Sin actualización remota: ${reason} · Usando caché local (${data.length} sorteos).`;
    } else {
      els.status.textContent = `OK · ${data.length} sorteos cargados (${monthKey}) · ${updatedAt}`;
    }
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
