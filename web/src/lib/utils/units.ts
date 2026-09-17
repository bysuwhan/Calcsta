// Unit system conversion utilities
// Internal model always uses SI (m, kN, kN/m, kN·m, MPa, m², m⁴).
// Stress is an independent display preference: it is not inferred from the
// length/force unit system.

export type UnitSystem = 'SI' | 'SI_MM' | 'Imperial';
export type StressUnit = 'MPa' | 'kgf/cm²';

let selectedStressUnit: StressUnit = 'MPa';

/** Set the application-wide stress display unit used at every UI boundary. */
export function setStressUnit(unit: StressUnit): void {
  selectedStressUnit = unit;
}

export function getStressUnit(): StressUnit {
  return selectedStressUnit;
}

export type Quantity =
  | 'length'           // m ↔ ft
  | 'force'            // kN ↔ kip
  | 'moment'           // kN·m ↔ kip·ft
  | 'distributedLoad'  // kN/m ↔ kip/ft
  | 'stress'           // MPa ↔ ksi
  | 'area'             // m² ↔ in²
  | 'inertia'          // m⁴ ↔ in⁴
  | 'sectionModulus'   // m³ ↔ in³
  | 'areaLoad'         // kN/m² ↔ kip/ft²
  | 'density'          // kN/m³ ↔ pcf (lb/ft³)
  | 'displacement'     // m ↔ in
  | 'rotation'         // rad ↔ rad (same)
  | 'springK'          // kN/m ↔ kip/ft
  | 'springKr'         // kN·m/rad ↔ kip·ft/rad
  | 'compliance'       // m/kN ↔ ft/kip
  | 'temperature';     // °C ↔ °F

// Conversion factors: multiply SI value by factor to get imperial value
const FACTORS: Record<Quantity, number> = {
  length: 3.28084,             // m → ft
  force: 0.224809,             // kN → kip
  moment: 0.737562,            // kN·m → kip·ft
  distributedLoad: 0.0685218,  // kN/m → kip/ft
  stress: 0.145038,            // MPa → ksi
  area: 1550.003,              // m² → in²
  inertia: 2402509.61,         // m⁴ → in⁴
  sectionModulus: 61023.7441,   // m³ → in³
  areaLoad: 0.0208854,          // kN/m² → kip/ft²
  density: 6.36587,            // kN/m³ → pcf
  displacement: 39.3701,       // m → in
  rotation: 1,                 // rad → rad
  springK: 0.0685218,          // kN/m → kip/ft
  springKr: 0.737562,          // kN·m/rad → kip·ft/rad
  compliance: 3.28084 / 0.224809, // m/kN → ft/kip
  temperature: 1,              // special handling (affine)
};

// Engineering gravitational metric display. The model remains in SI; kgf is
// used only at the UI boundary. Standard gravity is exact by definition.
const KG_FORCE_PER_KN = 1000 / 9.80665;
const SI_MM_FACTORS: Record<Quantity, number> = {
  length: 1000,
  force: KG_FORCE_PER_KN,
  moment: KG_FORCE_PER_KN * 1000,
  distributedLoad: KG_FORCE_PER_KN / 1000,
  areaLoad: KG_FORCE_PER_KN / 1_000_000,
  stress: 1 / 9.80665,
  area: 1_000_000,
  sectionModulus: 1_000_000_000,
  inertia: 1_000_000_000_000,
  // Internal rho is weight density (kN/m³); display is mass density kg/mm³.
  density: KG_FORCE_PER_KN / 1_000_000_000,
  displacement: 1000,
  rotation: 1,
  springK: KG_FORCE_PER_KN / 1000,
  springKr: KG_FORCE_PER_KN * 1000,
  compliance: 1000 / KG_FORCE_PER_KN,
  temperature: 1,
};

// SI unit labels
const SI_LABELS: Record<Quantity, string> = {
  length: 'm',
  force: 'kN',
  moment: 'kN·m',
  distributedLoad: 'kN/m',
  stress: 'MPa',
  area: 'm²',
  inertia: 'm⁴',
  sectionModulus: 'm³',
  areaLoad: 'kN/m²',
  density: 'kN/m³',
  displacement: 'm',
  rotation: 'rad',
  springK: 'kN/m',
  springKr: 'kN·m/rad',
  compliance: 'm/kN',
  temperature: '°C',
};

const SI_MM_LABELS: Record<Quantity, string> = {
  length: 'mm',
  force: 'kgf',
  moment: 'kgf·mm',
  distributedLoad: 'kgf/mm',
  areaLoad: 'kgf/mm²',
  stress: 'kgf/mm²',
  area: 'mm²',
  sectionModulus: 'mm³',
  inertia: 'mm⁴',
  density: 'kg/mm³',
  displacement: 'mm',
  rotation: 'rad',
  springK: 'kgf/mm',
  springKr: 'kgf·mm/rad',
  compliance: 'mm/kgf',
  temperature: '°C',
};

// Imperial unit labels
const IMPERIAL_LABELS: Record<Quantity, string> = {
  length: 'ft',
  force: 'kip',
  moment: 'kip·ft',
  distributedLoad: 'kip/ft',
  stress: 'ksi',
  area: 'in²',
  inertia: 'in⁴',
  sectionModulus: 'in³',
  areaLoad: 'kip/ft²',
  density: 'pcf',
  displacement: 'in',
  rotation: 'rad',
  springK: 'kip/ft',
  springKr: 'kip·ft/rad',
  compliance: 'ft/kip',
  temperature: '°F',
};

/**
 * Convert an SI value to display value in the given unit system.
 */
export function toDisplay(value: number, qty: Quantity, system: UnitSystem): number {
  if (qty === 'stress') return selectedStressUnit === 'kgf/cm²' ? value * (100 / 9.80665) : value;
  if (system === 'SI') return value;
  if (system === 'SI_MM') return value * SI_MM_FACTORS[qty];
  if (qty === 'temperature') return value * 9 / 5 + 32; // °C → °F
  return value * FACTORS[qty];
}

/**
 * Convert a display value (in the given unit system) back to SI.
 */
export function fromDisplay(value: number, qty: Quantity, system: UnitSystem): number {
  if (qty === 'stress') return selectedStressUnit === 'kgf/cm²' ? value / (100 / 9.80665) : value;
  if (system === 'SI') return value;
  if (system === 'SI_MM') return value / SI_MM_FACTORS[qty];
  if (qty === 'temperature') return (value - 32) * 5 / 9; // °F → °C
  return value / FACTORS[qty];
}

/**
 * Get the unit label string for a quantity in a given system.
 */
export function unitLabel(qty: Quantity, system: UnitSystem): string {
  if (qty === 'stress') return selectedStressUnit;
  if (system === 'SI') return SI_LABELS[qty];
  if (system === 'SI_MM') return SI_MM_LABELS[qty];
  return IMPERIAL_LABELS[qty];
}

/**
 * Format a value with appropriate precision for display.
 */
export function formatValue(value: number, qty: Quantity, system: UnitSystem): string {
  const displayVal = toDisplay(value, qty, system);
  const abs = Math.abs(displayVal);
  if (abs < 1e-10) return '0';
  if (abs >= 1000) return displayVal.toFixed(0);
  if (abs >= 100) return displayVal.toFixed(1);
  if (abs >= 1) return displayVal.toFixed(2);
  if (abs >= 0.01) return displayVal.toFixed(4);
  return displayVal.toExponential(3);
}
