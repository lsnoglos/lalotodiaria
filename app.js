const SOURCE_URL = "https://www.yelu.com.ni/lottery/results/diaria";
const CACHE_KEY = "lotoData";
const CACHE_TIME_KEY = "lotoDataUpdatedAt";
const CACHE_TTL_MS = 30 * 60 * 1000;
const HOURS = ["12PM", "3PM", "6PM", "9PM"];

let appState = {
  data: [],
  analysis: null,
  chart: null,
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
  frequencyChart: document.getElementById("frequencyChart"),
  accordionTemplate: document.getElementById("accordionTemplate"),
};

/**
 * Crea lista ["00", "01", ... "99"].
 */
function getAllNumbers() {
  return Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));
}

/**
 * Intenta obtener HTML directo; si CORS bloquea, usa proxys públicos de solo lectura.
 */
async function fetchHtmlWithFallback() {
  const endpoints = [
    SOURCE_URL,
    `https://r.jina.ai/http://www.yelu.com.ni/lottery/results/diaria`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(SOURCE_URL)}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) continue;
      const html = await response.text();
      if (html && html.includes("lotto_numbers")) return html;
    } catch {
      // Se ignora para continuar con fallback.
    }
  }

  throw new Error("No fue posible descargar HTML del origen.");
}

/**
 * Extrae fecha desde encabezados próximos al bloque; fallback a fecha de hoy.
 */
function detectDateForBlock(block, doc) {
  const candidates = [];
  let cursor = block.previousElementSibling;
  let hops = 0;

  while (cursor && hops < 8) {
    const text = cursor.textContent?.trim();
    if (text) candidates.push(text);
    cursor = cursor.previousElementSibling;
    hops += 1;
  }

  // Fallback: buscar títulos del documento.
  candidates.push(doc.querySelector("h1")?.textContent || "");
  candidates.push(doc.querySelector("title")?.textContent || "");

  for (const candidate of candidates) {
    const match = candidate.match(/(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];

    const dmy = candidate.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) {
      const [, dd, mm, yyyy] = dmy;
      return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }

  return new Date().toISOString().slice(0, 10);
}

/**
 * Parsea HTML y devuelve [{fecha, hora, numero}].
 */
function parseLotteryHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const blocks = [...doc.querySelectorAll("div.lotto_numbers")];
  const rows = [];

  blocks.forEach((block) => {
    const fecha = detectDateForBlock(block, doc);
    const items = [...block.children];

    for (let i = 0; i < items.length; i += 1) {
      const node = items[i];
      if (!node.classList.contains("lotto_no_time")) continue;

      const horaRaw = (node.textContent || "").replace(/\s+/g, "").toUpperCase();
      if (!HOURS.includes(horaRaw)) continue;

      const digits = [];
      let j = i + 1;
      while (j < items.length && !items[j].classList.contains("lotto_no_time")) {
        if (items[j].classList.contains("lotto_no_r")) {
          const text = (items[j].textContent || "").trim();
          if (/^\d$/.test(text)) digits.push(text);
          else if (/^\d{2}$/.test(text) && digits.length === 0) {
            digits.push(text[0], text[1]);
          }
          // Ignora JG, 2X, 5X, etc.
        }
        j += 1;
      }

      if (digits.length >= 2) {
        rows.push({
          fecha,
          hora: horaRaw,
          numero: `${digits[0]}${digits[1]}`,
        });
      }
    }
  });

  return rows
    .filter((r) => /^\d{2}$/.test(r.numero))
    .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
}

function loadFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const timestamp = Number(localStorage.getItem(CACHE_TIME_KEY) || 0);
    if (!raw || Date.now() - timestamp > CACHE_TTL_MS) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveToCache(data) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  localStorage.setItem(CACHE_TIME_KEY, String(Date.now()));
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

  const pyramids = data.map((d) => ({
    ...d,
    suma: Number(d.numero[0]) + Number(d.numero[1]),
  }));

  const recent = data.slice(-20).map((d) => d.numero);
  const cruces = new Set();
  for (let i = 0; i < recent.length - 1; i += 1) {
    const a = recent[i];
    const b = recent[i + 1];
    cruces.add(`${a[0]}${b[1]}`);
    cruces.add(`${b[0]}${a[1]}`);
  }

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

  return {
    allNumbers,
    frequency,
    noSalidos,
    repetidos,
    invertidos,
    distances,
    pyramids,
    cruces: [...cruces],
    scores,
    expansionModel,
  };
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

    if (!filtered.length) {
      content.textContent = "Sin datos para esta hora.";
    }

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

function renderChart(analysis) {
  const entries = Object.entries(analysis.frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  const labels = entries.map(([n]) => n);
  const values = entries.map(([, f]) => f);

  if (appState.chart) appState.chart.destroy();

  appState.chart = new Chart(els.frequencyChart, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Frecuencia",
        data: values,
        backgroundColor: "rgba(59,130,246,0.7)",
        borderColor: "rgba(147,197,253,1)",
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#e5e7eb" } },
      },
      scales: {
        x: { ticks: { color: "#e5e7eb" } },
        y: { ticks: { color: "#e5e7eb" } },
      },
    },
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
  renderChart(analysis);
}

function generatePlay(analysis) {
  const candidates = analysis.expansionModel.slice(0, 12).map((x) => x.n);
  const size = 2 + Math.floor(Math.random() * 3); // 2-4 números
  const selected = [];
  while (selected.length < size && candidates.length) {
    const idx = Math.floor(Math.random() * candidates.length);
    selected.push(candidates.splice(idx, 1)[0]);
  }
  els.generatedPlay.textContent = selected.join(" · ");
}

async function refreshData(force = false) {
  try {
    els.status.textContent = "Cargando datos…";

    let data = !force ? loadFromCache() : null;
    if (!data) {
      const html = await fetchHtmlWithFallback();
      data = parseLotteryHtml(html);
      if (!data.length) throw new Error("No se extrajeron sorteos válidos del HTML.");
      saveToCache(data);
    }

    const analysis = analyzeData(data);
    appState = { ...appState, data, analysis };
    renderAll(data, analysis);

    const last = data[data.length - 1];
    const updatedAt = new Date().toLocaleString();
    els.status.textContent = `OK · ${data.length} sorteos cargados · Último: ${last.fecha} ${last.hora} ${last.numero} · ${updatedAt}`;
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
