# Feature Specification: Counter Component

## Overview

A simple, self-contained React counter component with increment, decrement, and reset functionality. The component uses TypeScript and React hooks with inline styling, requiring no external dependencies beyond React itself.

## Requirements

### Functional Requirements
- Display a numeric counter value prominently in the center
- Provide three buttons: increment (`+`), decrement (`−`), and reset (`Reset`)
- Increment button adds 1 to the current count
- Decrement button subtracts 1 from the current count
- Reset button returns the count to 0
- Counter must support negative values
- Counter always starts at 0 (no configurable initial value)

### Technical Constraints
- TypeScript with strict typing
- React functional component using `useState` hook
- No external dependencies (only React)
- Inline styles only (no CSS files or CSS modules)
- No props required - fully self-contained component
- Named export pattern for barrel file

## Architecture

### Project Structure
```
src/
├── Counter.tsx        # Main counter component
├── Counter.test.tsx   # Unit tests with React Testing Library
└── index.ts           # Export barrel (named exports)
```

### Component Design
- **State Management**: Single `useState<number>` hook initialized to `0`
- **Event Handlers**: Three inline handlers for increment, decrement, and reset
- **Layout**: Flexbox container with centered content, count display above buttons
- **Styling**: Inline style objects for maintainability

### Integration Points
- Exports via `src/index.ts` as named export: `export { Counter } from './Counter'`
- Standalone component with no dependencies on other project code
- Compatible with existing React 18.x setup in `package.json`

## Implementation Steps

1. **Create `src/Counter.tsx`**
   - Define `Counter` functional component with `React.FC` type
   - Implement `useState<number>(0)` for count state
   - Create three handler functions: `handleIncrement`, `handleDecrement`, `handleReset`
   - Build JSX structure:
     - Outer container div with flexbox centering
     - Count display element (prominent styling, large font)
     - Button container with three buttons (`−`, `+`, `Reset`)
   - Apply inline styles for layout and visual hierarchy
   - Export component as named export

2. **Update `src/index.ts`**
   - Add named export: `export { Counter } from './Counter'`

3. **Create `src/Counter.test.tsx`**
   - Import `render`, `screen`, `fireEvent` from `@testing-library/react`
   - Import `Counter` component
   - Write test suite with four test cases:
     - "renders with initial count of 0"
     - "increments count when + button is clicked"
     - "decrements count when − button is clicked (including negative)"
     - "resets count to 0 from any value"

## Testing

### Unit Test Cases

| Test Case | Action | Expected Result |
|-----------|--------|-----------------|
| Initial render | Render component | Display shows "0" |
| Increment | Click `+` button once | Display shows "1" |
| Multiple increment | Click `+` button 3 times | Display shows "3" |
| Decrement | Click `−` button once from 0 | Display shows "-1" |
| Decrement negative | Click `−` button 3 times from 0 | Display shows "-3" |
| Reset from positive | Increment to 5, click `Reset` | Display shows "0" |
| Reset from negative | Decrement to -3, click `Reset` | Display shows "0" |

### Test Commands
```bash
npm test
```

### Manual Verification
1. Import and render the Counter component in your app
2. Verify count displays "0" on initial load
3. Click `+` button and verify count increases
4. Click `−` button and verify count decreases (test negative values)
5. Click `Reset` and verify count returns to 0

## Code Specifications

### Counter.tsx Interface
```typescript
// No props interface needed - component is self-contained
export const Counter: React.FC = () => { ... }
```

### Inline Style Structure
```typescript
const styles = {
  container: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px' },
  count: { fontSize: '48px', fontWeight: 'bold', margin: '20px 0' },
  buttonContainer: { display: 'flex', gap: '10px' },
  button: { padding: '10px 20px', fontSize: '16px', cursor: 'pointer' }
}
```

### Test File Structure
```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { Counter } from './Counter'

describe('Counter', () => {
  test('renders with initial count of 0', () => { ... })
  test('increments count when + button is clicked', () => { ... })
  test('decrements count including negative values', () => { ... })
  test('resets count to 0 from any value', () => { ... })
})
```

---

**Status**: Ready for Implementation
**Complexity**: Low
**Estimated Files**: 3 (Counter.tsx, Counter.test.tsx, index.ts update)
