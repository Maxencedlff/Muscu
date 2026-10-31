// Seuils du niveau de force, GÉNÉRÉS par scripts/strength-standards.py : ne pas modifier à la main.
// Source : openpowerlifting-2026-10-31-4a1c65a7.csv, OpenPowerlifting (https://www.openpowerlifting.org), domaine public.
// Rapport charge ÷ poids du corps des compétiteurs Raw de fédérations contrôlées, à leur première
// compétition ; seuils [novice, intermédiaire, avancé, élite] = percentiles 2, 15, 50, 90.
// max : borne haute de la catégorie de poids en kg (null = au-delà). Méthode : docs/ENTRAINEMENT.md
'use strict';

const STRENGTH_STANDARDS = {
  squat: {
    male: [{ max: 59, thr: [0.80, 1.50, 2.20, 2.85] }, { max: 66, thr: [1.15, 1.75, 2.30, 2.85] }, { max: 74, thr: [1.25, 1.80, 2.25, 2.75] }, { max: 83, thr: [1.30, 1.80, 2.20, 2.65] }, { max: 93, thr: [1.25, 1.70, 2.10, 2.55] }, { max: 105, thr: [1.10, 1.60, 2.00, 2.45] }, { max: 120, thr: [1.00, 1.50, 1.85, 2.30] }, { max: null, thr: [0.75, 1.25, 1.65, 2.10] }],
    female: [{ max: 47, thr: [0.75, 1.20, 1.65, 2.20] }, { max: 52, thr: [0.90, 1.30, 1.70, 2.20] }, { max: 57, thr: [0.90, 1.30, 1.70, 2.15] }, { max: 63, thr: [0.90, 1.25, 1.60, 2.10] }, { max: 69, thr: [0.85, 1.20, 1.55, 2.00] }, { max: 76, thr: [0.80, 1.15, 1.50, 1.90] }, { max: 84, thr: [0.70, 1.05, 1.40, 1.80] }, { max: null, thr: [0.55, 0.85, 1.20, 1.60] }],
  },
  bench: {
    male: [{ max: 59, thr: [0.55, 1.00, 1.50, 2.05] }, { max: 66, thr: [0.80, 1.20, 1.55, 1.95] }, { max: 74, thr: [0.85, 1.20, 1.50, 1.90] }, { max: 83, thr: [0.90, 1.20, 1.50, 1.85] }, { max: 93, thr: [0.85, 1.15, 1.45, 1.75] }, { max: 105, thr: [0.80, 1.10, 1.40, 1.70] }, { max: 120, thr: [0.70, 1.00, 1.30, 1.65] }, { max: null, thr: [0.55, 0.85, 1.15, 1.50] }],
    female: [{ max: 47, thr: [0.50, 0.70, 0.95, 1.35] }, { max: 52, thr: [0.55, 0.75, 0.95, 1.25] }, { max: 57, thr: [0.55, 0.70, 0.95, 1.25] }, { max: 63, thr: [0.50, 0.70, 0.90, 1.20] }, { max: 69, thr: [0.50, 0.65, 0.85, 1.15] }, { max: 76, thr: [0.45, 0.65, 0.80, 1.10] }, { max: 84, thr: [0.45, 0.60, 0.75, 1.00] }, { max: null, thr: [0.35, 0.50, 0.65, 0.85] }],
  },
  deadlift: {
    male: [{ max: 59, thr: [1.20, 1.90, 2.70, 3.40] }, { max: 66, thr: [1.55, 2.20, 2.80, 3.35] }, { max: 74, thr: [1.65, 2.25, 2.70, 3.25] }, { max: 83, thr: [1.65, 2.15, 2.60, 3.05] }, { max: 93, thr: [1.55, 2.05, 2.45, 2.90] }, { max: 105, thr: [1.40, 1.90, 2.30, 2.70] }, { max: 120, thr: [1.25, 1.75, 2.10, 2.50] }, { max: null, thr: [0.95, 1.40, 1.80, 2.20] }],
    female: [{ max: 47, thr: [1.10, 1.60, 2.10, 2.70] }, { max: 52, thr: [1.20, 1.65, 2.10, 2.65] }, { max: 57, thr: [1.25, 1.65, 2.05, 2.55] }, { max: 63, thr: [1.20, 1.60, 2.00, 2.45] }, { max: 69, thr: [1.15, 1.55, 1.90, 2.35] }, { max: 76, thr: [1.10, 1.45, 1.80, 2.20] }, { max: 84, thr: [1.00, 1.35, 1.65, 2.05] }, { max: null, thr: [0.80, 1.05, 1.40, 1.80] }],
  },
};
