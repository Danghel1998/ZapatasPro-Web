/**
 * Utilidades de diseño en concreto armado (Norma E.060 / ACI 318),
 * compartidas por el motor de zapata aislada y de zapata combinada: acero
 * requerido por flexión (con cuantía mínima), espaciamiento comercial y
 * capacidad a cortante (una y dos direcciones).
 */

export const PHI_FLEX = 0.90;
export const PHI_SHEAR = 0.85; // E.060 9.3.2 (corte y punzonamiento)

/**
 * Acero requerido por flexión para una franja de ancho b_m, con la cuantía
 * mínima de losas/zapatas (E.060 9.7 / ACI 318 7.6.1, 0.18% como piso).
 */
export function calcRequiredRebar(Mu_kNm, fc_MPa, fy_MPa, b_m, d_m, phi = PHI_FLEX) {
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

  const rho_min1 = (0.25 * Math.sqrt(fc_MPa)) / fy_MPa;
  const rho_min2 = 1.4 / fy_MPa;
  const rho_min = Math.max(0.0018, Math.max(rho_min1, rho_min2));

  const rho_design = Math.max(rho, rho_min);

  const As_calc = rho * b_cm * d_cm;
  const As_min = rho_min * b_cm * d_cm;
  const As_design = rho_design * b_cm * d_cm;

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

/** Longitud de desarrollo básica en tracción (fórmula simplificada usual en cursos de la UNI), en cm. */
export function ldBasic_cm(fy_MPa, fc_MPa, db_mm) {
  return Math.max(30.0, (fy_MPa / (2.1 * Math.sqrt(fc_MPa))) * (db_mm / 10.0) * 1.3);
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
