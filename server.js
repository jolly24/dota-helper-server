// server.js – Главный сервер AI-помощника для Dota 2 (патч 7.38+)
const http = require('http');
const WebSocket = require('ws');
const aiCoach = require('./ai-coach');
require('dotenv').config();

// ========== 1. Настройки ==========
const AI_COOLDOWN = 60000;          // AI-совет раз в 60 секунд
const EVENT_COOLDOWN = 30000;       // Для событийных напоминаний
let lastAiTime = 0;
let lastEventTimes = {};

// ========== 2. WebSocket сервер ==========
const wss = new WebSocket.Server({ port: 3001 });
const clients = new Set();

wss.on('connection', (ws) => {
    console.log('🟢 Оверлей подключился');
    clients.add(ws);
    ws.on('close', () => {
        console.log('🔴 Оверлей отключился');
        clients.delete(ws);
    });
});

console.log(`🌐 WebSocket сервер запущен на порту 3001`);

function sendAdvice(adviceText) {
    const message = JSON.stringify({ type: 'advice', text: adviceText });
    for (let client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

// ========== 3. Хранилище состояния игры ==========
let gameState = {};

// ========== 4. HTTP сервер для приёма данных GSI ==========
const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
        try {
            const data = JSON.parse(body);
            // Обновляем состояние
            if (data.provider) gameState.provider = data.provider;
            if (data.map) {
                // Сохраняем предыдущее состояние дня/ночи для отслеживания смены
                if (gameState.map) {
                    data.map.prevDaytime = gameState.map.daytime;
                }
                gameState.map = data.map;
            }
            if (data.player) gameState.player = data.player;
            if (data.hero) gameState.hero = data.hero;
            if (data.abilities) gameState.abilities = data.abilities;
            if (data.items) gameState.items = data.items;

            const now = Date.now();

            // ===== AI-советы (раз в AI_COOLDOWN) =====
            if (data.hero && (now - lastAiTime > AI_COOLDOWN)) {
                lastAiTime = now;
                try {
                    const advice = await aiCoach.generateAdvice(data.hero, gameState);
                    if (advice) sendAdvice(advice);
                } catch (e) {
                    console.error('AI ошибка:', e.message);
                }
            }

            // ===== Событийные напоминания =====
            checkEventReminders(data, now);

            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
        } catch (err) {
            console.error('Ошибка парсинга JSON:', err.message);
            res.writeHead(400);
            res.end();
        }
    });
});

server.listen(3000, () => {
    console.log('🎯 GSI HTTP-сервер запущен и слушает порт 3000');
});

// ========== 5. Функция проверки событий с актуальными таймингами ==========
function checkEventReminders(data, now) {
    if (!data.map) return;

    const gameTime = data.map.game_time || 0;
    const minutes = Math.floor(gameTime / 60);
    const seconds = gameTime % 60;
    
    // Определяем режим игры (Turbo или обычный)
    const isTurbo = data.map.game_mode?.includes('Turbo') || false;

    // 5.1 Руны богатства (Bounty) – каждые 4 минуты
    const bountyRuneTime = 240; // 4 минуты в секундах
    const timeToNextBounty = bountyRuneTime - (gameTime % bountyRuneTime);
    if (timeToNextBounty <= 10 && timeToNextBounty > 0) {
        const key = 'bounty_rune';
        if (!lastEventTimes[key] || now - lastEventTimes[key] > 20000) {
            lastEventTimes[key] = now;
            const goldAmount = isTurbo ? 72 + Math.floor(minutes / 5) * 18 : 36 + Math.floor(minutes / 5) * 9;
            sendAdvice(`💰 Руны богатства через ${timeToNextBounty} сек. (+${goldAmount} золота команде)`);
        }
    }

    // 5.2 Руны усиления (Power Runes) – с 6:00, каждые 2 минуты
    if (gameTime >= 360) { // 6 минут
        const powerRuneTime = 120; // 2 минуты
        const timeToNextPower = powerRuneTime - ((gameTime - 360) % powerRuneTime);
        if (timeToNextPower <= 10 && timeToNextPower > 0) {
            const key = 'power_rune';
            if (!lastEventTimes[key] || now - lastEventTimes[key] > 20000) {
                lastEventTimes[key] = now;
                sendAdvice(`⚡ Руны усиления через ${timeToNextPower} сек. (река, контроль!)`);
            }
        }
    }

    // 5.3 Святилища мудрости (Wisdom Shrines) – каждые 7 минут
    const wisdomShrineTime = 420; // 7 минут
    const timeToNextWisdom = wisdomShrineTime - (gameTime % wisdomShrineTime);
    if (timeToNextWisdom <= 15 && timeToNextWisdom > 0) {
        const key = 'wisdom_shrine';
        if (!lastEventTimes[key] || now - lastEventTimes[key] > 30000) {
            lastEventTimes[key] = now;
            sendAdvice(`📚 Святилище мудрости через ${timeToNextWisdom} сек. (нужно стоять 3 сек без врагов рядом)`);
        }
    }

    // 5.4 Смена дня/ночи (каждые 4 минуты)
    if (data.map.prevDaytime !== undefined && data.map.prevDaytime !== data.map.daytime) {
        const key = 'daynight';
        if (!lastEventTimes[key] || now - lastEventTimes[key] > 40000) {
            lastEventTimes[key] = now;
            const msg = data.map.daytime 
                ? '☀️ Рассвело. Видимость нормальная.' 
                : '🌙 Наступила ночь. Уменьшена видимость, бонусы для Night Stalker.';
            sendAdvice(msg);
        }
    }

    // 5.5 Терзатель (Tormentor) – первый в 15:00, затем каждые 10 минут
    if (gameTime >= 900) { // 15 минут
        const tormentorTime = 600; // 10 минут
        const timeSinceFirst = gameTime - 900;
        const timeToNextTormentor = tormentorTime - (timeSinceFirst % tormentorTime);
        if (timeToNextTormentor <= 20 && timeToNextTormentor > 0) {
            const key = 'tormentor';
            if (!lastEventTimes[key] || now - lastEventTimes[key] > 40000) {
                lastEventTimes[key] = now;
                sendAdvice(`👹 Терзатель через ${Math.round(timeToNextTormentor)} сек. (дает Аегис и нейтралку)`);
            }
        }
    }

    // 5.6 Рошан – информация из HUD (теперь таймер виден всем)
    // В GSI может быть поле roshan_timer или аналогичное
    if (data.map.roshan_timer !== undefined && data.map.roshan_timer > 0) {
        const key = 'roshan';
        if (!lastEventTimes[key] || now - lastEventTimes[key] > 60000) {
            lastEventTimes[key] = now;
            sendAdvice(`👑 Рошан возродится через ~${Math.round(data.map.roshan_timer)} сек.`);
        }
    }
}

// ========== 6. Запуск ==========
console.log('🚀 Сервер-помощник запущен. AI-советы раз в 60 сек, события с актуальными таймингами');
console.log('📊 Тайминги: Bounty 4мин | Power с 6мин каждые 2мин | Wisdom 7мин | День/ночь 4мин');