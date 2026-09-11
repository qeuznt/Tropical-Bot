import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags
} from 'discord.js';

import { createEmbed, successEmbed } from '../utils/embeds.js';
import {
  createTicket,
  closeTicket,
  claimTicket,
  updateTicketPriority
} from '../services/ticket.js';

import { getGuildConfig } from '../services/config/guildConfig.js';
import { logTicketEvent } from '../utils/ticket/ticketLogging.js';
import { logger } from '../utils/logger.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

import {
  replyUserError,
  ErrorTypes,
  handleInteractionError,
  createError
} from '../utils/errorHandler.js';

import {
  getTicketPermissionContext
} from '../utils/ticket/ticketPermissions.js';


function escapeHtml(text) {
  if (!text) return '';

  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


async function ensureGuildContext(interaction) {

  if (interaction.inGuild()) {
    return true;
  }

  if (!interaction.replied && !interaction.deferred) {

    await replyUserError(interaction, {
      type: ErrorTypes.UNKNOWN,
      message: 'This action can only be used in a server.'
    });
  }

  return false;
}


async function assertTicketPermission(
  interaction,
  client,
  actionLabel,
  options = {},
  timeoutMs = 2500
) {

  const {
    allowTicketCreator = false
  } = options;

  let context;

  try {

    const contextPromise =
      getTicketPermissionContext({
        client,
        interaction
      });

    const timeoutPromise =
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Timeout')),
          timeoutMs
        )
      );

    context =
      await Promise.race([
        contextPromise,
        timeoutPromise
      ]);

  } catch (error) {

    if (error.message === 'Timeout') {

      throw createError(
        'Ticket permission timeout',
        ErrorTypes.RATE_LIMIT,
        'The permission check took too long. Please try again.'
      );
    }

    throw createError(
      'Ticket permission check failed',
      ErrorTypes.UNKNOWN,
      `Failed to check permissions: ${error.message}`
    );
  }


  if (!context.ticketData) {

    throw createError(
      'Not a ticket channel',
      ErrorTypes.VALIDATION,
      'This action can only be used in a valid ticket channel.'
    );
  }


  const allowed =
    allowTicketCreator
      ? context.canCloseTicket
      : context.canManageTicket;


  if (!allowed) {

    const permissionMessage =
      allowTicketCreator
        ? 'You must have **Manage Channels**, the configured **Ticket Staff Role**, or be the **ticket creator**.'
        : 'You must have **Manage Channels** or the configured **Ticket Staff Role**.';


    throw createError(
      'Ticket permission denied',
      ErrorTypes.PERMISSION,
      `${permissionMessage}\n\nYou cannot ${actionLabel}.`
    );
  }


  return context;
}


async function ensureTicketPermission(
  interaction,
  client,
  actionLabel,
  options = {}
) {

  const {
    allowTicketCreator = false
  } = options;


  const context =
    await getTicketPermissionContext({
      client,
      interaction
    });


  if (!context.ticketData) {

    await replyUserError(interaction, {
      type: ErrorTypes.UNKNOWN,
      message:
        'This action can only be used in a valid ticket channel.'
    });

    return null;
  }


  const allowed =
    allowTicketCreator
      ? context.canCloseTicket
      : context.canManageTicket;


  if (!allowed) {

    const permissionMessage =
      allowTicketCreator
        ? 'You must have **Manage Channels**, the configured **Ticket Staff Role**, or be the **ticket creator**.'
        : 'You must have **Manage Channels** or the configured **Ticket Staff Role**.';


    await replyUserError(interaction, {
      type: ErrorTypes.PERMISSION,
      message:
        `${permissionMessage}\n\nYou cannot ${actionLabel}.`
    });

    return null;
  }


  return context;
}


/*
==================================================
TICKET TYPES
==================================================
*/

const ticketTypes = {

  support_ticket: {
    title: 'Support Ticket',
    question:
      'How can we help you?',
    placeholder:
      'Describe what you need help with...'
  },

  player_report: {
    title: 'Player Report',
    question:
      'What player are you reporting and why?',
    placeholder:
      'Tell us the player name and what happened...'
  },

  bug_report: {
    title: 'Bug Report',
    question:
      'What bug did you find?',
    placeholder:
      'Explain the bug and how it happened...'
  },

  punishment_appeal: {
    title: 'Ban/Mute Appeal',
    question:
      'Why should your punishment be appealed?',
    placeholder:
      'Explain why you are appealing your ban or mute...'
  }

};


/*
==================================================
OPEN MODAL FROM DROPDOWN
==================================================
*/

const createTicketHandler = {

  name: 'ticket_type',

  async execute(interaction, client) {

    try {

      if (!(await ensureGuildContext(interaction))) {
        return;
      }


      const selectedType =
        interaction.values?.[0];


      const typeData =
        ticketTypes[selectedType];


      if (!typeData) {

        return await replyUserError(interaction, {
          type: ErrorTypes.VALIDATION,
          message:
            'That ticket type is not valid.'
        });
      }


      const rateLimitKey =
        `${interaction.user.id}:create_ticket`;


      const allowed =
        await checkRateLimit(
          rateLimitKey,
          3,
          60000
        );


      if (!allowed) {

        await replyUserError(interaction, {
          type: ErrorTypes.RATE_LIMIT,
          message:
            'You are creating tickets too quickly. Please wait a minute and try again.'
        });

        return;
      }


      const config =
        await getGuildConfig(
          client,
          interaction.guildId
        );


      const maxTicketsPerUser =
        config.maxTicketsPerUser || 3;


      const {
        getUserTicketCount
      } =
        await import('../services/ticket.js');


      const currentTicketCount =
        await getUserTicketCount(
          interaction.guildId,
          interaction.user.id
        );


      if (
        currentTicketCount >=
        maxTicketsPerUser
      ) {

        return await replyUserError(
          interaction,
          {
            type: ErrorTypes.UNKNOWN,

            message:
              `You have reached the maximum number of open tickets (${maxTicketsPerUser}).\n\n` +
              `Please close your existing tickets before creating a new one.\n\n` +
              `**Current Tickets:** ${currentTicketCount}/${maxTicketsPerUser}`
          }
        );
      }


      const modal =
        new ModalBuilder()

          .setCustomId(
            `create_ticket_modal_${selectedType}`
          )

          .setTitle(
            typeData.title
          );


      const reasonInput =
        new TextInputBuilder()

          .setCustomId(
            'reason'
          )

          .setLabel(
            typeData.question
          )

          .setStyle(
            TextInputStyle.Paragraph
          )

          .setPlaceholder(
            typeData.placeholder
          )

          .setRequired(true)

          .setMaxLength(1000);


      const actionRow =
        new ActionRowBuilder()
          .addComponents(
            reasonInput
          );


      modal.addComponents(
        actionRow
      );


      await interaction.showModal(
        modal
      );


    } catch (error) {

      logger.error(
        'Error creating ticket modal:',
        error
      );


      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type: ErrorTypes.UNKNOWN,
            message:
              'Could not open ticket creation form.'
          }
        );
      }
    }
  }
};


/*
==================================================
CREATE TICKET FROM MODAL
==================================================
*/

async function handleCreateTicketModal(
  interaction,
  client,
  type
) {

  try {

    if (!(await ensureGuildContext(interaction))) {
      return;
    }


    const deferSuccess =
      await InteractionHelper.safeDefer(
        interaction,
        {
          flags:
            MessageFlags.Ephemeral
        }
      );


    if (!deferSuccess) {
      return;
    }


    const reason =
      interaction.fields
        .getTextInputValue(
          'reason'
        );


    const typeData =
      ticketTypes[type];


    if (!typeData) {

      return await replyUserError(
        interaction,
        {
          type:
            ErrorTypes.VALIDATION,

          message:
            'That ticket type is not valid.'
        }
      );
    }


    const config =
      await getGuildConfig(
        client,
        interaction.guildId
      );


    const categoryId =
      config.ticketCategoryId || null;


    const formattedReason =
      `Ticket Type: ${typeData.title}\n\n${reason}`;


    const {
      channel
    } =
      await createTicket(

        interaction.guild,

        interaction.member,

        categoryId,

        formattedReason
      );


    await interaction.editReply({

      embeds: [

        successEmbed(

          'Ticket Created',

          `Your **${typeData.title}** has been created in ${channel}!`

        )

      ]
    });


  } catch (error) {

    await handleInteractionError(
      interaction,
      error,
      {
        type:
          'modal',

        handler:
          'ticket',

        customId:
          interaction.customId
      }
    );
  }
}


/*
==================================================
SUPPORT TICKET MODAL
==================================================
*/

const supportTicketModalHandler = {

  name:
    'create_ticket_modal_support_ticket',

  async execute(
    interaction,
    client
  ) {

    return handleCreateTicketModal(
      interaction,
      client,
      'support_ticket'
    );
  }
};


/*
==================================================
PLAYER REPORT MODAL
==================================================
*/

const playerReportModalHandler = {

  name:
    'create_ticket_modal_player_report',

  async execute(
    interaction,
    client
  ) {

    return handleCreateTicketModal(
      interaction,
      client,
      'player_report'
    );
  }
};


/*
==================================================
BUG REPORT MODAL
==================================================
*/

const bugReportModalHandler = {

  name:
    'create_ticket_modal_bug_report',

  async execute(
    interaction,
    client
  ) {

    return handleCreateTicketModal(
      interaction,
      client,
      'bug_report'
    );
  }
};


/*
==================================================
BAN / MUTE APPEAL MODAL
==================================================
*/

const punishmentAppealModalHandler = {

  name:
    'create_ticket_modal_punishment_appeal',

  async execute(
    interaction,
    client
  ) {

    return handleCreateTicketModal(
      interaction,
      client,
      'punishment_appeal'
    );
  }
};


/*
==================================================
CLOSE TICKET
==================================================
*/

const closeTicketHandler = {

  name: 'ticket_close',

  async execute(
    interaction,
    client
  ) {

    try {

      if (!(await ensureGuildContext(interaction))) {
        return;
      }


      await assertTicketPermission(
        interaction,
        client,
        'close this ticket',
        {
          allowTicketCreator: true
        },
        2000
      );


      const modal =
        new ModalBuilder()

          .setCustomId(
            'ticket_close_modal'
          )

          .setTitle(
            'Close Ticket'
          );


      const reasonInput =
        new TextInputBuilder()

          .setCustomId(
            'reason'
          )

          .setLabel(
            'Reason for closing (optional)'
          )

          .setStyle(
            TextInputStyle.Paragraph
          )

          .setPlaceholder(
            'Add an optional reason for closing this ticket...'
          )

          .setRequired(false)

          .setMaxLength(1000);


      const actionRow =
        new ActionRowBuilder()
          .addComponents(
            reasonInput
          );


      modal.addComponents(
        actionRow
      );


      await interaction.showModal(
        modal
      );


    } catch (error) {

      logger.error(
        'Error closing ticket:',
        error
      );


      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'Could not open ticket close form.'
          }
        );
      }
    }
  }
};


/*
==================================================
CLOSE TICKET MODAL
==================================================
*/

const closeTicketModalHandler = {

  name:
    'ticket_close_modal',

  async execute(
    interaction,
    client
  ) {

    try {

      if (!(await ensureGuildContext(interaction))) {
        return;
      }


      await assertTicketPermission(
        interaction,
        client,
        'close this ticket',
        {
          allowTicketCreator: true
        },
        2000
      );


      const deferSuccess =
        await InteractionHelper.safeDefer(
          interaction,
          {
            flags:
              MessageFlags.Ephemeral
          }
        );


      if (!deferSuccess) {
        return;
      }


      const providedReason =
        interaction.fields
          .getTextInputValue(
            'reason'
          )
          ?.trim();


      const reason =
        providedReason ||
        'Closed via ticket button without a specific reason.';


      await closeTicket(
        interaction.channel,
        interaction.user,
        reason
      );


      await interaction.editReply({

        embeds: [

          successEmbed(
            'Ticket Closed',
            'This ticket has been closed.'
          )

        ]
      });


    } catch (error) {

      logger.error(
        'Error submitting close ticket modal:',
        error
      );


      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'An error occurred while closing the ticket.'
          }
        );

      } else if (
        interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'An error occurred while closing the ticket.'
          }
        );
      }
    }
  }
};


/*
==================================================
CLAIM TICKET
==================================================
*/

const claimTicketHandler = {

  name:
    'ticket_claim',

  async execute(
    interaction,
    client
  ) {

    try {

      if (!(await ensureGuildContext(interaction))) {
        return;
      }


      await assertTicketPermission(
        interaction,
        client,
        'claim tickets',
        {},
        2000
      );


      const deferSuccess =
        await InteractionHelper.safeDefer(
          interaction,
          {
            flags:
              MessageFlags.Ephemeral
          }
        );


      if (!deferSuccess) {
        return;
      }


      await claimTicket(
        interaction.channel,
        interaction.user
      );


      await interaction.editReply({

        embeds: [

          successEmbed(
            'Ticket Claimed',
            'You have claimed this ticket.'
          )

        ]
      });


    } catch (error) {

      logger.error(
        'Error claiming ticket:',
        error
      );


      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'An error occurred while claiming the ticket.'
          }
        );

      } else if (
        interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'An error occurred while claiming the ticket.'
          }
        );
      }
    }
  }
};


/*
==================================================
PRIORITY
==================================================
*/

const priorityTicketHandler = {

  name:
    'ticket_priority',

  async execute(
    interaction,
    client,
    args
  ) {

    try {

      if (!(await ensureGuildContext(interaction))) {
        return;
      }


      await assertTicketPermission(
        interaction,
        client,
        'change ticket priority',
        {},
        2000
      );


      const deferSuccess =
        await InteractionHelper.safeDefer(
          interaction,
          {
            flags:
              MessageFlags.Ephemeral
          }
        );


      if (!deferSuccess) {
        return;
      }


      const priority =
        args?.[0];


      if (!priority) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.VALIDATION,

            message:
              'A priority value is required.'
          }
        );

        return;
      }


      await updateTicketPriority(
        interaction.channel,
        priority,
        interaction.user
      );


      await interaction.editReply({

        embeds: [

          successEmbed(
            'Priority Updated',
            `Ticket priority set to **${priority.toUpperCase()}**.`
          )

        ]
      });


    } catch (error) {

      logger.error(
        'Error updating ticket priority:',
        error
      );


      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'An error occurred while updating the priority.'
          }
        );

      } else if (
        interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'An error occurred while updating the priority.'
          }
        );
      }
    }
  }
};


/*
==================================================
PIN / UNPIN
==================================================
*/

const pinTicketHandler = {

  name:
    'ticket_pin',

  async execute(
    interaction,
    client
  ) {

    try {

      if (!(await ensureGuildContext(interaction))) {
        return;
      }


      await assertTicketPermission(
        interaction,
        client,
        'pin tickets',
        {},
        2000
      );


      const deferSuccess =
        await InteractionHelper.safeDefer(
          interaction,
          {
            flags:
              MessageFlags.Ephemeral
          }
        );


      if (!deferSuccess) {
        return;
      }


      const channel =
        interaction.channel;


      const category =
        channel.parent;


      if (!category) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'This ticket is not in a category.'
          }
        );

        return;
      }


      const hasPingEmoji =
        channel.name.startsWith(
          '📌'
        );


      if (hasPingEmoji) {

        const newName =
          channel.name.replace(
            /^📌\s*/,
            ''
          );


        await channel.edit({

          name:
            newName,

          position:
            999
        });


        await interaction.editReply({

          embeds: [

            createEmbed({

              title:
                '📌 Ticket Unpinned',

              description:
                'This ticket has been unpinned and moved back to normal position.',

              color:
                0x95A5A6
            })

          ]
        });


        logger.info(
          'Ticket unpinned',
          {

            guildId:
              interaction.guildId,

            channelId:
              channel.id,

            channelName:
              newName,

            userId:
              interaction.user.id
          }
        );


      } else {

        const pinnedName =
          `📌 ${channel.name}`;


        await channel.edit({

          name:
            pinnedName,

          position:
            0
        });


        await interaction.editReply({

          embeds: [

            createEmbed({

              title:
                '📌 Ticket Pinned',

              description:
                'This ticket has been pinned to the top of the category.',

              color:
                0x3498db
            })

          ]
        });


        logger.info(
          'Ticket pinned',
          {

            guildId:
              interaction.guildId,

            channelId:
              channel.id,

            channelName:
              pinnedName,

            userId:
              interaction.user.id
          }
        );
      }


      await logTicketEvent({

        client:
          interaction.client,

        guildId:
          interaction.guildId,

        event: {

          type:
            hasPingEmoji
              ? 'unpin'
              : 'pin',

          ticketId:
            channel.id,

          ticketNumber:
            channel.name.replace(
              /[^0-9]/g,
              ''
            ),

          userId:
            interaction.user.id,

          executorId:
            interaction.user.id,

          metadata: {

            isPinned:
              !hasPingEmoji,

            newChannelName:
              hasPingEmoji
                ? channel.name.replace(
                    /^📌\s*/,
                    ''
                  )
                : `📌 ${channel.name}`
          }
        }
      });


    } catch (error) {

      logger.error(
        'Error pinning/unpinning ticket:',
        error
      );


      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'Failed to pin/unpin the ticket.'
          }
        );

      } else if (
        interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'Failed to pin/unpin the ticket.'
          }
        );
      }
    }
  }
};


/*
==================================================
UNCLAIM
==================================================
*/

const unclaimTicketHandler = {

  name:
    'ticket_unclaim',

  async execute(
    interaction,
    client
  ) {

    try {

      if (!(await ensureGuildContext(interaction))) {
        return;
      }


      await assertTicketPermission(
        interaction,
        client,
        'unclaim tickets',
        {},
        2000
      );


      const deferSuccess =
        await InteractionHelper.safeDefer(
          interaction,
          {
            flags:
              MessageFlags.Ephemeral
          }
        );


      if (!deferSuccess) {
        return;
      }


      const {
        unclaimTicket
      } =
        await import(
          '../services/ticket.js'
        );


      await unclaimTicket(
        interaction.channel,
        interaction.member
      );


      await interaction.editReply({

        embeds: [

          successEmbed(
            'Ticket Unclaimed',
            'This ticket has been unclaimed.'
          )

        ]
      });


    } catch (error) {

      logger.error(
        'Error unclaiming ticket:',
        error
      );


      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'An error occurred while unclaiming the ticket.'
          }
        );

      } else if (
        interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'An error occurred while unclaiming the ticket.'
          }
        );
      }
    }
  }
};


/*
==================================================
REOPEN
==================================================
*/

const reopenTicketHandler = {

  name:
    'ticket_reopen',

  async execute(
    interaction,
    client
  ) {

    try {

      if (!(await ensureGuildContext(interaction))) {
        return;
      }


      await assertTicketPermission(
        interaction,
        client,
        'reopen tickets',
        {},
        2000
      );


      const deferSuccess =
        await InteractionHelper.safeDefer(
          interaction,
          {
            flags:
              MessageFlags.Ephemeral
          }
        );


      if (!deferSuccess) {
        return;
      }


      const {
        reopenTicket
      } =
        await import(
          '../services/ticket.js'
        );


      const {
        openCategoryMoveFailed
      } =
        await reopenTicket(
          interaction.channel,
          interaction.member
        );


      let reopenMessage =
        'This ticket has been reopened.';


      if (
        openCategoryMoveFailed
      ) {

        reopenMessage +=
          ' Note: Could not move the channel back to the open tickets category.';
      }


      await interaction.editReply({

        embeds: [

          successEmbed(
            'Ticket Reopened',
            reopenMessage
          )

        ]
      });


    } catch (error) {

      logger.error(
        'Error reopening ticket:',
        error
      );


      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'An error occurred while reopening the ticket.'
          }
        );

      } else if (
        interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'An error occurred while reopening the ticket.'
          }
        );
      }
    }
  }
};


/*
==================================================
DELETE
==================================================
*/

const deleteTicketHandler = {

  name:
    'ticket_delete',

  async execute(
    interaction,
    client
  ) {

    try {

      if (!(await ensureGuildContext(interaction))) {
        return;
      }


      await assertTicketPermission(
        interaction,
        client,
        'delete tickets',
        {},
        2000
      );


      const deferSuccess =
        await InteractionHelper.safeDefer(
          interaction,
          {
            flags:
              MessageFlags.Ephemeral
          }
        );


      if (!deferSuccess) {
        return;
      }


      const {
        deleteTicket
      } =
        await import(
          '../services/ticket.js'
        );


      await deleteTicket(
        interaction.channel,
        interaction.member
      );


      await interaction.editReply({

        embeds: [

          successEmbed(
            'Ticket Deleted',
            'This ticket will be deleted shortly.'
          )

        ]
      });


    } catch (error) {

      logger.error(
        'Error deleting ticket:',
        error
      );


      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'An error occurred while deleting the ticket.'
          }
        );

      } else if (
        interaction.deferred
      ) {

        await replyUserError(
          interaction,
          {
            type:
              ErrorTypes.UNKNOWN,

            message:
              'An error occurred while deleting the ticket.'
          }
        );
      }
    }
  }
};


/*
==================================================
EXPORTS
==================================================
*/

export default createTicketHandler;

export {

  supportTicketModalHandler,

  playerReportModalHandler,

  bugReportModalHandler,

  punishmentAppealModalHandler,

  closeTicketModalHandler,

  closeTicketHandler,

  claimTicketHandler,

  priorityTicketHandler,

  pinTicketHandler,

  unclaimTicketHandler,

  reopenTicketHandler,

  deleteTicketHandler

};
