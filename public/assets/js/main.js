// ==========================================
// js/main.js
// ==========================================
import { fetchListaDeViagens, fetchDadosDoMapa, fetchTrechoCritico, fetchViagemCompleta } from './services/api.js';
import { calcularVelocidadesSuavizadas, buscarCoordenadaPorTempo } from './utils/math.js';

// 1. ESTADO GLOBAL E INICIALIZAÇÃO
const map = L.map("map").setView([-14.235, -51.925], 4);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

let layerEstrutural = L.layerGroup().addTo(map);
let layerVelocidade = L.layerGroup();
let todasCoordenadasViagem = [];
let cursorMarker = L.circleMarker([0, 0], { radius: 6, color: "white", weight: 2, fillColor: "#e74c3c", fillOpacity: 1, zIndexOffset: 1000 });

const workspace = document.getElementById("workspace");
const bottomChartDom = document.getElementById("bottom-chart-container");
const modalChartDom = document.getElementById("modal-chart-container");
const modalOverlay = document.getElementById("modalOverlay");

let bottomChart = null;
let modalChart = null;
let currentBottomFetch = null;
let currentModalFetch = null;

const legend = L.control({ position: "bottomright" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "legenda");
  div.innerHTML = `<span style="background: #3498db; width: 15px; height: 3px; display: inline-block;"></span> Normal<br>
                     <span style="background: #e74c3c; width: 15px; height: 5px; display: inline-block;"></span> Crítico (Clique)`;
  return div;
};
legend.addTo(map);

// 2. AUTO-LOAD E GAVETA
async function inicializarPainel() {
  try {
    const trips = await fetchListaDeViagens();
    renderizarListaNaGaveta(trips);

    const urlParams = new URLSearchParams(window.location.search);
    const idDaUrl = urlParams.get("id");

    if (idDaUrl) {
      document.getElementById("batchId").value = idDaUrl;
      carregarMapa(idDaUrl);
    } else if (trips.length > 0) {
      const ultimaViagem = trips[0].batch_id;
      document.getElementById("batchId").value = ultimaViagem;
      window.history.replaceState({}, "", `?id=${ultimaViagem}`);
      carregarMapa(ultimaViagem);
    }
  } catch (error) {
    console.error("Erro na inicialização:", error);
  }
}
inicializarPainel();

function renderizarListaNaGaveta(trips) {
  const container = document.getElementById("lista-viagens-container");
  container.innerHTML = "";

  trips.forEach((trip) => {
    const timestamp = trip.started_at > 9999999999 ? trip.started_at : trip.started_at * 1000;
    const dataFormatada = new Date(timestamp).toLocaleString("pt-BR");

    let corBadge = "#95a5a6";
    if (trip.trip_status === "CONSOLIDATED") corBadge = "#27ae60";
    if (trip.trip_status === "FINISH") corBadge = "#f39c12";
    if (trip.trip_status === "PENDING") corBadge = "#3498db";

    const card = document.createElement("div");
    card.className = "trip-item-card";
    card.innerHTML = `
            <div class="trip-date-text">📅 ${dataFormatada}</div>
            <div class="trip-id-text">${trip.batch_id}</div>
            <div class="trip-status-badge" style="background-color: ${corBadge};">${trip.trip_status}</div>
        `;

    card.addEventListener("click", () => {
      const idAlvo = trip.batch_id;
      document.getElementById("batchId").value = idAlvo;
      window.history.pushState({}, "", `?id=${idAlvo}`);

      const gaveta = document.querySelector(".trip-list-drawer");
      gaveta.style.left = "-320px";
      setTimeout(() => { gaveta.style.left = ""; }, 500);

      carregarMapa(idAlvo);
    });
    container.appendChild(card);
  });
}

// 3. CONTROLES DA UI E EVENTOS
document.getElementById("btnBuscar").addEventListener("click", () => {
  const batchId = document.getElementById("batchId").value.trim();
  if (batchId) { window.history.pushState({}, "", `?id=${batchId}`); carregarMapa(batchId); }
});

document.getElementById("batchId").addEventListener("keypress", (e) => {
  if (e.key === "Enter") document.getElementById("btnBuscar").click();
});

document.getElementById("toggleLayerCritical").addEventListener("change", (e) => {
  if (e.target.checked) map.addLayer(layerEstrutural);
  else map.removeLayer(layerEstrutural);
});

document.getElementById("toggleLayerSpeed").addEventListener("change", (e) => {
  if (e.target.checked) map.addLayer(layerVelocidade);
  else map.removeLayer(layerVelocidade);
});

// 4. CARREGAMENTO DO MAPA
async function carregarMapa(batchId) {
  fecharBottomChart();
  try {
    const trechos = await fetchDadosDoMapa(batchId);
    layerEstrutural.clearLayers();
    layerVelocidade.clearLayers();
    let bounds = L.latLngBounds();
    todasCoordenadasViagem = [];

    trechos.forEach((trecho) => {
      const coords = trecho.geo_points.map((p) => [p.lat, p.lng]);
      if (trecho.geo_points) todasCoordenadasViagem.push(...trecho.geo_points);

      // Camada Estrutural
      const isCritical = trecho.is_critical;
      const linhaEstrutural = L.polyline(coords, {
        color: isCritical ? "#e74c3c" : "#3498db", weight: isCritical ? 6 : 4, opacity: 0.9, cursor: isCritical ? "pointer" : "default",
      });

      if (isCritical) {
        linhaEstrutural.bindTooltip("⚠️ Trecho Crítico<br>Clique para analisar");
        linhaEstrutural.on("click", () => abrirModalTrecho(batchId, trecho.parquet_ref));
      }
      layerEstrutural.addLayer(linhaEstrutural);

      // Camada Velocidade
      const velocidades = calcularVelocidadesSuavizadas(trecho.geo_points);
      let coordsSeg = [], velsSeg = [], corAtual = null;

      for (let i = 0; i < trecho.geo_points.length; i++) {
        const pt = trecho.geo_points[i];
        const vel = velocidades[i];
        let corPt = "#033eff";
        if (vel > 5 && vel <= 25) corPt = "#27ae60";
        if (vel > 25 && vel <= 50) corPt = "#f39c12";
        if (vel > 50) corPt = "#c0392b";

        if (corPt !== corAtual && coordsSeg.length > 0) {
          desenharSegmentoVelocidade(coordsSeg, velsSeg, corAtual);
          coordsSeg = [coordsSeg[coordsSeg.length - 1]];
          velsSeg = [velocidades[i]];
        } else {
          velsSeg.push(vel);
        }
        coordsSeg.push([pt.lat, pt.lng]);
        corAtual = corPt;
      }
      if (coordsSeg.length > 1) desenharSegmentoVelocidade(coordsSeg, velsSeg, corAtual);

      bounds.extend(linhaEstrutural.getBounds());
    });

    todasCoordenadasViagem.sort((a, b) => a.t - b.t);
    if (trechos.length > 0) map.fitBounds(bounds, { padding: [30, 30] });
  } catch (err) { alert(err); }
}

function desenharSegmentoVelocidade(coords, vels, cor) {
  const avg = vels.reduce((a, b) => a + b, 0) / vels.length;
  const max = Math.max(...vels);
  const min = Math.min(...vels);

  let desc = "Manobra";
  if (cor === "#27ae60") desc = "Baixa";
  if (cor === "#f39c12") desc = "Média";
  if (cor === "#c0392b") desc = "Alta";

  const linha = L.polyline(coords, { color: cor, weight: 5, opacity: 0.8 });
  linha.bindTooltip(`
        <div style="font-size: 11px; line-height: 1.6; min-width: 150px;">
            <b style="color: ${cor}; text-transform: uppercase; border-bottom: 1px solid #eee; padding-bottom: 3px; display: block; margin-bottom: 4px;">${desc}</b>
            <div style="display: flex; justify-content: space-between;"><span>Média:</span> <b>${avg.toFixed(1)} km/h</b></div>
            <div style="display: flex; justify-content: space-between;"><span>Máxima:</span> <b style="color: #e74c3c;">${max.toFixed(1)} km/h</b></div>
            <div style="display: flex; justify-content: space-between;"><span>Mínima:</span> <b style="color: #3498db;">${min.toFixed(1)} km/h</b></div>
        </div>
    `, { sticky: true, opacity: 0.95 });
  layerVelocidade.addLayer(linha);
}

// 5. MODAL E GRÁFICO INFERIOR
async function abrirModalTrecho(batchId, parquetRef) {
  if (currentModalFetch) currentModalFetch.abort();
  currentModalFetch = new AbortController();

  modalOverlay.classList.add("active");
  if (modalChart) { echarts.dispose(modalChartDom); modalChart = null; }
  modalChartDom.innerHTML = `<div style="display: flex; justify-content: center; align-items: center; height: 100%; color: #e74c3c; font-weight: bold;">⏳ Carregando Trecho Crítico...</div>`;

  const tempoDaAnimacao = new Promise((resolve) => setTimeout(resolve, 300));
  try {
    const [dataResponse] = await Promise.all([fetchTrechoCritico(batchId, parquetRef, currentModalFetch.signal), tempoDaAnimacao]);
    modalChartDom.innerHTML = "";
    modalChart = echarts.init(modalChartDom);
    renderizarGraficoEcharts(modalChart, dataResponse, `Análise Detalhada do Trecho: ${parquetRef}`);
  } catch (err) {
    if (err.name !== "AbortError") modalChartDom.innerHTML = `<div style="color: red; padding: 20px;">Erro: ${err}</div>`;
  }
}

document.getElementById("btnFecharModal").addEventListener("click", () => {
  if (currentModalFetch) currentModalFetch.abort();
  modalOverlay.classList.remove("active");
  if (modalChart) { echarts.dispose(modalChartDom); modalChart = null; }
  modalChartDom.innerHTML = "";
});

document.getElementById("btnVerGraficoCompleto").addEventListener("click", async () => {
  const batchId = document.getElementById("batchId").value.trim();
  if (!batchId) return alert("Busque uma viagem primeiro.");

  if (currentBottomFetch) currentBottomFetch.abort();
  currentBottomFetch = new AbortController();

  workspace.classList.add("split-view");
  if (bottomChart) { echarts.dispose(bottomChartDom); bottomChart = null; }
  bottomChartDom.innerHTML = `<div style="display: flex; justify-content: center; align-items: center; height: 100%; color: #27ae60; font-weight: bold; font-size: 15px;">⏳ Consolidando Viagem Completa... Isso pode levar alguns segundos.</div>`;

  const tempoDaAnimacao = new Promise((resolve) => setTimeout(resolve, 350));
  try {
    const [dataResponse] = await Promise.all([fetchViagemCompleta(batchId, currentBottomFetch.signal), tempoDaAnimacao]);
    bottomChartDom.innerHTML = "";
    bottomChart = echarts.init(bottomChartDom);
    renderizarGraficoEcharts(bottomChart, dataResponse, `Tensão Mecânica - Viagem Completa (${dataResponse.points.length} pontos)`);
  } catch (err) {
    if (err.name !== "AbortError") bottomChartDom.innerHTML = `<div style="color: red; padding: 20px;">Erro: ${err}</div>`;
  }
});

function fecharBottomChart() {
  if (currentBottomFetch) currentBottomFetch.abort();
  workspace.classList.remove("split-view");
  if (bottomChart) { echarts.dispose(bottomChartDom); bottomChart = null; }
  bottomChartDom.innerHTML = "";
  setTimeout(() => { map.invalidateSize(); }, 300);
}
document.getElementById("btnFecharBottom").addEventListener("click", fecharBottomChart);

function renderizarGraficoEcharts(instanciaDoGrafico, dataResponse, titulo) {
  const pointsData = dataResponse.points;
  const globalAvg = Math.abs(dataResponse.global_average);
  const eixoX = pointsData.map((i) => new Date(i.t * 1000).toLocaleTimeString("pt-BR"));
  const eixoY_Max = pointsData.map((i) => i.max !== undefined ? i.max : i.max_strain);
  const eixoY_Min = pointsData.map((i) => i.min !== undefined ? i.min : i.min_strain);
  const eixoY_Avg = pointsData.map((i) => i.avg !== undefined ? i.avg : i.avg_strain);

  instanciaDoGrafico.setOption({
    title: { text: titulo, textStyle: { fontSize: 13 }, subtext: `Média Global: ${globalAvg.toFixed(2)} kgf`, subtextStyle: { color: "#2c3e50", fontStyle: "italic", fontSize: 11 } },
    tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
    grid: { left: "3%", right: "10%", bottom: "10%", top: "22%", containLabel: true },
    legend: { data: ["Máxima", "Média", "Mínima"], top: "12%", textStyle: { fontSize: 11 } },
    dataZoom: [{ type: "inside" }, { type: "slider", bottom: 0 }],
    xAxis: { type: "category", boundaryGap: false, data: eixoX, axisLabel: { fontSize: 10 } },
    yAxis: { type: "value", scale: true, name: "Eng(kgf)", axisLabel: { fontSize: 10 } },
    series: [
      { name: "Máxima", type: "line", data: eixoY_Max, itemStyle: { color: "#e74c3c" }, showSymbol: false },
      { name: "Média", type: "line", data: eixoY_Avg, itemStyle: { color: "#f1c40f" }, lineStyle: { type: "dashed", width: 2 }, showSymbol: false },
      {
        name: "Mínima", type: "line", data: eixoY_Min, itemStyle: { color: "#3498db" }, showSymbol: false,
        markLine: {
          symbol: ["none", "none"], label: {
            position: "end", fontSize: 10, formatter: (p) => {
              const v = [{ n: "Gatilho 1.8x", s: "1.8x" }, { n: "Gatilho -1.8x", s: "-1.8x" }, { n: "Alerta 1.5x", s: "1.5x" }, { n: "Alerta -1.5x", s: "-1.5x" }, { n: "Média Global", s: "AVG" }];
              const f = v.find((x) => x.n === p.name); return f ? `${f.s}: ${p.value.toFixed(1)}` : "";
            }
          }, lineStyle: { width: 1.2, opacity: 0.8 },
          data: [
            { yAxis: globalAvg * 1.8, name: "Gatilho 1.8x", lineStyle: { color: "#c0392b", type: "dotted" } },
            { yAxis: globalAvg * -1.8, name: "Gatilho -1.8x", lineStyle: { color: "#c0392b", type: "dotted" } },
            { yAxis: globalAvg * 1.5, name: "Alerta 1.5x", lineStyle: { color: "#e67e22", type: "dashed" } },
            { yAxis: globalAvg * -1.5, name: "Alerta -1.5x", lineStyle: { color: "#e67e22", type: "dashed" } },
            { yAxis: globalAvg, name: "Média Global", lineStyle: { color: "#2c3e50", type: "solid" } }
          ]
        }
      }
    ]
  });

  instanciaDoGrafico.resize();
  instanciaDoGrafico.off("updateAxisPointer");
  instanciaDoGrafico.off("globalout");

  instanciaDoGrafico.on("updateAxisPointer", function (event) {
    const xAxisInfo = event.axesInfo[0];
    if (xAxisInfo) {
      const index = xAxisInfo.value;
      const pontoMatematico = dataResponse.points[index];
      if (pontoMatematico && pontoMatematico.t) {
        // Chama a função matemática passando o nosso estado global de coordenadas!
        const coordGPS = buscarCoordenadaPorTempo(todasCoordenadasViagem, pontoMatematico.t);
        if (coordGPS && coordGPS.lat && coordGPS.lng) {
          cursorMarker.setLatLng([coordGPS.lat, coordGPS.lng]);
          if (!map.hasLayer(cursorMarker)) cursorMarker.addTo(map);
        }
      }
    }
  });

  instanciaDoGrafico.on("globalout", function () {
    if (map.hasLayer(cursorMarker)) map.removeLayer(cursorMarker);
  });
}

window.addEventListener("resize", () => {
  map.invalidateSize();
  if (bottomChart && workspace.classList.contains("split-view")) bottomChart.resize();
  if (modalChart && modalOverlay.classList.contains("active")) modalChart.resize();
});