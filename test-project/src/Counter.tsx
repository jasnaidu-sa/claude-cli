import { useState } from 'react';

export const Counter = () => {
  const [count, setCount] = useState<number>(0);

  return (
    <div>
      <div>{count}</div>
    </div>
  );
};
