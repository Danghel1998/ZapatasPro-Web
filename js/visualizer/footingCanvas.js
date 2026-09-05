/**
 * Motor gráfico interactivo HTML5 Canvas 2D para zapatas aisladas y
 * combinadas: planta, corte/elevación, presiones de contacto, armadura y
 * (para combinadas) diagramas de fuerza cortante y momento flector.
 */

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

    const isIsolated = this.footingData.footing_type === 'aislada';
    if (this.viewMode === 'diagram' && !isIsolated) {
      this.renderDiagram(width, height);
      return;
    }
    if (isIsolated) this.renderIsolated(width, height);
    else this.renderCombined(width, height);
  }

  drawGrid(width, height) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#eef2f7';
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
    ctx.save();
    ctx.strokeStyle = '#64748b';
    ctx.fillStyle = '#334155';
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
      const t = this._worldTransform(width, height, { xMin: -L * 0.7, xMax: L * 0.7, yMin: -B * 0.7, yMax: B * 0.7 });
      // Zapata
      ctx.save();
      ctx.fillStyle = '#e7ebf1';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(t.toX(-L / 2), t.toY(B / 2), L * t.scale, B * t.scale);
      ctx.fill(); ctx.stroke();
      ctx.restore();

      if (this.viewMode === 'plan') {
        // Columna
        ctx.save();
        ctx.fillStyle = '#94a3b8';
        ctx.strokeStyle = '#1e293b';
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
    // Barras dirección L (paralelas al eje X), espaciadas a lo largo de B
    const spB = str.isLLong ? (str.banding.bandWidth ? null : null) : null; // ver abajo por tramo
    const drawParallelBars = (alongAxis, spacingCm, runHalf, spreadHalf, color) => {
      if (!spacingCm) return;
      const spacing_m = spacingCm / 100;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      for (let pos = -spreadHalf + spacing_m / 2; pos <= spreadHalf; pos += spacing_m) {
        ctx.beginPath();
        if (alongAxis === 'L') {
          ctx.moveTo(t.toX(-runHalf), t.toY(pos));
          ctx.lineTo(t.toX(runHalf), t.toY(pos));
        } else {
          ctx.moveTo(t.toX(pos), t.toY(-runHalf));
          ctx.lineTo(t.toX(pos), t.toY(runHalf));
        }
        ctx.stroke();
      }
    };

    const longIsL = str.isLLong;
    const longSpacing = longIsL ? str.L_dir.spacing : str.B_dir.spacing;
    // Dirección larga (uniforme)
    drawParallelBars(longIsL ? 'L' : 'B', longSpacing, longIsL ? L / 2 : B / 2, longIsL ? B / 2 : L / 2, '#2563eb');
    // Dirección corta: banda central + franjas exteriores
    const shortAxis = longIsL ? 'B' : 'L';
    const shortRunHalf = longIsL ? B / 2 : L / 2;
    const bandHalf = str.banding.bandWidth / 2;
    drawParallelBars(shortAxis, str.banding.sp_band, shortRunHalf, bandHalf, '#dc2626');
    if (str.banding.sp_outer) {
      const outerFrom = bandHalf;
      const outerTo = longIsL ? L / 2 : B / 2;
      const spacing_m = str.banding.sp_outer / 100;
      ctx.strokeStyle = '#f97316';
      for (let pos = outerFrom + spacing_m / 2; pos <= outerTo; pos += spacing_m) {
        [pos, -pos].forEach((p) => {
          ctx.beginPath();
          if (shortAxis === 'L') { ctx.moveTo(t.toX(-shortRunHalf), t.toY(p)); ctx.lineTo(t.toX(shortRunHalf), t.toY(p)); }
          else { ctx.moveTo(t.toX(p), t.toY(-shortRunHalf)); ctx.lineTo(t.toX(p), t.toY(shortRunHalf)); }
          ctx.stroke();
        });
      }
    }
    // Columna (referencia)
    ctx.strokeStyle = '#1e293b';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(t.toX(-col_L / 2), t.toY(col_B / 2), col_L * t.scale, col_B * t.scale);
    ctx.setLineDash([]);
    ctx.restore();

    ctx.save();
    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText(`Azul: ${longIsL ? 'paralelo a L' : 'paralelo a B'} (dirección larga, uniforme) @ ${longSpacing} cm`, 10, 18);
    ctx.fillText(`Rojo: banda central (dirección corta) @ ${str.banding.sp_band} cm`, 10, 34);
    if (str.banding.sp_outer) ctx.fillText(`Naranja: franjas exteriores (dirección corta) @ ${str.banding.sp_outer} cm`, 10, 50);
    ctx.restore();
  }

  drawIsolatedSection(width, height) {
    const ctx = this.ctx;
    const { isolated } = this.footingData;
    const { L, h, col_L, Df } = isolated;
    const stemH = 0.8; // muñón de columna dibujado, referencial
    const t = this._worldTransform(width, height, { xMin: -L * 0.75, xMax: L * 0.75, yMin: -0.6, yMax: h + stemH + 0.8 });

    // Suelo
    ctx.save();
    ctx.fillStyle = '#f2e9d8';
    ctx.fillRect(0, t.toY(0), width, height - t.toY(0));
    ctx.restore();

    // Zapata
    ctx.save();
    ctx.fillStyle = '#cbd5e1';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(t.toX(-L / 2), t.toY(h), L * t.scale, h * t.scale);
    ctx.fill(); ctx.stroke();

    // Columna
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.rect(t.toX(-col_L / 2), t.toY(h + stemH), col_L * t.scale, stemH * t.scale);
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // Nivel de terreno / Df
    ctx.save();
    ctx.strokeStyle = '#8a6d1f';
    ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(t.toX(-L * 0.75), t.toY(Df)); ctx.lineTo(t.toX(L * 0.75), t.toY(Df)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#8a6d1f';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText(`Nivel de terreno (Df = ${Df.toFixed(2)} m)`, t.toX(-L * 0.72), t.toY(Df) - 6);
    ctx.restore();

    this._dimLine(ctx, t.toX(-L / 2), t.toY(0), t.toX(L / 2), t.toY(0), `L = ${L.toFixed(2)} m`, 26);
    this._dimLine(ctx, t.toX(L / 2), t.toY(h), t.toX(L / 2), t.toY(0), `h = ${h.toFixed(2)} m`, 18, true);
  }

  drawIsolatedPressures(width, height) {
    const ctx = this.ctx;
    const { isolated } = this.footingData;
    const { L } = isolated;
    const geo = this.bearingResults;
    const t = this._worldTransform(width, height, { xMin: -L * 0.75, xMax: L * 0.75, yMin: -1.4, yMax: 1.0 });

    ctx.save();
    ctx.strokeStyle = '#334155';
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
    ctx.fillStyle = '#334155';
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
      const t = this._worldTransform(width, height, { xMin: -L * 0.15, xMax: L * 1.15, yMin: -B * 0.8, yMax: B * 0.8 });
      ctx.save();
      ctx.fillStyle = '#e7ebf1';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(t.toX(0), t.toY(B / 2), L * t.scale, B * t.scale);
      ctx.fill(); ctx.stroke();
      ctx.restore();

      if (this.viewMode === 'plan') {
        [[a1, col1_L, col1_B, '1'], [a2, col2_L, col2_B, '2']].forEach(([xc, cl, cb, label]) => {
          ctx.save();
          ctx.fillStyle = '#94a3b8';
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.rect(t.toX(xc - cl / 2), t.toY(cb / 2), cl * t.scale, cb * t.scale);
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#1e293b';
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
    ctx.fillStyle = '#334155';
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

    ctx.save();
    ctx.fillStyle = '#f2e9d8';
    ctx.fillRect(0, t.toY(0), width, height - t.toY(0));
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#cbd5e1';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(t.toX(0), t.toY(h), L * t.scale, h * t.scale);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    [[a1, col1_L], [a2, col2_L]].forEach(([xc, cl]) => {
      ctx.beginPath();
      ctx.rect(t.toX(xc - cl / 2), t.toY(h + stemH), cl * t.scale, stemH * t.scale);
      ctx.fill(); ctx.stroke();
    });
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#8a6d1f';
    ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(t.toX(-L * 0.1), t.toY(Df)); ctx.lineTo(t.toX(L * 1.1), t.toY(Df)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    this._dimLine(ctx, t.toX(0), t.toY(0), t.toX(L), t.toY(0), `L = ${L.toFixed(2)} m`, 26);
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

    const drawPanel = (yTop, values, maxAbs, title, color, unit) => {
      const zeroY = yTop + panelH / 2;
      const scaleY = (panelH / 2 - 10) / maxAbs;
      ctx.save();
      ctx.strokeStyle = '#cbd5e1';
      ctx.beginPath(); ctx.moveTo(marginL, zeroY); ctx.lineTo(width - marginR, zeroY); ctx.stroke();
      ctx.fillStyle = '#334155';
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

      ctx.fillStyle = '#334155';
      ctx.font = '10px Inter, sans-serif';
      ctx.fillText(`max: ${maxAbs.toFixed(1)} ${unit}`, width - marginR - 90, yTop + 14);
      ctx.restore();
    };

    drawPanel(20, Vs, maxV, 'Fuerza Cortante V(x)', '#2563eb', 'kN');
    drawPanel(20 + panelH + 20, Ms, maxM, 'Momento Flector M(x) — positivo: tracción inferior', '#dc2626', 'kN·m');

    ctx.save();
    ctx.strokeStyle = '#334155';
    ctx.beginPath(); ctx.moveTo(marginL, height - 20); ctx.lineTo(width - marginR, height - 20); ctx.stroke();
    ctx.fillStyle = '#334155';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('0', marginL, height - 6);
    ctx.fillText(`${L.toFixed(2)} m`, width - marginR, height - 6);
    ctx.restore();
  }
}
