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

const LETTERS = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ',
  f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ',
  k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ',
  p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ',
  u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ',
  z: 'ᴢ',
};

function smallCaps(text) {
  return [...text]
    .map(letter => LETTERS[letter.toLowerCase()] ?? letter)
    .join('');
}

function fieldText(text) {
  const escaped = escapeMarkdown(text);

  return escaped.length > 1000
    ? `${escaped.slice(0, 999)}…`
    : escaped;
}

const TYPES = {
  promotion: {
    title: '↗ ꜱᴛᴀꜰꜰ ᴘʀᴏᴍᴏᴛɪᴏɴ',
    color: 0x00fc88,
    description: member =>
      `${member} ʜᴀꜱ ʙᴇᴇɴ ᴘʀᴏᴍᴏᴛᴇᴅ!\n` +
      'ᴛʜᴀɴᴋ ʏᴏᴜ ꜰᴏʀ ʏᴏᴜʀ ʜᴀʀᴅ ᴡᴏʀᴋ ᴀɴᴅ ᴅᴇᴅɪᴄᴀᴛɪᴏɴ.',
  },
  demotion: {
    title: '↘ ꜱᴛᴀꜰꜰ ᴅᴇᴍᴏᴛɪᴏɴ',
    color: 0xf87171,
    description: member =>
      `${member}'ꜱ ꜱᴛᴀꜰꜰ ʀᴀɴᴋ ʜᴀꜱ ʙᴇᴇɴ ᴜᴘᴅᴀᴛᴇᴅ.\n` +
      'ᴛʜᴇ ᴅᴇᴛᴀɪʟꜱ ᴏꜰ ᴛʜɪꜱ ᴄʜᴀɴɢᴇ ᴀʀᴇ ʟɪꜱᴛᴇᴅ ʙᴇʟᴏᴡ.',
  },
  joining: {
    title: '🌴 ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴛʜᴇ ᴛᴇᴀᴍ',
    color: 0x38bdf8,
    description: member =>
      `${member} ʜᴀꜱ ᴊᴏɪɴᴇᴅ ᴏᴜʀ ꜱᴛᴀꜰꜰ ᴛᴇᴀᴍ!\n` +
      'ᴡᴇ’ʀᴇ ᴇxᴄɪᴛᴇᴅ ᴛᴏ ʜᴀᴠᴇ ʏᴏᴜ ᴡɪᴛʜ ᴜꜱ.',
  },
  departure: {
    title: '👋 ꜱᴛᴀꜰꜰ ᴅᴇᴘᴀʀᴛᴜʀᴇ',
    color: 0x94a3b8,
    description: member =>
      `${member} ʜᴀꜱ ʟᴇꜰᴛ ᴏᴜʀ ꜱᴛᴀꜰꜰ ᴛᴇᴀᴍ.\n` +
      'ᴛʜᴀɴᴋ ʏᴏᴜ ꜰᴏʀ ʏᴏᴜʀ ᴛɪᴍᴇ ᴀɴᴅ ᴄᴏɴᴛʀɪʙᴜᴛɪᴏɴꜱ.',
  },
};

export default {
  data: new SlashCommandBuilder()
    .setName('staffmove')
    .setDescription('Create a Tropical SMP staff movement announcement')
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

    // No ":" in IDs so your global handler leaves these
    // interactions to this command's collectors.
    const modalId = `staffmove_reason_${interaction.id}`;
    const publishId = `staffmove_publish_${interaction.id}`;
    const cancelId = `staffmove_cancel_${interaction.id}`;

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Reason for this staff movement')
      .setPlaceholder('Explain the reason for this update...')
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

    const guildIcon = interaction.guild.iconURL({ size: 256 });

    // Match the embed accent to the destination rank.
    const rankColor = next.color || previous.color || style.color;

    const embed = new EmbedBuilder()
      .setColor(rankColor)
      .setAuthor({
        name: 'ᴛʀᴏᴘɪᴄᴀʟ ꜱᴍᴘ • ꜱᴛᴀꜰꜰ ᴜᴘᴅᴀᴛᴇꜱ',
        ...(guildIcon ? { iconURL: guildIcon } : {}),
      })
      .setTitle(style.title)
      .setDescription(style.description(`<@${member.id}>`))
      .setThumbnail(member.displayAvatarURL({ size: 256 }))
      .addFields(
        {
          name: '👤 ꜱᴛᴀꜰꜰ ᴍᴇᴍʙᴇʀ',
          value: `<@${member.id}>`,
          inline: false,
        },
        {
          name: '📋 ᴘʀᴇᴠɪᴏᴜꜱ ʀᴀɴᴋ',
          value:
            `<@&${previous.id}>\n` +
            `**${fieldText(smallCaps(previous.name))}**`,
          inline: true,
        },
        {
          name: '✨ ɴᴇᴡ ʀᴀɴᴋ',
          value:
            `<@&${next.id}>\n` +
            `**${fieldText(smallCaps(next.name))}**`,
          inline: true,
        },
        {
          name: '📝 ʀᴇᴀꜱᴏɴ ꜰᴏʀ ᴛʜɪꜱ ᴜᴘᴅᴀᴛᴇ',
          value: fieldText(reason),
          inline: false,
        },
        {
          name: '🛡️ ᴜᴘᴅᴀᴛᴇᴅ ʙʏ',
          value: `<@${interaction.user.id}>`,
          inline: true,
        },
        {
          name: '🕒 ᴅᴀᴛᴇ',
          value: `<t:${Math.floor(Date.now() / 1000)}:f>`,
          inline: true,
        }
      )
      .setFooter({
        text: 'ᴛʀᴏᴘɪᴄᴀʟ ꜱᴍᴘ • ᴏꜰꜰɪᴄɪᴀʟ ᴛᴇᴀᴍ ᴜᴘᴅᴀᴛᴇ',
        ...(guildIcon ? { iconURL: guildIcon } : {}),
      })
      .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(publishId)
        .setLabel('ᴘᴜʙʟɪꜱʜ ᴜᴘᴅᴀᴛᴇ')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel('ᴄᴀɴᴄᴇʟ')
        .setStyle(ButtonStyle.Secondary)
    );

    const preview = await submitted.editReply({
      content:
        `**ᴘʀᴇᴠɪᴇᴡ**\n` +
        `ᴛʜɪꜱ ᴜᴘᴅᴀᴛᴇ ᴡɪʟʟ ʙᴇ ᴘᴏꜱᴛᴇᴅ ɪɴ <#${CHANNEL_ID}>.`,
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
        content: 'ᴘʀᴇᴠɪᴇᴡ ᴇxᴘɪʀᴇᴅ. Run /staffmove again.',
        embeds: [],
        components: [],
      });
    }

    await clicked.deferUpdate();

    if (clicked.customId === cancelId) {
      return submitted.editReply({
        content: 'ꜱᴛᴀꜰꜰ ᴜᴘᴅᴀᴛᴇ ᴄᴀɴᴄᴇʟʟᴇᴅ.',
        embeds: [],
        components: [],
      });
    }

    let message;

    try {
      const author = await interaction.guild.members.fetch({
        user: interaction.user.id,
        force: true,
      });

      if (!author.permissions.has(PermissionFlagsBits.Administrator)) {
        return submitted.editReply({
          content: 'You no longer have permission to publish this update.',
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

      const publishedAt = new Date();

      embed.setTimestamp(publishedAt);
      embed.spliceFields(5, 1, {
        name: '🕒 ᴅᴀᴛᴇ',
        value: `<t:${Math.floor(publishedAt.getTime() / 1000)}:f>`,
        inline: true,
      });

      message = await channel.send({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('Staff movement publication failed:', error);

      return submitted.editReply({
        content:
          'Could not publish. Check the channel ID and the bot’s ' +
          'View Channel, Send Messages, and Embed Links permissions. ' +
          'Then run /staffmove again.',
        embeds: [],
        components: [],
      });
    }

    try {
      await submitted.editReply({
        content:
          `✅ **ꜱᴛᴀꜰꜰ ᴜᴘᴅᴀᴛᴇ ᴘᴜʙʟɪꜱʜᴇᴅ!**\n` +
          `[View announcement](${message.url})`,
        embeds: [],
        components: [],
      });
    } catch (error) {
      console.error(
        'Staff update was published, but confirmation failed:',
        error
      );
    }
  },
};
