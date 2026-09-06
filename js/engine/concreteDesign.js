/**
 * Utilidades de diseño en concreto armado (Norma E.060 / ACI 318),
 * compartidas por el motor de zapata aislada y de zapata combinada: acero
 * requerido por flexión (con cuantía mínima), espaciamiento comercial y
 * capacidad a cortante (una y dos direcciones).
 */

export const PHI_FLEX = 0.90;
export const PHI_SHEAR = 0.85; // E.060 9.3.2 (corte y punzonamiento)

/** Gancho estándar a 90° de una barra principal (E.060 / ACI 318 25.3.1):
 * extensión de 12·db más allá del doblez, para todo diámetro. Usado tanto
 * para el metrado (cuadro de habilitación) como para dibujar el doblez en
 * los visualizadores 2D/3D. */
export function hookMainBar_m(diameter_m) {
  return Math.max(0.10, diameter_m * 12.0);
}

/** Gancho de estribo (E.060 / ACI 318 25.3.2): la extensión depende del
 * diámetro de la propia barra transversal — 6·db para Ø ≤ 5/8" (15.9 mm),
 * 12·db para diámetros mayores (estribos de barra gruesa, poco usuales). */
export function hookStirrup_m(diameter_mm, diameter_m) {
  const factor = diameter_mm <= 15.9 ? 6.0 : 12.0;
  return Math.max(0.075, diameter_m * factor);
}

/**
 * Acero requerido por flexión para una franja de ancho b_m. El acero
 * mínimo depende del tipo de elemento:
 *   - Losa/zapata (se pasa `h_m`, el peralte TOTAL bruto): ACI 318
 *     7.6.1.1 / 8.6.1.1 remiten al mínimo de retracción y temperatura
 *     (24.4.3.2) — 0.0018·b·h — NO al mínimo de viga (confirmado contra
 *     la hoja de cálculo de referencia Efrén, que solo aplica este
 *     mínimo). Aplicar el mínimo de viga aquí sobre-diseña el acero de
 *     zapatas de forma significativa e incorrecta.
 *   - Viga (no se pasa `h_m`, p.ej. una viga de conexión/strap beam): ACI
 *     318 9.6.1.2 — max(0.25√f'c/fy, 1.4/fy) sobre el peralte EFECTIVO b·d.
 */
export function calcRequiredRebar(Mu_kNm, fc_MPa, fy_MPa, b_m, d_m, phi = PHI_FLEX, h_m = null) {
  const Mu = Math.max(0.001, Mu_kNm);
  const b_cm = b_m * 100.0;
  const d_cm = d_m * 100.0;

  const Mu_Nmm = Mu * 1e6;
  const b_mm = b_m * 1000.0;
  const d_mm = d_m * 1000.0;

  const Rn = Mu_Nmm / (phi * b_mm * Math.pow(d_mm, 2));

  let rho;
  const discr = 1.0 - (2.0 * Rn) / (0.85 * fc_MPa);
  if (discr > 0) {
    rho = (0.85 * fc_MPa / fy_MPa) * (1.0 - Math.sqrt(discr));
  } else {
    rho = 0.025; // sección insuficiente: se reporta una cuantía alta para que la verificación falle visiblemente
  }

  const As_calc = rho * b_cm * d_cm;

  let As_min, rho_min;
  if (h_m !== null) {
    As_min = 0.0018 * b_cm * (h_m * 100.0);
    rho_min = As_min / (b_cm * d_cm);
  } else {
    const rho_min1 = (0.25 * Math.sqrt(fc_MPa)) / fy_MPa;
    const rho_min2 = 1.4 / fy_MPa;
    rho_min = Math.max(rho_min1, rho_min2);
    As_min = rho_min * b_cm * d_cm;
  }

  const As_design = Math.max(As_calc, As_min);
  const rho_design = As_design / (b_cm * d_cm);

  const a_cm = (As_design * (fy_MPa / 10.0)) / (0.85 * (fc_MPa / 10.0) * b_cm);

  return { Mu_kNm, Rn, rho, rho_min, rho_design, a_cm, As_calc, As_min, As_design };
}

/** Espaciamiento comercial (redondeado hacia abajo a un valor constructivo estándar, en cm) que satisface el área de acero requerida por metro. */
export function calcSpacing(As_req_cm2_m, rebar_area_cm2) {
  if (As_req_cm2_m <= 0.01) return 25.0;
  const raw_spacing = (rebar_area_cm2 * 100.0) / As_req_cm2_m;
  const standard_spacings = [7.5, 10.0, 12.5, 15.0, 17.5, 20.0, 22.5, 25.0, 30.0];
  for (const s of standard_spacings) {
    if (s <= raw_spacing) continue;
    const idx = standard_spacings.indexOf(s);
    return idx > 0 ? standard_spacings[idx - 1] : 7.5;
  }
  return 30.0;
}

/**
 * Longitud de desarrollo en TRACCIÓN para barras corrugadas (E.060 25.4.2 /
 * ACI 318 25.4.2.3, caso "espaciamiento libre ≥ db y recubrimiento ≥ db,
 * o con estribos mínimos" — el caso simplificado usual en la memoria de
 * referencia UNI, sin refinar por Ψs/confinamiento). fy y f'c en kg/cm²,
 * db en mm; resultado en cm. Ψt=Ψe=λ=1 (caso normal: barra inferior, sin
 * epóxico, concreto de peso normal).
 */
export function ldTraccion_cm(fy_kgcm2, fc_kgcm2, db_mm, { psi_t = 1.0, psi_e = 1.0, lambda = 1.0 } = {}) {
  const db_cm = db_mm / 10.0;
  const divisor = db_mm <= 22.2 ? 8.2 : 6.6; // ≤ 7/8" u.8.2 ; ≥ 1" -> 6.6 (E.060 Tabla 25.4.2.3)
  return Math.max(30.0, ((fy_kgcm2 * psi_t * psi_e * lambda) / (divisor * Math.sqrt(fc_kgcm2))) * db_cm);
}

/**
 * Longitud de desarrollo en COMPRESIÓN para barras corrugadas (E.060
 * 25.4.9 / ACI 318 25.4.9.2) — el mayor de dos expresiones, en cm. Usada
 * para verificar el anclaje de las barras de la columna (dowels) que
 * penetran en la zapata.
 */
export function ldCompresion_cm(fy_kgcm2, fc_kgcm2, db_mm) {
  const db_cm = db_mm / 10.0;
  const l1 = (0.075 * fy_kgcm2 / Math.sqrt(fc_kgcm2)) * db_cm;
  const l2 = 0.0044 * fy_kgcm2 * db_cm;
  return Math.max(20.0, l1, l2);
}

/**
 * Verificación de aplastamiento (bearing) en la interfaz columna-zapata
 * (E.060 10.17 / ACI 318 22.8) y, si no cumple, el acero de arranque
 * (dowels) requerido para transmitir el excedente de carga. A2 es el área
 * de la base mayor de la pirámide troncal a 2:1 contenida en la zapata —
 * en la práctica, y siguiendo la memoria de referencia, el área total de
 * la zapata (L·B) cuando esta cabe geométricamente (caso usual).
 */
export function verificarAplastamiento(Pu_kg, fc_kgcm2, A1_col_cm2, A2_zap_cm2, fy_kgcm2, phi = 0.70) {
  const ratio = Math.min(2.0, Math.sqrt(A2_zap_cm2 / A1_col_cm2));
  const phiPn = phi * 0.85 * fc_kgcm2 * A1_col_cm2 * ratio;
  const pass = phiPn >= Pu_kg;
  let As_dowel_cm2 = 0;
  if (!pass) {
    const phiPdowel = Pu_kg - phiPn;
    As_dowel_cm2 = phiPdowel / (phi * fy_kgcm2);
  }
  return { ratio, phiPn, pass, As_dowel_cm2 };
}

/** Capacidad a cortante por corte en una dirección (viga ancha), Vc = 0.53√f'c·b·d (kg, cm), convertida a kN. */
export function oneWayShearCapacity_kN(fc_kgcm2, b_m, d_m) {
  const Vc_kg = 0.53 * Math.sqrt(fc_kgcm2) * (b_m * 100.0) * (d_m * 100.0);
  return (Vc_kg * 9.80665) / 1000.0;
}

/**
 * Capacidad a punzonamiento (corte en dos direcciones), tomando el menor de
 * las tres expresiones de E.060 9.9.2 / ACI 318:
 *   Vc1 = 0.53(1 + 2/βc)√f'c·bo·d
 *   Vc2 = 0.27(αs·d/bo + 2)√f'c·bo·d
 *   Vc3 = 1.06√f'c·bo·d
 * βc = relación lado mayor/lado menor de la columna; αs = 40 (columna
 * interior — perímetro crítico completo, caso de una zapata aislada).
 */
export function punchingShearCapacity_kN(fc_kgcm2, bo_m, d_m, betaC, alphaS = 40) {
  const bo_cm = bo_m * 100.0;
  const d_cm = d_m * 100.0;
  const sqfc = Math.sqrt(fc_kgcm2);
  const Vc1_kg = 0.53 * (1 + 2 / betaC) * sqfc * bo_cm * d_cm;
  const Vc2_kg = 0.27 * (alphaS * d_cm / bo_cm + 2) * sqfc * bo_cm * d_cm;
  const Vc3_kg = 1.06 * sqfc * bo_cm * d_cm;
  const Vc_kg = Math.min(Vc1_kg, Vc2_kg, Vc3_kg);
  return {
    Vc_kN: (Vc_kg * 9.80665) / 1000.0,
    Vc1_kN: (Vc1_kg * 9.80665) / 1000.0,
    Vc2_kN: (Vc2_kg * 9.80665) / 1000.0,
    Vc3_kN: (Vc3_kg * 9.80665) / 1000.0,
  };
}

/**
 * Analiza una franja en voladizo bajo una presión de contacto que varía
 * linealmente con la posición, q(ξ), desde la cara de la columna (faceX)
 * hasta el borde de la zapata (edgeX) — exacto para variación lineal de
 * presión (se reduce a q·Lc²/2 cuando la presión es uniforme). `d` es el
 * peralte efectivo de esa dirección; el cortante se evalúa a distancia d de
 * la cara (sección crítica, E.060 / ACI 318).
 */
export function analyzeCantileverStrip(qFunc, faceX, edgeX, d, widthPerp) {
  const Lc = Math.abs(edgeX - faceX);
  const dir = edgeX >= faceX ? 1 : -1;
  const q_face = qFunc(faceX);
  const q_edge = qFunc(edgeX);
  const M = widthPerp * Lc * Lc * (q_face + 2 * q_edge) / 6.0;
  const Lc_minus_d = Math.max(0, Lc - d);
  const dSection = faceX + dir * Math.min(d, Lc);
  const q_d = qFunc(dSection);
  const V = widthPerp * (q_d + q_edge) / 2.0 * Lc_minus_d;
  return { Lc, q_face, q_edge, M, V, Lc_minus_d };
}
