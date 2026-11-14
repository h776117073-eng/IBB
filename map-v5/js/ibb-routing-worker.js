// محرك التوجيه والملاحة المتقدم لمنصة إب ماركت (IBB Market Routing & Navigation Engine v5.0)
// يدعم: السيارات، المشاة (الأقصر vs الأسهل الجبلي + الأزقة والسلالم)، النقاط الوسيطة (Waypoints)، المسارات البديلة، مرشح Kalman Filter، وMap Matching

class MinHeap {
  constructor() { this.data = []; }
  push(node, priority) {
    this.data.push({ node, priority });
    this._up(this.data.length - 1);
  }
  pop() {
    const top = this.data[0];
    const bottom = this.data.pop();
    if (this.data.length > 0) { this.data[0] = bottom; this._down(0); }
    return top;
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].priority <= this.data[i].priority) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }
  _down(i) {
    const len = this.data.length;
    while ((i << 1) + 1 < len) {
      let left = (i << 1) + 1, right = left + 1, min = i;
      if (this.data[left].priority < this.data[min].priority) min = left;
      if (right < len && this.data[right].priority < this.data[min].priority) min = right;
      if (min === i) break;
      [this.data[i], this.data[min]] = [this.data[min], this.data[i]];
      i = min;
    }
  }
  get size() { return this.data.length; }
}

// 1D/2D Kalman Filter for noisy GPS coordinates in mountain cities
class KalmanGPSFilter {
  constructor(processNoise = 1e-6, measurementNoise = 4e-5) {
    this.Q = processNoise;
    this.R = measurementNoise;
    this.lat = null;
    this.lng = null;
    this.P = 1.0;
  }
  update(rawLat, rawLng, accuracyMeters = 12) {
    const R_adj = this.R * Math.max(0.5, accuracyMeters / 10);
    if (this.lat === null) {
      this.lat = rawLat;
      this.lng = rawLng;
      this.P = R_adj;
      return { lat: this.lat, lng: this.lng, kalmanGain: 1.0 };
    }
    this.P += this.Q;
    const K = this.P / (this.P + R_adj);
    this.lat = this.lat + K * (rawLat - this.lat);
    this.lng = this.lng + K * (rawLng - this.lng);
    this.P = (1 - K) * this.P;
    return { lat: +this.lat.toFixed(6), lng: +this.lng.toFixed(6), kalmanGain: +K.toFixed(3) };
  }
}

const IBB_ROAD_SPEEDS_KMH = {
  trunk: 50,
  primary: 40,
  secondary: 30,
  tertiary: 22,
  residential: 16,
  service: 12,
  track: 12,
  footway: 4.5,
  alley: 4.2,
  steps: 3.2
};

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lon2 - lon1) * toRad);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function getTurnDirection(prevBearing, nextBearing) {
  if (prevBearing === null || prevBearing === undefined) return 'انطلق عبر';
  let diff = ((nextBearing - prevBearing + 540) % 360) - 180;
  if (Math.abs(diff) <= 25) return 'استمر مستقيماً عبر';
  if (diff > 25 && diff <= 125) return 'انعطف يميناً إلى';
  if (diff > 125) return 'التف يميناً إلى';
  if (diff < -25 && diff >= -125) return 'انعطف يساراً إلى';
  return 'التف يساراً إلى';
}

// Map Matching: Project a GPS coordinate onto the nearest segment of a route polyline
function snapToRouteSegment(lat, lng, routeCoords) {
  if (!Array.isArray(routeCoords) || routeCoords.length < 2) {
    return { snappedLat: lat, snappedLng: lng, offRouteMeters: 0, shouldReroute: false, segmentIndex: 0 };
  }
  let bestDist = Infinity;
  let bestLat = lat, bestLng = lng, bestIdx = 0;

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const [x1, y1] = routeCoords[i];     // [lng, lat]
    const [x2, y2] = routeCoords[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((lng - x1) * dx + (lat - y1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const projLng = x1 + t * dx;
    const projLat = y1 + t * dy;
    const d = haversineMeters(lat, lng, projLat, projLng);
    if (d < bestDist) {
      bestDist = d;
      bestLat = projLat;
      bestLng = projLng;
      bestIdx = i;
    }
  }
  const bearing = bestIdx < routeCoords.length - 1
    ? computeBearing(routeCoords[bestIdx][1], routeCoords[bestIdx][0], routeCoords[bestIdx + 1][1], routeCoords[bestIdx + 1][0])
    : 0;
  return {
    snappedLat: +bestLat.toFixed(6),
    snappedLng: +bestLng.toFixed(6),
    offRouteMeters: Math.round(bestDist),
    shouldReroute: bestDist > 38,
    segmentIndex: bestIdx,
    headingDeg: Math.round(bearing)
  };
}

function findNearestNodeId(graph, lat, lon, mode = 'driving') {
  const nodes = graph.nodes;
  let bestId = 0, bestDist = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = haversineMeters(lat, lon, nodes[i][0], nodes[i][1]);
    if (d < bestDist) { bestDist = d; bestId = i; }
  }
  return { id: bestId, distMeters: Math.round(bestDist), node: nodes[bestId] };
}

function runSingleAStar(graph, startNodeId, endNodeId, startLat, startLon, endLat, endLon, startSnapDist, endSnapDist, mode, penalizedEdges = null, walkPref = 'shortest') {
  const { nodes, adj, street_names } = graph;
  const endNode = nodes[endNodeId];
  const isWalking = mode === 'walking' || mode === 'walking_easiest' || mode === 'walking_shortest';
  const easiestWalk = mode === 'walking_easiest' || walkPref === 'easiest';
  const maxSpeedMps = isWalking ? 1.4 : (55 / 3.6);
  const gScore = new Float64Array(nodes.length).fill(Infinity);
  const prevNode = new Int32Array(nodes.length).fill(-1);
  const prevEdge = new Array(nodes.length).fill(null);
  const visited = new Uint8Array(nodes.length);

  const openSet = new MinHeap();
  gScore[startNodeId] = 0;
  openSet.push(startNodeId, 0);

  let exploredNodes = 0;
  while (openSet.size > 0) {
    const { node: u } = openSet.pop();
    if (u === endNodeId) break;
    if (visited[u]) continue;
    visited[u] = 1;
    exploredNodes++;

    const edges = adj[u] || [];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const to = e[0], dist = e[1], cls = e[2], sIdx = e[3], slope = e[4] || 0;
      // Strict mode validation: driving cannot use footway/alley/steps
      if (!isWalking && (cls === 'footway' || cls === 'steps' || cls === 'alley')) continue;

      const baseKmh = isWalking ? (cls === 'steps' ? 3.2 : 4.6) : (IBB_ROAD_SPEEDS_KMH[cls] || 18);
      let slopeFactor = 1.0;
      if (isWalking) {
        slopeFactor = easiestWalk
          ? (Math.abs(slope) > 0.05 ? 2.4 : 1.0)
          : (slope > 0.08 ? 1.25 : 1.0);
      } else {
        slopeFactor = slope > 0.08 ? 1.35 : (slope < -0.08 ? 1.15 : 1.0);
      }
      const penalty = (penalizedEdges && penalizedEdges.has(`${u}->${to}`)) ? 2.2 : 1.0;
      const edgeCost = (dist / (baseKmh / 3.6)) * slopeFactor * penalty;
      const tentativeG = gScore[u] + edgeCost;

      if (tentativeG < gScore[to]) {
        gScore[to] = tentativeG;
        prevNode[to] = u;
        const bearing = computeBearing(nodes[u][0], nodes[u][1], nodes[to][0], nodes[to][1]);
        prevEdge[to] = { from: u, to, dist, cls, street: street_names[sIdx] || 'طريق محلي', slope, bearing };
        const nCoord = nodes[to];
        const hTimeSec = haversineMeters(nCoord[0], nCoord[1], endNode[0], endNode[1]) / maxSpeedMps;
        openSet.push(to, tentativeG + hTimeSec);
      }
    }
  }

  if (gScore[endNodeId] === Infinity) return null;

  const pathCoords = [[endLon, endLat]];
  const rawSteps = [];
  let curr = endNodeId;
  while (curr !== -1) {
    pathCoords.push([nodes[curr][1], nodes[curr][0]]);
    if (prevEdge[curr]) rawSteps.push(prevEdge[curr]);
    curr = prevNode[curr];
  }
  pathCoords.push([startLon, startLat]);
  pathCoords.reverse();
  rawSteps.reverse();

  const mergedSteps = [];
  for (const s of rawSteps) {
    const last = mergedSteps[mergedSteps.length - 1];
    if (last && last.street === s.street) {
      last.dist += s.dist;
      last.endBearing = s.bearing;
    } else {
      mergedSteps.push({
        street: s.street, dist: s.dist, cls: s.cls, slope: s.slope,
        startBearing: s.bearing, endBearing: s.bearing
      });
    }
  }

  const instructions = mergedSteps.map((s, idx) => {
    const dTxt = s.dist >= 1000 ? `${(s.dist / 1000).toFixed(2)} كم` : `${Math.round(s.dist)} متر`;
    const prefix = idx === 0
      ? (isWalking ? 'اسلك مشياً' : 'انطلق عبر')
      : getTurnDirection(mergedSteps[idx - 1].endBearing, s.startBearing);
    const slopeNote = s.slope > 0.06 ? ' (عقبة/صعود جبلي)' : (s.slope < -0.06 ? ' (منحدر)' : '');
    const alleyNote = (s.cls === 'footway' || s.street.includes('زغط')) ? ' [ممر مشاة/زغط]' : '';
    return {
      text: `${prefix} ${s.street}${alleyNote} لمسافة ${dTxt}${slopeNote}`,
      maneuver: prefix,
      distMeters: Math.round(s.dist),
      street: s.street,
      roadClass: s.cls
    };
  });

  const totalDist = Math.round(
    rawSteps.reduce((acc, s) => acc + s.dist, 0) + startSnapDist + endSnapDist
  );
  const extraSec = (startSnapDist + endSnapDist) / (isWalking ? 1.25 : 6.0);
  const totalSec = Math.max(30, Math.round(gScore[endNodeId] + extraSec));

  return {
    exploredNodes,
    durationSeconds: totalSec,
    distanceMeters: totalDist,
    rawSteps,
    geometry: { type: 'LineString', coordinates: pathCoords },
    steps: instructions
  };
}

function computeOfflineRoute(graph, startLat, startLon, endLat, endLon, mode = 'driving', waypoints = []) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const points = [{ lat: startLat, lng: startLon }, ...(waypoints || []), { lat: endLat, lng: endLon }];

  let totalDist = 0, totalSec = 0, totalExplored = 0;
  const combinedCoords = [];
  const combinedSteps = [];
  const legs = [];

  for (let p = 0; p < points.length - 1; p++) {
    const A = points[p], B = points[p + 1];
    const sSnap = findNearestNodeId(graph, A.lat, A.lng, mode);
    const eSnap = findNearestNodeId(graph, B.lat, B.lng, mode);
    const leg = runSingleAStar(graph, sSnap.id, eSnap.id, A.lat, A.lng, B.lat, B.lng, sSnap.distMeters, eSnap.distMeters, mode);
    if (!leg) return null;
    totalDist += leg.distanceMeters;
    totalSec += leg.durationSeconds;
    totalExplored += leg.exploredNodes;
    legs.push({
      legIndex: p + 1,
      distanceMeters: leg.distanceMeters,
      durationSeconds: leg.durationSeconds,
      steps: leg.steps
    });
    leg.geometry.coordinates.forEach((c, idx) => {
      if (p > 0 && idx === 0) return;
      combinedCoords.push(c);
    });
    combinedSteps.push(...leg.steps);
  }

  const startSnap = findNearestNodeId(graph, startLat, startLon, mode);
  const endSnap = findNearestNodeId(graph, endLat, endLon, mode);

  // Compute alternative route (or Easiest Less-Steep Route for pedestrians)
  const alternatives = [];
  const firstLeg = runSingleAStar(graph, startSnap.id, endSnap.id, startLat, startLon, endLat, endLon, startSnap.distMeters, endSnap.distMeters, mode);
  if (firstLeg && firstLeg.rawSteps.length >= 2) {
    const pen = new Set();
    firstLeg.rawSteps.forEach(s => pen.add(`${s.from}->${s.to}`));
    const isWalk = mode.startsWith('walking');
    const alt = runSingleAStar(
      graph, startSnap.id, endSnap.id, startLat, startLon, endLat, endLon,
      startSnap.distMeters, endSnap.distMeters, isWalk ? 'walking_easiest' : mode, pen, 'easiest'
    );
    if (alt) {
      const diffDist = alt.distanceMeters - totalDist;
      const diffMin = Math.round((alt.durationSeconds - totalSec) / 60);
      alternatives.push({
        label: isWalk ? 'المسار الأسهل (الأقل انحداراً للمشاة)' : 'المسار البديل الموازي',
        diffSummary: `${diffDist >= 0 ? '+' : ''}${diffDist} م (${diffMin >= 0 ? '+' : ''}${diffMin} د)`,
        durationSeconds: alt.durationSeconds,
        distanceMeters: alt.distanceMeters,
        geometry: alt.geometry,
        steps: alt.steps
      });
    }
  }

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    engine: mode.startsWith('walking')
      ? 'Pedestrian & Alley Routing Engine (Ibb Mountain Profile)'
      : 'Vehicle A* Road Graph + Kalman/MapMatching',
    mode,
    computeMs: +(now - t0).toFixed(2),
    exploredNodes: totalExplored,
    durationSeconds: totalSec,
    distanceMeters: totalDist,
    startNodeName: startSnap.node[3],
    endNodeName: endSnap.node[3],
    legs,
    geometry: { type: 'LineString', coordinates: combinedCoords },
    steps: combinedSteps,
    alternatives
  };
}

let GRAPH = null;
const kalmanFilter = new KalmanGPSFilter();

if (typeof self !== 'undefined') {
  self.onmessage = (e) => {
    const { type, payload, reqId } = e.data || {};
    if (type === 'INIT_GRAPH') {
      GRAPH = payload;
      self.postMessage({ type: 'GRAPH_READY', nodes: GRAPH.nodes.length });
    } else if (type === 'ROUTE' && GRAPH) {
      const res = computeOfflineRoute(
        GRAPH, payload.startLat, payload.startLon, payload.endLat, payload.endLon,
        payload.mode || 'driving', payload.waypoints || []
      );
      self.postMessage({ type: 'ROUTE_RESULT', reqId, result: res });
    } else if (type === 'SNAP_GPS') {
      const filtered = kalmanFilter.update(payload.lat, payload.lng, payload.accuracy || 10);
      const snapped = snapToRouteSegment(filtered.lat, filtered.lng, payload.routeCoords || []);
      self.postMessage({ type: 'SNAP_GPS_RESULT', reqId, result: { ...filtered, ...snapped } });
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    KalmanGPSFilter, snapToRouteSegment, computeBearing,
    getTurnDirection, findNearestNodeId, computeOfflineRoute
  };
}
