
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

async function getUser(request) {
  if (!request.auth) throw new HttpsError("unauthenticated","Log in first.");
  const snap = await db.collection("users").doc(request.auth.uid).get();
  if (!snap.exists) throw new HttpsError("permission-denied","User profile missing.");
  return { uid:request.auth.uid, user:snap.data() };
}

async function adminOnly(request) {
  if (!request.auth || request.auth.token.admin !== true)
    throw new HttpsError("permission-denied","Administrator access required.");
}

function text(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 160)
    throw new HttpsError("invalid-argument","Invalid location.");
  return value.trim();
}

exports.createRide = onCall(async request => {
  const {uid,user} = await getUser(request);
  if (user.role !== "passenger")
    throw new HttpsError("permission-denied","Passenger account required.");

  const pickup = text(request.data.pickup);
  const destination = text(request.data.destination);
  const km = Number(request.data.distanceKm);

  if (!Number.isFinite(km) || km <= 0 || km > 150)
    throw new HttpsError("invalid-argument","Invalid distance.");

  // Fare: R12 starting fee + R1 per kilometre.
  const estimatedFare = Math.round((12 + km) * 100) / 100;

  const ride = {
    passengerId:uid,
    passengerName:user.name || "",
    pickup,
    destination,
    distanceKm:km,
    estimatedFare,
    paymentMethod:"cash",
    driverId:null,
    status:"requested",
    createdAt:FieldValue.serverTimestamp(),
    updatedAt:FieldValue.serverTimestamp()
  };

  const ref = await db.collection("rides").add(ride);
  return {rideId:ref.id,estimatedFare};
});

exports.setDriverAvailability = onCall(async request => {
  const {uid,user} = await getUser(request);
  if (user.role !== "driver" || user.approvalStatus !== "approved")
    throw new HttpsError("permission-denied","Driver must be approved.");

  if (typeof request.data.isOnline !== "boolean")
    throw new HttpsError("invalid-argument","Invalid online status.");

  await db.collection("users").doc(uid).update({
    isOnline:request.data.isOnline
  });
  return {ok:true};
});

exports.acceptRide = onCall(async request => {
  const {uid,user} = await getUser(request);
  if (user.role !== "driver" || user.approvalStatus !== "approved" || user.isOnline !== true)
    throw new HttpsError("permission-denied","Approved online driver required.");

  const rideRef = db.collection("rides").doc(text(request.data.rideId));

  await db.runTransaction(async tx => {
    const snap = await tx.get(rideRef);
    if (!snap.exists || snap.data().status !== "requested")
      throw new HttpsError("failed-precondition","Ride is no longer available.");

    tx.update(rideRef,{
      driverId:uid,
      driverName:user.name || "",
      status:"accepted",
      acceptedAt:FieldValue.serverTimestamp(),
      updatedAt:FieldValue.serverTimestamp()
    });
  });
  return {ok:true};
});

exports.startRide = onCall(async request => {
  const {uid} = await getUser(request);
  const ref = db.collection("rides").doc(text(request.data.rideId));

  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().driverId !== uid || snap.data().status !== "accepted")
      throw new HttpsError("failed-precondition","You cannot start this trip.");
    tx.update(ref,{status:"started",startedAt:FieldValue.serverTimestamp()});
  });
  return {ok:true};
});

exports.completeRide = onCall(async request => {
  const {uid} = await getUser(request);
  const ref = db.collection("rides").doc(text(request.data.rideId));

  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().driverId !== uid || snap.data().status !== "started")
      throw new HttpsError("failed-precondition","You cannot complete this trip.");
    tx.update(ref,{status:"completed",completedAt:FieldValue.serverTimestamp()});
  });
  return {ok:true};
});

exports.approveDriver = onCall(async request => {
  await adminOnly(request);
  const driverId = text(request.data.driverId);
  const ref = db.collection("users").doc(driverId);
  const snap = await ref.get();

  if (!snap.exists || snap.data().role !== "driver")
    throw new HttpsError("not-found","Driver not found.");

  await ref.update({
    approvalStatus:"approved",
    isOnline:false,
    approvedAt:FieldValue.serverTimestamp()
  });
  return {ok:true};
});
