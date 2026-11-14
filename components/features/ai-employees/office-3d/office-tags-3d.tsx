'use client';

import { type RefObject, forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import {
  FIGURE_HEIGHT_3D,
  type FloorLabelsHandle,
  type FloorLabelsProps,
  OfficeFloorLabels,
} from '../office-floor-labels';
import type { Places3D } from './office-canvas-3d';
import { type View3D, projectFloor } from './office-view-3d';

export { LABELLED_AREAS, TAG_DROP, roomLabelAnchor, tagAnchor } from '../office-floor-labels';

/** What the canvas last showed: the tags place themselves with it between two frames */
export interface Shown3D {
  view: View3D;
  places: Places3D;
}

export interface Office3DTagsHandle {
  /** Puts every tag where the camera shows its employee: called by the canvas each frame */
  place: (view: View3D, places: Places3D) => void;
}

/**
 * The name tags and the room names of the 3D floor (#1147). The 3D canvas is a picture; what can
 * be chosen, pressed and read out is the same layer of DOM the 2D floor uses
 * (office-floor-labels.tsx). The canvas tells each frame where the camera looks, and the layer
 * lays the tags and names out there without a render.
 */
export const Office3DTags = forwardRef<
  Office3DTagsHandle,
  FloorLabelsProps & {
    /**
     * What the canvas showed in its last frame. The tags are placed with it after every render:
     * with less motion the canvas draws only on a change, so no next frame comes to place a tag
     * that was just mounted or whose seat just changed.
     */
    lastShown?: RefObject<Shown3D | null>;
  }
>(function Office3DTags({ lastShown, ...labels }, ref) {
  const layer = useRef<FloorLabelsHandle>(null);
  const place = useCallback((view: View3D, places: Places3D) => {
    layer.current?.place((point, height) => projectFloor(point, height, view), places, view.size);
  }, []);
  useImperativeHandle(ref, () => ({ place }), [place]);
  return (
    <OfficeFloorLabels
      ref={layer}
      {...labels}
      figureHeight={FIGURE_HEIGHT_3D}
      onLayout={() => {
        const shown = lastShown?.current;
        if (shown) place(shown.view, shown.places);
      }}
    />
  );
});
