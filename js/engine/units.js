/**
 * Conversión de unidades usuales de ingeniería civil peruana (tn, kg/cm²,
 * kg/m³) al sistema interno de cálculo (kN, kPa, kN/m³, m).
 */

export const TN_TO_KN = 9.80665;
export const KGCM2_TO_KPA = 98.0665;
export const KGM3_TO_KNM3 = 9.80665 / 1000.0;
export const KGCM2_TO_MPA = 0.0980665;

export function tnToKn(tn) { return tn * TN_TO_KN; }
export function knToTn(kn) { return kn / TN_TO_KN; }
export function kgcm2ToKpa(k) { return k * KGCM2_TO_KPA; }
export function kpaToKgcm2(k) { return k / KGCM2_TO_KPA; }
export function kgm3ToKnm3(k) { return k * KGM3_TO_KNM3; }
export function kgcm2ToMpa(k) { return k * KGCM2_TO_MPA; }
export function knToKg(kn) { return (kn * 1000.0) / 9.80665; }
export function kNmToKgm(knm) { return (knm * 1000.0) / 9.80665; }
