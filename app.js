const SOURCE_URL = "https://www.yelu.com.ni/lottery/results/history";
const CACHE_KEY = "lotoData";
const CACHE_TIME_KEY = "lotoDataUpdatedAt";
const CACHE_TTL_MS = 30 * 60 * 1000;
const HOURS = ["12PM", "3PM", "6PM", "9PM"];

let appState = {
  data: [],
  analysis: null,
  activeMonth: "",
};

const els = {
  status: document.getElementById("status"),
  refreshBtn: document.getElementById("refreshBtn"),
  generatePlayBtn: document.getElementById("generatePlayBtn"),
  numberGrid: document.getElementById("numberGrid"),
  topRecommendations: document.getElementById("topRecommendations"),
  generatedPlay: document.getElementById("generatedPlay"),
  hourAccordion: document.getElementById("hourAccordion"),
  missingList: document.getElementById("missingList"),
  repeatedList: document.getElementById("repeatedList"),
  invertedList: document.getElementById("invertedList"),
  historyBody: document.getElementById("historyBody"),
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

  const direct = await fetch(SOURCE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!direct.ok) {
    throw new Error(`No se pudo consultar historial mensual (HTTP ${direct.status}).`);
  }

  const html = await direct.text();
  if (!html.includes("Loto Nicaragua Números Ganadores Anteriores")) {
    throw new Error("La respuesta no contiene la tabla histórica esperada.");
  }

  return html;
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

  return { allNumbers, frequency, noSalidos, repetidos, invertidos, distances, scores, expansionModel };
}

function cellClass(number, analysis) {
  const freq = analysis.frequency[number];
  const hasInv = analysis.invertidos.includes(number);
  if (analysis.noSalidos.includes(number)) return "no-salido";
  if (freq > 2) return "alta-frecuencia";
  if (freq > 1) return "repetido";
  if (hasInv) return "invertido";
  if (analysis.distances[number] > 20) return "frio";
  return "";
}

function renderGrid(analysis) {
  els.numberGrid.innerHTML = "";
  analysis.allNumbers.forEach((number) => {
    const div = document.createElement("div");
    div.className = `cell ${cellClass(number, analysis)}`.trim();
    div.textContent = number;
    div.title = `Freq: ${analysis.frequency[number]} | Distancia: ${analysis.distances[number]} | Score: ${analysis.scores[number]}`;
    els.numberGrid.appendChild(div);
  });
}

function renderPills(container, values, emptyText = "Sin datos") {
  container.innerHTML = "";
  if (!values.length) {
    container.textContent = emptyText;
    return;
  }
  values.forEach((value) => {
    const span = document.createElement("span");
    span.className = "pill";
    span.textContent = value;
    container.appendChild(span);
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

    summary.textContent = `${hour} · ${filtered.length} sorteos`;
    if (filtered.length === 0) details.open = false;

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
  els.topRecommendations.innerHTML = "";
  top.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.n} · score ${item.score} (freq:${item.freq}, dist:${item.distance})`;
    els.topRecommendations.appendChild(li);
  });
}

function renderAll(data, analysis) {
  renderGrid(analysis);
  renderTop(analysis);
  renderAccordion(data);
  renderPills(els.missingList, analysis.noSalidos);
  renderPills(els.repeatedList, analysis.repetidos);
  renderPills(els.invertedList, analysis.invertidos);
  renderHistory(data);
}

function showNoMonthlyData(monthKey) {
  const month = monthNameEs(monthKey);
  const monthCap = month.charAt(0).toUpperCase() + month.slice(1);
  els.numberGrid.innerHTML = "";
  els.topRecommendations.innerHTML = "";
  els.hourAccordion.innerHTML = "";
  els.missingList.innerHTML = "";
  els.repeatedList.innerHTML = "";
  els.invertedList.innerHTML = "";
  els.historyBody.innerHTML = `<tr><td colspan=\"3\">Aún no hay sorteos para ${monthCap}. Puedes consultar el mes anterior para estimar el primer número de ${monthCap}.</td></tr>`;
  els.generatedPlay.textContent = "Sin jugada sugerida por falta de sorteos en el mes actual.";
}

function generatePlay(analysis) {
  const candidates = analysis.expansionModel.slice(0, 12).map((x) => x.n);
  const size = 2 + Math.floor(Math.random() * 3);
  const selected = [];
  while (selected.length < size && candidates.length) {
    const idx = Math.floor(Math.random() * candidates.length);
    selected.push(candidates.splice(idx, 1)[0]);
  }
  els.generatedPlay.textContent = selected.join(" · ");
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

refreshData();
