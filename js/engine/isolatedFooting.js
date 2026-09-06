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
 * simple, sino con el método del curso UNI "Concreto Armado 2" (cap. 2.3,
 * ecuaciones 2-5 a 2-10): se calculan las presiones de SERVICIO σ1 (sin
 * sismo), σ2 (sismo en X, ambos sentidos) y σ3 (sismo en Y, ambos
 * sentidos) en las 4 esquinas de la zapata, y cada una se amplifica por
 * un ÚNICO factor — σult1=1.55·σ1, σult2=1.25·σ2, σult3=1.25·σ3 — una
 * simplificación (según el propio curso) de la combinación completa de
 * cargas factoradas. La más desfavorable de las tres se toma como
 * presión de diseño ÚNICA y UNIFORME "su", con la que se diseña
 * punzonamiento, corte y flexión en vez de con la variación biaxial
 * exacta.
 */

import { REBAR_TABLE } from '../constants.js';
import { tnToKn, kgcm2ToMpa, kpaToKgcm2, kgm3ToKnm3 } from './units.js';
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

    // Peso propio (zapata + relleno sobre ella), con su valor REAL ya
    // calculado (en vez del 1.075 fijo del curso, una aproximación válida
    // antes de conocer L,B — aquí ya se conocen). Se suma al término axial
    // de σ1/σ2/σ3 ANTES de amplificar, igual que el 1.075(PCM+PCV) del
    // curso queda dentro de σ1 antes de multiplicar por 1.55.
    const gamma_s = kgm3ToKnm3(foundation.gamma_kgm3);
    const gamma_c = kgm3ToKnm3(materials.gamma_c_kgm3);
    const A0 = L * B;
    const selfWeight = gamma_c * A0 * isolated.h + gamma_s * A0 * Math.max(0, isolated.Df - isolated.h);

    const P_cmcv = Pd + Pl + selfWeight;
    const Mx_cmcv = Mxd + Mxl;
    const My_cmcv = Myd + Myl;

    // σult1 = 1.55·σ1, σult2 = 1.25·σ2, σult3 = 1.25·σ3 (ecuaciones 2-8 a
    // 2-10 del curso) — simplificación de la combinación completa de
    // cargas factoradas. Cada σ se evalúa en las 4 esquinas (o su
    // rectángulo equivalente si hay tracción) ANTES de amplificar.
    const cases = [
      { label: 'σ1 (sin sismo)', amp: 1.55, N: P_cmcv, Mx: Mx_cmcv, My: My_cmcv },
      { label: 'σ2 (sismo +X)', amp: 1.25, N: P_cmcv + Psx, Mx: Mx_cmcv + Mx_sx, My: My_cmcv + My_sx },
      { label: 'σ2 (sismo −X)', amp: 1.25, N: P_cmcv - Psx, Mx: Mx_cmcv - Mx_sx, My: My_cmcv - My_sx },
      { label: 'σ3 (sismo +Y)', amp: 1.25, N: P_cmcv + Psy, Mx: Mx_cmcv + Mx_sy, My: My_cmcv + My_sy },
      { label: 'σ3 (sismo −Y)', amp: 1.25, N: P_cmcv - Psy, Mx: Mx_cmcv - Mx_sy, My: My_cmcv - My_sy },
    ];
    const env = evaluateEnvelope(cases, L, B);
    const rows = env.rows.map((r) => ({
      ...r,
      q_governing_kgcm2: kpaToKgcm2(r.q_governing),
      su: r.amp * r.q_governing,
      su_kgcm2: kpaToKgcm2(r.amp * r.q_governing),
    }));
    let governingRow = rows[0];
    rows.forEach((r) => { if (r.su > governingRow.su) governingRow = r; });
    envelope = {
      rows,
      uses_rectangular: env.uses_rectangular,
      su: governingRow.su,
      su_kgcm2: governingRow.su_kgcm2,
      governingRow,
    };
    // "su" ya es la presión de diseño (envolvente), aplicada de forma
    // UNIFORME sobre toda el área — se traduce a una carga puntual
    // equivalente Pu = su·A sin momento, para que designFootingSlab la
    // reparta con la misma mecánica de siempre (cantiléver con presión
    // constante en vez de variable).
    Pu = governingRow.su * L * B;
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
