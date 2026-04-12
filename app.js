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
const PERSONAL_GAME_KEY = "lotoPersonalGameNumbers";
const VIEW_MODE_KEY = "lotoViewMode";
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
  visibleDrawIndex: -1,
  currentTopFive: [],
  gridColumns: 10,
  gridSortDirection: "asc",
  gridStartWith: "01",
  viewMode: "default",
  personalGameNumbers: [],
};

const els = {
  status: document.getElementById("status"),
  refreshBtn: document.getElementById("refreshBtn"),
  generatePlayBtn: document.getElementById("generatePlayBtn"),
  numberGrid: document.getElementById("numberGrid"),
  prevDrawBtn: document.getElementById("prevDrawBtn"),
  nextDrawBtn: document.getElementById("nextDrawBtn"),
  timelineLabel: document.getElementById("timelineLabel"),
  topRecommendations: document.getElementById("topRecommendations"),
  realtimeRecommendations: document.getElementById("realtimeRecommendations"),
  generatedPlay: document.getElementById("generatedPlay"),
  lastDrawHighlight: document.getElementById("lastDrawHighlight"),
  gridColumnsSelect: document.getElementById("gridColumnsSelect"),
  gridStartSelect: document.getElementById("gridStartSelect"),
  viewModeSelect: document.getElementById("viewModeSelect"),
  gridSortBtn: document.getElementById("gridSortBtn"),
  algorithmPanels: document.getElementById("algorithmPanels"),
  hourAccordion: document.getElementById("hourAccordion"),
  hourPanelTitle: document.getElementById("hourPanelTitle"),
  historyBody: document.getElementById("historyBody"),
  historyTitle: document.getElementById("historyTitle"),
  predictionStatsBody: document.getElementById("predictionStatsBody"),
  predictionStatsSummary: document.getElementById("predictionStatsSummary"),
  accordionTemplate: document.getElementById("accordionTemplate"),
  personalGameSummary: document.getElementById("personalGameSummary"),
  personalGameNumbers: document.getElementById("personalGameNumbers"),
  clearPersonalGameBtn: document.getElementById("clearPersonalGameBtn"),
};

function getVisibleData() {
  if (!Array.isArray(appState.data) || !appState.data.length) return [];
  const clamped = Math.max(0, Math.min(appState.visibleDrawIndex, appState.data.length - 1));
  return appState.data.slice(0, clamped + 1);
}

function isTimelineAtLatest() {
  return appState.visibleDrawIndex >= appState.data.length - 1;
}

function formatTimelineLabel(draw) {
  if (!draw) return "--";
  const [year, month, day] = draw.fecha.split("-");
  const hourLabel = HOUR_LABELS[draw.hora] || draw.hora;
  return `${day}/${month}/${year} ${hourLabel}`;
}

function renderTimelineControls() {
  const hasData = appState.data.length > 0;
  if (!hasData) {
    els.prevDrawBtn.disabled = true;
    els.nextDrawBtn.disabled = true;
    els.timelineLabel.textContent = "--";
    return;
  }
  const minIndex = 0;
  const maxIndex = appState.data.length - 1;
  const clamped = Math.max(minIndex, Math.min(appState.visibleDrawIndex, maxIndex));
  appState.visibleDrawIndex = clamped;
  els.prevDrawBtn.disabled = clamped <= minIndex;
  els.nextDrawBtn.disabled = clamped >= maxIndex;
  els.timelineLabel.textContent = formatTimelineLabel(appState.data[clamped]);
}

function renderByTimeline() {
  const visibleData = getVisibleData();
  if (!visibleData.length) return;
  const analysis = analyzeData(visibleData);
  appState.analysis = analysis;
  renderAll(visibleData, analysis);
  const current = visibleData[visibleData.length - 1];
  els.lastDrawHighlight.textContent = `Sorteo en vista: ${current.fecha} · ${HOUR_LABELS[current.hora] || current.hora} · ${current.numero}`;
  renderTimelineControls();
}

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

function loadPersonalGameNumbers() {
  return getStoredArray(PERSONAL_GAME_KEY)
    .filter((n) => /^\d{2}$/.test(n))
    .sort();
}

function savePersonalGameNumbers() {
  localStorage.setItem(PERSONAL_GAME_KEY, JSON.stringify(appState.personalGameNumbers));
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
  if (freq > 1) return "repetido";
  if (isDouble) return "salio-doble";
  if (analysis.invertidos.includes(number)) return "invertido";
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
  const drawList = getVisibleData().filter((d) => d.numero === number);
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

function isPersonalNumberSelected(number) {
  return appState.personalGameNumbers.includes(number);
}

function togglePersonalGameNumber(number, selected) {
  const set = new Set(appState.personalGameNumbers);
  if (selected) set.add(number);
  else set.delete(number);
  appState.personalGameNumbers = Array.from(set).sort();
  savePersonalGameNumbers();
}

function buildPersonalGameControl(number) {
  const checked = isPersonalNumberSelected(number) ? "checked" : "";
  return `<label class="personal-check"><input type="checkbox" class="personal-check-input" data-number="${number}" ${checked}> Armar jugada personal</label>`;
}

function showGridTooltip(content, x, y) {
  let tooltip = document.querySelector(".grid-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "grid-tooltip";
    document.body.appendChild(tooltip);
  }
  tooltip.innerHTML = `<button type="button" class="tooltip-close-btn" aria-label="Cerrar detalle">×</button>${content}`;
  const pad = 12;
  const maxX = window.innerWidth - 300;
  const maxY = window.innerHeight - 150;
  tooltip.style.left = `${Math.max(8, Math.min(x + pad, maxX))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(y + pad, maxY))}px`;
}

function closeGridTooltip() {
  const tooltip = document.querySelector(".grid-tooltip");
  if (tooltip) tooltip.remove();
}

function getNextDrawInfo(referenceDate = new Date()) {
  const now = referenceDate instanceof Date ? referenceDate : new Date();
  const slots = Object.entries(GAME_SCHEDULE)
    .map(([hourKey, schedule]) => ({ hourKey, schedule }))
    .sort((a, b) => a.schedule.hour - b.schedule.hour || a.schedule.minute - b.schedule.minute);

  const nextToday = slots.find(({ schedule }) => {
    const slotTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), schedule.hour, schedule.minute, 0, 0);
    return slotTime > now;
  });

  if (nextToday) {
    return {
      hourKey: nextToday.hourKey,
      at: new Date(now.getFullYear(), now.getMonth(), now.getDate(), nextToday.schedule.hour, nextToday.schedule.minute, 0, 0),
      isTomorrow: false,
    };
  }

  const first = slots[0];
  return {
    hourKey: first.hourKey,
    at: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, first.schedule.hour, first.schedule.minute, 0, 0),
    isTomorrow: true,
  };
}

function buildSlotDate(baseDate, hourKey) {
  const schedule = GAME_SCHEDULE[hourKey];
  if (!schedule || !(baseDate instanceof Date) || Number.isNaN(baseDate.getTime())) return null;
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), schedule.hour, schedule.minute, 0, 0);
}

function isPendingPredictionCurrent(pending, referenceDate = new Date()) {
  if (!pending || !pending.targetHour || !pending.predictedAt) return false;
  const predictedAt = new Date(pending.predictedAt);
  if (Number.isNaN(predictedAt.getTime())) return false;

  let targetAt = buildSlotDate(predictedAt, pending.targetHour);
  if (!targetAt) return false;
  if (targetAt <= predictedAt) targetAt = new Date(targetAt.getTime() + 24 * 60 * 60 * 1000);
  return targetAt > referenceDate;
}

function renderPersonalGameSection() {
  if (!els.personalGameNumbers || !els.personalGameSummary) return;
  const numbers = appState.personalGameNumbers.slice().sort();
  els.personalGameSummary.textContent = `Juego armado (${numbers.length})`;

  if (!numbers.length) {
    els.personalGameNumbers.innerHTML = `<p class="hint">No has seleccionado números todavía.</p>`;
    return;
  }

  els.personalGameNumbers.innerHTML = numbers
    .map((number) => `<span class="pill personal-pill">${number}</span>`)
    .join("");
}

function renderGrid(analysis) {
  els.numberGrid.innerHTML = "";
  els.numberGrid.style.gridTemplateColumns = `repeat(${appState.gridColumns}, minmax(0, 1fr))`;
  const colorSequenceMap = appState.viewMode === "colorSequence" ? buildColorSequenceMap(appState.data) : null;
  const numberSequenceMap = appState.viewMode === "numberSequence" ? buildNumberSequenceMap(appState.data) : null;

  const numbersByStart =
    appState.gridStartWith === "01"
      ? [...analysis.allNumbers.slice(1), analysis.allNumbers[0]]
      : analysis.allNumbers.slice();
  const orderedNumbers = appState.gridSortDirection === "desc" ? numbersByStart.slice().reverse() : numbersByStart;

  orderedNumbers.forEach((number) => {
    const div = document.createElement("div");
    div.className = `cell ${cellClass(number, analysis)}`.trim();
    if (appState.viewMode === "colorSequence") {
      div.innerHTML = renderColorSequenceCell(number, colorSequenceMap);
    } else if (appState.viewMode === "numberSequence") {
      div.innerHTML = renderNumberSequenceCell(number, numberSequenceMap);
    } else {
      div.textContent = number;
    }
    div.addEventListener("click", (event) => {
      const detail = buildNumberDetail(number, analysis);
      const control = buildPersonalGameControl(number);
      showGridTooltip(`${detail}<br>${control}`, event.clientX, event.clientY);
    });
    if (isPersonalNumberSelected(number)) div.classList.add("selected-personal");
    els.numberGrid.appendChild(div);
  });
}

function renderColorSequenceCell(number, colorSequenceMap) {
  const ratios = colorSequenceMap[number] || [];
  const segmentsHtml = ratios
    .map((ratio) => `<span style="background:${getColorByRatio(ratio)}"></span>`)
    .join("");
  const safeSegments = segmentsHtml || `<span style="background:transparent"></span>`;
  return `<div class="color-segments">${safeSegments}</div><div class="cell-number">${number}</div>`;
}

function renderNumberSequenceCell(number, numberSequenceMap) {
  const indexes = numberSequenceMap[number] || [];
  const indexesHtml = indexes.length ? `<div class="draw-indexes">${indexes.join(",")}</div>` : `<div class="draw-indexes"></div>`;
  return `${indexesHtml}<div class="cell-number">${number}</div>`;
}

function buildColorSequenceMap(data) {
  const totalDraws = Array.isArray(data) ? data.length : 0;
  const map = {};
  if (!totalDraws) return map;
  data.forEach((draw, index) => {
    if (!draw?.numero) return;
    const ratio = totalDraws <= 1 ? 0 : index / totalDraws;
    if (!map[draw.numero]) map[draw.numero] = [];
    map[draw.numero].push(ratio);
  });
  return map;
}

function buildNumberSequenceMap(data) {
  const map = {};
  if (!Array.isArray(data)) return map;
  data.forEach((draw, index) => {
    if (!draw?.numero) return;
    if (!map[draw.numero]) map[draw.numero] = [];
    map[draw.numero].push(index + 1);
  });
  return map;
}

function getColorByRatio(ratio) {
  const palette = [
    { at: 0, color: "#FFE100" },
    { at: 0.25, color: "#FFC917" },
    { at: 0.5, color: "#F8650C" },
    { at: 0.75, color: "#F00000" },
    { at: 1, color: "#8C0000" },
  ];

  const clamped = Math.min(1, Math.max(0, Number(ratio) || 0));
  const upperIndex = palette.findIndex((step) => clamped <= step.at);
  if (upperIndex <= 0) return palette[0].color;
  if (upperIndex === -1) return palette[palette.length - 1].color;

  const lower = palette[upperIndex - 1];
  const upper = palette[upperIndex];
  const localRatio = (clamped - lower.at) / (upper.at - lower.at || 1);
  return interpolateHexColor(lower.color, upper.color, localRatio);
}

function interpolateHexColor(colorA, colorB, ratio) {
  const normalize = (hex) => hex.replace("#", "");
  const toRgb = (hex) => {
    const clean = normalize(hex);
    return [0, 2, 4].map((start) => parseInt(clean.slice(start, start + 2), 16));
  };
  const [r1, g1, b1] = toRgb(colorA);
  const [r2, g2, b2] = toRgb(colorB);
  const clampRatio = Math.min(1, Math.max(0, ratio));
  const mix = (a, b) => Math.round(a + (b - a) * clampRatio);
  const toHex = (n) => n.toString(16).padStart(2, "0");
  return `#${toHex(mix(r1, r2))}${toHex(mix(g1, g2))}${toHex(mix(b1, b2))}`;
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
  const top = getAdaptiveTopFive(analysis);
  appState.currentTopFive = top.map((x) => x.n);
  const pending = getPendingPrediction();
  const sameNumbers =
    pending &&
    Array.isArray(pending.numbers) &&
    pending.numbers.length === appState.currentTopFive.length &&
    pending.numbers.every((value, idx) => value === appState.currentTopFive[idx]);
  const shouldRefreshPending = !sameNumbers || !isPendingPredictionCurrent(pending, new Date());
  if (shouldRefreshPending && isTimelineAtLatest()) {
    const nextDraw = getNextDrawInfo(new Date());
    const predictionId = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    savePendingPrediction({
      predictionId,
      predictedAt: new Date().toISOString(),
      targetHour: nextDraw.hourKey,
      numbers: appState.currentTopFive.slice(0, 5),
      remainingDraws: 4,
      evaluatedDrawIds: [],
    });
  }
  els.topRecommendations.innerHTML = "";
  top.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.n} | ${item.freq === 0 ? "No ha salido" : `${item.freq} vez${item.freq === 1 ? "" : "es"}`} | ${item.distance} sorteos`;
    els.topRecommendations.appendChild(li);
  });
}

function buildRealtimeSuggestions(data, analysis, limit = 2) {
  if (!Array.isArray(data) || data.length < 2 || !analysis) return [];

  const lastDraw = data[data.length - 1];
  const lastNumber = lastDraw?.numero;
  if (!lastNumber || !analysis.allNumbers.includes(lastNumber)) return [];

  const transitionCounts = Object.fromEntries(analysis.allNumbers.map((n) => [n, 0]));
  let totalWeightedTransitions = 0;

  for (let i = 0; i < data.length - 1; i += 1) {
    if (data[i].numero !== lastNumber) continue;
    const next = data[i + 1]?.numero;
    if (!next || !Object.prototype.hasOwnProperty.call(transitionCounts, next)) continue;

    const distanceFromNow = data.length - 2 - i;
    const weight = Math.exp(-distanceFromNow / 6);
    transitionCounts[next] += weight;
    totalWeightedTransitions += weight;
  }

  const alpha = 0.35;
  const universe = analysis.allNumbers.length;
  const frequencyPenaltyBase = Math.max(1, ...Object.values(analysis.frequency));

  return analysis.allNumbers
    .map((n) => {
      const weightedTransition = transitionCounts[n];
      const transitionProb = (weightedTransition + alpha) / (totalWeightedTransitions + alpha * universe);
      const freshnessBoost = Math.min(16, analysis.distances[n] || 0) / 16;
      const frequencyPenalty = (analysis.frequency[n] || 0) / frequencyPenaltyBase;
      const score = transitionProb * 0.7 + freshnessBoost * 0.4 - frequencyPenalty * 0.25;
      return {
        n,
        score,
        transitionProb,
        weightedTransition,
        distance: analysis.distances[n] || 0,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function renderRealtimeTop(data, analysis) {
  if (!els.realtimeRecommendations) return;

  const realtime = buildRealtimeSuggestions(data, analysis, 2);
  els.realtimeRecommendations.innerHTML = "";

  if (!realtime.length) {
    els.realtimeRecommendations.innerHTML = "<li>Se necesitan al menos 2 sorteos para activar tiempo real.</li>";
    return;
  }

  realtime.forEach((item) => {
    const li = document.createElement("li");
    const transitionLabel = (item.transitionProb * 100).toFixed(1);
    li.textContent = `${item.n} | transición ${transitionLabel}% | atraso ${item.distance} sorteos`;
    els.realtimeRecommendations.appendChild(li);
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

  const evaluated = new Set(Array.isArray(pending.evaluatedDrawIds) ? pending.evaluatedDrawIds : []);
  const remainingDraws = Number.isInteger(pending.remainingDraws) ? pending.remainingDraws : 1;
  const upcomingDraws = data.filter((draw) => {
    if (drawToDate(draw) <= predictionTime) return false;
    const drawId = `${draw.fecha}_${draw.hora}`;
    return !evaluated.has(drawId);
  });
  if (!upcomingDraws.length) return;

  const results = getStoredArray(PREDICTION_RESULTS_KEY);
  let remaining = remainingDraws;
  const nextEvaluated = new Set(evaluated);
  let hasHit = false;

  for (const draw of upcomingDraws) {
    if (remaining <= 0 || hasHit) break;
    const drawId = `${draw.fecha}_${draw.hora}`;
    const predictionId = pending.predictionId || pending.predictedAt;
    const resultId = `${predictionId}_${drawId}`;
    if (results.some((item) => item.resultId === resultId)) {
      nextEvaluated.add(drawId);
      continue;
    }

    const hit = pending.numbers.includes(draw.numero);
    results.push({
      resultId,
      predictionId,
      drawId,
      drawNumber: draw.numero,
      drawDate: draw.fecha,
      drawHour: draw.hora,
      predictedAt: pending.predictedAt,
      predictionHour: pending.targetHour,
      numbers: pending.numbers.slice(0, 5),
      hit,
    });
    nextEvaluated.add(drawId);
    remaining -= 1;
    if (hit) hasHit = true;
  }

  localStorage.setItem(PREDICTION_RESULTS_KEY, JSON.stringify(results));
  if (remaining <= 0 || hasHit) {
    clearPendingPrediction();
    return;
  }
  savePendingPrediction({ ...pending, remainingDraws: remaining, evaluatedDrawIds: Array.from(nextEvaluated) });
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

function getAdaptiveTopFive(analysis) {
  const predictionDriven = buildPredictionDrivenTop(analysis);
  const predictionBoost = Object.fromEntries(predictionDriven.map((n, idx) => [n, 5 - idx]));
  const recentMissPenalty = {};
  const results = getStoredArray(PREDICTION_RESULTS_KEY).slice(-24);
  results.forEach((item) => {
    if (item.hit) return;
    (item.numbers || []).forEach((n) => {
      recentMissPenalty[n] = (recentMissPenalty[n] || 0) + 1;
    });
  });

  const adaptive = analysis.allNumbers
    .map((n) => {
      const baseScore = analysis.scores[n] || 0;
      const missPenalty = (recentMissPenalty[n] || 0) * 2.6;
      const boost = (predictionBoost[n] || 0) * 1.8;
      const score = baseScore + boost - missPenalty;
      return {
        n,
        score,
        freq: analysis.frequency[n],
        distance: analysis.distances[n],
      };
    })
    .sort((a, b) => b.score - a.score);

  return adaptive.slice(0, 5);
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
      const predictedAtText = item.predictedAt ? new Date(item.predictedAt).toLocaleString() : "--";
      const predictionHourText = HOUR_LABELS[item.predictionHour] || item.predictionHour || "--";
      tr.innerHTML = `<td>${item.drawDate}</td><td>${HOUR_LABELS[item.drawHour] || item.drawHour}</td><td>${item.numbers.join(" | ")}<br><small class="hint">Pronóstico: ${predictionHourText} · ${predictedAtText}</small></td><td><strong>${item.drawNumber}</strong></td><td>${item.hit ? "✅ Acierto" : "❌ Desacierto"}</td>`;
      els.predictionStatsBody.appendChild(tr);
    });
}

function renderAll(data, analysis) {
  renderGrid(analysis);
  renderPersonalGameSection();
  renderTop(analysis);
  renderRealtimeTop(data, analysis);
  generatePlay(analysis);
  renderAlgorithmPanels(analysis);
  renderAccordion(data);
  renderHistory(data);
  renderPredictionStats();
  renderTimelineControls();
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
  appState.visibleDrawIndex = -1;
  renderTimelineControls();
}

function generatePlay(analysis) {
  const selected = appState.currentTopFive.length ? appState.currentTopFive : analysis.expansionModel.slice(0, 5).map((x) => x.n);
  const nextDraw = getNextDrawInfo(new Date());
  const daySuffix = nextDraw.isTomorrow ? " de mañana" : "";
  els.generatedPlay.textContent = `Recomendado para las ${HOUR_LABELS[nextDraw.hourKey]}${daySuffix}: ${selected.join(", ")}.`;
}

async function refreshData(force = false) {
  const monthKey = getCurrentMonthKey();

  try {
    els.status.textContent = force
      ? `Actualizando sorteo del mes ${monthKey} desde la página oficial…`
      : `Cargando datos del mes ${monthKey}…`;

    let data = !force ? loadFromCache(monthKey) : null;

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
    appState = { ...appState, data, analysis, visibleDrawIndex: data.length - 1 };
    const monthCap = monthNameEs(monthKey).replace(/^./, (s) => s.toUpperCase());
    els.hourPanelTitle.textContent = `Panel por hora del mes de ${monthCap}`;
    els.historyTitle.textContent = `Historial del mes de ${monthCap}`;
    renderByTimeline();

    const last = data[data.length - 1];
    const updatedAt = new Date().toLocaleString();
    els.lastDrawHighlight.textContent = `Último sorteo: ${last.fecha} · ${HOUR_LABELS[last.hora] || last.hora} · ${last.numero}`;
    els.status.textContent = `OK · ${data.length} sorteos cargados (${monthKey}) · ${updatedAt}`;
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
els.viewModeSelect?.addEventListener("change", (event) => {
  const selectedView = event.target.value;
  const allowed = new Set(["default", "colorSequence", "numberSequence"]);
  appState.viewMode = allowed.has(selectedView) ? selectedView : "default";
  localStorage.setItem(VIEW_MODE_KEY, appState.viewMode);
  if (appState.analysis) renderGrid(appState.analysis);
});
els.prevDrawBtn?.addEventListener("click", () => {
  if (appState.visibleDrawIndex <= 0) return;
  appState.visibleDrawIndex -= 1;
  renderByTimeline();
});
els.nextDrawBtn?.addEventListener("click", () => {
  if (appState.visibleDrawIndex >= appState.data.length - 1) return;
  appState.visibleDrawIndex += 1;
  renderByTimeline();
});

document.addEventListener("change", (event) => {
  const input = event.target.closest(".personal-check-input");
  if (!input) return;
  const number = input.dataset.number;
  if (!number) return;
  togglePersonalGameNumber(number, input.checked);
  if (appState.analysis) {
    renderGrid(appState.analysis);
    renderPersonalGameSection();
  }
});

document.addEventListener("click", (event) => {
  if (event.target.closest(".tooltip-close-btn")) {
    closeGridTooltip();
    return;
  }
  if (event.target.closest(".cell") || event.target.closest(".grid-tooltip")) return;
  closeGridTooltip();
});

els.clearPersonalGameBtn?.addEventListener("click", () => {
  if (!appState.personalGameNumbers.length) return;
  const confirmed = window.confirm("¿Seguro que quieres borrar tu juego armado? Se quitarán todos los checks.");
  if (!confirmed) return;
  appState.personalGameNumbers = [];
  savePersonalGameNumbers();
  closeGridTooltip();
  renderPersonalGameSection();
  if (appState.analysis) renderGrid(appState.analysis);
});

appState.personalGameNumbers = loadPersonalGameNumbers();
const savedView = localStorage.getItem(VIEW_MODE_KEY) || "default";
appState.viewMode = ["default", "colorSequence", "numberSequence"].includes(savedView) ? savedView : "default";
if (els.viewModeSelect) els.viewModeSelect.value = appState.viewMode;
refreshData();
setGridSortButtonLabel();
