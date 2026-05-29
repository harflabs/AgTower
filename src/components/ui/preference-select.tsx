import { ChevronDown } from "lucide-react";
import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type NativeMenuItemSpec, showNativeMenuForElement } from "@/lib/native-menu";
import { USES_NATIVE_MACOS_MENU } from "@/lib/platform";
import { cn } from "@/lib/utils";

interface PreferenceSelectOption<T extends string> {
  label: string;
  value: T;
}

export function PreferenceSelect<T extends string>({
  className,
  onValueChange,
  options,
  value,
}: {
  className?: string;
  onValueChange: (value: T) => void;
  options: PreferenceSelectOption<T>[];
  value: T;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  function showMenu(event: MouseEvent<HTMLButtonElement>) {
    const specs: NativeMenuItemSpec[] = options.map((option) => ({
      kind: "check",
      text: option.label,
      checked: option.value === value,
      action: () => onValueChange(option.value),
    }));
    void showNativeMenuForElement(event.currentTarget, specs);
  }

  if (USES_NATIVE_MACOS_MENU) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          "justify-between gap-2 px-2.5 font-normal [border-radius:var(--control-field-radius)]",
          className,
        )}
        onClick={showMenu}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </Button>
    );
  }

  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as T)}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
