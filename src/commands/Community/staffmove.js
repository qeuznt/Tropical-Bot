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
    title: '📈 Staff Promotion',
    color: 0x00fc88,
    text: 'Moving up in the Tropical SMP team.',
  },
  demotion: {
    title: '📉 Staff Demotion',
    color: 0xed4245,
    text: 'A change in team responsibilities.',
  },
  joining: {
    title: '🌴 Welcome to the Team',
    color: 0x38bdf8,
    text: 'A new chapter with Tropical SMP.',
  },
  departure: {
    title: '👋 Staff Departure',
    color: 0x94a3b8,
    text: 'Thank you for your time with the team.',
  },
};

export default {
  data: new SlashCommandBuilder()
    .setName('staffmove')
    .setDescription('Create a Tropical SMP staff movement announcement')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o =>
      o.setName('member')
        .setDescription('The staff member')
        .setRequired(true))
    .addStringOption(o =>
      o.setName('type')
        .setDescription('Type of staff movement')
        .setRequired(true)
        .addChoices(
          { name: '📈 Promotion', value: 'promotion' },
          { name: '📉 Demotion', value: 'demotion' },
          { name: '🌴 Joining the team', value: 'joining' },
          { name: '👋 Leaving the team', value: 'departure' },
        ))
    .addRoleOption(o =>
      o.setName('previous')
        .setDescription('Previous rank')
        .setRequired(true))
    .addRoleOption(o =>
      o.setName('new')
        .setDescription('New rank')
        .setRequired(true)),

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

    if (previous.id === next.id) {
      return interaction.reply({
        content: 'Choose two different ranks.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // No ":" in these IDs: your global handler leaves them
    // to this command's collectors.
    const modalId = `staffmove_reason_${interaction.id}`;

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Reason for this staff movement')
      .setPlaceholder('Explain the change...')
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(3)
      .setMaxLength(1000)
      .setRequired(true);

    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('Tropical SMP • Staff Movement')
      .addComponents(
        new ActionRowBuilder().addComponents(reasonInput)
      );

    await interaction.showModal(modal);

    let submitted;
    try {
      submitted = await interaction.awaitModalSubmit({
        filter: i =>
          i.customId === modalId &&
          i.user.id === interaction.user.id,
        time: 300_000,
      });
    } catch {
      return;
    }

    await submitted.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const reason = submitted.fields
      .getTextInputValue('reason').trim();

    if (reason.length < 3) {
      return submitted.editReply({
        content: 'Please enter a reason with at least 3 characters.',
      });
    }

    const style = TYPES[type];
    const icon = interaction.guild.iconURL({ size: 256 });

    const embed = new EmbedBuilder()
      .setColor(style.color)
      .setAuthor({
        name: 'TROPICAL SMP • STAFF MOVEMENTS',
        ...(icon ? { iconURL: icon } : {}),
      })
      .setTitle(style.title)
      .setDescription(
        `${style.text}\n\n` +
        `### ${member}\n` +
        `**${escapeMarkdown(previous.name)}** → ` +
        `**${escapeMarkdown(next.name)}**`
      )
      .setThumbnail(member.displayAvatarURL({ size: 256 }))
      .addFields(
        {
          name: '📝 Reason',
          value: escapeMarkdown(reason),
        },
        {
          name: '👤 Updated by',
          value: `${interaction.user}`,
          inline: true,
        },
        {
          name: '🕒 Date',
          value: `<t:${Math.floor(Date.now() / 1000)}:f>`,
          inline: true,
        },
      )
      .setFooter({ text: 'Tropical SMP • Team Update' })
      .setTimestamp();

    const publishId = `staffmove_publish_${interaction.id}`;
    const cancelId = `staffmove_cancel_${interaction.id}`;

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(publishId)
        .setLabel('Publish update')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    const preview = await submitted.editReply({
      content: `**Preview** • Will be posted in <#${CHANNEL_ID}>`,
      embeds: [embed],
      components: [buttons],
      allowedMentions: { parse: [] },
    });

    let clicked;
    try {
      clicked = await preview.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: i =>
          i.user.id === interaction.user.id &&
          [publishId, cancelId].includes(i.customId),
        time: 120_000,
      });
    } catch {
      return submitted.editReply({
        content: 'Preview expired. Run /staffmove again.',
        components: [],
      });
    }

    await clicked.deferUpdate();

    if (clicked.customId === cancelId) {
      return submitted.editReply({
        content: 'Staff update cancelled.',
        embeds: [],
        components: [],
      });
    }

    // Check permissions again at publication time.
    const author = await interaction.guild.members.fetch(
      interaction.user.id
    );

    if (!author.permissions.has(PermissionFlagsBits.Administrator)) {
      return submitted.editReply({
        content: 'You no longer have permission to publish this update.',
        components: [],
      });
    }

    try {
      const channel = await interaction.guild.channels.fetch(CHANNEL_ID);
      const bot = await interaction.guild.members.fetchMe();
      const permissions = channel?.permissionsFor(bot);

      if (
        !channel?.isTextBased() ||
        typeof channel.send !== 'function' ||
        !permissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
        ])
      ) {
        throw new Error('Missing channel or channel permissions');
      }

      embed.setTimestamp();

      const message = await channel.send({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });

      await submitted.editReply({
        content: `✅ Staff update published! [View announcement](${message.url})`,
        embeds: [],
        components: [],
      });
    } catch (error) {
      console.error('Staff movement publication failed:', error);

      await submitted.editReply({
        content:
          'Could not publish. Check that the bot can view the updates ' +
          'channel, send messages, and embed links. Then run /staffmove again.',
        components: [],
      });
    }
  },
};
