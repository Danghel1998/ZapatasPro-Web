/**
 * Motor de diseño estructural de una zapata CONECTADA (Norma E.060 / ACI
 * 318), siguiendo la hoja de cálculo real de referencia (Efrén — "ZAPATA
 * CONECTADA.xlsx"): Zapata 1 (excéntrica, columna en el límite de
 * propiedad) + Zapata 2 (interior, concéntrica), unidas por una viga de
 * conexión ("strap beam") modelada como un elemento con dos cargas
 * puntuales (P1, P2, en las columnas) y dos reacciones puntuales (R1, R2,
 * en los centroides de cada zapata) — NO como una viga con carga
 * distribuida.
 *
 * La presión de diseño de cada zapata ("su1", "su2") se obtiene, igual
 * que la zapata aislada, de una envolvente de 9 combinaciones clásicas
 * E.060/ACI 318 (1.4CM+1.7CV, 1.25(CM+CV)±SXD/SYD, 0.9CM±SXD/SYD) sobre
 * la presión de contacto de cada zapata — con el sismo longitudinal
 * (SXD) redistribuido a través de la viga (mismo mecanismo que la
 * gravedad) y el sismo transversal (SYD) sumado DIRECTAMENTE a la
 * reacción de gravedad de cada zapata (no pasa por la viga). Cada su
 * se aplica de forma uniforme sobre su zapata (Pu = su·A, sin momento)
 * para el diseño por punzonamiento, corte y flexión — mismo criterio que
 * la zapata aislada, reutilizando designFootingSlab con la excentricidad
 * de columna de cada zapata para ubicar correctamente los voladizos.
 *
 * La viga de conexión se diseña con las 5 combinaciones que sí la
 * involucran (1.4CM+1.7CV, 1.25(CM+CV)±SXD, 0.9CM±SXD — el sismo
 * transversal no genera cortante/momento en la viga, según la hoja de
 * referencia), por flexión (acero superior e inferior, cada uno con su
 * propio momento envolvente, mínimo de VIGA 0.7√f'c/fy·b·d y máximo por
 * ductilidad 0.75·ρ_bal·b·d) y por corte (con estribos si el concreto
 * solo no alcanza).
 */

import { REBAR_TABLE } from '../constants.js';
import { tnToKn, kgcm2ToMpa, knToKg, kNmToKgm } from './units.js';
import { designFootingSlab } from './footingSlabDesign.js';
import { calcRequiredRebar, oneWayShearCapacity_kN, beamAsMin_cm2, beamAsMax_cm2, PHI_FLEX, PHI_SHEAR } from './concreteDesign.js';
import { evaluateEnvelope, simplifyConnectedRect } from './seismicEnvelope.js';
import { redistributeRigidBeam } from './soilBearing.js';

export function calculateConnectedStructural(footingData) {
  const { connected, materials, safety_req } = footingData;
  const { L1, B1, h1, L2, B2, h2, col1_L, col1_B, col2_L, col2_B, strap_width, strap_height } = connected;

  const fc_kgcm2 = materials.fc_kgcm2, fy_kgcm2 = materials.fy_kgcm2;
  const fc = kgcm2ToMpa(fc_kgcm2), fy = kgcm2ToMpa(fy_kgcm2);
  const cover = materials.cover_footing;
  const dbMain = REBAR_TABLE[materials.rebar_main_id] ?? REBAR_TABLE[2];
  const rebarTrans = REBAR_TABLE[materials.rebar_trans_id] ?? REBAR_TABLE[1];

  const LF_D = safety_req.LF_D ?? 1.4;
  const LF_L = safety_req.LF_L ?? 1.7;
  const fz = connected.fz ?? 0.1;

  const e1 = L1 / 2.0 - col1_L / 2.0;
  const sCentroid = connected.s + col1_L / 2.0 + col2_L / 2.0;
  const denom = sCentroid - e1;

  const Pd1 = tnToKn(connected.P1d), Pl1 = tnToKn(connected.P1l);
  const Mxd1 = tnToKn(connected.Mx1_d || 0), Mxl1 = tnToKn(connected.Mx1_l || 0);
  const Myd1 = tnToKn(connected.My1_d || 0), Myl1 = tnToKn(connected.My1_l || 0);
  const Pd2 = tnToKn(connected.P2d), Pl2 = tnToKn(connected.P2l);
  const Mxd2 = tnToKn(connected.Mx2_d || 0), Mxl2 = tnToKn(connected.Mx2_l || 0);
  const Myd2 = tnToKn(connected.My2_d || 0), Myl2 = tnToKn(connected.My2_l || 0);

  const Psx1 = tnToKn(connected.Psx1 || 0), Mx1sx = tnToKn(connected.Mx1_sx || 0), My1sx = tnToKn(connected.My1_sx || 0);
  const Psy1 = tnToKn(connected.Psy1 || 0), Mx1sy = tnToKn(connected.Mx1_sy || 0), My1sy = tnToKn(connected.My1_sy || 0);
  const Psx2 = tnToKn(connected.Psx2 || 0), Mx2sx = tnToKn(connected.Mx2_sx || 0), My2sx = tnToKn(connected.My2_sx || 0);
  const Psy2 = tnToKn(connected.Psy2 || 0), Mx2sy = tnToKn(connected.Mx2_sy || 0), My2sy = tnToKn(connected.My2_sy || 0);

  /** Construye un caso de carga factorada: redistribuye P1,P2,My1,My2 (con
   * el sismo longitudinal SXD ya sumado si aplica) a través de la viga
   * rígida, o suma el sismo transversal SYD directamente sobre R1/R2 de
   * gravedad (sin redistribuir) — misma distinción que calculateConnectedBearing. */
  function buildCase(label, P1g, My1g, Mx1g, P2g, My2g, Mx2g, seis) {
    let P1c = P1g, My1c = My1g, Mx1c = Mx1g, P2c = P2g, My2c = My2g, Mx2c = Mx2g, R1, R2;
    if (!seis) {
      ({ R1, R2 } = redistributeRigidBeam(P1g, P2g, My1g, My2g, e1, denom));
    } else if (seis.axis === 'sx') {
      P1c = P1g + seis.sign * Psx1; My1c = My1g + seis.sign * My1sx; Mx1c = Mx1g + seis.sign * Mx1sx;
      P2c = P2g + seis.sign * Psx2; My2c = My2g + seis.sign * My2sx; Mx2c = Mx2g + seis.sign * Mx2sx;
      ({ R1, R2 } = redistributeRigidBeam(P1c, P2c, My1c, My2c, e1, denom));
    } else {
      ({ R1, R2 } = redistributeRigidBeam(P1g, P2g, My1g, My2g, e1, denom));
      P1c = P1g + seis.sign * Psy1; P2c = P2g + seis.sign * Psy2;
      Mx1c = Mx1g + seis.sign * Mx1sy; Mx2c = Mx2g + seis.sign * Mx2sy;
      R1 += seis.sign * Psy1; R2 += seis.sign * Psy2;
    }
    return { label, P1c, P2c, My1c, My2c, Mx1c, Mx2c, R1, R2 };
  }

  const grav1_14 = LF_D * Pd1 + LF_L * Pl1, gravMy1_14 = LF_D * Myd1 + LF_L * Myl1, gravMx1_14 = LF_D * Mxd1 + LF_L * Mxl1;
  const grav2_14 = LF_D * Pd2 + LF_L * Pl2, gravMy2_14 = LF_D * Myd2 + LF_L * Myl2, gravMx2_14 = LF_D * Mxd2 + LF_L * Mxl2;
  const grav1_125 = 1.25 * (Pd1 + Pl1), gravMy1_125 = 1.25 * (Myd1 + Myl1), gravMx1_125 = 1.25 * (Mxd1 + Mxl1);
  const grav2_125 = 1.25 * (Pd2 + Pl2), gravMy2_125 = 1.25 * (Myd2 + Myl2), gravMx2_125 = 1.25 * (Mxd2 + Mxl2);
  const grav1_09 = 0.9 * Pd1, gravMy1_09 = 0.9 * Myd1, gravMx1_09 = 0.9 * Mxd1;
  const grav2_09 = 0.9 * Pd2, gravMy2_09 = 0.9 * Myd2, gravMx2_09 = 0.9 * Mxd2;

  const cases = [
    buildCase('1.4CM+1.7CV', grav1_14, gravMy1_14, gravMx1_14, grav2_14, gravMy2_14, gravMx2_14, null),
    buildCase('1.25(CM+CV)+SXD', grav1_125, gravMy1_125, gravMx1_125, grav2_125, gravMy2_125, gravMx2_125, { sign: 1, axis: 'sx' }),
    buildCase('1.25(CM+CV)−SXD', grav1_125, gravMy1_125, gravMx1_125, grav2_125, gravMy2_125, gravMx2_125, { sign: -1, axis: 'sx' }),
    buildCase('1.25(CM+CV)+SYD', grav1_125, gravMy1_125, gravMx1_125, grav2_125, gravMy2_125, gravMx2_125, { sign: 1, axis: 'sy' }),
    buildCase('1.25(CM+CV)−SYD', grav1_125, gravMy1_125, gravMx1_125, grav2_125, gravMy2_125, gravMx2_125, { sign: -1, axis: 'sy' }),
    buildCase('0.9CM+SXD', grav1_09, gravMy1_09, gravMx1_09, grav2_09, gravMy2_09, gravMx2_09, { sign: 1, axis: 'sx' }),
    buildCase('0.9CM−SXD', grav1_09, gravMy1_09, gravMx1_09, grav2_09, gravMy2_09, gravMx2_09, { sign: -1, axis: 'sx' }),
    buildCase('0.9CM+SYD', grav1_09, gravMy1_09, gravMx1_09, grav2_09, gravMy2_09, gravMx2_09, { sign: 1, axis: 'sy' }),
    buildCase('0.9CM−SYD', grav1_09, gravMy1_09, gravMx1_09, grav2_09, gravMy2_09, gravMx2_09, { sign: -1, axis: 'sy' }),
  ];

  // Envolvente de presión de contacto factorada por zapata: Mx (propio de
  // cada columna, NO redistribuido) se pasa como "My" del formato
  // genérico para que caiga en el término 6·Mx/(L·B²) — misma convención
  // que calculateConnectedBearing.
  const env1 = simplifyConnectedRect(evaluateEnvelope(cases.map((c) => ({ label: c.label, Pgrav: c.R1, Pseis: 0, Mx: 0, My: c.Mx1c, fz })), L1, B1));
  const env2 = simplifyConnectedRect(evaluateEnvelope(cases.map((c) => ({ label: c.label, Pgrav: c.R2, Pseis: 0, Mx: 0, My: c.Mx2c, fz })), L2, B2));
  const Pu1 = env1.governing_q * L1 * B1;
  const Pu2 = env2.governing_q * L2 * B2;

  // -------------------------------------------------------------------
  // 1. LOSA DE LA ZAPATA 1 (excéntrica) y 2. LOSA DE LA ZAPATA 2 (interior)
  //    — presión uniforme Pu1/A1, Pu2/A2; d = h − 0.10 m (misma
  //    convención que la zapata aislada).
  // -------------------------------------------------------------------
  const slab1 = designFootingSlab({
    L: L1, B: B1, h: h1, col_L: col1_L, col_B: col1_B,
    ex_col: col1_L / 2.0 - L1 / 2.0, ey_col: 0,
    Pu: Pu1, Mu_x: 0, Mu_y: 0,
    fc, fy, fc_kgcm2, fy_kgcm2, cover, dFlat: Math.max(0.05, h1 - 0.10), dbMain, rebarTrans,
  });
  const slab2 = designFootingSlab({
    L: L2, B: B2, h: h2, col_L: col2_L, col_B: col2_B,
    ex_col: 0, ey_col: 0,
    Pu: Pu2, Mu_x: 0, Mu_y: 0,
    fc, fy, fc_kgcm2, fy_kgcm2, cover, dFlat: Math.max(0.05, h2 - 0.10), dbMain, rebarTrans,
  });

  // -------------------------------------------------------------------
  // 3. VIGA DE CONEXIÓN ("strap beam") — modelo de dos cargas puntuales
  //    (P1,P2) y dos reacciones puntuales (R1,R2). Solo las 5
  //    combinaciones que involucran sismo LONGITUDINAL (SXD) o ninguno
  //    generan cortante/momento en la viga; el sismo TRANSVERSAL (SYD) no
  //    la afecta (mismo hallazgo de la hoja de referencia).
  // -------------------------------------------------------------------
  const beamCaseIdx = [0, 1, 2, 5, 6]; // 1.4CM+1.7CV, 1.25(CM+CV)±SXD, 0.9CM±SXD
  let Vu_strap = -Infinity, Mu_top = 0, Mu_bottom = -Infinity;
  beamCaseIdx.forEach((i) => {
    const c = cases[i];
    const vSeg1 = -c.P1c, vSeg2 = c.R1 - c.P1c;
    Vu_strap = Math.max(Vu_strap, vSeg1, vSeg2);
    const m0 = c.My1c;
    const mE1 = -c.P1c * e1 + c.My1c;
    const mEnd = -c.My2c;
    Mu_top = Math.max(Mu_top, Math.abs(m0), Math.abs(mE1), Math.abs(mEnd));
    Mu_bottom = Math.max(Mu_bottom, m0, mE1, mEnd);
  });
  // Caso gobernante (el que produce Mu_top) — usado solo para dibujar el
  // diagrama V/M representativo en el visualizador.
  let governingCase = cases[beamCaseIdx[0]], governingAbs = -1;
  beamCaseIdx.forEach((i) => {
    const c = cases[i];
    const m0 = c.My1c, mE1 = -c.P1c * e1 + c.My1c, mEnd = -c.My2c;
    const worst = Math.max(Math.abs(m0), Math.abs(mE1), Math.abs(mEnd));
    if (worst > governingAbs) { governingAbs = worst; governingCase = c; }
  });

  const d_beam = strap_height - cover - dbMain.diameter_m / 2.0;
  const b_cm = strap_width * 100.0, d_cm = d_beam * 100.0;
  const As_min_beam = beamAsMin_cm2(fc_kgcm2, fy_kgcm2, b_cm, d_cm);
  const As_max_beam = beamAsMax_cm2(fc_kgcm2, fy_kgcm2, b_cm, d_cm);

  const flexTopCalc = calcRequiredRebar(Mu_top, fc, fy, strap_width, d_beam, PHI_FLEX);
  const flexBottomCalc = calcRequiredRebar(Math.max(0.001, Mu_bottom), fc, fy, strap_width, d_beam, PHI_FLEX);
  const As_top_req = Math.max(flexTopCalc.As_calc, As_min_beam);
  const As_bottom_req = Math.max(flexBottomCalc.As_calc, As_min_beam);
  const pass_ductility_top = As_top_req <= As_max_beam;
  const pass_ductility_bottom = As_bottom_req <= As_max_beam;

  const n_bars_top = Math.max(2, Math.ceil(As_top_req / dbMain.area_cm2));
  const As_top_provided = n_bars_top * dbMain.area_cm2;
  const n_bars_bottom = Math.max(2, Math.ceil(As_bottom_req / dbMain.area_cm2));
  const As_bottom_provided = n_bars_bottom * dbMain.area_cm2;

  const Vc_strap = oneWayShearCapacity_kN(fc_kgcm2, strap_width, d_beam);
  const phiVc_strap = PHI_SHEAR * Vc_strap;
  const pass_shear_strap_concrete = Vu_strap <= phiVc_strap;

  // Estribos: si el concreto solo no alcanza, se calcula el espaciamiento
  // requerido con Vs = Vu/φ − Vc (2 ramas del diámetro de la barra
  // transversal); si alcanza, se coloca el espaciamiento máximo
  // constructivo (estribos mínimos), acotado a d/2 y 30 cm.
  const Av_cm2 = 2 * rebarTrans.area_cm2;
  let stirrup_spacing_cm;
  let stirrups_required_by_calc = false;
  if (!pass_shear_strap_concrete) {
    stirrups_required_by_calc = true;
    const Vu_kg = knToKg(Vu_strap);
    const Vc_kg = knToKg(Vc_strap);
    const Vs_req_kg = Math.max(1, (Vu_kg / PHI_SHEAR) - Vc_kg);
    const raw_s = (Av_cm2 * fy_kgcm2 * d_cm) / Vs_req_kg;
    stirrup_spacing_cm = Math.max(5, Math.min(Math.floor(raw_s / 2.5) * 2.5, d_cm / 2.0));
  } else {
    stirrup_spacing_cm = Math.floor(Math.min(30, d_cm / 2.0) / 2.5) * 2.5;
  }

  // Diagrama V/M representativo (caso gobernante) para el visualizador:
  // x=0 (columna 1) → x=e1 (centroide Zapata 1, salto por R1) → x=sCentroid
  // (columna 2 / centroide Zapata 2).
  const gc = governingCase;
  const mE1g = -gc.P1c * e1 + gc.My1c;
  const diagram = {
    xs: [0, 0, e1, e1, sCentroid],
    Vs: [0, -gc.P1c, -gc.P1c, gc.R1 - gc.P1c, gc.R1 - gc.P1c],
    Ms: [0, gc.My1c, mE1g, mE1g, -gc.My2c],
  };

  return {
    e1, sCentroid, denom,
    env1: { rows: env1.rows, su_kPa: env1.governing_q, governingRow: env1.governingRow },
    env2: { rows: env2.rows, su_kPa: env2.governing_q, governingRow: env2.governingRow },
    Pu1, Pu2,
    slab1, slab2,
    strap: {
      Mu_top, Mu_top_kgm: kNmToKgm(Mu_top), Mu_bottom, Mu_bottom_kgm: kNmToKgm(Mu_bottom),
      d: d_beam, width: strap_width, height: strap_height,
      flexTopCalc, flexBottomCalc, As_min_beam, As_max_beam,
      As_top_req, As_top_provided, n_bars_top, pass_ductility_top,
      As_bottom_req, As_bottom_provided, n_bars_bottom, pass_ductility_bottom,
      Vu: Vu_strap, Vu_kg: knToKg(Vu_strap), Vc: Vc_strap, phiVc: phiVc_strap,
      pass_shear_concrete: pass_shear_strap_concrete,
      stirrups_required_by_calc, stirrup_spacing_cm, rebarTrans, Av_cm2,
    },
    dbMain, rebarTrans, fc, fy, fc_kgcm2, fy_kgcm2,
    L: sCentroid,
    diagram,
    pass_all_structural: slab1.pass_all_structural && slab2.pass_all_structural
      && pass_ductility_top && pass_ductility_bottom,
  };
}
