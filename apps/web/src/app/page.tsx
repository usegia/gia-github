import { Suspense } from "react";
import { SearchWorkspace } from "@/features/search/search-workspace";

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="page-loading" role="status">
          Opening the collection…
        </div>
      }
    >
      <SearchWorkspace />
    </Suspense>
  );
}
