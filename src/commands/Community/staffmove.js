    const guildIcon = interaction.guild.iconURL({ size: 256 });

    const smallCaps = text => {
      const letters = {
        a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ',
        f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ',
        k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ',
        p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ',
        u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ',
        z: 'ᴢ',
      };

      return [...text]
        .map(letter => letters[letter.toLowerCase()] ?? letter)
        .join('');
    };

    const headings = {
      promotion: '↗ ꜱᴛᴀꜰꜰ ᴘʀᴏᴍᴏᴛɪᴏɴ',
      demotion: '↘ ꜱᴛᴀꜰꜰ ᴅᴇᴍᴏᴛɪᴏɴ',
      joining: '🌴 ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴛʜᴇ ᴛᴇᴀᴍ',
      departure: '👋 ꜱᴛᴀꜰꜰ ᴅᴇᴘᴀʀᴛᴜʀᴇ',
    };

    const descriptions = {
      promotion:
        `<@${member.id}> ʜᴀꜱ ʙᴇᴇɴ ᴘʀᴏᴍᴏᴛᴇᴅ!\n` +
        'ᴛʜᴀɴᴋ ʏᴏᴜ ꜰᴏʀ ʏᴏᴜʀ ʜᴀʀᴅ ᴡᴏʀᴋ ᴀɴᴅ ᴅᴇᴅɪᴄᴀᴛɪᴏɴ.',

      demotion:
        `<@${member.id}>'ꜱ ꜱᴛᴀꜰꜰ ʀᴀɴᴋ ʜᴀꜱ ʙᴇᴇɴ ᴜᴘᴅᴀᴛᴇᴅ.\n` +
        'ᴛʜᴇ ᴅᴇᴛᴀɪʟꜱ ᴏꜰ ᴛʜɪꜱ ᴄʜᴀɴɢᴇ ᴀʀᴇ ʟɪꜱᴛᴇᴅ ʙᴇʟᴏᴡ.',

      joining:
        `<@${member.id}> ʜᴀꜱ ᴊᴏɪɴᴇᴅ ᴏᴜʀ ꜱᴛᴀꜰꜰ ᴛᴇᴀᴍ!\n` +
        'ᴡᴇ’ʀᴇ ᴇxᴄɪᴛᴇᴅ ᴛᴏ ʜᴀᴠᴇ ʏᴏᴜ ᴡɪᴛʜ ᴜꜱ.',

      departure:
        `<@${member.id}> ʜᴀꜱ ʟᴇꜰᴛ ᴏᴜʀ ꜱᴛᴀꜰꜰ ᴛᴇᴀᴍ.\n` +
        'ᴛʜᴀɴᴋ ʏᴏᴜ ꜰᴏʀ ʏᴏᴜʀ ᴛɪᴍᴇ ᴀɴᴅ ᴄᴏɴᴛʀɪʙᴜᴛɪᴏɴꜱ.',
    };

    // Use the destination rank's color, then the previous rank's
    // color if the destination rank has no color configured.
    const rankColor = next.color || previous.color || style.color;

    const embed = new EmbedBuilder()
      .setColor(rankColor)
      .setAuthor({
        name: 'ᴛʀᴏᴘɪᴄᴀʟ ꜱᴍᴘ • ꜱᴛᴀꜰꜰ ᴜᴘᴅᴀᴛᴇꜱ',
        ...(guildIcon ? { iconURL: guildIcon } : {}),
      })
      .setTitle(headings[type])
      .setDescription(descriptions[type])
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
            `-# ${escapeMarkdown(smallCaps(previous.name))}`,
          inline: true,
        },
        {
          name: '✨ ɴᴇᴡ ʀᴀɴᴋ',
          value:
            `<@&${next.id}>\n` +
            `-# ${escapeMarkdown(smallCaps(next.name))}`,
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
          inline: false,
        }
      )
      .setFooter({
        text: 'ᴛʀᴏᴘɪᴄᴀʟ ꜱᴍᴘ • ᴏꜰꜰɪᴄɪᴀʟ ᴛᴇᴀᴍ ᴜᴘᴅᴀᴛᴇ',
        ...(guildIcon ? { iconURL: guildIcon } : {}),
      })
      .setTimestamp();
