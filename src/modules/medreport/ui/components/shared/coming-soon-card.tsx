/**
 * Placeholder card used by screens that are not built yet.
 *
 * Owner: studio-a agent.
 */
import { Construction } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../primitives";

export function ComingSoonCard({ title, description }: { title: string; description?: string }) {
  return (
    <Card className="mx-auto max-w-xl border-dashed">
      <CardHeader>
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <Construction className="h-5 w-5" aria-hidden />
        </div>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description ?? "Coming soon."}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">This screen is being built.</CardContent>
    </Card>
  );
}
