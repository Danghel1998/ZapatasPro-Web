/**
 * Envolvente de combinaciones de carga (gravedad + sismo en X e Y) para
 * zapatas aisladas, siguiendo el método de la hoja de cálculo real de
 * referencia (Efrén — "ZAPATA TIPO 1.xlsx"): presión de contacto biaxial
 * en las 4 esquinas (o su equivalente rectangular si alguna esquina
 * resulta en tracción), evaluada para cada combinación, tomando la más
 * desfavorable como gobernante. Se usa tanto a nivel de servicio
 * (verificación de la capacidad portante) como a nivel factorado
 * (presión uniforme equivalente para el diseño estructural).
 *
 * El peso propio de la zapata (aún no conocido con precisión antes de
 * diseñarla) se aproxima con un factor "fz": la carga axial de GRAVEDAD
 * de cada caso se infla por (1+fz) — igual que la hoja de referencia —
 * en vez de calcular el peso propio real (zapata + relleno). Esa
 * inflación se aplica SOLO al término axial (nunca a los momentos, ni a
 * la carga de sismo, que se suma después sin inflar) y, siguiendo esa
 * misma hoja, la excentricidad usada en la fórmula rectangular de
 * respaldo se calcula con la carga SIN inflar (Mx/Praw, My/Praw) — solo
 * el numerador (la fuerza total repartida) usa la carga inflada.
 */

/** Presión en las 4 esquinas de una zapata rectangular L×B bajo carga
 * axial N y momentos biaxiales Mx (dirección L), My (dirección B). */
export function cornerPressures(N, Mx, My, L, B) {
  const A = L * B;
  const q0 = N / A;
  const termX = (6 * Mx) / (B * L * L);
  const termY = (6 * My) / (L * B * B);
  return {
    c: q0 + termX + termY,
    d: q0 + termX - termY,
    b: q0 - termX + termY,
    e: q0 - termX - termY,
  };
}

/**
 * Evalúa una lista de casos de carga {label, Pgrav, Pseis=0, Mx, My,
 * fz=0, limit} sobre una zapata L×B: la carga axial total de cada caso es
 * N = Pgrav·(1+fz) + Pseis. Para cada caso calcula las 4 esquinas y, si
 * alguna resulta negativa (tracción, no admisible), la presión
 * rectangular equivalente en cada dirección — con la excentricidad
 * (Mx/Praw, My/Praw) calculada sobre la carga SIN inflar Praw =
 * Pgrav+Pseis, igual que la hoja de referencia. La presión gobernante
 * final: si ALGUNA esquina de CUALQUIER caso es negativa, se gobierna por
 * el máximo de las presiones rectangulares ya calculadas; si no, por el
 * máximo de todas las esquinas de todos los casos.
 */
export function evaluateEnvelope(cases, L, B) {
  const rows = cases.map((c) => {
    const fz = c.fz || 0;
    const Pseis = c.Pseis || 0;
    const N = c.Pgrav * (1 + fz) + Pseis;
    const Praw = c.Pgrav + Pseis;
    const corners = cornerPressures(N, c.Mx, c.My, L, B);
    const vals = Object.values(corners);
    const minC = Math.min(...vals);
    const maxC = Math.max(...vals);
    let rect = null;
    if (minC < 0 && Math.abs(Praw) > 1e-6) {
      const denomX = L / 2 - c.Mx / Praw;
      const denomY = B / 2 - c.My / Praw;
      const qx = Math.abs(denomX) > 1e-6 ? N / (2 * B * denomX) : Infinity;
      const qy = Math.abs(denomY) > 1e-6 ? N / (2 * L * denomY) : Infinity;
      rect = { qx, qy };
    }
    const q_governing = rect ? Math.max(rect.qx, rect.qy) : maxC;
    const pass = c.limit !== undefined ? q_governing <= c.limit : null;
    return { ...c, N, Praw, corners, minC, maxC, rect, q_governing, pass };
  });

  const globalMin = Math.min(...rows.map((r) => r.minC));
  let governing_q;
  if (globalMin < 0) {
    const rectVals = rows.filter((r) => r.rect).flatMap((r) => [r.rect.qx, r.rect.qy]);
    governing_q = rectVals.length ? Math.max(...rectVals) : Math.max(...rows.map((r) => r.maxC));
  } else {
    governing_q = Math.max(...rows.flatMap((r) => Object.values(r.corners)));
  }

  let governingRow = rows[0];
  rows.forEach((r) => { if (r.q_governing > governingRow.q_governing) governingRow = r; });

  return { rows, globalMin, uses_rectangular: globalMin < 0, governing_q, governingRow };
}
