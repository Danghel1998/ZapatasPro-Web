/**
 * Motor de diseño estructural de una zapata AISLADA (Norma E.060 / ACI 318).
 * Traduce los datos de entrada (isolated.*, en tn/tn·m) a los parámetros
 * factorados que necesita el diseño genérico de losa de zapata
 * (designFootingSlab, en kN/kN·m) — ver ese archivo para el detalle del
 * cálculo (punzonamiento, corte en una dirección, flexión con bandas,
 * longitud de desarrollo).
 */

import { REBAR_TABLE } from '../constants.js';
import { tnToKn, kgcm2ToMpa } from './units.js';
import { designFootingSlab } from './footingSlabDesign.js';

export function calculateIsolatedStructural(footingData) {
  const { isolated, materials, safety_req } = footingData;
  const dbMain = REBAR_TABLE[materials.rebar_main_id] ?? REBAR_TABLE[2];
  const rebarTrans = REBAR_TABLE[materials.rebar_trans_id] ?? REBAR_TABLE[1];

  const LF_D = safety_req.LF_D ?? 1.2;
  const LF_L = safety_req.LF_L ?? 1.6;

  const Pu = LF_D * tnToKn(isolated.Pd) + LF_L * tnToKn(isolated.Pl);
  const Mu_x = LF_D * tnToKn(isolated.Mx_d) + LF_L * tnToKn(isolated.Mx_l);
  const Mu_y = LF_D * tnToKn(isolated.My_d) + LF_L * tnToKn(isolated.My_l);

  return designFootingSlab({
    L: isolated.L, B: isolated.B, h: isolated.h,
    col_L: isolated.col_L, col_B: isolated.col_B,
    ex_col: isolated.ex_col || 0, ey_col: isolated.ey_col || 0,
    Pu, Mu_x, Mu_y,
    fc: kgcm2ToMpa(materials.fc_kgcm2), fy: kgcm2ToMpa(materials.fy_kgcm2),
    fc_kgcm2: materials.fc_kgcm2, fy_kgcm2: materials.fy_kgcm2,
    cover: materials.cover_footing,
    dbMain, rebarTrans,
  });
}
