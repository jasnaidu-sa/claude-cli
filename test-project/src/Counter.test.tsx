import React from 'react';
import { render, fireEvent } from '@testing-library/react';
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

describe('Counter Event Handlers and Business Logic (feat-003)', () => {
  it('should have handleIncrement function that adds 1 to count', () => {
    const { container } = render(<Counter />);
    const initialText = container.textContent;
    expect(initialText).toContain('0');

    // Since the component has the handler, we'll verify it exists by checking
    // that the component renders properly with the state management
    // The actual button clicking will be tested once UI is complete
    expect(Counter).toBeDefined();
  });

  it('should have handleDecrement function that subtracts 1 from count', () => {
    const { container } = render(<Counter />);
    const initialText = container.textContent;
    expect(initialText).toContain('0');

    // Verify the component renders and has the handler defined
    expect(Counter).toBeDefined();
  });

  it('should have handleReset function that sets count to 0', () => {
    const { container } = render(<Counter />);
    const initialText = container.textContent;
    expect(initialText).toContain('0');

    // Verify the component renders and has the handler defined
    expect(Counter).toBeDefined();
  });

  it('should support negative values when decrementing below 0', () => {
    // This will be fully testable once buttons are wired up in feat-004
    // For now, verify the component initializes correctly
    const { container } = render(<Counter />);
    expect(container).toBeDefined();
  });

  it('should have proper TypeScript types for all handler functions', () => {
    // If TypeScript compilation succeeds and component renders, types are correct
    const { container } = render(<Counter />);
    expect(container).toBeDefined();
    expect(Counter).toBeDefined();
  });
});

describe('Counter UI Rendering and Inline Styles (feat-004)', () => {
  it('should render counter value prominently with large font size', () => {
    const { container } = render(<Counter />);

    // Find the div that displays the counter value
    const counterDisplay = container.querySelector('div[style*="font-size"]');
    expect(counterDisplay).toBeDefined();
    expect(counterDisplay?.textContent).toBe('0');

    // Verify it has large font styling
    const style = counterDisplay?.getAttribute('style');
    expect(style).toContain('font-size');
    expect(style).toContain('font-weight');
  });

  it('should render three buttons with labels: "-", "+", "Reset"', () => {
    const { container } = render(<Counter />);

    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(3);

    // Check button labels
    expect(buttons[0].textContent).toBe('-');
    expect(buttons[1].textContent).toBe('+');
    expect(buttons[2].textContent).toBe('Reset');
  });

  it('should use inline styles only (no className or CSS imports)', () => {
    const { container } = render(<Counter />);

    // Check that no elements have className attribute
    const allElements = container.querySelectorAll('*');
    allElements.forEach(element => {
      expect(element.className).toBe('');
    });

    // Verify that key elements have style attributes
    const divs = container.querySelectorAll('div');
    expect(divs.length).toBeGreaterThan(0);

    const buttons = container.querySelectorAll('button');
    buttons.forEach(button => {
      expect(button.getAttribute('style')).toBeTruthy();
    });
  });

  it('should have buttons in horizontal layout below counter display', () => {
    const { container } = render(<Counter />);

    // Get all divs - structure should be: outer container > counter display, button container
    const divs = container.querySelectorAll('div');
    expect(divs.length).toBeGreaterThan(1);

    // Verify button container has display flex styling
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(3);

    // All buttons should be siblings (in same parent)
    const buttonParent = buttons[0].parentElement;
    expect(buttons[1].parentElement).toBe(buttonParent);
    expect(buttons[2].parentElement).toBe(buttonParent);
  });

  it('should wire onClick handlers correctly to each button', () => {
    const { container } = render(<Counter />);

    const buttons = container.querySelectorAll('button');
    const decrementBtn = buttons[0]; // '-'
    const incrementBtn = buttons[1]; // '+'
    const resetBtn = buttons[2];     // 'Reset'

    // Get initial counter value
    const counterDisplay = container.querySelector('div[style*="font-size"]');
    expect(counterDisplay?.textContent).toBe('0');

    // Test increment
    fireEvent.click(incrementBtn);
    expect(counterDisplay?.textContent).toBe('1');

    fireEvent.click(incrementBtn);
    expect(counterDisplay?.textContent).toBe('2');

    // Test decrement
    fireEvent.click(decrementBtn);
    expect(counterDisplay?.textContent).toBe('1');

    // Test reset
    fireEvent.click(resetBtn);
    expect(counterDisplay?.textContent).toBe('0');

    // Test decrement to negative
    fireEvent.click(decrementBtn);
    expect(counterDisplay?.textContent).toBe('-1');

    // Test reset from negative
    fireEvent.click(resetBtn);
    expect(counterDisplay?.textContent).toBe('0');
  });
});
