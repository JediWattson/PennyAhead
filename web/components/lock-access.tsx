'use client';
import { useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { Button } from './ui/button';

export function LockAccess() {
  const [error, setError] = useState(false);
  return (
    <div className="access-control">
      <Button
        variant="ghost"
        size="sm"
        onClick={async () => {
          try {
            const response = await fetch('/api/access', { method: 'DELETE' });
            if (!response.ok) throw new Error('Lock failed');
            window.location.replace('/unlock');
          } catch {
            setError(true);
          }
        }}
      >
        <LockKeyhole size={14} />
        Lock this browser
      </Button>
      {error && <span role="alert">Unable to lock. Try again.</span>}
    </div>
  );
}
