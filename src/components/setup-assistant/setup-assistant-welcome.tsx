import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppWelcomeIcon } from "@/components/app-welcome-icon";
import { ProviderIcon, type ProviderIconId } from "@/components/icons/provider-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getWelcomeIconSizes } from "@/lib/welcome-icon";
import { useSettingsStore } from "@/stores/settings-store";

type WelcomeProvider = Extract<ProviderIconId, "claude-code" | "codex">;

type WelcomeCardData = {
  provider: WelcomeProvider;
  repo: string;
  snippet: string;
  title: string;
};

type WelcomeColumnData = {
  cards: readonly WelcomeCardData[];
  count: number;
  label: string;
  tone: "running" | "attention" | "idle";
};

const WELCOME_COLUMNS: readonly WelcomeColumnData[] = [
  {
    count: 2,
    label: "Running",
    tone: "running" as const,
    cards: [
      {
        provider: "claude-code",
        repo: "agtower",
        snippet: "$ pnpm build",
        title: "Observer race",
      },
      {
        provider: "codex",
        repo: "landing",
        snippet: "$ pnpm test landing",
        title: "Landing QA",
      },
    ],
  },
  {
    count: 1,
    label: "Attention",
    tone: "attention" as const,
    cards: [
      {
        provider: "codex",
        repo: "payments-api",
        snippet: "$ tail -f logs/worker.log",
        title: "Webhook retries",
      },
    ],
  },
  {
    count: 2,
    label: "Idle",
    tone: "idle" as const,
    cards: [
      {
        provider: "claude-code",
        repo: "docs",
        snippet: "$ git status",
        title: "Release notes",
      },
      {
        provider: "codex",
        repo: "search",
        snippet: "$ rg scoring src",
        title: "Ranking pass",
      },
    ],
  },
] as const;

const WELCOME_ICON_HOLD_MS = 1000;
const WELCOME_ICON_TRAVEL_MS = 1500;
const WELCOME_CONTENT_REVEAL_DELAY_MS = WELCOME_ICON_HOLD_MS + WELCOME_ICON_TRAVEL_MS;
const WELCOME_ICON_HOLD_RATIO = WELCOME_ICON_HOLD_MS / WELCOME_CONTENT_REVEAL_DELAY_MS;
const WELCOME_INTRO_EASE = [0.22, 1, 0.36, 1] as const;
const WELCOME_ICON_ANIMATION_SECONDS = WELCOME_CONTENT_REVEAL_DELAY_MS / 1000;
const WELCOME_HEADLINE_REVEAL_DELAY_SECONDS = 0.06;
const WELCOME_HEADLINE_REVEAL_DURATION_SECONDS = 0.72;
const WELCOME_COPY_REVEAL_DELAY_SECONDS = 0.18;
const WELCOME_COPY_REVEAL_DURATION_SECONDS = 0.66;
const WELCOME_STAGE_REVEAL_DELAY_SECONDS = 0.38;
const WELCOME_STAGE_REVEAL_DURATION_SECONDS = 0.88;
const WELCOME_ACTIONS_REVEAL_DELAY_SECONDS = 0.84;
const WELCOME_ACTIONS_REVEAL_DURATION_SECONDS = 0.54;
const WELCOME_AUDIO_START_DELAY_MS = 80;
const WELCOME_ICON_FLOAT_OFFSET_PX = 14;

type WelcomeIconFrame = {
  height: number;
  left: number;
  top: number;
  width: number;
};

type WelcomeIconFrames = {
  end: WelcomeIconFrame;
  introSizePx: number;
  settledSizePx: number;
  start: WelcomeIconFrame;
};

function measureWelcomeIconFrames(
  rootElement: HTMLElement,
  targetElement: HTMLElement,
): WelcomeIconFrames {
  const rootRect = rootElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  const { intro, settled } = getWelcomeIconSizes(window.innerWidth);

  return {
    introSizePx: intro,
    settledSizePx: settled,
    start: {
      left: (rootRect.width - intro) / 2,
      top: (rootRect.height - intro) / 2,
      width: intro,
      height: intro,
    },
    end: {
      left: targetRect.left - rootRect.left,
      top: targetRect.top - rootRect.top,
      width: targetRect.width,
      height: targetRect.height,
    },
  };
}

function WelcomeStagePanel() {
  return (
    <div className="setup-welcome-stage-wrap">
      <div className="setup-welcome-stage-shell">
        <div className="setup-welcome-stage">
          <div className="setup-welcome-stage-bar">
            <p className="justify-self-start text-xs font-medium text-muted-foreground">AgTower</p>
            <p className="justify-self-center text-xs font-medium text-foreground">
              Session overview
            </p>
            <p className="justify-self-end text-xs text-muted-foreground">5 sessions</p>
          </div>

          <div className="setup-welcome-stage-body grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 min-[520px]:grid-cols-3">
            {WELCOME_COLUMNS.map((column) => (
              <WelcomeColumn
                key={column.label}
                count={column.count}
                label={column.label}
                tone={column.tone}
              >
                {column.cards.map((card) => (
                  <WelcomeCard
                    key={card.title}
                    provider={card.provider}
                    repo={card.repo}
                    snippet={card.snippet}
                    title={card.title}
                  />
                ))}
              </WelcomeColumn>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function WelcomeStartActions({ onStart }: { onStart: () => void }) {
  return (
    <div className="setup-welcome-actions">
      <Button
        size="lg"
        className="h-9 rounded-md px-4 shadow-none transition-none"
        onClick={onStart}
      >
        Get Started
        <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}

function WelcomeColumn({
  count,
  label,
  tone,
  children,
}: {
  count: number;
  label: string;
  tone: "running" | "attention" | "idle";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "setup-welcome-column native-inset-panel flex h-full min-h-[min(10.5rem,100%)] min-w-0 flex-1 flex-col self-stretch sm:min-h-[min(11.75rem,100%)] lg:min-h-0",
        tone === "running" && "setup-welcome-column--running",
        tone === "attention" && "setup-welcome-column--attention",
        tone === "idle" && "setup-welcome-column--idle",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/45 px-3 py-2.5">
        <span
          className={cn(
            "size-2 rounded-full",
            tone === "running" && "bg-info",
            tone === "attention" && "bg-warning",
            tone === "idle" && "bg-muted-foreground/55",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
          {label}
        </span>
        <span className="rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">{children}</div>
    </div>
  );
}

function WelcomeCard({
  provider,
  repo,
  snippet,
  title,
}: {
  provider: WelcomeProvider;
  repo: string;
  snippet: string;
  title: string;
}) {
  return (
    <div className="setup-welcome-card rounded-md border border-border/55 bg-card/92 px-3 py-2.5 text-left shadow-none">
      <div className="flex shrink-0 items-center gap-2">
        <span aria-hidden="true" className="setup-welcome-provider-mark">
          <ProviderIcon
            provider={provider}
            aria-hidden={true}
            className="setup-welcome-provider-mark-image"
          />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium leading-5 text-foreground">
          {title}
        </p>
      </div>
      <div className="setup-welcome-card-snippet mt-2 rounded-md border border-border/50 bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
        {snippet}
      </div>
      <div className="mt-2.5 shrink-0 text-left text-xs text-muted-foreground">
        <span className="block truncate">{repo}</span>
      </div>
    </div>
  );
}

export function SetupAssistantWelcomeScreen({
  onStart,
  contentClassName,
  disableIntro = false,
}: {
  onStart: () => void;
  contentClassName?: string;
  disableIntro?: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();
  const shouldReduceMotion = disableIntro || prefersReducedMotion;
  const introSoundEnabled = useSettingsStore((s) => s.notifications.sound);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const introSoundEnabledRef = useRef(introSoundEnabled);
  const introStartedRef = useRef(shouldReduceMotion);
  const revealTimeoutRef = useRef<number | null>(null);
  const audioTimeoutRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const targetIconRef = useRef<HTMLDivElement | null>(null);
  const [iconFrames, setIconFrames] = useState<WelcomeIconFrames | null>(null);
  const [introReady, setIntroReady] = useState(shouldReduceMotion);
  const [contentVisible, setContentVisible] = useState(shouldReduceMotion);
  const contentVisibleRef = useRef(contentVisible);
  const [introInterrupted, setIntroInterrupted] = useState(false);
  const revealContent = shouldReduceMotion || contentVisible;

  useLayoutEffect(() => {
    if (shouldReduceMotion) {
      setIconFrames(null);
      setIntroReady(true);
      return;
    }

    const measure = () => {
      if (!rootRef.current || !targetIconRef.current) return;
      setIconFrames(measureWelcomeIconFrames(rootRef.current, targetIconRef.current));
      setIntroReady(true);

      if (introStartedRef.current && !contentVisibleRef.current) {
        if (revealTimeoutRef.current !== null) {
          window.clearTimeout(revealTimeoutRef.current);
          revealTimeoutRef.current = null;
        }
        if (audioTimeoutRef.current !== null) {
          window.clearTimeout(audioTimeoutRef.current);
          audioTimeoutRef.current = null;
        }
        const audio = audioRef.current;
        audio?.pause();
        if (audio) {
          audio.currentTime = 0;
        }
        setIntroInterrupted(true);
        setContentVisible(true);
      }
    };

    const frameId = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", measure);
    };
  }, [shouldReduceMotion]);

  useEffect(() => {
    introSoundEnabledRef.current = introSoundEnabled;
  }, [introSoundEnabled]);

  useEffect(() => {
    contentVisibleRef.current = contentVisible;
  }, [contentVisible]);

  useEffect(() => {
    const audio = new Audio("/welcome.mp3");
    audio.preload = "auto";
    audioRef.current = audio;

    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (shouldReduceMotion) {
      introStartedRef.current = true;
      setContentVisible(true);
      return;
    }

    if (!introReady) {
      return;
    }

    if (introStartedRef.current) {
      return;
    }

    introStartedRef.current = true;
    setIntroInterrupted(false);
    setContentVisible(false);

    const audio = audioRef.current;
    revealTimeoutRef.current = window.setTimeout(() => {
      setContentVisible(true);
    }, WELCOME_CONTENT_REVEAL_DELAY_MS);
    audioTimeoutRef.current =
      audio && introSoundEnabledRef.current
        ? window.setTimeout(() => {
            audio.currentTime = 0;
            void audio.play().catch(() => {});
          }, WELCOME_AUDIO_START_DELAY_MS)
        : null;

    return () => {
      if (revealTimeoutRef.current !== null) {
        window.clearTimeout(revealTimeoutRef.current);
        revealTimeoutRef.current = null;
      }
      if (audioTimeoutRef.current !== null) {
        window.clearTimeout(audioTimeoutRef.current);
        audioTimeoutRef.current = null;
      }
      audio?.pause();
      if (audio) {
        audio.currentTime = 0;
      }
    };
  }, [introReady, shouldReduceMotion]);

  const fallbackSizes = getWelcomeIconSizes(
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const settledIconSize = iconFrames?.settledSizePx ?? fallbackSizes.settled;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col justify-center">
      <div className="mx-auto flex w-full max-w-5xl min-h-0 flex-1 flex-col px-6 pb-10 pt-10 sm:pb-12 sm:pt-12 lg:px-10">
        <div
          ref={rootRef}
          className="relative mx-auto flex w-full max-w-5xl min-h-0 flex-1 flex-col items-center justify-center text-center"
        >
          {iconFrames && !shouldReduceMotion && !introInterrupted ? (
            <motion.div
              className="pointer-events-none absolute z-20"
              initial={{
                left: iconFrames.start.left,
                top: iconFrames.start.top,
                width: iconFrames.start.width,
                height: iconFrames.start.height,
                opacity: 1,
              }}
              animate={
                contentVisible
                  ? {
                      left: iconFrames.end.left,
                      top: iconFrames.end.top,
                      width: iconFrames.end.width,
                      height: iconFrames.end.height,
                      opacity: 0,
                    }
                  : {
                      left: [iconFrames.start.left, iconFrames.start.left, iconFrames.end.left],
                      top: [
                        iconFrames.start.top,
                        iconFrames.start.top - WELCOME_ICON_FLOAT_OFFSET_PX,
                        iconFrames.end.top,
                      ],
                      width: [
                        iconFrames.start.width,
                        iconFrames.start.width * 1.03,
                        iconFrames.end.width,
                      ],
                      height: [
                        iconFrames.start.height,
                        iconFrames.start.height * 1.03,
                        iconFrames.end.height,
                      ],
                      opacity: 1,
                    }
              }
              transition={
                contentVisible
                  ? {
                      duration: 0.18,
                      ease: "easeOut",
                    }
                  : {
                      left: {
                        duration: WELCOME_ICON_ANIMATION_SECONDS,
                        ease: WELCOME_INTRO_EASE,
                        times: [0, WELCOME_ICON_HOLD_RATIO, 1],
                      },
                      top: {
                        duration: WELCOME_ICON_ANIMATION_SECONDS,
                        ease: WELCOME_INTRO_EASE,
                        times: [0, WELCOME_ICON_HOLD_RATIO, 1],
                      },
                      width: {
                        duration: WELCOME_ICON_ANIMATION_SECONDS,
                        ease: WELCOME_INTRO_EASE,
                        times: [0, WELCOME_ICON_HOLD_RATIO, 1],
                      },
                      height: {
                        duration: WELCOME_ICON_ANIMATION_SECONDS,
                        ease: WELCOME_INTRO_EASE,
                        times: [0, WELCOME_ICON_HOLD_RATIO, 1],
                      },
                    }
              }
            >
              <AppWelcomeIcon alt="AgTower" ariaHidden className="size-full" />
            </motion.div>
          ) : null}

          <div
            className={cn(
              "mx-auto flex w-full max-w-5xl min-h-0 flex-1 flex-col items-center justify-center text-center",
              !revealContent && "pointer-events-none",
            )}
          >
            <div className="flex justify-center">
              <div
                ref={targetIconRef}
                className="flex justify-center"
                style={{ width: settledIconSize, height: settledIconSize }}
              >
                <AppWelcomeIcon
                  alt="AgTower"
                  className={cn("size-full", !revealContent && "opacity-0")}
                />
              </div>
            </div>

            <motion.div
              initial={shouldReduceMotion ? false : { opacity: 0, y: 18, filter: "blur(10px)" }}
              animate={
                revealContent
                  ? { opacity: 1, y: 0, filter: "blur(0px)" }
                  : { opacity: 0, y: 18, filter: "blur(10px)" }
              }
              transition={{
                delay:
                  shouldReduceMotion || introInterrupted
                    ? 0
                    : WELCOME_HEADLINE_REVEAL_DELAY_SECONDS,
                duration: WELCOME_HEADLINE_REVEAL_DURATION_SECONDS,
                ease: WELCOME_INTRO_EASE,
              }}
              className="mt-5 w-full"
            >
              <div className="mx-auto max-w-[48rem] space-y-3">
                <motion.h1
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 16, filter: "blur(8px)" }}
                  animate={
                    revealContent
                      ? { opacity: 1, y: 0, filter: "blur(0px)" }
                      : { opacity: 0, y: 16, filter: "blur(8px)" }
                  }
                  transition={{
                    delay:
                      shouldReduceMotion || introInterrupted
                        ? 0
                        : WELCOME_HEADLINE_REVEAL_DELAY_SECONDS,
                    duration: WELCOME_HEADLINE_REVEAL_DURATION_SECONDS,
                    ease: WELCOME_INTRO_EASE,
                  }}
                  className="mx-auto max-w-[18ch] font-heading text-[clamp(2rem,4.8vw,3rem)] leading-[1.03] font-semibold text-foreground"
                >
                  Welcome to AgTower
                </motion.h1>
                <motion.p
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 12, filter: "blur(8px)" }}
                  animate={
                    revealContent
                      ? { opacity: 1, y: 0, filter: "blur(0px)" }
                      : { opacity: 0, y: 12, filter: "blur(8px)" }
                  }
                  transition={{
                    delay:
                      shouldReduceMotion || introInterrupted
                        ? 0
                        : WELCOME_COPY_REVEAL_DELAY_SECONDS,
                    duration: WELCOME_COPY_REVEAL_DURATION_SECONDS,
                    ease: WELCOME_INTRO_EASE,
                  }}
                  className="mx-auto max-w-[41rem] text-[clamp(0.98rem,2.2vw,1.06rem)] leading-6 text-muted-foreground/88"
                >
                  Monitor every coding agent session from one focused Mac app, then jump straight to
                  the one that needs you.
                </motion.p>
              </div>
            </motion.div>

            <div className={cn("mt-7 w-full min-h-0", contentClassName)}>
              <div className="setup-welcome-hero">
                <motion.div
                  initial={
                    shouldReduceMotion
                      ? false
                      : { opacity: 0, y: 34, scale: 0.972, filter: "blur(16px)" }
                  }
                  animate={
                    revealContent
                      ? { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }
                      : { opacity: 0, y: 34, scale: 0.972, filter: "blur(16px)" }
                  }
                  transition={{
                    delay:
                      shouldReduceMotion || introInterrupted
                        ? 0
                        : WELCOME_STAGE_REVEAL_DELAY_SECONDS,
                    duration: WELCOME_STAGE_REVEAL_DURATION_SECONDS,
                    ease: WELCOME_INTRO_EASE,
                  }}
                  className="flex min-h-0 flex-1 w-full"
                >
                  <WelcomeStagePanel />
                </motion.div>

                <motion.div
                  initial={
                    shouldReduceMotion
                      ? false
                      : { opacity: 0, y: 18, scale: 0.96, filter: "blur(8px)" }
                  }
                  animate={
                    revealContent
                      ? { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }
                      : { opacity: 0, y: 18, scale: 0.96, filter: "blur(8px)" }
                  }
                  transition={{
                    delay:
                      shouldReduceMotion || introInterrupted
                        ? 0
                        : WELCOME_ACTIONS_REVEAL_DELAY_SECONDS,
                    duration: WELCOME_ACTIONS_REVEAL_DURATION_SECONDS,
                    ease: WELCOME_INTRO_EASE,
                  }}
                  className="mt-auto w-full"
                >
                  <WelcomeStartActions onStart={onStart} />
                </motion.div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
