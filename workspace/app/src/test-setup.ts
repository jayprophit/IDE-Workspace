// Test setup: wire the declared @testing-library/jest-dom matchers.
//
// The dependency was already in package.json but no setup file loaded it, so
// every DOM assertion like toBeDisabled() silently did not exist. A test that
// cannot express "this control is disabled" will happily assert the opposite.
import '@testing-library/jest-dom/vitest';
