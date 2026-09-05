/**
 * Motor de diseño estructural de una zapata COMBINADA (2 columnas, ancho B
 * constante), Norma E.060 / ACI 318.
 *
 * La zapata se analiza como una "viga invertida" de ancho B: las columnas
 * transmiten cargas puntuales factoradas hacia abajo y el suelo devuelve
 * una reacción distribuida hacia arriba (uniforme, o lineal si la
 * resultante de las columnas no cae en el centro de la zapata). Con la
 * convención de signos habitual de vigas (M positivo = tracción en la cara
 * inferior), esto da el resultado físico conocido: momento NEGATIVO (acero
 * superior) en el tramo entre columnas, y momento POSITIVO (acero
 * inferior) en los voladizos más allá de cada columna — validado
 * numéricamente reproduciendo el caso simétrico clásico de dos columnas
 * iguales, donde el diagrama cierra exactamente en V=0, M=0 en ambos
 * extremos libres.
 */

import { REBAR_TABLE } from '../constants.js';
import { tnToKn, kgcm2ToMpa } from './units.js';
import {
  calcRequiredRebar, calcSpacing, oneWayShearCapacity_kN, punchingShearCapacity_kN,
  PHI_FLEX, PHI_SHEAR,
} from './concreteDesign.js';

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

export function calculateCombinedStructural(footingData) {
  const { combined, materials, safety_req } = footingData;
  const { L, B, h, a1, s, Df } = combined;
  const a2 = a1 + s;
  const col1_L = combined.col1_L, col1_B = combined.col1_B;
  const col2_L = combined.col2_L, col2_B = combined.col2_B;

  const fc_kgcm2 = materials.fc_kgcm2, fy_kgcm2 = materials.fy_kgcm2;
  const fc = kgcm2ToMpa(fc_kgcm2), fy = kgcm2ToMpa(fy_kgcm2);
  const cover = materials.cover_footing;
  const dbMain = REBAR_TABLE[materials.rebar_main_id] ?? REBAR_TABLE[2];
  const dbTrans = REBAR_TABLE[materials.rebar_trans_id] ?? REBAR_TABLE[1];

  const LF_D = safety_req.LF_D ?? 1.2;
  const LF_L = safety_req.LF_L ?? 1.6;

  const Pu1 = LF_D * tnToKn(combined.P1d) + LF_L * tnToKn(combined.P1l);
  const Pu2 = LF_D * tnToKn(combined.P2d) + LF_L * tnToKn(combined.P2l);
  const Pu_total = Pu1 + Pu2;
  const A = L * B;

  const x_Ru = (Pu1 * a1 + Pu2 * a2) / Pu_total;
  const Mu_ecc = Pu_total * (x_Ru - L / 2.0);

  // Reacción distribuida factorada, por metro lineal de zapata (ya integra
  // el ancho B): w_u(x) = Pu_total/L + pendiente·(x − L/2)
  const wSlope = (12 * Mu_ecc) / Math.pow(L, 3);
  const w_u = (x) => Pu_total / L + wSlope * (x - L / 2.0);
  // Presión de contacto local q_u(x) = w_u(x)/B, usada para el diseño transversal bajo cada columna
  const q_u_local = (x) => w_u(x) / B;

  // Integral acumulada de w_u desde 0 hasta x (exacta, w_u es lineal)
  const W = (x) => (Pu_total * x) / L + (6 * Mu_ecc / Math.pow(L, 3)) * (Math.pow(x - L / 2.0, 2) - Math.pow(L / 2.0, 2));

  const shearAt = (x) => {
    let sumP = 0;
    if (a1 < x) sumP += Pu1;
    if (a2 < x) sumP += Pu2;
    return W(x) - sumP;
  };

  const xs = buildGrid(L, [a1, a2]);
  const Vs = xs.map(shearAt);
  const Ms = [0];
  for (let i = 1; i < xs.length; i++) {
    Ms.push(Ms[i - 1] + (Vs[i] + Vs[i - 1]) / 2.0 * (xs[i] - xs[i - 1]));
  }

  let iMax = 0, iMin = 0;
  for (let i = 1; i < Ms.length; i++) {
    if (Ms[i] > Ms[iMax]) iMax = i;
    if (Ms[i] < Ms[iMin]) iMin = i;
  }
  const Mu_pos = Math.max(0, Ms[iMax]);
  const Mu_neg = Math.abs(Math.min(0, Ms[iMin]));
  const x_pos = xs[iMax], x_neg = xs[iMin];

  // -------------------------------------------------------------------
  // ACERO LONGITUDINAL PRINCIPAL (sentido L), en toda la sección de ancho B
  // -------------------------------------------------------------------
  const d_main = h - cover - dbMain.diameter_m / 2.0;
  const d_trans = h - cover - dbMain.diameter_m - dbTrans.diameter_m / 2.0;

  const flexBottom = calcRequiredRebar(Mu_pos, fc, fy, B, d_main, PHI_FLEX); // acero inferior (voladizos)
  const flexTop = calcRequiredRebar(Mu_neg, fc, fy, B, d_main, PHI_FLEX); // acero superior (entre columnas)
  const AsBottom_per_m = flexBottom.As_design / B;
  const AsTop_per_m = flexTop.As_design / B;
  const sp_bottom = calcSpacing(AsBottom_per_m, dbMain.area_cm2);
  const sp_top = calcSpacing(AsTop_per_m, dbMain.area_cm2);

  // -------------------------------------------------------------------
  // CORTE EN UNA DIRECCIÓN, evaluado a distancia d de cada cara de columna
  // -------------------------------------------------------------------
  const Vc_oneWay = oneWayShearCapacity_kN(fc_kgcm2, B, d_main);
  const phiVc_oneWay = PHI_SHEAR * Vc_oneWay;

  const shearChecks = [
    { label: 'Izquierda de Columna 1 (a d)', x: Math.max(0, a1 - col1_L / 2 - d_main) },
    { label: 'Derecha de Columna 1 (a d)', x: Math.min(L, a1 + col1_L / 2 + d_main) },
    { label: 'Izquierda de Columna 2 (a d)', x: Math.max(0, a2 - col2_L / 2 - d_main) },
    { label: 'Derecha de Columna 2 (a d)', x: Math.min(L, a2 + col2_L / 2 + d_main) },
  ].map((c) => {
    const Vu = Math.abs(shearAt(c.x));
    return { ...c, Vu, pass: Vu <= phiVc_oneWay };
  });
  const pass_shear_oneWay = shearChecks.every((c) => c.pass);

  // -------------------------------------------------------------------
  // PUNZONAMIENTO POR COLUMNA (independiente para cada una — válido si sus
  // perímetros críticos, a d/2 de las caras, no se traslapan)
  // -------------------------------------------------------------------
  function punchingForColumn(colL, colB, xCenter, Pu_i) {
    const bo = 2 * (colL + d_main) + 2 * (colB + d_main);
    const areaWithin = (colL + d_main) * (colB + d_main);
    const Vu = Math.max(0, Pu_i - q_u_local(xCenter) * areaWithin);
    const betaC = Math.max(colL, colB) / Math.min(colL, colB);
    const cap = punchingShearCapacity_kN(fc_kgcm2, bo, d_main, betaC, 40);
    const phiVc = PHI_SHEAR * cap.Vc_kN;
    return { bo, areaWithin, Vu, betaC, Vc: cap.Vc_kN, phiVc, pass: Vu <= phiVc };
  }
  const halfGapAvailable = (a2 - col2_L / 2) - (a1 + col1_L / 2);
  const perimetersOverlap = halfGapAvailable < d_main;
  const punch1 = punchingForColumn(col1_L, col1_B, a1, Pu1);
  const punch2 = punchingForColumn(col2_L, col2_B, a2, Pu2);

  // -------------------------------------------------------------------
  // ACERO TRANSVERSAL (sentido B) bajo cada columna — voladizo local, igual
  // criterio que la zapata aislada, con la presión de contacto local
  // -------------------------------------------------------------------
  function transverseForColumn(colB, xCenter) {
    const voladizo = (B - colB) / 2.0;
    const q_local = q_u_local(xCenter);
    const Mu = q_local * voladizo * voladizo / 2.0; // por metro de longitud (kN·m/m)
    const flex = calcRequiredRebar(Mu, fc, fy, 1.0, d_trans, PHI_FLEX);
    const spacing = calcSpacing(flex.As_design, dbTrans.area_cm2);
    return { voladizo, q_local, Mu, flex, spacing };
  }
  const trans1 = transverseForColumn(col1_B, a1);
  const trans2 = transverseForColumn(col2_B, a2);

  return {
    L, B, h, A, Df, a1, a2, s,
    Pu1, Pu2, Pu_total, Mu_ecc, x_Ru,
    diagram: { xs, Vs, Ms },
    Mu_pos, Mu_neg, x_pos, x_neg,
    d_main, d_trans, dbMain, dbTrans,
    bottom: { ...flexBottom, As_per_m: AsBottom_per_m, spacing: sp_bottom },
    top: { ...flexTop, As_per_m: AsTop_per_m, spacing: sp_top },
    shearChecks, phiVc_oneWay, pass_shear_oneWay,
    punch1, punch2, perimetersOverlap, halfGapAvailable,
    trans1, trans2,
    fc, fy, fc_kgcm2, fy_kgcm2,
    pass_all_structural: pass_shear_oneWay && punch1.pass && punch2.pass,
  };
}
