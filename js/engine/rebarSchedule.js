/**
 * Cuadro de habilitación de acero: lista cada tipo de barra (marca,
 * diámetro, longitud de una barra, cantidad y peso total) a partir de los
 * resultados ya calculados por el motor estructural.
 */

const hookAllow = (diameter_m) => Math.max(0.10, diameter_m * 12.0);

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

export function calculateIsolatedRebarSchedule(footingData, structResults) {
  const { isolated, materials } = footingData;
  const { L, B, h } = isolated;
  const cover = materials.cover_footing;
  const str = structResults;
  const rows = [];
  let mark = 1;
  const nextMark = () => `Z${mark++}`;

  const dbMain = str.dbMain;
  const hook = hookAllow(dbMain.diameter_m);

  // Acero "dirección larga" (uniforme en toda la zapata)
  const longIsL = str.isLLong;
  const longSpacing = longIsL ? str.L_dir.spacing : str.B_dir.spacing;
  const longRunLength = longIsL ? L : B; // longitud de cada barra (paralela al lado largo)
  const longSpreadWidth = longIsL ? B : L; // sobre esta longitud se reparten las barras
  rows.push(row(nextMark(), `Zapata — Acero dirección larga (${longIsL ? 'paralelo a L' : 'paralelo a B'}), uniforme`, dbMain, 'straight',
    longRunLength - 2 * cover + 2 * hook, (longSpreadWidth - 2 * cover) / (longSpacing / 100) + 1));

  // Acero "dirección corta", en banda central + franjas exteriores (ACI 318 15.4.4)
  const shortRunLength = longIsL ? B : L;
  rows.push(row(nextMark(), 'Zapata — Acero dirección corta, banda central (bajo columna)', dbMain, 'straight',
    shortRunLength - 2 * cover + 2 * hook, str.banding.bandWidth / (str.banding.sp_band / 100) + 1));

  if (str.banding.sp_outer) {
    rows.push(row(nextMark(), 'Zapata — Acero dirección corta, franjas exteriores (x2 lados)', dbMain, 'straight',
      shortRunLength - 2 * cover + 2 * hook, 2 * (str.banding.outerWidthEach / (str.banding.sp_outer / 100) + 1)));
  }

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
