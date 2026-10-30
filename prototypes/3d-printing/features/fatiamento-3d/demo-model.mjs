function boundsFor(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  return { min, max, dimensions: min.map((value, axis) => max[axis] - value) };
}

function triangle(output, a, b, c) { output.push(...a, ...b, ...c); }

function addBox(output, min, max) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const points = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  for (const face of [[0,2,1,0,3,2],[4,5,6,4,6,7],[0,1,5,0,5,4],[1,2,6,1,6,5],[2,3,7,2,7,6],[3,0,4,3,4,7]]) {
    triangle(output, points[face[0]], points[face[1]], points[face[2]]);
    triangle(output, points[face[3]], points[face[4]], points[face[5]]);
  }
}

function addHull(output) {
  const stations = [
    { y: -54, bottom: 7, top: 22, halfWidth: 20 },
    { y: -44, bottom: 2, top: 25, halfWidth: 27 },
    { y: -20, bottom: 1, top: 25, halfWidth: 29 },
    { y: 13, bottom: 3, top: 25, halfWidth: 25 },
    { y: 38, bottom: 8, top: 27, halfWidth: 16 },
    { y: 55, bottom: 20, top: 32, halfWidth: 4 },
  ];
  const rings = stations.map(({ y, bottom, top, halfWidth }) => [
    [-halfWidth, y, bottom], [halfWidth, y, bottom], [halfWidth, y, top], [-halfWidth, y, top],
  ]);
  for (let index = 0; index < rings.length - 1; index++) {
    const current = rings[index], next = rings[index + 1];
    for (const side of [[0,1],[1,2],[2,3],[3,0]]) {
      const [a, b] = side;
      triangle(output, current[a], next[a], next[b]);
      triangle(output, current[a], next[b], current[b]);
    }
    triangle(output, current[2], current[3], next[3]);
    triangle(output, current[2], next[3], next[2]);
  }
  const first = rings[0], last = rings.at(-1);
  triangle(output, first[0], first[2], first[1]); triangle(output, first[0], first[3], first[2]);
  triangle(output, last[0], last[1], last[2]); triangle(output, last[0], last[2], last[3]);
}

function addChimney(output, centerX, centerY, base, radius, height, sides = 12) {
  const lower = [], upper = [];
  for (let index = 0; index < sides; index++) {
    const angle = index / sides * Math.PI * 2;
    lower.push([centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius, base]);
    upper.push([centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius, base + height]);
  }
  const bottomCenter = [centerX, centerY, base], topCenter = [centerX, centerY, base + height];
  for (let index = 0; index < sides; index++) {
    const next = (index + 1) % sides;
    triangle(output, lower[index], upper[index], upper[next]);
    triangle(output, lower[index], upper[next], lower[next]);
    triangle(output, bottomCenter, lower[next], lower[index]);
    triangle(output, topCenter, upper[index], upper[next]);
  }
}

export function createDemoModel() {
  const raw = [];
  addHull(raw);
  addBox(raw, [-15, -27, 24], [15, 6, 43]);
  addBox(raw, [-19, -31, 42], [19, 11, 46]);
  addBox(raw, [-23, -40, 22], [23, -29, 31]);
  addChimney(raw, 0, -17, 46, 4.5, 10);
  const positions = new Float32Array(raw);
  const bounds = boundsFor(positions);
  const meshObject = { id: "demo-boat", name: "Barco de teste", positions, triangleCount: positions.length / 9, bounds };
  return {
    id: "demo-boat",
    name: "Barco de teste · demonstração",
    format: "DEMO",
    size: 0,
    objects: [meshObject],
    triangleCount: meshObject.triangleCount,
    bounds,
    sourceUnit: "millimeter",
    originalFile: null,
    demo: true,
  };
}
