import {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder
} from 'discord.js';

const ticketTypes = {
    support_ticket: {
        title: 'Support Ticket',
        label: 'How can we help you?',
        placeholder: 'Describe what you need help with...'
    },

    player_report: {
        title: 'Player Report',
        label: 'Tell us what happened',
        placeholder: 'Who are you reporting and what did they do?'
    },

    bug_report: {
        title: 'Bug Report',
        label: 'Describe the bug',
        placeholder: 'Explain the bug and how it happened...'
    },

    punishment_appeal: {
        title: 'Ban/Mute Appeal',
        label: 'Why should your punishment be appealed?',
        placeholder: 'Explain why you are appealing your ban or mute...'
    }
};

export default {
    name: 'ticket_type',

    async execute(interaction) {
        const ticketType = interaction.values[0];

        const typeData = ticketTypes[ticketType];

        if (!typeData) {
            return interaction.reply({
                content: 'Invalid ticket type.',
                ephemeral: true
            });
        }

        const modal = new ModalBuilder()
            .setCustomId(`create_ticket_modal:${ticketType}`)
            .setTitle(typeData.title);

        const reasonInput = new TextInputBuilder()
            .setCustomId('reason')
            .setLabel(typeData.label)
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(typeData.placeholder)
            .setRequired(true)
            .setMaxLength(1000);

        const row = new ActionRowBuilder()
            .addComponents(reasonInput);

        modal.addComponents(row);

        await interaction.showModal(modal);
    }
};
