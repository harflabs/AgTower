interface DangerActionState {
  armedId: string | null;
}

export function armDangerAction(_state: DangerActionState, itemId: string): DangerActionState {
  return { armedId: itemId };
}

export function disarmDangerAction(): DangerActionState {
  return { armedId: null };
}

export function isDangerActionConfirmed(state: DangerActionState, itemId: string): boolean {
  return state.armedId === itemId;
}
