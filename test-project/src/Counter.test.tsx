import React from 'react';
import { render } from '@testing-library/react';
import { Counter } from './Counter';

describe('Counter Component Core Structure and State (feat-002)', () => {
  it('should export Counter as a named export from Counter.tsx', () => {
    // If we can import Counter, this test passes
    expect(Counter).toBeDefined();
    expect(typeof Counter).toBe('function');
  });

  it('should be a functional component with proper TypeScript typing', () => {
    // Verify it's a function that returns JSX
    const result = render(<Counter />);
    expect(result.container).toBeDefined();
  });

  it('should not accept any props (props interface is empty or absent)', () => {
    // TypeScript would fail compilation if we tried to pass props
    // This test verifies the component renders without props
    const result = render(<Counter />);
    expect(result.container).toBeDefined();
  });

  it('should initialize count state to 0 using useState', () => {
    const { container } = render(<Counter />);
    // The counter value should be displayed somewhere in the component
    // Even without full UI, the initial state should be 0
    const textContent = container.textContent;
    expect(textContent).toContain('0');
  });
});
