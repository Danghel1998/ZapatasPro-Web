/**
 * Motor de diseño estructural de una zapata AISLADA (Norma E.060 / ACI 318):
 * punzonamiento (corte en dos direcciones), corte en una dirección (viga
 * ancha) en ambos ejes, flexión en ambas direcciones (con la distribución
 * en franjas de ACI 318 15.4.4 para el lado corto) y longitud de
 * desarrollo disponible.
 *
 * La presión de contacto usada para diseño estructural es la NETA
 * mayorada (Pu de la columna / área), sin el peso propio de la zapata ni
 * del relleno: ese peso se equilibra con una reacción del suelo igual y
 * uniformemente distribuida bajo el área que ocupa, por lo que no induce
 * flexión ni cortante adicional en la losa de la zapata (simplificación
 * estándar en el diseño de zapatas).
 */

import { REBAR_TABLE } from '../constants.js';
import { tnToKn, kgcm2ToMpa } from './units.js';
import {
  calcRequiredRebar, calcSpacing, ldBasic_cm,
  oneWayShearCapacity_kN, punchingShearCapacity_kN, analyzeCantileverStrip,
  PHI_FLEX, PHI_SHEAR,
} from './concreteDesign.js';

export function calculateIsolatedStructural(footingData) {
  const { isolated, materials, safety_req } = footingData;
  const { L, B, h } = isolated;
  const col_L = isolated.col_L, col_B = isolated.col_B;
  const ex_col = isolated.ex_col || 0, ey_col = isolated.ey_col || 0;

  const fc_kgcm2 = materials.fc_kgcm2;
  const fy_kgcm2 = materials.fy_kgcm2;
  const fc = kgcm2ToMpa(fc_kgcm2);
  const fy = kgcm2ToMpa(fy_kgcm2);
  const cover = materials.cover_footing;
  const dbMain = REBAR_TABLE[materials.rebar_main_id] ?? REBAR_TABLE[2];

  const LF_D = safety_req.LF_D ?? 1.2;
  const LF_L = safety_req.LF_L ?? 1.6;

  // Cargas factoradas en la base de la columna
  const Pu = LF_D * tnToKn(isolated.Pd) + LF_L * tnToKn(isolated.Pl);
  const Mu_x = LF_D * tnToKn(isolated.Mx_d) + LF_L * tnToKn(isolated.Mx_l);
  const Mu_y = LF_D * tnToKn(isolated.My_d) + LF_L * tnToKn(isolated.My_l);

  const A = L * B;

  // Presión de contacto neta mayorada, variando linealmente si hay momento
  // (cada dirección se evalúa con su propia excentricidad, ignorando el
  // acoplamiento cruzado — simplificación estándar en zapatas con flexión
  // biaxial moderada).
  const qL = (x) => Pu / A + (12 * Mu_x * x) / (B * Math.pow(L, 3));
  const qB = (y) => Pu / A + (12 * Mu_y * y) / (L * Math.pow(B, 3));

  // ¿Cuál lado es el "largo"? Rige la ubicación de capas (la dirección
  // larga va en la capa inferior, de mayor peralte) y el ancho de banda de
  // ACI 318 15.4.4 para el lado corto.
  const isLLong = L >= B;
  const d_layer1 = h - cover - dbMain.diameter_m / 2.0; // capa inferior (dirección larga)
  const d_layer2 = h - cover - dbMain.diameter_m - dbMain.diameter_m / 2.0; // capa superior (dirección corta)
  const d_L = isLLong ? d_layer1 : d_layer2;
  const d_B = isLLong ? d_layer2 : d_layer1;

  // -------------------------------------------------------------------
  // 1. FLEXIÓN Y CORTE EN UNA DIRECCIÓN — franja "L" (voladizo a lo largo de L)
  // -------------------------------------------------------------------
  const faceL_pos = ex_col + col_L / 2.0, edgeL_pos = L / 2.0;
  const faceL_neg = ex_col - col_L / 2.0, edgeL_neg = -L / 2.0;
  const stripL_pos = analyzeCantileverStrip(qL, faceL_pos, edgeL_pos, d_L, B);
  const stripL_neg = analyzeCantileverStrip(qL, faceL_neg, edgeL_neg, d_L, B);
  const stripL = stripL_pos.M >= stripL_neg.M ? { ...stripL_pos, side: 'positivo (+X)' } : { ...stripL_neg, side: 'negativo (−X)' };
  const stripL_shear = stripL_pos.V >= stripL_neg.V ? stripL_pos : stripL_neg;

  const flexL = calcRequiredRebar(stripL.M, fc, fy, B, d_L, PHI_FLEX); // As total (cm²) a lo largo de B
  const AsL_per_m = flexL.As_design / B;
  const VcL = oneWayShearCapacity_kN(fc_kgcm2, B, d_L);
  const phiVcL = PHI_SHEAR * VcL;
  const pass_shear_L = stripL_shear.V <= phiVcL;

  // -------------------------------------------------------------------
  // 2. FLEXIÓN Y CORTE EN UNA DIRECCIÓN — franja "B" (voladizo a lo largo de B)
  // -------------------------------------------------------------------
  const faceB_pos = ey_col + col_B / 2.0, edgeB_pos = B / 2.0;
  const faceB_neg = ey_col - col_B / 2.0, edgeB_neg = -B / 2.0;
  const stripB_pos = analyzeCantileverStrip(qB, faceB_pos, edgeB_pos, d_B, L);
  const stripB_neg = analyzeCantileverStrip(qB, faceB_neg, edgeB_neg, d_B, L);
  const stripB = stripB_pos.M >= stripB_neg.M ? { ...stripB_pos, side: 'positivo (+Y)' } : { ...stripB_neg, side: 'negativo (−Y)' };
  const stripB_shear = stripB_pos.V >= stripB_neg.V ? stripB_pos : stripB_neg;

  const flexB = calcRequiredRebar(stripB.M, fc, fy, L, d_B, PHI_FLEX); // As total (cm²) a lo largo de L
  const AsB_per_m = flexB.As_design / L;
  const VcB = oneWayShearCapacity_kN(fc_kgcm2, L, d_B);
  const phiVcB = PHI_SHEAR * VcB;
  const pass_shear_B = stripB_shear.V <= phiVcB;

  // -------------------------------------------------------------------
  // 3. DISTRIBUCIÓN EN FRANJAS DEL LADO CORTO (ACI 318 15.4.4.2 / E.060):
  //    2/(β+1) del acero del lado corto va en una banda central de ancho
  //    igual al lado corto, centrada en la columna; el resto se reparte
  //    uniformemente en las dos franjas exteriores.
  // -------------------------------------------------------------------
  const shortSide = Math.min(L, B);
  const longSide = Math.max(L, B);
  const beta = longSide / shortSide;
  const bandFactor = 2.0 / (beta + 1.0);

  // ¿La dirección L o la B es la "corta" (la que se distribuye en banda)?
  const shortIsL = !isLLong;

  const shortFlex = shortIsL ? flexL : flexB;
  const shortRunLength = shortIsL ? B : L; // longitud total sobre la que se reparte el acero de esa dirección
  const As_short_band = bandFactor * shortFlex.As_design;
  const As_short_outer_total = shortFlex.As_design - As_short_band;
  const outerWidthEach = Math.max(0.01, (shortRunLength - shortSide) / 2.0);
  const As_short_band_per_m = As_short_band / shortSide;
  const As_short_outer_per_m = outerWidthEach > 0.01 ? As_short_outer_total / (2 * outerWidthEach) : 0;

  const rebarTrans = REBAR_TABLE[materials.rebar_trans_id] ?? REBAR_TABLE[1];
  const sp_short_band = calcSpacing(As_short_band_per_m, dbMain.area_cm2);
  const sp_short_outer = As_short_outer_per_m > 0.01 ? calcSpacing(As_short_outer_per_m, dbMain.area_cm2) : null;
  const sp_long_uniform = calcSpacing(shortIsL ? AsB_per_m : AsL_per_m, dbMain.area_cm2);

  // -------------------------------------------------------------------
  // 4. PUNZONAMIENTO (CORTE EN DOS DIRECCIONES), perímetro crítico a d/2
  //    de las caras de la columna.
  // -------------------------------------------------------------------
  const d_avg = (d_L + d_B) / 2.0;
  const bo = 2 * (col_L + d_avg) + 2 * (col_B + d_avg);
  const areaWithinPerimeter = (col_L + d_avg) * (col_B + d_avg);
  const q_u_avg = Pu / A;
  const Vu_punch = Math.max(0, Pu - q_u_avg * areaWithinPerimeter);
  const betaC = Math.max(col_L, col_B) / Math.min(col_L, col_B);
  const punchCap = punchingShearCapacity_kN(fc_kgcm2, bo, d_avg, betaC, 40);
  const phiVc_punch = PHI_SHEAR * punchCap.Vc_kN;
  const pass_punching = Vu_punch <= phiVc_punch;

  // -------------------------------------------------------------------
  // 5. LONGITUD DE DESARROLLO DISPONIBLE (desde la cara de la columna
  //    hasta el borde, menos el recubrimiento)
  // -------------------------------------------------------------------
  const ld_req_cm = ldBasic_cm(fy, fc, dbMain.diameter_mm);
  const ld_avail_L_cm = Math.max(stripL_pos.Lc, stripL_neg.Lc) * 100.0 - cover * 100.0;
  const ld_avail_B_cm = Math.max(stripB_pos.Lc, stripB_neg.Lc) * 100.0 - cover * 100.0;
  const pass_ld_L = ld_avail_L_cm >= ld_req_cm;
  const pass_ld_B = ld_avail_B_cm >= ld_req_cm;

  return {
    Pu, Mu_x, Mu_y, A, d_L, d_B, d_avg, isLLong, beta, bandFactor, shortIsL, shortSide, longSide,
    dbMain, rebarTrans,
    L_dir: {
      strip: stripL, shear: stripL_shear, flex: flexL, As_per_m: AsL_per_m,
      Vc: VcL, phiVc: phiVcL, pass_shear: pass_shear_L,
      spacing: shortIsL ? null : sp_long_uniform,
    },
    B_dir: {
      strip: stripB, shear: stripB_shear, flex: flexB, As_per_m: AsB_per_m,
      Vc: VcB, phiVc: phiVcB, pass_shear: pass_shear_B,
      spacing: shortIsL ? sp_long_uniform : null,
    },
    banding: {
      As_band_per_m: As_short_band_per_m, sp_band: sp_short_band,
      As_outer_per_m: As_short_outer_per_m, sp_outer: sp_short_outer,
      bandWidth: shortSide, outerWidthEach,
    },
    punching: {
      bo, d_avg, areaWithinPerimeter, Vu: Vu_punch, betaC,
      Vc1: punchCap.Vc1_kN, Vc2: punchCap.Vc2_kN, Vc3: punchCap.Vc3_kN,
      Vc: punchCap.Vc_kN, phiVc: phiVc_punch, pass: pass_punching,
    },
    development: {
      ld_req_cm, ld_avail_L_cm, ld_avail_B_cm, pass_ld_L, pass_ld_B,
    },
    fc, fy, fc_kgcm2, fy_kgcm2,
    pass_all_structural: pass_shear_L && pass_shear_B && pass_punching && pass_ld_L && pass_ld_B,
  };
}
