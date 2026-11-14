
let trackingMap;
let driverMarker;

window.updateTrackingMarker = (lat,lng) => {
  const point = [lat,lng];

  if (!trackingMap) {
    trackingMap = L.map("tracking-map").setView(point,15);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:"© OpenStreetMap contributors"
    }).addTo(trackingMap);
  }

  if (!driverMarker) {
    driverMarker = L.marker(point).addTo(trackingMap)
      .bindPopup("Village Ride driver");
  } else {
    driverMarker.setLatLng(point);
  }

  trackingMap.panTo(point);
};
