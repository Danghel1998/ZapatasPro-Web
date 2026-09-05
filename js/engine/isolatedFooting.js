/**
 * Motor de diseño estructural de una zapata AISLADA (Norma E.060 / ACI 318).
 * Traduce los datos de entrada (isolated.*, en tn/tn·m) a los parámetros
 * factorados que necesita el diseño genérico de losa de zapata
 * (designFootingSlab, en kN/kN·m) — ver ese archivo para el detalle del
 * cálculo (punzonamiento, corte en una dirección, flexión con bandas,
 * longitud de desarrollo).
 *
 * Cuando el proyecto incluye sismo (Psx/Psy o sus momentos distintos de
 * cero), la presión de diseño no se calcula con el par (Pu, Mu_x, Mu_y)
 * simple, sino con la envolvente de 9 combinaciones factoradas de una
 * hoja de cálculo real de referencia (1.4CM+1.7CV; 1.25(CM+CV)±sismo X/Y;
 * 0.9CM±sismo X/Y): se evalúan las 4 esquinas de cada combinación y se
 * toma la más desfavorable (o su rectángulo equivalente, si hay tracción
 * en alguna esquina) como una presión ÚNICA y UNIFORME "su" — igual
 * criterio que esa hoja, que diseña punzonamiento, corte y flexión con
 * esa presión envolvente en vez de con la variación biaxial exacta.
 */

import { REBAR_TABLE } from '../constants.js';
import { tnToKn, kgcm2ToMpa, kpaToKgcm2, kgm3ToKnm3 } from './units.js';
import { designFootingSlab } from './footingSlabDesign.js';
import { evaluateEnvelope } from './seismicEnvelope.js';

const ALPHA_S = { interior: 40, medianera: 30, esquinera: 20 };

export function calculateIsolatedStructural(footingData) {
  const { isolated, materials, safety_req, foundation } = footingData;
  const dbMain = REBAR_TABLE[materials.rebar_main_id] ?? REBAR_TABLE[2];
  const rebarTrans = REBAR_TABLE[materials.rebar_trans_id] ?? REBAR_TABLE[1];
  const alphaS = ALPHA_S[isolated.col_type] ?? 40;

  const LF_D = safety_req.LF_D ?? 1.4;
  const LF_L = safety_req.LF_L ?? 1.7;

  const hasSeismic = Math.abs(isolated.Psx || 0) > 1e-9 || Math.abs(isolated.Psy || 0) > 1e-9
    || Math.abs(isolated.Mx_sx || 0) > 1e-9 || Math.abs(isolated.My_sx || 0) > 1e-9
    || Math.abs(isolated.Mx_sy || 0) > 1e-9 || Math.abs(isolated.My_sy || 0) > 1e-9;

  let Pu, Mu_x, Mu_y, envelope = null;

  if (hasSeismic) {
    const { L, B } = isolated;
    const Pd = tnToKn(isolated.Pd), Pl = tnToKn(isolated.Pl);
    const Mxd = tnToKn(isolated.Mx_d), Mxl = tnToKn(isolated.Mx_l);
    const Myd = tnToKn(isolated.My_d), Myl = tnToKn(isolated.My_l);
    const Psx = tnToKn(isolated.Psx || 0), Mx_sx = tnToKn(isolated.Mx_sx || 0), My_sx = tnToKn(isolated.My_sx || 0);
    const Psy = tnToKn(isolated.Psy || 0), Mx_sy = tnToKn(isolated.Mx_sy || 0), My_sy = tnToKn(isolated.My_sy || 0);

    // Peso propio (zapata + relleno sobre ella), igual criterio de la hoja
    // de referencia: se suma al término axial de CADA combinación con el
    // MISMO factor que multiplica a CM en esa combinación (es carga muerta),
    // ya que sí contribuye a la presión de contacto bruta que la hoja usa
    // como presión de diseño uniforme "su" (a diferencia de la presión NETA
    // usada en el resto de esta herramienta quando no hay sismo).
    const gamma_s = kgm3ToKnm3(foundation.gamma_kgm3);
    const gamma_c = kgm3ToKnm3(materials.gamma_c_kgm3);
    const A0 = L * B;
    const selfWeight = gamma_c * A0 * isolated.h + gamma_s * A0 * Math.max(0, isolated.Df - isolated.h);

    const cases = [
      { label: '1.4CM+1.7CV', N: LF_D * Pd + LF_L * Pl + LF_D * selfWeight, Mx: LF_D * Mxd + LF_L * Mxl, My: LF_D * Myd + LF_L * Myl },
      { label: '1.25(CM+CV)+SXD', N: 1.25 * (Pd + Pl) + Psx + 1.25 * selfWeight, Mx: 1.25 * (Mxd + Mxl) + Mx_sx, My: 1.25 * (Myd + Myl) + My_sx },
      { label: '1.25(CM+CV)−SXD', N: 1.25 * (Pd + Pl) - Psx + 1.25 * selfWeight, Mx: 1.25 * (Mxd + Mxl) - Mx_sx, My: 1.25 * (Myd + Myl) - My_sx },
      { label: '1.25(CM+CV)+SYD', N: 1.25 * (Pd + Pl) + Psy + 1.25 * selfWeight, Mx: 1.25 * (Mxd + Mxl) + Mx_sy, My: 1.25 * (Myd + Myl) + My_sy },
      { label: '1.25(CM+CV)−SYD', N: 1.25 * (Pd + Pl) - Psy + 1.25 * selfWeight, Mx: 1.25 * (Mxd + Mxl) - Mx_sy, My: 1.25 * (Myd + Myl) - My_sy },
      { label: '0.9CM+SXD', N: 0.9 * Pd + Psx + 0.9 * selfWeight, Mx: 0.9 * Mxd + Mx_sx, My: 0.9 * Myd + My_sx },
      { label: '0.9CM−SXD', N: 0.9 * Pd - Psx + 0.9 * selfWeight, Mx: 0.9 * Mxd - Mx_sx, My: 0.9 * Myd - My_sx },
      { label: '0.9CM+SYD', N: 0.9 * Pd + Psy + 0.9 * selfWeight, Mx: 0.9 * Mxd + Mx_sy, My: 0.9 * Myd + My_sy },
      { label: '0.9CM−SYD', N: 0.9 * Pd - Psy + 0.9 * selfWeight, Mx: 0.9 * Mxd - Mx_sy, My: 0.9 * Myd - My_sy },
    ];
    const env = evaluateEnvelope(cases, L, B);
    envelope = {
      rows: env.rows.map((r) => ({ ...r, q_governing_kgcm2: kpaToKgcm2(r.q_governing) })),
      uses_rectangular: env.uses_rectangular,
      su: env.governing_q,
      su_kgcm2: kpaToKgcm2(env.governing_q),
      governingRow: env.governingRow,
    };
    // "su" ya es la presión de diseño (envolvente), aplicada de forma
    // UNIFORME sobre toda el área — se traduce a una carga puntual
    // equivalente Pu = su·A sin momento, para que designFootingSlab la
    // reparta con la misma mecánica de siempre (cantiléver con presión
    // constante en vez de variable).
    Pu = env.governing_q * L * B;
    Mu_x = 0;
    Mu_y = 0;
  } else {
    Pu = LF_D * tnToKn(isolated.Pd) + LF_L * tnToKn(isolated.Pl);
    Mu_x = LF_D * tnToKn(isolated.Mx_d) + LF_L * tnToKn(isolated.Mx_l);
    Mu_y = LF_D * tnToKn(isolated.My_d) + LF_L * tnToKn(isolated.My_l);
  }

  const result = designFootingSlab({
    L: isolated.L, B: isolated.B, h: isolated.h,
    col_L: isolated.col_L, col_B: isolated.col_B,
    ex_col: isolated.ex_col || 0, ey_col: isolated.ey_col || 0,
    Pu, Mu_x, Mu_y, alphaS,
    fc: kgcm2ToMpa(materials.fc_kgcm2), fy: kgcm2ToMpa(materials.fy_kgcm2),
    fc_kgcm2: materials.fc_kgcm2, fy_kgcm2: materials.fy_kgcm2,
    cover: materials.cover_footing,
    dbMain, rebarTrans,
  });
  result.hasSeismic = hasSeismic;
  result.envelope = envelope;
  return result;
}
