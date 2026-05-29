"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { interactiveStyles } from "@/components/ui/interactive-styles";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { IS_MACOS } from "@/lib/platform";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH_DEFAULT = 296;
const SIDEBAR_WIDTH_MIN = 256;
const SIDEBAR_WIDTH_MAX = 480;
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_WIDTH_ICON = "3rem";
export const SIDEBAR_MOTION_DURATION_MS = 220;
export const SIDEBAR_MOTION_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

type SidebarContextProps = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  openMobile: boolean;
  setOpenMobile: React.Dispatch<React.SetStateAction<boolean>>;
  isMobile: boolean;
  toggleSidebar: () => void;
  width: number;
  setWidth: (width: number) => void;
  desktopSidebarVisible: boolean;
  handleDesktopSidebarTransitionEnd: () => void;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function clampSidebarWidth(nextWidth: number) {
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, nextWidth));
}

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  width: widthProp,
  onWidthChange: setWidthProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  width?: number;
  onWidthChange?: (width: number) => void;
}) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;
  const [desktopSidebarClosing, setDesktopSidebarClosing] = React.useState(false);
  const previousDesktopOpenRef = React.useRef(open);
  const insetResetFrameRef = React.useRef<number | null>(null);
  const setOpen = React.useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    (value) => {
      const nextOpen = typeof value === "function" ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(nextOpen);
      } else {
        _setOpen(nextOpen);
      }
    },
    [open, setOpenProp],
  );

  const [_width, _setWidth] = React.useState(SIDEBAR_WIDTH_DEFAULT);
  const width = widthProp ?? _width;
  const setWidth = React.useCallback(
    (nextWidth: number) => {
      const clampedWidth = clampSidebarWidth(nextWidth);
      if (setWidthProp) {
        setWidthProp(clampedWidth);
      } else {
        _setWidth(clampedWidth);
      }
    },
    [setWidthProp],
  );

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((prevOpen) => !prevOpen);
    } else {
      setOpen((prevOpen) => !prevOpen);
    }
  }, [isMobile, setOpen]);

  React.useLayoutEffect(() => {
    const wrapper = wrapperRef.current;

    if (isMobile) {
      if (insetResetFrameRef.current !== null) {
        window.cancelAnimationFrame(insetResetFrameRef.current);
        insetResetFrameRef.current = null;
      }
      setDesktopSidebarClosing(false);
      wrapper?.style.setProperty("--sidebar-inset-offset", "0px");
      previousDesktopOpenRef.current = open;
      return;
    }

    const previousOpen = previousDesktopOpenRef.current;

    if (previousOpen !== open) {
      if (previousOpen && !open) {
        setDesktopSidebarClosing(true);
      } else if (open) {
        setDesktopSidebarClosing(false);
      }

      if (insetResetFrameRef.current !== null) {
        window.cancelAnimationFrame(insetResetFrameRef.current);
        insetResetFrameRef.current = null;
      }

      wrapper?.style.setProperty("--sidebar-inset-offset", `${open ? -width : width}px`);

      insetResetFrameRef.current = window.requestAnimationFrame(() => {
        wrapperRef.current?.style.setProperty("--sidebar-inset-offset", "0px");
        insetResetFrameRef.current = null;
      });
    } else if (open) {
      setDesktopSidebarClosing(false);
    }

    previousDesktopOpenRef.current = open;
  }, [isMobile, open, width]);

  React.useEffect(() => {
    return () => {
      if (insetResetFrameRef.current !== null) {
        window.cancelAnimationFrame(insetResetFrameRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (isMobile || open || !desktopSidebarClosing) {
      return;
    }

    // `transitionend` is the primary path, but reduced-motion users may skip it entirely.
    const timeoutId = window.setTimeout(() => {
      setDesktopSidebarClosing(false);
    }, SIDEBAR_MOTION_DURATION_MS + 48);

    return () => window.clearTimeout(timeoutId);
  }, [desktopSidebarClosing, isMobile, open]);

  const handleDesktopSidebarTransitionEnd = React.useCallback(() => {
    if (!open) {
      setDesktopSidebarClosing(false);
    }
  }, [open]);

  const state = open ? "expanded" : "collapsed";
  const desktopSidebarVisible = !isMobile && (open || desktopSidebarClosing);

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
      width,
      setWidth,
      desktopSidebarVisible,
      handleDesktopSidebarTransitionEnd,
      wrapperRef,
    }),
    [
      desktopSidebarVisible,
      handleDesktopSidebarTransitionEnd,
      isMobile,
      open,
      openMobile,
      setOpen,
      setWidth,
      state,
      toggleSidebar,
      width,
    ],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          ref={wrapperRef}
          data-slot="sidebar-wrapper"
          style={
            {
              "--sidebar-width": `${width}px`,
              "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
              "--sidebar-inset-offset": "0px",
              "--sidebar-motion-duration": `${SIDEBAR_MOTION_DURATION_MS}ms`,
              "--sidebar-motion-easing": SIDEBAR_MOTION_EASING,
              ...style,
            } as React.CSSProperties
          }
          className={cn(
            "group/sidebar-wrapper relative flex h-svh w-full overflow-hidden has-data-[variant=inset]:bg-sidebar",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  );
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  dir,
  onTransitionEnd,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
}) {
  const { isMobile, open, openMobile, setOpenMobile, state, handleDesktopSidebarTransitionEnd } =
    useSidebar();

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          dir={dir}
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
          side={side}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <nav
      role="navigation"
      aria-label="Application sidebar"
      className="group peer hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* Layout spacer — main content flexes into this space. Without a width
          transition the close/open snaps the content sideways even though
          the fixed sidebar container itself slides smoothly; reusing the
          shared sidebar motion tokens keeps the reflow in lockstep. */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative bg-transparent transition-[width] [transition-duration:var(--sidebar-motion-duration)] [transition-timing-function:var(--sidebar-motion-easing)] motion-reduce:transition-none",
          open ? "w-(--sidebar-width)" : "w-0",
          "group-data-[side=right]:rotate-180",
          !open && variant === "floating" ? "w-0" : undefined,
          open && (variant === "floating" || variant === "inset")
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
            : undefined,
          open && variant === "sidebar"
            ? "group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
            : undefined,
        )}
      />
      <div
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          "fixed inset-y-0 z-20 hidden h-svh w-(--sidebar-width) transition-[transform,opacity] [transition-duration:var(--sidebar-motion-duration)] [transition-timing-function:var(--sidebar-motion-easing)] will-change-transform motion-reduce:transition-none md:flex",
          side === "left" ? "left-0" : "right-0",
          side === "left"
            ? open
              ? "translate-x-0"
              : "-translate-x-full"
            : open
              ? "translate-x-0"
              : "translate-x-full",
          open ? "opacity-100" : "opacity-0",
          !open && "pointer-events-none",
          variant === "floating" || variant === "inset" ? "p-2" : "",
          className,
        )}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && event.propertyName === "transform") {
            handleDesktopSidebarTransitionEnd();
          }
          onTransitionEnd?.(event);
        }}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className={cn(
            "flex size-full min-w-0 flex-col overflow-hidden bg-sidebar",
            IS_MACOS ? "border-r-0" : "border-r border-sidebar-border/75",
            variant === "floating" && "rounded-md shadow-none ring-1 ring-sidebar-border",
          )}
        >
          {children}
        </div>
      </div>
    </nav>
  );
}

function SidebarResizeHandle() {
  const { open, setWidth, width, wrapperRef } = useSidebar();
  const [isDragging, setIsDragging] = React.useState(false);
  const [isHovered, setIsHovered] = React.useState(false);
  const startXRef = React.useRef(0);
  const startWidthRef = React.useRef(0);
  const liveWidthRef = React.useRef(width);
  const pendingWidthRef = React.useRef(width);
  const frameRef = React.useRef<number | null>(null);

  const applyLiveWidth = React.useCallback(
    (nextWidth: number) => {
      const clampedWidth = clampSidebarWidth(nextWidth);
      liveWidthRef.current = clampedWidth;
      const wrapper = wrapperRef.current;
      if (!wrapper) {
        return clampedWidth;
      }

      wrapper.dataset.resizing = "true";
      wrapper.style.setProperty("--sidebar-width", `${clampedWidth}px`);
      return clampedWidth;
    },
    [wrapperRef],
  );

  React.useEffect(() => {
    liveWidthRef.current = width;
    if (!isDragging) {
      wrapperRef.current?.style.setProperty("--sidebar-width", `${width}px`);
    }
  }, [isDragging, width, wrapperRef]);

  React.useEffect(() => {
    if (!isDragging) {
      return;
    }

    function handleMouseMove(event: MouseEvent) {
      event.preventDefault();
      const deltaX = event.clientX - startXRef.current;
      pendingWidthRef.current = startWidthRef.current + deltaX;
      if (frameRef.current !== null) {
        return;
      }

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        applyLiveWidth(pendingWidthRef.current);
      });
    }

    function handleMouseUp() {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      applyLiveWidth(pendingWidthRef.current);
      wrapperRef.current?.removeAttribute("data-resizing");
      setWidth(liveWidthRef.current);
      setIsDragging(false);
      setIsHovered(false);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      wrapperRef.current?.removeAttribute("data-resizing");
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [applyLiveWidth, isDragging, setWidth, wrapperRef]);

  if (!open) {
    return null;
  }

  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      className="group/sidebar-resize absolute inset-y-0 right-0 z-30 w-3 cursor-col-resize"
      onDoubleClick={() => {
        applyLiveWidth(SIDEBAR_WIDTH_DEFAULT);
        wrapperRef.current?.removeAttribute("data-resizing");
        setWidth(SIDEBAR_WIDTH_DEFAULT);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        startXRef.current = event.clientX;
        startWidthRef.current = width;
        pendingWidthRef.current = width;
        liveWidthRef.current = width;
        setIsDragging(true);
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        if (!isDragging) {
          setIsHovered(false);
        }
      }}
    >
      <div
        className={cn(
          "absolute inset-y-3 right-0 w-px rounded-full transition-colors",
          isDragging ? "bg-sidebar-primary" : isHovered ? "bg-sidebar-border/90" : "bg-transparent",
        )}
      />
    </div>
  );
}

function SidebarInset({ className, style, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      style={
        {
          transform: "translate3d(var(--sidebar-inset-offset), 0, 0)",
          backfaceVisibility: "hidden",
          ...style,
        } as React.CSSProperties
      }
      className={cn(
        "relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-background transition-transform [transition-duration:var(--sidebar-motion-duration)] [transition-timing-function:var(--sidebar-motion-easing)] will-change-transform motion-reduce:transition-none",
        "md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-md md:peer-data-[variant=inset]:shadow-none md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
        className,
      )}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn(
        "flex min-w-0 flex-col gap-2.5 overflow-x-hidden px-3.5 py-3 [--radius:var(--radius-md)]",
        className,
      )}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("flex min-w-0 flex-col gap-2.5 overflow-x-hidden px-3.5 py-3", className)}
      {...props}
    />
  );
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn(
        "mx-auto w-[calc(100%-1.75rem)] max-w-[calc(100%-1.75rem)] bg-sidebar-border/80",
        className,
      )}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "no-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto [--radius:var(--radius-md)] group-data-[collapsible=icon]:overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  );
}

const sidebarMenuButtonVariants = cva(
  cn(
    interactiveStyles.sidebar.item,
    interactiveStyles.sidebar.dataActive,
    "peer/menu-button group/menu-button flex w-full select-none items-center gap-2 overflow-hidden rounded-md px-2.5 py-1.5 text-left text-sm transition-[width,height,padding,background-color,border-color,color,opacity] duration-100 group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! active:bg-sidebar-interactive-selected active:text-sidebar-interactive-selected-foreground active:border-transparent disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate",
  ),
  {
    variants: {
      variant: {
        default: "",
        outline:
          "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:shadow-[0_0_0_1px_hsl(var(--sidebar-border))]",
      },
      size: {
        default: "h-9 text-sm",
        sm: "h-8 text-xs",
        lg: "h-14 px-3 text-sm group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean;
  isActive?: boolean;
  tooltip?: string | React.ComponentProps<typeof TooltipContent>;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot.Root : "button";
  const { isMobile, state } = useSidebar();

  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-selection="chrome"
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  );

  if (!tooltip) {
    return button;
  }

  const tooltipProps =
    typeof tooltip === "string"
      ? {
          children: tooltip,
        }
      : tooltip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltipProps}
      />
    </Tooltip>
  );
}

function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  placement = "absolute",
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean;
  showOnHover?: boolean;
  placement?: "absolute" | "inline";
}) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={cn(
        placement === "absolute"
          ? "absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground transition-transform group-data-[collapsible=icon]:hidden peer-data-[size=default]/menu-button:top-2 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 after:absolute after:-inset-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0"
          : "relative inline-flex min-h-5 items-center justify-center rounded-md px-1.5 text-sidebar-foreground after:absolute after:-inset-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
        interactiveStyles.sidebar.control,
        showOnHover &&
          placement === "absolute" &&
          "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-active/menu-button:text-sidebar-interactive-selected-foreground aria-expanded:opacity-100 md:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarResizeHandle,
  SidebarSeparator,
};
