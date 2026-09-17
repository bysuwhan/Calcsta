/**
 * Index of all example model fixtures.
 * Each fixture is a JSON file in the fixtures/ directory.
 * Dynamic imports keep the initial bundle small — fixtures are loaded on demand.
 */
type FixtureLoader = () => Promise<any>;

// 2D examples
const fixtures2D: Record<string, FixtureLoader> = {
  'simply-supported': () => import('./fixtures/simply-supported.json'),
  'cantilever': () => import('./fixtures/cantilever.json'),
  'cantilever-point': () => import('./fixtures/cantilever-point.json'),
  'continuous-beam': () => import('./fixtures/continuous-beam.json'),
  'portal-frame': () => import('./fixtures/portal-frame.json'),
  'two-story-frame': () => import('./fixtures/two-story-frame.json'),
  'multi-section-frame': () => import('./fixtures/multi-section-frame.json'),
  'color-map-demo': () => import('./fixtures/color-map-demo.json'),
  'truss': () => import('./fixtures/truss.json'),
  'warren-truss': () => import('./fixtures/warren-truss.json'),
  'howe-truss': () => import('./fixtures/howe-truss.json'),
  'point-loads': () => import('./fixtures/point-loads.json'),
  'spring-support': () => import('./fixtures/spring-support.json'),
  'settlement': () => import('./fixtures/settlement.json'),
  'three-hinge-arch': () => import('./fixtures/three-hinge-arch.json'),
  'gerber-beam': () => import('./fixtures/gerber-beam.json'),
  'bridge-moving-load': () => import('./fixtures/bridge-moving-load.json'),
  'bridge-highway': () => import('./fixtures/bridge-highway.json'),
  'frame-cirsoc-dl': () => import('./fixtures/frame-cirsoc-dl.json'),
  'building-3story-dlw': () => import('./fixtures/building-3story-dlw.json'),
  'frame-seismic': () => import('./fixtures/frame-seismic.json'),
  /*
   * Two spans on three supports that each restrain only the vertical — the
   * textbook case where the degree formula and the truth disagree.
   *
   *   g = 3·m + r − 3·n = 3×2 + 3 − 3×3 = 0
   *
   * Zero says "isostatic", and the structure is a mechanism: nothing holds it
   * horizontally. Kinematic analysis reports it as HYPOSTATIC anyway, names
   * node 3 and the ux degree of freedom, and refuses to solve.
   *
   * It exists for the blog post on the conceptual side of the advanced tools,
   * which needs a model where a reader can watch a formula be overruled.
   * Deliberately not in the examples menu: that is a catalogue of structures
   * that work, and this one is meant not to.
   */
  'hidden-mechanism': () => import('./fixtures/hidden-mechanism.json'),
};

/**
 * Fixtures that are NOT supposed to solve.
 *
 * Every audit suite walks the fixtures directory and asserts that each model
 * solves and produces finite diagrams. That is the right default and it must
 * stay strict — so a model whose entire purpose is
 * to be unsolvable has to say so here rather than have the assertion relaxed
 * for everyone.
 *
 * Listing one is a claim that its failure is the designed behaviour. Do not
 * add a fixture here to quiet a suite: if a model that should work stops
 * working, the audit is right and the model is wrong.
 */
export const INTENTIONALLY_UNSOLVABLE = new Set<string>([
  // Three supports that each restrain only the vertical: g = 0 by formula,
  // a mechanism in fact. The blog post on the conceptual side of the advanced
  // tools opens the kinematic panel on it precisely to show the solver refuse.
  'hidden-mechanism',
]);

export function getFixture(name: string): FixtureLoader | undefined {
  return fixtures2D[name];
}

export function is2DFixture(name: string): boolean {
  return name in fixtures2D;
}

export function is3DFixture(_name: string): boolean {
  return false;
}
