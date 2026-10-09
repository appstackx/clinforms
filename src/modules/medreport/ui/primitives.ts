/**
 * The ONLY bridge from the module to the host app's design system. Everything in the module's UI
 * imports Button, Card, etc. from here – never from "@/components/*" or "@/lib/*" directly (enforced by
 * ESLint). Extracting the module means copying this one file's targets.
 *
 * Shared contract (orchestrator-owned): add re-exports only.
 */
export { Button, buttonVariants, type ButtonProps } from "@/components/ui/button";
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
export { Badge, badgeVariants, type BadgeProps } from "@/components/ui/badge";
export { Input, type InputProps } from "@/components/ui/input";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
export { Separator } from "@/components/ui/separator";
export { Skeleton } from "@/components/ui/skeleton";
export { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
export { cn } from "@/lib/utils";
