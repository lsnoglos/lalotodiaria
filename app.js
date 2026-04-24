const SOURCE_URL = "https://www.yelu.com.ni/lottery/results/history";
const SOURCE_PROXY_URLS = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://proxy.cors.sh/${url}`,
  (url) => `https://cors.isomorphic-git.org/${url}`,
];
const CACHE_KEY = "lotoData";
const CACHE_TIME_KEY = "lotoDataUpdatedAt";
const PERSONAL_GAME_KEY = "lotoPersonalGameNumbers";
const VIEW_MODE_KEY = "lotoViewMode";
const SELECTED_GAME_KEY = "lotoSelectedGame";
const CACHE_TTL_MS = 30 * 60 * 1000;
const HOURS = ["12PM", "3PM", "6PM", "9PM"];
const HOUR_LABELS = { "12PM": "12:00pm", "3PM": "3:00pm", "6PM": "6:00pm", "9PM": "9:00pm" };
const GAME_CONFIGS = {
  diaria: {
    key: "diaria",
    label: "Diaria",
    sourceName: "Loto Diaria",
    digits: 2,
    min: 0,
    max: 99,
    boardTitle: "Tablero 00 - 99",
  },
  juega3: {
    key: "juega3",
    label: "Juega 3",
    sourceName: "Juga 3",
    digits: 3,
    min: 0,
    max: 999,
    boardTitle: "Tablero 000 - 999",
  },
};
const GAME_SCHEDULE = {
  "12PM": { hour: 12, minute: 0, label: "12:00pm" },
  "3PM": { hour: 15, minute: 0, label: "3:00pm" },
  "6PM": { hour: 18, minute: 0, label: "6:00pm" },
  "9PM": { hour: 21, minute: 0, label: "9:00pm" },
};

let appState = {
  selectedGame: "diaria",
  gameConfig: GAME_CONFIGS.diaria,
  data: [],
  analysis: null,
  activeMonth: "",
  visibleDateIndex: -1,
  currentTopFive: [],
  gridColumns: 10,
  gridSortDirection: "asc",
  gridStartWith: "01",
  viewMode: "default",
  personalGameNumbers: [],
  activeSequenceDraws: [],
  sequenceTargetDate: "",
};

const els = {
  appHeader: document.getElementById("appHeader"),
  status: document.getElementById("status"),
  loadingIndicator: document.getElementById("loadingIndicator"),
  refreshBtn: document.getElementById("refreshBtn"),
  generatePlayBtn: document.getElementById("generatePlayBtn"),
  copyPromptBtn: document.getElementById("copyPromptBtn"),
  gameSelect: document.getElementById("gameSelect"),
  boardTitle: document.getElementById("boardTitle"),
  numberGrid: document.getElementById("numberGrid"),
  prevDrawBtn: document.getElementById("prevDrawBtn"),
  nextDrawBtn: document.getElementById("nextDrawBtn"),
  timelineLabel: document.getElementById("timelineLabel"),
  topRecommendations: document.getElementById("topRecommendations"),
  realtimeRecommendations: document.getElementById("realtimeRecommendations"),
  verifySequenceBtn: document.getElementById("verifySequenceBtn"),
  generatedPlay: document.getElementById("generatedPlay"),
  lastDrawHighlight: document.getElementById("lastDrawHighlight"),
  gridColumnsSelect: document.getElementById("gridColumnsSelect"),
  gridStartSelect: document.getElementById("gridStartSelect"),
  viewModeSelect: document.getElementById("viewModeSelect"),
  gridSortBtn: document.getElementById("gridSortBtn"),
  historyBody: document.getElementById("historyBody"),
  historyTitle: document.getElementById("historyTitle"),
  personalGameSummary: document.getElementById("personalGameSummary"),
  personalGameNumbers: document.getElementById("personalGameNumbers"),
  clearPersonalGameBtn: document.getElementById("clearPersonalGameBtn"),
  drawSequenceBtn: document.getElementById("drawSequenceBtn"),
  resetSequenceBtn: document.getElementById("resetSequenceBtn"),
  sequenceStatus: document.getElementById("sequenceStatus"),
};
let loadingCount = 0;

function setLoadingState(isLoading, statusMessage = "") {
  if (isLoading) loadingCount += 1;
  else loadingCount = Math.max(loadingCount - 1, 0);

  const loadingActive = loadingCount > 0;
  if (els.loadingIndicator) {
    els.loadingIndicator.classList.toggle("visible", loadingActive);
    els.loadingIndicator.setAttribute("aria-hidden", loadingActive ? "false" : "true");
  }
  document.body.classList.toggle("is-loading", loadingActive);
  if (statusMessage) els.status.textContent = statusMessage;
}

function getVisibleData() {
  if (!Array.isArray(appState.data) || !appState.data.length) return [];
  const dates = getUniqueDates(appState.data);
  const clampedDateIndex = Math.max(0, Math.min(appState.visibleDateIndex, dates.length - 1));
  const activeDate = dates[clampedDateIndex];
  if (!activeDate) return appState.data.slice();
  return appState.data.filter((draw) => draw.fecha <= activeDate);
}

function getUniqueDates(data = appState.data) {
  return [...new Set((data || []).map((draw) => draw.fecha))];
}

function getCurrentTimelineDate() {
  const dates = getUniqueDates(appState.data);
  if (!dates.length) return "";
  const clampedDateIndex = Math.max(0, Math.min(appState.visibleDateIndex, dates.length - 1));
  appState.visibleDateIndex = clampedDateIndex;
  return dates[clampedDateIndex] || "";
}

function formatTimelineLabel(dateKey) {
  if (!dateKey) return "--";
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function renderTimelineControls() {
  const hasData = appState.data.length > 0;
  if (!hasData) {
    els.prevDrawBtn.disabled = true;
    els.nextDrawBtn.disabled = true;
    els.timelineLabel.textContent = "--";
    return;
  }
  const dates = getUniqueDates(appState.data);
  const minIndex = 0;
  const maxIndex = dates.length - 1;
  const clamped = Math.max(minIndex, Math.min(appState.visibleDateIndex, maxIndex));
  appState.visibleDateIndex = clamped;
  els.prevDrawBtn.disabled = clamped <= minIndex;
  els.nextDrawBtn.disabled = clamped >= maxIndex;
  els.timelineLabel.textContent = formatTimelineLabel(dates[clamped]);
}

function renderByTimeline() {
  const visibleData = getVisibleData();
  if (!visibleData.length) return;
  const analysis = analyzeData(visibleData);
  appState.analysis = analysis;
  renderAll(visibleData, analysis);
  const current = visibleData[visibleData.length - 1];
  els.lastDrawHighlight.textContent = `Último sorteo en vista: ${current.fecha} · ${HOUR_LABELS[current.hora] || current.hora} · ${current.numero}`;
  renderTimelineControls();
}


function getPreviousMonthKey(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, 1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildPromptMonthTransitionText(now = new Date()) {
  const day = now.getDate();
  if (day <= 2) return "te comparto los juegos del mes pasado y unos cuantos de este mes";
  if (day < 5) return "además te comparto los del mes pasado";
  return "te comparto los juegos de este mes y los del mes pasado";
}

function updateGameUiLabels() {
  if (els.boardTitle) els.boardTitle.textContent = appState.gameConfig.boardTitle;
  const monthCap = monthNameEs(getCurrentMonthKey()).replace(/^./, (s) => s.toUpperCase());
  const title = `Loto diaria o juga tres del mes de ${monthCap}`;
  document.title = `${title} · Nicaragua`;
  const appTitle = document.querySelector(".app-title");
  if (appTitle) appTitle.textContent = title;
}

function updateGridStartOptions() {
  if (!els.gridStartSelect) return;
  const zero = String(0).padStart(appState.gameConfig.digits, "0");
  const one = String(1).padStart(appState.gameConfig.digits, "0");
  els.gridStartSelect.innerHTML = `<option value="${zero}">${zero}</option><option value="${one}" selected>${one}</option>`;
  appState.gridStartWith = one;
}

function groupDrawsByDate(draws) {
  const grouped = new Map();
  draws.forEach((draw) => {
    if (!grouped.has(draw.fecha)) grouped.set(draw.fecha, {});
    grouped.get(draw.fecha)[draw.hora] = draw.numero;
  });
  return [...grouped.entries()].map(([fecha, byHour]) => ({
    fecha,
    byHour,
  }));
}

function buildMonthGamesText(draws, emptyText = "Sin datos") {
  const grouped = groupDrawsByDate(draws);
  if (!grouped.length) return emptyText;
  return grouped
    .map(({ fecha, byHour }, index) => `${index + 1}. ${fecha} · 12 pm: ${byHour["12PM"] || "x"}, 3pm: ${byHour["3PM"] || "x"}, 6pm: ${byHour["6PM"] || "x"}, 9pm: ${byHour["9PM"] || "x"}.`)
    .join("\n");
}

async function copyPromptToClipboard() {
  setLoadingState(true, "Construyendo prompt…");
  const currentMonthKey = appState.activeMonth || getCurrentMonthKey();
  const previousMonthKey = getPreviousMonthKey(currentMonthKey);
  const monthNameCurrent = monthNameEs(currentMonthKey);
  const monthTransitionText = buildPromptMonthTransitionText(new Date());

  try {
    let previousMonthData = [];
    try {
      const previousHtml = await fetchHistoryHtml(previousMonthKey, false);
      previousMonthData = parseLotteryHtml(previousHtml, previousMonthKey, appState.gameConfig);
    } catch (error) {
      console.warn("No se pudo cargar el mes anterior para el prompt:", error);
    }

    const currentMonthData = appState.data || [];
    const previousGames = buildMonthGamesText(previousMonthData, "1....");
    const currentGames = buildMonthGamesText(currentMonthData, "1....");
    const numericStart = String(appState.gameConfig.min).padStart(appState.gameConfig.digits, "0");
    const numericEnd = String(appState.gameConfig.max).padStart(appState.gameConfig.digits, "0");
    const totalNumbers = appState.gameConfig.max - appState.gameConfig.min + 1;

    const prompt = `Eres un jugador profesional de juegos al azar, te apasiona buscar algoritmos matemáticos, crees que el azar es un conjunto desordenado de secuencias ordenadas, porque la naturaleza te lo enseñó así,  siempre hay formas que parecen un caos, pero que terminan formando algo hermoso que se repite en el tiempo. Te compartiré los juegos que van de ${monthNameCurrent}, ${monthTransitionText}.

Diario hay 4 juegos, a las 12 del medio dia, a las 3 pm, 6 y 9 pm. Esos juegos deben seguir algún patrón, quizás el primero que cae si es menor que el segundo, resta x al segundo, y el segundo suma o resta al tercero, al final estos numeros crean una secuencia, y el cuarto se basa en esa respuesta, busca patrones.

Además, en columnas de 10, los números del ${numericStart} al ${numericEnd}; los ${totalNumbers} números forman muchísimos infinitos, es decir, al ver el trazo, tiene esa forma muchas veces, una especie de símbolo infinito al formar los 4 juegos. Busca patrones.

La idea es encontrar el siguiente juego, con gran precisión, con margen pero mínimo.

Al final dame una secuencia de números para el próximo juego.

Acá te dejo los juegos:

Mes pasado:

${previousGames}

Mes actual:

${currentGames}`;

    await navigator.clipboard.writeText(prompt);
    els.status.textContent = "Prompt copiado al portapapeles.";
  } finally {
    setLoadingState(false);
  }
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

function getScopedStorageKey(baseKey) {
  return `${baseKey}:${appState.selectedGame}`;
}

function loadFromCache(monthKey) {
  try {
    const raw = localStorage.getItem(getScopedStorageKey(CACHE_KEY));
    const timestamp = Number(localStorage.getItem(getScopedStorageKey(CACHE_TIME_KEY)) || 0);
    if (!raw || Date.now() - timestamp > CACHE_TTL_MS) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.month !== monthKey || !Array.isArray(parsed.data)) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function saveToCache(monthKey, data) {
  localStorage.setItem(getScopedStorageKey(CACHE_KEY), JSON.stringify({ month: monthKey, data }));
  localStorage.setItem(getScopedStorageKey(CACHE_TIME_KEY), String(Date.now()));
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
  const regex = new RegExp(`^\\d{${appState.gameConfig.digits}}$`);
  return getStoredArray(getScopedStorageKey(PERSONAL_GAME_KEY))
    .filter((n) => regex.test(n))
    .sort();
}

function savePersonalGameNumbers() {
  localStorage.setItem(getScopedStorageKey(PERSONAL_GAME_KEY), JSON.stringify(appState.personalGameNumbers));
}

function parseNumberValue(numberLike) {
  const parsed = Number(numberLike);
  if (!Number.isInteger(parsed)) return 0;
  return Math.max(appState.gameConfig.min, Math.min(appState.gameConfig.max, parsed));
}

function generarCandidatosOrdenados(n) {
  const base = appState.gameConfig.max + 1;
  const a = Math.floor(n / 10);
  const b = n % 10;
  const s = a + b;
  const d = Math.abs(a - b);

  return [
    (10 * b + a) % base,
    (10 * s + d) % base,
    (10 * d + s) % base,
    (10 * a + s) % base,
    (10 * b + s) % base,
    (10 * s + a) % base,
    (10 * s + b) % base,
  ];
}

function crearEstadoFrecuencias(history) {
  const visitCount = Object.fromEntries(Array.from({ length: appState.gameConfig.max + 1 }, (_, i) => [i, 0]));
  const digitCount = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i, 0]));
  const sumCount = Object.fromEntries(Array.from({ length: 19 }, (_, i) => [i, 0]));
  const diffCount = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i, 0]));

  const applyNumber = (value) => {
    const n = parseNumberValue(value);
    const a = Math.floor(n / 10);
    const b = n % 10;
    const s = a + b;
    const d = Math.abs(a - b);

    visitCount[n] = (visitCount[n] || 0) + 1;
    digitCount[a] = (digitCount[a] || 0) + 1;
    digitCount[b] = (digitCount[b] || 0) + 1;
    sumCount[s] = (sumCount[s] || 0) + 1;
    diffCount[d] = (diffCount[d] || 0) + 1;
  };

  history.forEach((n) => applyNumber(n));

  return { visitCount, digitCount, sumCount, diffCount, applyNumber };
}

function calcularPuntajeGlobal(x, state) {
  const a = Math.floor(x / 10);
  const b = x % 10;
  const invX = 10 * b + a;
  const s = a + b;
  const d = Math.abs(a - b);

  return (
    5 * (state.visitCount[x] || 0) +
    3 * (state.visitCount[invX] || 0) +
    2 * (state.digitCount[a] || 0) +
    2 * (state.digitCount[b] || 0) +
    1 * (state.sumCount[s] || 0) +
    1 * (state.diffCount[d] || 0)
  );
}

function seleccionarSiguientePorPuntaje(actual, state) {
  const candidatos = generarCandidatosOrdenados(actual);
  let mejor = candidatos[0];
  let mejorScore = calcularPuntajeGlobal(mejor, state);

  for (let i = 1; i < candidatos.length; i += 1) {
    const candidato = candidatos[i];
    const score = calcularPuntajeGlobal(candidato, state);
    if (score < mejorScore) {
      mejor = candidato;
      mejorScore = score;
    }
  }

  return mejor;
}

function generarSecuenciaDeterministaConMemoria(history, pasos = 28) {
  if (!Array.isArray(history) || !history.length) return [];
  const state = crearEstadoFrecuencias(history);
  let actual = parseNumberValue(history[history.length - 1]);
  const generados = [];

  for (let i = 0; i < pasos; i += 1) {
    const siguiente = seleccionarSiguientePorPuntaje(actual, state);
    generados.push(siguiente);
    state.applyNumber(siguiente);
    actual = siguiente;
  }

  return generados;
}

function siguiente(n, visitados) {
  const candidatos = generarCandidatosOrdenados(n);
  for (const c of candidatos) {
    if ((visitados[c] || 0) === 0) return c;
  }
  for (const c of candidatos) {
    if ((visitados[c] || 0) < 2) return c;
  }
  return candidatos[0];
}

function generarSecuencia(inicio, pasos, visitadosIniciales = null) {
  const visitados =
    visitadosIniciales ||
    Object.fromEntries(Array.from({ length: appState.gameConfig.max + 1 }, (_, i) => [i, 0]));
  const secuencia = [];
  let actual = inicio;

  for (let i = 0; i < pasos; i += 1) {
    secuencia.push(actual);
    visitados[actual] = (visitados[actual] || 0) + 1;
    actual = siguiente(actual, visitados);
  }

  return secuencia;
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

async function fetchHistoryHtml(monthKey, force = false) {
  const body = new URLSearchParams({
    _method: "POST",
    "data[Lottery][name]": appState.gameConfig.sourceName,
    "data[Lottery][date]": monthKey,
  });

  const sourceUrl = force ? `${SOURCE_URL}?_ts=${Date.now()}` : SOURCE_URL;
  const attempts = [sourceUrl, ...SOURCE_PROXY_URLS.map((buildUrl) => buildUrl(sourceUrl))];
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

function parseLotteryHtml(html, monthKey, gameConfig = appState.gameConfig) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const rows = [];
  const expectedDigits = gameConfig?.digits || 2;
  const expectedGame = (gameConfig?.sourceName || "").toLowerCase();

  doc.querySelectorAll("table tr").forEach((tr) => {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 3) return;

    const fecha = parseSpanishDate(tds[0].textContent || "");
    if (!fecha || !fecha.startsWith(monthKey)) return;

    const gameText = (tds[1].textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (expectedGame && !gameText.includes(expectedGame.toLowerCase())) return;

    const hora = normalizeHour(tds[1].querySelector("sup")?.textContent || "");
    if (!hora) return;

    const digits = [...tds[2].querySelectorAll(".lotto_no_r")]
      .map((node) => (node.textContent || "").trim())
      .filter((v) => /^\d$/.test(v));

    if (digits.length >= expectedDigits) {
      rows.push({
        fecha,
        hora,
        numero: digits.slice(0, expectedDigits).join(""),
        sorteo: (tds[3]?.textContent || "").trim(),
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
  const { min, max, digits } = appState.gameConfig;
  return Array.from({ length: max - min + 1 }, (_, i) => String(min + i).padStart(digits, "0"));
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
    const inv = n.split("").reverse().join("");
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
      const invertidoDetectado = frequency[n.split("").reverse().join("")] > 0 ? 1 : 0;
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
  const isDouble = number.split("").every((digit) => digit === number[0]);
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

function buildNumberDetail(number, analysis, sourceData = getVisibleData()) {
  const drawList = sourceData.filter((d) => d.numero === number);
  const inverse = number.split("").reverse().join("");
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

function getGridFilteredData(sourceData) {
  if (!Array.isArray(sourceData)) return [];
  return sourceData;
}

function renderGrid(analysis) {
  const visibleData = getVisibleData();
  const filteredGridData = getGridFilteredData(visibleData);
  const gridAnalysis = analyzeData(filteredGridData);
  els.numberGrid.innerHTML = "";
  els.numberGrid.style.gridTemplateColumns = `repeat(${appState.gridColumns}, minmax(0, 1fr))`;
  const colorSequenceMap = appState.viewMode === "colorSequence" ? buildColorSequenceMap(filteredGridData) : null;
  const numberSequenceMap = appState.viewMode === "numberSequence" ? buildNumberSequenceMap(filteredGridData) : null;

  const zeroStart = String(0).padStart(appState.gameConfig.digits, "0");
  const oneStart = String(1).padStart(appState.gameConfig.digits, "0");
  const numbersByStart =
    appState.gridStartWith === oneStart
      ? [...gridAnalysis.allNumbers.slice(1), gridAnalysis.allNumbers[0]]
      : gridAnalysis.allNumbers.slice();
  const orderedNumbers = appState.gridSortDirection === "desc" ? numbersByStart.slice().reverse() : numbersByStart;

  orderedNumbers.forEach((number) => {
    const div = document.createElement("div");
    div.className = `cell ${cellClass(number, gridAnalysis)}`.trim();
    if (appState.viewMode === "colorSequence") {
      div.innerHTML = renderColorSequenceCell(number, colorSequenceMap);
    } else if (appState.viewMode === "numberSequence") {
      div.innerHTML = renderNumberSequenceCell(number, numberSequenceMap);
    } else {
      div.textContent = number;
    }
    div.addEventListener("click", (event) => {
      const detail = buildNumberDetail(number, gridAnalysis, filteredGridData);
      const control = buildPersonalGameControl(number);
      showGridTooltip(`${detail}<br>${control}`, event.clientX, event.clientY);
    });
    if (isPersonalNumberSelected(number)) div.classList.add("selected-personal");
    div.dataset.number = number;
    els.numberGrid.appendChild(div);
  });
  renderSequenceOverlay();
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

function renderHistory(data) {
  els.historyBody.innerHTML = "";
  data.slice().reverse().slice(0, 200).forEach((draw) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${draw.fecha}</td><td>${draw.hora}</td><td><strong>${draw.numero}</strong></td><td>${draw.sorteo || "--"}</td>`;
    els.historyBody.appendChild(tr);
  });
}

function renderTop() {
  const visibleData = getVisibleData();
  const lastDraw = visibleData[visibleData.length - 1];
  if (!lastDraw) {
    els.topRecommendations.innerHTML = "<li>Sin datos para generar secuencia.</li>";
    els.realtimeRecommendations.innerHTML = "<li>Sin datos para generar secuencia.</li>";
    appState.currentTopFive = [];
    return;
  }

  const history = visibleData.map((draw) => parseNumberValue(draw.numero));
  const secuenciaBase =
    appState.gameConfig.key === "diaria"
      ? generarSecuenciaDeterministaConMemoria(history, 28)
      : generarSecuencia(parseNumberValue(lastDraw.numero), 10);

  const secuenciaSugerida = secuenciaBase
    .slice(0, 5)
    .map((n) => String(n).padStart(appState.gameConfig.digits, "0"));
  const secuenciaProbable = secuenciaBase
    .slice(5, 10)
    .map((n) => String(n).padStart(appState.gameConfig.digits, "0"));

  appState.currentTopFive = secuenciaSugerida.slice();
  els.topRecommendations.innerHTML = secuenciaSugerida.map((n, idx) => `<li>${idx + 1}. ${n}</li>`).join("");
  els.realtimeRecommendations.innerHTML = secuenciaProbable.map((n, idx) => `<li>${idx + 1}. ${n}</li>`).join("");
}


function getSequenceTargetDate() {
  if (appState.sequenceTargetDate) return appState.sequenceTargetDate;
  return getTodayDateKey(new Date());
}

function getSequenceDrawsForTargetDate() {
  const dateKey = getSequenceTargetDate();
  if (!dateKey) return { draws: [], dateKey, error: "No se pudo resolver la fecha objetivo para el trazo." };
  const drawsOnDate = appState.data.filter((draw) => draw.fecha === dateKey);
  const draws = drawsOnDate;
  if (draws.length < 2) {
    return {
      draws: [],
      dateKey,
      error: "No hay suficientes sorteos para trazar (mínimo 2). Prueba otro día.",
    };
  }
  return { draws, dateKey, error: "" };
}

function renderSequenceOverlay() {
  const previous = els.numberGrid.querySelector(".sequence-overlay");
  if (previous) previous.remove();
  if (!appState.activeSequenceDraws.length) return;

  const gridRect = els.numberGrid.getBoundingClientRect();
  if (!gridRect.width || !gridRect.height) return;
  const points = appState.activeSequenceDraws
    .map((draw) => {
      const cell = els.numberGrid.querySelector(`.cell[data-number="${draw.numero}"]`);
      if (!cell) return null;
      const rect = cell.getBoundingClientRect();
      return {
        x: rect.left - gridRect.left + rect.width / 2,
        y: rect.top - gridRect.top + rect.height / 2,
      };
    })
    .filter(Boolean);

  if (points.length < 2) return;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "sequence-overlay");
  svg.setAttribute("viewBox", `0 0 ${gridRect.width} ${gridRect.height}`);
  svg.setAttribute("width", `${gridRect.width}`);
  svg.setAttribute("height", `${gridRect.height}`);

  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "#fde047");
  polyline.setAttribute("stroke-width", "3");
  polyline.setAttribute("stroke-linecap", "round");
  polyline.setAttribute("stroke-linejoin", "round");
  polyline.setAttribute("filter", "drop-shadow(0 0 4px rgba(253,224,71,0.85))");
  polyline.classList.add("animated-sequence-line");
  svg.appendChild(polyline);
  els.numberGrid.appendChild(svg);
}

function resetSequence() {
  appState.activeSequenceDraws = [];
  renderSequenceOverlay();
  if (els.sequenceStatus) {
    const targetDate = getSequenceTargetDate();
    els.sequenceStatus.textContent = `Trazo reiniciado (${targetDate}).`;
  }
}

function applySequenceRange() {
  const { draws, error, dateKey } = getSequenceDrawsForTargetDate();
  if (error) {
    appState.activeSequenceDraws = [];
    renderSequenceOverlay();
    if (els.sequenceStatus) els.sequenceStatus.textContent = error;
    return;
  }
  appState.activeSequenceDraws = draws;
  renderSequenceOverlay();
  const from = draws[0];
  const to = draws[draws.length - 1];
  if (els.sequenceStatus) {
    els.sequenceStatus.textContent = `Trazo activo (${dateKey}): ${draws.length} sorteos (${HOUR_LABELS[from.hora]} → ${HOUR_LABELS[to.hora]}).`;
  }
}

function getTodayDateKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
  void data;
  void analysis;
}

function renderAll(data, analysis) {
  renderGrid(analysis);
  renderPersonalGameSection();
  renderTop();
  renderRealtimeTop(data, analysis);
  generatePlay(analysis);
  renderHistory(data);
  renderTimelineControls();
}

function setGridSortButtonLabel() {
  const label = appState.gridSortDirection === "asc" ? "Ascendente" : "Descendente";
  els.gridSortBtn.textContent = `Orden: ${label}`;
}

function showNoMonthlyData(monthKey) {
  const month = monthNameEs(monthKey);
  const monthCap = month.charAt(0).toUpperCase() + month.slice(1);
  els.historyTitle.textContent = `Historial del mes de ${monthCap}`;
  els.numberGrid.innerHTML = "";
  els.topRecommendations.innerHTML = "";
  els.historyBody.innerHTML = `<tr><td colspan=\"4\">Aún no hay sorteos para ${monthCap}. Puedes consultar el mes anterior para estimar el primer número de ${monthCap}.</td></tr>`;
  els.generatedPlay.textContent = `Sin jugada sugerida por falta de sorteos de ${appState.gameConfig.label} en el mes actual.`;
  els.lastDrawHighlight.textContent = "Último sorteo: --";
  appState.visibleDateIndex = -1;
  renderTimelineControls();
}

function generatePlay(analysis) {
  const selected = appState.currentTopFive.length ? appState.currentTopFive : analysis.expansionModel.slice(0, 5).map((x) => x.n);
  els.generatedPlay.textContent = `Jugada sugerida: ${selected.join(", ")}.`;
}

async function refreshData(force = false) {
  const monthKey = getCurrentMonthKey();
  const gameLabel = appState.gameConfig.label;
  const loadingMessage = force
    ? `Actualizando ${gameLabel} del mes ${monthKey} desde la página oficial…`
    : `Cargando ${gameLabel} del mes ${monthKey}…`;
  setLoadingState(true, loadingMessage);

  try {
    let data = !force ? loadFromCache(monthKey) : null;

    if (!data) {
      const html = await fetchHistoryHtml(monthKey, force);
      data = parseLotteryHtml(html, monthKey, appState.gameConfig);
      saveToCache(monthKey, data);
    }

    appState.activeMonth = monthKey;

    if (!data.length) {
      appState = { ...appState, data: [], analysis: null };
      resetSequence();
      showNoMonthlyData(monthKey);
      els.status.textContent = `Sin sorteos de ${gameLabel} para ${monthKey}.`;
      return;
    }

    const analysis = analyzeData(data);
    const uniqueDates = getUniqueDates(data);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = getTodayDateKey(yesterday);
    const defaultDateIndex = uniqueDates.includes(yesterdayKey) ? uniqueDates.indexOf(yesterdayKey) : uniqueDates.length - 1;
    appState = { ...appState, data, analysis, visibleDateIndex: defaultDateIndex };
    const monthCap = monthNameEs(monthKey).replace(/^./, (s) => s.toUpperCase());
    els.historyTitle.textContent = `Historial del mes de ${monthCap}`;
    appState.sequenceTargetDate = getCurrentTimelineDate();
    resetSequence();
    if (els.sequenceStatus) els.sequenceStatus.textContent = `Trazo listo para ${appState.sequenceTargetDate}.`;
    renderByTimeline();

    const last = data[data.length - 1];
    const updatedAt = new Date().toLocaleString();
    els.lastDrawHighlight.textContent = `Último sorteo: ${last.fecha} · ${HOUR_LABELS[last.hora] || last.hora} · ${last.numero}`;
    els.status.textContent = `${data.length} sorteos de ${gameLabel} cargados (${monthKey}) · ${updatedAt}`;
  } catch (error) {
    console.error(error);
    els.status.textContent = `Error: ${error.message}`;
  } finally {
    setLoadingState(false);
  }
}

async function switchGame(nextGameKey) {
  const nextConfig = GAME_CONFIGS[nextGameKey] || GAME_CONFIGS.diaria;
  appState.selectedGame = nextConfig.key;
  appState.gameConfig = nextConfig;
  localStorage.setItem(SELECTED_GAME_KEY, nextConfig.key);
  appState.personalGameNumbers = loadPersonalGameNumbers();
  updateGridStartOptions();
  updateGameUiLabels();
  if (els.gameSelect) els.gameSelect.value = nextConfig.key;
  closeGridTooltip();
  resetSequence();
  await refreshData(true);
}

els.refreshBtn.addEventListener("click", () => refreshData(true));
els.verifySequenceBtn?.addEventListener("click", async () => {
  await refreshData(true);
  els.status.textContent = `Secuencia verificada con los últimos números en tablero (${appState.gameConfig.label}).`;
});
els.generatePlayBtn.addEventListener("click", () => {
  if (!appState.analysis) return;
  generatePlay(appState.analysis);
});
els.copyPromptBtn?.addEventListener("click", async () => {
  try {
    await copyPromptToClipboard();
  } catch (error) {
    console.error(error);
    els.status.textContent = `No se pudo copiar el prompt: ${error.message}`;
  }
});
els.gameSelect?.addEventListener("change", async (event) => {
  await switchGame(event.target.value);
});
els.gridColumnsSelect.addEventListener("change", (event) => {
  const selectedColumns = Number(event.target.value);
  if (Number.isNaN(selectedColumns)) return;
  appState.gridColumns = selectedColumns;
  if (appState.analysis) renderGrid(appState.analysis);
});
els.gridStartSelect.addEventListener("change", (event) => {
  const allowed = new Set([
    String(0).padStart(appState.gameConfig.digits, "0"),
    String(1).padStart(appState.gameConfig.digits, "0"),
  ]);
  appState.gridStartWith = allowed.has(event.target.value) ? event.target.value : String(1).padStart(appState.gameConfig.digits, "0");
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
els.drawSequenceBtn?.addEventListener("click", () => {
  applySequenceRange();
});
els.resetSequenceBtn?.addEventListener("click", () => {
  resetSequence();
});
els.prevDrawBtn?.addEventListener("click", () => {
  if (appState.visibleDateIndex <= 0) return;
  appState.visibleDateIndex -= 1;
  appState.sequenceTargetDate = getCurrentTimelineDate();
  const keepActiveSequence = appState.activeSequenceDraws.length > 0;
  renderByTimeline();
  if (keepActiveSequence) applySequenceRange();
});
els.nextDrawBtn?.addEventListener("click", () => {
  const dates = getUniqueDates(appState.data);
  if (appState.visibleDateIndex >= dates.length - 1) return;
  appState.visibleDateIndex += 1;
  appState.sequenceTargetDate = getCurrentTimelineDate();
  const keepActiveSequence = appState.activeSequenceDraws.length > 0;
  renderByTimeline();
  if (keepActiveSequence) applySequenceRange();
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
window.addEventListener("resize", () => {
  renderSequenceOverlay();
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

const savedGame = localStorage.getItem(SELECTED_GAME_KEY) || "diaria";
appState.selectedGame = GAME_CONFIGS[savedGame] ? savedGame : "diaria";
appState.gameConfig = GAME_CONFIGS[appState.selectedGame];
if (els.gameSelect) els.gameSelect.value = appState.selectedGame;
updateGameUiLabels();
updateGridStartOptions();
appState.personalGameNumbers = loadPersonalGameNumbers();
const savedView = localStorage.getItem(VIEW_MODE_KEY) || "default";
appState.viewMode = ["default", "colorSequence", "numberSequence"].includes(savedView) ? savedView : "default";
if (els.viewModeSelect) els.viewModeSelect.value = appState.viewMode;
refreshData();
setGridSortButtonLabel();
