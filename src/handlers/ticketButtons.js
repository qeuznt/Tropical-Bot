const createTicketModalHandler = {
  name: 'create_ticket_modal',

  async execute(interaction, client, args) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const deferSuccess = await InteractionHelper.safeDefer(
        interaction,
        { flags: MessageFlags.Ephemeral }
      );

      if (!deferSuccess) return;

      const ticketType = args?.[0] || 'support_ticket';

      const ticketTypeNames = {
        support_ticket: 'Support Ticket',
        player_report: 'Player Report',
        bug_report: 'Bug Report',
        punishment_appeal: 'Ban/Mute Appeal'
      };

      const ticketTypeName =
        ticketTypeNames[ticketType] || 'Support Ticket';

      const reason =
        interaction.fields.getTextInputValue('reason');

      const config =
        await getGuildConfig(client, interaction.guildId);

      const categoryId =
        config.ticketCategoryId || null;

      const fullReason =
        `[${ticketTypeName}] ${reason}`;

      const { channel } = await createTicket(
        interaction.guild,
        interaction.member,
        categoryId,
        fullReason
      );

      await interaction.editReply({
        embeds: [
          successEmbed(
            'Ticket Created',
            `Your **${ticketTypeName}** has been created in ${channel}!`
          )
        ]
      });

    } catch (error) {
      await handleInteractionError(
        interaction,
        error,
        {
          type: 'modal',
          handler: 'ticket',
          customId: interaction.customId
        }
      );
    }
  }
};
