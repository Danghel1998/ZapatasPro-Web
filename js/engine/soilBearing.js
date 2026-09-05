/**
 * Motor de verificación geotécnica (E.050): presión de contacto
 * zapata-suelo, excentricidad respecto al tercio medio (núcleo central) y
 * comparación contra la capacidad portante admisible del estudio de suelos.
 * Trabaja con cargas de SERVICIO (sin factorar) — la presión bruta incluye
 * el peso propio de la zapata y del relleno sobre ella.
 */

import { tnToKn, knToTn, kgcm2ToKpa, kpaToKgcm2, kgm3ToKnm3 } from './units.js';

/**
 * Verificación geotécnica de una zapata AISLADA (rectángulo L × B). Cuando
 * hay momento en una o ambas direcciones, usa la fórmula de flexión biaxial
 * superpuesta en las esquinas — exacta si cada excentricidad cae dentro del
 * tercio medio de su lado (caso más común en la práctica).
 */
export function calculateIsolatedBearing(footingData) {
  const { isolated, foundation, materials } = footingData;
  const { L, B, h, Df } = isolated;

  const gamma_s = kgm3ToKnm3(foundation.gamma_kgm3);
  const gamma_c = kgm3ToKnm3(materials.gamma_c_kgm3);
  const q_adm = kgcm2ToKpa(foundation.q_adm_kgcm2);

  const P_col = tnToKn(isolated.Pd + isolated.Pl);
  const Mx = tnToKn(isolated.Mx_d + isolated.Mx_l);
  const My = tnToKn(isolated.My_d + isolated.My_l);

  const A = L * B;
  const W_footing = gamma_c * A * h;
  const W_soil = gamma_s * A * Math.max(0, Df - h);
  const N = P_col + W_footing + W_soil;

  const ex = N > 0.001 ? Mx / N : 0;
  const ey = N > 0.001 ? My / N : 0;
  const ex_max = L / 6.0;
  const ey_max = B / 6.0;
  const within_kern = Math.abs(ex) <= ex_max && Math.abs(ey) <= ey_max;

  let q_max, q_min, effective_note = null;
  if (within_kern) {
    const q0 = N / A;
    q_max = q0 * (1 + 6 * Math.abs(ex) / L + 6 * Math.abs(ey) / B);
    q_min = q0 * (1 - 6 * Math.abs(ex) / L - 6 * Math.abs(ey) / B);
  } else {
    const e_res = Math.hypot(ex, ey);
    const L_eff = Math.max(0.1, 3 * (L / 2 - Math.abs(ex)));
    q_max = (2 * N) / (L_eff * B);
    q_min = 0;
    effective_note = `La excentricidad resultante (e = ${e_res.toFixed(3)} m) cae fuera del tercio medio — se estima de forma aproximada y conservadora con un área efectiva triangular. Aumenta la zapata o reduce el momento actuante.`;
  }

  const pass_bearing = q_max <= q_adm;

  return {
    L, B, h, A, Df,
    N, N_tn: knToTn(N),
    P_col_tn: isolated.Pd + isolated.Pl,
    W_footing_tn: knToTn(W_footing),
    W_soil_tn: knToTn(W_soil),
    ex, ey, ex_max, ey_max, within_kern,
    q_max, q_min,
    q_max_kgcm2: kpaToKgcm2(q_max),
    q_min_kgcm2: kpaToKgcm2(q_min),
    q_adm, q_adm_kgcm2: foundation.q_adm_kgcm2,
    pass_bearing,
    pass_kern: within_kern,
    effective_note,
    pass_all: pass_bearing && within_kern,
  };
}

/**
 * Verificación geotécnica de una zapata COMBINADA (2 columnas, ancho B
 * constante). La excentricidad se evalúa solo a lo largo de L (eje de
 * columnas); se asume carga centrada en la dirección B.
 */
export function calculateCombinedBearing(footingData) {
  const { combined, foundation, materials } = footingData;
  const { L, B, h, a1, s, Df } = combined;

  const gamma_s = kgm3ToKnm3(foundation.gamma_kgm3);
  const gamma_c = kgm3ToKnm3(materials.gamma_c_kgm3);
  const q_adm = kgcm2ToKpa(foundation.q_adm_kgcm2);

  const P1 = tnToKn(combined.P1d + combined.P1l);
  const P2 = tnToKn(combined.P2d + combined.P2l);
  const R = P1 + P2;

  const A = L * B;
  const W_footing = gamma_c * A * h;
  const W_soil = gamma_s * A * Math.max(0, Df - h);
  const N = R + W_footing + W_soil;

  const x_R = R > 0.001 ? (P1 * a1 + P2 * (a1 + s)) / R : L / 2;
  const x_N = N > 0.001 ? (R * x_R + (W_footing + W_soil) * (L / 2)) / N : L / 2;
  const e = x_N - L / 2;
  const e_max = L / 6.0;
  const within_kern = Math.abs(e) <= e_max;

  let q_max, q_min, effective_note = null;
  if (within_kern) {
    const q0 = N / A;
    q_max = q0 * (1 + 6 * Math.abs(e) / L);
    q_min = q0 * (1 - 6 * Math.abs(e) / L);
  } else {
    const L_eff = Math.max(0.1, 3 * (L / 2 - Math.abs(e)));
    q_max = (2 * N) / (L_eff * B);
    q_min = 0;
    effective_note = `La excentricidad (e = ${e.toFixed(3)} m) cae fuera del tercio medio (L/6 = ${e_max.toFixed(3)} m) — ajusta "a1" (posición) o el largo L para acercar el centroide de la zapata a la resultante de cargas.`;
  }

  const pass_bearing = q_max <= q_adm;

  return {
    L, B, h, A, Df, a1, s,
    P1_tn: combined.P1d + combined.P1l,
    P2_tn: combined.P2d + combined.P2l,
    R, R_tn: knToTn(R), N, N_tn: knToTn(N),
    W_footing_tn: knToTn(W_footing), W_soil_tn: knToTn(W_soil),
    x_R, x_N, e, e_max, within_kern,
    q_max, q_min,
    q_max_kgcm2: kpaToKgcm2(q_max),
    q_min_kgcm2: kpaToKgcm2(q_min),
    q_adm, q_adm_kgcm2: foundation.q_adm_kgcm2,
    pass_bearing,
    effective_note,
    pass_all: pass_bearing && within_kern,
  };
}
