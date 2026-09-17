/**
 * "Moverse y seleccionar" — the two gestures everything else is built on.
 *
 * One walkthrough for the Basic canvas: pan, select, and delete. The tour is
 * deliberately limited to the controls available in the planar editor.
 *
 * It ends on Delete. That is not padding — deleting is the destructive
 * gesture, its meaning depends on which kinds are armed, and a user who has
 * just learned to sweep a rectangle is one keypress away from finding out the
 * hard way.
 */

import type { TourStep } from '../../store/tour.svelte';
import { t } from '../../i18n';
import { ANCHORS, loadExample, setDimension, openPanel } from '../demo-helpers';
import { uiStore } from '../../store';

export function buildNavigation(): TourStep[] {
  return [
    {
      id: 'welcome',
      target: 'none',
      title: t('demo.navigation.welcomeTitle'),
      description: t('demo.navigation.welcomeDesc'),
      position: 'center',
      onEnter: () => {
        setDimension('2d');
        void loadExample('portal-frame');
        uiStore.currentTool = 'select';
      },
    },

    {
      id: 'pan-2d',
      target: ANCHORS.viewport,
      /*
       * The model stays lit so the middle-button gesture can be tried directly
       * on the drawing while the card remains visible.
       */
      overlayOpacity: 0.25,
      title: t('demo.navigation.pan2dTitle'),
      description: t('demo.navigation.pan2dDesc'),
      position: 'left',
      allowInteraction: true,
      onEnter: () => { uiStore.currentTool = 'select'; },
    },

    {
      id: 'select-mode',
      target: ANCHORS.ribbonCommand('select'),
      /*
       * Keep the canvas visible while the reader tries selection gestures.
       */
      overlayOpacity: 0.25,
      title: t('demo.navigation.selectTitle'),
      description: t('demo.navigation.selectDesc'),
      position: 'left',
      allowInteraction: true,
      onEnter: () => { uiStore.currentTool = 'select'; },
    },

    /*
     * Window versus crossing. Every CAD package agrees on the convention and
     * almost nobody is told about it; being told is the difference between a
     * drag that does what you meant and one you undo.
     */
    {
      id: 'window-crossing',
      target: ANCHORS.viewport,
      title: t('demo.navigation.dragTitle'),
      description: t('demo.navigation.dragDesc'),
      position: 'right',
      highlightPadding: 0,
      overlayOpacity: 0.4,
      allowInteraction: true,
    },

    {
      id: 'kinds',
      target: ANCHORS.ribbonCommand('select'),
      /*
       * Opens the Selection panel rather than only pointing at the command.
       * The next card is about what Delete removes and reads the panel; left
       * unopened, it described a panel the reader was not looking at.
       */
      onEnter: () => openPanel('selection'),
      title: t('demo.navigation.kindsTitle'),
      description: t('demo.navigation.kindsDesc'),
      position: 'bottom',
      allowInteraction: true,
    },

    {
      id: 'delete',
      target: ANCHORS.rightPanel,
      onEnter: () => openPanel('selection'),
      title: t('demo.navigation.deleteTitle'),
      description: t('demo.navigation.deleteDesc'),
      position: 'left',
      allowInteraction: true,
    },

    {
      id: 'done',
      target: 'none',
      title: t('demo.navigation.doneTitle'),
      description: t('demo.navigation.doneDesc'),
      position: 'center',
    },
  ];
}
