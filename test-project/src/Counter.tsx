import { useState } from 'react';

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
    <div>
      <div>{count}</div>
    </div>
  );
};
