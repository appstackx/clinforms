import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skeleton-loading rounded-xl", className)}
      {...props}
    />
  );
}

export { Skeleton };
