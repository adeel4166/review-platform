"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { t } from "@/i18n/en";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "./ui/primitives/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/primitives/tooltip";

/** System / Light / Dark preference (ADR-0034 D7). Stored in localStorage only; the no-flash script is injected by ThemeProvider. */
export function ThemeToggle() {
  const { theme = "system", setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const Icon = !mounted ? Sun : resolvedTheme === "dark" ? Moon : Sun;
  return (
    <TooltipProvider delayDuration={300}>
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            aria-label={t("theme.label")}
            className="inline-flex min-h-target min-w-target items-center justify-center rounded-md hover:bg-bg-subtle focus-visible:ring-2 focus-visible:ring-focus outline-hidden"
          >
            <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("theme.label")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={mounted ? theme : "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="system"><Monitor size={16} strokeWidth={1.5} aria-hidden="true" />{t("theme.system")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light"><Sun size={16} strokeWidth={1.5} aria-hidden="true" />{t("theme.light")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon size={16} strokeWidth={1.5} aria-hidden="true" />{t("theme.dark")}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    </TooltipProvider>
  );
}
