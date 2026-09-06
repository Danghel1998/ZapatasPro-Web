/**
 * Motor de diseño estructural de una zapata AISLADA (Norma E.060 / ACI 318),
 * siguiendo la hoja de cálculo real de referencia (Efrén — "ZAPATA TIPO
 * 1.xlsx"). Traduce los datos de entrada (isolated.*, en tn/tn·m) a los
 * parámetros que necesita el diseño genérico de losa de zapata
 * (designFootingSlab, en kN/kN·m) — ver ese archivo para el detalle del
 * cálculo (punzonamiento, corte en una dirección, flexión con bandas,
 * longitud de desarrollo).
 *
 * La presión de diseño "su" siempre se obtiene de una envolvente de
 * presiones de contacto en las 4 esquinas de la zapata (σ = P/A ±
 * 6Mx/(BL²) ± 6My/(LB²), con el peso propio aproximado por el factor
 * "fz" — ver seismicEnvelope.js), evaluada sobre las combinaciones de
 * diseño clásicas de E.060/ACI 318: 1.4CM+1.7CV siempre, y además
 * 1.25(CM+CV)±SXD/SYD y 0.9CM±SXD/SYD cuando el proyecto tiene datos de
 * sismo (9 combinaciones en total). La más desfavorable se toma como
 * presión de diseño ÚNICA y UNIFORME "su", con la que se diseña
 * punzonamiento, corte y flexión en vez de con la variación biaxial
 * exacta (misma simplificación de la hoja de referencia).
 *
 * El peralte efectivo "d" se toma como h − 0.10 m (convención de la hoja
 * de referencia), en vez de derivarlo del recubrimiento y diámetro de
 * barra reales — ver el parámetro dFlat de designFootingSlab.
 */

import { REBAR_TABLE } from '../constants.js';
import { tnToKn, kgcm2ToMpa, kpaToKgcm2 } from './units.js';
import { designFootingSlab } from './footingSlabDesign.js';
import { evaluateEnvelope } from './seismicEnvelope.js';

const ALPHA_S = { interior: 40, medianera: 30, esquinera: 20 };

/**
 * Posición de la columna dentro de la losa según el tipo elegido: una
 * columna de borde/medianera se asume con su cara exterior al ras del
 * borde de la zapata en la dirección larga (sin volado hacia ese lado,
 * todo el volado disponible queda hacia el interior); una de esquina, al
 * ras de ambos bordes (X e Y). Una columna interior queda centrada.
 * Esta excentricidad es puramente geométrica (posición de la columna en
 * planta) y es independiente de la excentricidad de carga (Mx/My).
 */
export function deriveColumnEccentricity(isolated) {
  const { L, B, col_L, col_B, col_type } = isolated;
  if (col_type === 'medianera') {
    return { ex_col: L / 2 - col_L / 2, ey_col: 0 };
  }
  if (col_type === 'esquinera') {
    return { ex_col: L / 2 - col_L / 2, ey_col: B / 2 - col_B / 2 };
  }
  return { ex_col: 0, ey_col: 0 };
}

export function calculateIsolatedStructural(footingData) {
  const { isolated, materials, safety_req } = footingData;
  const dbMain = REBAR_TABLE[materials.rebar_main_id] ?? REBAR_TABLE[2];
  const rebarTrans = REBAR_TABLE[materials.rebar_trans_id] ?? REBAR_TABLE[1];
  const alphaS = ALPHA_S[isolated.col_type] ?? 40;

  const LF_D = safety_req.LF_D ?? 1.4;
  const LF_L = safety_req.LF_L ?? 1.7;

  const hasSeismic = Math.abs(isolated.Psx || 0) > 1e-9 || Math.abs(isolated.Psy || 0) > 1e-9
    || Math.abs(isolated.Mx_sx || 0) > 1e-9 || Math.abs(isolated.My_sx || 0) > 1e-9
    || Math.abs(isolated.Mx_sy || 0) > 1e-9 || Math.abs(isolated.My_sy || 0) > 1e-9;

  const { L, B } = isolated;
  const fz = isolated.fz ?? 0.08;
  const Pd = tnToKn(isolated.Pd), Pl = tnToKn(isolated.Pl);
  const Mxd = tnToKn(isolated.Mx_d), Mxl = tnToKn(isolated.Mx_l);
  const Myd = tnToKn(isolated.My_d), Myl = tnToKn(isolated.My_l);

  // Combinaciones de diseño clásicas E.060/ACI 318, igual que la hoja de
  // referencia: 1.4CM+1.7CV siempre; si hay sismo, además
  // 1.25(CM+CV)±SXD/SYD y 0.9CM±SXD/SYD (9 combinaciones en total). El
  // peso propio se aproxima con (1+fz) sobre el término axial de
  // gravedad de cada combinación (ver evaluateEnvelope).
  const cases = [
    { label: '1.4CM+1.7CV', Pgrav: LF_D * Pd + LF_L * Pl, Pseis: 0, Mx: LF_D * Mxd + LF_L * Mxl, My: LF_D * Myd + LF_L * Myl, fz },
  ];
  if (hasSeismic) {
    const Psx = tnToKn(isolated.Psx || 0), Mx_sx = tnToKn(isolated.Mx_sx || 0), My_sx = tnToKn(isolated.My_sx || 0);
    const Psy = tnToKn(isolated.Psy || 0), Mx_sy = tnToKn(isolated.Mx_sy || 0), My_sy = tnToKn(isolated.My_sy || 0);
    const Pgrav125 = 1.25 * (Pd + Pl), Mx125 = 1.25 * (Mxd + Mxl), My125 = 1.25 * (Myd + Myl);
    const Pgrav09 = 0.9 * Pd, Mx09 = 0.9 * Mxd, My09 = 0.9 * Myd;
    cases.push(
      { label: '1.25(CM+CV)+SXD', Pgrav: Pgrav125, Pseis: Psx, Mx: Mx125 + Mx_sx, My: My125 + My_sx, fz },
      { label: '1.25(CM+CV)−SXD', Pgrav: Pgrav125, Pseis: -Psx, Mx: Mx125 - Mx_sx, My: My125 - My_sx, fz },
      { label: '1.25(CM+CV)+SYD', Pgrav: Pgrav125, Pseis: Psy, Mx: Mx125 + Mx_sy, My: My125 + My_sy, fz },
      { label: '1.25(CM+CV)−SYD', Pgrav: Pgrav125, Pseis: -Psy, Mx: Mx125 - Mx_sy, My: My125 - My_sy, fz },
      { label: '0.9CM+SXD', Pgrav: Pgrav09, Pseis: Psx, Mx: Mx09 + Mx_sx, My: My09 + My_sx, fz },
      { label: '0.9CM−SXD', Pgrav: Pgrav09, Pseis: -Psx, Mx: Mx09 - Mx_sx, My: My09 - My_sx, fz },
      { label: '0.9CM+SYD', Pgrav: Pgrav09, Pseis: Psy, Mx: Mx09 + Mx_sy, My: My09 + My_sy, fz },
      { label: '0.9CM−SYD', Pgrav: Pgrav09, Pseis: -Psy, Mx: Mx09 - Mx_sy, My: My09 - My_sy, fz },
    );
  }
  const env = evaluateEnvelope(cases, L, B);
  const rows = env.rows.map((r) => ({ ...r, q_governing_kgcm2: kpaToKgcm2(r.q_governing) }));
  const governingRow = rows[env.rows.indexOf(env.governingRow)] ?? rows[0];
  const envelope = {
    rows,
    uses_rectangular: env.uses_rectangular,
    su: env.governing_q,
    su_kgcm2: kpaToKgcm2(env.governing_q),
    governingRow,
  };
  // "su" es la presión de diseño (envolvente), aplicada de forma UNIFORME
  // sobre toda el área — se traduce a una carga puntual equivalente Pu =
  // su·A sin momento, para que designFootingSlab la reparta con la misma
  // mecánica de siempre (cantiléver con presión constante en vez de
  // variable) — igual que la hoja de referencia.
  const Pu = env.governing_q * L * B;
  const Mu_x = 0, Mu_y = 0;

  const result = designFootingSlab({
    L: isolated.L, B: isolated.B, h: isolated.h,
    col_L: isolated.col_L, col_B: isolated.col_B,
    ex_col: isolated.ex_col || 0, ey_col: isolated.ey_col || 0,
    Pu, Mu_x, Mu_y, alphaS,
    fc: kgcm2ToMpa(materials.fc_kgcm2), fy: kgcm2ToMpa(materials.fy_kgcm2),
    fc_kgcm2: materials.fc_kgcm2, fy_kgcm2: materials.fy_kgcm2,
    cover: materials.cover_footing,
    dFlat: Math.max(0.05, isolated.h - 0.10),
    dbMain, rebarTrans,
  });
  result.hasSeismic = hasSeismic;
  result.envelope = envelope;
  return result;
}
