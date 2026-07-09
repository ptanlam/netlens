"use client";

import * as React from "react";
import { toast } from "sonner";
import { login } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [pending, startTransition] = React.useTransition();
  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await login(fd);
          if (res && !res.ok) toast.error(res.message);
        })
      }
      className="grid gap-4"
    >
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoFocus required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
