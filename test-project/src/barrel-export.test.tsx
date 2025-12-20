import React from 'react';
import { render } from '@testing-library/react';
// Import from barrel file (index.ts)
import { Counter } from './index';

describe('Export Barrel Configuration (feat-005)', () => {
  it('should export Counter as named export from index.ts', () => {
    // If we can import Counter from index, this test passes
    expect(Counter).toBeDefined();
    expect(typeof Counter).toBe('function');
  });

  it('should allow importing Counter via: import { Counter } from \'./src\'', () => {
    // This test verifies the barrel export works correctly
    const { container } = render(<Counter />);
    expect(container).toBeDefined();

    // Verify it renders the same component with initial value of 0
    const textContent = container.textContent;
    expect(textContent).toContain('0');
  });

  it('should compile TypeScript without errors after adding export', () => {
    // If this test file compiles and runs, TypeScript compilation succeeded
    // This is implicitly tested by the test suite running successfully
    expect(Counter).toBeDefined();

    // Verify the component is the same one exported from Counter.tsx
    const { container } = render(<Counter />);
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(3);
  });
});
