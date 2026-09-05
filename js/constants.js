/**
 * Constantes y tablas de referencia para diseño de zapatas (aisladas y
 * combinadas), Norma E.060 (Concreto Armado) y E.050 (Suelos y
 * Cimentaciones) — RNE, Perú.
 */

export const REBAR_TABLE = [
  { name: 'Ø 3/8" (9.5 mm)',  diameter_mm: 9.52,  diameter_m: 0.00952, area_cm2: 0.71, weight_kgm: 0.560, inches: '3/8"' },
  { name: 'Ø 1/2" (12.7 mm)', diameter_mm: 12.70, diameter_m: 0.01270, area_cm2: 1.29, weight_kgm: 0.994, inches: '1/2"' },
  { name: 'Ø 5/8" (15.9 mm)', diameter_mm: 15.88, diameter_m: 0.01588, area_cm2: 1.99, weight_kgm: 1.552, inches: '5/8"' },
  { name: 'Ø 3/4" (19.1 mm)', diameter_mm: 19.05, diameter_m: 0.01905, area_cm2: 2.84, weight_kgm: 2.235, inches: '3/4"' },
  { name: 'Ø 7/8" (22.2 mm)', diameter_mm: 22.22, diameter_m: 0.02222, area_cm2: 3.87, weight_kgm: 3.042, inches: '7/8"' },
  { name: 'Ø 1" (25.4 mm)',   diameter_mm: 25.40, diameter_m: 0.02540, area_cm2: 5.10, weight_kgm: 3.973, inches: '1"' },
  { name: 'Ø 1-1/8" (28.6 mm)', diameter_mm: 28.65, diameter_m: 0.02865, area_cm2: 6.45, weight_kgm: 5.060, inches: '1-1/8"' },
  { name: 'Ø 1-1/4" (32.0 mm)', diameter_mm: 32.00, diameter_m: 0.03200, area_cm2: 8.04, weight_kgm: 6.313, inches: '1-1/4"' },
  { name: 'Ø 8 mm',  diameter_mm: 8.0,  diameter_m: 0.0080, area_cm2: 0.503, weight_kgm: 0.395, inches: '8mm' },
  { name: 'Ø 10 mm', diameter_mm: 10.0, diameter_m: 0.0100, area_cm2: 0.785, weight_kgm: 0.617, inches: '10mm' },
  { name: 'Ø 12 mm', diameter_mm: 12.0, diameter_m: 0.0120, area_cm2: 1.131, weight_kgm: 0.888, inches: '12mm' },
  { name: 'Ø 16 mm', diameter_mm: 16.0, diameter_m: 0.0160, area_cm2: 2.011, weight_kgm: 1.578, inches: '16mm' },
  { name: 'Ø 20 mm', diameter_mm: 20.0, diameter_m: 0.0200, area_cm2: 3.142, weight_kgm: 2.466, inches: '20mm' },
  { name: 'Ø 25 mm', diameter_mm: 25.0, diameter_m: 0.0250, area_cm2: 4.909, weight_kgm: 3.853, inches: '25mm' },
  { name: 'Ø 32 mm', diameter_mm: 32.0, diameter_m: 0.0320, area_cm2: 8.042, weight_kgm: 6.313, inches: '32mm' },
];

export const DEFAULT_FOOTING_DATA = {
  footing_type: 'aislada', // 'aislada' | 'combinada' | 'conectada'

  // ---- Zapata Aislada ----
  isolated: {
    // Geometría en planta: L = dirección X, B = dirección Y (m)
    L: 2.20,
    B: 2.20,
    h: 0.50,       // peralte total de la zapata
    col_L: 0.40,   // columna, dimensión en X
    col_B: 0.40,   // columna, dimensión en Y
    ex_col: 0.0,   // excentricidad de la columna respecto al centro de la zapata, eje X (m)
    ey_col: 0.0,   // ídem, eje Y (m)
    Df: 1.50,      // profundidad de desplante
    // Cargas en la base de la columna (sobre el fuste, nivel superior de la zapata)
    Pd: 35.0,      // carga muerta de servicio (tn)
    Pl: 15.0,      // carga viva de servicio (tn)
    Mx_d: 0.0, Mx_l: 0.0, // momento de servicio en torno al eje "y" (produce excentricidad en X, dirección L) (tn-m)
    My_d: 0.0, My_l: 0.0, // momento de servicio en torno al eje "x" (produce excentricidad en Y, dirección B) (tn-m)
    // Sismo en X e Y (cada uno como un caso de carga de servicio propio,
    // sin descomponer en muerta/viva — igual convención que la hoja de
    // cálculo de referencia: "SXD"/"SYD"). Con ambos en 0 (caso por
    // defecto), la envolvente de 9 combinaciones se reduce a la única
    // combinación de gravedad 1.4CM+1.7CV, igual que antes.
    Psx: 0.0, Mx_sx: 0.0, My_sx: 0.0,
    Psy: 0.0, Mx_sy: 0.0, My_sy: 0.0,
    // Incremento admisible en la capacidad portante para combinaciones
    // que incluyen sismo (E.030) — 1.25 en la hoja de referencia, aunque
    // hay fuentes que usan 1.30; queda configurable.
    seismic_bearing_factor: 1.25,
    // Tipo de columna (afecta αs en punzonamiento: 40 interior, 30
    // medianera/borde, 20 esquinera — E.060 / ACI 318).
    col_type: 'interior',
  },

  // ---- Zapata Combinada (2 columnas, ancho B constante) ----
  combined: {
    L: 5.60,        // longitud total de la zapata (m), a lo largo del eje de columnas
    B: 2.00,        // ancho de la zapata (m)
    h: 0.60,        // peralte total
    a1: 0.50,       // distancia del borde izquierdo de la zapata al eje de la columna 1
    s: 4.50,        // separación entre ejes de columna 1 y columna 2
    col1_L: 0.40, col1_B: 0.40,
    col2_L: 0.45, col2_B: 0.45,
    Df: 1.60,
    P1d: 40.0, P1l: 20.0, // columna 1: carga muerta / viva de servicio (tn)
    P2d: 55.0, P2l: 25.0, // columna 2
  },

  // ---- Zapata Conectada (excéntrica + interior, unidas por viga de
  // conexión / "strap beam"). La columna 1 está en el límite de propiedad:
  // su cara exterior coincide con el borde de la Zapata 1 (no hay
  // proyección de zapata más allá de esa cara), por lo que su carga cae
  // excéntrica respecto al centro de su propia zapata — la viga de
  // conexión transfiere una fuerza a la Zapata 2 (interior, diseñada
  // concéntrica bajo su columna) para que la Zapata 1 trabaje con presión
  // uniforme sin necesitar invadir el terreno vecino.
  connected: {
    L1: 1.60, B1: 2.20, h1: 0.50, // Zapata 1 (excéntrica, en el límite)
    col1_L: 0.40, col1_B: 0.40,
    L2: 2.20, B2: 2.20, h2: 0.50, // Zapata 2 (interior, concéntrica)
    col2_L: 0.40, col2_B: 0.40,
    s: 4.50,          // separación entre ejes de columna 1 y columna 2
    strap_width: 0.30, strap_height: 0.60, // viga de conexión
    Df: 1.50,
    P1d: 25.0, P1l: 10.0, // columna 1 (excéntrica): carga de servicio
    P2d: 45.0, P2l: 20.0, // columna 2 (interior)
    // Momento neto de cada columna (tn·m), en torno al eje transversal a la
    // línea de columnas — signo positivo: tiende a aumentar la reacción de
    // la Zapata 2 (equivalente al "sentido horario positivo" de la
    // memoria de referencia UNI). Entran directamente a la ecuación de
    // equilibrio que resuelve N1/N2 junto con la excentricidad e1.
    M1_d: 0.0, M1_l: 0.0,
    M2_d: 0.0, M2_l: 0.0,
  },

  foundation: {
    gamma_kgm3: 1800.0,   // peso específico del suelo (kg/m³)
    phi: 30.0,            // ángulo de fricción interna (°), referencial
    q_adm_kgcm2: 2.00,    // capacidad portante admisible del estudio de suelos (kg/cm²), a la profundidad Df
  },

  materials: {
    fc_kgcm2: 210.0,
    fy_kgcm2: 4200.0,
    gamma_c_kgm3: 2400.0,
    cover_footing: 0.075,   // recubrimiento libre (7.5 cm), contacto con el terreno
    rebar_main_id: 2,       // barra principal (Ø 5/8" por defecto)
    rebar_trans_id: 1,      // barra transversal / temperatura
  },

  safety_req: {
    code: 'E060',
    LF_D: 1.4,
    LF_L: 1.7,
  },

  plano: {
    proyecto: '',
    propietario: '',
    ubicacion: '',
    dibujado_por: 'Ing. Dan Oliden',
    revisado_por: '',
    escala: 'Como se indica',
    codigo: 'E-01',
  }
};

export const PRESET_PROJECTS = {
  zapata_aislada_tipica: {
    title: '⭐ Zapata Aislada Típica (P=50 tn, q_adm=2.0 kg/cm²)',
    desc: 'Columna 40x40cm, carga de servicio 50 tn, sin momentos, suelo con capacidad admisible 2.0 kg/cm² a Df=1.50m.',
    data: JSON.parse(JSON.stringify(DEFAULT_FOOTING_DATA))
  },
  zapata_aislada_excentrica: {
    title: 'Zapata Aislada con Momento (columna de esquina/borde)',
    desc: 'Columna 40x40cm con carga axial y momento uniaxial (Mx), suelo q_adm=1.5 kg/cm².',
    data: (() => {
      const d = JSON.parse(JSON.stringify(DEFAULT_FOOTING_DATA));
      d.footing_type = 'aislada';
      d.isolated.L = 2.60; d.isolated.B = 2.20;
      d.isolated.Pd = 30.0; d.isolated.Pl = 12.0;
      d.isolated.Mx_d = 6.0; d.isolated.Mx_l = 3.0;
      d.foundation.q_adm_kgcm2 = 1.5;
      return d;
    })()
  },
  zapata_aislada_sismo: {
    title: 'Zapata Aislada Interior con Sismo (envolvente de 9 combinaciones)',
    desc: 'Columna interior 0.35×0.25 m con cargas de gravedad y sismo en X e Y (caso de referencia de una hoja de cálculo real de diseño estructural).',
    data: (() => {
      const d = JSON.parse(JSON.stringify(DEFAULT_FOOTING_DATA));
      d.footing_type = 'aislada';
      d.isolated.L = 1.95; d.isolated.B = 1.85; d.isolated.h = 0.50;
      d.isolated.col_L = 0.35; d.isolated.col_B = 0.25;
      d.isolated.Df = 1.50;
      d.isolated.Pd = 21.8576; d.isolated.Pl = 5.1633;
      d.isolated.Mx_d = 0.522; d.isolated.Mx_l = 0.16;
      d.isolated.My_d = 0.0177; d.isolated.My_l = 0.007;
      d.isolated.Psx = 0.4589; d.isolated.Mx_sx = 0.0; d.isolated.My_sx = 0.0149;
      d.isolated.Psy = 0.5271; d.isolated.Mx_sy = 0.008; d.isolated.My_sy = 0.0;
      d.isolated.col_type = 'interior';
      d.foundation.gamma_kgm3 = 1900.0;
      d.foundation.q_adm_kgcm2 = 1.0;
      return d;
    })()
  },
  zapata_combinada_tipica: {
    title: 'Zapata Combinada — 2 Columnas (Columna de Borde + Columna Interior)',
    desc: 'Caso clásico: columna 1 al borde de propiedad (no admite zapata aislada) + columna 2 interior, unidas por una zapata combinada rectangular.',
    data: (() => {
      const d = JSON.parse(JSON.stringify(DEFAULT_FOOTING_DATA));
      d.footing_type = 'combinada';
      return d;
    })()
  },
  zapata_conectada_tipica: {
    title: 'Zapata Conectada — Columna de Límite de Propiedad + Viga de Conexión',
    desc: 'Columna 1 en el límite de propiedad (zapata excéntrica) conectada mediante viga de conexión a la Zapata 2 (interior, concéntrica bajo su columna).',
    data: (() => {
      const d = JSON.parse(JSON.stringify(DEFAULT_FOOTING_DATA));
      d.footing_type = 'conectada';
      return d;
    })()
  }
};
