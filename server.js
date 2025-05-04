require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { Client, GatewayIntentBits } = require('discord.js');
const { Mutex } = require('async-mutex');

const app = express();
const mutex = new Mutex();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Configurações
const config = {
    messageLimit: 1,
    messageLifetime: 300000, // 5 minutos
    updateInterval: 10000 // 10 segundos
};

let serverState = {
    members: 0,
    bots: 0,
    channels: 0,
    onlineMembers: [],
    recentMessages: [],
    botStatus: 'offline'
};

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Atualização de estado
async function updateServerStats() {
    const release = await mutex.acquire();
    try {
        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        if (!guild) return;

        await guild.members.fetch();

        serverState = {
            members: guild.memberCount,
            bots: guild.members.cache.filter(m => m.user.bot).size,
            channels: guild.channels.cache.size,
            onlineMembers: guild.members.cache
                .filter(m => m.presence?.status === 'online')
                .map(m => ({
                    name: m.displayName || 'Usuário Desconhecido',
                    activity: m.presence?.activities[0]?.name || 'Sem atividade'
                })),
            recentMessages: serverState.recentMessages,
            botStatus: client.user.presence.status
        };
    } catch (error) {
        console.error('Erro na atualização:', error);
    } finally {
        release();
    }
}

// Eventos do Discord
client.on('ready', () => {
    console.log(`✅ Bot conectado como: ${client.user.tag}`);
    setInterval(updateServerStats, config.updateInterval);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    await mutex.runExclusive(() => {
        serverState.recentMessages = [
            ...serverState.recentMessages,
            {
                content: message.content.slice(0, 100),
                author: message.member?.displayName || message.author.username,
                channel: message.channel.name,
                emoji: getMessageEmoji(message.content),
                timestamp: Date.now()
            }
        ].slice(-config.messageLimit);
    });
});

function getMessageEmoji(content) {
    if (content.includes('?')) return '🤔';
    if (content.includes('!')) return '🎉';
    if (/http/.test(content)) return '🔗';
    return '💬';
}

// Rotas
app.get('/stats', (req, res) => {
    res.json(serverState);
});

// Iniciar servidor
const PORT = process.env.PORT || 8888;
app.listen(PORT, () => {
    console.log(`🌐 Servidor rodando na porta ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
