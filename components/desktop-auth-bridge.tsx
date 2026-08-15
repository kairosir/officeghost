"use client";

import { useEffect } from "react";

export function DesktopAuthBridge({ deepLink }: { deepLink: string }) {
  useEffect(() => {
    const timer = window.setTimeout(() => window.location.assign(deepLink), 350);
    return () => window.clearTimeout(timer);
  }, [deepLink]);

  return (
    <a className="desktop-auth-button" href={deepLink}>
      Открыть OfficeGhost
      <span>↗</span>
    </a>
  );
}
