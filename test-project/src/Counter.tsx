import React, { useState } from 'react';

export const Counter = () => {
  const [count, setCount] = useState<number>(0);

  const handleIncrement = (): void => {
    setCount(count + 1);
  };

  const handleDecrement = (): void => {
    setCount(count - 1);
  };

  const handleReset = (): void => {
    setCount(0);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        fontSize: '48px',
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: '20px'
      }}>
        {count}
      </div>
      <div style={{
        display: 'flex',
        gap: '10px',
        justifyContent: 'center'
      }}>
        <button onClick={handleDecrement} style={{
          padding: '10px 20px',
          fontSize: '16px',
          cursor: 'pointer'
        }}>
          -
        </button>
        <button onClick={handleIncrement} style={{
          padding: '10px 20px',
          fontSize: '16px',
          cursor: 'pointer'
        }}>
          +
        </button>
        <button onClick={handleReset} style={{
          padding: '10px 20px',
          fontSize: '16px',
          cursor: 'pointer'
        }}>
          Reset
        </button>
      </div>
    </div>
  );
};
