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
 * final: la fila (combinación) con el mayor q_governing PROPIO — cada
 * fila ya decide correctamente, de forma independiente, si usa su propio
 * máximo trapezoidal o su propio equivalente rectangular; una fila con
 * alguna esquina en tracción NUNCA debe opacar a otra fila, sin tracción,
 * cuyo propio q_governing sea más alto (bug real detectado al aplicar
 * esto a zapata conectada: una combinación con esquina en tracción podía
 * "ganar" con un valor rectangular pequeño o incluso negativo, ocultando
 * a la combinación realmente más desfavorable).
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

  let governingRow = rows[0];
  rows.forEach((r) => { if (r.q_governing > governingRow.q_governing) governingRow = r; });
  const governing_q = governingRow.q_governing;

  return { rows, uses_rectangular: governingRow.rect !== null, governing_q, governingRow };
}

/**
 * Ajusta el resultado de evaluateEnvelope() para el chequeo LOCAL de cada
 * zapata de una zapata conectada — hoja de cálculo de referencia (Efrén,
 * "ZAPATA CONECTADA.xlsx"): ahí "My" siempre vale 0 (el efecto
 * longitudinal ya está absorbido en R1/R2, ver calculateConnectedBearing/
 * calculateConnectedStructural), y el respaldo rectangular de esa hoja
 * solo implementa la fórmula que depende de "My" — al ser siempre 0, se
 * reduce al promedio simple N/A (sin corrección real por la excentricidad
 * de "Mx" que causó la tracción). Esta función reproduce exactamente ese
 * comportamiento: cuando una fila cae en el respaldo rectangular, su
 * q_governing se reemplaza por el promedio de las 4 esquinas (= N/A) en
 * vez del máximo entre qx y qy que usa evaluateEnvelope() para la zapata
 * aislada (que sí tiene My≠0 en general y sí necesita ambas fórmulas).
 */
export function simplifyConnectedRect(env) {
  const rows = env.rows.map((r) => {
    if (!r.rect) return r;
    const q_governing = (r.corners.c + r.corners.d + r.corners.b + r.corners.e) / 4;
    const pass = r.limit !== undefined ? q_governing <= r.limit : null;
    return { ...r, q_governing, pass };
  });
  let governingRow = rows[0];
  rows.forEach((r) => { if (r.q_governing > governingRow.q_governing) governingRow = r; });
  return { rows, uses_rectangular: governingRow.rect !== null, governing_q: governingRow.q_governing, governingRow };
}
