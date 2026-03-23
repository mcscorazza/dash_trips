// ==========================================
// js/services/api.js
// ==========================================

const BASE_URL = "https://trips.svxdigital.com/api";

export async function fetchListaDeViagens() {
  const response = await fetch(`${BASE_URL}/trips`);
  if (!response.ok) throw new Error("Falha ao buscar lista de viagens");
  return response.json();
}

export async function fetchDadosDoMapa(batchId) {
  const response = await fetch(`${BASE_URL}/map/${batchId}`);
  if (!response.ok) throw new Error("Viagem não encontrada no mapa");
  return response.json();
}

export async function fetchTrechoCritico(batchId, parquetRef, signal) {
  const response = await fetch(`${BASE_URL}/chart/${batchId}/${parquetRef}`, { signal });
  if (!response.ok) throw new Error("Erro ao carregar trecho");
  return response.json();
}

export async function fetchViagemCompleta(batchId, signal) {
  const response = await fetch(`${BASE_URL}/chart/full/${batchId}`, { signal });
  if (!response.ok) throw new Error("Erro ao consolidar viagem");
  return response.json();
}