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
import { knToKg, kNmToKgm } from '../engine/units.js';
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

    const canvasEl = document.getElementById('footingCanvas');
    this.renderer = new FootingCanvasRenderer(canvasEl);
    this.renderer3D = null; // se crea perezosamente al abrir "Detalle 3D" por primera vez

    this.initUI();
    this.recalculateAndRender();
  }

  initUI() {
    this.populateRebarSelects();
    this.bindInputEvents();
    this.bindButtonEvents();
    this.syncFormWithData();
    this.updateFootingTypeVisibility();
    this.renderer.resizeCanvas();
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

    const predimAisladaBtn = document.getElementById('btn-predim-aislada');
    if (predimAisladaBtn) predimAisladaBtn.addEventListener('click', () => this.predimensionIsolated());
  }

  /**
   * Predimensionamiento clásico de zapata aislada: reparte el mismo volado
   * "c" alrededor de la columna en ambas direcciones (L = 2c + col_L,
   * B = 2c + col_B), resolviendo "c" para que L×B cubra el área requerida
   * A = P·(1+fz)/q_adm (fz = 10%, asignación usual para peso propio +
   * relleno en esta etapa — antes de conocer la geometría final). Mismo
   * criterio que el método enseñado en el curso UNI y usado en la hoja de
   * cálculo de referencia para el área tentativa de la zapata.
   */
  predimensionIsolated() {
    const { isolated, foundation } = this.data;
    const P = (isolated.Pd || 0) + (isolated.Pl || 0);
    const q_adm_tnm2 = (foundation.q_adm_kgcm2 || 1) * 10;
    if (P <= 0 || q_adm_tnm2 <= 0) return;
    const fz = 0.10;
    const A_req = (P * (1 + fz)) / q_adm_tnm2;
    const a = isolated.col_L, b = isolated.col_B;
    const disc = (a - b) * (a - b) + 4 * A_req;
    const c = Math.max(0.05, Math.ceil(((-(a + b) + Math.sqrt(disc)) / 4) / 0.05) * 0.05);
    isolated.L = Math.round((Math.ceil((2 * c + a) / 0.05) * 0.05) * 100) / 100;
    isolated.B = Math.round((Math.ceil((2 * c + b) / 0.05) * 0.05) * 100) / 100;
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
      const val = target[parts[parts.length - 1]];
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
        val: `${geo.q1_kgcm2.toFixed(2)} / ${geo.q2_kgcm2.toFixed(2)} kg/cm²`,
        req: `≤ ${geo.q_adm_kgcm2.toFixed(2)}`,
        pass: geo.pass_bearing_1 && geo.pass_bearing_2,
        progress: Math.max(geo.q1_kgcm2, geo.q2_kgcm2) / geo.q_adm_kgcm2 * 100,
      });
    } else if (geo.hasSeismic) {
      this.renderKPIBadge('kpi_bearing', {
        title: 'Presión de Contacto (envolvente sísmica)',
        val: `${geo.seismic_envelope.governing_q_kgcm2.toFixed(2)} kg/cm²`,
        req: `${geo.seismic_envelope.governingRow.label}`,
        pass: geo.pass_bearing,
        progress: (geo.seismic_envelope.governing_q_kgcm2 / geo.seismic_envelope.governingRow.limit_kgcm2) * 100,
      });
    } else {
      this.renderKPIBadge('kpi_bearing', {
        title: 'Presión de Contacto (q_max)',
        val: `${geo.q_max_kgcm2.toFixed(2)} kg/cm²`,
        req: `≤ ${geo.q_adm_kgcm2.toFixed(2)}`,
        pass: geo.pass_bearing,
        progress: (geo.q_max_kgcm2 / geo.q_adm_kgcm2) * 100,
      });
    }

    if (type === 'conectada') {
      this.renderKPIBadge('kpi_eccentricity', {
        title: 'Fuerza en Viga de Conexión (R)',
        val: `${knToKg(geo.R).toFixed(0)} kg`,
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
          <td class="py-2 px-3 text-right">${strap.Mu_kgm.toFixed(0)} kg·m</td>
          <td class="py-2 px-3 text-right">—</td>
          <td class="py-2 px-3 text-right font-bold text-indigo-600">${strap.flex.As_design.toFixed(2)} cm²</td>
          <td class="py-2 px-3 font-semibold text-slate-900">${strap.n_bars_top} ${str.dbMain.name} (superior)</td>
          <td class="py-2 px-3 text-center">${badge(true)}</td>
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

  _reportIsolated() {
    const d = this.data.isolated, fnd = this.data.foundation, mat = this.data.materials;
    const geo = this.bearingResults, str = this.structResults;
    let html = `<h1 class="text-xl font-extrabold text-slate-900 mb-1">MEMORIA DE CÁLCULO — ZAPATA AISLADA</h1>
      <p class="text-xs text-slate-500 mb-6">Norma E.060 (Concreto Armado) / E.050 (Suelos y Cimentaciones) — RNE, Perú</p>`;

    html += this._sectionTitle('1. Datos de Entrada');
    html += this._table(['Parámetro', 'Valor'], [
      ['Dimensiones en planta (L × B)', `${d.L.toFixed(2)} × ${d.B.toFixed(2)} m`],
      ['Peralte total (h)', `${d.h.toFixed(2)} m`],
      ['Columna (col_L × col_B)', `${d.col_L.toFixed(2)} × ${d.col_B.toFixed(2)} m`],
      ['Profundidad de desplante (Df)', `${d.Df.toFixed(2)} m`],
      ['Carga de servicio — muerta / viva', `${d.Pd.toFixed(1)} / ${d.Pl.toFixed(1)} tn`],
      ['Momento de servicio Mx (D/L)', `${d.Mx_d.toFixed(1)} / ${d.Mx_l.toFixed(1)} tn·m`],
      ['Momento de servicio My (D/L)', `${d.My_d.toFixed(1)} / ${d.My_l.toFixed(1)} tn·m`],
      ...(geo.hasSeismic ? [
        ['Sismo X — P / Mx / My (servicio)', `${d.Psx.toFixed(2)} tn / ${d.Mx_sx.toFixed(2)} / ${d.My_sx.toFixed(2)} tn·m`],
        ['Sismo Y — P / Mx / My (servicio)', `${d.Psy.toFixed(2)} tn / ${d.Mx_sy.toFixed(2)} / ${d.My_sy.toFixed(2)} tn·m`],
      ] : []),
      ['Peso específico del suelo (γs)', `${fnd.gamma_kgm3.toFixed(0)} kg/m³`],
      ['Capacidad portante admisible (q_adm)', `${fnd.q_adm_kgcm2.toFixed(2)} kg/cm²`],
      [`f'c / fy`, `${mat.fc_kgcm2.toFixed(0)} / ${mat.fy_kgcm2.toFixed(0)} kg/cm²`],
    ]);

    html += this._sectionTitle('2. Verificación Geotécnica (Cargas de Servicio)');
    html += `<p class="text-xs text-slate-600 mb-2">Peso propio de la zapata: ${geo.W_footing_tn.toFixed(2)} tn. Peso del relleno sobre la zapata: ${geo.W_soil_tn.toFixed(2)} tn. Carga total transmitida al suelo N = ${geo.N_tn.toFixed(2)} tn.</p>`;
    html += this._table(['Verificación', 'Resultado', 'Límite', 'Estado'], [
      ['Excentricidad ex = Mx/N', `${(geo.ex * 100).toFixed(2)} cm`, `≤ L/6 = ${(geo.ex_max * 100).toFixed(2)} cm`, this._badgeHtml(Math.abs(geo.ex) <= geo.ex_max)],
      ['Excentricidad ey = My/N', `${(geo.ey * 100).toFixed(2)} cm`, `≤ B/6 = ${(geo.ey_max * 100).toFixed(2)} cm`, this._badgeHtml(Math.abs(geo.ey) <= geo.ey_max)],
      ['Presión máxima de contacto q_max (sin sismo)', `${geo.q_max_kgcm2.toFixed(2)} kg/cm²`, `≤ q_adm = ${geo.q_adm_kgcm2.toFixed(2)} kg/cm²`, this._badgeHtml(geo.q_max_kgcm2 <= geo.q_adm_kgcm2)],
    ]);
    if (geo.effective_note) html += `<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">⚠️ ${geo.effective_note}</p>`;

    if (geo.hasSeismic) {
      html += `<h3 class="text-sm font-bold text-slate-800 mt-3 mb-1.5">2.1 Envolvente Sísmica (Cargas de Servicio) — 5 Combinaciones</h3>`;
      html += `<p class="text-xs text-slate-600 mb-2">Presión en las 4 esquinas de la zapata para cada combinación (o su rectángulo equivalente si alguna esquina resulta en tracción); se reporta la más desfavorable de cada una.</p>`;
      html += this._table(['Combinación', 'q (esquina más desfavorable)', 'Límite admisible', 'Estado'], geo.seismic_envelope.rows.map((r) => [
        r.label,
        `${r.q_governing_kgcm2.toFixed(2)} kg/cm²${r.minC < 0 ? ' (rectangular)' : ''}`,
        `≤ ${r.limit_kgcm2.toFixed(2)} kg/cm²`,
        this._badgeHtml(r.pass),
      ]));
      html += `<p class="text-xs text-slate-600 mb-3">Combinación gobernante: <b>${geo.seismic_envelope.governingRow.label}</b>, q = ${geo.seismic_envelope.governing_q_kgcm2.toFixed(2)} kg/cm².</p>`;
    }

    if (str.hasSeismic) {
      html += this._sectionTitle('3. Envolvente Sísmica (Cargas Factoradas) — 9 Combinaciones');
      html += `<p class="text-xs text-slate-600 mb-2">Misma lógica que la verificación de servicio, con las cargas factoradas (1.4CM+1.7CV; 1.25(CM+CV)±sismo; 0.9CM±sismo). La presión gobernante "su" se aplica luego de forma <b>uniforme</b> sobre toda la zapata para el diseño por punzonamiento, corte y flexión.</p>`;
      html += this._table(['Combinación', 'q (esquina más desfavorable)'], str.envelope.rows.map((r) => [
        r.label, `${r.q_governing_kgcm2.toFixed(2)} kg/cm²${r.minC < 0 ? ' (rectangular)' : ''}`,
      ]));
      html += `<p class="text-xs text-slate-600 mb-3">Combinación gobernante: <b>${str.envelope.governingRow.label}</b>. su = ${str.envelope.su_kgcm2.toFixed(3)} kg/cm² (presión de diseño uniforme).</p>`;
      html += this._slabReportHtml(str, d.L, d.B, 4);
    } else {
      html += this._slabReportHtml(str, d.L, d.B, 3);
    }

    html += this._sectionTitle(`${str.hasSeismic ? 5 : 4}. Cuadro de Habilitación de Acero`);
    html += this._rebarTableHtml();

    return html;
  }

  _reportCombined() {
    const d = this.data.combined, fnd = this.data.foundation, mat = this.data.materials;
    const geo = this.bearingResults, str = this.structResults;
    let html = `<h1 class="text-xl font-extrabold text-slate-900 mb-1">MEMORIA DE CÁLCULO — ZAPATA COMBINADA</h1>
      <p class="text-xs text-slate-500 mb-6">Norma E.060 (Concreto Armado) / E.050 (Suelos y Cimentaciones) — RNE, Perú</p>`;

    html += this._sectionTitle('1. Datos de Entrada');
    html += this._table(['Parámetro', 'Valor'], [
      ['Dimensiones (L × B)', `${d.L.toFixed(2)} × ${d.B.toFixed(2)} m`],
      ['Peralte total (h)', `${d.h.toFixed(2)} m`],
      ['Posición Columna 1 (a1) / Columna 2 (a1+s)', `${d.a1.toFixed(2)} m / ${(d.a1 + d.s).toFixed(2)} m`],
      ['Columna 1 (col1_L × col1_B)', `${d.col1_L.toFixed(2)} × ${d.col1_B.toFixed(2)} m`],
      ['Columna 2 (col2_L × col2_B)', `${d.col2_L.toFixed(2)} × ${d.col2_B.toFixed(2)} m`],
      ['Carga de servicio Columna 1 (D/L)', `${d.P1d.toFixed(1)} / ${d.P1l.toFixed(1)} tn`],
      ['Carga de servicio Columna 2 (D/L)', `${d.P2d.toFixed(1)} / ${d.P2l.toFixed(1)} tn`],
      ['Capacidad portante admisible (q_adm)', `${fnd.q_adm_kgcm2.toFixed(2)} kg/cm²`],
      [`f'c / fy`, `${mat.fc_kgcm2.toFixed(0)} / ${mat.fy_kgcm2.toFixed(0)} kg/cm²`],
    ]);

    html += this._sectionTitle('2. Verificación Geotécnica (Cargas de Servicio)');
    html += `<p class="text-xs text-slate-600 mb-2">Resultante de columnas R = ${geo.R_tn.toFixed(2)} tn, ubicada a x̄ = ${geo.x_R.toFixed(3)} m del borde izquierdo. Con el peso propio, la resultante total N = ${geo.N_tn.toFixed(2)} tn actúa a x_N = ${geo.x_N.toFixed(3)} m (centro geométrico de la zapata en L/2 = ${(d.L / 2).toFixed(3)} m).</p>`;
    html += this._table(['Verificación', 'Resultado', 'Límite', 'Estado'], [
      ['Excentricidad e = x_N − L/2', `${(geo.e * 100).toFixed(2)} cm`, `≤ L/6 = ${(geo.e_max * 100).toFixed(2)} cm`, this._badgeHtml(geo.within_kern)],
      ['Presión máxima de contacto q_max', `${geo.q_max_kgcm2.toFixed(2)} kg/cm²`, `≤ q_adm = ${geo.q_adm_kgcm2.toFixed(2)} kg/cm²`, this._badgeHtml(geo.pass_bearing)],
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

  _reportConnected() {
    const d = this.data.connected, fnd = this.data.foundation, mat = this.data.materials;
    const geo = this.bearingResults, str = this.structResults;
    let html = `<h1 class="text-xl font-extrabold text-slate-900 mb-1">MEMORIA DE CÁLCULO — ZAPATA CONECTADA</h1>
      <p class="text-xs text-slate-500 mb-6">Norma E.060 (Concreto Armado) / E.050 (Suelos y Cimentaciones) — RNE, Perú</p>`;

    html += this._sectionTitle('1. Datos de Entrada');
    html += this._table(['Parámetro', 'Valor'], [
      ['Zapata 1, en el límite de propiedad (L1 × B1)', `${d.L1.toFixed(2)} × ${d.B1.toFixed(2)} m`],
      ['Columna 1 (col1_L × col1_B)', `${d.col1_L.toFixed(2)} × ${d.col1_B.toFixed(2)} m`],
      ['Zapata 2, interior — concéntrica (L2 × B2)', `${d.L2.toFixed(2)} × ${d.B2.toFixed(2)} m`],
      ['Columna 2 (col2_L × col2_B)', `${d.col2_L.toFixed(2)} × ${d.col2_B.toFixed(2)} m`],
      ['Separación entre ejes de columna (s)', `${d.s.toFixed(2)} m`],
      ['Viga de conexión (ancho × peralte)', `${d.strap_width.toFixed(2)} × ${d.strap_height.toFixed(2)} m`],
      ['Carga de servicio Columna 1 (D/L)', `${d.P1d.toFixed(1)} / ${d.P1l.toFixed(1)} tn`],
      ['Carga de servicio Columna 2 (D/L)', `${d.P2d.toFixed(1)} / ${d.P2l.toFixed(1)} tn`],
      ['Momento neto Columna 1 (D/L)', `${d.M1_d.toFixed(1)} / ${d.M1_l.toFixed(1)} tn·m`],
      ['Momento neto Columna 2 (D/L)', `${d.M2_d.toFixed(1)} / ${d.M2_l.toFixed(1)} tn·m`],
      ['Capacidad portante admisible (q_adm)', `${fnd.q_adm_kgcm2.toFixed(2)} kg/cm²`],
      [`f'c / fy`, `${mat.fc_kgcm2.toFixed(0)} / ${mat.fy_kgcm2.toFixed(0)} kg/cm²`],
    ]);

    html += this._sectionTitle('2. Verificación Geotécnica (Cargas de Servicio) — Método de la Viga Rígida');
    const hasM = Math.abs(geo.M1_tn) > 0.001 || Math.abs(geo.M2_tn) > 0.001;
    html += `<p class="text-xs text-slate-600 mb-2">La columna 1 no puede centrarse en su zapata (límite de propiedad): excentricidad e1 = L1/2 − col1_L/2 = ${(geo.e1 * 100).toFixed(2)} cm. Para que la Zapata 1 trabaje con presión <b>uniforme</b>, la viga de conexión transmite una fuerza R = ${geo.R_tn.toFixed(2)} tn hacia la Zapata 2. Tomando momentos respecto al centroide de la Zapata 1 (ΣFy=0, ΣM=0)${hasM ? `, incluyendo el momento neto de cada columna (M1=${geo.M1_tn.toFixed(2)}, M2=${geo.M2_tn.toFixed(2)} tn·m)` : ''}: N2 = P2 − P1·e1/(s−e1) + (M1+M2)/(s−e1) = ${geo.N2_tn.toFixed(2)} tn, N1 = P1+P2−N2 = ${geo.N1_tn.toFixed(2)} tn.</p>`;
    html += this._table(['Verificación', 'Resultado', 'Límite', 'Estado'], [
      ['Reacción N2 positiva (método aplicable)', `${geo.N2_tn.toFixed(2)} tn`, '> 0', this._badgeHtml(geo.pass_positive_reaction)],
      ['Presión de contacto Zapata 1 (q1)', `${geo.q1_kgcm2.toFixed(2)} kg/cm²`, `≤ q_adm = ${geo.q_adm_kgcm2.toFixed(2)} kg/cm²`, this._badgeHtml(geo.pass_bearing_1)],
      ['Presión de contacto Zapata 2 (q2)', `${geo.q2_kgcm2.toFixed(2)} kg/cm²`, `≤ q_adm = ${geo.q_adm_kgcm2.toFixed(2)} kg/cm²`, this._badgeHtml(geo.pass_bearing_2)],
    ]);

    html += this._sectionTitle('3. Zapata 1 (Excéntrica) — Diseño Estructural');
    html += this._slabReportHtml(str.slab1, d.L1, d.B1, 3);

    html += this._sectionTitle('4. Zapata 2 (Interior) — Diseño Estructural');
    html += this._slabReportHtml(str.slab2, d.L2, d.B2, 4);

    html += this._sectionTitle('5. Viga de Conexión ("Strap Beam")');
    const strap = str.strap;
    html += `<p class="text-xs text-slate-600 mb-2">Cortante constante Ru = ${strap.Vu_kg.toFixed(0)} kg a lo largo de toda la viga; momento lineal, máximo junto a la Zapata 1 (Mu = Ru·s) y nulo junto a la Zapata 2 (concéntrica, sin momento que equilibrar).</p>`;
    html += this._table(['', 'Valor'], [
      ['Momento último máximo (junto a Zapata 1)', `${strap.Mu_kgm.toFixed(0)} kg·m`],
      ['Cuantía de diseño ρ', strap.flex.rho_design.toFixed(4)],
      ['Acero superior requerido', `${strap.flex.As_design.toFixed(2)} cm² → ${strap.n_bars_top} ${str.dbMain.name} (As col. = ${strap.As_top_provided.toFixed(2)} cm²)`],
      ['Acero inferior (mínimo constructivo)', `${strap.n_bars_bottom} ${str.dbMain.name} (As col. = ${strap.As_bottom_provided.toFixed(2)} cm²)`],
      ['Cortante último Vu', `${strap.Vu_kg.toFixed(0)} kg`],
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
