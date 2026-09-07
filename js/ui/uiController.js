/**
 * Controlador de interfaz de usuario, eventos, reactividad y sincronización
 * de ZapatasPro (zapata aislada y zapata combinada), estilo MurosPro.
 */

import { DEFAULT_FOOTING_DATA, PRESET_PROJECTS, REBAR_TABLE } from '../constants.js';
import { calculateIsolatedBearing, calculateCombinedBearing, calculateConnectedBearing } from '../engine/soilBearing.js';
import { calculateIsolatedStructural, deriveColumnEccentricity } from '../engine/isolatedFooting.js';
import { calculateCombinedStructural } from '../engine/combinedFooting.js';
import { calculateConnectedStructural } from '../engine/connectedFooting.js';
import { calculateIsolatedRebarSchedule, calculateCombinedRebarSchedule, calculateConnectedRebarSchedule } from '../engine/rebarSchedule.js';
import { knToKg, kNmToKgm, kpaToKgcm2 } from '../engine/units.js';
import { FootingCanvasRenderer } from '../visualizer/footingCanvas.js';
import { FootingRenderer3D } from '../visualizer/footingRenderer3D.js';

const ISOLATED_VIEW_MODES = ['plan', 'section', 'pressures', 'rebar', 'rebar3d'];
const COMBINED_VIEW_MODES = ['plan', 'section', 'diagram', 'rebar', 'rebar3d'];
const CONNECTED_VIEW_MODES = ['plan', 'section', 'diagram', 'rebar', 'rebar3d'];

const LEGEND_KEYS_ISOLATED = ['long_dir', 'short_band', 'short_outer', 'dowels'];
const LEGEND_KEYS_COMBINED = ['bottom_long', 'top_long', 'trans_col1', 'trans_col2', 'dowels'];
const LEGEND_KEYS_CONNECTED = ['slab1', 'slab2', 'strap_top', 'strap_bottom', 'strap_stirrups', 'dowels'];

export class AppUIController {
  constructor() {
    this.data = JSON.parse(JSON.stringify(DEFAULT_FOOTING_DATA));
    this.bearingResults = null;
    this.structResults = null;
    this.rebarSchedule = null;
    // Unidad de presión para MOSTRAR resultados (q_adm, q_max, σ, su, etc.)
    // — el dato interno siempre se guarda en kg/cm²; 'tnm2' solo convierte
    // en pantalla/reporte (1 kg/cm² = 10 tonf/m²).
    this.pressureUnit = localStorage.getItem('zapataspro_punit') || 'kgcm2';

    const canvasEl = document.getElementById('footingCanvas');
    this.renderer = new FootingCanvasRenderer(canvasEl);
    this.renderer3D = null; // se crea perezosamente al abrir "Detalle 3D" por primera vez

    this.initUI();
    this.recalculateAndRender();
  }

  /** Formatea una presión dada en kg/cm² según la unidad activa. */
  _p(kgcm2, decimals = 2) {
    if (this.pressureUnit === 'tnm2') return `${(kgcm2 * 10).toFixed(decimals)} tonf/m²`;
    return `${kgcm2.toFixed(decimals)} kg/cm²`;
  }

  /** Refleja this.pressureUnit en la UI: etiqueta del botón, badge de
   * unidad de q_adm, el valor mostrado en el input de q_adm (convertido),
   * y recalcula/re-renderiza para que los badges y la memoria usen la
   * unidad activa. */
  _syncPressureUnitUI() {
    const label = document.getElementById('punit_label');
    const badge = document.getElementById('q_adm_unit_badge');
    const isTn = this.pressureUnit === 'tnm2';
    if (label) label.textContent = isTn ? 'tonf/m²' : 'kg/cm²';
    if (badge) badge.textContent = isTn ? 'tonf/m²' : 'kg/cm²';
    this.syncFormWithData();
    this.recalculateAndRender();
  }

  initUI() {
    this.populateRebarSelects();
    this.bindInputEvents();
    this.bindButtonEvents();
    this.syncFormWithData();
    this.updateFootingTypeVisibility();
    this.renderer.resizeCanvas();
    const label = document.getElementById('punit_label');
    const badge = document.getElementById('q_adm_unit_badge');
    const isTn = this.pressureUnit === 'tnm2';
    if (label) label.textContent = isTn ? 'tonf/m²' : 'kg/cm²';
    if (badge) badge.textContent = isTn ? 'tonf/m²' : 'kg/cm²';
  }

  populateRebarSelects() {
    ['rebar_main_id', 'rebar_trans_id'].forEach((selId) => {
      const el = document.getElementById(selId);
      if (!el) return;
      el.innerHTML = '';
      REBAR_TABLE.forEach((bar, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${bar.name} (Ab = ${bar.area_cm2} cm²)`;
        el.appendChild(opt);
      });
    });
  }

  bindInputEvents() {
    const inputs = document.querySelectorAll('input[data-bind], select[data-bind]');
    inputs.forEach((input) => {
      input.addEventListener('input', (e) => this.handleInputChange(e.target, false));
      input.addEventListener('change', (e) => this.handleInputChange(e.target, true));
    });
  }

  handleInputChange(element, isCommit) {
    const bindPath = element.getAttribute('data-bind');
    if (!bindPath) return;
    const parts = bindPath.split('.');
    let target = this.data;
    for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
    const lastKey = parts[parts.length - 1];

    let val;
    if (element.type === 'checkbox') {
      val = element.checked;
    } else if (element.type === 'number' || element.type === 'range') {
      if (element.type === 'number' && !isCommit && !/^-?\d*\.?\d*$/.test(element.value)) return;
      val = parseFloat(element.value);
      if (!isCommit && Number.isNaN(val)) return;
    } else {
      val = element.value;
    }
    // El dato interno de q_adm siempre se guarda en kg/cm² — si la unidad
    // activa es tonf/m², lo que se acaba de teclear está en esa unidad.
    if (bindPath === 'foundation.q_adm_kgcm2' && this.pressureUnit === 'tnm2' && !Number.isNaN(val)) {
      val = val / 10;
    }
    target[lastKey] = val;

    if (bindPath === 'footing_type') this.updateFootingTypeVisibility();

    const syncName = element.getAttribute('data-sync');
    if (syncName) {
      document.querySelectorAll(`[data-sync="${syncName}"]`).forEach((inp) => {
        if (inp !== element) {
          if (inp.type === 'checkbox') inp.checked = element.checked; else inp.value = element.value;
        }
      });
    }

    this.recalculateAndRender();
  }

  updateFootingTypeVisibility() {
    const type = this.data.footing_type;
    ['aislada', 'combinada', 'conectada'].forEach((t) => {
      document.querySelectorAll(`.only-${t}`).forEach((el) => el.classList.toggle('hidden', t !== type));
    });

    const legendKeys = { aislada: LEGEND_KEYS_ISOLATED, combinada: LEGEND_KEYS_COMBINED, conectada: LEGEND_KEYS_CONNECTED }[type];
    document.querySelectorAll('[data-rebar-key]').forEach((row) => {
      row.classList.toggle('hidden', !legendKeys.includes(row.getAttribute('data-rebar-key')));
    });

    const modes = { aislada: ISOLATED_VIEW_MODES, combinada: COMBINED_VIEW_MODES, conectada: CONNECTED_VIEW_MODES }[type];
    document.querySelectorAll('[data-view-mode]').forEach((btn) => {
      const mode = btn.getAttribute('data-view-mode');
      btn.classList.toggle('hidden', !modes.includes(mode));
    });
    if (!modes.includes(this.renderer.viewMode)) {
      this.renderer.setViewMode(modes[0]);
      document.querySelectorAll('[data-view-mode]').forEach((b) => {
        const active = b.getAttribute('data-view-mode') === modes[0];
        b.classList.toggle('bg-indigo-600', active);
        b.classList.toggle('text-white', active);
        b.classList.toggle('shadow', active);
        b.classList.toggle('bg-slate-100', !active);
        b.classList.toggle('text-slate-700', !active);
      });
    }
  }

  bindButtonEvents() {
    // Pestañas del panel izquierdo
    const inputTabs = document.querySelectorAll('[data-input-tab]');
    inputTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        inputTabs.forEach((t) => { t.classList.remove('bg-white', 'text-indigo-700', 'shadow-sm'); t.classList.add('text-slate-600'); });
        tab.classList.add('bg-white', 'text-indigo-700', 'shadow-sm');
        tab.classList.remove('text-slate-600');
        document.querySelectorAll('.input-group-panel').forEach((p) => p.classList.add('hidden'));
        const group = document.getElementById(tab.getAttribute('data-input-tab'));
        if (group) group.classList.remove('hidden');
      });
    });

    // Tipo de zapata (aislada / combinada)
    document.querySelectorAll('[data-footing-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.data.footing_type = btn.getAttribute('data-footing-type');
        document.querySelectorAll('[data-footing-type]').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('bg-indigo-600', active);
          b.classList.toggle('text-white', active);
          b.classList.toggle('bg-slate-100', !active);
          b.classList.toggle('text-slate-700', !active);
        });
        this.updateFootingTypeVisibility();
        this.recalculateAndRender();
      });
    });

    // Modos de vista del visualizador
    document.querySelectorAll('[data-view-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-view-mode]').forEach((b) => {
          b.classList.remove('bg-indigo-600', 'text-white', 'shadow');
          b.classList.add('bg-slate-100', 'text-slate-700');
        });
        btn.classList.add('bg-indigo-600', 'text-white', 'shadow');
        btn.classList.remove('bg-slate-100', 'text-slate-700');

        const mode = btn.getAttribute('data-view-mode');
        const container2D = document.getElementById('canvas2d_container');
        const container3D = document.getElementById('canvas3d_container');
        if (mode === 'rebar3d') {
          if (container2D) container2D.classList.add('hidden');
          if (container3D) container3D.classList.remove('hidden');
          if (!this.renderer3D) {
            this.renderer3D = new FootingRenderer3D(container3D);
            this._setupRebar3DLegendToggles();
          }
          this.renderer3D.updateData(this.data, this.bearingResults, this.structResults);
          this._updateRebar3DLegendDims();
          this.renderer3D.start();
        } else {
          if (this.renderer3D) this.renderer3D.stop();
          if (container3D) container3D.classList.add('hidden');
          if (container2D) container2D.classList.remove('hidden');
          this.renderer.setViewMode(mode);
        }
      });
    });

    // Pestañas principales (Visualizador / Fuerzas / Memoria)
    const mainTabs = document.querySelectorAll('[data-main-tab]');
    mainTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        mainTabs.forEach((t) => { t.classList.remove('border-indigo-600', 'text-indigo-600'); t.classList.add('border-transparent', 'text-slate-500'); });
        tab.classList.add('border-indigo-600', 'text-indigo-600');
        tab.classList.remove('border-transparent', 'text-slate-500');
        const tabId = tab.getAttribute('data-main-tab');
        document.querySelectorAll('.tab-content-panel').forEach((p) => p.classList.add('hidden'));
        const panel = document.getElementById(tabId);
        if (panel) {
          panel.classList.remove('hidden');
          if (tabId === 'visualizer_panel') { this.renderer.resizeCanvas(); this.renderer.render(); }
        }
      });
    });

    // Presets
    document.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-preset');
        if (PRESET_PROJECTS[key]) {
          this.data = JSON.parse(JSON.stringify(PRESET_PROJECTS[key].data));
          this.syncFormWithData();
          const activeBtn = document.querySelector(`[data-footing-type="${this.data.footing_type}"]`);
          if (activeBtn) activeBtn.click();
          this.updateFootingTypeVisibility();
          this.recalculateAndRender();
        }
      });
    });

    const resetBtn = document.getElementById('btn_reset_view');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const container3D = document.getElementById('canvas3d_container');
        if (this.renderer3D && container3D && !container3D.classList.contains('hidden')) {
          this.renderer3D._fitCamera(
            this.data.footing_type === 'aislada' ? this.data.isolated.L : this.data.combined.L,
            this.data.footing_type === 'aislada' ? this.data.isolated.B : this.data.combined.B,
            this.data.footing_type === 'aislada' ? this.data.isolated.h : this.data.combined.h,
          );
        } else {
          this.renderer.resetView();
        }
      });
    }

    const printBtn = document.getElementById('btn_print_report');
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        const memoriaTab = document.querySelector('[data-main-tab="report_panel"]');
        if (memoriaTab) memoriaTab.click();
        setTimeout(() => window.print(), 50);
      });
    }

    const printPlanoBtn = document.getElementById('btn_print_plano');
    if (printPlanoBtn) printPlanoBtn.addEventListener('click', () => this.printPlanoSheet());

    const exportJsonBtn = document.getElementById('btn_export_json');
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.download = `Proyecto_Zapata_${this.data.footing_type}.json`;
        link.href = URL.createObjectURL(blob);
        link.click();
      });
    }

    const exportImgBtn = document.getElementById('btn_export_png');
    if (exportImgBtn) {
      exportImgBtn.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `Zapata_${this.data.footing_type}.png`;
        link.href = this.renderer.canvas.toDataURL('image/png');
        link.click();
      });
    }

    const punitBtn = document.getElementById('btn_toggle_punit');
    if (punitBtn) {
      punitBtn.addEventListener('click', () => {
        this.pressureUnit = this.pressureUnit === 'tnm2' ? 'kgcm2' : 'tnm2';
        localStorage.setItem('zapataspro_punit', this.pressureUnit);
        this._syncPressureUnitUI();
      });
    }

    const predimAisladaBtn = document.getElementById('btn-predim-aislada');
    if (predimAisladaBtn) predimAisladaBtn.addEventListener('click', () => this.predimensionIsolated());

    const predimCombinadaBtn = document.getElementById('btn-predim-combinada');
    if (predimCombinadaBtn) predimCombinadaBtn.addEventListener('click', () => this.predimensionCombined());

    const predimConectadaBtn = document.getElementById('btn-predim-conectada');
    if (predimConectadaBtn) predimConectadaBtn.addEventListener('click', () => this.predimensionConnected());
  }

  /** Área requerida (m²), método del curso UNI "Concreto Armado 2"
   * (ecuación 2-4): A ≥ 1.075(PCM+PCV)/(0.9·q_adm) — el 0.9 deja un margen
   * del 10% de la capacidad admisible sin usar en el predimensionamiento.
   * Se itera hasta converger: primera estimación con el 1.075 fijo del
   * curso (una aproximación razonable antes de conocer L,B), y desde la
   * segunda vuelta con el peso propio REAL (zapata + relleno) de la
   * geometría resultante en cada paso — más preciso una vez que L,B ya se
   * conocen, y necesario porque el 1.075 fijo puede quedarse corto en
   * zapatas con desplante profundo frente a su tamaño. */
  _iterateArea(P_tn, h, Df, gamma_c_tnm3, gamma_s_tnm3, solveLB) {
    const qAdmEff = 0.9 * this._qAdmTnm2();
    let A_req = (P_tn * 1.075) / qAdmEff;
    let L, B;
    for (let iter = 0; iter < 6; iter++) {
      ({ L, B } = solveLB(A_req));
      const selfWeight = gamma_c_tnm3 * (L * B) * h + gamma_s_tnm3 * (L * B) * Math.max(0, Df - h);
      const A_next = (P_tn + selfWeight) / qAdmEff;
      if (Math.abs(A_next - A_req) < 1e-6) { A_req = A_next; break; }
      A_req = A_next;
    }
    return { L, B };
  }

  _qAdmTnm2() {
    return (this.data.foundation.q_adm_kgcm2 || 1) * 10;
  }

  /** L=2c+a, B=2c+b (proyección "c" simétrica en ambas direcciones) —
   * proporcionamiento clásico de zapata interior/concéntrica. */
  _solveCenteredLB(a, b, A_req) {
    const disc = (a - b) * (a - b) + 4 * A_req;
    const c = Math.max(0.05, Math.ceil(((-(a + b) + Math.sqrt(disc)) / 4) / 0.05) * 0.05);
    return {
      L: Math.ceil((2 * c + a) / 0.05) * 0.05,
      B: Math.ceil((2 * c + b) / 0.05) * 0.05,
    };
  }

  /** L=c+a, B=2c+b (proyección "c" hacia un solo lado en L — borde de
   * propiedad, sin volado hacia afuera — y simétrica en B). */
  _solveEdgeLB(a, b, A_req) {
    const disc = (2 * a + b) * (2 * a + b) - 8 * (a * b - A_req);
    const c = Math.max(0.05, Math.ceil(((-(2 * a + b) + Math.sqrt(disc)) / 4) / 0.05) * 0.05);
    return {
      L: Math.ceil((c + a) / 0.05) * 0.05,
      B: Math.ceil((2 * c + b) / 0.05) * 0.05,
    };
  }

  /** L=c+a, B=c+b (proyección "c" hacia un solo lado en ambas direcciones
   * — columna de esquina, sin volado hacia ninguno de los dos bordes de
   * propiedad). */
  _solveCornerLB(a, b, A_req) {
    const disc = (a - b) * (a - b) + 4 * A_req;
    const c = Math.max(0.05, Math.ceil(((-(a + b) + Math.sqrt(disc)) / 2) / 0.05) * 0.05);
    return {
      L: Math.ceil((c + a) / 0.05) * 0.05,
      B: Math.ceil((c + b) / 0.05) * 0.05,
    };
  }

  /** Elige la fórmula de proporcionamiento L,B según el tipo de columna
   * (mismo criterio que deriveColumnEccentricity en isolatedFooting.js):
   * interior → volado simétrico en ambas direcciones; medianera → un solo
   * lado en L (cara al ras del borde), simétrico en B; esquinera → un
   * solo lado en ambas direcciones (al ras de los dos bordes). */
  _solveLBByColType(colType, a, b, A_req) {
    if (colType === 'esquinera') return this._solveCornerLB(a, b, A_req);
    if (colType === 'medianera') return this._solveEdgeLB(a, b, A_req);
    return this._solveCenteredLB(a, b, A_req);
  }

  /**
   * Predimensionamiento de zapata combinada: L se fija para que el
   * centroide de la zapata coincida con la resultante de cargas de
   * servicio (excentricidad nula, e=0 en calculateCombinedBearing), dados
   * a1 y s; B se resuelve por área requerida, iterando con el peso propio
   * real. Mismo criterio de la hoja de cálculo/curso UNI para el
   * dimensionamiento de zapatas combinadas.
   */
  predimensionCombined() {
    const { combined, foundation, materials } = this.data;
    const P1 = (combined.P1d || 0) + (combined.P1l || 0);
    const P2 = (combined.P2d || 0) + (combined.P2l || 0);
    if (P1 + P2 <= 0) return;
    const gamma_c_tnm3 = (materials.gamma_c_kgm3 || 2400) / 1000;
    const gamma_s_tnm3 = (foundation.gamma_kgm3 || 1800) / 1000;
    const h = combined.h || 0.5, Df = combined.Df || 1.5;

    const x_R = combined.a1 + (P2 * combined.s) / (P1 + P2);
    const L = Math.ceil((2 * x_R) / 0.05) * 0.05;
    const { B } = this._iterateArea(P1 + P2, h, Df, gamma_c_tnm3, gamma_s_tnm3, (A_req) => ({ L, B: Math.ceil((A_req / L) / 0.05) * 0.05 }));

    combined.L = Math.round(L * 100) / 100;
    combined.B = Math.round(B * 100) / 100;
    this.syncFormWithData();
    this.recalculateAndRender();
  }

  /**
   * Predimensionamiento de zapata conectada — hoja de cálculo de
   * referencia (Efrén, "ZAPATA CONECTADA.xlsx"): en un solo paso (sin
   * iterar, el factor "fz" ya aproxima el peso propio):
   *   1. Zapata 1 (excéntrica): A1 = P1(1+fz)/q_adm, repartida con
   *      _solveEdgeLB (volado "c" hacia un solo lado en L — al ras del
   *      límite de propiedad —, simétrico en B).
   *   2. e1 = L1/2 − col1_L/2; distancia entre centroides = s (libre entre
   *      caras) + col1_L/2 + col2_L/2.
   *   3. R2 = P2 − P1·e1/(centroides−e1) + (My1+My2)/(centroides−e1) —
   *      método de la viga rígida, con el momento "My" de cada columna
   *      (el que actúa en el plano de la viga de conexión).
   *   4. Zapata 2 (interior): A2 = R2(1+fz)/q_adm, repartida con
   *      _solveCenteredLB (volado "c" simétrico en ambas direcciones).
   */
  predimensionConnected() {
    const { connected, foundation } = this.data;
    const P1 = (connected.P1d || 0) + (connected.P1l || 0);
    const P2 = (connected.P2d || 0) + (connected.P2l || 0);
    const My1 = (connected.My1_d || 0) + (connected.My1_l || 0);
    const My2 = (connected.My2_d || 0) + (connected.My2_l || 0);
    if (P1 <= 0 || P2 <= 0) return;
    const fz = connected.fz ?? 0.1;
    const qAdmTnm2 = (foundation.q_adm_kgcm2 || 1) * 10;
    const { col1_L, col1_B, col2_L, col2_B } = connected;

    const A1_req = (P1 * (1 + fz)) / qAdmTnm2;
    const { L: L1, B: B1 } = this._solveEdgeLB(col1_L, col1_B, A1_req);

    const e1 = L1 / 2 - col1_L / 2;
    const sCentroid = connected.s + col1_L / 2 + col2_L / 2;
    const denom = sCentroid - e1;
    if (denom <= 0.01) return; // geometría inválida (e1 demasiado cerca de la columna 2)
    const R2 = P2 - (P1 * e1) / denom + (My1 + My2) / denom;
    if (R2 <= 0) return; // reacción negativa: el método de la viga rígida no aplica

    const A2_req = (R2 * (1 + fz)) / qAdmTnm2;
    const { L: L2, B: B2 } = this._solveCenteredLB(col2_L, col2_B, A2_req);

    connected.L1 = Math.round(L1 * 100) / 100;
    connected.B1 = Math.round(B1 * 100) / 100;
    connected.L2 = Math.round(L2 * 100) / 100;
    connected.B2 = Math.round(B2 * 100) / 100;
    this.syncFormWithData();
    this.recalculateAndRender();
  }

  /**
   * Predimensionamiento de zapata aislada — hoja de cálculo de referencia
   * (Efrén, "ZAPATA TIPO 1.xlsx"): área tentativa A = P(1+fz)/q_adm (sin
   * iterar con el peso propio real — el factor "fz" ya lo aproxima), y
   * reparto del volado "c" según el tipo de columna — simétrico en ambas
   * direcciones si es interior, hacia un solo lado en L si es
   * medianera/borde, y hacia un solo lado en ambas direcciones si es
   * esquinera (ver _solveLBByColType) — para que L×B cubra esa área.
   */
  predimensionIsolated() {
    const { isolated, foundation } = this.data;
    const P = (isolated.Pd || 0) + (isolated.Pl || 0);
    if (P <= 0) return;
    const fz = isolated.fz ?? 0.08;
    const qAdmTnm2 = (foundation.q_adm_kgcm2 || 1) * 10;
    const A_req = (P * (1 + fz)) / qAdmTnm2;

    const { L, B } = this._solveLBByColType(isolated.col_type, isolated.col_L, isolated.col_B, A_req);
    isolated.L = Math.round(L * 100) / 100;
    isolated.B = Math.round(B * 100) / 100;
    this.syncFormWithData();
    this.recalculateAndRender();
  }

  syncFormWithData() {
    const inputs = document.querySelectorAll('input[data-bind], select[data-bind]');
    inputs.forEach((input) => {
      const bindPath = input.getAttribute('data-bind');
      if (!bindPath) return;
      const parts = bindPath.split('.');
      let target = this.data;
      for (let i = 0; i < parts.length - 1; i++) { if (!target) return; target = target[parts[i]]; }
      if (!target) return;
      let val = target[parts[parts.length - 1]];
      if (bindPath === 'foundation.q_adm_kgcm2' && this.pressureUnit === 'tnm2' && typeof val === 'number') {
        val = Math.round(val * 10 * 100) / 100;
      }
      if (input.type === 'checkbox') input.checked = !!val; else input.value = val !== undefined ? val : '';
    });
  }

  recalculateAndRender() {
    const type = this.data.footing_type;
    if (type === 'aislada') {
      const { ex_col, ey_col } = deriveColumnEccentricity(this.data.isolated);
      this.data.isolated.ex_col = ex_col;
      this.data.isolated.ey_col = ey_col;
      this.bearingResults = calculateIsolatedBearing(this.data);
      this.structResults = calculateIsolatedStructural(this.data);
      this.rebarSchedule = calculateIsolatedRebarSchedule(this.data, this.structResults);
    } else if (type === 'combinada') {
      this.bearingResults = calculateCombinedBearing(this.data);
      this.structResults = calculateCombinedStructural(this.data);
      this.rebarSchedule = calculateCombinedRebarSchedule(this.data, this.structResults);
    } else {
      this.bearingResults = calculateConnectedBearing(this.data);
      this.structResults = calculateConnectedStructural(this.data);
      this.rebarSchedule = calculateConnectedRebarSchedule(this.data, this.structResults);
    }
    this.renderer.updateData(this.data, this.bearingResults, this.structResults);
    if (this.renderer3D) {
      this.renderer3D.updateData(this.data, this.bearingResults, this.structResults);
      this._updateRebar3DLegendDims();
    }

    this.updateStatusBadges();
    this.updateStructuralSummary();
    this.generateCalculationReport();
  }

  /** Conecta los checkboxes de la leyenda del "Detalle 3D" para mostrar u
   * ocultar cada tipo de acero de forma independiente. Se llama una sola
   * vez, al crear el renderer3D. */
  _setupRebar3DLegendToggles() {
    document.querySelectorAll('#rebar3d_legend .rebar-vis-toggle').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.getAttribute('data-rebar-key');
        if (this.renderer3D) this.renderer3D.setRebarTypeVisible(key, input.checked);
      });
    });
    const realScaleToggle = document.getElementById('rebar3d_real_scale');
    if (realScaleToggle) {
      realScaleToggle.addEventListener('change', () => {
        if (this.renderer3D) this.renderer3D.setRebarRealScale(realScaleToggle.checked);
      });
    }
    const legendToggleBtn = document.getElementById('rebar3d_legend_toggle');
    const legendBody = document.getElementById('rebar3d_legend_body');
    if (legendToggleBtn && legendBody) {
      legendToggleBtn.addEventListener('click', () => {
        const collapsed = legendBody.classList.toggle('hidden');
        legendToggleBtn.textContent = collapsed ? '▸' : '▾';
      });
    }
  }

  /** Escribe el diámetro y espaciamiento real de cada tipo de acero junto a
   * su fila en la leyenda del "Detalle 3D", con los valores que ya calculó
   * el motor estructural (sin recalcular nada). */
  _updateRebar3DLegendDims() {
    const str = this.structResults;
    if (!str) return;
    const type = this.data.footing_type;
    let dims;
    if (type === 'aislada') {
      dims = {
        long_dir: `${str.dbMain.name} @ ${str.isLLong ? str.L_dir.spacing : str.B_dir.spacing} cm`,
        short_band: `${str.dbMain.name} @ ${str.banding.sp_band} cm`,
        short_outer: str.banding.sp_outer ? `${str.dbMain.name} @ ${str.banding.sp_outer} cm` : 'igual que banda central',
        dowels: 'Referencial (arranque de columna)',
      };
    } else if (type === 'combinada') {
      dims = {
        bottom_long: `${str.dbMain.name} @ ${str.bottom.spacing} cm`,
        top_long: `${str.dbMain.name} @ ${str.top.spacing} cm`,
        trans_col1: `${str.dbTrans.name} @ ${str.trans1.spacing} cm`,
        trans_col2: `${str.dbTrans.name} @ ${str.trans2.spacing} cm`,
        dowels: 'Referencial (arranque de columnas)',
      };
    } else {
      dims = {
        slab1: `Zapata 1 — ${str.dbMain.name} (ver planta para detalle)`,
        slab2: `Zapata 2 — ${str.dbMain.name} (ver planta para detalle)`,
        strap_top: `${str.dbMain.name} × ${str.strap.n_bars_top}`,
        strap_bottom: `${str.dbMain.name} × ${str.strap.n_bars_bottom}`,
        strap_stirrups: `${str.strap.rebarTrans.name} @ ${str.strap.stirrup_spacing_cm} cm`,
        dowels: 'Referencial (arranque de columnas)',
      };
    }
    document.querySelectorAll('.rebar-dim-text').forEach((span) => {
      const key = span.getAttribute('data-dim-key');
      if (dims[key]) span.textContent = dims[key];
    });
  }

  renderKPIBadge(elementId, data) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const bgClass = data.pass ? 'border-emerald-300 bg-emerald-50/70' : 'border-amber-300 bg-amber-50/70';
    const textClass = data.pass ? 'text-emerald-700' : 'text-amber-700';
    const barClass = data.pass ? 'bg-emerald-500' : 'bg-amber-500';
    const statusText = data.pass ? 'OK CUMPLE' : 'NO CUMPLE';
    const badgeBg = data.pass ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-200 text-amber-900';
    el.className = `p-2.5 rounded border ${bgClass} transition-all duration-150`;
    el.innerHTML = `
      <div class="flex justify-between items-start mb-0.5">
        <span class="text-[11px] font-bold text-slate-600">${data.title}</span>
        <span class="text-[9px] font-extrabold px-1 py-0.5 rounded ${badgeBg}">${statusText}</span>
      </div>
      <div class="flex items-baseline space-x-1.5">
        <span class="text-lg font-extrabold font-mono ${textClass}">${data.val}</span>
        <span class="text-[10px] text-slate-500 font-medium">${data.req}</span>
      </div>
      <div class="w-full bg-slate-200 h-1 rounded mt-1.5 overflow-hidden">
        <div class="${barClass} h-full rounded transition-all duration-200" style="width: ${Math.min(100, Math.max(2, data.progress))}%"></div>
      </div>`;
  }

  updateStatusBadges() {
    const geo = this.bearingResults, str = this.structResults;
    if (!geo || !str) return;
    const type = this.data.footing_type;
    const isIsolated = type === 'aislada';

    if (type === 'conectada') {
      this.renderKPIBadge('kpi_bearing', {
        title: 'Presión de Contacto (Z1 / Z2)',
        val: `${this._p(geo.q1_kgcm2).replace(/ [^ ]+$/, '')} / ${this._p(geo.q2_kgcm2)}`,
        req: `≤ ${this._p(geo.q_adm_eff_kgcm2)}`,
        pass: geo.pass_bearing_1 && geo.pass_bearing_2,
        progress: Math.max(geo.q1_kgcm2, geo.q2_kgcm2) / geo.q_adm_eff_kgcm2 * 100,
      });
    } else if (geo.hasSeismic) {
      this.renderKPIBadge('kpi_bearing', {
        title: 'Presión de Contacto (envolvente sísmica)',
        val: this._p(geo.seismic_envelope.governing_q_kgcm2),
        req: `${geo.seismic_envelope.governingRow.label}`,
        pass: geo.pass_bearing,
        progress: (geo.seismic_envelope.governing_q_kgcm2 / geo.seismic_envelope.governingRow.limit_kgcm2) * 100,
      });
    } else {
      this.renderKPIBadge('kpi_bearing', {
        title: 'Presión de Contacto (q_max)',
        val: this._p(geo.q_max_kgcm2),
        req: `≤ ${this._p(geo.q_adm_kgcm2)}`,
        pass: geo.pass_bearing,
        progress: (geo.q_max_kgcm2 / geo.q_adm_kgcm2) * 100,
      });
    }

    if (type === 'conectada') {
      this.renderKPIBadge('kpi_eccentricity', {
        title: 'Fuerza en Viga de Conexión (Ru)',
        val: `${knToKg(geo.Ru).toFixed(0)} kg`,
        req: `e1 = ${(geo.e1 * 100).toFixed(1)} cm`,
        pass: geo.pass_positive_reaction,
        progress: 50,
      });
      const worstShear = Math.max(
        str.slab1.L_dir.shear.V / str.slab1.L_dir.phiVc, str.slab1.B_dir.shear.V / str.slab1.B_dir.phiVc,
        str.slab2.L_dir.shear.V / str.slab2.L_dir.phiVc, str.slab2.B_dir.shear.V / str.slab2.B_dir.phiVc,
      );
      this.renderKPIBadge('kpi_shear', {
        title: 'Corte 1 dirección (peor losa)',
        val: `${(worstShear * 100).toFixed(0)} %`,
        req: '≤ 100 %',
        pass: str.slab1.L_dir.pass_shear && str.slab1.B_dir.pass_shear && str.slab2.L_dir.pass_shear && str.slab2.B_dir.pass_shear,
        progress: worstShear * 100,
      });
      const worstPunch = Math.max(str.slab1.punching.Vu / str.slab1.punching.phiVc, str.slab2.punching.Vu / str.slab2.punching.phiVc);
      this.renderKPIBadge('kpi_punching', {
        title: 'Punzonamiento (peor zapata)',
        val: `${(worstPunch * 100).toFixed(0)} %`,
        req: '≤ 100 %',
        pass: str.slab1.punching.pass && str.slab2.punching.pass,
        progress: worstPunch * 100,
      });
    } else if (isIsolated) {
      this.renderKPIBadge('kpi_eccentricity', {
        title: 'Excentricidad (tercio medio)',
        val: `ex=${(geo.ex * 100).toFixed(1)} / ey=${(geo.ey * 100).toFixed(1)} cm`,
        req: `≤ ${(geo.ex_max * 100).toFixed(1)} / ${(geo.ey_max * 100).toFixed(1)}`,
        pass: geo.pass_kern,
        progress: Math.max(Math.abs(geo.ex) / geo.ex_max, Math.abs(geo.ey) / geo.ey_max) * 100,
      });
      this.renderKPIBadge('kpi_punching', {
        title: 'Punzonamiento (Vu / φVc)',
        val: `${knToKg(str.punching.Vu).toFixed(0)} kg`,
        req: `≤ ${knToKg(str.punching.phiVc).toFixed(0)} kg`,
        pass: str.punching.pass,
        progress: (str.punching.Vu / str.punching.phiVc) * 100,
      });
      this.renderKPIBadge('kpi_shear', {
        title: 'Corte 1 dirección (peor caso)',
        val: `${(Math.max(str.L_dir.shear.V / str.L_dir.phiVc, str.B_dir.shear.V / str.B_dir.phiVc) * 100).toFixed(0)} %`,
        req: '≤ 100 %',
        pass: str.L_dir.pass_shear && str.B_dir.pass_shear,
        progress: Math.max(str.L_dir.shear.V / str.L_dir.phiVc, str.B_dir.shear.V / str.B_dir.phiVc) * 100,
      });
    } else {
      this.renderKPIBadge('kpi_eccentricity', {
        title: 'Excentricidad Longitudinal (tercio medio)',
        val: `e = ${(geo.e * 100).toFixed(1)} cm`,
        req: `≤ ${(geo.e_max * 100).toFixed(1)} cm`,
        pass: geo.within_kern,
        progress: (Math.abs(geo.e) / geo.e_max) * 100,
      });
      this.renderKPIBadge('kpi_punching', {
        title: 'Punzonamiento (peor columna)',
        val: `${(Math.max(str.punch1.Vu / str.punch1.phiVc, str.punch2.Vu / str.punch2.phiVc) * 100).toFixed(0)} %`,
        req: '≤ 100 %',
        pass: str.punch1.pass && str.punch2.pass,
        progress: Math.max(str.punch1.Vu / str.punch1.phiVc, str.punch2.Vu / str.punch2.phiVc) * 100,
      });
      this.renderKPIBadge('kpi_shear', {
        title: 'Corte 1 dirección (peor sección)',
        val: `${(Math.max(...str.shearChecks.map(c => c.Vu / str.phiVc_oneWay)) * 100).toFixed(0)} %`,
        req: '≤ 100 %',
        pass: str.pass_shear_oneWay,
        progress: Math.max(...str.shearChecks.map(c => c.Vu / str.phiVc_oneWay)) * 100,
      });
    }
  }

  /** Filas de la tabla de resumen estructural para UNA losa de zapata
   * (franja L, franja B, punzonamiento) — compartidas por la zapata
   * aislada y por cada una de las dos zapatas de una zapata conectada. */
  _slabSummaryRows(slab, label, badge) {
    return `
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-xs">
          <td class="py-2 px-3 font-bold text-slate-800">${label} — Franja dirección L</td>
          <td class="py-2 px-3 text-right">${kNmToKgm(slab.L_dir.strip.M).toFixed(0)} kg·m</td>
          <td class="py-2 px-3 text-right">${(slab.L_dir.shear.V / slab.L_dir.phiVc * 100).toFixed(0)} %</td>
          <td class="py-2 px-3 text-right font-bold text-indigo-600">${slab.L_dir.As_per_m.toFixed(2)} cm²/m</td>
          <td class="py-2 px-3 font-semibold text-slate-900">${slab.dbMain.name} @ ${slab.L_dir.spacing ?? slab.banding.sp_band} cm</td>
          <td class="py-2 px-3 text-center">${badge(slab.L_dir.pass_shear)}</td>
        </tr>
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-xs">
          <td class="py-2 px-3 font-bold text-slate-800">${label} — Franja dirección B</td>
          <td class="py-2 px-3 text-right">${kNmToKgm(slab.B_dir.strip.M).toFixed(0)} kg·m</td>
          <td class="py-2 px-3 text-right">${(slab.B_dir.shear.V / slab.B_dir.phiVc * 100).toFixed(0)} %</td>
          <td class="py-2 px-3 text-right font-bold text-indigo-600">${slab.B_dir.As_per_m.toFixed(2)} cm²/m</td>
          <td class="py-2 px-3 font-semibold text-slate-900">${slab.dbMain.name} @ ${slab.B_dir.spacing ?? slab.banding.sp_band} cm</td>
          <td class="py-2 px-3 text-center">${badge(slab.B_dir.pass_shear)}</td>
        </tr>
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-xs">
          <td class="py-2 px-3 font-bold text-slate-800">${label} — Punzonamiento (2 direcciones)</td>
          <td class="py-2 px-3 text-right">—</td>
          <td class="py-2 px-3 text-right">${knToKg(slab.punching.Vu).toFixed(0)} / ${knToKg(slab.punching.phiVc).toFixed(0)} kg</td>
          <td class="py-2 px-3 text-right">—</td>
          <td class="py-2 px-3 font-semibold text-slate-900">bo = ${(slab.punching.bo * 100).toFixed(0)} cm</td>
          <td class="py-2 px-3 text-center">${badge(slab.punching.pass)}</td>
        </tr>`;
  }

  updateStructuralSummary() {
    const tbody = document.getElementById('table_structural_tbody');
    if (!tbody) return;
    const str = this.structResults;
    const type = this.data.footing_type;
    const badge = (pass) => `<span class="px-2 py-0.5 rounded text-[10px] font-bold ${pass ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">${pass ? 'OK' : 'Revisar'}</span>`;

    if (type === 'aislada') {
      tbody.innerHTML = this._slabSummaryRows(str, 'Zapata', badge);
    } else if (type === 'conectada') {
      const strap = str.strap;
      tbody.innerHTML = this._slabSummaryRows(str.slab1, 'Zapata 1 (excéntrica)', badge)
        + this._slabSummaryRows(str.slab2, 'Zapata 2 (interior)', badge)
        + `
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-xs">
          <td class="py-2 px-3 font-bold text-slate-800">Viga de conexión (flexión)</td>
          <td class="py-2 px-3 text-right">${strap.Mu_top_kgm.toFixed(0)} kg·m</td>
          <td class="py-2 px-3 text-right">—</td>
          <td class="py-2 px-3 text-right font-bold text-indigo-600">${strap.As_top_req.toFixed(2)} cm²</td>
          <td class="py-2 px-3 font-semibold text-slate-900">${strap.n_bars_top} ${str.dbMain.name} (superior)</td>
          <td class="py-2 px-3 text-center">${badge(strap.pass_ductility_top)}</td>
        </tr>
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-xs">
          <td class="py-2 px-3 font-bold text-slate-800">Viga de conexión (corte)</td>
          <td class="py-2 px-3 text-right">—</td>
          <td class="py-2 px-3 text-right">${strap.Vu_kg.toFixed(0)} / ${knToKg(strap.phiVc).toFixed(0)} kg</td>
          <td class="py-2 px-3 text-right">—</td>
          <td class="py-2 px-3 font-semibold text-slate-900">Estribos ${strap.rebarTrans.name} @ ${strap.stirrup_spacing_cm} cm</td>
          <td class="py-2 px-3 text-center">${badge(true)}</td>
        </tr>`;
    } else {
      tbody.innerHTML = `
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-xs">
          <td class="py-2 px-3 font-bold text-slate-800">Longitudinal inferior (voladizos, +)</td>
          <td class="py-2 px-3 text-right">${kNmToKgm(str.Mu_pos).toFixed(0)} kg·m</td>
          <td class="py-2 px-3 text-right">—</td>
          <td class="py-2 px-3 text-right font-bold text-indigo-600">${str.bottom.As_per_m.toFixed(2)} cm²/m</td>
          <td class="py-2 px-3 font-semibold text-slate-900">${str.dbMain.name} @ ${str.bottom.spacing} cm</td>
          <td class="py-2 px-3 text-center">${badge(true)}</td>
        </tr>
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-xs">
          <td class="py-2 px-3 font-bold text-slate-800">Longitudinal superior (entre columnas, −)</td>
          <td class="py-2 px-3 text-right">${kNmToKgm(str.Mu_neg).toFixed(0)} kg·m</td>
          <td class="py-2 px-3 text-right">—</td>
          <td class="py-2 px-3 text-right font-bold text-indigo-600">${str.top.As_per_m.toFixed(2)} cm²/m</td>
          <td class="py-2 px-3 font-semibold text-slate-900">${str.dbMain.name} @ ${str.top.spacing} cm</td>
          <td class="py-2 px-3 text-center">${badge(true)}</td>
        </tr>
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-xs">
          <td class="py-2 px-3 font-bold text-slate-800">Corte en una dirección (4 secciones a "d")</td>
          <td class="py-2 px-3 text-right">—</td>
          <td class="py-2 px-3 text-right">${(Math.max(...str.shearChecks.map(c => c.Vu)) / 1).toFixed(0)} / ${str.phiVc_oneWay.toFixed(0)} kN</td>
          <td class="py-2 px-3 text-right">—</td>
          <td class="py-2 px-3 font-semibold text-slate-900">d = ${(str.d_main * 100).toFixed(1)} cm</td>
          <td class="py-2 px-3 text-center">${badge(str.pass_shear_oneWay)}</td>
        </tr>
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-xs">
          <td class="py-2 px-3 font-bold text-slate-800">Punzonamiento Columna 1 / Columna 2</td>
          <td class="py-2 px-3 text-right">—</td>
          <td class="py-2 px-3 text-right">${knToKg(str.punch1.Vu).toFixed(0)}/${knToKg(str.punch2.Vu).toFixed(0)} kg</td>
          <td class="py-2 px-3 text-right">—</td>
          <td class="py-2 px-3 font-semibold text-slate-900">φVc = ${knToKg(str.punch1.phiVc).toFixed(0)}/${knToKg(str.punch2.phiVc).toFixed(0)} kg</td>
          <td class="py-2 px-3 text-center">${badge(str.punch1.pass && str.punch2.pass)}</td>
        </tr>
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-xs">
          <td class="py-2 px-3 font-bold text-slate-800">Transversal bajo Columna 1 / Columna 2</td>
          <td class="py-2 px-3 text-right">${kNmToKgm(str.trans1.Mu).toFixed(0)}/${kNmToKgm(str.trans2.Mu).toFixed(0)} kg·m/m</td>
          <td class="py-2 px-3 text-right">—</td>
          <td class="py-2 px-3 text-right font-bold text-indigo-600">${str.trans1.flex.As_design.toFixed(2)}/${str.trans2.flex.As_design.toFixed(2)} cm²/m</td>
          <td class="py-2 px-3 font-semibold text-slate-900">${str.dbTrans.name} @ ${str.trans1.spacing}/${str.trans2.spacing} cm</td>
          <td class="py-2 px-3 text-center">${badge(true)}</td>
        </tr>`;
    }
  }

  generateCalculationReport() {
    const container = document.getElementById('calculation_report_content');
    if (!container) return;
    const type = this.data.footing_type;
    const reportFn = { aislada: '_reportIsolated', combinada: '_reportCombined', conectada: '_reportConnected' }[type];
    container.innerHTML = this[reportFn]();
  }

  _sectionTitle(text) {
    return `<h2 class="text-base font-extrabold text-slate-900 border-b-2 border-indigo-600 pb-1.5 mb-3 mt-8">${text}</h2>`;
  }

  _table(headers, rows) {
    return `<table class="w-full text-xs border-collapse mb-4">
      <thead><tr class="bg-slate-100 text-slate-600 font-bold">${headers.map(h => `<th class="border border-slate-300 px-2 py-1.5 text-left">${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td class="border border-slate-300 px-2 py-1.5">${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
  }

  _badgeHtml(pass) {
    return `<span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold ${pass ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">${pass ? 'CUMPLE' : 'NO CUMPLE'}</span>`;
  }

  _rebarTableHtml() {
    const sched = this.rebarSchedule;
    if (!sched) return '';
    const rows = sched.rows.map(r => [r.mark, r.element, r.diameter_name, `${r.unitLength_m.toFixed(2)} m`, r.quantity, `${r.totalLength_m.toFixed(1)} m`, `${r.weight_kg.toFixed(1)} kg`]);
    rows.push(['', '<b>TOTAL</b>', '', '', '', '', `<b>${sched.totalWeight_kg.toFixed(1)} kg</b>`]);
    return this._table(['Marca', 'Elemento', 'Ø', 'Long. (1 barra)', 'Cant.', 'Long. Total', 'Peso'], rows);
  }

  /** Bloque con los datos del cajetín (mismos datos que la hoja de Plano),
   * mostrado al inicio de la Memoria de Cálculo para identificar el
   * proyecto — se omiten los campos que el usuario dejó en blanco. */
  _cajetinBlockHtml() {
    const p = this.data.plano || {};
    const fields = [
      ['Proyecto', p.proyecto],
      ['Propietario', p.propietario],
      ['Ubicación', p.ubicacion],
      ['Dibujado por', p.dibujado_por],
      ['Revisado por', p.revisado_por],
      ['Escala', p.escala],
      ['Código de plano', p.codigo],
    ].filter(([, v]) => v && String(v).trim() !== '');
    if (!fields.length) return '';
    return `<div class="text-xs text-slate-700 border border-slate-200 rounded-lg bg-slate-50 px-3 py-2.5 mb-6 grid grid-cols-2 gap-x-6 gap-y-1">
      ${fields.map(([label, val]) => `<div><span class="font-semibold text-slate-500">${label}:</span> ${val}</div>`).join('')}
    </div>`;
  }

  /** Imágenes del visualizador (Planta, Detalle de Armado y, si ya se
   * abrió alguna vez, Isométrico 3D) embebidas al inicio de la Memoria de
   * Cálculo — mismas capturas que usa la hoja de Plano. No se fuerza la
   * creación del visor 3D aquí (evita el costo de iniciar WebGL) si el
   * usuario nunca lo abrió en esta sesión. */
  _visualizerImagesHtml() {
    let imgPlanta = '', imgArmadura = '';
    try { imgPlanta = this.renderer.captureSnapshot('plan'); } catch (e) { /* no disponible */ }
    try { imgArmadura = this.renderer.captureSnapshot('rebar'); } catch (e) { /* no disponible */ }
    let img3D = '';
    if (this.renderer3D) {
      try { img3D = this.renderer3D.captureSnapshot(); } catch (e) { /* no disponible */ }
    }
    const panel = (title, img) => (img ? `
      <div class="border border-slate-200 rounded-lg overflow-hidden bg-white">
        <div class="bg-slate-100 text-[10px] font-bold text-slate-600 uppercase tracking-wide px-2 py-1 border-b border-slate-200">${title}</div>
        <img src="${img}" alt="${title}" class="w-full block">
      </div>` : '');
    const panels = [panel('Planta', imgPlanta), panel('Detalle de Armado', imgArmadura), panel('Isométrico 3D', img3D)].filter(Boolean);
    if (!panels.length) return '';
    return `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">${panels.join('')}</div>`;
  }

  /** Fila "etiqueta = valor" para los mini-cuadros de especificaciones. */
  _specRow(label, val) {
    return `<tr><td class="py-0.5 pr-3 text-slate-600">${label} =</td><td class="py-0.5 text-right font-mono font-semibold text-slate-800 whitespace-nowrap">${val}</td></tr>`;
  }

  /** Redondea a 4 decimales y recorta ceros sobrantes (0.5000 → 0.5, 0 → 0). */
  _trimNum(n) {
    return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }

  /**
   * Sección "I) DATOS DE DISEÑO" al estilo de una hoja de cálculo real de
   * referencia: especificaciones del proyecto y sección de columna a la
   * izquierda, cuadro de cargas en servicio (CM/CV/SXD/SYD × P/Mx/My) a la
   * derecha — con SXD/SYD solo si el proyecto tiene datos de sismo.
   */
  _datosDisenoIsoladaHtml(d, fnd, mat, hasSeismic) {
    const specsHtml = `
      <h4 class="text-xs font-bold text-slate-700 mb-1">Especificaciones del proyecto</h4>
      <table class="text-xs w-full mb-3">
        ${this._specRow(`Resistencia del concreto (f'c)`, `${mat.fc_kgcm2.toFixed(0)} kg/cm²`)}
        ${this._specRow('Resistencia del acero (fy)', `${mat.fy_kgcm2.toFixed(0)} kg/cm²`)}
        ${this._specRow('Prof. de desplante (Df)', `${d.Df.toFixed(2)} m`)}
        ${this._specRow('Capacidad portante admisible (q_adm)', this._p(fnd.q_adm_kgcm2))}
        ${this._specRow('Peso específico del suelo (γs)', `${fnd.gamma_kgm3.toFixed(0)} kg/m³`)}
      </table>
      <h4 class="text-xs font-bold text-slate-700 mb-1">Sección de Columna</h4>
      <table class="text-xs w-full mb-3">
        ${this._specRow('Ancho de columna (b)', `${d.col_L.toFixed(2)} m`)}
        ${this._specRow('Peralte de columna (t)', `${d.col_B.toFixed(2)} m`)}
      </table>
      <h4 class="text-xs font-bold text-slate-700 mb-1">Geometría de la Zapata</h4>
      <table class="text-xs w-full">
        ${this._specRow('Largo de zapata (L)', `${d.L.toFixed(2)} m`)}
        ${this._specRow('Ancho de zapata (B)', `${d.B.toFixed(2)} m`)}
        ${this._specRow('Peralte total (h)', `${d.h.toFixed(2)} m`)}
      </table>`;

    const loadRow = (label, P, Mx, My) => `<tr class="odd:bg-sky-50">
      <td class="border border-slate-300 px-2 py-1 font-bold bg-sky-100">${label}</td>
      <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._trimNum(P)}</td>
      <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._trimNum(Mx)}</td>
      <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._trimNum(My)}</td>
    </tr>`;
    const loadsHtml = `
      <h4 class="text-xs font-bold text-slate-700 mb-1">Cargas en servicio</h4>
      <table class="text-xs w-full border-collapse">
        <thead><tr>
          <th class="border border-slate-300 px-2 py-1 bg-sky-100"></th>
          <th class="border border-slate-300 px-2 py-1 bg-sky-100">P (Ton)</th>
          <th class="border border-slate-300 px-2 py-1 bg-sky-100">Mx (Ton-m)</th>
          <th class="border border-slate-300 px-2 py-1 bg-sky-100">My (Ton-m)</th>
        </tr></thead>
        <tbody>
          ${loadRow('CM', d.Pd, d.Mx_d, d.My_d)}
          ${loadRow('CV', d.Pl, d.Mx_l, d.My_l)}
          ${hasSeismic ? loadRow('SXD', d.Psx, d.Mx_sx, d.My_sx) : ''}
          ${hasSeismic ? loadRow('SYD', d.Psy, d.Mx_sy, d.My_sy) : ''}
        </tbody>
      </table>
      <p class="text-[10px] text-slate-500 mt-1 leading-snug">
        <span class="font-semibold">CM</span>: Carga Muerta ·
        <span class="font-semibold">CV</span>: Carga Viva
        ${hasSeismic ? ` · <span class="font-semibold">SXD</span>: Sismo en dirección X · <span class="font-semibold">SYD</span>: Sismo en dirección Y` : ''} ·
        <span class="font-semibold">P</span>: carga axial ·
        <span class="font-semibold">Mx, My</span>: momentos flectores en X e Y
      </p>`;

    return `<div class="border border-slate-300 rounded-lg overflow-hidden mb-6">
      <div class="bg-amber-400 text-slate-900 font-extrabold text-sm px-3 py-1.5">I) DATOS DE DISEÑO</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 p-3">
        <div>${specsHtml}</div>
        <div>${loadsHtml}</div>
      </div>
    </div>`;
  }

  /** Celda "CUMPLE"/"NO CUMPLE" en texto (sin relleno de color), para
   * reemplazar los recuadros de color de la hoja de cálculo de referencia. */
  _estadoCell(pass) {
    return pass
      ? `<span class="text-emerald-700 font-bold">CUMPLE</span>`
      : `<span class="text-red-700 font-bold">NO CUMPLE</span>`;
  }

  /**
   * Boceto en planta del predimensionamiento (zapata Lp×Bp, columna a×b) —
   * SVG propio, con la misma paleta y convención de cotas del visualizador
   * (footingCanvas.js, paleta clara), en vez de reproducir literalmente el
   * dibujo de la hoja de cálculo de referencia. La columna se dibuja
   * centrada si es interior, al ras del borde derecho si es
   * medianera/borde, y al ras de los bordes derecho e inferior si es
   * esquinera — mismo criterio que deriveColumnEccentricity
   * (isolatedFooting.js) y _solveLBByColType.
   */
  _predimSketchSvg(Lp, Bp, a, b, cRound, colType) {
    const vw = 260, vh = 190;
    const top = 22, right = 30;
    const availW = vw - right - 14, availH = vh - top - 14;
    const scale = Math.min(availW / Lp, availH / Bp);
    const w = Lp * scale, h = Bp * scale;
    const x0 = 14, y0 = top;
    const cw = a * scale, ch = b * scale;
    const flushX = colType === 'medianera' || colType === 'esquinera';
    const flushY = colType === 'esquinera';
    const cx0 = flushX ? (x0 + w - cw) : (x0 + (w - cw) / 2);
    const cy0 = flushY ? (y0 + h - ch) : (y0 + (h - ch) / 2);
    const fillFooting = '#e7ebf1', strokeFooting = '#334155';
    const fillCol = '#94a3b8', strokeCol = '#1e293b';
    const dim = '#64748b', text = '#334155';
    const cLabel = `c = ${cRound.toFixed(2)} m`;

    return `<svg viewBox="0 0 ${vw} ${vh}" width="260" height="190" xmlns="http://www.w3.org/2000/svg" style="max-width:100%">
      <rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="${fillFooting}" stroke="${strokeFooting}" stroke-width="1.5"/>
      <rect x="${cx0}" y="${cy0}" width="${cw}" height="${ch}" fill="${fillCol}" stroke="${strokeCol}" stroke-width="1.2"/>
      <line x1="${x0}" y1="${y0 - 10}" x2="${x0 + w}" y2="${y0 - 10}" stroke="${dim}" stroke-width="1"/>
      <line x1="${x0}" y1="${y0 - 14}" x2="${x0}" y2="${y0 - 6}" stroke="${dim}" stroke-width="1"/>
      <line x1="${x0 + w}" y1="${y0 - 14}" x2="${x0 + w}" y2="${y0 - 6}" stroke="${dim}" stroke-width="1"/>
      <text x="${x0 + w / 2}" y="${y0 - 13}" font-size="9" fill="${text}" text-anchor="middle" font-family="Inter, sans-serif">L = ${Lp.toFixed(2)} m</text>
      <line x1="${x0 + w + 10}" y1="${y0}" x2="${x0 + w + 10}" y2="${y0 + h}" stroke="${dim}" stroke-width="1"/>
      <line x1="${x0 + w + 6}" y1="${y0}" x2="${x0 + w + 14}" y2="${y0}" stroke="${dim}" stroke-width="1"/>
      <line x1="${x0 + w + 6}" y1="${y0 + h}" x2="${x0 + w + 14}" y2="${y0 + h}" stroke="${dim}" stroke-width="1"/>
      <text x="0" y="0" font-size="9" fill="${text}" text-anchor="middle" font-family="Inter, sans-serif" transform="translate(${x0 + w + 22} ${y0 + h / 2}) rotate(-90)">B = ${Bp.toFixed(2)} m</text>
      <line x1="${x0}" y1="${cy0 + ch / 2}" x2="${cx0}" y2="${cy0 + ch / 2}" stroke="${dim}" stroke-width="1" stroke-dasharray="2,2"/>
      <text x="${(x0 + cx0) / 2}" y="${cy0 + ch / 2 - 4}" font-size="8.5" fill="${text}" text-anchor="middle" font-family="Inter, sans-serif">${cLabel}</text>
      <line x1="${cx0 + cw / 2}" y1="${y0}" x2="${cx0 + cw / 2}" y2="${cy0}" stroke="${dim}" stroke-width="1" stroke-dasharray="2,2"/>
      <text x="${cx0 + cw / 2 + 4}" y="${(y0 + cy0) / 2 + 3}" font-size="8.5" fill="${text}" font-family="Inter, sans-serif">${cLabel}</text>
    </svg>`;
  }

  /**
   * Sección "II) PREDIMENSIONAMIENTO", al estilo de la hoja de cálculo de
   * referencia (Efrén — "ZAPATA TIPO 1.xlsx"): 1°) área tentativa por
   * cargas de gravedad (A = P(1+fz)/q_adm, mismo método y volado "c" que
   * usa el botón "Predimensionar" — ver predimensionIsolated) y 2°)
   * verificación por gravedad + momento + sismo con el detalle de las 4
   * esquinas (distribución trapezoidal) y, cuando alguna esquina resulta
   * en tracción, la distribución rectangular equivalente — mismos casos y
   * valores ya calculados en geo.seismic_envelope (sección 2.1), solo que
   * aquí se muestra el desglose completo de las 4 esquinas en vez de
   * únicamente la más desfavorable.
   */
  _predimensionamientoIsoladaHtml(d, fnd, mat, geo) {
    const a = d.col_L, b = d.col_B;
    const colType = d.col_type || 'interior';
    const P = (d.Pd || 0) + (d.Pl || 0);
    const fz = d.fz ?? 0.08;
    const qAdmTnm2 = (fnd.q_adm_kgcm2 || 1) * 10;
    const A_req = (P * (1 + fz)) / qAdmTnm2;

    // Fórmula de proporcionamiento L,B según el tipo de columna (mismo
    // criterio que deriveColumnEccentricity y _solveLBByColType): interior
    // → volado "c" simétrico en ambas direcciones; medianera → un solo
    // lado en L (cara al ras del borde), simétrico en B; esquinera → un
    // solo lado en ambas direcciones.
    let cRaw, formulaLB;
    if (colType === 'esquinera') {
      const disc = (a - b) * (a - b) + 4 * A_req;
      cRaw = (-(a + b) + Math.sqrt(disc)) / 2;
      formulaLB = 'L = c + b, B = c + t';
    } else if (colType === 'medianera') {
      const disc = (2 * a + b) * (2 * a + b) - 8 * (a * b - A_req);
      cRaw = (-(2 * a + b) + Math.sqrt(disc)) / 4;
      formulaLB = 'L = c + b, B = 2c + t';
    } else {
      const disc = (a - b) * (a - b) + 4 * A_req;
      cRaw = (-(a + b) + Math.sqrt(disc)) / 4;
      formulaLB = 'L = 2c + b, B = 2c + t';
    }
    const cRound = Math.max(0.05, Math.ceil(cRaw / 0.05) * 0.05);
    const Lp = colType === 'interior' ? 2 * cRound + a : cRound + a;
    const Bp = colType === 'esquinera' ? cRound + b : 2 * cRound + b;

    const step1Html = `
      <h4 class="text-xs font-bold text-slate-700 mb-1">1°) Verificamos por cargas de gravedad</h4>
      <p class="text-[11px] text-slate-500 mb-2">Área tentativa: A = P(1+fz) / q_adm, con fz = ${fz.toFixed(2)} como aproximación del peso propio. Volado "c" repartido según el tipo de columna (${formulaLB}).</p>
      <table class="text-xs w-full mb-2">
        ${this._specRow('Carga en servicio (P = CM+CV)', `${this._trimNum(P)} Ton`)}
        ${this._specRow('Área tentativa (A)', `${A_req.toFixed(2)} m²`)}
        ${this._specRow('Volado calculado (c)', `${cRaw.toFixed(2)} m`)}
        ${this._specRow('Volado redondeado (c)', `${cRound.toFixed(2)} m`)}
      </table>
      <div class="flex justify-center mb-2">${this._predimSketchSvg(Lp, Bp, a, b, cRound, colType)}</div>
      <p class="text-xs font-semibold text-slate-800 text-center">Dimensiones predimensionadas: L = ${Lp.toFixed(2)} m &nbsp; B = ${Bp.toFixed(2)} m</p>`;

    let step2Html = '';
    if (geo.hasSeismic && geo.seismic_envelope) {
      const factor = d.seismic_bearing_factor || 1.25;
      const rows = geo.seismic_envelope.rows;
      const Pgrav = P;
      const MxGrav = (d.Mx_d || 0) + (d.Mx_l || 0);
      const MyGrav = (d.My_d || 0) + (d.My_l || 0);
      const seisOf = (label) => {
        if (label === 'CM+CV') return [0, 0, 0];
        if (label.includes('SXD')) return [d.Psx || 0, d.Mx_sx || 0, d.My_sx || 0];
        return [d.Psy || 0, d.Mx_sy || 0, d.My_sy || 0];
      };

      const loadsRows = rows.map((r) => {
        const [Ps, Mxs, Mys] = seisOf(r.label);
        return `<tr class="odd:bg-sky-50">
          <td class="border border-slate-300 px-2 py-1 font-bold bg-sky-100">${r.label}</td>
          <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._trimNum(Pgrav)}</td>
          <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._trimNum(MxGrav)}</td>
          <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._trimNum(MyGrav)}</td>
          <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._trimNum(Ps)}</td>
          <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._trimNum(Mxs)}</td>
          <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._trimNum(Mys)}</td>
        </tr>`;
      }).join('');

      const pressureRows = rows.map((r) => {
        const [s1, s2, s3, s4] = [r.corners.c, r.corners.d, r.corners.b, r.corners.e].map(kpaToKgcm2);
        const sx = r.rect ? `${kpaToKgcm2(r.rect.qx).toFixed(2)}` : '—';
        const sy = r.rect ? `${kpaToKgcm2(r.rect.qy).toFixed(2)}` : '—';
        return `<tr class="odd:bg-sky-50">
          <td class="border border-slate-300 px-2 py-1 font-bold bg-sky-100">${r.label}</td>
          <td class="border border-slate-300 px-2 py-1 text-right font-mono">${s1.toFixed(2)}</td>
          <td class="border border-slate-300 px-2 py-1 text-right font-mono">${s2.toFixed(2)}</td>
          <td class="border border-slate-300 px-2 py-1 text-right font-mono">${s3.toFixed(2)}</td>
          <td class="border border-slate-300 px-2 py-1 text-right font-mono">${s4.toFixed(2)}</td>
          <td class="border border-slate-300 px-2 py-1 text-right font-mono">${sx}</td>
          <td class="border border-slate-300 px-2 py-1 text-right font-mono">${sy}</td>
          <td class="border border-slate-300 px-2 py-1 text-center">${this._estadoCell(r.pass)}</td>
        </tr>`;
      }).join('');

      step2Html = `
        <h4 class="text-xs font-bold text-slate-700 mt-4 mb-1">2°) Verificamos por cargas de gravedad más momento y sismo</h4>
        <p class="text-[11px] text-slate-500 mb-2">σadm = ${this._p(fnd.q_adm_kgcm2)} &nbsp; σadm(sismo) = ${this._p(fnd.q_adm_kgcm2 * factor)} (factor × ${factor.toFixed(2)}). σ = P(1+fz)/(B·L) ± 6Mx/(B·L²) ± 6My/(L·B²), evaluado en las 4 esquinas de la zapata; si alguna resulta en tracción, se usa la distribución rectangular equivalente σx, σy.</p>
        <div class="overflow-x-auto">
        <table class="text-xs w-full border-collapse mb-2">
          <thead><tr>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100" rowspan="2"></th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100" colspan="3">Cargas de gravedad</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100" colspan="3">Cargas de sismo</th>
          </tr><tr>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">P (Ton)</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">Mx (Ton-m)</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">My (Ton-m)</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">P (Ton)</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">Mx (Ton-m)</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">My (Ton-m)</th>
          </tr></thead>
          <tbody>${loadsRows}</tbody>
        </table>
        </div>
        <div class="overflow-x-auto">
        <table class="text-xs w-full border-collapse">
          <thead><tr>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100" rowspan="2"></th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100" colspan="4">Distribución trapezoidal (kg/cm²)</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100" colspan="2">Distribución rectangular (kg/cm²)</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100" rowspan="2">Estado</th>
          </tr><tr>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">σ1</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">σ2</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">σ3</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">σ4</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">σx</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">σy</th>
          </tr></thead>
          <tbody>${pressureRows}</tbody>
        </table>
        </div>
        <p class="text-[11px] text-slate-500 mt-1">Con la geometría vigente (L = ${d.L.toFixed(2)} m, B = ${d.B.toFixed(2)} m), la envolvente sísmica de servicio: ${this._estadoCell(geo.seismic_envelope.pass)}.</p>`;
    }

    const geoRow = (label, val, limit, pass) => `<tr class="odd:bg-sky-50">
      <td class="border border-slate-300 px-2 py-1 font-semibold">${label}</td>
      <td class="border border-slate-300 px-2 py-1 text-right font-mono">${val}</td>
      <td class="border border-slate-300 px-2 py-1 text-right">${limit}</td>
      <td class="border border-slate-300 px-2 py-1 text-center">${this._estadoCell(pass)}</td>
    </tr>`;
    let step3Html = `
      <h4 class="text-xs font-bold text-slate-700 mt-4 mb-1">3°) Verificación geotécnica (cargas de servicio)</h4>
      <p class="text-[11px] text-slate-500 mb-2">Peso propio estimado con el factor fz = ${geo.fz.toFixed(2)} (N = P·(1+fz)): ${geo.selfWeight_equiv_tn.toFixed(2)} tn. Carga total transmitida al suelo N = ${geo.N_tn.toFixed(2)} tn.</p>
      <table class="text-xs w-full border-collapse mb-2">
        <thead><tr>
          <th class="border border-slate-300 px-2 py-1 bg-sky-100 text-left">Verificación</th>
          <th class="border border-slate-300 px-2 py-1 bg-sky-100">Resultado</th>
          <th class="border border-slate-300 px-2 py-1 bg-sky-100">Límite</th>
          <th class="border border-slate-300 px-2 py-1 bg-sky-100">Estado</th>
        </tr></thead>
        <tbody>
          ${geoRow('Excentricidad ex = Mx/N', `${(geo.ex * 100).toFixed(2)} cm`, `≤ L/6 = ${(geo.ex_max * 100).toFixed(2)} cm`, Math.abs(geo.ex) <= geo.ex_max)}
          ${geoRow('Excentricidad ey = My/N', `${(geo.ey * 100).toFixed(2)} cm`, `≤ B/6 = ${(geo.ey_max * 100).toFixed(2)} cm`, Math.abs(geo.ey) <= geo.ey_max)}
          ${geoRow('Presión máxima de contacto q_max (sin sismo)', this._p(geo.q_max_kgcm2), `≤ ${geo.hasSeismic ? `${(d.seismic_bearing_factor ?? 1.25).toFixed(2)}·q_adm` : 'q_adm'} = ${this._p(geo.q_adm_eff_kgcm2)}`, geo.q_max_kgcm2 <= geo.q_adm_eff_kgcm2)}
        </tbody>
      </table>`;
    if (geo.effective_note) step3Html += `<p class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-2">⚠️ ${geo.effective_note}</p>`;

    if (geo.hasSeismic) {
      step3Html += `
        <p class="text-[11px] text-slate-500 mb-2"><b>Envolvente sísmica de servicio:</b> σ = P(1+fz)/(B·L) ± 6Mx/(B·L²) ± 6My/(L·B²), evaluado en las 4 esquinas de la zapata (o su rectángulo equivalente si alguna esquina resulta en tracción) para CM+CV, CM+CV±SXD y CM+CV±SYD. Al haber datos de sismo en el proyecto, las 5 combinaciones se limitan a ${(d.seismic_bearing_factor ?? 1.25).toFixed(2)}·q_adm.</p>
        <table class="text-xs w-full border-collapse mb-2">
          <thead><tr>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100 text-left">Combinación</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">q (esquina más desfavorable)</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">Límite admisible</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">Estado</th>
          </tr></thead>
          <tbody>
            ${geo.seismic_envelope.rows.map((r) => geoRow(r.label, `${this._p(r.q_governing_kgcm2)}${r.minC < 0 ? ' (rectangular)' : ''}`, `≤ ${this._p(r.limit_kgcm2)}`, r.pass)).join('')}
          </tbody>
        </table>
        <p class="text-[11px] text-slate-500">Combinación gobernante: <b>${geo.seismic_envelope.governingRow.label}</b>, q = ${this._p(geo.seismic_envelope.governing_q_kgcm2)}.</p>`;
    }

    return `<div class="border border-slate-300 rounded-lg overflow-hidden mb-6">
      <div class="bg-amber-400 text-slate-900 font-extrabold text-sm px-3 py-1.5">II) PREDIMENSIONAMIENTO</div>
      <div class="p-3">${step1Html}${step2Html}${step3Html}</div>
    </div>`;
  }

  /** Boceto esquemático (no a escala) del perímetro crítico de
   * punzonamiento a d/2 de las caras de la columna. */
  _punchingSketchSvg() {
    const strokeFooting = '#334155', fillCol = '#94a3b8', strokeCol = '#1e293b', dim = '#64748b', text = '#334155';
    return `<svg viewBox="0 0 220 170" width="220" height="170" xmlns="http://www.w3.org/2000/svg" style="max-width:100%">
      <rect x="70" y="45" width="80" height="65" fill="none" stroke="${dim}" stroke-width="1.2" stroke-dasharray="4,3"/>
      <rect x="85" y="60" width="50" height="35" fill="${fillCol}" stroke="${strokeCol}" stroke-width="1.5"/>
      <text x="110" y="53" font-size="9" fill="${text}" text-anchor="middle" font-family="Inter, sans-serif">Sección crítica</text>
      <line x1="85" y1="60" x2="70" y2="45" stroke="${dim}" stroke-width="1"/>
      <text x="60" y="42" font-size="8.5" fill="${text}" text-anchor="middle" font-family="Inter, sans-serif">d/2</text>
      <text x="110" y="80" font-size="9" fill="${strokeCol}" text-anchor="middle" font-family="Inter, sans-serif">Columna</text>
      <line x1="20" y1="45" x2="20" y2="110" stroke="${strokeFooting}" stroke-width="1"/>
      <line x1="16" y1="45" x2="24" y2="45" stroke="${strokeFooting}" stroke-width="1"/>
      <line x1="16" y1="110" x2="24" y2="110" stroke="${strokeFooting}" stroke-width="1"/>
      <text x="12" y="80" font-size="9" fill="${text}" text-anchor="middle" font-family="Inter, sans-serif" transform="rotate(-90 12 80)">B</text>
      <line x1="70" y1="130" x2="150" y2="130" stroke="${strokeFooting}" stroke-width="1"/>
      <line x1="70" y1="126" x2="70" y2="134" stroke="${strokeFooting}" stroke-width="1"/>
      <line x1="150" y1="126" x2="150" y2="134" stroke="${strokeFooting}" stroke-width="1"/>
      <text x="110" y="145" font-size="9" fill="${text}" text-anchor="middle" font-family="Inter, sans-serif">L</text>
    </svg>`;
  }

  /** Boceto esquemático (no a escala) de la sección crítica de corte en
   * una dirección, a "d" de la cara de la columna. */
  _shearSketchSvg() {
    const strokeFooting = '#334155', fillFooting = '#e7ebf1', fillCol = '#94a3b8', strokeCol = '#1e293b', dim = '#64748b', text = '#334155';
    return `<svg viewBox="0 0 220 140" width="220" height="140" xmlns="http://www.w3.org/2000/svg" style="max-width:100%">
      <rect x="20" y="70" width="180" height="30" fill="${fillFooting}" stroke="${strokeFooting}" stroke-width="1.5"/>
      <rect x="90" y="30" width="40" height="40" fill="${fillCol}" stroke="${strokeCol}" stroke-width="1.5"/>
      <text x="110" y="24" font-size="9" fill="${strokeCol}" text-anchor="middle" font-family="Inter, sans-serif">Columna</text>
      <line x1="140" y1="30" x2="140" y2="100" stroke="${dim}" stroke-width="1" stroke-dasharray="4,3"/>
      <text x="150" y="20" font-size="9" fill="${text}" text-anchor="middle" font-family="Inter, sans-serif">Sección crítica</text>
      <line x1="130" y1="18" x2="140" y2="28" stroke="${dim}" stroke-width="1"/>
      <line x1="130" y1="60" x2="140" y2="60" stroke="${dim}" stroke-width="1"/>
      <line x1="128" y1="56" x2="128" y2="64" stroke="${dim}" stroke-width="1"/>
      <line x1="142" y1="56" x2="142" y2="64" stroke="${dim}" stroke-width="1"/>
      <text x="135" y="52" font-size="8.5" fill="${text}" text-anchor="middle" font-family="Inter, sans-serif">d</text>
      <line x1="140" y1="112" x2="200" y2="112" stroke="${strokeFooting}" stroke-width="1"/>
      <line x1="140" y1="108" x2="140" y2="116" stroke="${strokeFooting}" stroke-width="1"/>
      <line x1="200" y1="108" x2="200" y2="116" stroke="${strokeFooting}" stroke-width="1"/>
      <text x="170" y="126" font-size="9" fill="${text}" text-anchor="middle" font-family="Inter, sans-serif">Volado</text>
    </svg>`;
  }

  /**
   * Caja "III) DISEÑO" de la zapata aislada, al estilo de la hoja de
   * cálculo de referencia (Efrén): 1) combinaciones de diseño (ya
   * calculadas en str.envelope), 2) punzonamiento, 3) corte en una
   * dirección y 4) flexión — con las direcciones L y B mostradas juntas
   * (nuestro motor, a diferencia de la hoja de referencia, sí distingue
   * ambas direcciones para zapatas no cuadradas) y terminando con el
   * acero finalmente elegido (longitudinal/banda central/franjas
   * exteriores), igual que la hoja de referencia.
   */
  /** Tarjeta compacta de resultado (etiqueta + valor grande + estado),
   * para resaltar los números clave de cada verificación como en un
   * informe — en vez de perderlos dentro de una tabla larga. `pass` en
   * `null` la deja neutra (sin verificación asociada, p.ej. un dato
   * informativo). */
  _statCard(label, value, sub, pass) {
    const tone = pass === true ? 'border-emerald-300 bg-emerald-50' : pass === false ? 'border-rose-300 bg-rose-50' : 'border-slate-300 bg-slate-50';
    const valColor = pass === true ? 'text-emerald-700' : pass === false ? 'text-rose-700' : 'text-slate-800';
    return `<div class="border ${tone} rounded-lg px-3 py-2 text-center">
      <div class="text-[9.5px] font-semibold text-slate-500 uppercase tracking-wide">${label}</div>
      <div class="text-sm font-extrabold font-mono ${valColor} mt-0.5">${value}</div>
      ${sub ? `<div class="text-[9.5px] text-slate-500 mt-0.5">${sub}</div>` : ''}
    </div>`;
  }

  _disenoIsoladaHtml(d, str) {
    const step1Html = `
      <h4 class="text-xs font-bold text-slate-700 mb-1">1) Combinaciones de diseño</h4>
      <p class="text-[11px] text-slate-500 mb-2">Se factoran las cargas con las combinaciones clásicas E.060/ACI 318 — 1.4CM+1.7CV${str.hasSeismic ? ', 1.25(CM+CV)±SXD/SYD y 0.9CM±SXD/SYD (9 en total)' : ''} — y se evalúa la presión de contacto en las 4 esquinas de la zapata para cada una (con el peso propio aproximado por el factor fz). La más desfavorable de todas se toma como la presión de diseño "σu", aplicada de forma uniforme sobre toda la zapata para punzonamiento, corte y flexión.</p>
      <table class="text-xs w-full border-collapse mb-2">
        <thead><tr>
          <th class="border border-slate-300 px-2 py-1 bg-sky-100 text-left">Combinación</th>
          <th class="border border-slate-300 px-2 py-1 bg-sky-100">σ (esquina más desfavorable)</th>
        </tr></thead>
        <tbody>
          ${str.envelope.rows.map((r) => `<tr class="odd:bg-sky-50 ${r.label === str.envelope.governingRow.label ? 'font-bold' : ''}">
            <td class="border border-slate-300 px-2 py-1 font-bold bg-sky-100">${r.label}${r.label === str.envelope.governingRow.label ? ' ⟵ gobierna' : ''}</td>
            <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._p(r.q_governing_kgcm2)}${r.minC < 0 ? ' (rectangular)' : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="grid grid-cols-2 gap-2">
        ${this._statCard('Combinación gobernante', str.envelope.governingRow.label, null, null)}
        ${this._statCard('σu — presión de diseño', this._p(str.envelope.su_kgcm2, 3), 'uniforme sobre toda la zapata', null)}
      </div>`;

    const pn = str.punching;
    const step2Html = `
      <h4 class="text-xs font-bold text-slate-700 mt-4 mb-1">2) Diseño por punzonamiento (corte en dos direcciones)</h4>
      <p class="text-[11px] text-slate-500 mb-2">Verifica que el concreto resista el corte que la columna "punzona" a través del peralte de la zapata, en un perímetro crítico ubicado a d/2 de sus caras. La resistencia φVc es el menor de tres expresiones (E.060 / ACI 318 22.6.5), según la relación de lados de la columna (βc) y su ubicación (interior/borde/esquina, factor αs).</p>
      <div class="flex flex-col md:flex-row gap-4 items-start">
        <div class="w-full md:flex-1">
          <div class="grid grid-cols-2 gap-2 mb-2">
            ${this._statCard('Vu (cortante actuante)', `${knToKg(pn.Vu).toFixed(0)} kg`, null, null)}
            ${this._statCard('φVc (resistencia)', `${knToKg(pn.phiVc).toFixed(0)} kg`, null, null)}
          </div>
          <table class="text-xs w-full">
            ${this._specRow('Peralte efectivo (d)', `${pn.d_avg.toFixed(2)} m`)}
            ${this._specRow('Área dentro del perímetro (Ao)', `${pn.areaWithinPerimeter.toFixed(2)} m²`)}
            ${this._specRow('Perímetro crítico (bo)', `${pn.bo.toFixed(2)} m`)}
            ${this._specRow('Relación de lados de columna (βc)', pn.betaC.toFixed(2))}
            ${this._specRow('Tipo de columna (αs)', `${d.col_type} (αs = ${{ interior: 40, medianera: 30, esquinera: 20 }[d.col_type] ?? 40})`)}
            ${this._specRow('Vc1 = 0.53(1+2/βc)√f\'c·bo·d', `${knToKg(pn.Vc1).toFixed(0)} kg`)}
            ${this._specRow('Vc2 = 0.27(αs·d/bo+2)√f\'c·bo·d', `${knToKg(pn.Vc2).toFixed(0)} kg`)}
            ${this._specRow('Vc3 = 1.06√f\'c·bo·d', `${knToKg(pn.Vc3).toFixed(0)} kg`)}
            ${this._specRow('Vc = mín(Vc1,Vc2,Vc3)', `${knToKg(pn.Vc).toFixed(0)} kg`)}
          </table>
        </div>
        <div class="flex justify-center w-full md:w-auto">${this._punchingSketchSvg()}</div>
      </div>
      <p class="text-xs font-semibold mt-2">Verificación Vu ≤ φVc: ${this._estadoCell(pn.pass)}</p>`;

    const shearDir = (label, res) => `
      <h5 class="text-[11px] font-bold text-slate-600 mt-3 mb-1">Dirección ${label} — voladizo ${res.strip.side}, Lc = ${res.strip.Lc.toFixed(2)} m</h5>
      <div class="grid grid-cols-2 gap-2 mb-1">
        ${this._statCard('Vu', `${knToKg(res.shear.V).toFixed(0)} kg`, null, null)}
        ${this._statCard('φVc', `${knToKg(res.phiVc).toFixed(0)} kg`, null, null)}
      </div>
      <p class="text-xs font-semibold">Verificación Vu ≤ φVc: ${this._estadoCell(res.pass_shear)}</p>`;
    const step3Html = `
      <h4 class="text-xs font-bold text-slate-700 mt-4 mb-1">3) Diseño por cortante (una dirección)</h4>
      <p class="text-[11px] text-slate-500 mb-2">Verifica el corte tipo "viga ancha" en la sección crítica, ubicada a una distancia "d" de la cara de la columna, en cada dirección de la franja en voladizo (E.060 / ACI 318 22.5).</p>
      <div class="flex flex-col md:flex-row gap-4 items-start">
        <div class="w-full md:flex-1">${shearDir('L', str.L_dir)}${shearDir('B', str.B_dir)}</div>
        <div class="flex justify-center w-full md:w-auto">${this._shearSketchSvg()}</div>
      </div>`;

    const flexDir = (label, res) => `
      <h5 class="text-[11px] font-bold text-slate-600 mt-2 mb-1">Dirección ${label}</h5>
      <div class="grid grid-cols-2 gap-2 mb-1">
        ${this._statCard('Mu', `${kNmToKgm(res.strip.M).toFixed(0)} kg·m`, 'en la cara de la columna', null)}
        ${this._statCard('As requerido', `${res.flex.As_design.toFixed(2)} cm²`, `${res.As_per_m.toFixed(2)} cm²/m`, null)}
      </div>
      <table class="text-xs w-full">
        ${this._specRow('Brazo de palanca (a)', `${res.flex.a_cm.toFixed(2)} cm`)}
        ${this._specRow('As calculado', `${res.flex.As_calc.toFixed(2)} cm²`)}
        ${this._specRow('As mínimo (losa, 0.0018·b·h)', `${res.flex.As_min.toFixed(2)} cm²`)}
      </table>`;
    const longDir = str.isLLong ? 'L' : 'B', longRes = str.isLLong ? str.L_dir : str.B_dir;
    const step4Html = `
      <h4 class="text-xs font-bold text-slate-700 mt-4 mb-1">4) Diseño por flexión</h4>
      <p class="text-[11px] text-slate-500 mb-2">El momento último Mu = σu·volado²/2 se toma en la cara de la columna, en cada dirección; el acero se calcula con el bloque de Whitney, tomando el mayor entre el cálculo y el acero mínimo de losa por retracción y temperatura (0.0018·b·h). El lado corto se reparte en banda central + franjas exteriores (ACI 318 15.4.4); el lado largo va uniforme.</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <div>${flexDir('L', str.L_dir)}</div>
        <div>${flexDir('B', str.B_dir)}</div>
      </div>
      <h5 class="text-xs font-bold text-slate-700 mt-3 mb-1.5">🔩 Acero a colocar</h5>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        ${this._statCard(`Dirección ${longDir} (uniforme)`, `${str.dbMain.name}`, `@ ${longRes.spacing} cm — ${(str.isLLong ? str.L_dir : str.B_dir).As_per_m.toFixed(2)} cm²/m`, true)}
        ${this._statCard('Banda central (lado corto)', `${str.dbMain.name}`, `@ ${str.banding.sp_band} cm — ${str.banding.As_band_per_m.toFixed(2)} cm²/m`, true)}
        ${this._statCard('Franjas exteriores (lado corto)', `${str.dbMain.name}`, str.banding.sp_outer ? `@ ${str.banding.sp_outer} cm — ${str.banding.As_outer_per_m.toFixed(2)} cm²/m` : `@ ${str.banding.sp_band} cm (continúa igual)`, true)}
      </div>`;

    return `<div class="border border-slate-300 rounded-lg overflow-hidden mb-6">
      <div class="bg-amber-400 text-slate-900 font-extrabold text-sm px-3 py-1.5">III) DISEÑO</div>
      <div class="p-3">${step1Html}${step2Html}${step3Html}${step4Html}</div>
    </div>`;
  }

  _reportIsolated() {
    const d = this.data.isolated, fnd = this.data.foundation, mat = this.data.materials;
    const geo = this.bearingResults, str = this.structResults;
    let html = `<h1 class="text-xl font-extrabold text-slate-900 mb-1">MEMORIA DE CÁLCULO — ZAPATA AISLADA</h1>
      <p class="text-xs text-slate-500 mb-4">Norma E.060 (Concreto Armado) / E.050 (Suelos y Cimentaciones) — RNE, Perú</p>`;
    html += this._cajetinBlockHtml();
    html += this._visualizerImagesHtml();

    html += this._datosDisenoIsoladaHtml(d, fnd, mat, geo.hasSeismic);
    html += this._predimensionamientoIsoladaHtml(d, fnd, mat, geo);
    html += this._disenoIsoladaHtml(d, str);

    html += this._sectionTitle('IV) Cuadro de Habilitación de Acero');
    html += this._rebarTableHtml();

    return html;
  }

  _reportCombined() {
    const d = this.data.combined, fnd = this.data.foundation, mat = this.data.materials;
    const geo = this.bearingResults, str = this.structResults;
    let html = `<h1 class="text-xl font-extrabold text-slate-900 mb-1">MEMORIA DE CÁLCULO — ZAPATA COMBINADA</h1>
      <p class="text-xs text-slate-500 mb-4">Norma E.060 (Concreto Armado) / E.050 (Suelos y Cimentaciones) — RNE, Perú</p>`;
    html += this._cajetinBlockHtml();
    html += this._visualizerImagesHtml();

    html += this._sectionTitle('1. Datos de Entrada');
    html += this._table(['Parámetro', 'Valor'], [
      ['Dimensiones (L × B)', `${d.L.toFixed(2)} × ${d.B.toFixed(2)} m`],
      ['Peralte total (h)', `${d.h.toFixed(2)} m`],
      ['Posición Columna 1 (a1) / Columna 2 (a1+s)', `${d.a1.toFixed(2)} m / ${(d.a1 + d.s).toFixed(2)} m`],
      ['Columna 1 (col1_L × col1_B)', `${d.col1_L.toFixed(2)} × ${d.col1_B.toFixed(2)} m`],
      ['Columna 2 (col2_L × col2_B)', `${d.col2_L.toFixed(2)} × ${d.col2_B.toFixed(2)} m`],
      ['Carga de servicio Columna 1 (D/L)', `${d.P1d.toFixed(1)} / ${d.P1l.toFixed(1)} tn`],
      ['Carga de servicio Columna 2 (D/L)', `${d.P2d.toFixed(1)} / ${d.P2l.toFixed(1)} tn`],
      ['Capacidad portante admisible (q_adm)', this._p(fnd.q_adm_kgcm2)],
      [`f'c / fy`, `${mat.fc_kgcm2.toFixed(0)} / ${mat.fy_kgcm2.toFixed(0)} kg/cm²`],
    ]);

    html += this._sectionTitle('2. Verificación Geotécnica (Cargas de Servicio)');
    html += `<p class="text-xs text-slate-600 mb-2">Resultante de columnas R = ${geo.R_tn.toFixed(2)} tn, ubicada a x̄ = ${geo.x_R.toFixed(3)} m del borde izquierdo. Con el peso propio, la resultante total N = ${geo.N_tn.toFixed(2)} tn actúa a x_N = ${geo.x_N.toFixed(3)} m (centro geométrico de la zapata en L/2 = ${(d.L / 2).toFixed(3)} m).</p>`;
    html += this._table(['Verificación', 'Resultado', 'Límite', 'Estado'], [
      ['Excentricidad e = x_N − L/2', `${(geo.e * 100).toFixed(2)} cm`, `≤ L/6 = ${(geo.e_max * 100).toFixed(2)} cm`, this._badgeHtml(geo.within_kern)],
      ['Presión máxima de contacto q_max', this._p(geo.q_max_kgcm2), `≤ q_adm = ${this._p(geo.q_adm_kgcm2)}`, this._badgeHtml(geo.pass_bearing)],
    ]);
    if (geo.effective_note) html += `<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">⚠️ ${geo.effective_note}</p>`;

    html += this._sectionTitle('3. Análisis Longitudinal (Viga Invertida) — Cargas Factoradas');
    const LF_D = this.data.safety_req.LF_D ?? 1.4, LF_L = this.data.safety_req.LF_L ?? 1.7;
    html += `<p class="text-xs text-slate-600 mb-2">Pu1 = ${knToKg(str.Pu1).toFixed(0)} kg, Pu2 = ${knToKg(str.Pu2).toFixed(0)} kg (U = ${LF_D}D + ${LF_L}L). Momento máximo positivo (voladizos, tracción inferior) M+ = ${kNmToKgm(str.Mu_pos).toFixed(0)} kg·m en x = ${str.x_pos.toFixed(2)} m. Momento máximo negativo (entre columnas, tracción superior) M− = ${kNmToKgm(str.Mu_neg).toFixed(0)} kg·m en x = ${str.x_neg.toFixed(2)} m.</p>`;

    html += this._sectionTitle('4. Acero Longitudinal Principal');
    html += this._table(['', 'Inferior (M+)', 'Superior (M−)'], [
      ['Momento de diseño', `${kNmToKgm(str.Mu_pos).toFixed(0)} kg·m`, `${kNmToKgm(str.Mu_neg).toFixed(0)} kg·m`],
      ['Cuantía de diseño ρ', str.bottom.rho_design.toFixed(4), str.top.rho_design.toFixed(4)],
      ['As requerido', `${str.bottom.As_design.toFixed(2)} cm² (${str.bottom.As_per_m.toFixed(2)} cm²/m)`, `${str.top.As_design.toFixed(2)} cm² (${str.top.As_per_m.toFixed(2)} cm²/m)`],
      ['Armado colocado', `${str.dbMain.name} @ ${str.bottom.spacing} cm`, `${str.dbMain.name} @ ${str.top.spacing} cm`],
    ]);

    html += this._sectionTitle('5. Corte en Una Dirección');
    html += this._table(['Sección crítica (a "d" de la cara)', 'Vu', 'φVc', 'Estado'], str.shearChecks.map(c => [c.label, `${knToKg(c.Vu).toFixed(0)} kg`, `${knToKg(str.phiVc_oneWay).toFixed(0)} kg`, this._badgeHtml(c.pass)]));

    html += this._sectionTitle('6. Punzonamiento por Columna');
    if (str.perimetersOverlap) html += `<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">⚠️ Los perímetros críticos de punzonamiento de ambas columnas se traslapan (separación libre ${str.halfGapAvailable.toFixed(2)} m &lt; d = ${str.d_main.toFixed(2)} m) — se recomienda un análisis conjunto del perímetro combinado.</p>`;
    [['Columna 1', str.punch1], ['Columna 2', str.punch2]].forEach(([label, p]) => {
      html += this._table(['', label], [
        ['bo (perímetro crítico)', `${(p.bo * 100).toFixed(1)} cm`],
        ['Vu', `${knToKg(p.Vu).toFixed(0)} kg`],
        ['φVc', `${knToKg(p.phiVc).toFixed(0)} kg`],
        ['Estado', this._badgeHtml(p.pass)],
      ]);
    });

    html += this._sectionTitle('7. Acero Transversal Bajo Cada Columna');
    html += this._table(['', 'Columna 1', 'Columna 2'], [
      ['Voladizo transversal', `${str.trans1.voladizo.toFixed(3)} m`, `${str.trans2.voladizo.toFixed(3)} m`],
      ['Presión local q_u', `${(str.trans1.q_local).toFixed(1)} kPa`, `${(str.trans2.q_local).toFixed(1)} kPa`],
      ['Momento Mu', `${kNmToKgm(str.trans1.Mu).toFixed(0)} kg·m/m`, `${kNmToKgm(str.trans2.Mu).toFixed(0)} kg·m/m`],
      ['As requerido', `${str.trans1.flex.As_design.toFixed(2)} cm²/m`, `${str.trans2.flex.As_design.toFixed(2)} cm²/m`],
      ['Armado colocado', `${str.dbTrans.name} @ ${str.trans1.spacing} cm`, `${str.dbTrans.name} @ ${str.trans2.spacing} cm`],
    ]);

    html += this._sectionTitle('8. Longitud de Desarrollo en Tracción (E.060 25.4.2)');
    html += this._table(['', 'Valor'], [
      ['Longitud de desarrollo requerida (ld)', `${str.development.ld_req_cm.toFixed(1)} cm`],
      ['Longitud disponible, voladizo izquierdo', `${str.development.ld_avail_left_cm.toFixed(1)} cm — ${this._badgeHtml(str.development.pass_ld_left)}`],
      ['Longitud disponible, voladizo derecho', `${str.development.ld_avail_right_cm.toFixed(1)} cm — ${this._badgeHtml(str.development.pass_ld_right)}`],
    ]);

    html += this._sectionTitle('9. Aplastamiento Columna-Zapata (E.060 10.17 / ACI 318 22.8)');
    [['Columna 1', str.aplastamiento1, str.Pu1], ['Columna 2', str.aplastamiento2, str.Pu2]].forEach(([label, ap, Pu_i]) => {
      html += `<h3 class="text-sm font-bold text-slate-800 mt-3 mb-1.5">${label}</h3>`;
      html += this._table(['', 'Valor'], [
        ['Relación √(A2/A1) (limitada a 2.0)', ap.ratio.toFixed(2)],
        ['φPn = φ·0.85·f\'c·A1·√(A2/A1)', `${ap.phiPn.toFixed(0)} kg`],
        ['Carga última en la columna (Pu)', `${knToKg(Pu_i).toFixed(0)} kg`],
        ['Verificación φPn ≥ Pu', this._badgeHtml(ap.pass)],
      ]);
      if (!ap.pass) {
        html += `<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">⚠️ Requiere acero de arranque (dowels) adicional con As ≥ ${ap.As_dowel_cm2.toFixed(2)} cm².</p>`;
      }
    });

    html += this._sectionTitle('10. Cuadro de Habilitación de Acero');
    html += this._rebarTableHtml();

    return html;
  }

  /** Secciones de punzonamiento, corte+flexión (L y B), distribución en
   * franjas y longitud de desarrollo para UNA losa — mismo contenido que
   * las secciones 3–6 de _reportIsolated, parametrizado para reutilizarse
   * con la Zapata 1 y la Zapata 2 de una zapata conectada. `n` es el
   * número de sección inicial (p.ej. 3 → genera 3.1..3.5). */
  _slabReportHtml(slab, L, B, n) {
    let html = `<h3 class="text-sm font-bold text-slate-800 mt-3 mb-1.5">${n}.1 Punzonamiento (corte en 2 direcciones)</h3>`;
    html += `<p class="text-xs text-slate-600 mb-2">Perímetro crítico a d/2 de las caras de la columna (d promedio = ${(slab.punching.d_avg * 100).toFixed(1)} cm), bo = ${(slab.punching.bo * 100).toFixed(1)} cm, βc = ${slab.punching.betaC.toFixed(2)}.</p>`;
    html += this._table(['', 'Valor'], [
      ['Carga última uniforme (Pu)', `${knToKg(slab.Pu).toFixed(0)} kg`],
      ['Cortante actuante Vu', `${knToKg(slab.punching.Vu).toFixed(0)} kg`],
      ['φVc (mínimo de las 3 fórmulas, φ=0.85)', `${knToKg(slab.punching.phiVc).toFixed(0)} kg`],
      ['Verificación Vu ≤ φVc', this._badgeHtml(slab.punching.pass)],
    ]);

    [['L', slab.L_dir, L, '2'], ['B', slab.B_dir, B, '3']].forEach(([axis, res, dim, sub]) => {
      html += `<h3 class="text-sm font-bold text-slate-800 mt-3 mb-1.5">${n}.${sub} Franja dirección ${axis} (voladizo lado ${res.strip.side}, Lc = ${res.strip.Lc.toFixed(3)} m)</h3>`;
      html += this._table(['', 'Valor'], [
        ['Momento último Mu (en la cara de la columna)', `${kNmToKgm(res.strip.M).toFixed(0)} kg·m`],
        ['Cortante último Vu (a "d" de la cara)', `${knToKg(res.shear.V).toFixed(0)} kg`],
        ['φVc (corte en una dirección)', `${knToKg(res.phiVc).toFixed(0)} kg`],
        ['Verificación por corte Vu ≤ φVc', this._badgeHtml(res.pass_shear)],
        ['Cuantía de diseño ρ', res.flex.rho_design.toFixed(4)],
        ['Acero requerido (As)', `${res.flex.As_design.toFixed(2)} cm² (${res.As_per_m.toFixed(2)} cm²/m)`],
      ]);
    });

    html += `<h3 class="text-sm font-bold text-slate-800 mt-3 mb-1.5">${n}.4 Distribución del Acero — Franja del Lado Corto (ACI 318 15.4.4)</h3>`;
    html += `<p class="text-xs text-slate-600 mb-2">β = ${slab.beta.toFixed(2)}. Fracción en banda central = 2/(β+1) = ${slab.bandFactor.toFixed(3)}. Ancho de banda = ${slab.banding.bandWidth.toFixed(2)} m.</p>`;
    html += this._table(['Zona', 'As requerido', 'Armado colocado'], [
      ['Banda central', `${slab.banding.As_band_per_m.toFixed(2)} cm²/m`, `${slab.dbMain.name} @ ${slab.banding.sp_band} cm`],
      ['Franjas exteriores (c/u)', slab.banding.sp_outer ? `${slab.banding.As_outer_per_m.toFixed(2)} cm²/m` : 'Acero mínimo', slab.banding.sp_outer ? `${slab.dbMain.name} @ ${slab.banding.sp_outer} cm` : `${slab.dbMain.name} @ ${slab.banding.sp_band} cm (continúa igual)`],
      ['Dirección larga (uniforme)', `${(slab.isLLong ? slab.L_dir.As_per_m : slab.B_dir.As_per_m).toFixed(2)} cm²/m`, `${slab.dbMain.name} @ ${slab.isLLong ? slab.L_dir.spacing : slab.B_dir.spacing} cm`],
    ]);

    html += `<h3 class="text-sm font-bold text-slate-800 mt-3 mb-1.5">${n}.5 Longitud de Desarrollo en Tracción (E.060 25.4.2)</h3>`;
    html += this._table(['', 'Valor'], [
      ['Longitud de desarrollo requerida (ld)', `${slab.development.ld_req_cm.toFixed(1)} cm`],
      ['Longitud disponible, dirección L (voladizo − recubrimiento)', `${slab.development.ld_avail_L_cm.toFixed(1)} cm — ${this._badgeHtml(slab.development.pass_ld_L)}`],
      ['Longitud disponible, dirección B (voladizo − recubrimiento)', `${slab.development.ld_avail_B_cm.toFixed(1)} cm — ${this._badgeHtml(slab.development.pass_ld_B)}`],
    ]);

    html += `<h3 class="text-sm font-bold text-slate-800 mt-3 mb-1.5">${n}.6 Longitud de Desarrollo en Compresión de las Barras de Columna (E.060 25.4.9)</h3>`;
    html += `<p class="text-xs text-slate-600 mb-2">Anclaje disponible para las barras de arranque (dowels) de la columna dentro del peralte de la zapata (se asume el mismo diámetro que el acero principal de la zapata).</p>`;
    html += this._table(['', 'Valor'], [
      ['Longitud de desarrollo requerida (ldc)', `${slab.development.ldc_req_cm.toFixed(1)} cm`],
      ['Longitud disponible (h − recubrimiento − Ø)', `${slab.development.ldc_avail_cm.toFixed(1)} cm — ${this._badgeHtml(slab.development.pass_ldc)}`],
    ]);

    html += `<h3 class="text-sm font-bold text-slate-800 mt-3 mb-1.5">${n}.7 Aplastamiento Columna-Zapata (E.060 10.17 / ACI 318 22.8)</h3>`;
    const ap = slab.aplastamiento;
    html += this._table(['', 'Valor'], [
      ['Relación √(A2/A1) (limitada a 2.0)', ap.ratio.toFixed(2)],
      ['φPn = φ·0.85·f\'c·A1·√(A2/A1)', `${ap.phiPn.toFixed(0)} kg`],
      ['Carga última en la columna (Pu)', `${knToKg(slab.Pu).toFixed(0)} kg`],
      ['Verificación φPn ≥ Pu', this._badgeHtml(ap.pass)],
    ]);
    if (!ap.pass) {
      html += `<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">⚠️ El aplastamiento no se satisface directamente: se requiere acero de arranque (dowels) adicional con As ≥ ${ap.As_dowel_cm2.toFixed(2)} cm² para transmitir el excedente de carga (φ·As·fy = Pu − φPn).</p>`;
    }
    return html;
  }

  /** Caja "I) DATOS DE DISEÑO" de la zapata conectada — mismo formato que
   * _datosDisenoIsoladaHtml, con las secciones de columna y las tablas de
   * cargas duplicadas para cada columna. */
  _datosDisenoConectadaHtml(d, fnd, mat, hasSeismic) {
    const specsHtml = `
      <h4 class="text-xs font-bold text-slate-700 mb-1">Especificaciones del proyecto</h4>
      <table class="text-xs w-full mb-3">
        ${this._specRow(`Resistencia del concreto (f'c)`, `${mat.fc_kgcm2.toFixed(0)} kg/cm²`)}
        ${this._specRow('Resistencia del acero (fy)', `${mat.fy_kgcm2.toFixed(0)} kg/cm²`)}
        ${this._specRow('Prof. de desplante (Df)', `${d.Df.toFixed(2)} m`)}
        ${this._specRow('Capacidad portante admisible (q_adm)', this._p(fnd.q_adm_kgcm2))}
        ${this._specRow('Peso específico del suelo (γs)', `${fnd.gamma_kgm3.toFixed(0)} kg/m³`)}
      </table>
      <h4 class="text-xs font-bold text-slate-700 mb-1">Sección de Columna 1 (medianera)</h4>
      <table class="text-xs w-full mb-3">
        ${this._specRow('Ancho de columna (b1)', `${d.col1_L.toFixed(2)} m`)}
        ${this._specRow('Peralte de columna (t1)', `${d.col1_B.toFixed(2)} m`)}
      </table>
      <h4 class="text-xs font-bold text-slate-700 mb-1">Sección de Columna 2 (interior)</h4>
      <table class="text-xs w-full">
        ${this._specRow('Ancho de columna (b2)', `${d.col2_L.toFixed(2)} m`)}
        ${this._specRow('Peralte de columna (t2)', `${d.col2_B.toFixed(2)} m`)}
      </table>`;

    const loadsBlock = (label, Pd, Pl, Mxd, Mxl, Myd, Myl, Psx, Mxsx, Mysx, Psy, Mxsy, Mysy) => {
      const row = (l, P, Mx, My) => `<tr class="odd:bg-sky-50">
        <td class="border border-slate-300 px-2 py-1 font-bold bg-sky-100">${l}</td>
        <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._trimNum(P)}</td>
        <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._trimNum(Mx)}</td>
        <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._trimNum(My)}</td>
      </tr>`;
      return `
        <h4 class="text-xs font-bold text-slate-700 mb-1">Cargas en servicio — ${label}</h4>
        <table class="text-xs w-full border-collapse mb-3">
          <thead><tr>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100"></th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">P (Ton)</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">Mx (Ton-m)</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">My (Ton-m)</th>
          </tr></thead>
          <tbody>
            ${row('CM', Pd, Mxd, Myd)}
            ${row('CV', Pl, Mxl, Myl)}
            ${hasSeismic ? row('SXD', Psx, Mxsx, Mysx) : ''}
            ${hasSeismic ? row('SYD', Psy, Mxsy, Mysy) : ''}
          </tbody>
        </table>`;
    };
    const loadsHtml = loadsBlock('Columna 1', d.P1d, d.P1l, d.Mx1_d, d.Mx1_l, d.My1_d, d.My1_l, d.Psx1, d.Mx1_sx, d.My1_sx, d.Psy1, d.Mx1_sy, d.My1_sy)
      + loadsBlock('Columna 2', d.P2d, d.P2l, d.Mx2_d, d.Mx2_l, d.My2_d, d.My2_l, d.Psx2, d.Mx2_sx, d.My2_sx, d.Psy2, d.Mx2_sy, d.My2_sy)
      + `<p class="text-[10px] text-slate-500 mt-1 leading-snug">
        <span class="font-semibold">CM</span>: Carga Muerta ·
        <span class="font-semibold">CV</span>: Carga Viva
        ${hasSeismic ? ` · <span class="font-semibold">SXD</span>: Sismo en dirección X · <span class="font-semibold">SYD</span>: Sismo en dirección Y` : ''} ·
        <span class="font-semibold">P</span>: carga axial ·
        <span class="font-semibold">Mx, My</span>: momentos flectores en X e Y
      </p>`;

    return `<div class="border border-slate-300 rounded-lg overflow-hidden mb-6">
      <div class="bg-amber-400 text-slate-900 font-extrabold text-sm px-3 py-1.5">I) DATOS DE DISEÑO</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 p-3">
        <div>${specsHtml}</div>
        <div>${loadsHtml}</div>
      </div>
    </div>`;
  }

  /**
   * Caja "II) PREDIMENSIONAMIENTO" de la zapata conectada — hoja de
   * cálculo de referencia (Efrén, "ZAPATA CONECTADA.xlsx"): 1°) Zapata 1
   * (excéntrica) por cargas de gravedad; 2°) reacciones R1/R2 por el
   * método de la viga rígida; 3°) Zapata 2 (interior) a partir de R2; 4°)
   * verificación de la presión de contacto de servicio de cada zapata
   * (envolvente con sismo, si el proyecto tiene datos de sismo).
   */
  _predimensionamientoConectadaHtml(d, fnd, mat, geo) {
    const fz = d.fz ?? 0.1;
    const qAdmTnm2 = (fnd.q_adm_kgcm2 || 1) * 10;
    const P1 = (d.P1d || 0) + (d.P1l || 0);
    const P2 = (d.P2d || 0) + (d.P2l || 0);
    const My1 = (d.My1_d || 0) + (d.My1_l || 0);
    const My2 = (d.My2_d || 0) + (d.My2_l || 0);

    // 1°) Zapata 1 — volado "c" hacia el interior en L (al ras del límite
    // de propiedad), simétrico en B — igual que una zapata aislada
    // medianera (_solveEdgeLB: L=c+a, B=2c+b).
    const A1_req = (P1 * (1 + fz)) / qAdmTnm2;
    const disc1 = (2 * d.col1_L + d.col1_B) * (2 * d.col1_L + d.col1_B) - 8 * (d.col1_L * d.col1_B - A1_req);
    const c1Raw = (-(2 * d.col1_L + d.col1_B) + Math.sqrt(disc1)) / 4;
    const c1Round = Math.max(0.05, Math.ceil(c1Raw / 0.05) * 0.05);
    const L1p = c1Round + d.col1_L, B1p = 2 * c1Round + d.col1_B;

    const step1Html = `
      <h4 class="text-xs font-bold text-slate-700 mb-1">1°) Zapata 1 (excéntrica) — cargas de gravedad</h4>
      <p class="text-[11px] text-slate-500 mb-2">Área tentativa: A1 = P1(1+fz) / q_adm, con fz = ${fz.toFixed(2)}. Volado "c" hacia el interior en L (L1 = c + b1), simétrico en B (B1 = 2c + t1) — la cara exterior de la columna 1 queda al ras del límite de propiedad.</p>
      <table class="text-xs w-full mb-2">
        ${this._specRow('Carga en servicio (P1 = CM+CV)', `${this._trimNum(P1)} Ton`)}
        ${this._specRow('Área tentativa (A1)', `${A1_req.toFixed(2)} m²`)}
        ${this._specRow('Volado calculado (c)', `${c1Raw.toFixed(2)} m`)}
        ${this._specRow('Volado redondeado (c)', `${c1Round.toFixed(2)} m`)}
      </table>
      <div class="flex justify-center mb-2">${this._predimSketchSvg(L1p, B1p, d.col1_L, d.col1_B, c1Round, 'medianera')}</div>
      <p class="text-xs font-semibold text-slate-800 text-center">Zapata 1 predimensionada: L1 = ${L1p.toFixed(2)} m &nbsp; B1 = ${B1p.toFixed(2)} m</p>`;

    // 2°) R1, R2 — método de la viga rígida, con la geometría YA VIGENTE
    // (d.L1, no la tentativa L1p) para mostrar el estado actual real.
    const e1 = d.L1 / 2 - d.col1_L / 2;
    const sCentroid = d.s + d.col1_L / 2 + d.col2_L / 2;
    const denom = sCentroid - e1;
    const R2 = P2 - (P1 * e1) / denom + (My1 + My2) / denom;
    const R1 = P1 + P2 - R2;
    const step2Html = `
      <h4 class="text-xs font-bold text-slate-700 mt-4 mb-1">2°) Reacciones R1, R2 — método de la viga rígida</h4>
      <p class="text-[11px] text-slate-500 mb-2">e1 = L1/2 − col1_L/2 (excentricidad de la columna 1 respecto al centroide de su zapata). Distancia entre centroides = distancia libre entre caras de columna (s) + col1_L/2 + col2_L/2. R2 = P2 − P1·e1/(centroides−e1) + (My1+My2)/(centroides−e1); R1 = P1+P2−R2.</p>
      <table class="text-xs w-full">
        ${this._specRow('Excentricidad Zapata 1 (e1)', `${e1.toFixed(2)} m`)}
        ${this._specRow('Distancia entre centroides', `${sCentroid.toFixed(2)} m`)}
        ${this._specRow('Reacción Zapata 1 (R1)', `${this._trimNum(R1)} Ton`)}
        ${this._specRow('Reacción Zapata 2 (R2)', `${this._trimNum(R2)} Ton`)}
      </table>`;

    // 3°) Zapata 2 — volado "c" simétrico en ambas direcciones, a partir
    // de R2 (no de P2 solo) — igual que una zapata aislada interior
    // (_solveCenteredLB: L=2c+a, B=2c+b).
    const A2_req = (R2 * (1 + fz)) / qAdmTnm2;
    const disc2 = (d.col2_L - d.col2_B) * (d.col2_L - d.col2_B) + 4 * A2_req;
    const c2Raw = (-(d.col2_L + d.col2_B) + Math.sqrt(disc2)) / 4;
    const c2Round = Math.max(0.05, Math.ceil(c2Raw / 0.05) * 0.05);
    const L2p = 2 * c2Round + d.col2_L, B2p = 2 * c2Round + d.col2_B;

    const step3Html = `
      <h4 class="text-xs font-bold text-slate-700 mt-4 mb-1">3°) Zapata 2 (interior) — a partir de R2</h4>
      <p class="text-[11px] text-slate-500 mb-2">Área tentativa: A2 = R2(1+fz) / q_adm. Volado "c" repartido por igual en ambas direcciones (L2 = 2c + b2, B2 = 2c + t2).</p>
      <table class="text-xs w-full mb-2">
        ${this._specRow('Área tentativa (A2)', `${A2_req.toFixed(2)} m²`)}
        ${this._specRow('Volado calculado (c)', `${c2Raw.toFixed(2)} m`)}
        ${this._specRow('Volado redondeado (c)', `${c2Round.toFixed(2)} m`)}
      </table>
      <div class="flex justify-center mb-2">${this._predimSketchSvg(L2p, B2p, d.col2_L, d.col2_B, c2Round, 'interior')}</div>
      <p class="text-xs font-semibold text-slate-800 text-center">Zapata 2 predimensionada: L2 = ${L2p.toFixed(2)} m &nbsp; B2 = ${B2p.toFixed(2)} m</p>`;

    // 4°) Verificación de la presión de contacto de servicio, con la
    // geometría VIGENTE (d.L1/B1/L2/B2) — reutiliza geo (calculateConnectedBearing).
    let step4Html = `
      <h4 class="text-xs font-bold text-slate-700 mt-4 mb-1">4°) Verificación geotécnica (cargas de servicio, geometría vigente)</h4>
      <table class="text-xs w-full border-collapse mb-2">
        <thead><tr>
          <th class="border border-slate-300 px-2 py-1 bg-sky-100 text-left">Verificación</th>
          <th class="border border-slate-300 px-2 py-1 bg-sky-100">Resultado</th>
          <th class="border border-slate-300 px-2 py-1 bg-sky-100">Límite</th>
          <th class="border border-slate-300 px-2 py-1 bg-sky-100">Estado</th>
        </tr></thead>
        <tbody>
          <tr class="odd:bg-sky-50">
            <td class="border border-slate-300 px-2 py-1 font-semibold">Presión de contacto Zapata 1 (q1)</td>
            <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._p(geo.q1_kgcm2)}</td>
            <td class="border border-slate-300 px-2 py-1 text-right">≤ ${this._p(geo.q_adm_eff_kgcm2)}</td>
            <td class="border border-slate-300 px-2 py-1 text-center">${this._estadoCell(geo.pass_bearing_1)}</td>
          </tr>
          <tr class="odd:bg-sky-50">
            <td class="border border-slate-300 px-2 py-1 font-semibold">Presión de contacto Zapata 2 (q2)</td>
            <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._p(geo.q2_kgcm2)}</td>
            <td class="border border-slate-300 px-2 py-1 text-right">≤ ${this._p(geo.q_adm_eff_kgcm2)}</td>
            <td class="border border-slate-300 px-2 py-1 text-center">${this._estadoCell(geo.pass_bearing_2)}</td>
          </tr>
          <tr class="odd:bg-sky-50">
            <td class="border border-slate-300 px-2 py-1 font-semibold">Reacción R2 positiva (método aplicable)</td>
            <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._trimNum(geo.R2_tn)} Ton</td>
            <td class="border border-slate-300 px-2 py-1 text-right">&gt; 0</td>
            <td class="border border-slate-300 px-2 py-1 text-center">${this._estadoCell(geo.pass_positive_reaction)}</td>
          </tr>
        </tbody>
      </table>`;

    if (geo.hasSeismic) {
      const envTable = (title, env) => `
        <h5 class="text-[11px] font-bold text-slate-600 mt-2 mb-1">${title}</h5>
        <table class="text-xs w-full border-collapse mb-2">
          <thead><tr>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100 text-left">Combinación</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">q (esquina más desfavorable)</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">Límite admisible</th>
            <th class="border border-slate-300 px-2 py-1 bg-sky-100">Estado</th>
          </tr></thead>
          <tbody>
            ${env.rows.map((r) => `<tr class="odd:bg-sky-50">
              <td class="border border-slate-300 px-2 py-1 font-bold bg-sky-100">${r.label}</td>
              <td class="border border-slate-300 px-2 py-1 text-right font-mono">${this._p(r.q_governing_kgcm2)}${r.minC < 0 ? ' (rectangular)' : ''}</td>
              <td class="border border-slate-300 px-2 py-1 text-right">≤ ${this._p(r.limit_kgcm2)}</td>
              <td class="border border-slate-300 px-2 py-1 text-center">${this._estadoCell(r.pass)}</td>
            </tr>`).join('')}
          </tbody>
        </table>`;
      step4Html += `<p class="text-[11px] text-slate-500 mb-1">Al haber datos de sismo, se evalúa además la envolvente CM+CV, CM+CV±SXD, CM+CV±SYD en cada zapata (σ con el momento propio "Mx" de cada columna — el efecto longitudinal ya está absorbido en R1/R2), limitada a ${(d.seismic_bearing_factor ?? 1.25).toFixed(2)}·q_adm.</p>`
        + envTable('Zapata 1', geo.seismic_envelope1) + envTable('Zapata 2', geo.seismic_envelope2);
    }

    return `<div class="border border-slate-300 rounded-lg overflow-hidden mb-6">
      <div class="bg-amber-400 text-slate-900 font-extrabold text-sm px-3 py-1.5">II) PREDIMENSIONAMIENTO</div>
      <div class="p-3">${step1Html}${step2Html}${step3Html}${step4Html}</div>
    </div>`;
  }

  _reportConnected() {
    const d = this.data.connected, fnd = this.data.foundation, mat = this.data.materials;
    const geo = this.bearingResults, str = this.structResults;
    let html = `<h1 class="text-xl font-extrabold text-slate-900 mb-1">MEMORIA DE CÁLCULO — ZAPATA CONECTADA</h1>
      <p class="text-xs text-slate-500 mb-4">Norma E.060 (Concreto Armado) / E.050 (Suelos y Cimentaciones) — RNE, Perú</p>`;
    html += this._cajetinBlockHtml();
    html += this._visualizerImagesHtml();

    html += this._datosDisenoConectadaHtml(d, fnd, mat, geo.hasSeismic);
    html += this._predimensionamientoConectadaHtml(d, fnd, mat, geo);

    html += this._sectionTitle('2. Combinaciones de Diseño (Cargas Factoradas)');
    html += `<p class="text-xs text-slate-600 mb-2">Combinaciones clásicas E.060/ACI 318 — 1.4CM+1.7CV, 1.25(CM+CV)±SXD/SYD y 0.9CM±SXD/SYD (9 en total) — redistribuidas a R1/R2 por el método de la viga rígida en cada combinación (mismo criterio de la sección II, 2°). La más desfavorable de cada zapata se toma como su presión de diseño "su", uniforme sobre toda su área.</p>`;
    const envRow = (r) => [r.label, `${this._p(kpaToKgcm2(r.q_governing))}${r.minC < 0 ? ' (rectangular)' : ''}`];
    html += `<div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">
      <div><h4 class="text-xs font-bold text-slate-700 mb-1">Zapata 1</h4>${this._table(['Combinación', 'σ (esquina más desfavorable)'], str.env1.rows.map(envRow))}</div>
      <div><h4 class="text-xs font-bold text-slate-700 mb-1">Zapata 2</h4>${this._table(['Combinación', 'σ (esquina más desfavorable)'], str.env2.rows.map(envRow))}</div>
    </div>`;
    html += `<p class="text-xs text-slate-600 mb-3">Zapata 1 — combinación gobernante: <b>${str.env1.governingRow.label}</b>, su1 = ${this._p(kpaToKgcm2(str.env1.su_kPa), 3)}. Zapata 2 — combinación gobernante: <b>${str.env2.governingRow.label}</b>, su2 = ${this._p(kpaToKgcm2(str.env2.su_kPa), 3)}.</p>`;

    html += this._sectionTitle('3. Zapata 1 (Excéntrica) — Diseño Estructural');
    html += this._slabReportHtml(str.slab1, d.L1, d.B1, 3);

    html += this._sectionTitle('4. Zapata 2 (Interior) — Diseño Estructural');
    html += this._slabReportHtml(str.slab2, d.L2, d.B2, 4);

    html += this._sectionTitle('5. Viga de Conexión ("Strap Beam")');
    const strap = str.strap;
    html += `<p class="text-xs text-slate-600 mb-2">Modelo de dos cargas puntuales (P1, P2 en las columnas) y dos reacciones puntuales (R1, R2 en los centroides de cada zapata) — no una viga con carga distribuida. Solo las combinaciones con sismo longitudinal (SXD) o ninguna generan cortante/momento en la viga; el sismo transversal (SYD) no la afecta (se resuelve directamente en cada zapata).</p>`;
    html += this._table(['', 'Valor'], [
      ['Cortante último Vu (envolvente)', `${strap.Vu_kg.toFixed(0)} kg`],
      ['Momento último superior |Mu| (envolvente)', `${strap.Mu_top_kgm.toFixed(0)} kg·m`],
      ['Acero superior requerido', `${strap.As_top_req.toFixed(2)} cm² → ${strap.n_bars_top} ${str.dbMain.name} (As col. = ${strap.As_top_provided.toFixed(2)} cm²)`],
      ['Ductilidad superior (As ≤ As_máx = 0.75·ρ_bal·b·d)', `${strap.As_max_beam.toFixed(2)} cm² — ${this._badgeHtml(strap.pass_ductility_top)}`],
      ['Momento último inferior Mu (envolvente)', `${strap.Mu_bottom_kgm.toFixed(0)} kg·m`],
      ['Acero inferior requerido', `${strap.As_bottom_req.toFixed(2)} cm² → ${strap.n_bars_bottom} ${str.dbMain.name} (As col. = ${strap.As_bottom_provided.toFixed(2)} cm²)`],
      ['Ductilidad inferior (As ≤ As_máx)', `${strap.As_max_beam.toFixed(2)} cm² — ${this._badgeHtml(strap.pass_ductility_bottom)}`],
      ['Acero mínimo de viga (0.7√f\'c/fy·b·d)', `${strap.As_min_beam.toFixed(2)} cm²`],
      ['φVc (solo concreto)', `${knToKg(strap.phiVc).toFixed(0)} kg`],
      ['¿Requiere estribos por cálculo?', strap.stirrups_required_by_calc ? 'Sí (Vu > φVc)' : 'No (mínimos constructivos)'],
      ['Estribos', `${strap.rebarTrans.name}, 2 ramas @ ${strap.stirrup_spacing_cm} cm`],
    ]);

    html += this._sectionTitle('6. Cuadro de Habilitación de Acero');
    html += this._rebarTableHtml();

    return html;
  }

  // ===================================================================
  // HOJA DE PLANO (impresión A3 horizontal)
  // ===================================================================
  printPlanoSheet() {
    const container = document.getElementById('plano_sheet_content');
    const pageStyle = document.getElementById('dynamic_page_style');
    if (!container) return;

    container.innerHTML = this._buildPlanoHtml();
    if (pageStyle) pageStyle.textContent = '@page { size: A3 landscape; margin: 8mm; }';
    document.body.classList.add('printing-plano');

    const cleanup = () => {
      document.body.classList.remove('printing-plano');
      if (pageStyle) pageStyle.textContent = '';
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => window.print(), 50);
  }

  /** Arma el HTML de la hoja de plano: planta, armadura e isométrico 3D,
   * más el cuadro de habilitación de acero y el cajetín (datos.plano). */
  _buildPlanoHtml() {
    const d = this.data;
    const plano = d.plano || {};
    const schedule = this.rebarSchedule;

    const prevMode = this.renderer.viewMode;
    let imgPlanta = '', imgArmadura = '';
    try { imgPlanta = this.renderer.captureSnapshot('plan'); } catch (e) { /* no disponible */ }
    try { imgArmadura = this.renderer.captureSnapshot('rebar'); } catch (e) { /* no disponible */ }
    this.renderer.setViewMode(prevMode);

    let img3D = '';
    try {
      const container3D = document.getElementById('canvas3d_container');
      if (!this.renderer3D && container3D) {
        this.renderer3D = new FootingRenderer3D(container3D);
        this._setupRebar3DLegendToggles();
      }
      if (this.renderer3D) {
        this.renderer3D.updateData(this.data, this.bearingResults, this.structResults);
        img3D = this.renderer3D.captureSnapshot();
      }
    } catch (e) { /* 3D no disponible */ }

    const now = new Date();
    const fecha = `${now.toLocaleDateString('es-PE', { month: 'long' }).toUpperCase()} - ${now.getFullYear()}`;
    const tbRow = (label, value) => `<div class="plano-tb-row"><label>${label}</label><span>${value || '—'}</span></div>`;

    const scheduleRows = schedule.rows.map((r) => `
                <tr>
                  <td>${r.mark}</td>
                  <td>${r.element}</td>
                  <td>${r.diameter_name}</td>
                  <td class="num">${r.unitLength_m.toFixed(2)}</td>
                  <td class="num">${r.quantity}</td>
                  <td class="num">${r.totalLength_m.toFixed(1)}</td>
                  <td class="num">${r.weight_kg.toFixed(1)}</td>
                </tr>`).join('');

    const nombrePlano = { aislada: 'Zapata Aislada', combinada: 'Zapata Combinada', conectada: 'Zapata Conectada' }[d.footing_type];

    return `
      <div class="plano-sheet">
        <div class="plano-main">
          <div class="plano-panel" style="grid-column:1; grid-row:1;">
            <div class="plano-panel-img">${imgPlanta ? `<img src="${imgPlanta}" alt="Planta de la zapata">` : ''}</div>
            <div class="plano-panel-title"><span><span class="plano-bubble">1</span>PLANTA</span><span class="plano-scale">ESC: ${plano.escala || 'Indicada'}</span></div>
          </div>
          <div class="plano-panel" style="grid-column:2; grid-row:1;">
            <div class="plano-panel-img">${imgArmadura ? `<img src="${imgArmadura}" alt="Detalle de armado">` : ''}</div>
            <div class="plano-panel-title"><span><span class="plano-bubble">2</span>DETALLE DE ARMADO</span><span class="plano-scale">ESC: ${plano.escala || 'Indicada'}</span></div>
          </div>
          <div class="plano-panel" style="grid-column:3; grid-row:1;">
            <div class="plano-panel-img">${img3D ? `<img src="${img3D}" alt="Isométrico del armado">` : ''}</div>
            <div class="plano-panel-title"><span><span class="plano-bubble">3</span>ISOMÉTRICO DEL ARMADO</span></div>
          </div>
          <div class="plano-panel plano-panel-table" style="grid-row:2;">
            <div class="plano-panel-title"><span><span class="plano-bubble">4</span>CUADRO DE HABILITACIÓN DE ACERO</span></div>
            <table class="plano-table">
              <thead><tr><th>Marca</th><th>Elemento</th><th>Ø</th><th>Long. unit. (m)</th><th>Cant.</th><th>Long. total (m)</th><th>Peso (kg)</th></tr></thead>
              <tbody>${scheduleRows}
                <tr class="plano-table-total"><td colspan="6">Peso total de acero</td><td>${schedule.totalWeight_kg.toFixed(1)} kg</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="plano-titleblock">
          <div class="plano-tb-brand">ZapatasPro</div>
          <div class="plano-tb-section">
            ${tbRow('Dibujado por', plano.dibujado_por)}
            ${tbRow('Revisado por', plano.revisado_por)}
          </div>
          <div class="plano-tb-section">${tbRow('Ubicación', plano.ubicacion)}</div>
          <div class="plano-tb-section">${tbRow('Propietario', plano.propietario)}</div>
          <div class="plano-tb-section">${tbRow('Nombre de proyecto', plano.proyecto)}</div>
          <div class="plano-tb-section">${tbRow('Nombre de plano', nombrePlano)}</div>
          <div class="plano-tb-section">
            ${tbRow('Fecha', fecha)}
            ${tbRow('Escala', plano.escala)}
          </div>
          <div class="plano-tb-code">${plano.codigo || 'E-01'}</div>
        </div>
      </div>
    `;
  }
}
