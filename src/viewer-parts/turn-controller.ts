export interface ViewerStreamGuard {
  viewSeq: number;
  facultyId?: string | null;
  streamSeq: number;
}

export interface ViewerTurnHandle {
  finish(): void;
}

export interface ViewerTurnControllerDeps {
  setNextButtonDisabled(disabled: boolean): void;
  currentViewSeq(): number;
  currentFaculty(): string | null | undefined;
}

export interface ViewerTurnController {
  isBusy(): boolean;
  beginManual(): ViewerTurnHandle | null;
  beginAgent(force?: boolean): ViewerTurnHandle | null;
  beginButtonAction(): ViewerTurnHandle | null;
  nextStreamGuard(facultyId?: string | null): ViewerStreamGuard;
  streamStillCurrent(opts?: ViewerStreamGuard | null): boolean;
  syncControls(): void;
}

export function createViewerTurnController(deps: ViewerTurnControllerDeps): ViewerTurnController {
  const state = {
    agentBusy: false,
    manualChatBusy: false,
    buttonBusy: false,
    agentSeq: 0,
    streamSeq: 0,
  };

  function busy() {
    return state.buttonBusy || state.manualChatBusy || state.agentBusy;
  }

  function syncControls() {
    const disabled = busy();
    deps.setNextButtonDisabled(disabled);
  }

  function beginManual() {
    if (state.manualChatBusy || state.agentBusy) return null;
    state.manualChatBusy = true;
    syncControls();
    return {
      finish() {
        state.manualChatBusy = false;
        syncControls();
      },
    };
  }

  function beginAgent(force?: boolean) {
    if (!force && state.agentBusy) return null;
    state.agentBusy = true;
    const seq = ++state.agentSeq;
    syncControls();
    return {
      finish() {
        if (state.agentSeq === seq) state.agentBusy = false;
        syncControls();
      },
    };
  }

  function beginButtonAction() {
    if (state.buttonBusy || state.manualChatBusy || state.agentBusy) return null;
    state.buttonBusy = true;
    syncControls();
    return {
      finish() {
        state.buttonBusy = false;
        syncControls();
      },
    };
  }

  return {
    isBusy: busy,
    beginManual,
    beginAgent,
    beginButtonAction,
    nextStreamGuard(facultyId?: string | null) {
      return { viewSeq: deps.currentViewSeq(), facultyId, streamSeq: ++state.streamSeq };
    },
    streamStillCurrent(opts?: ViewerStreamGuard | null) {
      if (!opts) return true;
      if (opts.viewSeq !== deps.currentViewSeq()) return false;
      if (opts.streamSeq !== state.streamSeq) return false;
      if (!opts.facultyId) return true;
      const currentFaculty = deps.currentFaculty();
      if (!currentFaculty) return true;
      return currentFaculty === opts.facultyId;
    },
    syncControls,
  };
}
