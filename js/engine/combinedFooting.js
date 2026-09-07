/**
 * Motor de diseño estructural de una zapata COMBINADA (2 columnas, ancho B
 * constante — losa rígida única que abarca ambas columnas), Norma E.060 /
 * ACI 318, siguiendo la hoja de cálculo real de referencia (Efrén —
 * "ZAPATA COMBINADA.xlsx"): columna 1 medianera (al ras del borde
 * izquierdo) + columna 2 interior.
 *
 * La presión de diseño ("su") se obtiene de una envolvente de combinaciones
 * factoradas E.060/ACI 318 (1.4CM+1.7CV siempre; si hay sismo, además
 * 1.25(CM+CV)±SXD/SYD y 0.9CM±SXD/SYD) sobre la presión de contacto BIAXIAL
 * de TODA la losa (L×B) — igual método que la zapata aislada
 * (evaluateEnvelope/cornerPressures), con "My" (longitudinal, causa
 * gradiente en L) = suma de los momentos propios de cada columna en esa
 * dirección + el "brazo" de su posición respecto al centro de la zapata, y
 * "Mx" (transversal, causa gradiente en B) = suma de los momentos propios
 * (se asume ambas columnas centradas en B). Ese "su" gobernante se aplica
 * de forma UNIFORME sobre toda la losa para punzonamiento (Vu = su·(Área
 * total − Área crítica), forma conservadora de la hoja de referencia) y
 * para las franjas en voladizo transversal bajo cada columna (Mu =
 * su·voladizo²/2) — mismo criterio que la hoja de referencia.
 *
 * La franja LONGITUDINAL (acero superior/inferior a lo largo de L, y el
 * corte en esa dirección) SÍ necesita el diagrama real de fuerza cortante
 * y momento flector de la losa tratada como "viga invertida" de ancho B
 * (reacción distribuida hacia arriba, cargas puntuales de columna hacia
 * abajo) — la hoja de referencia obtiene esos valores de un modelo externo
 * (SAP2000, sin fórmula en la hoja); aquí se calculan analíticamente, en
 * equilibrio exacto para CADA una de las combinaciones factoradas, tomando
 * como diseño la envolvente (máximo) entre todas ellas.
 *
 * El punzonamiento usa un perímetro crítico con reducción automática por
 * borde/esquina: la distancia de cada cara de columna al borde real de la
 * losa se recorta a d/2 (igual que la zapata aislada, ver
 * footingSlabDesign.js) — para la columna 1 (medianera) esto reduce el
 * perímetro en el lado que da al borde izquierdo; αs (40 interior / 30
 * medianera / 20 esquinera) se deriva de esa misma reducción, sin
 * necesidad de que el usuario indique el tipo de columna.
 */

import { REBAR_TABLE } from '../constants.js';
import { tnToKn, kgcm2ToMpa, kpaToKgcm2 } from './units.js';
import {
  calcRequiredRebar, calcSpacing, oneWayShearCapacity_kN, punchingShearCapacity_kN,
  ldTraccion_cm, verificarAplastamiento,
  PHI_FLEX, PHI_SHEAR,
} from './concreteDesign.js';
import { evaluateEnvelope } from './seismicEnvelope.js';

const ALPHA_S = { interior: 40, medianera: 30, esquinera: 20 };

/** Construye una malla 1D con puntos exactos en x=0, en cada eje de columna y en x=L, subdividiendo cada tramo en `nSeg` pasos — así el diagrama nunca "salta" un eje de columna por redondeo. */
function buildGrid(L, positions, nSeg = 120) {
  const bounds = Array.from(new Set([0, ...positions, L])).sort((a, b) => a - b);
  const xs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const x0 = bounds[i], x1 = bounds[i + 1];
    for (let j = 0; j < nSeg; j++) xs.push(x0 + (x1 - x0) * (j / nSeg));
  }
  xs.push(L);
  return xs;
}

/** Diagrama V(x)/M(x) de la losa tratada como "viga invertida" de ancho B,
 * para UN caso de carga (P1c, P2c en a1, a2; My1c+My2c = momento propio
 * longitudinal total): reacción distribuida w_u(x) en equilibrio exacto
 * con P1c+P2c y con el momento total respecto al centro de la losa. */
function buildDiagram(L, a1, a2, P1c, P2c, MyOwnTotal) {
  const Pu_total = P1c + P2c;
  const Mu_ecc = MyOwnTotal + P1c * (a1 - L / 2.0) + P2c * (a2 - L / 2.0);
  const wSlope = (12 * Mu_ecc) / Math.pow(L, 3);
  const W = (x) => (Pu_total * x) / L + (6 * Mu_ecc / Math.pow(L, 3)) * (Math.pow(x - L / 2.0, 2) - Math.pow(L / 2.0, 2));
  const shearAt = (x) => {
    let sumP = 0;
    if (a1 < x) sumP += P1c;
    if (a2 < x) sumP += P2c;
    return W(x) - sumP;
  };
  const xs = buildGrid(L, [a1, a2]);
  const Vs = xs.map(shearAt);
  const Ms = [0];
  for (let i = 1; i < xs.length; i++) {
    Ms.push(Ms[i - 1] + (Vs[i] + Vs[i - 1]) / 2.0 * (xs[i] - xs[i - 1]));
  }
  return { xs, Vs, Ms, shearAt };
}

export function calculateCombinedStructural(footingData) {
  const { combined, materials, safety_req } = footingData;
  const { L, B, h, a1, s } = combined;
  const a2 = a1 + s;
  const col1_L = combined.col1_L, col1_B = combined.col1_B;
  const col2_L = combined.col2_L, col2_B = combined.col2_B;

  const fc_kgcm2 = materials.fc_kgcm2, fy_kgcm2 = materials.fy_kgcm2;
  const fc = kgcm2ToMpa(fc_kgcm2), fy = kgcm2ToMpa(fy_kgcm2);
  const dbMain = REBAR_TABLE[materials.rebar_main_id] ?? REBAR_TABLE[2];
  const dbTrans = REBAR_TABLE[materials.rebar_trans_id] ?? REBAR_TABLE[1];

  const LF_D = safety_req.LF_D ?? 1.4;
  const LF_L = safety_req.LF_L ?? 1.7;
  const fz = combined.fz ?? 0.1;

  // d = h − 0.10 m (misma convención "plana" que la zapata aislada y
  // conectada — ver dFlat en footingSlabDesign.js), única para toda la losa.
  const d = Math.max(0.05, h - 0.10);

  const hasSeismic = Math.abs(combined.Psx1 || 0) > 1e-9 || Math.abs(combined.Psx2 || 0) > 1e-9
    || Math.abs(combined.Psy1 || 0) > 1e-9 || Math.abs(combined.Psy2 || 0) > 1e-9
    || Math.abs(combined.Mx1_sx || 0) > 1e-9 || Math.abs(combined.My1_sx || 0) > 1e-9
    || Math.abs(combined.Mx2_sx || 0) > 1e-9 || Math.abs(combined.My2_sx || 0) > 1e-9
    || Math.abs(combined.Mx1_sy || 0) > 1e-9 || Math.abs(combined.My1_sy || 0) > 1e-9
    || Math.abs(combined.Mx2_sy || 0) > 1e-9 || Math.abs(combined.My2_sy || 0) > 1e-9;

  const Pd1 = tnToKn(combined.P1d), Pl1 = tnToKn(combined.P1l);
  const Mxd1 = tnToKn(combined.Mx1_d || 0), Mxl1 = tnToKn(combined.Mx1_l || 0);
  const Myd1 = tnToKn(combined.My1_d || 0), Myl1 = tnToKn(combined.My1_l || 0);
  const Pd2 = tnToKn(combined.P2d), Pl2 = tnToKn(combined.P2l);
  const Mxd2 = tnToKn(combined.Mx2_d || 0), Mxl2 = tnToKn(combined.Mx2_l || 0);
  const Myd2 = tnToKn(combined.My2_d || 0), Myl2 = tnToKn(combined.My2_l || 0);

  const Psx1 = tnToKn(combined.Psx1 || 0), Mx1sx = tnToKn(combined.Mx1_sx || 0), My1sx = tnToKn(combined.My1_sx || 0);
  const Psy1 = tnToKn(combined.Psy1 || 0), Mx1sy = tnToKn(combined.Mx1_sy || 0), My1sy = tnToKn(combined.My1_sy || 0);
  const Psx2 = tnToKn(combined.Psx2 || 0), Mx2sx = tnToKn(combined.Mx2_sx || 0), My2sx = tnToKn(combined.My2_sx || 0);
  const Psy2 = tnToKn(combined.Psy2 || 0), Mx2sy = tnToKn(combined.Mx2_sy || 0), My2sy = tnToKn(combined.My2_sy || 0);

  /** Construye un caso de carga factorada para ambas columnas. */
  function buildCase(label, P1g, My1g, Mx1g, P2g, My2g, Mx2g, seis) {
    let P1c = P1g, My1c = My1g, Mx1c = Mx1g, P2c = P2g, My2c = My2g, Mx2c = Mx2g, Pseis1 = 0, Pseis2 = 0;
    if (seis) {
      if (seis.axis === 'sx') {
        Pseis1 = seis.sign * Psx1; Pseis2 = seis.sign * Psx2;
        My1c += seis.sign * My1sx; Mx1c += seis.sign * Mx1sx;
        My2c += seis.sign * My2sx; Mx2c += seis.sign * Mx2sx;
      } else {
        Pseis1 = seis.sign * Psy1; Pseis2 = seis.sign * Psy2;
        My1c += seis.sign * My1sy; Mx1c += seis.sign * Mx1sy;
        My2c += seis.sign * My2sy; Mx2c += seis.sign * Mx2sy;
      }
      P1c += Pseis1; P2c += Pseis2;
    }
    return { label, P1c, P2c, My1c, My2c, Mx1c, Mx2c, Pgrav1: P1g, Pgrav2: P2g, Pseis1, Pseis2 };
  }

  const grav1_14 = LF_D * Pd1 + LF_L * Pl1, gravMy1_14 = LF_D * Myd1 + LF_L * Myl1, gravMx1_14 = LF_D * Mxd1 + LF_L * Mxl1;
  const grav2_14 = LF_D * Pd2 + LF_L * Pl2, gravMy2_14 = LF_D * Myd2 + LF_L * Myl2, gravMx2_14 = LF_D * Mxd2 + LF_L * Mxl2;
  const grav1_125 = 1.25 * (Pd1 + Pl1), gravMy1_125 = 1.25 * (Myd1 + Myl1), gravMx1_125 = 1.25 * (Mxd1 + Mxl1);
  const grav2_125 = 1.25 * (Pd2 + Pl2), gravMy2_125 = 1.25 * (Myd2 + Myl2), gravMx2_125 = 1.25 * (Mxd2 + Mxl2);
  const grav1_09 = 0.9 * Pd1, gravMy1_09 = 0.9 * Myd1, gravMx1_09 = 0.9 * Mxd1;
  const grav2_09 = 0.9 * Pd2, gravMy2_09 = 0.9 * Myd2, gravMx2_09 = 0.9 * Mxd2;

  const cases = [
    buildCase('1.4CM+1.7CV', grav1_14, gravMy1_14, gravMx1_14, grav2_14, gravMy2_14, gravMx2_14, null),
  ];
  if (hasSeismic) {
    cases.push(
      buildCase('1.25(CM+CV)+SXD', grav1_125, gravMy1_125, gravMx1_125, grav2_125, gravMy2_125, gravMx2_125, { sign: 1, axis: 'sx' }),
      buildCase('1.25(CM+CV)−SXD', grav1_125, gravMy1_125, gravMx1_125, grav2_125, gravMy2_125, gravMx2_125, { sign: -1, axis: 'sx' }),
      buildCase('1.25(CM+CV)+SYD', grav1_125, gravMy1_125, gravMx1_125, grav2_125, gravMy2_125, gravMx2_125, { sign: 1, axis: 'sy' }),
      buildCase('1.25(CM+CV)−SYD', grav1_125, gravMy1_125, gravMx1_125, grav2_125, gravMy2_125, gravMx2_125, { sign: -1, axis: 'sy' }),
      buildCase('0.9CM+SXD', grav1_09, gravMy1_09, gravMx1_09, grav2_09, gravMy2_09, gravMx2_09, { sign: 1, axis: 'sx' }),
      buildCase('0.9CM−SXD', grav1_09, gravMy1_09, gravMx1_09, grav2_09, gravMy2_09, gravMx2_09, { sign: -1, axis: 'sx' }),
      buildCase('0.9CM+SYD', grav1_09, gravMy1_09, gravMx1_09, grav2_09, gravMy2_09, gravMx2_09, { sign: 1, axis: 'sy' }),
      buildCase('0.9CM−SYD', grav1_09, gravMy1_09, gravMx1_09, grav2_09, gravMy2_09, gravMx2_09, { sign: -1, axis: 'sy' }),
    );
  }

  // -------------------------------------------------------------------
  // 1. ENVOLVENTE DE PRESIÓN FACTORADA DE TODA LA LOSA ("su") — reutilizada
  //    para punzonamiento y franjas en voladizo transversal.
  // -------------------------------------------------------------------
  const envCases = cases.map((c) => {
    const My_L = c.My1c + c.My2c + c.P1c * (a1 - L / 2.0) + c.P2c * (a2 - L / 2.0);
    const Mx_B = c.Mx1c + c.Mx2c;
    return { label: c.label, Pgrav: c.Pgrav1 + c.Pgrav2, Pseis: c.Pseis1 + c.Pseis2, Mx: My_L, My: Mx_B, fz };
  });
  const env = evaluateEnvelope(envCases, L, B);
  const su = env.governing_q; // kPa
  const envelope = {
    rows: env.rows.map((r) => ({ ...r, q_governing_kgcm2: kpaToKgcm2(r.q_governing) })),
    uses_rectangular: env.uses_rectangular,
    su, su_kgcm2: kpaToKgcm2(su),
    governingRow: env.governingRow,
  };

  // -------------------------------------------------------------------
  // 2. DIAGRAMA V/M LONGITUDINAL — por cada combinación factorada (la losa
  //    en equilibrio exacto con sus propias P1c/P2c/momentos propios),
  //    tomando la envolvente (máximo) entre todas.
  // -------------------------------------------------------------------
  let Mu_pos = 0, Mu_neg = 0, x_pos = 0, x_neg = 0;
  let repDiagram = null, repWorst = -1;
  const shearStationsDef = [
    { label: 'Izquierda de Columna 1 (a d)', x: Math.max(0, a1 - col1_L / 2 - d) },
    { label: 'Derecha de Columna 1 (a d)', x: Math.min(L, a1 + col1_L / 2 + d) },
    { label: 'Izquierda de Columna 2 (a d)', x: Math.max(0, a2 - col2_L / 2 - d) },
    { label: 'Derecha de Columna 2 (a d)', x: Math.min(L, a2 + col2_L / 2 + d) },
  ];
  const shearVu = [0, 0, 0, 0];

  cases.forEach((c) => {
    const diag = buildDiagram(L, a1, a2, c.P1c, c.P2c, c.My1c + c.My2c);
    let iMax = 0, iMin = 0;
    for (let i = 1; i < diag.Ms.length; i++) {
      if (diag.Ms[i] > diag.Ms[iMax]) iMax = i;
      if (diag.Ms[i] < diag.Ms[iMin]) iMin = i;
    }
    const casePos = Math.max(0, diag.Ms[iMax]);
    const caseNeg = Math.abs(Math.min(0, diag.Ms[iMin]));
    if (casePos > Mu_pos) { Mu_pos = casePos; x_pos = diag.xs[iMax]; }
    if (caseNeg > Mu_neg) { Mu_neg = caseNeg; x_neg = diag.xs[iMin]; }
    const worst = Math.max(casePos, caseNeg);
    if (worst > repWorst) { repWorst = worst; repDiagram = { xs: diag.xs, Vs: diag.Vs, Ms: diag.Ms }; }
    shearStationsDef.forEach((st, i) => {
      shearVu[i] = Math.max(shearVu[i], Math.abs(diag.shearAt(st.x)));
    });
  });

  const shearChecks = shearStationsDef.map((st, i) => ({ ...st, Vu: shearVu[i] }));

  // -------------------------------------------------------------------
  // 3. ACERO LONGITUDINAL PRINCIPAL (sentido L), en toda la sección de ancho B
  // -------------------------------------------------------------------
  const flexBottom = calcRequiredRebar(Mu_pos, fc, fy, B, d, PHI_FLEX, h); // acero inferior (voladizos)
  const flexTop = calcRequiredRebar(Mu_neg, fc, fy, B, d, PHI_FLEX, h); // acero superior (entre columnas)
  const AsBottom_per_m = flexBottom.As_design / B;
  const AsTop_per_m = flexTop.As_design / B;
  const sp_bottom = calcSpacing(AsBottom_per_m, dbMain.area_cm2);
  const sp_top = calcSpacing(AsTop_per_m, dbMain.area_cm2);

  // -------------------------------------------------------------------
  // 4. CORTE EN UNA DIRECCIÓN (envolvente, ver arriba)
  // -------------------------------------------------------------------
  const Vc_oneWay = oneWayShearCapacity_kN(fc_kgcm2, B, d);
  const phiVc_oneWay = PHI_SHEAR * Vc_oneWay;
  shearChecks.forEach((c) => { c.pass = c.Vu <= phiVc_oneWay; });
  const pass_shear_oneWay = shearChecks.every((c) => c.pass);

  // -------------------------------------------------------------------
  // 5. PUNZONAMIENTO POR COLUMNA — perímetro crítico con reducción
  //    automática por borde (distancia real de cada cara al borde de la
  //    losa, recortada a d/2 — igual que la zapata aislada), Vu = su·(Área
  //    total − Área crítica) (forma conservadora de la hoja de referencia).
  // -------------------------------------------------------------------
  function punchingForColumn(xCenter, colL, colB) {
    const halfD = d / 2.0;
    const distXneg = Math.max(0, xCenter - colL / 2.0);
    const distXpos = Math.max(0, L - (xCenter + colL / 2.0));
    const distYneg = Math.max(0, B / 2.0 - colB / 2.0); // columna centrada en B
    const offXneg = Math.min(halfD, distXneg);
    const offXpos = Math.min(halfD, distXpos);
    const offY = Math.min(halfD, distYneg);
    const critWidthX = colL + offXneg + offXpos;
    const critWidthY = colB + 2 * offY;
    const bo = 2 * critWidthX + 2 * critWidthY;
    const areaWithin = critWidthX * critWidthY;
    const edgeX = offXneg < halfD - 1e-6 || offXpos < halfD - 1e-6;
    const edgeY = offY < halfD - 1e-6;
    const colType = edgeX && edgeY ? 'esquinera' : (edgeX || edgeY) ? 'medianera' : 'interior';
    const alphaS = ALPHA_S[colType];
    const betaC = Math.max(colL, colB) / Math.min(colL, colB);
    const Vu = Math.max(0, su * (L * B - areaWithin));
    const cap = punchingShearCapacity_kN(fc_kgcm2, bo, d, betaC, alphaS);
    const phiVc = PHI_SHEAR * cap.Vc_kN;
    return { bo, areaWithin, Vu, betaC, colType, alphaS, Vc: cap.Vc_kN, phiVc, pass: Vu <= phiVc };
  }
  const halfGapAvailable = (a2 - col2_L / 2) - (a1 + col1_L / 2);
  const perimetersOverlap = halfGapAvailable < d;
  const punch1 = punchingForColumn(a1, col1_L, col1_B);
  const punch2 = punchingForColumn(a2, col2_L, col2_B);

  // -------------------------------------------------------------------
  // 6. ACERO TRANSVERSAL (sentido B) bajo cada columna — voladizo local,
  //    con la presión de diseño gobernante "su" (uniforme) — mismo
  //    criterio que la hoja de referencia (F212). Incluye el corte en una
  //    dirección transversal (por metro de longitud), Vu = su·(voladizo −
  //    d) — mismo criterio que la hoja de referencia (B190).
  // -------------------------------------------------------------------
  function transverseForColumn(colB) {
    const voladizo = (B - colB) / 2.0;
    const Mu = su * voladizo * voladizo / 2.0; // por metro de longitud (kN·m/m)
    const flex = calcRequiredRebar(Mu, fc, fy, 1.0, d, PHI_FLEX, h);
    const spacing = calcSpacing(flex.As_design, dbTrans.area_cm2);
    const Vu_y = Math.max(0, su * (voladizo - d)); // kN/m
    const Vc_y = oneWayShearCapacity_kN(fc_kgcm2, 1.0, d);
    const phiVc_y = PHI_SHEAR * Vc_y;
    const shearY = { Vu: Vu_y, Vc: Vc_y, phiVc: phiVc_y, pass: Vu_y <= phiVc_y };
    return { voladizo, q_local: su, Mu, flex, spacing, shearY };
  }
  const trans1 = transverseForColumn(col1_B);
  const trans2 = transverseForColumn(col2_B);

  // -------------------------------------------------------------------
  // 7. APLASTAMIENTO columna-zapata (E.060 10.17 / ACI 318 22.8), por
  //    columna, con la carga última envolvente de cada columna.
  // -------------------------------------------------------------------
  const Pu1 = Math.max(...cases.map((c) => Math.abs(c.P1c)));
  const Pu2 = Math.max(...cases.map((c) => Math.abs(c.P2c)));
  function aplastamientoForColumn(colL, colB, Pu_i) {
    const Pu_kg = (Pu_i * 1000.0) / 9.80665;
    const A1_cm2 = (colL * 100.0) * (colB * 100.0);
    const A2_cm2 = (L * 100.0) * (B * 100.0);
    return verificarAplastamiento(Pu_kg, fc_kgcm2, A1_cm2, A2_cm2, fy_kgcm2);
  }
  const aplastamiento1 = aplastamientoForColumn(col1_L, col1_B, Pu1);
  const aplastamiento2 = aplastamientoForColumn(col2_L, col2_B, Pu2);

  // -------------------------------------------------------------------
  // 8. LONGITUD DE DESARROLLO EN TRACCIÓN del acero longitudinal principal,
  //    disponible desde la cara de cada columna hasta el extremo respectivo
  // -------------------------------------------------------------------
  const cover = materials.cover_footing;
  const ld_req_cm = ldTraccion_cm(fy_kgcm2, fc_kgcm2, dbMain.diameter_mm);
  const ld_avail_left_cm = Math.max(0, a1 - col1_L / 2) * 100.0 - cover * 100.0;
  const ld_avail_right_cm = Math.max(0, L - (a2 + col2_L / 2)) * 100.0 - cover * 100.0;
  const pass_ld_left = ld_avail_left_cm >= ld_req_cm;
  const pass_ld_right = ld_avail_right_cm >= ld_req_cm;

  return {
    L, B, h, A: L * B, a1, a2, s,
    Pu1, Pu2,
    hasSeismic, envelope,
    diagram: repDiagram,
    Mu_pos, Mu_neg, x_pos, x_neg,
    d_main: d, d_trans: d, dbMain, dbTrans,
    bottom: { ...flexBottom, As_per_m: AsBottom_per_m, spacing: sp_bottom },
    top: { ...flexTop, As_per_m: AsTop_per_m, spacing: sp_top },
    shearChecks, phiVc_oneWay, pass_shear_oneWay,
    punch1, punch2, perimetersOverlap, halfGapAvailable,
    trans1, trans2,
    aplastamiento1, aplastamiento2,
    development: { ld_req_cm, ld_avail_left_cm, ld_avail_right_cm, pass_ld_left, pass_ld_right },
    fc, fy, fc_kgcm2, fy_kgcm2,
    pass_all_structural: pass_shear_oneWay && punch1.pass && punch2.pass
      && trans1.shearY.pass && trans2.shearY.pass
      && aplastamiento1.pass && aplastamiento2.pass && pass_ld_left && pass_ld_right,
  };
}
