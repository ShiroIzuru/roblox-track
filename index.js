require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    PermissionsBitField,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const axios = require("axios");

const PREFIX = "!";
const CHECK_INTERVAL = 10000;

// ==========================================
// DISCORD CLIENT
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ==========================================
// DATA TRACKING
// ==========================================

const trackedPlayers = new Map();

let notificationChannelId = null;
let trackingLoopRunning = false;

// ==========================================
// ROBLOX PRESENCE
// ==========================================

async function getRobloxPresence(userId) {
    try {
        const response = await axios.post(
            "https://presence.roblox.com/v1/presence/users",
            {
                userIds: [Number(userId)]
            },
            {
                headers: {
                    "Content-Type": "application/json"
                },
                timeout: 10000
            }
        );

        if (
            !response.data ||
            !response.data.userPresences ||
            response.data.userPresences.length === 0
        ) {
            return null;
        }

        return response.data.userPresences[0];

    } catch (error) {
        console.error(
            `Gagal mengambil presence Roblox ${userId}:`,
            error.response?.data || error.message
        );

        return null;
    }
}

// ==========================================
// ROBLOX USER
// ==========================================

async function getRobloxUser(userId) {
    try {
        const response = await axios.get(
            `https://users.roblox.com/v1/users/${userId}`,
            {
                timeout: 10000
            }
        );

        return response.data;

    } catch (error) {
        console.error(
            `Gagal mengambil data user ${userId}:`,
            error.response?.data || error.message
        );

        return null;
    }
}

// ==========================================
// ROBLOX GAME
// ==========================================

async function getRobloxGame(universeId) {

    if (!universeId) {
        return null;
    }

    try {

        const response = await axios.get(
            `https://games.roblox.com/v1/games?universeIds=${universeId}`,
            {
                headers: {
                    "Accept": "application/json"
                },
                timeout: 10000
            }
        );

        if (
            !response.data ||
            !response.data.data ||
            response.data.data.length === 0
        ) {
            return null;
        }

        return response.data.data[0];

    } catch (error) {

        console.error(
            `Gagal mengambil informasi game ${universeId}:`,
            error.response?.data || error.message
        );

        return null;
    }
}

// ==========================================
// ROBLOX GAME THUMBNAIL
// ==========================================

async function getRobloxGameThumbnail(universeId) {

    if (!universeId) {
        return null;
    }

    try {

        const response = await axios.get(
            "https://thumbnails.roblox.com/v1/games/multiget/thumbnails",
            {
                params: {
                    universeIds: universeId,
                    countPerUniverse: 1,
                    defaults: true,
                    size: "768x432",
                    format: "Webp",
                    isCircular: false
                },
                timeout: 10000
            }
        );

        if (
            !response.data ||
            !response.data.data ||
            response.data.data.length === 0
        ) {
            return null;
        }

        const gameData = response.data.data[0];

        if (
            !gameData.thumbnails ||
            gameData.thumbnails.length === 0
        ) {
            return null;
        }

        return gameData.thumbnails[0].imageUrl || null;

    } catch (error) {

        console.error(
            `Gagal mengambil thumbnail game ${universeId}:`,
            error.response?.data || error.message
        );

        return null;
    }
}

// ==========================================
// STATUS
// ==========================================

function getStatusName(presenceType) {

    switch (presenceType) {

        case 0:
            return "Offline";

        case 1:
            return "Online";

        case 2:
            return "Playing";

        case 3:
            return "Editing";

        default:
            return "Unknown";
    }
}

// ==========================================
// URL JOIN GAME
// ==========================================

function createJoinUrl(placeId, gameId) {

    if (!placeId) {
        return null;
    }

    /*
        Jika Job ID tersedia,
        Roblox akan mencoba membuka instance tersebut.

        Jika Roblox mengabaikan Job ID,
        setidaknya tetap membuka GAME yang sedang dimainkan.
    */

    let url =
        `https://www.roblox.com/games/start?placeId=${encodeURIComponent(placeId)}`;

    if (gameId) {

        url +=
            `&gameInstanceId=${encodeURIComponent(gameId)}`;
    }

    return url;
}

// ==========================================
// STATUS LENGKAP PLAYER
// ==========================================

async function getFullPlayerStatus(userId) {

    const presence =
        await getRobloxPresence(userId);

    if (!presence) {

        return {
            status: "Unknown",
            presenceType: -1,
            placeId: null,
            universeId: null,
            gameId: null,
            gameName: null,
            thumbnailUrl: null
        };
    }

    let gameName = null;

    let universeId =
        presence.universeId || null;

    let placeId =
        presence.placeId || null;

    let gameId =
        presence.gameId || null;

    let thumbnailUrl = null;

    // ======================================
    // JIKA SEDANG BERMAIN
    // ======================================

    if (
        presence.userPresenceType === 2
    ) {

        // ==================================
        // AMBIL DATA GAME
        // ==================================

        if (universeId) {

            const game =
                await getRobloxGame(universeId);

            if (game) {

                gameName =
                    game.name ||
                    game.displayName ||
                    "Unknown Game";
            }

            // ==================================
            // AMBIL THUMBNAIL GAME
            // ==================================

            thumbnailUrl =
                await getRobloxGameThumbnail(
                    universeId
                );
        }
    }

    return {

        status:
            getStatusName(
                presence.userPresenceType
            ),

        presenceType:
            presence.userPresenceType,

        placeId:
            placeId,

        universeId:
            universeId,

        gameId:
            gameId,

        gameName:
            gameName,

        thumbnailUrl:
            thumbnailUrl,

        lastLocation:
            presence.lastLocation || null
    };
}

// ==========================================
// TRACK PLAYER
// ==========================================

async function trackPlayer(userId) {

    if (trackedPlayers.has(userId)) {

        return {
            success: false,
            message:
                "User tersebut sudah sedang di-track."
        };
    }

    const user =
        await getRobloxUser(userId);

    if (!user) {

        return {
            success: false,
            message:
                "User Roblox tidak ditemukan."
        };
    }

    console.log(
        `Checking Roblox status ${user.name}...`
    );

    const status =
        await getFullPlayerStatus(userId);

    trackedPlayers.set(
        userId,
        {
            userId: userId,

            username:
                user.name,

            displayName:
                user.displayName,

            status:
                status.status,

            placeId:
                status.placeId,

            universeId:
                status.universeId,

            gameId:
                status.gameId,

            gameName:
                status.gameName,

            thumbnailUrl:
                status.thumbnailUrl
        }
    );

    return {

        success: true,

        username:
            user.name,

        displayName:
            user.displayName,

        status:
            status
    };
}

// ==========================================
// UNTRACK
// ==========================================

function untrackPlayer(userId) {

    if (!trackedPlayers.has(userId)) {
        return false;
    }

    trackedPlayers.delete(userId);

    return true;
}

// ==========================================
// CHANNEL NOTIFIKASI
// ==========================================

async function getNotificationChannel() {

    if (!notificationChannelId) {
        return null;
    }

    try {

        const channel =
            await client.channels.fetch(
                notificationChannelId
            );

        return channel;

    } catch (error) {

        console.error(
            "Gagal mendapatkan channel:",
            error.message
        );

        return null;
    }
}

// ==========================================
// NOTIFIKASI
// ==========================================

async function sendStatusNotification(
    player,
    oldStatus,
    newStatus,
    statusData
) {

    const channel =
        await getNotificationChannel();

    if (!channel) {

        console.log(
            "⚠️ Channel notifikasi belum diatur."
        );

        return;
    }

    // ======================================
    // PLAYING
    // ======================================

    if (newStatus === "Playing") {

        const embed =
            new EmbedBuilder()
                .setTitle("🎮 Roblox Player Update")

                .setDescription(
                    `**${player.username}** sedang bermain Roblox!`
                )

                .addFields(

                    {
                        name: "👤 Player",
                        value:
                            `${player.displayName} (@${player.username})`,
                        inline: false
                    },

                    {
                        name: "🟢 Status",
                        value: "Playing",
                        inline: true
                    },

                    {
                        name: "🎮 Game",
                        value:
                            statusData.gameName ||
                            "Unknown Game",
                        inline: true
                    },

                    {
                        name: "🆔 Place ID",
                        value:
                            statusData.placeId
                                ? String(statusData.placeId)
                                : "-",
                        inline: false
                    },

                    {
                        name: "🌐 Universe ID",
                        value:
                            statusData.universeId
                                ? String(statusData.universeId)
                                : "-",
                        inline: false
                    },

                    {
                        name: "🖥️ Job ID",
                        value:
                            statusData.gameId
                                ? String(statusData.gameId)
                                : "-",
                        inline: false
                    },

                    {
                        name: "🔄 Perubahan",
                        value:
                            `${oldStatus} → ${newStatus}`,
                        inline: false
                    }
                )

                .setTimestamp();

        // ==================================
        // GAMBAR GAME
        // ==================================

        if (statusData.thumbnailUrl) {

            embed.setImage(
                statusData.thumbnailUrl
            );

            console.log(
                `🖼️ Thumbnail: ${statusData.thumbnailUrl}`
            );
        }

        // ==================================
        // TOMBOL JOIN GAME
        // ==================================

        const joinUrl =
            createJoinUrl(
                statusData.placeId,
                statusData.gameId
            );

        if (joinUrl) {

            const row =
                new ActionRowBuilder()
                    .addComponents(

                        new ButtonBuilder()
                            .setLabel(
                                "🎮 JOIN GAME"
                            )
                            .setStyle(
                                ButtonStyle.Link
                            )
                            .setURL(
                                joinUrl
                            )
                    );

            await channel.send({

                embeds: [
                    embed
                ],

                components: [
                    row
                ]
            });

            console.log(
                `🎮 Join URL: ${joinUrl}`
            );

            return;
        }

        await channel.send({
            embeds: [
                embed
            ]
        });

        return;
    }

    // ======================================
    // ONLINE
    // ======================================

    if (newStatus === "Online") {

        const embed =
            new EmbedBuilder()

                .setTitle(
                    "🟢 Roblox Player Online"
                )

                .setDescription(
                    `**${player.username}** sekarang online Roblox.`
                )

                .addFields(

                    {
                        name: "👤 Player",
                        value:
                            `${player.displayName} (@${player.username})`,
                        inline: false
                    },

                    {
                        name: "🟢 Status",
                        value: "Online",
                        inline: true
                    },

                    {
                        name: "🔄 Perubahan",
                        value:
                            `${oldStatus} → ${newStatus}`,
                        inline: true
                    }
                )

                .setTimestamp();

        await channel.send({
            embeds: [
                embed
            ]
        });

        return;
    }

    // ======================================
    // OFFLINE
    // ======================================

    if (newStatus === "Offline") {

        const embed =
            new EmbedBuilder()

                .setTitle(
                    "🔴 Roblox Player Offline"
                )

                .setDescription(
                    `**${player.username}** sekarang offline.`
                )

                .addFields(

                    {
                        name: "👤 Player",
                        value:
                            `${player.displayName} (@${player.username})`,
                        inline: false
                    },

                    {
                        name: "🔴 Status",
                        value: "Offline",
                        inline: true
                    },

                    {
                        name: "🔄 Perubahan",
                        value:
                            `${oldStatus} → ${newStatus}`,
                        inline: true
                    }
                )

                .setTimestamp();

        await channel.send({
            embeds: [
                embed
            ]
        });

        return;
    }

    // ======================================
    // EDITING
    // ======================================

    if (newStatus === "Editing") {

        const embed =
            new EmbedBuilder()

                .setTitle(
                    "🛠️ Roblox Studio"
                )

                .setDescription(
                    `**${player.username}** sedang menggunakan Roblox Studio.`
                )

                .addFields(

                    {
                        name: "👤 Player",
                        value:
                            `${player.displayName} (@${player.username})`,
                        inline: false
                    },

                    {
                        name: "🛠️ Status",
                        value: "Editing",
                        inline: true
                    },

                    {
                        name: "🔄 Perubahan",
                        value:
                            `${oldStatus} → ${newStatus}`,
                        inline: true
                    }
                )

                .setTimestamp();

        await channel.send({
            embeds: [
                embed
            ]
        });

        return;
    }
}

// ==========================================
// CHECK SEMUA PLAYER
// ==========================================

async function checkPlayers() {

    if (trackedPlayers.size === 0) {
        return;
    }

    for (
        const [userId, player]
        of trackedPlayers
    ) {

        try {

            const statusData =
                await getFullPlayerStatus(
                    userId
                );

            // ==================================
            // API ERROR
            // ==================================

            if (
                !statusData ||
                statusData.status === "Unknown"
            ) {

                console.log(
                    `[TRACK] ${player.username}: API tidak memberikan status`
                );

                continue;
            }

            const oldStatus =
                player.status;

            const newStatus =
                statusData.status;

            console.log(
                `[TRACK] ${player.username}: ${oldStatus} -> ${newStatus}` +
                (
                    statusData.gameName
                        ? ` | Game: ${statusData.gameName}`
                        : ""
                )
            );

            // ==================================
            // CEK PERUBAHAN STATUS
            // ==================================

            const statusChanged =
                oldStatus !== newStatus;

            // ==================================
            // CEK PERUBAHAN GAME
            // ==================================

            const gameChanged =
                newStatus === "Playing" &&
                (
                    player.placeId !==
                        statusData.placeId ||

                    player.universeId !==
                        statusData.universeId ||

                    player.gameId !==
                        statusData.gameId ||

                    player.gameName !==
                        statusData.gameName
                );

            // ==================================
            // SIMPAN DATA LAMA
            // ==================================

            const previousGameName =
                player.gameName;

            const previousThumbnail =
                player.thumbnailUrl;

            // ==================================
            // UPDATE PLAYER
            // ==================================

            player.status =
                newStatus;

            player.placeId =
                statusData.placeId;

            player.universeId =
                statusData.universeId;

            player.gameId =
                statusData.gameId;

            player.gameName =
                statusData.gameName ||
                (
                    newStatus === "Playing"
                        ? previousGameName
                        : null
                );

            player.thumbnailUrl =
                statusData.thumbnailUrl ||
                (
                    newStatus === "Playing"
                        ? previousThumbnail
                        : null
                );

            // ==================================
            // KIRIM NOTIFIKASI
            // ==================================

            if (
                statusChanged ||
                gameChanged
            ) {

                await sendStatusNotification(
                    player,
                    oldStatus,
                    newStatus,
                    {
                        ...statusData,

                        gameName:
                            statusData.gameName ||
                            player.gameName,

                        thumbnailUrl:
                            statusData.thumbnailUrl ||
                            player.thumbnailUrl
                    }
                );
            }

        } catch (error) {

            console.error(
                `Error tracking ${player.username}:`,
                error.message
            );
        }
    }
}

// ==========================================
// TRACKING LOOP
// ==========================================

async function startTrackingLoop() {

    if (trackingLoopRunning) {
        return;
    }

    trackingLoopRunning = true;

    console.log(
        "🔄 Tracking loop dimulai."
    );

    while (trackingLoopRunning) {

        try {

            await checkPlayers();

        } catch (error) {

            console.error(
                "Tracking loop error:",
                error
            );
        }

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    CHECK_INTERVAL
                )
        );
    }
}

// ==========================================
// LIST TRACK
// ==========================================

function listTracked() {

    if (trackedPlayers.size === 0) {

        return "📭 Tidak ada player yang sedang di-track.";
    }

    let text =
        "🎮 **Player yang sedang di-track:**\n\n";

    for (
        const player
        of trackedPlayers.values()
    ) {

        text +=

            `👤 **${player.username}**\n` +

            `🆔 ID: \`${player.userId}\`\n` +

            `📡 Status: **${player.status}**\n`;

        if (
            player.status === "Playing"
        ) {

            text +=

                `🎮 Game: **${player.gameName || "Unknown"}**\n` +

                `🆔 Place ID: \`${player.placeId || "-"}\`\n` +

                `🌐 Universe ID: \`${player.universeId || "-"}\`\n` +

                `🖥️ Job ID: \`${player.gameId || "-"}\`\n`;
        }

        text += "\n";
    }

    return text;
}

// ==========================================
// HELP
// ==========================================

function showHelp() {

    return `

🎮 **ROBLOX TRACKER BOT**

**Command:**

\`!track USER_ID\`
→ Mulai tracking player Roblox

\`!untrack USER_ID\`
→ Hentikan tracking

\`!listtrack\`
→ Lihat player yang sedang di-track

\`!setchannel\`
→ Jadikan channel saat ini sebagai channel notifikasi

\`!help\`
→ Menampilkan bantuan

**Contoh:**

\`!track 123456789\`

Bot akan otomatis mengecek status setiap **10 detik**.

Jika player sedang bermain:
🎮 Nama Game
🆔 Place ID
🌐 Universe ID
🖥️ Job ID
🖼️ Thumbnail Game
🎮 Tombol JOIN GAME

`;
}

// ==========================================
// MESSAGE HANDLER
// ==========================================

client.on(
    "messageCreate",
    async (message) => {

        if (message.author.bot) {
            return;
        }

        if (
            !message.content.startsWith(PREFIX)
        ) {
            return;
        }

        const args =
            message.content
                .slice(PREFIX.length)
                .trim()
                .split(/\s+/);

        const command =
            args.shift().toLowerCase();

        // ==============================
        // HELP
        // ==============================

        if (command === "help") {

            return message.reply(
                showHelp()
            );
        }

        // ==============================
        // TRACK
        // ==============================

        if (command === "track") {

            const userId =
                args[0];

            if (!userId) {

                return message.reply(
                    "❌ Masukkan Roblox User ID.\n\n" +
                    "Contoh: `!track 123456789`"
                );
            }

            if (!/^\d+$/.test(userId)) {

                return message.reply(
                    "❌ User ID Roblox harus berupa angka."
                );
            }

            await message.reply(
                "🔍 Mengambil data Roblox..."
            );

            const result =
                await trackPlayer(
                    userId
                );

            if (!result.success) {

                return message.reply(
                    `❌ ${result.message}`
                );
            }

            const status =
                result.status;

            let response =

                `🎮 **${result.username} berhasil di-track!**\n\n` +

                `👤 Player: **${result.displayName} (@${result.username})**\n` +

                `📡 Status: **${status.status}**\n`;

            if (
                status.status === "Playing"
            ) {

                response +=

                    `\n🎮 **Game:** ${status.gameName || "Unknown Game"}\n` +

                    `🆔 **Place ID:** \`${status.placeId || "-"}\`\n` +

                    `🌐 **Universe ID:** \`${status.universeId || "-"}\`\n` +

                    `🖥️ **Job ID:** \`${status.gameId || "-"}\`\n` +

                    `🖼️ **Thumbnail:** ${status.thumbnailUrl ? "Tersedia" : "Tidak tersedia"}\n`;
            }

            response +=
                `\n🔄 Tracking otomatis setiap **10 detik**.`;

            return message.reply(
                response
            );
        }

        // ==============================
        // UNTRACK
        // ==============================

        if (command === "untrack") {

            const userId =
                args[0];

            if (!userId) {

                return message.reply(
                    "❌ Masukkan Roblox User ID."
                );
            }

            const removed =
                untrackPlayer(
                    userId
                );

            if (!removed) {

                return message.reply(
                    "❌ User tersebut tidak sedang di-track."
                );
            }

            return message.reply(
                `✅ User \`${userId}\` berhasil dihentikan tracking.`
            );
        }

        // ==============================
        // LIST TRACK
        // ==============================

        if (
            command === "listtrack"
        ) {

            return message.reply(
                listTracked()
            );
        }

        // ==============================
        // SET CHANNEL
        // ==============================

        if (
            command === "setchannel"
        ) {

            if (
                !message.member.permissions.has(
                    PermissionsBitField.Flags.ManageChannels
                )
            ) {

                return message.reply(
                    "❌ Kamu membutuhkan permission **Manage Channels**."
                );
            }

            notificationChannelId =
                message.channel.id;

            return message.reply(
                "✅ Channel ini sekarang menjadi channel notifikasi tracking Roblox."
            );
        }
    }
);

// ==========================================
// BOT READY
// ==========================================

client.once(
    "ready",
    async () => {

        console.log(
            "================================="
        );

        console.log(
            "BOT ONLINE"
        );

        console.log(
            `Login sebagai: ${client.user.tag}`
        );

        console.log(
            "================================="
        );

        console.log(
            `Tracking interval: ${CHECK_INTERVAL / 1000} detik`
        );

        await startTrackingLoop();
    }
);

// ==========================================
// ERROR HANDLER
// ==========================================

process.on(
    "unhandledRejection",
    (error) => {

        console.error(
            "Unhandled Promise Rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    (error) => {

        console.error(
            "Uncaught Exception:",
            error
        );
    }
);

// ==========================================
// LOGIN
// ==========================================

if (
    !process.env.DISCORD_TOKEN
) {

    console.error(
        "❌ DISCORD_TOKEN tidak ditemukan di file .env"
    );

    process.exit(1);
}

client.login(
    process.env.DISCORD_TOKEN
);