// ==========================================
// js/main.js
// ==========================================
import { fetchListaDeViagens, fetchDadosDoMapa, fetchTrechoCritico, fetchViagemCompleta } from './services/api.js';
import { calcularVelocidadesSuavizadas, buscarCoordenadaPorTempo, calcularDistanciaHaversine } from './utils/math.js';

// ==========================================
// 1. ESTADO GLOBAL E INICIALIZAÇÃO
// ==========================================
const map = L.map("map").setView([-14.235, -51.925], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

let layerEstrutural = L.layerGroup().addTo(map);
let layerVelocidade = L.layerGroup();
let todasCoordenadasViagem = [];
let viagensDynamo = [];
let ultimaViagemBounds = null;

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

const legendVelocidade = L.control({ position: "bottomright" });
legendVelocidade.onAdd = () => {
  const div = L.DomUtil.create("div", "legenda");
  div.innerHTML = `
        <div style="margin-bottom: 3px;"><b>Velocidade</b></div>
        <span style="color: #033eff; font-size: 14px;">■</span> 0 a 5 km/h<br>
        <span style="color: #27ae60; font-size: 14px;">■</span> 5 a 25 km/h<br>
        <span style="color: #f39c12; font-size: 14px;">■</span> 25 a 50 km/h<br>
        <span style="color: #c0392b; font-size: 14px;">■</span> + 50 km/h
    `;
  return div;
};

// ==========================================
// 2. AUTO-LOAD E GAVETA
// ==========================================
async function inicializarPainel() {
  try {
    const trips = await fetchListaDeViagens();
    viagensDynamo = trips;
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

// ==========================================
// 4. RENDERIZAÇÃO DA GAVETA
// ==========================================
function renderizarListaNaGaveta(trips) {
  const container = document.getElementById("lista-viagens-container");
  container.innerHTML = "";
  trips.forEach((trip) => {
    const statusOperacional = trip.status || trip.trip_status || "DESCONHECIDO";
    const datalogger = trip.datalogger_id || "DL Desconhecido";
    const cidadeOrigem = trip.city_start || "Origem Indisponível";
    const cidadeDestino = trip.city_end || trip.city_current || "Destino Indisponível";
    const timestamp = trip.started_at > 9999999999 ? trip.started_at : trip.started_at * 1000;
    const dataFormatada = new Date(timestamp).toLocaleString("pt-BR", {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    let corBadge = "#95a5a6";
    if (statusOperacional === "CONSOLIDATED") corBadge = "#27ae60";
    if (statusOperacional === "FINISH") corBadge = "#f39c12";
    if (statusOperacional === "PENDING") corBadge = "#3498db";
    const card = document.createElement("div");
    card.className = "trip-item-card";
    card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="font-size: 11px; font-weight: bold; color: #2c3e50;">📅 ${dataFormatada}</div>
                <div class="trip-status-badge" style="background-color: ${corBadge}; font-size: 9px; padding: 2px 6px;">${statusOperacional}</div>
            </div>
            
            <div style="font-size: 13px; font-weight: bold; color: #2c3e50; margin-bottom: 6px;">
                📟 ${datalogger}
            </div>
            
            <div style="font-size: 11px; color: #7f8c8d; line-height: 1.5; margin-bottom: 8px; background: white; padding: 5px; border-radius: 4px; border: 1px dashed #ccc;">
                <span style="color: #3498db;">📍</span> ${cidadeOrigem}<br>
                <span style="color: #27ae60;">🏁</span> ${cidadeDestino}
            </div>
            
            <div class="trip-id-text" style="font-size: 9px; margin: 0; opacity: 0.7;">ID: ${trip.batch_id}</div>
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

// ==========================================
// 5. CONTROLES DA UI E EVENTOS
// ==========================================
document.getElementById("btnBuscar").addEventListener("click", () => {
  const batchId = document.getElementById("batchId").value.trim();
  if (batchId) { window.history.pushState({}, "", `?id=${batchId}`); carregarMapa(batchId); }
});

document.getElementById("batchId").addEventListener("keypress", (e) => {
  if (e.key === "Enter") document.getElementById("btnBuscar").click();
});

document.getElementById("toggleLayerCritical").addEventListener("change", (e) => {
  if (e.target.checked) {
    map.addLayer(layerEstrutural);
    legend.addTo(map);
  } else {
    map.removeLayer(layerEstrutural);
    legend.remove();
  }
});

document.getElementById("toggleLayerSpeed").addEventListener("change", (e) => {
  if (e.target.checked) {
    map.addLayer(layerVelocidade);
    legendVelocidade.addTo(map);
  } else {
    map.removeLayer(layerVelocidade);
    legendVelocidade.remove();
  }
});

// ==========================================
// 6. CARREGAMENTO DO MAPA
// ==========================================
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
      const isCritical = trecho.is_critical;
      const linhaEstrutural = L.polyline(coords, {
        color: isCritical ? "#e74c3c" : "#3498db", weight: isCritical ? 6 : 4, opacity: 0.9, cursor: isCritical ? "pointer" : "default",
      });

      if (isCritical) {
        linhaEstrutural.bindTooltip("⚠️ Trecho Crítico<br>Clique para analisar");
        linhaEstrutural.on("click", () => abrirModalTrecho(batchId, trecho.parquet_ref));
      }
      layerEstrutural.addLayer(linhaEstrutural);
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
    if (trechos.length > 0) {
      ultimaViagemBounds = bounds;
      map.fitBounds(bounds, { padding: [30, 30] });
      atualizarResumoViagem(batchId, trechos, todasCoordenadasViagem);
    }
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

// ==========================================
// 7. MODAL E GRÁFICO INFERIOR
// ==========================================
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
  setTimeout(() => {
    map.invalidateSize();
    if (ultimaViagemBounds) map.fitBounds(ultimaViagemBounds, { padding: [30, 30] });
  }, 300);
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
  setTimeout(() => {
    map.invalidateSize();
    if (ultimaViagemBounds) map.fitBounds(ultimaViagemBounds, { padding: [30, 30] });
  }, 300);
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
    tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
    grid: { left: "2%", right: "12%", bottom: "12%", top: "2%", containLabel: true },
    legend: {
      data: ["Máxima", "Média", "Mínima"],
      orient: "vertical",
      right: "1%",
      top: "center",
      textStyle: { fontSize: 11 }
    },

    dataZoom: [{ type: "inside" }, { type: "slider", bottom: 8 }],
    xAxis: { type: "category", boundaryGap: false, data: eixoX, axisLabel: { fontSize: 10 } },
    yAxis: { type: "value", scale: true, name: "", axisLabel: { fontSize: 10 } },
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

// ==========================================
// 8. ATUALIZAÇÃO DINÂMICA DA SIDEBAR
// ==========================================
function atualizarResumoViagem(batchId, trechos, coordenadasGlobais) {
  const container = document.getElementById("trip-details");

  if (!trechos || trechos.length === 0 || coordenadasGlobais.length === 0) {
    container.innerHTML = `<div class="info-value" style="color: #e74c3c;">Dados da viagem incompletos.</div>`;
    return;
  }
  const tripData = viagensDynamo.find(t => t.batch_id === batchId) || {};
  const statusOperacional = tripData.status || tripData.trip_status || "DESCONHECIDO";
  const datalogger = tripData.datalogger_id || "N/A";
  const cidadeOrigem = tripData.city_start || "Origem Indisponível";
  const cidadeDestino = tripData.city_end
  const cidadeAtual = tripData.city_current || "Cidade não Identificada"
  const tInicio = coordenadasGlobais[0].t;
  const tFim = coordenadasGlobais[coordenadasGlobais.length - 1].t;
  const duracaoSegundos = tFim - tInicio;
  const horas = Math.floor(duracaoSegundos / 3600);
  const minutos = Math.floor((duracaoSegundos % 3600) / 60);
  const totalPontos = coordenadasGlobais.length.toLocaleString('pt-BR');
  let distanciaKm = 0;
  for (let i = 1; i < coordenadasGlobais.length; i++) {
    distanciaKm += calcularDistanciaHaversine(
      coordenadasGlobais[i - 1].lat, coordenadasGlobais[i - 1].lng,
      coordenadasGlobais[i].lat, coordenadasGlobais[i].lng
    );
  }
  const qtdCriticos = trechos.filter(t => t.is_critical).length;
  const statusTexto = qtdCriticos > 0 ? `⚠️ Alertas Críticos (${qtdCriticos})` : `✅ Operação Normal`;
  const statusCor = qtdCriticos > 0 ? "#e74c3c" : "#27ae60";
  container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; background: #f8f9fa; padding: 10px; border-radius: 6px; border: 1px solid #eee;">
            <div>
                <div style="font-size: 10px; color: #7f8c8d; text-transform: uppercase; font-weight: bold;">Equipamento</div>
                <div style="font-size: 14px; color: #2c3e50; font-weight: bold;">📟 ${datalogger}</div>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 10px; color: #7f8c8d; text-transform: uppercase; text-align:right; font-weight: bold;">Status</div>
                <div style="font-size: 11px; font-weight: bold; color: white; background: #34495e; padding: 2px 8px; border-radius: 10px; display: inline-block;">${statusOperacional}</div>
            </div>
        </div>
        <div class="info-label">Trajeto (Origem ➔ Destino)</div>
        <div class="info-value" style="font-size: 12px; line-height: 1.5;">
            <span style="color: #3498db;">📌</span> ${cidadeOrigem}<br>
            ${statusOperacional === 'CONSOLIDATED'
      ? `<span style="color: #27ae60;">✅</span> ${cidadeDestino}`
      : `<span style="color: #f39c12;">🔄</span> ${cidadeAtual} <span style="font-size: 10px; color: #7f8c8d;">(em trânsito)</span>`
    }
        </div>
        <div class="info-label">Diagnóstico de Tensão</div>
        <div class="info-value" style="color: ${statusCor}; font-weight: bold">${statusTexto}</div>

        <div style="display: flex; gap: 10px; margin-top: 15px;">
            <div style="flex: 1;">
                <div class="info-label">Duração</div>
                <div class="info-value" style="font-size: 15px; border: none;"><b>${horas}h ${minutos}m</b></div>
            </div>
            <div style="flex: 1;">
                <div class="info-label">Distância</div>
                <div class="info-value" style="font-size: 15px; border: none;"><b>${distanciaKm.toFixed(1)} km</b></div>
            </div>
        </div>

        <div class="info-label">Volume de Dados Lidos</div>
        <div class="info-value">${totalPontos} pontos de GPS/Sensores</div>
        
        <div class="info-label" style="margin-top: 10px;">ID do Lote (Batch ID)</div>
        <div class="info-value" style="font-size: 10px; color: #95a5a6; word-break: break-all; border: none;">${batchId}</div>
    `;
}