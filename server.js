require('dotenv').config();
const express = require('express');
const https = require('https');
const fs = require('fs');
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

// Configuração SSL
const privateKey = fs.readFileSync('localhost+2-key.pem', 'utf8');
const certificate = fs.readFileSync('localhost+2.pem', 'utf8');
const credentials = { key: privateKey, cert: certificate };

// Configurações
const config = {
    messageLimit: 5,
    messageLifetime: 300000, // 5 minutos
    updateInterval: 10000 // 10 segundos
};

// Estado do servidor
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
app.use(express.static(path.join(__dirname, 'public')));

// Controle de mensagens
async function updateMessages() {
    const now = Date.now();
    serverState.recentMessages = serverState.recentMessages
        .filter(msg => now - msg.timestamp < config.messageLifetime)
        .slice(-config.messageLimit);
}

async function updateServerStats() {
    try {
        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        if (!guild) return;

        await guild.members.fetch();

        const newState = {
            members: guild.memberCount,
            bots: guild.members.cache.filter(m => m.user.bot).size,
            channels: guild.channels.cache.size,
            onlineMembers: guild.members.cache
                .filter(m => m.presence?.status === 'online')
                .map(m => ({
                    name: m.displayName || 'Usuário Desconhecido',
                    activity: m.presence?.activities[0]?.name || 'Sem atividade'
                })),
            botStatus: client.user.presence.status,
            recentMessages: serverState.recentMessages
        };

        await mutex.runExclusive(() => {
            serverState = newState;
        });
    } catch (error) {
        console.error('Erro na atualização:', error);
    }
}

// Eventos do Discord
client.on('ready', () => {
    console.log(`✅ Bot conectado como: ${client.user.tag}`);
    setInterval(async () => {
        await mutex.runExclusive(async () => {
            await updateServerStats();
            await updateMessages();
        });
    }, config.updateInterval);
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
app.get('/stats', async (req, res) => {
    const state = await mutex.runExclusive(() => ({ ...serverState }));
    res.json(state);
});

// Iniciar servidor
https.createServer(credentials, app).listen(8888, () => {
    console.log('🌐 Servidor HTTPS rodando em: https://localhost:8888');
});

client.login(process.env.DISCORD_TOKEN);