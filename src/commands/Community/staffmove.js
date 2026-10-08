import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  escapeMarkdown,
} from 'discord.js';

const CHANNEL_ID = '1531035523546743004';

const TYPES = {
  promotion: {
    title: '↗ Staff Promotion',
    color: 0x00fc88,
    description: member => `${member} has been promoted.`,
  },
  demotion: {
    title: '↘ Staff Demotion',
    color: 0xf87171,
    description: member => `${member}'s staff rank has been updated.`,
  },
  joining: {
    title: '🌴 Welcome to the Team',
    color: 0x38bdf8,
    description: member => `Welcome ${member} to the Tropical SMP team!`,
  },
  departure: {
    title: '👋 Staff Departure',
    color: 0x94a3b8,
    description: member =>
      `${member} has left the staff team.\nThank you for your contribution to Tropical SMP.`,
  },
};

// Escaping can increase the length of the submitted text.
// Keep field values within Discord's 1,024-character limit.
function fieldText(text) {
  const escaped = escapeMarkdown(text);
  return escaped.length > 1024
    ? `${escaped.slice(0, 1020)}…`
    : escaped;
}

export default {
  data: new SlashCommandBuilder()
    .setName('staffmove')
    .setDescription('Create a Tropical SMP staff announcement')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option
        .setName('member')
        .setDescription('The staff member')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Type of staff movement')
        .setRequired(true)
        .addChoices(
          { name: '↗ Promotion', value: 'promotion' },
          { name: '↘ Demotion', value: 'demotion' },
          { name: '🌴 Joining the team', value: 'joining' },
          { name: '👋 Leaving the team', value: 'departure' }
        )
    )
    .addRoleOption(option =>
      option
        .setName('previous')
        .setDescription('Previous rank')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('new')
        .setDescription('New rank')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (
      !interaction.inGuild() ||
      !interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
      )
    ) {
      return interaction.reply({
        content: 'Only administrators can create staff updates.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const member = interaction.options.getUser('member', true);
    const type = interaction.options.getString('type', true);
    const previous = interaction.options.getRole('previous', true);
    const next = interaction.options.getRole('new', true);
    const style = TYPES[type];

    if (!style) {
      return interaction.reply({
        content: 'Please select a valid staff movement type.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (previous.id === next.id) {
      return interaction.reply({
        content: 'Choose two different ranks.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Keep IDs without ":" for compatibility with your global handler.
    const modalId = `staffmove_reason_${interaction.id}`;
    const publishId = `staffmove_publish_${interaction.id}`;
    const cancelId = `staffmove_cancel_${interaction.id}`;

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Reason for this update')
      .setPlaceholder(
        'Example: Consistent activity and excellent support for players.'
      )
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(3)
      .setMaxLength(1000)
      .setRequired(true);

    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('Tropical SMP • Staff Update')
      .addComponents(
        new ActionRowBuilder().addComponents(reasonInput)
      );

    await interaction.showModal(modal);

    let submitted;

    try {
      submitted = await interaction.awaitModalSubmit({
        filter: event =>
          event.customId === modalId &&
          event.user.id === interaction.user.id,
        time: 300_000,
      });
    } catch {
      return;
    }

    await submitted.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const reason = submitted.fields
      .getTextInputValue('reason')
      .trim();

    if (reason.length < 3) {
      return submitted.editReply({
        content: 'Please enter a reason with at least 3 characters.',
      });
    }

    const guildIcon = interaction.guild.iconURL({ size: 128 });

    const embed = new EmbedBuilder()
      .setColor(style.color)
      .setAuthor({
        name: 'Tropical SMP',
        ...(guildIcon ? { iconURL: guildIcon } : {}),
      })
      .setTitle(style.title)
      .setDescription(style.description(`<@${member.id}>`))
      .setThumbnail(member.displayAvatarURL({ size: 128 }))
      .addFields(
        {
          name: 'Previous rank',
          value: `**${fieldText(previous.name)}**`,
          inline: true,
        },
        {
          name: 'New rank',
          value: `**${fieldText(next.name)}**`,
          inline: true,
        },
        {
          name: 'Reason',
          value: fieldText(reason),
          inline: false,
        }
      )
      .setFooter({
        text: `Updated by ${interaction.user.username} • Staff Updates`,
        iconURL: interaction.user.displayAvatarURL({ size: 64 }),
      })
      .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(publishId)
        .setLabel('Publish announcement')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    const preview = await submitted.editReply({
      content:
        `**Review your announcement**\n` +
        `Ready to publish in <#${CHANNEL_ID}>.`,
      embeds: [embed],
      components: [buttons],
      allowedMentions: { parse: [] },
    });

    let clicked;

    try {
      clicked = await preview.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: event =>
          event.user.id === interaction.user.id &&
          [publishId, cancelId].includes(event.customId),
        time: 120_000,
      });
    } catch {
      return submitted.editReply({
        content: 'This preview expired. Run `/staffmove` to try again.',
        embeds: [],
        components: [],
      });
    }

    await clicked.deferUpdate();

    if (clicked.customId === cancelId) {
      return submitted.editReply({
        content: 'Announcement cancelled.',
        embeds: [],
        components: [],
      });
    }

    let message;

    try {
      // Recheck administrator access before publishing.
      const author = await interaction.guild.members.fetch(
        interaction.user.id
      );

      if (!author.permissions.has(PermissionFlagsBits.Administrator)) {
        return submitted.editReply({
          content: 'You no longer have permission to publish staff updates.',
          embeds: [],
          components: [],
        });
      }

      const channel = await interaction.guild.channels.fetch(CHANNEL_ID);
      const bot = await interaction.guild.members.fetchMe();
      const permissions = channel?.permissionsFor(bot);

      const sendPermission = channel?.isThread()
        ? PermissionFlagsBits.SendMessagesInThreads
        : PermissionFlagsBits.SendMessages;

      if (
        !channel?.isTextBased() ||
        typeof channel.send !== 'function' ||
        !permissions?.has([
          PermissionFlagsBits.ViewChannel,
          sendPermission,
          PermissionFlagsBits.EmbedLinks,
        ])
      ) {
        throw new Error('Missing announcement channel or permissions');
      }

      embed.setTimestamp();

      message = await channel.send({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('Staff movement publication failed:', error);

      return submitted.editReply({
        content:
          'Could not publish the announcement. Check the channel ID and ' +
          'the bot’s View Channel, Send Messages, and Embed Links permissions.',
        embeds: [],
        components: [],
      });
    }

    // Keep confirmation errors separate from publication errors.
    // If this fails, the announcement has already been sent.
    try {
      await submitted.editReply({
        content: `✅ Published successfully. [View announcement](${message.url})`,
        embeds: [],
        components: [],
      });
    } catch (error) {
      console.error(
        'Staff update published, but confirmation could not be updated:',
        error
      );
    }
  },
};
