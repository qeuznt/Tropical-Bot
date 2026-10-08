import 'dotenv/config';
import { createConnection } from 'node:net';
import { resolveSrv } from 'node:dns/promises';
import {
  Client,
  Collection,
  GatewayIntentBits,
  EmbedBuilder,
} from 'discord.js';
import { REST } from '@discordjs/rest';
import express from 'express';
import cron from 'node-cron';

import config from './config/application.js';
import { initializeDatabase } from './utils/database.js';
import {
  getServerCounters,
  saveServerCounters,
  updateCounter,
} from './services/serverstatsService.js';
import {
  logger,
  startupLog,
  shutdownLog,
} from './utils/logger.js';
import { checkBirthdays } from './services/birthdayService.js';
import { checkGiveaways } from './services/giveawayService.js';
import {
  loadCommands,
  registerCommands as registerSlashCommands,
} from './handlers/loaders/commandLoader.js';
import {
  runSafeTask,
  handleTaskError,
  ErrorCodes,
} from './utils/errorHandler.js';
import { initializeMusic } from './services/music/riffySetup.js';
import { shutdownMusic } from './services/music/playerHandler.js';
import pkg from '../package.json' with { type: 'json' };
import {
  EXPECTED_SCHEMA_VERSION,
  EXPECTED_SCHEMA_LABEL,
} from './config/database/schemaVersion.js';

// ============================================================
// TROPICAL SMP SERVER STATUS
// ============================================================

// 10 October 2026, 10:55 AM Europe/Berlin (UTC+02:00).
const STATUS_START_AT = Date.parse('2026-10-10T10:55:00+02:00');
const RESTART_GRACE_MS = 180000;

const STATUS_CHANNEL_ID = '1528844537051611349';
const STATUS_HOST = process.env.MC_HOST || 'tropicalsmp.noob.club';

// If MC_PORT is not provided, the monitor checks the domain's
// Minecraft SRV record to find the actual Java server port.
const STATUS_PORT = Number(process.env.MC_PORT || 25565);

const STATUS_LABELS = {
  online: {
    title: '🟢 ꜱᴇʀᴠᴇʀ ᴏɴʟɪɴᴇ',
    color: 0x00fc88,
    text:
      'ᴛʀᴏᴘɪᴄᴀʟ ꜱᴍᴘ ɪꜱ ᴏɴʟɪɴᴇ!\n' +
      'ʏᴏᴜ ᴄᴀɴ ᴊᴏɪɴ ᴛʜᴇ ꜱᴇʀᴠᴇʀ ᴀɢᴀɪɴ.',
  },

  maintenance: {
    title: '🟠 ꜱᴇʀᴠᴇʀ ᴍᴀɪɴᴛᴇɴᴀɴᴄᴇ',
    color: 0xffa726,
    text:
      'ᴛʀᴏᴘɪᴄᴀʟ ꜱᴍᴘ ɪꜱ ᴜɴᴅᴇʀ ᴍᴀɪɴᴛᴇɴᴀɴᴄᴇ.\n' +
      'ᴘʟᴀʏᴇʀ ᴀᴄᴄᴇꜱꜱ ɪꜱ ᴄᴜʀʀᴇɴᴛʟʏ ʟɪᴍɪᴛᴇᴅ. ' +
      'ᴡᴇ’ʟʟ ʙᴇ ʙᴀᴄᴋ ꜱᴏᴏɴ!',
  },

  restarting: {
    title: '🔄 ꜱᴇʀᴠᴇʀ ʀᴇꜱᴛᴀʀᴛɪɴɢ',
    color: 0xfee75c,
    text:
      'ᴛʀᴏᴘɪᴄᴀʟ ꜱᴍᴘ ɪꜱ ʀᴇꜱᴛᴀʀᴛɪɴɢ.\n' +
      'ᴘʟᴇᴀꜱᴇ ᴡᴀɪᴛ — ᴡᴇ’ʟʟ ᴘᴏꜱᴛ ᴀɴ ᴜᴘᴅᴀᴛᴇ ᴡʜᴇɴ ɪᴛ’ꜱ ʙᴀᴄᴋ!',
  },

  offline: {
    title: '🔴 ꜱᴇʀᴠᴇʀ ᴏꜰꜰʟɪɴᴇ',
    color: 0xed4245,
    text:
      'ᴛʀᴏᴘɪᴄᴀʟ ꜱᴍᴘ ɪꜱ ᴄᴜʀʀᴇɴᴛʟʏ ᴜɴʀᴇᴀᴄʜᴀʙʟᴇ.\n' +
      'ᴡᴇ’ʟʟ ᴘᴏꜱᴛ ᴀɴ ᴜᴘᴅᴀᴛᴇ ᴡʜᴇɴ ɪᴛ ʀᴇᴛᴜʀɴꜱ.',
  },
};

function encodeVarInt(value) {
  const bytes = [];

  do {
    let byte = value & 0x7f;
    value >>>= 7;

    if (value) byte |= 0x80;

    bytes.push(byte);
  } while (value);

  return Buffer.from(bytes);
}

function decodeVarInt(buffer, offset = 0) {
  let value = 0;

  for (let i = 0; i < 5; i++) {
    if (offset + i >= buffer.length) return null;

    const byte = buffer[offset + i];
    value |= (byte & 0x7f) << (7 * i);

    if (!(byte & 0x80)) {
      return {
        value,
        bytes: i + 1,
      };
    }
  }

  throw new Error('Invalid Minecraft VarInt');
}

function packet(body) {
  return Buffer.concat([
    encodeVarInt(body.length),
    body,
  ]);
}

async function pingMinecraft() {
  if (
    !Number.isInteger(STATUS_PORT) ||
    STATUS_PORT < 1 ||
    STATUS_PORT > 65535
  ) {
    throw new Error('Invalid MC_PORT');
  }

  return new Promise((resolve, reject) => {
    let socket;
    let finished = false;

    const finish = (error, result) => {
      if (finished) return;

      finished = true;
      clearTimeout(deadline);
      socket?.destroy();

      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };

    // Covers DNS, connecting, and reading the status response.
    const deadline = setTimeout(() => {
      finish(new Error('Minecraft ping timed out'));
    }, 8000);

    (async () => {
      let host = STATUS_HOST;
      let port = STATUS_PORT;

      if (!process.env.MC_PORT) {
        try {
          const records = await resolveSrv(
            `_minecraft._tcp.${STATUS_HOST}`
          );

          const record = records.sort(
            (a, b) => a.priority - b.priority
          )[0];

          if (record) {
            host = record.name;
            port = record.port;
          }
        } catch (error) {
          if (
            !['ENODATA', 'ENOTFOUND'].includes(error.code)
          ) {
            throw error;
          }
        }
      }

      if (finished) return;

      const address = Buffer.from(STATUS_HOST, 'utf8');
      const portBytes = Buffer.alloc(2);

      portBytes.writeUInt16BE(port);

      const handshake = Buffer.concat([
        encodeVarInt(0),
        encodeVarInt(767),
        encodeVarInt(address.length),
        address,
        portBytes,
        encodeVarInt(1),
      ]);

      let buffer = Buffer.alloc(0);

      socket = createConnection({ host, port });

      socket.once('connect', () => {
        socket.write(
          Buffer.concat([
            packet(handshake),
            packet(encodeVarInt(0)),
          ])
        );
      });

      socket.on('data', chunk => {
        try {
          buffer = Buffer.concat([buffer, chunk]);

          if (buffer.length > 1048576) {
            throw new Error('Minecraft response too large');
          }

          const length = decodeVarInt(buffer);

          if (!length) return;

          if (
            length.value < 0 ||
            length.value > 1048576
          ) {
            throw new Error('Invalid packet size');
          }

          if (
            buffer.length < length.bytes + length.value
          ) {
            return;
          }

          const body = buffer.subarray(
            length.bytes,
            length.bytes + length.value
          );

          const id = decodeVarInt(body);

          if (!id || id.value !== 0) {
            throw new Error('Invalid status packet');
          }

          const jsonLength = decodeVarInt(
            body,
            id.bytes
          );

          if (!jsonLength || jsonLength.value < 0) {
            throw new Error('Invalid status JSON');
          }

          const start = id.bytes + jsonLength.bytes;

          if (
            start + jsonLength.value !== body.length
          ) {
            throw new Error('Invalid JSON size');
          }

          const result = JSON.parse(
            body.subarray(start).toString('utf8')
          );

          if (
            !result ||
            typeof result !== 'object' ||
            !result.version ||
            !result.players
          ) {
            throw new Error(
              'Invalid Minecraft status response'
            );
          }

          finish(null, result);
        } catch (error) {
          finish(error);
        }
      });

      socket.once('error', error => {
        finish(error);
      });

      socket.once('close', () => {
        finish(
          new Error('Minecraft connection closed')
        );
      });
    })().catch(error => {
      finish(error);
    });
  });
}

function componentText(component) {
  if (typeof component === 'string') {
    return component;
  }

  if (Array.isArray(component)) {
    return component.map(componentText).join('');
  }

  if (
    !component ||
    typeof component !== 'object'
  ) {
    return '';
  }

  return (
    (component.text || '') +
    componentText(component.extra || [])
  );
}

function startMinecraftMonitor(client) {
  let stopped = false;
  let timer;
  let lastAnnounced;
  let historyLoaded = false;
  let candidate;
  let consecutive = 0;
  let restartUntil = 0;

  const footer = state =>
    `ᴛʀᴏᴘɪᴄᴀʟ ꜱᴍᴘ • ꜱᴇʀᴠᴇʀ ꜱᴛᴀᴛᴜꜱ | ${state}`;

  async function check() {
    try {
      if (!client.isReady() || stopped) return;
      // No checks, channel access, or messages before the launch gate.
      if (Date.now() < STATUS_START_AT) return;

      let result;
      let state;

      try {
        result = await pingMinecraft();

        const motd = componentText(
          result.description
        ).replace(/§[0-9a-fk-or]/gi, '');

        // A failed ping alone cannot prove that a server is restarting.
        // Set the MOTD to contain 'restarting' before a planned restart.
        if (/\brestarting\b|\bserver restart\b/i.test(motd)) {
          state = 'restarting';
          restartUntil = Date.now() + RESTART_GRACE_MS;
        } else {
          state = /currently under maintenance/i.test(motd)
            ? 'maintenance'
            : 'online';
          restartUntil = 0;
        }
      } catch (error) {
        state = Date.now() < restartUntil ? 'restarting' : 'offline';

        logger.warn(
          `Minecraft status check failed: ${error.message}`
        );
      }

      if (stopped) return;

      if (state === candidate) {
        consecutive++;
      } else {
        candidate = state;
        consecutive = 1;
      }

      // Confirm outages with three checks.
      // Confirm online/maintenance with two checks.
      const requiredChecks = state === 'offline' ? 3 : 2;

      if (consecutive < requiredChecks) return;

      const channel = await client.channels.fetch(
        STATUS_CHANNEL_ID
      );

      if (
        !channel?.isTextBased() ||
        typeof channel.send !== 'function'
      ) {
        throw new Error(
          'Status channel is unavailable'
        );
      }

      if (!historyLoaded) {
        // Requires Read Message History.
        // Restore the last announced status after a redeploy.
        const messages = await channel.messages.fetch({
          limit: 100,
        });

        const previous = messages.find(message =>
          message.createdTimestamp >= STATUS_START_AT &&
          message.author.id === client.user.id &&
          message.embeds.some(embed =>
            Object.keys(STATUS_LABELS).some(
              key => embed.footer?.text === footer(key)
            )
          )
        );

        if (previous) {
          lastAnnounced = Object.keys(
            STATUS_LABELS
          ).find(key =>
            previous.embeds.some(
              embed => embed.footer?.text === footer(key)
            )
          );
        }

        historyLoaded = true;
      }

      if (
        lastAnnounced === state ||
        stopped ||
        Date.now() < STATUS_START_AT
      ) {
        return;
      }

      const style = STATUS_LABELS[state];

      const icon = channel.guild.iconURL({
        size: 256,
      });

      const embed = new EmbedBuilder()
        .setAuthor({
          name: 'ᴛʀᴏᴘɪᴄᴀʟ ꜱᴍᴘ • ꜱᴇʀᴠᴇʀ ᴜᴘᴅᴀᴛᴇ',
          ...(icon ? { iconURL: icon } : {}),
        })
        .setTitle(style.title)
        .setColor(style.color)
        .setDescription(style.text)
        .addFields({
          name: '🌴 ꜱᴇʀᴠᴇʀ ᴀᴅᴅʀᴇꜱꜱ',
          value: '`tropicalsmp.noob.club`',
        })
        .setFooter({
          text: footer(state),
        })
        .setTimestamp();

      if (icon) {
        embed.setThumbnail(icon);
      }

      if (
        state === 'online' &&
        Number.isInteger(result?.players?.online) &&
        result.players.online >= 0
      ) {
        embed.addFields({
          name: '👥 ᴘʟᴀʏᴇʀꜱ ᴏɴʟɪɴᴇ',
          value: String(result.players.online),
          inline: true,
        });
      }

      await channel.send({
        embeds: [embed],
        allowedMentions: {
          parse: [],
        },
      });

      lastAnnounced = state;

      logger.info(
        `Minecraft status announced: ${state}`
      );
    } catch (error) {
      logger.error(
        'Minecraft status monitor error:',
        error
      );
    } finally {
      // Schedule after completion to prevent overlapping checks.
      if (!stopped) {
        const untilStart = STATUS_START_AT - Date.now();
        timer = setTimeout(check, untilStart > 0
          ? Math.min(untilStart, 15000)
          : 15000);
      }
    }
  }

  void check();

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

// ============================================================
// EXISTING BOT
// ============================================================

class TitanBot extends Client {
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildBans,
      ],
    });

    this.config = config;
    this.commands = new Collection();
    this.events = new Collection();
    this.buttons = new Collection();
    this.selectMenus = new Collection();
    this.modals = new Collection();
    this.cooldowns = new Collection();
    this.db = null;

    this.rest = new REST({
      version: '10',
    }).setToken(config.bot.token);
  }

  async start() {
    try {
      startupLog('Starting TitanBot...');

      await new Promise(resolve =>
        setTimeout(resolve, 1000)
      );

      startupLog('Initializing database...');

      const dbInstance = await initializeDatabase();
      this.db = dbInstance.db;

      const dbStatus = this.db.getStatus();

      if (dbStatus.isDegraded) {
        logger.warn(
          'DATABASE RUNNING IN DEGRADED MODE'
        );
        logger.warn(
          'PostgreSQL unavailable: using in-memory storage.'
        );
        logger.warn(
          'Data persistence is disabled; data is lost on restart.'
        );
        logger.warn(
          'Fix PostgreSQL and restart the bot to restore persistence.'
        );
      } else {
        startupLog(
          `✅ Database Status: ${dbStatus.connectionType} (fully operational)`
        );
      }

      startupLog('Starting web server...');
      this.startWebServer();

      startupLog('Loading commands...');
      await loadCommands(this);

      startupLog(
        `Commands loaded: ${this.commands.size}`
      );

      startupLog('Loading handlers...');
      await this.loadHandlers();

      startupLog('Handlers loaded');

      initializeMusic(this);

      startupLog('Logging into Discord...');
      await this.login(this.config.bot.token);

      startupLog('Discord login successful');

      startupLog(
        'Registering slash commands globally...'
      );

      await this.registerCommands();

      startupLog(
        'Slash commands registration complete'
      );

      const databaseMode = dbStatus.isDegraded
        ? 'Optional in-memory mode (data resets after restart)'
        : 'Connected (persistent data enabled)';

      const handlerSummary =
        `${this.buttons.size} buttons, ` +
        `${this.selectMenus.size} menus, ` +
        `${this.modals.size} modals`;

      startupLog(
        `ONLINE ✅ | ${this.commands.size} commands loaded | ` +
        `${handlerSummary} | Database: ${databaseMode}`
      );

      this.setupCronJobs();

      this.stopMinecraftMonitor =
        startMinecraftMonitor(this);

      startupLog(
        'Tropical SMP status monitor started'
      );
    } catch (error) {
      logger.error(
        'Failed to start bot:',
        error
      );

      process.exit(1);
    }
  }

  startWebServer() {
    const app = express();

    const configuredPort = Number(
      this.config.api?.port ||
      process.env.PORT ||
      3000
    );

    const maxPortRetryAttempts = Number(
      process.env.PORT_RETRY_ATTEMPTS || 5
    );

    const host =
      process.env.WEB_HOST || '0.0.0.0';

    const corsOrigin =
      this.config.api?.cors?.origin || '*';

    app.use((req, res, next) => {
      const allowedOrigins = Array.isArray(corsOrigin)
        ? corsOrigin
        : [corsOrigin];

      const origin = req.headers.origin;

      if (
        allowedOrigins.includes('*') ||
        allowedOrigins.includes(origin)
      ) {
        res.header(
          'Access-Control-Allow-Origin',
          origin || '*'
        );
      }

      res.header(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS'
      );

      res.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization'
      );

      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }

      next();
    });

    const requestCounts = new Map();

    const windowMs =
      this.config.api?.rateLimit?.windowMs ||
      60000;

    const maxRequests =
      this.config.api?.rateLimit?.max ||
      100;

    app.use((req, res, next) => {
      const ip = req.ip;
      const now = Date.now();
      const windowStart = now - windowMs;

      if (!requestCounts.has(ip)) {
        requestCounts.set(ip, []);
      }

      const times = requestCounts
        .get(ip)
        .filter(time => time > windowStart);

      if (times.length >= maxRequests) {
        return res.status(429).json({
          error: 'Too many requests',
        });
      }

      times.push(now);
      requestCounts.set(ip, times);

      next();
    });

    app.get('/health', (req, res) => {
      const dbStatus =
        this.db?.getStatus?.() ||
        { isDegraded: 'unknown' };

      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: {
          connected:
            dbStatus.connectionType !== 'none',
          degraded: dbStatus.isDegraded,
          type: dbStatus.connectionType,
        },
      });
    });

    app.get('/ready', (req, res) => {
      const dbStatus =
        this.db?.getStatus?.() || {
          isDegraded: true,
          connectionType: 'none',
        };

      const isReady =
        this.isReady() && !dbStatus.isDegraded;

      const metrics = {
        guildCount:
          this.guilds?.cache?.size ?? 0,

        commandCount:
          this.commands?.size ?? 0,

        database: {
          mode: dbStatus.connectionType,
          degraded: dbStatus.isDegraded,
          degradedReason:
            dbStatus.degradedReason ?? null,
        },

        schemaVersion: EXPECTED_SCHEMA_VERSION,
        schemaLabel: EXPECTED_SCHEMA_LABEL,
      };

      if (isReady) {
        return res.status(200).json({
          ready: true,
          message: 'Bot is ready',
          metrics,
        });
      }

      res.status(503).json({
        ready: false,
        reason: !this.isReady()
          ? 'Bot not Ready'
          : 'Database degraded',
        metrics,
      });
    });

    app.get('/', (req, res) => {
      res.status(200).json({
        message: 'TitanBot System Online',
        version: pkg.version,
        timestamp: new Date().toISOString(),
      });
    });

    const startServer = (port, attempt = 0) => {
      let hasStartedListening = false;

      const server = app.listen(port, host, () => {
        hasStartedListening = true;
        this.webServer = server;

        startupLog(
          `✅ Web Server running on ${host}:${port}`
        );

        startupLog(
          `Health endpoint: http://${host}:${port}/health`
        );

        startupLog(
          `Ready endpoint: http://${host}:${port}/ready`
        );
      });

      server.on('error', error => {
        const errorCode =
          error?.code || 'UNKNOWN_ERROR';

        const errorMessage =
          error?.message || 'Unknown server error';

        if (
          !hasStartedListening &&
          errorCode === 'EADDRINUSE' &&
          attempt < maxPortRetryAttempts
        ) {
          const nextPort = port + 1;

          startupLog(
            `Port ${port} is already in use. Trying port ${nextPort}...`
          );

          setTimeout(
            () => startServer(nextPort, attempt + 1),
            250
          );

          return;
        }

        if (
          hasStartedListening &&
          errorCode === 'EADDRINUSE'
        ) {
          logger.warn(
            `Web server reported a duplicate bind warning on ` +
            `${host}:${port}, but the bot remains online.`
          );

          return;
        }

        logger.error(
          `❌ Web server error on port ${port} ` +
          `(${errorCode}): ${errorMessage}`
        );

        if (!hasStartedListening) {
          process.exit(1);
        }
      });
    };

    startServer(configuredPort, 0);
  }

  setupCronJobs() {
    cron.schedule(
      '0 6 * * *',
      runSafeTask(
        'birthday_check',
        () => checkBirthdays(this)
      )
    );

    cron.schedule(
      '* * * * *',
      runSafeTask(
        'giveaway_check',
        () => checkGiveaways(this)
      )
    );

    cron.schedule(
      '*/15 * * * *',
      runSafeTask(
        'counter_update',
        () => this.updateAllCounters()
      )
    );
  }

  async updateAllCounters() {
    if (!this.db) {
      logger.warn(
        'Database not available for counter updates'
      );
      return;
    }

    for (const [guildId, guild] of this.guilds.cache) {
      try {
        const counters = await getServerCounters(
          this,
          guildId
        );

        const validCounters = [];
        const orphanedCounters = [];

        for (const counter of counters) {
          if (
            counter &&
            counter.type &&
            counter.channelId &&
            counter.enabled !== false
          ) {
            const channel = guild.channels.cache.get(
              counter.channelId
            );

            if (channel) {
              validCounters.push(counter);

              await updateCounter(
                this,
                guild,
                counter
              );
            } else {
              orphanedCounters.push(counter);

              logger.info(
                `Removing orphaned counter ${counter.id} ` +
                `(type: ${counter.type}, deleted channel: ` +
                `${counter.channelId}) from guild ${guildId}`
              );
            }
          }
        }

        if (orphanedCounters.length > 0) {
          await saveServerCounters(
            this,
            guildId,
            validCounters
          );

          logger.info(
            `Cleaned up ${orphanedCounters.length} ` +
            `orphaned counter(s) from guild ${guildId}`
          );
        }
      } catch (error) {
        logger.error(
          `Error updating counters for guild ${guildId}:`,
          error
        );
      }
    }
  }

  async loadHandlers() {
    startupLog('Loading handlers...');

    const handlers = [
      {
        path: 'events',
        type: 'default',
        required: true,
      },
      {
        path: 'interactions',
        type: 'default',
        required: true,
      },
    ];

    for (const handler of handlers) {
      try {
        startupLog(
          `Loading handler: ${handler.path}`
        );

        const module = await import(
          `./handlers/loaders/${handler.path}.js`
        );

        const loaderFn = handler.type.startsWith('named:')
          ? module[handler.type.split(':')[1]]
          : module.default;

        if (typeof loaderFn === 'function') {
          await loaderFn(this);

          startupLog(
            `✅ Loaded ${handler.path}`
          );
        } else {
          throw new Error(
            `Invalid loader export from ${handler.path}`
          );
        }
      } catch (error) {
        if (handler.required) {
          logger.error(
            `❌ Failed to load required handler ${handler.path}:`,
            error.message
          );

          throw error;
        } else if (error.code !== 'MODULE_NOT_FOUND') {
          logger.warn(
            `⚠️ Failed to load optional handler ${handler.path}:`,
            error.message
          );
        }
      }
    }
  }

  async registerCommands() {
    try {
      await registerSlashCommands(this, {
        clientId: this.config.bot.clientId,
      });
    } catch (error) {
      logger.error(
        'Error registering commands:',
        error
      );
    }
  }

  async shutdown(reason = 'UNKNOWN') {
    shutdownLog(
      `Bot is shutting down (${reason})...`
    );

    logger.info(
      `🛑 Graceful Shutdown Initiated (${reason})`
    );

    try {
      this.stopMinecraftMonitor?.();

      logger.info('Stopping cron jobs...');

      cron.getTasks().forEach(task => task.stop());

      logger.info('✅ Cron jobs stopped');

      logger.info('Stopping music players...');
      await shutdownMusic(this);

      logger.info('✅ Music players stopped');

      if (this.webServer) {
        logger.info('Closing web server...');

        await new Promise(resolve =>
          this.webServer.close(resolve)
        );

        logger.info('✅ Web server closed');
      }

      if (this.db && this.db.db) {
        logger.info('Closing database connection...');

        try {
          if (this.db.db.pool) {
            await this.db.db.pool.end();

            logger.info(
              '✅ Database connection closed'
            );
          }
        } catch (error) {
          logger.warn(
            'Error closing database pool:',
            error.message
          );
        }
      }

      logger.info('Destroying Discord client...');

      if (this.isReady()) {
        try {
          this.destroy();

          logger.info(
            '✅ Discord client destroyed'
          );
        } catch (error) {
          logger.warn(
            'Discord client destroy warning (non-critical):',
            error.message
          );
        }
      }

      logger.info(
        '✅ Graceful shutdown complete'
      );

      shutdownLog(
        'Bot stopped successfully.'
      );

      process.exit(0);
    } catch (error) {
      logger.error(
        'Error during graceful shutdown:',
        error
      );

      process.exit(1);
    }
  }
}

try {
  const bot = new TitanBot();

  process.on('SIGTERM', () =>
    bot.shutdown('SIGTERM')
  );

  process.on('SIGINT', () =>
    bot.shutdown('SIGINT')
  );

  process.on('uncaughtException', error => {
    handleTaskError(
      'uncaught_exception',
      error,
      { fatal: true }
    );

    bot.shutdown('UNCAUGHT_EXCEPTION');
  });

  process.on('unhandledRejection', reason => {
    const code = reason?.code;

    if (
      code === 10062 ||
      code === 40060 ||
      code === 50027
    ) {
      logger.warn(
        'Recoverable Discord interaction rejection:',
        reason?.message || reason
      );

      return;
    }

    if (
      reason?.message?.includes('Queue is empty')
    ) {
      return;
    }

    handleTaskError(
      'unhandled_rejection',
      reason instanceof Error
        ? reason
        : new Error(String(reason)),
      {
        errorCode: ErrorCodes.UNHANDLED_REJECTION,
      }
    );
  });

  bot.start().catch(error => {
    logger.error(
      'Fatal error during bot startup:',
      error
    );

    bot.shutdown('STARTUP_ERROR');
  });
} catch (error) {
  logger.error(
    'Fatal error during bot startup:',
    error
  );

  process.exit(1);
}

export default TitanBot;
