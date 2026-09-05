/**
 * Cuadro de habilitación de acero: lista cada tipo de barra (marca,
 * diámetro, longitud de una barra, cantidad y peso total) a partir de los
 * resultados ya calculados por el motor estructural.
 */

import { hookMainBar_m, hookStirrup_m } from './concreteDesign.js';

const hookAllow = hookMainBar_m;

function row(mark, element, rebar, shape, unitLength_m, quantity) {
  const qty = Math.max(0, Math.ceil(quantity));
  const totalLength_m = Math.max(0, unitLength_m) * qty;
  return {
    mark, element,
    diameter_name: rebar.inches || rebar.name,
    diameter_mm: rebar.diameter_mm,
    shape, unitLength_m, quantity: qty, totalLength_m,
    weight_kg: totalLength_m * rebar.weight_kgm,
  };
}

/** Filas del acero de una losa de zapata (dirección larga uniforme +
 * dirección corta en banda central/franjas exteriores) — compartido por la
 * zapata aislada y por cada una de las dos zapatas de una zapata
 * conectada, ya que ambas se diseñan con la misma función (designFootingSlab). */
function pushSlabRows(rows, nextMark, labelPrefix, L, B, cover, slab) {
  const dbMain = slab.dbMain;
  const hook = hookAllow(dbMain.diameter_m);

  const longIsL = slab.isLLong;
  const longSpacing = longIsL ? slab.L_dir.spacing : slab.B_dir.spacing;
  const longRunLength = longIsL ? L : B;
  const longSpreadWidth = longIsL ? B : L;
  rows.push(row(nextMark(), `${labelPrefix} — Acero dirección larga (${longIsL ? 'paralelo a L' : 'paralelo a B'}), uniforme`, dbMain, 'straight',
    longRunLength - 2 * cover + 2 * hook, (longSpreadWidth - 2 * cover) / (longSpacing / 100) + 1));

  const shortRunLength = longIsL ? B : L;
  rows.push(row(nextMark(), `${labelPrefix} — Acero dirección corta, banda central (bajo columna)`, dbMain, 'straight',
    shortRunLength - 2 * cover + 2 * hook, slab.banding.bandWidth / (slab.banding.sp_band / 100) + 1));

  if (slab.banding.sp_outer) {
    rows.push(row(nextMark(), `${labelPrefix} — Acero dirección corta, franjas exteriores (x2 lados)`, dbMain, 'straight',
      shortRunLength - 2 * cover + 2 * hook, 2 * (slab.banding.outerWidthEach / (slab.banding.sp_outer / 100) + 1)));
  }
}

export function calculateIsolatedRebarSchedule(footingData, structResults) {
  const { isolated, materials } = footingData;
  const cover = materials.cover_footing;
  const rows = [];
  let mark = 1;
  const nextMark = () => `Z${mark++}`;

  pushSlabRows(rows, nextMark, 'Zapata', isolated.L, isolated.B, cover, structResults);

  const totalWeight_kg = rows.reduce((sum, r) => sum + r.weight_kg, 0);
  return { rows, totalWeight_kg };
}

export function calculateCombinedRebarSchedule(footingData, structResults) {
  const { combined, materials } = footingData;
  const { L, B } = combined;
  const cover = materials.cover_footing;
  const str = structResults;
  const rows = [];
  let mark = 1;
  const nextMark = () => `Z${mark++}`;

  const dbMain = str.dbMain, dbTrans = str.dbTrans;
  const hookMain = hookAllow(dbMain.diameter_m);
  const hookTrans = hookAllow(dbTrans.diameter_m);

  rows.push(row(nextMark(), 'Zapata combinada — Acero longitudinal inferior (voladizos)', dbMain, 'straight',
    L - 2 * cover + 2 * hookMain, (B - 2 * cover) / (str.bottom.spacing / 100) + 1));

  rows.push(row(nextMark(), 'Zapata combinada — Acero longitudinal superior (entre columnas)', dbMain, 'straight',
    L - 2 * cover + 2 * hookMain, (B - 2 * cover) / (str.top.spacing / 100) + 1));

  const trib1 = Math.max(0.3, (str.a1 + (str.a2 - str.a1) / 2.0));
  const trib2 = Math.max(0.3, (L - str.a1 - (str.a2 - str.a1) / 2.0));

  rows.push(row(nextMark(), 'Zapata combinada — Transversal bajo Columna 1', dbTrans, 'straight',
    B - 2 * cover + 2 * hookTrans, trib1 / (str.trans1.spacing / 100) + 1));

  rows.push(row(nextMark(), 'Zapata combinada — Transversal bajo Columna 2', dbTrans, 'straight',
    B - 2 * cover + 2 * hookTrans, trib2 / (str.trans2.spacing / 100) + 1));

  const totalWeight_kg = rows.reduce((sum, r) => sum + r.weight_kg, 0);
  return { rows, totalWeight_kg };
}

export function calculateConnectedRebarSchedule(footingData, structResults) {
  const { connected, materials } = footingData;
  const cover = materials.cover_footing;
  const str = structResults;
  const rows = [];
  let mark = 1;
  const nextMark = () => `Z${mark++}`;

  pushSlabRows(rows, nextMark, 'Zapata 1', connected.L1, connected.B1, cover, str.slab1);
  pushSlabRows(rows, nextMark, 'Zapata 2', connected.L2, connected.B2, cover, str.slab2);

  const strap = str.strap;
  const hookStirrup = hookStirrup_m(strap.rebarTrans.diameter_mm, strap.rebarTrans.diameter_m);
  const stirrupPerimeter = 2 * (strap.width - 2 * cover) + 2 * (strap.height - 2 * cover) + 2 * hookStirrup;
  const strapClearSpan = Math.max(0.3, connected.s - connected.col1_L / 2.0 - connected.col2_L / 2.0);

  rows.push(row(nextMark(), 'Viga de conexión — Acero superior (momento máximo en Zapata 1)', str.dbMain, 'straight',
    connected.s + 0.6, strap.n_bars_top));
  rows.push(row(nextMark(), 'Viga de conexión — Acero inferior (mínimo constructivo)', str.dbMain, 'straight',
    connected.s + 0.6, strap.n_bars_bottom));
  rows.push(row(nextMark(), `Viga de conexión — Estribos ${strap.stirrups_required_by_calc ? '(por cálculo)' : '(mínimos constructivos)'}`, strap.rebarTrans, 'stirrup',
    stirrupPerimeter, strapClearSpan / (strap.stirrup_spacing_cm / 100) + 1));

  const totalWeight_kg = rows.reduce((sum, r) => sum + r.weight_kg, 0);
  return { rows, totalWeight_kg };
}
