
import { auth, db, rtdb, functions } from "./firebase-config.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  doc, setDoc, getDoc, collection, query, where,
  onSnapshot, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import {
  ref, set, onValue, remove
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js";

const $ = id => document.getElementById(id);
const call = name => httpsCallable(functions, name);

let currentUser = null;
let activeTrackingStop = null;
let gpsWatch = null;
let online = false;

function say(id, text) {
  if ($(id)) $(id).textContent = text;
}

async function profile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

async function register(form, role) {
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    const credential = await createUserWithEmailAndPassword(
      auth, data.email, data.password
    );
    const record = {
      uid: credential.user.uid,
      name: data.name,
      phone: data.phone,
      email: data.email,
      role,
      approvalStatus: role === "driver" ? "pending" : "approved",
      isOnline: false,
      createdAt: serverTimestamp()
    };
    if (role === "driver") {
      record.vehicle = data.vehicle;
      record.registration = data.registration;
    }
    await setDoc(doc(db, "users", credential.user.uid), record);
    say("auth-message", role === "driver"
      ? "Application submitted. Wait for administrator approval."
      : "Passenger account created.");
    say("admin-message", "Account created.");
  } catch (error) {
    say("auth-message", error.message);
    say("admin-message", error.message);
  }
}

$("signup-form")?.addEventListener("submit", e => {
  e.preventDefault();
  const role = location.pathname.includes("driver") ? "driver" : "passenger";
  register(e.currentTarget, role);
});

$("login-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.currentTarget).entries());
  try {
    await signInWithEmailAndPassword(auth, data.email, data.password);
  } catch (error) {
    say("auth-message", error.message);
    say("admin-message", error.message);
  }
});

$("logout")?.addEventListener("click", () => signOut(auth));
$("driver-logout")?.addEventListener("click", () => stopDriverAndLogout());
$("admin-logout")?.addEventListener("click", () => signOut(auth));

async function stopDriverAndLogout() {
  stopGPS();
  await signOut(auth);
}

async function requestRide(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const km = Number(data.distanceKm);
  if (!Number.isFinite(km) || km <= 0) throw new Error("Please calculate a valid road distance first.");
  const result = await call("createRide")({
    pickup: data.pickup,
    destination: data.destination,
    distanceKm: km
  });
  return result.data;
}

$("ride-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!currentUser) {
    say("ride-message", "Please create an account or log in first.");
    return;
  }
  try {
    const result = await requestRide(e.currentTarget);
    say("ride-message", `Ride requested. Estimated fare: R${result.estimatedFare.toFixed(2)}.`);
  } catch (error) {
    say("ride-message", error.message);
  }
});

function renderRide(container, ride, id, role) {
  const item = document.createElement("div");
  item.className = "trip";

  const title = document.createElement("strong");
  title.textContent = `${ride.pickup} → ${ride.destination}`;
  const detail = document.createElement("p");
  detail.textContent = `Status: ${ride.status} · Estimated fare: R${Number(ride.estimatedFare).toFixed(2)}`;

  item.append(title, detail);

  if (role === "driver" && ride.status === "requested") {
    const accept = document.createElement("button");
    accept.className = "btn yellow";
    accept.textContent = "Accept ride";
    accept.onclick = async () => {
      try {
        await call("acceptRide")({rideId:id});
        say("driver-message", "Ride accepted.");
      } catch(e) { say("driver-message", e.message); }
    };
    item.append(accept);
  }

  if (role === "driver" && ride.status === "accepted" && ride.driverId === currentUser.uid) {
    const start = document.createElement("button");
    start.className = "btn yellow";
    start.textContent = "Start trip";
    start.onclick = async () => {
      try {
        await call("startRide")({rideId:id});
        say("driver-message", "Trip started. Your GPS is being shared while the trip is active.");
      } catch(e) { say("driver-message", e.message); }
    };
    const complete = document.createElement("button");
    complete.className = "btn";
    complete.textContent = "Complete trip";
    complete.onclick = async () => {
      try {
        await call("completeRide")({rideId:id});
        await remove(ref(rtdb, `liveTrips/${id}`));
        stopGPS();
        say("driver-message", "Trip completed.");
      } catch(e) { say("driver-message", e.message); }
    };
    item.append(start, complete);
  }

  if (role === "passenger" && ride.passengerId === currentUser.uid &&
      ["accepted","arrived","started"].includes(ride.status)) {
    const track = document.createElement("button");
    track.className = "btn yellow";
    track.textContent = "Track my trip";
    track.onclick = () => trackTrip(id);
    item.append(track);
  }

  container.append(item);
}

function listenPassenger(uid) {
  const target = $("my-rides");
  if (!target) return;
  return onSnapshot(
    query(collection(db,"rides"),where("passengerId","==",uid)),
    snap => {
      target.replaceChildren();
      snap.forEach(d => renderRide(target,d.data(),d.id,"passenger"));
      if (snap.empty) target.textContent = "You have no rides yet.";
    }
  );
}

function listenDriver(uid) {
  const available = $("available-rides");
  const active = $("active-rides");
  if (!available || !active) return;
  return onSnapshot(
    query(collection(db,"rides"),where("status","in",["requested","accepted","started","arrived"])),
    snap => {
      available.replaceChildren();
      active.replaceChildren();
      snap.forEach(d => {
        const ride = d.data();
        if (ride.status === "requested") renderRide(available,ride,d.id,"driver");
        if (ride.driverId === uid) renderRide(active,ride,d.id,"driver");
      });
    }
  );
}

function startGPS(rideId) {
  if (!navigator.geolocation) {
    say("driver-message","GPS is not available in this browser.");
    return;
  }
  stopGPS();
  gpsWatch = navigator.geolocation.watchPosition(async position => {
    const p = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      updatedAt: Date.now()
    };
    try {
      await set(ref(rtdb,`liveTrips/${rideId}`),p);
    } catch(e) { say("driver-message",e.message); }
  }, error => say("driver-message","GPS error: "+error.message),
  {enableHighAccuracy:true,maximumAge:5000,timeout:20000});
}

function stopGPS() {
  if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
  gpsWatch = null;
}

async function trackTrip(rideId) {
  $("tracking-area")?.classList.remove("hidden");
  if (activeTrackingStop) activeTrackingStop();
  activeTrackingStop = onValue(ref(rtdb,`liveTrips/${rideId}`),snap => {
    const p = snap.val();
    say("tracking-status",p ? "Driver location updated" : "Waiting for driver GPS location…");
    say("tracking-detail",p
      ? `Driver location: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`
      : "The driver has not shared a location yet.");
    if (p && window.updateTrackingMarker) window.updateTrackingMarker(p.lat,p.lng);
  }, error => say("tracking-detail",error.message));
}

$("online-toggle")?.addEventListener("click", async () => {
  try {
    online = !online;
    await call("setDriverAvailability")({isOnline:online});
    $("online-toggle").textContent = online ? "Go offline" : "Go online";
    say("driver-message",online ? "You are online." : "You are offline.");
  } catch(e) {
    online = false;
    say("driver-message",e.message);
  }
});

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) return;

  const p = await profile(user.uid);
  if (!p) return;

  if (p.role === "passenger") {
    $("auth-panel")?.classList.add("hidden");
    $("account-panel")?.classList.remove("hidden");
    say("account-name",`Signed in as ${p.name}`);
    listenPassenger(user.uid);
  }

  if (p.role === "driver") {
    $("driver-panel")?.classList.remove("hidden");
    $("signup-form")?.classList.add("hidden");
    $("login-form")?.classList.add("hidden");
    say("driver-name",`Welcome, ${p.name}`);
    say("approval-status",`Application status: ${p.approvalStatus}`);
    if (p.approvalStatus === "approved") listenDriver(user.uid);
  }

  if (location.pathname.includes("admin")) {
    const token = await user.getIdTokenResult(true);
    if (token.claims.admin !== true) {
      say("admin-message","This account is not authorised as an administrator.");
      return;
    }
    $("admin-panel")?.classList.remove("hidden");
    listenAdmin();
  }
});

function listenAdmin() {
  onSnapshot(collection(db,"users"),snap => {
    const target = $("driver-applications");
    if (!target) return;
    target.replaceChildren();
    snap.forEach(d => {
      const u = d.data();
      if (u.role !== "driver" || u.approvalStatus !== "pending") return;
      const line = document.createElement("div");
      line.className = "trip";
      line.textContent = `${u.name} · ${u.phone} · ${u.vehicle || ""} · ${u.registration || ""}`;
      const button = document.createElement("button");
      button.className = "btn yellow";
      button.textContent = "Approve driver";
      button.onclick = async () => {
        try {
          await call("approveDriver")({driverId:d.id});
        } catch(e) { say("admin-message",e.message); }
      };
      line.append(button);
      target.append(line);
    });
  });

  onSnapshot(collection(db,"rides"),snap => {
    const target = $("all-rides");
    if (!target) return;
    target.replaceChildren();
    snap.forEach(d => {
      const line = document.createElement("div");
      line.className = "trip";
      line.textContent = `${d.data().pickup} → ${d.data().destination} · ${d.data().status} · R${d.data().estimatedFare}`;
      target.append(line);
    });
  });
}
