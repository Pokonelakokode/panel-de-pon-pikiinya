import { PikiinyaController } from './ui.ts';
import type { SnesBridgeApi } from './types.ts';
import { onlineClient } from '../net/online-client.ts';

let pikiController: PikiinyaController | null = null;

function ensurePikiinyaLoaded(bridge: SnesBridgeApi): PikiinyaController | null {
  const panel = document.getElementById('panel-game-pikiinya');
  if (!panel) return null;
  if (!pikiController) {
    pikiController = new PikiinyaController(panel, bridge);
  }
  return pikiController;
}

function initDualGameTabs(): void {
  const bridge = window.snesBridge;
  if (!bridge) return;

  const tabPdp = document.getElementById('tab-game-pdp');
  const tabPiki = document.getElementById('tab-game-pikiinya');
  const panelPdp = document.getElementById('panel-game-pdp');
  const panelPiki = document.getElementById('panel-game-pikiinya');
  if (!tabPdp || !tabPiki || !panelPdp || !panelPiki) return;

  const applyGameSelection = (game: 'pdp' | 'pikiinya', moveFocus = false): void => {
    bridge.switchAppGame(game);

    const isPiki = game === 'pikiinya';
    tabPdp.setAttribute('aria-selected', String(!isPiki));
    tabPdp.tabIndex = isPiki ? -1 : 0;
    tabPdp.classList.toggle('tab-active-pdp', !isPiki);
    tabPdp.classList.toggle('tab-inactive', isPiki);

    tabPiki.setAttribute('aria-selected', String(isPiki));
    tabPiki.tabIndex = isPiki ? 0 : -1;
    tabPiki.classList.toggle('tab-active-piki', isPiki);
    tabPiki.classList.toggle('tab-inactive', !isPiki);

    panelPdp.classList.toggle('hidden', isPiki);
    if (isPiki) panelPdp.setAttribute('inert', '');
    else panelPdp.removeAttribute('inert');

    panelPiki.classList.toggle('hidden', !isPiki);
    if (!isPiki) panelPiki.setAttribute('inert', '');
    else panelPiki.removeAttribute('inert');

    document.body.classList.toggle('game-pikiinya', isPiki);
    document.title = isPiki
      ? 'Pikiinya! (SNES 1997) - Dual SNES Classic App'
      : 'Panel de Pon (SNES 1995) - Dual SNES Classic App';

    if (isPiki) {
      const ctrl = ensurePikiinyaLoaded(bridge);
      ctrl?.setActive(true);
      bridge.setActivePauseHandler?.((paused: boolean) => ctrl?.pauseFromModal(paused));
    } else {
      pikiController?.setActive(false);
      bridge.setActivePauseHandler?.(null);
    }

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('game', game);
      window.history.replaceState({}, '', url);
    } catch {
      // ignore history errors
    }

    if (moveFocus) {
      (isPiki ? tabPiki : tabPdp).focus();
    }
  };

  tabPdp.addEventListener('click', () => applyGameSelection('pdp'));
  tabPiki.addEventListener('click', () => applyGameSelection('pikiinya'));

  const handleTablistKeys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'Home') {
      e.preventDefault();
      applyGameSelection('pdp', true);
    } else if (e.key === 'ArrowRight' || e.key === 'End') {
      e.preventDefault();
      applyGameSelection('pikiinya', true);
    }
  };

  tabPdp.addEventListener('keydown', handleTablistKeys);
  tabPiki.addEventListener('keydown', handleTablistKeys);

  // Expose helpers for Online Multiplayer lobby
  const win = window as unknown as {
    onlineClient?: typeof onlineClient;
    appSelectGame?: (game: 'pdp' | 'pikiinya') => void;
    getPikiinyaController?: () => PikiinyaController | null;
    openOnlineModalForJoin?: (code: string, game: 'pdp' | 'pikiinya') => void;
  };
  win.onlineClient = onlineClient;
  win.appSelectGame = (g) => applyGameSelection(g);
  win.getPikiinyaController = () => ensurePikiinyaLoaded(bridge);

  // Check URL query (?game=pikiinya) or hash (#pikiinya)
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('game');
  const initialGame: 'pdp' | 'pikiinya' =
    requested === 'pikiinya' || window.location.hash === '#pikiinya' ? 'pikiinya' : 'pdp';
  applyGameSelection(initialGame);

  const joinRoomCode = params.get('room');
  if (joinRoomCode && joinRoomCode.trim()) {
    window.setTimeout(() => {
      win.openOnlineModalForJoin?.(joinRoomCode.trim().toUpperCase(), initialGame);
    }, 60);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initDualGameTabs);
} else {
  initDualGameTabs();
}
