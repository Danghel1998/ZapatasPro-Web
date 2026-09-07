/**
 * Motor de verificación geotécnica (E.050): presión de contacto
 * zapata-suelo, excentricidad respecto al tercio medio (núcleo central) y
 * comparación contra la capacidad portante admisible del estudio de suelos.
 * Trabaja con cargas de SERVICIO (sin factorar) — la presión bruta incluye
 * el peso propio de la zapata y del relleno sobre ella.
 */

import { tnToKn, knToTn, kgcm2ToKpa, kpaToKgcm2 } from './units.js';
import { evaluateEnvelope, simplifyConnectedRect, cornerPressures } from './seismicEnvelope.js';

/**
 * Verificación geotécnica de una zapata AISLADA (rectángulo L × B). Cuando
 * hay momento en una o ambas direcciones, usa la fórmula de flexión biaxial
 * superpuesta en las esquinas — exacta si cada excentricidad cae dentro del
 * tercio medio de su lado (caso más común en la práctica).
 */
export function calculateIsolatedBearing(footingData) {
  const { isolated, foundation, materials } = footingData;
  const { L, B, h, Df } = isolated;

  const q_adm = kgcm2ToKpa(foundation.q_adm_kgcm2);

  const P_col = tnToKn(isolated.Pd + isolated.Pl);
  const Mx = tnToKn(isolated.Mx_d + isolated.Mx_l);
  const My = tnToKn(isolated.My_d + isolated.My_l);

  // Peso propio aproximado con el factor "fz" (hoja de referencia Efrén)
  // en vez del peso real de zapata+relleno: N = P_col·(1+fz).
  const fz = isolated.fz ?? 0.08;
  const A = L * B;
  const N = P_col * (1 + fz);

  const ex = N > 0.001 ? Mx / N : 0;
  const ey = N > 0.001 ? My / N : 0;
  const ex_max = L / 6.0;
  const ey_max = B / 6.0;
  const within_kern = Math.abs(ex) <= ex_max && Math.abs(ey) <= ey_max;

  let q_max, q_min, effective_note = null;
  if (within_kern) {
    const q0 = N / A;
    q_max = q0 * (1 + 6 * Math.abs(ex) / L + 6 * Math.abs(ey) / B);
    q_min = q0 * (1 - 6 * Math.abs(ex) / L - 6 * Math.abs(ey) / B);
  } else {
    const e_res = Math.hypot(ex, ey);
    const L_eff = Math.max(0.1, 3 * (L / 2 - Math.abs(ex)));
    q_max = (2 * N) / (L_eff * B);
    q_min = 0;
    effective_note = `La excentricidad resultante (e = ${e_res.toFixed(3)} m) cae fuera del tercio medio — se estima de forma aproximada y conservadora con un área efectiva triangular. Aumenta la zapata o reduce el momento actuante.`;
  }

  // -------------------------------------------------------------------
  // ENVOLVENTE SÍSMICA (σ1 sin sismo, σ2 sismo X, σ3 sismo Y — cada una
  // evaluada en ambos sentidos ±) — solo si se ingresó algún dato de
  // sismo; en caso contrario se omite y rige únicamente el caso biaxial
  // simple ya calculado arriba. Mismo método que la hoja de cálculo real
  // de referencia (Efrén): σ = P/A ± 6Mx/(BL²) ± 6My/(LB²), con la carga
  // axial de gravedad inflada por (1+fz) como sustituto del peso propio.
  // Si el proyecto tiene datos de sismo, el límite amplificado
  // (factor·q_adm) rige para las 5 combinaciones — incluida CM+CV —, no
  // solo para las que incluyen sismo; si no hay sismo, rige el q_adm
  // simple. El sismo se combina en ambos sentidos (+/−) porque puede
  // actuar en cualquier dirección.
  // -------------------------------------------------------------------
  const hasSeismic = Math.abs(isolated.Psx || 0) > 1e-9 || Math.abs(isolated.Psy || 0) > 1e-9
    || Math.abs(isolated.Mx_sx || 0) > 1e-9 || Math.abs(isolated.My_sx || 0) > 1e-9
    || Math.abs(isolated.Mx_sy || 0) > 1e-9 || Math.abs(isolated.My_sy || 0) > 1e-9;

  const q_adm_seismic = q_adm * (isolated.seismic_bearing_factor || 1.25);
  const q_adm_eff = hasSeismic ? q_adm_seismic : q_adm;
  const pass_bearing = q_max <= q_adm_eff;

  let seismic_envelope = null;
  if (hasSeismic) {
    const Psx = tnToKn(isolated.Psx || 0), Mx_sx = tnToKn(isolated.Mx_sx || 0), My_sx = tnToKn(isolated.My_sx || 0);
    const Psy = tnToKn(isolated.Psy || 0), Mx_sy = tnToKn(isolated.Mx_sy || 0), My_sy = tnToKn(isolated.My_sy || 0);

    const cases = [
      { label: 'CM+CV', Pgrav: P_col, Pseis: 0, Mx, My, fz, limit: q_adm_seismic },
      { label: 'CM+CV+SXD', Pgrav: P_col, Pseis: Psx, Mx: Mx + Mx_sx, My: My + My_sx, fz, limit: q_adm_seismic },
      { label: 'CM+CV−SXD', Pgrav: P_col, Pseis: -Psx, Mx: Mx - Mx_sx, My: My - My_sx, fz, limit: q_adm_seismic },
      { label: 'CM+CV+SYD', Pgrav: P_col, Pseis: Psy, Mx: Mx + Mx_sy, My: My + My_sy, fz, limit: q_adm_seismic },
      { label: 'CM+CV−SYD', Pgrav: P_col, Pseis: -Psy, Mx: Mx - Mx_sy, My: My - My_sy, fz, limit: q_adm_seismic },
    ];
    const env = evaluateEnvelope(cases, L, B);
    seismic_envelope = {
      rows: env.rows.map((r) => ({
        ...r,
        q_governing_kgcm2: kpaToKgcm2(r.q_governing),
        limit_kgcm2: kpaToKgcm2(r.limit),
      })),
      uses_rectangular: env.uses_rectangular,
      governing_q: env.governing_q,
      governing_q_kgcm2: kpaToKgcm2(env.governing_q),
      governingRow: env.governingRow,
      pass: env.rows.every((r) => r.pass),
    };
  }

  return {
    L, B, h, A, Df,
    N, N_tn: knToTn(N),
    P_col_tn: isolated.Pd + isolated.Pl,
    fz, selfWeight_equiv_tn: knToTn(N) - (isolated.Pd + isolated.Pl),
    ex, ey, ex_max, ey_max, within_kern,
    q_max, q_min,
    q_max_kgcm2: kpaToKgcm2(q_max),
    q_min_kgcm2: kpaToKgcm2(q_min),
    q_adm, q_adm_kgcm2: foundation.q_adm_kgcm2,
    q_adm_eff_kgcm2: kpaToKgcm2(q_adm_eff),
    hasSeismic, seismic_envelope,
    pass_bearing: hasSeismic ? seismic_envelope.pass : pass_bearing,
    pass_kern: within_kern,
    effective_note,
    pass_all: (hasSeismic ? seismic_envelope.pass : pass_bearing) && within_kern,
  };
}

/**
 * Calcula el "ex" fijo del método de la hoja de cálculo real de referencia
 * (Efrén, "ZAPATA COMBINADA.xlsx"): la excentricidad longitudinal de
 * servicio se calcula UNA SOLA VEZ (a partir del caso CM+CV+SXD) y se
 * reutiliza igual para TODAS las combinaciones — incluida CM+CV sin sismo
 * — como My = P·ex, en vez de recalcular el brazo de cada columna por
 * separado en cada combinación:
 *   x1 = centroide SIN sismo, respecto al eje de la columna 1 (mismo que
 *        fija L = 2·x1 en el predimensionamiento), redondeado a 0.05 m.
 *   x_sismo = centroide con el caso CM+CV+SXD, también redondeado.
 *   ex = x_sismo − x1.
 * Sin datos de sismo, x_sismo = x1 y ex = 0 (la zapata se asume centrada
 * exactamente bajo la carga de gravedad, por construcción de L).
 */
export function combinedFixedEx(P1, P2, M1, M2, s, Psx1 = 0, Psx2 = 0, My1sx = 0, My2sx = 0) {
  const round5 = (v) => Math.ceil(v / 0.05) * 0.05;
  const x1 = round5((M1 + M2 + P2 * s) / (P1 + P2));
  const P1s = P1 + Psx1, P2s = P2 + Psx2;
  const M1s = M1 + My1sx, M2s = M2 + My2sx;
  const xSismo = round5((M1s + M2s + P2s * s) / (P1s + P2s));
  return xSismo - x1;
}

/**
 * Verificación geotécnica de una zapata COMBINADA (2 columnas, ancho B
 * constante — losa rígida única). Igual que la zapata aislada, la presión
 * de contacto es BIAXIAL; el momento transversal (a lo largo de B) viene
 * del momento propio de cada columna (se asume ambas centradas en B). El
 * momento longitudinal (a lo largo de L) usa el "ex" fijo del método de
 * la hoja de cálculo real de referencia — ver combinedFixedEx: My = P·ex
 * para todas las combinaciones, en vez de recalcular el brazo de cada
 * columna por caso. El peso propio se aproxima con el factor "fz" (ver
 * evaluateEnvelope) en vez de calcularlo con la geometría real — mismo
 * criterio que la hoja de referencia: A = R(1+k)/s. Si hay datos de
 * sismo, se evalúa además la envolvente de 5 combinaciones de servicio
 * (CM+CV, CM+CV±SXD, CM+CV±SYD) — mismo criterio que la zapata aislada.
 */
export function calculateCombinedBearing(footingData) {
  const { combined, foundation } = footingData;
  const { L, B, h, a1, s, Df } = combined;
  const a2 = a1 + s;

  const q_adm = kgcm2ToKpa(foundation.q_adm_kgcm2);
  const fz = combined.fz ?? 0.1;

  const P1 = tnToKn(combined.P1d + combined.P1l);
  const P2 = tnToKn(combined.P2d + combined.P2l);
  const R = P1 + P2;
  const A = L * B;
  const N = R * (1 + fz);

  const My1own = tnToKn((combined.My1_d || 0) + (combined.My1_l || 0));
  const My2own = tnToKn((combined.My2_d || 0) + (combined.My2_l || 0));
  const Mx1own = tnToKn((combined.Mx1_d || 0) + (combined.Mx1_l || 0));
  const Mx2own = tnToKn((combined.Mx2_d || 0) + (combined.Mx2_l || 0));
  const Psx1_0 = tnToKn(combined.Psx1 || 0), Psx2_0 = tnToKn(combined.Psx2 || 0);
  const My1sx_0 = tnToKn(combined.My1_sx || 0), My2sx_0 = tnToKn(combined.My2_sx || 0);

  const ex = combinedFixedEx(P1, P2, My1own, My2own, s, Psx1_0, Psx2_0, My1sx_0, My2sx_0);

  // Momento longitudinal total (causa gradiente en L) y transversal total
  // (causa gradiente en B), bajo cargas de servicio SIN sismo.
  const My_L = R * ex;
  const Mx_B = Mx1own + Mx2own;

  const x_R = L / 2 + ex;
  const e = ex;
  const e_max = L / 6.0;
  const within_kern = Math.abs(e) <= e_max;

  // cornerPressures(N, Mx, My, L, B): su 1er momento causa gradiente en L
  // (nuestro My_L), el 2° causa gradiente en B (nuestro Mx_B) — misma
  // convención ya usada por la zapata conectada.
  const corners = cornerPressures(N, My_L, Mx_B, L, B);
  const cornerVals = Object.values(corners);
  let q_max = Math.max(...cornerVals), q_min = Math.min(...cornerVals);
  let effective_note = null;
  if (q_min < 0) {
    const L_eff = Math.max(0.1, 3 * (L / 2 - Math.abs(e)));
    q_max = (2 * N) / (L_eff * B);
    q_min = 0;
    effective_note = `La excentricidad longitudinal (e = ${e.toFixed(3)} m) cae fuera del tercio medio (L/6 = ${e_max.toFixed(3)} m) — se estima de forma aproximada y conservadora con un área efectiva. Ajusta "a1"/"s" (posición) o el largo L para acercar el centroide de la zapata a la resultante de cargas.`;
  }

  const hasSeismic = Math.abs(combined.Psx1 || 0) > 1e-9 || Math.abs(combined.Psx2 || 0) > 1e-9
    || Math.abs(combined.Psy1 || 0) > 1e-9 || Math.abs(combined.Psy2 || 0) > 1e-9
    || Math.abs(combined.Mx1_sx || 0) > 1e-9 || Math.abs(combined.My1_sx || 0) > 1e-9
    || Math.abs(combined.Mx2_sx || 0) > 1e-9 || Math.abs(combined.My2_sx || 0) > 1e-9
    || Math.abs(combined.Mx1_sy || 0) > 1e-9 || Math.abs(combined.My1_sy || 0) > 1e-9
    || Math.abs(combined.Mx2_sy || 0) > 1e-9 || Math.abs(combined.My2_sy || 0) > 1e-9;

  const q_adm_seismic = q_adm * (combined.seismic_bearing_factor || 1.25);
  const q_adm_eff = hasSeismic ? q_adm_seismic : q_adm;
  const pass_bearing = q_max <= q_adm_eff;

  let seismic_envelope = null;
  if (hasSeismic) {
    const Psx1 = tnToKn(combined.Psx1 || 0), Mx1sx = tnToKn(combined.Mx1_sx || 0);
    const Psx2 = tnToKn(combined.Psx2 || 0), Mx2sx = tnToKn(combined.Mx2_sx || 0);
    const Psy1 = tnToKn(combined.Psy1 || 0), Mx1sy = tnToKn(combined.Mx1_sy || 0);
    const Psy2 = tnToKn(combined.Psy2 || 0), Mx2sy = tnToKn(combined.Mx2_sy || 0);

    /** Construye un caso de servicio: My = (P1c+P2c)·ex, con el mismo "ex"
     * fijo para las 5 combinaciones — igual que la hoja de cálculo de
     * referencia (D72:D76 = B72:B76 * B$67) —, en vez de recalcular el
     * brazo de cada columna por separado en cada combinación. */
    function buildCase(label, Pseis1, Pseis2, Mx1seis, Mx2seis) {
      const P1c = P1 + Pseis1, P2c = P2 + Pseis2;
      const My_L_case = (P1c + P2c) * ex;
      const Mx_B_case = Mx1own + Mx2own + Mx1seis + Mx2seis;
      return { label, Pgrav: R, Pseis: Pseis1 + Pseis2, Mx: My_L_case, My: Mx_B_case, fz, limit: q_adm_seismic };
    }
    const cases = [
      buildCase('CM+CV', 0, 0, 0, 0),
      buildCase('CM+CV+SXD', Psx1, Psx2, Mx1sx, Mx2sx),
      buildCase('CM+CV−SXD', -Psx1, -Psx2, -Mx1sx, -Mx2sx),
      buildCase('CM+CV+SYD', Psy1, Psy2, Mx1sy, Mx2sy),
      buildCase('CM+CV−SYD', -Psy1, -Psy2, -Mx1sy, -Mx2sy),
    ];
    const env = evaluateEnvelope(cases, L, B);
    seismic_envelope = {
      rows: env.rows.map((r) => ({ ...r, q_governing_kgcm2: kpaToKgcm2(r.q_governing), limit_kgcm2: kpaToKgcm2(r.limit) })),
      uses_rectangular: env.uses_rectangular,
      governing_q: env.governing_q,
      governing_q_kgcm2: kpaToKgcm2(env.governing_q),
      governingRow: env.governingRow,
      pass: env.rows.every((r) => r.pass),
    };
  }

  return {
    L, B, h, A, Df, a1, s,
    P1_tn: combined.P1d + combined.P1l,
    P2_tn: combined.P2d + combined.P2l,
    R, R_tn: knToTn(R), N, N_tn: knToTn(N),
    fz, selfWeight_equiv_tn: knToTn(N) - knToTn(R),
    x_R, x_N: x_R, e, ex, e_max, within_kern,
    My_L, Mx_B,
    q_max, q_min,
    q_max_kgcm2: kpaToKgcm2(q_max),
    q_min_kgcm2: kpaToKgcm2(q_min),
    q_adm, q_adm_kgcm2: foundation.q_adm_kgcm2,
    q_adm_eff_kgcm2: kpaToKgcm2(q_adm_eff),
    hasSeismic, seismic_envelope,
    pass_bearing: hasSeismic ? seismic_envelope.pass : pass_bearing,
    within_kern,
    effective_note,
    pass_all: (hasSeismic ? seismic_envelope.pass : pass_bearing) && within_kern,
  };
}

/**
 * Verificación geotécnica de una zapata CONECTADA: Zapata 1 (excéntrica,
 * columna en el límite de propiedad) + Zapata 2 (interior, concéntrica
 * bajo su columna), unidas por una viga de conexión.
 *
 * Método de la viga rígida: se exige presión UNIFORME bajo cada zapata
 * (cada una actúa en su propio centroide). De la estática del conjunto
 * (2 ecuaciones: ΣFy=0 y ΣM=0 respecto al límite de propiedad, con N1
 * actuando en el centroide de la Zapata 1 y N2 en el eje de la columna 2)
 * resulta, en forma cerrada:
 *   N1 = P1 · s / (s − e1),   R = N1 − P1,   N2 = P1 + P2 − N1
 * donde e1 = L1/2 − col1_L/2 es la excentricidad de la columna 1 respecto
 * al centro de su propia zapata (no puede crecer hacia el límite). R es la
 * fuerza cortante que transmite la viga de conexión.
 */
/**
 * Redistribuye las cargas de gravedad (+ sismo longitudinal, si se pasa)
 * de ambas columnas hacia las reacciones de zapata R1/R2, por el método
 * de la viga rígida (hoja de cálculo de referencia Efrén, "ZAPATA
 * CONECTADA.xlsx"): R2 = P2 − P1·e1/denom + (My1+My2)/denom, R1 = P1+P2−R2.
 * "My" es el momento de cada columna en el plano de la viga de conexión
 * (misma dirección que la excentricidad e1).
 */
export function redistributeRigidBeam(P1, P2, My1, My2, e1, denom) {
  const R2 = P2 - (P1 * e1) / denom + (My1 + My2) / denom;
  const R1 = P1 + P2 - R2;
  return { R1, R2 };
}

export function calculateConnectedBearing(footingData) {
  const { connected, foundation } = footingData;
  const { L1, B1, L2, B2, col1_L, col2_L } = connected;

  const q_adm = kgcm2ToKpa(foundation.q_adm_kgcm2);
  const fz = connected.fz ?? 0.1;

  const P1 = tnToKn(connected.P1d + connected.P1l);
  const P2 = tnToKn(connected.P2d + connected.P2l);
  const Mx1 = tnToKn((connected.Mx1_d || 0) + (connected.Mx1_l || 0));
  const My1 = tnToKn((connected.My1_d || 0) + (connected.My1_l || 0));
  const Mx2 = tnToKn((connected.Mx2_d || 0) + (connected.Mx2_l || 0));
  const My2 = tnToKn((connected.My2_d || 0) + (connected.My2_l || 0));

  // Excentricidad geométrica de la Zapata 1 (columna al ras del límite de
  // propiedad) y distancia entre centroides de zapata (a partir de la
  // distancia LIBRE entre caras de columna "s" — ver predimensionConnected).
  const e1 = L1 / 2.0 - col1_L / 2.0;
  const sCentroid = connected.s + col1_L / 2.0 + col2_L / 2.0;
  const denom = sCentroid - e1;

  const { R1, R2 } = redistributeRigidBeam(P1, P2, My1, My2, e1, denom);
  const A1 = L1 * B1, A2 = L2 * B2;

  // Presión de contacto con el peso propio aproximado por "fz" (igual que
  // la zapata aislada: N = R·(1+fz)) en vez del peso real de zapata+relleno.
  const q1 = (R1 * (1 + fz)) / A1;
  const q2 = (R2 * (1 + fz)) / A2;

  const hasSeismic = Math.abs(connected.Psx1 || 0) > 1e-9 || Math.abs(connected.Psy1 || 0) > 1e-9
    || Math.abs(connected.Psx2 || 0) > 1e-9 || Math.abs(connected.Psy2 || 0) > 1e-9
    || Math.abs(connected.Mx1_sx || 0) > 1e-9 || Math.abs(connected.My1_sx || 0) > 1e-9
    || Math.abs(connected.Mx1_sy || 0) > 1e-9 || Math.abs(connected.My1_sy || 0) > 1e-9
    || Math.abs(connected.Mx2_sx || 0) > 1e-9 || Math.abs(connected.My2_sx || 0) > 1e-9
    || Math.abs(connected.Mx2_sy || 0) > 1e-9 || Math.abs(connected.My2_sy || 0) > 1e-9;

  const q_adm_seismic = q_adm * (connected.seismic_bearing_factor || 1.25);
  const q_adm_eff = hasSeismic ? q_adm_seismic : q_adm;
  const pass_bearing_1 = q1 <= q_adm_eff;
  const pass_bearing_2 = q2 <= q_adm_eff;
  const pass_positive_reaction = R2 > 0; // si R2 <= 0, el método de viga rígida no es aplicable (redimensionar)

  // -------------------------------------------------------------------
  // ENVOLVENTE SÍSMICA DE SERVICIO — solo si hay datos de sismo. El sismo
  // longitudinal (SXD) redistribuye su P y su My completos a través del
  // mismo mecanismo de viga rígida; el sismo transversal (SYD) se suma
  // DIRECTAMENTE a R1/R2 de gravedad (no pasa por la viga) — misma
  // distinción física que la hoja de referencia. El momento "Mx" propio de
  // cada columna (transversal, no redistribuido) se usa en la verificación
  // local biaxial de cada zapata con My=0 (el efecto longitudinal ya está
  // absorbido en R) — ver cornerPressures: se pasa Mx como si fuera "My"
  // del formato genérico para que caiga en el término 6·Mx/(L·B²), igual
  // que la hoja de referencia (Mx pareado con L·B², no con B·L²).
  // -------------------------------------------------------------------
  let seismic_envelope1 = null, seismic_envelope2 = null;
  if (hasSeismic) {
    const Psx1 = tnToKn(connected.Psx1 || 0), Mx1_sx = tnToKn(connected.Mx1_sx || 0), My1_sx = tnToKn(connected.My1_sx || 0);
    const Psy1 = tnToKn(connected.Psy1 || 0), Mx1_sy = tnToKn(connected.Mx1_sy || 0), My1_sy = tnToKn(connected.My1_sy || 0);
    const Psx2 = tnToKn(connected.Psx2 || 0), Mx2_sx = tnToKn(connected.Mx2_sx || 0), My2_sx = tnToKn(connected.My2_sx || 0);
    const Psy2 = tnToKn(connected.Psy2 || 0), Mx2_sy = tnToKn(connected.Mx2_sy || 0), My2_sy = tnToKn(connected.My2_sy || 0);

    const sxdPlus = redistributeRigidBeam(P1 + Psx1, P2 + Psx2, My1 + My1_sx, My2 + My2_sx, e1, denom);
    const sxdMinus = redistributeRigidBeam(P1 - Psx1, P2 - Psx2, My1 - My1_sx, My2 - My2_sx, e1, denom);

    const cases = [
      { label: 'CM+CV', R1, R2, Mx1: Mx1, Mx2: Mx2, limit: q_adm_seismic },
      { label: 'CM+CV+SXD', R1: sxdPlus.R1, R2: sxdPlus.R2, Mx1: Mx1 + Mx1_sx, Mx2: Mx2 + Mx2_sx, limit: q_adm_seismic },
      { label: 'CM+CV−SXD', R1: sxdMinus.R1, R2: sxdMinus.R2, Mx1: Mx1 - Mx1_sx, Mx2: Mx2 - Mx2_sx, limit: q_adm_seismic },
      { label: 'CM+CV+SYD', R1: R1 + Psy1, R2: R2 + Psy2, Mx1: Mx1 + Mx1_sy, Mx2: Mx2 + Mx2_sy, limit: q_adm_seismic },
      { label: 'CM+CV−SYD', R1: R1 - Psy1, R2: R2 - Psy2, Mx1: Mx1 - Mx1_sy, Mx2: Mx2 - Mx2_sy, limit: q_adm_seismic },
    ];
    const env1 = simplifyConnectedRect(evaluateEnvelope(cases.map((c) => ({ label: c.label, Pgrav: c.R1, Pseis: 0, Mx: 0, My: c.Mx1, fz, limit: c.limit })), L1, B1));
    const env2 = simplifyConnectedRect(evaluateEnvelope(cases.map((c) => ({ label: c.label, Pgrav: c.R2, Pseis: 0, Mx: 0, My: c.Mx2, fz, limit: c.limit })), L2, B2));
    const wrap = (env) => ({
      rows: env.rows.map((r) => ({ ...r, q_governing_kgcm2: kpaToKgcm2(r.q_governing), limit_kgcm2: kpaToKgcm2(r.limit) })),
      uses_rectangular: env.uses_rectangular,
      governing_q: env.governing_q,
      governing_q_kgcm2: kpaToKgcm2(env.governing_q),
      governingRow: env.governingRow,
      pass: env.rows.every((r) => r.pass),
    });
    seismic_envelope1 = wrap(env1);
    seismic_envelope2 = wrap(env2);
  }

  const pass_bearing_final_1 = hasSeismic ? seismic_envelope1.pass : pass_bearing_1;
  const pass_bearing_final_2 = hasSeismic ? seismic_envelope2.pass : pass_bearing_2;

  return {
    L1, B1, L2, B2, A1, A2,
    P1_tn: connected.P1d + connected.P1l, P2_tn: connected.P2d + connected.P2l,
    Mx1_tn: (connected.Mx1_d || 0) + (connected.Mx1_l || 0), My1_tn: (connected.My1_d || 0) + (connected.My1_l || 0),
    Mx2_tn: (connected.Mx2_d || 0) + (connected.Mx2_l || 0), My2_tn: (connected.My2_d || 0) + (connected.My2_l || 0),
    e1, s: connected.s, sCentroid, denom, fz,
    R1, R1_tn: knToTn(R1), R2, R2_tn: knToTn(R2), Ru: R1 - P1, Ru_tn: knToTn(R1 - P1),
    q1, q2,
    q1_kgcm2: kpaToKgcm2(q1), q2_kgcm2: kpaToKgcm2(q2),
    q_adm, q_adm_kgcm2: foundation.q_adm_kgcm2, q_adm_eff_kgcm2: kpaToKgcm2(q_adm_eff),
    hasSeismic, seismic_envelope1, seismic_envelope2,
    pass_bearing_1: pass_bearing_final_1, pass_bearing_2: pass_bearing_final_2, pass_positive_reaction,
    pass_all: pass_bearing_final_1 && pass_bearing_final_2 && pass_positive_reaction,
  };
}
