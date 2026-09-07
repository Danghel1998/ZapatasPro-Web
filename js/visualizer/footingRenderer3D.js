/**
 * Vista 3D interactiva (Three.js) del detalle de armaduras de una zapata
 * (aislada o combinada), a partir de los mismos resultados estructurales
 * que usa el detalle 2D. Convención de ejes: X = largo de la zapata (L),
 * Z = ancho (B), Y = altura (vertical) — igual que un plano en planta con
 * la altura "saliendo" de la hoja.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { hookMainBar_m } from '../engine/concreteDesign.js';

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

const COLORS_CONNECTED = {
  slab1: 0x2563eb,       // Malla de la Zapata 1 (excéntrica) — azul
  slab2: 0xdc2626,       // Malla de la Zapata 2 (interior) — rojo
  strap_top: 0xf97316,   // Acero superior de la viga de conexión — naranja
  strap_bottom: 0xeab308, // Acero inferior de la viga de conexión — amarillo
  strap_stirrups: 0x16a34a, // Estribos de la viga de conexión — verde
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
    this._forceLight = false;
    this._applyBackground();
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

  /** true si corresponde pintar con la paleta oscura — nunca durante
   * captureSnapshot() (usada para la hoja de Plano, que se imprime siempre
   * en blanco sin importar el tema de pantalla). */
  _isDark() {
    return !this._forceLight && document.documentElement.classList.contains('dark');
  }

  _applyBackground() {
    this.scene.background = new THREE.Color(this._isDark() ? 0x0f172a : 0xffffff);
  }

  /** Vuelve a pintar la escena con el tema activo (fondo + aristas de
   * concreto + cotas), sin recalcular geometría — se llama al cambiar de
   * tema en pantalla. */
  refreshTheme() {
    this._applyBackground();
    if (this.footingData && this.structResults) this.updateData(this.footingData, null, this.structResults);
  }

  captureSnapshot(width = 900, height = 700) {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const usesFallbackSize = w < 2 || h < 2;
    if (usesFallbackSize) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    }
    // La hoja de Plano siempre se genera en blanco, sin importar el tema
    // de pantalla activo — se fuerza la paleta clara y se reconstruye la
    // escena antes de capturar, luego se restaura el tema real.
    this._forceLight = true;
    this._applyBackground();
    if (this.footingData && this.structResults) this.updateData(this.footingData, null, this.structResults);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    let dataUrl = '';
    try { dataUrl = this.renderer.domElement.toDataURL('image/png'); } catch (e) { console.warn('captureSnapshot: toDataURL falló', e); }
    this._forceLight = false;
    this._applyBackground();
    if (this.footingData && this.structResults) this.updateData(this.footingData, null, this.structResults);
    if (usesFallbackSize) this.resize();
    return dataUrl;
  }

  updateData(footingData, bearingResults, structResults) {
    this.footingData = footingData;
    this.structResults = structResults;
    if (!footingData || !structResults) return;
    const type = footingData.footing_type;
    this.colors = { aislada: COLORS_ISOLATED, combinada: COLORS_COMBINED, conectada: COLORS_CONNECTED }[type];
    this._buildSubgroups();
    this._clearGroup(this.concreteGroup);
    this._clearGroup(this.annotationGroup);
    if (type === 'aislada') this._buildIsolated(footingData, structResults);
    else if (type === 'combinada') this._buildCombined(footingData, structResults);
    else this._buildConnected(footingData, structResults);
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
    const type = this.footingData.footing_type;
    if (type === 'aislada') this._buildIsolated(this.footingData, this.structResults);
    else if (type === 'combinada') this._buildCombined(this.footingData, this.structResults);
    else this._buildConnected(this.footingData, this.structResults);
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

  /** Barra recta con gancho estándar a 90° en ambos extremos (E.060 / ACI
   * 318 25.3.1: extensión de 12·db), doblado hacia arriba (`bendUp=true`,
   * barras de la capa inferior) o hacia abajo (capa superior) — la
   * longitud del gancho depende del diámetro real de la propia barra, no
   * de un valor fijo. */
  _addBarWithHooks(p1, p2, radius, key, diameter_m, bendUp = true) {
    this._addBar(p1, p2, radius, key);
    const hookLen = hookMainBar_m(diameter_m) * 0.6; // 60%: representación esquemática, no a escala real de 12·db
    const bend = new THREE.Vector3(0, bendUp ? 1 : -1, 0).multiplyScalar(hookLen);
    this._addBar(p1, p1.clone().add(bend), radius, key);
    this._addBar(p2, p2.clone().add(bend), radius, key);
  }

  _addConcreteBox(cx, cy, cz, sx, sy, sz) {
    const dark = this._isDark();
    const geometry = new THREE.BoxGeometry(sx, sy, sz);
    const material = new THREE.MeshStandardMaterial({
      color: dark ? 0x475569 : 0xcbd5e1, transparent: true, opacity: 0.45, side: THREE.DoubleSide, roughness: 0.9, metalness: 0.0, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(cx, cy, cz);
    this.concreteGroup.add(mesh);
    const edges = new THREE.EdgesGeometry(geometry, 20);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: dark ? 0xcbd5e1 : 0x334155, transparent: true, opacity: 0.5 }));
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
      if (longAxisIsX) this._addBarWithHooks(V(-longRunHalf, yLongDir, p), V(longRunHalf, yLongDir, p), rMain, 'long_dir', dbMain.diameter_m);
      else this._addBarWithHooks(V(p, yLongDir, -longRunHalf), V(p, yLongDir, longRunHalf), rMain, 'long_dir', dbMain.diameter_m);
    });

    // Dirección corta: banda central + franjas exteriores
    const shortAxisIsX = !longAxisIsX;
    const shortRunHalf = (shortAxisIsX ? L : B) / 2 - cover;
    const bandHalf = str.banding.bandWidth / 2;
    positionsIn(str.banding.sp_band, bandHalf).forEach((p) => {
      if (shortAxisIsX) this._addBarWithHooks(V(-shortRunHalf, yShortDir, p), V(shortRunHalf, yShortDir, p), rMain, 'short_band', dbMain.diameter_m);
      else this._addBarWithHooks(V(p, yShortDir, -shortRunHalf), V(p, yShortDir, shortRunHalf), rMain, 'short_band', dbMain.diameter_m);
    });
    if (str.banding.sp_outer) {
      const outerTo = (shortAxisIsX ? B : L) / 2;
      const s = Math.max(0.03, str.banding.sp_outer / 100);
      for (let p = bandHalf + s / 2; p <= outerTo - s / 2 + 1e-6; p += s) {
        [p, -p].forEach((pp) => {
          if (shortAxisIsX) this._addBarWithHooks(V(-shortRunHalf, yShortDir, pp), V(shortRunHalf, yShortDir, pp), rMain, 'short_outer', dbMain.diameter_m);
          else this._addBarWithHooks(V(pp, yShortDir, -shortRunHalf), V(pp, yShortDir, shortRunHalf), rMain, 'short_outer', dbMain.diameter_m);
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
      this._addBarWithHooks(V(cover, yBottom, z), V(L - cover, yBottom, z), rMain, 'bottom_long', dbMain.diameter_m, true);
    });
    positionsIn(str.top.spacing, zHalf).forEach((z) => {
      this._addBarWithHooks(V(cover, yTop, z), V(L - cover, yTop, z), rMain, 'top_long', dbMain.diameter_m, false);
    });

    // Franja de reparto de cada columna: desde el borde de la zapata más
    // cercano hasta el punto medio entre los ejes de columna (igual
    // criterio que calculateCombinedRebarSchedule), acotada siempre dentro
    // de [cover, L-cover] para que ninguna barra sobresalga del sólido.
    // Se dibuja tanto en la capa inferior (junto al acero longitudinal
    // inferior) como en la superior (junto al superior) — mismo acero
    // transversal, espejado en ambas capas.
    const xMid = (a1 + a2) / 2;
    const trans1Xs = positionsBetween(str.trans1.spacing, cover, Math.min(xMid, L - cover));
    const trans2Xs = positionsBetween(str.trans2.spacing, Math.max(xMid, cover), L - cover);
    const yTransBottom = yBottom + 2 * rMain;
    const yTransTop = yTop - 2 * rMain;
    trans1Xs.forEach((x) => {
      this._addBarWithHooks(V(x, yTransBottom, -zHalf), V(x, yTransBottom, zHalf), rTrans, 'trans_col1', dbTrans.diameter_m, true);
      this._addBarWithHooks(V(x, yTransTop, -zHalf), V(x, yTransTop, zHalf), rTrans, 'trans_col1', dbTrans.diameter_m, false);
    });
    trans2Xs.forEach((x) => {
      this._addBarWithHooks(V(x, yTransBottom, -zHalf), V(x, yTransBottom, zHalf), rTrans, 'trans_col2', dbTrans.diameter_m, true);
      this._addBarWithHooks(V(x, yTransTop, -zHalf), V(x, yTransTop, zHalf), rTrans, 'trans_col2', dbTrans.diameter_m, false);
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
  // ZAPATA CONECTADA (excéntrica + interior, con viga de conexión)
  // ===================================================================
  _buildConnected(fd, str) {
    const { connected } = fd;
    const { L1, B1, h1, col1_L, col1_B, L2, B2, h2, col2_L, col2_B, s, strap_width, strap_height } = connected;
    const cover = fd.materials.cover_footing;
    const c1 = col1_L / 2.0;
    const c2 = c1 + s;
    const stemH1 = Math.max(0.5, Math.min(1.2, h1 * 1.4));
    const stemH2 = Math.max(0.5, Math.min(1.2, h2 * 1.4));

    this._addConcreteBox(L1 / 2, h1 / 2, 0, L1, h1, B1);
    this._addConcreteBox(c1, h1 + stemH1 / 2, 0, col1_L, stemH1, col1_B);
    this._addConcreteBox(c2, h2 / 2, 0, L2, h2, B2);
    this._addConcreteBox(c2, h2 + stemH2 / 2, 0, col2_L, stemH2, col2_B);

    const strapY0 = Math.min(h1, h2);
    this._addConcreteBox((c1 + c2) / 2, strapY0 + strap_height / 2, 0, c2 - c1, strap_height, strap_width);

    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const dbMain = str.dbMain;
    const rMain = dbMain.diameter_m / 2;

    const positionsIn = (spacingCm, half) => {
      const sp = Math.max(0.03, (spacingCm || 20) / 100);
      const list = [];
      for (let p = -half + sp / 2; p <= half - sp / 2 + 1e-6; p += sp) list.push(p);
      return list.length ? list : [0];
    };

    const drawSlabRebar = (slab, cx, L, B, colL, colB, colCx, topH, colorKey) => {
      const yLow = cover + rMain, yHigh = yLow + rMain + rMain;
      const longIsL = slab.isLLong;
      const yLongDir = longIsL ? yLow : yHigh;
      const yShortDir = longIsL ? yHigh : yLow;

      const longSpacing = longIsL ? slab.L_dir.spacing : slab.B_dir.spacing;
      const longAxisIsX = longIsL;
      const longRunHalf = (longAxisIsX ? L : B) / 2 - cover;
      const longSpreadHalf = (longAxisIsX ? B : L) / 2;
      positionsIn(longSpacing, longSpreadHalf).forEach((p) => {
        if (longAxisIsX) this._addBarWithHooks(V(cx - longRunHalf, yLongDir, p), V(cx + longRunHalf, yLongDir, p), rMain, colorKey, dbMain.diameter_m);
        else this._addBarWithHooks(V(cx + p, yLongDir, -longRunHalf), V(cx + p, yLongDir, longRunHalf), rMain, colorKey, dbMain.diameter_m);
      });

      const shortAxisIsX = !longAxisIsX;
      const shortRunHalf = (shortAxisIsX ? L : B) / 2 - cover;
      const bandHalf = slab.banding.bandWidth / 2;
      positionsIn(slab.banding.sp_band, bandHalf).forEach((p) => {
        if (shortAxisIsX) this._addBarWithHooks(V(cx - shortRunHalf, yShortDir, p), V(cx + shortRunHalf, yShortDir, p), rMain, colorKey, dbMain.diameter_m);
        else this._addBarWithHooks(V(cx + p, yShortDir, -shortRunHalf), V(cx + p, yShortDir, shortRunHalf), rMain, colorKey, dbMain.diameter_m);
      });
      if (slab.banding.sp_outer) {
        const outerTo = (shortAxisIsX ? B : L) / 2;
        const sp = Math.max(0.03, slab.banding.sp_outer / 100);
        for (let p = bandHalf + sp / 2; p <= outerTo - sp / 2 + 1e-6; p += sp) {
          [p, -p].forEach((pp) => {
            if (shortAxisIsX) this._addBarWithHooks(V(cx - shortRunHalf, yShortDir, pp), V(cx + shortRunHalf, yShortDir, pp), rMain, colorKey, dbMain.diameter_m);
            else this._addBarWithHooks(V(cx + pp, yShortDir, -shortRunHalf), V(cx + pp, yShortDir, shortRunHalf), rMain, colorKey, dbMain.diameter_m);
          });
        }
      }

      const yDowelBot = Math.max(yLow, yHigh) + rMain;
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => {
        const dx = cx + colCx + sx * (colL / 2 - cover);
        const dz = sz * (colB / 2 - cover);
        this._addBar(V(dx, yDowelBot, dz), V(dx, topH - cover, dz), rMain * 0.6, 'dowels');
      });
    };

    drawSlabRebar(str.slab1, L1 / 2, L1, B1, col1_L, col1_B, c1 - L1 / 2, h1 + stemH1, 'slab1');
    drawSlabRebar(str.slab2, c2, L2, B2, col2_L, col2_B, 0, h2 + stemH2, 'slab2');

    // Acero de la viga de conexión (superior e inferior), a lo largo de su luz
    const yStrapTop = strapY0 + strap_height - cover - rMain;
    const yStrapBot = strapY0 + cover + rMain;
    const zHalfStrap = strap_width / 2 - cover;
    const nTop = Math.max(2, str.strap.n_bars_top);
    const nBot = Math.max(2, str.strap.n_bars_bottom);
    for (let i = 0; i < nTop; i++) {
      const z = nTop > 1 ? -zHalfStrap + (i * 2 * zHalfStrap) / (nTop - 1) : 0;
      this._addBar(V(c1, yStrapTop, z), V(c2, yStrapTop, z), rMain, 'strap_top');
    }
    for (let i = 0; i < nBot; i++) {
      const z = nBot > 1 ? -zHalfStrap + (i * 2 * zHalfStrap) / (nBot - 1) : 0;
      this._addBar(V(c1, yStrapBot, z), V(c2, yStrapBot, z), rMain, 'strap_bottom');
    }

    // Estribos de la viga de conexión, como lazos rectangulares (4 tramos)
    // en el plano Y-Z, espaciados a lo largo de su luz según el
    // espaciamiento ya calculado por el motor estructural.
    const rStirrup = str.strap.rebarTrans.diameter_m / 2;
    const yStirrupTop = strapY0 + strap_height - cover;
    const yStirrupBot = strapY0 + cover;
    const zStirrupHalf = strap_width / 2 - cover;
    const spStirrup = Math.max(0.03, str.strap.stirrup_spacing_cm / 100);
    for (let x = c1 + spStirrup / 2; x <= c2 - spStirrup / 2 + 1e-6; x += spStirrup) {
      this._addBar(V(x, yStirrupTop, -zStirrupHalf), V(x, yStirrupTop, zStirrupHalf), rStirrup, 'strap_stirrups');
      this._addBar(V(x, yStirrupBot, -zStirrupHalf), V(x, yStirrupBot, zStirrupHalf), rStirrup, 'strap_stirrups');
      this._addBar(V(x, yStirrupBot, -zStirrupHalf), V(x, yStirrupTop, -zStirrupHalf), rStirrup, 'strap_stirrups');
      this._addBar(V(x, yStirrupBot, zStirrupHalf), V(x, yStirrupTop, zStirrupHalf), rStirrup, 'strap_stirrups');
    }

    this._buildAnnotationsConnected(fd, str, c1, c2, Math.max(stemH1, stemH2));
    this._fitCamera(c2 + L2 / 2, Math.max(B1, B2), Math.max(h1 + stemH1, h2 + stemH2));
  }

  // ===================================================================
  // ETIQUETAS Y COTAS
  // ===================================================================
  _makeTextSprite(lines, { color, fontPx = 32, weight = 600, align = 'left' } = {}) {
    const resolvedColor = color || (this._isDark() ? '#e2e8f0' : '#0f172a');
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
    ctx.fillStyle = resolvedColor;
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
    const dimColor = this._isDark() ? 0xcbd5e1 : 0x1e293b;
    const lineMat = new THREE.LineBasicMaterial({ color: dimColor });
    const dotMat = new THREE.MeshBasicMaterial({ color: dimColor });
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
    const leaderColor = this._isDark() ? 0x94a3b8 : 0x475569;
    const lineMat = new THREE.LineBasicMaterial({ color: leaderColor });
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([anchor, labelPos]), lineMat));
    const dot = new THREE.Mesh(new THREE.SphereGeometry((this._labelSize || 0.14) * 0.09, 8, 8), new THREE.MeshBasicMaterial({ color: leaderColor }));
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

  _buildAnnotationsConnected(fd, str, c1, c2, stemH) {
    const { connected } = fd;
    const { L1, B1, L2, B2, h1, h2 } = connected;
    const cover = fd.materials.cover_footing;
    const totalSpan = c2 + L2 / 2;
    const maxDim = Math.max(totalSpan, B1, B2);
    const vertH = Math.max(h1, h2) + stemH;
    this._labelSize = maxDim * 0.018;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);

    this._addDimension(V(0, 0, Math.max(B1, B2) / 2), V(0, h1, Math.max(B1, B2) / 2), h1.toFixed(2), V(-1, 0, 0), 0.06 * maxDim);
    this._addDimension(V(0, 0, Math.max(B1, B2) * 0.7), V(totalSpan, 0, Math.max(B1, B2) * 0.7), `s = ${connected.s.toFixed(2)} m`, V(0, 0, 1), 0.06 * maxDim);

    // Marca del límite de propiedad (x=0)
    const propLineTop = vertH + 0.15 * vertH;
    const group = this.annotationGroup;
    const lineMat = new THREE.LineDashedMaterial({ color: 0xdc2626, dashSize: 0.08 * maxDim, gapSize: 0.05 * maxDim });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(0, 0, -Math.max(B1, B2) * 0.6), V(0, propLineTop, -Math.max(B1, B2) * 0.6)]), lineMat);
    line.computeLineDistances();
    group.add(line);
    const sprite = this._makeTextSprite('Límite de propiedad', { color: '#dc2626', fontPx: 30, weight: 700, align: 'left' });
    sprite.position.copy(V(0.05 * maxDim, propLineTop, -Math.max(B1, B2) * 0.6));
    group.add(sprite);

    const labels = [
      [V(L1 / 2, cover, 0), ['Zapata 1 (excéntrica)']],
      [V(c2, cover, 0), ['Zapata 2 (interior)']],
      [V((c1 + c2) / 2, Math.min(h1, h2) + connected.strap_height / 2, connected.strap_width / 2), ['Viga de conexión']],
    ];
    labels.forEach(([anchor, text], i) => {
      this._addLeaderLabel(anchor, V(totalSpan + 0.12 * maxDim, vertH * 0.8 - i * 0.28 * vertH, 0), text);
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
