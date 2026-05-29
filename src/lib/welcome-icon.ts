export const WELCOME_APP_ICON_SRC = "/welcome-icon.png";
export const WELCOME_APP_ICON_INTRINSIC_SIZE_PX = 512;

function clampPx(min: number, preferred: number, max: number) {
  return Math.min(max, Math.max(min, preferred));
}

export function getWelcomeIconSizes(viewportWidth: number) {
  return {
    intro: clampPx(120, viewportWidth * 0.18, 156),
    settled: clampPx(76, viewportWidth * 0.1, 92),
  };
}
