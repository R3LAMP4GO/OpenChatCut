import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  PARAKEET_INFERENCE_CHANNELS,
  isParakeetInferenceRequestId,
  parseParakeetInferenceRequest,
} from '../shared/parakeet-inference.ts';
import { assertTrustedDesktopSenderUrl } from './page-origin.ts';
import { ParakeetService } from './parakeet-service.ts';

interface ObservedOwner {
  readonly sender: WebContents;
  readonly onDestroyed: () => void;
  readonly onNavigation: (
    _details: unknown,
    _url: string,
    inPlace: boolean,
    mainFrame: boolean,
    _frameProcessId: number,
    _frameRoutingId: number,
  ) => void;
  readonly onRenderProcessGone: () => void;
}

export interface InstalledParakeetIpc {
  dispose(): void;
}

class ParakeetIpcState {
  private readonly service = new ParakeetService();
  private readonly owners = new Map<string, number>();
  private readonly observedOwners = new Map<number, ObservedOwner>();
  private readonly trustedOrigin: string;

  constructor(trustedOrigin: string) {
    this.trustedOrigin = trustedOrigin;
  }

  assertTrusted(event: IpcMainInvokeEvent): void {
    assertTrustedDesktopSenderUrl(event.senderFrame?.url ?? '', this.trustedOrigin);
    this.observeOwner(event.sender);
  }

  async transcribe(event: IpcMainInvokeEvent, value: unknown) {
    const request = parseParakeetInferenceRequest(value);
    if (this.owners.has(request.requestId)) throw new Error('Parakeet request is already active');
    this.owners.set(request.requestId, event.sender.id);
    try {
      return await this.service.transcribe(request);
    } finally {
      this.owners.delete(request.requestId);
    }
  }

  cancel(event: IpcMainInvokeEvent, requestId: unknown): void {
    if (!isParakeetInferenceRequestId(requestId)) throw new Error('invalid Parakeet transcription request id');
    const ownerId = this.owners.get(requestId);
    if (ownerId === undefined) return;
    if (ownerId !== event.sender.id) throw new Error('Parakeet transcription request owner mismatch');
    this.service.cancel(requestId);
  }

  dispose(): void {
    this.service.dispose();
    this.owners.clear();
    for (const owner of this.observedOwners.values()) {
      owner.sender.off('destroyed', owner.onDestroyed);
      owner.sender.off('render-process-gone', owner.onRenderProcessGone);
      owner.sender.off('did-start-navigation', owner.onNavigation);
    }
    this.observedOwners.clear();
  }

  private observeOwner(sender: WebContents): void {
    if (this.observedOwners.has(sender.id)) return;
    const onDestroyed = (): void => {
      this.cancelOwner(sender.id);
      this.observedOwners.delete(sender.id);
    };
    const onRenderProcessGone = (): void => this.cancelOwner(sender.id);
    const onNavigation = (
      _details: unknown,
      _url: string,
      inPlace: boolean,
      mainFrame: boolean,
      _frameProcessId: number,
      _frameRoutingId: number,
    ): void => {
      if (mainFrame && !inPlace) this.cancelOwner(sender.id);
    };
    sender.once('destroyed', onDestroyed);
    sender.on('render-process-gone', onRenderProcessGone);
    sender.on('did-start-navigation', onNavigation);
    this.observedOwners.set(sender.id, { sender, onDestroyed, onRenderProcessGone, onNavigation });
  }

  private cancelOwner(ownerId: number): void {
    for (const [requestId, requestOwnerId] of this.owners) {
      if (requestOwnerId === ownerId) this.service.cancel(requestId);
    }
  }
}

export function installParakeetIpc(trustedOrigin: string): InstalledParakeetIpc {
  const state = new ParakeetIpcState(trustedOrigin);
  ipcMain.handle(PARAKEET_INFERENCE_CHANNELS.transcribe, (event, value: unknown) => {
    state.assertTrusted(event);
    return state.transcribe(event, value);
  });
  ipcMain.handle(PARAKEET_INFERENCE_CHANNELS.cancel, (event, requestId: unknown) => {
    state.assertTrusted(event);
    state.cancel(event, requestId);
  });
  return {
    dispose: () => {
      ipcMain.removeHandler(PARAKEET_INFERENCE_CHANNELS.transcribe);
      ipcMain.removeHandler(PARAKEET_INFERENCE_CHANNELS.cancel);
      state.dispose();
    },
  };
}
