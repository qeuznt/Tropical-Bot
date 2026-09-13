// xpSystem.js
// Tropical Bot - Leveling Disabled

import { wrapServiceBoundary } from '../../utils/errorHandler.js';

/**
 * Leveling has been completely disabled.
 *
 * This function is intentionally kept/exported because other parts
 * of TitanBot may import addXp(). Returning null prevents:
 *
 * - XP gain
 * - Level ups
 * - Level-up announcements
 * - Level reward roles
 * - Level-up logging
 *
 * Keeping the function prevents missing-export/import errors.
 */
export const addXp = wrapServiceBoundary(
  async function addXp(client, guild, member, xpToAdd) {
    return null;
  },
  {
    service: 'xpSystem',
    operation: 'addXp',
    userMessage: 'Leveling is disabled.',
  }
);
