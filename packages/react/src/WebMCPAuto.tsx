import { useEffect } from 'react';
import type { WebMCPAutoConfig } from '@react-webmcp-auto/core';
import { initWebMCPAuto, stopWebMCPAuto } from './init';

/** Mount once near the root. Unmounting aborts all registrations. */
export function WebMCPAuto({ config }: { config?: WebMCPAutoConfig }): null {
  useEffect(() => {
    void initWebMCPAuto(config);
    return () => void stopWebMCPAuto();
    // The config is read once at mount by design; remount to change it.
  }, []);
  return null;
}
