'use client';

import type { ComponentType } from 'react';
import type { OfficeRoomProps } from './office-room-contract';
import { OfficeRoomDue } from './office-room-due';
import { OfficeRoomLeads } from './office-room-leads';
import { OfficeRoomSales } from './office-room-sales';
import type { OfficeRoom } from './office-rooms';

/**
 * What each room of the full-screen office shows (#1142): the office picks the room's view here
 * and hands it the same props (office-room-contract.ts), so a room is added with its own files, a
 * line here and its entries in office-rooms.ts.
 *
 * The first two rooms were built before the contract: they are handed its props under the names
 * they already take.
 */
export const ROOM_VIEWS: Readonly<Record<OfficeRoom, ComponentType<OfficeRoomProps>>> = {
  marketing: ({ organizationId, guide, keysRef, onLeaveOffice, onFileOpenChange }) =>
    guide && (
      <OfficeRoomLeads
        organizationId={organizationId}
        role={guide.role}
        status={guide.status}
        employeeName={guide.name}
        look={guide.look}
        keysRef={keysRef}
        onOpenLead={onLeaveOffice}
        onFileOpenChange={onFileOpenChange}
      />
    ),
  sales: OfficeRoomSales,
  backoffice: ({ organizationId, guide, keysRef, onLeaveOffice }) =>
    guide && (
      <OfficeRoomDue
        organizationId={organizationId}
        role={guide.role}
        status={guide.status}
        employeeName={guide.name}
        look={guide.look}
        keysRef={keysRef}
        onOpenNormal={onLeaveOffice}
      />
    ),
};
