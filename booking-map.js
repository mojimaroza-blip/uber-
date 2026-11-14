
const CENTER = [-24.5891, 29.8319]; // Approximate Mphanama centre
const $ = id => document.getElementById(id);

let map;
let pickupPin;
let destinationPin;
let routeLine;
let destinationCoords = null;
let pickupCoords = CENTER;
let selecting = false;

function fare(km) {
  return 12 + Number(km) * 1;
}

function updateFare(km) {
  $("distance").value = Number(km).toFixed(1);
  $("fare").textContent = "R" + fare(km).toFixed(2);
}

function message(text) {
  const el = $("ride-message");
  if (el) el.textContent = text;
}

function insideServiceArea(lat, lon) {
  // Approximate broad Limpopo service boundary.
  return lat >= -25.5 && lat <= -22 &&
         lon >= 28.2 && lon <= 31.9;
}

function initMap() {
  if (!$("ride-map") || !window.L) return;

  map = L.map("ride-map", {
    maxBounds: L.latLngBounds([[-25.5,28.2],[-22,31.9]]),
    maxBoundsViscosity: 0.8
  }).setView(CENTER, 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  pickupPin = L.marker(CENTER).addTo(map)
    .bindPopup("Default pickup area: Mphanama");

  map.on("click", async event => {
    if (!selecting) return;
    selecting = false;
    destinationCoords = [event.latlng.lat, event.latlng.lng];
    if (destinationPin) destinationPin.setLatLng(event.latlng);
    else destinationPin = L.marker(event.latlng).addTo(map);
    $("destination").value = "Selected map location in Mphanama";
    await calculateRoute();
  });
}

async function searchPlace(text) {
  const query = encodeURIComponent(
    text + ", Limpopo, South Africa"
  );
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=za&viewbox=28.2,-22,31.9,-25.5&bounded=1&q=" +
    query;

  const response = await fetch(url);
  if (!response.ok) throw new Error("Location search unavailable.");
  const results = await response.json();
  if (!results.length) throw new Error("Location not found in the service area.");

  const match = results.find(x =>
    insideServiceArea(Number(x.lat), Number(x.lon))
  );
  if (!match) throw new Error("Please choose a location in the Limpopo service area.");

  return [Number(match.lat), Number(match.lon)];
}

async function calculateRoute() {
  if (!pickupCoords || !destinationCoords) return;

  const [aLat,aLon] = pickupCoords;
  const [bLat,bLon] = destinationCoords;

  const url =
    `https://router.project-osrm.org/route/v1/driving/${aLon},${aLat};${bLon},${bLat}?overview=full&geometries=geojson`;

  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not calculate the road route.");
  const data = await response.json();

  if (data.code !== "Ok" || !data.routes.length)
    throw new Error("No road route was found.");

  const route = data.routes[0];
  const km = route.distance / 1000;

  if (routeLine) map.removeLayer(routeLine);
  routeLine = L.geoJSON(route.geometry, {
    style: { color: "#d5a500", weight: 5 }
  }).addTo(map);

  map.fitBounds(routeLine.getBounds(), { padding: [20,20] });
  updateFare(km);
  message(`Estimated road distance ${km.toFixed(1)} km. Fare R${fare(km).toFixed(2)}.`);
}

$("current-location")?.addEventListener("click", () => {
  if (!navigator.geolocation) {
    message("Your browser does not support GPS.");
    return;
  }
  message("Requesting your location permission…");
  navigator.geolocation.getCurrentPosition(async position => {
    const point = [position.coords.latitude, position.coords.longitude];
    if (!insideServiceArea(point[0], point[1])) {
      message("Your current location is outside our current Limpopo service area. Please enter a supported pickup manually.");
      return;
    }
    pickupCoords = point;
    pickupPin.setLatLng(point).bindPopup("Your current pickup location").openPopup();
    map.setView(point, 15);
    $("pickup").value = `${point[0].toFixed(5)}, ${point[1].toFixed(5)}`;
    message("Current pickup location selected.");
    if (destinationCoords) {
      try { await calculateRoute(); } catch(e) { message(e.message); }
    }
  }, error => {
    message("Location permission was not granted or GPS is unavailable. You can type your pickup address.");
  }, { enableHighAccuracy: true, timeout: 15000 });
});

$("search-destination")?.addEventListener("click", async () => {
  try {
    const point = await searchPlace($("destination").value.trim());
    destinationCoords = point;
    if (destinationPin) destinationPin.setLatLng(point);
    else destinationPin = L.marker(point).addTo(map);
    map.setView(point, 15);
    await calculateRoute();
  } catch(e) {
    message(e.message + " You can select an approximate point on the map.");
  }
});

$("choose-pin")?.addEventListener("click", () => {
  selecting = true;
  message("Tap the map to place the destination pin.");
});

$("pickup")?.addEventListener("change", async () => {
  const value = $("pickup").value.trim();
  if (!value) return;
  try {
    const point = await searchPlace(value);
    pickupCoords = point;
    pickupPin.setLatLng(point);
    if (destinationCoords) await calculateRoute();
  } catch(e) {
    message("Pickup not found. Try a more specific Mphanama landmark or use GPS.");
  }
});

$("ride-form")?.addEventListener("submit", event => {
  if (!destinationCoords || !$("distance").value) {
    event.preventDefault();
    message("Please search for your destination or choose it on the map first.");
  }
});

initMap();

