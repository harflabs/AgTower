import type { SearchAddon } from "@xterm/addon-search";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

interface Props {
  searchAddon: SearchAddon | null;
  onClose: () => void;
  onClosedFocusRestore?: () => void;
}

export function TerminalSearchBar({ searchAddon, onClose, onClosedFocusRestore }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  const closeSearch = useCallback(() => {
    searchAddon?.clearDecorations();
    onClose();
    window.requestAnimationFrame(() => onClosedFocusRestore?.());
  }, [onClose, onClosedFocusRestore, searchAddon]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSearch();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeSearch]);

  function handleSearch(direction: "next" | "prev") {
    if (!searchAddon || !query) return;
    if (direction === "next") {
      searchAddon.findNext(query);
    } else {
      searchAddon.findPrevious(query);
    }
  }

  function handleInputChange(value: string) {
    setQuery(value);
    if (!searchAddon) return;
    if (value) {
      searchAddon.findNext(value);
    } else {
      searchAddon.clearDecorations();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch(e.shiftKey ? "prev" : "next");
    }
  }

  return (
    <InputGroup className="absolute right-3 top-2.5 z-10 w-[18rem] max-w-[calc(100%-1.5rem)] shadow-sm">
      <InputGroupInput
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => handleInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in terminal..."
        className="text-[13px]"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          onClick={() => handleSearch("prev")}
          disabled={!query}
          aria-label="Previous match"
          title="Previous match"
        >
          <ChevronUp className="size-3.5" />
        </InputGroupButton>
        <InputGroupButton
          size="icon-xs"
          onClick={() => handleSearch("next")}
          disabled={!query}
          aria-label="Next match"
          title="Next match"
        >
          <ChevronDown className="size-3.5" />
        </InputGroupButton>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={closeSearch}
          aria-label="Close search"
          title="Close search"
        >
          <X className="size-3.5" />
        </Button>
      </InputGroupAddon>
    </InputGroup>
  );
}
