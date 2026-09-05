/**
 * Vista 3D interactiva (Three.js) del detalle de armaduras de una zapata
 * (aislada o combinada), a partir de los mismos resultados estructurales
 * que usa el detalle 2D. Convención de ejes: X = largo de la zapata (L),
 * Z = ancho (B), Y = altura (vertical) — igual que un plano en planta con
 * la altura "saliendo" de la hoja.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const COLORS_ISOLATED = {
  long_dir: 0x2563eb,   // Acero dirección larga (uniforme) — azul
  short_band: 0xdc2626, // Acero dirección corta, banda central — rojo
  short_outer: 0xf97316, // Acero dirección corta, franjas exteriores — naranja
  dowels: 0x64748b,      // Espera / arranque de columna — gris
};

const COLORS_COMBINED = {
  bottom_long: 0x2563eb, // Acero longitudinal inferior (voladizos) — azul
  top_long: 0xdc2626,    // Acero longitudinal superior (entre columnas) — rojo
  trans_col1: 0xf97316,  // Transversal bajo columna 1 — naranja
  trans_col2: 0xeab308,  // Transversal bajo columna 2 — amarillo
  dowels: 0x64748b,
};

const REBAR_EXAGGERATION = 3;

export class FootingRenderer3D {
  constructor(container) {
    this.container = container;
    this.footingData = null;
    this.structResults = null;
    this._animating = false;
    this.colors = COLORS_ISOLATED;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(4, 8, 6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-5, 4, -6);
    this.scene.add(fill);

    this.concreteGroup = new THREE.Group();
    this.rebarGroup = new THREE.Group();
    this.annotationGroup = new THREE.Group();
    this.scene.add(this.concreteGroup, this.rebarGroup, this.annotationGroup);

    this.rebarSubgroups = {};
    this._buildSubgroups();

    this.rebarScaleFactor = REBAR_EXAGGERATION;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  _buildSubgroups() {
    Object.values(this.rebarSubgroups).forEach((g) => this.rebarGroup.remove(g));
    this.rebarSubgroups = {};
    Object.keys(this.colors).forEach((k) => {
      const g = new THREE.Group();
      this.rebarSubgroups[k] = g;
      this.rebarGroup.add(g);
    });
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this._clearGroup(this.concreteGroup);
    this._clearGroup(this.rebarGroup);
    this._clearGroup(this.annotationGroup);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w < 2 || h < 2) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  start() {
    this.resize();
    if (this._animating) return;
    this._animating = true;
    const loop = () => {
      if (!this._animating) return;
      if (this.renderer.domElement.width < 2 || this.renderer.domElement.height < 2) this.resize();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() { this._animating = false; }

  captureSnapshot(width = 900, height = 700) {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const usesFallbackSize = w < 2 || h < 2;
    if (usesFallbackSize) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    let dataUrl = '';
    try { dataUrl = this.renderer.domElement.toDataURL('image/png'); } catch (e) { /* WebGL no disponible aún */ }
    if (usesFallbackSize) this.resize();
    return dataUrl;
  }

  updateData(footingData, bearingResults, structResults) {
    this.footingData = footingData;
    this.structResults = structResults;
    if (!footingData || !structResults) return;
    this.colors = footingData.footing_type === 'aislada' ? COLORS_ISOLATED : COLORS_COMBINED;
    this._buildSubgroups();
    this._clearGroup(this.concreteGroup);
    this._clearGroup(this.annotationGroup);
    if (footingData.footing_type === 'aislada') {
      this._buildIsolated(footingData, structResults);
    } else {
      this._buildCombined(footingData, structResults);
    }
  }

  _clearGroup(group) {
    while (group.children.length) {
      const obj = group.children.pop();
      obj.geometry?.dispose();
      obj.material?.map?.dispose();
      obj.material?.dispose();
    }
  }

  setRebarTypeVisible(key, visible) {
    const g = this.rebarSubgroups[key];
    if (g) g.visible = visible;
  }

  setRebarRealScale(useReal) {
    this.rebarScaleFactor = useReal ? 1 : REBAR_EXAGGERATION;
    if (!this.footingData || !this.structResults) return;
    if (this.footingData.footing_type === 'aislada') this._buildIsolated(this.footingData, this.structResults);
    else this._buildCombined(this.footingData, this.structResults);
  }

  _bar(p1, p2, radius, color) {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const length = dir.length();
    if (length < 1e-4) return null;
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1, false);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.55 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return mesh;
  }

  _addBar(p1, p2, radius, key) {
    const mesh = this._bar(p1, p2, radius * this.rebarScaleFactor, this.colors[key]);
    if (mesh) this.rebarSubgroups[key].add(mesh);
  }

  _addConcreteBox(cx, cy, cz, sx, sy, sz) {
    const geometry = new THREE.BoxGeometry(sx, sy, sz);
    const material = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1, transparent: true, opacity: 0.45, side: THREE.DoubleSide, roughness: 0.9, metalness: 0.0, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(cx, cy, cz);
    this.concreteGroup.add(mesh);
    const edges = new THREE.EdgesGeometry(geometry, 20);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.5 }));
    line.position.set(cx, cy, cz);
    this.concreteGroup.add(line);
  }

  // ===================================================================
  // ZAPATA AISLADA
  // ===================================================================
  _buildIsolated(fd, str) {
    const { isolated } = fd;
    const { L, B, h, col_L, col_B } = isolated;
    const ex = isolated.ex_col || 0, ez = isolated.ey_col || 0;
    const stemH = Math.max(0.5, Math.min(1.2, h * 1.4));
    const cover = fd.materials.cover_footing;

    this._addConcreteBox(0, h / 2, 0, L, h, B);
    this._addConcreteBox(ex, h + stemH / 2, ez, col_L, stemH, col_B);

    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const dbMain = str.dbMain;
    const rMain = dbMain.diameter_m / 2;
    const hook = Math.max(0.08, dbMain.diameter_m * 12);

    const longIsL = str.isLLong;
    const yLow = cover + rMain; // capa inferior (dirección larga)
    const yHigh = yLow + rMain + rMain; // capa superior (dirección corta)
    const yLongDir = longIsL ? yLow : yHigh;
    const yShortDir = longIsL ? yHigh : yLow;

    const positionsIn = (spacingCm, half) => {
      const s = Math.max(0.03, (spacingCm || 20) / 100);
      const list = [];
      for (let p = -half + s / 2; p <= half - s / 2 + 1e-6; p += s) list.push(p);
      return list.length ? list : [0];
    };

    // Dirección larga (uniforme): barras paralelas a ese eje
    const longSpacing = longIsL ? str.L_dir.spacing : str.B_dir.spacing;
    const longAxisIsX = longIsL; // si L es larga, esas barras corren en X
    const longRunHalf = (longAxisIsX ? L : B) / 2 - cover;
    const longSpreadHalf = (longAxisIsX ? B : L) / 2;
    positionsIn(longSpacing, longSpreadHalf).forEach((p) => {
      if (longAxisIsX) this._addBar(V(-longRunHalf, yLongDir, p), V(longRunHalf, yLongDir, p), rMain, 'long_dir');
      else this._addBar(V(p, yLongDir, -longRunHalf), V(p, yLongDir, longRunHalf), rMain, 'long_dir');
    });

    // Dirección corta: banda central + franjas exteriores
    const shortAxisIsX = !longAxisIsX;
    const shortRunHalf = (shortAxisIsX ? L : B) / 2 - cover;
    const bandHalf = str.banding.bandWidth / 2;
    positionsIn(str.banding.sp_band, bandHalf).forEach((p) => {
      if (shortAxisIsX) this._addBar(V(-shortRunHalf, yShortDir, p), V(shortRunHalf, yShortDir, p), rMain, 'short_band');
      else this._addBar(V(p, yShortDir, -shortRunHalf), V(p, yShortDir, shortRunHalf), rMain, 'short_band');
    });
    if (str.banding.sp_outer) {
      const outerTo = (shortAxisIsX ? B : L) / 2;
      const s = Math.max(0.03, str.banding.sp_outer / 100);
      for (let p = bandHalf + s / 2; p <= outerTo - s / 2 + 1e-6; p += s) {
        [p, -p].forEach((pp) => {
          if (shortAxisIsX) this._addBar(V(-shortRunHalf, yShortDir, pp), V(shortRunHalf, yShortDir, pp), rMain, 'short_outer');
          else this._addBar(V(pp, yShortDir, -shortRunHalf), V(pp, yShortDir, shortRunHalf), rMain, 'short_outer');
        });
      }
    }

    // Esperas / arranque de columna (4 esquinas), desde la parrilla hasta la corona del muñón
    const yDowelTop = h + stemH - cover;
    const yDowelBot = Math.max(yLow, yHigh) + rMain;
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => {
      const dx = ex + sx * (col_L / 2 - cover);
      const dz = ez + sz * (col_B / 2 - cover);
      this._addBar(V(dx, yDowelBot, dz), V(dx, yDowelTop, dz), rMain * 0.6, 'dowels');
    });

    this._buildAnnotationsIsolated(fd, str, stemH);
    this._fitCamera(L, B, h + stemH);
  }

  // ===================================================================
  // ZAPATA COMBINADA
  // ===================================================================
  _buildCombined(fd, str) {
    const { combined } = fd;
    const { L, B, h, a1, s, col1_L, col1_B, col2_L, col2_B } = combined;
    const a2 = a1 + s;
    const stemH = Math.max(0.5, Math.min(1.2, h * 1.2));
    const cover = fd.materials.cover_footing;

    this._addConcreteBox(L / 2, h / 2, 0, L, h, B);
    this._addConcreteBox(a1, h + stemH / 2, 0, col1_L, stemH, col1_B);
    this._addConcreteBox(a2, h + stemH / 2, 0, col2_L, stemH, col2_B);

    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const dbMain = str.dbMain, dbTrans = str.dbTrans;
    const rMain = dbMain.diameter_m / 2, rTrans = dbTrans.diameter_m / 2;

    const yBottom = cover + rMain;
    const yTop = h - cover - rMain;
    const zHalf = B / 2 - cover;

    const positionsIn = (spacingCm, half) => {
      const sp = Math.max(0.03, (spacingCm || 20) / 100);
      const list = [];
      for (let p = -half + sp / 2; p <= half - sp / 2 + 1e-6; p += sp) list.push(p);
      return list.length ? list : [0];
    };
    // Igual que positionsIn, pero entre dos límites absolutos (no simétrico
    // respecto de 0) — para el acero transversal, cuya franja de reparto no
    // está centrada en el eje de la columna sino entre el borde de la
    // zapata y el punto medio hacia la columna vecina.
    const positionsBetween = (spacingCm, x0, x1) => {
      const sp = Math.max(0.03, (spacingCm || 20) / 100);
      const list = [];
      for (let p = x0 + sp / 2; p <= x1 - sp / 2 + 1e-6; p += sp) list.push(p);
      return list.length ? list : [(x0 + x1) / 2];
    };

    positionsIn(str.bottom.spacing, zHalf).forEach((z) => {
      this._addBar(V(cover, yBottom, z), V(L - cover, yBottom, z), rMain, 'bottom_long');
    });
    positionsIn(str.top.spacing, zHalf).forEach((z) => {
      this._addBar(V(cover, yTop, z), V(L - cover, yTop, z), rMain, 'top_long');
    });

    // Franja de reparto de cada columna: desde el borde de la zapata más
    // cercano hasta el punto medio entre los ejes de columna (igual
    // criterio que calculateCombinedRebarSchedule), acotada siempre dentro
    // de [cover, L-cover] para que ninguna barra sobresalga del sólido.
    const xMid = (a1 + a2) / 2;
    positionsBetween(str.trans1.spacing, cover, Math.min(xMid, L - cover)).forEach((x) => {
      this._addBar(V(x, yBottom + 2 * rMain, -zHalf), V(x, yBottom + 2 * rMain, zHalf), rTrans, 'trans_col1');
    });
    positionsBetween(str.trans2.spacing, Math.max(xMid, cover), L - cover).forEach((x) => {
      this._addBar(V(x, yBottom + 2 * rMain, -zHalf), V(x, yBottom + 2 * rMain, zHalf), rTrans, 'trans_col2');
    });

    const yDowelTop = h + stemH - cover;
    [[a1, col1_L, col1_B], [a2, col2_L, col2_B]].forEach(([xc, cl, cb]) => {
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => {
        const dx = xc + sx * (cl / 2 - cover);
        const dz = sz * (cb / 2 - cover);
        this._addBar(V(dx, yBottom + 4 * rMain, dz), V(dx, yDowelTop, dz), rMain * 0.6, 'dowels');
      });
    });

    this._buildAnnotationsCombined(fd, str, stemH);
    this._fitCamera(L, B, h + stemH);
  }

  // ===================================================================
  // ETIQUETAS Y COTAS
  // ===================================================================
  _makeTextSprite(lines, { color = '#0f172a', fontPx = 32, weight = 600, align = 'left' } = {}) {
    const arr = Array.isArray(lines) ? lines : [lines];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = `${weight} ${fontPx}px Inter, Arial, sans-serif`;
    ctx.font = font;
    const padding = 10;
    const lineHeight = fontPx * 1.3;
    const maxWidth = Math.max(1, ...arr.map((l) => ctx.measureText(l).width));
    canvas.width = Math.ceil(maxWidth) + padding * 2;
    canvas.height = Math.ceil(lineHeight * arr.length) + padding * 2;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.textAlign = align;
    const xPos = align === 'left' ? padding : align === 'right' ? canvas.width - padding : canvas.width / 2;
    arr.forEach((l, i) => ctx.fillText(l, xPos, padding + i * lineHeight));

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 999;
    const worldPerPx = (this._labelSize || 0.14) / lineHeight;
    sprite.scale.set(canvas.width * worldPerPx, canvas.height * worldPerPx, 1);
    if (align === 'left') sprite.center.set(0, 0.5);
    if (align === 'right') sprite.center.set(1, 0.5);
    return sprite;
  }

  _addDimension(p1, p2, text, extDir, extLen) {
    const group = this.annotationGroup;
    const lineMat = new THREE.LineBasicMaterial({ color: 0x1e293b });
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
    const dotGeo = new THREE.SphereGeometry((this._labelSize || 0.14) * 0.09, 8, 8);
    const e1 = p1.clone().addScaledVector(extDir, extLen);
    const e2 = p2.clone().addScaledVector(extDir, extLen);
    const mkLine = (a, b) => group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMat));
    mkLine(p1, e1); mkLine(p2, e2); mkLine(e1, e2);
    [e1, e2].forEach((p) => { const dot = new THREE.Mesh(dotGeo, dotMat); dot.position.copy(p); group.add(dot); });
    const mid = e1.clone().add(e2).multiplyScalar(0.5);
    const sprite = this._makeTextSprite(text, { fontPx: 34, weight: 700, align: 'center' });
    sprite.position.copy(mid);
    group.add(sprite);
  }

  _addLeaderLabel(anchor, labelPos, textLines) {
    const group = this.annotationGroup;
    const lineMat = new THREE.LineBasicMaterial({ color: 0x475569 });
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([anchor, labelPos]), lineMat));
    const dot = new THREE.Mesh(new THREE.SphereGeometry((this._labelSize || 0.14) * 0.09, 8, 8), new THREE.MeshBasicMaterial({ color: 0x475569 }));
    dot.position.copy(anchor);
    group.add(dot);
    const sprite = this._makeTextSprite(textLines, { fontPx: 28, align: 'left' });
    sprite.position.copy(labelPos);
    group.add(sprite);
  }

  _buildAnnotationsIsolated(fd, str, stemH) {
    const { isolated } = fd;
    const { L, B, h } = isolated;
    const maxDim = Math.max(L, B);
    const vertH = h + stemH;
    this._labelSize = maxDim * 0.022;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const zFront = B / 2;

    this._addDimension(V(-L / 2, 0, zFront), V(-L / 2, h, zFront), h.toFixed(2), V(-1, 0, 0), 0.10 * maxDim);
    this._addDimension(V(-L / 2, 0, zFront), V(L / 2, 0, zFront), L.toFixed(2), V(0, 0, 1), 0.12 * maxDim);
    this._addDimension(V(L / 2, 0, -B / 2), V(L / 2, 0, B / 2), B.toFixed(2), V(1, 0, 0), 0.12 * maxDim);

    // Etiquetas cortas, ancladas cerca de su propia franja de acero y
    // apiladas justo encima del muñón de columna (no muy por encima del
    // modelo, para que la línea directriz no cruce toda la escena).
    const labels = [
      [V(0, h - 0.03, B * 0.35), [`Dir. larga: ${str.dbMain.name} @ ${str.isLLong ? str.L_dir.spacing : str.B_dir.spacing} cm`]],
      [V(L * 0.25, h - 0.03, 0), [`Banda central: ${str.dbMain.name} @ ${str.banding.sp_band} cm`]],
    ];
    const labelX = L / 2 + 0.12 * maxDim;
    const top = vertH + 0.35 * vertH;
    labels.forEach(([anchor, text], i) => {
      this._addLeaderLabel(anchor, V(labelX, top - i * 0.3 * vertH, B * 0.3), text);
    });
  }

  _buildAnnotationsCombined(fd, str, stemH) {
    const { combined } = fd;
    const { L, B, h } = combined;
    const cover = fd.materials.cover_footing;
    const maxDim = Math.max(L, B);
    const vertH = h + stemH;
    this._labelSize = maxDim * 0.018;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const zFront = B / 2;

    this._addDimension(V(0, 0, zFront), V(0, h, zFront), h.toFixed(2), V(-1, 0, 0), 0.06 * maxDim);
    this._addDimension(V(0, 0, zFront), V(L, 0, zFront), L.toFixed(2), V(0, 0, 1), 0.10 * maxDim);
    this._addDimension(V(L + 0.02 * maxDim, 0, -B / 2), V(L + 0.02 * maxDim, 0, B / 2), B.toFixed(2), V(1, 0, 0), 0.08 * maxDim);

    // Etiquetas ancladas cerca de su propia capa de acero, apiladas justo
    // encima de los muñones de columna (escala vertical según la altura
    // real del modelo, no según el largo L — de lo contrario la línea
    // directriz termina muy por encima y cruza toda la escena en diagonal).
    const labels = [
      [V(L * 0.5, cover, B * 0.35), [`Inferior: ${str.dbMain.name} @ ${str.bottom.spacing} cm`]],
      [V(L * 0.5, h - 0.03, -B * 0.35), [`Superior: ${str.dbMain.name} @ ${str.top.spacing} cm`]],
    ];
    const labelX = L * 0.5 + 0.10 * maxDim;
    const top = vertH + 0.35 * vertH;
    labels.forEach(([anchor, text], i) => {
      this._addLeaderLabel(anchor, V(labelX, top - i * 0.3 * vertH, B * 0.5), text);
    });
  }

  _fitCamera(L, B, height) {
    const maxDim = Math.max(L, B);
    const leftExtent = 0.35 * maxDim;
    const rightExtent = L + 0.4 * maxDim + 0.8;
    const target = new THREE.Vector3((rightExtent - leftExtent) / 2, height / 2.2, 0);
    this.controls.target.copy(target);
    const span = Math.max(rightExtent - leftExtent, B * 1.6, height * 2);
    const distance = span * 1.4;
    const azimuth = THREE.MathUtils.degToRad(35);
    const elevation = THREE.MathUtils.degToRad(28);
    this.camera.position.set(
      target.x + distance * Math.cos(elevation) * Math.sin(azimuth),
      target.y + distance * Math.sin(elevation),
      target.z + distance * Math.cos(elevation) * Math.cos(azimuth)
    );
    this.camera.near = Math.max(0.01, distance / 200);
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
}
