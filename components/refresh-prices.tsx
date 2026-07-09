"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { refreshPrices } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RefreshPricesButton() {
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await refreshPrices();
          if (res.ok) toast.success(res.message);
          else toast.warning(res.message);
        })
      }
    >
      <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
      Refresh prices
    </Button>
  );
}
