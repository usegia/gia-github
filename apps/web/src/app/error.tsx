"use client";

import { Button } from "@/components/ui/button";

export default function PageError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page-error" role="alert">
      <span className="eyebrow">TEMPORARILY UNAVAILABLE</span>
      <h1>We could not load this page.</h1>
      <p>The collection may be unavailable. Your search is not being retried automatically.</p>
      <Button onClick={reset}>Try loading again</Button>
    </div>
  );
}
