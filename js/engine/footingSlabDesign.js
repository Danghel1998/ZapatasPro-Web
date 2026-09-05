/**
 * Diseño estructural genérico de una losa de zapata rectangular (E.060 /
 * ACI 318): punzonamiento (corte en dos direcciones), corte en una
 * dirección en ambos ejes, flexión en ambas direcciones con la
 * distribución en franjas de ACI 318 15.4.4 para el lado corto, y longitud
 * de desarrollo disponible. Es el núcleo de cálculo compartido por la
 * zapata aislada y por cada una de las dos zapatas de una zapata
 * conectada (ambas se diseñan igual que una aislada una vez que se conoce
 * su presión de contacto neta mayorada, uniforme o con excentricidad).
 *
 * La presión de contacto usada aquí es la NETA mayorada (Pu de la columna
 * / área, más el momento Mu si lo hay), sin el peso propio de la zapata ni
 * del relleno: ese peso se equilibra con una reacción del suelo igual y
 * uniformemente distribuida bajo el área que ocupa, por lo que no induce
 * flexión ni cortante adicional en la losa (simplificación estándar).
 *
 * Excepción: cuando el caso incluye sismo, isolatedFooting.js arma "Pu" a
 * partir de la presión de diseño "su" de la envolvente de 9 combinaciones
 * (que sí incluye el peso propio, igual que la hoja de cálculo real de
 * referencia), aplicada de forma uniforme — el efecto es una presión de
 * diseño ligeramente mayor y del lado conservador.
 */

import {
  calcRequiredRebar, calcSpacing, ldTraccion_cm, ldCompresion_cm, verificarAplastamiento,
  oneWayShearCapacity_kN, punchingShearCapacity_kN, analyzeCantileverStrip,
  PHI_FLEX, PHI_SHEAR,
} from './concreteDesign.js';

/**
 * @param {object} p
 * @param {number} p.L, p.B, p.h - dimensiones de la losa (m)
 * @param {number} p.col_L, p.col_B - dimensiones de la columna (m)
 * @param {number} [p.ex_col], [p.ey_col] - excentricidad de la columna respecto al centro de la losa (m)
 * @param {number} p.Pu - carga axial última de la columna (kN)
 * @param {number} [p.Mu_x], [p.Mu_y] - momento último (kN·m) que genera excentricidad en L (Mu_x) y en B (Mu_y)
 * @param {number} p.fc_kgcm2, p.fy_kgcm2 - resistencias (kg/cm²)
 * @param {number} p.fc, p.fy - resistencias (MPa)
 * @param {number} p.cover - recubrimiento libre (m)
 * @param {object} p.dbMain - barra principal (de REBAR_TABLE)
 * @param {object} p.rebarTrans - barra de banda/temperatura (de REBAR_TABLE)
 */
export function designFootingSlab(p) {
  const { L, B, h, col_L, col_B, Pu, fc, fy, fc_kgcm2, cover, dbMain, rebarTrans } = p;
  const ex_col = p.ex_col || 0, ey_col = p.ey_col || 0;
  const Mu_x = p.Mu_x || 0, Mu_y = p.Mu_y || 0;
  const alphaS = p.alphaS || 40; // 40 interior, 30 borde/medianera, 20 esquinera (E.060 / ACI 318)
  const A = L * B;

  const qL = (x) => Pu / A + (12 * Mu_x * x) / (B * Math.pow(L, 3));
  const qB = (y) => Pu / A + (12 * Mu_y * y) / (L * Math.pow(B, 3));

  const isLLong = L >= B;
  const d_layer1 = h - cover - dbMain.diameter_m / 2.0;
  const d_layer2 = h - cover - dbMain.diameter_m - dbMain.diameter_m / 2.0;
  const d_L = isLLong ? d_layer1 : d_layer2;
  const d_B = isLLong ? d_layer2 : d_layer1;

  const faceL_pos = ex_col + col_L / 2.0, edgeL_pos = L / 2.0;
  const faceL_neg = ex_col - col_L / 2.0, edgeL_neg = -L / 2.0;
  const stripL_pos = analyzeCantileverStrip(qL, faceL_pos, edgeL_pos, d_L, B);
  const stripL_neg = analyzeCantileverStrip(qL, faceL_neg, edgeL_neg, d_L, B);
  const stripL = stripL_pos.M >= stripL_neg.M ? { ...stripL_pos, side: 'positivo (+X)' } : { ...stripL_neg, side: 'negativo (−X)' };
  const stripL_shear = stripL_pos.V >= stripL_neg.V ? stripL_pos : stripL_neg;

  const flexL = calcRequiredRebar(stripL.M, fc, fy, B, d_L, PHI_FLEX, h);
  const AsL_per_m = flexL.As_design / B;
  const VcL = oneWayShearCapacity_kN(fc_kgcm2, B, d_L);
  const phiVcL = PHI_SHEAR * VcL;
  const pass_shear_L = stripL_shear.V <= phiVcL;

  const faceB_pos = ey_col + col_B / 2.0, edgeB_pos = B / 2.0;
  const faceB_neg = ey_col - col_B / 2.0, edgeB_neg = -B / 2.0;
  const stripB_pos = analyzeCantileverStrip(qB, faceB_pos, edgeB_pos, d_B, L);
  const stripB_neg = analyzeCantileverStrip(qB, faceB_neg, edgeB_neg, d_B, L);
  const stripB = stripB_pos.M >= stripB_neg.M ? { ...stripB_pos, side: 'positivo (+Y)' } : { ...stripB_neg, side: 'negativo (−Y)' };
  const stripB_shear = stripB_pos.V >= stripB_neg.V ? stripB_pos : stripB_neg;

  const flexB = calcRequiredRebar(stripB.M, fc, fy, L, d_B, PHI_FLEX, h);
  const AsB_per_m = flexB.As_design / L;
  const VcB = oneWayShearCapacity_kN(fc_kgcm2, L, d_B);
  const phiVcB = PHI_SHEAR * VcB;
  const pass_shear_B = stripB_shear.V <= phiVcB;

  const shortSide = Math.min(L, B);
  const longSide = Math.max(L, B);
  const beta = longSide / shortSide;
  const bandFactor = 2.0 / (beta + 1.0);
  const shortIsL = !isLLong;

  const shortFlex = shortIsL ? flexL : flexB;
  const shortRunLength = shortIsL ? B : L;
  const As_short_band = bandFactor * shortFlex.As_design;
  const As_short_outer_total = shortFlex.As_design - As_short_band;
  const outerWidthEach = Math.max(0.01, (shortRunLength - shortSide) / 2.0);
  const As_short_band_per_m = As_short_band / shortSide;
  const As_short_outer_per_m = outerWidthEach > 0.01 ? As_short_outer_total / (2 * outerWidthEach) : 0;

  const sp_short_band = calcSpacing(As_short_band_per_m, dbMain.area_cm2);
  const sp_short_outer = As_short_outer_per_m > 0.01 ? calcSpacing(As_short_outer_per_m, dbMain.area_cm2) : null;
  const sp_long_uniform = calcSpacing(shortIsL ? AsB_per_m : AsL_per_m, dbMain.area_cm2);

  // Perímetro crítico de punzonamiento (a d/2 de cada cara de la columna),
  // recortado a lo que realmente cabe dentro de la losa: si la columna es
  // de borde o esquina (cara al ras del borde de la zapata), no hay
  // concreto más allá de esa cara para que se desarrolle el d/2 de
  // extensión, así que ese lado del perímetro queda con offset 0 en vez de
  // extenderse fuera de la losa. Para una columna interior (o cualquier
  // holgura ≥ d/2) esto se reduce exactamente a la fórmula de 4 lados
  // completos de siempre.
  const d_avg = (d_L + d_B) / 2.0;
  const halfD = d_avg / 2.0;
  const offXpos = Math.min(halfD, Math.max(0, L / 2.0 - (ex_col + col_L / 2.0)));
  const offXneg = Math.min(halfD, Math.max(0, (ex_col - col_L / 2.0) + L / 2.0));
  const offYpos = Math.min(halfD, Math.max(0, B / 2.0 - (ey_col + col_B / 2.0)));
  const offYneg = Math.min(halfD, Math.max(0, (ey_col - col_B / 2.0) + B / 2.0));
  const critWidthX = col_L + offXpos + offXneg;
  const critWidthY = col_B + offYpos + offYneg;
  const bo = 2 * critWidthX + 2 * critWidthY;
  const areaWithinPerimeter = critWidthX * critWidthY;
  const q_u_avg = Pu / A;
  const Vu_punch = Math.max(0, Pu - q_u_avg * areaWithinPerimeter);
  const betaC = Math.max(col_L, col_B) / Math.min(col_L, col_B);
  const punchCap = punchingShearCapacity_kN(fc_kgcm2, bo, d_avg, betaC, alphaS);
  const phiVc_punch = PHI_SHEAR * punchCap.Vc_kN;
  const pass_punching = Vu_punch <= phiVc_punch;

  const ld_req_cm = ldTraccion_cm(p.fy_kgcm2, fc_kgcm2, dbMain.diameter_mm);
  const ld_avail_L_cm = Math.max(stripL_pos.Lc, stripL_neg.Lc) * 100.0 - cover * 100.0;
  const ld_avail_B_cm = Math.max(stripB_pos.Lc, stripB_neg.Lc) * 100.0 - cover * 100.0;
  const pass_ld_L = ld_avail_L_cm >= ld_req_cm;
  const pass_ld_B = ld_avail_B_cm >= ld_req_cm;

  // -------------------------------------------------------------------
  // APLASTAMIENTO columna-zapata (E.060 10.17 / ACI 318 22.8) y longitud de
  // desarrollo en compresión de las barras de la columna que penetran en
  // la zapata (dowels) — se asume el mismo diámetro de barra que el acero
  // principal de la zapata, ya que esta herramienta no modela el refuerzo
  // propio de la columna.
  // -------------------------------------------------------------------
  const Pu_kg = (Pu * 1000.0) / 9.80665;
  const A1_col_cm2 = (col_L * 100.0) * (col_B * 100.0);
  const A2_zap_cm2 = (L * 100.0) * (B * 100.0);
  const aplastamiento = verificarAplastamiento(Pu_kg, fc_kgcm2, A1_col_cm2, A2_zap_cm2, p.fy_kgcm2);

  const ldc_req_cm = ldCompresion_cm(p.fy_kgcm2, fc_kgcm2, dbMain.diameter_mm);
  const ldc_avail_cm = h * 100.0 - cover * 100.0 - dbMain.diameter_mm / 10.0;
  const pass_ldc = ldc_avail_cm >= ldc_req_cm;

  return {
    L, B, h, col_L, col_B, Pu, Mu_x, Mu_y, A, d_L, d_B, d_avg, isLLong, beta, bandFactor, shortIsL, shortSide, longSide,
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
      ldc_req_cm, ldc_avail_cm, pass_ldc,
    },
    aplastamiento,
    fc, fy, fc_kgcm2, fy_kgcm2: p.fy_kgcm2,
    pass_all_structural: pass_shear_L && pass_shear_B && pass_punching && pass_ld_L && pass_ld_B && pass_ldc,
  };
}
