/**
 * Motor de diseño estructural de una zapata CONECTADA (Norma E.060 / ACI
 * 318): Zapata 1 (excéntrica, columna en el límite de propiedad) + Zapata
 * 2 (interior, concéntrica), unidas por una viga de conexión ("strap
 * beam") que transmite una fuerza cortante constante R entre ambas.
 *
 * Con cargas factoradas, la misma estática de calculateConnectedBearing
 * da Nu1 y Nu2 — la presión de contacto factorada bajo cada zapata es
 * entonces UNIFORME (Nu/A), así que cada losa se diseña exactamente igual
 * que una zapata aislada (designFootingSlab), usando la excentricidad de
 * su propia columna respecto a su centroide para ubicar correctamente los
 * voladizos (la Zapata 1 sigue teniendo un voladizo mucho más corto hacia
 * el límite de propiedad que hacia el interior, aunque la presión ya sea
 * uniforme).
 *
 * La viga de conexión transmite cortante CONSTANTE Ru a todo lo largo de
 * su luz (sin carga distribuida propia, peso propio aparte) y momento
 * LINEAL, de Mu = Ru·s en la Zapata 1 hasta Mu = 0 en la Zapata 2 (que no
 * necesita momento por ser concéntrica) — verificado por estática exacta
 * (Mu_max = N1·e1 = Ru·s, ambas expresiones coinciden).
 */

import { REBAR_TABLE } from '../constants.js';
import { tnToKn, kgcm2ToMpa, knToKg, kNmToKgm } from './units.js';
import { designFootingSlab } from './footingSlabDesign.js';
import { calcRequiredRebar, oneWayShearCapacity_kN, PHI_FLEX, PHI_SHEAR } from './concreteDesign.js';

export function calculateConnectedStructural(footingData) {
  const { connected, materials, safety_req } = footingData;
  const { L1, B1, h1, L2, B2, h2, col1_L, col1_B, col2_L, col2_B, s, strap_width, strap_height } = connected;

  const fc_kgcm2 = materials.fc_kgcm2, fy_kgcm2 = materials.fy_kgcm2;
  const fc = kgcm2ToMpa(fc_kgcm2), fy = kgcm2ToMpa(fy_kgcm2);
  const cover = materials.cover_footing;
  const dbMain = REBAR_TABLE[materials.rebar_main_id] ?? REBAR_TABLE[2];
  const rebarTrans = REBAR_TABLE[materials.rebar_trans_id] ?? REBAR_TABLE[1];

  const LF_D = safety_req.LF_D ?? 1.4;
  const LF_L = safety_req.LF_L ?? 1.7;

  const Pu1 = LF_D * tnToKn(connected.P1d) + LF_L * tnToKn(connected.P1l);
  const Pu2 = LF_D * tnToKn(connected.P2d) + LF_L * tnToKn(connected.P2l);
  const Mu1 = LF_D * tnToKn(connected.M1_d) + LF_L * tnToKn(connected.M1_l);
  const Mu2 = LF_D * tnToKn(connected.M2_d) + LF_L * tnToKn(connected.M2_l);

  // Mismo método de la viga rígida (generalizado con momento) que
  // calculateConnectedBearing, con cargas factoradas.
  const e1 = L1 / 2.0 - col1_L / 2.0;
  const Nu2 = Pu2 - (Pu1 * e1) / (s - e1) + (Mu1 + Mu2) / (s - e1);
  const Nu1 = Pu1 + Pu2 - Nu2;
  const Ru = Nu1 - Pu1;

  // -------------------------------------------------------------------
  // 1. LOSA DE LA ZAPATA 1 (excéntrica) — presión uniforme Nu1/A1, columna
  //    desplazada hacia el límite de propiedad respecto al centroide.
  // -------------------------------------------------------------------
  const slab1 = designFootingSlab({
    L: L1, B: B1, h: h1, col_L: col1_L, col_B: col1_B,
    ex_col: col1_L / 2.0 - L1 / 2.0, ey_col: 0,
    Pu: Nu1, Mu_x: 0, Mu_y: 0,
    fc, fy, fc_kgcm2, fy_kgcm2, cover, dbMain, rebarTrans,
  });

  // -------------------------------------------------------------------
  // 2. LOSA DE LA ZAPATA 2 (interior) — presión uniforme Nu2/A2, columna
  //    centrada (zapata concéntrica bajo su propia columna).
  // -------------------------------------------------------------------
  const slab2 = designFootingSlab({
    L: L2, B: B2, h: h2, col_L: col2_L, col_B: col2_B,
    ex_col: 0, ey_col: 0,
    Pu: Nu2, Mu_x: 0, Mu_y: 0,
    fc, fy, fc_kgcm2, fy_kgcm2, cover, dbMain, rebarTrans,
  });

  // -------------------------------------------------------------------
  // 3. VIGA DE CONEXIÓN ("strap beam"): cortante constante Ru, momento
  //    lineal de Ru·s (en la Zapata 1) a 0 (en la Zapata 2) — exacto
  //    cuando no hay momento aplicado en las columnas (M1=M2=0, caso
  //    verificado analíticamente: Ru·s ≡ Nu1·e1 por dos vías de cálculo
  //    independientes). Con momento en las columnas esta expresión sigue
  //    siendo una aproximación razonable (usa el Ru ya ajustado por
  //    momento); para un caso con momentos importantes, conviene
  //    verificar la viga con un análisis exacto del diagrama de momento
  //    flector, como en la memoria de referencia (resuelto con software).
  // -------------------------------------------------------------------
  const Mu_strap = Ru * s;
  const d_beam = strap_height - cover - dbMain.diameter_m / 2.0;
  const flexStrap = calcRequiredRebar(Mu_strap, fc, fy, strap_width, d_beam, PHI_FLEX);
  const n_bars_top = Math.max(2, Math.ceil(flexStrap.As_design / dbMain.area_cm2));
  const As_top_provided = n_bars_top * dbMain.area_cm2;

  const As_min_beam = flexStrap.As_min;
  const n_bars_bottom = Math.max(2, Math.ceil(As_min_beam / dbMain.area_cm2));
  const As_bottom_provided = n_bars_bottom * dbMain.area_cm2;

  const Vc_strap = oneWayShearCapacity_kN(fc_kgcm2, strap_width, d_beam);
  const phiVc_strap = PHI_SHEAR * Vc_strap;
  const pass_shear_strap_concrete = Ru <= phiVc_strap;

  // Estribos: si el concreto solo no alcanza, se calcula el espaciamiento
  // requerido con Vs = Vu/φ − Vc (2 ramas del diámetro de la barra
  // transversal); si alcanza, se coloca el espaciamiento máximo
  // constructivo (estribos mínimos), acotado a d/2 y 30 cm.
  const Av_cm2 = 2 * rebarTrans.area_cm2;
  let stirrup_spacing_cm;
  let stirrups_required_by_calc = false;
  if (!pass_shear_strap_concrete) {
    stirrups_required_by_calc = true;
    const Vu_kg = knToKg(Ru);
    const Vc_kg = knToKg(Vc_strap);
    const Vs_req_kg = Math.max(1, (Vu_kg / PHI_SHEAR) - Vc_kg);
    const d_beam_cm = d_beam * 100.0;
    const raw_s = (Av_cm2 * fy_kgcm2 * d_beam_cm) / Vs_req_kg;
    stirrup_spacing_cm = Math.max(5, Math.min(Math.floor(raw_s / 2.5) * 2.5, d_beam_cm / 2.0));
  } else {
    stirrup_spacing_cm = Math.floor(Math.min(30, (d_beam * 100.0) / 2.0) / 2.5) * 2.5;
  }

  return {
    Pu1, Pu2, Mu1, Mu2, e1, Nu1, Nu1_kg: knToKg(Nu1), Ru, Ru_kg: knToKg(Ru), Nu2, Nu2_kg: knToKg(Nu2),
    slab1, slab2,
    strap: {
      Mu: Mu_strap, Mu_kgm: kNmToKgm(Mu_strap),
      d: d_beam, width: strap_width, height: strap_height,
      flex: flexStrap, n_bars_top, As_top_provided, n_bars_bottom, As_bottom_provided,
      Vu: Ru, Vu_kg: knToKg(Ru), Vc: Vc_strap, phiVc: phiVc_strap,
      pass_shear_concrete: pass_shear_strap_concrete,
      stirrups_required_by_calc, stirrup_spacing_cm, rebarTrans, Av_cm2,
    },
    dbMain, rebarTrans, fc, fy, fc_kgcm2, fy_kgcm2,
    // Diagrama de la viga de conexión (cortante constante, momento lineal
    // de Ru·s en la Zapata 1 a 0 en la Zapata 2) — mismo formato que el
    // diagrama V/M de la zapata combinada, para reutilizar su renderizado.
    L: s,
    diagram: { xs: [0, s], Vs: [Ru, Ru], Ms: [Mu_strap, 0] },
    pass_all_structural: slab1.pass_all_structural && slab2.pass_all_structural,
  };
}
