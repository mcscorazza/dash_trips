const map = L.map("map").setView([-15.7801, -47.9292], 4);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap",
}).addTo(map);

let currentRouteGroup = L.featureGroup().addTo(map);

async function loadTrips() {
  const response = await fetch("/api/trips");
  const trips = await response.json();

  const listDiv = document.getElementById("trip-list");
  listDiv.innerHTML = "";

  trips.forEach((trip) => {
    const div = document.createElement("div");
    div.className = `trip-item ${trip.status}`;

    let locationText = "📍 Aguardando localização...";

    if (
      trip.status === "CONSOLIDATED" &&
      trip.city_start &&
      trip.city_end
    ) {
      locationText = `📍 ${trip.city_start} ➔ ${trip.city_end}`;
    } else if (trip.city_start && trip.city_current) {
      locationText = `📍 ${trip.city_start} ➔ ${trip.city_current} (Atual)`;
    } else if (trip.city_start) {
      locationText = `📍 ${trip.city_start}`;
    }

    div.innerHTML = `
            <div class="trip-city">${locationText}</div>
            <div class="trip-id">ID: ${trip.batch_id.substring(0, 8)}...</div>
            <div class="status-badge ${trip.status}">${trip.status}</div>
          `;

    div.onclick = () => {
      window.history.pushState({}, "", `?batch_id=${trip.batch_id}`);
      drawRoute(trip.batch_id);
      if (window.innerWidth <= 768) {
        document
          .getElementById("sidebar")
          .classList.remove("show-mobile");
      }
    };

    listDiv.appendChild(div);
  });
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getSpeedColor(speed) {
  if (speed > 40) return "#ff0000";
  if (speed > 20) return "#ff9900";
  if (speed > 5) return "#33cc33";
  return "#3388ff";
}

document.getElementById("menu-toggle").onclick = () => {
  const sidebar = document.getElementById("sidebar");
  if (window.innerWidth <= 768) {
    sidebar.classList.toggle("show-mobile");
  } else {
    sidebar.classList.toggle("hidden-desktop");
  }
};

async function drawRoute(batch_id) {
  const response = await fetch(`/api/map-data/${batch_id}`);

  if (!response.ok) {
    const errorData = await response.json();
    alert(`Erro ao buscar dados: ${errorData.error}`);
    return;
  }

  const points = await response.json();

  if (points.length < 2) {
    alert(
      "Pontos insuficientes para traçar uma rota e calcular velocidade.",
    );
    return;
  }

  currentRouteGroup.clearLayers();
  let coordsForBounds = [];

  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];

    const distanceKm = getDistance(p1.lat, p1.lng, p2.lat, p2.lng);
    const timeDiffSec = p2.t - p1.t;

    let speedKmH = 0;
    if (timeDiffSec > 0) {
      speedKmH = distanceKm / (timeDiffSec / 3600);
    }

    const color = getSpeedColor(speedKmH);

    const segment = L.polyline(
      [
        [p1.lat, p1.lng],
        [p2.lat, p2.lng],
      ],
      { color: color, weight: 5 },
    );

    segment.bindTooltip(
      `Velocidade: <b>${speedKmH.toFixed(1)} km/h</b>`,
      { sticky: true, className: "speed-tooltip" },
    );

    currentRouteGroup.addLayer(segment);
    coordsForBounds.push([p2.lat, p2.lng]);
  }

  if (coordsForBounds.length > 0) {
    map.fitBounds(currentRouteGroup.getBounds());
  }
}

async function init() {
  await loadTrips();
  const params = new URLSearchParams(window.location.search);
  const targetBatchId = params.get("batch_id");

  if (targetBatchId) {
    drawRoute(targetBatchId);
  }
}

init();