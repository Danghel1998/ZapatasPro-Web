/**
 * Motor gráfico interactivo HTML5 Canvas 2D para zapatas aisladas y
 * combinadas: planta, corte/elevación, presiones de contacto, armadura y
 * (para combinadas) diagramas de fuerza cortante y momento flector.
 */

import { hookMainBar_m } from '../engine/concreteDesign.js';

export class FootingCanvasRenderer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    this.viewMode = 'plan'; // 'plan' | 'section' | 'pressures' | 'rebar' | 'diagram'
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;

    this.footingData = null;
    this.bearingResults = null;
    this.structResults = null;

    this.setupEvents();
  }

  setupEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStartX = e.clientX - this.panX;
      this.dragStartY = e.clientY - this.panY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.panX = e.clientX - this.dragStartX;
      this.panY = e.clientY - this.dragStartY;
      this.render();
    });
    window.addEventListener('mouseup', () => { this.isDragging = false; });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      this.zoom = Math.max(0.3, Math.min(4.0, this.zoom * zoomFactor));
      this.render();
    });
    window.addEventListener('resize', () => { this.resizeCanvas(); this.render(); });
  }

  setViewMode(mode) { this.viewMode = mode; this.render(); }

  resetView() { this.zoom = 1.0; this.panX = 0; this.panY = 0; this.render(); }

  /** Renderiza temporalmente en otro modo de vista para capturar una
   * imagen PNG (usada en la hoja de "Plano"), sin alterar la vista
   * interactiva activa. Se fuerza la paleta CLARA sin importar el tema de
   * pantalla — la hoja de plano se imprime siempre en blanco. */
  captureSnapshot(mode) {
    const prevMode = this.viewMode;
    this.viewMode = mode;
    this._forceLight = true;
    this.render();
    let dataUrl = '';
    try { dataUrl = this.canvas.toDataURL('image/png'); } catch (e) { /* canvas no disponible aún */ }
    this._forceLight = false;
    this.viewMode = prevMode;
    this.render();
    return dataUrl;
  }

  /** Paleta de colores del canvas 2D, según el tema activo (o siempre
   * clara si _forceLight está activo, usado al exportar la hoja de
   * Plano). Los colores semánticos del acero (azul/rojo/naranja/verde) se
   * mantienen iguales en ambos temas. */
  _palette() {
    const dark = !this._forceLight && document.documentElement.classList.contains('dark');
    return dark ? {
      grid: '#1e293b',
      concreteFill: '#334155',
      concreteStroke: '#94a3b8',
      columnFill: '#475569',
      columnStroke: '#cbd5e1',
      soilFill: '#2b2213',
      dimStroke: '#94a3b8',
      text: '#cbd5e1',
      groundLine: '#eab308',
      strapFill: 'rgba(148,163,184,0.35)',
      strapStroke: '#94a3b8',
      limitLine: '#f87171',
      axisLine: '#cbd5e1',
    } : {
      grid: '#eef2f7',
      concreteFill: '#e7ebf1',
      concreteStroke: '#334155',
      columnFill: '#94a3b8',
      columnStroke: '#1e293b',
      soilFill: '#f2e9d8',
      dimStroke: '#64748b',
      text: '#334155',
      groundLine: '#8a6d1f',
      strapFill: 'rgba(100,116,139,0.35)',
      strapStroke: '#475569',
      limitLine: '#dc2626',
      axisLine: '#334155',
    };
  }

  resizeCanvas() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.resetTransform();
    this.ctx.scale(dpr, dpr);
  }

  updateData(footingData, bearingResults, structResults) {
    this.footingData = footingData;
    this.bearingResults = bearingResults;
    this.structResults = structResults;
    this.render();
  }

  render() {
    if (!this.footingData) return;
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    this.drawGrid(width, height);

    const type = this.footingData.footing_type;
    if (this.viewMode === 'diagram' && type !== 'aislada') {
      this.renderDiagram(width, height);
      return;
    }
    if (type === 'aislada') this.renderIsolated(width, height);
    else if (type === 'combinada') this.renderCombined(width, height);
    else this.renderConnected(width, height);
  }

  drawGrid(width, height) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this._palette().grid;
    ctx.lineWidth = 1;
    const step = 24;
    for (let x = 0; x < width; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y < height; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    ctx.restore();
  }

  _worldTransform(width, height, focus) {
    const margin = 70;
    const totalW = focus.xMax - focus.xMin;
    const totalH = focus.yMax - focus.yMin;
    const cx = (focus.xMin + focus.xMax) / 2;
    const cy = (focus.yMin + focus.yMax) / 2;
    const scaleX = (width - margin * 2) / totalW;
    const scaleY = (height - margin * 2) / totalH;
    const baseScale = Math.min(scaleX, scaleY) * this.zoom;
    const originX = width / 2 - cx * baseScale + this.panX;
    const originY = height / 2 + cy * baseScale + this.panY;
    return {
      toX: (x) => originX + x * baseScale,
      toY: (y) => originY - y * baseScale,
      scale: baseScale,
    };
  }

  _dimLine(ctx, x1, y1, x2, y2, label, offset = 18, vertical = false) {
    const p = this._palette();
    ctx.save();
    ctx.strokeStyle = p.dimStroke;
    ctx.fillStyle = p.text;
    ctx.lineWidth = 1;
    ctx.font = '11px Inter, sans-serif';
    if (!vertical) {
      const y = Math.max(y1, y2) + offset;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1, y); ctx.moveTo(x2, y2); ctx.lineTo(x2, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(label, (x1 + x2) / 2, y + 14);
    } else {
      const x = Math.min(x1, x2) - offset;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x, y1); ctx.moveTo(x2, y2); ctx.lineTo(x, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
      ctx.save();
      ctx.translate(x - 14, (y1 + y2) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  // ===================================================================
  // ZAPATA AISLADA
  // ===================================================================
  renderIsolated(width, height) {
    const { isolated } = this.footingData;
    const { L, B, h, col_L, col_B } = isolated;
    const ex = isolated.ex_col || 0, ey = isolated.ey_col || 0;
    const ctx = this.ctx;

    if (this.viewMode === 'plan' || this.viewMode === 'rebar') {
      const p = this._palette();
      const t = this._worldTransform(width, height, { xMin: -L * 0.7, xMax: L * 0.7, yMin: -B * 0.7, yMax: B * 0.7 });
      // Zapata
      ctx.save();
      ctx.fillStyle = p.concreteFill;
      ctx.strokeStyle = p.concreteStroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(t.toX(-L / 2), t.toY(B / 2), L * t.scale, B * t.scale);
      ctx.fill(); ctx.stroke();
      ctx.restore();

      if (this.viewMode === 'plan') {
        // Columna
        ctx.save();
        ctx.fillStyle = p.columnFill;
        ctx.strokeStyle = p.columnStroke;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(t.toX(ex - col_L / 2), t.toY(ey + col_B / 2), col_L * t.scale, col_B * t.scale);
        ctx.fill(); ctx.stroke();
        ctx.restore();

        this._dimLine(ctx, t.toX(-L / 2), t.toY(-B / 2), t.toX(L / 2), t.toY(-B / 2), `L = ${L.toFixed(2)} m`);
        this._dimLine(ctx, t.toX(L / 2), t.toY(-B / 2), t.toX(L / 2), t.toY(B / 2), `B = ${B.toFixed(2)} m`, 18, true);
      } else {
        this.drawIsolatedRebarPlan(ctx, t);
      }
    } else if (this.viewMode === 'section') {
      this.drawIsolatedSection(width, height);
    } else if (this.viewMode === 'pressures') {
      this.drawIsolatedPressures(width, height);
    }
  }

  drawIsolatedRebarPlan(ctx, t) {
    const str = this.structResults;
    const { isolated } = this.footingData;
    const { L, B, col_L, col_B } = isolated;
    if (!str) return;
    ctx.save();
    this._drawSlabRebarGrid(ctx, t, str, 0, L, B, isolated.ex_col || 0, isolated.ey_col || 0, col_L, col_B);
    ctx.restore();

    const longSpacing = str.isLLong ? str.L_dir.spacing : str.B_dir.spacing;
    ctx.save();
    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = this._palette().text;
    ctx.fillText(`Azul: ${str.isLLong ? 'paralelo a L' : 'paralelo a B'} (dirección larga, uniforme) @ ${longSpacing} cm`, 10, 18);
    ctx.fillText(`Rojo: banda central (dirección corta) @ ${str.banding.sp_band} cm`, 10, 34);
    if (str.banding.sp_outer) ctx.fillText(`Naranja: franjas exteriores (dirección corta) @ ${str.banding.sp_outer} cm`, 10, 50);
    ctx.restore();
  }

  /** Dibuja la malla de acero de UNA losa de zapata (dirección larga
   * uniforme, en azul; dirección corta en banda central roja + franjas
   * exteriores naranjas) — compartido por la zapata aislada y por cada una
   * de las dos zapatas de una zapata conectada. `cx` es el centro de esa
   * losa en coordenadas de mundo (0 para la aislada, que ya está centrada
   * en el origen); `colCx`/`colCy` son la posición de la columna relativa
   * a ese centro. */
  _drawSlabRebarGrid(ctx, t, slab, cx, L, B, colCx, colCy, colL, colB) {
    const drawParallelBars = (alongAxis, spacingCm, runHalf, spreadHalf, color, center = 0, edgeLimit = Infinity) => {
      if (!spacingCm) return;
      const spacing_m = spacingCm / 100;
      const lo = Math.max(-edgeLimit, -spreadHalf + center);
      const hi = Math.min(edgeLimit, spreadHalf + center);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      for (let p = lo + spacing_m / 2; p <= hi - spacing_m / 2 + 1e-6; p += spacing_m) {
        ctx.beginPath();
        if (alongAxis === 'L') {
          ctx.moveTo(t.toX(cx - runHalf), t.toY(p));
          ctx.lineTo(t.toX(cx + runHalf), t.toY(p));
        } else {
          ctx.moveTo(t.toX(cx + p), t.toY(-runHalf));
          ctx.lineTo(t.toX(cx + p), t.toY(runHalf));
        }
        ctx.stroke();
      }
    };

    const longIsL = slab.isLLong;
    const longSpacing = longIsL ? slab.L_dir.spacing : slab.B_dir.spacing;
    drawParallelBars(longIsL ? 'L' : 'B', longSpacing, longIsL ? L / 2 : B / 2, longIsL ? B / 2 : L / 2, '#2563eb');
    const shortAxis = longIsL ? 'B' : 'L';
    const shortRunHalf = longIsL ? B / 2 : L / 2;
    // La franja central de ACI 318 15.4.4 va centrada en la COLUMNA, no en
    // el centro geométrico de la zapata — importa cuando la columna es
    // excéntrica (borde/esquina). Se recorta al borde real de la losa.
    const bandCenter = longIsL ? colCx : colCy;
    const edgeLimit = (longIsL ? L : B) / 2;
    const bandHalf = slab.banding.bandWidth / 2;
    drawParallelBars(shortAxis, slab.banding.sp_band, shortRunHalf, bandHalf, '#dc2626', bandCenter, edgeLimit);
    if (slab.banding.sp_outer) {
      const outerWidth = slab.banding.outerWidthEach;
      const spacing_m = slab.banding.sp_outer / 100;
      ctx.strokeStyle = '#f97316';
      for (let d = spacing_m / 2; d <= outerWidth - spacing_m / 2 + 1e-6; d += spacing_m) {
        [bandCenter + bandHalf + d, bandCenter - bandHalf - d].forEach((p) => {
          if (p < -edgeLimit || p > edgeLimit) return;
          ctx.beginPath();
          if (shortAxis === 'L') { ctx.moveTo(t.toX(cx - shortRunHalf), t.toY(p)); ctx.lineTo(t.toX(cx + shortRunHalf), t.toY(p)); }
          else { ctx.moveTo(t.toX(cx + p), t.toY(-shortRunHalf)); ctx.lineTo(t.toX(cx + p), t.toY(shortRunHalf)); }
          ctx.stroke();
        });
      }
    }
    ctx.strokeStyle = this._palette().columnStroke;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(t.toX(cx + colCx - colL / 2), t.toY(colCy + colB / 2), colL * t.scale, colB * t.scale);
    ctx.setLineDash([]);
  }

  drawIsolatedSection(width, height) {
    const ctx = this.ctx;
    const { isolated, materials } = this.footingData;
    const { L, h, col_L, Df } = isolated;
    const ex = isolated.ex_col || 0;
    const stemH = 0.8; // muñón de columna dibujado, referencial
    const t = this._worldTransform(width, height, { xMin: -L * 0.75, xMax: L * 0.75, yMin: -0.6, yMax: h + stemH + 0.8 });

    const p = this._palette();
    // Suelo
    ctx.save();
    ctx.fillStyle = p.soilFill;
    ctx.fillRect(0, t.toY(0), width, height - t.toY(0));
    ctx.restore();

    // Zapata
    ctx.save();
    ctx.fillStyle = p.concreteFill;
    ctx.strokeStyle = p.concreteStroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(t.toX(-L / 2), t.toY(h), L * t.scale, h * t.scale);
    ctx.fill(); ctx.stroke();

    // Columna (respeta la excentricidad de "Tipo de columna": interior=centrada, borde/esquina=al ras del borde)
    ctx.fillStyle = p.columnFill;
    ctx.beginPath();
    ctx.rect(t.toX(ex - col_L / 2), t.toY(h + stemH), col_L * t.scale, stemH * t.scale);
    ctx.fill(); ctx.stroke();
    ctx.restore();

    const str = this.structResults;
    if (str) this._drawSectionRebarIsolated(ctx, t, str, materials.cover_footing, L, h, col_L, stemH, ex);

    // Nivel de terreno / Df
    ctx.save();
    ctx.strokeStyle = p.groundLine;
    ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(t.toX(-L * 0.75), t.toY(Df)); ctx.lineTo(t.toX(L * 0.75), t.toY(Df)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = p.groundLine;
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText(`Nivel de terreno (Df = ${Df.toFixed(2)} m)`, t.toX(-L * 0.72), t.toY(Df) - 6);
    ctx.restore();

    // La cota de "h" se dibuja del lado OPUESTO a la columna cuando esta es
    // excéntrica (borde/esquina), para no cruzarse con el detalle de
    // ganchos/esperas que quedan apretados junto al borde de ese lado.
    const dimSideX = ex > 1e-6 ? -L / 2 : L / 2;
    this._dimLine(ctx, t.toX(-L / 2), t.toY(0), t.toX(L / 2), t.toY(0), `L = ${L.toFixed(2)} m`, 26);
    this._dimLine(ctx, t.toX(dimSideX), t.toY(h), t.toX(dimSideX), t.toY(0), `h = ${h.toFixed(2)} m`, 18, true);
  }

  /**
   * Armadura en la vista de Sección (corte longitudinal a lo largo de L):
   * la dirección que corre A LO LARGO de L se ve "de perfil" (una línea con
   * ganchos de 90° en los extremos, apoyada en su capa correspondiente);
   * la dirección perpendicular (a lo largo de B) se ve "de frente", como
   * una fila de círculos espaciados a lo largo de L en la OTRA capa. La
   * capa (inferior/superior) de cada una se toma de isLLong, igual criterio
   * que footingSlabDesign.js (la dirección larga va en la capa inferior).
   */
  _drawSectionRebarIsolated(ctx, t, str, cover, L, h, col_L, stemH, ex = 0) {
    const dbMain = str.dbMain;
    const rMain = dbMain.diameter_m / 2;
    const hook = hookMainBar_m(dbMain.diameter_m);
    const longIsL = str.isLLong;

    const yBottom = cover + rMain;
    const yTop = yBottom + 2 * rMain;
    const lineDepth = longIsL ? yBottom : yTop;
    const dotDepth = longIsL ? yTop : yBottom;

    // --- Esperas / arranque de columna: 2 barras visibles en este corte,
    // desde la parrilla de la zapata hasta cerca de la corona del muñón,
    // con gancho de 90° hacia el interior en la base ---
    if (col_L && stemH) {
      // La espera se apoya en la capa SUPERIOR (la más alejada del fondo)
      // para que su gancho quede a una profundidad distinta de la línea
      // principal y no quede tapado por ella al dibujarse encima.
      const dowelDepth = Math.max(lineDepth, dotDepth);
      const yDowelBot = t.toY(dowelDepth);
      const yDowelTop = t.toY(h + stemH - cover);
      ctx.save();
      ctx.strokeStyle = '#16a34a';
      ctx.lineWidth = 1.8;
      [1, -1].forEach((sign) => {
        const dx = ex + sign * (col_L / 2 - cover);
        const xPix = t.toX(dx);
        ctx.beginPath(); ctx.moveTo(xPix, yDowelBot); ctx.lineTo(xPix, yDowelTop); ctx.stroke();
        const hookPxDowel = hook * t.scale * 0.5;
        ctx.beginPath(); ctx.moveTo(xPix, yDowelBot); ctx.lineTo(xPix - sign * hookPxDowel, yDowelBot); ctx.stroke();
      });
      ctx.restore();
    }

    // --- Barra(s) a lo largo de L: línea con ganchos de 90° hacia arriba ---
    const runHalf = L / 2 - cover - rMain;
    const x0 = t.toX(-runHalf), x1 = t.toX(runHalf);
    const yLine = t.toY(lineDepth);
    const hookPx = hook * t.scale;
    ctx.save();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, yLine); ctx.lineTo(x1, yLine); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0, yLine); ctx.lineTo(x0, yLine - hookPx); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, yLine); ctx.lineTo(x1, yLine - hookPx); ctx.stroke();
    ctx.restore();

    // --- Barras a lo largo de B: círculos espaciados a lo largo de L ---
    const dotPositions = [];
    let lineSpacingLabel, dotSpacingLabel;
    if (longIsL) {
      lineSpacingLabel = `${str.L_dir.spacing} cm`;
      // La franja central de ACI 318 15.4.4 va centrada en la COLUMNA (ex),
      // no en el centro geométrico de la zapata — y se recorta al margen
      // físico disponible (recubrimiento) para que ningún punto quede
      // dibujado más cerca del borde que el recubrimiento real (mismo
      // margen que usa la línea azul).
      const edgeLimit = L / 2 - cover - rMain;
      const bandHalf = str.banding.bandWidth / 2;
      const bandLo = Math.max(-edgeLimit, ex - bandHalf);
      const bandHi = Math.min(edgeLimit, ex + bandHalf);
      const spBand = (str.banding.sp_band || 20) / 100;
      for (let p = bandLo + spBand / 2; p <= bandHi - spBand / 2 + 1e-6; p += spBand) dotPositions.push(p);
      if (str.banding.sp_outer) {
        const spOuter = str.banding.sp_outer / 100;
        const outerWidth = str.banding.outerWidthEach;
        for (let d = spOuter / 2; d <= outerWidth - spOuter / 2 + 1e-6; d += spOuter) {
          [bandHi + d, bandLo - d].forEach((p) => { if (p >= -edgeLimit && p <= edgeLimit) dotPositions.push(p); });
        }
      }
      dotSpacingLabel = `${str.banding.sp_band} cm (banda central) / ${str.banding.sp_outer ?? '—'} cm (exterior)`;
    } else {
      dotSpacingLabel = `${str.B_dir.spacing} cm`;
      const sp = (str.B_dir.spacing || 20) / 100;
      const half = L / 2 - cover - rMain;
      for (let p = -half + sp / 2; p <= half - sp / 2 + 1e-6; p += sp) dotPositions.push(p);
      lineSpacingLabel = `${str.banding.sp_band} cm (banda central) / ${str.banding.sp_outer ?? '—'} cm (exterior)`;
    }
    const yDot = t.toY(dotDepth);
    ctx.save();
    ctx.fillStyle = '#dc2626';
    ctx.strokeStyle = '#7f1d1d';
    dotPositions.forEach((p) => {
      ctx.beginPath();
      ctx.arc(t.toX(p), yDot, Math.max(2.5, rMain * t.scale), 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    });
    ctx.restore();

    ctx.save();
    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = '#2563eb';
    ctx.fillText(`Línea azul: Ø ${dbMain.inches} a lo largo de L @ ${lineSpacingLabel} (gancho 90° = ${(hook * 100).toFixed(0)} cm)`, 10, 18);
    ctx.fillStyle = '#dc2626';
    ctx.fillText(`Círculos rojos: Ø ${dbMain.inches} a lo largo de B @ ${dotSpacingLabel}`, 10, 34);
    ctx.restore();
  }

  drawIsolatedPressures(width, height) {
    const ctx = this.ctx;
    const { isolated } = this.footingData;
    const { L } = isolated;
    const geo = this.bearingResults;
    const t = this._worldTransform(width, height, { xMin: -L * 0.75, xMax: L * 0.75, yMin: -1.4, yMax: 1.0 });

    ctx.save();
    ctx.strokeStyle = this._palette().axisLine;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(t.toX(-L / 2), t.toY(0)); ctx.lineTo(t.toX(L / 2), t.toY(0)); ctx.stroke();
    ctx.restore();

    if (!geo) return;
    const qMax = geo.q_max_kgcm2, qMin = geo.q_min_kgcm2;
    const maxScale = Math.max(qMax, 0.01);
    const pxHeight = 1.1; // altura máxima del diagrama en "metros" de mundo

    ctx.save();
    ctx.fillStyle = 'rgba(239,68,68,0.35)';
    ctx.strokeStyle = '#dc2626';
    ctx.beginPath();
    ctx.moveTo(t.toX(-L / 2), t.toY(0));
    ctx.lineTo(t.toX(-L / 2), t.toY(-(qMax / maxScale) * pxHeight));
    ctx.lineTo(t.toX(L / 2), t.toY(-(qMin / maxScale) * pxHeight));
    ctx.lineTo(t.toX(L / 2), t.toY(0));
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = this._palette().text;
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`q_max = ${qMax.toFixed(2)} kg/cm²`, t.toX(-L / 2) + 4, t.toY(-(qMax / maxScale) * pxHeight) - 6);
    ctx.textAlign = 'right';
    ctx.fillText(`q_min = ${qMin.toFixed(2)} kg/cm²`, t.toX(L / 2) - 4, t.toY(-(qMin / maxScale) * pxHeight) - 6);
    ctx.textAlign = 'center';
    ctx.fillStyle = geo.pass_bearing ? '#059669' : '#dc2626';
    ctx.fillText(`q_adm = ${geo.q_adm_kgcm2.toFixed(2)} kg/cm² — ${geo.pass_bearing ? 'CUMPLE' : 'NO CUMPLE'}`, (t.toX(-L / 2) + t.toX(L / 2)) / 2, t.toY(0) + 24);
    ctx.restore();
  }

  // ===================================================================
  // ZAPATA COMBINADA
  // ===================================================================
  renderCombined(width, height) {
    const { combined } = this.footingData;
    const { L, B, col1_L, col1_B, col2_L, col2_B, a1, s } = combined;
    const a2 = a1 + s;
    const ctx = this.ctx;

    if (this.viewMode === 'plan' || this.viewMode === 'rebar') {
      const p = this._palette();
      const t = this._worldTransform(width, height, { xMin: -L * 0.15, xMax: L * 1.15, yMin: -B * 0.8, yMax: B * 0.8 });
      ctx.save();
      ctx.fillStyle = p.concreteFill;
      ctx.strokeStyle = p.concreteStroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(t.toX(0), t.toY(B / 2), L * t.scale, B * t.scale);
      ctx.fill(); ctx.stroke();
      ctx.restore();

      if (this.viewMode === 'plan') {
        [[a1, col1_L, col1_B, '1'], [a2, col2_L, col2_B, '2']].forEach(([xc, cl, cb, label]) => {
          ctx.save();
          ctx.fillStyle = p.columnFill;
          ctx.strokeStyle = p.columnStroke;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.rect(t.toX(xc - cl / 2), t.toY(cb / 2), cl * t.scale, cb * t.scale);
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = p.columnStroke;
          ctx.font = 'bold 11px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`C${label}`, t.toX(xc), t.toY(0) + 4);
          ctx.restore();
        });
        this._dimLine(ctx, t.toX(0), t.toY(-B / 2), t.toX(L), t.toY(-B / 2), `L = ${L.toFixed(2)} m`);
        this._dimLine(ctx, t.toX(a1), t.toY(B / 2) - 24, t.toX(a2), t.toY(B / 2) - 24, `s = ${s.toFixed(2)} m`);
        this._dimLine(ctx, t.toX(L), t.toY(-B / 2), t.toX(L), t.toY(B / 2), `B = ${B.toFixed(2)} m`, 18, true);
      } else {
        this.drawCombinedRebarPlan(ctx, t);
      }
    } else if (this.viewMode === 'section') {
      this.drawCombinedElevation(width, height);
    }
  }

  drawCombinedRebarPlan(ctx, t) {
    const str = this.structResults;
    const { combined } = this.footingData;
    const { L, B, a1, s } = combined;
    const a2 = a1 + s;
    if (!str) return;
    ctx.save();
    const drawLongBars = (spacingCm, color, dash) => {
      const spacing_m = spacingCm / 100;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      if (dash) ctx.setLineDash(dash);
      for (let y = -B / 2 + spacing_m / 2; y <= B / 2; y += spacing_m) {
        ctx.beginPath(); ctx.moveTo(t.toX(0), t.toY(y)); ctx.lineTo(t.toX(L), t.toY(y)); ctx.stroke();
      }
      ctx.setLineDash([]);
    };
    drawLongBars(str.bottom.spacing, '#2563eb', null);
    drawLongBars(str.top.spacing, '#dc2626', [6, 4]);

    const drawTransBars = (xc, spacingCm, halfSpread) => {
      const spacing_m = spacingCm / 100;
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 1.3;
      for (let x = xc - halfSpread + spacing_m / 2; x <= xc + halfSpread; x += spacing_m) {
        ctx.beginPath(); ctx.moveTo(t.toX(x), t.toY(-B / 2)); ctx.lineTo(t.toX(x), t.toY(B / 2)); ctx.stroke();
      }
    };
    drawTransBars(a1, str.trans1.spacing, Math.max(0.3, s / 4));
    drawTransBars(a2, str.trans2.spacing, Math.max(0.3, s / 4));
    ctx.restore();

    ctx.save();
    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = this._palette().text;
    ctx.fillText(`Azul: acero inferior longitudinal @ ${str.bottom.spacing} cm — Rojo (punteado): superior @ ${str.top.spacing} cm`, 10, 18);
    ctx.fillText(`Naranja: transversal bajo columnas @ ${str.trans1.spacing} / ${str.trans2.spacing} cm`, 10, 34);
    ctx.restore();
  }

  drawCombinedElevation(width, height) {
    const ctx = this.ctx;
    const { combined } = this.footingData;
    const { L, h, col1_L, col2_L, a1, s, Df } = combined;
    const a2 = a1 + s;
    const stemH = 0.8;
    const t = this._worldTransform(width, height, { xMin: -L * 0.1, xMax: L * 1.1, yMin: -0.6, yMax: h + stemH + 0.8 });

    const p = this._palette();
    ctx.save();
    ctx.fillStyle = p.soilFill;
    ctx.fillRect(0, t.toY(0), width, height - t.toY(0));
    ctx.restore();

    ctx.save();
    ctx.fillStyle = p.concreteFill;
    ctx.strokeStyle = p.concreteStroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(t.toX(0), t.toY(h), L * t.scale, h * t.scale);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = p.columnFill;
    [[a1, col1_L], [a2, col2_L]].forEach(([xc, cl]) => {
      ctx.beginPath();
      ctx.rect(t.toX(xc - cl / 2), t.toY(h + stemH), cl * t.scale, stemH * t.scale);
      ctx.fill(); ctx.stroke();
    });
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = p.groundLine;
    ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(t.toX(-L * 0.1), t.toY(Df)); ctx.lineTo(t.toX(L * 1.1), t.toY(Df)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    this._dimLine(ctx, t.toX(0), t.toY(0), t.toX(L), t.toY(0), `L = ${L.toFixed(2)} m`, 26);
  }

  // ===================================================================
  // ZAPATA CONECTADA (excéntrica + interior, con viga de conexión)
  // ===================================================================
  renderConnected(width, height) {
    const { connected } = this.footingData;
    const { L1, B1, L2, B2, col1_L, col1_B, col2_L, col2_B, s, strap_width } = connected;
    const c1 = col1_L / 2.0; // eje de columna 1 (límite de propiedad en x=0)
    const c2 = c1 + s;
    const f2x0 = c2 - L2 / 2.0;
    const maxB = Math.max(B1, B2);
    const ctx = this.ctx;

    if (this.viewMode === 'plan' || this.viewMode === 'rebar') {
      const p = this._palette();
      const t = this._worldTransform(width, height, { xMin: -0.5, xMax: Math.max(L1, f2x0 + L2) + 0.5, yMin: -maxB * 0.8, yMax: maxB * 0.8 });

      ctx.save();
      ctx.fillStyle = p.concreteFill;
      ctx.strokeStyle = p.concreteStroke;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.rect(t.toX(0), t.toY(B1 / 2), L1 * t.scale, B1 * t.scale); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.rect(t.toX(f2x0), t.toY(B2 / 2), L2 * t.scale, B2 * t.scale); ctx.fill(); ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = p.limitLine;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(t.toX(0), t.toY(-maxB * 0.75)); ctx.lineTo(t.toX(0), t.toY(maxB * 0.75)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = p.limitLine;
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Límite de propiedad', t.toX(0) + 4, t.toY(maxB * 0.75) + 12);
      ctx.restore();

      if (this.viewMode === 'plan') {
        ctx.save();
        ctx.fillStyle = p.strapFill;
        ctx.strokeStyle = p.strapStroke;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.rect(t.toX(c1), t.toY(strap_width / 2), (c2 - c1) * t.scale, strap_width * t.scale); ctx.fill(); ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.fillStyle = p.columnFill;
        ctx.strokeStyle = p.columnStroke;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(t.toX(c1 - col1_L / 2), t.toY(col1_B / 2), col1_L * t.scale, col1_B * t.scale); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.rect(t.toX(c2 - col2_L / 2), t.toY(col2_B / 2), col2_L * t.scale, col2_B * t.scale); ctx.fill(); ctx.stroke();
        ctx.restore();

        this._dimLine(ctx, t.toX(0), t.toY(-B1 / 2), t.toX(L1), t.toY(-B1 / 2), `L1 = ${L1.toFixed(2)} m`, 16);
        this._dimLine(ctx, t.toX(c1), t.toY(maxB / 2) + 22, t.toX(c2), t.toY(maxB / 2) + 22, `s = ${s.toFixed(2)} m`);
        this._dimLine(ctx, t.toX(f2x0), t.toY(-B2 / 2), t.toX(f2x0 + L2), t.toY(-B2 / 2), `L2 = ${L2.toFixed(2)} m`, 16);
      } else {
        const str = this.structResults;
        if (str) {
          this._drawSlabRebarGrid(ctx, t, str.slab1, L1 / 2, L1, B1, c1 - L1 / 2, 0, col1_L, col1_B);
          this._drawSlabRebarGrid(ctx, t, str.slab2, c2, L2, B2, 0, 0, col2_L, col2_B);
        }
        ctx.save();
        ctx.font = '11px Inter, sans-serif';
        ctx.fillStyle = p.text;
        ctx.fillText('Azul: dirección larga (uniforme) — Rojo: banda central — Naranja: franjas exteriores', 10, 18);
        ctx.restore();
      }
    } else if (this.viewMode === 'section') {
      this.drawConnectedElevation(width, height, c1, c2, f2x0);
    }
  }

  drawConnectedElevation(width, height, c1, c2, f2x0) {
    const ctx = this.ctx;
    const { connected } = this.footingData;
    const { L1, h1, L2, h2, col1_L, col2_L, s, strap_height, Df } = connected;
    const stemH = 0.8;
    const maxH = Math.max(h1, h2);
    const t = this._worldTransform(width, height, { xMin: -0.5, xMax: f2x0 + L2 + 0.5, yMin: -0.6, yMax: maxH + stemH + 0.8 });

    const p = this._palette();
    ctx.save();
    ctx.fillStyle = p.soilFill;
    ctx.fillRect(0, t.toY(0), width, height - t.toY(0));
    ctx.restore();

    ctx.save();
    ctx.fillStyle = p.concreteFill;
    ctx.strokeStyle = p.concreteStroke;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(t.toX(0), t.toY(h1), L1 * t.scale, h1 * t.scale); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.rect(t.toX(f2x0), t.toY(h2), L2 * t.scale, h2 * t.scale); ctx.fill(); ctx.stroke();

    // Viga de conexión, entre las dos zapatas, apoyada sobre ellas
    const strapY = Math.min(h1, h2);
    ctx.fillStyle = p.columnFill;
    ctx.beginPath(); ctx.rect(t.toX(c1), t.toY(strapY + strap_height), (c2 - c1) * t.scale, strap_height * t.scale); ctx.fill(); ctx.stroke();

    ctx.fillStyle = p.columnFill;
    ctx.beginPath(); ctx.rect(t.toX(c1 - col1_L / 2), t.toY(h1 + stemH), col1_L * t.scale, stemH * t.scale); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.rect(t.toX(c2 - col2_L / 2), t.toY(h2 + stemH), col2_L * t.scale, stemH * t.scale); ctx.fill(); ctx.stroke();
    ctx.restore();

    this._drawStrapReinforcement(ctx, t, c1, c2, strapY);

    ctx.save();
    ctx.strokeStyle = p.limitLine;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(t.toX(0), t.toY(-0.4)); ctx.lineTo(t.toX(0), t.toY(maxH + stemH + 0.6)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = p.limitLine;
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('Límite', t.toX(0) + 3, t.toY(maxH + stemH + 0.5));
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = p.groundLine;
    ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(t.toX(-0.4), t.toY(Df)); ctx.lineTo(t.toX(f2x0 + L2 + 0.4), t.toY(Df)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    this._dimLine(ctx, t.toX(0), t.toY(0), t.toX(f2x0 + L2), t.toY(0), `s = ${s.toFixed(2)} m (ejes de columna)`, 26);
  }

  /** Acero longitudinal (superior/inferior) y estribos de la viga de
   * conexión, dibujados en elevación — el espaciamiento de estribos es el
   * mismo que ya calculó el motor estructural (str.strap.stirrup_spacing_cm). */
  _drawStrapReinforcement(ctx, t, c1, c2, strapY) {
    const str = this.structResults;
    if (!str) return;
    const { connected, materials } = this.footingData;
    const strap = str.strap;
    const cover = materials.cover_footing;
    const yTop = strapY + connected.strap_height - cover;
    const yBot = strapY + cover;

    ctx.save();
    ctx.strokeStyle = this._palette().columnStroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(t.toX(c1 + cover), t.toY(yTop)); ctx.lineTo(t.toX(c2 - cover), t.toY(yTop)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(t.toX(c1 + cover), t.toY(yBot)); ctx.lineTo(t.toX(c2 - cover), t.toY(yBot)); ctx.stroke();

    const sp = Math.max(0.03, strap.stirrup_spacing_cm / 100);
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 1.2;
    for (let x = c1 + sp / 2; x <= c2 - sp / 2 + 1e-6; x += sp) {
      ctx.beginPath();
      ctx.moveTo(t.toX(x), t.toY(yTop));
      ctx.lineTo(t.toX(x), t.toY(yBot));
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = this._palette().text;
    ctx.fillText(`Estribos ${strap.rebarTrans.name} @ ${strap.stirrup_spacing_cm} cm`, t.toX(c1), t.toY(yTop) - 6);
    ctx.restore();
  }

  renderDiagram(width, height) {
    const ctx = this.ctx;
    const str = this.structResults;
    if (!str) return;
    const { xs, Vs, Ms } = str.diagram;
    const L = str.L;

    const maxV = Math.max(1, ...Vs.map((v) => Math.abs(v)));
    const maxM = Math.max(1, ...Ms.map((m) => Math.abs(m)));

    const panelH = (height - 60) / 2;
    const marginL = 60, marginR = 30;
    const plotW = width - marginL - marginR;
    const scaleX = (x) => marginL + (x / L) * plotW;

    const p = this._palette();
    const drawPanel = (yTop, values, maxAbs, title, color, unit) => {
      const zeroY = yTop + panelH / 2;
      const scaleY = (panelH / 2 - 10) / maxAbs;
      ctx.save();
      ctx.strokeStyle = p.dimStroke;
      ctx.beginPath(); ctx.moveTo(marginL, zeroY); ctx.lineTo(width - marginR, zeroY); ctx.stroke();
      ctx.fillStyle = p.text;
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.fillText(title, marginL, yTop + 14);

      ctx.strokeStyle = color;
      ctx.fillStyle = color + '33';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(scaleX(xs[0]), zeroY);
      xs.forEach((x, i) => ctx.lineTo(scaleX(x), zeroY - values[i] * scaleY));
      ctx.lineTo(scaleX(xs[xs.length - 1]), zeroY);
      ctx.closePath();
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = p.text;
      ctx.font = '10px Inter, sans-serif';
      ctx.fillText(`max: ${maxAbs.toFixed(1)} ${unit}`, width - marginR - 90, yTop + 14);
      ctx.restore();
    };

    drawPanel(20, Vs, maxV, 'Fuerza Cortante V(x)', '#2563eb', 'kN');
    drawPanel(20 + panelH + 20, Ms, maxM, 'Momento Flector M(x) — positivo: tracción inferior', '#dc2626', 'kN·m');

    ctx.save();
    ctx.strokeStyle = p.text;
    ctx.beginPath(); ctx.moveTo(marginL, height - 20); ctx.lineTo(width - marginR, height - 20); ctx.stroke();
    ctx.fillStyle = p.text;
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('0', marginL, height - 6);
    ctx.fillText(`${L.toFixed(2)} m`, width - marginR, height - 6);
    ctx.restore();
  }
}
