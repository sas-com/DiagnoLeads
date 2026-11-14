/**
 * The name tags and the room names over the 3D floor (#1147): DOM buttons that the canvas places
 * each frame. No renderer here: the tags are placed with a view, like the canvas does.
 */
import {
  LABELLED_AREAS,
  Office3DTags,
  type Office3DTagsHandle,
  TAG_DROP,
  roomLabelAnchor,
  tagAnchor,
} from '@/components/features/ai-employees/office-3d/office-tags-3d';
import {
  FLOOR_MIDDLE,
  type View3D,
  projectFloor,
  pxPerUnit,
} from '@/components/features/ai-employees/office-3d/office-view-3d';
import { AREA_RECTS, spotOf } from '@/components/features/ai-employees/office-map-layout';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

const messages = mergeMessageFiles(MESSAGE_FILES.ja);
const size = { w: 1440, h: 900 };
const view: View3D = {
  target: FLOOR_MIDDLE,
  pxPerUnit: pxPerUnit(size, 1),
  pan: { x: 0, y: 0 },
  size,
};
const statuses = {
  marketer: 'vacant',
  sales: 'training',
  engineer: 'vacant',
  back_office: 'paused',
} as const;

function renderTags(over: { selected?: 'sales' | 'marketer' } = {}) {
  const ref = createRef<Office3DTagsHandle>();
  const onChoose = vi.fn();
  const onTalk = vi.fn();
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <Office3DTags
        ref={ref}
        statuses={statuses}
        names={{ sales: 'AIセールス', back_office: 'AIバックオフィス' }}
        selected={over.selected ?? 'marketer'}
        onChoose={onChoose}
        onTalk={onTalk}
      />
    </NextIntlClientProvider>
  );
  return { ref, onChoose, onTalk };
}

describe('tagAnchor', () => {
  it('follows an employee wherever it walks, and falls back to where its status puts it', () => {
    expect(tagAnchor('sales', 'training', { sales: { x: 4, y: 9 } })).toEqual({ x: 4, y: 9 });
    const spot = spotOf('sales', 'training');
    expect(tagAnchor('sales', 'training', {})).toEqual({ x: spot.x, y: spot.y });
  });

  it('stays on the seat for a role nobody was hired for, whatever was left in the places', () => {
    const seat = spotOf('marketer', 'vacant');
    expect(tagAnchor('marketer', 'vacant', { marketer: { x: 1, y: 1 } })).toEqual({
      x: seat.x,
      y: seat.y,
    });
  });
});

describe('roomLabelAnchor', () => {
  it('floats over the back of each room, inside it', () => {
    for (const area of LABELLED_AREAS) {
      const rect = AREA_RECTS[area];
      const { point, height } = roomLabelAnchor(area);
      expect(point.x).toBeGreaterThan(rect.x);
      expect(point.x).toBeLessThan(rect.x + rect.w / 2);
      expect(point.y).toBeGreaterThan(rect.y);
      expect(point.y).toBeLessThan(rect.y + rect.h / 2);
      expect(height).toBeGreaterThan(0);
    }
    expect(LABELLED_AREAS).not.toContain('corridor');
  });
});

describe('Office3DTags', () => {
  it('shows a tag for every role, hired or vacant, once the canvas placed them', () => {
    const { ref } = renderTags();
    // Not shown in a pile in the corner before the first frame
    const before = Array.from(document.querySelectorAll('button'));
    expect(before).toHaveLength(4);
    for (const tag of before) expect(tag.style.visibility).toBe('hidden');
    act(() => ref.current?.place(view, {}));
    for (const name of [/マーケター 空席/, /AIセールス 研修中/, /エンジニア 空席/, /AIバックオフィス 休止中/]) {
      expect(screen.getByRole('button', { name }).style.visibility).toBe('visible');
    }
  });

  it('puts each tag under its employee, and moves it when the employee walks or the floor is dragged', () => {
    const { ref } = renderTags();
    act(() => ref.current?.place(view, {}));
    const sales = screen.getByRole('button', { name: /AIセールス 研修中/ });
    const spot = spotOf('sales', 'training');
    const rest = projectFloor({ x: spot.x, y: spot.y }, 0, view);
    // Its upper edge hangs under the feet (jsdom measures no width: the middle is the left edge)
    expect(sales.style.transform).toBe(
      `translate(${rest.x.toFixed(1)}px, ${(rest.y + TAG_DROP).toFixed(1)}px)`
    );

    const walking = { x: 12, y: 9 };
    act(() => ref.current?.place(view, { sales: walking }));
    const onTheWay = projectFloor(walking, 0, view);
    expect(sales.style.transform).toContain(`translate(${onTheWay.x.toFixed(1)}px,`);

    const dragged = { ...view, pan: { x: 50, y: 0 } };
    act(() => ref.current?.place(dragged, { sales: walking }));
    expect(sales.style.transform).toContain(`translate(${(onTheWay.x + 50).toFixed(1)}px,`);
  });

  it('chooses with a press, and talks to the one already chosen', async () => {
    const user = userEvent.setup();
    const { ref, onChoose, onTalk } = renderTags({ selected: 'sales' });
    act(() => ref.current?.place(view, {}));
    await user.click(screen.getByRole('button', { name: /マーケター 空席/ }));
    expect(onChoose).toHaveBeenCalledWith('marketer');
    const chosen = screen.getByRole('button', { name: /AIセールス 研修中/ });
    expect(chosen).toHaveAttribute('aria-current', 'true');
    await user.click(chosen);
    expect(onTalk).toHaveBeenCalledWith('sales');
  });

  it('reads out the role and the room with each tag, and keeps the room names for the eye', () => {
    const { ref } = renderTags();
    act(() => ref.current?.place(view, {}));
    expect(screen.getByRole('button', { name: /AIセールス\s*研修中\s*セールス・研修室/ })).toBeVisible();
    const room = screen.getByText('マーケティング室');
    expect(room).toHaveAttribute('aria-hidden', 'true');
    expect(room.style.visibility).toBe('visible');
  });

  it('leaves out the name of a room that the view puts off the screen (#1177)', () => {
    const { ref } = renderTags();
    // Dragged far to the right: the rooms on the right leave the screen
    act(() => ref.current?.place({ ...view, pan: { x: 1400, y: 0 } }, {}));
    expect(screen.getByText('開発室').style.visibility).toBe('hidden');
    act(() => ref.current?.place(view, {}));
    expect(screen.getByText('開発室').style.visibility).toBe('visible');
  });

  it('places itself with what the canvas last showed, without waiting for a frame', () => {
    // With less motion the canvas draws only on a change: no frame follows the mount of the tags
    const lastShown = { current: { view, places: { sales: { x: 12, y: 9 } } } };
    render(
      <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
        <Office3DTags
          lastShown={lastShown}
          statuses={statuses}
          names={{ sales: 'AIセールス' }}
          selected="sales"
          onChoose={vi.fn()}
          onTalk={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    const sales = screen.getByRole('button', { name: /AIセールス 研修中/ });
    const at = projectFloor({ x: 12, y: 9 }, 0, view);
    expect(sales.style.visibility).toBe('visible');
    expect(sales.style.transform).toContain(`translate(${at.x.toFixed(1)}px,`);
  });

  it('lets the pointer through to the floor, except on the tags', () => {
    const { ref } = renderTags();
    act(() => ref.current?.place(view, {}));
    const sales = screen.getByRole('button', { name: /AIセールス 研修中/ });
    expect(sales.className).toContain('pointer-events-auto');
    expect(sales.parentElement?.className).toContain('pointer-events-none');
  });
});
