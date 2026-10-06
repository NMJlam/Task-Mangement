import { Link } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";

/** Any address no route claims — a mistyped link, or a page that has moved. */
export function NotFoundPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Page not found"
        description="There is nothing at this address. The link may be mistyped, or the page may have moved."
      />
      <Button asChild className="mt-8">
        <Link to="/">Go to the dashboard</Link>
      </Button>
    </main>
  );
}
