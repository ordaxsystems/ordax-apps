const vertexSource = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec3 aColor;
uniform mat4 uViewProjection;
uniform mat4 uModel;
uniform bool uLit;
out vec3 vColor;
out vec3 vNormal;
void main() {
  gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0);
  vColor = aColor;
  vNormal = normalize(mat3(uModel) * aNormal);
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec3 vColor;
in vec3 vNormal;
uniform bool uLit;
out vec4 outColor;
void main() {
  float light = uLit ? 0.44 + 0.56 * max(dot(normalize(vNormal), normalize(vec3(-0.38, -0.55, 0.74))), 0.0) : 1.0;
  outColor = vec4(vColor * light, 1.0);
}`;

function compile(gl, kind, source) {
  const shader = gl.createShader(kind);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Falha no shader WebGL.";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Não foi possível preparar a visualização 3D.");
  return program;
}

const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function multiply(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    out[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
  }
  return out;
}

function translation(x, y, z) {
  const out = identity(); out[12] = x; out[13] = y; out[14] = z; return out;
}

function rotationZ(radians) {
  const out = identity(), cosine = Math.cos(radians), sine = Math.sin(radians);
  out[0] = cosine; out[1] = sine; out[4] = -sine; out[5] = cosine;
  return out;
}

function rotationX(radians) {
  const out = identity(), cosine = Math.cos(radians), sine = Math.sin(radians);
  out[5] = cosine; out[6] = sine; out[9] = -sine; out[10] = cosine;
  return out;
}

function rotationY(radians) {
  const out = identity(), cosine = Math.cos(radians), sine = Math.sin(radians);
  out[0] = cosine; out[2] = -sine; out[8] = sine; out[10] = cosine;
  return out;
}

function uniformScale(value) {
  const out = identity(); out[0] = value; out[5] = value; out[10] = value; return out;
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), out = new Float32Array(16);
  out[0] = f / aspect; out[5] = f; out[10] = (far + near) / (near - far); out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map(value => value / length);
}

function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function lookAt(eye, center, up = [0, 0, 1]) {
  const z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  const x = normalize(cross(up, z)), y = cross(z, x);
  const out = identity();
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0];
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1];
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2];
  out[12] = -dot(x, eye); out[13] = -dot(y, eye); out[14] = -dot(z, eye);
  return out;
}

function createBuffer(gl, data, location, size) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  return buffer;
}

function meshNormals(positions) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i + 3] - positions[i], ay = positions[i + 4] - positions[i + 1], az = positions[i + 5] - positions[i + 2];
    const bx = positions[i + 6] - positions[i], by = positions[i + 7] - positions[i + 1], bz = positions[i + 8] - positions[i + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, length = Math.hypot(nx, ny, nz) || 1;
    for (let vertex = 0; vertex < 3; vertex++) normals.set([nx / length, ny / length, nz / length], i + vertex * 3);
  }
  return normals;
}

function buildGrid(width, depth) {
  const positions = [], colors = [];
  const addLine = (ax, ay, bx, by, major = false) => {
    positions.push(ax, ay, 0, bx, by, 0);
    const color = major ? [0.24, 0.39, 0.40] : [0.14, 0.24, 0.27];
    colors.push(...color, ...color);
  };
  const halfWidth = width / 2, halfDepth = depth / 2;
  for (let x = -halfWidth; x <= halfWidth + 0.001; x += 10) addLine(x, -halfDepth, x, halfDepth, Math.abs(x % 50) < 0.001);
  for (let y = -halfDepth; y <= halfDepth + 0.001; y += 10) addLine(-halfWidth, y, halfWidth, y, Math.abs(y % 50) < 0.001);
  addLine(-halfWidth, -halfDepth, halfWidth, -halfDepth, true);
  addLine(halfWidth, -halfDepth, halfWidth, halfDepth, true);
  addLine(halfWidth, halfDepth, -halfWidth, halfDepth, true);
  addLine(-halfWidth, halfDepth, -halfWidth, -halfDepth, true);
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) };
}

export function createMeshViewer(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, powerPreference: "high-performance" });
  if (!gl) throw new Error("Este navegador não disponibilizou WebGL 2 para a visualização do modelo.");
  const program = createProgram(gl);
  const locations = {
    position: gl.getAttribLocation(program, "aPosition"), normal: gl.getAttribLocation(program, "aNormal"), color: gl.getAttribLocation(program, "aColor"),
    viewProjection: gl.getUniformLocation(program, "uViewProjection"), model: gl.getUniformLocation(program, "uModel"), lit: gl.getUniformLocation(program, "uLit"),
  };
  const meshBuffer = gl.createBuffer(), normalBuffer = gl.createBuffer(), meshColorBuffer = gl.createBuffer();
  let mesh = null, grid = null, gridBuffer = null, gridColorBuffer = null, disposed = false;
  let orbit = { azimuth: -0.72, polar: 0.88, zoom: 1 };
  let settings = { bed: [256, 256, 256], rotation: 0, scale: 1, unitScale: 1 };
  const emptyCameraSize = 360;

  const bindMeshAttribute = (buffer, location, size) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };

  function updateMeshColors() {
    if (!mesh) return;
    const colors = new Float32Array(mesh.positions.length);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = 0.33; colors[i + 1] = 0.83; colors[i + 2] = 0.75; }
    for (const range of mesh.objectRanges || []) {
      if (range.id !== mesh.selectedObjectId) continue;
      const first = Math.max(0, range.firstVertex) * 3;
      const end = Math.min(mesh.positions.length / 3, range.firstVertex + range.vertexCount) * 3;
      for (let index = first; index < end; index += 3) { colors[index] = 1; colors[index + 1] = 0.53; colors[index + 2] = 0.25; }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, meshColorBuffer); gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
  }

  function updateMesh(model) {
    mesh = model;
    if (!mesh) return draw();
    gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer); gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer); gl.bufferData(gl.ARRAY_BUFFER, meshNormals(mesh.positions), gl.STATIC_DRAW);
    updateMeshColors();
    draw();
  }

  function updateSettings(next = {}) {
    settings = { ...settings, ...next };
    const [width, depth] = settings.bed;
    grid = buildGrid(width, depth);
    if (!gridBuffer) gridBuffer = gl.createBuffer();
    if (!gridColorBuffer) gridColorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer); gl.bufferData(gl.ARRAY_BUFFER, grid.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, gridColorBuffer); gl.bufferData(gl.ARRAY_BUFFER, grid.colors, gl.STATIC_DRAW);
    draw();
  }

  function draw() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2), width = Math.floor(rect.width * ratio), height = Math.floor(rect.height * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.035, 0.055, 0.067, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(program);

    const sceneBounds = mesh?.visualBounds || mesh?.bounds;
    const sceneCenter = sceneBounds ? sceneBounds.min.map((value, axis) => (value + sceneBounds.max[axis]) / 2) : [0, 0, 0];
    const targetZ = sceneBounds ? Math.max(sceneBounds.min[2] + sceneBounds.dimensions[2] * 0.38, 16) : 14;
    const extentFromOrigin = sceneBounds ? Math.max(...sceneBounds.min.map(Math.abs), ...sceneBounds.max.map(Math.abs)) : 0;
    const sceneRadius = mesh ? Math.max(settings.bed[0], settings.bed[1], sceneBounds?.dimensions[2] || 0, extentFromOrigin, 80) * 1.85 / orbit.zoom : emptyCameraSize / orbit.zoom;
    const eye = [
      sceneRadius * Math.sin(orbit.polar) * Math.cos(orbit.azimuth),
      sceneRadius * Math.sin(orbit.polar) * Math.sin(orbit.azimuth),
      targetZ + sceneRadius * Math.cos(orbit.polar),
    ];
    const view = lookAt([eye[0] + sceneCenter[0], eye[1] + sceneCenter[1], eye[2]], [sceneCenter[0], sceneCenter[1], targetZ]);
    const projection = perspective(Math.PI / 4.3, width / height, 0.1, Math.max(sceneRadius * 8, 2500));
    const viewProjection = multiply(projection, view);
    gl.uniformMatrix4fv(locations.viewProjection, false, viewProjection);

    if (grid) {
      bindMeshAttribute(gridBuffer, locations.position, 3);
      gl.disableVertexAttribArray(locations.normal); gl.vertexAttrib3f(locations.normal, 0, 0, 1);
      bindMeshAttribute(gridColorBuffer, locations.color, 3);
      gl.uniformMatrix4fv(locations.model, false, identity()); gl.uniform1i(locations.lit, 0);
      gl.drawArrays(gl.LINES, 0, grid.positions.length / 3);
    }
    if (mesh) {
      bindMeshAttribute(meshBuffer, locations.position, 3);
      bindMeshAttribute(normalBuffer, locations.normal, 3);
      bindMeshAttribute(meshColorBuffer, locations.color, 3);
      const centerX = (mesh.bounds.min[0] + mesh.bounds.max[0]) / 2;
      const centerY = (mesh.bounds.min[1] + mesh.bounds.max[1]) / 2;
      gl.uniform1i(locations.lit, 1);
      let baseMatrix = rotationZ(settings.rotation * Math.PI / 180);
      baseMatrix = multiply(baseMatrix, uniformScale(settings.scale * settings.unitScale));
      baseMatrix = multiply(baseMatrix, translation(-centerX, -centerY, -mesh.bounds.min[2]));
      const ranges = mesh.objectRanges || [];
      if (ranges.length) {
        for (const range of ranges) {
          const transform = range.transform || {};
          const bounds = range.bounds;
          const center = bounds ? bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2) : [0, 0, 0];
          let localMatrix = translation(center[0], center[1], center[2]);
          localMatrix = multiply(localMatrix, rotationZ((Number(transform.rotationZ) || 0) * Math.PI / 180));
          localMatrix = multiply(localMatrix, rotationY((Number(transform.rotationY) || 0) * Math.PI / 180));
          localMatrix = multiply(localMatrix, rotationX((Number(transform.rotationX) || 0) * Math.PI / 180));
          localMatrix = multiply(localMatrix, uniformScale(Number(transform.scale) || 1));
          localMatrix = multiply(localMatrix, translation(-center[0], -center[1], -center[2]));
          const offset = Array.isArray(transform.positionMm) ? transform.positionMm : [Number(transform.x) || 0, Number(transform.y) || 0, Number(transform.z) || 0];
          const modelMatrix = multiply(translation(...offset.map(value => Number(value) || 0)), multiply(baseMatrix, localMatrix));
          gl.uniformMatrix4fv(locations.model, false, modelMatrix);
          gl.drawArrays(gl.TRIANGLES, range.firstVertex, range.vertexCount);
        }
      } else {
        gl.uniformMatrix4fv(locations.model, false, baseMatrix);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.positions.length / 3);
      }
    }
  }

  let dragging = false, last = null;
  canvas.addEventListener("pointerdown", event => { dragging = true; last = [event.clientX, event.clientY]; canvas.setPointerCapture(event.pointerId); canvas.classList.add("is-dragging"); });
  canvas.addEventListener("pointermove", event => {
    if (!dragging || !last) return;
    const dx = event.clientX - last[0], dy = event.clientY - last[1]; last = [event.clientX, event.clientY];
    orbit.azimuth -= dx * 0.009; orbit.polar = Math.max(0.12, Math.min(1.48, orbit.polar - dy * 0.009)); draw();
  });
  const stopDrag = () => { dragging = false; last = null; canvas.classList.remove("is-dragging"); };
  canvas.addEventListener("pointerup", stopDrag); canvas.addEventListener("pointercancel", stopDrag);
  canvas.addEventListener("wheel", event => { event.preventDefault(); orbit.zoom = Math.max(0.48, Math.min(3.5, orbit.zoom * Math.exp(-event.deltaY * 0.001))); draw(); }, { passive: false });
  const observer = new ResizeObserver(draw); observer.observe(canvas);
  const reset = () => { orbit = { azimuth: -0.72, polar: 0.88, zoom: 1 }; draw(); };
  updateSettings();

  return {
    setMesh: updateMesh,
    setSettings: updateSettings,
    reset,
    dispose() {
      disposed = true; observer.disconnect();
      gl.deleteBuffer(meshBuffer); gl.deleteBuffer(normalBuffer); gl.deleteBuffer(meshColorBuffer);
      if (gridBuffer) gl.deleteBuffer(gridBuffer); if (gridColorBuffer) gl.deleteBuffer(gridColorBuffer);
      gl.deleteProgram(program);
    },
  };
}
